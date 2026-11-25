// Signing in to an outside service (Google, Microsoft), as its page draws it where it is shown in an assistant's chat,
// which can't frame the service's sign-in (Google refuses to be framed and an embedded web view) and opens no windows:
// the person's own browser does it, and the page follows how it goes. Written once on the drawing primitives
// (#primitives), so each app's page for its sign-in tool is a line.
import { createSignal, onCleanup, Show } from "solid-js"
import { Text, View } from "#primitives"
import { call, changed, open } from "#bridge"
import { Button, Icon, Spinner } from "./button.tsx"
import { Problem } from "./states.tsx"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

const look = styles({
  box: { alignSelf: "stretch", alignItems: "flex-start", gap: tokens.grid[3], padding: tokens.grid[3] },
  line: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2] },
  heading: { fontWeight: tokens.weight.medium },
  said: { color: tokens.colour.secondaryLabel },
})

/** How `vault_sign_in_state` answers. */
interface Status {
  service: string
  status: "started" | "ok" | "cancelled" | "failed"
  account?: string
  problem?: string
}

/// `<ServiceSignIn url={signIn.url} />`: where a person signs in to an outside service, from the `url` a tool that starts
/// an OAuth sign-in answered (`google-account_sign_in`, the Vault's `sign_in`): a "Sign in with <service>" button that opens
/// it in their own browser (`open`), and then, by itself as the sign-in ends, "Signed in as …", or what went wrong. It
/// asks the Vault how it's going (`sign_in_state`) as the Vault says it changed, and every few seconds while it waits,
/// since a page in a chat is told nothing of what happens in another window.
export function ServiceSignIn(props: { url: string }) {
  const state = () => new URL(props.url).searchParams.get("state") ?? ""
  const [status, setStatus] = createSignal<Status>()
  const [problem, setProblem] = createSignal<Error>()
  const read = () => call("vault_sign_in_state", { state: state() }).then((text) => setStatus(JSON.parse(text) as Status), (error) => setProblem(error as Error))
  void read()
  // What happens in another window (the browser that signs in) reaches this page only as it asks.
  const waiting = setInterval(() => (status()?.status ?? "started") === "started" && void read(), 3000)
  onCleanup(() => clearInterval(waiting))
  onCleanup(changed(read))
  const service = () => status()?.service ?? "your account"
  return (
    <View style={look.box}>
      <Show when={!problem()} fallback={<Problem heading="Can't follow this sign-in" text={problem()} />}>
        <Show when={status()?.status === "ok"}>
          <View style={look.line}>
            <Icon name="check-circle" large />
            <Text style={look.heading}>{status()!.account ? `Signed in as ${status()!.account}` : `Signed in to ${service()}`}</Text>
          </View>
        </Show>
        <Show when={status()?.status === "cancelled"}>
          <Text style={look.heading}>{`You didn't sign in to ${service()}.`}</Text>
          <Text style={look.said}>Ask your assistant to start it again.</Text>
        </Show>
        <Show when={status()?.status === "failed"}>
          <Problem heading={`${service()} didn't sign you in`} text={status()!.problem} />
        </Show>
        <Show when={(status()?.status ?? "started") === "started"}>
          <Text style={look.heading}>{`Sign in to ${service()}`}</Text>
          <Text style={look.said}>It opens in your own browser, which finishes it here.</Text>
          <View style={look.line}>
            <Button onPress={() => open(props.url)}>{`Sign in with ${service()}`}</Button>
            <Spinner />
          </View>
        </Show>
      </Show>
    </View>
  )
}
