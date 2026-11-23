import { createSignal } from "solid-js"
import { Badge, Button, Checkbox, createListbox, Icon, List, Menu, Metadata, ReorderList, Row, type Scenes, Search, Section, styles, Text, tokens, View } from "ui"

const look = styles({
  column: { gap: tokens.grid[2] },
  row: { flexDirection: "row", gap: tokens.grid[2] },
  time: { color: tokens.colour.secondaryLabel },
})

/// A search and its results, a listbox the field drives while it keeps the keyboard, and which was opened, as text, so a
/// check can say.
const Results = () => {
  const fruit = ["Apple", "Banana", "Cherry", "Grape"]
  const [words, setWords] = createSignal("")
  const [opened, setOpened] = createSignal("nothing")
  const found = () => fruit.filter((one) => one.toLowerCase().includes(words().toLowerCase()))
  const results = createListbox({ onOpen: (index) => setOpened(found()[index]) })
  return (
    <View style={look.column}>
      <Search {...results.field()} placeholder="Search fruit" aria-label="Search fruit" value={words()} onChangeText={(text) => (setWords(text), results.choose(0))} onKeyDown={results.keys} />
      <List listbox={results} label="Fruit">
        {found().map((one) => (
          <Row heading={one} onPress={() => setOpened(one)} />
        ))}
      </List>
      <Text>{`Opened: ${opened()}`}</Text>
    </View>
  )
}

const option = (name: string, selected = true) => ({ states: { of: { role: "option", name }, is: { selected } } })
const search = { role: "combobox", name: "Search fruit" }

const Rows = () => {
  const [notes, setNotes] = createSignal(["First note", "Second note", "Third note"])
  return (
    <View style={look.column}>
      <View style={look.row}>
        <Button variant="outline" onPress={() => setNotes([...notes().slice(0, 1), `Note ${notes().length + 1}`, ...notes().slice(1)])}>
          Add Row
        </Button>
        <Button variant="outline" onPress={() => setNotes(notes().slice(0, 1).concat(notes().slice(2)))}>
          Remove Row
        </Button>
      </View>
      <List each={notes()}>{(note) => <Row heading={note()} />}</List>
    </View>
  )
}

const Sections = () => (
  <>
    <Section heading="Passwords & Keys">
      <List>
        <Row start={<Icon name="file" />} heading="Cloudflare API" text="api.cloudflare.com" onPress={() => {}} />
        <Row start={<Icon name="file" />} heading="GitHub" text="github.com and api.github.com" current onPress={() => {}} />
        <Row start={<Icon name="file" />} heading="OpenRouter" end={<Text>14 Nov</Text>} onPress={() => {}} />
      </List>
    </Section>
    <Section heading="Asked For">
      <List>
        <Row start={<Icon name="file" />} heading="Stripe secret key" end={<Badge variant="destructive">1</Badge>} onPress={() => {}} />
      </List>
    </Section>
  </>
)

const Details = () => (
  <Section heading="Information">
    <Metadata>
      <Metadata.Label title="Username" text="drevan" />
      <Metadata.Label title="Token" text="•••••••••••••" />
      <Metadata.Label title="Your agents" text="Use it, never see it" />
      <Metadata.Label title="Added" text="14 Nov at 09:12" />
    </Metadata>
  </Section>
)

/// Whose Home Screens, put in order by hand, You first and Everyone last where they stay, and the order as text, so a
/// check can say.
const Owners = () => {
  const [owners, setOwners] = createSignal(["You", "Family", "PTC Systems", "Book Club", "Everyone"])
  return (
    <View style={look.column}>
      <ReorderList label="Home Screens" each={owners()} keyed={(owner) => owner} heading={(owner) => owner} fixed={(owner) => owner === "You" || owner === "Everyone"} onReorder={setOwners} />
      <Text>{`Order: ${owners().join(", ")}`}</Text>
    </View>
  )
}
const order = (...owners: string[]) => ({ expect: { text: `Order: ${owners.join(", ")}` } })
const handle = (owner: string) => ({ role: "button", name: `Reorder ${owner}` })
// A row's handle dragged down past the next row, and held there, or let go.
const dragged = (lift: boolean) => ({ from: handle("Family"), follow: { role: "listitem", name: "Family" }, gesture: { moves: [{ ms: 120 }, { dy: 70, ms: 400 }, { ms: 200 }], lift } })

