// The page an assistant shows for an app's tool, as an MCP App (`core/edge/mcp/mcp.ts`): the page of the app whose tool
// it called, drawn by our renderer in its frame from the network's address (`renderer/`), as the web client draws it,
// as an MCP App's own page may not compile WebAssembly. Many tools show it, as one view, each saying which page shows
// what it answered (its result's `_meta.page`, `<app>/<path>`).
//
// It passes messages between that frame and the assistant, but what the page asks the network (its tools, its
// resources) it asks itself, as whoever let the assistant in, as the web client's page does (`ask`). It's
// greeted by the assistant once, as one page, and answers each page it shows itself with what it was answered, and
// tells the tool's page what the tool was given and answered, as an MCP App's page is told. A `one:` link a page opens
// shows what that link opens, as the window's `go` does (`opens`), in this view.
import { named, opens, pagesOf } from "../app/page/path.js"

/** What the edge says of where it is, read for whoever let the assistant in: the network's address, where their apps'
 * files are, the apps listed for them, and the device the assistant is to the network.
 * @type {{ origin: string, apps: string, resources: { uri: string }[], device: string }} */
const { origin, apps, resources, device } = JSON.parse(/** @type {HTMLElement} */ (document.getElementById("router")).textContent ?? "")
const listed = pagesOf(resources)
/// The renderer's frame of the page shown, a new one for each, as a frame whose address changes only after its `#` is
/// the same page.
let frame = /** @type {HTMLIFrameElement} */ (document.querySelector("iframe"))
/** @param {Record<string, unknown>} message */
const toHost = (message) => parent.postMessage({ jsonrpc: "2.0", ...message }, "*")
/** @param {Record<string, unknown>} message */
const toPage = (message) => frame.contentWindow?.postMessage({ jsonrpc: "2.0", ...message }, "*")

/// The id of this page's own `ui/initialize`, which no page it shows asks by.
const GREETING = "router"
/// How tall the page is in an assistant's chat: a host sizes a page by what it says. What the page says of its content
/// (`ui/notifications/size-changed`, as any page's client has it), or until it does as much as the host allows, which
/// a page that fills its window (Settings, a live screen) is as tall as, and no more than its person's display.
/** @type {number | undefined} */
let said
let told = 0
function size() {
  const dimensions = /** @type {{ maxHeight?: number } | undefined} */ (greeted?.hostContext?.containerDimensions)
  const most = dimensions?.maxHeight ?? Infinity
  const height = Math.round(Math.min(most, said ?? Math.max(480, screen.availHeight * 0.8)))
  if (height !== told) toHost({ method: "ui/notifications/size-changed", params: { height: (told = height) } })
}
/// What the assistant answered this page's `ui/initialize`, once it has.
/** @type {{ hostContext?: Record<string, unknown>, hostCapabilities?: unknown, hostInfo?: unknown } | undefined} */
let greeted
/// What the tool was given and answered, which its page is told, and whether the page shown is its.
/** @type {object | undefined} */
let input
/** @type {{ _meta?: { page?: unknown, tool?: unknown, subject?: unknown } } | undefined} */
let result
let tools = false
/// Whom the page shown is for, where it isn't whoever let the assistant in: the group whose app's tool was called for
/// it (its result's `_meta.subject`). Its page is that app's, and what it asks is asked for them.
/** @type {string | undefined} */
let subject
/// The app whose page is shown.
/** @type {string | undefined} */
let showing

/// What the page says until the renderer's frame has drawn, in its place, and what it says where the frame can't: a
/// link that opens the app at the network's address, in its person's browser, which any assistant lets a page open.
const note = /** @type {HTMLElement} */ (document.getElementById("note"))
/** Says `text` where the page would be, with a link to open `app` at the network's address. @param {string} text @param {string} [app] */
function say(text, app) {
  delete document.body.dataset.drawn
  note.textContent = text
  if (!app) return
  const link = Object.assign(document.createElement("a"), { href: `${origin}/${app}`, target: "_blank", textContent: `Open it at ${new URL(origin).host}` })
  link.addEventListener("click", (event) => {
    event.preventDefault()
    toHost({ id: `open-${Date.now()}`, method: "ui/open-link", params: { url: link.href } })
  })
  note.append(link)
}

