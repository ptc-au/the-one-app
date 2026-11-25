// The network's front door: its MCP endpoint over the web (`/mcp`, or in code mode `/mcp?code`), what tells an
// assistant how to come in (`/llms.txt`), the skills of whoever signed in (`/skills/<path>`), the web client's apps'
// files (`/apps`), the endpoint for whoever holds a sharing link (`/link/<link>`), and an app's webhooks, which anyone
// a service shows one to asks (`/webhooks/<owner>/<app>/<token>`). Each call is passed through the relay to a server
// acting for whoever it's from, which is told which device that is and decides whose it is itself.
//
// One of the network's own devices signs what it asks with its key, which is checked here. Anyone else has signed in,
// and who they are is the app's to say that signs people in: it's bound here as WHO, by `edge.js`, and asked
// `who(request)` (`apps/sign-in/edge/worker.ts`). With no such app, only devices signing with their key come in.
import { verifiedKey, unsigned, hex, NETWORK } from "../ask.ts";
import { randomBytes } from "@noble/hashes/utils.js";
import { reader, servers as acting } from "../presigner/presigner.ts";
import { forward as relayed, notify } from "../relay/relay.ts";
import rules from "../../server/priv/rules.md";

/** Who a request is from, as the app that signs people in says. */
interface Who {
  /** The device it is to a server. */
  device: string;
  /** Whose that device is, as relation tuples name them: `users/<name>`. */
  who: string;
  /** An assistant's: the `WWW-Authenticate` to answer once a server says its device is nobody's. */
  challenge?: string;
  /** A browser's: its session, as Devices lists it, where its apps' files are, and its session's cookies, renewed. */
  session?: string;
  apps?: string;
  cookies?: string[];
}

declare global {
  interface Env {
    /** The app that signs people in: who a request is from, or the answer for one from nobody signed in. */
    WHO?: { who(request: Request): Promise<Who | { refused: Response }>; device(origin: string, device: string): Promise<Who | null> };
  }
}

const refuse = (status: number, why: string) => Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: why } }, { status });

/** A sharing link, or a webhook, starts with whose it leads to, as their prefix: that's whose servers answer it. */
const LEADS_TO = /^(?:(?:users|groups)\/[^/]+\/|network\/)/;
/** The JSON-RPC error a server answers a device that's nobody's (`OneCore.Mcp`). */
const NOBODY = -32003;
/** What's said to whoever isn't one of the network's devices, with nothing here to sign them in. */
const NO_SIGN_IN = "Nothing signs people in on this network, so only its own devices come in, signing what they ask with their key";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/llms.txt") return new Response(llms(url.origin), { headers: { "content-type": "text/markdown; charset=utf-8" } });
    if (url.pathname.startsWith("/skills/")) return skill(request, env, url);
    if (url.pathname === "/apps") return apps(request, env);
    if (url.pathname.startsWith("/apps/")) return file(request, env, url, ctx);
    // A webhook is asked by whatever a service sends, with whatever method: Slack and GitHub both POST, and a service
    // that checks one first may GET or HEAD it.
    if (url.pathname.startsWith("/webhooks/")) return webhook(request, env, url, ctx);
    // MCP's streamable HTTP: each message is a POST, answered with JSON, or a stream of its progress and then its
    // answer. There's no stream to GET.
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    if (url.pathname === "/mcp") return mcp(request, env, ctx);
    if (url.pathname.startsWith("/link/")) return link(request, env, url, ctx);
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * What an assistant reads to come into the network at `origin`, as llmstxt.org has it. Anyone may read it, so it
 * says nothing of what a network has: which apps, and their skills, are for whoever signed in.
 */
