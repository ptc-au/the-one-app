// The forms Backups' write tools open: each tool, with its arguments, is Backups' section of Settings with that form
// open and filled in from them, which is never sent until its person sends it. Under a call that has run, the section
// is shown as it is now. Where it goes from there is Backups, in Settings.
import { createMemo, Loading, Show } from "solid-js"
import { component, ListStyle, open, render, Spinner, toolInput, toolResult } from "ui"

const asked = createMemo(() => toolInput("backups_add"))
const given = () => asked().arguments as Record<string, string | undefined>

/** Backups' form for the tool, filled in from what it was given. */
const inputs = () => {
  const { destination, backup, blobs, ...adding } = given()
  if (toolResult()) return { destination }
  if (asked().name === "backups_restore") return { destination, restore: backup ?? "", blobs }
  return { add: adding.endpoint || adding.bucket || adding.item ? "s3" : "folder", ...adding }
}
// Drawn as Settings draws a section (`Drawn` in its page), in its grouped lists.
const Section = createMemo(() => component("backups", "backups").then((module) => module.default))

/** Goes to Backups' screen `inputs` says, in Settings. */
const show = (inputs: object = {}) =>
  void open(`settings#section&${new URLSearchParams(Object.entries({ app: "backups", section: "backups", ...inputs }).filter((pair): pair is [string, string] => typeof pair[1] === "string"))}`)

render(() => (
  <ListStyle value="insetGrouped">
    <Loading fallback={<Spinner delay />}>
      <Show when={Section()} keyed>
        {(Section) => <Section inputs={inputs()} show={show} />}
      </Show>
    </Loading>
  </ListStyle>
))
