// The bridge: the JSON-RPC a page and its client say to each other, through the host, and what the client says of
// where the page is shown. The UI library's components import it as `#bridge`.
import { configureClientErrors, createSignal } from "solid-js"
import { event, modalOpen } from "./drawing-primitives/renderer.native.ts"
import type { Host, Sandbox } from "./calls.ts"
import type { Event, Events } from "./drawing-primitives/renderer.ts"
import type * as Page from "./types/ui.d.ts"
import { readable, whole } from "./words.ts"

const host = (globalThis as { host?: Host }).host
const waiting = new Map<number, (response: { result?: unknown; error?: { message: string } }) => void>()
const listeners = new Set<() => void>()
const warned = new Set<() => void>()
/** Whether a change came while the page wasn't shown, which it's told of once it is (`changed`). */
let missed = false
const tell = () => {
  missed = !shown()
  if (!missed) for (const listener of listeners) listener()
}
let requests = 0
/** What listens for each key pressed (`keydown`). */
const keys = new Set<(event: Page.Keyed) => void>()
/** A key on its way through the page's nodes: which press it is (`Event.press`), and whether a node it's been told to
 * used it, which stops it there and short of the page's own listeners, as the DOM's events stop at what used them. */
let passing = { press: undefined as number | undefined, used: false }

;(globalThis as { ui?: Sandbox & Events }).ui = {
  // A key goes to what has the keyboard and each node it's in that listens, the innermost first, until one uses it, then
  // once to the page (the host tells it, as node 0), for what listens for every key (`keydown`), as the DOM's
  // `document` does, whatever has the keyboard. No page listener hears one while a modal layer is open, which takes
  // every key as the DOM's `<dialog>` does.
  event(told: Event) {
    if (told.name !== "keydown") return void event(told)
    // One press's key is told to each node it goes to and then the page, all saying which press it is. A host of 6
    // says none: then each is the page's, as it was.
    if (told.press === undefined || told.press !== passing.press) passing = { press: told.press, used: false }
    if (told.id === 0) {
      if (!passing.used && !modalOpen()) for (const listener of keys) listener({ key: told.key ?? "", code: told.code ?? "", shiftKey: !!told.shiftKey, altKey: !!told.altKey, ctrlKey: !!told.ctrlKey, metaKey: !!told.metaKey, preventDefault() {} })
      passing = { press: told.press, used: false }
      return
    }
    if (!passing.used) passing.used = event(told)
  },
  message(message: { id?: number; method?: string; result?: unknown; error?: { message: string } }) {
    if (message.method === "notifications/one/changed") tell()
    else if (message.method === "notifications/one/memory_warning") for (const listener of warned) listener()
    else if (message.method === "ui/notifications/host-context-changed") dress((message as { params?: object }).params)
    else if (message.method === "ui/notifications/tool-result") setToolResult((message as { params?: Page.ToolResult }).params)
    else if (message.method === "ui/notifications/tool-input" && assistantTool) setShownCall({ name: assistantTool, arguments: (message as { params?: { arguments?: Record<string, unknown> } }).params?.arguments ?? {} })
    // The device's own back, where something is open over the page: the topmost shuts.
    else if (message.method === "notifications/one/back") topmost()?.shut()
    else if (message.id !== undefined) waiting.get(message.id)?.(message)
  },
}

/// A page's errors are logged to its client (MCP's `notifications/message`), which tells
/// Telemetry: what threw in a listener or a timer, a promise nothing handled, and what an `<Errored>` boundary caught
/// and shows, with where it was thrown from its stack, and the stack, which a native client puts in the source by its
/// bundles' sourcemaps.
const logged = (message: unknown, file?: string, line?: number, stack?: string) =>
  host?.post({ jsonrpc: "2.0", method: "notifications/message", params: { level: "error", data: { message: String(message), file, line, stack } } })
