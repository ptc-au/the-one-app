// Who signs in to a network, and what they let act as them: Better Auth, kept in this Worker's own database. A
// person signs in with a passkey, or with Google where the network has a Google client (`GOOGLE_CLIENT_ID`): someone
// invited joins with their Google account as with a passkey, and anyone whose Google Workspace domain the network's
// owner named (`domains`) joins by signing in. An assistant becomes theirs when they answer that one question
// for it, and a new device when they also say the code it shows matches the one they're shown, as Better Auth's
// device authorization has it, or when a device or assistant of theirs lets it in by that code. Whose each device is,
// a server keeps a copy of, which it copies from here (`whose`), so a call asks nothing here. What a person goes by
// is a line in this app's own artifact, `people/<name>`: the name they chose as they joined, and their email where
// how they signed in has one, which a server tells apps of by `people`.
import { env } from "cloudflare:workers";
import { betterAuth, getCurrentAdapter } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getAuthoritativeSessionFromCtx, getOAuthState, getSessionFromCtx } from "better-auth/api";
import { jwt, testUtils } from "better-auth/plugins";
import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import { DEVICE_CODE_GRANT_TYPE, getIssuer, oauthDeviceAuthorization, verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import Bowser from "bowser";
import * as z from "zod";
import { keepGoogle, keepNetwork, MOST, removeAll, setOwn } from "./pictures.ts";
import type { BetterAuthOptions, BetterAuthPlugin, DBAdapter, GenericEndpointContext, User as AuthUser } from "better-auth";

declare global {
  namespace Cloudflare {
    /** Its bindings: its database and page, and what the edge gives every app's part (`core/edge/edge.js`). */
    interface Env {
      DB: D1Database;
      ASSETS: Fetcher;
      /** Which deployed version of this Worker this is (`version_metadata` in `wrangler.jsonc`). */
      VERSION: WorkerVersionMetadata;
      OWN: {
        write(name: string, data: string): Promise<boolean>;
        update(name: string, change: (was: string | null) => string | Promise<string>): Promise<string>;
        remove(name: string): Promise<void>;
      };
      NETWORK: {
        verifiedKey(url: string, headers: Record<string, string>, body: string): Promise<string | null>;
        unsigned(url: string, headers: Record<string, string>): Promise<Response>;
        servers(of?: string): Promise<string[]>;
        owner(): Promise<string | null>;
      };
      RELAY: {
        notify(message: string): Promise<void>;
        forward(servers: string[], message: string): Promise<{ server: string; answer: string } | null>;
        presence(keys: string[]): Promise<Record<string, { connected: boolean; last_seen?: number } | null>>;
      };
      /** The apps that use this network's passkeys and open its links (`vars` in `wrangler.jsonc`). */
      APPLE_APPS: string[];
      ANDROID_APPS: string[];
      ANDROID_KEYS: string[];
      APP_LINKS: string[];
      /**
       * The network's Google OAuth client, a web application's, whose redirect URI is
       * `<address>/sign-in/auth/callback/google`: secrets the network's own deploy sets, if it signs people in with
       * Google. Without them nobody does.
       */
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
    }
  }
}

/** What of Better Auth's database adapter is used here, whatever options it was made with. */
type Adapter = Pick<DBAdapter, "findMany" | "findOne" | "create" | "update" | "delete" | "deleteMany" | "incrementOne">;

/** Someone, as Better Auth keeps them here: `users/<name>`, and the name they go by. */
type User = AuthUser & { called?: string | null };

/** Someone's account at this network, as a passkey of theirs is named: what they go by, and the network's address. */
const account = (user: User, origin: string) => `${user.called || user.name} · ${new URL(origin).host}`;

/** A device or an assistant someone let act as them. */
interface Device {
  id: string;
  userId: string;
  kind: "app" | "assistant";
  name: string;
  /** The command a person types to run the program that was let in, if it's one run from a terminal: `ptc`. */
  command?: string | null;
  createdAt: Date;
}

/** A device's code, as Better Auth's device authorization keeps it, with what the device calls itself. */
interface DeviceCode {
  id: string;
  deviceCode: string;
  userCode: string;
  clientId: string;
  userId?: string | null;
  status: "pending" | "approved" | "denied";
  expiresAt: Date;
  name: string;
  /** What `Device` says of the command. */
  command?: string | null;
}

/**
 * Where a new device's code is: waiting until someone signed in says it matches, or lets it in by it (`approve`), and
 * then approved; denied when they stop it; expired when its time passes with neither. Approved, denied and expired
 * are ends: the device learns which as it next asks (`/device/token`), and Better Auth forgets its code.
 */
type RequestState = "waiting" | "approved" | "denied" | "expired";

/**
 * An invitation: the hash of its link, whose it is, and when it ends; the device that asked for it, if one did; and
 * the passkey made with it, by its credential ID, once one was, when it ended.
 */
interface Invite {
  id: string;
  userId: string;
  expiresAt: Date;
  device?: string | null;
  credential?: string | null;
}

/** How long ago someone may have answered the passkey question for it to count as them saying yes now, in seconds. */
const FRESH = 5 * 60;
/**
 * How long a browser's session, once checked against the database, is believed without checking again, in seconds:
 * Better Auth's cookie cache, and an app's page's session (`worker.ts`). A session signed out or removed is still
 * let in here that long at most. The servers stop answering it at once, as its device is nobody's from then on
 * (`gone`), so all it still reaches is `/apps`, and app files' code.
 */
export const BELIEVED = 60;
/**
 * How long a browser's session lasts without being used, in seconds, as Google's and GitHub's do: Better Auth moves
 * its end on each day it's used, and one not used for this long ends and leaves the list of devices.
 */
const UNUSED = 30 * 24 * 60 * 60;
/** How long an invitation lasts, in milliseconds. */
const INVITED_FOR = 7 * 24 * 60 * 60 * 1000;
/**
 * How many codes no device shows a person may look up or let in by, and over how long, in seconds: on the sign-in
 * page (`/device`) and by the `approve` ask alike, counted for the person, never for the address they ask from, which
 * a household or an office shares. A code is one of 32⁸, so this only stops guessing at speed, and a code a device
 * shows is never counted. It's counted in the table Better Auth keeps its own limits in.
 */
const WRONG_CODES = { max: 5, window: 15 * 60 };
/** What `WRONG_CODES` counts for `user`. */
const wrongCodes = (adapter: Adapter, user: { id: string }) => limit(adapter, `wrong-codes/${user.id}`, WRONG_CODES);
/** What a person who tried too many codes no device shows is told. */
const tooManyCodes = (minutes: number) => `That's too many codes no device showed. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
const sha256 = async (text: string) => bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));

/** What a browser is called, from what it says of itself: "Chrome on Linux". */
function browser(agent?: string | null) {
  const { browser, os } = Bowser.parse(agent || " ");
  return [browser.name, os.name].filter(Boolean).join(" on ") || "A browser";
}

/** A user as relation tuples name them. Their name here is the part after `users/`. */
export const who = (user: { name: string }) => `users/${user.name}`;

/**
 * The device an assistant somewhere else is, to a server: one for each program a person let in, named by both.
 * It's the size of a key and nobody's key, so it never names a device that connects by one.
 */
export const assistant = (client: string, user: string) => sha256(`${client}\n${user}`);

/**
 * The device a browser that's signed in here is, to a server: one for each of its sessions, the size of a key and
 * nobody's key, as an assistant's is.
 */
export const browserDevice = (session: string) => sha256(`browser\n${session}`);

/**
 * What signs this Worker's cookies and tokens, kept beside what it protects. It's made once, as the database's tables
 * are, by its migrations at deploy (`migrations/`): a request only reads it, which D1 retries itself where it fails
 * for a moment.
 */
async function secret() {
  const kept = await env.DB.prepare("select secret from secret").first<{ secret: string }>();
  if (!kept) throw new Error("The sign-in database has no secret: its migrations haven't been applied (`bun edge.js deploy`)");
  return kept.secret;
}

/**
 * The tables that say who's in the network and what lets them in: its people, their passkeys, with each one's
 * encrypted key, their devices, and its settings (`domains`). They're kept in this app's own artifact as
 * `accounts.json` (`keep`), so a backup of the bucket holds them (the Backups app). Sessions, tokens and the secret
 * that signs them aren't, nor Google's accounts, which hold Google's tokens: after a loss, people sign in again with
 * their passkeys, and with Google, which Better Auth links to them again by their verified email.
 */
const KEPT = ["user", "passkey", "device", "setting"] as const;

/**
 * Keeps the database's people, passkeys and devices in the bucket, as `KEPT` says, writing only what changed. A
 * database with nobody in it, as one made anew after the old was lost, is given back what was kept, which is how a
 * network restored from a backup gets its people back. The edge calls this every ten minutes (`wrangler.jsonc`).
 */
export async function keep() {
  const anyone = await env.DB.prepare("select 1 from user limit 1").first();
  await env.OWN.update("accounts.json", async (was) => {
    if (!anyone && was) {
      const kept: Record<string, Record<string, unknown>[]> = JSON.parse(was);
      await env.DB.batch(
        KEPT.flatMap((table) =>
          (kept[table] ?? []).map((row) => {
            const columns = Object.keys(row);
            const sql = `insert into "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) values (${columns.map(() => "?").join(", ")})`;
            return env.DB.prepare(sql).bind(...Object.values(row));
          }),
        ),
      );
      console.log(`Gave sign-in's database back its ${kept.user.length} people, as kept in the bucket`);
      return was;
    }
    const rows = await env.DB.batch(KEPT.map((table) => env.DB.prepare(`select * from "${table}" order by rowid`)));
    return JSON.stringify(Object.fromEntries(KEPT.map((table, at) => [table, rows[at].results])));
  });
}

