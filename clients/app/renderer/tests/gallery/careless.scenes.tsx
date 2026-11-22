import { createSignal, For, onCleanup, Show } from "solid-js"
import { Badge, Icon, Image, ScrollView, styles, Text, tokens, View, type Scenes } from "ui"

// A page written the way a careless app is, whose author did what came to mind and looked at nothing: a long list
// under a glass header, twenty cards each with an inset shadow, a `willChange` on everything, a huge shadow, a badge
// that fades and an icon that turns on every card, scroll boxes inside scroll boxes, words over glass, and pictures
// that arrive late and push what's under them down. Every part is something an app does on its own; the scene is what
// they cost all at once, so the frames of a fling or a wheel on it say what the renderer does with an app nobody
// tuned (a stress scene, which is no model of how to write one).

const look = styles({
  page: { flexGrow: 1 },
  // The page kept to its window. A page without it is as tall as what it holds, as CSS's `min-height: auto` has a flex item
  // (a scroll box too is as tall as its content, there, till its parent says otherwise): a browser scrolls the document.
  bounded: { minHeight: 0 },
  // Under the glass header, and above the glass bar, as a careless page clears them, by guessing.
  content: { paddingTop: 150, paddingBottom: 120, paddingInline: tokens.grid[4], gap: tokens.grid[4] },
  // On everything, as `willChange` is by someone who read once that it makes things fast.
  layer: { willChange: ["translateX", "translateY", "scale", "opacity"] },
  card: { padding: tokens.grid[4], gap: tokens.grid[3], borderRadius: tokens.radius.large, backgroundColor: tokens.colour.card, boxShadow: tokens.shadow.field },
  // A card with a huge shadow, and a wider one: its blur is the window's, 32 and 48 points, on a card that fills the page.
  huge: { height: 220, boxShadow: tokens.shadow.window },
  windowed: { boxShadow: tokens.shadow.window },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.grid[3] },
  grow: { flexGrow: 1, flexShrink: 1, gap: tokens.grid[1] },
  title: { font: tokens.type.large, color: tokens.colour.label },
  body: { font: tokens.type.medium, color: tokens.colour.secondaryLabel },
  small: { font: tokens.type.small, color: tokens.colour.secondaryLabel },
  avatar: { width: 56, height: 56, borderRadius: tokens.radius.full, backgroundColor: tokens.colour.tile },
  banner: { width: "100%", height: 150, borderRadius: tokens.radius.medium },
  // A picture that has arrived, in the room that it needed, which wasn't kept for it.
  late: { width: "100%", height: 0, borderRadius: tokens.radius.medium, overflow: "hidden" },
  arrived: { height: 150 },
  fading: { animationName: { from: { opacity: 1 }, "50%": { opacity: 0.1 }, to: { opacity: 1 } }, animation: tokens.motion.pulse },
  turning: { animationName: "spin", animation: tokens.motion.spin, flexShrink: 0 },
  box: (height: number) => ({ height, borderRadius: tokens.radius.medium, backgroundColor: tokens.colour.field, boxShadow: tokens.shadow.field, overflow: "hidden" }),
  line: { paddingInline: tokens.grid[3], paddingBlock: tokens.grid[2], borderBottomWidth: tokens.length.hairline, borderColor: tokens.colour.quaternaryLabel },
  header: { position: "absolute", top: 0, start: 0, end: 0, paddingTop: tokens.length.safeTop, paddingBottom: tokens.grid[3], paddingInline: tokens.grid[4], gap: tokens.grid[1], backgroundColor: tokens.colour.glass, backdropFilter: tokens.material.glass, boxShadow: tokens.shadow.glass },
  bar: { position: "absolute", bottom: tokens.length.safeBottom, start: tokens.grid[4], end: tokens.grid[4], flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: tokens.grid[3], borderRadius: tokens.radius.full, backgroundColor: tokens.colour.glass, backdropFilter: tokens.material.glass, boxShadow: tokens.shadow.glass },
})

