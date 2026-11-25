// The profile `update` opened for its person, drawn under its call as the Vault draws it (`profile.tsx`): its browser,
// which they sign in on, then Save.
import { createMemo, Show } from "solid-js"
import { render, toolInput } from "ui"
import ChromeProfile from "./profile.tsx"

const profile = createMemo(() => toolInput("chrome-profiles_update").arguments?.profile as string | undefined)

render(() => <Show when={profile()} keyed>{(item) => <ChromeProfile item={item} />}</Show>)
