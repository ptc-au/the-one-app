// The design tokens: every colour, length, radius, shadow, material, font, weight, type style and pace the UI library
// and every app draw with, as typed values, each the same everywhere or varying by condition (dark, touch, phone,
// reduced motion: drawing-primitives/renderer.ts's `Condition`). This is their one source, in two layers: a palette of
// raw values with no meaning (`zinc[977]`), private to this file, and the roles that point at it. `tokens` are by role, as Raycast's
// model has them (text at 100, 60 (70 in light), 40, 20 and 10%, a background, a selection, a loader, seven accents each with a
// tint, a 4px grid, three radii, a window's shadow and edge, three sizes of text and a large title), and a page's code
// names only those, so their values change here alone. `legacy` are what the UI library's components drawn with CSS
// name, until each is written on the drawing primitives. The UI library's build makes from it the web's
// CSS variables (tokens.css, which isn't edited by hand) and a native host's token table (/ui/client/tokens.json), and
// a style names a token here by reference (`tokens.colour.mutedForeground`), never by its value.
//
// Values are Raycast's, as the round-two mockup measured them beside it (DESIGN.md), light and dark. The typeface is Allo (allo.joshpuckett.me, github.com/joshpuckett/
// allo v1.0, SIL Open Font License with no Reserved Font Name: Allo-LICENSE.txt), built into the renderer and
// served beside the app's window page, so nothing comes from a font host; code is in the device's own monospace, and a script Allo lacks in the
// device's own font. Allo-Variable.woff2 is its AlloVariable.ttf with roundness pinned at 100 and only Latin kept:
//   fonttools varLib.instancer AlloVariable.ttf ROND=100 -o allo.ttf
//   pyftsubset allo.ttf --layout-features='*' --flavor=woff2 --output-file=Allo-Variable.woff2 --unicodes=U+0000-00FF,
//     U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,
//     U+2193,U+2212,U+2215,U+FEFF,U+FFFD
import type { Condition, Length, Varies } from "./drawing-primitives/renderer.ts"

/** A token of a kind, whose `value` a style never reads: it names the token, and the build resolves it. */
export interface Token<Kind extends string = string> {
  kind: Kind
  /** Its id, which is its CSS variable's name: `muted-foreground` is `var(--muted-foreground)`. */
  id: string
  value: unknown
}

export type { Condition }

/** A colour, light and dark; and `tinted`, its light and dark where glass is a plain tint (`reducedTransparency`). */
const colour = (light: string, dark = light, tinted?: readonly [light: string, dark: string]): Token<"colour"> => {
  const tint = tinted && (tinted[0] === tinted[1] ? tinted[0] : { default: tinted[0], dark: tinted[1] })
  return { kind: "colour", id: "", value: tint ? { default: light, ...(light === dark ? {} : { dark }), reducedTransparency: tint } : light === dark ? light : { default: light, dark } }
}
const length = (value: Varies<Length>): Token<"length"> => ({ kind: "length", id: "", value })
const radius = (value: Varies<Length | { percent: number }>): Token<"radius"> => ({ kind: "radius", id: "", value })
const rem = (rem: number): Length => ({ rem })
const px = (px: number): Length => ({ px })

/** A shadow: its offsets, blur and spread in pixels, its colour, and whether it's inside the edge. */
type Shadow = { x: number; y: number; blur: number; spread: number; colour: string; inset?: boolean }
const shadow = (...shadows: Shadow[]): Token<"shadow"> => ({ kind: "shadow", id: "", value: shadows })
/** A shadow that's one in light and another in dark. */
const lightDark = (light: Shadow[], dark: Shadow[]): Token<"shadow"> => ({ kind: "shadow", id: "", value: { default: light, dark } })
const font = (...families: string[]): Token<"font"> => ({ kind: "font", id: "", value: families })
/** A weight, a little lighter in dark: light text on dark looks heavier. */
const weight = (weight: number): Token<"weight"> => ({ kind: "weight", id: "", value: { default: weight, dark: weight - 25 } })
/** A colour as another at a part of its opacity: text at 60%, an accent's 12% tint. */
const alpha = (of: Token<"colour">, percent: number): Token<"colour"> => ({ kind: "colour", id: "", value: { of, alpha: percent / 100 } })
/** What shows through what has it: what's behind, blurred so far and saturated so much; `system`, the system's own
 * material where the host has one, as a launcher panel's glass is under the window (a Mac's), and else blurred as any.
 * Where glass is a plain tint (`reducedTransparency`) it blurs nothing, and the fill of what has it is all there is. */