const llms = (origin: string) => `# ${new URL(origin).host}

> A network of the One App: a person's, a family's or a workplace's email, messages, calendar, files, devices and more,
> each an app. An assistant comes in as the person who lets it in, and does what they can, through MCP or the
> \`one\` command.

## Rules

${rules.trim()}

## Connecting for a person

When someone asks you to connect to this network, do it yourself, and tell them only what they need to do, one step
at a time, in everyday words.

- If you can run commands (Claude Code, Codex, OpenCode, Cursor): run \`one --version\`. If it answers, you're on one
  of their computers already: use \`one\`, and add MCP as below. A computer that isn't in their network yet says so,
  with a link and a code: give them the link, ask them to check it shows that code, and carry on once they've let it
  in. If there's no \`one\`, add MCP over the web as below instead.
- If you can't (ChatGPT, Claude and other chat apps): you can't add it yourself, so show them where their app adds a
  connector (a custom MCP server) and have them add \`${origin}/mcp\`. They sign in when it asks, with their passkey,
  and then you act as them.

## Adding MCP

There are two ways in, and you choose the one that fits you, or tell the person in one line which you're adding and why:

- Every tool, and \`skills\`. For an agent whose client searches tools itself: Claude Code, OpenCode, Codex, Cursor.
  On one of their computers, \`one mcp\` over stdio (\`claude mcp add --scope user one -- one mcp\`); anywhere else,
  \`${origin}/mcp\` over streamable HTTP (\`claude mcp add --transport http one ${origin}/mcp\`).
- Code mode, as Executor's: \`search\` finds what's possible, \`call\` calls one tool or several at once, \`execute\`
  runs a short script where one call's answer feeds the next, and \`skills\` reads the skills. For every other agent.
  \`one mcp --code\`, or \`${origin}/mcp?code\`.

## Finding your way

- Each app has a skill that says when and how to use its tools: read it before them. The \`skills\` tool lists
  and reads them, as do MCP's \`skills/list\` and \`resources/read\`, under \`skill://\`, and \`one <app>\` prints one
  with its tools. Whoever signed in reads them at \`${origin}/skills/<path>\` too, as
  \`${origin}/skills/building-apps/SKILL.md\`.
- \`one search "<words>"\`, and code mode's \`search\`, find the tools for a task across every app, each with how to
  call it and its app's skill. Before saying you can't, search: an app they haven't installed yet may do it, and
  search offers it.
- Every MCP tool is also a command: \`gmail_search\` is \`one gmail search\`. \`one run <file>\` runs a script as
  \`execute\` does.
- When the person asks for an app, tracker or tool, make it here as an app, where it's on all their devices: the
  skill building-apps says how.
`;

/**
 * A file of a skill, `/skills/<path>/<file>` for `skill://<path>/<file>`, for whoever signed in or one of the
 * network's own devices, as a server reads it for them. Skills say what apps someone has, so nobody else reads one.
 */
async function skill(request: Request, env: Env, url: URL) {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });
  const read = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: `skill://${url.pathname.slice("/skills/".length)}` } });
  let answer: Response;
  if (request.headers.has("one-key")) {
    const device = await verifiedKey(request, "");
    if (!device) return new Response("Sign what you ask with your key", { status: 401 });
    answer = await forward(env, read, { device }, [NETWORK]);
  } else {
    const who = await signedIn(request, env);
    if ("refused" in who) return new Response("Sign in to read a skill", { status: 401 });
    answer = await forward(env, read, { device: who.device }, [`${who.who}/`, NETWORK]);
  }
  if (answer.status !== 200) return answer;
  const response = await answer.json<{ result?: { contents: { text: string }[] }; error?: { code?: number; message: string } }>();
  const text = response.result?.contents?.[0]?.text;
  if (text === undefined) return new Response(response.error?.message ?? "There's no such skill", { status: response.error?.code === NOBODY ? 401 : 404 });
  return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
}

/** Who signed in, as the app that signs people in says from what `request` carries, its body left here. */
async function signedIn(request: Request, env: Env) {
  if (!env.WHO) return { refused: refuse(401, NO_SIGN_IN) };
  return env.WHO.who(new Request(request.url, { method: request.method, headers: request.headers }));
}

