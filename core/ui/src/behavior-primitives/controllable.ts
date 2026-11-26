// What's chosen, ticked or open: the caller's where it says (`value`), else the component's own, from `defaultValue`.
// The rule of Vercel's UI SDK (Apache-2.0), packages/core/src/foundation/kernel/change.ts at
// ab55044caee66cc8228fa7ed3525088a1b7b5af7: a change asks the caller (`onChange`) and is kept where the caller doesn't
// hold the value, and a change to the value it already has does nothing. Named as Solid's own libraries name it
// (Kobalte's `createControllableSignal`). Ours holds a change as Solid 2's actions do: what was chosen shows at once and
// stays while what `onChange` gives back (a tool it calls, and what it asks again) is under way, so a read that left
// before it can't turn a switch back for a moment.
import { action, createOptimistic, createSignal } from "solid-js"

/** `const [value, setValue] = createControllableSignal({ value: () => props.value, defaultValue: () => props.defaultValue, onChange: (value) => props.onValueChange?.({ value }) })`:
 * a value a component keeps, as its caller says where it says. */
export function createControllableSignal<T>(options: { value: () => T | undefined; defaultValue?: () => T | undefined; onChange?: (value: T) => unknown }) {
  const [own, setOwn] = createSignal<T | undefined>(undefined)
  const [touched, setTouched] = createSignal(false)
  const [value, setValue] = createOptimistic(() => options.value() ?? (touched() ? own() : options.defaultValue?.()))
  const set = action(function* (next: T) {
    if (Object.is(next, value())) return
    setValue(() => next)
    setOwn(() => next)
    setTouched(true)
    yield options.onChange?.(next)
  })
  return [value, (next: T) => void set(next)] as const
}