/**
 * Says whose a device is has changed: the version `whose` gives moves on, so a copy made from an older answer is
 * never kept over a newer one. It's a time, in milliseconds, or one more than the last where that's later, so it moves
 * on after a backup that kept an older one is given back (`keep`) too.
 */
async function changed() {
  await env.DB.prepare("insert into setting (name, value) values ('devices', ?1) on conflict (name) do update set value = max(cast(value as integer) + 1, ?1)").bind(Date.now()).run();
}

/**
 * A browser that signs in again, as it does for an approval that needs a new sign-in, replaces the session it had: the
 * one its request carries is deleted, as the cookie for it is replaced.
 */
async function replaced(session: { token: string }, ctx: GenericEndpointContext | null) {
  await changed();
  const old = ctx && (await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret));
  if (old && old !== session.token) await ctx.context.internalAdapter.deleteSession(old);
}

/**
 * Has one of the network's servers copy whose each device is (`whose`), for every server: the server's `copy`, which
 * only reads what's here, so whoever asks for it is nobody, as a sharing link's holder is to a server. One that finds
 * the copy as new as what's here writes nothing.
 */
export async function copied() {
  const call = { name: "sign-in_copy", arguments: {}, _meta: { link: "network/sign-in" } };
  const reached = await env.RELAY.forward(await env.NETWORK.servers(), JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: call }));
  const { result, error }: { result?: { isError?: boolean; content?: { text?: string }[] }; error?: { message?: string } } = JSON.parse(reached?.answer ?? "{}");
  if (!reached || error || result?.isError)
    console.error(`No server copied whose each device is just now: ${reached ? (error?.message ?? result?.content?.[0]?.text) : "none answered"}`);
}

/**
 * Makes what's gone nobody's on every server: one of them copies whose each device is again, and then every server is
 * told to ask again. Where none answers, one copies it at the next ten minutes (`scheduled` in `worker.ts`).
 */
async function gone() {
  await changed();
  await copied();
  await env.RELAY.notify(JSON.stringify({ jsonrpc: "2.0", method: "notifications/one/invalidate", params: { hooks: ["device"] } }));
}

/** Deletes the sessions that ended (`UNUSED`), which Better Auth otherwise deletes only as one is used again. The edge calls this every ten minutes. */
export async function expire() {
  await env.DB.prepare('delete from session where "expiresAt" <= ?').bind(new Date().toISOString()).run();
}

/**
 * Whose each device is, as a server keeps a copy of it (`SignIn`): each device and assistant, and each browser that's
 * signed in, by its key, with the version of that (`changed`), all as one read.
 */
async function whose() {
  const [version, devices, sessions] = await env.DB.batch<{ value?: string; id?: string; name: string }>([
    env.DB.prepare("select value from setting where name = 'devices'"),
    env.DB.prepare('select device.id, user.name from device join user on user.id = device."userId"'),
    env.DB.prepare('select session.id, user.name from session join user on user.id = session."userId" where session."expiresAt" > ?').bind(new Date().toISOString()),
  ]);
  const browsers = await Promise.all(sessions.results.map(async ({ id, name }) => [await browserDevice(id!), who({ name })]));
  return {
    version: Number(version.results[0]?.value ?? 0),
    devices: Object.fromEntries([...devices.results.map(({ id, name }) => [id, who({ name })]), ...browsers]),
  };
}

/** Makes `device` the user's, under `name`, from now on, and says which command ran it if it was run from a terminal. */
async function place(adapter: Adapter, device: string, kind: Device["kind"], name: string, user: { id: string; name: string }, command?: string | null) {
  const [was] = await adapter.findMany<Device>({ model: "device", where: [{ field: "id", value: device }] });
  if (was) await remove(adapter, was);
  await adapter.create({ model: "device", data: { id: device, userId: user.id, kind, name, command: command ?? null, createdAt: new Date() }, forceAllowId: true });
  await changed();
}

/**
 * Writes what `user` goes by where a server reads it: the name they chose, and their email where it's one they
 * proved. Better Auth keeps an email for everyone, made up for whoever signs in only with a passkey, which isn't one.
 */
async function goesBy(user: User) {
  const person = { called: user.called ?? null, email: user.emailVerified ? user.email : null };
  await env.OWN.update(`people/${user.name}`, () => JSON.stringify(person));
}

