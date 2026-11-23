// Welcome: the first step of onboarding, shown once per person, on whichever device they open first after signing
// in, before their Home Screen (the tip `welcome`, kept with their pages), where their device's renderer draws it. Their network's logo and name, then four things it
// does, each with a picture that plays as it's shown (slides.tsx), going on to the next every 6.5 s until one is
// chosen, which stays. On a computer the four are rows beside a large picture, the one shown with its line and a line
// filling under it as it plays; on a phone, the one shown is over the picture, with a dot for each under it. Continue
// goes on to onboarding's next step for this device (home.tsx), or the Home Screen.
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Button, call, defineVars, type Element, Image, Pressable, safeArea, styles, Text, tokens, View } from "ui"
import { Panel } from "./art.tsx"
import { Automate, Devices, Multiplayer, Secure } from "./slides.tsx"

/// What a row and its picture say, in order, as Andre wrote them.
const items: { title: string; text: string; picture: () => Element }[] = [
  { title: "Create your own apps", text: "Performant, secure, and on all your devices.", picture: Devices },
  { title: "Automate anything", text: "Connect APIs and apps, even ones without an API.", picture: Automate },
  { title: "Secure", text: "Encrypted passwords and data only you can open.", picture: Secure },
  { title: "Multiplayer", text: "Collaborate on apps, automations, and data with others.", picture: Multiplayer },
]

/// How long each is shown before the next, as the mockup plays them.
const CYCLE = 6500
/// How round a row's corners are, as the mockup has them: the window's radius, 10, and 2 more.
const ROUND = { row: 12 }

const own = defineVars({
  title: 24,
  titlePhone: 20,
  rowTitle: 14.5,
  rowText: 12.5,
  heading: 16,
  headingText: 13,
  mark: 40,
  markPhone: 32,
  dot: 7,
  dotOn: 20,
  headingMin: 54,
  titleLeading: 28,
  titleLeadingPhone: 23,
  titleSpacing: -0.48,
  titleSpacingPhone: -0.4,
  rowPad: 9,
  rowsGap: 2,
  rowLeading: 19.5,
  textLeading: 17.25,
  textTop: 3,
  textBottom: 2,
  line: 2,
  phoneGap: 14,
  headingGap: 3,
  headingLeading: 20,
  headingTextLeading: 17.5,
  row: { default: "#0000000d", dark: "#ffffff14" },
  // A page dot not shown stands off the page at 3:1, as a control's mark must, where the mockup's 22% didn't.
  dotOff: { default: "#00000080", dark: "#ffffff80" },
  rowHover: { default: "#00000008", dark: "#ffffff0d" },
})

const look = styles({
  screen: (width: number, height: number) => ({ width, height, alignItems: "center", justifyContent: "center" }),
  wide: (width: number, height: number) => ({ width, height, flexDirection: "row", gap: tokens.grid[5] }),
  side: (width: number) => ({ width, flexDirection: "column", gap: tokens.grid[4] }),
  brand: { flexDirection: "column", alignItems: "flex-start", gap: tokens.grid[2], paddingTop: tokens.grid[0.5] },
  brandPhone: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: tokens.grid[2.5] },
  mark: { width: own.mark, height: own.mark },
  markPhone: { width: own.markPhone, height: own.markPhone },
  title: { fontSize: own.title, fontWeight: 700, lineHeight: own.titleLeading, letterSpacing: own.titleSpacing, color: tokens.colour.label },
  titlePhone: { fontSize: own.titlePhone, fontWeight: 700, lineHeight: own.titleLeadingPhone, letterSpacing: own.titleSpacingPhone, color: tokens.colour.label },
  rows: { flexGrow: 1, flexDirection: "column", gap: own.rowsGap },
  row: (borderRadius: number) => ({ position: "relative", paddingBlock: own.rowPad, paddingInline: tokens.grid[3], borderRadius, overflow: "hidden", cursor: "pointer", backgroundColor: { default: tokens.colour.transparent, hover: own.rowHover } }),
  rowOn: { backgroundColor: own.row },
  rowTitle: { fontSize: own.rowTitle, fontWeight: 600, lineHeight: own.rowLeading, color: tokens.colour.secondaryLabel },
  rowTitleOn: { color: tokens.colour.label },
  rowText: { fontSize: own.rowText, lineHeight: own.textLeading, color: tokens.colour.secondaryLabel, paddingTop: own.textTop, paddingBottom: own.textBottom, opacity: { default: 1, entering: 0 }, transitionProperty: ["opacity"], transition: tokens.motion.settle },
  line: { position: "absolute", start: tokens.grid[3], end: tokens.grid[3], bottom: 0, height: own.line, borderRadius: tokens.radius.full, overflow: "hidden" },
  filling: { height: "100%", backgroundColor: tokens.colour.tertiaryLabel, animationName: { from: { width: "0%" }, to: { width: "100%" } }, animationDuration: 6500, animationTimingFunction: "linear", animationFillMode: "forwards" },
  scene: { position: "absolute", top: 0, start: 0, width: "100%", height: "100%", pointerEvents: "none" },
  shown: { animationName: { from: { opacity: 0 }, to: { opacity: 1 } }, animationDuration: 450, animationTimingFunction: "ease", animationFillMode: "both" },
  gone: { animationName: { from: { opacity: 1 }, to: { opacity: 0 } }, animationDuration: 450, animationTimingFunction: "ease", animationFillMode: "both" },
  unseen: { opacity: 0 },
  phone: (width: number, paddingTop: number, paddingBottom: number) => ({ width, paddingTop, paddingBottom, paddingInline: tokens.grid[4], flexDirection: "column", gap: own.phoneGap }),
  heading: { minHeight: own.headingMin, alignItems: "center", justifyContent: "center", gap: own.headingGap, paddingInline: tokens.grid[1] },
  headingTitle: { fontSize: own.heading, fontWeight: 650, lineHeight: own.headingLeading, color: tokens.colour.label, textAlign: "center" },
  headingText: { fontSize: own.headingText, lineHeight: own.headingTextLeading, color: tokens.colour.secondaryLabel, textAlign: "center" },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: tokens.grid[2], paddingBlock: tokens.grid[0.5] },
  dot: { width: own.dot, height: own.dot, borderRadius: tokens.radius.full, backgroundColor: own.dotOff, transitionProperty: ["width", "backgroundColor"], transition: tokens.motion.settle, cursor: "pointer" },
  dotOn: { width: own.dotOn, backgroundColor: tokens.colour.label },
  go: { alignSelf: "stretch" },
})

