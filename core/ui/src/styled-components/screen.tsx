// A whole view of an app, a part of one, and a list beside what it opens: written once on the drawing primitives
// (#primitives), the same on every host, which each say what's theirs (#bridge): their history,
// their device's back and how they move between screens.
import { children, createContext, createEffect, createSignal, For, onSettled, Show, useContext } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Pressable, ScrollView, Text, View } from "#primitives"
import { back as goBack, covers, go, keydown, reducedMotion, safeArea, step, titled, touch, viewport } from "#bridge"
import { BarEnd, Button, Icon, type IconName } from "./button.tsx"
import { messages } from "../words.ts"
import { createButton } from "../headless-components/button.ts"
import { createPop } from "../headless-components/split.ts"
import { ListKeys, ListStyle } from "./list.tsx"
import { Empty } from "./states.tsx"
import { Menu } from "./menu.tsx"
import { Tips, type Tip } from "./tips.tsx"
import { negative, styles, type Styles } from "../styles.ts"
import { pixels, tokens } from "../tokens.ts"
import type { Rect } from "../drawing-primitives/renderer.ts"

// How many splits have been made, each naming its own timeline.
let splits = 0

const look = styles({
  screen: { position: "relative", flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0 },
  // The bar keeps clear of what the device keeps for itself at the top under a finger (its status bar). On a computer
  // it is the window's title row, where the window has one, which is what's kept at its top there: it's in that row,
  // after the window's controls and title (`atStart`), not under it.
  bar: { paddingStart: tokens.length.safeLeft, paddingEnd: tokens.length.safeRight },
  // Under a finger, what's in it scrolls under the bar, as UINavigationBar's and Android's top app bar's does: clear of
  // it where it's scrolled to its top (`clear`), and the bar takes its material and a hairline as what's in it goes
  // under, as a scroll edge's appearance gives way to the standard one.
  floating: { position: "absolute", top: 0, start: 0, end: 0, zIndex: 1 },
  backdrop: { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, zIndex: -1, backgroundColor: tokens.colour.glass, backdropFilter: tokens.material.glass, borderBottomWidth: tokens.length.hairline, borderColor: tokens.colour.quinaryLabel },
  clear: { paddingTop: tokens.length.safeTop },
  clearRow: { height: tokens.length.bar },
  clearBy: (height: number) => ({ height }),
  faded: (opacity: number) => ({ opacity }),
  // A phone's first screen's name, large, at the top of what scrolls, as iOS's large titles and Android's large top
  // app bar have it: it goes under the bar as what's in it scrolls, and the bar's own small title takes its place.
  large: { paddingInline: tokens.length.gutter, paddingTop: tokens.grid[1], paddingBottom: tokens.grid[1], font: tokens.type.largeTitle, textAlign: "start" },
  // Its line keeps clear of the buttons beside it (`inline`).
  largeEnd: (end: number) => ({ paddingEnd: end }),
  // A bar that's only room over a large title lets a finger through to what scrolls under it, but for its buttons.
  through: { pointerEvents: "none" },
  taken: { pointerEvents: "auto" },
  lift: (by: number) => ({ translateY: by }),
  row: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2], minHeight: tokens.length.bar, paddingInline: tokens.length.gutter },
  // A long name, which may be all the screen says of what it's about, takes two lines, as Android's bars do.
  title: { flexGrow: 1, flexShrink: 1, minWidth: 0, paddingBlock: tokens.grid[1], font: tokens.type.headline, lineClamp: 2, textAlign: "start" },
  // On a computer, Raycast's: its title beside Back, 15px, on one line.
  // It keeps room for a short name beside the actions, which give way to it (`kept`).
  computerTitle: { font: tokens.type.barTitle, lineClamp: 1, minWidth: tokens.grid[16] },
  // On a computer the bar is the window's title row, its unified toolbar, as macOS's System Settings and Raycast have
  // it: at the window's top, after the window's controls and title where it's at the window's start, and before
  // the controls at its end where it's at its end.
  atStart: { paddingStart: tokens.length.titleBarStart },
  atEnd: { paddingEnd: tokens.length.titleBarEnd },
  // The arrow, not the button's edge, lines up with what's under it.
  back: { marginStart: negative(tokens.length.iconInset) },
  // On a computer, Back and Forward in one pill of glass before the title, as macOS's System Settings and Raycast's
  // Settings have them; under a finger, Back alone, round.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    height: tokens.length.control,
    paddingInline: tokens.grid[1],
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.colour.glass,
    boxShadow: tokens.shadow.pill,
  },
  pillButton: { width: tokens.length.control, height: tokens.length.control, alignItems: "center", justifyContent: "center", borderRadius: tokens.radius.full, cursor: "pointer", color: tokens.colour.secondaryLabel },
  pillOff: { color: tokens.colour.quaternaryLabel, cursor: "default" },
  pillLine: { width: tokens.length.hairline, height: tokens.grid[4], backgroundColor: tokens.colour.quinaryLabel },
  round: { paddingInline: 0 },
  action: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2], flexShrink: 0 },
  main: { flexGrow: 1, minHeight: 0 },
  // What's in it keeps clear of what the device keeps for itself at its other edges.
  safe: { flexGrow: 1, paddingStart: tokens.length.safeLeft, paddingEnd: tokens.length.safeRight, paddingBottom: tokens.length.safeBottom },
  parts: { flexGrow: 1, gap: tokens.length.gutter, paddingTop: tokens.grid[2], paddingInline: tokens.length.gutter, paddingBottom: tokens.length.gutter },
  section: { gap: tokens.grid[1.5], minWidth: 0 },
  // Raycast's on a computer, 11px; iOS's on a phone, its footnote inset to the rows' words.
  heading: { font: tokens.type.small, color: tokens.colour.secondaryLabel },
  touchHeading: { paddingInline: tokens.grid[4] },
  // Above a card in grouped cards: the group's name, as Raycast's Settings heads one, in line with the card's words.
  groupedHeading: { font: tokens.type.medium, fontWeight: tokens.weight.medium, color: tokens.colour.label, paddingInline: tokens.grid[3], paddingTop: tokens.grid[2], paddingBottom: tokens.grid[1] },
  // What's in a screen keeps a readable width in the middle of its room, as macOS's System Settings' and Raycast's
  // Settings' do, so a note, a field or a button is in line with the lists, and a wide window doesn't leave it at
  // one side.
  column: { flexGrow: 1, gap: tokens.length.gutter, width: "100%", maxWidth: tokens.length.readable, alignSelf: "center" },
  filled: { maxWidth: "100%" },
  // A row that scrolls sideways runs out to the window's edges, as the App Store's shelves do on a Mac and an iPad, so
  // what's cut by an edge is cut by the window's, never at the column's margin with room beyond it. It starts where
  // the column does (`side` of padding, as far as the margin pulls it out) and keeps room above and below for
  // the focus ring its children draw, which it would clip.
  shelf: { flexDirection: "row", paddingTop: tokens.grid[1], paddingBottom: tokens.grid[1], marginTop: negative(tokens.grid[1]), marginBottom: negative(tokens.grid[1]) },
  bleed: (pull: number, side: number) => ({ marginStart: pull, marginEnd: pull, paddingStart: side, paddingEnd: side }),
  split: { flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0, position: "relative" },
  beside: { flexDirection: "row" },
  // Pushed over its list, what slides off its side isn't drawn beyond it.
  clipped: { overflow: "hidden" },
  pane: { minHeight: 0, minWidth: 0, overflow: "hidden", backgroundColor: tokens.colour.background },
  // Where there's no room for both, what's opened is pushed over its list, as UINavigationController pushes: it
  // slides in from the end as it's made (`entering`), and back the same way, drawn going till it's off (`exiting`), as
  // UIKit keeps a popped view till its transition ends: on one spring the renderer draws, by the points it's across.
  // The list under it follows it frame by frame, wherever it is, on its way or under a finger, as UIKit's interactive
  // pop drives both by one percent: a third of the way the other way, and dimmed, as it covers it (`timeline`, by how
  // far it's across). The list stays drawn under it, as it was, with its place, where it's scrolled to and its
  // pictures, so it's there whole the moment what's over it goes, and out of reach (`inert`) till then.
  over: { position: "absolute", inset: 0 },
  // With less motion, it fades in over the list and out, which stays where it is.
  sliding: { transitionProperty: ["translateX", "opacity"], transition: tokens.motion.smooth },
  pushed: (translateX: { default: number; entering: number; exiting: number }) => ({ translateX }),
  timeline: (name: `--${string}`) => ({ translateTimelineName: name, translateTimelineAxis: "x" }),
  fades: { opacity: { default: 1, entering: 0, exiting: 0 } },
  out: { pointerEvents: "none" },
  whole: { flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0 },
  under: { animationName: { from: { translateX: "-30%" }, to: { translateX: 0 } } },
  dim: { position: "absolute", inset: 0, backgroundColor: tokens.colour.overlay, opacity: 0, pointerEvents: "none", animationName: { from: { opacity: 0.35 }, to: { opacity: 0 } } },
  // A host before timelines goes through no time of it, and leaves it where it is.
  follows: (name: `--${string}`) => ({ animationTimeline: name, animationIterationCount: 0 }),
  // Where there is, the list keeps a readable width and what it opens has the rest.
  list: { flexBasis: "38%", minWidth: tokens.length.columnMin, maxWidth: tokens.length.column, flexShrink: 0, borderEndWidth: tokens.length.hairline, borderColor: tokens.colour.quinaryLabel },
  // A window's sidebar is narrower, as macOS's and Raycast's Settings' are.
  sidebar: { flexBasis: tokens.length.sidebar, minWidth: tokens.length.sidebar, maxWidth: tokens.length.sidebar },
  detail: { flexGrow: 1, flexShrink: 1 },
  // A split's ?, beside its list on a computer: at the window's end of the title bar, over the end of what's open's
  // bar, which keeps room for it.
  tipsAt: { position: "absolute", top: 0, end: 0, zIndex: 2 },
  tipsRow: { flexDirection: "row", alignItems: "center", minHeight: tokens.length.bar, paddingInline: tokens.length.gutter },
  tipsRoom: { width: tokens.length.control, flexShrink: 0 },
  // A phone's floating actions, over what scrolls and clear of the home indicator, as iOS's floating buttons and
  // Android's FABs are: a stack of round buttons at the start and one pill at the end, each hugging its own corner so
  // what's between them is still pressed through.
  floatAt: { position: "absolute", bottom: tokens.length.safeBottom, zIndex: 1, padding: tokens.length.gutter, opacity: { default: 1, entering: 0, exiting: 0 }, translateY: { default: 0, entering: tokens.grid[4], exiting: tokens.grid[4] }, transitionProperty: ["opacity", "translateY"], transition: tokens.motion.travel },
  floatStart: { start: tokens.length.safeLeft, alignItems: "flex-start", gap: tokens.grid[3] },
  floatEnd: { end: tokens.length.safeRight },
  // Glass over the page as Liquid Glass's buttons are; the main one dark, as Material's primary FAB is the strongest fill.
  floatButton: { width: tokens.grid[10], height: tokens.grid[10], alignItems: "center", justifyContent: "center", borderRadius: tokens.radius.full, backgroundColor: tokens.colour.glass, backdropFilter: tokens.material.glass, boxShadow: tokens.shadow.glass, color: tokens.colour.label, cursor: "pointer", opacity: { default: 1, pressed: 0.7 }, transitionProperty: ["opacity"], transition: tokens.motion.quick },
  floatMain: { width: tokens.grid[12], height: tokens.grid[12], backgroundColor: tokens.colour.label, color: tokens.colour.background },
  floatPill: { width: "auto", flexDirection: "row", gap: tokens.grid[2], paddingInline: tokens.grid[5], font: tokens.type.large, whiteSpace: "nowrap" },
  floatOff: { opacity: 0.5, cursor: "default" },
})

