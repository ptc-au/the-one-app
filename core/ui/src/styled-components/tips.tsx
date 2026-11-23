// A screen's tips: a ? that opens a few of them, one at a time, under it on a computer and in a sheet under a finger.
// Written once on the drawing primitives, the same on every host.
import { createSignal, For, onSettled, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Image, Modal, Pressable, Text, View } from "#primitives"
import { client, direction, keydown, open as openLink, touch, viewport } from "#bridge"
import { Button, Icon } from "./button.tsx"
import { Sheet } from "./sheet.tsx"
import { type Action, askMac, mac, shown } from "./actions.tsx"
import { messages } from "../words.ts"
import { createDismissable } from "../behavior-primitives/dismissable.ts"
import { computePlacement } from "../behavior-primitives/placement.ts"
import { projected } from "../behavior-primitives/velocity.ts"
import { negative, styles } from "../styles.ts"
import { pixels, tokens } from "../tokens.ts"
import type { Rect } from "../drawing-primitives/renderer.ts"
import type { Dragged, Keyed, Laid } from "../types/ui.d.ts"

/** One tip: one idea in a few words (`title`), a sentence (`body`), and what's drawn above them: keys as keycaps
 * (`["mod", "K"]`, as `Keys` names them) or a picture of the app's own (`picture`). */
export interface Tip {
  title: string
  body: string
  keys?: string[]
  picture?: string
}

const look = styles({
  catcher: { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, pointerEvents: "auto" },
  placed: (top: number, left: number) => ({ position: "absolute", top, left, pointerEvents: "auto" }),
  measuring: { position: "absolute", top: 0, left: 0, opacity: 0 },
  // A popover of glass, as a menu is, its corner growing from the ?.
  popover: {
    width: tokens.length.tips,
    padding: tokens.grid[2],
    gap: tokens.grid[2],
    borderRadius: tokens.radius.medium,
    backgroundColor: tokens.colour.panel,
    backdropFilter: tokens.material.glass,
    color: tokens.colour.label,
    boxShadow: tokens.shadow.window,
    opacity: { default: 1, entering: 0 },
    scale: { default: 1, entering: 0.97 },
    transitionProperty: ["opacity", "scale"],
    transition: tokens.motion.quick,
  },
  deck: { gap: tokens.grid[2] },
  // The tips side by side, one shown, which slide as they're flipped through or swiped.
  window: { overflow: "hidden", borderRadius: tokens.radius.medium },
  track: { flexDirection: "row", transitionProperty: ["translateX"], transition: tokens.motion.snappy, userSelect: "none" },
  at: (translateX: number) => ({ translateX }),
  tip: { width: "100%", flexShrink: 0, gap: tokens.grid[0.5] },
  picture: {
    height: tokens.length.tipPicture,
    marginBottom: tokens.grid[2],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.medium,
    backgroundColor: tokens.colour.stripe,
    boxShadow: tokens.shadow.edge,
    overflow: "hidden",
  },
  // Its pictures are drawn 256 by 108, the popover's, and keep that shape in a sheet.
  image: { height: "100%", aspectRatio: 2.37 },
  keys: { flexDirection: "row", alignItems: "center", gap: tokens.grid[1.5] },
  key: {
    minWidth: tokens.grid[8],
    height: tokens.grid[8],
    paddingInline: tokens.grid[2.5],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.small,
    backgroundColor: tokens.colour.card,
    boxShadow: tokens.shadow.pill,
    font: tokens.type.barTitle,
  },
  title: { paddingInline: tokens.grid[1], font: tokens.type.medium, fontWeight: tokens.weight.semibold },
  body: { paddingInline: tokens.grid[1], font: tokens.type.caption, color: tokens.colour.secondaryLabel },
  touchTitle: { paddingInline: 0, font: tokens.type.headline },
  touchBody: { paddingInline: 0, font: tokens.type.medium },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  middle: { justifyContent: "center", paddingBlock: tokens.grid[1] },
  arrow: { width: tokens.grid[6], height: tokens.grid[6], alignItems: "center", justifyContent: "center", borderRadius: tokens.radius.small, color: tokens.colour.secondaryLabel, cursor: "pointer", backgroundColor: { hover: tokens.colour.quinaryLabel } },
  off: { opacity: 0.3, cursor: "default", backgroundColor: tokens.colour.transparent },
  dots: { flexDirection: "row", alignItems: "center" },
  dotButton: { padding: tokens.grid[1], cursor: "pointer" },
  // Unlit at 3:1 against the popover, as the Home Screen's page dots are.
  dot: { width: tokens.grid[1.5], height: tokens.grid[1.5], borderRadius: tokens.radius.full, backgroundColor: tokens.colour.secondaryLabel },
  lit: { backgroundColor: tokens.colour.label },
  // Below the tips, a line apart: Get the App, where it's a browser.
  foot: { borderTopWidth: tokens.length.hairline, borderColor: tokens.colour.quinaryLabel, marginStart: negative(tokens.grid[2]), marginEnd: negative(tokens.grid[2]), paddingTop: tokens.grid[1], paddingInline: tokens.grid[1] },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2], padding: tokens.grid[2], borderRadius: tokens.radius.small, cursor: "pointer", backgroundColor: { hover: tokens.colour.quinaryLabel, focused: tokens.colour.quinaryLabel } },
  rowWords: { flexGrow: 1, minWidth: 0 },
  rowIcon: { color: tokens.colour.secondaryLabel },
  rowTitle: { font: tokens.type.medium },
  rowText: { font: tokens.type.small, color: tokens.colour.secondaryLabel },
  sheetFoot: { marginTop: tokens.grid[2], gap: tokens.grid[2] },
})

