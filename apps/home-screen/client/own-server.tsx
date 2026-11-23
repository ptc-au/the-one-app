// Your own server: a step of onboarding, after Welcome, on a computer's app only (a Mac, a PC or a Linux computer),
// and only where it isn't one of its network's servers already. This computer can run its person's apps while it's
// awake, instead of the cloud. Its switch starts on, and changes nothing until Continue: then, with it on, this
// computer becomes a server, as the switch at the top of Settings › Devices makes it one (apps/sign-in/client/
// devices.tsx), Continue spinning until it's started, as the mockup's Starting… does, and it goes on: so the Vault's
// step after it (vault.tsx) sees a server waiting for its person's key. Where it couldn't start, it says why and stays. Its picture, beside it, is this computer, the cloud at
// the network's address and a phone: with it on, the apps run on this computer while it's awake and in the cloud while
// it sleeps, every 3.2 s; with it off, in the cloud only. It changes as the switch does.
import { createEffect, createSignal, For, Show } from "solid-js"
import { Button, client, defineVars, type Element, illustration, Image, Path, reducedMotion, Svg, styles, Switch, Text, toast, tokens, View } from "ui"
import { Box, circle, Panel, type Part, Shape, Words } from "./art.tsx"
import { device } from "./store.ts"
import { network } from "./welcome.tsx"

const drawn = illustration("Your own server's picture: this computer's screen and keyboard, a cloud, a phone and its apps, a moon, a globe and the apps moving between them, each in the colours of what isn't ours, drawn the same in light and dark", {
  cloud: "#ffffff", cloudEdge: "#00000014", cloudShadow: "0 8px 18px #0000001f",
  globeInk: "#6e6e73", moon: "#cfd2ff",
  chip: "#ffffff", chipShadow: "0 2px 8px #0000001a, 0 0 0 0.5px #00000014", statusDot: "#c7c7cc",
  screenBezel: "#0c0c0d", screenEdge: "inset 0 0 0 1px #3a3a3c", desktop: "linear-gradient(160deg, #e8a3b8, #8b8ff0)", screenOff: "#08080a",
  keyboardDeck: "linear-gradient(#e9e9ec, #b9b9bf 70%, #8e8e94)", deckNotch: "#a5a5ab",
  phoneBody: "#1c1c1e", phoneEdge: "inset 0 0 0 1.2px #5a5a5e, 0 10px 24px #0000002e", phoneScreen: "#f2f2f7", phoneIsland: "#000000",
  phoneApp1: "linear-gradient(145deg, #ffb340, #f2384b)", phoneApp2: "linear-gradient(#5ac8fa, #007aff)", phoneApp3: "linear-gradient(#34c759, #248a3d)",
  phoneApp4: "linear-gradient(#bf5af2, #7d3cff)", phoneApp5: "linear-gradient(#ffd60a, #ff9f0a)", phoneApp6: "linear-gradient(#ff6482, #ff2d55)",
  movingApp1: "linear-gradient(145deg, #ffb340, #ff6a2b 55%, #f2384b)", movingApp2: "linear-gradient(145deg, #64d2ff, #0a84ff)", movingApp3: "linear-gradient(145deg, #bf5af2, #7d3cff)",
  movingAppShadow: "inset 0 0.5px 0 #ffffff80, 0 3px 8px #00000033",
})

/// How long the picture shows this computer awake, then asleep, as the mockup plays them.
const PHASE = 3200
/// How round the switch's card's corners are, as the mockup has them: the window's radius, 10, and 4 more.
const ROUND = { card: 14 }

const own = defineVars({
  title: 24,
  titleNarrow: 20,
  titleLeading: 28,
  titleLeadingNarrow: 23,
  titleSpacing: -0.48,
  titleSpacingNarrow: -0.4,
  mark: 34,
  markNarrow: 28,
  subtitle: 13.5,
  subtitleLeading: 18.25,
  perk: 14.5,
  perkLeading: 19,
  perkGap: 11,
  glyph: 16,
  option: 14.5,
  optionLeading: 19,
  small: 12.5,
  smallLeading: 17,
  narrowGap: 14,
  pillPad: 5,
  cardPadBlock: 11,
  cardPadInline: 12,
  caption: 12.5,
  captionLeading: 17,
  captionGlyph: 19,
  captionGlyphInner: 11,
  board: 440,
  boardHeight: 330,
  ...illustration("The caption pill's colours and the wires on the art board, as the mockup has them", { captionFill: "#18181adb", captionInk: "#ffffff", captionGlyphFill: "#ffffff", captionGlyphInk: "#111111", wire: "#0000001a", flow: "#0a84ff" }),
})