/// The network as Welcome shows it: its name ("the PTC App") and its logo, light and dark, as data where it has one
/// of its own, which a native window draws (only an app's own files load there), or else the One App's.
export const network = createMemo(() =>
  call("sign-in_network").then(
    (answer) => {
      const { name, mark } = JSON.parse(answer) as { name?: string | null; mark?: { light?: string; dark?: string } | null }
      return { name: name ?? "the One App", light: mark?.light ?? "one-app.png", dark: mark?.dark ?? "one-app.png" }
    },
    () => ({ name: "the One App", light: "one-app.png", dark: "one-app.png" }),
  ),
)

/// Welcome, in `width` by `height`, with `inset` kept clear at its top and bottom (a phone's status bar and home
/// indicator). `onContinue` goes on. `progress` is where it is among onboarding's steps, over its title where it's narrow.
export function Welcome(props: { width: number; height: number; onContinue: () => void; progress?: Element }) {
  const [shown, setShown] = createSignal(0)
  // How many times each has been shown, so it plays again from its start each time it is.
  const [runs, setRuns] = createSignal([1, 0, 0, 0])
  const [was, setWas] = createSignal<number>()
  const [held, setHeld] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const show = (index: number) => {
    if (index !== shown()) setWas(shown())
    setShown(index)
    setRuns((runs) => runs.map((run, at) => (at === index ? run + 1 : run)))
    clearTimeout(timer)
    if (!held()) timer = setTimeout(() => show((index + 1) % items.length), CYCLE)
  }
  timer = setTimeout(() => show(1), CYCLE)
  onCleanup(() => clearTimeout(timer))
  // Chosen, it stays, as the mockup's rows and dots do.
  const choose = (index: number) => (setHeld(true), show(index))

  const wide = () => props.width >= 600

  const Mark = (mark: { phone?: boolean }) => (
    <View style={mark.phone ? look.brandPhone : look.brand}>
      <Image src={network().light} srcDark={network().dark} alt="" style={mark.phone ? look.markPhone : look.mark} />
      <Text role="heading" aria-level={1} style={mark.phone ? look.titlePhone : look.title}>
        {network().name}
      </Text>
    </View>
  )

  // The four pictures, the one shown faded in over the one before.
  const Pictures = (size: { width: number; height: number }) => (
    <Panel width={size.width} height={size.height}>
      <For each={items}>
        {(item, index) => (
          <View style={[look.scene, shown() === index() ? look.shown : was() === index() ? look.gone : look.unseen]}>
            <Show when={runs()[index()]} keyed>
              {item.picture()}
            </Show>
          </View>
        )}
      </For>
    </Panel>
  )

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
            <View style={look.phone(width, safeArea().top + 20, safeArea().bottom + 18)}>
              {props.progress}
              <Mark phone />
              <View style={look.heading}>
                <Text style={look.headingTitle}>{items[shown()].title}</Text>
                <Text style={look.headingText}>{items[shown()].text}</Text>
              </View>
              <Pictures width={inner} height={Math.round((inner * 3.15) / 4)} />
              <View role="tablist" aria-label="Highlights" style={look.dots}>
                <For each={items}>{(item, index) => <Pressable role="tab" aria-label={item.title} aria-selected={shown() === index() ? "true" : "false"} onPress={() => choose(index())} style={[look.dot, shown() === index() && look.dotOn]} />}</For>
              </View>
              <Continue />
            </View>
          )
        })()}
      >
        {(() => {
          const width = Math.min(props.width - 48, 960)
          // As wide and short as the mockup's: its picture about 1.6 times as wide as it's tall, never under 360.
          const height = Math.min(props.height - 48, Math.max(360, Math.round(width * 0.41)))
          const side = Math.max(195, ((width - 20) * 0.82) / 2.5)
          return (
            <View style={look.wide(width, height)}>
              <View style={look.side(side)}>
                <Mark />
                <View role="tablist" aria-label="Highlights" style={look.rows}>
                  <For each={items}>
                    {(item, index) => (
                      <Pressable role="tab" aria-selected={shown() === index() ? "true" : "false"} onPress={() => choose(index())} style={[look.row(ROUND.row), shown() === index() && look.rowOn]} layout>
                        <Text style={[look.rowTitle, shown() === index() && look.rowTitleOn]}>{item.title}</Text>
                        <Show when={shown() === index()}>
                          <Text style={look.rowText}>{item.text}</Text>
                          <Show when={!held() && runs()[index()]} keyed>
                            <View style={look.line}>
                              <View style={look.filling} />
                            </View>
                          </Show>
                        </Show>
                      </Pressable>
                    )}
                  </For>
                </View>
                <Continue />
              </View>
              <Pictures width={width - 20 - side} height={height} />
            </View>
          )
        })()}
      </Show>
    </View>
  )
}
