// A screen as it is now, as a remote desktop app shows one: written once on the drawing primitives (#primitives),
// the same on every host. Its live video is the `Video` primitive, which a host draws.
import { createSignal, onCleanup, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { assign, createActor, fromPromise, setup } from "xstate"
import { Portal, Pressable, Video, View } from "#primitives"
import { safeArea, touch, viewport } from "#bridge"
import { BarEnd, Button, Icon } from "./button.tsx"
import { Problem, Status } from "./states.tsx"
import { fullScreen } from "../drawing-primitives/input.ts"
import type { Ice } from "../drawing-primitives/renderer.ts"
import type { Laid } from "../types/ui.d.ts"
import { messages } from "../words.ts"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

// The sizes a screen is resized to: no narrower than Chrome draws its window (500), and no bigger than Computer Use's
// screens take.
const SIZES = { width: [500, 7680], height: [240, 4320] }
const look = styles({
  root: { gap: tokens.grid[1], minWidth: 0 },
  // As wide as its place, and as tall as fits under the bar with a line or two left under it (its `height`).
  view: {
    position: "relative",
    overflow: "hidden",
    borderWidth: tokens.length.hairline,
    borderColor: tokens.colour.quinaryLabel,
    borderRadius: tokens.radius.medium,
    backgroundColor: tokens.colour.background,
    touchAction: "pan-y",
  },
  // Full screen: the whole window, over the page.
  full: { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, borderWidth: 0, borderRadius: 0, pointerEvents: "auto", touchAction: "auto" },
  fill: { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, width: "100%", height: "100%" },
  surface: { backgroundColor: tokens.colour.quinaryLabel, cursor: "default" },
  hidden: { display: "none" },
  // What it shows in place of the screen: in its middle, on the view's grey, over what was there.
  state: { backgroundColor: tokens.colour.background },
  middle: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: tokens.length.gutter, backgroundColor: tokens.colour.quinaryLabel },
  leave: (top: number, end: number) => ({ position: "absolute", opacity: 0.85, top, end }),
  tall: (height: number) => ({ height }),
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: tokens.grid[2] },
})

/** What's sent to a screen: its `action`, and what that action takes, as Computer Use's screens have them. */
export type ScreenInputs = { action: string } & Record<string, unknown>

const json = (answer: unknown) => (typeof answer === "string" ? JSON.parse(answer) : answer)

/// `<LiveScreen label="The browser" screen={(inputs) => call("chrome_screen", { session, ...inputs })} />`: a screen
/// as it is now, as a remote desktop app shows one, which you click, scroll and type on. It's live video over WebRTC:
/// `screen` is called with `stream`, for the ICE servers and then with its offer, for the screen's answer, and what's
/// done on it goes to the screen over the stream's data channel. Video lost is connected to again. Where it can't
/// connect it's a problem that says why, in the words of what refused it, with Try Again. It's as wide as its place
/// and as tall as fits, and the screen is resized to match it (`resize`), so its text is as big as the page's. Full
/// Screen (F11, or ⌃⌘F on a Mac) fills the window with it, and on a phone a tap is what opens it. `watch` only looks:
/// nothing is sent to it, and it keeps its size. Until there's a `screen` (one that's still starting) its place shows
/// what it's given instead, its `Steps` most often.
export function LiveScreen(props: { label: string; screen?: (inputs: ScreenInputs) => Promise<unknown>; watch?: boolean; children?: JSX.Element }) {
  return (
    <Show
      when={props.screen}
      keyed
      fallback={
        <View style={look.root}>
          <View style={[look.view, look.tall(Math.max(256, viewport().height - 240))]}>
            <View style={look.middle}>{props.children}</View>
          </View>
        </View>
      }
    >
      {(screen) => <Connected label={props.label} screen={screen} watch={props.watch} />}
    </Show>
  )
}

/** What happens to a live screen's connection, as its machine is told it: its video `lost`, ended to connect again at
 * its new size (`resized`), or tried again by its person (`again`). */
type Happened = { type: "lost" } | { type: "resized" } | { type: "again" }

/** Why, as words: an error's message, or what was said. */
const said = (why: string | Error | undefined) => (why instanceof Error ? why.message : (why ?? ""))