const look = styles({
  screen: (width: number, height: number) => ({ width, height, alignItems: "center", justifyContent: "center" }),
  wide: (width: number) => ({ width, flexDirection: "column", gap: tokens.grid[4] }),
  columns: (height: number) => ({ height, flexDirection: "row", gap: tokens.grid[5] }),
  side: { flexGrow: 1, flexShrink: 1, flexBasis: 0, flexDirection: "column", justifyContent: "space-between", gap: tokens.grid[4] },
  body: { flexDirection: "column", gap: tokens.grid[3] },
  narrow: (width: number) => ({ width, paddingInline: tokens.grid[4], flexDirection: "column", gap: own.narrowGap }),
  brand: { flexDirection: "column", alignItems: "flex-start", gap: tokens.grid[1], paddingStart: tokens.grid[0.5] },
  brandNarrow: { flexDirection: "column", alignItems: "center", gap: tokens.grid[1.5] },
  heading: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2.5] },
  headingNarrow: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2] },
  mark: { width: own.mark, height: own.mark },
  markNarrow: { width: own.markNarrow, height: own.markNarrow },
  title: { fontSize: own.title, fontWeight: 700, lineHeight: own.titleLeading, letterSpacing: own.titleSpacing, color: tokens.colour.label },
  titleNarrow: { fontSize: own.titleNarrow, fontWeight: 700, lineHeight: own.titleLeadingNarrow, letterSpacing: own.titleSpacingNarrow, color: tokens.colour.label },
  subtitle: { fontSize: own.subtitle, lineHeight: own.subtitleLeading, color: tokens.colour.secondaryLabel },
  centred: { textAlign: "center" },
  perks: { flexDirection: "column", gap: own.perkGap },
  perk: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2.5] },
  glyph: { width: own.glyph, height: own.glyph },
  glyphInk: { fill: "none", stroke: tokens.colour.secondaryLabel, strokeWidth: 1.5 },
  perkText: { fontSize: own.perk, fontWeight: 550, lineHeight: own.perkLeading, color: tokens.colour.label },
  card: (borderRadius: number) => ({ flexDirection: "row", alignItems: "center", gap: tokens.grid[3], paddingBlock: own.cardPadBlock, paddingInline: own.cardPadInline, borderRadius, backgroundColor: tokens.colour.card }),
  cardText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, flexDirection: "column", gap: tokens.grid[0.5] },
  option: { fontSize: own.option, fontWeight: 600, lineHeight: own.optionLeading, color: tokens.colour.label },
  small: { fontSize: own.small, lineHeight: own.smallLeading, color: tokens.colour.secondaryLabel },
  strong: { fontWeight: 600, color: tokens.colour.label },
  go: { alignSelf: "stretch" },
  caption: { position: "absolute", start: 0, end: 0, bottom: tokens.grid[2.5], alignItems: "center", pointerEvents: "none" },
  pill: illustration("The caption pill's shadow and its rise into place, as the mockup draws them", {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.grid[1.5],
    paddingBlock: own.pillPad,
    paddingStart: own.pillPad,
    paddingEnd: tokens.grid[3],
    borderRadius: tokens.radius.full,
    backgroundColor: own.captionFill,
    boxShadow: "0 4px 14px #0000002e",
    animationName: { from: { opacity: 0, translateY: 4 }, to: { opacity: 1, translateY: 0 } },
    animationDuration: 300,
    animationTimingFunction: "ease",
    animationFillMode: "both",
  }),
  pillGlyph: { width: own.captionGlyph, height: own.captionGlyph, borderRadius: tokens.radius.full, backgroundColor: own.captionGlyphFill, alignItems: "center", justifyContent: "center" },
  sun: { width: own.captionGlyphInner, height: own.captionGlyphInner },
  sunInk: { fill: "none", stroke: own.captionGlyphInk, strokeWidth: 1.2 },
  pillText: { fontSize: own.caption, fontWeight: 600, lineHeight: own.captionLeading, color: own.captionInk, whiteSpace: "nowrap" },
})

