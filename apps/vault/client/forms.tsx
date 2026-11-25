// The form `set` opens: the Vault, as Settings draws it, with the field's form over it, filled in from what it was
// given, which is never saved until its person saves it. Under a call that has run, the item is shown as it is now.
// Where it goes from there is the Vault, in Settings.
import { createMemo, Loading, Show } from "solid-js"
import { component, ListStyle, open, render, Spinner, toolInput, toolResult } from "ui"

const asked = createMemo(() => toolInput("vault_set"))
const given = () => asked().arguments as { item?: string; field?: string; value?: string; secret?: boolean; hosts?: string[] }
// Drawn as Settings draws a section (`Drawn` in its page), in its grouped lists.
const Section = createMemo(() => component("vault", "accounts").then((module) => module.default))

/** Goes to the Vault's screen `inputs` says, in Settings. */
const show = (inputs: object = {}) =>
  void open(`settings#section&${new URLSearchParams(Object.entries({ app: "vault", section: "accounts", ...inputs }).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])))}`)

render(() => (
  <ListStyle value="insetGrouped">
    <Loading fallback={<Spinner delay />}>
      <Show when={Section()} keyed>
        {(Section) => <Section inputs={toolResult() ? { item: given().item } : { ...given(), field: given().field ?? "" }} show={show} />}
      </Show>
    </Loading>
  </ListStyle>
))
