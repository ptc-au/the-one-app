// The presigner: the only holder of the bucket's credentials. A server asks it to sign one request to the bucket, and
// it does if that server is on the list of whoever the blob belongs to. A read or a list it sends to the bucket
// itself, and answers with what the bucket answered: one trip for the server rather than two, to the presigner and
// then to the bucket, and no signed request to keep for later. It never signs a write without a condition
// (only if absent, or only if unchanged), so nothing in a network overwrites a blob blind: the condition is a
// signed header, which the bucket refuses to go without. It also says who the network's own servers and clients
// are, for the rest of the edge (`servers`, `admits`), an app's part (`Network`) and a client, and keeps the blobs an
// app's part writes for its app's servers (`Own`). It keeps no blob itself, only the lists of servers it has read
// lately, and runs no app code. An app's part is given only `Network` or `Own`: nothing but an ask signed by a
// server's key reaches the rest.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";
import { verifiedKey, unsigned, isKey, signedBy, NETWORK } from "../ask.ts";

/** How long a signed request works for, in seconds. */
const SIGNED_FOR = 60;
/**
 * How long a list of servers read from the bucket is believed, in milliseconds, at most: a list is changed by a write
 * the presigner signs, which says so (`Changes`), and this is only for one that a write it didn't sign changed.
 */
const KEPT = 30_000;
/** How long, in milliseconds, what's signed may still land: the time it's signed for, and a few seconds for clocks. */
const LANDS = (SIGNED_FOR + 5) * 1000;
/**
 * An entry of a database's log (`Database.Log`). The server holding a database's lease reads its next one every two
 * seconds while it's in use, which is almost always absent (`Database.Lease`), so whether it is, is kept (`Changes`).
 */
const LOG = /\/log\/\d{16}$/;
/** How long, in milliseconds, a blob known to be absent is still kept as that after it was last asked for. */
const FORGOTTEN = 10 * 60_000;
/**
 * A list of servers is that of a user, a group or the network, `servers` under its prefix. Whoever writes one asks the
 * presigner to sign the write (`sign`), which is how the presigner hears that it's changing.
 */
const LIST = /^(?:(?:users|groups)\/[^/]+\/|network\/)servers$/;
/**
 * A server's own blobs are under its key. It reaches them, and the network's other servers read them: that's how
 * they learn where it is.
 */
const SERVER = /^servers\/([0-9a-f]{64})\//;
/**
 * What every server of the network reads, whoever's it is: an app's code, which is open to everyone in the
 * network, what's installed for whom, which servers act for whom, who the network's first owner is, the builds its
 * machines take, and what each owner has deployed. That's how a server runs an app someone else deployed, finds
 * the server to pass a call on to, knows who may do anything where no app decides who may, updates, lists
 * every app there is, lists every server, `servers/`, to find a group's servers for its members, and knows who was renamed
 * (`network/renamed`), which every request it's asked is read through (`OneCore.User.renamed/1`).
 */
const OPEN = /^(?:(?:(?:users|groups)\/[^/]+\/|network\/)(?:apps\/.*|installs|installed|servers)|network\/(?:owner|renamed)|network\/(?:builds|deployed)\/.*|servers\/)$/;
/**
 * An app's icon, kept by its SHA-256 the first time a server gives its address (`OneCore.Apps.Icons`): what an app's
 * code says, which every server reads already. Any of the network's servers writes one, which lands only once, and
 * reads them all, a person's own as much as the network's, since each gives the icons of the apps it runs.
 */
const ICON = /^icons\/[0-9a-f]{64}$/;
/**
 * That a user, a group or the network installed an app is a blob under the app, `installed/<who>`, which a server
 * acting for them writes and removes, whoever's the app is: a deploy of it tells their servers.
 */
const INSTALLED = /^(?:(?:users|groups)\/[^/]+\/|network\/)apps\/[^/]+\/installed\/((?:users|groups)\/[^/]+|network)$/;
/**
 * That a user, a group or the network deployed an app is a blob of the network's, `deployed/<who>/<name>`, naming
 * the app, which a server acting for them writes as it deploys: so every app there is is listed in one place,
 * whichever pages it's on, as the app's `latest` describes it.
 */