/** How far a screen whose own page draws its large title (`largeTitle`) is scrolled when that's gone under its bar, in
 * CSS pixels. */
const LARGE = 56
/** How far what's in a screen with no large title scrolls under its bar while the bar takes its material, in CSS
 * pixels. */
const UNDER = 16

/** How wide a split's list is beside what it opens (tokens.length.columnMin, 38%, tokens.length.column), and how
 * wide it has to be for both, in CSS pixels. */
const columnMin = 18 * 16
const column = 24 * 16
const wide = 48 * 16
const sidebarWidth = 15 * 16

/** How wide what's being drawn has room for: the window, or a split's side. */
export const Room = createContext<() => number>(() => viewport().width)
/** What closes what a split has open beside its list, for the list's Back button, while something is. */
const Opened = createContext<() => (() => void) | undefined>(() => undefined)
/** What a screen's Back does when it says nothing of its own: back through the history, or closing a split's detail. */
const Leave = createContext<() => void>(goBack)
/** Whether it's in a split's detail beside its list, where a screen has nowhere to go back to. A split in that detail
 * whose own detail is pushed over its list has a Back again, to that list. */
const InDetail = createContext<() => boolean>(() => false)
type Went = { back?: () => void; forward?: () => void } | null
/** Where the window's Back and Forward go, read as it changes. */
const Went = createContext<() => Went>(() => null)
/// `<History value={{ back, forward }}>`: where a window's Back and Forward go, as macOS's System Settings keeps them:
/// the screens in it draw them in their bar, each greyed where it goes nowhere, as `value` changes. A split pushing a
/// screen over its list starts again, its Back going back to the list. ⌘[ and ⌘] on a Mac, and Alt+← and Alt+→
/// elsewhere, go Back and Forward too, as a browser's and Finder's do.
export function History(props: { value: Went; children?: JSX.Element }) {
  onSettled(() =>
    keydown((event) => {
      const only = (held: boolean) => held && [event.metaKey, event.altKey, event.ctrlKey, event.shiftKey].filter(Boolean).length === 1
      const way = only(event.metaKey) ? { "[": "back", "]": "forward" }[event.key] : only(event.altKey) ? { ArrowLeft: "back", ArrowRight: "forward" }[event.key] : undefined
      const went = way && props.value?.[way as "back" | "forward"]
      if (!went) return
      event.preventDefault()
      went()
    }),
  )
  return <Went value={() => props.value}>{props.children}</Went>
}
/** Which of the window's edges a screen's bar reaches, where its title row's controls and title are: a split's
 * list beside what it opens reaches the start, and what it opens the end. */
