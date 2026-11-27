// What the other modules of the page share and nothing of it depends on: reporting to Telemetry, and finding the page's own elements.
import { invoke } from "./host.js"

/// Reports what went wrong here to Telemetry, through the client, which keeps it until a server can be told: what
/// this page showed its person, an error of its own or of an app's page, an app that never drew. Names, files and
/// what was shown only, never what anyone typed. What's reported before the client is open, as the app starts, is kept on the device until it is, as a browser's
/// page keeps its own (`clients/web/host.js`): it's sent with the next report the client takes, and as the page hears
/// where the client is (`sendKept`, as it opens). At most 100, the first kept.
/** @param {string} name @param {string} error @param {Record<string, unknown>} [attributes] */
export const report = (name, error, attributes = {}) => send({ name, error, attributes })
const KEPT = "reports"
/** @returns {Record<string, unknown>[]} */
function kept() {
  try {
    return JSON.parse(localStorage.getItem(KEPT) ?? "[]")
  } catch {
    // A web view may refuse its storage, or hold what isn't JSON: nothing was kept.
    return []
  }
}
/** @param {Record<string, unknown>} record */
function send(record) {
  invoke("report", { record }).then(sendKept, () => {
    const before = kept()
    try {
      if (before.length < 100) localStorage.setItem(KEPT, JSON.stringify([...before, record]))
    } catch {
      // A web view may refuse its storage (a full disk): it's lost then, with nowhere else to keep it.
    }
  })
}
/// Sends what was kept, now the client may be open: each that fails again is kept again.
export function sendKept() {
  const records = kept()
  if (!records.length) return
  localStorage.removeItem(KEPT)
  for (const record of records) send(record)
}
/// An error as OpenTelemetry's `exception` says one: its message, and the file and line it was thrown at, by its
/// path alone, which leaves out anything a query had in it, and its stack, which a browser's client puts in the
/// source it was built from (`clients/web/host.js`).
/** @param {unknown} message @param {unknown} [file] @param {unknown} [line] @param {string} [app] @param {unknown} [stack] */
export function exception(message, file, line, app, stack) {
  const path = typeof file === "string" && URL.canParse(file) ? new URL(file).pathname : undefined
  report("exception", String(message).slice(0, 500), { "code.file.path": path, "code.line.number": typeof line === "number" ? line : undefined, "exception.stacktrace": typeof stack === "string" && stack ? stack : undefined, "one.app": app })
}
addEventListener("error", ({ message, filename, lineno, error }) => exception(message, filename, lineno, undefined, error?.stack))
addEventListener("unhandledrejection", ({ reason }) => exception(reason?.message ?? reason, undefined, undefined, undefined, reason?.stack))
/** An element of the page's own, which is there. @param {string} id */
export const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id))
