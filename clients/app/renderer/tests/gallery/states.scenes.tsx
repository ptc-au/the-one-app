import { createSignal, Show } from "solid-js"
import { Button, DropZone, Empty, List, Problem, Row, type Scenes, Spinner, Status, Stepper, Steps, styles, tokens, View } from "ui"

const look = styles({ column: { gap: tokens.grid[4] } })

export default {
  "States/Every kind": () => (
    <View style={look.column}>
      <Empty>Nothing here yet.</Empty>
      <Problem heading="Couldn't load" text="The server didn't answer." action={<Button>Try Again</Button>} />
      <Problem warn heading="Needs you" text="Sign in again." />
      <Status heading="Backing up" text="12 of 40 files" />
      <Steps steps={["Starting", "Signing in", "Ready"]} at={1} />
    </View>
  ),
  // Where someone is in a flow they go through: its steps named in a row on a computer, dots on a phone.
  "States/Stepper": () => (
    <View style={look.column}>
      <Stepper steps={["Welcome", "Connect your AI", "Open from anywhere", "Your own server", "Set Up Your Vault"]} at={2} />
      <Stepper steps={["Welcome", "Open from anywhere", "Your own server"]} at={0} />
      <Stepper steps={["Welcome", "Connect your AI", "Open from anywhere", "Your own server", "Set Up Your Vault"]} at={2} dots />
    </View>
  ),
  "States/Stepper, narrow": {
    size: [390, 400],
    render: () => <Stepper steps={["Welcome", "Connect your AI", "Open from anywhere", "Your own server", "Set Up Your Vault"]} at={4} />,
  },
  // What's loading shows nothing for the first half second, as most answers come sooner, then a spinner in the middle
  // of its place: where a computer's window is wider than a column, the window's middle.
  "States/Loading on a computer": {
    size: [1280, 800],
    render: () => <Spinner delay />,
    checks: { "The spinner is in the middle of the window": [{ expect: { centred: { role: "status", name: "Loading" } } }] },
  },
  "States/Loading, from the start": {
    render: () => {
      const [loading, setLoading] = createSignal(false)
      return <Show when={loading()} fallback={<Button onPress={() => setLoading(true)}>Load</Button>}><Spinner delay /></Show>
    },
    checks: {
      "Nothing shows for the first half second, then the spinner fades in": [
        { role: "button", name: "Load" },
        { wait: 300 },
        { expect: { drawn: { of: { role: "status", name: "Loading" }, opacity: 0 }, within: 0 } },
        { wait: 500 },
        { expect: { drawn: { of: { role: "status", name: "Loading" }, opacity: 1 } } },
      ],
    },
  },
  // While its page loads, its app's window shows the app's icon in its middle, as a phone's launch screen does, once it has
  // waited long enough that a quick page shows none (`SPLASH`); a page that has drawn nothing is the whole of it here.
  "States/App icon while its page loads": { render: () => <></>, layout: "fullscreen", launching: true },
  // Where files from the computer's own are dropped (Claims' receipts): a dashed area that says so, with the picker
  // under it; while files are dragged over it, tinted, saying what dropping does.
  "States/Drop zone": { size: [800, 400], touch: false, render: () => <DropZone accept={["image/*", ".pdf"]} multiple label="Drop receipts here" onDrop={() => {}} /> },
  "States/Drop zone, files over it": {
    size: [800, 400],
    touch: false,
    render: () => <DropZone accept={["image/*", ".pdf"]} multiple label="Drop receipts here" onDrop={() => {}} />,
    taps: [{ files: "drag", text: "Drop receipts here" }],
  },
  // Around a list, it's only the list until files come over it.
  "States/Drop zone around a list, files over it": {
    size: [800, 400],
    touch: false,
    render: () => (
      <DropZone accept={["image/*", ".pdf"]} multiple onDrop={() => {}}>
        <List>
          <Row heading="Coles" text="Tue, 13 Oct · $8.20" />
          <Row heading="Pearl Energy" text="Mon, 28 Sept · $30.76" />
          <Row heading="Main Beach Fish Grotto" text="Sat, 7 Nov · $35.00" />
        </List>
      </DropZone>
    ),
    taps: [{ files: "drag", text: "Coles" }],
  },
  // On a phone nothing is dragged in: its empty state is its Choose Files.
  "States/Drop zone on a phone": { render: () => <DropZone accept={["image/*", ".pdf"]} multiple label="Drop receipts here" onDrop={() => {}} /> },
} satisfies Scenes