async function mcp(request: Request, env: Env, ctx: ExecutionContext) {
  // One of the network's own devices signs what it asks with its key. One that's nobody's is told so by the
  // server, and asks for a code to be let in by.
  if (request.headers.has("one-key")) {
    const body = await request.text();
    const device = await verifiedKey(request, body);
    if (!device) return unsigned(request);
    // The page an assistant shows, for a device whose own assistant, `one mcp`, asks for it.
    const asked = routes(body);
    const page = asked && env.WHO && (await env.WHO.device(new URL(request.url).origin, device));
    if (asked && page) return router(env, asked, new URL(request.url).origin, page);
    return forward(env, body, { device }, [NETWORK], request.headers, mode(new URL(request.url)), { signal: request.signal, ctx });
  }
  // A browser or an assistant someone let in. One that's since become nobody's signs in, or is let in, again.
  const who = await signedIn(request, env);
  if ("refused" in who) return who.refused;
  const body = await request.text();
  const asked = routes(body);
  if (asked && !who.session && who.apps) return withCookies(await router(env, asked, new URL(request.url).origin, who), who.cookies);
  const answer = await forward(env, body, { device: who.device }, [`${who.who}/`, NETWORK], request.headers, mode(new URL(request.url)), { signal: request.signal, ctx });
  if (!(await nobodys(answer))) return withCookies(answer, who.cookies);
  if (who.challenge) return new Response(null, { status: 401, headers: { "www-authenticate": who.challenge } });
  // A browser is told why, which it shows where it signs in again (`clients/web/host.js`), where signing in again
  // brings it back here if its servers still don't know it.
  const name = who.who.replace(/^users\//, "");
  const why = `This browser signed in as ${name}, but the network's servers didn't know it as theirs. Sign in again, and if this happens again, tell whoever runs the network.`;
  return Response.json({ jsonrpc: "2.0", id: null, error: { code: NOBODY, message: why } }, { status: 401 });
}

/**
 * The page an assistant shows for every app's tool that has one (`ui://one/<version>/app.html`, as `OneCore.Mcp` lists
 * it), read by an assistant that shows MCP Apps: the router (`clients/web/router.js`), which shows the page of the app
 * whose tool was called in the renderer's frame from here, and what a link in it opens, as the web client does. It's
 * written here, as only here is where whoever let the assistant in has their apps' files (`apps`), and it's told the
 * apps listed for them, which a link opens among. A device's `one mcp` asks for it here too (`mcp`).
 */
async function router(env: Env, call: Call, origin: string, who: Who) {
  const listing = await forward(env, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/list", params: {} }), { device: who.device }, [`${who.who}/`, NETWORK]);
  const listed = listing.status === 200 ? await listing.json<{ result?: { resources: { uri: string; mimeType?: string; _meta?: { category?: string } }[] } }>() : {};
  // Only what a link opens among: the apps' pages.
  const resources = (listed.result?.resources ?? []).filter(({ mimeType }) => mimeType === "text/html;profile=mcp-app").map(({ uri, mimeType, _meta }) => ({ uri, mimeType, _meta: { category: _meta?.category } }));
  const said = JSON.stringify({ origin, apps: who.apps, resources, device: who.device }).replace(/</g, "\\u003c");
  const script = await (await env.ASSETS.fetch(new Request(`${origin}/router.js`))).text();
  const page = `<!doctype html>
<meta charset="utf-8">
<style>html, body { margin: 0; height: 100%; overflow: hidden; } iframe { display: block; border: 0; width: 100%; height: 100%; }
body[data-unopened] iframe { display: none; } body[data-unopened]::before { content: "This app couldn't open here: " attr(data-unopened); display: block; padding: 16px; font: 15px system-ui; }</style>
<iframe sandbox="allow-scripts allow-forms" allow="clipboard-write"></iframe>
<script type="application/json" id="router">${said}</script>
<script>${script.replace(/<\/script/gi, "<\\/script")}</script>
`;
  const ui = { csp: { frameDomains: [origin] } };
  return Response.json({ jsonrpc: "2.0", id: call.id, result: { contents: [{ uri: call.params?.uri, mimeType: "text/html;profile=mcp-app", text: page, _meta: { ui } }] } });
}

/** What names the router's page, whatever its version. */
const ROUTER = /^ui:\/\/one\/[^/]+\/app\.html$/;

/** The request in `body` if it reads the router's page, which `router` answers, and any other is nothing of its. */
function routes(body: string) {
  try {
    const call: Call = JSON.parse(body);
    const uri = call.params?.uri;
    return call.method === "resources/read" && typeof uri === "string" && ROUTER.test(uri) ? call : undefined;
  } catch {
    return undefined;
  }
}

/** How an agent calls tools at `/mcp`: in code mode with `?code` (`OneCore.Mcp`), and otherwise as MCP's tools. */
const mode = (url: URL) => (url.searchParams.has("code") ? "code" : undefined);

/**
 * Whoever holds a sharing link needs no signing in: the link is all they are. What they ask says it's from the
 * link's holder and nothing else, whatever it said of itself, and a server refuses them everything the link's
 * relation tuple doesn't give. Whose a request is, is a server's to say: one acting for whoever the link leads to,
 * or for the network.
 */
async function link(request: Request, env: Env, url: URL, ctx: ExecutionContext) {
  const link = decodeURIComponent(url.pathname.slice("/link/".length));
  const of = LEADS_TO.exec(link)?.[0];
  if (!of) return refuse(404, "That isn't a sharing link");
  return forward(env, await request.text(), { link }, [of, NETWORK], request.headers, undefined, { signal: request.signal, ctx });
}

/** An app's name, as a webhook's address says it. */
const APP = /^[a-z0-9][a-z0-9-]*$/;
/** A webhook's token: the secret in its address, which is all whoever asks one has to know. */
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
/** How big a webhook's body may be, in bytes: a service may send more than an app can take, and is told so. */
const LIMIT = 1_048_576;
/**
 * How long a webhook waits for a server's answer, in milliseconds: the longest a service waits for one, GitHub's 10
 * seconds, so a server that's restarting is answered with a try again, which a service does, rather than the service
 * waiting past its own limit for one.
 */
const WEBHOOK_WAIT = 10_000;
/** What's said of a webhook's address that isn't one. */
const WEBHOOKS_ARE = "A webhook's address is /webhooks/<owner>/<app>/<token>, where owner is users/<name>, groups/<name> or network";

/** A body's bytes as base64, which is how a JSON-RPC message holds bytes. */
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** What a service that asked a webhook is told went wrong, as it would be by any address. */
const failed = (status: number, why: string) => new Response(why, { status });

/** The HTTP status a server's JSON-RPC error is answered as. */
const STATUS: Record<number, number> = { [-32023]: 404, [-32024]: 403, [-32602]: 400 };

/**
 * A webhook: an address anyone a service is given it may ask, `/webhooks/<owner>/<app>/<token>[/<path>]`, with whatever
 * method, as Slack and GitHub send one, and with nobody signed in. The token is the secret in it, and what the app
 * answers is the HTTP answer (`OneCore.App.webhook/2`): a server passes on to the app what came in, and tells which
 * webhook it is in `_meta`, which only the edge does.
 */
async function webhook(request: Request, env: Env, url: URL, ctx: ExecutionContext) {
  const path = url.pathname.slice("/webhooks/".length);
  const of = LEADS_TO.exec(path)?.[0];
  const [app = "", token = "", ...rest] = of ? path.slice(of.length).split("/") : [];
  if (!of || !APP.test(app) || !TOKEN.test(token)) return failed(400, WEBHOOKS_ARE);
  // A body over the limit is refused before it's read whole where the caller says how big it is, and the rest of it
  // doesn't stay here, as nothing of a webhook does.
  if (Number(request.headers.get("content-length") ?? 0) > LIMIT) return failed(413, "A webhook's body is 1 MB or less");
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > LIMIT) return failed(413, "A webhook's body is 1 MB or less");
  const at = `${of}${app}/${token}`;
  const message = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "webhooks/http",
    params: {
      app,
      webhook: at,
      request: {
        method: request.method,
        path: rest.length ? `/${rest.join("/")}` : "",
        query: url.search.slice(1),
        // Fetch says a header's name in lowercase, as an app gets it, and each of the same name is kept.
        headers: [...request.headers],
        body: base64(body),
      },
    },
  });
  // A webhook not answered in time is given up on as a client that went is: the server running it is told, and stops.
  const signal = AbortSignal.timeout(WEBHOOK_WAIT);
  const gaveUp = new Promise<null>((done) => signal.addEventListener("abort", () => done(null), { once: true }));
  const answering = forward(env, message, { webhook: at }, [of, NETWORK], undefined, undefined, { signal, ctx }).catch((error) => {
    // Never log the token: it's the secret in the webhook's address.
    console.error(JSON.stringify({ webhook: `${of}${app}`, error: String(error) }));
    return null;
  });
  const answer = await Promise.race([answering, gaveUp]);
  if (!answer || answer.status === 503) return new Response("None of this network's servers answered. Try again in a moment.", { status: 503, headers: { "retry-after": "5" } });
  const { result, error } = await answer.json<{ result?: { status?: number; headers?: [string, string][]; body?: string }; error?: { code?: number; message?: string } }>();
  if (error) return failed(STATUS[error.code ?? 0] ?? 502, error.message ?? "The server couldn't say what happened");
  const status = result?.status ?? 200;
  const sent = Uint8Array.from(atob(result?.body ?? ""), (char) => char.charCodeAt(0));
  // HTTP has statuses a Response takes no body with, as a webhook answers a service's first GET with 204.
  return new Response([204, 304].includes(status) ? null : sent, { status, headers: result?.headers ?? [] });
}

