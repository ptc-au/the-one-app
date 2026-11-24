// Where the window's address says it is, in a browser (`pathOf` in clients/web/host.js), as a web app's does.

/// The address of an app's place, which a link to it names: at the launcher `/`, and at an app `/<app>`, then the
/// place in it, `settings#vault/accounts&request=4` at `/settings/vault/accounts?request=4`, which loading it again
/// opens (`start` in clients/web/host.js). An app's page other than its first is its app's. A screen whose tool says
/// its `path` among the tools listed (`_meta.path`, `week/{start}`, as OpenAPI's paths say theirs) is at that path,
/// its arguments in it and the rest after `?`: `my-week#week&start=2026-11-23` at `/my-week/week/2026-11-23`.
/** @param {string} link @param {Tool[]} tools */
export function pathOf(link, tools) {
  const [page, fragment = ""] = link.split("#", 2)
  const [place, ...rest] = fragment.split("&")
  const app = page.split("/")[0]
  const said = new URLSearchParams(rest.join("&"))
  const shape = tools.find(({ name }) => name === `${app}_${place}`)?._meta?.path?.split("/").filter(Boolean)
  // A link that doesn't say every argument its tool's path has is at its place, as a tool with none is.
  const filled = shape?.map(argument).every((name) => !name || said.has(name))
  const parts = shape && filled ? shape.map((part) => taken(said, argument(part)) ?? part) : place.split("/")
  const query = filled ? `${said}` : rest.join("&")
  return `/${[app, ...parts].filter(Boolean).map(encodeURIComponent).join("/")}${query ? `?${query}` : ""}`
}
/** The argument a part of a tool's path is, `start` of `{start}`. @param {string} part */
const argument = (part) => /^\{(\w+)\}$/.exec(part)?.[1]
/** The value of `name` in `said`, which it's taken out of. @param {URLSearchParams} said @param {string} [name] */
function taken(said, name) {
  const value = name === undefined ? undefined : (said.get(name) ?? undefined)
  if (name) said.delete(name)
  return value
}

/// The link to the place an address is at: `pathOf`'s other way, nothing at the launcher. The tool whose `path` the
/// address is at is the one it names, the one whose path says the most of it where more than one would be.
/** @param {string} pathname @param {string} search @param {Tool[]} tools */
export function linkOf(pathname, search, tools) {
  const [app, ...place] = pathname.split("/").filter(Boolean).map(decodeURIComponent)
  const said = new URLSearchParams(search)
  if (!app) return undefined
  const matched = tools
    .flatMap(({ name, _meta }) => {
      const parts = name.startsWith(`${app}_`) && typeof _meta?.path === "string" ? _meta.path.split("/").filter(Boolean) : undefined
      if (!parts || parts.length !== place.length || !parts.every((part, at) => argument(part) || part === place[at])) return []
      return [{ tool: name.slice(app.length + 1), parts, exact: parts.filter((part) => !argument(part)).length }]
    })
    .sort((one, other) => other.exact - one.exact)[0]
  if (matched) {
    for (const [at, part] of matched.parts.entries()) if (argument(part)) said.set(/** @type {string} */ (argument(part)), place[at])
    return `${app}#${matched.tool}${said.size ? `&${said}` : ""}`
  }
  return place.length || said.size ? `${app}#${place.join("/")}${said.size ? `&${said}` : ""}` : app
}

/** A tool as the tools listed have it (MCP's `tools/list`): a screen's says its `path` (`_meta.path`). */
/** @typedef {{ name: string, _meta?: { path?: string } }} Tool */

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