const material = (blur: number, saturate: number, system?: boolean): Token<"material"> => ({
  kind: "material",
  id: "",
  value: { default: { blur: px(blur), saturate, ...(system ? { system } : {}) }, reducedTransparency: { blur: px(0), saturate: 1, ...(system ? { system } : {}) } },
})
const motion = (duration: Varies<number>, easing: Varies<[number, number, number, number]>): Token<"motion"> => ({ kind: "motion", id: "", value: { duration, easing } })
/** A spring, as SwiftUI's `.spring(duration:bounce:)` and Motion's are given: about how long it takes to get there, in
 * milliseconds, and how far past it goes, from 0 (not at all) to 1. A change on its way is turned to the new value
 * from where it is, at the speed it has. `easing` is for a host that draws only Béziers, and for whoever asked for less
 * motion, for whom it is a 200 ms ease out and no spring: what moves is faded instead. */
const spring = (duration: number, bounce: number): Token<"motion"> => ({ kind: "motion", id: "", value: { duration: { default: duration, reducedMotion: 200 }, bounce, easing: [0.22, 1, 0.36, 1] } })

// The palette: raw colours with no meaning, each hue a scale whose steps are their OKLCH lightness in thousandths, as
// Tailwind's and Radix Colors' scales name theirs (`zinc[977]`), and `opacity`, one at a part of its opacity, as
// Tailwind's `black/30`. Only the roles below name them, and nothing outside this file sees them: a page names a role,
// and a theme changes the palette behind the roles. Values are Raycast's as round two measured them beside it
// (raycast-mockups-v2): a near-white window, one text colour, and Apple's accents but red, orange and blue, which are
// the mockup's. Dark is true black, an OLED's (20 Nov), with what's raised off it neutral greys, no tint. Colours CSS
// names are written in OKLCH. Red, orange, blue and green in light are a little deeper than Apple's, and red in dark a
// little lighter, so words in them stand off every surface a page draws on by WCAG AA's 4.5:1, and white words on them
// too (lint-tokens.js).
const black = "oklch(0 0 0)"
const white = "oklch(1 0 0)"
const neutral = { 185: "oklch(0.185 0 0)", 225: "oklch(0.225 0 0)", 260: "oklch(0.26 0 0)", 269: "oklch(0.269 0 0)" } as const
const zinc = { 224: "oklch(0.224 0.008 285.76)", 919: "oklch(0.919 0.003 286.35)", 962: "oklch(0.962 0.004 286.32)", 977: "oklch(0.977 0.003 286.35)", 991: "oklch(0.991 0.001 286.38)" } as const
const red = { 510: "oklch(0.51 0.204 25.56)", 745: "oklch(0.745 0.191 23.4)" } as const
const orange = { 460: "oklch(0.46 0.13 57.12)", 600: "oklch(0.60 0.164 57.12)", 782: "oklch(0.782 0.171 67.22)", 820: "#ffb340" } as const
const yellow = { 865: "#ffcc00", 885: "#ffd60a" } as const
const green = { 440: "oklch(0.44 0.13 149)", 600: "oklch(0.6 0.17 149)", 756: "#30d158" } as const
const blue = { 450: "oklch(0.45 0.199 261.84)", 510: "oklch(0.51 0.199 261.84)", 714: "oklch(0.714 0.139 249.06)" } as const
const purple = { 615: "#af52de", 656: "#bf5af2" } as const
const pink = { 650: "#ff2d55", 658: "#ff375f" } as const
/** One of the palette's OKLCH colours at a part of its opacity. */
const opacity = (colour: `oklch(${string})`, percent: number) => colour.replace(/\)$/, ` / ${percent}%)`)