/** What opens each `Tips` drawn, the last drawn last: the screen in front's, which Help's key opens. */
const opens: (() => void)[] = []
let listening: (() => void) | undefined
/** Whether a key is Help's, as a Mac's Help menu has ⌘? and Windows' and Linux's apps F1: ⌘? on a Mac, Ctrl+? or F1
 * elsewhere. */
const help = (event: Keyed) => event.key === "F1" || (event.key === "?" && (mac() ? event.metaKey : event.ctrlKey))

const rectOf = (event: Laid): Rect => {
  const { x, y, width, height } = event.currentTarget.getBoundingClientRect()
  return { x, y, width, height }
}

/// `<Tips tips={[{ title: "Copy without looking", body: "Return copies the chosen item's password.", keys: ["enter"] }, …]} />`:
/// a ? that opens a screen's 2 to 4 tips, one at a time, as a Mac's and an iPhone's apps teach theirs: a popover under
/// it on a computer, a sheet swiped through under a finger. ← and → and the dots flip through them; Escape, a press
/// outside and the device's back close them, and ⌘? on a Mac (Ctrl+? or F1 elsewhere) opens the screen in front's,
/// as Help does. A tip draws its `keys` as keycaps, or its `picture`, one of the app's own
/// files. `action` is one thing to do at their foot, as Show Welcome Again (an `Action`: its `label`, `onAction`, an
/// `icon`). In a browser it ends with Get the App. A `Screen`'s `tips` draw one in its bar; this is for a page with no
/// `Screen`, as the Home Screen is.
export function Tips(props: { tips: Tip[]; action?: Action }) {
  const [open, setOpen] = createSignal(false)
  const [anchor, setAnchor] = createSignal<Rect>()
  const [web, setWeb] = createSignal<string>()
  onSettled(() => {
    askMac()
    client().then((said) => setWeb(said.web ? said.network : undefined), () => {})
  })
  const close = () => setOpen(false)
  // Help's key opens the tips of the screen in front, the last drawn, as a Mac's Help menu shows the app's help.
  const show = () => setOpen(true)
  onSettled(() => {
    opens.push(show)
    listening ??= keydown((event) => {
      if (!help(event) || !opens.length) return
      event.preventDefault()
      opens.at(-1)!()
    })
    return () => {
      opens.splice(opens.indexOf(show), 1)
      if (!opens.length) (listening?.(), (listening = undefined))
    }
  })
  // Its popover's: a sheet is dismissed as a sheet is.
  const layer = createDismissable({ open: () => open() && !touch(), onDismiss: close })
  return (
    <>
      {/* A node is told where it is as its size changes, as a ResizeObserver tells it, not as it moves: drawn again for
          each size of the window, which moves the ? with it (a window's end, the launcher's card in its middle), it's
          told where it is now, so Help's key opens its popover under it. */}
      <Show when={`${viewport().width}x${viewport().height}`} keyed>
        {(_size) => (
          <Button
            variant="ghost"
            size="icon"
            shape="capsule"
            aria-label={messages.tips}
            aria-haspopup="dialog"
            aria-expanded={open() ? "true" : "false"}
            autoFocus={layer.returning()}
            onLayout={(event) => setAnchor(rectOf(event))}
            onPress={(event) => (setAnchor(rectOf(event)), setOpen(!open()))}
          >
            <Icon name="question" large />
          </Button>
        )}
      </Show>
      <Show
        when={touch()}
        fallback={
          <Show when={open() && anchor()}>
            {(at) => (
              <Popover at={at()} keydown={layer.keydown} outside={layer.outside}>
                <Deck tips={props.tips} />
                <Show when={props.action || web()}>
                  <View style={look.foot}>
                    <Show when={props.action}>
                      {(action) => (
                        <Pressable role="button" onPress={() => (close(), action().onAction())} style={look.row}>
                          <Show when={action().icon}>
                            {(icon) => (
                              <View style={look.rowIcon}>
                                <Icon name={icon()} />
                              </View>
                            )}
                          </Show>
                          <Text style={[look.rowWords, look.rowTitle]}>{action().label}</Text>
                        </Pressable>
                      )}
                    </Show>
                    <Show when={web()}>{(network) => <GetTheApp network={network()} />}</Show>
                  </View>
                </Show>
              </Popover>
            )}
          </Show>
        }
      >
        <Sheet heading={messages.tips} open={open()} onClose={close}>
          <Deck tips={props.tips} />
          <Show when={props.action || web()}>
            <View style={look.sheetFoot}>
              <Show when={props.action}>
                {(action) => (
                  <Button variant="secondary" onPress={() => (close(), action().onAction())}>
                    <Show when={action().icon}>{(icon) => <Icon name={icon()} along />}</Show>
                    {action().label}
                  </Button>
                )}
              </Show>
              <Show when={web()}>
                {(network) => (
                  <Button variant="secondary" onPress={() => void openLink(`${network()}/download`)}>
                    <Icon name="download-simple" along />
                    {messages.getTheApp}
                  </Button>
                )}
              </Show>
            </View>
          </Show>
        </Sheet>
      </Show>
    </>
  )
}

