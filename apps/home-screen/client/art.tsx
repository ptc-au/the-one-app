// What Welcome's pictures are drawn with: boxes and words on an art board 440 by 330, each placed, sized, filled and
// moved as the picture says, by the values it gives (each a dynamic style's, as a picture's are data), and shapes
// (`Shape`), as an SVG's paths. Every picture is real UI, drawn by the renderer as any page is.
import { type Element, illustration, Image, Path, styles, type Styles, Svg, Text, tokens, View } from "ui"

/** The colours the drawing kit draws with: the people, the app they make's icon and its glyphs, and the pointers. */
const drawn = illustration("Welcome's pictures' drawing kit: four people, the made-up app's icon and the white of its glyphs, and the pointers, each in its own colours, drawn the same in light and dark.", {
  sarahSkin: "#f2c7a5",
  sarahHair: "#7a3e1d",
  sarahShirt: "#e8467c",
  sarahGround: "#fde2ea",
  jamesSkin: "#8d5a3b",
  jamesHair: "#1b1b1b",
  jamesShirt: "#2f7cf6",
  jamesGround: "#dbe8ff",
  priyaSkin: "#c98e63",
  priyaHair: "#1c1410",
  priyaShirt: "#16a34a",
  priyaGround: "#dcf5e4",
  miaSkin: "#f5d0b5",
  miaHair: "#2a1a12",
  miaShirt: "#a855f7",
  miaGround: "#f1e6ff",
  ink: "#1d1d1f",
  appIconGradient: "linear-gradient(145deg, #ffb340, #ff6a2b 55%, #f2384b)",
  appIconSheen: "inset 0 0.5px 0 #ffffff80",
  glyph: "#ffffff",
  pointerBody: "#ffffff",
  pointerEdge: "#ffffff",
  pointerOutline: "#000000",
})

const art = styles({
  absolute: { position: "absolute" },
  fromStart: (start: number) => ({ start }),
  fromTop: (top: number) => ({ top }),
  fromEnd: (end: number) => ({ end }),
  fromBottom: (bottom: number) => ({ bottom }),
  width: (width: number | `${number}%`) => ({ width }),
  height: (height: number | `${number}%`) => ({ height }),
  fill: (backgroundColor: `#${string}`) => ({ backgroundColor }),
  image: (backgroundImage: string) => ({ backgroundImage }),
  round: (borderTopStartRadius: number, borderTopEndRadius: number, borderBottomEndRadius: number, borderBottomStartRadius: number) => ({ borderTopStartRadius, borderTopEndRadius, borderBottomEndRadius, borderBottomStartRadius }),
  shadow: (boxShadow: string) => ({ boxShadow }),
  border: (borderWidth: number, borderColor: `#${string}`) => ({ borderWidth, borderColor }),
  lines: (borderTopWidth: number, borderBottomWidth: number, borderColor: `#${string}`) => ({ borderTopWidth, borderBottomWidth, borderColor }),
  most: (maxWidth: number) => ({ maxWidth }),
  pad: (paddingTop: number, paddingEnd: number, paddingBottom: number, paddingStart: number) => ({ paddingTop, paddingEnd, paddingBottom, paddingStart }),
  margin: (marginTop: number, marginEnd: number | "auto", marginBottom: number, marginStart: number | "auto") => ({ marginTop, marginEnd, marginBottom, marginStart }),
  gap: (gap: number) => ({ gap }),
  opacity: (opacity: number) => ({ opacity }),
  layer: (zIndex: number) => ({ zIndex }),
  turn: (rotate: number) => ({ rotate }),
  grow: (flexGrow: number) => ({ flexGrow, flexShrink: 1, flexBasis: 0 }),
  timing: (animationDelay: number, animationDuration: number) => ({ animationDelay, animationDuration }),
  words: (fontSize: number, fontWeight: number, color: `#${string}`, lineHeight: number, letterSpacing: number) => ({ fontSize, fontWeight, color, lineHeight, letterSpacing }),
  ink: (color: `#${string}`) => ({ color }),
  plainWords: (fontSize: number, fontWeight: number, lineHeight: number, letterSpacing: number) => ({ fontSize, fontWeight, lineHeight, letterSpacing }),
  paint: (fill: `#${string}` | "none", stroke: `#${string}` | "none", strokeWidth: number) => ({ fill, stroke, strokeWidth }),
  shift: (translateX: number, translateY: number) => ({ translateX, translateY }),
  zoom: (scale: number) => ({ scale }),
  // A pointer gliding from one place to the next, and a part pressed, as a person's hand moves them.
  glides: { transitionProperty: ["translateX", "translateY"], transition: tokens.motion.travel },
  presses: { transitionProperty: ["scale"], transition: tokens.motion.quick },
  // What shows partway through a picture fades and grows in, as a sheet does.
  shows: { opacity: { default: 1, entering: 0 }, scale: { default: 1, entering: 0.96 }, transitionProperty: ["opacity", "scale"], transition: tokens.motion.settle },
  // What's absolute in a box is placed in it, as every part of a picture is placed in what it's in.
  placing: { position: "relative" },
  row: { flexDirection: "row", alignItems: "center" },
  column: { flexDirection: "column" },
  middle: { alignItems: "center", justifyContent: "center" },
  between: { justifyContent: "space-between" },
  start: { alignSelf: "flex-start" },
  clip: { overflow: "hidden" },
  still: { pointerEvents: "none" },
  line: { whiteSpace: "nowrap" },
  centred: { textAlign: "center" },
  mono: { fontFamily: tokens.font.mono },
})

