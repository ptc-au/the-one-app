import { createSignal } from "solid-js"
import { Button, Field, Input, List, plural, Problem, Row, type Scenes, Screen, ScrollView, styles, Text, tokens, View } from "ui"

const look = styles({
  column: { gap: tokens.grid[2] },
  largeTitle: { font: tokens.type.largeTitle },
  title: { font: tokens.type.title },
  figure: { font: tokens.type.figure },
  barTitle: { font: tokens.type.barTitle },
  large: { font: tokens.type.large },
  small: { font: tokens.type.small },
  caption: { font: tokens.type.caption },
  strong: { fontWeight: tokens.weight.medium },
  quiet: { color: tokens.colour.secondaryLabel },
  wrong: { color: tokens.colour.red },
  accent: { color: tokens.colour.blue },
  highlight: { backgroundColor: tokens.colour.quinaryLabel },
  width: (width: number) => ({ width }),
  stack: { gap: 8, padding: 24 },
  row: { height: 100, justifyContent: "center", paddingStart: 60, alignItems: "flex-start" },
  moved: { translateX: 90, translateY: 6 },
  grown: { scale: 2, color: tokens.colour.red },
  turned: { rotate: 90, color: tokens.colour.blue },
  inside: { scale: 1.5, translateX: 40 },
  nested: { scale: 0.8, translateX: 30 },
  centred: { width: 240, textAlign: "center", scale: 1.3, translateX: 20 },
  half: { translateX: "100%", scale: 0.9 },
  scroller: { height: 60, width: 200, scale: 1.4, translateX: 30 },
  spins: (turn: number) => ({ rotate: turn, transitionProperty: ["rotate"], transition: tokens.motion.smooth }),
  tilted: { rotate: 20 },
  fades: (opacity: number) => ({ opacity, transitionProperty: ["opacity"], transition: tokens.motion.quick }),
  flies: (x: number, y: number, scale: number) => ({ translateX: x, translateY: y, scale, transitionProperty: ["translateX", "translateY", "scale"], transition: tokens.motion.smooth }),
})

/// Words that read as content, which a pointer selects and copies as a web page's, beside a row it presses: an error's
/// title and its message, a sentence, a screen's title (one opened from another, with Back, where it says), and a field
/// to paste into, which says what it holds.
function Selectable(props: { back?: boolean }) {
  const [pasted, setPasted] = createSignal("")
  const [pressed, setPressed] = createSignal(0)
  return (
    <Screen heading="Backups stopped: the disk is full" back={props.back}>
      <Problem heading="Git Repos didn't open" text="Its server didn't answer in time." />
      <Text>Every word that reads as content can be copied.</Text>
      <List>
        <Row heading={`Pressed ${pressed()} times`} onPress={() => setPressed((times) => times + 1)} />
      </List>
      <Field label="Paste here">
        <Input value={pasted()} onChangeText={setPasted} />
      </Field>
      <Text>{`Holds: ${pasted()}`}</Text>
    </Screen>
  )
}

/// Dragged across the words `text` names, from its start to past its end on its first line.
const across = (text: string) => [{ down: { text, position: { x: 1, y: 8 } } }, { hover: { text, position: { x: 560, y: 8 } } }, { up: true as const }]

/// A link in a sentence's words, which says how often it's been pressed.
function InlineLink() {
  const [pressed, setPressed] = createSignal(0)
  return (
    <View style={look.column}>
      <Text>
        Read the{" "}
        <Text role="link" tabIndex={0} onPress={() => setPressed(pressed() + 1)} style={[look.accent, look.strong]}>
          terms of use
        </Text>{" "}
        before you go on.
      </Text>
      <Text style={[look.caption, look.quiet]}>Pressed {plural(pressed(), "time")}</Text>
    </View>
  )
}