/** The picture in a Google ID token's claims (`picture`), whose address Google sizes, or null. The token is Google's own, handed over as Better Auth signed them in. */
function pictureOf(idToken: string | null | undefined) {
  try {
    const claims = JSON.parse(atob(idToken!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims.picture === "string" ? claims.picture : null;
  } catch {
    return null;
  }
}

/** Takes the picture Google has for someone who signed in with it, which Better Auth keeps the ID token of each time they do. */
async function fromGoogle(account: { userId: string; providerId: string; idToken?: string | null }) {
  if (account.providerId !== "google") return;
  const user = await env.DB.prepare('select name from "user" where id = ?').bind(account.userId).first<{ name: string }>();
  // Someone not made yet has theirs taken at the next ten minutes (`pictures`), as does one Google didn't answer for, as signing in doesn't wait for it.
  if (user) await keepGoogle(user.name, pictureOf(account.idToken)).catch((error) => console.error(`Couldn't take ${user.name}'s picture from Google: ${error.message}`));
}

/** Takes Google's picture for everyone who signed in with it and has none kept, and the network's, which the edge calls every ten minutes (`wrangler.jsonc`), as a network made before pictures was has none. */
export async function pictures() {
  const { results } = await env.DB.prepare(`select "user".name as name, account.idToken as token from account join "user" on "user".id = account.userId where account.providerId = 'google'`).all<{ name: string; token: string | null }>();
  await Promise.all(results.map(({ name, token }) => keepGoogle(name, pictureOf(token)).catch((error) => console.error(`Couldn't take ${name}'s picture from Google: ${error.message}`))));
  await keepNetwork((await network()).icon?.png ?? null, false);
}

/** Makes a device nobody's, on every server. */
async function remove(adapter: Adapter, device: { id: string }) {
  await adapter.delete({ model: "device", where: [{ field: "id", value: device.id }] });
  await gone();
}

/** The invitation a link carries, if it's one that still stands. The link is kept nowhere: only its hash is. */
async function invited(adapter: Adapter, link: string | undefined) {
  const [invite] = await adapter.findMany<Invite>({ model: "invite", where: [{ field: "id", value: await sha256(link ?? "") }] });
  if (!invite || invite.expiresAt < new Date()) throw new APIError("FORBIDDEN", { code: "invitation_expired", message: "That invitation expired. Ask for another." });
  return invite;
}

/**
 * Where a device asks for a code and for its answer, as the metadata says (RFC 8628): the device authorization
 * endpoint, and the token endpoint with the device code grant. Each names its key as `client_id`.
 */
const DEVICE_CODE = "/sign-in/auth/device/code";
const TOKEN = "/sign-in/auth/oauth2/token";
/** Where Better Auth answers a device that isn't an OAuth client, with a session the device has no use for. */
const DEVICE_TOKEN = "/sign-in/auth/device/token";
/** Where a person signs in, which the authorization endpoint shows one who comes with nothing to authorize. */
const AUTHORIZE = "/sign-in/auth/oauth2/authorize";
const SIGN_IN = "/sign-in/";

/** A passkey as Better Auth keeps it, with what lets it unlock its person's key. */
interface Passkey {
  id: string;
  userId: string;
  name?: string;
  credentialID: string;
  createdAt: Date;
  prfKey?: string | null;
  encryptedKey?: string | null;
  replaces?: string | null;
  /** The device whose Add Passkey made it. */
  device?: string | null;
}

/**
 * The passkey named by `credential` in what the sign-in page asks, which this browser's session was made with in the
 * last few minutes, and whose it is: what it says of a passkey's PRF output is believed only from that passkey.
 */
async function usedJustNow(ctx: { body?: { credential?: unknown } } & Parameters<typeof getAuthoritativeSessionFromCtx>[0]) {
  const session = await getAuthoritativeSessionFromCtx(ctx);
  const credential = String(ctx.body?.credential ?? "");
  const made = session as { session: { passkey?: string | null; createdAt: Date } } | null;
  if (!session || made!.session.passkey !== credential || Date.now() - new Date(made!.session.createdAt).getTime() >= FRESH * 1000)
    throw new APIError("FORBIDDEN", { message: "Sign in again with that passkey." });
  const [passkey] = await ctx.context.adapter.findMany<Passkey>({ model: "passkey", where: [{ field: "userId", value: session.user.id }, { field: "credentialID", value: credential }] });
  if (!passkey) throw new APIError("FORBIDDEN", { message: "That isn't one of your passkeys." });
  return { passkey, user: session.user as User };
}

/**
 * Throws unless this browser's session was made in the last few minutes, with a passkey or with Google: what lets
 * another device or an app act as its person is approved only by them just now, as WebAuthn's user verification and
 * GitHub's sudo mode have it, whatever a page asked first.
 */
async function signedInJustNow(ctx: Parameters<typeof getAuthoritativeSessionFromCtx>[0]) {
  const session = await getAuthoritativeSessionFromCtx(ctx);
  if (!session || Date.now() - new Date(session.session.createdAt).getTime() >= FRESH * 1000)
    throw new APIError("FORBIDDEN", { message: "Sign in again to approve this." });
}

/** A device's code as Better Auth looks it up: its letters and digits, in capitals. */
const plain = (code: unknown) => String(code).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

/**
 * Devices, the invitations people join by, and what ties a device's code to its key, beside what Better Auth
 * keeps. A device asks for its code with its key as `client_id`, signed with that key, so a code is only ever for
 * the key that asked for it, and the key is that device's once its person says the code matches.
 */
const devices = () => ({
  id: "devices",
  schema: {
    device: {
      fields: {
        userId: { type: "string", references: { model: "user", field: "id" } },
        // `app` connects by its key, and `assistant` comes in over the web with a token.
        kind: { type: "string" },
        name: { type: "string" },
        // `ptc` for the program a terminal ran, which signed it in (`ptc CLI on workspace`); nothing for an app.
        command: { type: "string", required: false },
        createdAt: { type: "date" },
      },
    },
    invite: { fields: { userId: { type: "string", references: { model: "user", field: "id" } }, expiresAt: { type: "date" }, device: { type: "string", required: false }, credential: { type: "string", required: false } } },
    // What a device that asked to be let in calls itself, which its person is shown with its code, and the command that
    // ran it if a terminal did.
    deviceCode: { fields: { name: { type: "string", required: false }, command: { type: "string", required: false } } },
    // What lets a passkey unlock its person's key on a new device (`page/passkey.ts`): the public key its PRF output
    // derives, empty for a passkey that said it has none, and their key, encrypted to it by a device that holds it.
    // A passkey made to replace one that can't unlock (`replaces`) takes its place once it unlocks the key.
    passkey: { fields: { prfKey: { type: "string", required: false }, encryptedKey: { type: "string", required: false }, replaces: { type: "string", required: false }, device: { type: "string", required: false } } },
    // The passkey a browser's session was made with, by its credential ID.
    session: { fields: { passkey: { type: "string", required: false } } },
  },
  endpoints: {
    /**
     * Where a device's code is (`RequestState`), or `unknown` for one Better Auth has forgotten or never made, so the
     * sign-in page says a code has ended before it asks anyone to sign in for it.
     */
    deviceState: createAuthEndpoint("/device/state", { method: "GET", query: z.object({ user_code: z.string() }) }, async (ctx) => {
      const code = await ctx.context.adapter.findOne<DeviceCode>({ model: "deviceCode", where: [{ field: "userCode", value: plain(ctx.query.user_code) }] });
      return ctx.json({ state: code ? state(code) : "unknown" });
    }),
    /** The ways besides a passkey someone signs in here, which the sign-in page offers: Google, where it's set up. */
    socialProviders: createAuthEndpoint("/social-providers", { method: "GET" }, async (ctx) =>
      ctx.json({ providers: env.GOOGLE_CLIENT_ID ? ["google"] : [] }),
    ),
    // The sign-in page says which key a passkey's PRF output derives, or that it gave none, as it's just been used.
    passkeyPrfKey: createAuthEndpoint("/passkey/prf-key", { method: "POST" }, async (ctx) => {
      const { passkey } = await usedJustNow(ctx);
      const key = ctx.body?.key === null ? "" : String(ctx.body?.key ?? "");
      if (key && !/^[0-9a-f]{64}$/.test(key)) throw new APIError("BAD_REQUEST", { message: "That isn't a passkey's key." });
      // One made to replace another of theirs that can't unlock says so, and takes its place once it unlocks the key
      // (`encrypt_for_passkeys`): the other stays until then, so they're never left with no way in.
      const [replaced] = key && ctx.body?.replaces ? await ctx.context.adapter.findMany<Passkey>({ model: "passkey", where: [{ field: "userId", value: passkey.userId }, { field: "id", value: String(ctx.body.replaces) }] }) : [];
      if (replaced && replaced.id !== passkey.id && !replaced.prfKey) await ctx.context.adapter.update({ model: "passkey", where: [{ field: "id", value: passkey.id }], update: { replaces: replaced.id } });
      // Made with the link a device of theirs asked for, it's that device's, which lets it unlock with no code to check.
      const [invite] = passkey.device ? [] : await ctx.context.adapter.findMany<Invite>({ model: "invite", where: [{ field: "credential", value: passkey.credentialID }] });
      if (invite?.device) await ctx.context.adapter.update({ model: "passkey", where: [{ field: "id", value: passkey.id }], update: { device: invite.device } });
      // A passkey that gave no PRF output this time, where a web view or provider didn't pass it on, keeps the key it
      // gave before, and what's encrypted to it.
      if (!key && passkey.prfKey) return ctx.json({});
      if (passkey.prfKey !== key) await ctx.context.adapter.update({ model: "passkey", where: [{ field: "id", value: passkey.id }], update: { prfKey: key, encryptedKey: null } });
      return ctx.json({});
    }),
    // Where a passkey just used has no PRF, the sign-in page makes one that has and replaces it, as Sign In & Security's
    // Add Passkey makes one.
    passkeyAnother: createAuthEndpoint("/passkey/another", { method: "POST" }, async (ctx) => {
      const { passkey, user } = await usedJustNow(ctx);
      const replaces = passkey.prfKey ? "" : `&replaces=${passkey.id}`;
      return ctx.json({ link: `/sign-in/?passkey#passkey=${await invitation(ctx.context.adapter, user, 15 * 60 * 1000)}${replaces}` });
    }),
    // What the sign-in page opens with a passkey's PRF output, on a new device: the person's key, encrypted to it.
    passkeyEncryptedKey: createAuthEndpoint("/passkey/encrypted-key", { method: "POST" }, async (ctx) => {
      const { passkey, user } = await usedJustNow(ctx);
      return ctx.json({ owner: who(user), key: passkey.encryptedKey || null });
    }),
  },
  async onRequest(request: Request) {
    const url = new URL(request.url);
    // The web client sends a person who isn't signed in to the authorization endpoint the metadata names, with no
    // OAuth client of its own: what it shows them is the page they sign in on.
    if (url.pathname === AUTHORIZE && request.method === "GET" && !url.searchParams.has("client_id"))
      return { response: Response.redirect(new URL(SIGN_IN, url.origin).href, 302) };
    if (url.pathname !== DEVICE_CODE && url.pathname !== TOKEN) return;
    // A device asks with a form, as RFC 8628 has it.
    const body = await request.clone().text();
    const form = Object.fromEntries(new URLSearchParams(body));
    if (url.pathname === TOKEN && form.grant_type !== DEVICE_CODE_GRANT_TYPE) return;
    // Whatever names a key as `client_id` is signed with it (`core/edge/ask.ts`).
    const key = await env.NETWORK.verifiedKey(request.url, Object.fromEntries(request.headers), body);
    if (!key || key !== form.client_id) {
      const refused = { error: "invalid_client", error_description: "Sign what you ask with the key it names, by a clock within 15 minutes of the right time" };
      return { response: Response.json(refused, { status: 401 }) };
    }
    // A device is no OAuth client, so it's answered as Better Auth answers a device of its own, which takes JSON.
    if (url.pathname === TOKEN)
      return { request: new Request(new URL(DEVICE_TOKEN, url.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }) };
  },
  hooks: {
    before: [
      {
        // Allow on the consent page goes on to the passkey question, so it has to have just been answered. Cancel
        // needs no one signed in: Better Auth asks for a session to say no, so it's answered here, as Better Auth
        // would, at the redirect its own authorization endpoint checked before it signed the query.
        matcher: (ctx) => ctx.path === "/oauth2/consent",
        handler: createAuthMiddleware(async (ctx) => {
          if (ctx.body?.accept !== true) {
            const signed = String(ctx.body?.oauth_query ?? "");
            if (!(await verifyOAuthQueryParams(signed, ctx.context.secret))) throw new APIError("BAD_REQUEST", { error: "invalid_signature" });
            const query = new URLSearchParams(signed);
            const denied = new URLSearchParams({ error: "access_denied", error_description: "User denied access" });
            if (query.get("state")) denied.set("state", query.get("state")!);
            denied.set("iss", getIssuer(ctx, { loginPage: SIGN_IN, consentPage: SIGN_IN }));
            const url = new URL(query.get("redirect_uri")!);
            for (const [name, value] of denied) url.searchParams.set(name, value);
            return ctx.json({ redirect: true, url: url.href });
          }
          await signedInJustNow(ctx);
        }),
      },
      {
        // A device's code is looked up only for someone signed in, and only so many codes no device shows
        // (`WRONG_CODES`), for them: Better Auth's own limit counts every lookup from an address.
        matcher: (ctx) => ctx.path === "/device",
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session) throw new APIError("UNAUTHORIZED", { message: "Sign in to approve a device." });
          const missed = await wrongCodes(ctx.context.adapter, session.user);
          if (missed.count >= WRONG_CODES.max) throw new APIError("TOO_MANY_REQUESTS", { message: tooManyCodes(missed.minutes) });
        }),
      },
      {
        // Approving a device makes it its person's from then on, so it's asked of a passkey just now.
        matcher: (ctx) => ctx.path === "/device/approve",
        handler: createAuthMiddleware(signedInJustNow),
      },
    ],
    after: [
      {
        // A browser's session keeps which passkey made it, so only that passkey's page says what unlocks with it.
        matcher: (ctx) => (ctx.path === "/passkey/verify-authentication" || ctx.path === "/passkey/verify-registration") && !!ctx.context.newSession,
        handler: createAuthMiddleware(async (ctx) => {
          await ctx.context.internalAdapter.updateSession(ctx.context.newSession!.session.token, { passkey: String(ctx.body.response.id) });
        }),
      },
      {
        // A device's code keeps what the device calls itself, and the command that ran it, if a terminal did.
        matcher: (ctx) => ctx.path === "/device/code" && !(ctx.context.returned instanceof Error),
        handler: createAuthMiddleware(async (ctx) => {
          const name = String(ctx.body.name ?? "").trim().slice(0, 100) || "A device";
          const command = String(ctx.body.command ?? "").trim().slice(0, 100) || null;
          await ctx.context.adapter.update({ model: "deviceCode", where: [{ field: "deviceCode", value: (ctx.context.returned as { device_code: string }).device_code }], update: { name, command } });
        }),
      },
      {
        // A code no device shows counts against whoever looked it up (`WRONG_CODES`).
        matcher: (ctx) => ctx.path === "/device" && (ctx.context.returned as { body?: { error?: string } } | undefined)?.body?.error === "invalid_request",
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (session) await (await wrongCodes(ctx.context.adapter, session.user)).again();
        }),
      },
      {
        // Whoever the code is shown to is told what it's for.
        matcher: (ctx) => ctx.path === "/device" && !!(ctx.context.returned as { client_id?: string } | undefined)?.client_id,
        handler: createAuthMiddleware(async (ctx) => {
          const code = await ctx.context.adapter.findOne<DeviceCode>({ model: "deviceCode", where: [{ field: "userCode", value: plain(ctx.query?.user_code) }] });
          return ctx.json({ ...(ctx.context.returned as object), name: code!.name });
        }),
      },
      {
        // A device whose code its person said matches is theirs from then on: the key that asked for that code.
        matcher: (ctx) => ctx.path === "/device/approve" && !(ctx.context.returned instanceof Error),
        handler: createAuthMiddleware(async (ctx) => {
          const { adapter } = ctx.context;
          const code = await adapter.findOne<DeviceCode>({ model: "deviceCode", where: [{ field: "userCode", value: plain(ctx.body.userCode) }] });
          const { user } = (await getSessionFromCtx(ctx))!;
          await place(adapter, code!.clientId, "app", code!.name, user, code!.command);
        }),
      },
      {
        // The device connects by its key, so the session Better Auth makes for it when it learns its answer would
        // only be listed as a browser that isn't one.
        matcher: (ctx) => ctx.path === "/device/token" && !!ctx.context.newSession,
        handler: createAuthMiddleware(async (ctx) => {
          await ctx.context.internalAdapter.deleteSession(ctx.context.newSession!.session.token);
        }),
      },
      {
        // An assistant that was just let in is one of that person's devices from then on.
        matcher: (ctx) => ctx.path === "/oauth2/consent" && ctx.body?.accept === true && !(ctx.context.returned instanceof Error),
        handler: createAuthMiddleware(async (ctx) => {
          const { adapter } = ctx.context;
          const { user } = (await getSessionFromCtx(ctx))!;
          const client = new URLSearchParams(ctx.body.oauth_query).get("client_id")!;
          const [{ name }] = await adapter.findMany<{ name?: string }>({ model: "oauthClient", where: [{ field: "clientId", value: client }] });
          await place(adapter, await assistant(client, user.id), "assistant", name || "An assistant", user);
        }),
      },
    ],
  },
}) satisfies BetterAuthPlugin;