const DEPLOYED = /^network\/deployed\/((?:users|groups)\/[^/]+|network)\/[^/]+$/;
/** A blob's key says whose it is by how it starts: a user's or a group's prefix, or the network's. */
const OWNER = /^(?:(?:users|groups)\/[^/]+\/|network\/)/;
const owner = (key: unknown) => OWNER.exec(String(key))?.[0];
/**
 * A key is parts joined by `/`, none empty or starting with a dot: a `..` would leave the prefix that says whose
 * it is. What's listed is the start of a key, so its last part can be empty.
 */
const isBlob = (key: unknown, start = false): key is string =>
  typeof key === "string" &&
  key.split("/").every((part, at, parts) => /^[^.]/.test(part) || (start && part === "" && at === parts.length - 1));

const refuse = (status: number, why: string) => Response.json({ error: why }, { status });

/** What a token says: a server's names a list it's on, and a device's is signed by a server for a while. */
interface Token {
  list?: string
  by?: string
  until?: number
  signature?: string
  first?: string
}

/** What a token says, or nothing if it isn't one. */
function claims(token: string): Token {
  try {
    return JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/"))) ?? {};
  } catch {
    return {};
  }
}

const utf8 = new TextEncoder();
/** Whether two secrets are the same, in a time that doesn't say how alike they are. */
function same(one: unknown, other: unknown) {
  if (typeof one !== "string" || typeof other !== "string") return false;
  const [a, b] = [utf8.encode(one), utf8.encode(other)];
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    const body = await request.text();
    const by = await verifiedKey(request, body);
    if (!by) return unsigned(request);
    const token = request.headers.get("one-token");
    // The tokens it shows besides its own: each another server's word that it may act for someone too, for a while,
    // as a group's server for its members (`OneCore.Edge.token/2`).
    const tokens = (request.headers.get("one-tokens") ?? "").split(" ").filter(Boolean);
    if (pathname === "/presigner/sign" && request.method === "POST") return sign(env, by, token, tokens, body);
    if (pathname === "/presigner/read" && request.method === "POST") return read(env, by, token, tokens, body);
    if (pathname === "/presigner/servers" && request.method === "GET") {
      const lists = reader(env);
      if (!(await admits(lists, by, token))) return refuse(403, "This network doesn't know you");
      // Whoever's servers are asked for, the ones acting for the network act for them too.
      const acting = await Promise.all([servers(lists, searchParams.get("of")), servers(lists, NETWORK)]);
      return Response.json({ servers: [...new Set(acting.flat())] });
    }
    return refuse(404, "The presigner signs at /presigner/sign, reads at /presigner/read and lists servers at /presigner/servers");
  },
} satisfies ExportedHandler<Env>;

/** Who the network's own are, for an app's part. */
export class Network extends WorkerEntrypoint<Env> {
  /** The keys of the servers that act for a user or group, by its prefix, or for the network, with none. */
  servers(of: string | null = NETWORK): Promise<string[]> {
    return servers(reader(this.env), of);
  }

  /** Whether `key` is one of the network's own, by the token it shows: `null`, or `{until}` for a token that ends. */
  admits(key: string, token: string | null): Promise<Admitted | null> {
    return admits(reader(this.env), key, token);
  }

  /**
   * The network's owners now, `users/<name>`, as its permissions app keeps them in `network/owners` as they change
   * (`Permissions`), since no server need be on for the edge to say who they are. It throws what's wrong in words
   * for a person to read, which the sign-in page shows.
   */
  async owners(): Promise<string[]> {
    const got = await bucket(this.env).fetch(blob(this.env, `${NETWORK}owners`));
    if (got.status === 404) throw new Error("This network has no list of owners yet, so no one can add a server to it. An owner on one of its servers makes the list: `one permissions share --artifact network --relation owner --who users/<name>`.");
    if (!got.ok) throw new Error(`The network's bucket answered ${got.status} when asked who its owners are.`);
    return got.json();
  }

  /** Where the bucket is, as R2 says (`oc`, `apac`, `wnam`, ...), or `null` where it's up to R2. */
  async location(): Promise<string | null> {
    const got = await bucket(this.env).fetch(`${this.env.BUCKET}?location`);
    return (got.ok && /<LocationConstraint[^>]*>([^<]+)</.exec(await got.text())?.[1]) || null;
  }

