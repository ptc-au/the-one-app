// The page an assistant shows for an app's tool, as an MCP App (`core/edge/mcp/mcp.ts`): the page of the app whose tool
// it called, drawn by our renderer in its frame from the network's address (`renderer/`), as the web client draws it,
// as an MCP App's own page may not compile WebAssembly. Many tools show it, as one view, each saying which page shows
// what it answered (its result's `_meta.page`, `<app>/<path>`).
//
// It passes messages between that frame and the assistant, which calls the app's tools as whoever let it in. It's
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
/// How tall it is in an assistant's chat: a host sizes a page by what it says, and an app's says nothing of it.
const HEIGHT = 600
/// What the assistant answered this page's `ui/initialize`, once it has.
/** @type {{ hostContext?: Record<string, unknown> } | undefined} */
let greeted
/// What the tool was given and answered, which its page is told, and whether the page shown is its.
/** @type {object | undefined} */
let input
/** @type {{ _meta?: { page?: unknown } } | undefined} */
let result
let tools = false

/** Shows `page`, `<app>/<path>`, at `fragment`, the place in it, in the renderer's frame. @param {string} page @param {string} [fragment] */
function show(page, fragment) {
  const [app, ...path] = page.split("/")
  // By its version, as the web client loads it (`address`): what the page loads is found beside it from there.
  const version = resources.find(({ uri }) => named(uri) === page)?.uri.split("/")[3]
  const theme = greeted?.hostContext?.theme
  const at = `${origin}${apps}/${app}/${version ? `${app}@${version}` : app}/${path.join("/")}${typeof theme === "string" ? `?theme=${theme}` : ""}${fragment ? `#${fragment}` : ""}`
  const shown = /** @type {HTMLIFrameElement} */ (frame.cloneNode())
  shown.src = `${origin}/renderer/#${at}`
  frame.replaceWith(shown)
  frame = shown
}

addEventListener("message", ({ source, data }) => {
  if (typeof data !== "object" || data?.jsonrpc !== "2.0") return
  if (source === parent) {
    if (data.id === GREETING) {
      greeted = data.result
      toHost({ method: "ui/notifications/initialized", params: {} })
      toHost({ method: "ui/notifications/size-changed", params: { height: HEIGHT } })
      return
    }
    if (data.method === "ui/notifications/tool-input") input = data.params
    if (data.method === "ui/notifications/tool-result") {
      result = data.params
      const page = result?._meta?.page
      if (typeof page === "string") {
        tools = true
        show(page)
      }
      return
    }
    if (data.method === "ui/notifications/host-context-changed" && greeted) greeted = { ...greeted, hostContext: { ...greeted.hostContext, ...data.params } }
    toPage(data)
    return
  }
  if (source !== frame.contentWindow) return
  // A page shown is greeted with what the assistant answered this one, and the tool's is told what it was given and
  // answered, once it says it's ready, as a host tells an MCP App's.
  if (data.method === "ui/initialize") return toPage({ id: data.id, result: greeted })
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
  // The renderer's frame couldn't open its page, and says why, which is shown here as a native host's window says it.
  if (data.method === "notifications/one/seen" && typeof data.params?.unopened === "string") document.body.dataset.unopened = data.params.unopened
  toHost(data)
})

toHost({ id: GREETING, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "one", version: "1" }, appCapabilities: {} } })