addEventListener("error", ({ message, filename, lineno, error }) => logged(message, filename, lineno, error?.stack))
addEventListener("unhandledrejection", ({ reason }) => logged(reason?.message ?? reason, undefined, undefined, reason?.stack))
configureClientErrors({
  onError(error) {
    const [, file, line] = /([a-z]+:\/\/[^\s()]+?):(\d+):\d+/.exec((error as Error)?.stack ?? "") ?? []
    logged(whole(error), file, line ? Number(line) : undefined, (error as Error)?.stack)
  },
})

/// What the page has asked its client that isn't answered yet, for `tellDrawn`.
const asked = new Set<Promise<unknown>>()

function ask<T>(method: string, params: object): Promise<T> {
  const id = ++requests
  const answer = new Promise<T>((done, failed) => {
    waiting.set(id, ({ result, error }) => {
      waiting.delete(id)
      if (error) failed(new Error(error.message))
      else done(result as T)
    })
    host?.post({ jsonrpc: "2.0", id, method, params })
  })
  asked.add(answer)
  void answer.then(() => asked.delete(answer), () => asked.delete(answer))
  return answer
}

/// Tells the client the page has drawn: once it has rendered and everything it asked for
/// has been answered, which the host times its opening to (`Opening` in clients/app/src/native.rs).
export async function tellDrawn() {
  await greeted
  do await Promise.allSettled(asked)
  while (await new Promise((later) => setTimeout(() => later(asked.size))))
  host?.post({ jsonrpc: "2.0", method: "notifications/one/drawn", params: {} })
}

/** What the client says of where the page is shown: whether the window names the app
 * above it (a computer's app window, whose title a first screen's title gives way to), whether its network
 * answers, what the device keeps for itself at each edge, the window's size and whether its person asked for less
 * motion. */
/** Whether the window names the app above it, which a first screen's title gives way to (the Screen's). */
export const [titled, setTitled] = createSignal(false)
const [connected, setConnected] = createSignal<ReturnType<typeof Page.connection>>("online")
// A host tells its whole context as any of it changes (the device's pressure, say): insets and a size the same as
// before change nothing, where every node laid out by hand was styled again (8 ms of an App Library's JS on a Ryzen).
const same = (before: Record<string, number>, after: Record<string, number>) => Object.keys(after).every((key) => before[key] === after[key])
const [insets, setInsets] = createSignal<{ top: number; right: number; bottom: number; left: number }>({ top: 0, right: 0, bottom: 0, left: 0 }, { equals: same })
const [size, setSize] = createSignal<{ width: number; height: number }>({ width: 0, height: 0 }, { equals: same })
const [still, setStill] = createSignal(false)
// How its client shows the page, as MCP Apps' host context says: a computer's window shows it full, an assistant's chat inline.
const [mode, setMode] = createSignal<"inline" | "fullscreen">("fullscreen")
const [offered, setOffered] = createSignal<string[]>([])
const [shown, setShown] = createSignal(true)
interface Context {
  titled?: boolean
  connection?: ReturnType<typeof Page.connection>
  safeAreaInsets?: ReturnType<typeof Page.safeArea>
  containerDimensions?: { width: number; height: number }
  reducedMotion?: boolean
  /** MCP Apps' own: how the client shows the page, and the other ways it offers. */
  displayMode?: "inline" | "fullscreen"
  availableDisplayModes?: string[]
  /** The link the page was opened to: what follows `#` in a page's address (`link()`). */
  link?: string
  /** MCP Apps' own: the tool an assistant shows the page for. */
  toolInfo?: { tool?: { name?: string } }
  /** MCP Apps' own: whether a finger points at it, and a mouse hovers. */
  deviceCapabilities?: { touch?: boolean; hover?: boolean }
  /** Whether its window is on screen, as a computer's launcher put away isn't: the DOM's `visibilityState`. */
  visible?: boolean
  /** How pressed the device is, as the Compute Pressure API's `PressureRecord.state` says it. */
  pressure?: PressureState
}