/**
 * Fetches an assistant's metadata document, or what that names, as Better Auth's CIMD asks: over HTTPS, and never
 * by a redirect. Better Auth refuses an address that's private before asking. A name that resolves to one is
 * refused by Cloudflare itself, which resolves it once and connects to what it resolved: a Worker's fetch reaches
 * only the public internet.
 */
function fetchMetadata(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, { ...init, redirect: "manual" });
  if (new URL(request.url).protocol !== "https:" || !["GET", "HEAD"].includes(request.method)) throw new TypeError("Only an HTTPS GET or HEAD");
  return fetch(request);
}

/**
 * How Better Auth is set up for the network at `origin`, signing with `secret`, in `database`: the Worker's D1, or
 * the SQLite a migration is worked out against (`generate.ts`).
 */
export function options(origin: string, secret: string, database: BetterAuthOptions["database"] = env.DB, name = ONE_APP) {
  return {
    baseURL: origin,
    basePath: "/sign-in/auth",
    secret,
    database,
    // The JWT plugin signs the tokens an assistant is given, and hands out none of its own. A device asks for its
    // answer at the token endpoint, which passes it on to `/device/token` once it's checked its signature.
    disabledPaths: ["/token", "/device/token"],
    session: { expiresIn: UNUSED, freshAge: FRESH, cookieCache: { enabled: true, maxAge: BELIEVED } },
    // The name a person chose as they joined, which they can change: the one they're `users/<name>` by is chosen
    // for them, as they're invited, and never changes.
    user: {
      additionalFields: { called: { type: "string", required: false, input: true } },
      // Someone new joins with Google only by an invitation, or from a Workspace domain the network's owner named.
      validateUserInfo: async ({ source }) => {
        if (source.oauth?.providerId !== "google" || source.action !== "create-user") return;
        if ((await getOAuthState())?.invite || (await admits(source.oauth.profile ?? {}))) return;
        return { error: "not_invited", errorDescription: "This network lets your Google account in only with an invitation. Ask its owner for one." };
      },
    },
    // A network with a Google client signs people in with it too, choosing the account each time.
    socialProviders: env.GOOGLE_CLIENT_ID ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET!, prompt: "select_account" as const } } : {},
    databaseHooks: {
      user: {
        // Someone joining with Google is `users/<name>` by the invitation they came with, or by a name made of their
        // email, and goes by the name Google has for them. An invitation is for a user who hasn't joined, who's made
        // again as they join, by the same name.
        create: {
          before: async (user, ctx) => {
            if (ctx?.params?.id !== "google") return;
            // Better Auth makes the user in a transaction, which a query outside it would wait for.
            const adapter = await getCurrentAdapter(ctx.context.adapter);
            const invitee = await invitedToGoogle(adapter);
            if (invitee) {
              await adapter.deleteMany({ model: "invite", where: [{ field: "userId", value: invitee.id }] });
              await adapter.delete({ model: "user", where: [{ field: "id", value: invitee.id }] });
            }
            // The name someone joining typed on the sign-in page, which only says what they go by.
            const typed = String((await getOAuthState())?.called ?? "").trim().slice(0, 100);
            return { data: { ...user, name: invitee?.name ?? (await freeName(adapter, user.email)), called: typed || invitee?.called || user.name } };
          },
          after: goesBy,
        },
        update: { after: goesBy },
      },
      // Better Auth keeps Google's ID token each time someone signs in with it, which has their picture.
      account: { create: { after: fromGoogle }, update: { after: fromGoogle } },
      // A browser that's signed in is one of its person's devices for as long as it is: the web client asks as its
      // session (`worker.ts`).
      session: {
        create: { after: replaced },
        // After, as a device is removed (`remove`): what servers copy is what's here.
        delete: { after: gone },
      },
    },
    // Better Auth limits how often an address asks only where NODE_ENV says production, which a Worker's doesn't,
    // and counts in memory, which each copy of a Worker has its own of.
    // Better Auth's own limit on looking up a device's code counts every lookup from an address, which a household
    // or an office shares: that one is counted for the person instead (`WRONG_CODES`). Its limit on a token, 20 a
    // minute from an address, isn't kept: a token is only given for a refresh token or a code, which can't be guessed,
    // and every server and device behind one address asks for theirs at once as they start (PTC's three servers and
    // Andre's devices, 429 each time its machine restarted, 23 Nov).
    rateLimit: { enabled: true, storage: "database", customRules: { "/device": false, "/oauth2/token": false } },
    // Cloudflare says where a request came from in a header of its own. Its cookies are named the One App's, since a
    // browser sends a parent domain's cookies too, and another Better Auth there names its own `better-auth.*`,
    // which it would send first: a network at a subdomain wasn't signed in by its own after another's on its parent domain.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] }, cookiePrefix: "one" },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      passkey({
        // What a password manager names the passkey (WebAuthn's `rp.name`): the network's name (`network`), where it
        // named it after the host ("Ptcau").
        rpName: name,
        registration: {
          // Whoever holds an invitation makes their first passkey with it, signed in as nobody yet.
          requireSession: false,
          // A passkey is its person's account at this network, wherever it syncs to, so that's its name, in the
          // password manager that keeps it and in Sign In & Security: "André van Tonder · one.example.com".
          resolveUser: async ({ ctx, context }) => {
            const invite = await invited(ctx.context.adapter, context ?? undefined);
            const user = (await ctx.context.internalAdapter.findUserById(invite.userId))! as User;
            return { id: user.id, name: account(user, origin), displayName: account(user, origin) };
          },
          // An invitation is used once. It's kept, ended, with the passkey made by it, which is the device's that asked
          // for it from when its key is first said (`/passkey/prf-key`).
          afterVerification: async ({ ctx, user, context, verification }) => {
            const credential = verification.registrationInfo?.credential.id;
            if (context) await ctx.context.adapter.update({ model: "invite", where: [{ field: "id", value: await sha256(context) }], update: { expiresAt: new Date(), credential } });
            return { name: user.name };
          },
        },
      }),
      // What lets an assistant somewhere else in at /mcp, as MCP's authorization says. Its consent page is the sign-in
      // page, whose Allow goes on to the passkey.
      mcp({
        loginPage: SIGN_IN,
        consentPage: SIGN_IN,
        resource: `${origin}/mcp`,
        scopes: ["openid", "profile", "offline_access"],
        allowPublicClientPrelogin: true,
        // Most assistants still register themselves, which MCP keeps for them.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
        // Who the token's holder acts as, so that asking for their servers asks nothing of the database.
        customAccessTokenClaims: ({ user }) => ({ who: who(user!) }),
      }),
      // An assistant may instead name itself by the address of its metadata document, which MCP recommends and
      // Claude asks for first. Better Auth checks the address, fetches it within 5 seconds and 5 KB, checks it names
      // that address and the redirect it asks for, and keeps it as its cache headers say.
      cimd({ fetchClientMetadataResource: fetchMetadata, metadataProfile: "mcp-2026-07-28" }),
      // A new device shows a code, and its link carries it. Its person opens that where they sign in, and says
      // whether the code they're shown matches. The metadata names where it asks (RFC 8628).
      // A device's `client_id` is its key, which it signed what it asked with (`onRequest` in `devices`).
      oauthDeviceAuthorization({ verificationUri: SIGN_IN, validateClient: async () => true }),
      devices(),
    ],
  } satisfies BetterAuthOptions;
}

