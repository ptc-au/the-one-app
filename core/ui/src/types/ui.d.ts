// The UI library as an app's page sees it (`tsconfig.app.json` names it `ui`): the drawing primitives, the
// components drawn with them, and what an app asks for in passing, each with only the props a native host draws
// too. Nothing here is the DOM's. The UI library's own typecheck proves its components take these (../check.ts). A
// component an app needs that isn't here yet is added here, with only the props every host can draw.
import type { Context, Element } from "solid-js"
import type { Ice, Props, Rect } from "../drawing-primitives/renderer.ts"
import type { Look, Styled, Styles } from "../styles.ts"
import type { tokens as Tokens } from "../tokens.ts"

export type { Element, Ice, Look, Rect, Styled, Styles }

// Styles and tokens (../../styles.ts, ../../tokens.ts).
export { createTheme, defineVars, illustration, styles, negative } from "../styles.ts"
export declare const tokens: typeof Tokens

/** What a node says it is, and its states, as ARIA has them. */
export type Semantics = Pick<Props, Extract<keyof Props, "role" | "id" | `aria-${string}`>>

// The primitives.

// What a page moved by hand is told (renderer.ts's `Moved`), each a part of the DOM's event of that name, which is
// what it's given on the DOM.

/** Where it happened, in the window, and where the node is drawn there (`getBoundingClientRect()`): a click's, a
 * `contextmenu`'s. */
export type Located = {
  clientX: number
  clientY: number
  timeStamp: number
  currentTarget: { getBoundingClientRect(): Rect }
}
/** A pointer's, a finger's or a mouse's: which one, what it is, and which button, `0` the main one. */
export type Pressed = Located & {
  pointerId: number
  pointerType: "mouse" | "touch" | "pen"
  button: number
}
/** What a node dragged is told as it's let go, as Motion's `PanInfo`: how far it went from where it was pressed, and
 * how fast it was going, in pixels a second, with where it's drawn. */
export type Dragged = Laid & {
  offset: { x: number; y: number }
  velocity: { x: number; y: number }
  canceled: boolean
}
/** Where a node is drawn, as it's laid out. */
export type Laid = {
  currentTarget: { getBoundingClientRect(): Rect }
}
/** A trackpad's or a wheel's scroll, in CSS pixels. Where the system says them, which a native host on a Mac does and
 * the DOM doesn't: the trackpad's fingers' `phase`, by AppKit's names, and whether it's the `momentum` after they've
 * lifted. Where a wheel turned by clicks, as a mouse's does, how many it turned along and down (`notchesX`,
 * `notchesY`, the deltas' way), which a native host says on every system and the DOM where it says lines (Firefox):
 * what tells it from a trackpad's scroll, or a wheel's that turns smoothly, which has none. */
export type Wheeled = {
  deltaX: number
  deltaY: number
  timeStamp: number
  phase?: "began" | "changed" | "ended" | "cancelled" | "mayBegin"
  momentum?: boolean
  notchesX?: number
  notchesY?: number
}

/** What a key pressed is told, as the DOM's `KeyboardEvent`: `key` what it means, `code` where it is on the keyboard
 * ("KeyK", "Space"), as a shortcut is recorded, since ⌥K on a Mac means "˚"; `preventDefault()` keeps what the key
 * does by itself in a field (a caret moved, the focus moved on by Tab) from happening, on the DOM. */
export type Keyed = {
  key: string
  code: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  preventDefault(): void
}

/** Whether a box is near the window: within half the window's size of what shows of it. */
export type Intersected = {
  isIntersecting: boolean
}
/** What a scroll view scrolling is told: how far it's scrolled. */
export type Scrolled = {
  currentTarget: { scrollTop: number; scrollLeft: number }
}

/** What every primitive but an image and a text input takes: how it looks, and what it listens for. */
type Listens = Semantics & {
  style?: Styles
  /** What Tab reaches, as the web's `tabIndex`: `0` for what it otherwise wouldn't, `-1` for what's focused only by a
   * press. */
  tabIndex?: 0 | -1
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (event: Keyed) => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  /** Once a pointer is down on it, its moves and its end come here, wherever it goes, as a touch's do. */
  onPointerDown?: (event: Pressed) => void
  onPointerMove?: (event: Pressed) => void
  onPointerUp?: (event: Pressed) => void
  onPointerCancel?: (event: Pressed) => void
  /** A right-click, or a touch held, as the device has it, in place of the device's own menu. */
  onContextMenu?: (event: Located) => void
  onWheel?: (event: Wheeled) => void
  /** Told where it's drawn as it's laid out, and each time that changes, as React Native's `onLayout`. */
  onLayout?: (event: Laid) => void
  /** Told whether it's near the window, as it's first laid out and each time that changes, as an
   * `IntersectionObserver` with a `rootMargin` of 50% tells: what draws only what's near what shows does it by this. */
  onIntersection?: (event: Intersected) => void
  /** Has the keyboard as it's drawn, and again each time it's set. */
  autoFocus?: boolean
  /** Out of reach, with all that's in it, as the DOM's `inert` is: never pressed, never reached by Tab, never read,
   * as what's faded out is. `undefined`, not `false`, for reachable. */
  inert?: true
  children?: Element
}

export type ViewProps = Listens & {
  /** Files dropped on it from the system (a Finder's, an Explorer's). */
  onDrop?: (files: File[]) => void
  /** Files from the system came over it, as they're dragged, where it takes them (`onDrop`), as the DOM's `dragenter`;
   * and left it, as its `dragleave`, unless they were dropped on it. A host before this one doesn't say. */
  onDragEnter?: () => void
  onDragLeave?: () => void
  /** Follows a pointer or a finger dragging it, as Motion's `drag`: along (`"x"`), down (`"y"`) or both (`true`),
   * moved by the host where the input arrives, never by a turn of the page's JS. */
  drag?: "x" | "y" | boolean
  /** How far it may be dragged up, left, right and down from where its style puts it, in pixels; past that it gives
   * as a rubber band, as loose as `dragElastic` (0 none, 1 loose, 0.5 if unsaid). */
  dragConstraints?: { top?: number; left?: number; right?: number; bottom?: number }
  dragElastic?: number
  /** Moves from where it was laid out to where it is as that changes, as Motion's `layout`: a list reordered, a card
   * grown. The host draws it on its way, by a spring, with no layout again each frame. */
  layout?: boolean
  /** What it shares its place with, as Motion's `layoutId` and SwiftUI's `matchedGeometryEffect`: one drawn where
   * another with the same id was a moment ago goes there from it (a tab's pill sliding to the tab chosen, an icon
   * growing into its window). */
  layoutId?: string
  onDragStart?: () => void
  /** Dragged on, as Motion's `onDrag`: how far it's held from where its style puts it, as it moves. A host before
   * this one doesn't say it. */
  onDrag?: (event: Pick<Dragged, "offset">) => void
  /** Let go: how far it went and how fast it was going, in pixels a second. It springs from where it is, at that
   * speed, to where its style puts it, which this may move. */
  onDragEnd?: (event: Dragged) => void
  /** Let go, it has sprung to rest where its style puts it, as Motion's `onDragTransitionEnd`: what waits for it to
   * settle (a pager's arrows) shows then. A host before this one doesn't say it. */
  onDragTransitionEnd?: () => void
  /** What its style moved (`transition`) has all but arrived, within a twenty-fifth of its way and 8 points, as SwiftUI's
   * `.logicallyComplete` (`rest: false`): what waits for it to land (captions beside an icon) shows then; and again as
   * it comes to rest, drawn where its style puts it, as SwiftUI's `.removed` and CSS's `transitionend` (`rest: true`):
   * what takes its place there (an icon handed back to its folder) shows then, unseen. Each once for the node, not each
   * property. A host before this one doesn't say it, and one before rest's tells once, with no `rest`, as it all but
   * arrives. */
  onTransitionEnd?: (event: { rest?: boolean }) => void
}
export declare function View(props: ViewProps): Element