type PressureState = "nominal" | "fair" | "serious" | "critical"
type PressureRecord = { source: "cpu"; state: PressureState; time: number; toJSON(): object }
type PressureCallback = (records: PressureRecord[], observer: PressureObserving) => void
let pressure: PressureState = "nominal"
const observing = new Set<PressureObserving>()
/** The W3C Compute Pressure API's `PressureObserver`, as a browser that has it gives a page, told by the host as the
 * device's pressure changes (`hostContext.pressure`): its frames missing the display's refresh, its heat, a battery
 * saver. Its source is `cpu`, as Chromium's is. */
class PressureObserving {
  static readonly knownSources = Object.freeze(["cpu"])
  #callback: PressureCallback
  #records: PressureRecord[] = []
  constructor(callback: PressureCallback) {
    this.#callback = callback
  }
  async observe(source: string) {
    // A browser's is a DOMException, which a native page's JS hasn't: an error of the same name.
    if (source !== "cpu") throw Object.assign(new Error(`There's no source ${source}: cpu is`), { name: "NotSupportedError" })
    observing.add(this)
    this.said(pressure)
  }
  unobserve() {
    observing.delete(this)
  }
  disconnect() {
    observing.delete(this)
    this.#records = []
  }
  takeRecords() {
    return this.#records.splice(0)
  }
  /** The device's pressure is `state`, which its callback hears soon after. */
  said(state: PressureState) {
    const record = { source: "cpu" as const, state, time: performance.now(), toJSON: () => ({ source: "cpu", state, time: record.time }) }
    if (this.#records.push(record) > 1) return
    void Promise.resolve().then(() => {
      const records = this.takeRecords()
      if (records.length && observing.has(this)) this.#callback(records, this)
    })
  }
}
;(globalThis as { PressureObserver?: unknown }).PressureObserver ??= PressureObserving
// Under a finger from the start where the device is, as its host says before it's greeted, so what's drawn before then
// (a screen in its loading fallback) is drawn for a finger too.
const [fingered, setFingered] = createSignal(navigator.maxTouchPoints > 0)
// Told again, the same link is news too: Back to where the page was opened is a link to it again (`place`).
const [opened, setOpened] = createSignal<string | undefined>(undefined, { equals: false })
function dress(context?: Context) {
  if (context && typeof context.link === "string") (setOpened(context.link), linked(context.link))
  if (typeof context?.toolInfo?.tool?.name === "string") assistantTool = context.toolInfo.tool.name
  if (context?.deviceCapabilities && "touch" in context.deviceCapabilities) setFingered(context.deviceCapabilities.touch === true)
  if (context && "titled" in context) setTitled(context.titled === true)
  if (context?.connection) setConnected(context.connection)
  if (context?.safeAreaInsets) setInsets(context.safeAreaInsets)
  if (context?.containerDimensions) setSize(context.containerDimensions)
  if (context && "reducedMotion" in context) setStill(context.reducedMotion === true)
  if (context?.displayMode) setMode(context.displayMode)
  if (context?.availableDisplayModes) setOffered(context.availableDisplayModes)
  if (context && "visible" in context) {
    setShown(context.visible !== false)
    if (missed) tell()
  }
  if (context?.pressure && context.pressure !== pressure) {
    pressure = context.pressure
    for (const observer of observing) observer.said(pressure)
  }
}

/** A client answers a page once it has said what it is, which it does as it loads. */
const greeted = ask<{ hostContext?: object }>("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "", version: "1" }, appCapabilities: {} }).then(({ hostContext }) => {
  dress(hostContext)
  host?.post({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} })
})

/** A part of what a tool answered (MCP's content): its text, a picture (`image`), a file in it (`resource`), or a large
 * file's address (`resource_link`, where its client keeps it). */
type Content = { type: string; text?: string; uri?: string; data?: string; mimeType?: string; resource?: { mimeType?: string; blob?: string } }

