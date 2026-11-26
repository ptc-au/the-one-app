// The page an assistant shows for an app's tool, as an MCP App (`core/edge/mcp/mcp.ts`): the page of the app whose tool
// it called, drawn here by our renderer (`renderer/renderer.js`), loaded by its full address at the network's, as the web
// client's frame loads it, in the assistant's own frame. Many tools show it, as one view, each saying which page shows
// what it answered (its result's `_meta.page`, `<app>/<path>`).
//
// It's the page's client (`Client` in renderer.js): it passes messages between the page and the assistant, but what the
// page asks the network (its tools, its resources) it asks itself, as whoever let the assistant in, as the web client's
// page does (`ask`). It's greeted by the assistant once, and answers the page with what it was answered, and tells the
// tool's page what the tool was given and answered, as an MCP App's page is told. A `one:` link to the place in the page
// shown takes it there; one to any other page opens it at the network's address, as the page's JS is the view's own.
import { named, opens, pagesOf, pathOf } from "../app/page/path.js"

/** What the edge says of where it is, read for whoever let the assistant in: the network's address, where their apps'
 * files are, the apps listed for them, the device the assistant is to the network, and the renderer's script.
 * @type {{ origin: string, apps: string, resources: { uri: string }[], device: string, renderer: string }} */
const { origin, apps, resources, device, renderer } = JSON.parse(/** @type {HTMLElement} */ (document.getElementById("router")).textContent ?? "")
const listed = pagesOf(resources)
/** @param {Record<string, unknown>} message */
const toHost = (message) => parent.postMessage({ jsonrpc: "2.0", ...message }, "*")
/// What the page hears from its client, once the renderer has started it (`heard`).
/** @type {(message: object) => void} */
let toPage = () => {}

/// The id of this page's own `ui/initialize`, which the page shown never asks by.
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
/** @type {{ hostContext?: Record<string, any>, hostCapabilities?: unknown, hostInfo?: { name?: unknown } } | undefined} */
let greeted
/// What the tool was given and answered, which its page is told.
/** @type {object | undefined} */
let input
/** @type {{ _meta?: { page?: unknown, tool?: unknown, subject?: unknown } } | undefined} */
let result
/// Whom the page shown is for, where it isn't whoever let the assistant in: the group whose app's tool was called for
/// it (its result's `_meta.subject`). Its page is that app's, and what it asks is asked for them.
/** @type {string | undefined} */
let subject
/// The page shown, `<app>/<path>`, once there is one.
/** @type {string | undefined} */
let showing

/// The assistant's light or dark and its colours and fonts, as an MCP App takes them (the SDK's `applyDocumentTheme` and
/// `applyHostStyleVariables`): a page whose colour scheme isn't its frame's is painted on the browser's own opaque
/// backdrop, which was the black around this page's words in Claude.
function styled() {
  const context = greeted?.hostContext
  if (context?.theme === "light" || context?.theme === "dark") document.documentElement.style.colorScheme = context.theme
  for (const [name, value] of Object.entries(context?.styles?.variables ?? {})) if (typeof value === "string") document.documentElement.style.setProperty(name, value)
}

/// What the page says until the renderer has drawn, in its place, and what it says where it can't: a link that opens the
/// app at the network's address, in its person's browser, which any assistant lets a page open.
const note = /** @type {HTMLElement} */ (document.getElementById("note"))
/** Says `text` where the page would be, with a link to open `app` at the network's address. @param {string} text @param {string} [app] */
function say(text, app) {
  delete document.body.dataset.drawn
  note.textContent = text
  if (app) note.append(link(`${origin}/${app}`, `Open it at ${new URL(origin).host}`))
}
/** A link to `url`, which the assistant opens. @param {string} url @param {string} text */
function link(url, text) {
  const opening = Object.assign(document.createElement("a"), { href: url, target: "_blank", textContent: text })
  opening.addEventListener("click", (event) => (event.preventDefault(), openLink(url)))
  return opening
}
/** @param {string} url */
const openLink = (url) => toHost({ id: `open-${Date.now()}`, method: "ui/open-link", params: { url } })

/** Draws `page`, `<app>/<path>`, for `whom` (`subject`): the renderer, loaded by its full address, takes this page as its
 * client. Once, as the view's JS is the page's. @param {string} page @param {string} [whom] */
function show(page, whom) {
  const [app, ...path] = page.split("/")
  subject = whom
  showing = page
  say("Opening…", app)
  // By its version, as the web client loads it (`address`): what the page loads is found beside it from there. One for
  // someone else is found by its app's name, at the address that says for whom, last part first (`notes.family.groups`).
  const version = whom ? undefined : resources.find(({ uri }) => named(uri) === page)?.uri.split("/")[3]
  const host = whom ? [app, ...whom.split("/").reverse()].join(".") : app
  const theme = greeted?.hostContext?.theme
  const at = `${origin}${apps}/${host}/${version ? `${app}@${version}` : app}/${path.join("/")}${typeof theme === "string" ? `?theme=${theme}` : ""}`
  /** @type {import("./renderer/renderer.js").Client} */
  const client = { page: at, post: fromPage, heard: (take) => void (toPage = take) }
  Object.assign(globalThis, { client })
  document.head.append(Object.assign(document.createElement("script"), { src: renderer, crossOrigin: "anonymous" }))
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
  answer(answered.error ? { id, error: answered.error } : { id, result: answered.result })
  if (method !== "tools/call" || answered.error || answered.result?.isError) return
  const whom = meta._meta?.subject ?? ""
  if (!reading.has(whom)) reading.set(whom, request(0, "tools/list", meta).then(({ result }) => new Set((result?.tools ?? []).filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name))))
  if (!(await reading.get(whom))?.has(params?.name)) answer({ method: "notifications/one/changed", params: {} })
}
/** @param {Record<string, unknown>} message */
const answer = (message) => toPage({ jsonrpc: "2.0", ...message })