/** The popover: in a layer over the page, its end under the ?'s, flipped above it where there isn't room. */
function Popover(props: { at: Rect; keydown: (event: Keyed) => boolean; outside: { onPointerDown: () => void; onPress: () => void }; children?: JSX.Element }) {
  const [size, setSize] = createSignal<{ width: number; height: number }>()
  const placed = () => {
    const measured = size()
    if (!measured) return
    return computePlacement(props.at, measured, viewport(), { side: "bottom", align: "end", sideOffset: pixels(tokens.grid[1.5]), alignOffset: 0, collisionPadding: pixels(tokens.grid[2]), rtl: direction() === "rtl" })
  }
  return (
    <Modal>
      <Pressable {...props.outside} style={look.catcher} />
      <View
        role="dialog"
        aria-modal="true"
        aria-label={messages.tips}
        tabIndex={-1}
        onKeyDown={(event) => void props.keydown(event)}
        onLayout={(event) => {
          const { width, height } = event.currentTarget.getBoundingClientRect()
          setSize({ width, height })
        }}
        style={[look.popover, placed() ? look.placed(placed()!.y, placed()!.x) : look.measuring]}
      >
        {props.children}
      </View>
    </Modal>
  )
}

/** The tips, one shown, with the arrows and dots that flip through them, which a swipe does too. */
function Deck(props: { tips: Tip[] }) {
  const [at, setAt] = createSignal(0)
  const [width, setWidth] = createSignal(0)
  const last = () => props.tips.length - 1
  const go = (to: number) => setAt(Math.max(0, Math.min(last(), to)))
  const keys = (event: Keyed) => {
    const way = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
    if (!way || event.metaKey || event.altKey || event.ctrlKey) return
    event.preventDefault()
    go(at() + (direction() === "rtl" ? -way : way))
  }
  // Let go a quarter of the way to the next, or flicked so it would carry on past that, it goes there.
  const swiped = ({ offset, velocity, canceled }: Dragged) => {
    if (canceled) return
    const by = offset.x + projected(velocity.x / 1000)
    if (Math.abs(by) > width() / 4) go(at() + (by < 0 ? 1 : -1))
  }
  return (
    <View tabIndex={-1} autoFocus onKeyDown={keys} style={look.deck}>
      <View style={look.window} onLayout={(event) => setWidth(rectOf(event).width)}>
        <View
          drag="x"
          dragConstraints={{ left: at() < last() ? width() : 0, right: at() > 0 ? width() : 0 }}
          dragElastic={0.2}
          onDragEnd={swiped}
          style={[look.track, look.at(-at() * width())]}
        >
          <For each={props.tips}>{(tip, index) => <Page tip={tip} shown={index() === at()} />}</For>
        </View>
      </View>
      <View style={[look.nav, touch() && look.middle]}>
        <Show when={!touch()}>
          <Pressable role="button" aria-label={messages.previousTip} aria-disabled={at() === 0 ? "true" : undefined} onPress={() => go(at() - 1)} style={[look.arrow, at() === 0 && look.off]}>
            <Icon name="caret-left" />
          </Pressable>
        </Show>
        <View style={look.dots}>
          <For each={props.tips}>
            {(_, index) => (
              <Pressable role="button" aria-label={messages.tipOf(index() + 1, props.tips.length)} aria-current={index() === at() ? "true" : undefined} onPress={() => go(index())} style={look.dotButton}>
                <View style={[look.dot, index() === at() && look.lit]} />
              </Pressable>
            )}
          </For>
        </View>
        <Show when={!touch()}>
          <Pressable role="button" aria-label={messages.nextTip} aria-disabled={at() === last() ? "true" : undefined} onPress={() => go(at() + 1)} style={[look.arrow, at() === last() && look.off]}>
            <Icon name="caret-right" />
          </Pressable>
        </Show>
      </View>
    </View>
  )
}