/// `await call("notes_add", { text: "Milk" })`: calls a tool and gives its answer, which is text. A file a
/// tool answers with is its address, which an `<Image>` takes as its `src`: a `data:` one, or for a large file, one
/// the client keeps the file at. A tool that refuses throws an `Error` whose `message` is what a person reads of
/// what it said (`readable`), and whose `cause` is all of it, as an agent reads it. The client keeps the answer of a tool
/// that only reads, and answers with it at once. A screen that shows what a tool answers reads it in a memo:
/// `const notes = createMemo(() => call("notes_list").then(JSON.parse))`, under `<Loading>`.
/// An app opened from a group's Home Screen page is answered for the group, with nothing said. A page that shows more
/// than one of them says who each call is for: `call("home-screen_pages", {}, { subject: "groups/family" })`, or `network`.
export const call: typeof Page.call = async (tool, inputs = {}, { subject } = {}) => {
  await greeted
  const { content, isError } = await ask<{ content: Content[]; isError?: boolean }>("tools/call", { name: tool, arguments: inputs, ...(subject ? { _meta: { subject } } : {}) })
  const text = content.map(({ type, text, uri, data, mimeType, resource }) => text ?? (type === "resource_link" ? uri : `data:${mimeType ?? resource?.mimeType};base64,${data ?? resource?.blob}`)).join("\n")
  if (isError) throw new Error(readable(text), { cause: text })
  return text
}

/// `const { device, network, build, server, push } = await client()`: this device's key, as Devices lists it, the
/// network's address, if it has one, the build it's on, its server's key and state if it's a server, and on a phone or in a
/// browser, whether it's woken by its notifications. `await client({ theme: "dark" })` has every app drawn dark, or `"light"`, or with
/// `null` as the device is, and `client({ leave: true })` signs this device out once it's been removed from its
/// person's devices. `client({ serve: true })` makes this device a server of its person's and `false` stops it being
/// one, `client({ update: true })` has it take the latest builds, and `client({ push: true })` has a phone whose push
/// failed try again, or a browser turn its notifications on, from its person's tap: each answers `{ message }`, what it did, or throws why it couldn't. `client({ statusBar: false })`
/// hides the device's status bar while this app is showing, as an iPhone's Home Screen does while it's edited, and
/// `true` shows it again; a device with none, or whose app can't, keeps what it has. An update shows over every app
/// as it's under way, and the app starts again on the new build. On Android, `client({ settings: "accessibility" })`
/// opens its Accessibility settings, and `"app"` the app's App Info, on an iPhone its page in Settings, where its
/// person allows what only they may.
export const client = (async (change: Page.ClientChange = {}) => {
  await greeted
  return ask("one/client", change)
}) as typeof Page.client
/// `<View style={look.top(safeArea().top)}>`, with `top: (paddingTop: number) => ({ paddingTop })` in `styles()`: what the device keeps for itself at each edge of the window (a
/// status bar, a notch, a home indicator), in CSS pixels, as it changes: CSS's `--safe-top` and the rest, as numbers,
/// for what's laid out by hand.
export const safeArea: typeof Page.safeArea = () => insets()
/// `viewport().width`: the window's size, in CSS pixels, as it changes, for what's laid out by hand.
export const viewport: typeof Page.viewport = () => size()
/// `direction()`: which way the page's words run, as its language has them: `rtl` for Arabic or Hebrew.
export const direction: typeof Page.direction = () => "ltr"
/** Whether a finger points at it, as its host says (`deviceCapabilities.touch`): a phone's does, a computer's doesn't. */
export const touch = () => fingered()
/// `displayMode()`: how the client shows the page, as MCP Apps' host context has it: `"fullscreen"` where the page has the
/// window (a computer's), `"inline"` where it's in something larger, as an assistant's chat is.
export const displayMode: typeof Page.displayMode = () => mode()
/// `await requestDisplayMode("fullscreen")`: asks the client to show the page `"fullscreen"`, or back `"inline"`, as an
/// MCP App does (`ui/request-display-mode`). → how it shows it now: the same where it doesn't offer that, or declined.
export const requestDisplayMode: typeof Page.requestDisplayMode = async (to) => {
  await greeted
  if (to === mode() || !offered().includes(to)) return mode()
  const answered = (await ask<{ mode: "inline" | "fullscreen" }>("ui/request-display-mode", { mode: to })).mode
  setMode(answered)
  return answered
}
/// `reducedMotion()`: whether whoever's looking asked for less motion, as it changes, for what moves by hand.
export const reducedMotion: typeof Page.reducedMotion = () => still()
/// `createEffect(visible, (now, was) => now && was === false && refresh(phone))`: whether this page is shown, as it
/// changes: not while its app is in the background or its person is in another app, as Settings. For what's asked
/// again once they're back.
export const visible: typeof Page.visible = () => shown()
/// `sizeChanged({ height: 420 })`: tells the client how large the page's content is, in CSS pixels, as an MCP App tells
/// its host (`ui/notifications/size-changed`). A window sized by what it shows, a computer's launcher, takes it; one
/// whose page fills it keeps its size.
export const sizeChanged: typeof Page.sizeChanged = async (size) => (await greeted, host?.post({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: size }))
/// `pinShortcut("notes/client/index.html")`: puts an app, by its entrypoint, on the device's own home screen, as its
/// own apps go there, which opens it here. Android asks its person where; a device that can't, which `client()` says
/// (`pinsShortcuts`), throws.
export const pinShortcut: typeof Page.pinShortcut = async (entrypoint) => (await greeted, ask("one/pin-shortcut", { entrypoint }))
/// `open("claims")`: shows another app over this one, by its app's name, as tapping its icon or a notification
/// from it does. `open("notes/client/index.html", { subject: "groups/family" })` names a page of the app's that isn't
/// its first app, and who it's for if not whoever this one is: a group, or `network`. It's how a Home Screen page opens
/// an app. With `behind: true` the app only starts, as a finger lands on its icon, and shows when it's opened
/// without. `from` is where its icon or widget is in this page, with its corners' `radius`, which the app grows out
/// of as it shows and goes back into as it closes, as an iPhone's do. `open("https://...")`, a web address, opens it
/// in the device's own browser, outside the app, as an outside service's sign-in page is opened.
export const open: typeof Page.open = async (app, { subject, behind, from } = {}) => (await greeted, ask("ui/open-link", /^https?:/.test(app) ? { url: app } : { url: `one:${app}`, subject, behind, from }))

