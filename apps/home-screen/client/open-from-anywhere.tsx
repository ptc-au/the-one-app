// Open from anywhere: a step of onboarding, after Welcome, on a computer's app only (a Mac, a PC or a Linux computer),
// never on the web or a phone, which have no launcher shortcut. Its shortcut as keycaps, which its person changes
// here as in Settings' General (shortcut.tsx), and beside it a picture of this computer's desktop, a window open on
// it, where the shortcut is pressed and the launcher springs in over the window, again and again, from its start each
// time the shortcut changes. One shortcut opens the launcher of every network's app on the computer.
import { createSignal, For, Show } from "solid-js"
import { Button, defineVars, Image, reducedMotion, styles, Text, tokens, View } from "ui"
import { Box, circle, Panel, Shape, Words } from "./art.tsx"
import { labels, type Os, os, shortcut, ShortcutControl, WindowsKey } from "./shortcut.tsx"
import { network } from "./welcome.tsx"

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
  narrowGap: 14,
})

const look = styles({
  screen: (width: number, height: number) => ({ width, height, alignItems: "center", justifyContent: "center" }),
  wide: (width: number) => ({ width, flexDirection: "column", gap: tokens.grid[4] }),
  columns: (height: number) => ({ height, flexDirection: "row", gap: tokens.grid[5] }),
  side: { flexGrow: 1, flexShrink: 1, flexBasis: 0, flexDirection: "column", justifyContent: "space-between", gap: tokens.grid[4] },
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
  go: { alignSelf: "stretch" },
  // The picture's own: a launcher page's icons in rows, the owner pill in the card's middle, and a keycap's least width.
  rows: (rowGap: number) => ({ flexWrap: "wrap", rowGap }),
  middle: { alignSelf: "center" },
  least: (minWidth: number) => ({ minWidth }),
})