/// How the picture's parts change between its states: each fades, and the apps move between this computer and the cloud.
const moves = styles({
  fades: { transitionProperty: ["opacity"], transition: tokens.motion.smooth },
  travels: { transitionProperty: ["translateX", "translateY"], transition: tokens.motion.snappy },
  at: (translateX: number, translateY: number) => ({ translateX, translateY }),
  shown: (opacity: number) => ({ opacity }),
  // Work flowing along a wire, as the mockup's dashes march along it: each of five offsets of its dashes in turn.
  dash0: { animationName: { "0%": { opacity: 1 }, "19.9%": { opacity: 1 }, "20%": { opacity: 0 }, "100%": { opacity: 0 } }, animationDuration: 450, animationIterationCount: "infinite", animationTimingFunction: "linear" },
  dash1: { animationName: { "0%": { opacity: 0 }, "19.9%": { opacity: 0 }, "20%": { opacity: 1 }, "39.9%": { opacity: 1 }, "40%": { opacity: 0 }, "100%": { opacity: 0 } }, animationDuration: 450, animationIterationCount: "infinite", animationTimingFunction: "linear" },
  dash2: { animationName: { "0%": { opacity: 0 }, "39.9%": { opacity: 0 }, "40%": { opacity: 1 }, "59.9%": { opacity: 1 }, "60%": { opacity: 0 }, "100%": { opacity: 0 } }, animationDuration: 450, animationIterationCount: "infinite", animationTimingFunction: "linear" },
  dash3: { animationName: { "0%": { opacity: 0 }, "59.9%": { opacity: 0 }, "60%": { opacity: 1 }, "79.9%": { opacity: 1 }, "80%": { opacity: 0 }, "100%": { opacity: 0 } }, animationDuration: 450, animationIterationCount: "infinite", animationTimingFunction: "linear" },
  dash4: { animationName: { "0%": { opacity: 0 }, "79.9%": { opacity: 0 }, "80%": { opacity: 1 }, "100%": { opacity: 1 } }, animationDuration: 450, animationIterationCount: "infinite", animationTimingFunction: "linear" },
  board: { position: "absolute", top: 0, start: 0, width: own.board, height: own.boardHeight },
  wire: { fill: "none", stroke: own.wire, strokeWidth: 2 },
  flow: { fill: "none", stroke: own.flow, strokeWidth: 2 },
})
const marching = [moves.dash0, moves.dash1, moves.dash2, moves.dash3, moves.dash4]

/// What this computer is called, by its build's target (`macos-aarch64`), or nothing for a phone or a browser.
export const computer = (target?: string) => ({ macos: "this Mac", windows: "this PC", linux: "this computer" } as Record<string, string>)[target?.split("-")[0] ?? ""]

/// The network's name, short, as the step says it ("Keeps costs down for PTC"): its own without "the" and "App", or
/// the One App's, said "the One App".
const short = (name: string) => (name === "the One App" ? name : name.replace(/^the (.+) App$/, "$1"))

// The wires, from the phone to this computer and to the cloud, as cubic Béziers, and each drawn as dashes 3 long
// every 10, at each of the five offsets they march through.
type Curve = [number, number, number, number, number, number, number, number]
const toComputer: Curve = [336, 232, 296, 232, 290, 170, 250, 166]
const toCloud: Curve = [366, 168, 366, 146, 342, 152, 340, 140]
const curve = ([x0, y0, x1, y1, x2, y2, x3, y3]: Curve) => `M${x0} ${y0}C${x1} ${y1} ${x2} ${y2} ${x3} ${y3}`
function dashes(bezier: Curve): string[] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = bezier
  const at = (t: number) => {
    const u = 1 - t
    return [u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]
  }
  // Points along it, each with how far along it is.
  const points: [number, number, number][] = []
  for (let step = 0, along = 0; step <= 400; step++) {
    const [x, y] = at(step / 400)
    if (step) along += Math.hypot(x - points[step - 1][0], y - points[step - 1][1])
    points.push([x, y, along])
  }
  const length = points[points.length - 1][2]
  return [0, 2, 4, 6, 8].map((offset) => {
    let d = ""
    for (let from = offset - 10; from < length; from += 10) {
      const run = points.filter(([, , along]) => along >= Math.max(0, from) && along <= Math.min(length, from + 3))
      if (run.length > 1) d += run.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("")
    }
    return d
  })
}
const wires = { computer: dashes(toComputer), cloud: dashes(toCloud) }