/// `changed(() => refresh(notes))`: runs what it's given whenever what this page was answered has changed, to ask
/// again and draw it, but not while the page isn't shown: a change then is told once, as it's shown again, as a
/// browser's background tab does nothing until it's looked at. → the function that stops it.
export const changed: typeof Page.changed = (listener) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
/// `memoryWarning(() => setKept([]))`: what a native host tells a page that holds nearly all the memory it may have.
/// A browser never tells a page that, so there it never runs. → the function that stops it.
export const memoryWarning: typeof Page.memoryWarning = (listener) => {
  warned.add(listener)
  return () => void warned.delete(listener)
}
/** What's open over the page (`covers`), which its host hears of, so its Back shuts it. */
const over: { shut: () => void; layer: boolean }[] = []
/// What the device's Back shuts: the last opened of what's drawn over the page (a sheet, a menu, a dialog), which is above
/// any screen, and where none is, the last screen's Back, as Android's OnBackPressedDispatcher and the web's top layer put
/// what's drawn over first, whichever registered first.
const topmost = () => over.findLast(({ layer }) => layer) ?? over.at(-1)
const said = async () => (await greeted, host?.post({ jsonrpc: "2.0", method: "notifications/one/over", params: { over: over.length > 0, layer: over.some(({ layer }) => layer) } }))
/// `const shut = covers(close)`: says something of the app's own has opened over its page, as a sheet or a menu
/// does, which `close` closes: the device's own back (an iPhone's swipe in from the edge, Android's Back) calls
/// `close` before it goes anywhere else. `{ layer: false }` where nothing is drawn over the page, as a screen's own
/// Back. → the function to call once it has closed, however it was.
export const covers: typeof Page.covers = (shut, { layer = true } = {}) => {
  const one = { shut, layer }
  over.push(one)
  void said()
  return () => {
    if (!over.includes(one)) return
    over.splice(over.indexOf(one), 1)
    void said()
  }
}
/// `<Button disabled={connection() === "offline"}>Send</Button>`: whether this device reaches its network now, as it
/// changes: `"online"`, `"connecting"` as it opens, `"offline"`, or `"reconnecting"` once it has lost it. For what can't be done without it: what was answered stays
/// shown either way, and the client says it's offline itself. A client that doesn't say is `"online"`.
export const connection: typeof Page.connection = () => connected()
/** Where the page is in itself as its host was last told it (`place`). */
let placed: string | undefined
/** `place("vault/accounts")`: says where the page is in itself, as its splits have it, which its host hears of as it
 * changes (`notifications/one/place`): a browser's address and history follow it, and its host's link takes it back
 * there (`link`). */