/** What MCP says of a request in its `_meta`, under its own prefix: its version, and its client and what that can do. */
const MCP = "io.modelcontextprotocol/";
const VERSION = `${MCP}protocolVersion`;
/** How often a request with a `progressToken` is told it's still running, as a server tells one (`client::THERE`). */
const PROGRESS = 1_000;

type Call = { id?: unknown; method?: unknown; params?: { _meta?: Record<string, unknown>; name?: unknown; uri?: unknown; taskId?: unknown } };

/**
 * Passes one JSON-RPC message to a server acting for one of `of`, as from `from`, a device, a sharing link's holder
 * or a webhook, and answers what the server did. What's asked says who it's from, who it's for and which app's page asked
 * (a device's), the span it's under and what MCP has it say, and nothing else of itself. `headers` are the HTTP request's, if it's one, and
 * `client` its client's connection, whose going before its answer the servers are told.
 */
async function forward(
  env: Env,
  message: string,
  from: { device: string } | { link: string } | { webhook: string },
  of: string[],
  headers?: Headers,
  mode?: string,
  client?: { signal: AbortSignal; ctx: ExecutionContext },
) {
  let call: Call;
  try {
    call = JSON.parse(message);
    if (typeof call?.method !== "string") throw new Error("not a request");
  } catch {
    return refuse(400, "That isn't a JSON-RPC request");
  }
  const meta = call.params?._meta ?? {};
  const modern = headers && (VERSION in meta || (headers.get("mcp-protocol-version") ?? "") >= "2026-07-28");
  const mismatch = modern && mismatched(headers, call);
  if (mismatch) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32020, message: `Header mismatch: ${mismatch}` } }, { status: 400 });
  const subject = "device" in from ? meta.subject : undefined;
  // Which app's page asked, as the window's page says of each (`clients/app/page/bridge.js`), which a server holds
  // that page to (`OneCore.Mcp`).
  const app = "device" in from ? meta.app : undefined;
  const traceparent = traced(meta.traceparent ?? headers?.get("traceparent") ?? undefined);
  const mcp = Object.fromEntries(Object.entries(meta).filter(([key]) => key.startsWith(MCP) || key === "progressToken"));
  const forwardedMeta = { ...mcp, ...from, traceparent, ...(typeof subject === "string" && { subject }), ...(typeof app === "string" && { app }), ...(mode && { mode }) };
  message = JSON.stringify({ ...call, params: { ...call.params, _meta: forwardedMeta } });
  const lists = reader(env);
  const servers = [...new Set((await Promise.all(of.map((of) => acting(lists, of)))).flat())];
  const forwarded = relayed(env, servers, message);
  // A client that goes away before its answer is said to have, by the request's id: what a call does then is its own
  // (`OneCore.Call.State.gone/1`). MCP's Streamable HTTP has a client cancel with `notifications/cancelled`, which is
  // passed on as any message is.
  if (client && "id" in call) {
    const gone = { jsonrpc: "2.0", method: "notifications/one/gone", params: { requestId: call.id, _meta: forwardedMeta } };
    const went = () => client.ctx.waitUntil(notify(env, JSON.stringify(gone)));
    client.signal.addEventListener("abort", went, { once: true });
    forwarded.finally(() => client.signal.removeEventListener("abort", went));
  }
  // A request with a progress token from a client that takes a stream is told every second that it's still running,
  // as MCP's streamable HTTP has it: once it's run that long, it's answered with a stream of its progress and then
  // its answer, however long it runs. One answered sooner is answered as any other.
  const token = meta.progressToken;
  const streams = "id" in call && (typeof token === "string" || typeof token === "number") && headers?.get("accept")?.includes("text/event-stream");
  if (streams && (await Promise.race([forwarded.then(() => false), scheduler.wait(PROGRESS).then(() => true)]))) return streamed(forwarded, call.id, token);
  const reached = await forwarded;
  if (!reached) return refuse(503, "None of this network's servers answered. Try again once one is on.");
  // A notification has no answer.
  if (reached.answer === "") return new Response(null, { status: 202 });
  // From MCP's 2026-07-28, a version or method a server doesn't have is said in the status too.
  const code = modern && (JSON.parse(reached.answer) as { error?: { code?: number } }).error?.code;
  const status = code === -32022 ? 400 : code === -32601 ? 404 : 200;
  return new Response(reached.answer, { status, headers: { "content-type": "application/json" } });
}