  /** The key that signed what was asked at `url` with `body`, by the `one-` headers it came with, or null. */
  verifiedKey(url: string, headers: HeadersInit, body: string): Promise<string | null> {
    return verifiedKey(new Request(url, { headers }), body);
  }

  /**
   * The answer to what was asked at `url` with `headers` whose signature `verifiedKey` refused, as the edge gives it
   * (`unsigned`), by which a server whose clock is off corrects it (`OneCore.Edge.ask!/2`).
   */
  unsigned(url: string, headers: HeadersInit): Response {
    return unsigned(new Request(url, { headers }));
  }
}

/**
 * Puts a server on the network's list, for the part of the edge that signs people in alone (`edge.js`): what One
 * Core's `add_server` does, once the network's owner approved it there with a passkey (`apps/sign-in/edge/auth.ts`),
 * so a network whose servers are all off takes a new one with none to ask.
 */
export class Servers extends WorkerEntrypoint<Env> {
  /** Adds the server whose key is `key` to the network's list, which a network has from its first server on. */
  async add(key: string): Promise<void> {
    if (!isKey(key)) throw new Error("That isn't a server's key");
    const at = blob(this.env, `${NETWORK}servers`);
    // Said before it's written, as `sign` says it of a write it signs, so no list read from now on is believed until it lands.
    await changes(this.env).hold("any");
    for (;;) {
      const got = await bucket(this.env).fetch(at);
      if (got.status === 404) throw new Error("This network has no server yet: its first is made with the secret its edge was deployed with");
      if (!got.ok) throw new Error(`The bucket answered ${got.status} for ${NETWORK}servers`);
      const keys: string[] = await got.json();
      if (keys.includes(key)) return;
      const wrote = await bucket(this.env).fetch(at, { method: "PUT", body: JSON.stringify([...keys, key]), headers: { "if-match": got.headers.get("etag")! } });
      if (wrote.ok) return;
      if (wrote.status !== 412) throw new Error(`The bucket answered ${wrote.status} for ${NETWORK}servers`);
    }
  }
}

/**
 * An app's edge function keeps blobs in its app's own artifact for the network, which is where its
 * app's servers read them, and reaches nothing else in the bucket. Which app is said by the binding it was
 * given (`props`), which only whoever deploys the edge sets.
 */
export class Own extends WorkerEntrypoint<Env, { app: string }> {
  /** Writes the blob `name`, only if there's none. Gives whether it wrote it. */
  async write(name: string, data: BodyInit): Promise<boolean> {
    await this.writing(name);
    const wrote = await bucket(this.env).fetch(this.blob(name), { method: "PUT", body: data, headers: { "if-none-match": "*" } });
    if (!wrote.ok && wrote.status !== 412) throw new Error(`The bucket answered ${wrote.status} for ${name}`);
    return wrote.ok;
  }

  /**
   * Changes the blob `name` in one step, as `OneCore.Artifact.update/3` does, and gives what it wrote: `change` is
   * given what's there, or null for nothing, and gives what's to be there. If someone else wrote it meanwhile,
   * `change` is given theirs and asked again, so neither change is lost: the bucket writes only on a condition, its
   * ETag or nothing there.
   */
  async update(name: string, change: (was: string | null) => string | Promise<string>): Promise<string> {
    const at = this.blob(name);
    await this.writing(name);
    for (;;) {
      const got = await bucket(this.env).fetch(at);
      if (!got.ok && got.status !== 404) throw new Error(`The bucket answered ${got.status} for ${name}`);
      const was = got.ok ? await got.text() : null;
      const now = await change(was);
      if (now === was) return now;
      const condition: Record<string, string> = was === null ? { "if-none-match": "*" } : { "if-match": got.headers.get("etag")! };
      const wrote = await bucket(this.env).fetch(at, { method: "PUT", body: now, headers: condition });
      if (wrote.ok) return now;
      if (wrote.status !== 412 && wrote.status !== 404) throw new Error(`The bucket answered ${wrote.status} for ${name}`);
    }
  }

