// Keys, as a Mac and a PC name them: whether it's a Mac, how a key's shown, and whether a key pressed is these keys.
import { createSignal } from "solid-js"
import { client } from "#bridge"
import type { Keyed } from "../types/ui.d.ts"

/** Whether it's a Mac, whose keys are ⌘ where a PC's are Ctrl, as its client says. */
export const [mac, setMac] = createSignal(false)
let asked = false
/** Asks the client whether it's a Mac, once, for `pressed`. */
export const askMac = () => {
  if (asked) return
  asked = true
  client().then((said) => setMac(!!said.mac), () => {})
}

/** How a key's shown: ⌘ or Ctrl, ⇧ and the rest as a Mac's menus show them, a letter in capitals, a word (Space) as
 * it's written; Return, which fonts don't all have a glyph for, is an icon (a tip's keycaps). */
export const shown = (key: string): string =>
  ({ mod: mac() ? "⌘" : "Ctrl", shift: "⇧", alt: mac() ? "⌥" : "Alt", ctrl: mac() ? "⌃" : "Ctrl", escape: "esc", backspace: "⌫", delete: "⌦", tab: "⇥", up: "↑", down: "↓", left: "←", right: "→" })[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key)

/** Whether a key pressed is these keys, `mod` being ⌘ on a Mac and Ctrl elsewhere (`askMac` first). */
export const pressed = (keys: string[], event: Keyed) => {
  const want = keys.map((key) => key.toLowerCase())
  const has = (name: string) => want.includes(name)
  const command = has("mod") ? (mac() ? event.metaKey : event.ctrlKey) : false
  const mods = (has("mod") ? command : !(mac() ? event.metaKey : event.ctrlKey)) && !!event.shiftKey === has("shift") && !!event.altKey === has("alt")
  const key = want.find((one) => !["mod", "shift", "alt", "ctrl"].includes(one))
  const named = { enter: "Enter", escape: "Escape", backspace: "Backspace", delete: "Delete", tab: "Tab", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" } as Record<string, string>
  return mods && !!key && (named[key] ?? key) === (key.length === 1 ? event.key.toLowerCase() : event.key)
}
