// `render` as a page calls it: its first screen, in an error boundary, so a page that throws while drawing says it
// can't show the page, with Try Again, instead of a blank window. What it threw is Telemetry's too (the client's error
// handler logs it, `bridge.ts`). Once here for every page: the primitives' own `render` (#primitives) draws it.
import type { JSX } from "@solidjs/web"
import { render as draw } from "#primitives"
import { Errored } from "./styled-components/states.tsx"

/// `render(() => <App />)`: draws an app's first screen, where its page is: the page itself on the web, the app's
/// window on a native host. → what takes it away again. If the page throws while drawing, it says it can't show it, as
/// `<Errored>` does, with Try Again, which draws it again.
export const render = (code: () => JSX.Element): (() => void) => draw(() => <Errored screen={{}}>{code()}</Errored>)
