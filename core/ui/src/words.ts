// The words the UI library says itself and how it reads a tool's error, which every client has, a native host's too.
import { createStore } from "solid-js"

/// The few words the UI library says itself, in English until a page says otherwise with `words`.
export const [messages, setMessages] = createStore({
  back: "Back",
  cantShowPage: "Can't show this page",
  cantShowHere: (what: string) => `Can't show this ${what.toLowerCase()} here yet`,
  cancel: "Cancel",
  chooseDate: "Choose a Date",
  chooseFiles: "Choose Files…",
  clear: "Clear",
  close: "Close",
  copied: "Copied",
  copy: "Copy",
  details: "Details",
  dropFiles: "Drop files here",
  dropToAdd: "Drop to add",
  exitFullScreen: "Exit Full Screen",
  everyDevice: "Mac, Windows, Linux, iPhone, Android",
  forward: "Forward",
  fullScreen: "Full Screen",
  getTheApp: "Get the App",
  hideDetails: "Hide Details",
  loading: "Loading",
  more: "More",
  moreActions: "More Actions",
  nextMonth: "Next Month",
  nextTip: "Next Tip",
  notifications: "Notifications",
  notDrawnHere: "This One App doesn't draw it yet. It shows in a browser.",
  ok: "OK",
  previousMonth: "Previous Month",
  previousTip: "Previous Tip",
  progress: "Progress",
  reorder: (item: string) => `Reorder ${item}`,
  reorderHint: "Space to pick up, then the arrows to move",
  reordered: (step: "grab" | "move" | "drop" | "cancel", item: string, position: number, of: number) =>
    step === "grab" ? `Picked up ${item}, position ${position} of ${of}.` : step === "move" ? `${item}, position ${position} of ${of}.` : step === "drop" ? `Dropped ${item} at position ${position} of ${of}.` : `Moved ${item} back to position ${position} of ${of}.`,
  showDetails: "Show Details",
  stepDone: (step: string) => `${step}, done`,
  stepOf: (step: number, of: number) => `Step ${step} of ${of}`,
  tipOf: (tip: number, of: number) => `Tip ${tip} of ${of}`,
  tips: "Tips",
  tryAgain: "Try Again",
})

/// What a person reads of a tool's error: its first paragraph. What follows a blank line is for an agent, as MCP's
/// text is the model's: which tool to call next, or what went wrong inside an app.
export const readable = (error: string): string => error.split(/\n\s*\n/, 1)[0]

/// All of an error a screen shows: what a tool said, whole, where it's an `Error` `call` threw (its `cause`), or
/// the text itself. What was thrown that says nothing is named, with where it was thrown from, so Show Details always
/// says something to copy for an agent or for support.
export const whole = (error: unknown): string => {
  const said = error instanceof Error ? (typeof error.cause === "string" && error.cause) || error.message : typeof error === "string" ? error : undefined
  if (said) return said
  const what = error instanceof Error ? `${error.name} with no message` : `${JSON.stringify(error) ?? String(error)}`
  const stack = error instanceof Error && error.stack
  return `It threw ${what}${stack ? `, from:\n${stack}` : ""}`
}

// `words({ back: "Zurück", cancel: "Abbrechen", close: "Schließen" })`: says the UI library's own words in the user's
// language, once, for every component on the page. A word the UI library doesn't say throws the words it does.
export function words(theirs: Partial<Record<keyof typeof messages, string>>): void {
  for (const name in theirs) if (!(name in messages)) throw new Error(`The UI library has no word "${name}". It has: ${Object.keys(messages).join(", ")}`)
  setMessages((words) => void Object.assign(words, theirs))
}
