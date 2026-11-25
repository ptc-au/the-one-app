import { createSignal } from "solid-js"
import { Button, List, Row, Screen, ScrollView, Sheet, Split, styles, Text, tokens, View, type Scenes } from "ui"

const look = styles({
  card: { padding: tokens.grid[4], borderRadius: tokens.radius.large, backgroundColor: tokens.colour.card, boxShadow: tokens.shadow.lifted, gap: tokens.grid[1] },
  page: { padding: tokens.grid[4], gap: tokens.grid[4] },
  phone: { height: 844 },
  strip: { flexDirection: "row", height: 80 },
  box: { width: 64, height: 64, borderRadius: tokens.radius.medium, backgroundColor: tokens.colour.blue },
  // About to move: a surface of its own, drawn from its picture.
  lifting: { willChange: ["translateY"] },
  inner: { height: 120 },
  smooth: (translateX: number) => ({ translateX, transitionProperty: ["translateX"], transition: tokens.motion.smooth }),
  snappy: (translateX: number) => ({ translateX, transitionProperty: ["translateX"], transition: tokens.motion.snappy }),
})

/// Each box says what it was last told of its move (`onTransitionEnd`): that it all but landed, then that it's at rest.
const Springs = () => {
  const [moved, setMoved] = createSignal(false)
  const Box = (props: { name: string; style: (translateX: number) => object }) => {
    const [told, setTold] = createSignal("still")
    return (
      <>
        <Text>{`${props.name}: ${told()}`}</Text>
        <View role="group" aria-label={props.name} onTransitionEnd={(event) => setTold((was) => (event.rest ? `${was}, then at rest` : "landed"))} style={[look.box, props.style(moved() ? 200 : 0)]} />
      </>
    )
  }
  return (
    <View style={look.page}>
      <Button onPress={() => setMoved(!moved())}>Move</Button>
      <Box name="Smooth" style={look.smooth} />
      <Box name="Snappy" style={look.snappy} />
    </View>
  )
}

const notes = Array.from({ length: 200 }, (_, at) => `Note ${at + 1}`)

/// Cards about to move, each a surface of its own, each with a list scrolled inside it, on a page taller than its window.
const Cards = () => (
  <ScrollView style={look.phone}>
    <View style={look.page}>
      {Array.from({ length: 8 }, (_, card) => (
        <View style={[look.card, look.lifting]}>
          <Text>{`Card ${card + 1}`}</Text>
          <ScrollView style={look.inner}>{notes.slice(0, 12).map((note) => <Text>{note}</Text>)}</ScrollView>
        </View>
      ))}
    </View>
  </ScrollView>
)

/// A page of rows that scroll along, as the App Store's are.
const Strips = () => (
  <ScrollView style={look.phone}>
    <View style={look.page}>
      {Array.from({ length: 10 }, (_, row) => (
        <View>
          <Text>{`Row ${row + 1}`}</Text>
          <ScrollView horizontal style={look.strip}>{Array.from({ length: 14 }, (_, at) => <View style={look.box}><Text>{`${row}.${at}`}</Text></View>)}</ScrollView>
        </View>
      ))}
    </View>
  </ScrollView>
)

/// A list whose rows say which was chosen, as a finger takes them.
const Chosen = () => {
  const [chosen, setChosen] = createSignal("none")
  return (
    <Screen heading={`Chosen: ${chosen()}`}>
      <List each={notes.slice(0, 40)}>{(note) => <Row heading={note()} onPress={() => setChosen(note())} />}</List>
    </Screen>
  )
}

/// A sheet of notes, which a finger pulls down from its list scrolled to its top to close.
const Pulled = () => {
  const [open, setOpen] = createSignal(true)
  return (
    <View>
      <Button onPress={() => setOpen(true)}>Show Notes</Button>
      <Sheet heading="Notes" open={open()} onClose={() => setOpen(false)}>
        <List each={notes.slice(0, 40)}>{(note) => <Row heading={note()} />}</List>
      </Sheet>
    </View>
  )
}

/// A list whose row opens its page over it, as a phone's does, which a finger in from the left edge goes back from.
const Pushed = () => {
  const [open, setOpen] = createSignal(false)
  return (
    <View style={look.phone}>
      <Split open={open()} onClose={() => setOpen(false)} detail={<Screen heading="Alex's Laptop" back><Text>Its page.</Text></Screen>}>
        <Screen heading="Devices">
          <List>
            <Row heading="Alex's Laptop" onPress={() => setOpen(true)} />
            <Row heading="Sam's Phone" onPress={() => setOpen(true)} />
          </List>
        </Screen>
      </Split>
    </View>
  )
}

