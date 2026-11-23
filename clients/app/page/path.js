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
