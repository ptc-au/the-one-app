// Connect your AI: the second step of onboarding, after Welcome, shown once per person unless an AI already uses the
// network as them (an assistant in their devices, or `one` in a terminal). Claude, ChatGPT or a coding agent, each
// with what to paste (the network's MCP address, or a prompt that points at its llms.txt), a Copy that says it
// copied, a way to open where it goes, and a picture of what to do there (assistants.tsx). It never blocks: Continue
// and Later both go on.
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Button, client, copy, defineVars, type Element, Icon, Image, open, Path, Pressable, safeArea, ScrollView, styles, Svg, Text, tokens, View } from "ui"
import { Agent, type Caption, ChatGPT, Claude, type Told } from "./assistants.tsx"
import { network as named } from "./welcome.tsx"

const own = defineVars({
  title: 24,
  titlePhone: 20,
  titleLeading: 28,
  titleLeadingPhone: 23,
  titleSpacing: -0.48,
  lead: 13.5,
  leadLeading: 18.25,
  mark: 34,
  markPhone: 28,
  rowTitle: 15,
  rowLeading: 19.5,
  rowSmall: 12.5,
  rowSmallLeading: 16.25,
  tile: 30,
  text: 13,
  textLeading: 18.2,
  code: 12.5,
  codeLeading: 17.5,
  caption: 12.5,
  captionDot: 19,
  gap: 14,
  lift: 4,
  dotText: 11,
  row: { default: "#0000000d", dark: "#ffffff14" },
  rowHover: { default: "#00000008", dark: "#ffffff0d" },
  claudeTile: "#f4efe6",
  gptTile: "#ffffff",
  agentTile: "#1c1c1e",
  captionFill: "#18181adb",
  captionDone: "#34c759",
})