// The mockup's drawings: a cloud, a globe, a moon and a sun, and the step's three glyphs.
const cloudShape: Part[] = [{ d: "M38 86h76a30 30 0 0 0 3-59.8A40 40 0 0 0 42.3 22 32 32 0 0 0 38 86z", fill: drawn.cloud, stroke: drawn.cloudEdge }]
const globe: Part[] = [
  { d: circle(6, 6, 5), stroke: drawn.globeInk, width: 1.2 },
  { d: "M1 6h10M6 1c2 2.5 2 7.5 0 10M6 1c-2 2.5-2 7.5 0 10", stroke: drawn.globeInk, width: 1 },
]
const moon: Part[] = [{ d: "M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z", fill: drawn.moon }]
const glyphs = {
  faster: "M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z",
  costs: "M4.5 12.5h7.2a2.8 2.8 0 0 0 .3-5.58A3.8 3.8 0 0 0 4.6 5.8a2.7 2.7 0 0 0-.1 6.7z",
  builds: "M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 10V4.5A1.5 1.5 0 0 1 3.5 3zM5.5 14h5M8 11.5V14",
}
const sun = "M8.6 6a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 1 1 5.2 0M6 .8v1.6M6 9.6v1.6M.8 6h1.6M9.6 6h1.6M2.3 2.3l1.1 1.1M8.6 8.6l1.1 1.1M2.3 9.7l1.1-1.1M8.6 3.4l1.1-1.1"

/// The phone's apps, and the three that move between this computer and the cloud, as the mockup colours them.
const phoneApps = [
  drawn.phoneApp1,
  drawn.phoneApp2,
  drawn.phoneApp3,
  drawn.phoneApp4,
  drawn.phoneApp5,
  drawn.phoneApp6,
]
const moving = [drawn.movingApp1, drawn.movingApp2, drawn.movingApp3]

/// A white pill on the picture, centred on `x`: a dot or a glyph, and its words.
const Chip = (props: { x: number; y: number; children: Element }) => (
  <Box x={props.x - 100} y={props.y} w={200} middle>
    <Box row gap={5} h={20} pad={[0, 9]} r={99} fill={drawn.chip} shadow={drawn.chipShadow}>
      {props.children}
    </Box>
  </Box>
)

/// A wire's dashes, marching while motion's allowed, shown while work flows along it.
const Flow = (props: { phases: string[]; shown: boolean }) => (
  <View style={[moves.board, moves.fades, moves.shown(props.shown ? 1 : 0)]}>
    <For each={reducedMotion() ? props.phases.slice(0, 1) : props.phases}>
      {(d, index) => (
        <Svg viewBox="0 0 440 330" style={[moves.board, !reducedMotion() && marching[index()]]}>
          <Path d={d} style={moves.flow} />
        </Svg>
      )}
    </For>
  </View>
)

