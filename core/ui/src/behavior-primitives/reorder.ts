// Reordering a list: an item dragged by a pointer or picked up with the keyboard moves through a draft order, which
// the list draws as it moves, and only dropping it commits it. From Vercel's UI SDK (Apache-2.0),
// packages/core/src/foundation/drag-and-drop/reorder.ts at ab55044caee66cc8228fa7ed3525088a1b7b5af7: its keys (Space or
// Enter picks an item up, arrows, Home and End move it, Space or Enter drops it, Escape puts it back, and Tab puts it
// back and goes on), where a dragged item goes among the others (after every middle it has passed, `dropIndex`),
// `movedTo`, and what screen readers hear at each step (`reorderMessage`); on our host: the draft in a signal, the
// pointer by `createDrag`, and the items drawn in the order they're in, each moved along to its place in the draft
// (`place`), as a style the renderer moves, what's dragged under the pointer, where each is from how tall each was
// laid out, so a drag reads no layout and the list's own order changes only as an item is dropped. Left out, as nothing here uses them: a group moving
// together, grids, a floating copy and scrolling at an edge. Added: items that stay where they are (`fixed`), which
// the others move around but never past, as You first and Everyone last in the Home Screen's order.
import { createSignal } from "solid-js"
import { announce } from "./announce.tsx"
import { createDrag } from "./drag.ts"
import { moveIndex, stepFor } from "./collection.ts"
import { messages } from "../words.ts"
import type { Keyed, Pressed } from "../types/ui.d.ts"

/** What happened, which screen readers hear: picked up, moved a step, dropped, or put back. */
export type ReorderStep = "grab" | "move" | "drop" | "cancel"

/** Where a dragged item goes among the others that move: after every one whose middle it has passed. */
export function dropIndex(middles: readonly number[], pointer: number) {
  let index = 0
  for (const middle of middles) if (middle < pointer) index++
  return index
}

/** The order with `key` at `index` among the items that move, those that stay (`fixed`) keeping their places. The
 * same array where it's there already. */
export function movedTo(order: readonly string[], key: string, index: number, fixed: (key: string) => boolean = () => false): readonly string[] {
  const moving = order.filter((one) => !fixed(one))
  const rest = moving.filter((one) => one !== key)
  const to = Math.max(0, Math.min(rest.length, index))
  if (moving[to] === key) return order
  rest.splice(to, 0, key)
  let next = 0
  return order.map((one) => (fixed(one) ? one : rest[next++]))
}

/** An item picked up: the order the list shows as it moves, and whether a pointer drags it. */
type Draft = { key: string; order: readonly string[]; pointer: boolean }

/** `const reorder = createReorder({ order: () => keys(), label: (key) => nameOf(key), onReorder: setKeys })`: a list
 * whose items are put in order by dragging them or with the keyboard. Draw the items in `reorder.laid()`'s order, each
 * moved down `reorder.place(key)` (moving there unless `still()`, what lands at `velocity()`); each spreads
 * `reorder.drag(key)` where it's dragged from, says how tall it's laid out (`measured`) and when it has come to rest
 * (`landed`); its handle's press is `reorder.press(key)` and its keys `reorder.keydown(event, key)`. `onReorder` is
 * told the new order as an item's dropped somewhere new; what a pointer let go of lands in its place before the list
 * is laid out in it. */
