// What's done on a screen, as it's sent to it: down a `video`'s data channel (renderer.ts).

/** What the person does on a stream, as its data channel carries it to the screen. */
export type Input = { t: "move"; x: number; y: number } | { t: "button"; b: number; down: boolean; mods: string[] } | { t: "key"; key: string; mods: string[] } | { t: "text"; text: string }

/** A key pressed, with the modifiers held, as the DOM's `KeyboardEvent` has them. */
type Pressed = { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

/** The device's own keys for full screen, F11, or ⌃⌘F on a Mac, which are the page's, never the screen's. */
export const fullScreen = (event: Pressed) => event.key === "F11" || (event.ctrlKey && event.metaKey && event.key.toLowerCase() === "f")