  /** Removes the blob `name`. */
  async remove(name: string): Promise<void> {
    const removed = await bucket(this.env).fetch(this.blob(name), { method: "DELETE" });
    if (!removed.ok && removed.status !== 404) throw new Error(`The bucket answered ${removed.status} for ${name}`);
  }

  blob(name: string) {
    if (!isBlob(name)) throw new Error("That isn't a blob's name");
    return blob(this.env, `${NETWORK}own/${this.ctx.props.app}/${name}`);
  }

  /** Tells `Changes` of a write of a log's entry before it's made, as `sign` does. */
  async writing(name: string) {
    const key = `${NETWORK}own/${this.ctx.props.app}/${name}`;
    if (LOG.test(key)) await changes(this.env).writing(key);
  }
}

const OPERATIONS = ["read", "write", "replace", "list", "remove"] as const;

/** What a server asks of the bucket: one operation, on a blob's key, or for a list the start of the keys it lists. */
interface Ask {
  operation: (typeof OPERATIONS)[number]
  key: string
  /** A replace's: the tag of the blob it replaces. */
  tag?: unknown
  /** A list's: where the keys it lists start, as the bucket said with the ones before. */
  after?: string
  /** A list's: whether it lists the folders just under its start, `<start><name>/`, rather than every key. */
  folders?: boolean
  /** A read's: the file name a browser saves it by, which the link's response says (`response-content-disposition`). */
  filename?: string
}

/**
 * The ask in `body`, or null if it isn't one: `{read: key}`, `{write: key}` (only if absent), `{replace: key, tag}`
 * (only if unchanged), `{list: prefix, after?, folders?}` or `{remove: key}`. It names one operation, so that what's checked
 * is what's signed.
 */
function parse(body: string): Ask | null {
  let ask;
  try {
    ask = JSON.parse(body);
  } catch {
    return null;
  }
  const named = OPERATIONS.filter((operation) => ask?.[operation] !== undefined);
  if (named.length !== 1) return null;
  const [operation] = named;
  const key = ask[operation];
  // A replace names the version it replaces: `*`, any version, would be a write that overwrites blind.
  if (operation === "replace" && !(typeof ask.tag === "string" && ask.tag !== "" && ask.tag.trim() !== "*")) return null;
  const filename = operation === "read" && typeof ask.filename === "string" && ask.filename !== "" ? ask.filename : undefined;
  return isBlob(key, operation === "list") ? { operation, key, tag: ask.tag, after: ask.after, folders: ask.folders === true, filename } : null;
}

/**
 * Signs one request to the bucket for the server `by`, which shows `token`, if it may send it. Answers what to send:
 * its method, URL and headers.
 */
async function sign(env: Env, by: string, token: string | null, tokens: string[], body: string) {
  const ask = parse(body);
  if (!ask) return refuse(400, "An ask is JSON that names one blob's key, to read, write, replace, list or remove");
  if (!(await allowed(env, by, token, tokens, ask))) return refuse(403, "You aren't on its list of servers");
  // Said before it's signed, so no list read from now on is believed until what's signed has had its time to land.
  if (LIST.test(ask.key)) await changes(env).hold(ask.operation === "write" ? "absent" : "any");
  if (LOG.test(ask.key)) await changes(env).writing(ask.key);
  const { method, url, headers } = request(env, ask);
  url.searchParams.set("X-Amz-Expires", String(SIGNED_FOR));
  const signed = await bucket(env).sign(url, { method, headers, aws: { signQuery: true } });
  return Response.json({ method, url: signed.url, headers });
}

/**
 * Sends a read or a list to the bucket for the server `by`, which shows `token`, if it may send it. Answers with
 * what the bucket answered: its status, the blob's tag, and the blob or the list. The bucket is asked while the
 * lists of servers are, so this takes as long as the slower of the two, and an answer the server may not have is
 * dropped unread: a refusal comes as soon as the lists say so, however large or absent the blob.
 */