export const place = (at: string, navigated = false) => {
  if (at === placed) return
  placed = at
  void greeted.then(() => host?.post({ jsonrpc: "2.0", method: "notifications/one/place", params: { place: at, navigated } }))
}
/** Opening something is a step back closes, as the device's back closes what covers the page: a screen pushed over the
 * last, which isn't drawn over the page as a sheet or a menu is (a layer), as the DOM's history step isn't one. */
export const step = (close: () => void): (() => void) => covers(close, { layer: false })
/// `go(() => setOpen(note))`: changes which screen shows, as a move. `change` puts the new screen in place, at once:
/// no move is drawn between screens yet.
export const go: typeof Page.go = (change) => change()

/// `keydown((event) => event.key === "Escape" && close())`: each key pressed that isn't something's own: not one a field,
/// a menu or a dialog used first, and none at all while a modal layer (a sheet, a dialog, an alert) is open, which
/// takes every key. → what stops it.
export const keydown: typeof Page.keydown = (listener) => {
  keys.add(listener)
  return () => void keys.delete(listener)
}

/** Back, where there's no history to go back through. */
export function back(): void {
  throw new Error("A native host has no history to go back through: a screen's Back says where it goes (`onBack`)")
}

/** Sends a file the page chose where the network keeps it: the host takes it as base64, the
 * only way a file crosses its JSON channel. */
export const upload: typeof Page.upload = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return (await greeted, (await ask<{ upload: string }>("one/upload", { body: btoa(binary) })).upload)
}
/// `await call("notes_attach", { note: 4, name: file.name, type: file.type, upload: await upload(file) })`:
/// sends a file that's too large to go in a call straight to where the network keeps it, for a tool of this app's
/// app. → the name that tool takes for it, in the input its app says is an upload.
/// `const [file] = await pickFiles({ accept: [".png", "image/*"] })`: the device's own picker of files to open, from a
/// press, as a browser shows it for `<input type="file">`. → the files chosen, none where it was cancelled.
export const pickFiles: typeof Page.pickFiles = async (options = {}) => {
  await greeted
  const { files } = await ask<{ files: { name: string; body: string }[] }>("one/files", { accept: options.accept ?? [], multiple: !!options.multiple })
  return files.map((file) => new File([Uint8Array.from(atob(file.body), (character) => character.charCodeAt(0))], file.name))
}
/// `copy(url).then(() => setCopied(true))`: puts text on the device's clipboard, as a Copy button does, which its client
/// does (`one/copy`): a page has none of its own.
export const copy = async (text: string): Promise<void> => (await greeted, void (await ask("one/copy", { text })))

/// `await share(link)`: hands text to the device's own share sheet where it has one, and copies it otherwise. Call
/// it as a press is handled: a device shares only what its person just asked to. → `"shared"`, `"copied"`, or
/// `undefined` if they closed the sheet.
export const share: typeof Page.share = async (text) => (await greeted, (await ask<{ done: "shared" | "copied" | null }>("one/share", { text })).done ?? undefined)

