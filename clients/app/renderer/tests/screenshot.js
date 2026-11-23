// Draws every scene on a native host, and with `--web` on the web too, and compares them: `bun screenshot.js [<folder>…] [--scene <words>]
// [--out <dir>] [--against <dir>] [--dark] [--glass tinted|blurred] [--size <width>x<height>] [--release] [--web] [--ssh <host> --headless <its build of the
// headless renderer>]` in clients/app/renderer/tests, after `bun build.js` in core/ui, on the headless renderer it builds, or
// the one built before from the same (animation.js's `built`; `--release` for a release build's, whose timings are a shipped build's). `--against` compares each scene with an earlier run's too, kept in that
// `--out`: what a change did to how things look, drawn before it (on main) and after.
//
// A folder is the gallery (clients/app/renderer/tests/gallery, its scenes the components': `*.scenes.tsx`) or an app's (apps/<app>,
// its previews, its screens in each state, in `client/previews.json`); with none, the gallery and every app that has previews. None holds an expectation of its own: the checks here run over every one. An app's
// previews hold what each screen shows, by name, and what it's given to show it, as the tools' answers a client would
// give (record.js's answers): `{ "Inbox": { "answers": { "notifications_inbox": { … } } } }`, with any of `page` (its
// page, `client/index.html` unless said, and a link after `#`), `component` (a component its client exports, drawn alone, in
// place of a page, as another app's page draws it), `uses` (other apps whose components the page draws, as Settings draws its sections: each is built, and served beside the page as `/<app>/client/`), `opens` (on a phone's Home Screen, the app that draws each app it opens, `{ "notes": "git-repos" }`, in a window over it, as the app's own does: built as `uses` are, for motion.js), `taps` (what's done first: pressed by what each is named or
// says, or `{ role, name }`; a point pressed, `{ x, y }`; a key, `{ key }` as the web names it, with `ctrl`, `shift`, `alt`
// or `meta` held; or text typed where the keyboard is, `{ type }`), `size` (`[390, 844]`, a phone's, unless said), `wait` (ms the page runs on after its taps, before it's drawn, for a scene whose end is a state a few seconds on, as a live screen's "couldn't show this screen" is: a native host's clock is stepped by it, the web's runs it out, so both draw that state and not one on the way to it), `touch` (a finger points at it, as on a phone: true for any window narrower than COMPACT unless the scene says `false`, as a narrow computer's window is), `errors` (words of the errors it logs, as a page that can't reach its server does: any other the page logs fails the scene), `timeZone` (the IANA name of the device's, `UTC` unless said: a fixture's instants are said in it, as a person in it reads them), `latency` (ms each tool's answer takes to come on the page's clock, as a server's round trip: for checks of what shows meanwhile), and `like` (another scene's name, as Storybook's args are a
// component's: this is that scene, with its own taps, and its answers in place of that one's, tool by tool). An answer `{ "$error": "Couldn't reach it" }` is a tool's
// refusal, and `{ "$image": "data:image/png;base64,…" }` a picture, as a server answers one (MCP's `image`: a screenshot). A method of the client's (`ui/initialize`, `one/client`) is answered as it's named too. It's 1 January 2026,
// 00:00 UTC, as a native host's headless renderer has it, so a fixture's times are said from then.
//
// Each scene is drawn on a native host by its headless renderer (clients/app/renderer's `headless` example): the check
// every change runs (the `qa` skill). With `--web`, a tool for debugging the web client itself and never a routine check,
// it's drawn by our renderer in headless Chromium too, in a frame a stand-in client answers (its web frame,
// clients/web/renderer, on Chromium's WebGPU, on the machine's GPU through Vulkan), with `--ssh` on a device's GPU too, by its own build of the headless renderer (a Windows
// one's Direct3D 12, as animation.js plays there: where each node is laid out there and here, and how much of the
// pictures differs, `device.png` beside `afresh.png`, drawn the same way here), each as a picture, and natively its
// semantic tree as text (src/drawing-primitives/outline.ts) too. On the web every frame from opening the app's frame until its
// first draw must be the window's background (`opening`), light and dark. It says, scene by scene, how much of the pictures
// differs (a web picture more than 1% from its native one fails, `WEB_DIFFERS_MOST`, as does one drawn on what its frame kept
// that differs from the same drawn whole, `web-whole.png`, by more than a level, or drawn moved by whole device pixels, `web-moved-<dx>,<dy>.png`, by more than rounding, as animation.js's checks have it natively) and whether the text in sight is the same (any
// difference fails, however small the pictures'), and keeps them all in `--out` to look at. A native host that can't draw a page yet (an older runtime
// version) gives nothing, which it says. It says too how quickly the native host drew each (the headless renderer's
// `--measure`): its first frame, a frame when nothing changes, as its first field is typed in and as its first list
// scrolls, the memory drawing took and what a second window adds, to compare a change's before and after.
//
// As a page opens there, each tool's answer comes a round trip after it's asked (LATENCY_MS), but a tool's that only
// reads, which a client answers at once from what it keeps: its first content is when it's had every answer, and a
// scene whose page takes longer than OPENS_WITHIN_MS to it, as one that asks again for what an answer said or opens on
// a tool that changes something does, fails, which the exit status says.
//
// A scene a phone's width (under COMPACT) is a phone's: under a finger, in a window whose top and bottom the device keeps
// for itself (IPHONE's, unless it says its own `safeArea`), so words or a control drawn under its status bar, or under its
// home indicator but for what scrolls there, fail it. A narrow computer's window is a scene of its own, `touch: false`.
//
// Every scene is held to the rules every screen must meet (rules.js: words 4.5:1 against what's drawn behind them, a
// control's mark 3:1, nothing over anything else, rows' end controls in a column, a readable column in the middle,
// nothing cut short with room beside it, a date or a size never broken, nothing past a rounded clip), and first, the
// colours its styles give words against what they're drawn on (lint-tokens.js): a rule broken fails it, saying where.
// An app's scene on a computer is drawn again as a Mac's app window, `mac.png` (`onAMac`): its title row's title and
// whatever its page puts in that row start clear of the traffic lights, where current macOS puts them.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PNG } from "pngjs"
import { outline } from "../../../../core/ui/src/drawing-primitives/outline.ts"
import { messages } from "../../../../core/ui/src/words.ts"
import { rules } from "./rules.js"
import { lint } from "../../../../core/ui/lint-tokens.js"
import { build, built, cached, changed, COMPONENTS, decoded, differs, copied, machine, env, glass, headless, jobs, lavapipe, library, monospaced, pageFolder, panel, phone, pLimit, runThere, scenesOf as gallery, setHeadless, slot, stale, stopped, usedFolder, work } from "./animation.js"

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
/// A line that fails the run, marked ✗ after its indent, as animation.js's checks mark theirs.
const failing = (line) => {
  process.exitCode = 1
  return line.replace(/^\s*/, (indent) => `${indent}✗ `)
}
const root = here("../../../../")
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
// Its own worktree's, never a folder every agent on the machine shares, where one ran with another's UI build.
const out = resolve(option("--out") ?? join(root, "target", "screenshot"))
const dark = flag("--dark")
const onTheWeb = flag("--web")
// Chromium, which only `--web` starts, loaded only then.
const { chromium } = onTheWeb ? await import("playwright-core") : {}
// Every scene in a window this size, a phone's if it is under COMPACT and a computer's if not, where it says none of its own.
const sized = option("--size")?.split("x").map(Number)
const against = option("--against") && resolve(option("--against"))
// A device over ssh (`--ssh`, with its own build of the headless renderer, `--headless`) draws each scene too, as animation.js plays there.
const ssh = option("--ssh")
// Only the scenes whose names have these words, as animation.js's `--scene`.
const only = option("--scene")?.toLowerCase()
const folders = args.filter((arg, at) => !arg.startsWith("--") && !["--out", "--against", "--size", "--ssh", "--headless", "--scene", "--glass", "--jobs"].includes(args[at - 1])).map((folder) => resolve(folder))
const targets = folders.length ? folders : changed([here("gallery"), ...readdirSync(join(root, "apps")).map((app) => join(root, "apps", app)).filter((app) => existsSync(join(app, "client/previews.json")))])
// The runtime version the UI library needs, and the native host's: a host whose version is older draws nothing of a
// page written for this one, so there's nothing yet to compare.
const speaks = (file, pattern) => Number(readFileSync(join(root, file), "utf8").match(pattern)?.[1])
const needed = speaks("core/ui/src/drawing-primitives/renderer.ts", /export const RUNTIME_VERSION = (\d+)/)
const hosted = speaks("clients/app/renderer/src/lib.rs", /pub const RUNTIME_VERSION: u32 = (\d+)/)

if (stale()) throw new Error(stale())
setHeadless(copied(built(), out))


/// A target's scenes, each its name, page, link, answers, taps and size, and where a wheel's notch eases what it
/// scrolls (`wheel`: a motion's `eases`, at its trace's first wheel's point).
async function scenesOf(target, built) {
  if (existsSync(join(target, "client/previews.json"))) {
    const all = JSON.parse(readFileSync(join(target, "client/previews.json"), "utf8"))
    const whole = (scene) => (scene.like ? { ...whole(all[scene.like]), taps: undefined, ...scene, answers: { ...whole(all[scene.like]).answers, ...scene.answers } } : scene)
    return Object.entries(all).map(([name, scene]) => {
      const { component, uses = [], answers = {}, taps = [], size = sized ?? [390, 844], touch, timeZone = "UTC", errors, safeArea, wait = 0, checks } = whole(scene)
      const at = whole(scene).page ?? (component ? `${COMPONENTS}/${component}.html` : "client/index.html")
      const [page, link] = at.split("#")
      const eased = Object.values(whole(scene).motions ?? {}).find((motion) => motion.eases && motion.gesture?.trace)
      const wheel = eased && JSON.parse(readFileSync(join(target, "client", eased.gesture.trace), "utf8")).find((event) => event.kind === "wheel")
      return { ...phone({ name, page, link, uses, answers, taps, size, touch: sized ? undefined : touch, timeZone, errors, safeArea: sized ? undefined : safeArea, checks }), wheel, wait }
    })
  }
  // The gallery lists its own, drawn at `#scenes` by the headless renderer (animation.js).
  return (await gallery(target, built, join(out, basename(target), ".scenes"), true)).map((scene) => {
    return { ...(sized ? phone({ ...scene, size: sized, touch: undefined, safeArea: undefined }) : scene), timeZone: "UTC" }
  })
}