const look = styles({
  screen: (width: number, height: number) => ({ width, height, alignItems: "center", justifyContent: "center" }),
  wide: (width: number) => ({ width, gap: tokens.grid[4] }),
  columns: (height: number) => ({ height, flexDirection: "row", gap: tokens.grid[5] }),
  side: (width: number) => ({ width, gap: tokens.grid[4], justifyContent: "space-between" }),
  phone: (width: number, paddingTop: number, paddingBottom: number) => ({ width, paddingTop, paddingBottom, paddingInline: tokens.grid[4], gap: own.gap, alignSelf: "center" }),
  scroll: (width: number, height: number) => ({ width, height }),
  brand: { gap: tokens.grid[1] },
  brandPhone: { gap: tokens.grid[1.5], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2.5] },
  mark: { width: own.mark, height: own.mark },
  markPhone: { width: own.markPhone, height: own.markPhone },
  title: { fontSize: own.title, fontWeight: 700, lineHeight: own.titleLeading, letterSpacing: own.titleSpacing, color: tokens.colour.label },
  titlePhone: { fontSize: own.titlePhone, fontWeight: 700, lineHeight: own.titleLeadingPhone, letterSpacing: own.titleSpacing, color: tokens.colour.label },
  lead: { fontSize: own.lead, lineHeight: own.leadLeading, color: tokens.colour.secondaryLabel },
  centred: { textAlign: "center" },
  rows: { gap: tokens.grid[0.5] },
  row: (borderRadius: number) => ({ borderRadius, overflow: "hidden" }),
  rowOn: { backgroundColor: own.row },
  head: (borderRadius: number) => ({ flexDirection: "row", alignItems: "center", gap: tokens.grid[3], paddingBlock: tokens.grid[2], paddingInline: tokens.grid[2.5], borderRadius, cursor: "pointer", backgroundColor: { default: tokens.colour.transparent, hover: own.rowHover } }),
  tile: (borderRadius: number) => ({ width: own.tile, height: own.tile, borderRadius, alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 0.5px #0000001f" }),
  claude: { backgroundColor: own.claudeTile },
  gpt: { backgroundColor: own.gptTile },
  agent: { backgroundColor: own.agentTile },
  logo: { width: tokens.grid[5], height: tokens.grid[5] },
  prompt: { width: tokens.grid[4], height: tokens.grid[4], color: own.gptTile },
  stroke: { fill: "none", stroke: "currentColor", strokeWidth: 1.6 },
  rowTitle: { fontSize: own.rowTitle, fontWeight: 600, lineHeight: own.rowLeading, color: tokens.colour.secondaryLabel },
  rowTitleOn: { color: tokens.colour.label },
  rowSmall: { fontSize: own.rowSmall, lineHeight: own.rowSmallLeading, color: tokens.colour.secondaryLabel },
  body: { paddingTop: tokens.grid[0.5], paddingBottom: tokens.grid[3], paddingInline: tokens.grid[2.5], gap: tokens.grid[2], alignItems: "flex-start", opacity: { default: 1, entering: 0 }, transitionProperty: ["opacity"], transition: tokens.motion.settle },
  copyBox: (borderRadius: number) => ({ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: tokens.grid[1.5], paddingBlock: tokens.grid[1], paddingStart: tokens.grid[2.5], paddingEnd: tokens.grid[1], borderRadius, backgroundColor: tokens.colour.background, borderWidth: tokens.length.hairline, borderColor: tokens.colour.quinaryLabel }),
  copyMulti: { flexDirection: "column", alignItems: "stretch", paddingBlock: tokens.grid[2], paddingInline: tokens.grid[2.5] },
  code: { flexGrow: 1, flexShrink: 1, fontFamily: tokens.font.mono, fontSize: own.code, lineHeight: own.codeLeading, fontWeight: 500, color: tokens.colour.label, whiteSpace: "nowrap" },
  codeMulti: { whiteSpace: "normal" },
  end: { alignSelf: "flex-end" },
  text: { fontSize: own.text, lineHeight: own.textLeading, color: tokens.colour.secondaryLabel },
  strong: { fontWeight: 600, color: tokens.colour.label },
  away: { width: tokens.grid[3], height: tokens.grid[3] },
  goes: { flexDirection: "row-reverse", gap: tokens.grid[2] },
  goesPhone: { gap: tokens.grid[1] },
  go: { flexGrow: 1 },
  stretch: { alignSelf: "stretch" },
  panel: (width: number, height: number, borderRadius: number) => ({ position: "relative", width, height, borderRadius, overflow: "hidden", color: tokens.colour.label, backgroundImage: "radial-gradient(120% 90% at 50% 100%, color-mix(in oklab, currentColor 7%, transparent), color-mix(in oklab, currentColor 3%, transparent))" }),
  stage: (start: number, top: number, width: number, height: number, scale: number) => ({ position: "absolute", start, top, width, height, scale }),
  scene: { position: "absolute", top: 0, start: 0, width: "100%", height: "100%", pointerEvents: "none" },
  shown: { animationName: { from: { opacity: 0 }, to: { opacity: 1 } }, animationDuration: 400, animationTimingFunction: "ease", animationFillMode: "both" },
  caption: { position: "absolute", bottom: tokens.grid[2.5], start: 0, end: 0, alignItems: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2], paddingBlock: tokens.grid[1], paddingStart: tokens.grid[1], paddingEnd: tokens.grid[3], borderRadius: tokens.radius.full, backgroundColor: own.captionFill, boxShadow: "0 4px 14px #0000002e", opacity: { default: 1, entering: 0 }, translateY: { default: 0, entering: own.lift }, transitionProperty: ["opacity", "translateY"], transition: tokens.motion.settle },
  dot: { width: own.captionDot, height: own.captionDot, borderRadius: tokens.radius.full, backgroundColor: own.gptTile, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: own.captionDone },
  dotText: { fontSize: own.dotText, fontWeight: 700, color: own.agentTile },
  tick: { color: own.gptTile },
  captionText: { fontSize: own.caption, fontWeight: 600, color: own.gptTile, whiteSpace: "nowrap" },
})

/// The art board the pictures are drawn on, and the part of it fitted to the room it has.
const BOARD = { width: 440, height: 330, fits: [432, 312], lift: 8 }
/// How round a row's corners are, the copy box's, a tile's and the picture's, as the mockup has them.
const ROUND = { row: 12, copy: 10, tile: 8, panel: 16 }

type Choice = "claude" | "gpt" | "agent"

/// The network's address, from its client, as its pages are reached.
const network = createMemo(() => client().then(({ network }) => network))