async function read(env: Env, by: string, token: string | null, tokens: string[], body: string) {
  const ask = parse(body);
  if (!ask || (ask.operation !== "read" && ask.operation !== "list")) {
    return refuse(400, "An ask to read is JSON that names one blob's key to read, or the start of the keys to list");
  }
  const { method, url, headers } = request(env, ask);
  const stop = new AbortController();
  const fetched = () => {
    const response = bucket(env).fetch(url, { method, headers, signal: stop.signal });
    // One dropped for a server that may not have it isn't an error; awaited below, one that failed still throws.
    response.catch(() => {});
    return response;
  };
  // A log's entry is asked about with the lists, and read from the bucket only where it may be there.
  const logged = ask.operation === "read" && LOG.test(ask.key);
  const lists = reader(env, logged ? ask.key : undefined);
  const permitted = allowed(env, by, token, tokens, ask, lists);
  const asked = logged ? await lists.asked! : undefined;
  const response = asked?.absent ? undefined : fetched();
  if (!(await permitted)) {
    stop.abort();
    return refuse(403, "You aren't on its list of servers");
  }
  if (!response) return new Response(null, { status: 404, headers: { "content-type": "application/octet-stream" } });
  const got = await response;
  if (asked && got.status === 404) await changes(env).absent(ask.key, asked.at);
  const tag = got.headers.get("etag");
  // Only what the presigner says itself is JSON, so a server tells it from the bucket's answer by its type. A blob's
  // own type isn't passed on, so nothing between here and the server takes it for a page to change.
  return new Response(got.body, { status: got.status, headers: { "content-type": "application/octet-stream", ...(tag && { etag: tag }) } });
}

/**
 * Whether the server `by`, which shows `token`, and `tokens`, other servers' word that it acts for someone too, may
 * send the request to the bucket that `ask` is: one acting for the network, or for whoever the key is under, or with
 * a token that says it acts for them.
 */
async function allowed(env: Env, by: string, token: string | null, tokens: string[], { operation, key }: Ask, lists = reader(env)) {
  const server = SERVER.exec(key)?.[1];
  const reads = operation === "read" || operation === "list";
  const icon = ICON.test(key) && (operation === "read" || operation === "write");
  const opens = server === by || (server !== undefined && operation === "read") || (OPEN.test(key) && reads) || icon;
  const installer = ((operation === "write" || operation === "remove") && INSTALLED.exec(key)?.[1]) || (!reads && DEPLOYED.exec(key)?.[1]);
  // A new network has no server yet, so nobody is on a list. The first is whichever shows the secret this
  // edge was deployed with (`FIRST_SERVER`), which only whoever deployed it knows: it reads what any server reads as
  // it starts, as who was renamed (`OneCore.User`), and writes the network's list. The secret writes no list after
  // that, since the bucket lets only the first write land. It says whom it's for first, in its own blob, which
  // `OneCore.Servers.joined?/2` does before it writes the list.
  const shown = same(claims(token ?? "").first, env.FIRST_SERVER);
  const first = shown && ((operation === "write" && (key === NETWORK + "servers" || server === by)) || (OPEN.test(key) && reads));
  // Every list that could let it is read at once, each once: one trip to `Changes`.
  // Another server's word counts for whoever the key is under, and for whoever it says deployed or installed an app:
  // so a group's server, which runs its members' apps, deploys them too.
  const vouched = tokens.filter((shown) => {
    const list = claims(shown.split(".")[0]).list;
    return list !== undefined && (list === owner(key) || (installer && list === installer + "/"));
  });
  const [network, owners, open, installed, ...words] = await Promise.all([
    servers(lists, NETWORK),
    servers(lists, owner(key)),
    opens ? admits(lists, by, token) : null,
    installer ? servers(lists, installer + "/") : null,
    ...vouched.map((shown) => admits(lists, by, shown)),
  ]);
  return Boolean(network.includes(by) || owners.includes(by) || first || open || installed?.includes(by) || words.some(Boolean));
}

/** The request to the bucket that `ask` is, unsigned: its method, URL and headers. */
function request(env: Env, { operation, key, tag, after, folders, filename }: Ask) {
  const url = new URL(operation === "list" ? env.BUCKET : blob(env, key));
  if (filename) url.searchParams.set("response-content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  if (operation === "list") {
    const listed = { "list-type": "2", prefix: key, ...(after && { "continuation-token": after }), ...(folders && { delimiter: "/" }) };
    url.search = new URLSearchParams(listed).toString();
  }
  const headers: Record<string, string> = {};
  if (operation === "write") headers["if-none-match"] = "*";
  if (operation === "replace") headers["if-match"] = String(tag);
  const method = operation === "remove" ? "DELETE" : operation === "write" || operation === "replace" ? "PUT" : "GET";
  return { method, url, headers };
}