/// The background the real window's pages have, which its frames are painted with where they have none of their own
/// (clients/app/page/client.css's `body` and `iframe`).
const BACKGROUND = readFileSync(join(root, "core/ui/src/tokens.css"), "utf8").match(/^\s*--background:\s*(.+);/m)[1]

/// A stand-in client for a page in a frame, as the real window is (`color-scheme: light dark`, its background from the
/// theme's tokens on its page and its frames): it answers what the page asks from `answers`, as a client would. The
/// frame is the page's own, or `src`, the renderer's frame that draws it (`web`), which the test starts (`openApp`) once
/// the window alone has been seen, as an app is opened from a window that shows its background.
const host = (page, link, answers, [width, height], touch, safeArea, src = `/${page}${link ? `#${encodeURIComponent(link)}` : ""}`) => `<!doctype html><meta charset="utf-8"><style>:root{color-scheme:light dark;--background:${BACKGROUND}}html,body{margin:0;background:var(--background)}iframe{border:0;width:${width}px;height:${height}px;display:block;background:var(--background)}</style>
<script>window.openApp = () => document.body.append(Object.assign(document.createElement("iframe"), { id: "page", src: ${JSON.stringify(src)} }))</script>
<script>
const answers = ${JSON.stringify(answers)}
window.pending = 0
addEventListener("message", ({ data, source }) => {
  if (!data || data.id === undefined) return
  const reply = (body) => source.postMessage({ jsonrpc: "2.0", id: data.id, ...body }, "*")
  const own = (method) => (method in answers ? answers[method] : undefined)
  if (data.method === "ui/initialize") return reply({ result: own("ui/initialize") ?? { hostContext: { containerDimensions: { width: ${width}, height: ${height} }, deviceCapabilities: { touch: ${touch}, hover: ${!touch} }, theme: ${JSON.stringify(dark ? "dark" : "light")}${safeArea ? `, safeAreaInsets: ${JSON.stringify(insets(safeArea))}` : ""} } } })
  if (data.method === "tools/call") {
    const answer = own(data.params.name)
    if (answer === undefined || answer?.$error) return reply({ result: { isError: true, content: [{ type: "text", text: answer?.$error ?? "No answer for " + data.params.name }] } })
    const [, mimeType, image] = answer?.$image?.match(/^data:(.*?);base64,(.*)$/) ?? []
    return reply({ result: { content: [mimeType ? { type: "image", mimeType, data: image } : { type: "text", text: JSON.stringify(answer) }] } })
  }
  // A method no answer names isn't answered, as record.js's and the headless renderer's aren't.
  const answer = own(data.method)
  reply(answer === undefined ? { error: { code: -32601, message: data.method + " isn't answered here" } } : { result: answer })
})
</script>`

/// Serves a built page, what its build leaves as it is (a picture) as a server serves an app's files, the UI library, and the stand-in client around it.
function server(built, target, used) {
  const pages = new Map()
  const listener = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/host.html") return new Response(pages.get(url.searchParams.get("scene")), { headers: { "content-type": "text/html" } })
      const path = decodeURIComponent(url.pathname)
      // Each to a frame's page too, whose origin is its own, as the edge serves an app's files, the UI library and the
      // renderer's frame (`file` in core/edge/mcp/mcp.ts, clients/web/_headers).
      const cors = { headers: { "access-control-allow-origin": "*" } }
      if (path.startsWith("/renderer/")) return new Response(Bun.file(join(rendererFrame, path.slice("/renderer/".length) || "index.html")), cors)
      const [, app, client, ...rest] = path.split("/")
      if (used.has(app) && client === "client") return new Response(Bun.file(join(used.get(app), rest.join("/"))), cors)
      const file = path.startsWith("/ui/client/") ? Bun.file(join(library("client"), path.slice("/ui/client/".length))) : [join(built, path), join(target, path)].map((one) => Bun.file(one)).find((one) => one.size)
      return file?.size ? new Response(file, cors) : new Response("Not found", { status: 404 })
    },
  })
  return {
    url: (key) => `http://localhost:${listener.port}/host.html?scene=${encodeURIComponent(key)}`,
    // The renderer's frame, drawing the page at its address here.
    hostWeb: (key, scene) => pages.set(key, host(scene.page, scene.link, scene.answers, scene.size, !!scene.touch, scene.safeArea, `/renderer/?runtime=${needed}&paused#/${scene.page}${scene.link ? `#${encodeURIComponent(scene.link)}` : ""}`)),
    stop: () => listener.stop(true),
  }
}

/// The rows (`- listitem`) of a scene's semantic tree (src/drawing-primitives/outline.ts) that have no `list` or `listbox`
/// above them: each as its line.
function strayRows(tree) {
  const lines = tree.split("\n")
  const depth = (line) => line.length - line.trimStart().length
  return lines.flatMap((line, at) => {
    if (!/^\s*- listitem\b/.test(line)) return []
    for (let up = at - 1, floor = depth(line); up >= 0; up--) {
      if (depth(lines[up]) >= floor) continue
      floor = depth(lines[up])
      if (/^\s*- (list|listbox)\b/.test(lines[up])) return []
    }
    return [line.trim()]
  })
}

/// What a screen's words may not say to a person: this codebase's own, as a build error's (`entrypoint`, `runtime_version`,
/// a file and its line), an error's code (JSON-RPC's `-32601`, a system's `ECONNREFUSED`, Erlang's `{:error, :timeout}`,
/// an HTTP status, an exception's name, `TypeError`), or a tool's name (`computer-use_screenshot`, as a tool that didn't
/// answer says it), which belong in Telemetry and to the agents. Each line of a scene's semantic tree that says one.
const INTERNAL = /entrypoint|runtime_version|\.[mc]?[jt]sx?:?\(?\d+[,:]\d+|\berror: /i
const CODE = /(^|[^\d])-32\d{3}\b|\bE(CONN[A-Z]+|NOENT|TIMEDOUT|HOSTUNREACH|NETUNREACH|ADDRINUSE|PIPE|ACCES|PERM)\b|\{:error\b|:(econnrefused|nxdomain|timeout|closed|enoent)\b|\b(HTTP|status) [1-5]\d\d\b|\b[A-Z][a-z]+([A-Z][a-z]+)*Error\b/
function internalWords(tree) {
  return tree.split("\n").filter((line) => INTERNAL.test(line) || CODE.test(line) || line.match(/[\w-]+_\w+/g)?.some((word) => tools.has(word))).map((line) => line.trim())
}

/// What a screen's words may not get wrong in English, whatever the data: a count of one with a plural noun after it
/// ("1 calls failed", "Pressed 1 times": `plural` in the UI library says it by `Intl.PluralRules`), and a word run into
/// the next, a lowercase one into a capitalised one ("used byBackups", as a join drops the space between a text and an
/// app's name). Each line of a scene's semantic tree that has one.
const ONE_PLURAL = /(?<![\w.,:/#$%-])1 [A-Za-z]{2,}s(?<![su]s|is)\b(?!['’])/
const RUN_TOGETHER = /\b[a-z]{2,}[A-Z][a-z]{2,}\b/
function misreadWords(tree) {
  return tree.split("\n").filter((line) => ONE_PLURAL.test(line) || RUN_TOGETHER.test(line)).map((line) => line.trim())
}

/// Presses what's named or says `name` on our renderer's canvas, as a person would: found in its ARIA tree
/// (clients/web/renderer/semantics.js), scrolled into sight where it isn't as a screen reader has the browser do it,
/// which the renderer reveals as the headless renderer's tap does (`Screen::reveal`: whole, with 16 points below it),
/// and pressed where it's drawn then.
async function press(frame, name) {
  const page = frame.page()
  if (name.key) return page.keyboard.press([...["ctrl", "shift", "alt", "meta"].filter((held) => name[held]).map((held) => ({ ctrl: "Control", shift: "Shift", alt: "Alt", meta: "Meta" })[held]), name.key].join("+"))
  if (name.type) return page.keyboard.type(name.type)
  const at = await page.locator("#page").boundingBox()
  if (name.x !== undefined) return page.mouse.click(at.x + name.x, at.y + name.y)
  const found = typeof name === "object" ? frame.getByRole(name.role, { name: name.name, exact: true }).first() : frame.locator(`#semantics [aria-label="${name.replaceAll('"', '\\"')}"], #semantics :text-is("${name.replaceAll('"', '\\"')}")`).last()
  let box = await found.boundingBox({ timeout: 5000 }).catch(() => null)
  const out = (/** @type {any} */ box) => box.y < at.y || box.y + box.height > at.y + at.height
  if (box && out(box)) {
    // The browser says it scrolled in its next frame, which the renderer then reveals, and the tree's drawn where it's
    // revealed to a frame or two later: it's pressed once it's there and settled, as Playwright's click waits for what
    // it clicks to be in view.
    const frames = () => frame.evaluate(() => new Promise((shown) => /** @type {any} */ (globalThis).inspector.frame(() => /** @type {any} */ (globalThis).inspector.frame(shown))))
    await found.scrollIntoViewIfNeeded({ timeout: 5000 })
    for (let tries = 0; box && out(box) && tries < 60; tries++) {
      await frames()
      box = await found.boundingBox({ timeout: 5000 }).catch(() => null)
    }
    await frame.evaluate((deadline) => /** @type {any} */ (globalThis).inspector.settle(deadline), HANGS_AFTER_MS)
    await frames()
    box = await found.boundingBox({ timeout: 5000 }).catch(() => null)
  }
  if (!box) throw new Error(`Nothing named or saying "${typeof name === "object" ? name.name : name}" to press`)
  // Its box is the page's, the frame's place in it already in it.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/// The web half waits for what a scene's page has pending (a picture decoding, a frame, a transition), however long a loaded
/// machine takes to draw it on the CPU (SwiftShader): its picture is of what it came to rest on, never of a moment on the
/// way there. This is only for a page that hangs, which fails the scene, saying what's pending.
const HANGS_AFTER_MS = 120000
/// A scene's whole web half (its taps, each pictured, its text) that takes longer than this hung.
const WEB_HANGS_AFTER_MS = 10 * 60000

/// What shows from the moment an app is opened until it has drawn is the window's own background, `[r, g, b]`, in light and
/// dark, so opening an app never flashes (a frame whose document is light in a dark window is painted white by the browser
/// until its own styles are there). `frames` is each frame the browser showed from the opening until the app's first draw.
/// → what the first frame that isn't the window's shows, or nothing.
function opening([r, g, b], frames) {
  for (const [at, frame] of frames.entries()) {
    for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
      const [pr, pg, pb] = frame.data.subarray(pixel * 4, pixel * 4 + 3)
      if (Math.max(Math.abs(pr - r), Math.abs(pg - g), Math.abs(pb - b)) > 2) {
        return `frame ${at + 1} of the app opening shows rgb(${pr}, ${pg}, ${pb}) at ${pixel % frame.width},${Math.floor(pixel / frame.width)}, where the window's own background, rgb(${r}, ${g}, ${b}), is all there is to show until its first draw`
      }
    }
  }
}

/// A scene drawn by our renderer on the web, in headless Chromium's WebGPU, as `web.png`, once its first frame is drawn
/// and what moves as it opens has settled, on the headless renderer's clock, language and time zone, each tap pressed
/// through its ARIA tree.
async function web(browser, serve, key, scene, folder) {
  const page = await browser.newPage({ viewport: { width: scene.size[0], height: scene.size[1] }, deviceScaleFactor: 2, hasTouch: scene.touch, colorScheme: dark ? "dark" : "light", locale: "en-US", timezoneId: scene.timeZone })
  const problems = []
  // What the page logs fails it but for the errors the scene says it logs (`errors`), as the headless renderer's `--errors`.
  const logged = (text) => {
    if (scene.errors?.some((words) => text.includes(words))) return
    problems.push(failing(text))
  }
  page.on("pageerror", (error) => logged(String(error)))
  // Warnings that aren't the page's: a preload Chrome saw unused within a few seconds of the page's load, as long as a
  // busy machine's Chromium takes to start the frame's renderer, which does use it.
  const notThePage = ["preferred by this device", "preloaded using link preload but not used within a few seconds"]
  page.on("console", (message) => message.type() === "warning" && !notThePage.some((words) => message.text().includes(words)) && logged(message.text()))
  await page.clock.setFixedTime(new Date(Date.UTC(2026, 0, 1)))
  // The first fetch of each picture file fails on the network, as a loaded or flaky connection's does: a picture is tried
  // again, and drawn when it comes, never left broken for a failure that passed.
  const failed = new Map()
  await page.route(/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/, (route) => {
    const url = route.request().url()
    failed.set(url, (failed.get(url) ?? 0) + 1)
    return failed.get(url) === 1 ? route.abort("connectionreset") : route.continue()
  })
  // Every frame the browser shows from the window alone until the app's first draw, as a person sees them open it: the
  // frame's own page says it has drawn (`data-drawn`, renderer.js), and the frames shown before it say what's on screen
  // meanwhile.
  const seen = []
  let before
  await page.exposeFunction("firstDrawn", () => (before ??= seen.length))
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if ("drawn" in document.documentElement.dataset) /** @type {any} */ (globalThis).firstDrawn()
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-drawn"] })
  })
  serve.hostWeb(`${key} (web)`, scene)
  await page.goto(serve.url(`${key} (web)`))
  const screen = await page.context().newCDPSession(page)
  screen.on("Page.screencastFrame", ({ data, sessionId }) => {
    seen.push(PNG.sync.read(Buffer.from(data, "base64")))
    screen.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
  })
  await screen.send("Page.startScreencast", { format: "png", maxWidth: scene.size[0], maxHeight: scene.size[1] })
  // What the window shows alone, its background as a canvas reads the colour its page's styles give it, and the frames
  // from the moment the app is opened.
  const [r, g, b] = await page.evaluate(() => {
    const canvas = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true })
    canvas.fillStyle = getComputedStyle(document.body).backgroundColor
    canvas.fillRect(0, 0, 1, 1)
    return canvas.getImageData(0, 0, 1, 1).data
  })
  while (!seen.length) await page.waitForTimeout(20)
  const opened = seen.length
  await page.evaluate(() => /** @type {any} */ (globalThis).openApp())
  const frame = await (await page.waitForSelector("#page")).contentFrame()
  const drawn = await frame.waitForFunction(() => "drawn" in document.documentElement.dataset, null, { timeout: HANGS_AFTER_MS }).then(() => true, () => false)
  await screen.send("Page.stopScreencast")
  const flash = drawn && opening([r, g, b], seen.slice(opened, before))
  if (flash) seen.slice(opened, before).forEach((f, i) => writeFileSync(join(folder, `opening-${i}.png`), PNG.sync.write(f)))
  if (flash) problems.push(failing(flash))
  // Each picture is taken once the renderer says nothing is pending, as the headless renderer's `settle`, and the frame
  // it drew last is on the screen.
  const settled = async () => {
    const { settled, pending } = await frame.evaluate((deadline) => /** @type {any} */ (globalThis).inspector.settle(deadline), HANGS_AFTER_MS)
    if (!settled) {
      problems.push(failing(`it hadn't settled after ${HANGS_AFTER_MS} ms: ${JSON.stringify(pending)}`))
    }
    await frame.evaluate(() => new Promise((shown) => /** @type {any} */ (globalThis).inspector.frame(() => /** @type {any} */ (globalThis).inspector.frame(shown))))
  }
  // Its clock is paused at 0 as it opens (`paused`), and stepped a second after it's drawn and after each tap, as the
  // headless renderer's is, so what moves by itself (a spinner, a caret's blink) is where the same steps put it on every
  // run, however long a loaded machine took to draw each frame: it was where the real time since it opened had it.
  const step = () => frame.evaluate(() => /** @type {any} */ (globalThis).inspector.clock({ step: 1000 }))
  if (drawn) await settled().then(step).then(settled)
  for (const name of drawn ? scene.taps : []) await press(frame, name).then(settled).then(step).then(settled)
  // The page's own time runs on here, as a native host's clock is stepped by it: a state that comes in seconds is there.
  if (drawn && scene.wait) {
    await page.waitForTimeout(scene.wait).then(settled)
    for (let seconds = 0; seconds < Math.ceil(scene.wait / 1000); seconds++) await step()
    await settled()
  }
  for (const [url, times] of failed) {
    if (times > 1) continue
    problems.push(failing(`${url} failed on the network once and wasn't fetched again, so it's drawn broken`))
  }
  // Its page's clock is paused for the pictures that follow, so they're of one time, as the headless renderer's are: on
  // the web's own clock a caret blinked between the frame drawn on what it kept and the one drawn whole (L77).
  const paused = drawn && (await frame.evaluate(() => /** @type {any} */ (globalThis).inspector.clock({ pause: true })))
  // Each picture is of what the browser shows once the frame drawn last is on it: on a GPU, Chrome composites the
  // page's WebGPU canvas a frame or more after it was drawn, past the two frames `settled` waits, so the picture is
  // taken again until two in a row are the same, as Playwright's `toHaveScreenshot` waits for. The clock is paused,
  // so only a frame shown late can change it.
  const picture = async (name) => {
    let shown = await page.screenshot()
    for (let tries = 0; tries < 10; tries++) {
      const again = await page.screenshot()
      if (again.equals(shown)) break
      shown = again
    }
    writeFileSync(join(folder, name), shown)
  }
  if (drawn) await picture("web.png")
  // The frame drawn on what it kept from the frames before is the one drawn whole, within a level, as the headless renderer
  // checks each frame of each motion (`unlike_whole`), where nothing on it moves (a spinner turns between pictures).
  if (drawn) await settled().then(() => picture("web-again.png"))
  if (drawn && !levels(join(folder, "web.png"), join(folder, "web-again.png"))) {
    await frame.evaluate(() => /** @type {any} */ (globalThis).inspector.whole())
    await settled()
    await picture("web-whole.png")
    const unlike = levels(join(folder, "web.png"), join(folder, "web-whole.png"))
    if (unlike) {
      problems.push(failing(`its frame differs from the same drawn whole (web-whole.png) in ${unlike.differ} pixels, by up to ${unlike.most} levels`))
    }
  }
  // Drawn moved by whole device pixels, it's the same moved, as natively (animation.js's checks): each way in turn, then
  // drawn where it is again.
  if (drawn) {
    // Drawn whole where it is first, as the moved ones are, so what a frame drawn on what it kept may differ by isn't in it.
    await frame.evaluate(() => /** @type {any} */ (globalThis).inspector.whole())
    await settled()
    await picture("web-here.png")
    for (const by of WEB_MOVED) {
      const glass = await frame.evaluate((by) => /** @type {any} */ (globalThis).inspector.moved(...by), by)
      await settled()
      const file = join(folder, `web-moved-${by.join(",")}.png`)
      await picture(basename(file))
      const unlike = unmoved(join(folder, "web-here.png"), file, by, glass)
      if (unlike) {
        problems.push(failing(`drawn moved by ${by.join(",")} px (${basename(file)}) it differs in ${unlike.differ} pixels, by up to ${unlike.most} levels, from ${unlike.box}`))
      }
    }
    await frame.evaluate(() => /** @type {any} */ (globalThis).inspector.moved(0, 0))
    await settled()
  }
  // And it stood still while they were taken, so what they show is of one time.
  const after = drawn && (await frame.evaluate(() => /** @type {any} */ (globalThis).inspector.clock({})))
  if (paused && after?.time !== paused.time) problems.push(failing(`its page's clock ran on from ${paused.time} to ${after?.time} ms while it was pictured, paused, so its pictures aren't of one time`))
  // What its screen reader reads: each text and name in sight (the native query's), and all of them, as the native tree's
  // are checked for words that aren't a person's.
  const { words, names } = drawn
    ? await frame.evaluate(
      (edge) => {
        const nodes = [...document.querySelectorAll("#semantics *")]
        const inside = (/** @type {Element} */ node) => {
          const box = node.getBoundingClientRect()
          // A node with no box (one the screen didn't place) is at its parent's origin with no size, and a hairline's worth
          // (the keys' unseen field) isn't read. A text is in sight when all of it is.
          if (box.width <= 2 || box.height <= 2) return false
          return node.children.length ? box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight : box.left >= edge && box.top >= edge && box.right <= innerWidth - edge && box.bottom <= innerHeight - edge
        }
        const named = (/** @type {Element} */ node) => (node.localName === "span" ? node.textContent : node.getAttribute("aria-label")) ?? ""
        return { words: nodes.filter((node) => named(node) && inside(node)).map(named), names: nodes.map(named).filter(Boolean) }
      },
      EDGE,
    )
    : { words: [], names: [] }
  if (drawn) writeFileSync(join(folder, "web-text.txt"), words.join("\n") + "\n")
  // Its clock runs again once what's read of it is, where a wheel's ease needs it (`notched`): read with it running, a
  // sheet that slid in as the clock moved on was where it was between two runs' reads.
  if (drawn) await frame.evaluate(() => /** @type {any} */ (globalThis).inspector.clock({ pause: false }))
  // The texts a scene's checks say are code (`expect.monospace`) advance as one monospace face does in the web's inspector
  // too, as the native check has it: the web draws them in the same face, bundled with it, and not the browser's own.
  const code = [...new Set(Object.values(scene.checks ?? {}).flat().flatMap((step) => step?.expect?.monospace ?? []))]
  const spaced = drawn && code.length ? monospaced((await frame.evaluate(() => /** @type {any} */ (globalThis).inspector.query({ text: "" }))).nodes, code) : undefined
  if (spaced) {
    problems.push(failing(`its code: ${spaced}`))
  }
  const jumped = drawn && scene.wheel && (await notched(page, frame, scene.wheel))
  if (jumped?.note) problems.push(jumped.note)
  else if (jumped) {
    problems.push(failing(jumped))
  }
  await page.close()
  return drawn ? { problems, internal: internalWords(names.join("\n")), words, all: names } : { missing: `it drew nothing${problems.length ? `: ${problems.join("; ")}` : ""}`, error: true }
}

/// A mouse wheel's notch turned at `at`, as Chrome gives one (CDP's: pixels, marked a notch only by its legacy
/// `wheelDelta` of 120), which eases what it scrolls, as natively (a motion's `eases`): where the nodes of the ARIA tree
/// are, frame by frame over the second after it, what moved furthest hasn't moved all of the notch within a tenth of a
/// second of it, which an ease's spring takes longer than. One whose first move came later than that can't tell (a frame
/// SwiftShader, on the CPU, took long to draw), and is turned again, up to three times. → what's wrong, if it is.
async function notched(page, frame, at) {
  const box = await page.locator("#page").boundingBox()
  await page.mouse.move(box.x + at.x, box.y + at.y)
  for (let turns = 0; turns < 3; turns++) {
    // What the turn before moved has come to rest, so this one's moves are its own.
    await frame.evaluate((deadline) => /** @type {any} */ (globalThis).inspector.settle(deadline), HANGS_AFTER_MS)
    const watched = frame.evaluate(
      () =>
        new Promise((done) => {
          const where = () => new Map([...document.querySelectorAll("#semantics [aria-label], #semantics span")].map((node) => [node, node.getBoundingClientRect().y]))
          let [before, turned] = [where(), Infinity]
          addEventListener("wheel", (event) => (turned = Math.min(turned, event.timeStamp)), { capture: true, passive: true, once: true })
          const moves = []
          const since = performance.now()
          let frames = 0
          const frame = (/** @type {number} */ at) => {
            frames++
            const now = where()
            const by = [...now].reduce((most, [node, y]) => (before.has(node) && Math.abs(y - before.get(node)) > Math.abs(most) ? y - before.get(node) : most), 0)
            if (by) moves.push({ after: at - turned, by })
            before = now
            at - since < 1000 ? /** @type {any} */ (globalThis).inspector.frame(frame) : done({ moves, frames })
          }
          /** @type {any} */ (globalThis).inspector.frame(frame)
        }),
    )
    await page.mouse.wheel(0, 100)
    const { moves, frames } = await watched
    const all = Math.abs(moves.reduce((sum, move) => sum + move.by, 0))
    if (all < 1 || frames < 30) continue
    if (moves[0].after >= 100) continue
    return Math.abs(moves[0].by) >= all - 0.5 ? `a wheel's notch moved it ${all.toFixed(0)} px all at once, ${moves[0].after.toFixed(0)} ms after it, where it eases natively` : undefined
  }
  return { note: "a wheel's notch was turned 3 times and each time the page drew too few frames, or moved nothing within a tenth of a second, to tell whether it eased" }
}

// A round trip to a server, as a live network's take, and how soon a page opened should show its first content.
const LATENCY_MS = 150
const OPENS_WITHIN_MS = 300

// Every app's tools, named as a client calls them (`<app>_<tool>`), as each app's `tools/0` says, and those a client
// answers from what it keeps as a page opens: those that only read, as those and One Core's own definitions say
// (`read_only: true`).
const { tools, kept } = (() => {
  const [tools, kept] = [new Set(), new Set()]
  const read = (file, prefix) => {
    const text = readFileSync(file, "utf8")
    const named = [...text.matchAll(/name: "([\w-]+)"/g)]
    named.forEach((match, at) => {
      if (prefix) tools.add(prefix + match[1])
      if (/read_only: true/.test(text.slice(match.index, named[at + 1]?.index ?? text.length))) kept.add(prefix + match[1])
    })
  }
  read(join(root, "core/server/lib/one_core/tools/definitions.ex"), "")
  for (const app of readdirSync(join(root, "apps"))) {
    const server = join(root, "apps", app, "server")
    if (existsSync(server)) for (const file of readdirSync(server, { recursive: true })) if (String(file).endsWith(".ex")) read(join(server, String(file)), `${app}_`)
  }
  return { tools, kept: [...kept] }
})()

/// The headless renderer run with `asked`, once a slot of `jobs` is free (animation.js's `--jobs`). → its exit
/// status, stdout and stderr.
const headlessRun = (asked) => slot(() => work(headless, asked, env))
/// The same, drawn by any worktree on the machine before where all it's given was the same, its `outputs` kept for
/// them (`cached`).
const keptRun = (asked, outputs) => slot(() => cached(headless, asked, env, outputs, (args) => work(headless, args, env)))

/// A scene drawn by a native host's headless renderer, or nothing where it hasn't been built or can't draw the page.
/// `again` draws it a second time, only to be compared with the first: afresh, never kept, without what only the first
/// is judged by (how quickly it drew, `--measure`, and the rules).
async function native(built, scene, folder, again = false) {
  if (hosted < needed) return { missing: `the native host's runtime version is ${hosted}, the UI library needs ${needed}: nothing to compare until it's ${needed}` }
  const at = pageFolder(built, scene.page, folder, scene.uses)
  const answers = { ...scene.answers, "ui/initialize": scene.answers["ui/initialize"] ?? { hostContext: { link: scene.link, containerDimensions: { width: scene.size[0], height: scene.size[1] }, deviceCapabilities: { touch: scene.touch, hover: !scene.touch } } } }
  writeFileSync(join(folder, "answers.json"), JSON.stringify(answers))
  // The headless renderer's clock stands still, so what moves as the page opens and after each tap is moved on to where it
  // settles, as the DOM's is, and what's laid out once it's drawn (onLayout) is drawn again.
  // With a device to draw it too, each ends at rest with where every node is and a picture drawn afresh, to compare.
  // With a plain tint for glass (`--glass tinted`), the scene drawn whole runs no blur: its `profile` says what's drawn.
  const steps = [{ op: "clock", step: 1000 }, ...scene.taps.flatMap((tap) => [tap.key ? { op: "key", ...tap } : tap.type ? { op: "type", text: tap.type } : { op: "tap", ...(typeof tap === "object" ? tap : { name: tap }) }, { op: "clock", step: 1000 }]), ...Array.from({ length: Math.ceil(scene.wait / 1000) }, () => ({ op: "clock", step: 1000 })), ...(glass === "tinted" ? [{ op: "profile", at: [0], snap: false }] : []), { op: "query" }, { op: "query", frames: true }, ...(ssh ? DRAWN : [])]
  const requests = steps.map((request, at) => JSON.stringify({ v: 1, id: at + 1, ...request })).join("\n")
  writeFileSync(join(folder, "requests.jsonl"), requests)
  const asked = [at, join(folder, "native.png"), join(folder, "native.json"), "--ui", library("client"), "--answers", join(folder, "answers.json"), "--size", `${scene.size[0]}x${scene.size[1]}`, "--scale", "2", ...(again ? [] : ["--measure"]), "--latency", String(LATENCY_MS), "--cached", kept.join(","), ...(dark ? ["--dark"] : []), ...(scene.touch ? ["--touch"] : []), ...(scene.errors ? ["--errors", JSON.stringify(scene.errors)] : []), ...(scene.safeArea ? ["--safe-area", scene.safeArea.join(",")] : []), "--time-zone", scene.timeZone, "--requests", join(folder, "requests.jsonl"), ...panel(scene)]
  const run = await (again ? headlessRun(asked) : keptRun(asked, [join(folder, "native.png"), join(folder, "native.json")]))
  if (run.exitCode !== 0 || !existsSync(join(folder, "native.json"))) return { missing: stopped(run.exitCode) ?? (run.stderr.trim().split("\n").at(-1) || "the headless renderer drew nothing"), error: true }
  const nodes = JSON.parse(readFileSync(join(folder, "native.json"), "utf8"))
  // Its tree: each node's role, name and what it is (its states, by ARIA's names, beside them), and its words.
  const semantic = ({ id, role, name, children = [], actions, states = {}, ...more }) =>
    role === "text" ? { text: name ?? "", states: {}, children: [] } : { role: role ?? undefined, name: name ?? undefined, states: Object.fromEntries(Object.entries({ ...more, ...states }).map(([state, value]) => [state, String(value)])), children: children.map(semantic) }
  const tree = outline({ states: {}, children: (Array.isArray(nodes) ? nodes : [nodes]).map(semantic) })
  writeFileSync(join(folder, "native.txt"), tree)
  writeFileSync(join(folder, "native-answers.jsonl"), run.stdout)
  const measured = run.stderr.match(/^measured (.*)$/m)
  const said = answered(run.stdout)
  const after = ssh ? DRAWN.length : 0
  const drew = glass === "tinted" ? said.at(-after - 3)?.result?.frames?.[0]?.work : undefined
  const blurring = drew && (drew.backdrops > 0 || drew.blurs > 0 || drew.blurred > 0) ? `glass drawn tinted still blurs: ${drew.backdrops} backdrop pixels, ${drew.blurs} blur passes` : undefined
  const queried = said.at(-after - 2)?.result?.nodes ?? []
  const unsafe = scene.safeArea && underTheDevice(said.at(-after - 1)?.result?.nodes ?? [], scene.size[1], insets(scene.safeArea))
  const squeezed = squeezedWords(queried, scene.size[0])
  const overflowing = overflowingWords(queried, scene.size[0])
  const allNodes = said.at(-after - 1)?.result?.nodes ?? []
  writeFileSync(join(folder, "native-nodes.json"), JSON.stringify(allNodes))
  const broken = !again && existsSync(join(folder, "native.png")) ? rules(allNodes, join(folder, "native.png"), scene.size, `${basename(dirname(folder))} · ${scene.name}`) : []
  // The words in sight, as the last frame drew them: each text and name of the semantic tree whose node, or the nearest
  // above it the inspector knows (a text in a line, a page in a frame), has some of its box in the window and isn't
  // see-through.
  // A text is in sight when all of it is, and clear of the window's edge (EDGE points), as one cut by it or touching it may
  // or may not be read there.
  const [width, height] = scene.size
  const clear = (rect) => rect.x >= EDGE && rect.y >= EDGE && rect.x + rect.width <= width - EDGE && rect.y + rect.height <= height - EDGE
  const seen = new Map(queried.map((node) => [node.node, node.opacity > 0 ? (node.rect && !clear(node.rect) && node.seen >= 0.99 ? 0.5 : node.seen) : 0]))
  const inSight = (list, above = true) => list.flatMap((node) => {
    const known = seen.get(node.id)
    const here = known === undefined ? above : (node.children?.length ? known > 0 : known >= 0.99)
    return [...(here && node.name ? [node.name] : []), ...inSight(node.children ?? [], here)]
  })
  // And the pieces of a line (raw text), which the inspector places but doesn't say are seen: those in the window.
  const pieces = queried.filter((node) => node.kind === "raw-text" && node.name && node.rect && node.rect.width > 0 && clear(node.rect)).map((node) => node.name)
  const words = [...inSight(Array.isArray(nodes) ? nodes : [nodes]), ...pieces]
  // Every word of the tree, in sight or not.
  const every = (list) => list.flatMap((node) => [...(node.name ? [node.name] : []), ...every(node.children ?? [])])
  const all = [...every(Array.isArray(nodes) ? nodes : [nodes]), ...queried.filter((node) => node.kind === "raw-text" && node.name).map((node) => node.name)]
  writeFileSync(join(folder, "native-text.txt"), words.join("\n") + "\n")
  return { kept: run.kept, tree, words, all, measured: measured && JSON.parse(measured[1]), unsafe, squeezed, overflowing, broken, blurring, answers: said, at, asked, requests }
}

/// A panelled scene (a computer's launcher, over the system's glass) drawn natively again as a plain window, `window.png`,
/// which is what the web's tab is: the web has no system glass, so its page draws its own glass and shadows, as a native
/// window does. → that picture (`native.png` where the scene is a window already), or why it isn't drawn.
async function windowed(drawn, scene, folder) {
  const flags = panel(scene)
  if (!flags.length) return { picture: join(folder, "native.png") }
  const asked = [drawn.asked[0], join(folder, "window.png"), join(folder, "window.json"), ...drawn.asked.slice(3, -flags.length).filter((flag) => flag !== "--measure")]
  const run = await headlessRun(asked)
  if (run.exitCode !== 0 || !existsSync(join(folder, "window.png"))) return { missing: stopped(run.exitCode) ?? (run.stderr.trim().split("\n").at(-1) || "the headless renderer drew nothing") }
  return { picture: join(folder, "window.png") }
}

/// A Mac's app window's title row, as the app opens one (clients/app/src/native `BAR`), and how far after the traffic
/// lights what's in it starts at least: about the 9 points between the lights themselves, nearer than which it reads
/// as on top of them (Settings' title, 2 points after the zoom button on macOS 27, 23 Nov).
const TITLE_ROW = 52
const LIGHTS_CLEAR = 8

/// An app's scene on a computer drawn natively again as a Mac's app window has it, `mac.png`: its app's name in a title
/// row, after the traffic lights the fake platform's window says it has where current macOS puts them. Neither its
/// title nor anything of its page in that row (its top bar's words and controls, the `?` at its end) starts before
/// they end and a gap. A phone's, a panel's (the launcher's) and a component's, drawn in another app's window, have
/// none. → what's wrong, a line each.
async function onAMac(drawn, scene, folder, app) {
  if (app === "gallery" || drawn.missing || scene.touch || panel(scene).length || scene.page.startsWith(COMPONENTS)) return []
  const lines = drawn.requests.split("\n")
  writeFileSync(join(folder, "mac-requests.jsonl"), [...lines, JSON.stringify({ v: 1, id: lines.length + 1, op: "window" })].join("\n"))
  const [at, , , ...rest] = drawn.asked
  const flags = rest.flatMap((arg, n) => (arg === "--measure" || ["--safe-area", "--requests"].includes(arg) || ["--safe-area", "--requests"].includes(rest[n - 1]) ? [] : [arg]))
  const name = app.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ")
  const asked = [at, join(folder, "mac.png"), join(folder, "mac.json"), ...flags, "--requests", join(folder, "mac-requests.jsonl"), "--safe-area", `${TITLE_ROW},0,0,0`, "--title", name]
  const run = await keptRun(asked, [join(folder, "mac.png"), join(folder, "mac.json")])
  const said = answered(run.stdout)
  const window = said.at(-1)?.result
  if (run.exitCode !== 0 || !window) return [`it drew nothing: ${stopped(run.exitCode) ?? run.stderr.trim().split("\n").at(-1)}`]
  if (window.lights == null) return ["its window said nothing of its traffic lights"]
  const clear = window.lights + LIGHTS_CLEAR
  const wrong = []
  if (!window.title) wrong.push("its title wasn't drawn")
  else if (window.title.x < clear) wrong.push(`its title starts at x ${window.title.x}, ${Math.round(clear - window.title.x)} pt short of ${LIGHTS_CLEAR} pt after the traffic lights, which end at ${window.lights}`)
  const nodes = said.findLast((answer) => answer.result?.nodes)?.result.nodes ?? []
  for (const node of nodes) {
    const { rect } = node
    if (!rect || !(node.opacity > 0) || !(node.seen > 0) || !(node.kind === "text" || node.actions) || rect.width >= scene.size[0] - 1) continue
    if (rect.y < TITLE_ROW && rect.y + rect.height > 0 && rect.x < clear && rect.x + rect.width > 0)
      wrong.push(`"${node.name ?? node.role ?? node.kind}" is drawn in the title row from x ${Math.round(rect.x)}, ${Math.round(clear - rect.x)} pt short of ${LIGHTS_CLEAR} pt after the traffic lights, which end at ${window.lights}`)
  }
  return wrong
}

const insets = ([top, right, bottom, left]) => ({ top, right, bottom, left })
/// What a phone draws over a window's words and controls (the headless renderer's `query` of every node, at rest): each drawn under
/// its status bar, or under its home indicator unless it's in what scrolls, which goes under it as UIKit's scroll views'
/// content does. Under the status bar, what's scrolled there is meant to be, as under a bar, and so is what covers the
// whole window, as a menu's backdrop that closes it does. → what's wrong, a line each.
function underTheDevice(nodes, height, { top, bottom }) {
  // A page's nodes have its own ids (`in` says which frames it's in), so each page is read by itself, a frame's with
  // what's around its frame.
  const pages = Map.groupBy(nodes, (node) => JSON.stringify(node.in ?? []))
  const read = (path, outside) => {
    const here = pages.get(JSON.stringify(path)) ?? []
    const byId = new Map(here.map((node) => [node.node, node]))
    const parent = new Map(here.flatMap((node) => (node.children ?? []).map((child) => [child, node])))
    const above = (node) => {
      const all = []
      for (let up = parent.get(node.node); up; up = parent.get(up.node)) all.push(up)
      return [...all, ...outside]
    }
    // What scrolls: a scroll view, or the window itself where what's in it is taller, as a browser's document is; and
    // whether it's scrolled, where what's in the one starts above it, or the other's top is above the window's.
    const scrolls = (node) => node.kind === "scroll" || (!parent.has(node.node) && node.rect?.height > height + 0.5)
    const scrolled = (node) => (node.kind === "scroll" ? (node.children ?? []).some((child) => byId.get(child)?.rect?.y < node.rect.y - 0.5) : node.rect.y < -0.5)
    const said = (node) => node.name ?? node.role ?? node.kind
    return [
      ...here
        // A control, or words but a control's own, which it's said for.
        .filter((node) => node.rect && node.opacity > 0 && node.seen > 0 && (node.actions || (node.kind === "text" && !above(node).some((up) => up.actions))))
        .flatMap((node) => {
          const { y, height: tall } = node.rect
          const over = above(node).filter(scrolls)
          if (y <= 0.5 && y + tall >= height - 0.5) return []
          if (y < top - 0.5 && y + tall > 0 && !over.some(scrolled)) return [`"${said(node)}" is drawn at y ${Math.round(y)}, under the status bar, whose safe area ends at ${top}`]
          if (y + tall > height - bottom + 0.5 && y < height && !over.length) return [`"${said(node)}" is drawn down to y ${Math.round(y + tall)}, under the home indicator, whose safe area starts at ${height - bottom}`]
          return []
        }),
      ...here.filter((node) => node.kind === "frame").flatMap((frame) => read([...path, frame.node], [...above(frame), frame])),
    ]
  }
  return read([], [])
}

/// A row's words given less than half of its width while they are cut short or wrapped: a control or a value beside
/// them took the room the words needed, where they'd have it whole on the row's own width. Words outside any row (a
/// tile's name in a grid or a shelf) are judged against the window's width, so a name cut in a column narrower than half
/// of it fails, as a row's does, where wrapping to a second line or a wider column would show it whole. A control's own
/// words (a button's label) aren't a row's. → what's wrong, a line each.
const SQUEEZED = 0.5
function squeezedWords(nodes, window) {
  const parent = new Map(nodes.flatMap((node) => (node.children ?? []).map((child) => [child, node])))
  return nodes.flatMap((node) => {
    if (node.kind !== "text" || !node.rect || !(node.opacity > 0) || !(node.seen > 0) || !(node.cut || node.lines?.length > 1)) return []
    const above = []
    for (let up = parent.get(node.node); up; up = parent.get(up.node)) above.push(up)
    const row = above.find((up) => up.role === "listitem")
    const said = node.name ?? above.find((up) => up.name)?.name
    // Outside a row, only a name cut short counts: wrapped to a second line it's shown whole.
    if (!row) return node.cut && node.rect.width < SQUEEZED * window ? [`"${said}" is ${Math.round(node.rect.width)} pt wide in a window ${window} pt wide, cut short`] : []
    if (!row.rect || node.rect.width >= SQUEEZED * row.rect.width) return []
    // Inside a control that's not most of the row (a button beside the words), the words are its own.
    const control = above.slice(0, above.indexOf(row)).find((up) => up.actions)
    if (control?.rect && control.rect.width < 0.5 * row.rect.width) return []
    return [`"${said}" is ${Math.round(node.rect.width)} pt wide in a row ${Math.round(row.rect.width)} pt wide, ${node.cut ? "cut short" : `wrapped to ${node.lines.length} lines`}`]
  })
}

/// Words drawn past the side of what they're in, or of the window, where nothing scrolls them there: a line that didn't
/// wrap in the width it was given. → what's wrong, a line each.
const MOVED = ["transform", "translateX", "translateY", "scale", "scaleX", "scaleY", "rotate"]
function overflowingWords(nodes, width) {
  const parent = new Map(nodes.flatMap((node) => (node.children ?? []).map((child) => [child, node])))
  return nodes.flatMap((node) => {
    if (node.kind !== "text" || !node.rect || !(node.opacity > 0) || !(node.seen > 0) || node.rect.width <= 0) return []
    const above = []
    for (let up = parent.get(node.node); up; up = parent.get(up.node)) above.push(up)
    // What scrolls sideways shows the rest as it's scrolled, and a transform moves words where it's meant to.
    if ([node, ...above].some((up) => up.kind === "scroll" || MOVED.some((key) => up.resolved?.[key] !== undefined))) return []
    const { x, width: wide } = node.rect
    if (x < -0.5 || x + wide > width + 0.5) return [`"${node.name}" is drawn from x ${Math.round(x)} to ${Math.round(x + wide)}, past the window's ${width}`]
    const box = above.find((up) => up.rect)?.rect
    if (box && (x < box.x - 0.5 || x + wide > box.x + box.width + 0.5)) return [`"${node.name}" is drawn from x ${Math.round(x)} to ${Math.round(x + wide)}, past what it's in, from ${Math.round(box.x)} to ${Math.round(box.x + box.width)}`]
    return []
  })
}

/// What each scene ends with where a device draws it too: at rest, where each node is, and a picture drawn afresh.
const DRAWN = [{ op: "clock", step: 3000 }, { op: "query" }, { op: "snap" }]
const answered = (stdout) => stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line))

