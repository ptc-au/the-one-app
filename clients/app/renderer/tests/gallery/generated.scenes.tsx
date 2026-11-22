// A page no app draws: a random tree of what the renderer draws (cards with their shadows, rounded and inset boxes,
// glass over what scrolls, lists that scroll in it, things moved, grown, turned and faded, text), changed now and then
// as its seed says, for a few seconds, as other people's apps will draw what the gallery's scenes don't. The same
// seed is the same page and the same changes, at the same times on the page's clock, so what a frame of it shows wrong
// is shown again from its seed. Its link says the seed (`#Generated/Random?seed=7`); `bun animation.js --generated`
// plays many, each frame against the same drawn whole and moved by whole device pixels.
import { createSignal, For, onCleanup, Show } from "solid-js"
import { link, ScrollView, styles, Text, tokens, View, type Scenes } from "ui"

/// Mulberry32: a number from 0 to below 1, the same sequence for the same seed.
const random = (seed: number) => {
  // Mixed first, as seeds one apart start alike.
  seed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fills = styles({
  card: { backgroundColor: tokens.colour.card },
  blue: { backgroundColor: tokens.colour.blue },
  red: { backgroundColor: tokens.colour.red },
  green: { backgroundColor: tokens.colour.green },
  orange: { backgroundColor: tokens.colour.orange },
  purple: { backgroundColor: tokens.colour.purple },
  muted: { backgroundColor: tokens.colour.tile },
  field: { backgroundColor: tokens.colour.field },
})
const shadows = styles({
  none: { boxShadow: "none" },
  lifted: { boxShadow: tokens.shadow.lifted },
  window: { boxShadow: tokens.shadow.window },
  edge: { boxShadow: tokens.shadow.edge },
  field: { boxShadow: tokens.shadow.field },
  pill: { boxShadow: tokens.shadow.pill },
})
const corners = styles({
  none: { borderRadius: 0 },
  small: { borderRadius: tokens.radius.small },
  medium: { borderRadius: tokens.radius.medium },
  large: { borderRadius: tokens.radius.large },
  full: { borderRadius: tokens.radius.full },
})
const types = styles({
  body: { font: tokens.type.medium, color: tokens.colour.label },
  small: { font: tokens.type.small, color: tokens.colour.secondaryLabel },
  title: { font: tokens.type.title, color: tokens.colour.label },
})
const look = styles({
  page: { flexGrow: 1 },
  // Clear of what a phone keeps for itself, its status bar and home indicator, as a page is.
  content: { padding: tokens.grid[4], paddingTop: tokens.length.safeTop, paddingBottom: tokens.length.safeBottom, gap: tokens.grid[3] },
  card: { padding: tokens.grid[3], gap: tokens.grid[2] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: tokens.grid[2] },
  list: (height: number) => ({ height, borderRadius: tokens.radius.medium, backgroundColor: tokens.colour.card, overflow: "hidden" }),
  item: { paddingInline: tokens.grid[3], paddingBlock: tokens.grid[2], borderBottomWidth: tokens.length.hairline, borderColor: tokens.colour.quaternaryLabel },
  glass: (top: number, start: number, width: number) => ({ position: "absolute", top, start, width, padding: tokens.grid[3], borderRadius: tokens.radius.large, backgroundColor: tokens.colour.glass, backdropFilter: tokens.material.glass, boxShadow: tokens.shadow.glass }),
  box: (width: number, height: number) => ({ width, height }),
  moved: (x: number, y: number, scale: number, rotate: number, opacity: number) => ({ translateX: x, translateY: y, scale, rotate, opacity }),
  eased: (x: number, y: number, scale: number, rotate: number, opacity: number) => ({ translateX: x, translateY: y, scale, rotate, opacity, transitionProperty: ["translateX", "translateY", "scale", "rotate", "opacity"], transition: tokens.motion.smooth }),
  sprung: (x: number, y: number, scale: number, rotate: number, opacity: number) => ({ translateX: x, translateY: y, scale, rotate, opacity, transitionProperty: ["translateX", "translateY", "scale", "rotate", "opacity"], transition: tokens.motion.snappy }),
  faded: (opacity: number) => ({ opacity, transitionProperty: ["opacity"], transition: tokens.motion.settle }),
})

const WORDS = "the quick brown fox jumps over a lazy dog while seven bright cards drift under glass and lists scroll past their ends".split(" ")

/// What a page of `seed` draws, and changes for `seconds`.
function Random(props: { seed: number; seconds: number }) {
  const next = random(props.seed)
  const pick = <T,>(of: readonly T[]): T => of[Math.floor(next() * of.length)]
  const between = (least: number, most: number) => Math.round(least + next() * (most - least))
  const words = (count: number) => Array.from({ length: count }, () => pick(WORDS)).join(" ")
  // What each node changes about itself, while it's there.
  const changes = new Set<() => void>()
  const changing = (change: () => void) => {
    changes.add(change)
    onCleanup(() => changes.delete(change))
  }

  const Words = () => {
    const [said, say] = createSignal(words(between(1, 12)))
    const type = pick(Object.keys(types) as (keyof typeof types)[])
    changing(() => say(words(between(1, 12))))
    return <Text style={types[type]}>{said()}</Text>
  }

  const Box = () => {
    const [fill, setFill] = createSignal(pick(Object.keys(fills) as (keyof typeof fills)[]))
    const [corner, setCorner] = createSignal(pick(Object.keys(corners) as (keyof typeof corners)[]))
    const [shadow, setShadow] = createSignal(pick(Object.keys(shadows) as (keyof typeof shadows)[]))
    const [size, setSize] = createSignal([between(16, 120), between(16, 80)])
    const [place, setPlace] = createSignal([0, 0, 1, 0, 1])
    const [how, setHow] = createSignal(pick(["moved", "eased", "sprung"] as const))
    changing(() =>
      pick([
        () => setFill(pick(Object.keys(fills) as (keyof typeof fills)[])),
        () => setCorner(pick(Object.keys(corners) as (keyof typeof corners)[])),
        () => setShadow(pick(Object.keys(shadows) as (keyof typeof shadows)[])),
        () => setSize([between(16, 120), between(16, 80)]),
        () => {
          setHow(pick(["moved", "eased", "sprung"] as const))
          setPlace([between(-40, 40), between(-20, 20), pick([1, 1, 0.5, 0.8, 1.25]), pick([0, 0, 15, -30, 90, 7]), pick([1, 1, 0.4, 0])])
        },
      ])(),
    )
    return <View style={[fills[fill()], corners[corner()], shadows[shadow()], look.box(size()[0], size()[1]), look[how()](...(place() as [number, number, number, number, number]))]} />
  }

  const Card = (props: { depth: number }) => {
    const [shadow, setShadow] = createSignal(pick(["lifted", "window", "edge", "none"] as const))
    const [opacity, setOpacity] = createSignal(1)
    const [inside, setInside] = createSignal(Array.from({ length: between(1, 3) }, (_, at) => at))
    let made = inside().length
    changing(() =>
      pick([
        () => setShadow(pick(["lifted", "window", "edge", "none"] as const)),
        () => setOpacity(pick([1, 1, 0.6, 0.2])),
        () => setInside(inside().length > 1 && next() < 0.5 ? inside().filter((_, at) => at !== between(0, inside().length - 1)) : [...inside(), made++]),
      ])(),
    )
    return (
      <View style={[look.card, fills.card, corners.large, shadows[shadow()], look.faded(opacity())]}>
        <For each={inside()}>{() => block(props.depth + 1)}</For>
      </View>
    )
  }

  const Row = () => <View style={look.row}>{Array.from({ length: between(2, 6) }, () => <Box />)}</View>

  const List = () => {
    const [items, setItems] = createSignal(Array.from({ length: between(8, 30) }, () => words(between(1, 5))))
    changing(() => setItems(next() < 0.5 ? [words(between(1, 5)), ...items()] : items().slice(1)))
    return (
      <ScrollView style={look.list(between(96, 240))}>
        <For each={items()}>{(item) => <View style={look.item}><Text style={types.body}>{item}</Text></View>}</For>
      </ScrollView>
    )
  }

  /// A block of the tree, `depth` deep: past the second, only what holds nothing.
  const block = (depth: number) => {
    const [shown, show] = createSignal(true)
    changing(() => next() < 0.15 && show(!shown()))
    const kind = depth > 1 ? pick(["words", "box", "row"]) : pick(["words", "box", "row", "card", "card", "list"])
    return (
      <Show when={shown()}>
        {kind === "words" ? <Words /> : kind === "box" ? <Box /> : kind === "row" ? <Row /> : kind === "card" ? <Card depth={depth} /> : <List />}
      </Show>
    )
  }

  const Glass = () => {
    // Clear of a phone's status bar, and inside its window however wide.
    const place = () => [between(70, 300), between(0, 60), between(120, 300)]
    const [at, setAt] = createSignal(place())
    changing(() => setAt(place()))
    return (
      <View style={look.glass(...(at() as [number, number, number]))}>
        <Words />
      </View>
    )
  }

  const blocks = Array.from({ length: between(6, 16) }, () => block(0))
  const glasses = Array.from({ length: between(0, 2) }, () => <Glass />)
  // Changed now and then, one thing at a time, until `seconds` of the page's clock have gone.
  let gone = 0
  const step = () => {
    const all = [...changes]
    if (all.length) pick(all)()
    const wait = pick([16, 40, 90, 150, 250, 400])
    gone += wait
    if (gone < props.seconds * 1000) timer = setTimeout(step, wait)
  }
  let timer = props.seconds > 0 ? setTimeout(step, pick([16, 100, 300])) : undefined
  onCleanup(() => clearTimeout(timer))
  return (
    <View style={look.page}>
      <ScrollView style={look.page}>
        <View style={look.content}>{blocks}</View>
      </ScrollView>
      {glasses}
    </View>
  )
}

/// The seed and seconds its link says (`?seed=7&seconds=3`): seed 1 unless it says, and still unless it says how long
/// it changes, so the gallery's are drawn at one state, natively and on the web alike.
const asked = () => {
  const query = new URLSearchParams(decodeURIComponent(link() ?? "").split("?")[1] ?? "")
  return { seed: Number(query.get("seed") ?? 1), seconds: Number(query.get("seconds") ?? 0) }
}

const scene = { layout: "fullscreen", render: () => <Random {...asked()} /> } as const

// Three of them still, each a scene of its own by its link's seed, which the scenes' runner draws natively and on the
// web, and animation.js's checks draw the same however they came to be and moved.
export default {
  "Generated/Random": scene,
  "Generated/Random?seed=2": scene,
  "Generated/Random?seed=3": scene,
} satisfies Scenes
