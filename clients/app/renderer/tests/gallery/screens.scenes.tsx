import { Button, Empty, History, Input, List, ListStyle, Menu, Row, type Scenes, Screen, Section, SignIn, Split, styles, Text, View } from "ui"

const look = styles({ window: { height: 720 }, narrow: { height: 475 }, phone: { height: 844 }, pane: { width: 300, height: 475 } })

/// A network's logo, as its edge serves it: a picture of its own.
const network = (letter: string, fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="48" fill="${fill}"/><text x="48" y="48" dy="0.35em" text-anchor="middle" font-family="system-ui, sans-serif" font-size="48" font-weight="600" fill="#fff">${letter}</text></svg>`)}`

const notes = Array.from({ length: 30 }, (_, at) => `Note ${at + 1}`)

const More = () => (
  <Menu.Root onSelect={() => {}}>
    <Menu.Trigger />
    <Menu.Positioner>
      <Menu.Content>
        <Menu.Item value="remove" destructive>Remove</Menu.Item>
      </Menu.Content>
    </Menu.Positioner>
  </Menu.Root>
)

const Devices = () => (
  <Screen
    heading="Devices"
    action={
      <>
        <Menu.Root onSelect={() => {}}>
          <Menu.Trigger aria-label="More Actions" />
          <Menu.Positioner>
            <Menu.Content>
              <Menu.Item value="export">Export List</Menu.Item>
              <Menu.Item value="forget">Forget Old Devices</Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>
        <Button>Invite</Button>
      </>
    }
  >
    <Section heading="Your Devices">
      <List>
        <Row heading="Alex's Laptop" text="This device" onPress={() => {}} />
        <Row heading="Sam's Phone" text="Seen 3 hours ago" end={<More />} />
        <Row heading="Pixel Tablet" text="Selected" current onPress={() => {}} />
      </List>
    </Section>
  </Screen>
)

// A list whose screen has floating actions, as Claims' receipts have: Add, Scan and History, and Complete its main one.
const Claims = () => (
  <Screen
    heading="Claims"
    floatingActions={{
      leading: [
        { icon: "plus", label: "Add Receipt", onPress: () => {} },
        { icon: "scan", label: "Scan", onPress: () => {}, primary: true },
        { icon: "clock-counter-clockwise", label: "History", onPress: () => {} },
      ],
      trailing: { icon: "list-checks", label: "Complete", onPress: () => {} },
    }}
  >
    <List>
      <Row heading="Third Wave BBQ" text="$56.91" current onPress={() => {}} />
      <Row heading="Coles" text="$8.20" onPress={() => {}} />
    </List>
  </Screen>
)

// A window of grouped cards: a sidebar, and what it opens, which opens its own list's rows over that list.
const settings = () => (
  <ListStyle value="sidebar">
    <Split
      open
      detail={
        <ListStyle value="insetGrouped">
          <History value={{ back: () => {} }}>
            <Split detail={<Screen heading="Alex's Laptop" back><Text>Its page.</Text></Screen>}><Devices /></Split>
          </History>
        </ListStyle>
      }
    >
      <Screen heading="Settings">
        <List>
          <Row heading="Devices" current onPress={() => {}} />
          <Row heading="People & Groups" onPress={() => {}} />
        </List>
      </Screen>
    </Split>
  </ListStyle>
)

/// Receipts under a screen's floating actions: a stack of round buttons at the start, the main one dark and larger at its
/// bottom, and a pill at the end, as the old Claims had them.
const receipts = () => (
  <Screen
    heading="Claims"
    floatingActions={{
      leading: [{ icon: "plus", label: "Add receipt", onPress: () => {} }, { icon: "scan", label: "Scan", onPress: () => {}, primary: true }],
      trailing: { icon: "list-checks", label: "Complete", onPress: () => {} },
    }}
  >
    <Input aria-label="Note" placeholder="Note" />
    <List>{notes.map((note) => <Row heading={note} text="Wed, 14 Oct" />)}</List>
  </Screen>
)

export default {
  // A phone's floating actions, over what scrolls and clear of the home indicator; the last row scrolls clear of them,
  // and they're gone while a field has the keyboard.
  "Screens/Floating actions on a phone": {
    alone: true,
    layout: "fullscreen",
    touch: true,
    safeArea: [47, 0, 34, 0],
    render: () => <View style={look.phone}>{receipts()}</View>,
    checks: {
      "They're in view, clear of the home indicator": [{ expect: { shown: { role: "button", name: "Scan" } } }, { expect: { shown: { role: "button", name: "Complete" } } }, { expect: { shown: { role: "button", name: "Add receipt" } } }],
      "The last row scrolls clear of them": [{ trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { trace: "traces/finger-pans-up.json" }, { expect: { apart: { of: { text: "Note 30" }, from: { role: "button", name: "Scan" } } } }],
      "Away while a field has the keyboard": [{ role: "textbox", name: "Note" }, { expect: { gone: { role: "button", name: "Scan" } } }],
    },
  },
  "Screens/Floating actions with the keyboard": {
    alone: true, layout: "fullscreen", touch: true, safeArea: [47, 0, 34, 0],
    render: () => <View style={look.phone}>{receipts()}</View>,
    taps: [{ role: "textbox", name: "Note" }],
  },
  // Where there's room, the same actions are in the bar, the leading ones before the main one.
  "Screens/Floating actions on a computer": {
    alone: true,
    layout: "fullscreen",
    size: [1100, 720],
    render: () => <View style={look.window}>{receipts()}</View>,
    checks: { "They're in the bar": [{ expect: { shown: { role: "button", name: "Complete" } } }, { expect: { shown: { role: "button", name: "Scan" } } }] },
  },
  // A phone's first screen: its name large at the top of what scrolls, which goes under the bar as it scrolls, the
  // bar's small name taking its place and the bar its glass and hairline, as UINavigationBar's large titles do.
  "Screens/A phone's first screen": {
    alone: true,
    layout: "fullscreen",
    touch: true,
    // An iPhone's status bar and home indicator.
    safeArea: [47, 0, 34, 0],
    render: () => (
      <View style={look.phone}>
        <Screen heading="Notes" action={<Button>Add</Button>}>
          <List>{notes.map((note) => <Row heading={note} />)}</List>
        </Screen>
      </View>
    ),
    checks: {
      // Its glass reaches the window's sides and goes up under the status bar, as UINavigationBar's does.
      "Scrolled, its large title goes under the bar, which takes its glass": [{ expect: { blur: false } }, { trace: "traces/finger-pans-up.json" }, { expect: { blur: true } }, { expect: { shown: { role: "heading", name: "Notes" } } }, { expect: { at: { of: { role: "banner" }, x: 0, y: 0, width: 390 } } }],
      // iOS's sizes at its usual text size (17 pt): the large title 34 pt (`.largeTitle`), the bar's 17 (`.headline`), each
      // with its lines' height and the room around them.
      "On a phone, the large title is 34 pt and the bar's title 17": [
        { expect: { tall: { of: { role: "heading", name: "Notes" }, height: 49.3 } } },
        { trace: "traces/finger-pans-up.json" },
        { expect: { tall: { of: { role: "heading", name: "Notes" }, height: 34 } } },
      ],
    },
    motions: { "Scrolled under its bar": { from: { x: 195, y: 600 }, gesture: { swipe: [0, -200], speed: 400 }, follow: { role: "heading", name: "Notes" }, once: { role: "heading", name: "Notes" } } },
  },
  // With no buttons, the large title is right under the status bar, with no row of the bar above it, as Music's is.
  "Screens/A phone's first screen with nothing in its bar": {
    alone: true, layout: "fullscreen", touch: true, safeArea: [47, 0, 34, 0],
    render: () => <View style={look.phone}><Screen heading="Telemetry"><List>{notes.map((note) => <Row heading={note} />)}</List></Screen></View>,
    motions: { "Scrolled under its bar": { from: { x: 195, y: 600 }, gesture: { swipe: [0, -200], speed: 400 }, follow: { role: "heading", name: "Telemetry" }, once: { role: "heading", name: "Telemetry" } } },
  },
  // Three buttons keep the bar's row above the large title, as UINavigationBar's do.
  "Screens/A phone's first screen with three buttons": {
    alone: true, layout: "fullscreen", touch: true, safeArea: [47, 0, 34, 0],
    render: () => (
      <View style={look.phone}>
        <Screen heading="Devices" tips={[{ title: "Devices", body: "Every device that's signed in." }, { title: "Invite", body: "Add one of yours." }]} action={<><More /><Button>Invite</Button></>}>
          <List>{notes.map((note) => <Row heading={note} />)}</List>
        </Screen>
      </View>
    ),
  },
  "Screens/Settings": { alone: true, layout: "fullscreen", size: [1100, 720], render: () => <View style={look.window}>{settings()}</View> },
  // A list and nothing open: its detail side says what to do, as Mail's says "No Message Selected", never blank.
  "Screens/A split with nothing open": {
    alone: true,
    layout: "fullscreen",
    size: [1100, 720],
    render: () => <View style={look.window}><Split pick="Pick a device to see it." detail={<Screen heading="Alex's Laptop" back><Text>Its page.</Text></Screen>}><Devices /></Split></View>,
    checks: { "Beside its list it says what to pick": [{ expect: { text: "Pick a device to see it." } }, { expect: { gone: "Its page." } }] },
  },
  // A list with nothing in it has nothing to pick, so its detail side says nothing and the list's own line stands
  // alone, as Mail's and Finder's do.
  "Screens/A split with an empty list": {
    alone: true,
    layout: "fullscreen",
    size: [1100, 720],
    render: () => (
      <View style={look.window}>
        <Split pick="Pick a destination to see its backups." detail={<Screen heading="Alex's Laptop" back><Text>Its page.</Text></Screen>}>
          <Screen heading="Backups"><Empty>Nothing is backed up yet.</Empty></Screen>
        </Split>
      </View>
    ),
    checks: { "Its own line stands alone": [{ expect: { text: "Nothing is backed up yet." } }, { expect: { gone: "Pick a destination to see its backups." } }, { expect: { gone: "Its page." } }] },
  },
  // A computer's list, as Finder's and GitHub's are: the screen's main action a button at the end of its bar with the
  // rest in a ⋯ menu beside it, and a row's actions in its own ⋯ menu (a right-click too); nothing floats at the foot.
  "Screens/A list's actions": {
    alone: true,
    layout: "fullscreen",
    size: [750, 475],
    render: () => <View style={look.narrow}><Devices /></View>,
  },
  "Screens/A list's bar menu open": {
    alone: true,
    layout: "fullscreen",
    size: [750, 475],
    render: () => <View style={look.narrow}><Devices /></View>,
    taps: [{ role: "button", name: "More Actions" }],
  },
  "Screens/A row's menu open": {
    alone: true,
    layout: "fullscreen",
    size: [750, 475],
    render: () => <View style={look.narrow}><Devices /></View>,
    taps: [{ role: "button", name: "More" }],
  },
  // A narrow list pane on a computer (Claims' beside its detail), with a screen's floating actions in its bar: the main
  // one, at the bar's end, stays whole, and the icons that don't fit beside the heading go into More Actions.
  "Screens/A list pane's actions, narrow": {
    alone: true,
    layout: "fullscreen",
    size: [900, 475],
    render: () => <View style={look.pane}><Claims /></View>,
  },
  // The same, as a Mac's app window draws it: the list pane's bar is the title row, after the traffic lights.
  "Screens/A list pane's actions, on a Mac": {
    alone: true,
    layout: "fullscreen",
    titleRow: true,
    size: [1280, 720],
    render: () => <View style={look.window}><Split detail={<Screen heading="Third Wave BBQ Gold Coast" back><Text>Its page.</Text></Screen>}><Claims /></Split></View>,
  },
  "Screens/A list pane's actions, narrow, More Actions open": {
    alone: true,
    layout: "fullscreen",
    size: [900, 475],
    render: () => <View style={look.pane}><Claims /></View>,
    taps: [{ role: "button", name: "More Actions" }],
  },
  "Screens/A large title": {
    alone: true,
    layout: "fullscreen",
    size: [750, 475],
    render: () => (
      <View style={look.narrow}>
        <Screen heading="Notes" back largeTitle>
          <Text role="heading" aria-level={2}>Notes</Text>
        </Screen>
      </View>
    ),
  },
  // The sign-in page on a phone, saying a problem longer than a line: its words wrap inside the screen, as the network's
  // Unlock with Passkey page says a passkey can't unlock (21 Nov, where it ran off both sides on one line).
  "Screens/Sign-in with a long problem": {
    alone: true,
    layout: "fullscreen",
    touch: true,
    safeArea: [47, 0, 34, 0],
    render: () => (
      <View style={look.phone}>
        <SignIn
          heading="Unlock with Passkey"
          problem="This passkey can't unlock your key on a new device, so approve it from a device that holds your key, or with your recovery key."
          button="Create a Passkey"
          onSignIn={() => {}}
          stop="Try Another Passkey"
          onStop={() => {}}
        />
      </View>
    ),
  },
  // A code to compare elsewhere, which a finger can copy: words drawn on the web's canvas can't be selected by one.
  "Screens/Sign-in with a code": {
    alone: true,
    layout: "fullscreen",
    touch: true,
    safeArea: [47, 0, 34, 0],
    render: () => (
      <View style={look.phone}>
        <SignIn heading="Add a passkey" note="Your passkey is created. To let it unlock your key, open the One App on Andre's MacBook Air and tap Allow, but only if it shows this same code." code="63038 96957 95028 61504" />
      </View>
    ),
    checks: { "Copy copies it, and says so": [{ expect: { shown: { role: "button", name: "Copy" } } }, { press: { role: "button", name: "Copy" } }, { expect: { text: "Copied" } }] },
  },
  // No device holds the key, so there's no code to compare: none is shown.
  "Screens/Sign-in, passkey created, nothing to compare": {
    alone: true,
    layout: "fullscreen",
    touch: true,
    safeArea: [47, 0, 34, 0],
    render: () => (
      <View style={look.phone}>
        <SignIn heading="Add a passkey" done="Your passkey is created, and you can sign in with it. No device holds your key yet, so there's nothing to allow." />
      </View>
    ),
  },
  // The Vault's page while it adds an outside service's account: the network's logo, not the One App's.
  "Screens/Sign-in, adding an account": {
    alone: true,
    layout: "fullscreen",
    touch: true,
    safeArea: [47, 0, 34, 0],
    render: () => (
      <View style={look.phone}>
        <SignIn mark={network("P", "#1a6bd6")} markDark={network("P", "#6aa8ff")} heading="Adding your account" status="Adding your account…" />
      </View>
    ),
  },
} satisfies Scenes