/** Better Auth, as this Worker sets it up. */
const authFor = (origin: string, secret: string, name?: string) => betterAuth(options(origin, secret, env.DB, name));
export type Auth = ReturnType<typeof authFor>;
const auths = new Map<string, Auth>();

/**
 * Better Auth for the network at `origin`, made once for as long as this Worker stays loaded. A promise made in one
 * request settles only in that request, and Better Auth makes what it needs (`$context`) in the request that first
 * asks: so that request waits for it, and Better Auth is kept for others only once it's made. Requests that come
 * before that each read the secret and make it.
 */
export async function at(origin: string): Promise<Auth> {
  const kept = auths.get(origin);
  if (kept) return kept;
  const auth = authFor(origin, await secret(), (await network()).name ?? ONE_APP);
  await auth.$context;
  auths.set(origin, auth);
  return auth;
}

/**
 * How many times `key` was counted within `window` seconds of the last, in the table Better Auth keeps its own limits
 * in: how many, the minutes until it may be counted again, and `again()`, which counts one more.
 */
async function limit(adapter: Adapter, key: string, { window }: { window: number }) {
  const [row] = await adapter.findMany<{ count: number; lastRequest: number | string }>({ model: "rateLimit", where: [{ field: "key", value: key }] });
  const lastRequest = Number(row?.lastRequest ?? 0);
  const count = row && Date.now() - lastRequest < window * 1000 ? row.count : 0;
  const again = () => {
    const data = { key, count: count + 1, lastRequest: Date.now() };
    return row ? adapter.update({ model: "rateLimit", where: [{ field: "key", value: key }], update: data }) : adapter.create({ model: "rateLimit", data });
  };
  return { count, minutes: Math.ceil((lastRequest + window * 1000 - Date.now()) / 60_000), again };
}

