// A list whose rows are put in order by hand: a card of rows, each with its handle, as iOS's lists in edit mode and
// macOS's System Settings reorder them. Written once on the drawing primitives, the same on every host.
import { For, Show } from "solid-js"
import { Pressable, Text, View } from "#primitives"
import { touch } from "#bridge"
import { Icon } from "./button.tsx"
import { messages } from "../words.ts"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"
import { createReorder } from "../behavior-primitives/reorder.ts"
import { createRovingFocus } from "../behavior-primitives/roving-focus.ts"

const look = styles({
  list: { maxWidth: tokens.length.readable, borderRadius: tokens.radius.large, backgroundColor: tokens.colour.card, color: tokens.colour.label, boxShadow: tokens.shadow.edge },
  row: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.grid[3],
    minHeight: tokens.length.groupedRow,
    paddingStart: tokens.grid[3],
    // A finger moving up or down on a row scrolls what it's in: only its handle drags it.
    touchAction: "pan-y",
  },
  // With a mouse the whole row drags, as macOS's lists do.
  grabbed: { cursor: "grab" },
  // Moving into its place, as the rows around what's carried make room, as the keyboard moves it, and as it's dropped.
  moving: { transitionProperty: ["translateY", "scale", "backgroundColor"], transition: tokens.motion.smooth },
  // Let go, it sets off at the speed the pointer had.
  flung: (transitionVelocity: number) => ({ transition: tokens.motion.smooth, transitionVelocity }),
  // Picked up: a card of its own over the rest, opaque as a card in the dark isn't, a little larger, its shadow under
  // it, as a phone lifts what a finger carries.
  lifted: { zIndex: 1, scale: 1.02, backgroundColor: tokens.colour.elevated, borderRadius: tokens.radius.large, boxShadow: tokens.shadow.lifted },
  offset: (translateY: number) => ({ translateY }),
  rule: { position: "absolute", top: 0, start: tokens.grid[3], end: 0, height: tokens.length.hairline, backgroundColor: tokens.colour.quinaryLabel },
  hidden: { opacity: 0 },
  heading: { flexGrow: 1, flexShrink: 1, minWidth: 0, paddingBlock: tokens.grid[2], font: tokens.type.groupedRow, lineClamp: 2 },
  handle: {
    flexShrink: 0,
    alignSelf: "stretch",
    minWidth: tokens.length.control,
    justifyContent: "center",
    alignItems: "center",
    paddingInline: tokens.grid[3],
    color: tokens.colour.secondaryLabel,
    borderRadius: tokens.radius.large,
  },
  // A row that stays where it is has room where the handle would be, so its words line up with the others'.
  still: { minWidth: tokens.length.control, paddingInline: tokens.grid[3] },
})

/// `<ReorderList label="Groups" each={groups()} keyed={(group) => group.id} heading={(group) => group.name}
/// onReorder={setGroups} />`: things put in order by hand, a row each in a card, as iOS's lists in edit mode and
/// macOS's System Settings reorder them. A row is dragged by its handle (≡), or with a mouse by any of it; it follows
/// the pointer, the others making room, and let go, it settles into its place and `onReorder` is told the new order. On
/// a computer its handles are one tab stop, Up and Down moving between them; Space picks a row up, the arrows, Home and
/// End move it, Space drops it and Escape puts it back, and a screen reader hears each step. A row that's `fixed`
/// stays where it is, with no handle, and the others move around it but never past it, as a list's first and last
/// may be kept there.
export function ReorderList<T>(props: { label: string; each: readonly T[]; keyed: (item: T) => string; heading: (item: T) => string; fixed?: (item: T) => boolean; onReorder: (items: T[]) => void }) {
  const byKey = () => new Map(props.each.map((item) => [props.keyed(item), item]))
  const fixed = (key: string) => !!props.fixed?.(byKey().get(key)!)
  const reorder = createReorder({
    order: () => props.each.map(props.keyed),
    fixed,
    label: (key) => props.heading(byKey().get(key)!),
    onReorder: (order) => props.onReorder(order.map((key) => byKey().get(key)!)),
  })
  const roving = createRovingFocus({ items: () => reorder.order().filter((key) => !fixed(key)).map((key) => ({ key })) })
  return (
    <View role="list" aria-label={props.label} style={look.list}>
      <For each={reorder.laid()}>
        {(key, index) => {
          const item = () => byKey().get(key)!
          // A finger drags it only by its handle, as on a phone, where the rest of it scrolls what it's in; a press
          // by a pointer is the drag's, and only a key or a screen reader's press picks it up.
          let onHandle: number | undefined
          let pointed = false
          const drag = reorder.drag(key, (event) => event.pointerType !== "touch" || event.pointerId === onHandle)
          const carried = () => reorder.carried(key)
          return (
            <View
              role="listitem"
              aria-label={props.heading(item())}
              onLayout={(event) => reorder.measured(key, event.currentTarget.getBoundingClientRect().height)}
              onTransitionEnd={(event) => event.rest !== false && reorder.landed(key)}
              {...(fixed(key) ? {} : drag)}
              style={[look.row, !touch() && !fixed(key) && look.grabbed, !reorder.still(key) && look.moving, reorder.landing(key) && look.flung(reorder.velocity()), (reorder.up(key) || (carried() && !reorder.landing(key))) && look.lifted, look.offset(reorder.place(key))]}
            >
              <Show when={index() > 0}>
                <View style={[look.rule, reorder.up(key) && look.hidden]} />
              </Show>
              <Text style={look.heading}>{props.heading(item())}</Text>
              <Show when={!fixed(key)} fallback={<View style={look.still} />}>
                <Pressable
                  role="button"
                  aria-label={messages.reorder(props.heading(item()))}
                  aria-description={messages.reorderHint}
                  aria-pressed={reorder.up(key) ? "true" : "false"}
                  {...roving.item(key)}
                  onPointerDown={(event) => ((onHandle = event.pointerId), (pointed = true))}
                  onKeyDown={(event) => {
                    pointed = false
                    if (!reorder.keydown(event, key)) roving.keydown(event, key)
                  }}
                  onPress={() => (pointed ? (pointed = false) : reorder.press(key))}
                  style={look.handle}
                >
                  <Icon name="list" />
                </Pressable>
              </Show>
            </View>
          )
        }}
      </For>
    </View>
  )
}
