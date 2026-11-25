// The form `group` opens: People & Groups, as Settings draws it (Sign In's), with New Group over it, filled in from
// what it was given, which is never made until its person makes it. Under a call that has run, the group is shown.
// Where it goes from there is People & Groups, in Settings.
import { createMemo, Show, Loading } from "solid-js"
import { component, ListStyle, open, render, Spinner, toolInput, toolResult } from "ui"

const asked = createMemo(() => toolInput("permissions_group"))
const made = () => (toolResult()?.structuredContent as { group?: string } | undefined)?.group
const People = createMemo(() => component("sign-in", "people").then((module) => module.default))

/** Goes to People & Groups' screen `inputs` says, in Settings. */
const show = (inputs: object = {}) =>
  void open(`settings#section&${new URLSearchParams(Object.entries({ app: "sign-in", section: "people", ...inputs }).filter((pair): pair is [string, string] => typeof pair[1] === "string"))}`)

// Drawn as Settings draws a section, in its grouped lists, once what it shows first has loaded.
render(() => (
  <ListStyle value="insetGrouped">
    <Loading fallback={<Spinner delay />}>
      <Show when={People()} keyed>
        {(People) => <People inputs={toolResult() ? { group: made() } : { form: "new-group", name: asked().arguments.name }} show={show} />}
      </Show>
    </Loading>
  </ListStyle>
))