/// Texts drawn moved, grown and turned, by themselves and inside a view that is, which the inspector finds where they're drawn.
const Transformed = () => (
  <View style={look.stack}>
    <View style={look.row}><Text>Plain text</Text></View>
    <View style={look.row}><Text style={look.moved}>Moved text</Text></View>
    <View style={look.row}><View style={look.inside}><Text>Inside a view</Text></View></View>
    <View style={look.row}><Text style={look.grown}>Grown</Text></View>
    <View style={look.row}><Text style={look.turned}>Turned</Text></View>
    <View style={look.row}><View style={look.turned}><Text>View turned</Text></View></View>
    <View style={look.row}><View style={look.inside}><View style={look.nested}><Text>Nested</Text></View></View></View>
    <View style={look.row}><Text style={look.centred}>Centred</Text></View>
    <View style={look.row}><Text style={look.half}>Half over</Text></View>
    <View style={look.row}><ScrollView style={look.scroller}><View style={look.column}><Text>First line</Text><Text>Second line</Text><Text>Third line</Text></View></ScrollView></View>
    <View style={look.row}><View style={look.inside}><Text>Some <Text style={look.strong}>words</Text> in spans</Text></View></View>
  </View>
)

/// Texts that fly when Go is pressed, by themselves and inside a view that does, one turned in a view inside it.
const Flying = () => {
  const [away, setAway] = createSignal(false)
  return (
    <View style={look.stack}>
      <Button onPress={() => setAway(!away())}>Go</Button>
      <View style={look.row}><Text style={away() ? look.flies(120, 30, 1.6) : look.flies(0, 0, 1)}>Flies</Text></View>
      <View style={look.row}><View style={away() ? look.flies(120, 30, 1.6) : look.flies(0, 0, 1)}><Text>Rides</Text></View></View>
      <View style={look.row}><Text style={look.spins(away() ? 90 : 0)}>Spins</Text></View>
      <View style={look.row}><View style={look.spins(away() ? 90 : 0)}><Text>Turns</Text></View></View>
      <View style={look.row}><View style={away() ? look.flies(120, 30, 1.6) : look.flies(0, 0, 1)}><View style={look.tilted}><Text>Tilts</Text></View></View></View>
      <View style={look.row}><View style={look.fades(away() ? 1 : 0.2)}><View style={away() ? look.flies(120, 30, 1.6) : look.flies(0, 0, 1)}><Text>Grows</Text></View></View></View>
    </View>
  )
}

