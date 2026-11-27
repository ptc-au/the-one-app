// Draws the window's own page (clients/app/page) in each of its states, as its host puts it in them: `bun window.js
// [--out <dir>] [--against <dir>] [--scene <words>]` in clients/app/renderer/tests. `--against` compares each picture
// with an earlier run's, kept in that `--out`: what a change did to how the window looks, drawn before it (on main) and
// after.
//
// The page is the one the app ships (tauri.conf.json's `frontendDist`), its modules and machines as they are, in
// headless Chromium, as an Android phone's web view draws it. Only its host is a stand-in (`window.__TAURI__`): each
// scene says what the client answers (`start`, `apps`, `open_launcher`, …) and what it tells the page after (`state`,
// `launcher`), and what's pressed, as a person would, and it's drawn once it has come to rest. An app's page in a frame
// is a stand-in too, which says it has drawn, as the UI library's `render` does. Each is drawn light and dark, at a
// phone's size or a computer's as it says, and a page that logs an error fails it, as does one that isn't at rest.
import { chromium } from "playwright-core"
import { PNG } from "pngjs"
import pixelmatch from "pixelmatch"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const args = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const out = resolve(option("--out") ?? here("../../../../target/window"))
const against = option("--against") && resolve(option("--against"))
const only = option("--scene")?.toLowerCase()

/// The page's files, by the names it loads them by, as the app bundles them.
const app = here("../../")
const files = new Map(JSON.parse(readFileSync(join(app, "tauri.conf.json"), "utf8")).build.frontendDist.map((file) => [basename(file), join(app, file)]))
const TYPES = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", woff2: "font/woff2", txt: "text/plain" }

const PHONE = [390, 844]
const COMPUTER = [800, 560]
const launcher = { uri: "ui://home-screen/1/client/index.html", mimeType: "text/html;profile=mcp-app", name: "Home Screen", _meta: { category: "launcher", trusted: true, runtimeVersion: 1 } }
const notes = { uri: "ui://notes/1/client/index.html", mimeType: "text/html;profile=mcp-app", name: "Notes", _meta: { trusted: true, runtimeVersion: 1 } }
const appStore = { uri: "ui://app-store/1/client/index.html", mimeType: "text/html;profile=mcp-app", name: "App Store", _meta: { category: "app-store", trusted: true, runtimeVersion: 1 } }
/// What the client says over the page while its network doesn't answer (`Connection::banner` in core/client).
const BANNER = { offline: "Can't reach your network", reconnecting: "Reconnecting…" }
const signedIn = (connection) => ({ seq: 0, session: { state: "signedIn" }, connection, banner: BANNER[connection] })
const opening = (connection) => ({ seq: 0, session: { state: "opening" }, connection, banner: BANNER[connection] })
/// What never answers, as a server that hasn't yet.
const PENDING = { pending: true }

/// What the client answers while its network doesn't, with nothing kept.
const UNANSWERED = () => Promise.reject("Can't reach your network")
/// A computer behind the latest build, which its network says.
const BEHIND = { client: () => ({ build: "0.37.139", target: "linux" }), request: ({ params }) => {
    const answer = params?.name === "builds" ? { latest: { "one/linux": { build: "0.37.140" } } } : { seen: ["pull-home"] }
    return { structuredContent: answer, content: [{ text: JSON.stringify(answer) }] }
  },
}