export type PressableProps = ViewProps & {
  /** Pressed, by a pointer, a finger, or Enter or Space where the keyboard is. */
  onPress?: (event: Located) => void
  /** Not pressed, and says so. */
  disabled?: boolean
}
export declare function Pressable(props: PressableProps): Element

export type ScrollViewProps = ViewProps & {
  onScroll?: (event: Scrolled) => void
}
export declare function ScrollView(props: ScrollViewProps): Element

export type VirtualizedListProps<T> = Semantics & {
  style?: Styles
  data: readonly T[]
  renderItem: (info: { item: T; index: number }) => Element
  estimatedItemSize?: number
  /** A row to keep drawn wherever the list is scrolled, one the keyboard is being sent to (Home, End), which scrolls
   * into view as it takes it. */
  keep?: number
}
export declare function VirtualizedList<T>(props: VirtualizedListProps<T>): Element

export type TextProps = Semantics & {
  style?: Styles
  /** Pressed where its words are, as an inline link (`role="link"`), reached by Tab with a `tabIndex`. */
  tabIndex?: 0 | -1
  onPress?: (event: Located) => void
  children?: Element
}
export declare function Text(props: TextProps): Element

export type ImageProps = Pick<Semantics, "aria-hidden"> & {
  src: string
  /** The picture where the window is dark, as HTML's `<source media="(prefers-color-scheme: dark)">` is. */
  srcDark?: string
  alt: string
  style?: Styles
}
export declare function Image(props: ImageProps): Element

export type SvgProps = Pick<Semantics, "role" | "aria-label" | "aria-hidden"> & {
  viewBox: string
  style?: Styles
  children?: Element
}
export declare function Svg(props: SvgProps): Element

export type PathProps = {
  d: string
  /** Its `fill`, `stroke` and `strokeWidth`. */
  style?: Styles
}
export declare function Path(props: PathProps): Element

/** A screen's live video over WebRTC, which sends what's done on it to the screen itself (renderer.ts's `video`): the
 * page does its signalling, a new `ice` connecting, its `offer` answered with the screen's `answer`. */
export type VideoProps = {
  ice?: Ice
  answer?: string
  /** Looked at only: nothing done on it is sent. */
  watch?: boolean
  "aria-label": string
  /** Has the keyboard, what's typed going to the screen, each time it's set. */
  autoFocus?: boolean
  style?: Styles
  onOffer?: (event: { sdp: string }) => void
  onState?: (event: { state: "connected" | "lost" }) => void
  /** The video's own size, in its pixels, as it comes and changes. */
  onSize?: (event: { width: number; height: number }) => void
}
export declare function Video(props: VideoProps): Element

/** An audio input or output device a `voice` can use. */
export type VoiceDevice = {
  id: string
  label: string
}

/** A call's audio over WebRTC, which the host connects and plays (renderer.ts's `voice`): the page does its
 * signalling, a new `ice` connecting, its `offer` answered with the screen's `answer`, and an SFU's `offer` answered
 * as `onAnswer`. It draws nothing. */
export type VoiceProps = {
  ice?: Ice
  answer?: string
  /** An SFU's SDP offer, which the host answers, telling `onAnswer`. */
  offer?: string
  /** The microphone isn't sent. */
  muted?: boolean
  /** The audio input device id (empty or omitted for system default). */
  input?: string
  /** The audio output device id (empty or omitted for system default). */
  output?: string
  onOffer?: (event: { sdp: string }) => void
  onAnswer?: (event: { sdp: string }) => void
  onState?: (event: { state: "connecting" | "connected" | "lost" }) => void
  /** Whether the person is speaking, as the microphone's level says. */
  onSpeaking?: (event: { speaking: boolean }) => void
  /** Available audio input and output devices, once permission is granted and whenever devices change. */
  onDevices?: (event: { inputs: VoiceDevice[]; outputs: VoiceDevice[] }) => void
}
export declare function Voice(props: VoiceProps): Element

/** Another app's page, in a box of this one's, as an iframe is (renderer.ts's `frame`): `src` as a `one:` link names
 * it after its scheme, for `subject`, or whoever this page is for. Only a trusted app's page shows one. */
export type FrameProps = {
  src: string
  subject?: string
  /** What it is, its accessible name. */
  title?: string
  style?: Styles
}
export declare function Frame(props: FrameProps): Element

/** What's drawn over the whole window, over the page, while it's `visible` (unless it says, it is), with everything
 * else inert: a sheet, a menu. */
export declare function Modal(props: { visible?: boolean; children?: Element }): Element
/** What's drawn over the whole window, over the page, without taking it from anyone: a toast, a select's list. */
export declare function Portal(props: { children?: Element }): Element

/** What an input's action key says, a phone keyboard's Done, Go, Next, Search or Send, or a new line (`enter`). */
export type EnterKeyHint = "enter" | "done" | "go" | "next" | "previous" | "search" | "send"