/**
 * The answer to the request `id`, which carries `token`, as a stream of server-sent events: MCP's progress
 * notification every second while it runs, how far it is being the seconds it's run, as a server says it, and then
 * the answer. Whoever asked closing it stops the telling, and the servers are told it went (`forward`).
 */
function streamed(forwarded: Promise<{ answer: string } | null>, id: unknown, token: string | number) {
  let ran = 1;
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const stream = writable.getWriter();
  const send = (message: string) => stream.write(new TextEncoder().encode(`event: message\ndata: ${message}\n\n`));
  const progress = () => send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: ran++ } }));
  // A stream that can't be written to has ended, and the write of the answer below says so.
  const telling = setInterval(() => progress().catch(() => clearInterval(telling)), PROGRESS);
  (async () => {
    try {
      await progress();
      const reached = await forwarded;
      const none = { jsonrpc: "2.0", id, error: { code: -32000, message: "None of this network's servers answered. Try again once one is on." } };
      await send(reached?.answer ?? JSON.stringify(none));
    } finally {
      clearInterval(telling);
      await stream.close();
    }
  })();
  return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

/**
 * Which of the headers MCP's streamable HTTP has a request carry, from 2026-07-28, doesn't say what its body does, if
 * one doesn't. A name that isn't plain ASCII is sent in base64, between `=?base64?` and `?=`. A task's request names
 * its task, as MCP's Tasks have it.
 */