addEventListener("message", ({ source, data }) => {
  if (source !== parent || typeof data !== "object" || data?.jsonrpc !== "2.0") return
  if (data.id === GREETING) {
    greeted = data.result
    styled()
    toHost({ method: "ui/notifications/initialized", params: {} })
    size()
    return
  }
  if (data.method === "ui/notifications/tool-input") input = data.params
  if (data.method === "ui/notifications/tool-result") {
    result = data.params
    const page = result?._meta?.page
    // A call that failed has no page, and says why, as a host shows a tool's text.
    const text = /** @type {{ content?: { type?: string, text?: string }[] } | undefined} */ (result)?.content?.find((item) => item.type === "text")?.text
    if (typeof page !== "string") return say(text ?? "This tool has no page to show.")
    if (!showing) return show(page, typeof result?._meta?.subject === "string" ? result._meta.subject : undefined)
  }
  if (data.method === "ui/notifications/host-context-changed" && greeted) {
    greeted = { ...greeted, hostContext: { ...greeted.hostContext, ...data.params } }
    styled()
    size()
  }
  toPage(data)
})

/** What the page says to its client. @param {any} data */
function fromPage(data) {
  // The page is greeted with what the assistant answered this one, and told what the tool was given and answered, once
  // it says it's ready, as a host tells an MCP App's. It's told which tool it shows (MCP Apps' `toolInfo`), which an
  // assistant may not say, and that it's in an assistant's chat (`assistant`), where what only its person's own device
  // may do is refused.
  if (data.method === "ui/initialize") {
    const tool = typeof result?._meta?.tool === "string" ? { toolInfo: { tool: { name: result._meta.tool } } } : {}
    return answer({ id: data.id, result: greeted && { ...greeted, hostContext: { ...tool, ...greeted.hostContext, assistant: true } } })
  }
  if (data.method === "ui/notifications/size-changed") {
    said = typeof data.params?.height === "number" ? data.params.height : undefined
    return size()
  }
  if (data.method === "ui/notifications/initialized") {
    if (input) answer({ method: "ui/notifications/tool-input", params: input })
    if (result) answer({ method: "ui/notifications/tool-result", params: result })
    return
  }
  // What a page is told of its client, as the web client tells it (`client` in host.js): this view changes nothing of
  // a device.
  if (data.method === "one/client") {
    if (Object.keys(data.params ?? {}).length) return answer({ id: data.id, error: { code: -32000, message: "An assistant's view of an app changes nothing of a device" } })
    return answer({ id: data.id, result: { device, network: origin, web: true, theme: null } })
  }
  // A `one:` link to a place in the page shown takes it there, as a native host tells its page (its host context's
  // `link`); one to another page opens it at the network's address, where the web client opens it.
  if (data.method === "ui/open-link" && typeof data.params?.url === "string" && data.params.url.startsWith("one:")) {
    const to = opens(data.params.url.slice("one:".length), listed)
    if (!to) return answer({ id: data.id, error: { code: -32000, message: "That app isn't installed" } })
    answer({ id: data.id, result: {} })
    if (to.page === showing && !subject) return answer({ method: "ui/notifications/host-context-changed", params: { link: to.fragment ?? "" } })
    return openLink(`${origin}${pathOf(to.link, [])}`)
  }
  // What the page asks the network, it asks itself, as whoever let the assistant in (`pages` in core/edge/mcp/mcp.ts):
  // it's its person's tap, which the assistant would otherwise ask them to approve, as it does what its model calls.
  if (data.id !== undefined && typeof data.method === "string" && !data.method.startsWith("ui/")) return void ask(data)
  // The renderer has drawn its page, which is shown from then; or couldn't open it, and says why, which is said here as
  // a native host's window says it.
  if (data.method === "notifications/one/seen" && "drawn" in (data.params ?? {})) document.body.dataset.drawn = ""
  if (data.method === "notifications/one/seen" && typeof data.params?.unopened === "string") say(unopened(data.params.unopened), showing?.split("/")[0])
  toHost(data)
}

/** What the page says where the renderer couldn't open it, `why`: an assistant whose chat refuses WebAssembly (its
 * Content Security Policy) is named, as what the renderer is can't run there. @param {string} why */
function unopened(why) {
  const assistant = greeted?.hostInfo?.name
  if (/Content Security Policy/i.test(why)) return `${typeof assistant === "string" ? assistant : "This assistant"} doesn't let this chat run the app's code (WebAssembly), so this app can't open here.`
  return `This app couldn't open here: ${why}`
}

toHost({ id: GREETING, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "one", version: "1" }, appCapabilities: {} } })