export type TextInputProps = Pick<Semantics, "role" | "aria-label" | "aria-description" | "aria-invalid" | "aria-controls" | "aria-activedescendant" | "aria-expanded"> & {
  name?: string
  value?: string
  /** Which keyboard a touch screen shows: `numeric` is digits alone; `email`, `url`, `tel` and `search` are those kinds
   * of field too. */
  inputMode?: Props["inputmode"]
  /** What's typed is hidden, as a password's. */
  secureTextEntry?: boolean
  multiline?: boolean
  placeholder?: string
  /** What its action key says and does: `done` in one line unless it says, a new line in several. */
  enterKeyHint?: EnterKeyHint
  disabled?: boolean
  readOnly?: boolean
  /** All its text is selected as it takes the keyboard, so what's typed replaces it, as React Native's `selectTextOnFocus` does. */
  selectTextOnFocus?: boolean
  required?: boolean
  autoFocus?: boolean
  autoCapitalize?: Props["autocapitalize"]
  autoCorrect?: boolean
  spellCheck?: boolean
  autoComplete?: string
  style?: Styles
  /** What's in it now, each time that changes. */
  onChangeText?: (text: string) => void
  /** Its action key was pressed: Return in one line, or a phone's Done, Go, Search or Send. */
  onSubmitEditing?: () => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (event: Keyed) => void
}
export declare function TextInput(props: TextInputProps): Element

// The components.

// Props are types, not interfaces, so the DOM's components, which take any `data-` attribute too, take them.

export declare function render(code: () => Element): () => void

/** One of a screen's tips: one idea in a few words, a sentence, and keys drawn as keycaps or a picture of the app's own. */
export type Tip = { title: string; body: string; keys?: string[]; picture?: string }
/** One of a screen's floating actions: an icon, its name (which the trailing one shows too) and what pressing it does. */
export type FloatingAction = { icon: IconName; label: string; onPress: () => void; disabled?: boolean; primary?: boolean }
export declare function Screen(props: { heading?: Element; action?: Element; floatingActions?: { leading?: FloatingAction[]; trailing?: FloatingAction }; tips?: Tip[]; back?: boolean; onBack?: () => void; largeTitle?: boolean; readable?: boolean; children?: Element }): Element
/** One thing to do at the tips' foot: what it says, an icon, and what does it. */
export type Action = { label: string; icon?: IconName; onAction: () => void }
export declare function Tips(props: { tips: Tip[]; action?: Action }): Element
export declare function Section(props: { heading?: Element; "aria-label"?: string; children?: Element }): Element
/** A row that scrolls sideways from the window's edge to its edge, its first item where the screen's column starts (`style` may say its `gap`). */
export declare function Shelf(props: { role?: "group" | "toolbar" | "list"; "aria-label"?: string; style?: Styles<"gap">; children?: Element }): Element
/** What's open in it is a screen of the page's: `open={toolInput("notes_list").name === "notes_note"}`, opened with
 * `navigate("notes_note", { id })` and closed with `navigate("notes_list")`, which is Back to where it came from. */
export declare function Split(props: { open?: boolean; onClose?: () => void; pick?: string; detail?: Element; children?: Element }): Element
/** Where a window's Back and Forward go (`History`), which its screens draw in their bar. */
export declare function History(props: { value: { back?: () => void; forward?: () => void } | null; children: Element }): Element
/** A listbox: which of its rows is chosen, and what's typed in that drives it (`createListbox`). */
export interface Listbox {
  readonly id: string
  chosen: () => number
  choose: (index: number) => void
  field: () => { role: "combobox"; "aria-controls": string; "aria-expanded": "true" | "false"; "aria-activedescendant"?: string }
  keys: (event: Keyed) => boolean
}
export declare function createListbox(): Listbox
/** How fast a finger was going as it lifted, from its moves (`createVelocityTracker`): `add` each move, then
 * `velocity` as it lifts, in pixels a millisecond. */
export declare function createVelocityTracker(options?: { horizon?: number; staleAfter?: number; maxSpeed?: number; capacity?: number }): {
  add(time: number, position: number): void
  velocity(now: number): number
  reset(): void
}
/** How far something let go at `velocity` (px/ms) goes on by itself, slowing as a phone's scrolling does: UIKit's
 * normal deceleration rate unless `rate` says. Where it would carry on to is where a page lands, as an iPhone's do. */
export declare function projected(velocity: number, rate?: number): number
export declare function List(props: { listbox?: Listbox; label?: string; children?: Element }): Element
export declare function List<T>(props: { listbox?: Listbox; label?: string; each: readonly T[]; keyed?: (item: T) => unknown; children: (item: () => T, index: () => number) => Element }): Element
export declare function ReorderList<T>(props: { label: string; each: readonly T[]; keyed: (item: T) => string; heading: (item: T) => string; fixed?: (item: T) => boolean; onReorder: (items: T[]) => void }): Element
/** How the lists in it are drawn (`ListStyle`): plain, inset grouped cards, or a window's sidebar. */
export declare function ListStyle(props: { value: "plain" | "insetGrouped" | "sidebar"; children: Element }): Element
export declare function Row(props: {
  heading?: Element
  text?: Element
  /** Beside the heading, on its line. */
  badge?: Element
  /** One small grey line under the text. */
  meta?: Element
  start?: Element
  end?: Element
  /** Pressed, with where it's drawn; Return in a listbox opens it with none. As React Native's `onPress`. */
  onPress?: (event?: Located) => void
  current?: boolean
  control?: Element
  action?: Element
  /** Something destructive it does, its heading red. */
  destructive?: boolean
  /** `false` for a row that opens what isn't a page of the app, as iOS Reminders' rows have none. */
  chevron?: boolean
}): Element

export type IconName =
  | "sparkle" | "camera" | "image" | "scan" | "file-pdf" | "file-arrow-up" | "receipt" | "folder" | "folder-open" | "envelope-simple" | "paper-plane-tilt" | "clock-counter-clockwise" | "user" | "bank" | "credit-card" | "arrow-square-out" | "link" | "upload-simple" | "info" | "arrows-merge" | "arrows-split" | "file-zip" | "list-checks" | "hourglass" | "currency-dollar" | "files"
  | "arrow-counter-clockwise" | "arrow-down" | "arrow-elbow-down-left" | "arrow-up" | "calendar-blank" | "caret-down" | "caret-left" | "caret-right" | "caret-up-down" | "check" | "check-circle" | "check-circle-fill" | "copy" | "corners-in"
  | "corners-out" | "device-mobile" | "devices" | "dots-three" | "dots-three-circle" | "download-simple" | "file" | "flag" | "flag-fill" | "gear-six" | "globe" | "hard-drives" | "list" | "magnifying-glass" | "minus" | "minus-circle"
  | "paperclip" | "pencil-simple" | "plus" | "plus-circle" | "question" | "robot" | "squares-four" | "terminal-window" | "trash" | "video-camera" | "warning-circle" | "x"
export declare function Icon(props: { name: IconName; along?: boolean; large?: boolean }): Element
export declare function Spinner(props: { delay?: boolean }): Element