/// `haptic("medium")`: plays a haptic, by iOS's name: an impact (`"light"`, `"medium"`, `"heavy"`, `"rigid"`,
/// `"soft"`) for something physical, a lift, a snap, a landing; `"selection"` as a value changes step by step; or an
/// outcome (`"success"`, `"warning"`, `"error"`). An iPhone and Android's app play it, as does Chrome on Android, where
/// the device has them on; elsewhere it does nothing.
export const haptic: typeof Page.haptic = (kind) => void greeted.then(() => ask("one/haptic", { kind })).catch(() => {})

/// `leave()`: tells the client the user is done with the app, as MCP Apps' `request-teardown`: the window goes back to
/// the Home Screen, as the device's back does from the app's first screen. An app's first screen has no Back for it:
/// the window's rail and the device's back leave every app.
export const leave: typeof Page.leave = async () => (await greeted, host?.post({ jsonrpc: "2.0", method: "ui/notifications/request-teardown", params: {} }))

/// `await showRecoveryKey()`: has the client show its person their recovery key, over the app. The app is told
/// only that they've seen it: no app's page is handed one. → whether it was shown, which only a device that
/// holds their key can. It's the key of whoever the app is for, or as a call says it, `{ subject: "network" }`'s.
export const showRecoveryKey: typeof Page.showRecoveryKey = async ({ subject } = {}) => (await greeted, (await ask<{ done: boolean }>("one/recovery-key", { subject })).done)
/// `await useRecoveryKey()`: has the client ask its person for their recovery key, and let this device in with
/// it. → whether the device holds their key now. Whose, as `showRecoveryKey` says.
export const useRecoveryKey: typeof Page.useRecoveryKey = async ({ subject } = {}) => (await greeted, (await ask<{ done: boolean }>("one/recovery-key", { typed: true, subject })).done)

/// `const { Summary } = await component("chrome-profiles", "profile")`: what another app's client exports
/// (its client/package.json names it), as a module the client serves beside this app's page: its components, drawn
/// here with what they're given.
export const component: typeof Page.component = async (app, name) => {
  const url = `/${app}/client/${name}.js`
  return import(/* @vite-ignore */ (await host?.component?.(url)) ?? url)
}
/// `createEffect(link, (to) => ...)`: the link the page was opened to last, `one:settings#section&app=vault&section=accounts&request=4`'s `section&app=vault&section=accounts&request=4`, as it
/// changes: a link followed while the page is open is told too, the same one again as well. The page's address
/// forgets it once it's read, so following it again is news. None until a link names more than the app.
export const link: typeof Page.link = () => opened()

const [shownResult, setToolResult] = createSignal<Page.ToolResult | undefined>(undefined, { equals: false })
/// `createEffect(toolResult, (shown) => shown && setWeek(shown.structuredContent.offset))`: what a tool answered, where the
/// page is shown for it, as an assistant shows a tool's page as an MCP App (`ui/notifications/tool-result`): its
/// `structuredContent`, and its `content`. The page shows what it answered, as it shows a place a link opens.
/// None where it isn't, as in an app's own window.
export const toolResult: typeof Page.toolResult = () => shownResult()

/** The tool an assistant shows the page for (MCP Apps' `toolInfo`), whose input it's told (`ui/notifications/tool-input`). */
let assistantTool: string | undefined
/** The screen the page shows: a link's tool and arguments, `week&start=2026-11-23`, its tool by its app's own name (as
 * the address `/my-week/week?start=2026-11-23` says it), or the call an assistant shows it for. */
