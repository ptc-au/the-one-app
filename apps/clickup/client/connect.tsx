// Connecting ClickUp: the person's own personal API token, which they add in their Vault on their own device, as the
// old PTC App's ClickUp page had them add it. This page never sees it.
import { createMemo, createSignal, Errored, Loading, refresh, Show } from "solid-js"
import { Button, call, changed, List, ListStyle, open, Problem, render, Row, Screen, Section, Skeleton, styles, Text, toast, tokens, View } from "ui"

const look = styles({
  page: { gap: tokens.grid[4] },
  quiet: { font: tokens.type.medium, color: tokens.colour.secondaryLabel },
})

function Connect() {
  const connected = createMemo(() => call("clickup_connect").then((text) => JSON.parse(text) as { item: string | null }))
  changed(() => refresh(connected))
  const [asking, setAsking] = createSignal(false)
  // Asks for the key in their Vault, named for whose it is, as a Google account's is, and opens the request there.
  const connect = async () => {
    setAsking(true)
    try {
      const [me] = (JSON.parse(await call("sign-in_people", {})) as { people: { called: string | null; email: string | null }[] }).people
      const asked = JSON.parse(
        await call("vault_request", {
          title: `ClickUp ${me?.email ?? me?.called ?? "account"}`,
          fields: { token: { secret: true } },
          hosts: ["api.clickup.com"],
          app: "clickup",
          why: "Your ClickUp personal API token: in ClickUp, your avatar, then Settings, then Apps. It starts with pk_.",
        }),
      ) as { id: string }
      await open(`settings#vault/accounts&request=${asked.id}`)
    } catch (error) {
      toast(error as Error)
    } finally {
      setAsking(false)
    }
  }
  return (
    <Screen heading="ClickUp">
      <View style={look.page}>
        <Text style={look.quiet}>Lets your apps read and update your ClickUp tasks as you.</Text>
        <Show when={connected().item}>
          {(item) => (
            <ListStyle value="insetGrouped">
              <List>
                <Row heading="Connected" text={item().replace(/^ClickUp /, "")} />
              </List>
            </ListStyle>
          )}
        </Show>
        <Section heading={connected().item ? "Connect Again" : "Connect"}>
          <ListStyle value="insetGrouped">
            <List>
              <Row heading="1. Copy your key" text="In ClickUp: your avatar, then Settings, then Apps. Copy the API token, pk_…" />
              <Row heading="2. Add it in your Vault" text="Press Connect, and paste it where your Vault asks." />
            </List>
          </ListStyle>
        </Section>
        <View>
          <Button loading={asking()} onPress={() => void connect()}>
            Connect
          </Button>
        </View>
        <Text style={look.quiet}>Your key is kept in your Vault, for you only. Apps like My Tasks use it to show and update your tasks. Nothing is deleted.</Text>
      </View>
    </Screen>
  )
}

render(() => (
  <Errored fallback={(error) => <Screen heading="ClickUp"><Problem heading="Can't connect ClickUp" text={error() as Error} /></Screen>}>
    <Loading fallback={<Skeleton rows={3} />}>
      <Connect />
    </Loading>
  </Errored>
))