/// A scene drawn on `--ssh`'s device by its own GPU, as here: where each node is laid out there and here, and how much
/// of the two pictures differs, beyond what one GPU's rounding does differently from another's. → what it says.
async function onDevice(drawn, folder) {
  const there = await slot(() => runThere(drawn.at, folder, drawn.asked, drawn.requests))
  const theirs = answered(there.stdout)
  if (there.failed || theirs.length < DRAWN.length) return [`  device: it drew nothing: ${there.stderr.trim().split("\n").at(-1)}`]
  const [[, ours, mine], [, its, picture]] = [drawn.answers, theirs].map((answers) => answers.slice(-DRAWN.length))
  const said = []
  const [here, away] = [ours, its].map((answer) => answer?.result?.nodes ?? [])
  const box = ({ rect }) => (rect ? `${rect.x},${rect.y} ${rect.width}×${rect.height}` : "nowhere")
  const moved = here.filter((node, at) => !away[at] || ["x", "y", "width", "height"].some((edge) => Math.abs((node.rect?.[edge] ?? 0) - (away[at].rect?.[edge] ?? 0)) > 0.5))
  if (here.length !== away.length) said.push(`  device: ${away.length} nodes there, ${here.length} here`)
  if (moved.length) said.push(`  device: ${moved.length} nodes laid out elsewhere, as ${moved.slice(0, 3).map((node) => `${node.role ?? node.kind} "${node.name ?? ""}" at ${box(node)} here, ${box(away[here.indexOf(node)] ?? {})} there`).join("; ")}`)
  if (!mine?.result?.png || !picture?.result?.png) return [...said, `  device: no picture: ${picture?.error ?? mine?.error}`]
  writeFileSync(join(folder, "afresh.png"), Buffer.from(mine.result.png, "base64"))
  writeFileSync(join(folder, "device.png"), Buffer.from(picture.result.png, "base64"))
  const part = differs(join(folder, "afresh.png"), join(folder, "device.png"), join(folder, "device-diff.png"))
  said.push(`  here and on the device: pictures ${part === undefined ? "aren't the same size" : `${(part * 100).toFixed(1)}% different${part > 0.005 ? " (over 0.5%)" : ""}`}`)
  return said
}

