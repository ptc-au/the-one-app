// Something to press, a count or word beside something, an icon and a spinner: written once on the drawing
// primitives (#primitives), the same on every host.
import { children, createContext, createSignal, onCleanup, Show, useContext } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Path, Pressable, Svg, Text, View } from "#primitives"
import { messages } from "../words.ts"
import { Middle } from "./screen.tsx"
import { createButton } from "../headless-components/button.ts"
import { negative, styles, type Styles } from "../styles.ts"
import { tokens } from "../tokens.ts"
import type { Laid, Located } from "../types/ui.d.ts"
import type { Host } from "../calls.ts"
import arrowDown from "@phosphor-icons/core/assets/regular/arrow-down.svg?raw"
import arrowUp from "@phosphor-icons/core/assets/regular/arrow-up.svg?raw"
import arrowCounterClockwise from "@phosphor-icons/core/assets/regular/arrow-counter-clockwise.svg?raw"
import arrowElbowDownLeft from "@phosphor-icons/core/assets/regular/arrow-elbow-down-left.svg?raw"
import calendarBlank from "@phosphor-icons/core/assets/regular/calendar-blank.svg?raw"
import caretLeft from "@phosphor-icons/core/assets/regular/caret-left.svg?raw"
import caretRight from "@phosphor-icons/core/assets/regular/caret-right.svg?raw"
import caretUpDown from "@phosphor-icons/core/assets/regular/caret-up-down.svg?raw"
import check from "@phosphor-icons/core/assets/regular/check.svg?raw"
import checkCircle from "@phosphor-icons/core/assets/regular/check-circle.svg?raw"
import checkCircleFill from "@phosphor-icons/core/assets/fill/check-circle-fill.svg?raw"
import copy from "@phosphor-icons/core/assets/regular/copy.svg?raw"
import cornersIn from "@phosphor-icons/core/assets/regular/corners-in.svg?raw"
import cornersOut from "@phosphor-icons/core/assets/regular/corners-out.svg?raw"
import dotsThree from "@phosphor-icons/core/assets/regular/dots-three.svg?raw"
import dotsThreeCircle from "@phosphor-icons/core/assets/regular/dots-three-circle.svg?raw"
import downloadSimple from "@phosphor-icons/core/assets/regular/download-simple.svg?raw"
import flag from "@phosphor-icons/core/assets/regular/flag.svg?raw"
import flagFill from "@phosphor-icons/core/assets/fill/flag-fill.svg?raw"
import file from "@phosphor-icons/core/assets/regular/file.svg?raw"
import gearSix from "@phosphor-icons/core/assets/fill/gear-six-fill.svg?raw"
import list from "@phosphor-icons/core/assets/regular/list.svg?raw"
import magnifyingGlass from "@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw"
import paperclip from "@phosphor-icons/core/assets/regular/paperclip.svg?raw"
import pencilSimple from "@phosphor-icons/core/assets/regular/pencil-simple.svg?raw"
import plus from "@phosphor-icons/core/assets/regular/plus.svg?raw"
import trash from "@phosphor-icons/core/assets/regular/trash.svg?raw"
import warningCircle from "@phosphor-icons/core/assets/fill/warning-circle-fill.svg?raw"
import caretDown from "@phosphor-icons/core/assets/regular/caret-down.svg?raw"
import deviceMobile from "@phosphor-icons/core/assets/regular/device-mobile.svg?raw"
import devices from "@phosphor-icons/core/assets/regular/devices.svg?raw"
import globe from "@phosphor-icons/core/assets/regular/globe.svg?raw"
import hardDrives from "@phosphor-icons/core/assets/regular/hard-drives.svg?raw"
import robot from "@phosphor-icons/core/assets/regular/robot.svg?raw"
import terminalWindow from "@phosphor-icons/core/assets/regular/terminal-window.svg?raw"
import minus from "@phosphor-icons/core/assets/regular/minus.svg?raw"
import minusCircle from "@phosphor-icons/core/assets/regular/minus-circle.svg?raw"
import plusCircle from "@phosphor-icons/core/assets/regular/plus-circle.svg?raw"
import question from "@phosphor-icons/core/assets/regular/question.svg?raw"
import squaresFour from "@phosphor-icons/core/assets/regular/squares-four.svg?raw"
import videoCamera from "@phosphor-icons/core/assets/regular/video-camera.svg?raw"
import x from "@phosphor-icons/core/assets/regular/x.svg?raw"
import sparkle from "@phosphor-icons/core/assets/regular/sparkle.svg?raw"
import camera from "@phosphor-icons/core/assets/regular/camera.svg?raw"
import image from "@phosphor-icons/core/assets/regular/image.svg?raw"
import scan from "@phosphor-icons/core/assets/regular/scan.svg?raw"
import filePdf from "@phosphor-icons/core/assets/regular/file-pdf.svg?raw"
import fileArrowUp from "@phosphor-icons/core/assets/regular/file-arrow-up.svg?raw"
import receipt from "@phosphor-icons/core/assets/regular/receipt.svg?raw"
import folder from "@phosphor-icons/core/assets/regular/folder.svg?raw"
import folderOpen from "@phosphor-icons/core/assets/regular/folder-open.svg?raw"
import envelopeSimple from "@phosphor-icons/core/assets/regular/envelope-simple.svg?raw"
import paperPlaneTilt from "@phosphor-icons/core/assets/regular/paper-plane-tilt.svg?raw"
import clockCounterClockwise from "@phosphor-icons/core/assets/regular/clock-counter-clockwise.svg?raw"
import user from "@phosphor-icons/core/assets/regular/user.svg?raw"
import bank from "@phosphor-icons/core/assets/regular/bank.svg?raw"
import creditCard from "@phosphor-icons/core/assets/regular/credit-card.svg?raw"
import arrowSquareOut from "@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw"
import link from "@phosphor-icons/core/assets/regular/link.svg?raw"
import uploadSimple from "@phosphor-icons/core/assets/regular/upload-simple.svg?raw"
import info from "@phosphor-icons/core/assets/regular/info.svg?raw"
import arrowsMerge from "@phosphor-icons/core/assets/regular/arrows-merge.svg?raw"
import arrowsSplit from "@phosphor-icons/core/assets/regular/arrows-split.svg?raw"
import fileZip from "@phosphor-icons/core/assets/regular/file-zip.svg?raw"
import listChecks from "@phosphor-icons/core/assets/regular/list-checks.svg?raw"
import hourglass from "@phosphor-icons/core/assets/regular/hourglass.svg?raw"
import currencyDollar from "@phosphor-icons/core/assets/regular/currency-dollar.svg?raw"
import files from "@phosphor-icons/core/assets/regular/files.svg?raw"