/** Where a request to sign in is (`RequestState`). */
function state(code: DeviceCode): RequestState {
  if (code.status !== "pending") return code.status;
  return new Date(code.expiresAt) < new Date() ? "expired" : "waiting";
}

/**
 * Moves a device's code that's waiting to `to`, as `user`'s answer, and makes the device theirs if it's approved.
 * Only a code nobody else has opened moves, and only once: whether it did.
 */
async function answer(adapter: Adapter, code: DeviceCode, user: { id: string; name: string }, to: "approved" | "denied") {
  if (state(code) !== "waiting" || (code.userId && code.userId !== user.id)) return false;
  const where = [
    { field: "id", value: code.id },
    { field: "status", value: "pending" },
    { field: "userId", operator: "eq" as const, value: code.userId ?? null },
  ];
  if (!(await adapter.incrementOne({ model: "deviceCode", where, increment: {}, set: { status: to, userId: user.id } }))) return false;
  if (to === "approved") await place(adapter, code.clientId, "app", code.name, user, code.command);
  return true;
}

/**
 * A link that `name` joins the network by, as that user, made for them if they're new. It's their only one: an
 * earlier link to join as them no longer works. Whoever joins by it is them, so for someone who has joined already
 * it's made only when the server says it may be (`again`): the network's owner asked, for someone who isn't an
 * owner. An owner who lost a passkey adds one on a device they're signed in on, as Apple and Google have it.
 */
async function invite(adapter: Adapter, origin: string, name: string, user: User | undefined, again: boolean) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return { error: "A user's name is lowercase letters, digits and hyphens, starting with a letter." };
  if (user && !again && (await joined(adapter, user)))
    return { error: `${name} has joined already. Only the network's owner invites someone again, and never an owner, who adds a passkey on a device they're signed in on.` };
  const invitee = user ?? (await made(adapter, origin, name));
  return { link: `${origin}/sign-in/#invite=${await invitation(adapter, invitee, INVITED_FOR)}` };
}

/** The user `name`, made here, who hasn't joined. */
function made(adapter: Adapter, origin: string, name: string): Promise<User> {
  // Better Auth keeps a unique email for everyone, so each has one made of their name here. Nothing is sent to it.
  const now = new Date();
  return adapter.create<User>({ model: "user", data: { name, email: `${name}@${new URL(origin).hostname}`, emailVerified: false, createdAt: now, updatedAt: now } });
}

/**
 * A new invitation for `user` to make a passkey by, lasting `lasts` milliseconds: what's carried after `#invite=` or
 * `#passkey=` in a link, for the device that asked for it if one did. It ends the one made for them before.
 */
async function invitation(adapter: Adapter, user: { id: string }, lasts: number, device?: string | null) {
  await adapter.deleteMany({ model: "invite", where: [{ field: "userId", value: user.id }] });
  const link = bytesToHex(randomBytes(24));
  await adapter.create({ model: "invite", data: { id: await sha256(link), userId: user.id, expiresAt: new Date(Date.now() + lasts), device: device ?? null }, forceAllowId: true });
  return link;
}

/** Whether `user` has joined: they made a passkey, or signed in with Google. */
const joined = async (adapter: Adapter, user: { id: string }) =>
  (await Promise.all(["passkey", "account"].map((model) => adapter.findMany({ model, where: [{ field: "userId", value: user.id }] })))).some((rows) => rows.length > 0);

/** The Google Workspace domains whose people join by signing in with Google, as the network's owner said (`domains`). */
async function domains(): Promise<string[]> {
  const kept = await env.DB.prepare("select value from setting where name = 'domains'").first<{ value: string }>();
  return kept ? JSON.parse(kept.value) : [];
}

/**
 * The network's name, icon and logo, as its owner said (`network`): what its sign-in page and web app show, and its
 * own apps are finished with; and its own Android app's package name, which its passkeys and links are its as well. Its icon is on a tile of its own, as a Home Screen and a tab show it, and its logo is
 * its mark alone, with no tile, as its pages draw it, as the One App's are `apple-touch-icon.png` and `Logo.png`: one
 * for a light page and one for a dark, either of which shows on both where it's alone. Each picture is a square PNG,
 * as base64, with its size, and is the One App's where there's none.
 */
export async function network(): Promise<{ name: string | null; icon: Picture | null; logo: { light?: Picture; dark?: Picture } | null; android_package: string | null; apple_app: string | null }> {
  const { results } = await env.DB.prepare("select name, value from setting where name in ('name', 'icon', 'logo', 'android_package', 'apple_app')").all<{ name: string; value: string }>();
  const kept = Object.fromEntries(results.map(({ name, value }) => [name, JSON.parse(value)]));
  return { name: kept.name ?? null, icon: kept.icon ?? null, logo: kept.logo ?? null, android_package: kept.android_package ?? null, apple_app: kept.apple_app ?? null };
}

/** A square PNG, as base64, with its size. */
type Picture = { png: string; size: number };

/** A network's name where it has none of its own. */
export const ONE_APP = "the One App";

/** The most an icon may be, as PNG's bytes. */
const ICON_BYTES = 1024 * 1024;

/** A network's icon as it's given, base64: its size, where it's a square PNG no bigger than `ICON_BYTES`. */
function square(base64: string): number | string {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    return "An icon is a PNG as base64.";
  }
  if (bytes.length > ICON_BYTES) return "An icon is 1 MB at most.";
  // PNG's signature, then its first chunk, IHDR, with its width and height.
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, at) => bytes[at] === byte);
  const view = new DataView(bytes.buffer);
  if (!png || bytes.length < 24) return "An icon is a PNG.";
  const [width, height] = [view.getUint32(16), view.getUint32(20)];
  return width === height ? width : "An icon is square.";
}

/**
 * Whether a Google account may join with no invitation: Google says it's a Workspace account of a domain the network's
 * owner named (its `hd` claim), and that its email, at that domain, is verified. An email at the domain alone isn't
 * enough, since anyone can make a Google account with any email.
 */
async function admits(profile: { hd?: unknown; email?: unknown; email_verified?: unknown }) {
  const domain = typeof profile.hd === "string" ? profile.hd.toLowerCase() : "";
  const email = String(profile.email ?? "").toLowerCase();
  return !!domain && profile.email_verified === true && email.endsWith(`@${domain}`) && (await domains()).includes(domain);
}

/**
 * The invitation a Google sign-in carries (`invite` in its OAuth state, which the sign-in page sends), and the user it's
 * for, who joins with Google as they would have with a passkey. Only someone who hasn't joined does: someone who has
 * signs in as they joined.
 */
async function invitedToGoogle(adapter: Adapter) {
  const link = (await getOAuthState())?.invite;
  if (typeof link !== "string") return null;
  const invite = await invited(adapter, link);
  const user = (await adapter.findOne<User>({ model: "user", where: [{ field: "id", value: invite.userId }] }))!;
  if (await joined(adapter, user)) throw new APIError("FORBIDDEN", { code: "joined", message: `${user.called || user.name} has joined already. Sign in as you joined.` });
  return user;
}