const colours = {
  background: colour(zinc[977], black),
  foreground: colour(zinc[224], white),
  /** What's raised off what it's on: a group of rows, a problem. In dark it's white at 11%, so each level up is
   * lighter, as iOS's dark grouped lists are: `#1C1C1E` on the black page (secondarySystemGroupedBackground), and
   * about `#2C2C2E` on a sheet or an alert (its elevated twin), as the widgets' tiles are. */
  card: colour(white, opacity(white, 11)),
  /** What's over the page and holds cards of its own, under a finger: a sheet, an alert. The page's colour in light,
   * and in dark iOS's elevated background (`#1C1C1E`), off the black page. */
  elevated: colour(zinc[977], neutral[225]),
  primary: colour(zinc[224], white),
  primaryForeground: colour(white, black),
  /** A quiet fill: a secondary button, what's hovered, a skeleton: the text at 10% over the page. */
  muted: colour(zinc[919], neutral[269]),
  /** Grey words, and where the keyboard is: the text at 60%, 70% in light (`secondaryLabel`). */
  mutedForeground: colour(opacity(zinc[224], 70), opacity(white, 60)),
  destructive: colour(red[510], red[745]),
  /** Warn: "this needs you", but it can wait. */
  warning: colour(orange[600], orange[782]),
  /** A hairline, a field's edge, and what a pressed row fills with: the text at 10%. */
  border: colour(opacity(zinc[224], 10), opacity(white, 10)),
  /** What dims the page under a sheet or an alert, as iOS's and macOS's do: black over a light page as over a dark one. */
  overlay: colour(opacity(black, 30), opacity(black, 40)),
}

/** Lengths. A computer's are rems of 16px; under a finger what's pressed is a 44px target and text a step larger, which
 * a field never shows under 16px, where an iPhone would zoom into it; an iPhone's and iPad's rem is the text size its
 * person chose (Dynamic Type), 17px unless they changed it, and its type styles are iOS's own at that size. */
const lengths = {
  /** Body text and what's typed: Raycast's 13px on a computer. */
  textBase: length({ default: rem(0.8125), touch: rem(1) }),
  textLg: length({ default: rem(0.9375), phone: rem(1) }),
  textTitle: length({ default: rem(1.25), phone: rem(28 / 17) }),
  /** A big number's: 34px, as iOS's widgets draw one. */
  textFigure: length({ default: rem(2.125), phone: rem(34 / 17) }),
  /** Apple's footnote, the same under a finger and a mouse: for a count, code or a hint. */
  textFootnote: length(rem(0.8125)),
  /** What's typed in a field: body, but never under 16px under a finger. */
  textField: length({ default: rem(0.8125), touch: rem(1) }),
  /** How tall what's pressed or typed in is, and an icon in it. */
  control: length({ default: rem(2), touch: rem(2.75), phone: rem(44 / 17) }),
  icon: length({ default: rem(1), touch: rem(1.125), phone: rem(19 / 17) }),
  /** A screen's gutter and the gap between its parts, which on an iPhone stay put as its text grows; and where lists
   * and forms stop growing. */
  gutter: length({ default: rem(1), phone: px(16) }),
  readable: length(rem(42)),
  /** A border: a hairline. */
  hairline: length(px(1)),
}

const radii = {
  sm: radius(rem(0.375)),
  md: radius(rem(0.5625)),
  xl: radius(rem(0.875)),
  /** A pill, or a circle. */
  full: radius(px(9999)),
  /** An app's icon, as iOS rounds one. */
  icon: radius({ percent: 22.5 }),
}

const shadows = {
  xs: shadow({ x: 0, y: 1, blur: 2, spread: 0, colour: opacity(black, 5) }),
  lg: shadow({ x: 0, y: 10, blur: 15, spread: -3, colour: opacity(black, 10) }, { x: 0, y: 4, blur: 6, spread: -4, colour: opacity(black, 10) }),
}

const fonts = {
  sans: font("Allo", "-apple-system", "BlinkMacSystemFont", "Segoe UI Variable", "Segoe UI", "system-ui", "sans-serif"),
  mono: font("ui-monospace", "SF Mono", "Cascadia Mono", "monospace"),
}

/** Weights between Allo's named ones. */
const weights = {
  body: weight(400),
  label: weight(500),
  title: weight(600),
}

/** A type style (DESIGN.md: text is one of a few): body; label, for what's pressed, named or a row's heading;
 * headline, a section's or a card's title; title, a screen's, a dialog's and a big widget text; figure, a big number;
 * and Apple's smaller ones. Big titles and figures are tracked in, and figures are tabular, as numbers that change
 * or line up are. Allo's optical size follows the text's size by itself. */