// The Phosphor icons the UI library draws with, by Phosphor's own names: each one path in a 256 square.
const svgs = {
  sparkle,
  camera,
  image,
  scan,
  "file-pdf": filePdf,
  "file-arrow-up": fileArrowUp,
  receipt,
  folder,
  "folder-open": folderOpen,
  "envelope-simple": envelopeSimple,
  "paper-plane-tilt": paperPlaneTilt,
  "clock-counter-clockwise": clockCounterClockwise,
  user,
  bank,
  "credit-card": creditCard,
  "arrow-square-out": arrowSquareOut,
  link,
  "upload-simple": uploadSimple,
  info,
  "arrows-merge": arrowsMerge,
  "arrows-split": arrowsSplit,
  "file-zip": fileZip,
  "list-checks": listChecks,
  hourglass,
  "currency-dollar": currencyDollar,
  files,
  "arrow-counter-clockwise": arrowCounterClockwise,
  "arrow-down": arrowDown,
  "arrow-up": arrowUp,
  "arrow-elbow-down-left": arrowElbowDownLeft,
  "calendar-blank": calendarBlank,
  "caret-down": caretDown,
  "caret-left": caretLeft,
  "caret-right": caretRight,
  "caret-up-down": caretUpDown,
  check,
  "check-circle": checkCircle,
  "check-circle-fill": checkCircleFill,
  copy,
  "corners-in": cornersIn,
  "corners-out": cornersOut,
  "device-mobile": deviceMobile,
  devices,
  globe,
  "hard-drives": hardDrives,
  robot,
  "terminal-window": terminalWindow,
  "dots-three": dotsThree,
  "dots-three-circle": dotsThreeCircle,
  "download-simple": downloadSimple,
  file,
  flag,
  "flag-fill": flagFill,
  "gear-six": gearSix,
  list,
  "magnifying-glass": magnifyingGlass,
  minus,
  "minus-circle": minusCircle,
  paperclip,
  "pencil-simple": pencilSimple,
  plus,
  "plus-circle": plusCircle,
  question,
  "squares-four": squaresFour,
  trash,
  "video-camera": videoCamera,
  "warning-circle": warningCircle,
  x,
}
const paths = Object.fromEntries(Object.entries(svgs).map(([name, svg]) => [name, svg.match(/ d="([^"]+)"/)![1]])) as Record<string, string>

/** The name of one of the UI library's icons. */
export type IconName = keyof typeof svgs

const look = styles({
  icon: { width: tokens.length.icon, height: tokens.length.icon, flexShrink: 0 },
  symbol: { width: tokens.length.symbol, height: tokens.length.symbol },
  spinner: { width: tokens.length.icon, height: tokens.length.icon, flexShrink: 0, animationName: "spin", animation: tokens.motion.spin },
  spinnerArc: { fill: "none", stroke: "currentColor", strokeWidth: 2 },
  // Where what's loading goes, a spinner in the middle of it, grey, as Apple's activity indicator is, faded in.
  waiting: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingBlock: tokens.grid[8],
    color: tokens.colour.secondaryLabel,
    opacity: 0,
    transitionProperty: ["opacity"],
    transition: tokens.motion.settle,
  },
  late: { opacity: 1 },
  // All there is where it is, as Status is: in the middle of it.
  middle: { flexGrow: 1, justifyContent: "center" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.grid[2],
    height: tokens.length.control,
    paddingInline: tokens.grid[4],
    borderRadius: tokens.radius.medium,
    backgroundColor: { default: tokens.colour.label },
    color: tokens.colour.background,
    font: tokens.type.medium,
    fontWeight: tokens.weight.medium,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    opacity: { default: 1, hover: 0.9, pressed: 0.7 },
    boxShadow: { default: "none", focused: tokens.shadow.focus },
    // Pressed, it dims at once, and comes back at once as it's let go, as a Mac's buttons do: what hover and focus
    // change still fades.
    transitionProperty: { default: ["opacity", "backgroundColor", "boxShadow"], pressed: ["backgroundColor", "boxShadow"] },
    transition: tokens.motion.quick,
  },
  secondary: { backgroundColor: { default: tokens.colour.quinaryLabel, hover: tokens.colour.quaternaryLabel }, color: tokens.colour.label, opacity: { default: 1, pressed: 0.7 } },
  outline: { backgroundColor: { default: tokens.colour.field, hover: tokens.colour.quinaryLabel }, color: tokens.colour.label, boxShadow: { default: tokens.shadow.edge, focused: tokens.shadow.focus }, opacity: { default: 1, pressed: 0.7 } },
  ghost: { backgroundColor: { hover: tokens.colour.quinaryLabel }, color: { default: tokens.colour.secondaryLabel, hover: tokens.colour.label }, opacity: { default: 1, pressed: 0.7 } },
  // Red words on a red tint, as Raycast's: the colour says what it does, not how much it matters.
  destructive: { backgroundColor: { default: tokens.colour.redTint, hover: tokens.colour.redTint }, color: tokens.colour.red },
  square: { width: tokens.length.control, paddingInline: 0, flexShrink: 0 },
  capsule: { borderRadius: tokens.radius.full },
  pulled: { marginEnd: negative(tokens.length.iconInset) },
  disabled: { opacity: 0.5, cursor: "default" },
  /** A menu's button, while its menu is open: one with no fill of its own shows it's the one. */
  open: { backgroundColor: tokens.colour.quinaryLabel },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: tokens.length.key,
    height: tokens.length.key,
    paddingInline: tokens.grid[1.5],
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.colour.label,
    color: tokens.colour.background,
    font: tokens.type.small,
    fontWeight: tokens.weight.semibold,
    whiteSpace: "nowrap",
  },
  badgeSecondary: { backgroundColor: tokens.colour.quinaryLabel, color: tokens.colour.label },
  badgeDestructive: { backgroundColor: tokens.colour.red, color: tokens.colour.onAccent },
  badgeOutline: { backgroundColor: tokens.colour.field, color: tokens.colour.label, boxShadow: tokens.shadow.edge },
})