export type ButtonProps = {
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive"
  size?: "icon"
  /** Its ends rounded fully, as SwiftUI's capsule: a button that is a pill of its own. */
  shape?: "capsule"
  loading?: boolean
  disabled?: boolean
  "aria-label"?: string
  "aria-haspopup"?: "menu" | "dialog" | "listbox"
  "aria-expanded"?: "true" | "false"
  autoFocus?: boolean
  /** What pressing it does, as React Native's `onPress`. */
  onPress?: (event: Located) => void
  onLayout?: (event: Laid) => void
  /** Where it sits in what it's in, the only part of its look a caller changes. */
  style?: Styles<"marginTop" | "marginBottom" | "marginStart" | "marginEnd" | "alignSelf" | "flexGrow">
  children?: Element
}
export declare function Button(props: ButtonProps): Element
/** A face a group's avatar is drawn with: one of its members, and their picture where they have one. */
export type Face = { subject: string; name?: string; picture?: string | null }
/** Who or what a thing is, as a picture or its initials: a person's (`users/…`), round; the network's (`network`), as an app's icon; a group's (`groups/…`), up to four of its members' faces, or its initials on a rounded square with no one in it. `faces` are drawn as they are, where they're known already (a scene's). */
export declare function Avatar(props: { subject: string; name?: string; size?: "small" | "medium" | "large"; faces?: Face[] }): Element
/** Has every avatar ask for its picture again, as it's set or changed in this page. */
export declare function refreshAvatars(): void
export declare function Badge(props: { variant?: "default" | "secondary" | "destructive" | "outline"; tone?: "blue" | "green" | "orange"; "aria-label"?: string; children?: Element }): Element

export declare function Empty(props: { action?: Element; children?: Element }): Element
/** Where files dragged from the computer's own are dropped: tinted, saying "Drop to add", while they're over it, and
 * `onDrop` told those of `accept`'s kinds. Without `children`, a dashed area with `label` and Choose Files…. */
export declare function DropZone(props: { onDrop: (files: File[]) => void; accept?: string[]; multiple?: boolean; label?: string; children?: Element }): Element
export declare function Problem(props: { heading: Element; text?: Element | Error; action?: Element; warn?: boolean }): Element
export declare function Status(props: { heading: Element; text?: Element; over?: boolean }): Element
export declare function Steps(props: { steps: Element[]; at: number; text?: Element }): Element
export declare function Stepper(props: { steps: Element[]; at: number; dots?: boolean }): Element
/** The one screen someone signs in on: whose it is, a heading, what they compare or are warned of, and one button. */
export declare function SignIn(props: {
  mark?: string | Element
  heading?: Element
  button?: Element
  quiet?: boolean
  onSignIn?: () => unknown
  problem?: Element
  code?: Element
  note?: Element
  warning?: Element
  stop?: Element
  onStop?: () => unknown
  beside?: boolean
  done?: Element
  status?: Element
  children?: Element
}): Element

export declare function Field(props: { label?: Element; hint?: Element; error?: string; disabled?: boolean; children?: Element }): Element
/** An `Input`'s props: a text input's, in a field's box, with styles of its own over it. */
export type InputProps = Omit<TextInputProps, "style" | "multiline"> & {
  style?: Styles
}
export declare function Input(props: InputProps): Element
export declare function Textarea(props: Omit<InputProps, "style">): Element
export declare function Search(props: Omit<InputProps, "inputMode" | "style">): Element
/** A `Checkbox`'s or a `Switch`'s props: whether it's on (`value`), and what's told when it changes, as React
 * Native's `Switch` has them. */
export type ChoiceProps = {
  label?: Element
  hint?: Element
  error?: string
  value?: boolean
  disabled?: boolean
  "aria-label"?: string
  onValueChange?: (value: boolean) => void
}
export declare function Checkbox(props: ChoiceProps): Element
export declare function Switch(props: ChoiceProps): Element
export declare function RadioGroup(props: {
  value?: string
  options: { value: string; label: Element; disabled?: boolean }[]
  disabled?: boolean
  onValueChange?: (value: string) => void
}): Element

/** What a select chooses from, and what it's told of what's chosen, as React Native's `Picker` has them. */
export type Choice = { value: string; label: string; disabled?: boolean }
export declare function DatePicker(props: { value?: string; placeholder?: string; disabled?: boolean; "aria-label"?: string; onValueChange?: (value: string) => void }): Element
export declare const Select: {
  Root: (props: {
    items: Choice[]
    value?: string
    defaultValue?: string
    placeholder?: string
    disabled?: boolean
    "aria-label"?: string
    onValueChange?: (value: string) => void
  }) => Element
}

/** What a `LiveScreen` is told: its `action`, and what that action takes, as Computer Use's screens have them. */
export type ScreenInputs = { action: string } & Record<string, unknown>
export declare function LiveScreen(props: { label: string; screen?: (inputs: ScreenInputs) => Promise<unknown>; watch?: boolean; children?: Element }): Element

export declare function Alert(props: { heading: Element; text?: Element; open?: boolean; onClose?: () => void; action?: Element; children?: Element }): Element

/** What only its person's own device may do: its `children` (the action) as they are, and in an assistant's chat (`inChat`)
 * the way to do it there instead, `link` as a button and a code. */
export declare function OwnDevice(props: { what: string; link: string; children: Element }): Element

/** Where a person signs in to an outside service, from the `url` a tool that starts an OAuth sign-in answered: a button that
 * opens it in their own browser, then "Signed in as …" or what went wrong, by itself as it ends. */
export declare function ServiceSignIn(props: { url: string }): Element

export declare function Sheet(props: { heading?: Element; open?: boolean; onClose?: () => void; children?: Element }): Element

export declare const PresentationContext: Context<() => Rect | undefined>


export declare const Metadata: ((props: { children?: Element }) => Element) & { Label: (props: { title: Element; text?: Element }) => Element }

/** Values as bars over their labels, or with `kind="line"` a line, up to `max`, in the text's colour: `highlight` picks
 * one bar out, the rest fainter; `figures` says each bar's value over it. It fills its room, which `style`'s `height` sets. */
export declare function Chart(props: {
  values: number[]
  labels?: string[]
  kind?: "bar" | "line"
  max?: number
  highlight?: number
  figures?: boolean
  label?: string
  style?: Styles<"height" | "flexGrow" | "alignSelf" | "marginTop">
}): Element
/** A count and what it counts, pressed to show those, as iOS Reminders' lists are: filled while it's `chosen`, a
 * `colour` dot before its label, and a grey `note` under it. */
export declare function Tile(props: { value: number; label: string; note?: string; colour?: `#${string}` | null; chosen?: boolean; onPress?: () => void }): Element
/** One event of a `TimeGrid`: where it starts and ends in its day, in minutes from midnight, its title, a grey line,
 * its own colour from data, whether it's over, something to do with it, and what a press does. */