/** Each side, as CSS's shorthand writes them: one, vertical and horizontal, or top, right, bottom and left. */
type Sides = number | [number, number] | [number, number, number, number]
const sides = (value: Sides): [number, number, number, number] => (typeof value === "number" ? [value, value, value, value] : value.length === 2 ? [value[0], value[1], value[0], value[1]] : value)

/** A box on the art board: where it is (`x`, `y`, or `right`, `bottom`), its size, fill or gradient (`image`), corners,
 * shadow and border, how what's in it is laid out, and how it moves (`move`, keyframes, after `delay` for `duration`
 * milliseconds). What's in a picture: every value is the picture's own. */
export type BoxProps = {
  x?: number
  y?: number
  right?: number
  bottom?: number
  w?: number | `${number}%`
  h?: number | `${number}%`
  fill?: `#${string}`
  image?: string
  r?: Sides
  shadow?: string
  border?: [number, `#${string}`]
  /** A rule along its top and its bottom, each so wide, in a colour. */
  lines?: [number, number, `#${string}`]
  most?: number
  pad?: Sides
  m?: [number, number | "auto", number, number | "auto"]
  gap?: number
  row?: boolean
  middle?: boolean
  between?: boolean
  start?: boolean
  clip?: boolean
  grow?: number
  opacity?: number
  z?: number
  turn?: number
  move?: Styles
  /** Moved from where it's placed, gliding there as it changes (a pointer), and grown (a part pressed). */
  shift?: [number, number]
  zoom?: number
  /** It fades in as it's first drawn, as what shows partway through a picture does. */
  shows?: boolean
  delay?: number
  duration?: number
  style?: Styles
  children?: Element
}

export const boxStyle = (props: BoxProps): Styles => [
  // Placed by any side it says, as CSS's `position: absolute` is, and else in its flow, placing what's absolute in it.
  props.x === undefined && props.y === undefined && props.right === undefined && props.bottom === undefined ? art.placing : art.absolute,
  props.x !== undefined && art.fromStart(props.x),
  props.y !== undefined && art.fromTop(props.y),
  props.right !== undefined && art.fromEnd(props.right),
  props.bottom !== undefined && art.fromBottom(props.bottom),
  props.w !== undefined && art.width(props.w),
  props.h !== undefined && art.height(props.h),
  props.fill !== undefined && art.fill(props.fill),
  props.image !== undefined && art.image(props.image),
  props.r !== undefined && art.round(...sides(props.r)),
  props.shadow !== undefined && art.shadow(props.shadow),
  props.border && art.border(...props.border),
  props.lines && art.lines(...props.lines),
  props.most !== undefined && art.most(props.most),
  props.pad !== undefined && art.pad(...sides(props.pad)),
  props.m && art.margin(...props.m),
  props.gap !== undefined && art.gap(props.gap),
  props.row && art.row,
  props.middle && art.middle,
  props.between && art.between,
  props.start && art.start,
  props.clip && art.clip,
  props.grow !== undefined && art.grow(props.grow),
  props.opacity !== undefined && art.opacity(props.opacity),
  props.z !== undefined && art.layer(props.z),
  props.turn !== undefined && art.turn(props.turn),
  props.move,
  props.move && art.timing(props.delay ?? 0, props.duration ?? 400),
  props.shift && [art.shift(...props.shift), art.glides],
  props.zoom !== undefined && [art.zoom(props.zoom), art.presses],
  props.shows && art.shows,
  props.style,
]