/// A letter on a colour, as an app draws a picture for what it has none of.
const face = (letter: string, hue: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" style="fill:oklch(0.6 0.14 ${hue})"/><text x="28" y="28" dy="0.35em" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26" font-weight="600" fill="#fff">${letter}</text></svg>`)}`

/// A photo as a server sends one: blurred shapes that take a while to decode.
const photo = (hue: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150"><filter id="b"><feGaussianBlur stdDeviation="22"/></filter><g filter="url(#b)"><circle cx="110" cy="70" r="70" fill="oklch(0.6 0.2 ${hue})"/><circle cx="290" cy="90" r="80" fill="oklch(0.6 0.2 ${(hue + 140) % 360})"/></g></svg>`)}`

/// What arrives `ms` after the page's clock starts, and is nothing until then.
const later = (ms: number) => {
  const [here, arrive] = createSignal(false)
  const timer = setTimeout(() => arrive(true), ms)
  onCleanup(() => clearTimeout(timer))
  return here
}

const NAMES = ["Sam", "Alex", "Priya", "Jordan", "Mei", "Tomás", "Noor", "Lee", "Ana", "Kofi"]
const LINES = [
  "Are we still on for tomorrow? I can move it to the afternoon if the morning's too early for the others.",
  "The build is green again after the weekend, and the deploy went out to every server without a hitch.",
  "Photos from the trip are in the shared folder, all four hundred of them, so take your time.",
  "Reminder: the invoice for the March work is due on Friday, and the new total includes the extra day.",
]

/// A box that scrolls, with lines in it, and one more inside it, as a card's "details" are written without looking at
/// where a finger will land.
const Scrolling = (props: { lines: number; inside?: boolean }) => (
  <ScrollView style={[look.box(props.inside ? 160 : 100), look.layer]}>
    <For each={Array.from({ length: props.lines }, (_, at) => at)}>{(at) => <View style={[look.line, look.layer]}><Text style={look.body}>{`Detail ${at + 1} of its card, as a list scrolled inside a list`}</Text></View>}</For>
    <Show when={props.inside}>
      <Scrolling lines={8} />
    </Show>
  </ScrollView>
)

const Card = (props: { at: number }) => {
  const name = NAMES[props.at % NAMES.length]
  // Pictures that come when they come: the face a little after the card, the photo a good while, and nothing was kept for it.
  const arrived = later(500 + props.at * 120)
  const photoArrived = later(600 + props.at * 140)
  return (
    <View style={[look.card, look.layer, props.at % 5 === 2 && look.windowed]}>
      <View style={[look.row, look.layer]}>
        <Show when={arrived()} fallback={<View style={[look.avatar, look.layer]} />}>
          <Image src={face(name[0], props.at * 37)} alt="" style={look.avatar} />
        </Show>
        <View style={[look.grow, look.layer]}>
          <Text style={look.title}>{`${name}, message ${props.at + 1}`}</Text>
          <Text style={look.small}>{`${(props.at % 12) + 1}:${String((props.at * 7) % 60).padStart(2, "0")}`}</Text>
        </View>
        <View style={[look.fading, look.layer]}>
          <Badge variant="destructive">{String(props.at + 1)}</Badge>
        </View>
        <View style={[look.turning, look.layer]}>
          <Icon name="gear-six" />
        </View>
      </View>
      <Text style={look.body}>{LINES[props.at % LINES.length]}</Text>
      <Show when={props.at % 3 === 1}>
        <View style={[look.late, look.layer, photoArrived() && look.arrived]}>
          <Show when={photoArrived()}>
            <Image src={photo(props.at * 53)} alt="" style={look.banner} />
          </Show>
        </View>
      </Show>
      <Show when={props.at % 4 === 3}>
        <Scrolling lines={10} inside />
      </Show>
    </View>
  )
}

// What the motions follow and what must stay drawn: the first card's title, which scrolls with the list, and the
// header's words, which are over the glass the whole time.
const follow = { role: "text", name: "Sam, message 1" }
const header = "Twenty messages, three of them new, over the glass that the cards scroll under"

const Careless = (props: { bounded: boolean }) => (
  <View style={[look.page, props.bounded && look.bounded]}>
    <ScrollView style={[look.page, props.bounded && look.bounded]}>
      <View style={look.content}>
        <View style={[look.card, look.layer, look.huge]}>
          <Text style={look.title}>Inbox</Text>
          <Text style={look.body}>Twenty cards under glass, each with its own shadow, badge, icon and picture.</Text>
        </View>
        <For each={Array.from({ length: 20 }, (_, at) => at)}>{(at) => <Card at={at} />}</For>
      </View>
    </ScrollView>
    <View style={look.header}>
      <Text style={look.title}>Inbox</Text>
      <Text style={look.body}>{header}</Text>
    </View>
    <View style={look.bar}>
      <Text style={look.body}>Compose</Text>
      <Text style={look.body}>Search</Text>
      <Text style={look.body}>Settings</Text>
    </View>
  </View>
)

// A finger flings it, drags it past a nested box, pulls it down from its top; a wheel turns it, by notches as a mouse's
// do and as a trackpad's fingers; its badges fade and its icons turn throughout.
export default {
  "Careless/On a phone": {
    touch: true,
    layout: "fullscreen",
    render: () => <Careless bounded />,
    motions: {
      // Pressed in the margin beside the cards, where no scroll box of theirs is under the finger to take it.
      Flung: { from: { x: 378, y: 600 }, gesture: { fling: [0, -300] }, follow, holds: header },
      "Dragged and held": { from: { x: 378, y: 600 }, gesture: { moves: [{ dy: -300, ms: 100 }, { ms: 100 }], lift: true }, follow, holds: header },
      // On the first of the scroll boxes in a card, which takes the finger until it's at its end, and then the page does.
      "Flung from a box in a card": { from: { x: 195, y: 800 }, gesture: { fling: [0, -300] } },
      "Pulled past its top": { from: { x: 378, y: 400 }, gesture: { swipe: [0, 240], speed: 1600 }, follow, holds: header },
    },
  },
  // Its page not kept to its window, which the author of a page like this never thought of: it is as tall as its cards, as it is in
  // a browser, where the document scrolls, the header and the bar with it.
  "Careless/On a phone, its page not kept to its window": {
    touch: true,
    layout: "fullscreen",
    render: () => <Careless bounded={false} />,
    motions: { Flung: { from: { x: 378, y: 600 }, gesture: { fling: [0, -300] }, follow } },
  },
  "Careless/On a computer": {
    touch: false,
    layout: "fullscreen",
    size: [900, 640],
    render: () => <Careless bounded />,
    motions: {
      "Wheel notches": { gesture: { trace: "traces/careless-wheel-notches.json" }, follow, holds: header },
      "Trackpad swipe and its momentum": { gesture: { trace: "traces/careless-trackpad.json" }, follow, holds: header },
    },
  },
} satisfies Scenes