/// Whether the assistant lets this page frame the network's address. An assistant may refuse a page's frames whatever
/// it declares (`frameDomains` in `core/edge/mcp/mcp.ts`), as Claude does a connector added by its address, and then
/// says which it allows (MCP Apps' `hostCapabilities.sandbox.csp.frameDomains`); one that doesn't say may still.
function framed() {
  const allowed = /** @type {{ hostCapabilities?: { sandbox?: { csp?: { frameDomains?: unknown } } } } | undefined} */ (greeted)?.hostCapabilities?.sandbox?.csp?.frameDomains
  if (!Array.isArray(allowed)) return true
  const { protocol, host } = new URL(origin)
  return allowed.some((entry) => entry === origin || (typeof entry === "string" && entry.startsWith(`${protocol}//*.`) && host.endsWith(entry.slice(`${protocol}//*`.length))))
}

/** Shows `page`, `<app>/<path>`, at `fragment`, the place in it, in the renderer's frame, for `whom` (`subject`). @param {string} page @param {string} [fragment] @param {string} [whom] */
function show(page, fragment, whom) {
  const [app, ...path] = page.split("/")
  subject = whom
  showing = app
  const assistant = /** @type {{ hostInfo?: { name?: unknown } } | undefined} */ (greeted)?.hostInfo?.name
  if (!framed()) return say(`${typeof assistant === "string" ? assistant : "This assistant"} doesn't let this chat show pages from ${new URL(origin).host}, so this app can't open here.`, app)
  say("Opening…", app)
  // By its version, as the web client loads it (`address`): what the page loads is found beside it from there. One for
  // someone else is found by its app's name, at the address that says for whom, last part first (`notes.family.groups`).
  const version = whom ? undefined : resources.find(({ uri }) => named(uri) === page)?.uri.split("/")[3]
  const host = whom ? [app, ...whom.split("/").reverse()].join(".") : app
  const theme = greeted?.hostContext?.theme
  const at = `${origin}${apps}/${host}/${version ? `${app}@${version}` : app}/${path.join("/")}${typeof theme === "string" ? `?theme=${theme}` : ""}${fragment ? `#${fragment}` : ""}`
  const shown = /** @type {HTMLIFrameElement} */ (frame.cloneNode())
  shown.src = `${origin}/renderer/#${at}`
  frame.replaceWith(shown)
  frame = shown
  said = undefined
  size()
}