const Edge = createContext<() => { start: boolean; end: boolean }>(() => ({ start: true, end: true }))
/** Where a screen in a split hands it its `tips`, which a split beside its list draws once, at the window's end. →
 * what takes them back. */
const HandTips = createContext<((tips: () => Tip[] | undefined) => () => void) | null>(null)
/** Whether the split a screen is in draws the ? for it (`HandTips`), and whether over the end of this screen's bar. */
const TipsDrawn = createContext<() => { drawn: boolean; over: boolean }>(() => ({ drawn: false, over: false }))
/** Whether a state is all there is of where it is, which it fills, in its middle, inside the gutter: a split's
 * detail beside its list, or a page or a part of one with no screen around it (an app that couldn't show its first
 * screen, an empty Home page), as iOS's ContentUnavailableView is. In a screen's parts, it's one of them. */
export const Middle = createContext<() => boolean>(() => true)
/// Where an `Empty` in a split's list side says it's there, so the split's detail side has nothing to pick: not one in a
/// `Section`, which is only that section's.
export const Blank = createContext<(change: number) => void>(() => {})
/** Whether `node` is all there is in the screen it's in, as an empty screen's `Empty` is: in the middle of it, then. */
export const Alone = createContext<(node: unknown) => boolean>(() => false)

/** A floating action: an icon, what it's named (`label`, which the trailing one also shows) and what pressing it does. */
export interface FloatingAction {
  icon: IconName
  label: string
  onPress: () => void
  disabled?: boolean
  /** The leading stack's main one, larger and dark, at the stack's bottom. */
  primary?: boolean
}