/// The picture: this computer awake or asleep, or not running a server (`on` false), the cloud and a phone, and where
/// the apps run.
function Drawing(props: { on: boolean; awake: boolean; name: string; host: string }) {
  const here = () => props.on && props.awake
  const status = () => (!props.on ? "Not running" : props.awake ? "Awake" : "Asleep")
  return (
    <Box x={0} y={0} w={440} h={330}>
      <Svg viewBox="0 0 440 330" style={moves.board}>
        <Path d={curve(toComputer)} style={moves.wire} />
        <Path d={curve(toCloud)} style={moves.wire} />
      </Svg>
      <Flow phases={wires.computer} shown={here()} />
      <Flow phases={wires.cloud} shown={!here()} />

      <Box x={276} y={56} w={128} h={62} r={31} shadow={drawn.cloudShadow} style={[moves.fades, moves.shown(here() ? 0.55 : 1)]} />
      <Shape x={266} y={30} w={148} h={92} viewBox="0 0 148 92" parts={cloudShape} style={[moves.fades, moves.shown(here() ? 0.55 : 1)]} />
      <Chip x={340} y={116}>
        <Shape w={10} h={10} viewBox="0 0 12 12" parts={globe} />
        <Words size={8.5} weight={600}>{props.host}</Words>
      </Chip>

      <Box x={34} y={82} w={206}>
        <Box h={132} r={[10, 10, 3, 3]} fill={drawn.screenBezel} shadow={drawn.screenEdge}>
          <Box x={6} y={6} w={194} h={119} r={3} clip image={drawn.desktop}>
            <Box x={0} y={0} w="100%" h="100%" fill={drawn.screenOff} style={[moves.fades, moves.shown(here() ? 0 : 0.9)]} />
          </Box>
          <Shape x={92} y={55} w={22} h={22} viewBox="0 0 24 24" parts={moon} style={[moves.fades, moves.shown(props.on && !props.awake ? 1 : 0)]} />
        </Box>
        <Box h={9} m={[0, -18, 0, -18]} r={[1, 1, 8, 8]} image={drawn.keyboardDeck}>
          <Box x={101} y={0} w={40} h={4} r={[0, 0, 5, 5]} fill={drawn.deckNotch} />
        </Box>
      </Box>
      <Chip x={137} y={228}>
        <Box w={6} h={6} r={3} fill={drawn.statusDot} />
        <Words size={8.5} weight={600}>{`${props.name[0].toUpperCase()}${props.name.slice(1)} · ${status()}`}</Words>
      </Chip>

      <Box x={336} y={168} w={60} h={122} r={14} fill={drawn.phoneBody} shadow={drawn.phoneEdge}>
        <Box x={3} y={3} w={54} h={116} r={11} fill={drawn.phoneScreen} clip pad={[16, 6, 0, 6]} gap={5}>
          <For each={[phoneApps.slice(0, 3), phoneApps.slice(3)]}>
            {(row) => <Box row gap={5}><For each={row}>{(image) => <Box w={10.6} h={10.6} r={3} image={image} />}</For></Box>}
          </For>
        </Box>
        <Box x={22} y={5} w={16} h={5} r={3} fill={drawn.phoneIsland} />
      </Box>

      <Box x={0} y={0} row gap={5} z={3} style={[moves.travels, here() ? moves.at(98, 136) : moves.at(301, 66)]}>
        <For each={moving}>{(image) => <Box w={22} h={22} r={6} image={image} shadow={drawn.movingAppShadow} />}</For>
      </Box>
    </Box>
  )
}

