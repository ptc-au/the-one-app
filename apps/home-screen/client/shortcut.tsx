// The launcher's shortcut, as its person sees and changes it, in onboarding's Open from anywhere and Settings' General:
// the keys as keycaps, Change to record new ones (Escape cancels), three to pick from, and Reset to Default once it's
// another. The computer's app keeps it and takes a new one at once (`client({ shortcut })`), refusing with why one the
// system keeps for itself or won't let it have. Recording, the app lets go of the one it has (`shortcutPaused`), so
// pressing it records it rather than putting the launcher away.
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { type Client, client, defineVars, keydown, negative, Path, Pressable, styles, Svg, Text, tokens, View, visible } from "ui"

/** Which computer it's on, whose keys are named its own way. */
export type Os = "mac" | "windows" | "linux"

/** The launcher's shortcut now and its default, in global-hotkey's words, as the client says them: none on a phone or
 * a client that doesn't say. */
const [kept, setKept] = createSignal<Client["shortcut"]>()
const [os, setOs] = createSignal<Os>("mac")
client().then(
  (now) => {
    setOs(now.mac ? "mac" : now.target?.startsWith("windows") ? "windows" : "linux")
    setKept(now.shortcut ?? null)
  },
  () => setKept(null),
)
export { kept as shortcut, os }

/** Each modifier as global-hotkey names it, in the order each computer shows them (a Mac's ⌃⌥⇧⌘), and its label. */
const MODIFIERS: Record<Os, [string, string][]> = {
  mac: [["control", "⌃"], ["alt", "⌥"], ["shift", "⇧"], ["super", "⌘"]],
  windows: [["super", "Win"], ["control", "Ctrl"], ["alt", "Alt"], ["shift", "Shift"]],
  linux: [["super", "Super"], ["control", "Ctrl"], ["alt", "Alt"], ["shift", "Shift"]],
}

/** Three to pick from on each, the default first (the client's), as the mockup Andre approved has them, without one
 * the system keeps for itself. */
const PICKS: Record<Os, string[]> = {
  mac: ["shift+super+Space", "shift+alt+Space"],
  windows: ["control+alt+Space", "shift+control+Space"],
  linux: ["control+alt+Space", "shift+control+Space"],
}