/// How quickly the native host drew a scene, as a line.
const timings = ({ first_frame_ms, first_content_ms, worst_paint_ms, idle_ms, typing_ms, scrolling_ms, memory_mb, window_mb }) =>
  [`first frame ${first_frame_ms} ms`, first_content_ms != null && `first content ${first_content_ms} ms`, `worst frame ${worst_paint_ms} ms on its thread`, `frame ${idle_ms} ms idle`, typing_ms != null && `${typing_ms} ms typing`, scrolling_ms != null && `${scrolling_ms} ms scrolling`, `${memory_mb} MB`, `${window_mb} MB a window more`].filter(Boolean).join(", ")

/// How many pixels of a picture are drawn: those that aren't its background's, its most common colour (to within a rounding
/// of a channel or two). A picture that drew nothing, or only its background, has none, however big its window and small
/// what's in it (a button in a computer's window).
function inked(file) {
  const { data } = decoded(file)
  // Counted a run of one colour at a time, as most of a picture is runs of its background: each colour in the order
  // it's first found, so of two as common, the first. (Plain variables: destructured, Bun's JSC ran this four times as slow.)
  const counts = new Map()
  let colour = data.readUInt32BE(0)
  let run = 0
  for (let at = 0; at < data.length; at += 4) {
    const here = data.readUInt32BE(at)
    if (here === colour) {
      run++
      continue
    }
    counts.set(colour, (counts.get(colour) ?? 0) + run)
    colour = here
    run = 1
  }
  counts.set(colour, (counts.get(colour) ?? 0) + run)
  const [background] = [...counts].reduce((most, one) => (one[1] > most[1] ? one : most))
  const [r, g, b, a] = [background >>> 24, (background >>> 16) & 255, (background >>> 8) & 255, background & 255]
  let ink = 0
  for (let at = 0; at < data.length; at += 4) if (data.readUInt32BE(at) !== background && Math.max(Math.abs(data[at] - r), Math.abs(data[at + 1] - g), Math.abs(data[at + 2] - b), Math.abs(data[at + 3] - a)) > 2) ink++
  return ink
}