/** Whether a field in the screen has the keyboard, which a phone's floating actions give way to. */
export const Typing = createContext<(on: boolean) => void>(() => {})

function FloatingButton(props: { action: FloatingAction; pill?: boolean }) {
  const button = createButton({
    get disabled() {
      return props.action.disabled
    },
    get onPress() {
      return props.action.onPress
    },
  })
  return (
    <Pressable {...button.root()} aria-label={props.action.label} style={[look.floatButton, props.action.primary && look.floatMain, props.pill && look.floatPill, button.off() && look.floatOff]}>
      <Icon name={props.action.icon} />
      <Show when={props.pill}>
        <Text>{props.action.label}</Text>
      </Show>
    </Pressable>
  )
}

/// `<Screen heading="Notes" action={<Button>Add</Button>}>...</Screen>`: a whole view of an app: a bar across its
/// top that stays as what's under it scrolls, with its `heading` and what it does (`action`: its one main button, at
/// the bar's end on every device as a Mac's toolbar and GitHub's New have it, with any others in a ⋯ `Menu` before it),
/// then what's in it, one part under another. With `back` the bar starts with a Back button, which calls
/// `onBack`, as the device's own back gesture does: a screen with `back` says where it goes, but in a split's detail,
/// which it closes. A split's list closes what's open beside it first. An
/// app's first screen has no Back: the window's rail and the device's back leave the app. Where the window's title
/// names the app, its first screen's heading gives way to it. Under a finger, a first screen's heading is large at the top
/// of what scrolls, as iOS's large titles and Android's large top app bar are, and goes under the bar as it scrolls,
/// the bar's small one taking its place, every step of it following the scroll; what scrolls under the bar gives it
/// its material and a hairline. With `largeTitle` the screen's page draws its name large itself, as iOS's App Store's
/// pages do, and the bar's shows as that scrolls away. With `tips` (2 to 4 `Tip`s: `{ title, body, keys?, picture? }`)
/// its bar has a ? that shows them (`Tips`): at the end of a computer's title bar, where it stays, and under a finger
/// just before `action`. What's in it keeps a readable width in the middle of its
/// room; with `readable={false}` it fills the room, as a calendar's week or a grid of photos does (UIKit's
/// readableContentGuide, not followed). With `floatingActions={{ leading: [{ icon: "plus", label: "Add receipt", onPress: add }, { icon: "scan", label: "Scan", onPress: scan, primary: true }], trailing: { icon: "list-checks", label: "Complete", onPress: complete } }}`
/// a screen has the actions its person reaches for most, as Android's FAB and extended FAB and iOS's floating buttons
/// are, over what scrolls, always in view: under a finger in a narrow window, a stack of round buttons at the start (the
/// `primary` one larger, at its bottom) and one pill at the end, clear of the home indicator, with room left at the end of
/// what scrolls so the last row clears them, and away while a field has the keyboard. Where there's room (a computer's
/// window, an iPad's wide one) they're in the bar instead: the leading ones before `action`, the trailing one after it,
/// whole, with the leading ones that don't fit beside the heading in a ⋯ menu (More Actions), as a toolbar's overflow.
export function Screen(props: { heading?: JSX.Element; action?: JSX.Element; floatingActions?: { leading?: FloatingAction[]; trailing?: FloatingAction }; tips?: Tip[]; back?: boolean; onBack?: () => void; largeTitle?: boolean; readable?: boolean; children?: JSX.Element }) {
  const opened = useContext(Opened)
  const leave = useContext(Leave)
  const inDetail = useContext(InDetail)
  const back = () => {
    const close = opened()
    if (close) close()
    else if (props.onBack) props.onBack()
    else leave()
  }
  // The device's own back calls a Back of the screen's own, as a tap on it does.
  createEffect(() => !!props.back && !!props.onBack, (now) => (now ? covers(back, { layer: false }) : undefined))
  const backed = () => !!props.back && !inDetail()
  const history = useContext(Went)
  const edge = useContext(Edge)
  // In a split beside its list, its tips are the window's, drawn by the split at the window's end; else its own.
  const hand = useContext(HandTips)
  const splitTips = useContext(TipsDrawn)
  if (hand) onSettled(() => hand(() => props.tips))
  const tips = () => (splitTips().drawn ? undefined : props.tips?.length ? props.tips : undefined)
  const computer = !touch()
  const room = useContext(Room)
  const floating = () => !computer && room() < wide && !!props.floatingActions
  const [typing, setTyping] = createSignal(0)
  const typed = (on: boolean) => void setTyping((count) => count + (on ? 1 : -1))
  const [leadingHeight, setLeadingHeight] = createSignal(0)
  const [trailingHeight, setTrailingHeight] = createSignal(0)
  // Under a finger, a first screen draws its heading large itself.
  const large = !computer && !props.back && !props.largeTitle
  const action = children(() => props.action)
  // What's in it, and whether one node is all of it, as a screen with only an `Empty` has.
  // What's in it is made here, so it's in what the screen provides it (`Typing`) as its bar is.
  const [whole, setWhole] = createSignal<unknown[]>([])
  const parts = children(() => (
    <Typing value={typed}>
      <Middle value={() => false}>
        <Alone value={(node) => whole().length === 1 && whole()[0] === node}>{props.children}</Alone>
      </Middle>
    </Typing>
  ))
  createEffect(() => parts.toArray().filter(Boolean), (all) => void setWhole(all))
  // One or two small buttons sit at the end of a large title's line, vertically centred on it, and the bar has no row
  // of its own above it till the title scrolls under, as Music's, Photos' and the App Store's do; three or more keep
  // their row above it, as UINavigationBar's do.
  const buttons = () => action.toArray().filter(Boolean).length + (tips() ? 1 : 0) + (floating() ? 0 : (props.floatingActions?.leading?.length ?? 0) + (props.floatingActions?.trailing ? 1 : 0))
  const inline = () => large && buttons() <= 2
  const [endWidth, setEndWidth] = createSignal(0)
  // On a computer, how many leading actions fit in the bar beside its heading and its trailing one, which is kept whole:
  // those that don't are in a ⋯ menu before it, the last first, as a macOS toolbar's overflow is. Each layout where the
  // actions overflow the row puts one more there, and a row grown by more than a button since tries all of them again.
  const [kept, setKept] = createSignal(Infinity)
  let row: Rect | undefined
  let end: Rect | undefined
  let narrowedAt = Infinity
  const leading = () => props.floatingActions?.leading ?? []
  const inBar = () => leading().slice(0, kept())
  const inMenu = () => leading().slice(kept())
  const fit = () => {
    if (!computer || !row || !end || floating() || !leading().length) return
    // How far the actions run past the row's end padding: one more goes each layout they do, the ⋯ coming in with the
    // first, whose own layout is the next turn (it takes the room of the icon it holds, so the actions' width stays).
    const over = end.x + end.width - (row.x + row.width - pixels(edge().end ? tokens.length.titleBarEnd : tokens.length.gutter))
    const now = Math.min(kept(), leading().length)
    if (over > 0.5 && now > 0) {
      narrowedAt = row.width
      setKept(now - 1)
    } else if (kept() < leading().length && row.width > narrowedAt + pixels(tokens.length.control)) {
      narrowedAt = Infinity
      setKept(Infinity)
    }
  }
  const [scrolled, setScrolled] = createSignal(0)
  const [largeHeight, setLargeHeight] = createSignal(LARGE)
  const [barHeight, setBarHeight] = createSignal<number>()
  // How far the buttons are from the large title's middle, which they go to from as it goes under the bar.
  const lift = () => (inline() && barHeight() ? (largeHeight() - (barHeight()! - safeArea().top)) / 2 * (1 - under()) : 0)
  // How far its large title has gone under the bar, or what's in it has, from 0 to 1, as Compose's top app bar's
  // `collapsedFraction` is: a large title from halfway under it to all the way.
  const under = () => {
    const height = large ? largeHeight() : props.largeTitle ? LARGE : 0
    const [from, span] = height ? [height / 2, height / 2] : [0, UNDER]
    return Math.min(1, Math.max(0, (scrolled() - from) / span))
  }
  // Only an app's first screen, which has no Back, gives way to the window's title; a large title's bar shows its
  // heading as that goes, cross-faded as UINavigationBar's: the large one fades out over the first half and the bar's
  // in over the second, so the two are never drawn at once.
  const titleShown = () => (!props.back && titled() ? 0 : large || props.largeTitle ? Math.max(0, 2 * under() - 1) : 1)
  const named = () => titleShown() > 0
  // On a computer, a screen that says nothing in its bar, in a window whose title bar already names it (a dialog's),
  // has no bar; under a finger the bar keeps clear of the status bar.
  const barred = () => !computer || !!props.heading || !!props.action || !!props.floatingActions || !!tips() || backed() || titled() || (computer && !!history())
  return (
    <Typing value={typed}>
    <View style={look.screen}>
      <Show when={barred()}>
      <View role="banner" style={[look.bar, !computer && look.clear, !computer && look.floating, inline() && look.through]} onLayout={computer ? undefined : (event) => setBarHeight(event.currentTarget.getBoundingClientRect().height)}>
        <Show when={!computer}>
          <View style={[look.backdrop, look.faded(under())]} />
        </Show>
        <View style={[look.row, computer && edge().start && look.atStart, computer && edge().end && look.atEnd]} onLayout={computer ? (event) => ((row = event.currentTarget.getBoundingClientRect()), fit()) : undefined}>
          <Show when={backed() || (computer && history())}>
            <View role="group" style={[look.pill, !(computer && history()) && look.round]}>
              <Pressable
                role="button"
                aria-label={messages.back}
                aria-disabled={backed() || history()?.back ? undefined : "true"}
                onPress={() => (backed() ? back() : history()?.back?.())}
                style={[look.pillButton, !(backed() || history()?.back) && look.pillOff]}
              >
                <Icon name="caret-left" along />
              </Pressable>
              <Show when={computer && history()}>
                <View style={look.pillLine} />
                <Pressable
                  role="button"
                  aria-label={messages.forward}
                  aria-disabled={!backed() && history()?.forward ? undefined : "true"}
                  onPress={() => !backed() && history()?.forward?.()}
                  style={[look.pillButton, (backed() || !history()?.forward) && look.pillOff]}
                >
                  <Icon name="caret-right" along />
                </Pressable>
              </Show>
            </View>
          </Show>
          <Heading level={1} aria-hidden={named() ? undefined : "true"} style={[look.title, computer && look.computerTitle, titleShown() < 1 && look.faded(titleShown())]}>
            {props.heading}
          </Heading>
          <View style={[look.action, look.taken, look.lift(lift())]} onLayout={(event) => {
            end = event.currentTarget.getBoundingClientRect()
            setEndWidth(end.width)
            fit()
          }}>
            <Show when={!computer && tips()}>
              {(now) => <Tips tips={now()} />}
            </Show>
            <Show when={action.toArray().some(Boolean) || (!floating() && props.floatingActions)}>
              <BarEnd value={true}>
                <View style={look.action}>
                  <Show when={!floating()}>
                    <Show when={inMenu().length}>
                      <View style={look.action} onLayout={fit}>
                      <Menu.Root onSelect={(label) => inMenu().find((one) => one.label === label)?.onPress()}>
                        <Menu.Trigger aria-label={messages.moreActions} />
                        <Menu.Positioner>
                          <Menu.Content>
                            <For each={inMenu()}>
                              {(one) => (
                                <Menu.Item value={one.label} disabled={one.disabled}>
                                  <Icon name={one.icon} />
                                  {one.label}
                                </Menu.Item>
                              )}
                            </For>
                          </Menu.Content>
                        </Menu.Positioner>
                      </Menu.Root>
                      </View>
                    </Show>
                    <For each={inBar()}>
                      {(one) => (
                        <Button size="icon" variant={one.primary ? "default" : "ghost"} aria-label={one.label} disabled={one.disabled} onPress={one.onPress}>
                          <Icon name={one.icon} />
                        </Button>
                      )}
                    </For>
                  </Show>
                  {action()}
                  <Show when={!floating() && props.floatingActions?.trailing}>
                    {(one) => (
                      <Button variant="outline" disabled={one().disabled} onPress={one().onPress}>
                        <Icon name={one().icon} />
                        {one().label}
                      </Button>
                    )}
                  </Show>
                </View>
              </BarEnd>
            </Show>
            <Show when={computer && tips()}>
              {(now) => <Tips tips={now()} />}
            </Show>
          </View>
          <Show when={computer && splitTips().over && edge().end}>
            <View style={look.tipsRoom} />
          </Show>
        </View>
      </View>
      </Show>
      <ScrollView role="main" style={look.main} onScroll={!computer || props.largeTitle ? (event) => setScrolled(event.currentTarget.scrollTop) : undefined}>
        <View style={[look.safe, computer && !barred() && look.clear]}>
          <Show when={!computer}>
            <Show when={!inline()} fallback={<View style={look.clear} />}>
              <Show when={barHeight()} fallback={<View style={look.clear}><View style={look.clearRow} /></View>}>
                <View style={look.clearBy(barHeight()!)} />
              </Show>
            </Show>
          </Show>
          <Show when={large}>
            <View onLayout={(event) => setLargeHeight(event.currentTarget.getBoundingClientRect().height)}>
              <Heading level={1} aria-hidden={named() ? "true" : undefined} style={[look.large, inline() && endWidth() > 0 && look.largeEnd(pixels(tokens.length.gutter) + endWidth() + pixels(tokens.grid[2])), under() > 0 && look.faded(Math.max(0, 1 - 2 * under()))]}>
                {props.heading}
              </Heading>
            </View>
          </Show>
          <View style={look.parts}>
            <View style={[look.column, props.readable === false && look.filled]}>
              {parts()}
            </View>
          </View>
          <Show when={floating()}>
            <View style={look.clearBy(Math.max(leadingHeight(), trailingHeight()))} />
          </Show>
        </View>
      </ScrollView>
      <Show when={floating() && !typing()}>
        <Show when={props.floatingActions?.leading?.length}>
          <View role="toolbar" style={[look.floatAt, look.floatStart]} onLayout={(event) => setLeadingHeight(event.currentTarget.getBoundingClientRect().height)}>
            <For each={props.floatingActions?.leading}>{(one) => <FloatingButton action={one} />}</For>
          </View>
        </Show>
        <Show when={props.floatingActions?.trailing}>
          {(one) => (
            <View style={[look.floatAt, look.floatEnd]} onLayout={(event) => setTrailingHeight(event.currentTarget.getBoundingClientRect().height)}>
              <FloatingButton action={one()} pill />
            </View>
          )}
        </Show>
      </Show>
    </View>
    </Typing>
  )
}