// What moves under a pointer or a finger, each with the gestures animation.js plays on it, frame by frame.
export default {
  "Motion/Card dragged along": {
    touch: true,
    motions: {
      "Swiped and let go": { from: { role: "group", name: "Swipe me" }, follow: { role: "group", name: "Swipe me" }, gesture: { swipe: [160, 0], speed: 600 }, keeps: "Intel UHD laptop at 4K" },
      "Dragged with pauses": { from: { role: "group", name: "Swipe me" }, follow: { role: "group", name: "Swipe me" }, gesture: { drag: [200, 0], pauses: 2, speed: 400 }, keeps: "mid browser on WebGPU" },
    },
    render: () => (
      <View style={look.page}>
        <View role="group" aria-label="Swipe me" drag="x" dragConstraints={{ left: 0, right: 0 }} style={look.card}>
          <Text>Swipe me</Text>
          <Text>It gives as a rubber band and springs back.</Text>
        </View>
      </View>
    ),
  },
  // A trackpad's swipe drags it as a finger does, the fingers' alone: the pointer, nudged as they go, doesn't move it.
  "Motion/Card swiped by a trackpad": {
    touch: false,
    motions: { "Swiped, the pointer nudged": { follow: { role: "group", name: "Swipe me" }, gesture: { trace: "traces/trackpad-swipe-right.json" }, steady: true } },
    render: () => (
      <View style={look.page}>
        <View role="group" aria-label="Swipe me" drag="x" dragConstraints={{ left: 0, right: 0 }} style={look.card}>
          <Text>Swipe me</Text>
          <Text>It gives as a rubber band and springs back.</Text>
        </View>
      </View>
    ),
  },
  // The springs the tokens name, each moving a box 200 pt as Move is pressed: SwiftUI's `.smooth` and `.snappy`, each
  // told as it all but lands and again at rest, as SwiftUI's `.logicallyComplete` and `.removed`.
  "Motion/Springs": {
    motions: {
      "Smooth moves": { from: { role: "button", name: "Move" }, follow: { role: "group", name: "Smooth" }, gesture: { moves: [{ ms: 90 }] } },
      "Snappy moves": { from: { role: "button", name: "Move" }, follow: { role: "group", name: "Snappy" }, gesture: { moves: [{ ms: 90 }] } },
    },
    render: () => <Springs />,
    checks: {
      "Told it landed, then at rest": ["Move", { wait: 60 }, { expect: { text: "Smooth: still" } }, { wait: 2000 }, { expect: { text: "Smooth: landed, then at rest" } }, { expect: { text: "Snappy: landed, then at rest" } }],
    },
  },
  "Motion/Long list": {
    touch: true,
    motions: {
      Flung: { from: { x: 195, y: 600 }, gesture: { fling: [0, -300] }, keeps: "older iPhone" },
      "Pulled past its top": { from: { x: 195, y: 300 }, gesture: { swipe: [0, 240], speed: 800 } },
    },
    render: () => <List each={notes}>{(note) => <Row heading={note()} />}</List>,
  },
  // Lists in cards drawn from their pictures, the page flung on past its end: what scrolls in a card stays in it (a
  // surface of the page's tiles drew a card's rows past its box, 23 Nov), the page keeps the finger as a card's list
  // comes under it (the list took it, ran to its end and stretched, the page stopped), and it stretches on past its
  // end at the speed it reached it.
  "Motion/Lists in cards about to move": {
    touch: true,
    // Flung from between two cards, not from a card's list, so the page takes the finger.
    motions: { Flung: { from: { x: 195, y: 285 }, gesture: { fling: [0, -300] } } },
    render: () => <Cards />,
  },
  // A finger going up a page from a row that scrolls along, drifting a little left as a finger does, scrolls the page:
  // the row took the drift and the page stood still (25 Nov, the App Store in a chat app on a phone).
  "Motion/Rows that scroll along, in a page": {
    touch: true,
    motions: { "Swiped up on a row": { from: { x: 195, y: 130 }, gesture: { swipe: [-3, -200], speed: 800 } }, "Swiped along a row": { from: { x: 300, y: 130 }, gesture: { swipe: [-200, 3], speed: 800 } } },
    render: () => <Strips />,
  },
  // A finger as a phone's screen gives it, which every phone's host takes alike (the renderer's `view::touch`).
  "Motion/Rows under a finger": {
    touch: true,
    render: () => <Chosen />,
    checks: {
      "A tap presses a row": ["Note 3", { expect: { text: "Chosen: Note 3" } }],
      "A finger that pans the list presses nothing": [{ trace: "traces/finger-pans-up.json" }, { expect: { text: "Chosen: none" } }],
    },
  },
  "Motion/A sheet's list under a finger": {
    touch: true,
    render: () => <Pulled />,
    checks: {
      "Pulled down from its list's top, the sheet takes the finger and closes": [{ wait: 400 }, { trace: "traces/finger-pulls-down.json" }, { expect: { gone: { role: "dialog" } } }],
    },
  },
  "Motion/A page pushed, under a finger": {
    touch: true,
    motions: { "Push a page with less motion": { from: { role: "button", name: "Alex's Laptop" }, gesture: { moves: [{ ms: 90 }] }, reducedMotion: true, follow: { role: "heading", name: "Alex's Laptop" } } },
    render: () => <Pushed />,
    checks: {
      "In from the left edge, it goes back a page": ["Alex's Laptop", { wait: 400 }, { expect: { text: "Its page." } }, { trace: "traces/finger-from-left-edge.json" }, { expect: { gone: { text: "Its page." } } }],
    },
  },
} satisfies Scenes
