// The forms Sign In's write tools open: each tool, with its arguments, is its section of Settings with that form open
// and filled in from them, which is never sent until its person sends it. Under a call that has run, its section is
// shown as it is now. Where it goes from there is that section, in Settings.
import { createMemo, Loading, Show } from "solid-js"
import { component, ListStyle, open, render, Spinner, toolInput, toolResult } from "ui"

const asked = createMemo(() => toolInput("sign-in_invite"))
const given = () => asked().arguments as Record<string, string | undefined>
const ran = () => !!toolResult()

/** The section and its form for the tool, filled in from what it was given: someone else's username is changed in
 * People & Groups, your own in Sign In & Security. */
const shown = () => {
  const { email, called, username, who } = given()
  if (asked().name === "sign-in_username" && !who) return { section: "passkeys", inputs: ran() ? {} : { form: "username", username } }
  if (ran()) return { section: "people", inputs: {} }
  if (asked().name === "sign-in_name") return { section: "people", inputs: { form: "name", called } }
  if (asked().name === "sign-in_username") return { section: "people", inputs: { form: "username", who, username } }
  return { section: "people", inputs: { form: "invite", email } }
}
// Drawn as Settings draws a section (`Drawn` in its page), in its grouped lists.
const Section = createMemo(() => component("sign-in", shown().section).then((module) => module.default))

/** Goes to the section's screen `inputs` says, in Settings. */
const show = (inputs: object = {}) =>
  void open(`settings#section&${new URLSearchParams(Object.entries({ app: "sign-in", section: shown().section, ...inputs }).filter((pair): pair is [string, string] => typeof pair[1] === "string"))}`)

render(() => (
  <ListStyle value="insetGrouped">
    <Loading fallback={<Spinner delay />}>
      <Show when={Section()} keyed>
        {(Section) => <Section inputs={shown().inputs} show={show} />}
      </Show>
    </Loading>
  </ListStyle>
))