function mismatched(headers: Headers, call: Call) {
  const tasked = ["tasks/get", "tasks/update", "tasks/cancel"].includes(call.method as string);
  const named = tasked || ["tools/call", "resources/read", "prompts/get"].includes(call.method as string);
  const sent = headers.get("mcp-name");
  const encoded = sent && /^=\?base64\?(.*)\?=$/.exec(sent);
  const name = encoded ? new TextDecoder().decode(Uint8Array.from(atob(encoded[1]), (c) => c.charCodeAt(0))) : sent;
  const expected: [string, unknown, string | null][] = [
    ["MCP-Protocol-Version", call.params?._meta?.[VERSION], headers.get("mcp-protocol-version")],
    ["Mcp-Method", call.method, headers.get("mcp-method")],
    ...(named ? [["Mcp-Name", tasked ? call.params?.taskId : (call.params?.name ?? call.params?.uri), name] as [string, unknown, string | null]] : []),
  ];
  const wrong = expected.find(([, body, header]) => header === null || body !== header);
  return wrong && `${wrong[0]} header value '${wrong[2] ?? ""}' does not match body value '${wrong[1] ?? ""}'`;
}

/**
 * The `traceparent` of this request's span, as W3C's Trace Context has it: under `parent`, the client's, which it
 * sends in `_meta` as MCP has it or as a header, if any. It's said in a line Telemetry's Tail Worker reads
 * (`apps/telemetry/edge/worker.ts`), and carried to the server.
 */