export default {
  "Text/Transformed": {
    render: () => <Transformed />,
    size: [390, 1400],
    checks: {
      "Every text's rect is where its glyphs are drawn": [{ expect: { located: ["Plain text", "Moved text", "Inside a view", "Grown", "Turned", "View turned", "Nested", "Centred", "Some words in spans", "Half over", "First line", "Second line"] } }],
    },
  },
  "Text/Flying": {
    render: () => <Flying />,
    size: [390, 820],
    motions: {
      "A text flies": { from: { role: "button", name: "Go" }, gesture: { moves: [{ ms: 90 }] }, follow: "Flies", located: true, sharp: true },
      "A text rides a view that flies": { from: { role: "button", name: "Go" }, gesture: { moves: [{ ms: 90 }] }, follow: "Rides", located: true, sharp: true },
      "A text spins": { from: { role: "button", name: "Go" }, gesture: { moves: [{ ms: 90 }] }, follow: "Spins", located: true },
      "A text rides a view that spins": { from: { role: "button", name: "Go" }, gesture: { moves: [{ ms: 90 }] }, follow: "Turns", located: true },
      "A text turned in a view that flies": { from: { role: "button", name: "Go" }, gesture: { moves: [{ ms: 90 }] }, follow: "Tilts", located: true, sharp: true },
      "A text grows in a view that fades in": { from: { role: "button", name: "Go" }, gesture: { moves: [{ ms: 90 }] }, follow: "Grows", located: true },
    },
  },
  "Text/Type styles": () => (
    <View style={look.column}>
      <Text style={look.largeTitle}>Large Title</Text>
      <Text style={look.title}>Title</Text>
      <Text style={look.figure}>1,234</Text>
      <Text style={look.barTitle}>Bar Title</Text>
      <Text style={look.large}>Large</Text>
      <Text>Medium, the body's, which runs on over more than one line where there isn't room for all of it in one.</Text>
      <Text style={look.strong}>Medium, its weight medium</Text>
      <Text style={[look.caption, look.quiet]}>Caption, quiet</Text>
      <Text style={look.small}>Small</Text>
    </View>
  ),
  "Text/Styled spans": () => (
    <View style={look.column}>
      <Text style={look.quiet}>
        12 calls · <Text style={look.wrong}>3 failed</Text>
      </Text>
      <Text>
        Body, <Text style={look.strong}>medium weight</Text> and <Text style={[look.caption, look.quiet]}>a caption</Text> beside{" "}
        <Text style={look.highlight}>a highlight</Text> here
      </Text>
      <Text style={look.title}>
        Title with <Text style={look.accent}>a coloured word</Text>
      </Text>
    </View>
  ),
  // Words that read as content are selected by a pointer's drag and copied, as a web page's are: an error's title, a
  // sentence, a screen's title; a press on a row presses it and selects nothing.
  "Text/Selected and copied": {
    render: () => <Selectable />,
    size: [600, 600],
    checks: {
      "An error's title is selected by a drag, and copied": [
        ...across("Git Repos didn't open"),
        { expect: { selected: "Git Repos didn't open" } },
        { key: "c", ctrl: true },
        { role: "textbox", name: "Paste here" },
        { key: "v", ctrl: true },
        { expect: { text: "Holds: Git Repos didn't open" } },
      ],
      "A sentence is selected by a drag": [...across("Every word that reads"), { expect: { selected: "Every word that reads as content can be copied." } }],
      "The screen's title is selected by a drag": [...across("Backups stopped"), { expect: { selected: "Backups stopped: the disk is full" } }],
      "A press on a row presses it, selecting nothing": [
        { down: { text: "Pressed 0 times", position: { x: 1, y: 8 } } },
        { hover: { text: "Pressed 0 times", position: { x: 80, y: 8 } } },
        { up: true },
        { expect: { selected: false, text: "Pressed 1 times" } },
      ],
    },
  },
  // Under a finger, as a phone's browser and its own apps' pages have it: held still on words, a finger selects the
  // word, magnified as it's held, with handles at its ends and the system's menu (Copy, Select All) as it lifts; a tap
  // elsewhere lets go of it; a finger held on a row presses it and moving scrolls, selecting nothing.
  "Text/Selected by a finger": {
    render: () => <Selectable />,
    checks: {
      "Held, a word is selected and magnified, with its handles and the menu as it lifts": [
        { down: { text: "Every word that reads", position: { x: 12, y: 10 } } },
        { wait: 600 },
        { expect: { selected: "Every", magnifier: true, handles: 2, textMenu: false } },
        { up: true },
        { expect: { selected: "Every", textMenu: { items: ["copy", "selectAll"] }, handles: 2, magnifier: false } },
      ],
      "A tap elsewhere lets go of it": [
        { down: { text: "Its server didn't answer", position: { x: 12, y: 8 } } },
        { wait: 600 },
        { up: true },
        { expect: { selected: "Its", handles: 2 } },
        { x: 200, y: 760 },
        { expect: { selected: false, handles: 0, textMenu: false } },
      ],
      "A row held is pressed, selecting nothing": [
        { down: { text: "Pressed 0 times", position: { x: 12, y: 8 } } },
        { wait: 600 },
        { up: true },
        { expect: { selected: false, handles: 0, text: "Pressed 1 times" } },
      ],
      "Moved, a finger scrolls, selecting nothing": [
        { down: { text: "Every word that reads", position: { x: 12, y: 10 } } },
        { hover: { x: 40, y: 300 } },
        { up: true },
        { expect: { selected: false, handles: 0 } },
      ],
    },
  },
  // In a Mac's app window a screen opened from another has its bar in the title row, which moves the window where it's
  // held, but its title's words are selected there, as a page's are.
  "Text/Selected in a title row": {
    render: () => <Selectable back />,
    layout: "fullscreen",
    size: [600, 600],
    titleRow: true,
    checks: { "The screen's title is selected by a drag": [...across("Backups stopped"), { expect: { selected: "Backups stopped: the disk is full" } }] },
  },
  "Text/Inline link": () => <InlineLink />,
  "Text/Inline link, pressed": { render: () => <InlineLink />, taps: ["terms of use"] },
  "Text/Runs wrapping": () => (
    <View style={look.width(220)}>
      <Text>
        A sentence that wraps, with <Text style={look.wrong}>a red stretch that runs on over the end of a line</Text> and{" "}
        <Text style={[look.strong, look.highlight]}>a highlighted bold one that wraps too</Text> then plain words to its end
      </Text>
    </View>
  ),
} satisfies Scenes