export function createReorder(options: { order: () => readonly string[]; fixed?: (key: string) => boolean; label: (key: string) => string; onReorder: (order: string[]) => void }) {
  const fixed = (key: string) => options.fixed?.(key) ?? false
  const [draft, setDraft] = createSignal<Draft>()
  // What a pointer carries, held under it where it's `held`, then landing in its place once it's let go, at the speed
  // it was let go at, of its way a second.
  const [carried, setCarried] = createSignal<{ key: string; landing: boolean; velocity?: number }>()
  const [held, setHeld] = createSignal(0)
  // The order the items are laid out in while what was let go lands, the one before it was dropped.
  const [landing, setLanding] = createSignal<readonly string[]>()
  const laid = () => landing() ?? options.order()
  // The frame the list's order changes in, as an item's dropped: each item drawn where it was, now its place.
  const [still, setStill] = createSignal(false)
  const settle = () => {
    setStill(true)
    requestAnimationFrame(() => setStill(false))
  }
  const heights = new Map<string, number>()
  const top = (order: readonly string[], key: string) => {
    let y = 0
    for (const one of order) {
      if (one === key) break
      y += heights.get(one) ?? 0
    }
    return y
  }
  const say = (step: ReorderStep, key: string, order: readonly string[]) => announce(messages.reordered(step, options.label(key), order.indexOf(key) + 1, order.length), { priority: "assertive" })

  const grab = (key: string, pointer: boolean): Draft | undefined => {
    const order = options.order()
    if (draft() || !order.includes(key) || fixed(key)) return
    const picked = { key, order, pointer }
    setDraft(picked)
    say("grab", key, order)
    return picked
  }
  const moveTo = (current: Draft, index: number): Draft => {
    const order = movedTo(current.order, current.key, index, fixed)
    if (order === current.order) return current
    const moved = { ...current, order }
    setDraft(moved)
    say("move", current.key, order)
    return moved
  }
  const drop = (current: Draft) => {
    setDraft(undefined)
    say("drop", current.key, current.order)
    if (current.order.join("\n") === options.order().join("\n")) return
    if (current.pointer) setLanding(options.order())
    else settle()
    options.onReorder([...current.order])
  }
  const cancel = (current: Draft) => {
    setDraft(undefined)
    say("cancel", current.key, options.order())
  }

  return {
    /** The order it's in now: the draft's while an item is up, else the list's. */
    order: () => draft()?.order ?? options.order(),
    /** The order the items are laid out in. */
    laid,
    /** How far down an item is drawn from where it's laid out: to its place, or under the pointer. */
    place(key: string) {
      const now = carried()
      if (now?.key === key && !now.landing) return held() - top(laid(), key)
      return top(draft()?.order ?? options.order(), key) - top(laid(), key)
    },
    /** How far down an item is drawn from where it's laid out, as a share of its own height, which is what a style
     * moves it by: where it is is told in the window's pixels, which an ancestor grown or shrunk (a launcher's card
     * settling in) makes more or fewer than the item's own, but not as a share. */
    share: (key: string, by: number): `${number}%` => (heights.get(key) ? `${(100 * by) / heights.get(key)!}%` : "0%"),
    /** How fast what lands sets off, of its way a second. */
    velocity: () => carried()?.velocity ?? 0,
    /** Whether items are drawn where they are without moving there: as the list's order changes, and what's held. */
    still: (key: string) => still() || (carried()?.key === key && !carried()!.landing),
    /** Whether an item is picked up, by a pointer or the keyboard. */
    up: (key: string) => draft()?.key === key,
    /** Whether a pointer has the item, held under it or landing in its place. */
    carried: (key: string) => carried()?.key === key,
    landing: (key: string) => carried()?.key === key && carried()!.landing,
    /** How tall an item is laid out, which where each is follows from: not while it's up, grown as it's lifted. */
    measured: (key: string, height: number) => void (draft()?.key !== key && carried()?.key !== key && heights.set(key, height)),
    /** It has come to rest in its place: what landed is laid out where it is, with nothing moving. */
    landed(key: string) {
      if (carried()?.key !== key || !carried()!.landing) return
      setCarried(undefined)
      if (!landing()) return
      settle()
      setLanding(undefined)
    },
    /** What a pointer drags an item by, spread where it's dragged from: once it has moved a few points, which
     * `accepts` may limit (a finger to its handle). Let go, it lands in its place from where it was let go. */
    drag(key: string, accepts?: (event: Pressed) => boolean) {
      let current: Draft | undefined
      let from = 0
      let within = [0, 0]
      let y = 0
      return createDrag({
        axis: "y",
        accepts: (event) => !draft() && !carried() && !fixed(key) && (accepts?.(event) ?? true),
        onStart: () => {
          current = grab(key, true)
          if (!current) return
          const order = current.order
          from = top(order, key)
          // It goes no further than the first place and the last an item may move to.
          within = [top(movedTo(order, key, 0, fixed), key), top(movedTo(order, key, order.length, fixed), key)]
          y = from
          setHeld(y)
          setCarried({ key, landing: false })
        },
        onMove: (delta) => {
          if (!current) return
          // Drawn no further than the ends, but where it goes is where the pointer has it: held at the last place, its
          // middle is the middle of the last it passed, which it has to go past to take its place.
          y = Math.max(within[0], Math.min(within[1], from + delta))
          const others = current.order.filter((one) => one !== key && !fixed(one))
          const middles = others.map((one) => top(current!.order, one) + (heights.get(one) ?? 0) / 2)
          current = moveTo(current, dropIndex(middles, from + delta + (heights.get(key) ?? 0) / 2))
          setHeld(y)
        },
        onEnd: ({ canceled, velocity }) => {
          if (!current) return
          const to = top(canceled ? options.order() : current.order, key)
          if (canceled) cancel(current)
          else drop(current)
          current = undefined
          // From where it was let go, at the speed it was going, into its place.
          const way = to - y
          setCarried({ key, landing: true, velocity: Math.abs(way) < 1 ? 0 : Math.max(-20, Math.min(20, (velocity * 1000) / way)) })
        },
      }).gesture
    },
    /** Its handle pressed, by Space or Enter, or a screen reader: it's picked up, or the one that's up is dropped. */
    press(key: string) {
      const current = draft()
      if (current) drop(current)
      else grab(key, false)
    },
    /** A key on an item while one is up: arrows, Home and End move it, Escape puts it back and Tab puts it back
     * and goes on. → whether it took the key. */
    keydown(event: Keyed, key: string) {
      const current = draft()
      if (!current) return false
      if (current.pointer || current.key !== key) return true
      if (event.key === "Tab") {
        cancel(current)
        return true
      }
      const step = event.altKey || event.ctrlKey || event.metaKey ? undefined : stepFor(event.key, "vertical", false)
      if (step !== undefined) {
        event.preventDefault()
        const moving = current.order.filter((one) => !fixed(one))
        moveTo(current, moveIndex(moving.indexOf(key), step, moving.length, false))
      } else if (event.key === "Escape") {
        event.preventDefault()
        cancel(current)
      }
      return true
    },
  }
}

export type Reorder = ReturnType<typeof createReorder>