/// Connect your AI, in `width` by `height`, for the network Welcome names (its name and logo). `onContinue` goes on,
/// whether by Continue or Later.
export function ConnectAI(props: { width: number; height: number; onContinue: () => void }) {
  const [chosen, setChosen] = createSignal<Choice>("claude")
  const [runs, setRuns] = createSignal(1)
  const [copied, setCopied] = createSignal<string>()
  const [caption, setCaption] = createSignal<Caption>({ step: "1", text: "" })
  let unCopy: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(unCopy))
  const name = () => named().name
  const address = () => network() ?? ""
  const host = () => address().replace(/^[a-z]+:\/\//, "").split("/")[0]
  const mcp = () => `${address()}/mcp`
  const prompt = () => `Connect to my network at ${host()}: read ${address()}/llms.txt and do what it says.`
  // What the pictures are told, read as they draw, so the network's name or address coming in changes their words but
  // never starts them again.
  const told: Told = {
    get name() {
      return name()
    },
    get logo() {
      return named().light
    },
    get host() {
      return host()
    },
    get mcp() {
      return mcp()
    },
    caption: setCaption,
  }
  const choose = (choice: Choice) => (setChosen(choice), setRuns((run) => run + 1))
  const copyIt = (text: string) => copy(text).then(() => (setCopied(text), clearTimeout(unCopy), (unCopy = setTimeout(() => setCopied(), 1800))))
  const wide = () => props.width >= 600

  const Away = () => (
    <Svg viewBox="0 0 12 12" style={look.away}>
      <Path d="M4 2h6v6M10 2 2.5 9.5" style={look.stroke} />
    </Svg>
  )

  const Copy = (copying: { text: string; multi?: boolean }) => (
    <View style={[look.copyBox(ROUND.copy), copying.multi && look.copyMulti]}>
      <Text style={[look.code, copying.multi && look.codeMulti]}>{copying.text}</Text>
      <View style={copying.multi && look.end}>
        <Button onPress={() => copyIt(copying.text)}>
          <Icon name={copied() === copying.text ? "check" : "copy"} />
          {copied() === copying.text ? "Copied" : "Copy"}
        </Button>
      </View>
    </View>
  )

  const choices: { key: Choice; title: string; small: string; tile: typeof look.claude; logo: () => Element; body: () => Element }[] = [
    {
      key: "claude",
      title: "Claude",
      small: "Add it as a connector",
      tile: look.claude,
      logo: () => <Image src="claude.svg" alt="" style={look.logo} />,
      body: () => (
        <>
          <Copy text={mcp()} />
          <Text style={look.text}>
            Paste it in <Text style={look.strong}>Customize › Connectors › Add custom connector</Text>, then Connect.
          </Text>
          <Button variant="outline" onPress={() => open("https://claude.ai/customize/connectors")}>
            Open Claude
            <Away />
          </Button>
        </>
      ),
    },
    {
      key: "gpt",
      title: "ChatGPT",
      small: "Add it as a connector",
      tile: look.gpt,
      logo: () => <Image src="chatgpt.svg" alt="" style={look.logo} />,
      body: () => (
        <>
          <Copy text={mcp()} />
          <Text style={look.text}>
            In <Text style={look.strong}>Plugins</Text>, choose <Text style={look.strong}>+ › Add custom MCP server</Text>, paste it, then <Text style={look.strong}>Create as a plugin</Text>.
          </Text>
          <Button variant="outline" onPress={() => open("https://chatgpt.com/plugins")}>
            Open ChatGPT
            <Away />
          </Button>
        </>
      ),
    },
    {
      key: "agent",
      title: "Coding agent",
      small: "Claude Code, Cursor, Codex, OpenCode",
      tile: look.agent,
      logo: () => (
        <Svg viewBox="0 0 16 16" style={look.prompt}>
          <Path d="m3 4.5 3.5 3.5L3 11.5M8.5 12h5" style={look.stroke} />
        </Svg>
      ),
      body: () => (
        <>
          <Copy text={prompt()} multi />
          <Text style={look.text}>Paste it into your agent. It does the rest.</Text>
        </>
      ),
    },
  ]

  const Mark = (mark: { phone?: boolean }) => (
    <View style={mark.phone ? look.brandPhone : look.brand}>
      <View style={look.titleRow}>
        <Image src={named().light} srcDark={named().dark} alt="" style={mark.phone ? look.markPhone : look.mark} />
        <Text role="heading" aria-level={1} style={mark.phone ? look.titlePhone : look.title}>
          Connect your AI
        </Text>
      </View>
      <Text style={[look.lead, mark.phone && look.centred]}>Use {name()} from the AI you already use.</Text>
    </View>
  )

  const Rows = () => (
    <View style={look.rows}>
      <For each={choices}>
        {(choice) => (
          <View style={[look.row(ROUND.row), chosen() === choice.key && look.rowOn]}>
            <Pressable role="button" aria-label={choice.title} aria-expanded={chosen() === choice.key ? "true" : "false"} onPress={() => choose(choice.key)} style={look.head(ROUND.row)}>
              <View style={[look.tile(ROUND.tile), choice.tile]}>{choice.logo()}</View>
              <View>
                <Text style={[look.rowTitle, chosen() === choice.key && look.rowTitleOn]}>{choice.title}</Text>
                <Text style={look.rowSmall}>{choice.small}</Text>
              </View>
            </Pressable>
            <Show when={chosen() === choice.key}>
              <View style={look.body}>{choice.body()}</View>
            </Show>
          </View>
        )}
      </For>
    </View>
  )

  // The art board, centred in the picture's room (a little above the middle, clear of its caption) and grown to fill it.
  const Panel = (size: { width: number; height: number }) => {
    const scale = () => Math.min(size.width / BOARD.fits[0], size.height / BOARD.fits[1])
    return (
      <View style={look.panel(size.width, size.height, ROUND.panel)}>
        <View aria-hidden="true" style={look.stage((size.width - BOARD.width) / 2, (size.height - BOARD.height) / 2 - BOARD.lift * scale(), BOARD.width, BOARD.height, scale())}>
          <Show when={`${chosen()} ${runs()}`} keyed>
            <View style={[look.scene, look.shown]}>
              {chosen() === "claude" ? <Claude told={told} /> : chosen() === "gpt" ? <ChatGPT told={told} /> : <Agent told={told} prompt={prompt()} />}
            </View>
          </Show>
        </View>
        <View style={look.caption}>
          <Show when={caption().text ? caption() : undefined} keyed>
            {(now) => (
              <View style={look.pill}>
                <View style={[look.dot, now.step === "✓" && look.dotDone]}>
                  <Show when={now.step === "✓"} fallback={<Text style={look.dotText}>{now.step}</Text>}>
                    <View style={look.tick}>
                      <Icon name="check" />
                    </View>
                  </Show>
                </View>
                <Text style={look.captionText}>{now.text}</Text>
              </View>
            )}
          </Show>
        </View>
      </View>
    )
  }

  const Goes = (goes: { phone?: boolean }) => (
    <View style={goes.phone ? look.goesPhone : look.goes}>
      <Button shape={goes.phone ? "capsule" : undefined} onPress={props.onContinue} style={goes.phone ? look.stretch : look.go}>
        Continue
      </Button>
      <Button variant="ghost" onPress={props.onContinue} style={goes.phone ? look.stretch : undefined}>
        Later
      </Button>
    </View>
  )

  return (
    <View style={look.screen(props.width, props.height)}>
      <Show
        when={wide()}
        fallback={(() => {
          const width = Math.min(props.width, 480)
          const inner = width - 32
          return (
            // Taller than a phone's window with a choice open, it scrolls, as an iPhone's screen does.
            <ScrollView style={look.scroll(props.width, props.height)}>
              <View style={look.phone(width, safeArea().top + 20, safeArea().bottom + 16)}>
                <Mark phone />
                <Panel width={inner} height={Math.round((inner * 3.4) / 4)} />
                <Rows />
                <Goes phone />
              </View>
            </ScrollView>
          )
        })()}
      >
        {(() => {
          const width = Math.min(props.width - 48, 960)
          const height = Math.min(props.height - 48 - 70, Math.max(330, Math.round(width * 0.42)))
          const side = Math.round(((width - 20) * 1) / 2.2)
          return (
            <View style={look.wide(width)}>
              <Mark />
              <View style={look.columns(height)}>
                <View style={look.side(side)}>
                  <Rows />
                  <Goes />
                </View>
                <Panel width={width - 20 - side} height={height} />
              </View>
            </View>
          )
        })()}
      </Show>
    </View>
  )
}