/** What a key's `code` shows as: a letter or digit alone, an arrow as one, and the rest by name. */
const named: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`", Enter: "Return", Escape: "Esc" }
const label = (code: string) => named[code] ?? code.replace(/^Key|^Digit/, "")

/** A shortcut's keys as their labels, its modifiers first in the computer's order. */
export const labels = (keys: string, on: Os): string[] => {
  const parts = keys.split("+").map((part) => part.toLowerCase())
  const code = keys.split("+").at(-1) ?? ""
  return [...MODIFIERS[on].filter(([name]) => parts.includes(name)).map(([, shown]) => shown), label(code)]
}

/** Two shortcuts are the same keys, whatever order or case they're written in. */
const same = (one: string | null | undefined, other: string | null | undefined) =>
  !!one && !!other && one.toLowerCase().split("+").sort().join("+") === other.toLowerCase().split("+").sort().join("+")

const own = defineVars({
  cap: 40,
  capWide: 92,
  capType: 17,
  capTypeWord: 14,
  pick: 30,
  pickType: 13,
  pickNote: 11,
  hint: 12.5,
  hintLeading: 17.5,
  heading: 12,
  word: 14,
  small: 13,
  wellPad: 10,
  ring: 2,
  line: 1,
  capPad: 11,
  capGap: 6,
  dot: 6,
  change: 30,
  inset: 2,
  pickPad: 9,
  pickGap: 3,
  pickKey: 16,
  noteGap: 4,
  // The mockup's orange and green, dark enough in light to read at WCAG AA's 4.5:1 on the screen's grey.
  warn: { default: "#9a4d00", dark: "#ffb340" },
  good: { default: "#13702f", dark: "#30d158" },
})

const look = styles({
  control: { flexDirection: "column", gap: tokens.grid[3] },
  well: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2.5], padding: own.wellPad, borderWidth: own.ring, borderColor: tokens.colour.transparent, backgroundColor: tokens.colour.quinaryLabel, cursor: "pointer" },
  recording: { borderColor: tokens.colour.blue },
  caps: { flexGrow: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: own.capGap, minHeight: own.cap },
  cap: {
    minWidth: own.cap,
    height: own.cap,
    paddingInline: own.capPad,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.colour.background,
    borderWidth: own.line,
    borderBottomWidth: own.ring,
    borderColor: tokens.colour.quaternaryLabel,
    boxShadow: "0 1px 2px #0000000f",
    color: tokens.colour.label,
    animationName: { from: { scale: 0.7, opacity: 0 }, to: { scale: 1, opacity: 1 } },
    animationDuration: 300,
    animationTimingFunction: [0.3, 1.6, 0.5, 1],
    animationFillMode: "both",
  },
  capWide: { minWidth: own.capWide },
  capType: { fontSize: own.capType, fontWeight: 500, lineHeight: own.capType },
  capWord: { fontSize: own.capTypeWord, fontWeight: 500, lineHeight: own.capTypeWord },
  waiting: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2] },
  waitingText: { fontSize: own.word, color: tokens.colour.secondaryLabel },
  dot: { width: own.dot, height: own.dot, borderRadius: tokens.radius.full, backgroundColor: tokens.colour.red, animationName: { "50%": { opacity: 0.2 } }, animationDuration: 1000, animationTimingFunction: "ease-in-out", animationIterationCount: "infinite" },
  change: { flexShrink: 0, height: own.change, paddingInline: tokens.grid[3], justifyContent: "center", backgroundColor: { default: tokens.colour.background, hover: tokens.colour.quinaryLabel }, borderWidth: own.line, borderColor: tokens.colour.quaternaryLabel, cursor: "pointer" },
  changeText: { fontSize: own.small, fontWeight: 500, color: tokens.colour.label },
  hint: { fontSize: own.hint, lineHeight: own.hintLeading, color: tokens.colour.secondaryLabel, minHeight: own.hintLeading, marginTop: negative(tokens.grid[1]), paddingInline: own.inset },
  warn: { color: own.warn },
  good: { color: own.good },
  heading: { fontSize: own.heading, fontWeight: 600, color: tokens.colour.secondaryLabel, paddingInline: own.inset, marginBottom: negative(tokens.grid[1]) },
  picks: { flexDirection: "row", flexWrap: "wrap", gap: own.capGap },
  pick: { flexDirection: "row", alignItems: "center", gap: own.pickGap, height: own.pick, paddingInline: own.pickPad, borderRadius: tokens.radius.full, borderWidth: own.line, borderColor: tokens.colour.quaternaryLabel, backgroundColor: { default: tokens.colour.transparent, hover: tokens.colour.quinaryLabel }, cursor: "pointer", color: tokens.colour.label },
  picked: { backgroundColor: tokens.colour.quinaryLabel, borderColor: tokens.colour.label },
  pickText: { fontSize: own.pickType, minWidth: own.pickKey, textAlign: "center", color: tokens.colour.label },
  pickNote: { fontSize: own.pickNote, color: tokens.colour.secondaryLabel, marginStart: own.noteGap },
  reset: { alignSelf: "flex-start", paddingInline: own.inset, cursor: "pointer" },
  resetText: { fontSize: own.small, fontWeight: 500, color: tokens.colour.blue },
  // How round the well, a keycap and Change are, as the mockup has them: the window's radius, 10, and 4 more, 1 and
  // 2 less.
  round: (borderRadius: number) => ({ borderRadius }),
  win: (size: number) => ({ width: size, height: size, color: tokens.colour.label }),
})

/** Windows' key, its logo, as Windows' own keyboard shortcuts show it. */
export const WindowsKey = (props: { size: number }) => (
  <Svg viewBox="0 0 16 16" style={look.win(props.size)}>
    <Path d="M0 0h7.5v7.5H0zM8.5 0H16v7.5H8.5zM0 8.5h7.5V16H0zM8.5 8.5H16V16H8.5z" />
  </Svg>
)

/** One key, as a keycap. */
const Cap = (props: { label: string }) => (
  <View style={[look.cap, look.round(9), props.label === "Space" && look.capWide]}>
    <Show when={props.label !== "Win"} fallback={<WindowsKey size={15} />}>
      <Text style={props.label.length > 1 ? look.capWord : look.capType}>{props.label}</Text>
    </Show>
  </View>
)

/** The shortcut's control. `onChanged` is told each time it's changed, as Open from anywhere's picture plays it again. */
export function ShortcutControl(props: { onChanged?: (keys: string) => void }) {
  const [recording, setRecording] = createSignal(false)
  // What's been pressed while recording: the modifiers held so far, or a whole shortcut that was refused.
  const [pressed, setPressed] = createSignal<string[]>()
  const [hint, setHint] = createSignal<{ text: string; tone?: "warn" | "good" }>()
  // Drawn again from its start each time it's saved, so its keys pop in.
  const [saves, setSaves] = createSignal(0)
  const idle = () => (os() === "mac" ? "Works in every app, even full screen." : "Works in every app.")
  const keys = () => kept()?.keys ?? null

  const pause = (paused: boolean) => void client({ shortcutPaused: paused }).catch(() => {})
  const start = () => {
    setRecording(true)
    setPressed(undefined)
    setHint({ text: "Hold the keys together. Esc to cancel." })
    pause(true)
  }
  const stop = () => {
    if (!recording()) return
    setRecording(false)
    setPressed(undefined)
    pause(false)
  }
  const cancel = () => (stop(), setHint(undefined))
  onCleanup(stop)
  // Away from the page, it stops recording, so the shortcut is never left let go of.
  createEffect(visible, (shown) => void (!shown && cancel()))

  // Saved, recording stops; refused, it goes on, the keys refused shown with why, as the mockup has it, so another
  // can be pressed at once.
  const choose = (chosen: string | null) =>
    client({ shortcut: chosen }).then(
      () =>
        client().then((now) => {
          stop()
          setKept(now.shortcut ?? null)
          setSaves(saves() + 1)
          setHint({ text: "Saved. Try it now.", tone: "good" })
          if (now.shortcut?.keys) props.onChanged?.(now.shortcut.keys)
        }),
      (error: Error) => setHint({ text: error.message, tone: "warn" }),
    )

  onCleanup(
    keydown((event) => {
      if (!recording()) return
      event.preventDefault()
      const held = [event.shiftKey && "shift", event.ctrlKey && "control", event.altKey && "alt", event.metaKey && "super"].filter((held): held is string => !!held)
      if (event.key === "Escape" && !held.length) return cancel()
      // A modifier alone shows what's held so far.
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key) || !event.code) return setPressed(held)
      const function_key = /^F\d+$/.test(event.code)
      if (!held.length && !function_key) return setHint({ text: `Add a key like ${os() === "mac" ? "⌥ or ⌃" : "Ctrl or Alt"}.`, tone: "warn" })
      const chosen = [...held, event.code].join("+")
      setPressed(labels(chosen, os()))
      choose(chosen)
    }),
  )

  return (
    <View style={look.control}>
      <Pressable role="button" aria-label="Shortcut, press to change" style={[look.well, look.round(14), recording() && look.recording]} onPress={() => !recording() && start()}>
        <View style={look.caps}>
          <Show
            when={!recording() || pressed()?.length}
            fallback={
              <View style={look.waiting}>
                <Text style={look.waitingText}>Press a shortcut</Text>
                <View style={look.dot} />
              </View>
            }
          >
            <Show when={saves() + 1} keyed>
              <For each={recording() || pressed() ? (pressed() ?? []) : keys() ? labels(keys()!, os()) : []}>{(shown) => <Cap label={shown} />}</For>
            </Show>
            <Show when={!recording() && !pressed() && !keys()}>
              <Text style={look.waitingText}>None</Text>
            </Show>
          </Show>
        </View>
        <Pressable role="button" style={[look.change, look.round(8)]} onPress={() => (recording() ? cancel() : start())}>
          <Text style={look.changeText}>{recording() ? "Cancel" : "Change"}</Text>
        </Pressable>
      </Pressable>
      <Text style={[look.hint, hint()?.tone === "warn" && look.warn, hint()?.tone === "good" && look.good]}>{hint()?.text ?? idle()}</Text>
      <Text style={look.heading}>Or pick one</Text>
      <View style={look.picks}>
        <For each={[kept()?.default ?? "", ...PICKS[os()]].filter(Boolean)}>
          {(pick, index) => (
            <Pressable role="button" aria-pressed={same(pick, keys()) ? "true" : "false"} style={[look.pick, same(pick, keys()) && look.picked]} onPress={() => choose(index() === 0 ? null : pick)}>
              <For each={labels(pick, os())}>{(shown) => (shown === "Win" ? <WindowsKey size={11} /> : <Text style={look.pickText}>{shown}</Text>)}</For>
              <Show when={index() === 0}>
                <Text style={look.pickNote}>Default</Text>
              </Show>
            </Pressable>
          )}
        </For>
      </View>
      <Show when={keys() && !same(keys(), kept()?.default)}>
        <Pressable role="button" style={look.reset} onPress={() => choose(null)}>
          <Text style={look.resetText}>Reset to Default</Text>
        </Pressable>
      </Show>
    </View>
  )
}