export type TimeGridEvent = { id: string; start: number; end: number; title: string; text?: string; colour?: `#${string}` | null; over?: boolean; action?: Element; onPress?: () => void }
/** A day's column of a `TimeGrid`, with its events. */
export type TimeGridDay = { key: string; weekday: string; date: number | string; today?: boolean; events: TimeGridEvent[] }
/** What takes whole days, from the column `from` to the column `to`. */
export type TimeGridAllDay = { id: string; title: string; from: number; to: number; colour?: `#${string}` | null; onPress?: () => void }
export declare function TimeGrid(props: { days: TimeGridDay[]; hours?: [number, number]; allDay?: TimeGridAllDay[]; now?: number | null; selected?: string; onSelect?: (key: string) => void; header?: boolean }): Element

export declare const Menu: {
  Root: (props: { open?: boolean; onOpenChange?: (open: boolean) => void; onSelect?: (value: string) => void; children?: Element }) => Element
  Trigger: (props: { variant?: ButtonProps["variant"]; size?: "icon"; shape?: ButtonProps["shape"]; "aria-label"?: string; children?: Element }) => Element
  Positioner: (props: { children?: Element }) => Element
  Content: (props: { children?: Element }) => Element
  Item: (props: { value: string; destructive?: boolean; disabled?: boolean; children?: Element }) => Element
  /** Items under a small heading, as iOS's menus group them. */
  Group: (props: { label: Element; children?: Element }) => Element
  Separator: (props: {}) => Element
}

export declare const Tabs: {
  Root: (props: { value?: string; defaultValue?: string; onValueChange?: (value: string) => void; children?: Element }) => Element
  List: (props: { children?: Element }) => Element
  /** `icon` goes before its words, as a picture of what it is. */
  Trigger: (props: { value: string; icon?: Element; children?: Element }) => Element
  Content: (props: { value: string; children?: Element }) => Element
  Indicator: (props: {}) => Element
}

/** A widget's layout, as its tool answers it (the skill `building-apps` lists its parts). */
export type Layout = { [part: string]: unknown }
export declare function Widget(props: {
  name?: string
  size?: "2x2" | "4x2" | "4x4"
  layout?: Layout
  problem?: string
  onCall?: (tool: string | undefined, inputs: Record<string, unknown>) => unknown
  /** Pressed, with where the card is drawn, which the app it opens grows out of. */
  onOpen?: (card: { getBoundingClientRect(): Rect }) => void
}): Element

// Scenes: a component's or a screen's states, named, each drawn as it is with what it shows, for the gallery
// (clients/app/renderer/tests/gallery) and for drawing each natively and on the web (clients/app/renderer/tests/screenshot.js). A scene is what to
// draw, or that with what to press first (`taps`, by what each is named or says), whether it's drawn only by itself
// (`alone`: something over the page), drawn edge to edge in its window, as a whole screen is, rather than inset in it
// (`layout: "fullscreen"`, as Storybook's), how big its window is (`size`, a phone's 390 × 844 unless said) and whether a
// finger points at it (`touch`: a window under 600 wide is a phone's unless it says `false`), what its window keeps at each
// edge (`safeArea`, top, right, bottom and left: a phone's status bar and home indicator, an iPhone's for a touch scene), whether it's a Mac's
// app window with its title row over the page (`titleRow`), where a press on what's empty moves the window, whether its page has drawn nothing yet, as its app's window shows its icon (`launching`), the gestures played on it, frame by frame (`motions`, clients/app/renderer/tests/animation.js), and what
// people do with it and what must hold as they do (`checks`, `bun animation.js --checks`), with the seeds a check once
// failed on (`seeds`). A page that logs an error fails the scene, as a browser's console does a test, but for the
// words a scene that shows an error says it logs (`errors`: "Couldn't reach the network"). Its name is its family's and its own: "Buttons/Variants".
export type Scene =
  | (() => Element)
  | { render: () => Element; taps?: Tap[]; alone?: boolean; layout?: "fullscreen"; size?: [number, number]; touch?: boolean; errors?: string[]; safeArea?: [number, number, number, number]; titleRow?: boolean; launching?: boolean; motions?: Record<string, Motion>; checks?: Record<string, CheckStep[]>; seeds?: number[] }
/** A step of a check, as a test's (Playwright's, the UI SDK's): what's done, as a tap is (pressed, a key, typed), a
 * press held `hold` ms or tapped `clicks` times (an `agent`'s comes as an agent's request to a device's window does, by the inspector, though
 * nobody could press it, as on a panel put away), the pointer moved onto something (`hover`), a button held `down` on something and let go (`up`), input played as
 * a device delivered it (`trace`, a JSON file of `{ ms, kind, … }` beside the scenes, as the headless renderer's `trace` takes
 * it: a trackpad's swipe with its phases and momentum, the pointer's nudges, a finger's `touch`es, each with its
 * `phase`), time passing (`wait`, ms), the app in the background that long and back (`away`, ms), which fails where it
 * draws meanwhile, as a phone's GPU refuses that, a panel put away or summoned (`putAway`, `summon`), or the device's own
 * Back (`back`), as Android's key is; the window made `[width, height]` points (`resize`), as a phone turns or its
 * system lays its window out from nothing, 0 tall; the client's answers changed to these tools' and the page told that something
 * changed (`answers`, as an update going away is), a server restarting for `restart` ms, every tool refusing
 * meanwhile, then answering as the scene's do with `answers` on top, or what must
 * hold then (`expect`), waited for a second, or `within` ms. */