/// Each state, as its host puts the page in it: `start`'s answer (a phone's has `taps`), what other commands answer
/// (a function of what they're given, or `PENDING`), the apps it lists (`listed`), what the host tells the page after
/// it starts (`tell`: `[event, payload]`), what's pressed then (by its element's id), what an app's page asks of the
/// window (`ask`: `[its app, its message]`), and the window's size.
const scenes = {
  "Opening, connecting": { start: { state: opening("connecting"), taps: true, runtimeVersion: 1 }, apps: PENDING },
  "Opening, offline": { start: { state: opening("offline"), taps: true, runtimeVersion: 1 }, apps: UNANSWERED },
  "Opening, reconnecting": { start: { state: opening("reconnecting"), taps: true, runtimeVersion: 1 }, apps: UNANSWERED },
  "Opening, offline, on a computer": { start: { state: opening("offline") }, apps: UNANSWERED, size: COMPUTER },
  "Home Screen, offline": { start: { state: signedIn("online") }, tell: [["state", signedIn("offline")]] },
  "Home Screen, reconnecting": { start: { state: signedIn("online") }, tell: [["state", signedIn("offline")], ["state", signedIn("reconnecting")]] },
  "An app, offline": { start: { state: signedIn("online"), open: "notes" }, tell: [["state", signedIn("offline")]] },
  "App Store with no Home Screen, offline": { start: { state: signedIn("online") }, listed: [appStore], press: ["open-app-store"], tell: [["state", signedIn("offline")]] },
  "No Home Screen": { start: { state: signedIn("online") }, listed: [appStore] },
  "Home Screen didn't open": { start: { state: signedIn("online"), taps: true, runtimeVersion: 1 }, open_launcher: () => Promise.reject("home-screen/client/index.html didn't draw in 15 s: no answer yet to home-screen_pages.") },
  "Home Screen stopped working": { start: { state: signedIn("online"), taps: true, runtimeVersion: 1 }, tell: [["launcher", { native: false, why: "its page's process ended", crashed: true }]] },
  "An app didn't open": { start: { state: signedIn("online"), taps: true, runtimeVersion: 1, open: "notes" }, open_window: () => Promise.reject("its window couldn't be made") },
  "An app that needs a newer One App": { start: { state: signedIn("online"), taps: true, runtimeVersion: 1, open: "notes" }, listed: [launcher, { ...notes, _meta: { ...notes._meta, runtimeVersion: 2 } }] },
  "An app that needs a newer One App, from TestFlight": { start: { state: signedIn("online"), taps: true, testflight: true, runtimeVersion: 1, open: "notes" }, listed: [launcher, { ...notes, _meta: { ...notes._meta, runtimeVersion: 2 } }] },
  "A Home Screen that needs a newer One App": { start: { state: signedIn("online"), taps: true, runtimeVersion: 1 }, listed: [{ ...launcher, _meta: { ...launcher._meta, runtimeVersion: 2 } }] },
  "Update Required, on a phone": { start: { state: signedIn("online"), taps: true, runtimeVersion: 1 }, tell: [["state", signedIn("behind")]] },
  "Update Required, on a computer": { start: { state: signedIn("online") }, tell: [["state", signedIn("behind")]], size: COMPUTER },
  "Updating": { start: { state: signedIn("online") }, tell: [["state", signedIn("behind")]], press: ["problem-button"], update: PENDING, size: COMPUTER },
  "Checking after an update": { start: { state: signedIn("online") }, ask: [["home-screen", { jsonrpc: "2.0", id: 1, method: "one/client", params: { update: true } }]], ...BEHIND, update: () => "Restarting on 0.37.140…", retry: PENDING, size: COMPUTER },
  "Couldn't update": { start: { state: signedIn("online") }, tell: [["state", signedIn("behind")]], press: ["problem-button"], update: () => Promise.reject("the download of 0.37.140 stopped at 41%"), size: COMPUTER },
  "Signing in, in an app's own window": { start: { state: { seq: 0, session: { state: "signIn" }, connection: "online", link: "about:blank" }, windows: true, window: { entrypoint: "notes/client/index.html", name: "Notes" } }, size: COMPUTER },
}

/// The stand-in host, in the page before its modules run: `start` and the rest answered as `window.scene` says, and
/// what it tells the page handed to the listeners the page has by then.
function host() {
  const scene = window.scene
  const listeners = new Map()
  const answers = {
    apps: () => ({ resources: scene.listed ?? [scene.launcher, scene.notes], outdated: [] }),
    client: () => ({}),
    // A tool's answer, as the client gives the page one: the rail's tip seen already, and nothing else it needs.
    request: ({ params }) => {
      const answer = params?.name === "home-screen_tips" ? { seen: ["pull-home"] } : {}
      return { structuredContent: answer, content: [{ text: JSON.stringify(answer) }] }
    },
    open_launcher: () => true,
    open_window: () => true,
  }
  const answer = (command, given) => {
    const said = scene.commands[command] ?? answers[command]
    if (said === "pending") return new Promise(() => {})
    if (typeof said === "string") return new Function(`return ${said}`)()(given)
    return said?.(given) ?? null
  }
  window.__TAURI__ = {
    core: {
      invoke: async (command, given) => (command === "start" ? scene.start : answer(command, given)),
      addPluginListener: async () => {},
    },
    event: {
      listen: async (event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return () => {}
      },
    },
  }
  window.tell = (event, payload) => (listeners.get(event) ?? []).forEach((listener) => listener({ payload }))
}

