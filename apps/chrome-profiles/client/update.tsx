// The profile `update` opened for its person, drawn under its call as the Vault draws it (`profile.tsx`): its browser,
// which they sign in on, then Save. `rename` with its arguments opens its form over it, filled in, which is never sent
// until its person sends it; under a call that has run, the profile is shown by its new name.
import { createMemo, Show } from "solid-js"
import { navigate, render, toolInput, toolResult } from "ui"
import ChromeProfile from "./profile.tsx"

const asked = createMemo(() => toolInput("chrome-profiles_update"))
const given = () => asked().arguments as { profile?: string; name?: string }
const renaming = () => asked().name === "chrome-profiles_rename" && !toolResult()
const profile = () => ((toolResult()?.structuredContent as { profile?: string } | undefined)?.profile ?? given().profile)

render(() => (
  <Show when={profile()} keyed>
    {(item) => (
      <ChromeProfile
        item={item}
        sheet={renaming() ? "rename" : undefined}
        name={renaming() ? given().name : undefined}
        sheeted={(sheet) => navigate(sheet === "rename" ? "chrome-profiles_rename" : "chrome-profiles_update", { profile: item })}
        open={(name) => navigate("chrome-profiles_update", { profile: name }, { replace: true })}
      />
    )}
  </Show>
))