export type CheckStep = Tap | { press: Tap; hold?: number; clicks?: number; agent?: true } | { hover: Tap } | { down: Tap } | { up: true } | { trace: string } | { wait: number } | { away: number } | { putAway: true } | { summon: true } | { back: true } | { resize: [number, number] } | { answers: Record<string, unknown> } | { restart: number; answers?: Record<string, unknown> } | { expect: Expect; within?: number }
/** What must hold: what's drawn whole and in the window (`shown`), what isn't there (`gone`), what has the keyboard
 * (`focused`), words somewhere on it (`text`), a node's states (`states`: `{ of, is: { expanded: true } }`), how opaque
 * it's drawn (`drawn`: `{ of, opacity }`, a pressed look), the glass's blur drawn or not (`blur`), what's over the page dimming it (`dimmed`, as a sheet's or an alert's scrim does), and what the input with the
 * keyboard asks the platform's keyboard for (`keyboard`, as Flutter's `TextInputConfiguration` says it to iOS and
 * Android: `{ textCapitalization: "TextCapitalization.none", autocorrect: false }`), and every text drawn in the window
 * at least `margins` points in from its sides, as a page's margins keep it, and what's drawn as tall as it should be (`tall`:
 * a node of that name, `height` points, within one), as a type size is; every text in sight drawn whole, none cut
 * short with "…", or the one named (`whole`); these texts each as wide a character as the others, as a monospace face's
 * are (`monospace`: the texts, each on one line); no line of a text ending inside a run a pattern finds, as a date is kept
 * on one line (`unbroken`: a regular expression's source); what's named drawn to both of the window's edges (`bleeds`), as a
 * shelf is; every node named the same distance along its row from the window's end, or its start with `at: "start"`, or its middle with `at: "middle"`
 * (`aligned`: `{ of, with?, at? }`), as controls at the end of rows form a column; nothing of what's named or inside it clipped away (`unclipped`), as a badge
 * overhanging its icon is drawn whole; what's named clear of what's in `from`, inert or not, as a page's arrow is of the content, and what isn't drawn is (`apart`: `{ of, from }`); what's named in the middle of the window across, within a point
 * (`centred`); nothing named so wider than `most` points (`widest`: `{ of, most }`); what's named standing off what's
 * around it by at least `least`:1 and at most `most`:1 (a chosen row's fill is a tint, not a heavy grey), WCAG's contrast between the colour just outside its start and its first 4 points in,
 * where a control's ring or a card's edge is (`contrast`: `{ of, least }`); each text named drawn where the inspector's rect for it
 * is, its glyphs inside the rect, whatever moves, grows or turns it (`located`); and what a phone's system is asked to show of
 * a finger's selection: its menu for text with these items, inside the safe area, or none (`textMenu`:
 * `{ items: ["cut", "copy", "paste", "selectAll"] }`, or false), so many handles drawn (`handles`), and its magnifier
 * or not (`magnifier`), what's over the page dimming it (`dimmed`, as a sheet's or an alert's scrim does), and at most `js`
 * MB held by its page's JS, collected first (the inspector's `js_bytes`), as a page that keeps what it no longer shows
 * grows past it, whether `settle` says it's `settled`, and where something is drawn (`at`: `{ of, x, y, width }`, each
 * given in points, within one), so what comes in above it is seen not to push it, and a bar's glass is seen to reach the
 * window's edges, and how many times the page has asked for a tool (`asked`: `{ "<tool>": 1, "<tool> for <subject>": 2 }`),
 * as a check that it doesn't ask again, and what's named, rounded `radius` points and clipping what's in it, showing nothing
 * past its rounding, as CSS clips it (`rounded`: `{ of, radius }`), and the same material to its corners as along its edges, none of what's
 * drawn outside its arc pulled in by a blur (`even`: `{ of, radius, most }`, levels of a channel), and a press reaching what's drawn where it
 * lands, everywhere in the window, however what's pressed is moved, grown, scrolled, clipped or stacked (`hits`: each pressable
 * square, in a colour of its own, with nothing of another colour over it), and what's selected of the text that isn't a field, as
 * it would be copied, or nothing (`selected`: the words, or false). */
export type Expect = { shown?: Tap; gone?: Tap; focused?: Tap; text?: string; states?: { of: Tap; is: Record<string, boolean | string> }; drawn?: { of: Tap; opacity: number }; blur?: boolean; dimmed?: boolean; keyboard?: Record<string, unknown>; margins?: number; tall?: { of: Tap; height: number }; whole?: true | Tap; unbroken?: string; monospace?: string[]; unclipped?: Tap; apart?: { of: Tap; from: Tap }; bleeds?: Tap; aligned?: { of: Tap; with?: Tap; at?: "start" | "end" | "middle" }; centred?: Tap; widest?: { of: Tap; most: number }; contrast?: { of: Tap; least?: number; most?: number }; located?: Tap[]; textMenu?: { items?: string[] } | false; handles?: number; magnifier?: boolean; js?: number; asked?: Record<string, number>; settled?: boolean; at?: { of: Tap; x?: number; y?: number; width?: number }; rounded?: { of: Tap; radius: number }; even?: { of: Tap; radius: number; most: number }; hits?: true; selected?: string | false }
/** A press that goes down on what `from` names (as a tap does) and moves as `gesture` says, or input played as a device
 * delivered it (a `trace` file of events, as a check's `trace`), with what's watched move (`follow`, named as a tap is;
 * what scrolls under it is always watched). `steady`: what moves never goes back against its way before its input
 * ends, as a swipe that bounces does. `frameMs`: its frames drawn only that often,
 * as a device others load draws them (Telemetry's frame interval), which presses it as a window's late frames do.
 * `blurred`: glass shows blurred in every frame after its first, as a veil it opens does. `keeps`: the tier of
 * clients/app/renderer/tests/devices.json whose budget each of its frames keeps, at that tier's rate, the frames a press lands and lifts
 * on too, their JS, painting and GPU as that device would take them. `opensFrom`: what `follow` names is first drawn from
 * where this is, its top and its middle there (within a point), as an iPhone's folder grows out of its square and its
 * apps out of the square's. `shows`: what it names is drawn from the frame what `follow` names has landed, as a folder's
 * apps are handed back to its square as they get there. `sized`: the badge at the corner of what `follow` names is as wide in every frame as in the first, as a badge isn't scaled with its app. `located`: the glyphs of what `follow` names are inside its rect in every frame, as the inspector's rect for a text is where it's drawn however it's moved, grown or turned. `sharp`: the words of what `follow` names are drawn as sharp in every frame as where they come to rest, as SwiftUI draws a text moved and grown: its glyphs where they are, never a picture of them grown, softer. `apart`: no two icons of what it names cover each other by more than a tenth, in any frame, as apps flying to their places don't cross over each other. `named`: what it names (a square's captions) is never seen in a frame where an icon of what `apart` names is still on its way, as a folder's captions come in as its icons land. `holds`: what it names is drawn in every frame while what `follow` names is on its way, as a folder's apps are drawn flying, not handed over before. `seamless`: the last frame any of `apart`'s is drawn in and the one after it look the same around each of them (within a level of each colour), as a folder's apps are handed back to its square unseen. `onward`: what `follow` names never goes back against its way in any frame. `reducedMotion`: played with the
 * system's Reduce Motion on. `before`: a check's steps done first, at their own times (`wait`), as a person does them,
 * mid-motion too: an app opened over the Home Screen and closed again (`back`), whatever opens drawn by the app the
 * scene's `opens` says. `once`: what it names is never seen
 * twice in a frame, whether a screen reader reads it or not, as a large title and its bar's small one are cross-faded.
 * However it's played, what it takes out is gone once it settles, and what a press lets go moves on from where the
 * finger last showed it, no frame as it's let go jumping further than the finger moved in a refresh or the frame after
 * goes on, as UIScrollView's deceleration and SwiftUI's spring do. */