/// An app's page in a frame, which says it has drawn, as the UI library's `render` does once what it first asked is answered.
const framed = (name) => `<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;font:17px system-ui;color:#888;background:Canvas;color-scheme:light dark">${name}<script>parent.postMessage({ jsonrpc: "2.0", method: "notifications/one/drawn" }, "*")</script></body></html>`

mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
let failed = 0
for (const [name, scene] of Object.entries(scenes)) {
  if (only && !name.toLowerCase().includes(only)) continue
  for (const scheme of ["light", "dark"]) {
    const [width, height] = scene.size ?? PHONE
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 2, hasTouch: !scene.size })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url())
      if (url.hostname === "window.test") {
        const file = files.get(url.pathname.slice(1) || "index.html")
        if (!file) return route.fulfill({ status: 404 })
        return route.fulfill({ body: readFileSync(file), contentType: TYPES[file.split(".").pop()] })
      }
      const app = url.hostname.split(".")[1]
      return route.fulfill({ body: framed(app === "home-screen" ? "Home Screen" : app), contentType: "text/html" })
    })
    // What each command answers, as a function's source, since the page has its own realm.
    const commands = Object.fromEntries(Object.entries(scene).filter(([key]) => !["start", "tell", "press", "ask", "size", "listed"].includes(key)).map(([key, said]) => [key, said === PENDING ? "pending" : `${said}`]))
    await page.addInitScript(`window.scene = ${JSON.stringify({ start: scene.start, listed: scene.listed, launcher, notes, commands })}; (${host})()`)
    await page.goto("http://window.test/")
    // Started: its machine has its first state, and an app it was told to open is open.
    await page.waitForFunction(() => document.querySelector("#state") && document.readyState === "complete")
    await page.waitForTimeout(300)
    if (scene.start.open) await page.evaluate((link) => window.tell("open", link), scene.start.open)
    for (const [event, payload] of scene.tell ?? []) {
      await page.evaluate(([event, payload]) => window.tell(event, payload), [event, payload])
      await page.waitForTimeout(100)
    }
    for (const [app, message] of scene.ask ?? []) {
      const frame = page.frames().find((frame) => frame.url().includes(`oneapp.${app}.`))
      await frame?.evaluate((message) => parent.postMessage(message, "*"), message)
      await page.waitForTimeout(300)
    }
    for (const id of scene.press ?? []) {
      await page.locator(`#${id}`).click()
      await page.waitForTimeout(300)
    }
    // At rest: its steps and banner come in after a moment, and every fade has ended.
    await page.waitForTimeout(4000)
    const settled = await page.evaluate(() => document.getAnimations().filter((one) => one.playState === "running" && one.effect?.getComputedTiming().iterations !== Infinity).length)
    const file = join(out, `${name.replace(/[^\w]+/g, "-")}-${scheme}.png`)
    writeFileSync(file, await page.screenshot())
    let differs = ""
    const before = against && join(against, basename(file))
    if (before && existsSync(before)) {
      const [a, b] = [PNG.sync.read(readFileSync(before)), PNG.sync.read(readFileSync(file))]
      const changed = a.width === b.width && a.height === b.height ? pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 }) / (a.width * a.height) : 1
      differs = changed ? ` · ${(changed * 100).toFixed(2)}% differs from before` : " · as before"
    }
    const problems = [...errors, ...(settled ? [`${settled} animations still running`] : [])]
    if (problems.length) failed += 1
    console.log(`${problems.length ? "✗" : "✓"} ${name} (${scheme})${differs}${problems.map((problem) => `\n    ${problem}`).join("")}`)
    await page.close()
  }
}
await browser.close()
console.log(`pictures in ${out}`)
process.exitCode = failed ? 1 : 0