const type = (size: Token<"length">, weight: Token<"weight">, { lineHeight = 1.5, tracking = 0, tabular = false } = {}): Token<"type"> => ({ kind: "type", id: "", value: { font: fonts.sans, size, lineHeight, weight, tracking, tabular } })
const types = {
  body: type(lengths.textBase, weights.body),
  label: type(lengths.textBase, weights.label),
  headline: type(lengths.textLg, weights.title, { tracking: -0.015 }),
  title: type(lengths.textTitle, weights.title, { lineHeight: 1.2, tracking: -0.015 }),
  /** A big number, as an iOS widget's and Raycast's large numbers: 34px, tracked in, its figures tabular. */
  figure: type(lengths.textFigure, weights.title, { lineHeight: 1.1, tracking: -0.03, tabular: true }),
  footnote: type(lengths.textFootnote, weights.body),
}

/** How things move. Quick: what goes, what's small (a press, a fade, a menu). Settle: what arrives or shifts in
 * place. Travel: what crosses the screen (a sheet), which for whoever asked for less motion fades instead, as briefly
 * as what settles. */
const out: [number, number, number, number] = [0.22, 1, 0.36, 1]
const motions = {
  quick: motion(120, out),
  settle: motion(200, out),
  travel: motion({ default: 300, reducedMotion: 200 }, { default: [0.32, 0.72, 0, 1], reducedMotion: out }),
  /** Springs, by SwiftUI's names and bounces (`Animation.snappy`, `.smooth`), quicker than its half a second: at rest
   * within a pixel 0.4 s after they're let go from 200 or 300 points, as Material 3 Expressive's spatial springs are,
   * where SwiftUI's took 0.7 (Andre likes snappy motion, 22 Nov). Snappy: what changes size or place and can be turned
   * back midway, a little past where it goes. Smooth: what fades or settles beside it, with no bounce. */
  snappy: spring(300, 0.15),
  smooth: spring(300, 0),
  /** Pages settling where a swipe let them go, as UIScrollView's paging, SpringBoard's pages', does: its curve recorded
   * on iOS 26's simulator and fitted, a spring from the finger's speed (a stiffness of 420 and damping of 39.5), at
   * rest in a third of a second. */
  paging: spring(307, 0.036),
}

// By role.

/** Raycast's window shadow, light and dark, and its edge inside, as round two measured them. */
const windowShadow: Record<"light" | "dark", Shadow[]> = {
  light: [{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(black, 16) }, { x: 0, y: 4, blur: 8, spread: 0, colour: opacity(black, 6) }, { x: 0, y: 12, blur: 32, spread: 0, colour: opacity(black, 14) }, { x: 0, y: 16, blur: 48, spread: 8, colour: opacity(black, 6) }],
  dark: [{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(black, 75) }, { x: 0, y: 4, blur: 8, spread: 0, colour: opacity(black, 40) }, { x: 0, y: 12, blur: 32, spread: 0, colour: opacity(black, 60) }, { x: 0, y: 16, blur: 48, spread: 8, colour: opacity(black, 20) }],
}
const edge: Record<"light" | "dark", Shadow[]> = {
  light: [{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(black, 10), inset: true }, { x: 0, y: 0.5, blur: 0, spread: 0, colour: opacity(white, 90), inset: true }],
  dark: [{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(white, 14), inset: true }, { x: 0, y: 0.5, blur: 0, spread: 0, colour: opacity(white, 12), inset: true }],
}

const label = colour(zinc[224], white)
const accents = {
  red: colour(red[510], red[745]),
  orange: colour(orange[600], orange[782]),
  yellow: colour(yellow[865], yellow[885]),
  green: colour(green[600], green[756]),
  blue: colour(blue[510], blue[714]),
  purple: colour(purple[615], purple[656]),
  magenta: colour(pink[650], pink[658]),
}
/** Colours: one text colour at five strengths, a background and the second of its gradient, what's selected, what's
 * loading, and the accents, each with its tint. */
