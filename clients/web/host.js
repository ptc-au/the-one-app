// What the app's own page (`clients/app/page`) asks of where it runs, in a browser: the network's edge at the address
// it was opened at. It asks the network's servers as MCP over HTTP (`/mcp`), as whoever signed in here with their
// passkey, and an app's files come from the edge too (`/apps/`). It's what the app's Rust half answers, the same
// commands by the same names, less what a browser can't do, which each says.

import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping"
import { linkOf } from "../app/page/path.js"

/** @import { Commands } from "../app/page/host.js" */

/// Where a person signs in: the authorization endpoint of the authorization server the network's metadata names (RFC
/// 9728, RFC 8414), kept in this browser's storage once it's looked, so going to sign in asks nothing more.
const AUTHORIZATION_ENDPOINT = "authorization_endpoint"
async function signIn() {
  const stored = localStorage.getItem(AUTHORIZATION_ENDPOINT)
  if (stored) return stored
  const { authorization_servers } = await (await fetch("/.well-known/oauth-protected-resource")).json()
  const issuer = new URL(authorization_servers[0])
  const { authorization_endpoint } = await (await fetch(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`.replace(/\/$/, ""))).json()
  localStorage.setItem(AUTHORIZATION_ENDPOINT, authorization_endpoint)
  return authorization_endpoint
}

/// What hears each event, by its name.
/** @type {Map<string, Set<(event: { payload: unknown }) => void>>} */
const hearing = new Map()
/** @type {typeof import("../app/page/host.js").listen} */
export const listen = (event, handler) => {
  if (!hearing.has(event)) hearing.set(event, new Set())
  hearing.get(event)?.add(/** @type {(event: { payload: unknown }) => void} */ (handler))
}
/** @param {string} event @param {unknown} payload */
const emit = (event, payload) => hearing.get(event)?.forEach((handler) => handler({ payload }))

/// Where this browser's apps' files are, this browser as Devices lists it, and its key as a server knows it, once
/// it's signed in (`start`).
/** @type {string} */
let apps
/** @type {string} */
let device
/** @type {string} */
let key
/// What this browser kept of its network from when it last opened, as the app's client keeps it on disk, so it opens
/// from that at once while each is asked for again, as stale-while-revalidate has it: where its apps' files are and who
/// it is (`apps`, `device`, `key`), the files a server listed for each subject (`lists`, by subject, `""` its user's),
/// the tools (`tools`), and what each app was answered that only reads (`reads`, by app and by what it asked). A
/// browser that's no longer signed in, or signed in as someone else, keeps none of it.
const KEPT = "kept"
/** @type {{ apps?: string, device?: string, key?: string, lists: Record<string, any>, tools?: any[], reads: Record<string, Record<string, unknown>> }} */
const kept = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEPT) ?? "null") ?? { lists: {}, reads: {} }
  } catch {
    return { lists: {}, reads: {} }
  }
})()
/// It's written a moment after it changes, once for each run of changes; a browser out of room keeps what it had.
/** @type {ReturnType<typeof setTimeout> | undefined} */
let keeping
const keep = () =>
  void (keeping ??= setTimeout(() => {
    keeping = undefined
    try {
      localStorage.setItem(KEPT, JSON.stringify(kept))
    } catch {}
  }, 500))
const forget = () => {
  clearTimeout(keeping)
  localStorage.removeItem(KEPT)
}

/// Whether its network answers, as the app's client says it (`Connection` in core/client), how soon it's asked
/// again while it doesn't, and that ask.
/** @type {import("../app/page/host.js").Connection} */
let connection = "connecting"
/// How long it waits before asking again, doubling from `FIRST` to `MOST`, each wait a random time from half of it
/// to all of it (jitter, so browsers that lost the network together don't all ask together once it's back).
const [FIRST, MOST] = [1000, 3000]
let again = FIRST
/** @type {ReturnType<typeof setTimeout> | undefined} */
let asking

/// How long a request may take before it's reported as slow, as the app's client has it.
const SLOW = 2000
/** Random bytes in hex, as a trace's ids are. @param {number} bytes */
const hex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")

/** Which client this is, to a server (`OneCore.Call.client/1`). */
const CLIENT = { name: "one-web" }

/// Asks the network's servers `method`, as this browser's person. → its result. A browser that's no longer
/// signed in goes to sign in again.
/** @param {string} method @param {Record<string, any>} params @returns {Promise<any>} */
async function mcp(method, params = {}) {
  if (method === "tools/call") params = await filled(params)
  // The span this request is, carried as W3C's `traceparent`, which the edge's span and a server's are under, so a
  // trace runs from this browser on. It's reported if it fails or is slow, as the app's client reports its own
  // (`span` in `core/client`), but not when it failed for no server answering while none was already: that's the
  // outage, reported once it's over (`said`).
  const tool = method === "tools/call" ? params.name : undefined
  const span = { name: tool ? `${method} ${tool}` : method, traceId: hex(16), spanId: hex(8), kind: "client", attributes: { "mcp.method.name": method, "gen_ai.tool.name": tool, "one.reached": "edge" } }
  const [started, was] = [performance.now(), connection]
  /** @param {string} [error] */
  const ended = (error) => {
    const took = performance.now() - started
    if ((error && (was === "online" || connection === "online")) || took > SLOW) report({ ...span, took, error })
  }
  let response
  try {
    const headers = { "content-type": "application/json", traceparent: `00-${span.traceId}-${span.spanId}-01` }
    // It says which client it is, as MCP's 2026-07-28 has each request say, as the app's does (`say` in `core/client`).
    const said = { ...params, _meta: { "io.modelcontextprotocol/clientInfo": CLIENT, ...params._meta } }
    response = await fetch("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: said }) })
  } catch {
    answered(false)
    ended("Can't reach your network")
    throw new Error("Can't reach your network. Check this device is online.")
  }
  if (response.status === 401) {
    forget()
    location.replace(await signIn())
    throw new Error("Sign in again.")
  }
  answered(response.status !== 503)
  const { result, error } = await response.json()
  ended(error?.message ?? (result?.isError ? (result.content?.[0]?.text ?? "The tool failed") : undefined))
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return result
}
/// A page's error's stack in the source it was built from, as a native client puts one (`source_mapped` in
/// clients/app/renderer/src/js/stack.rs): each frame a browser says, `at <function> (<file>:<line>:<column>)` in Chrome
/// and `<function>@<file>:<line>:<column>` in Firefox and Safari, is looked up in its file's sourcemap (`<file>.map`, which
/// an app's build writes beside each bundle). Only this origin's files are asked for, as a page's stack is its own say.
/// → the stack and the place of its first frame, the one that threw.
const FRAME = /^\s*(?:at\s+(?:.+?\s+\()?|[^@\s]*@)?(https?:\/\/.+?):(\d+):(\d+)\)?$/
/** @param {string} stack @returns {Promise<{ stack: string, place?: { file: string, line: number } }>} */
async function sourceMapped(stack) {
  const lines = stack.split("\n").filter((line) => line.trim())
  const files = new Set(lines.map((line) => FRAME.exec(line)?.[1]).filter((file) => file && new URL(file).origin === location.origin))
  /** @type {Map<string, TraceMap>} */
  const maps = new Map()
  await Promise.all([...files].map(async (file) => {
    const map = await fetch(`${file}.map`).then((answer) => (answer.ok ? answer.text() : undefined), () => undefined)
    if (map) maps.set(/** @type {string} */ (file), new TraceMap(map))
  }))
  /** @type {{ file: string, line: number } | undefined} */
  let place
  const mapped = lines.map((line) => {
    const [, file = "", row, column] = FRAME.exec(line) ?? []
    const map = maps.get(file)
    const at = map && originalPositionFor(map, { line: Number(row), column: Number(column) - 1 })
    if (!at?.source || at.line === null) return line
    const source = at.source.replace(/^(\.\.\/)+/, "")
    place ??= { file: source, line: at.line }
    return `    at ${source}:${at.line}:${at.column + 1}`
  })
  return { stack: mapped.join("\n"), place }
}
/// A report of an error with its stack, as a native client sends it: the stack and where it threw in the source.
/** @param {Record<string, any>} record */
async function mapped(record) {
  const stacktrace = record.attributes?.["exception.stacktrace"]
  if (typeof stacktrace !== "string") return record
  const { stack, place } = await sourceMapped(stacktrace)
  return { ...record, attributes: { ...record.attributes, "exception.stacktrace": stack, ...(place && { "code.file.path": place.file, "code.line.number": place.line }) } }
}
/// What this browser reported to Telemetry (`report`), kept in its storage until a server is told, a few hundred
/// at most, as the app's client keeps them on disk. Telling reports nothing itself.
const REPORTS = "reports"
/** @returns {Record<string, unknown>[]} */
const reports = () => JSON.parse(localStorage.getItem(REPORTS) ?? "[]")
/** @param {Record<string, any>} record */
function report(record) {
  const stored = reports()
  const attributes = { ...record.attributes, "service.name": "web", "user_agent.name": browser(), "os.type": os() }
  if (stored.length < 300) localStorage.setItem(REPORTS, JSON.stringify([...stored, { ...record, attributes, time: Date.now() }]))
  if (connection === "online") sendReports()
}
/// Which browser this is, by its name.
const browser = () => ["Edge", "Firefox", "Chrome", "Safari"].find((name) => navigator.userAgent.includes(name === "Edge" ? "Edg/" : `${name}/`))
/// The device's operating system, by the names the app's client reports its own by (Rust's `env::consts::OS`). An
/// iPad's Safari says it's a Mac, but has a touch screen.
const os = () => {
  const agent = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(agent) || (agent.includes("Macintosh") && navigator.maxTouchPoints > 1)) return "ios"
  if (agent.includes("Android")) return "android"
  if (agent.includes("Mac OS X")) return "macos"
  if (agent.includes("Windows")) return "windows"
  if (agent.includes("CrOS")) return "chromeos"
  if (agent.includes("Linux")) return "linux"
  return undefined
}
/// Reports are told a few seconds after the first of them, as one batch.
/** @type {ReturnType<typeof setTimeout> | undefined} */
let sending
const sendReports = () => void (sending ??= setTimeout(() => ((sending = undefined), send()), 5000))
async function send() {
  const stored = reports()
  if (!stored.length) return
  localStorage.removeItem(REPORTS)
  const notification = { jsonrpc: "2.0", method: "notifications/one/measured", params: { records: stored } }
  const sent = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(notification) }).catch(() => undefined)
  if (!sent?.ok) localStorage.setItem(REPORTS, JSON.stringify([...stored, ...reports()].slice(0, 300)))
}
/// Since when no server has answered, which once one does is reported, if it was long enough to show.
let unanswered = 0

/// The moves its connection makes, from each state, as the app's client has them (`Connection::moves_to`).
const MOVES = { connecting: ["online", "offline"], offline: ["reconnecting"], reconnecting: ["online", "offline"], online: ["offline"] }
/// Moves its connection to `next`, if that's a move there is from where it is.
/** @param {import("../app/page/host.js").Connection} next */
function connected(next) {
  if (!MOVES[connection].includes(next)) return
  connection = next
  emit("state", state())
}

/// Says whether its network answered what was just asked, which leaves it offline until it's tried again
/// (`tryAgain`), and an answer to what was asked while it was offline is a try that was answered. While it doesn't
/// answer, this browser asks again by itself, every few seconds at most, as what's outside a device comes and goes,
/// and no person should have to ask for what was going to come back anyway: at once as the browser says it's online
/// again or the page is seen again, and otherwise as `again` says. Once it answers, every open app asks again, for
/// what it missed.
/** @param {boolean} now */
function answered(now) {
  const lost = connection === "offline" || connection === "reconnecting"
  if (now) connected("reconnecting")
  const was = connection
  connected(now ? "online" : "offline")
  if (was === connection) return
  if (now && lost) {
    listTools().catch(() => {})
    for (const view of views.keys()) refresh(view)
  }
  if (!now) unanswered ||= performance.now()
  if (now && unanswered && performance.now() - unanswered > 3000) report({ name: "one.client.unanswered", took: performance.now() - unanswered, error: "No server is answering" })
  else if (now) sendReports()
  if (now) [again, unanswered] = [FIRST, 0]
  else tryAgain()
}
/// Tries its network again once `again` has passed, or with `now`, at once: by opening again while it hasn't, and
/// by asking a server once it has.
function tryAgain(now = false) {
  clearTimeout(asking)
  asking = setTimeout(
    () => {
      again = Math.min(again * 2, MOST)
      connected("reconnecting")
      if (apps) mcp("ping").catch(() => {})
      else opened()
    },
    now ? 0 : again * (0.5 + Math.random() / 2),
  )
}
for (const [target, event] of /** @type {const} */ ([[window, "online"], [document, "visibilitychange"]]))
  target.addEventListener(event, () => connection === "offline" && document.visibilityState === "visible" && tryAgain(true))

/// What each open app was answered that only reads, by what it asked: it's answered that at once, as
/// stale-while-revalidate has it, as the app's client answers a view (`Subscription` in `core/client`). A write has
/// each tool's answer asked again in the background (`fetching`), and the app is told as one comes back different.
/** @typedef {{ method: string, params: Record<string, unknown>, response: unknown, invalidated: number, fetched: number, fetching?: { generation: number, done: Promise<boolean> } }} CachedQuery */
/** @type {Map<string, Map<string, CachedQuery>>} */
const views = new Map()
/** @param {string} view */
const responses = (view) => /** @type {NonNullable<ReturnType<typeof views.get>>} */ (views.get(view) ?? views.set(view, new Map()).get(view))

/** @param {string} view @param {CachedQuery} entry @param {number} generation @returns {Promise<boolean>} */
function fetchEntry(view, entry, generation) {
  const done = mcp(entry.method, entry.params).then(
    (fresh) => {
      if (entry.fetching?.generation === generation) entry.fetching = undefined
      if (generation < entry.invalidated || generation < entry.fetched) return true
      entry.fetched = generation
      ;(kept.reads[view] ??= {})[JSON.stringify([entry.method, entry.params])] = fresh
      keep()
      if (JSON.stringify(fresh) !== JSON.stringify(entry.response)) {
        entry.response = fresh
        emit("changed", view)
      }
      return true
    },
    () => {
      // With no server answering, what was answered stays what's shown.
      if (entry.fetching?.generation === generation) entry.fetching = undefined
      return false
    },
  )
  entry.fetching = { generation, done }
  return done
}

/** @param {string} view @param {string} method @param {Record<string, unknown>} params @returns {Promise<any>} */
async function read(view, method, params) {
  const request = JSON.stringify([method, params])
  const cached = responses(view).get(request)
  if (cached) return cached.response
  // Answered before this browser last closed it: that at once, and asked again, the app told if it's changed.
  if (kept.reads[view] && request in kept.reads[view]) {
    const entry = { method, params, response: kept.reads[view][request], invalidated: 0, fetched: 0 }
    responses(view).set(request, entry)
    fetchEntry(view, entry, 0)
    return entry.response
  }
  const response = await mcp(method, params)
  if (!responses(view).has(request)) responses(view).set(request, { method, params, response, invalidated: 0, fetched: 0 })
  ;(kept.reads[view] ??= {})[request] = response
  keep()
  return /** @type {CachedQuery} */ (responses(view).get(request)).response
}

/// The tools a server lists, by which a call is known to only read: asked for as soon as this browser is signed in,
/// as nearly every app's first call waits on it, and again once something may have changed them. Those kept from
/// before say it meanwhile, as which tools only read hardly changes.
/** @type {Promise<{ name: string, annotations?: { readOnlyHint?: boolean }, inputSchema?: { properties?: Record<string, { format?: string }> } }[]> | undefined} */
let tools
const listTools = () =>
  (tools = mcp("tools/list").then(
    (listed) => {
      kept.tools = listed.tools
      keep()
      return listed.tools
    },
    (error) => {
      tools = undefined
      throw error
    },
  ))
const known = () => (kept.tools ? Promise.resolve(kept.tools) : (tools ?? listTools()))

/// A tool's call with the inputs a device fills in itself filled in where none is given, as the app's client fills
/// them (`core/client/src/resolve.rs`): `device`, this browser's key as a server knows it, and `device-name`, what
/// it's called. The rest are filled in by what only a device holds, which a browser doesn't.
/** @param {Record<string, any>} params */
async function filled(params) {
  const listed = /** @type {Awaited<NonNullable<typeof tools>>} */ (await known())
  const tool = listed.find(({ name }) => name === params.name)
  /** @type {Record<string, string>} */
  const own = { device: key, "device-name": called() }
  const fills = Object.entries(tool?.inputSchema?.properties ?? {}).filter(([name, says]) => says.format && own[says.format] && params.arguments?.[name] === undefined)
  if (!fills.length) return params
  return { ...params, arguments: { ...params.arguments, ...Object.fromEntries(fills.map(([name, says]) => [name, own[/** @type {string} */ (says.format)]])) } }
}

/// Whether asking `method` only reads. A tool does when the server's list of tools says so.
/** @param {string} method @param {Record<string, unknown>} params */
async function reads(method, params) {
  if (["tools/list", "resources/list", "resources/read"].includes(method)) return true
  if (method !== "tools/call") return false
  return (await known()).some((/** @type {{ name: string, annotations?: { readOnlyHint?: boolean } }} */ tool) => tool.name === params.name && tool.annotations?.readOnlyHint === true)
}

/// Asks again, in the background, for each tool `view` was answered, or with `app`, each of that app's, as a write may
/// have changed what they answer (TanStack Query's `invalidateQueries` by key). An app's files aren't: what changes
/// them, an install or a deploy, says so.
/** @param {string} view @param {string} [app] */
function invalidate(view, app) {
  for (const cached of views.get(view)?.values() ?? []) {
    if (cached.method !== "tools/call") continue
    if (app && !String(cached.params.name).startsWith(`${app}_`)) continue
    cached.invalidated += 1
    fetchEntry(view, cached, cached.invalidated)
  }
}

/// Asks again for everything `view` was answered, and tells it as each answer changes.
/** @param {string} view */
async function refresh(view) {
  await Promise.all(
    [...(views.get(view)?.values() ?? [])].map((cached) =>
      cached.fetched < cached.invalidated && cached.fetching ? cached.fetching.done : fetchEntry(view, cached, cached.invalidated),
    ),
  )
}

/// The runtime version each entrypoint a server last listed needs to be drawn by the renderer, by its subject and
/// entrypoint (`<subject>|<entrypoint>`), where it names one (`runtime_version`).
/** @type {Map<string, number>} */
const runtimes = new Map()
/// Whether this browser has the WebGPU the renderer draws every app's page on, asked as the page loads: one without it
/// is sent to a page that names the browsers that have it (`unsupported.html`).
const webgpu = navigator.gpu ? navigator.gpu.requestAdapter().then(Boolean, () => false) : Promise.resolve(false)
/// The version of each app a server last listed, by the subject it's listed for.
/** @type {Map<string | undefined, Map<string, string>>} */
const versions = new Map()
/// The open apps for `subject` whose apps have a new version since the last list, each as its address names it
/// (`<app>[.<subject, last part first>]`).
/** @param {string | undefined} subject @param {{ uri: string, _meta?: { runtimeVersion?: number } }[]} resources */
function outdated(subject, resources) {
  for (const { uri, _meta } of resources) {
    const [app, , ...page] = uri.slice("ui://".length).split("/")
    if (_meta?.runtimeVersion) runtimes.set(`${subject ?? ""}|${app}/${page.join("/")}`, _meta.runtimeVersion)
  }
  const now = new Map(resources.map(({ uri }) => /** @type {[string, string]} */ (uri.slice("ui://".length).split("/", 2))))
  const was = versions.get(subject)
  versions.set(subject, now)
  if (!was) return []
  const changed = [...now].filter(([app, version]) => was.has(app) && was.get(app) !== version).map(([app]) => app)
  const whose = subject ? `.${subject.split("/").reverse().join(".")}` : ""
  return changed.map((app) => app + whose)
}

/// Where this browser is with its network, as the page hears it (`State` in core/client): its session, as its network's
/// address last said it, with how many moves of it the page has been told of, and whether its network answers.
/** @type {Omit<import("../app/page/host.js").Told, "seq">} */
let session = { session: { state: "opening" } }
let told = 0
/** @returns {import("../app/page/host.js").State} */
const state = () => ({ seq: told, ...session, connection })
/// Moves its session to `now`, which the page hears.
/** @param {Omit<import("../app/page/host.js").Told, "seq">} now */
function moved(now) {
  session = now
  told += 1
  emit("state", state())
}
/// Asks the network's address whether this browser is signed in, as it opens, and moves its session on by what it
/// says: signed in here, or sent to sign in, with where it does. An address that doesn't answer leaves it opening.
async function opened() {
  let response
  try {
    response = await fetch("/apps")
  } catch {
    return answered(false)
  }
  if (response.status === 401) {
    forget()
    moved({ session: { state: "signIn" }, link: await signIn() })
    return answered(true)
  }
  if (!response.ok) return answered(false)
  const now = await response.json()
  // Signed in as someone else since, what was kept isn't theirs: it opens again with none.
  if (kept.apps && now.apps !== kept.apps) {
    forget()
    return location.reload()
  }
  ;({ apps, device, key } = now)
  Object.assign(kept, now)
  keep()
  if (session.session.state !== "signedIn") moved({ session: { state: "signedIn" } })
  answered(true)
  listTools().catch(() => {})
  // Its person may have turned its notifications on or off in the browser's settings since.
  if (push && push.state !== "homeScreen") {
    if (Notification.permission === "granted") registerPush()
    else pushed({ state: Notification.permission === "denied" ? "denied" : "notAsked" })
  }
}

/// Where this browser is with being woken by its notifications, as a phone's is (`Push` in
/// apps/notifications/client/native): nothing where a browser has no push, and on an iPhone or iPad until the web
/// client is on its Home Screen, where Safari gives one push (webkit.org/blog/13878), `homeScreen`. Unlike a phone's
/// app, a browser asks its person only as they turn notifications on (`push`), as browsers ask that a site does.
/** @type {import("../app/page/host.js").Push | undefined} */
let push =
  "PushManager" in window && "serviceWorker" in navigator
    ? { state: Notification.permission === "denied" ? "denied" : "notAsked" }
    : os() === "ios" && !(/** @type {{ standalone?: boolean }} */ (navigator).standalone)
      ? { state: "homeScreen" }
      : undefined
/// Moves its push on to `next`, and has every open app ask again, as Notifications shows it.
/** @param {import("../app/page/host.js").Push} next */
function pushed(next) {
  push = next
  for (const view of views.keys()) emit("changed", view)
}
/// Where it was signed in when it last opened, which it opens as, and whether it's signed in now, asked of its
/// network's address as the page loads, beside whether this browser has WebGPU, not after.
if (kept.apps) {
  ;({ apps, device, key } = /** @type {{ apps: string, device: string, key: string }} */ (kept))
  session = { session: { state: "signedIn" } }
}
const opening = opened()

/// Each operating system, as a person calls it, by `os()`'s names: what a browser is called, beside its own name.
/** @type {Record<string, string>} */
const SYSTEMS = { ios: "iPhone", android: "Android", macos: "Mac", windows: "Windows", chromeos: "ChromeOS", linux: "Linux" }
/// What this browser is called, as Sign-In calls it: "Chrome on Linux".
const called = () => `${browser() ?? "Browser"} on ${SYSTEMS[os() ?? ""] ?? "this device"}`
/// Has this browser's service worker give the network its push subscription, as a phone gives its push token: each
/// time it's signed in, so a network that lost it gets it again, and the worker does it too as the push service
/// replaces the subscription (`sw.js`).
async function registerPush() {
  if (push?.state !== "registered") pushed({ state: "registering" })
  try {
    await navigator.serviceWorker.register("/sw.js")
    const { active } = await navigator.serviceWorker.ready
    const { arguments: own } = await filled({ name: "notifications_register", arguments: {} })
    const { port1, port2 } = new MessageChannel()
    const done = new Promise((resolve) => (port1.onmessage = ({ data }) => resolve(data)))
    active?.postMessage({ register: own }, [port2])
    const { error } = await done
    if (error) throw new Error(error)
    pushed({ state: "registered" })
  } catch (error) {
    pushed({ state: "failed", why: /** @type {Error} */ (error).message })
  }
}
// A notification tapped while a window of this address is open opens its app here (`sw.js`).
navigator.serviceWorker?.addEventListener("message", ({ data }) => data?.open && emit("open", data.open))
// Safari puts the web client on an iPhone's Home Screen as an app of its own, which a push reaches, by its manifest,
// which names it as the network is named (`apps/sign-in/edge/worker.ts`), as the edge names its tab (`core/edge/web/web.ts`).
document.head.append(Object.assign(document.createElement("link"), { rel: "manifest", href: "manifest.webmanifest" }))

/// What a browser can't do, as it's said where it's asked.
/** @param {string} why */
const cannot = (why) => () => Promise.reject(new Error(why))
const NO_KEY = "A browser can't hold your key. Use the app on your phone or computer for that."

/// Where this tab keeps the link it was opened with while its person signs in.
const OPEN = "open"
/// When this tab last came back from being stopped, its device asleep or the tab frozen in the background: a timer that
/// came 4 s or more late, so an open across it isn't told.
let stopped = 0
let ticked = Date.now()
setInterval(() => {
  const now = Date.now()
  if (now - ticked >= 6000) stopped = now
  ticked = now
}, 2000)

/** @type {{ [Command in keyof Commands]?: (...args: Parameters<Commands[Command]>) => ReturnType<Commands[Command]> | Promise<ReturnType<Commands[Command]>> }} */
const commands = {
  /// Where this browser is with its network, as the app's client says a device's session (`State` in core/client):
  /// signed in here, or sent to sign in, and whether its network answers. A browser keeps nothing of a network's, so
  /// with its address not answering it's still opening, and asks again by itself (`tryAgain`).
  /// Where the address it was opened at is, an app's place (`/settings/vault/accounts?request=4`, as `pathOf` makes
  /// it), is opened once it's signed in, as a link to it (`settings#vault/accounts&request=4`): it's kept in this tab
  /// while its person signs in, and the address goes back to the Home Screen's, which the app's own is pushed over
  /// (`go` in client.js), so Back goes home. A request's link in Vault still leads to `/?open=<one: link>`, as a
  /// phone's app follows it there (clients/app/src/mobile.rs), until phones read a path.
  async start() {
    const asked = opening
    if (!(await webgpu)) {
      location.replace("/unsupported")
      return new Promise(() => {})
    }
    const linked = new URLSearchParams(location.search).get("open") ?? linkOf(location.pathname, location.search)
    if (linked) {
      sessionStorage.setItem(OPEN, linked)
      history.replaceState(null, "", "/")
    }
    // Signed in when it last opened, it opens as it was while its network says whether it still is.
    if (!kept.apps) await asked
    const open = session.session.state === "signIn" ? null : sessionStorage.getItem(OPEN)
    if (open) sessionStorage.removeItem(OPEN)
    return { state: state(), ...(open && { open }) }
  },
  /// The files a server lists for `subject`, and the open apps that are out of date.
  /// Those kept from before are answered at once, and listed again: an open app whose app has a new version since is
  /// told it's stale, and the page lists them again where anything changed, as a server says it.
  async apps({ subject }) {
    const at = subject ?? ""
    const before = kept.lists[at]
    const listing = mcp("resources/list", subject ? { _meta: { subject } } : {}).then((listed) => {
      kept.lists[at] = listed
      keep()
      return listed
    })
    if (!before) {
      const listed = await listing
      return { ...listed, outdated: outdated(subject, listed.resources) }
    }
    listing.then((listed) => {
      const stale = outdated(subject, listed.resources)
      if (stale.length) emit("stale", stale)
      if (JSON.stringify(listed) !== JSON.stringify(before)) emit("changed", "client")
    }, () => {})
    return { ...before, outdated: outdated(subject, before.resources) }
  },
  async request({ view, method, params }) {
    if (await reads(method, params)) return read(view, method, params)
    const response = await mcp(method, params)
    const name = typeof params?.name === "string" ? params.name : ""
    // One Core's own tools (`install`, `apps_update`) may change anything, the tools listed too.
    const core = !name.includes("_") || name.startsWith("apps_")
    if (method === "tools/call" && core) listTools().catch(() => {})
    // The view that wrote asks again for all it was answered, as the app's client's does (`Subscription::request`).
    // A server tells every client it's connected to what an app's call changed, that app's tools
    // (`notifications/one/changed`); a browser isn't connected, so every other open view asks again for the called
    // app's, or for everything after One Core's own.
    const app = method === "tools/call" && !core ? name.slice(0, name.indexOf("_")) : undefined
    for (const open of views.keys()) invalidate(open, open === view ? undefined : app)
    return response
  },
  refresh: ({ view }) => refresh(view),
  close: ({ view }) => void views.delete(view),
  // The runtime version its renderer draws, which ships with this page: renderer::RUNTIME_VERSION.
  client: () => ({ device, network: location.origin, push, web: true, runtimeVersion: 6 }),
  /// Turns on its notifications, as its person taps to: the browser asks them first, which it does only for a tap.
  async push() {
    if (push?.state === "homeScreen") throw new Error("Add this to your Home Screen first.")
    if ((await Notification.requestPermission()) !== "granted") pushed({ state: "denied" })
    else await registerPush()
    return { message: "" }
  },
  /// A file too large to go in a call goes where the network keeps it, by the link a server gives for it.
  async upload(file, { headers: { app } }) {
    const { content, isError } = await mcp("tools/call", { name: "upload", arguments: { app } })
    if (isError) throw new Error(content[0].text)
    const to = JSON.parse(content[0].text)
    const sent = await fetch(to.url, { method: to.method, headers: to.headers, body: file })
    if (!sent.ok) throw new Error("The file couldn't be sent. Try again.")
    return { upload: to.upload }
  },
  retry: () => tryAgain(true),
  /// Its session is gone, and with it what the network kept of this browser (`sign-in.device_removed`): what its push
  /// service kept goes too.
  async sign_out() {
    forget()
    await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription().then((subscription) => subscription?.unsubscribe())
    location.reload()
  },
  serve: cannot("A browser can't be a server. Make your phone or computer one in its app."),
  update: cannot("A browser has the latest each time it opens."),
  recovery_key: cannot(NO_KEY),
  recover: cannot(NO_KEY),
  report: async ({ record }) => report(await mapped(record)),
  opened: ({ view, ms }) => Date.now() - stopped < ms ? undefined : report({ name: "one.client.open.duration", value: ms, attributes: { "one.view": view } }),
  // What the app does as it's seen, which a browser doesn't: it hears notifications.
  visible() {},
  listen() {},
  // A browser's back and forward gestures are its own, and so is its status bar.
  navigation_gestures() {},
  status_bar() {},
}

/// Light or dark for the browser's own bars, as its `theme-color` (index.html) names the page's background in each:
/// the chosen one's, or with `null` each as the device is.
const themeColors = [.../** @type {NodeListOf<HTMLMetaElement>} */ (document.querySelectorAll('meta[name="theme-color"]'))].map((meta) => /** @type {const} */ ([meta, meta.media]))
/** @type {typeof import("../app/page/host.js").setTheme} */
export const setTheme = (theme) => {
  for (const [meta, media] of themeColors) meta.media = theme ? (media.includes(theme) ? "all" : "not all") : media
}

/** @type {typeof import("../app/page/host.js").invoke} */
export const invoke = (command, ...args) => {
  if (!commands[command]) return Promise.reject(new Error(`A browser has no ${command}`))
  return Promise.resolve(commands[command](...args))
}

/// Where an app's page is: the edge's, under where this browser's apps' files are, by what names its address
/// (`<app>[.<subject, last part first>]`), as the app has its own address for each. It's at the version a server
/// last listed, which the edge keeps (`core/edge/mcp/mcp.ts`), or before its subject is listed, the latest.
/** @type {typeof import("../app/page/host.js").address} */
export const address = (view) => {
  const [app, ...page] = view.entrypoint.split("/")
  const version = versions.get(view.subject)?.get(app)
  const at = `${apps}/${view.host}/${version ? `${app}@${version}` : app}/${page.join("/")}`
  // It's drawn by the renderer, in its frame (`renderer/`), which loads the page's own and says what it needs.
  const runtime = runtimes.get(`${view.subject ?? ""}|${view.entrypoint}`) ?? 0
  return `${location.origin}/renderer/?runtime=${runtime}#${at}`
}

/// What an app's frame may do. Its address is this page's, so it's given an origin of its own, which reaches
/// nothing here: not this page, not another app, and not what this browser is signed in with.
export const sandbox = "allow-scripts allow-forms"

/// The window's address says where it is (`pathOf`), as a web app's does, so going back and forward moves through
/// it, loading it again opens the same place, and a copied address opens it for whoever may see it.
export const addressed = true

/// An app's page updated under it asks its person to reload it while it's on screen ("Updated · Reload"), as a web
/// app in a browser offers its update.
export const asksToReload = true

/// A web address an app opens, in a tab of its own.
/** @type {typeof import("../app/page/host.js").openLink} */
export const openLink = (url) => void open(url, "_blank", "noopener")

/// A haptic, as a short vibration where the browser has one and lets this page vibrate (Chrome on Android, after a
/// tap), and nothing elsewhere: iOS's Safari and a computer's browsers have none.
/** @type {Record<import("../app/page/host.js").Haptic, number | number[]>} */
const VIBRATIONS = { light: 10, soft: 8, medium: 15, rigid: 15, heavy: 25, selection: 5, success: [10, 60, 10], warning: [20, 80, 20], error: [20, 40, 20, 40, 20] }
/** @type {typeof import("../app/page/host.js").haptic} */
export const haptic = (kind) => void navigator.vibrate?.(VIBRATIONS[kind])