/// How many pixels of two pictures of a size differ by more than a level in a channel, and by how much at most, or
/// nothing where none does.
function levels(one, other) {
  const [a, b] = [one, other].map(decoded)
  let [differ, most] = [0, 0]
  for (let at = 0; at < a.data.length; at += 4) {
    const by = Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(a.data[at + channel] - b.data[at + channel])))
    if (by > 1) [differ, most] = [differ + 1, Math.max(most, by)]
  }
  return differ ? { differ, most } : undefined
}

/// How two drawings of a scene differ, from one run to the next of the same build: the first thing that isn't the same
/// (a picture's pixels, a tree's line, what each node's query says), or nothing. A scene is drawn twice, on a headless renderer
/// each, and any difference fails it: a check that passes on a rerun is broken, so what leaks in (real time, an
/// ordering, a clock nothing pins, a wait on time rather than state) is fixed where it comes from.
function otherwise(folder, again, files, within = 0) {
  for (const file of files) {
    const [a, b] = [folder, again].map((one) => (existsSync(join(one, file)) ? readFileSync(join(one, file)) : undefined))
    if (a && b && a.equals(b)) continue
    if (!a || !b) return `${file} was drawn ${a ? "once" : "only the second time"}`
    if (!file.endsWith(".png")) {
      const off = first(a.toString(), b.toString())
      return `${file} differs, first at line ${off?.at}: "${off?.a}" and "${off?.b}"`
    }
    const [one, two] = [a, b].map((bytes) => PNG.sync.read(bytes))
    if (one.width !== two.width || one.height !== two.height) return `${file} is ${one.width}×${one.height}, then ${two.width}×${two.height}`
    let [differ, most] = [0, 0]
    for (let at = 0; at < one.data.length; at += 4) {
      const by = Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(one.data[at + channel] - two.data[at + channel])))
      if (by > within) [differ, most] = [differ + 1, Math.max(most, by)]
    }
    if (!differ) continue
    return `${file} is drawn otherwise in ${differ} pixels, by up to ${most} levels`
  }
}