function traced(parent: unknown) {
  const random = (bytes: number) => hex.encode(randomBytes(bytes));
  const under = typeof parent === "string" ? /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(parent) : null;
  const traceparent = `00-${under?.[1] ?? random(16)}-${random(8)}-01`;
  console.log(JSON.stringify({ telemetry: { traceparent, parent: under?.[0] } }));
  return traceparent;
}

/** Whether a server answered that the device is nobody's. The answer is left to be sent on if it isn't. */
async function nobodys(answer: Response) {
  // A stream ran past what a server says of a device at once.
  if (answer.status !== 200 || answer.headers.get("content-type") !== "application/json") return false;
  const response = await answer.clone().json<{ error?: { code?: number } }>();
  return response.error?.code === NOBODY;
}

/**
 * Where a signed-in browser's apps' files are, `/apps/<its session, signed>`, and the device it is: its session, as
 * Devices lists it, and its key, as a server knows it, which it fills a tool's `device` input in with. An app's page has an origin of its own in the web client, so its files are asked for with no
 * cookie, and the signed session in their address says whose they are.
 */
async function apps(request: Request, env: Env) {
  const who = await signedIn(request, env);
  if ("refused" in who || !who.apps) return Response.json({ error: "Sign in" }, { status: 401 });
  return withCookies(Response.json({ apps: who.apps, device: who.session, key: who.device }), who.cookies);
}

/** `answer`, with the cookies of a browser's session the app that signs people in renewed, if it did. */
function withCookies(answer: Response, cookies: string[] = []) {
  for (const cookie of cookies) answer.headers.append("set-cookie", cookie);
  return answer;
}

/**
 * What an app's page loads in the web client: `/apps/<session, signed>/<app>/<app>/<path>` is `path` among the
 * latest files of `app` that a server lists for that session's person, as the app's client has them at its own
 * address for each app (`clients/app/src/lib.rs`). An app opened for a group or the network says so after its name,
 * last part first (`notes.family.groups`).
 *
 * `<app>@<version>` in place of the second `<app>` is that version's file, which never changes, so it's kept in
 * Cloudflare's cache for whoever asked and answered from there, with no server asked. A page asked for by its app's
 * name alone loads the rest by its version, as its `<base>` says: its frame's origin is its own and opaque, which
 * browsers give no HTTP cache, so this cache is the only one its files have.
 */
