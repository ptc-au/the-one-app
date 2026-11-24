// A tile: a count and what it counts, pressed to show those, as iOS Reminders' lists at the top of its screen are.
// Written once on the drawing primitives, the same on every host.
import { Show } from "solid-js"
import { Pressable, Text, View } from "#primitives"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

const look = styles({
  tile: {
    flexGrow: 1,
    flexBasis: tokens.grid[24],
    minWidth: 0,
    gap: tokens.grid[0.5],
    paddingBlock: tokens.grid[2],
    paddingInline: tokens.grid[3],
    borderRadius: tokens.radius.medium,
    backgroundColor: { default: tokens.colour.card, hover: tokens.colour.choiceHover },
    color: tokens.colour.label,
    boxShadow: { default: tokens.shadow.edge, focused: tokens.shadow.focus },
    cursor: "pointer",
    userSelect: "none",
    opacity: { default: 1, pressed: 0.7 },
    transitionProperty: ["backgroundColor", "color"],
    transition: tokens.motion.quick,
  },
  // The one chosen is filled, as the default button is.
  chosen: { backgroundColor: { default: tokens.colour.label, hover: tokens.colour.label }, color: tokens.colour.background },
  value: { font: tokens.type.title },
  line: { flexDirection: "row", alignItems: "flex-start", gap: tokens.grid[1.5], minWidth: 0 },
  // What it counts, and a note under it, at the text's 70%, chosen or not.
  label: { flexShrink: 1, minWidth: 0, font: tokens.type.small, opacity: 0.7 },
  note: { font: tokens.type.caption, opacity: 0.7 },
  // Level with the label's first line.
  dot: { width: tokens.grid[2.5], height: tokens.grid[2.5], flexShrink: 0, marginTop: tokens.grid[1], borderRadius: tokens.radius.full },
  colour: (backgroundColor: `#${string}`) => ({ backgroundColor }),
})

/// `<Tile value={7} label="To do" colour="#87909e" chosen={view() === "to do"} onPress={() => setView("to do")} />`:
/// a count and what it counts, pressed to show those, as iOS Reminders' lists at the top of its screen are, filled
/// while it's `chosen`. `colour` is a dot before its label, the colour its things have where they come from (a
/// ClickUp status's), and `note` a grey line under it. Tiles side by side share a row, a few to a phone's width, in
/// a view that wraps them (`flexDirection: "row", flexWrap: "wrap"`).
export function Tile(props: { value: number; label: string; note?: string; colour?: `#${string}` | null; chosen?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      role="button"
      aria-pressed={props.chosen ? "true" : "false"}
      aria-label={`${props.label}${props.note ? `, ${props.note}` : ""}: ${props.value.toLocaleString()}`}
      onPress={props.onPress}
      style={[look.tile, props.chosen && look.chosen]}
    >
      <Text style={look.value}>{props.value.toLocaleString()}</Text>
      <View style={look.line}>
        <Show when={props.colour}>{(colour) => <View style={[look.dot, look.colour(colour())]} />}</Show>
        <Text style={look.label}>{props.label}</Text>
      </View>
      <Show when={props.note}>
        <Text style={look.note}>{props.note}</Text>
      </Show>
    </Pressable>
  )
}