/// How far a web frame is moved to be compared with itself (`unmoved`), in device pixels: down and right, as the canvas
/// cuts off what's moved past its edge.
const WEB_MOVED = [[1, 0], [0, 1], [37, 23]]

/// How `moved`, a picture of the frame in `here` (both drawn whole) drawn moved `by` device pixels on the canvas,
/// differs from it where both have it, by the headless renderer's rules (its `unlike_moved`, whose constants these are): at
/// an edge, where `here` changes by more than 8 levels across a pixel's neighbours, 32 levels apart, as what isn't on
/// whole pixels rounds otherwise moved (SwiftShader's a pill's round end by 20); elsewhere 4 levels in 64 pixels at
/// most; and under glass (`glass`, left, top, right and bottom each) 4, as its blur's samples are on its frame's grid,
/// but near the canvas's edges, where what it reads beyond them is cut off otherwise moved. → how many pixels differ,
/// by how much at most and where, or nothing.
function unmoved(here, moved, [dx, dy], glass) {
  const [a, b] = [here, moved].map(decoded)
  const rects = Array.from({ length: glass.length / 4 }, (_, n) => glass.slice(n * 4, n * 4 + 4))
  // How far a blur reads round its glass, at most: twice three of its widest sigma, 30 points at 2x.
  const REACH = 360
  const value = (x, y, channel) => a.data[(Math.min(a.height - 1, Math.max(0, y)) * a.width + Math.min(a.width - 1, Math.max(0, x))) * 4 + channel]
  const span = (x, y) => Math.max(...[0, 1, 2].map((channel) => {
    const near = [-1, 0, 1].flatMap((j) => [-1, 0, 1].map((i) => value(x + i, y + j, channel)))
    return Math.max(...near) - Math.min(...near)
  }))
  let [over, flat, most, box] = [0, 0, 0, [Infinity, Infinity, 0, 0]]
  for (let y = 0; y + dy < b.height && y < a.height; y++)
    for (let x = 0; x + dx < b.width && x < a.width; x++) {
      const [i, j] = [(y * a.width + x) * 4, ((y + dy) * b.width + x + dx) * 4]
      const apart = Math.max(...[0, 1, 2].map((channel) => Math.abs(a.data[i + channel] - b.data[j + channel])))
      if (!apart) continue
      if (rects.some(([l, t, r, bottom]) => x >= l && x < r && y >= t && y < bottom)) {
        const edge = Math.min(x, y, b.width - dx - x, b.height - dy - y) < REACH
        if (apart <= 4 || edge) continue
        over++
      } else if (span(x, y) > 8) {
        if (apart <= 32) continue
        over++
      } else if (apart <= 4) flat++
      else over++
      ;[most, box] = [Math.max(most, apart), [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)]]
    }
  const differ = over + (flat > 64 ? flat : 0)
  return differ ? { differ, most, box: `${box[0]},${box[1]} ${box[2] - box[0]}×${box[3] - box[1]} px` } : undefined
}

