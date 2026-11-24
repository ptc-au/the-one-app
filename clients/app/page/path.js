// Where the window's address says it is, in a browser (`addressed` in host.js), as a web app's does.

/// The address of an app's place, which a link to it names: at the launcher `/`, and at an app `/<app>`, then the
/// place in it, `settings#vault/accounts&request=4` at `/settings/vault/accounts?request=4`, which loading it again
/// opens (`start` in clients/web/host.js). An app's page other than its first is its app's.
/** @param {string} link */
export function pathOf(link) {
  const [page, fragment = ""] = link.split("#", 2)
  const [place, ...said] = fragment.split("&")
  const path = [page.split("/")[0], ...place.split("/").filter(Boolean)].map(encodeURIComponent).join("/")
  return `/${path}${said.length ? `?${said.join("&")}` : ""}`
}

/// The link to the place an address is at: `pathOf`'s other way, nothing at the launcher.
/** @param {string} pathname @param {string} search */
export function linkOf(pathname, search) {
  const [app, ...place] = pathname.split("/").filter(Boolean).map(decodeURIComponent)
  const said = new URLSearchParams(search)
  if (!app) return undefined
  return place.length || said.size ? `${app}#${place.join("/")}${said.size ? `&${said}` : ""}` : app
}

/// What's listed of the apps, as MCP's resources (`ui://<app>/<version>/<path>`), each named `<app>/<path>`: their
/// pages, an MCP App's kind; what each app opens first, by the app's name (the last of its pages set, and the
/// launcher's for its app, as `one:home-screen` opens it); every file; and the launcher's, Settings' and the App
/// Store's pages, by their categories.
/** @param {{ uri: string, mimeType?: string, name?: string, icons?: { src: string }[], _meta?: Record<string, any> }[]} resources */
export function pagesOf(resources) {
  const pages = resources.filter(({ mimeType }) => mimeType === "text/html;profile=mcp-app")
  const found = (/** @type {string} */ category) => {
    const uri = pages.find(({ _meta }) => _meta?.category === category)?.uri
    return uri ? named(uri) : ""
  }
  const first = new Map(pages.toReversed().map(({ uri }) => [named(uri).split("/")[0], named(uri)]))
  const launcher = found("launcher")
  if (launcher) first.set(launcher.split("/")[0], launcher)
  return { pages, first, files: new Set(resources.map(({ uri }) => named(uri))), launcher, settings: found("settings"), appStore: found("app-store") }
}

/// A file's name, `<app>/<path>`, by its resource's `ui://<app>/<version>/<path>`.
/** @param {string} uri */
export function named(uri) {
  const [app, _version, ...page] = uri.slice("ui://".length).split("/")
  return `${app}/${page.join("/")}`
}

/// What a `one:` link opens, by what it says after its scheme, `<app>[/<page>][#<fragment>]`, among what's listed
/// (`pagesOf`): its page, the place in it, and the link as it's opened. An app with no page of its own to open, or a
/// page it no longer has (a link kept from before, an older phone's), opens where its settings are, at that app (its
/// own `#<app>`). → nothing, where there's no page to open.
/** @param {string} link @param {{ first: Map<string, string>, files: Set<string>, settings: string }} listed @returns {{ page: string, fragment?: string, link: string } | undefined} */
export function opens(link, listed) {
  const [entrypoint, fragment] = link.split("#", 2)
  const page = entrypoint.includes("/") ? entrypoint : listed.first.get(entrypoint)
  const { files, settings } = listed
  if (files.size && (!page || !files.has(page)) && settings && page !== settings) return opens(`${settings}#${entrypoint.split("/")[0]}${fragment ? `&${fragment}` : ""}`, listed)
  return page ? { page, fragment, link } : undefined
}