const [shownCall, setShownCall] = createSignal<string | Page.ToolCall>("")
/** Whether the page's screens are tools (`toolInput`), whose splits then say nothing of where they are (`Split`). */
let byTools = false
export const routed = () => byTools
/** The tool of the app's first screen (`toolInput`'s `first`), which with no arguments is the app's own address, as a link to the app alone says it. */
let firstScreen: string | undefined
/** The screens the page navigated from (`navigate`), the last on top, each with what stops the device's Back going there. */
const navigated: { from: string; done: () => void }[] = []

/** A link's arguments, as an address's query has them: a string as it is, and anything else, or a string that would
 * read as something else (`"42"`), as JSON, so it reads back as it was. */
const typed = (said: string): unknown => {
  if (/^(-?\d|["[{]|true$|false$|null$)/.test(said))
    try {
      return JSON.parse(said)
    } catch {}
  return said
}
/** The link to `name` (`my-week_week`) with `inputs`: its tool by its app's own name, then its arguments (`week&start=2026-11-23`). */
const linkTo = (name: string, inputs: Record<string, unknown>) => {
  const said = new URLSearchParams()
  for (const [key, value] of Object.entries(inputs)) if (value !== undefined) said.set(key, typeof value === "string" && typed(value) === value ? value : JSON.stringify(value))
  return `${name.slice(name.indexOf("_") + 1)}${said.size ? `&${said}` : ""}`
}
const linkOfShown = () => {
  const now = shownCall()
  return typeof now === "string" ? now : linkTo(now.name, now.arguments)
}
/** A link the page is told: Back to the screen it navigated from, or anywhere else, from where nothing is navigated. */
function linked(to: string) {
  const last = navigated.at(-1)
  if (last?.from === to) (navigated.pop(), last.done())
  else for (const one of navigated.splice(0)) one.done()
  placed = to
  setShownCall(to)
}

/// `toolInput("my-week_week")`: the screen the page shows, as the tool that answers what it shows and its
/// arguments, `{ name: "my-week_week", arguments: { start: "2026-11-23" } }`, as it changes: what a link to the page
/// names (`one:my-week#week&start=2026-11-23`, which a browser's address says as `/my-week/week?start=2026-11-23`), what
/// an assistant called where it shows the page as an MCP App, or where the page navigated (`navigate`). `first`, with no
/// arguments, where nothing names one: the app's first screen. Every screen is a tool that only reads, and answers all
/// it first draws: `createMemo(() => call("my-week_week", toolInput("my-week_week").arguments))`.
export const toolInput: typeof Page.toolInput = (first) => {
  byTools = true
  firstScreen = first
  const now = shownCall()
  if (typeof now !== "string") return now
  const [tool, ...said] = now.split("&")
  if (!tool) return { name: first, arguments: {} }
  return { name: `${first.slice(0, first.indexOf("_") + 1)}${tool}`, arguments: Object.fromEntries([...new URLSearchParams(said.join("&"))].map(([key, value]) => [key, typed(value)])) }
}
/// `navigate("my-week_week", { start: week().next })`: shows another of the app's screens, by its tool and arguments,
/// as a link to it would (`toolInput`). It's a step Back goes back from: the device's, and a browser's, whose address
/// says it (`/my-week/week/2026-11-30`), so it's kept, loaded again and shared as a link. To the screen it last came
/// from, it's that Back, as a split's detail closing goes back to its list.
export const navigate: typeof Page.navigate = (name, inputs = {}) => {
  const [from, to] = [linkOfShown(), name === firstScreen && !Object.values(inputs).some((value) => value !== undefined) ? "" : linkTo(name, inputs)]
  if (from === to) return
  // To the screen it last navigated from is Back to it, as a split's detail closing goes back to its list.
  const last = navigated.at(-1)
  if (last?.from === to) {
    navigated.pop()
    last.done()
    setShownCall(to)
    return place(to, true)
  }
  const one = { from, done: () => {} }
  one.done = step(() => {
    const at = navigated.indexOf(one)
    if (at < 0) return
    for (const later of navigated.splice(at)) later.done()
    setShownCall(from)
    place(from, true)
  })
  navigated.push(one)
  setShownCall(to)
  place(to, true)
}