/// Where two trees first differ, as a line of each.
function first(one = "", other = "") {
  const [a, b] = [one.split("\n"), other.split("\n")]
  const at = Array.from({ length: Math.max(a.length, b.length) }, (_, index) => index).find((index) => a[index] !== b[index])
  return at === undefined ? undefined : { at: at + 1, a: a[at]?.trim() ?? "(nothing)", b: b[at]?.trim() ?? "(nothing)" }
}

/// What a comparison says: the trees and the pictures, `them` named.
function compared(said, them, treeA, treeB, pictureA, pictureB, diff) {
  const off = first(treeA, treeB)
  said.push(`  ${them}: trees ${off ? `differ, first at line ${off.at}: "${off.a}" and "${off.b}"` : "the same"}`)
  const part = differs(pictureA, pictureB, diff)
  said.push(`  ${them}: pictures ${part === undefined ? "aren't the same size" : `${(part * 100).toFixed(1)}% different${part > 0.02 ? " (over 2%)" : ""}`}`)
}

/// How far inside the window's edge a text must be to count as in sight, in points: what touches the edge may or may not be read.
const EDGE = 8

/// The most of a scene's web picture that may differ from its native one, from 0 to 1, else the scene fails: our
/// renderer draws both, so more is the web platform's fault, as the widgets' shapes missing from the web were (L30).
const WEB_DIFFERS_MOST = 0.01
/// Scenes whose web picture, or text, differs for a known reason that isn't a fault, by `<folder> · <scene>`, each with why.
const WEB_DIFFERS = {}

// Our renderer on the web, on WebGPU, in Chrome on the machine's GPU through Vulkan (as the headless renderer draws), at a
// phone's two pixels a point; with `--lavapipe`, on SwiftShader's, which draws every frame on the CPU, the second GPU whose
// pictures must agree: its canvas is put on the page only when the page is composited on the GPU too (ANGLE on
// SwiftShader).
const webgpuArgs = lavapipe
  ? ["--font-render-hinting=none", "--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--enable-gpu", "--use-gl=angle", "--use-angle=swiftshader", "--use-webgpu-adapter=opengles", "--force-device-scale-factor=2"]
  : ["--font-render-hinting=none", "--enable-unsafe-webgpu", "--enable-gpu", "--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--force-device-scale-factor=2"]
// Each page drawn at once has a browser of its own, so one that hangs or fails (its GPU process starved) is closed and
// started again for the next, taking no other scene with it.
const browsers = []
/// How many pages it draws on the web at once: a page's JS, layout and compositing are on the CPU, where a native
/// headless renderer waits for half its run, so half as many as headless renderers (`--jobs`), and a quarter with `--lavapipe`, whose
/// SwiftShader draws each on about two cores more: 16 of those at once, light and dark side by side, took the Linux
/// machine's load to 120.
const pages = pLimit(Math.max(1, Math.floor(jobs / (lavapipe ? 4 : 2))))
/// `scene` drawn on the web on a browser no other page is on, once one of `pages` is free.
const webDrawn = (serve, key, scene, folder) =>
  pages(() => machine(async () => {
    const browser = browsers.pop() ?? (await chromium.launch({ args: webgpuArgs }))
    // A page that never answers (a browser whose GPU process starved) fails the scene, saying so, where it held the run for ever.
    const hung = Symbol()
    let timer
    const gone = new Promise((resolve) => (timer = setTimeout(resolve, WEB_HANGS_AFTER_MS, hung)))
    const result = await Promise.race([web(browser, serve, key, scene, folder), gone]).catch((error) => ({ failed: String(error) }))
    clearTimeout(timer)
    if (result !== hung && !result.failed) {
      browsers.push(browser)
      return result
    }
    process.exitCode = 1
    browser.close().catch(() => {})
    return { missing: result === hung ? `it hung for ${WEB_HANGS_AFTER_MS / 60000} minutes` : result.failed }
  }))
