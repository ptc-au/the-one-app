// The Vault's page at a network's address, where an outside service sends whoever signed in to it back. It ends the
// sign-in as people expect from where it began (`@sign_in_moves` in `apps/vault/server/vault.ex`): begun on an app's
// screen, it goes back to that screen; begun by an agent or `one`, whose link was opened in a tab of its own, it says
// they're done there and to go back to it, as a CLI's or an MCP client's sign-in does. It never sends them to the
// agent's site: the network doesn't know the conversation's address, and a page that sends people where it's told
// to is an open redirect. Cancelled or failed, it says so, with Try Again.
import { createSignal, For, Show } from "solid-js"
import { Icon, render, SignIn, styles, Text, tokens, View } from "ui"

/// The network's mark: its own logo, for a light page and a dark one, as the sign-in page draws it (`/Logo.png` in `apps/sign-in/edge/worker.ts`).
const mark = "/Logo.png"
const markDark = "/Logo-dark.png"

const look = styles({
  /// What a sign-in is connected to, in a plain box, as the sign-in page's consent lists what an app can do.
  connected: { alignSelf: "stretch", gap: tokens.grid[2.5], padding: tokens.grid[4], borderWidth: tokens.length.hairline, borderColor: tokens.colour.quinaryLabel, borderRadius: tokens.radius.medium },
  heading: { font: tokens.type.headline },
  row: { flexDirection: "row", gap: tokens.grid[2.5], alignItems: "flex-start" },
  tick: { color: tokens.colour.secondaryLabel, paddingTop: tokens.grid[0.5] },
  grows: { flexShrink: 1 },
  said: { color: tokens.colour.secondaryLabel, textAlign: "center" },
  note: { color: tokens.colour.secondaryLabel, textAlign: "center", font: tokens.type.small },
})

/// Where a sign-in began, as the server kept it: an app's screen, an agent by its own name, or `one` in a terminal.
type Began = { screen: string } | { agent: string } | { cli: true }
/// What the server said of it: how it ended, and where it began, or only a `problem` when it can't say whose it is.
type Ended = {
  service?: string
  status?: "started" | "ok" | "cancelled" | "failed"
  began?: Began
  apps?: string[]
  item?: string
  account?: string
  problem?: string
  url?: string
}

/// The page: finishing it, then how it ended.
const [ended, setEnded] = createSignal<Ended>()
const ask = (body: object) =>
  fetch(location.href, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((response) => response.json() as Promise<Ended>)
    .catch((): Ended => ({ problem: "Couldn't reach the network. Start the sign-in again." }))

ask({}).then((answer) => {
  setEnded(answer)
  // A tab a script opened, as the Vault's screen opens a service's page, closes, which takes them back to where they
  // were; any other stays, saying what to do.
  if (answer.status === "ok") window.close()
})

/// Try Again: the server starts it again as it began, and this tab goes on to the service's page.
async function again() {
  const answer = await ask({ again: true })
  if (!answer.url) throw new Error(answer.problem ?? "It couldn't start again.")
  location.assign(answer.url)
}

/// Where they go back to, as a sentence's end, for what began elsewhere than an app's screen.
const back = (began?: Began) => (began && "agent" in began ? began.agent : began && "cli" in began ? "your terminal" : undefined)
/// An app's screen, by its app, and how its button names it.
const screen = (began?: Began) => (began && "screen" in began ? began.screen : undefined)
/// Where the web client has the place a link names (`settings#vault/accounts&request=4` at
/// `/settings/vault/accounts?request=4`), as its address says it (`pathOf` in clients/app/page/path.js).
const path = (link: string) => {
  const [page, fragment = ""] = link.split("#", 2)
  const [place, ...said] = fragment.split("&")
  return `/${[page.split("/")[0], ...place.split("/").filter(Boolean)].map(encodeURIComponent).join("/")}${said.length ? `?${said.join("&")}` : ""}`
}
/// An app's name, as its button says it, from a link to it (`settings#vault/accounts` is Settings).
const titled = (app: string) => app[0].toUpperCase() + app.split("#")[0].slice(1)
/// "Gmail, Google Calendar and Google Drive".
const listed = (things: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(things)
/// The network's name, as its manifest says it (`apps/sign-in/edge/worker.ts`): the app a sign-in begun in it is for.
const [named, setNamed] = createSignal("the One App")
fetch("/manifest.webmanifest")
  .then((response) => response.json())
  .then(({ name }) => setNamed(name))

render(() => {
  const status = () => ended()?.status
  const began = () => ended()?.began
  const after = () => back(began())
  const app = () => screen(began())
  return (
    <SignIn
      mark={mark}
      markDark={markDark}
      heading={!ended() ? "Adding your account" : status() === "ok" ? "You're signed in" : status() === "cancelled" ? "Sign-in cancelled" : "Not signed in"}
      status={ended() ? undefined : "Adding your account…"}
      problem={status() !== "cancelled" ? ended()?.problem : undefined}
      button={status() === "ok" ? app() && `Open ${titled(app()!)}` : began() && "Try Again"}
      onSignIn={status() === "ok" && app() ? () => location.assign(path(app()!)) : again}
      stop={status() !== "ok" && app() ? `Open ${titled(app()!)}` : undefined}
      onStop={() => location.assign(path(app()!))}
    >
      <Show when={status() === "ok"}>
        <View style={look.connected} role="group">
          <Text style={look.heading} role="heading">{ended()!.account ?? ended()!.item} is connected to</Text>
          <For each={ended()!.apps?.length ? ended()!.apps : [ended()!.service!]}>
            {(name) => (
              <View style={look.row}>
                <View style={look.tick}>
                  <Icon name="check" />
                </View>
                <Text style={look.grows}>{name}</Text>
              </View>
            )}
          </For>
        </View>
      </Show>
      <Show when={status() === "cancelled"}>
        <Text style={look.said}>
          You didn't let {listed(ended()!.apps?.length ? ended()!.apps! : [named()])} use your {ended()!.service} account.
        </Text>
      </Show>
      <Show when={ended() && after()}>
        <Text style={look.note}>You can close this tab and go back to {after()}.</Text>
      </Show>
    </SignIn>
  )
})