/** A box of the picture. */
export const Box = (props: BoxProps) => <View style={boxStyle(props)}>{props.children}</View>

/** Words of the picture: their size, weight and colour (`#1d1d1f` unless said), and the box they're in. */
export const Words = (props: BoxProps & { size: number; weight?: number; ink?: `#${string}`; leading?: number; spacing?: number; mono?: boolean; centred?: boolean; wraps?: boolean; onPanel?: boolean }) => (
  <Text
    style={[
      boxStyle(props),
      // On the picture's own ground, in its text's colour, light or dark; on what's drawn, in the colour it's given.
      props.onPanel
        ? art.plainWords(props.size, props.weight ?? 400, props.leading ?? Math.round(props.size * 1.25 * 10) / 10, props.spacing ?? 0)
        : art.words(props.size, props.weight ?? 400, props.ink ?? drawn.ink, props.leading ?? Math.round(props.size * 1.25 * 10) / 10, props.spacing ?? 0),
      !props.wraps && art.line,
      props.mono && art.mono,
      props.centred && art.centred,
    ]}
  >
    {props.children}
  </Text>
)

/** A run of words inside `Words`, in a colour of its own. */
export const Run = (props: { ink: `#${string}`; children: Element }) => <Text style={art.ink(props.ink)}>{props.children}</Text>

/** One path of a shape: its `d`, filled, or stroked `width` wide. */
export type Part = { d: string; fill?: `#${string}`; stroke?: `#${string}`; width?: number }

/** A shape, as an SVG: its paths in a `viewBox`, stretched to the box it's in (`w` by `h`). */
export const Shape = (props: BoxProps & { viewBox: string; parts: Part[] }) => (
  <Svg viewBox={props.viewBox} style={boxStyle(props)}>
    {props.parts.map((part) => (
      <Path d={part.d} style={art.paint(part.fill ?? "none", part.stroke ?? "none", part.width ?? 1)} />
    ))}
  </Svg>
)

/** A circle's path. */
export const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`

/** A rectangle's path, its corners rounded `r`. */
export const rect = (x: number, y: number, w: number, h: number, r = 0) =>
  r ? `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z` : `M${x} ${y}h${w}v${h}h${-w}z`

/** The people in the pictures, drawn, not initials: skin, hair, shirt, background and how their hair is. */
export const people = {
  sarah: [drawn.sarahSkin, drawn.sarahHair, drawn.sarahShirt, drawn.sarahGround, "long"],
  james: [drawn.jamesSkin, drawn.jamesHair, drawn.jamesShirt, drawn.jamesGround, "short"],
  priya: [drawn.priyaSkin, drawn.priyaHair, drawn.priyaShirt, drawn.priyaGround, "bun"],
  mia: [drawn.miaSkin, drawn.miaHair, drawn.miaShirt, drawn.miaGround, "bun"],
} as const satisfies Record<string, readonly [`#${string}`, `#${string}`, `#${string}`, `#${string}`, "long" | "short" | "bun"]>
export type Person = keyof typeof people

const hair = {
  short: (c: `#${string}`): Part[] => [{ d: "M11.6 17.5c-.6-6.5 3.2-10.5 8.4-10.5s9 4 8.4 10.5c-1-3.6-3.9-5.6-8.4-5.6s-7.4 2-8.4 5.6z", fill: c }],
  long: (c: `#${string}`): Part[] => [{ d: "M11 28V17c0-6.2 4-10.4 9-10.4s9 4.2 9 10.4v11h-3.2V18c-1.2-3.6-3.4-5.4-5.8-5.4s-4.6 1.8-5.8 5.4v10z", fill: c }],
  bun: (c: `#${string}`): Part[] => [
    { d: circle(20, 6, 3.6), fill: c },
    { d: "M11.6 17.5c-.6-6.5 3.2-10.3 8.4-10.3s9 3.8 8.4 10.3c-1.3-3.2-4.2-5-8.4-5s-7.1 1.8-8.4 5z", fill: c },
  ],
}