// The renderer's frame, built once for every scene drawn on the web (clients/web/renderer/build.js).
const rendererFrame = join(out, "renderer")
const framed = onTheWeb && Bun.spawnSync(["bun", join(root, "clients/web/renderer/build.js"), rendererFrame])
if (framed && framed.exitCode !== 0) throw new Error(`The renderer's frame didn't build: ${framed.stderr}`)
const report = []
// A token pair that can't be read is found where it's written, before any scene draws it.
for (const line of lint()) {
  report.push(`tokens: ${line}`)
  process.exitCode = 1
}
// Every target and scene at once, their headless renderers and pages as many at once as `jobs`, each said in their order.
const drawnTargets = await Promise.all(targets.map(async (target) => {
  const name = basename(target)
  const built = join(out, name, "build")
  const scenes = existsSync(join(target, "client/previews.json")) ? JSON.parse(readFileSync(join(target, "client/previews.json"), "utf8")) : {}
  const unbuilt = await build(target, built)
  if (unbuilt) return [`${name}: ${unbuilt}`]
  // The apps whose components its scenes draw, which its build built.
  const used = new Map([...new Set(Object.values(scenes).flatMap((scene) => scene.uses ?? []))].map((app) => [app, usedFolder(built, app)]))
  const serve = server(built, target, used)
  const drawnScenes = await Promise.all((await scenesOf(target, built)).filter((scene) => !only || scene.name.toLowerCase().includes(only)).map(async (scene) => {
    const folder = join(out, name, scene.name.replace(/[^\w.-]+/g, "-"))
    mkdirSync(folder, { recursive: true })
    // Each scene is drawn twice, a run (and a browser page) of its own each, side by side, in `again`: the second
    // is only compared, and any difference between the two fails the scene.
    const again = join(folder, "again")
    mkdirSync(again, { recursive: true })
    // One kept from before (`cached`) was drawn twice as it was kept, and isn't drawn again.
    const drawn = await native(built, scene, folder)
    const drawnAgain = drawn.kept ? undefined : await native(built, scene, again, true)
    const [onWeb = {}, onWebAgain] = await Promise.all((onTheWeb ? [folder, again] : []).map((where) => webDrawn(serve, `${name}/${scene.name}`, scene, where)))
    const said = [`${name} · ${scene.name}`]
    // The web's pictures are drawn by Chrome's GPU, whose blends and blurs round a level apart from one run to the next
  // (5 pixels of an open select's shadow), as a picture drawn whole is compared within a level (`levels`); native's are exact.
  for (const [run, twice, files, within] of [["native", drawnAgain, ["native.png", "native.txt", "native-text.txt", "native-answers.jsonl"], 0], ["web", onWebAgain, ["web.png", "web-text.txt"], 1]]) {
      if (!twice) continue
      const first = run === "native" ? drawn : onWeb
      const off = first.missing || twice.missing ? (first.missing === twice.missing ? undefined : `${first.missing ?? "drew"} the first time, ${twice.missing ?? "drew"} the second`) : otherwise(folder, again, files, within)
      if (off) {
        said.push(`  ${run}, drawn twice, FAILS: ${off}`)
        process.exitCode = 1
      }
    }
    // A row is drawn in its card by the `List` it's in: one outside any has none, and floats on its screen's background.
    if (name !== "gallery" && drawn.tree !== undefined) for (const row of strayRows(drawn.tree)) said.push(`  a row isn't in a List, so it has no card: ${row}`)
    // A person reads a scene's words: nothing of the build's or the platform's is among them.
    for (const line of drawn.tree === undefined ? [] : internalWords(drawn.tree)) {
      said.push(failing(`  the screen says a word that isn't a person's: ${line}`))
    }
    for (const line of drawn.tree === undefined ? [] : misreadWords(drawn.tree)) {
      said.push(failing(`  the screen's words misread: ${line}`))
    }
    // A page that threw while drawing shows `render`'s Problem, whose scene says nothing of the page.
    if (drawn.tree?.includes(messages.cantShowPage)) {
      said.push(failing(`  native: the page crashed, showing "${messages.cantShowPage}"`))
    }
    if (drawn.blurring) {
      said.push(`  native: ${drawn.blurring}`)
      process.exitCode = 1
    }
    for (const line of drawn.unsafe ?? []) {
      said.push(failing(`  on a phone: ${line}`))
    }
    for (const line of drawn.squeezed ?? []) {
      said.push(failing(`  words are squeezed: ${line}`))
    }
    for (const line of drawn.overflowing ?? []) {
      said.push(failing(`  words run past their side: ${line}`))
    }
    for (const line of drawn.broken ?? []) {
      said.push(`  breaks a rule: ${line}`)
      process.exitCode = 1
    }
    for (const line of await onAMac(drawn, scene, folder, name)) said.push(failing(`  on a Mac: ${line}`))
    // A scene the headless renderer errored on fails the run, where one a host too old for the UI library can't draw only says so.
    if (drawn.missing) said.push(drawn.error ? failing(`  native: ${drawn.missing}`) : `  native: ${drawn.missing}`)
    if (drawn.measured) said.push(`  native: ${timings(drawn.measured)}`)
    if (drawn.measured?.first_content_ms > OPENS_WITHIN_MS) {
      said.push(failing(`  opens slowly: its first content came ${drawn.measured.first_content_ms} ms after it opened, over ${OPENS_WITHIN_MS} ms, with each answer a client doesn't keep ${LATENCY_MS} ms away`))
    }
    if (ssh && !drawn.missing) said.push(...(await onDevice(drawn, folder)))
    for (const problem of onWeb.problems ?? []) said.push(problem.startsWith("✗ ") ? `  ✗ web: ${problem.slice(2)}` : `  web: ${problem}`)
    for (const line of onWeb.internal ?? []) {
      said.push(failing(`  web: the screen says a word that isn't a person's: ${line}`))
    }
    // Pictures a little apart can still show different states (a spinner, an error): each word in sight on one is somewhere
    // on the other, as a person reads it. A word, whichever node or nodes it's in (a text in a line is a node of its own
    // here and part of its line there, and a name is its text's too), however it's spaced (Chrome keeps a plain space
    // where ICU4X, as CLDR has it, puts a narrow no-break one in a time, "12:00 AM"), and anywhere in the other's tree,
    // so one at a window's edge, or under a clip only the native tree knows, isn't a difference.
    if (drawn.words && onWeb.words) {
      const bag = (words) => new Set(words.flatMap((word) => word.split(/[\s\u202f]+/).filter(Boolean)))
      const [nativeSees, webSees, nativeHas, webHas] = [drawn.words, onWeb.words, drawn.all, onWeb.all].map(bag)
      const lost = [...[...nativeSees].filter((word) => !webHas.has(word)).map((word) => `native shows "${word}", web has none`), ...[...webSees].filter((word) => !nativeHas.has(word)).map((word) => `web shows "${word}", native has none`)]
      if (lost.length) {
        const differs = `  native and web: the text differs${WEB_DIFFERS[`${name} · ${scene.name}`] ? ` (known: ${WEB_DIFFERS[`${name} · ${scene.name}`]})` : ""}: ${lost.slice(0, 4).join("; ")}${lost.length > 4 ? `, and ${lost.length - 4} more` : ""}`
        said.push(WEB_DIFFERS[`${name} · ${scene.name}`] ? differs : failing(differs))
      }
    }
    // A picture that drew nothing, or only its background: two near-empty pictures are under the 1% above, so each is judged by
    // itself. A scene always shows something (a blank native one is a root that rendered nothing), and the web's shows what the
    // native one does.
    if (existsSync(join(folder, "native.png"))) {
      const native = inked(join(folder, "native.png"))
      if (native === 0) {
        said.push(failing("  native: the picture is blank (nothing drawn)"))
      }
      const onWebPicture = onTheWeb && !onWeb.missing ? inked(join(folder, "web.png")) : native
      if (onWebPicture === 0 && native > 0) {
        said.push(failing(`  web: the picture is blank (nothing drawn), where the native one has ${native} pixels`))
      }
    }
    const excused = WEB_DIFFERS[`${name} · ${scene.name}`]
    const asWindow = onTheWeb && !onWeb.missing && !drawn.missing && (await windowed(drawn, scene, folder))
    if (onWeb.missing) said.push(failing(`  web: ${onWeb.missing}`))
    else if (asWindow?.missing) {
      said.push(failing(`  native, as a window: ${asWindow.missing}`))
    } else if (asWindow) {
      const part = differs(asWindow.picture, join(folder, "web.png"), join(folder, "web-diff.png"))
      const over = part === undefined || part > WEB_DIFFERS_MOST
      const apart = `  native and web: pictures ${part === undefined ? "aren't the same size" : `${(part * 100).toFixed(1)}% different${over ? ` (over ${WEB_DIFFERS_MOST * 100}%${excused ? `, known: ${excused}` : ""})` : ""}`}`
      said.push(over && !excused ? failing(apart) : apart)
    }
    const before = against && join(against, name, basename(folder))
    // What changed, where our renderer drew the scene both times.
    if (drawn.tree === undefined) {
    } else if (before && existsSync(join(before, "native.png"))) compared(said, "before and now", readFileSync(join(before, "native.txt"), "utf8"), drawn.tree, join(before, "native.png"), join(folder, "native.png"), join(folder, "changed.png"))
    else if (before) said.push("  before and now: no scene of this name before")
    said.push(`  ${folder}`)
    return said.join("\n")
  }))
  serve.stop()
  return drawnScenes
}))
report.push(...drawnTargets.flat())
for (const browser of browsers) await browser.close()
console.log(report.join("\n"))