/** A heading: its words a `Text`, or, where it's more than words (a button at its end, an icon before it), a box
 * that's the heading, as a `Text` holds only words. */
function Heading(props: { level: number; "aria-label"?: string; "aria-hidden"?: "true"; style: Parameters<typeof Text>[0]["style"]; children?: JSX.Element }) {
  const inside = children(() => props.children)
  const words = () => inside.toArray().every((part) => typeof part === "string" || typeof part === "number")
  return (
    <Show when={words()} fallback={<View role="heading" aria-level={props.level} aria-label={props["aria-label"]} aria-hidden={props["aria-hidden"]} style={props.style}>{inside()}</View>}>
      <Text role="heading" aria-level={props.level} aria-hidden={props["aria-hidden"]} style={props.style}>
        {inside()}
      </Text>
    </Show>
  )
}

/// `<Section heading="This week">...</Section>`: a part of a screen under a small grey heading.
export function Section(props: { heading?: JSX.Element; "aria-label"?: string; children?: JSX.Element }) {
  // Grouped cards head their groups, and so does a sidebar under a finger, which is drawn as them.
  const style = useContext(ListStyle)
  const grouped = () => style === "insetGrouped" || (style === "sidebar" && touch())
  return (
    <View style={look.section}>
      <Show when={props.heading}>
        <Heading level={2} aria-label={props["aria-label"]} style={[look.heading, touch() && look.touchHeading, grouped() && look.groupedHeading]}>
          {props.heading}
        </Heading>
      </Show>
      {/* An `Empty` in a part of the list is that part's, not the list's: its split still has rows to pick. */}
      <Blank value={() => {}}>{props.children}</Blank>
    </View>
  )
}