function Connected(props: { label: string; screen: (inputs: ScreenInputs) => Promise<unknown>; watch?: boolean }) {
  // What it's of, for good: what's still on its way once it's gone goes to it.
  const screen = props.screen
  const watch = props.watch
  const [full, setFull] = createSignal(false)
  // The screen's size, as its video has it, and its place's, where it's drawn.
  const [size, setSize] = createSignal<[number, number]>()
  const [place, setPlace] = createSignal<{ width: number; height: number }>()
  // The stream: the ICE servers it connects with, and the screen's answer to its offer, which the video is given.
  const [ice, setIce] = createSignal<Ice>()
  const [answer, setAnswer] = createSignal<string>()
  let queue: Promise<unknown> = Promise.resolve()
  let gone = false
  // What the stream connecting is told by its video: its offer, and whether it connected.
  let connecting: { offer: (sdp: string) => void; state: (state: "connected" | "lost") => void } | undefined

  /// Connects to the screen's stream, through the video: the ICE servers, its offer, the screen's answer, and its data
  /// channel open. `signal` is the machine leaving the state that connects, which closes what this made.
  const connect = async (signal: AbortSignal) => {
    const servers = json(await screen({ action: "stream" }))
    signal.throwIfAborted()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((connected, failed) => {
        signal.addEventListener("abort", () => failed(signal.reason), { once: true })
        connecting = {
          offer: (sdp) =>
            void screen({ action: "stream", offer: sdp }).then((answered) => {
              setAnswer(json(answered).answer)
              timer = setTimeout(() => failed(new Error("It didn't connect through Cloudflare's relay within 10 seconds")), 10_000)
            }, failed),
          state: (state) => (state === "connected" ? connected() : failed(new Error("Its video was lost as it connected, so the relay didn't carry it"))),
        }
        setAnswer(undefined)
        setIce({ ...servers, iceTransportPolicy: "relay" })
      })
    } catch (error) {
      // What didn't connect is closed.
      setIce(undefined)
      throw error
    } finally {
      clearTimeout(timer)
      connecting = undefined
    }
  }

  /// The connection: video, connected to again when it's lost (as it is when the screen is resized), or else a
  /// problem that says why, which its person tries again.
  const machine = setup({
    types: {} as { context: { why: string }; events: Happened },
    actors: { connect: fromPromise(({ signal }) => connect(signal)) },
    // What went wrong connecting is Telemetry's (`reportError`, which the page's client records), by what happened,
    // then why, and the person is shown why, as the words of what refused it.
    actions: {
      failed: assign({
        why: ({ event }) => {
          const why = said((event as unknown as { error?: Error }).error)
          reportError(new Error(`Live video didn't connect: ${why}`))
          return why
        },
      }),
    },
  }).createMachine({
    context: { why: "" },
    initial: "connecting",
    states: {
      connecting: { invoke: { src: "connect", onDone: "live", onError: { target: "failed", actions: "failed" } } },
      live: {
        id: "live",
        on: {
          lost: { target: "reconnecting", actions: () => reportError(new Error("Live video was lost as it played")) },
          resized: "reconnecting",
        },
      },
      reconnecting: { invoke: { src: "connect", onDone: "live", onError: { target: "failed", actions: "failed" } } },
      failed: { on: { again: "connecting" } },
    },
  })
  const connection = createActor(machine)
  const [state, setState] = createSignal(connection.getSnapshot())
  connection.subscribe(setState)
  onCleanup(() => ((gone = true), connection.stop()))
  const live = () => state().matches("live")
  // The video stays while it's connected to again, under what says so.
  const showsVideo = () => state().matches("live") || state().matches("reconnecting")

  // The screen is resized to the view, in CSS pixels: Chrome on it draws at one pixel each and doesn't take a new
  // scale while it runs, so a screen of the device's pixels would draw its text smaller than the page's. Its stream
  // ends as it's resized, and is connected to again at its new size.
  let resizing: ReturnType<typeof setTimeout> | undefined
  let fixed = false
  let requested = ""
  const resize = () => {
    const { width: wide, height: tall } = place()!
    // A view smaller than the least a screen takes keeps its shape, and is drawn a little smaller.
    const up = Math.max(1, SIZES.width[0] / wide, SIZES.height[0] / tall)
    const width = Math.min(Math.round(wide * up), SIZES.width[1])
    const height = Math.min(Math.round(tall * up), SIZES.height[1])
    if (fixed || requested === `${width}x${height}`) return
    requested = `${width}x${height}`
    // A screen whose display can't be resized (a desktop container made before it could) is drawn scaled instead.
    return screen({ action: "resize", width, height }).then(
      () => true,
      () => (fixed = true) && false,
    )
  }
  const fit = () => {
    clearTimeout(resizing)
    resizing = setTimeout(() => (queue = queue.then(async () => (await resize()) && live() && connection.send({ type: "resized" }))), 250)
  }
  /// Where it's drawn, as it's laid out and each time that changes: its first place is the one the screen is resized
  /// to before it's connected to, so it isn't connected to twice.
  const laid = (event: Laid) => {
    const { width, height } = event.currentTarget.getBoundingClientRect()
    const first = !place()
    setPlace({ width, height })
    if (!first) return void (!watch && fit())
    if (watch) connection.start()
    else queue = queue.then(resize).then(() => !gone && connection.start())
  }

  // Full Screen fills the window with it, over the page: a page has no display of its own to fill.
  const toggle = () => setFull(!full())

  // Where the person types, presses and scrolls: its video, which sends it all itself.
  const view = (
    <View
      onKeyDown={(event) => fullScreen(event) && (event.preventDefault(), toggle())}
      style={[
        look.view,
        full() ? look.full : look.tall(watch && size() && place() ? Math.min((place()!.width * size()![1]) / size()![0], viewport().height - 128) : Math.max(256, viewport().height - 240)),
      ]}
    >
      <Pressable onLayout={laid} style={[look.fill, look.surface]}>
        <Show when={ice()}>
          {(servers) => (
            <Video
              ice={servers()}
              answer={answer()}
              watch={watch}
              aria-label={props.label}
              autoFocus={full()}
              onOffer={({ sdp }) => connecting?.offer(sdp)}
              onState={({ state }) => (connecting ? connecting.state(state) : state === "lost" && connection.send({ type: "lost" }))}
              onSize={({ width, height }) => setSize([width, height])}
              style={[look.fill, !showsVideo() && look.hidden]}
            />
          )}
        </Show>
      </Pressable>
      <Show when={state().matches("connecting")}>
        <View style={[look.fill, look.state]}>
          <View style={look.middle}>
            <Status heading="Connecting…" />
          </View>
        </View>
      </Show>
      <Show when={state().matches("reconnecting")}>
        <Status over heading="Reconnecting…" />
      </Show>
      <Show when={state().matches("failed")}>
        <View style={[look.fill, look.state]}>
          <View style={look.middle}>
            <Problem
              heading="Live video didn't connect"
              text={state().context.why}
              action={
                <Button variant="outline" onPress={() => connection.send({ type: "again" })}>
                  Try Again
                </Button>
              }
            />
          </View>
        </View>
      </Show>
      {/* On a phone the view is small: a tap opens it full screen. */}
      <Show when={touch() && !full()}>
        <Pressable onPress={toggle} style={look.fill} />
      </Show>
      {/* Full screen has no Escape, which is the screen's: it has its own way out. */}
      <Show when={full()}>
        <View style={look.leave(Math.max(8, safeArea().top), Math.max(8, safeArea().right))}>
          <Button variant="secondary" size="icon" aria-label={messages.exitFullScreen} onPress={toggle}>
            <Icon name="corners-in" />
          </Button>
        </View>
      </Show>
    </View>
  )

  return (
    <View style={look.root}>
      {!full() && view}
      <Show when={full()}>
        <Portal>{view}</Portal>
      </Show>
      <View style={look.bar}>
        <BarEnd value={true}>
          <Button variant="ghost" size="icon" aria-label={messages.fullScreen} onPress={toggle}>
            <Icon name="corners-out" />
          </Button>
        </BarEnd>
      </View>
    </View>
  )
}