const roles = {
  label,
  /** The text at 60%, and at 70% in light, where 60% on a widget's tile over a dark window behind the launcher fell
   * short of WCAG AA's 4.5:1 (3.9:1; 4.6:1 at 66%), and 66% on a widget's tile in the launcher's light card (4.4:1). */
  secondaryLabel: colour(opacity(zinc[224], 70), opacity(white, 60)),
  tertiaryLabel: alpha(label, 40),
  quaternaryLabel: alpha(label, 20),
  quinaryLabel: alpha(label, 10),
  background: colours.background,
  /** What's raised off what it's on: a group of rows, a problem, what's loading in place of a list. */
  card: colours.card,
  /** What's over the page under a finger: a sheet, an alert. */
  elevated: colours.elevated,
  backgroundGradient: colour(zinc[962], black),
  selection: alpha(label, 10),
  /** Every other row of metadata: the text at 2.5%. */
  stripe: alpha(label, 2.5),
  /** What dims the page under a sheet or an alert. */
  overlay: colours.overlay,
  /** A panel of glass, over the window or the desktop: a menu, an alert, the launcher. Tinted as macOS's
   * widgets and Control Center are, so text stays readable over any window behind it: secondary text holds WCAG AA's
   * 4.5:1 over a white one in dark. */
  panel: colour(opacity(zinc[991], 92), opacity(neutral[185], 92), [zinc[991], neutral[185]]),
  /** Liquid Glass's fill, over what's blurred behind it: mostly white in light, a grey a little lighter than black in
   * dark, a fifth see-through, so it reads over anything. */
  glass: colour(opacity(white, 80), opacity(neutral[260], 80), [white, neutral[260]]),
  /** What veils a page behind something opened over it, over what's blurred; where glass is a plain tint, opaque: what's
   * behind, unblurred, would show its words through the words over it. */
  veil: colour(opacity(zinc[977], 55), opacity(black, 55), [zinc[977], black]),
  /** What veils the App Library behind a category opened over it, over what's blurred, as an iOS folder's does: a
   * quarter, so what's behind keeps its colours, blurred; where glass is a plain tint, opaque, as `veil` is. */
  folderVeil: colour(opacity(zinc[977], 25), opacity(black, 25), [zinc[977], black]),
  /** A tile's tint, as an App Library category's square is. */
  tile: alpha(label, 14),
  /** What's typed in, and an outline button: a field's fill, a little lighter than what it's on, as iOS's
   * tertiarySystemFill is in dark. */
  field: colour(opacity(white, 70), opacity(white, 10)),
  /** Nothing: what has no fill of its own where something else has one. */
  transparent: colour(opacity(black, 0)),
  /** Words and icons on an accent: white in light, black in dark, where the accents are light enough to read on
   * black, and white on them falls short of 4.5:1 (red's 2.8:1). */
  onAccent: colour(white, black),
  /** A switch's thumb while it's off: white in light and dark, as iOS's and macOS's are, off its track by its edge's shadow. */
  thumb: colour(white),
  loader: alpha(label, 40),
  /** The row that's open among a few, each showing what it's about where it's open (Welcome's four, Connect your AI's
   * assistants), and one under the pointer. */
  choice: colour(opacity(black, 5), opacity(white, 8)),
  choiceHover: colour(opacity(black, 3), opacity(white, 5)),
  /** A page dot not shown: at 3:1 against the page, as a control's mark must be. */
  pageDot: colour(opacity(black, 50), opacity(white, 50)),
  /** Words that warn, that say it worked, and that name a kind of thing in blue (a tag's): orange's, green's and blue's,
   * deep enough in light to read at WCAG AA's 4.5:1 on their own tint over a page's grey, a card and the open row's
   * grey on a Mac (4.8:1 or more), which the accents' aren't (blue's 3.9:1 there, 26 Nov). */
  warningLabel: colour(orange[460], orange[820]),
  successLabel: colour(green[440], green[756]),
  infoLabel: colour(blue[450], blue[714]),
  ...accents,
  redTint: alpha(accents.red, 12),
  orangeTint: alpha(accents.orange, 12),
  yellowTint: alpha(accents.yellow, 12),
  greenTint: alpha(accents.green, 12),
  blueTint: alpha(accents.blue, 12),
  purpleTint: alpha(accents.purple, 12),
  magentaTint: alpha(accents.magenta, 12),
}

/** The 4px grid, by its steps: `grid[3]` is 12px. */
const grid = Object.fromEntries([0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24].map((step) => [step, length(rem(step / 4))])) as Record<0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 16 | 20 | 24, Token<"length">>