/** A name nobody has, made of an email's local part, for someone who joins by signing in with Google. */
async function freeName(adapter: Adapter, email: string) {
  const made = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+|-+$/g, "") || "person";
  for (let n = 1; ; n++) {
    const name = n === 1 ? made : `${made}-${n}`;
    if (!(await adapter.findOne({ model: "user", where: [{ field: "name", value: name }] }))) return name;
  }
}

/**
 * What a server acting for the network asks, for a person in the app: `{ask, ...}`. Their name is theirs as
 * relation tuples have it, `users/<name>`.
 */
/** What a server asks: `ask`, about whom, and what else that ask takes. */
export interface Ask {
  ask?: string;
  who?: string;
  called?: unknown;
  device?: string;
  code?: unknown;
  passkey?: string;
  /** What `encrypt_for_passkeys` keeps, by credential ID. */
  keys?: unknown;
  /** Whether the network is being built, where a server acts as whoever a client says (`mix network --development`). */
  building?: boolean;
  /** With `invite`: whether someone who has joined may be invited again, as the server says (`invite`). */
  again?: boolean;
  /** With `domains`: the Google Workspace domains whose people join by signing in with Google. */
  domains?: unknown;
  /** With `network`: the network's name, or null for the One App's. */
  name?: unknown;
  /** With `network`: the network's icon, a square PNG as base64, or null for the One App's. */
  icon?: unknown;
  /** With `network`: the network's logo, its mark with no tile, as square PNGs as base64 for a light page and a dark one
   * (`{ light, dark }`, either alone shown on both), or null for the One App's. */
  logo?: unknown;
  /** With `network`: its own Android app's package name (`tooling/android-apk`), or null where it has none. */
  android_package?: unknown;
  /** With `network`: its own iPhone app's app ID, its team and bundle identifier (`tooling/testflight`), or null where it has none. */
  apple_app?: unknown;
  /** With `picture`: the picture the person sets for themselves, as base64, or null to go back to Google's. */
  image?: unknown;
}