async function file(request: Request, env: Env, url: URL, ctx: ExecutionContext) {
  const [session, host, named, ...path] = url.pathname.slice("/apps/".length).split("/");
  const [app, pinned] = named.split("@");
  const who = await signedIn(request, env);
  if ("refused" in who) return new Response("Sign in again", { status: 401 });
  const [, ...whose] = host.split(".");
  const meta = whose.length ? { _meta: { subject: whose.reverse().join("/") } } : {};
  // Where it is, as its page says it didn't load: its session is this browser's alone, and isn't said.
  const where = [host, named, ...path].join("/");
  // Its servers' answer, or what they said instead, as the page is answered: none answering is a 503 that says so,
  // not a page that isn't there.
  const ask = async <Result,>(method: string, params: object): Promise<Result | Response> => {
    const answer = await forward(env, JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, ...meta } }), { device: who.device }, [`${who.who}/`, NETWORK]);
    const { result, error } = await answer.json<{ result?: Result; error?: { message?: string } }>().catch(() => ({}) as { result?: Result; error?: { message?: string } });
    if (answer.ok && result) return result;
    return new Response(error?.message ?? `There's nothing at ${where}`, { status: answer.ok ? 404 : answer.status });
  };
  const listed = pinned ? null : await ask<{ resources: { uri: string }[] }>("resources/list", {});
  if (listed instanceof Response) return listed;
  const version = pinned ?? listed?.resources.map(({ uri }) => uri.split("/")).find(([scheme, , of]) => scheme === "ui:" && of === app)?.[3];
  if (!version) return new Response(`There's nothing at ${where}`, { status: 404 });
  // Kept for whoever it was read for, as a server may answer another person otherwise.
  const kept = new Request(`${url.origin}/apps/${who.who}/${host}/${app}@${version}/${path.join("/")}`);
  let found = await caches.default.match(kept);
  if (!found) {
    const read = await ask<{ contents: { blob?: string; text?: string; mimeType: string }[] }>("resources/read", { uri: `ui://${app}/${version}/${path.join("/")}` });
    if (read instanceof Response) return read;
    const content = read.contents?.[0];
    if (!content) return new Response(`There's nothing at ${where}`, { status: 404 });
    const body = content.blob ? Uint8Array.from(atob(content.blob), (char) => char.charCodeAt(0)) : content.text;
    found = new Response(body, { headers: { "content-type": content.mimeType.replace(";profile=mcp-app", ""), "cache-control": "public, max-age=31536000, immutable" } });
    ctx.waitUntil(caches.default.put(kept, found.clone()));
  }
  const headers = {
    "content-type": found.headers.get("content-type") ?? "",
    // What an app's page may load, which is what an MCP App may by default and what the app lets one
    // (`APP_MAY_LOAD` in `clients/app/src/lib.rs`): its own app's files and the UI library, which are all
    // here, and nothing from anywhere else; and in a frame, another app's page, which is here too (`Frame`).
    "content-security-policy": `default-src 'none'; script-src ${url.origin} 'unsafe-inline'; style-src ${url.origin} 'unsafe-inline'; img-src ${url.origin} data:; media-src ${url.origin} data:; font-src ${url.origin} data:; connect-src 'none'; frame-src ${url.origin}; object-src 'none'; base-uri ${url.origin}`,
    // The page's origin is its own, so what it loads from here is from elsewhere to it.
    "access-control-allow-origin": "*",
    // Its address has its session in it, so it's this browser's alone. A page asked for by its app's name is
    // whichever version is latest.
    "cache-control": pinned ? "private, max-age=31536000, immutable" : "no-store",
  };
  if (pinned || !headers["content-type"].startsWith("text/html")) return new Response(found.body, { headers });
  // Before anything in it that has an address, its import map too, but after its doctype, which a browser reads first.
  const base = `<base href="${url.origin}/apps/${session}/${host}/${app}@${version}/${path.slice(0, -1).map((part) => `${part}/`).join("")}">`;
  const page = (await found.text()).replace(/^(\s*<!doctype html>)?/i, (doctype) => doctype + base);
  return new Response(page, { headers });
}