export default {
  "Lists/Reordered by hand on a computer": {
    size: [750, 475],
    render: Owners,
    motions: { "A row dragged past the next and let go": dragged(true), "A row dragged and held": dragged(false) },
    checks: {
      // The UI SDK's reorder keys (foundation/drag-and-drop/reorder.ts at the commit reorder.ts names): Space picks a
      // row up, the arrows, Home and End move it, Space drops it, Escape puts it back.
      "Space, an arrow and Space move a row": [{ key: "Tab" }, { expect: { focused: handle("Family") } }, { key: " " }, { key: "ArrowDown" }, { key: " " }, order("You", "PTC Systems", "Family", "Book Club", "Everyone"), { expect: { focused: handle("Family") } }],
      "Escape puts it back": [{ key: "Tab" }, { key: " " }, { key: "ArrowDown" }, { key: "ArrowDown" }, { key: "Escape" }, order("You", "Family", "PTC Systems", "Book Club", "Everyone")],
      "Up and Down move between the handles until one is picked up": [{ key: "Tab" }, { key: "ArrowDown" }, { expect: { focused: handle("PTC Systems") } }, { key: "ArrowDown" }, { expect: { focused: handle("Book Club") } }, { key: "ArrowDown" }, { expect: { focused: handle("Book Club") } }],
      // You and Everyone stay first and last: nothing passes them, and they have no handle.
      "Fixed rows stay where they are": [
        { key: "Tab" },
        { key: " " },
        { key: "ArrowUp" },
        { key: "End" },
        { key: " " },
        order("You", "PTC Systems", "Book Club", "Family", "Everyone"),
        { expect: { gone: handle("You") } },
        { expect: { gone: handle("Everyone") } },
      ],
      // A click on a handle is a drag that didn't go anywhere, not Space: it picks nothing up.
      "A click on a handle picks nothing up": [{ press: handle("Family") }, { key: "ArrowDown" }, order("You", "Family", "PTC Systems", "Book Club", "Everyone"), { expect: { states: { of: handle("Family"), is: { pressed: false } } } }],
    },
  },
  // Dragged past the end, it takes the last place there is, before Everyone, which stays (it once couldn't: held at
  // the end, its middle was the last row's middle, never past it).
  "Lists/Reordered by hand, to the end": {
    size: [750, 475],
    render: Owners,
    motions: { "A row dragged past the end and let go": { from: handle("Family"), follow: { role: "listitem", name: "Family" }, gesture: { moves: [{ ms: 120 }, { dy: 200, ms: 500 }, { ms: 200 }], lift: true } } },
  },
  "Lists/Reordered by hand under a finger": {
    touch: true,
    render: Owners,
    motions: { "A row dragged by its handle past the next and let go": dragged(true), "A row dragged by its handle and held": dragged(false) },
  },
  "Lists/Metadata on a computer": { size: [750, 475], render: Details },
  "Lists/Metadata under a finger": { touch: true, render: Details },
  "Lists/Sections on a computer": {
    size: [750, 475],
    render: Sections,
    checks: {
      // Each list is one tab stop, the row open beside it first, and the arrows, Home, End and letters move in it.
      "The keyboard in a list": [
        { key: "Tab" },
        { expect: { focused: "GitHub github.com and api.github.com" } },
        { key: "ArrowDown" },
        { expect: { focused: "OpenRouter 14 Nov" } },
        { key: "ArrowDown" },
        { expect: { focused: "OpenRouter 14 Nov" } },
        { key: "Home" },
        { expect: { focused: "Cloudflare API api.cloudflare.com" } },
        { key: "o" },
        { expect: { focused: "OpenRouter 14 Nov" } },
        { key: "Tab" },
        { expect: { focused: "Stripe secret key 1" } },
        { key: "Tab", shift: true },
        { expect: { focused: "OpenRouter 14 Nov" } },
      ],
    },
  },
  "Lists/Sections under a finger": { touch: true, render: Sections },
  "Lists/Rows": () => (
    <List>
      <Row heading="A row" text="Its grey line, which says up to two lines of what it says before it's cut off at the end" onPress={() => {}} />
      <Row heading="The current one" text="Open beside the list" current onPress={() => {}} />
      <Row heading="With an end" end={<Text style={look.time}>12:30</Text>} />
      <Row
        heading="With a control"
        control={<Checkbox aria-label="Done" value />}
        end={
          <Menu.Root>
            <Menu.Trigger aria-label="More" />
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item value="a">Rename</Menu.Item>
                <Menu.Item value="b" destructive>
                  Delete
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        }
      />
    </List>
  ),
  "Lists/Rows coming and going": () => <Rows />,
  "Lists/A row added": { render: () => <Rows />, taps: ["Add Row"] },
  "Lists/A long list": () => (
    <List each={Array.from({ length: 10000 }, (_, at) => `Note ${at + 1}`)}>{(note) => <Row heading={note()} text="19 Nov" />}</List>
  ),
  "Lists/A long list by the keyboard": {
    size: [750, 475],
    // Each failed once: an arrow pressed before the row the last one went to was drawn went nowhere.
    seeds: [4, 6],
    render: () => (
      <List each={Array.from({ length: 10000 }, (_, at) => `Note ${at + 1}`)}>{(note) => <Row heading={note()} text="19 Nov" onPress={() => {}} />}</List>
    ),
    checks: {
      // Only the rows near the window are drawn, but End goes to the last of the 10,000 and Home to the first, which
      // scroll into view, as NSTableView's and Windows' ListView's do; so do the arrows past the rows that show.
      "Home and End reach the real ends": [
        { key: "Tab" },
        { expect: { focused: "Note 1 19 Nov" } },
        { key: "End" },
        { expect: { focused: "Note 10000 19 Nov" } },
        { expect: { shown: "Note 10000 19 Nov" } },
        { key: "ArrowUp" },
        { expect: { focused: "Note 9999 19 Nov" } },
        { expect: { shown: "Note 9999 19 Nov" } },
        { key: "Home" },
        { expect: { focused: "Note 1 19 Nov" } },
        { expect: { shown: "Note 1 19 Nov" } },
        ...Array.from({ length: 25 }, () => ({ key: "ArrowDown" })),
        // Each key waits for the page, which a seed holds busy up to 120 ms.
        { expect: { focused: "Note 26 19 Nov" }, within: 8000 },
        { expect: { shown: "Note 26 19 Nov" } },
      ],
    },
  },
  // What people expect of a listbox the field that has the keyboard drives, from the UI SDK's own tests
  // (tests/specs/listbox.spec.ts at the commit listbox.ts names), as its root's keyboard has them: the arrows move,
  // stopping at the ends, Home and End go to them, the one chosen is the one Enter opens, and a press opens one.
  "Lists/Search results, a listbox": {
    size: [750, 475],
    render: () => <Results />,
    checks: {
      "The first is chosen to begin with": [search, { expect: option("Apple") }, { expect: option("Banana", false) }],
      "The arrows move, stopping at the ends": [search, { key: "ArrowUp" }, { expect: option("Apple") }, ...Array.from({ length: 4 }, () => ({ key: "ArrowDown" })), { expect: option("Grape") }],
      "Home and End move to the first and last": [search, { key: "End" }, { expect: option("Grape") }, { key: "Home" }, { expect: option("Apple") }],
      "Enter opens the one chosen": [search, { key: "ArrowDown" }, { key: "Enter" }, { expect: { text: "Opened: Banana" } }],
      "A press opens one": [{ role: "option", name: "Cherry" }, { expect: { text: "Opened: Cherry" } }],
      "Typing chooses the first of what it finds": [search, { key: "End" }, { type: "an" }, { expect: option("Banana") }, { expect: { gone: { role: "option", name: "Grape" } } }],
    },
  },
  "Lists/Rows with headings of their own, by the keyboard": {
    size: [750, 475],
    render: () => (
      <List>
        <Row heading={<Text>Alpha</Text>} onPress={() => {}} />
        <Row heading={<Text>Bravo</Text>} onPress={() => {}} />
        <Row heading={<Text>Charlie</Text>} onPress={() => {}} />
      </List>
    ),
    checks: {
      // A heading that's a component, as Settings' person row is, has its words for a name: letters typed find it.
      "Letters find a row by its heading": [
        { key: "Tab" },
        { expect: { focused: "Alpha" } },
        { key: "c" },
        { expect: { focused: "Charlie" } },
        { wait: 2000 },
        { key: "b" },
        { expect: { focused: "Bravo" } },
      ],
    },
  },
} satisfies Scenes