/// Your own server, in `width` by `height`. `onContinue` goes on, once this computer's begun becoming a server if its
/// switch is on.
export function OwnServer(props: { width: number; height: number; onContinue: () => void; progress?: Element }) {
  const [on, setOn] = createSignal(true)
  const [awake, setAwake] = createSignal(true)
  // Awake, then asleep, and so on, while it's on and motion's allowed; with it switched, from awake again.
  createEffect(
    () => on() && !reducedMotion(),
    (cycling) => {
      setAwake(true)
      if (!cycling) return
      const timer = setInterval(() => setAwake((was) => !was), PHASE)
      return () => clearInterval(timer)
    },
  )
  const name = () => computer(device().target) ?? "this computer"
  const host = () => (device().network ? new URL(device().network!).host : "Cloud")
  const [starting, setStarting] = createSignal(false)
  const go = async () => {
    // A computer that's a server already, as onboarding shown again finds it, only goes on.
    if (on() && !device().server) {
      setStarting(true)
      // Going on says it's done; only why it couldn't is said.
      try {
        await client({ serve: true })
      } catch (error) {
        setStarting(false)
        return void toast(error as Error)
      }
    }
    props.onContinue()
  }
  const wide = () => props.width >= 600

  const Heading = (heading: { narrow?: boolean }) => (
    <View style={heading.narrow ? look.brandNarrow : look.brand}>
      <View style={heading.narrow ? look.headingNarrow : look.heading}>
        <Image src={network().light} srcDark={network().dark} alt="" style={heading.narrow ? look.markNarrow : look.mark} />
        <Text role="heading" aria-level={1} style={heading.narrow ? look.titleNarrow : look.title}>
          Your own server
        </Text>
      </View>
      <Text style={[look.subtitle, heading.narrow && look.centred]}>Do the behind-the-scenes work on {name()} while it's awake, instead of in the cloud.</Text>
    </View>
  )

  const Perk = (perk: { d: string; children: string }) => (
    <View style={look.perk}>
      <Svg viewBox="0 0 16 16" aria-hidden="true" style={look.glyph}>
        <Path d={perk.d} style={look.glyphInk} />
      </Svg>
      <Text style={look.perkText}>{perk.children}</Text>
    </View>
  )

  const Body = () => (
    <View style={look.body}>
      <View style={look.perks}>
        <Perk d={glyphs.faster}>Faster</Perk>
        <Perk d={glyphs.costs}>{`Keeps costs down for ${short(network().name)}`}</Perk>
        <Perk d={glyphs.builds}>{`Build apps that use ${name()}`}</Perk>
      </View>
      <View style={look.card(ROUND.card)}>
        <View style={look.cardText}>
          <Text style={look.option}>Run your own server on {name()}</Text>
          <Text style={look.small}>Only runs your own apps and data, never anyone else's.</Text>
        </View>
        <Switch aria-label="Run your own server" value={on()} disabled={starting()} onValueChange={setOn} />
      </View>
      <Text style={look.small}>
        {on() ? "Turn it off anytime in " : "You can turn it on later in "}
        <Text style={look.strong}>Settings › Devices</Text>.
      </Text>
    </View>
  )

  // The picture, and what it shows said at its foot.
  const Picture = (size: { width: number; height: number }) => {
    const caption = () => (!on() ? "Apps run in the cloud" : awake() ? `Awake: apps run on ${name()}` : "Asleep: the cloud takes over")
    return (
      <Panel
        width={size.width}
        height={size.height}
        over={
          <View style={look.caption}>
            <Show when={caption()} keyed>
              {(said) => (
                <View style={look.pill}>
                  <View style={look.pillGlyph}>
                    <Svg viewBox="0 0 12 12" style={look.sun}>
                      <Path d={sun} style={look.sunInk} />
                    </Svg>
                  </View>
                  <Text style={look.pillText}>{said}</Text>
                </View>
              )}
            </Show>
          </View>
        }
      >
        <Drawing on={on()} awake={awake()} name={name()} host={host()} />
      </Panel>
    )
  }

  const Continue = () => (
    <Button shape={wide() ? undefined : "capsule"} loading={starting()} onPress={go} style={look.go}>
      Continue
    </Button>
  )

  return (
    <View style={look.screen(props.width, props.height)}>
      <Show
        when={wide()}
        fallback={(() => {
          const width = Math.min(props.width, 480)
          const inner = width - 32
          return (
            <View style={look.narrow(width)}>
              {props.progress}
              <Heading narrow />
              <Picture width={inner} height={Math.round((inner * 3.4) / 4)} />
              <Body />
              <Continue />
            </View>
          )
        })()}
      >
        {(() => {
          const width = Math.min(props.width - 48, 960)
          const panel = Math.round(((width - 20) * 1.2) / 2.2)
          // As tall as the mockup's picture, about 0.7 of its width, never under 330, and what fits under the heading.
          const height = Math.min(props.height - 48 - 90, Math.max(330, Math.round(panel * 0.7)))
          return (
            <View style={look.wide(width)}>
              <Heading />
              <View style={look.columns(height)}>
                <View style={look.side}>
                  <Body />
                  <Continue />
                </View>
                <Picture width={panel} height={height} />
              </View>
            </View>
          )
        })()}
      </Show>
    </View>
  )
}