/** Sizes of text: large, medium and small, and a phone's large title. */
const sizes = {
  large: length({ default: rem(1.125), phone: rem(1) }),
  medium: length({ default: rem(0.8125), touch: rem(0.9375), phone: rem(15 / 17) }),
  small: length({ default: rem(0.6875), touch: rem(0.8125), phone: rem(13 / 17) }),
  /** A computer's bar's title: Raycast's 15px. */
  barTitle: length(rem(0.9375)),
  /** A row's heading in grouped cards and a sidebar on a computer, as Raycast's Settings draws them: 13.5px and 14px;
   * under a finger, a row's own. */
  groupedRow: length({ default: rem(0.84375), touch: rem(0.9375), phone: rem(15 / 17) }),
  sidebarRow: length({ default: rem(0.875), touch: rem(0.9375), phone: rem(15 / 17) }),
  /** A toast's and a small note's: Raycast's 12px. */
  caption: length({ default: rem(0.75), touch: rem(0.8125), phone: rem(13 / 17) }),
  largeTitle: length({ default: rem(1.25), phone: rem(34 / 17) }),
}
const weightRoles = {
  regular: weights.body,
  medium: weights.label,
  semibold: weights.title,
}

/** What the UI library's components drawn with CSS name, as their CSS variables, until each is written on the drawing primitives. */
export const legacy = {
  colour: named(colours, (key) => key),
  length: named(lengths, (key) => key),
  radius: named(radii, (key) => `radius-${key}`),
  shadow: named(shadows, (key) => `shadow-${key}`),
  weight: named(weights, (key) => `${key}-weight`),
  type: named(types, (key) => `type-${key}`),
}