export async function asked(auth: Auth, origin: string, { ask, who: name, building, ...about }: Ask) {
  const { adapter, internalAdapter } = await auth.$context;
  const named = String(name ?? "").replace(/^users\//, "");
  let [user] = await adapter.findMany<User>({ model: "user", where: [{ field: "name", value: named }] });
  // In a network being built nobody joins, and a server asks as whoever a client says it is: they're made here as
  // they're first asked about, so they approve a device's code as anyone who joined does.
  if (!user && building && ask !== "invite" && /^[a-z][a-z0-9-]*$/.test(named)) user = await made(adapter, origin, named);

  if (ask === "whose") return whose();
  if (ask === "invite") return invite(adapter, origin, named, user, about.again === true);
  // The network's first owner is invited only until they've joined, so a link to join as them isn't made after.
  if (ask === "owner") return user && (await joined(adapter, user)) ? { joined: true } : invite(adapter, origin, named, user, false);
  // The Google Workspace domains whose people join by signing in with Google, with no invitation, as the network's
  // owner says: given `domains`, they're those from then on.
  if (ask === "domains") {
    if (about.domains !== undefined) {
      const domains = [...new Set((Array.isArray(about.domains) ? about.domains : []).map((domain) => String(domain).trim().toLowerCase()).filter(Boolean))];
      if (domains.some((domain) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain))) return { error: "A domain is a name like example.org." };
      await env.DB.prepare("insert into setting (name, value) values ('domains', ?) on conflict (name) do update set value = excluded.value").bind(JSON.stringify(domains)).run();
    }
    return { domains: await domains() };
  }
  // The network's name, icon and logo, as its owner says: given any, it's that from then on, and null is the One App's.
  if (ask === "network") {
    const set = (name: string, value: unknown) =>
      value === null
        ? env.DB.prepare("delete from setting where name = ?").bind(name).run()
        : env.DB.prepare("insert into setting (name, value) values (?, ?) on conflict (name) do update set value = excluded.value").bind(name, JSON.stringify(value)).run();
    if (about.name !== undefined) {
      const named = about.name === null ? null : String(about.name).trim().slice(0, 100);
      await set("name", named || null);
      // Better Auth is made with it (`at`), here again at once; another copy of this Worker, as it's next loaded.
      auths.clear();
    }
    const picture = (given: unknown): Picture | string => {
      const size = square(String(given));
      return typeof size === "string" ? size : { png: String(given), size };
    };
    if (about.icon !== undefined) {
      const icon = about.icon === null ? null : picture(about.icon);
      if (typeof icon === "string") return { error: icon };
      await set("icon", icon);
    }
    if (about.logo !== undefined) {
      const given = (about.logo ?? {}) as { light?: unknown; dark?: unknown };
      const logo = Object.fromEntries(Object.entries({ light: given.light, dark: given.dark }).filter(([, png]) => png != null).map(([mode, png]) => [mode, picture(png)]));
      const wrong = Object.values(logo).find((it) => typeof it === "string");
      if (wrong) return { error: wrong };
      await set("logo", Object.keys(logo).length ? logo : null);
    }
    if (about.android_package !== undefined) {
      const named = about.android_package === null ? null : String(about.android_package);
      // Android's rule for an application ID: two or more parts, each a letter then letters, digits or underscores.
      if (named !== null && !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(named)) return { error: "An Android package is named like app.ptc.android." };
      await set("android_package", named);
    }
    if (about.apple_app !== undefined) {
      const named = about.apple_app === null ? null : String(about.apple_app);
      // Apple's rule for an app ID: its ten-character team, then its bundle identifier, whose parts are letters, digits and hyphens.
      if (named !== null && !/^[A-Z0-9]{10}\.[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(named)) return { error: "An iPhone app's ID is its team and bundle identifier, like X96JC3HCV7.app.theone.client." };
      await set("apple_app", named);
    }
    const { name, icon, logo, android_package, apple_app } = await network();
    // Its picture is its icon, made small, kept for the people who show it.
    if (about.icon !== undefined) await keepNetwork(icon?.png ?? null, true);
    // Its mark as data too, for a page drawn where only its app's own files load, as a native window's is.
    const data = (picture?: Picture) => picture && `data:image/png;base64,${picture.png}`;
    return {
      name,
      icon: icon && `${origin}/apple-touch-icon.png`,
      logo: logo && { light: `${origin}/Logo.png`, dark: `${origin}/Logo-dark.png` },
      mark: logo && { light: data(logo.light ?? logo.dark), dark: data(logo.dark ?? logo.light) },
      android_package,
      apple_app,
    };
  }
  // Everyone who has joined, and everyone invited who hasn't yet, with the name each goes by.
  if (ask === "everyone") {
    type Row = { id: string; userId: string; expiresAt?: Date; name?: string; called?: string | null; email?: string; emailVerified?: boolean };
    const [users, passkeys, accounts, invites] = await Promise.all(["user", "passkey", "account", "invite"].map((model) => adapter.findMany<Row>({ model })));
    const has = (rows: Row[]) => new Set(rows.filter(({ expiresAt }) => !expiresAt || expiresAt > new Date()).map(({ userId }) => userId));
    const [keyed, invited] = [has([...passkeys, ...accounts]), has(invites)];
    return {
      people: users
        .filter(({ id }) => keyed.has(id) || invited.has(id))
        .map((user) => ({ who: who(user as { name: string }), called: user.called ?? null, email: user.emailVerified ? user.email : null, joined: keyed.has(user.id) })),
    };
  }
  if (!user) return { error: `${name} hasn't joined this network.` };
  const mine = [{ field: "userId", value: user.id }];

  // In a network being built, where a server acts as whoever a client says, a browser is signed in as whoever it's
  // asked for with no passkey: a new session's cookies, as Playwright's storage state has them, so a test browser
  // opens the network signed in (`browser.json`, `tooling/network`). Better Auth's test helpers make it, in an
  // instance of its own, so the network's has none of them.
  if (ask === "browser") {
    if (!building) return { error: "Only a network being built signs a browser in with no passkey." };
    const { test } = await betterAuth({ ...options(origin, (await auth.$context).secret), plugins: [testUtils()] }).$context;
    return { cookies: await test.getCookies({ userId: user.id }), origins: [] };
  }

  // A picture a person sets for themselves: any picture, made small and square, which is theirs from then on, or null.
  if (ask === "picture") {
    if (about.image === null) {
      await setOwn(user.name, null);
      return { picture: null };
    }
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(String(about.image)), (char) => char.charCodeAt(0));
    } catch {
      return { error: "A picture is sent as base64." };
    }
    if (bytes.length > MOST) return { error: "A picture is 10 MB at most." };
    try {
      await setOwn(user.name, bytes);
    } catch (error) {
      return { error: `That isn't a picture the network can use (${(error as Error).message}).` };
    }
    return { picture: "own" };
  }

  if (ask === "called") {
    const called = String(about.called ?? "").trim().slice(0, 100);
    if (!called) return { error: "A name can't be empty." };
    await internalAdapter.updateUser(user.id, { called });
    return { called };
  }

  if (ask === "devices") {
    const [devices, browsers, passkeys] = await Promise.all([
      adapter.findMany<Device>({ model: "device", where: mine }),
      internalAdapter.listSessions(user.id, { onlyActiveSessions: true }),
      adapter.findMany<Passkey>({ model: "passkey", where: mine }),
    ]);
    // Whether an app is connected to the relay, which says when it was last seen otherwise.
    using presence = await env.RELAY.presence(devices.filter(({ kind }) => kind === "app").map(({ id }) => id));
    const when = (id: string) => {
      const here = presence[id];
      return here ? { connected: here.connected, ...(here.last_seen && { last_seen: new Date(here.last_seen) }) } : {};
    };
    return {
      devices: [
        ...devices.map(({ id, kind, name, command, createdAt }) => ({ id, kind, name, command, added: createdAt, ...when(id) })),
        // A browser that's signed in is a device too, named by what it says it is, and last used when Better Auth last
        // moved the end of its session.
        ...browsers.map(({ id, userAgent, createdAt, updatedAt }) => ({ id, kind: "browser", name: browser(userAgent), added: createdAt, last_seen: updatedAt })),
      ],
      // Whether each unlocks its person's key on a new device, and what a device that holds the key encrypts it to.
      passkeys: passkeys.map(({ id, name, createdAt, credentialID, prfKey, encryptedKey, device }) => ({
        id,
        name: name || "Passkey",
        added: createdAt,
        credential: credentialID,
        prf_key: prfKey ?? null,
        unlocks: !!(prfKey && encryptedKey),
        // The device whose Add Passkey made it, which lets it unlock with no code to check, where it holds the key.
        from: device ?? null,
      })),
    };
  }
  if (ask === "remove_device") {
    const [device] = await adapter.findMany<Device>({ model: "device", where: [...mine, { field: "id", value: about.device! }] });
    if (device) {
      await remove(adapter, device);
      // What an assistant was given to come back with ends with it.
      if (device.kind === "assistant") {
        const clients = await adapter.findMany<{ clientId: string }>({ model: "oauthConsent", where: mine });
        for (const { clientId } of clients) {
          if ((await assistant(clientId, user.id)) !== device.id) continue;
          const theirs = [...mine, { field: "clientId", value: clientId }];
          for (const model of ["oauthRefreshToken", "oauthAccessToken", "oauthConsent"]) await adapter.deleteMany({ model, where: theirs });
        }
      }
      return { removed: device.name, device: device.id };
    }
    const signed_in = (await internalAdapter.listSessions(user.id, { onlyActiveSessions: true })).find(({ id }) => id === about.device);
    if (!signed_in) return { error: "That isn't one of your devices." };
    await internalAdapter.deleteSession(signed_in.token);
    return { removed: browser(signed_in.userAgent), device: await browserDevice(signed_in.id) };
  }
  if (ask === "approve") {
    // A person lets a device in by its code from one of their own devices or assistants, which a passkey let in.
    // Better Auth's device authorization answers a code only for a browser that's signed in, so this is what its
    // `/device` and `/device/approve` check, in one change that only a code nobody else has opened makes: it's
    // answered once. The device then learns its answer from Better Auth as it would have.
    const missed = await wrongCodes(adapter, user);
    if (missed.count >= WRONG_CODES.max) return { error: tooManyCodes(missed.minutes) };
    const code = await adapter.findOne<DeviceCode>({ model: "deviceCode", where: [{ field: "userCode", value: plain(about.code) }] });
    // Better Auth forgets a code once its device has learned it was answered, stopped or ended.
    if (!code) {
      await missed.again();
      return { error: "That isn't a code any device is showing now." };
    }
    const now = state(code);
    if (now === "expired") return { error: "That code expired. The device shows another when it's asked again." };
    if (now === "denied") return { error: "That code was denied, so its device isn't approved." };
    if (now === "approved") return { error: "Already approved." };
    if (code.userId && code.userId !== user.id) return { error: "Someone else opened that code first, and only they can answer it." };
    if (!(await answer(adapter, code, user, "approved"))) return { error: "Already approved." };
    return { approved: code.name };
  }
  // Someone taken out of the network: nothing acts as them from then on, they sign in nowhere, and their name is free.
  if (ask === "remove_person") {
    for (const device of await adapter.findMany<Device>({ model: "device", where: mine })) await remove(adapter, device);
    for (const model of ["oauthRefreshToken", "oauthAccessToken", "oauthConsent", "session", "passkey", "invite", "account"])
      await adapter.deleteMany({ model, where: mine });
    await adapter.delete({ model: "user", where: [{ field: "id", value: user.id }] });
    await gone();
    await env.OWN.remove(`people/${user.name}`);
    await removeAll(user.name);
    return { removed: user.called ?? user.name };
  }
  // A link that this person makes another passkey by, in a browser, within a quarter of an hour.
  // Its query makes it a page of its own: a browser that has the sign-in page open already (Safari, from the app) loads it
  // afresh, where a link that differs only after `#` kept what that page was doing (21 Nov: Unlock with Passkey's error).
  if (ask === "passkey") return { link: `${origin}/sign-in/?passkey#passkey=${await invitation(adapter, user, 15 * 60 * 1000, about.device)}` };
  // A device that holds this person's key encrypted it to the passkey they confirmed there, whose PRF output derives
  // `prf_key`. It's kept only for that passkey, and only while that's its key: whatever else a device sends, as one
  // on a build that encrypted it to every passkey did, is never kept.
  if (ask === "encrypt_for_passkeys") {
    const keys = (about.keys ?? {}) as Record<string, { prf_key?: unknown; key?: unknown }>;
    const [passkey] = await adapter.findMany<Passkey>({ model: "passkey", where: [...mine, { field: "id", value: String(about.passkey ?? "") }] });
    const given = passkey && keys[passkey.credentialID];
    if (!given || !passkey.prfKey || given.prf_key !== passkey.prfKey || typeof given.key !== "string") return { passkeys: 0 };
    await adapter.update({ model: "passkey", where: [{ field: "id", value: passkey.id }], update: { encryptedKey: given.key } });
    // It unlocks the key now, so the one it was made to replace, which can't, goes: a person keeps one passkey.
    const [replaced] = passkey.replaces ? await adapter.findMany<Passkey>({ model: "passkey", where: [...mine, { field: "id", value: passkey.replaces }] }) : [];
    if (replaced && !(replaced.prfKey && replaced.encryptedKey)) await adapter.delete({ model: "passkey", where: [{ field: "id", value: replaced.id }] });
    return { passkeys: 1 };
  }
  if (ask === "remove_passkey") {
    const passkeys = await adapter.findMany<{ id: string; name?: string }>({ model: "passkey", where: mine });
    const passkey = passkeys.find(({ id }) => id === about.passkey);
    if (!passkey) return { error: "That isn't one of your passkeys." };
    if (passkeys.length === 1) return { error: "That's your only passkey, and you sign in with it. Add another before it goes." };
    await adapter.delete({ model: "passkey", where: [{ field: "id", value: passkey.id }] });
    return { removed: passkey.name || "Passkey" };
  }
  return { error: `There's nothing to ask named ${ask}.` };
}