export type Motion = { from?: Tap; gesture: Gesture; before?: CheckStep[]; follow?: Tap; frameMs?: number; blurred?: boolean; steady?: boolean; keeps?: string; opensFrom?: Tap; once?: Tap; shows?: Tap; holds?: Tap; apart?: Tap; seamless?: boolean; sized?: boolean; located?: boolean; sharp?: boolean; reducedMotion?: boolean; onward?: boolean; named?: Tap }
/** How a press moves, in points and points a second: swiped at a steady `speed` (800 unless said) and let go; flung,
 * a short quick flick; dragged with `pauses` of a fifth of a second along the way; a sheet pulled down and let go; or
 * each stretch it moves (`moves`, a stretch with neither `dx` nor `dy` holding still), held at the end unless `lift`. */
export type Gesture =
  | { swipe: [number, number]; speed?: number }
  | { fling: [number, number] }
  | { drag: [number, number]; pauses?: number; speed?: number }
  | { pull: number }
  | { moves: { dx?: number; dy?: number; ms: number }[]; lift?: boolean }
  | { trace: string }
/** What's done, in order (clients/app/renderer/tests/screenshot.js runs them): pressed by what it's named or says, or that and its role
 * where a name alone is two things (a field's label and its select), or by its role alone (the menu open), or by the words it
 * says (`text`), each in its middle or `position` points from its top left, as Playwright's; a point pressed; a key as the DOM names it, with
 * any of `ctrl`, `shift`, `alt` or `meta` held; or text typed where the keyboard is. */
export type Tap =
  | string
  | { role: string; name?: string; position?: { x: number; y: number } }
  | { text: string; position?: { x: number; y: number } }
  | { x: number; y: number }
  | { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
  | { type: string }
  /** Files from the computer dragged over what's named (`drag`), or dropped there (paths on the machine drawing it). */
  | { files: "drag" | string[]; role?: string; name?: string; text?: string }
export type Scenes = Record<string, Scene>

// What an app asks for in passing.

export type Subject = {
  subject?: string
}
export declare function call(tool: string, inputs?: object, options?: Subject): Promise<string>
/** Sends a file the person chose where the network keeps it, for a tool of this app's: the name that tool takes for it,
 * in the input its app says is an upload. */
export declare function upload(file: File | Blob): Promise<string>
/** The device's own picker of files to open, from a press: of `accept`'s kinds (`.png`, `image/*`), one or
 * `multiple`. → the files chosen, none where it was cancelled. */
export declare function pickFiles(options?: { accept?: string[]; multiple?: boolean }): Promise<File[]>
/** The device's own document scanner, from a press: it finds each page's edges, takes it by itself, flattens it and scans
 * as many in a row as its person likes. → a JPEG file a page, in order, none where it was cancelled. A device without
 * one takes a photo, or asks for image files as `pickFiles` does. */
export declare function scanDocuments(): Promise<File[]>
/** `changed(() => refresh(notes))`: runs `listener` whenever what this page was answered has changed, to ask again and
 * draw it, but not while the page isn't shown (`visible`): a change then is told once, as it's shown again, as a
 * browser's background tab does nothing until it's looked at. → the function that stops it. */
export declare function changed(listener: () => void): () => void
/** `memoryWarning(() => setKept([]))`: runs `listener` as the page holds nearly all the memory it may have, for it to
 * let go of what it can make again, as iOS's `didReceiveMemoryWarning` tells an app. A browser never tells it. → the
 * function that stops it. */
export declare function memoryWarning(listener: () => void): () => void
export declare function toast(text: string | Error, options?: { action?: { label: string; run: () => void } }): Promise<void>
export declare function confirm(question: { heading: string; text?: string; action?: string; destructive?: boolean }): Promise<boolean>
/** `behind` only starts it, as a finger lands on its icon; `from` is where its icon or widget is drawn, with its corners'
 * `radius`, which it grows out of. */
export declare function open(app: string, options?: Subject & { behind?: boolean; from?: Rect & { radius?: number } }): Promise<unknown>
export declare function leave(): Promise<void>
export declare function link(): string | undefined
/** What a tool answered, as MCP's `CallToolResult` has it, where the page is shown for it. */
export interface ToolResult {
  structuredContent?: any
  content?: { type: string; text?: string }[]
  isError?: boolean
  /** What the network says of the answer (`_meta`): a widget's tool says which widget it is, `widget`. */
  _meta?: Record<string, unknown>
}
/** `createEffect(toolResult, (shown) => shown && setWeek(shown.structuredContent.offset))`: what a tool answered, where
 * the page is shown for it, as an assistant shows a tool's page as an MCP App; none in an app's own window. */
export declare function toolResult(): ToolResult | undefined
/** A tool and its arguments, as MCP's `tools/call` names them: a screen of an app (`toolInput`). */
export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}
/** `createProjection(() => call("my-week_week", toolInput("my-week_week").arguments).then(JSON.parse))`: the screen the page shows, as the tool that answers it and its arguments,
 * as it changes: what a link to the page names, what an assistant called, or where the page navigated; `first`, with
 * no arguments, where nothing names one. */
export declare function toolInput(first: string): ToolCall
/** `navigate("my-week_week", { start })`: shows another of the app's screens, a step Back goes back from, which a
 * browser's address says (`/my-week/week?start=2026-11-30`); `{ replace: true }` in place of the screen it's on. */
export declare function navigate(name: string, inputs?: Record<string, unknown>, options?: { replace?: boolean }): void
export declare function component(app: string, name: string): Promise<Record<string, (props: Record<string, unknown>) => Element>>
export declare function showRecoveryKey(options?: Subject): Promise<boolean>
export declare function useRecoveryKey(options?: Subject): Promise<boolean>
export declare function go(change: () => void, options?: { back?: boolean }): void
export declare function share(text: string): Promise<"shared" | "copied" | undefined>
/** Puts `text` on the device's clipboard, as a Copy button does, which its client does: a page has none of its own. */
export declare function copy(text: string): Promise<void>
/** All of what was thrown, as a problem's Show Details has it: a tool's whole error, a message, or what was thrown and where from where it says nothing. */
export declare function whole(error: unknown): string
export declare function date(at: string | number | Date): string
export declare function plural(count: number, one: string, other?: string): string
export declare function seen(at: string | number | Date): string
export declare function since(at: string | number | Date, style?: "long" | "narrow"): string
export declare function size(bytes: number): string
export declare function haptic(kind: "light" | "medium" | "heavy" | "rigid" | "soft" | "selection" | "success" | "warning" | "error"): void
/** Plays a short sound, a WAV or an MP3 file of the app's named as an image is, on the device's speakers. */
export declare function play(src: string): Promise<void>
export declare function connection(): "connecting" | "online" | "offline" | "reconnecting"
/** Whether this page is shown, as it changes: not while its person is in another app, as their device's Settings. */
export declare function visible(): boolean
/** Whether its person is away from this device, as it changes: its screen is locked, it's asleep, or nobody has
 * touched its keyboard or pointer for five minutes, as a computer's idle time says. A device that can't tell never is. */