/// `<Icon name="plus" />`: one of the UI library's icons, by Phosphor's name for it, an icon's size (`large`: a symbol's,
/// which is a control of its own), in the colour of the text around it. A name the UI library doesn't have throws the names it has. An app that wants another draws
/// Phosphor's path with a `Path`.
export function Icon(props: { name: IconName; along?: boolean; large?: boolean }) {
  const d = () => {
    if (!paths[props.name]) throw new Error(`No icon named "${props.name}". There are: ${Object.keys(paths).join(", ")}`)
    return paths[props.name]
  }
  return <Svg viewBox="0 0 256 256" aria-hidden="true" style={[look.icon, props.large && look.symbol]}><Path d={d()} /></Svg>
}

/// `<Spinner />`: something's under way, an icon's size. `<Loading fallback={<Spinner delay />}>`: what's loading,
/// in the place it'll take, as Apple's own apps show it: nothing for the first half second, as most answers come
/// sooner (the client answers at once with what it kept), then a grey spinner in the middle of that place. A screen
/// keeps its title, search and tabs outside its `<Loading>`, so they're drawn at once. How long it was in sight is told
/// to the client as it goes (`notifications/one/waited`), which tells Telemetry with the tool it waited on.
export function Spinner(props: { delay?: boolean }) {
  const middle = useContext(Middle)
  const [late, setLate] = createSignal(false)
  if (props.delay) {
    let shown = 0
    const timer = setTimeout(() => (setLate(true), (shown = Date.now())), 500)
    onCleanup(() => {
      clearTimeout(timer)
      if (shown) (globalThis as { host?: Host }).host?.post({ jsonrpc: "2.0", method: "notifications/one/waited", params: { ms: Date.now() - shown } })
    })
  }
  return (
    <View role="status" aria-label={messages.loading} style={[props.delay && look.waiting, props.delay && middle() && look.middle, props.delay && late() && look.late]}>
      <Svg viewBox="0 0 24 24" style={look.spinner}><Path d="M12 3a9 9 0 1 0 9 9" style={look.spinnerArc} /></Svg>
    </View>
  )
}