/// One press of the shortcut, every 5.4 s, as the mockup plays it: its keys come up at 0.9 s and go down one
/// after another, the launcher springs in at 1.5 s, the keys go at 2.4 s, and the launcher goes at 4.8 s.
const moves = styles({
  launcher: {
    animationName: {
      "0%": { opacity: 0, scale: 0.94, translateY: -6 },
      "27.8%": { opacity: 0, scale: 0.94, translateY: -6 },
      "30.7%": { opacity: 1 },
      "35.2%": { opacity: 1, scale: 1, translateY: 0 },
      "88.1%": { opacity: 1, scale: 1, translateY: 0 },
      "92.6%": { opacity: 0, scale: 0.94, translateY: -6 },
      "100%": { opacity: 0, scale: 0.94, translateY: -6 },
    },
    animationDuration: 5400,
    animationIterationCount: "infinite",
    animationTimingFunction: [0.2, 1.3, 0.35, 1],
  },
  keys: {
    animationName: {
      "0%": { opacity: 0, translateY: 6 },
      "16.7%": { opacity: 0, translateY: 6 },
      "19.4%": { opacity: 1, translateY: 0 },
      "41.5%": { opacity: 1, translateY: 0 },
      "44.4%": { opacity: 0, translateY: 6 },
      "100%": { opacity: 0, translateY: 6 },
    },
    animationDuration: 5400,
    animationIterationCount: "infinite",
    animationTimingFunction: "ease",
  },
  // Each key goes down in turn, 0.11 s apart, and they all come up as the launcher's in.
  down0: {
    animationName: { "0%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "18.6%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "18.7%": { translateY: 2, scale: 0.95, backgroundColor: "#0a84ffeb" }, "32.5%": { translateY: 2, scale: 0.95, backgroundColor: "#0a84ffeb" }, "33%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "100%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" } },
    animationDuration: 5400,
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  down1: {
    animationName: { "0%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "20.6%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "20.7%": { translateY: 2, scale: 0.95, backgroundColor: "#0a84ffeb" }, "32.5%": { translateY: 2, scale: 0.95, backgroundColor: "#0a84ffeb" }, "33%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "100%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" } },
    animationDuration: 5400,
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  down2: {
    animationName: { "0%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "22.7%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "22.8%": { translateY: 2, scale: 0.95, backgroundColor: "#0a84ffeb" }, "32.5%": { translateY: 2, scale: 0.95, backgroundColor: "#0a84ffeb" }, "33%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "100%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" } },
    animationDuration: 5400,
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  down3: {
    animationName: { "0%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "24.7%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "24.8%": { translateY: 2, scale: 0.95, backgroundColor: "#0a84ffeb" }, "32.5%": { translateY: 2, scale: 0.95, backgroundColor: "#0a84ffeb" }, "33%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" }, "100%": { translateY: 0, scale: 1, backgroundColor: "#1c1c1edb" } },
    animationDuration: 5400,
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
})
const downs = [moves.down0, moves.down1, moves.down2, moves.down3]

/// Each desktop's wallpaper, in the mockup's colours, each one gradient: the renderer draws a radial gradient that fades
/// to transparent over another with a ring at its edge, and leaves a corner dark in dark mode (23 Nov).
const wallpaper: Record<Os, string> = {
  mac: "linear-gradient(160deg, #f6c9a8, #e8a3b8 35%, #a596ee 70%, #6d7cf2)",
  windows: "radial-gradient(60% 70% at 50% 70%, #a9d6ff, #3f8cf0 30%, #1546b8 62%, #0a2466)",
  linux: "linear-gradient(160deg, #4b1d63, #9b3c74 55%, #e2754f 85%, #f08a5d)",
}
/// The apps in the dock or the taskbar, and on the launcher's pages, as the mockup colours them.
const docked = ["linear-gradient(#5ac8fa, #007aff)", "linear-gradient(#ffd60a, #ff9f0a)", "linear-gradient(#ffffff, #d1d1d6)", "linear-gradient(#34c759, #248a3d)", "linear-gradient(#ff6482, #ff2d55)", "linear-gradient(#8e8e93, #48484a)"]
const icons = ["#ff9f0a,#ff6a2b", "#64d2ff,#0a84ff", "#30d158,#248a3d", "#bf5af2,#7d3cff", "#ff6482,#ff2d55", "#ffd60a,#ff9f0a", "#8e8e93,#48484a", "#5e5ce6,#3634a3", "#40c8e0,#0a84ff", "#ff453a,#c9342a", "#ffffff,#d1d1d6", "#a2845e,#7a5c3a"].map((pair) => `linear-gradient(145deg, ${pair.split(",")[0]}, ${pair.split(",")[1]})`)
const wifi = [{ d: "M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.5 7a6.3 6.3 0 0 1 9 0l-1.4 1.4a4.3 4.3 0 0 0-6.2 0zM1.3 4.8a9.4 9.4 0 0 1 13.4 0l-1.4 1.4a7.4 7.4 0 0 0-10.6 0z", fill: "#1d1d1f" as const }]
const apple = [{ d: "M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.6 1.3-.1 1.7-.8 3.3-.8 1.5 0 1.9.8 3.3.8 1.4 0 2.2-1.3 3-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.4-.9-2.4-4.1zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z", fill: "#1d1d1f" as const }]

/// The desktop's own bars: a Mac's menu bar and Dock, Windows' taskbar, and GNOME's top bar.
function Bars(props: { os: Os }) {
  return (
    <>
      <Show when={props.os === "mac"}>
        <Box x={0} y={0} w={440} h={20} row gap={13} pad={[0, 12]} fill="#ffffff66" z={3}>
          <Shape w={10} h={12} viewBox="0 0 17 20" parts={apple} />
          <Words size={11} weight={700}>Notes</Words>
          <Words size={11}>File</Words>
          <Words size={11}>Edit</Words>
          <Words size={11}>View</Words>
          <Box row gap={11} m={[0, 0, 0, "auto"]}>
            <Shape w={11} h={11} viewBox="0 0 12 12" parts={[{ d: circle(6, 6, 4.6), stroke: "#1d1d1f", width: 1.4 }]} />
            <Shape w={13} h={10} viewBox="0 0 16 12" parts={wifi} />
            <Words size={11}>Mon 9:41</Words>
          </Box>
        </Box>
        <Box x={128} bottom={6} h={34} row gap={5} pad={[4, 6]} r={13} fill="#ffffff59" shadow="0 0 0 0.5px #ffffff80, 0 6px 18px #00000026" z={3}>
          <For each={docked}>{(image) => <Box w={26} h={26} r={7} image={image} />}</For>
        </Box>
      </Show>
      <Show when={props.os === "windows"}>
        <Box x={0} right={0} bottom={0} h={30} row middle gap={6} fill="#eef2fad6" lines={[0.5, 0, "#0000001a"]} z={3}>
          <Box w={18} h={18} r={4} image="conic-gradient(#0078d4 0 25%, #00a4ef 0 50%, #0078d4 0 75%, #00a4ef 0)" />
          <For each={docked.slice(1, 5)}>{(image) => <Box w={18} h={18} r={4} image={image} />}</For>
          <Box right={10} y={5}>
            <Words size={9} leading={10} ink="#111111">9:41 AM</Words>
            <Words size={9} leading={10} ink="#111111">23/11/2026</Words>
          </Box>
        </Box>
      </Show>
      <Show when={props.os === "linux"}>
        <Box x={0} y={0} w={440} h={20} row middle fill="#000000" z={3}>
          <Box x={8} y={7} row gap={3}>
            <Box w={16} h={6} r={3} fill="#ffffff" />
            <Box w={6} h={6} r={3} fill="#ffffff80" />
            <Box w={6} h={6} r={3} fill="#ffffff80" />
          </Box>
          <Words size={11} weight={600} ink="#ffffff">Mon 09:41</Words>
        </Box>
      </Show>
    </>
  )
}

/// The window open on the desktop, Notes, in each system's own frame.
function Window(props: { os: Os }) {
  const mac = () => props.os === "mac"
  return (
    <Box x={54} y={34} w={330} h={214} r={props.os === "windows" ? 7 : 10} fill="#ffffff" clip shadow="0 14px 36px #00000038, 0 0 0 0.5px #00000033">
      <Box h={props.os === "linux" ? 28 : 26} row gap={5} pad={[0, 9]} fill={props.os === "linux" ? "#ebebeb" : "#f5f5f7"} lines={[0, 0.5, "#e2e2e6"]}>
        <Show when={mac()}>
          <For each={["#ff5f57", "#febc2e", "#28c840"] as const}>{(fill) => <Box w={7} h={7} r={3.5} fill={fill} />}</For>
        </Show>
        <Words size={8} weight={props.os === "windows" ? 400 : props.os === "linux" ? 700 : 600} ink="#3c3c43" grow={1} centred={props.os !== "windows"}>
          Notes
        </Words>
        <Show when={!mac()}>
          <Box row gap={props.os === "linux" ? 5 : 0}>
            <For each={["–", "☐", "✕"]}>
              {(control) => (
                <Box w={props.os === "linux" ? 13 : 22} h={13} r={props.os === "linux" ? 6.5 : 0} fill={props.os === "linux" ? "#d8d8d8" : undefined} middle>
                  <Words size={7} ink="#3c3c43">{control}</Words>
                </Box>
              )}
            </For>
          </Box>
        </Show>
      </Box>
      <Box pad={[16, 22]} gap={7}>
        <Box w="46%" h={9} r={3} fill="#2c2c2e" m={[0, 0, 5, 0]} />
        <For each={[92, 84, 88, 60, 0, 90, 76, 82]}>{(width) => (width ? <Box w={`${width}%`} h={5} r={3} fill="#e5e5ea" /> : <Box h={3} />)}</For>
      </Box>
    </Box>
  )
}

/// The launcher, as it springs in over the window: its search and its card of Home's pages.
function Launcher(props: { still: boolean }) {
  const Icon = (icon: { at: number; chosen?: boolean }) => (
    <Box w={14} h={21}>
      <Show when={icon.chosen}>
        <Box x={-3} y={-3} w={20} h={23} r={6} fill="#00000017" />
      </Show>
      <Box w={14} h={14} r={4} image={icons[icon.at % icons.length]} shadow="inset 0 0.5px 0 #ffffff80" />
      <Box x={1} y={18} w={12} h={2} r={1} fill="#00000024" />
    </Box>
  )
  const Page = (page: { count: number; from: number; widget?: boolean }) => (
    <Box w={74} row gap={6} style={look.rows(5)}>
      <Show when={page.widget}>
        <Box w={34} h={47} r={7} fill="#ffffff" pad={[4, 5]} shadow="0 0 0 0.5px #00000014">
          <Words size={5} weight={700} ink="#ff3b30">MONDAY</Words>
          <Words size={13} weight={700} leading={13}>23</Words>
          <Box h={2} r={1} fill="#c7d8ff" m={[3, 0, 0, 0]} />
          <Box h={2} r={1} fill="#e5e5ea" m={[3, 0, 0, 0]} />
        </Box>
      </Show>
      <For each={Array.from({ length: page.count }, (_, at) => at)}>{(at) => <Icon at={page.from + at * (page.widget ? 1 : 5)} chosen={page.widget && at === 0} />}</For>
    </Box>
  )
  return (
    <Box x={80} y={52} w={280} z={4} style={props.still ? undefined : moves.launcher}>
      <Box h={34} r={11} row pad={[0, 13]} m={[0, 0, 7, 0]} fill="#f6f6f8bd" shadow="0 0 0 0.5px #0000001f, 0 10px 30px #0000002e">
        <Box w={1.5} h={15} fill="#0a84ff" m={[0, 2, 0, 0]} />
        <Words size={13.5} ink="#8a8a8e">Search apps…</Words>
      </Box>
      <Box r={14} pad={[9, 12, 9, 12]} fill="#f6f6f8bd" shadow="0 0 0 0.5px #0000001f, 0 10px 30px #0000002e">
        <Box row start gap={3} h={14} pad={[0, 7, 0, 3]} r={99} fill="#ffffffb3" m={[0, 0, 9, 0]} style={look.middle}>
          <Box w={9} h={9} r={4.5} fill="#e8467c" />
          <Words size={7} weight={600}>You</Words>
        </Box>
        <Box row between>
          <Page count={8} from={3} widget />
          <Page count={16} from={7} />
          <Page count={9} from={14} />
        </Box>
        <Box row middle gap={4} m={[6, 0, 0, 0]}>
          <Box w={4} h={4} r={2} fill="#000000b3" />
          <Box w={4} h={4} r={2} fill="#00000033" />
          <Box w={4} h={4} r={2} fill="#00000033" />
          <Box right={0} y={-3} h={10} pad={[0, 5]} r={99} fill="#ffffffbf" middle>
            <Words size={5.5} weight={600}>App Library</Words>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

/// The shortcut's keys, as they're pressed over the desktop, each going down in turn.
function Pressed(props: { keys: string[]; os: Os; still: boolean }) {
  return (
    <Box x={0} y={262} w={440} row middle gap={5} z={5} style={props.still ? undefined : moves.keys}>
      <For each={props.keys}>
        {(key, index) => (
          <Box h={30} pad={[0, 9]} r={7} fill="#1c1c1edb" middle shadow="inset 0 -2px 0 #ffffff14, 0 4px 12px #0000004d" style={[look.least(key === "Space" ? 70 : 30), !props.still && downs[Math.min(index(), 3)]]}>
            <Show when={key !== "Win"} fallback={<WindowsKey size={12} />}>
              <Words size={key.length > 1 ? 11 : 13} weight={500} ink="#ffffff">{key}</Words>
            </Show>
          </Box>
        )}
      </For>
    </Box>
  )
}

/// The picture: this computer's desktop, a window open on it, the shortcut pressed and the launcher springing in.
export function Desktop(props: { os: Os; keys: string }) {
  const still = () => reducedMotion()
  return (
    <Box x={0} y={0} w={440} h={330} image={wallpaper[props.os]} clip>
      <Bars os={props.os} />
      <Window os={props.os} />
      <Launcher still={still()} />
      <Pressed keys={labels(props.keys, props.os)} os={props.os} still={still()} />
    </Box>
  )
}

/// Open from anywhere, in `width` by `height`. `onContinue` goes on.
export function OpenFromAnywhere(props: { width: number; height: number; onContinue: () => void }) {
  // Played again from its start each time the shortcut changes.
  const [plays, setPlays] = createSignal(1)
  const keys = () => shortcut()?.keys ?? shortcut()?.default ?? ""
  const wide = () => props.width >= 600
  const Heading = (heading: { narrow?: boolean }) => (
    <View style={heading.narrow ? look.brandNarrow : look.brand}>
      <View style={heading.narrow ? look.headingNarrow : look.heading}>
        <Image src={network()?.light ?? "one-app.png"} srcDark={network()?.dark ?? "one-app.png"} alt="" style={heading.narrow ? look.markNarrow : look.mark} />
        <Text role="heading" aria-level={1} style={heading.narrow ? look.titleNarrow : look.title}>
          Open from anywhere
        </Text>
      </View>
      <Text style={[look.subtitle, heading.narrow && look.centred]}>Press your shortcut in any app to bring up {network()?.name ?? "The One App"}.</Text>
    </View>
  )
  // The desktop, played again as the shortcut changes.
  const Picture = (size: { width: number; height: number }) => (
    <Panel width={size.width} height={size.height} bare>
      <Show when={`${plays()} ${keys()}`} keyed>
        <Desktop os={os()} keys={keys()} />
      </Show>
    </Panel>
  )
  const Control = () => <ShortcutControl onChanged={() => setPlays(plays() + 1)} />
  const Continue = () => (
    <Button shape={wide() ? undefined : "capsule"} onPress={props.onContinue} style={look.go}>
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
              <Heading narrow />
              <Picture width={inner} height={Math.round((inner * 3.4) / 4)} />
              <Control />
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
                  <Control />
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