/** A tip: its keys or picture, its title and its sentence. Only the one shown is read out. */
function Page(props: { tip: Tip; shown: boolean }) {
  return (
    <View aria-hidden={props.shown ? undefined : "true"} style={look.tip}>
      <Show when={props.tip.keys?.length || props.tip.picture}>
        <View style={look.picture}>
          <Show when={props.tip.keys?.length} fallback={<Image src={props.tip.picture!} alt="" style={look.image} />}>
            <View aria-hidden="true" style={look.keys}>
              <For each={props.tip.keys}>
                {(key) => (
                  <View style={look.key}>
                    {key.toLowerCase() === "enter" ? <Icon name="arrow-elbow-down-left" /> : <Text>{shown(key)}</Text>}
                  </View>
                )}
              </For>
            </View>
          </Show>
        </View>
      </Show>
      <Text role="heading" aria-level={2} style={[look.title, touch() && look.touchTitle]}>
        {props.tip.title}
      </Text>
      <Text style={[look.body, touch() && look.touchBody]}>{props.tip.body}</Text>
    </View>
  )
}

/** In a browser: the One App for this computer or phone, from the network's download page. */
function GetTheApp(props: { network: string }) {
  return (
    <Pressable role="link" onPress={() => void openLink(`${props.network}/download`)} style={look.row}>
      <View style={look.rowIcon}>
        <Icon name="download-simple" />
      </View>
      <View style={look.rowWords}>
        <Text style={look.rowTitle}>{messages.getTheApp}</Text>
        <Text style={look.rowText}>{messages.everyDevice}</Text>
      </View>
    </Pressable>
  )
}