/** A blob's address in the bucket, each part of its key as it is, so the bucket reads no `%2F` in one as a `/`. */
const blob = (env: Env, key: string) => `${env.BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** What a token admits: a server's, for as long as it's on its list (`{}`), and a device's, until a time. */
type Admitted = { until?: number }

/**
 * Whether `key` is one of the network's own, by the token it shows: `null`, or `{until}` for a token that ends. A
 * server's token names a list it's on (`{list}`). A device's is signed by a server on a list, for that device's
 * key, until a time (`{list, by, until, signature}`): how a device gets one is the server's to decide. A run of a
 * client on a device has a key of its own, and shows the device's token, the device's key and the device's word for
 * the run's key, joined by dots (`core/client/src/lib.rs`).
 */
export async function admits(lists: Lists, key: string, shown: string | null): Promise<Admitted | null> {
  const [token, device = key, attestation] = (shown ?? "").split(".");
  const { list, by, until, signature } = claims(token);
  if (!isKey(key) || owner(list) !== list) return null;
  // A server's own token says it's one of the network's, on the list it names, which is all it says: a new one is on
  // its list before it says whom it chose, the other side of acting for them (`servers/2`).
  // One started for someone who was renamed since names the list they had, which leads to their new one.
  if (by === undefined) {
    if ((await lists(list)).list?.includes(key)) return {};
    const now = list && (await lists.renamed?.(list));
    return now ? ((await lists(now)).list?.includes(key) ? {} : null) : null;
  }
  if (!(until !== undefined && until > Date.now())) return null;
  if (device !== key && !(await signedBy(device, attestation, `one/run/1\n${key}`))) return null;
  if (!(await signedBy(by, signature, `one/token/1\n${device}\n${list}\n${until}`))) return null;
  // Its signer acts for whoever the token's list is, or for the network, which acts for everyone. A token made before
  // its person was renamed names the list they had, which leads to their new one.
  const [theirs, network] = await Promise.all([servers(lists, list), servers(lists, NETWORK)]);
  if (theirs.includes(by) || network.includes(by)) return { until };
  const now = list && (await lists.renamed?.(list));
  return now && (await servers(lists, now)).includes(by) ? { until } : null;
}

/**
 * The keys of the servers that act for a user or group, or for the network, by its prefix, both ways, as One Core
 * has it (`OneCore.Servers.acts_for/1`): each on its list that chose it, as its `servers/<key>/members` says.
 */
export async function servers(lists: Lists, of: unknown): Promise<string[]> {
  return owner(of) === of ? (await lists(of as string)).acting : [];
}

/**
 * The lists of servers, by their prefixes, as one request reads them, and what `Changes` said with the first of them
 * of the blob that request reads, if it asked.
 */
type Lists = ((prefix: string | undefined) => Promise<Listed>) & { asked?: Promise<Asked>; renamed?: (prefix: string) => Promise<string | undefined> };

/** The lists of servers asked for, whether the blob asked about is surely not in the bucket, and when it was asked. */
interface Asked {
  lists: Listed[];
  absent: boolean;
  at: number;
}

/** A list of servers as the bucket gave it, `null` where there's none yet, and those on it that chose whoever it's of. */
interface Listed {
  list: string[] | null;
  acting: string[];
}

/**
 * Keeps the lists of servers for every copy of the presigner, of which Cloudflare runs dozens, and says when one may
 * have changed. A write to a list is signed for `SIGNED_FOR` seconds, so a list read before that has passed may not be
 * the one that's there then. It's held back from belief until then, and read from the bucket again once it has, so a
 * server taken off a list is refused on its next request, not when `KEPT` ends. A Durable Object is one place that
 * every copy asks, and answers in the order things happened.
 *
 * A write that only lands if there's no list yet (`write`) can't change one that's there, and a server that starts
 * signs one each time (`OneCore.Servers.joined?/2`), so that holds back only the lists that weren't there.
 */
export class Changes extends DurableObject<Env> {
  /** The lists of servers read lately, by their prefixes, as being read, and when each was asked for. */
  #lists = new Map<string, { at: number; list: Promise<string[] | null>; found?: string[] | null }>();
  /** Whom each server chose, by its key, as being read, and when it was asked for. */
  #members = new Map<string, { at: number; members: Promise<string[]> }>();
  /** Log entries the bucket said weren't there, by key, with when each was last asked about. */
  #absent = new Map<string, number>();
  /** When a write of each log entry was last signed, while it may still land. */
  #written = new Map<string, number>();
  /** When this copy of the object started: what was signed before, it wasn't told of. */
  #started = Date.now();

  /**
   * The lists of servers `prefixes` names, as `lists` gives them, and whether the log entry `key` is surely not in
   * the bucket: it said so after every write of it that was signed had had its time to land, and none was signed
   * since. Every write of a blob is signed here (`sign`) or made by an app's part (`Own`), which says so first.
   */
  async ask(prefixes: string[], key?: string): Promise<Asked> {
    const at = Date.now();
    for (const [old, asked] of this.#absent) if (at - asked >= FORGOTTEN) this.#absent.delete(old);
    const absent = key !== undefined && this.#absent.has(key);
    if (absent) this.#absent.set(key, at);
    return { lists: await this.lists(prefixes), absent, at };
  }

  /** The bucket said the log entry `key` wasn't there, read once `ask` had answered at `at`. */
  async absent(key: string, at: number): Promise<void> {
    if (at - this.#started >= LANDS && !((this.#written.get(key) ?? -Infinity) > at - LANDS)) this.#absent.set(key, Date.now());
  }

  /** A write of the log entry `key` is signed now, or about to be made. */
  async writing(key: string): Promise<void> {
    const at = Date.now();
    for (const [old, written] of this.#written) if (at - written >= LANDS) this.#written.delete(old);
    this.#absent.delete(key);
    this.#written.set(key, at);
  }

  /**
   * The lists of servers `prefixes` names, each with the servers on it that chose whoever it's of. Every copy of the
   * presigner asks here, so each list and each server's choice is read from the bucket once every `KEPT` for the
   * whole network, rather than once in each copy, of which Cloudflare runs dozens. What's being read is shared by
   * whoever asks meanwhile.
   */
  async lists(prefixes: string[]): Promise<Listed[]> {
    const [at, held] = [Date.now(), await this.until()];
    for (const [prefix, had] of this.#lists) if (at - had.at >= KEPT) this.#lists.delete(prefix);
    for (const [key, had] of this.#members) if (at - had.at >= KEPT) this.#members.delete(key);
    return Promise.all(
      prefixes.map(async (prefix) => {
        const list = await this.#list(prefix, at, held);
        const chose = await Promise.all((list ?? []).map((key) => this.#chose(key)));
        return { list, acting: (list ?? []).filter((_key, at) => chose[at].includes(prefix.slice(0, -1))) };
      }),
    );
  }

  /** The list `prefix`, as read since any change to it and less than `KEPT` ago, or as the bucket has it now. */
  #list(prefix: string, at: number, held: { any: number; absent: number }): Promise<string[] | null> {
    const had = this.#lists.get(prefix);
    if (had && had.at > (had.found === null ? Math.max(held.any, held.absent) : held.any)) return had.list;
    const kept: { at: number; list: Promise<string[] | null>; found?: string[] | null } = { at, list: list(this.env, prefix) };
    kept.list.then((found) => (kept.found = found), () => this.#lists.get(prefix) === kept && this.#lists.delete(prefix));
    this.#lists.set(prefix, kept);
    return kept.list;
  }

  /**
   * Whom the server `key` chose (`chosen`), read again once it's been `KEPT`. Only it writes that, and it changes
   * only when its owner chooses someone else too, which is never a refusal of what was let. One not there yet is
   * read again next time, as a new server writes it as it starts.
   */
  #chose(key: string): Promise<string[]> {
    const had = this.#members.get(key);
    if (had) return had.members;
    const kept = { at: Date.now(), members: chosen(this.env, key) };
    const forget = () => this.#members.get(key) === kept && this.#members.delete(key);
    kept.members.then((members) => members.length || forget(), forget);
    this.#members.set(key, kept);
    return kept.members;
  }

  /** When lists read at or before it aren't believed, in milliseconds: any, and the ones that weren't there. */
  async until(): Promise<{ any: number; absent: number }> {
    const held = await this.ctx.storage.get<number>(["any", "absent"]);
    return { any: held.get("any") ?? 0, absent: held.get("absent") ?? 0 };
  }

  /** A write is signed now. The clocks of the copies and this one differ a little, so it's held a few seconds past that. */
  async hold(of: "any" | "absent"): Promise<void> {
    await this.ctx.storage.put(of, Date.now() + LANDS);
  }
}

const changes = (env: Env) => env.CHANGES.getByName("lists");

/**
 * Reads the lists of servers for one request: each once, however often it's asked for, and all that are asked for
 * together in one request to `Changes`, which keeps them for every copy of the presigner.
 */
export function reader(env: Env, key?: string): Lists {
  const read = new Map<string, Promise<Listed>>();
  let asking: { prefixes: string[]; asked: Promise<Asked> } | undefined;
  const lists: Lists = (prefix) => {
    if (!prefix) return Promise.resolve({ list: null, acting: [] });
    if (read.has(prefix)) return read.get(prefix)!;
    // What's asked for before this request next waits is asked for at once: `allowed` asks for every list it needs so.
    if (!asking) {
      const [prefixes, about] = [[] as string[], lists.asked ? undefined : key];
      asking = { prefixes, asked: Promise.resolve().then(() => ((asking = undefined), changes(env).ask(prefixes, about))) };
      lists.asked ??= asking.asked;
    }
    const at = asking.prefixes.push(prefix) - 1;
    const listed = asking.asked.then(({ lists }) => lists[at]);
    read.set(prefix, listed);
    return listed;
  };
  // Who was renamed (`OneCore.Renames`): each user's prefix they had, as a list is named, and their prefix now.
  let names: Promise<Record<string, string>> | undefined;
  lists.renamed = async (prefix) => {
    names ??= bucket(env).fetch(blob(env, `${NETWORK}renamed`)).then((got) => (got.ok ? got.json() : {}));
    const now = (await names)[prefix.slice(0, -1)];
    return now && `${now}/`;
  };
  return lists;
}

/** Whom the server `key` chose to act for, as its own `members` blob says, none where it has none yet. */
async function chosen(env: Env, key: string): Promise<string[]> {
  const got = await bucket(env).fetch(blob(env, `servers/${key}/members`));
  if (!got.ok && got.status !== 404) throw new Error(`The bucket answered ${got.status} for servers/${key}/members`);
  return got.ok ? got.json() : [];
}

/**
 * What the network's own app `app` keeps as the blob `name` (`OneCore.Artifact`), or null where it keeps none: the
 * network's installers, as its Software Update publishes them, which the network's update reads to know which build its
 * own app is (`updater/core.ts`). The presigner is the edge's holder of the bucket's credentials, so the rest of the
 * edge asks it, as it asks for the network's owner.
 */
export async function networkApp(env: Env, app: string, name: string): Promise<string | null> {
  const key = `${NETWORK}own/${app}/${name}`;
  const got = await bucket(env).fetch(blob(env, key));
  if (got.status === 404) return null;
  if (!got.ok) throw new Error(`The bucket answered ${got.status} for ${key}`);
  return got.text();
}

/** The list of servers kept under `prefix`, `null` if there's none yet. */
async function list(env: Env, prefix: string): Promise<string[] | null> {
  const got = await bucket(env).fetch(blob(env, `${prefix}servers`));
  if (got.status === 404) return null;
  if (!got.ok) throw new Error(`The bucket answered ${got.status} for ${prefix}servers`);
  return got.json();
}

/** One client for the isolate, which keeps the signing key it derives for each day. */
let client: AwsClient | undefined;
function bucket({ ACCESS_KEY_ID: accessKeyId, SECRET_ACCESS_KEY: secretAccessKey }: Env) {
  return (client ??= new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }));
}