export declare function idle(): boolean
/** What `menuBarExtra` changes of the app's icon in a computer's menu bar: the `title` beside it (`null` for none), its
 * `icon`, one of Phosphor's by its name (`"microphone"`, `"moon-fill"`), or `null` for the app's own, and whether its
 * panel is `open`. */
export type MenuBarExtra = { title?: string | null; icon?: string | null; open?: boolean }
/** Changes the app's menu bar extra (`menu_bar_extra/0`), where its device has one: elsewhere it does nothing. */
export declare function menuBarExtra(change: MenuBarExtra): Promise<void>

/** What `client()` answers: what this device is, and what it can do that an app asks of it. */
export type Client = {
  device: string
  network?: string
  build: string
  /** The runtime version its renderer draws (`RUNTIME_VERSION`), from 6: a page that needs what a newer one draws
   * shows it only where it's said and as new. */
  runtimeVersion?: number
  /** This device as a server, while it is one or is becoming one: its key, and where becoming one or stopping being
   * one is. */
  server?: {
    key: string
    server_membership: "joining" | "active" | "leaving"
    server_membership_stage?: "registering" | "downloading" | "installing" | "starting" | "draining" | "deregistering" | "uninstalling" | null
  }
  push?: { state: "notAsked" | "denied" | "registering" | "registered" | "homeScreen" } | { state: "failed"; why: string }
  computerUse?: { on: boolean }
  /** Whether a computer's app opens when its person logs in, as the system says; null where this device or build has none. */
  login?: boolean | null
  /** A computer's launcher's shortcut, in global-hotkey's words (`alt+Space`, `shift+control+KeyK`): what it is now,
   * null while it has none, and what it is where its person hasn't chosen one; null on a phone. */
  shortcut?: { keys: string | null; default: string } | null
  /** Every network's app running on this computer, this one too (`current`), by name, as a launcher switches between
   * them: each one's identifier, name and logo (a `data:` address, or null); null on a phone. */
  networks?: { identifier: string; name: string; logo: string | null; current: boolean }[] | null
  theme: "light" | "dark" | null
  pinsShortcuts?: boolean
  settings?: boolean
  launcher?: boolean
  /** Whether the launcher's panel is see-through where its page draws nothing, so what it draws floats over the
   * desktop, on the system's glass where it asks for it (`tokens.material.window`). */
  transparent?: boolean
  /** Whether this is an app's menu bar extra's page, in its panel (`menu_bar_extra/0`): false in its window, and not said
   * where a device has no menu bar, a phone or a browser. */
  menuBarExtra?: boolean
  /** Whether it's a Mac (or an iPhone or iPad), whose keys are ⌘ where a PC's are Ctrl. */
  mac?: boolean
  /** An app's build's kind of machine, as builds are named (`macos-aarch64`, `windows-x86_64`, `linux-x86_64`). */
  target?: string
  /** Whether it's a browser, which the network's download page has the app for. */
  web?: boolean
}
/** What `client(change)` changes. */
export type ClientChange = {
  theme?: "light" | "dark" | null
  statusBar?: boolean
  leave?: boolean
  serve?: boolean
  /** A computer's app opens when its person logs in, or not. */
  login?: boolean
  /** A computer's launcher's shortcut, in global-hotkey's words, or null for its default: refused with why, where the
   * system keeps it for itself or won't let the app have it. */
  shortcut?: string | null
  /** Lets go of the launcher's shortcut while another is recorded, so pressing it records it, or takes it again. */
  shortcutPaused?: boolean
  /** Another network's app on this computer shows its launcher in this one's place, by its identifier. */
  network?: string
  update?: boolean
  push?: boolean
  settings?: "accessibility" | "app"
}
export declare function client(): Promise<Client>
export declare function client(change: ClientChange): Promise<{ message: string }>
/** Something of the page's own is open over it, which `shut` shuts: the device's own back calls it first. With
 * `layer: false`, it's what the device's back does on a screen, and nothing is drawn over the page (a screen's own
 * Back, a split's detail beside its list). → what to call once it has shut. */
export declare function covers(shut: () => void, options?: { layer?: boolean }): () => void
/** How large the page's content is, for a window sized by what it shows (a computer's launcher). */
export declare function sizeChanged(size: { width?: number; height?: number }): Promise<void>
/** Puts an app, by its entrypoint, on the device's own home screen, where `client()` says it can (`pinsShortcuts`). */
export declare function pinShortcut(entrypoint: string): Promise<unknown>
/** The window's size, in CSS pixels, as it changes. */
export declare function viewport(): { width: number; height: number }
/** Which way the page's words run, as its language has them. */
export declare function direction(): "ltr" | "rtl"
/** What the device keeps for itself at each edge of the window (a status bar, a notch, a home indicator), as it
 * changes: the CSS's `env(safe-area-inset-*)`. */
export declare function safeArea(): { top: number; right: number; bottom: number; left: number }
/** Whether the page is drawn in an assistant's chat, where every call it makes is the assistant's: what only its
 * person's own device may do is refused there (`OwnDevice`). */
export declare function inChat(): boolean
/** How the client shows the page, as it changes: `"fullscreen"` where the page has the window (a computer's), `"inline"`
 * where it's in something larger, as an assistant's chat is. */
export declare function displayMode(): "inline" | "fullscreen"
/** Asks the client to show the page full screen or back inline, where it's inline and offers that, as an MCP App does.
 * → how the client shows it now: unchanged where it doesn't offer it, or declined. */
export declare function requestDisplayMode(mode: "inline" | "fullscreen"): Promise<"inline" | "fullscreen">
/** Whether a finger points at the window, as it changes: a phone's does, a computer's doesn't. */
export declare function touch(): boolean
/** Whether the device has a document scanner of its own (VisionKit's, ML Kit's), which `scanDocuments` shows: a
 * computer and a browser have none. */
export declare function canScan(): boolean
/** Whether whoever's looking asked for less motion, as it changes. */
export declare function reducedMotion(): boolean
/** Calls `listener` with each key pressed that isn't something's own: not one a field, a menu or a dialog used first
 * (`preventDefault()`), and none at all while a modal layer (a `Modal`, which a `Sheet` and an `Alert` draw) is open,
 * which takes every key as the DOM's `<dialog>` does. → what stops it. */
export declare function keydown(listener: (event: Keyed) => void): () => void
