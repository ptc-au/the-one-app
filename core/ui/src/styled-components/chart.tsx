// A chart: bars or a line of values over their labels, drawn once it's laid out, in its own pixels. Written once on
// the drawing primitives, the same on every host, and a widget's `chart` part draws with it.
import { createSignal, For, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Path, Svg, Text, View } from "#primitives"
import type { Laid, Rect } from "../types/ui.d.ts"
import { styles, type Styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

const look = styles({
  chart: { flexGrow: 1, gap: tokens.grid[1], minWidth: 0, minHeight: 0 },
  bars: { position: "relative", flexGrow: 1, minHeight: 0 },
  over: { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, width: "100%", height: "100%" },
  // With one bar picked out, the others are the secondary text's colour.
  other: { color: tokens.colour.secondaryLabel },
  labels: { flexDirection: "row" },
  label: { flexGrow: 1, flexBasis: 0, minWidth: 0, font: tokens.type.small, color: tokens.colour.secondaryLabel, textAlign: "center", lineClamp: 1 },
  // A bar's figure, just over it.
  figure: { position: "absolute", font: tokens.type.small, color: tokens.colour.secondaryLabel, textAlign: "center", lineClamp: 1 },
  place: (start: number, width: number, bottom: number) => ({ start, width, bottom }),
})

/** A coordinate, short. */
export const at = (value: number) => Math.round(value * 100) / 100

/** A rectangle with round corners, as a path. */
export const rounded = (x: number, y: number, width: number, height: number, radius: number) => {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  return `M${at(x + r)} ${at(y)}H${at(x + width - r)}A${r} ${r} 0 0 1 ${at(x + width)} ${at(y + r)}V${at(y + height - r)}A${r} ${r} 0 0 1 ${at(x + width - r)} ${at(y + height)}H${at(x + r)}A${r} ${r} 0 0 1 ${at(x)} ${at(y + height - r)}V${at(y + r)}A${r} ${r} 0 0 1 ${at(x + r)} ${at(y)}Z`
}

/** Points along a box `width` by `height`, one for each value up to `max`, from the left edge to the right. */
export const along = (values: number[], max: number, width: number, height: number) =>
  values.map((value, index) => [values.length > 1 ? (index / (values.length - 1)) * width : width / 2, height - 1 - (Math.min(value, max) / max) * (height - 2)] as const)

/** A line through `points`, `thick` across, as a shape to fill: its two edges, each a half's width out, mitred at
 * each turn. */
export function band(points: readonly (readonly [number, number])[], thick: number) {
  if (points.length < 2) return ""
  const normal = (from: readonly [number, number], to: readonly [number, number]) => {
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]]
    const length = Math.hypot(dx, dy) || 1
    return [-dy / length, dx / length] as const
  }
  const out = points.map((point, index) => {
    const before = index > 0 ? normal(points[index - 1], point) : undefined
    const after = index < points.length - 1 ? normal(point, points[index + 1]) : undefined
    const [a, b] = [before ?? after!, after ?? before!]
    const [x, y] = [a[0] + b[0], a[1] + b[1]]
    const length = Math.hypot(x, y) || 1
    // How far out the mitre is, no more than twice the half's width at a sharp turn.
    const mitre = Math.min(2, 1 / Math.max(0.5, (x / length) * a[0] + (y / length) * a[1])) * (thick / 2)
    return [(x / length) * mitre, (y / length) * mitre] as const
  })
  const edge = (side: 1 | -1, order: number[]) => order.map((index) => `${at(points[index][0] + side * out[index][0])} ${at(points[index][1] + side * out[index][1])}`)
  const indices = points.map((_, index) => index)
  return `M${[...edge(1, indices), ...edge(-1, indices.reverse())].join("L")}Z`
}

/// A box its shapes fill, drawn once it's laid out, in its own pixels, so a line is as thick however wide it is.
export function Drawn(props: { label?: string; style?: Styles; draw: (width: number, height: number) => JSX.Element }) {
  const [size, setSize] = createSignal<Rect>()
  const laid = (event: Laid) => {
    const { width, height } = event.currentTarget.getBoundingClientRect()
    if (width !== size()?.width || height !== size()?.height) setSize({ x: 0, y: 0, width, height })
  }
  return (
    <View role={props.label ? "img" : undefined} aria-label={props.label} onLayout={laid} style={props.style}>
      <Show when={size()?.width && size()?.height ? size() : undefined}>{(box) => props.draw(box().width, box().height)}</Show>
    </View>
  )
}

// The room a bar's figure takes over it, in pixels: a small line of text.
const FIGURE = 18

/// `<Chart values={[3, 5, 2]} labels={["13 Oct", "20 Oct", "This wk"]} highlight={2} figures label="Closed per week" />`:
/// values as bars, each in its slot over its label, or with `kind="line"` a line through them, up to `max` (the
/// largest unless it says), in the text's colour. `highlight` picks one bar out, the rest in the secondary text's colour, as the week
/// that's now is; `figures` says each bar's value just over it. It fills the room it's given, which a `height` in
/// its `style` sets. `label` is what a screen reader hears of it.
export function Chart(props: {
  values: number[]
  labels?: string[]
  kind?: "bar" | "line"
  max?: number
  highlight?: number
  figures?: boolean
  label?: string
  style?: Styles
}) {
  const max = () => props.max ?? Math.max(...props.values, 1)
  const top = () => (props.figures && props.kind !== "line" ? FIGURE : 0)
  const tall = (value: number, height: number) => (Math.max(0, Math.min(value, max())) / max()) * (height - top())
  /// The bars `which` picks, each in its own slot at three fifths of its width.
  const bars = (width: number, height: number, which: (index: number) => boolean) => {
    const slot = width / Math.max(props.values.length, 1)
    return props.values
      .map((value, index) => {
        const high = tall(value, height)
        return which(index) && high > 0 ? rounded(index * slot + slot * 0.2, height - high, slot * 0.6, high, 3) : ""
      })
      .join("")
  }
  const picked = () => props.highlight !== undefined && props.highlight >= 0 && props.highlight < props.values.length
  return (
    <View style={[look.chart, props.style]}>
      <Drawn
        label={props.label}
        style={look.bars}
        draw={(width, height) => (
          <Show
            when={props.kind !== "line"}
            fallback={
              <Svg viewBox={`0 0 ${at(width)} ${at(height)}`} style={look.over}>
                <Path d={band(along(props.values, max(), width, height), 1.5)} />
              </Svg>
            }
          >
            <Svg viewBox={`0 0 ${at(width)} ${at(height)}`} style={[look.over, picked() && look.other]}>
              <Path d={bars(width, height, (index) => !picked() || index !== props.highlight)} />
            </Svg>
            <Show when={picked()}>
              <Svg viewBox={`0 0 ${at(width)} ${at(height)}`} style={look.over}>
                <Path d={bars(width, height, (index) => index === props.highlight)} />
              </Svg>
            </Show>
            <Show when={props.figures}>
              <For each={props.values} keyed={false}>
                {(value, index) => {
                  const slot = () => width / Math.max(props.values.length, 1)
                  return (
                    <Text aria-hidden="true" style={[look.figure, look.place(index * slot(), slot(), tall(value(), height) + 2)]}>
                      {value().toLocaleString()}
                    </Text>
                  )
                }}
              </For>
            </Show>
          </Show>
        )}
      />
      <Show when={props.labels}>
        <View style={look.labels}>
          <For each={props.labels} keyed={false}>
            {(label) => <Text style={look.label}>{label()}</Text>}
          </For>
        </View>
      </Show>
    </View>
  )
}