/** A `Button`'s props. */
export interface ButtonProps {
  shape?: "capsule"
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive"
  size?: "icon"
  loading?: boolean
  disabled?: boolean
  "aria-label"?: string
  "aria-haspopup"?: "menu" | "dialog" | "listbox"
  "aria-expanded"?: "true" | "false"
  autoFocus?: boolean
  /** What pressing it does, as React Native's `onPress`. */
  onPress?: (event: Located) => void
  /** Told where it's drawn as it's laid out, as a menu's button is, which its menu opens under. */
  onLayout?: (event: Laid) => void
  /** Where it sits in what it's in, the only part of its look a caller changes. */
  style?: Styles<"marginTop" | "marginBottom" | "marginStart" | "marginEnd" | "alignSelf" | "flexGrow">
  children?: JSX.Element
}

/** Whether what's in it ends a screen's bar, where an icon with no edge of its own lines up with what's under it, as
 * Back does at the bar's start. */
export const BarEnd = createContext(false)

/** Whether it's a `Problem`'s action, which every one draws as `outline`, so a problem looks the same wherever it's shown. */
export const InProblem = createContext(false)

/// `<Button onPress={save}>Save</Button>`: something to press. `variant` says how much it matters: one `default`
/// to a view, then `secondary`, `outline` and `ghost`, and `destructive` for what can't be undone. `size="icon"`
/// is square, for an icon alone (`<Icon name="plus" />`), named by `aria-label`. `shape="capsule"` rounds its ends
/// fully, as SwiftUI's capsule border shape, for one that is a pill of its own (the Home Screen's owner pill). `loading` shows it's working and
/// can't be pressed again. `style` places it, and changes nothing else of its look.
export function Button(props: ButtonProps) {
  const button = createButton({
    get disabled() {
      return props.disabled
    },
    get loading() {
      return props.loading
    },
    get onPress() {
      return props.onPress
    },
  })
  // What it says, made once: words in a text, or what it's given (an icon) as it is.
  const inside = children(() => props.children)
  const end = useContext(BarEnd)
  const alerted = useContext(InProblem)
  const variant = () => (alerted ? "outline" : props.variant)
  const shown = () => {
    const which = variant()
    return which && which !== "default" ? look[which] : undefined
  }
  return (
    <Pressable
      {...button.root()}
      aria-label={props["aria-label"]}
      aria-haspopup={props["aria-haspopup"]}
      aria-expanded={props["aria-expanded"]}
      autoFocus={props.autoFocus}
      onLayout={props.onLayout}
      style={[look.button, shown(), props.size === "icon" && look.square, props.shape === "capsule" && look.capsule, end && variant() === "ghost" && props.size === "icon" && look.pulled, button.off() && look.disabled, props["aria-expanded"] === "true" && (variant() === "outline" || variant() === "ghost") && look.open, props.style]}
    >
      <Show when={props.loading}>
        <Spinner />
      </Show>
      {inside.toArray().map((part) => (typeof part === "string" ? <Text>{part}</Text> : part))}
    </Pressable>
  )
}

/** A `Badge`'s props. */
export interface BadgeProps {
  variant?: "default" | "secondary" | "destructive" | "outline"
  "aria-label"?: string
  children?: JSX.Element
}

const badges = { default: undefined, secondary: look.badgeSecondary, destructive: look.badgeDestructive, outline: look.badgeOutline }

/// `<Badge variant="destructive" aria-label="3 waiting">3</Badge>`: a short count or word beside what it's about, as
/// shadcn's Badge. `destructive` is the red count of what waits for someone, as on an iPhone's icons; `default`,
/// `secondary` and `outline` are for a word that only says what something is.
export function Badge(props: BadgeProps) {
  return (
    <View aria-label={props["aria-label"]} style={[look.badge, badges[props.variant ?? "default"]]}>
      <Text>{props.children}</Text>
    </View>
  )
}