/** A person's round picture, `size` across. */
export function Avatar(props: BoxProps & { who: Person; size: number }) {
  const [skin, hairColour, shirt, background, style] = people[props.who]
  return (
    <Box {...props} w={props.size} h={props.size} r={props.size / 2} clip>
      <Shape
        w={props.size}
        h={props.size}
        viewBox="0 0 40 40"
        parts={[
          { d: rect(0, 0, 40, 40), fill: background },
          { d: "M5 41c0-8.4 6.6-13 15-13s15 4.6 15 13z", fill: shirt },
          { d: rect(17, 22, 6, 7, 3), fill: skin },
          { d: circle(20, 17.5, 8), fill: skin },
          ...hair[style](hairColour),
        ]}
      />
    </Box>
  )
}

/** The app the pictures make, its icon: a rounded square of orange to red, its glyph white. */
export const AppIcon = (props: BoxProps & { size: number; glyph: Part[]; stroke?: number }) => (
  <Box {...props} w={props.size} h={props.size} r={props.size * 0.23} image={drawn.appIconGradient} shadow={drawn.appIconSheen} middle>
    <Shape w={props.size * 0.62} h={props.size * 0.62} viewBox="0 0 24 24" parts={props.glyph} />
  </Box>
)

/** A calendar with a tick, Roster's glyph, white on its icon. */
export const roster = (width = 2.4): Part[] => [{ d: "M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm4 8 2 2 4-4", stroke: drawn.glyph, width }]

/** A box, Orders' glyph. */
export const orders = (width = 2): Part[] => [{ d: "M12 3 4 7.2v9.6L12 21l8-4.2V7.2zM4 7.2l8 4.2 8-4.2M12 11.4V21M8 5.1l8 4.2", stroke: drawn.glyph, width }]

/** A tent, Camp sign-up's glyph. */
export const camp = (width = 2.6): Part[] => [{ d: "M12 3 3 19h18zM12 3v16M9 19l3-5 3 5", stroke: drawn.glyph, width }]

/** The pointer someone moves, white edged in black, or an agent's, in its colour edged in white. */
export const Pointer = (props: BoxProps & { colour?: `#${string}` }) => (
  <Shape {...props} w={13} h={19} z={4} viewBox="0 0 13 19" parts={[{ d: "M1 1v14.5l3.6-3.4 2.4 5.6 2.4-1-2.4-5.5h5z", fill: props.colour ?? drawn.pointerBody, stroke: props.colour ? drawn.pointerEdge : drawn.pointerOutline, width: props.colour ? 1.2 : 1 }]} />
)

/** The art board every picture is drawn on, and the part of it that's fitted to the room it has (its margins trimmed). */
export const BOARD = { width: 440, height: 330, fits: [428, 302] }
/** How round a picture's panel is, as the mockups have it: the window's radius, 10, and 6 more. */
const PANEL_ROUND = 16

const panels = styles({
  panel: (width: number, height: number, borderRadius: number) => ({ position: "relative", width, height, borderRadius, overflow: "hidden", color: tokens.colour.label }),
  ground: { backgroundImage: "radial-gradient(120% 90% at 50% 100%, color-mix(in oklab, currentColor 7%, transparent), color-mix(in oklab, currentColor 3%, transparent))" },
  stage: (start: number, top: number, width: number, height: number, scale: number) => ({ position: "absolute", start, top, width, height, scale, pointerEvents: "none" }),
})

/** A picture in its panel, `width` by `height`, on the pictures' soft ground unless it's `bare` (one with a ground of
 * its own, a desktop): its art board centred in it and grown to fill it, and `over` drawn over that at the panel's own
 * size (a caption). It's only to look at, so it's hidden from assistive tech and takes no presses. */
export const Panel = (props: { width: number; height: number; bare?: boolean; over?: Element; children: Element }) => {
  const scale = () => Math.min(props.width / BOARD.fits[0], props.height / BOARD.fits[1])
  return (
    <View style={[panels.panel(props.width, props.height, PANEL_ROUND), !props.bare && panels.ground]} aria-hidden="true">
      <View style={panels.stage((props.width - BOARD.width) / 2, (props.height - BOARD.height) / 2, BOARD.width, BOARD.height, scale())}>{props.children}</View>
      {props.over}
    </View>
  )
}

/** A picture of the art board's own (a brand's logo), sized and placed as a box is. */
export const Picture = (props: BoxProps & { src: string }) => <Image src={props.src} alt="" style={boxStyle(props)} />