export const tokens = {
  colour: named(roles, (key) => key),
  grid: named(grid, (key) => `grid-${key.replace(".", "-")}`),
  length: named({
    control: lengths.control,
    icon: lengths.icon,
    /** A symbol that is a control of its own, as iOS's `ellipsis.circle` ends a row: 22 pt under a finger. */
    symbol: length({ default: rem(1.25), touch: rem(1.375), phone: rem(22 / 17) }),
    /** How far an icon sits inside the edge of a square button of it, which a button with no edge of its own at the
     * end of a row pulls out by, so the icon lines up with what's under it: half of `control` less `icon`. */
    iconInset: length({ default: rem(0.5), touch: rem(0.8125), phone: rem(12.5 / 17) }),
    /** How tall a screen's bar is at least: a control's height and a little, Raycast's 52px on a computer. */
    bar: length({ default: rem(3.25), touch: rem(3.5), phone: rem(44 / 17 + 0.75) }),
    gutter: lengths.gutter,
    readable: lengths.readable,
    hairline: lengths.hairline,
    /** A centred screen's parts, as sign-in's, at their widest; and a network's mark over its name there. */
    narrow: length(px(352)),
    mark: length(px(88)),
    /** A split's list beside what it opens: its widest and its narrowest. */
    column: length(rem(24)),
    columnMin: length(rem(18)),
    /** A window's sidebar, as macOS's and Raycast's Settings': 240px. */
    sidebar: length(rem(15)),
    /** How tall a block of code grows before it scrolls. */
    excerpt: length(rem(12)),
    /** What the device keeps for itself at each edge of the window (a status bar, a notch, a home indicator), which
     * the host sets as it changes: on the web the client says it (`safeAreaInsets`) and the bridge sets it. */
    safeTop: length(px(0)),
    safeBottom: length(px(0)),
    safeLeft: length(px(0)),
    safeRight: length(px(0)),
    /** Where a computer's window has its title row over the page, which its top bar is (`titleBar` in its host
     * context): where in it the page's own may start, after the window's controls and title, and how far from
     * its end, before the controls there. With none, a gutter's. The host sets them as they change. */
    titleBarStart: length(rem(1)),
    titleBarEnd: length(rem(1)),
    sheet: length({ default: rem(34), touch: rem(28) }),
    alert: length(rem(18.75)),
    menu: length(rem(10)),
    /** A sheet's grabber, which says under a finger that it can be pulled down, and is nothing under a mouse. */
    grabber: length({ default: px(0), touch: rem(0.25) }),
    grabberGap: length({ default: px(0), touch: rem(0.5) }),
    /** A toast's: Raycast's pill, 36px. */
    pill: length(rem(2.25)),
    /** A form's labels on a computer, beside what they name, as Raycast's and macOS's forms have them. */
    formLabel: length(rem(9.5)),
    /** A badge's height, as a count's. */
    key: length(rem(1.125)),
    /** A screen's tips' popover, and how tall a tip's keys or picture are, as a sheet draws them larger. */
    tips: length(rem(17)),
    tipPicture: length({ default: rem(6.75), touch: rem(8.25) }),
    /** How tall a row in a list is at least: what's pressed, and a little room. */
    row: length({ default: rem(2.375), touch: rem(3.25), phone: rem(52 / 17) }),
    /** A row in grouped cards, as Raycast's Settings and iOS's Settings draw them: 46px on a computer. */
    groupedRow: length({ default: rem(2.875), touch: rem(3.25), phone: rem(52 / 17) }),
    /** A sidebar's row on a computer, as macOS's and Raycast's Settings' sidebars draw them. */
    sidebarRow: length({ default: rem(2.0625), touch: rem(3.25), phone: rem(52 / 17) }),
    /** An icon at a row's start in a sidebar and in grouped cards, as Raycast's Settings: 22px and 28px on a computer,
     * 30px under a finger. */
    sidebarIcon: length({ default: rem(1.375), touch: rem(1.875), phone: rem(30 / 17) }),
    groupedIcon: length({ default: rem(1.75), touch: rem(1.875), phone: rem(30 / 17) }),
  }, (key) => key),
  size: named(sizes, (key) => `size-${key}`),
  radius: named({ small: radius(px(6)), medium: radius(px(10)), large: radius(px(18)), window: radius(px(26)), full: radii.full, icon: radii.icon }, (key) => `radius-${key}`),
  shadow: named({
    /** Liquid Glass's: a hairline rim, a line of light along its top, and a soft shadow under it. */
    glass: lightDark(
      [{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(black, 12) }, { x: 0, y: 1, blur: 3, spread: 0, colour: opacity(black, 6) }, { x: 0, y: 0.5, blur: 0, spread: 0, colour: opacity(white, 90), inset: true }, { x: 0, y: 8, blur: 24, spread: 0, colour: opacity(black, 18) }],
      [{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(white, 14), inset: true }, { x: 0, y: 0.5, blur: 0, spread: 0, colour: opacity(white, 18), inset: true }, { x: 0, y: 8, blur: 24, spread: 0, colour: opacity(black, 25) }],
    ),
    /** What's carried by a finger: a soft drop shadow. */
    lifted: shadow({ x: 0, y: 12, blur: 28, spread: -6, colour: opacity(black, 30) }),
    /** Where the keyboard is: a blue edge and a ring of its tint. */
    focus: lightDark(
      [{ x: 0, y: 0, blur: 0, spread: 1, colour: blue[510], inset: true }, { x: 0, y: 0, blur: 0, spread: 3, colour: opacity(blue[510], 30) }],
      [{ x: 0, y: 0, blur: 0, spread: 1, colour: blue[714], inset: true }, { x: 0, y: 0, blur: 0, spread: 3, colour: opacity(blue[714], 30) }],
    ),
    /** A window's, a sheet's or a menu's, as Raycast's: a hairline outside, three soft shadows under it, and its edge. */
    window: lightDark([...windowShadow.light, ...edge.light], [...windowShadow.dark, ...edge.dark]),
    /** A pill of glass's, as Raycast draws them: a hairline round it and a line of light along its top. */
    pill: lightDark(
      [{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(black, 12) }, { x: 0, y: 1, blur: 3, spread: 0, colour: opacity(black, 6) }, { x: 0, y: 0.5, blur: 0, spread: 0, colour: opacity(white, 90), inset: true }],
      [{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(white, 12), inset: true }, { x: 0, y: 0.5, blur: 0, spread: 0, colour: opacity(white, 18), inset: true }],
    ),
    /** A field's edge: a half-pixel line inside. */
    field: lightDark([{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(black, 14), inset: true }], [{ x: 0, y: 0, blur: 0, spread: 0.5, colour: opacity(white, 12), inset: true }]),
    /** A checkbox's and a radio's ring, off: a whole point, at 3:1 or more against what it's on (WCAG's non-text
     * contrast), as iOS's and macOS's are drawn. */
    tick: lightDark([{ x: 0, y: 0, blur: 0, spread: 1, colour: opacity(black, 45), inset: true }], [{ x: 0, y: 0, blur: 0, spread: 1, colour: opacity(white, 40), inset: true }]),
    /** A keycap's, as a shortcut's keys are drawn: a soft shadow under it. */
    keycap: shadow({ x: 0, y: 1, blur: 2, spread: 0, colour: opacity(black, 6) }),
    /** A raised thing's edge inside: a half-pixel line, lit along the top. */
    edge: lightDark(edge.light, edge.dark),
    /** A field's edge, and where the keyboard is in it, where what's in it is wrong. */
    wrongEdge: lightDark([{ x: 0, y: 0, blur: 0, spread: 1, colour: red[510], inset: true }], [{ x: 0, y: 0, blur: 0, spread: 1, colour: red[745], inset: true }]),
    wrongFocus: lightDark([{ x: 0, y: 0, blur: 0, spread: 3, colour: opacity(red[510], 30) }], [{ x: 0, y: 0, blur: 0, spread: 3, colour: opacity(red[745], 30) }]),
  }, (key) => `shadow-${key}`),
  material: named({ glass: material(20, 1.6), thin: material(18, 1.2), window: material(30, 1.8, true) }, (key) => `material-${key}`),
  font: named(fonts, (key) => `font-${key}`),
  weight: named(weightRoles, (key) => `weight-${key}`),
  type: named({
    largeTitle: type(sizes.largeTitle, weights.title, { lineHeight: 1.2, tracking: -0.015 }),
    /** A big number: a widget's stat. */
    figure: types.figure,
    /** A screen's, a dialog's and a big widget text. */
    title: types.title,
    /** A bar's title under a finger, which runs to a second line before it's cut: UIKit's `.headline`, 17 pt. */
    headline: types.headline,
    /** A computer's bar's title, deeper in an app, beside its Back: Raycast's 15px. */
    barTitle: type(sizes.barTitle, weights.label, { lineHeight: 1.3, tracking: -0.01 }),
    large: type(sizes.large, weights.label),
    medium: type(sizes.medium, weights.body, { lineHeight: 1.35 }),
    groupedRow: type(sizes.groupedRow, weights.body, { lineHeight: 1.35 }),
    sidebarRow: type(sizes.sidebarRow, weights.body, { lineHeight: 1.35 }),
    small: type(sizes.small, weights.body),
    caption: type(sizes.caption, weights.body, { lineHeight: 1.35 }),
    /** What's typed in a field: medium, but never under 16px under a finger, where an iPhone would zoom into it. */
    field: type(lengths.textField, weights.body),
  }, (key) => `type-${key}`),
  motion: named({ ...motions, spin: motion(1000, [0, 0, 1, 1]), hold: motion(500, out), pulse: motion(2000, [0.4, 0, 0.6, 1]) }, (key) => `move-${key}`),
}


/** Each token's id, its CSS variable's name, as its kind's group names it: a colour by itself (`secondary-label`), a
 * length as it's known (`control`), and the rest by their group (`grid-3`, `radius-small`, `type-medium`,
 * `move-quick`). A token in two groups keeps the first's: `legacy`'s, which its CSS names, until it goes. */
function named<T extends Record<string, Token>>(group: T, id: (key: string) => string): T {
  for (const [key, token] of Object.entries(group)) token.id ||= id(key.replace(/([a-z])([A-Z0-9])/g, (_, before, letter) => `${before}-${letter.toLowerCase()}`).replace(/^x(x+)l$/, (_, more) => `${more.length + 1}xl`))
  return group
}

/** How long a motion token takes by default, in milliseconds, for what a page times itself as it moves. */
export const duration = (token: Token<"motion">): number => {
  const value = (token.value as { duration: number | { default: number } }).duration
  return typeof value === "number" ? value : value.default
}

/** How long a length token is by default, in CSS pixels, at the root's 16px to a rem, for what a page places itself:
 * a popup beside what opened it. */
export const pixels = (token: Token<"length">): number => {
  const value = token.value as Varies<Length>
  const length = "default" in value ? value.default : value
  return "px" in length ? length.px : length.rem * 16
}