/// `<Shelf aria-label="Categories" style={look.chips}>{chips}</Shelf>`: a row that scrolls sideways, from the window's
/// edge to its edge, as the App Store's shelves do on a Mac and an iPad, its first item where the screen's column
/// starts. `style` may say its `gap`. In a screen's column, never a `ScrollView` of your own, which ends at the column
/// with a hard cut and room to spare beyond it. `role` says what it is: a `"toolbar"` of choices, a `"group"` (the
/// default) of things under its `aria-label`.
export function Shelf(props: { role?: "group" | "toolbar" | "list"; "aria-label"?: string; style?: Styles<"gap">; children?: JSX.Element }) {
  const room = useContext(Room)
  // Where the column starts: the gutter, or where its readable width leaves the room's middle.
  const side = () => Math.max(pixels(tokens.length.gutter), (room() - safeArea().left - safeArea().right - pixels(tokens.length.readable)) / 2)
  return (
    <ScrollView role={props.role ?? "group"} aria-label={props["aria-label"]} style={[look.shelf, look.bleed(-side(), side()), props.style]}>
      {props.children}
    </ScrollView>
  )
}

/** The splits with something open, the innermost last, which Escape closes first. */
const open: (() => void)[] = []

/// `<Split open={toolInput("notes_list").name === "notes_note"} onClose={() => navigate("notes_list")} detail={<Screen heading={note().text} back>...</Screen>}><Screen heading="Notes">...</Screen></Split>`:
/// a list and what it opens (`detail`): beside it where there's room, pushed over it where there isn't, while
/// `open`. Each side scrolls by itself, and the split is as tall as what it's in. While it's open the device's own
/// back, Escape, and the detail's Back button close it, or beside its list, where a detail has none, the list's: it
/// calls `onClose`, and the app sets `open` false. Its list side's lists are one to the keyboard (`ListKeys`).
/// Beside its list with nothing open, its detail side says `pick` ("Pick a repo to see its code."), as Mail says "No
/// Message Selected", where the app has a list to pick from: it's left out where there's none, and where the list is
/// empty (an `Empty` in it, not in one of its sections), when its detail side says nothing and the list's own line stands alone, as Mail's does.
export function Split(props: { open?: boolean; onClose?: () => void; pick?: string; detail?: JSX.Element; children?: JSX.Element }) {
  const room = useContext(Room)
  const history = useContext(Went)
  const edge = useContext(Edge)
  // What a split in another's detail opens is pushed over its list, as a window's page of settings opens what's in it.
  const inDetail = useContext(InDetail)
  const beside = () => room() >= wide && !inDetail()
  // A sidebar's list is a sidebar's width (`ListStyle`), and the detail has the rest.
  const sidebar = useContext(ListStyle) === "sidebar"
  const listWidth = () => (sidebar ? sidebarWidth : Math.min(column, Math.max(columnMin, room() * 0.38)))
  // What's drawn as open, which follows `open` as a move.
  const [shown, setShown] = createSignal(false)
  // How many `Empty` its list side shows.
  const [blank, setBlank] = createSignal(0)
  const close = () => props.onClose?.()
  // The tips its screens hand it (`HandTips`), each with its side: beside its list on a computer, one ? at the window's
  // end of the title bar has them, what's open's first, as one window has one Help.
  const [handed, setHanded] = createSignal<{ side: "list" | "detail"; tips: () => Tip[] | undefined }[]>([])
  const hand = (side: "list" | "detail") => (tips: () => Tip[] | undefined) => {
    const one = { side, tips }
    setHanded((now) => [...now, one])
    return () => setHanded((now) => now.filter((other) => other !== one))
  }
  const of = (side: "list" | "detail") => handed().filter((one) => one.side === side).map((one) => one.tips()).filter((tips) => tips?.length).at(-1)
  const windowTips = () => (beside() && !touch() ? ((props.open && of("detail")) || of("list")) : undefined)

  // Escape closes it, unless it's for something open over it, a sheet or a menu, or a split open in it, which closes
  // first.
  onSettled(() => keydown((event) => event.key === "Escape" && props.open && open.at(-1) === close && close()))

  // It starts as it's written, and beside its list it shows at once; pushed over it, it moves, once the page has
  // first settled (`moved`): a page opened at what it opens doesn't slide it in.
  const [moved, setMoved] = createSignal(false)
  onSettled(() => void setMoved(true))
  createEffect(() => !!props.open, (now, was) => {
    if (was === undefined || beside()) setShown(now)
    else go(() => setShown(now), { back: !now })
  })

  // Open, it's what the device's back closes: beside its list as it closes a sheet, pushed over the list as a step
  // back through the history, which a device's gesture shows as the whole page going back. A sidebar's choice beside it
  // is no more closed than macOS's is by Escape.
  createEffect(() => (props.open ? (beside() ? (sidebar ? "" : "beside") : "over") : ""), (how) => {
    if (!how) return
    open.push(close)
    const done = how === "beside" ? covers(close, { layer: false }) : step(close)
    return () => (open.splice(open.indexOf(close), 1), done())
  })

  // Pushed over its list, a finger swipes it back, and the list follows it by its timeline, its own.
  const pop = createPop({ enabled: () => !beside() && touch(), onClose: close })
  const timeline = `--pushed-${++splits}` as const
  const follows = () => !beside() && !reducedMotion()

  return (
    <View style={[look.split, beside() ? look.beside : look.clipped]}>
      <View aria-hidden={!beside() && shown() ? "true" : undefined} inert={!beside() && shown() ? true : undefined} style={[look.pane, beside() ? look.list : [look.over, follows() && [look.under, look.follows(timeline)], shown() && look.out], beside() && sidebar && look.sidebar]}>
        <Room value={() => (beside() ? listWidth() : room())}>
          <Edge value={() => ({ start: edge().start, end: edge().end && !beside() })}>
          <Opened value={() => (props.open ? close : undefined)}>
            <Middle value={() => false}>
              <Blank value={(change) => setBlank((count) => count + change)}>
                <HandTips value={hand("list")}>
                  <TipsDrawn value={() => ({ drawn: !!windowTips(), over: false })}>
                    <ListKeys>{props.children}</ListKeys>
                  </TipsDrawn>
                </HandTips>
              </Blank>
            </Middle>
          </Opened>
          </Edge>
        </Room>
        <Show when={follows()}>
          <View style={[look.dim, look.follows(timeline)]} />
        </Show>
      </View>
      <View aria-hidden={!beside() && !shown() ? "true" : undefined} style={beside() ? [look.pane, look.detail] : [look.over, !shown() && look.out]}>
        <Show when={beside() || props.open}>
        <View {...pop} style={beside() ? look.whole : [look.pane, look.over, look.sliding, reducedMotion() ? moved() && look.fades : [look.pushed({ default: 0, entering: moved() ? room() : 0, exiting: room() }), look.timeline(timeline)]]}>
        <Room value={() => (beside() ? room() - listWidth() - 1 : room())}>
          <Edge value={() => ({ start: edge().start && !beside(), end: edge().end })}>
          <Leave value={close}>
            <History value={beside() ? history() : null}>
            <InDetail value={beside}>
              <Middle value={beside}>
                <HandTips value={hand("detail")}>
                  <TipsDrawn value={() => ({ drawn: !!windowTips(), over: !!windowTips() })}>
                    <Show when={beside() && !props.open && (blank() || props.pick)} fallback={props.detail}>
                      <Show when={!blank()}>
                        <Empty>{props.pick}</Empty>
                      </Show>
                    </Show>
                  </TipsDrawn>
                </HandTips>
              </Middle>
            </InDetail>
            </History>
          </Leave>
          </Edge>
        </Room>
        </View>
        </Show>
      </View>
      <Show when={windowTips()}>
        {(tips) => (
          <View style={look.tipsAt}>
            <View style={[look.tipsRow, edge().end && look.atEnd]}>
              <Tips tips={tips()} />
            </View>
          </View>
        )}
      </Show>
    </View>
  )
}