/** Asks the network `method`, as whoever let the assistant in. → its JSON-RPC answer. @param {unknown} id @param {string} method @param {unknown} [params] */
const request = (id, method, params) =>
  fetch(`${origin}${apps}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }).then(
    async (response) => (response.ok ? response.json() : { error: { code: -32000, message: response.status === 401 ? "This page's sign-in ended. Ask your assistant to show it again." : await response.text() } }),
    () => ({ error: { code: -32000, message: "Can't reach your network. Check this device is online." } }),
  )
/// The tools that only read, by name, as the network lists them for each subject (`""` whoever let the assistant in):
/// a call to any other may change what the page shows.
/** @type {Map<string, Promise<Set<string>>>} */
const reading = new Map()
/** Asks the network what the page asked, for whom it's for unless it says, and answers the page. After a call that may
 * have changed something, the page asks again for what it was answered, as the web client has it (`request` in
 * host.js). @param {{ id: unknown, method: string, params?: any }} asked */
async function ask({ id, method, params }) {
  const meta = subject ? { _meta: { subject, ...params?._meta } } : {}
  const answered = await request(id, method, { ...params, ...meta })
  toPage(answered.error ? { id, error: answered.error } : { id, result: answered.result })
  if (method !== "tools/call" || answered.error || answered.result?.isError) return
  const whom = meta._meta?.subject ?? ""
  if (!reading.has(whom)) reading.set(whom, request(0, "tools/list", meta).then(({ result }) => new Set((result?.tools ?? []).filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name))))
  if (!(await reading.get(whom))?.has(params?.name)) toPage({ method: "notifications/one/changed", params: {} })
}

addEventListener("message", ({ source, data }) => {
  if (typeof data !== "object" || data?.jsonrpc !== "2.0") return
  if (source === parent) {
    if (data.id === GREETING) {
      greeted = data.result
      toHost({ method: "ui/notifications/initialized", params: {} })
      size()
      return
    }
    if (data.method === "ui/notifications/tool-input") input = data.params
    if (data.method === "ui/notifications/tool-result") {
      result = data.params
      const page = result?._meta?.page
      if (typeof page === "string") {
        tools = true
        show(page, undefined, typeof result?._meta?.subject === "string" ? result._meta.subject : undefined)
      } else {
        // A call that failed has no page, and says why, as a host shows a tool's text.
        const text = /** @type {{ content?: { type?: string, text?: string }[] } | undefined} */ (result)?.content?.find((item) => item.type === "text")?.text
        say(text ?? "This tool has no page to show.")
      }
      return
    }
    if (data.method === "ui/notifications/host-context-changed" && greeted) {
      greeted = { ...greeted, hostContext: { ...greeted.hostContext, ...data.params } }
      size()
    }
    toPage(data)
    return
  }
  if (source !== frame.contentWindow) return
  // A page shown is greeted with what the assistant answered this one, and the tool's is told what it was given and
  // answered, once it says it's ready, as a host tells an MCP App's.
  // The tool's page is told which tool it shows (MCP Apps' `toolInfo`), which an assistant may not say, and that it's in an
  // assistant's chat (`inChat`), where what only its person's own device may do is refused.
  if (data.method === "ui/initialize") {
    const tool = tools && typeof result?._meta?.tool === "string" ? { toolInfo: { tool: { name: result._meta.tool } } } : {}
    return toPage({ id: data.id, result: greeted && { ...greeted, hostContext: { ...tool, ...greeted.hostContext, assistant: true } } })
  }
  if (data.method === "ui/notifications/size-changed") {
    said = typeof data.params?.height === "number" ? data.params.height : undefined
    return size()
  }
  if (data.method === "ui/notifications/initialized") {
    if (tools && input) toPage({ method: "ui/notifications/tool-input", params: input })
    if (tools && result) toPage({ method: "ui/notifications/tool-result", params: result })
    return
  }
  // What a page is told of its client, as the web client tells it (`client` in host.js): this view changes nothing of
  // a device.
  if (data.method === "one/client") {
    if (Object.keys(data.params ?? {}).length) return toPage({ id: data.id, error: { code: -32000, message: "An assistant's view of an app changes nothing of a device" } })
    return toPage({ id: data.id, result: { device, network: origin, web: true, theme: null } })
  }
  if (data.method === "ui/open-link" && typeof data.params?.url === "string" && data.params.url.startsWith("one:")) {
    const to = opens(data.params.url.slice("one:".length), listed)
    if (!to) return toPage({ id: data.id, error: { code: -32000, message: "That app isn't installed" } })
    toPage({ id: data.id, result: {} })
    tools = false
    show(to.page, to.fragment)
    return
  }
  // What the page asks the network, it asks itself, as whoever let the assistant in (`pages` in core/edge/mcp/mcp.ts):
  // it's its person's tap, which the assistant would otherwise ask them to approve, as it does what its model calls.
  if (data.id !== undefined && typeof data.method === "string" && !data.method.startsWith("ui/")) return void ask(data)
  // The renderer's frame has drawn its page, which is shown from then; or couldn't open it, and says why, which is
  // said here as a native host's window says it.
  if (data.method === "notifications/one/seen" && "drawn" in (data.params ?? {})) document.body.dataset.drawn = ""
  if (data.method === "notifications/one/seen" && typeof data.params?.unopened === "string") say(`This app couldn't open here: ${data.params.unopened}`, showing)
  toHost(data)
})

toHost({ id: GREETING, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "one", version: "1" }, appCapabilities: {} } })
