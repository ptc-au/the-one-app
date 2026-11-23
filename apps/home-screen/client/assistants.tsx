// Connect your AI's pictures, on the art board (art.tsx): what to do in Claude, in ChatGPT and in a coding agent to
// let it use the network, played step by step, as a person's hand does it, then again. Their words are each one's
// own today (their help pages, 23 Nov 2026): Claude's Customize › Connectors › + Add › Add custom connector, then
// Connect; ChatGPT's Plugins › + › Add custom MCP server, then Create as a plugin; then the network's own Sign in, and
// "<AI> wants to use your network" with Allow, as its sign-in page says them.
import { createSignal, For, onCleanup, Show } from "solid-js"
import { type Element, reducedMotion } from "ui"
import { Box, circle, type Part, Picture, Pointer, rect, Run, Shape, Words } from "./art.tsx"

/// What a picture says it's showing: the step's number (or done) and what it is.
export type Caption = { step: string; text: string }

/// What every picture is told: the network's name ("the PTC App"), its logo, its host and its MCP address, and where
/// to say each step.
export type Told = { name: string; logo: string; host: string; mcp: string; caption: (caption: Caption) => void }

/// Runs `play` from its start, then again after a pause, until the picture's gone: each step waits on the screen's
/// clock (`wait`), and one gone stops at its next. With less motion each step comes at once and it plays once.
function looping(reset: () => void, play: (wait: (ms: number) => Promise<void>) => Promise<void>) {
  let live = true
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const wait = (ms: number) =>
    new Promise<void>((done, stop) => {
      const timer = setTimeout(() => (timers.delete(timer), live ? done() : stop()), reducedMotion() ? 0 : ms)
      timers.add(timer)
    })
  void (async () => {
    try {
      for (;;) {
        reset()
        await wait(30)
        await play(wait)
        if (reducedMotion()) return
        await wait(2800)
      }
    } catch {
      // Gone: it stops.
    }
  })()
  onCleanup(() => ((live = false), timers.forEach(clearTimeout)))
}

/// A pointer that glides to a place, presses there, and lets go; and text typed into a field a letter at a time.
function hand() {
  const [at, setAt] = createSignal<[number, number]>([400, 300])
  const [down, setDown] = createSignal(false)
  return {
    at,
    down,
    reset: () => (setAt([400, 300]), setDown(false)),
    async to(wait: (ms: number) => Promise<void>, x: number, y: number, ms = 600) {
      setAt([x, y])
      await wait(ms)
    },
    async press(wait: (ms: number) => Promise<void>) {
      setDown(true)
      await wait(170)
      setDown(false)
      await wait(110)
    },
  }
}

async function typed(wait: (ms: number) => Promise<void>, text: string, set: (text: string) => void) {
  for (let at = 1; at <= text.length; at++) {
    set(text.slice(0, at))
    await wait(42)
  }
}

/// A Mac's window: its traffic lights and an address bar, `address` in it, its host dark and its path dim.
function Window(props: { x: number; y: number; w: number; h: number; host: string; path?: string; fill: `#${string}`; bar?: number; children?: Element }) {
  const bar = () => props.bar ?? 24
  return (
    <Box x={props.x} y={props.y} w={props.w} h={props.h} r={10} clip fill={props.fill} shadow="0 14px 40px #00000029, 0 0 0 0.5px #00000029">
      <Box h={bar()} row gap={4} pad={[0, 9]} fill="#ececee" lines={[0, 0.5, "#d6d6da"]}>
        <Box w={7} h={7} r={3.5} fill="#ff5f57" />
        <Box w={7} h={7} r={3.5} fill="#febc2e" />
        <Box w={7} h={7} r={3.5} fill="#28c840" />
        <Box grow={1} row middle>
          <Box w={bar() > 20 ? 210 : 110} h={bar() > 20 ? 15 : 11} r={99} fill="#ffffff" row middle gap={4}>
            <Shape w={6} h={7} viewBox="0 0 10 12" parts={[{ d: rect(1, 5, 8, 7, 1.5), fill: "#8e8e93" }, { d: "M3 5V3.5a2 2 0 0 1 4 0V5", stroke: "#8e8e93", width: 1.3 }]} />
            <Words size={bar() > 20 ? 7 : 6.4} ink="#3c3c43">
              {props.host}
              {props.path && <Run ink="#8e8e93">{props.path}</Run>}
            </Words>
          </Box>
        </Box>
        <Box w={29} />
      </Box>
      {props.children}
    </Box>
  )
}

/// The network's own sign-in, as its page draws it, in a window over the AI's: its logo, then Sign in, then the AI
/// asking to use the network, with Cancel and Allow.
function SignIn(props: { told: Told; ai: string; asking: boolean; pressed: "sign" | "allow" | undefined }) {
  return (
    <Box x={127} y={52} w={186} r={10} clip fill="#ffffff" shadow="0 18px 50px #00000047, 0 0 0 0.5px #0000001a" z={8} shows>
      <Window x={0} y={0} w={186} h={17} bar={17} host={props.told.host} fill="#ffffff" />
      <Box pad={[30, 14, 13, 14]} middle gap={3}>
        <Picture src={props.told.logo} w={30} h={30} r={8} m={[0, 0, 5, 0]} />
        <Show
          when={props.asking}
          fallback={
            <>
              <Words size={9.6} weight={700} centred>Sign in</Words>
              <Box h={22} w={158} r={99} fill="#111111" middle m={[10, 0, 0, 0]} zoom={props.pressed === "sign" ? 0.92 : 1}>
                <Words size={7.6} weight={600} ink="#ffffff">Sign in</Words>
              </Box>
            </>
          }
        >
          <Words size={9.6} weight={700} centred>{`${props.ai} wants to use your network`}</Words>
          <Words size={7} ink="#6e6e73" centred>{`It acts as you in ${props.told.name}.`}</Words>
          <Box row gap={6} m={[8, 0, 0, 0]}>
            <Box w={76} h={22} r={99} fill="#e9e9ee" middle>
              <Words size={7.6} weight={600}>Cancel</Words>
            </Box>
            <Box w={76} h={22} r={99} fill="#111111" middle zoom={props.pressed === "allow" ? 0.92 : 1}>
              <Words size={7.6} weight={600} ink="#ffffff">Allow</Words>
            </Box>
          </Box>
        </Show>
      </Box>
    </Box>
  )
}

/// The network's logo, small, as a list's row shows an app's.
const Mark = (props: { size: number; logo: string }) => <Picture src={props.logo} w={props.size} h={props.size} r={3.5} />

/// Connected, in green with a tick, as a connector that's connected says.
const Connected = () => (
  <Box row gap={3} m={[0, 0, 0, "auto"]}>
    <Box w={9} h={9} r={4.5} fill="#1e8e3e" middle>
      <Shape w={6} h={6} viewBox="0 0 24 24" parts={[{ d: "m5 12.5 4.5 4.5L19 7.5", stroke: "#ffffff", width: 4 }]} />
    </Box>
    <Words size={6.8} weight={600} ink="#1e8e3e">Connected</Words>
  </Box>
)

/// A field of a form, its placeholder grey until something's typed in it, ringed while it's typed in, and flashed
/// as what's pasted lands.
const Field = (props: { placeholder: string; text: string; focus: boolean; w?: number; m?: number }) => (
  <Box h={20} w={props.w} r={6} pad={[0, 7]} row fill="#ffffff" border={[1, props.focus ? "#6a8fe0" : "#dedcd2"]} shadow={props.focus ? "0 0 0 2px #6a8fe038" : "0 0 0 0 #6a8fe000"} m={[0, 0, props.m ?? 6, 0]} clip>
    <Words size={7.4} ink={props.text ? "#1d1d1f" : "#a3a29b"}>{props.text || props.placeholder}</Words>
  </Box>
)

/// ⌘V, shown by the field as what's copied is pasted.
const Paste = (props: { x: number; y: number }) => (
  <Box x={props.x} y={props.y} pad={[2, 5]} r={4} fill="#1d1d1f" shadow="0 2px 6px #0000004d" z={19} shows>
    <Words size={7.5} weight={600} ink="#ffffff">⌘V</Words>
  </Box>
)

const drive: Part[] = [
  { d: "m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z", fill: "#0066da" },
  { d: "m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z", fill: "#00ac47" },
  { d: "m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z", fill: "#ea4335" },
  { d: "m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z", fill: "#00832d" },
  { d: "m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z", fill: "#2684fc" },
  { d: "m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z", fill: "#ffba00" },
]
const gmail: Part[] = [
  { d: "M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6", fill: "#4285f4" },
  { d: "M120 108h14c3.32 0 6-2.69 6-6V59l-20 15", fill: "#34a853" },
  { d: "M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2", fill: "#fbbc04" },
  { d: "M72 74V48l24 18 24-18v26L96 92", fill: "#ea4335" },
  { d: "M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2", fill: "#c5221f" },
]
const github: Part[] = [
  {
    d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z",
    fill: "#1f2328",
  },
]

/// The apps already in a list of connectors, each by its logo and name.
const others: [Part[], string, string][] = [
  [drive, "0 0 87.3 78", "Google Drive"],
  [gmail, "52 42 88 66", "Gmail"],
  [github, "0 0 16 16", "GitHub"],
]

/// Claude: Customize › Connectors, + Add › Add custom connector, its name and the address pasted, Add; then Connect
/// on its row, Sign in and Allow, and it's Connected.
export function Claude(props: { told: Told }) {
  const pointer = hand()
  const [menu, setMenu] = createSignal(false)
  const [dialog, setDialog] = createSignal(false)
  const [name, setName] = createSignal("")
  const [address, setAddress] = createSignal("")
  const [focus, setFocus] = createSignal<"name" | "address">()
  const [pasting, setPasting] = createSignal(false)
  const [added, setAdded] = createSignal(false)
  const [signing, setSigning] = createSignal<"sign" | "ask">()
  const [pressed, setPressed] = createSignal<"add" | "item" | "ok" | "connect" | "sign" | "allow">()
  const [connected, setConnected] = createSignal(false)
  const press = async (wait: (ms: number) => Promise<void>, what: NonNullable<ReturnType<typeof pressed>>) => (setPressed(what), await pointer.press(wait), setPressed())
  looping(
    () => (pointer.reset(), setMenu(false), setDialog(false), setName(""), setAddress(""), setFocus(), setPasting(false), setAdded(false), setSigning(), setConnected(false)),
    async (wait) => {
      props.told.caption({ step: "1", text: "Customize › Connectors" })
      await wait(500)
      await pointer.to(wait, 390, 58, 800)
      await press(wait, "add")
      setMenu(true)
      await wait(300)
      await pointer.to(wait, 360, 80, 400)
      await press(wait, "item")
      setMenu(false)
      setDialog(true)
      props.told.caption({ step: "2", text: "Add custom connector, paste the link" })
      await wait(450)
      await pointer.to(wait, 200, 118, 450)
      setFocus("name")
      await typed(wait, props.told.name, setName)
      await pointer.to(wait, 200, 143, 400)
      setFocus("address")
      setPasting(true)
      await wait(380)
      setAddress(props.told.mcp)
      await wait(400)
      setPasting(false)
      await pointer.to(wait, 300, 182, 500)
      await press(wait, "ok")
      setDialog(false)
      setFocus()
      setAdded(true)
      props.told.caption({ step: "3", text: "Connect, then sign in and Allow" })
      await wait(500)
      await pointer.to(wait, 385, 99, 600)
      await press(wait, "connect")
      setSigning("sign")
      await wait(500)
      await pointer.to(wait, 225, 135, 600)
      await press(wait, "sign")
      setSigning("ask")
      await wait(500)
      await pointer.to(wait, 265, 148, 500)
      await press(wait, "allow")
      await wait(300)
      setSigning()
      setConnected(true)
      props.told.caption({ step: "✓", text: `Claude can use ${props.told.name}` })
      await wait(400)
    },
  )
  return (
    <>
      <Window x={12} y={10} w={416} h={290} host="claude.ai" path="/customize/connectors" fill="#faf9f5">
        <Box row h={266}>
          <Box w={100} h="100%" pad={[13, 8]}>
            <Words size={12} ink="#1f1e1d" m={[0, 0, 10, 6]}>Customize</Words>
            <Box pad={[4, 6]} r={5} fill="#ebe8df" m={[0, 0, 1, 0]}>
              <Words size={7.4} weight={600} ink="#1f1e1d">Connectors</Words>
            </Box>
            <Box pad={[4, 6]}>
              <Words size={7.4} ink="#5c5a52">Skills</Words>
            </Box>
          </Box>
          <Box grow={1} h="100%" pad={[14, 18, 0, 8]}>
            <Box row between>
              <Box>
                <Words size={10.5} weight={600} ink="#1f1e1d">Connectors</Words>
                <Words size={6.8} ink="#73726c" m={[2, 0, 9, 0]}>Let Claude use your apps and data.</Words>
              </Box>
              <Box row gap={4} pad={[5, 9]} r={6} border={[0.5, "#cfccc1"]} fill="#ffffff" zoom={pressed() === "add" ? 0.92 : 1}>
                <Shape w={8} h={8} viewBox="0 0 10 10" parts={[{ d: "M5 1v8M1 5h8", stroke: "#1f1e1d", width: 1.4 }]} />
                <Words size={7.4} weight={600} ink="#1f1e1d">Add</Words>
              </Box>
            </Box>
            <Box r={8} clip border={[0.5, "#e3e0d6"]} fill="#ffffff">
              <Show when={added()}>
                <Box h={27} row gap={7} pad={[0, 9]} fill={connected() ? "#e6f4ea" : "#ffffff"} shows>
                  <Mark size={14} logo={props.told.logo} />
                  <Words size={7.6}>{props.told.name}</Words>
                  <Box pad={[1, 3]} r={3} fill="#efefef">
                    <Words size={5.6} weight={600} ink="#6e6e73" spacing={0.2}>CUSTOM</Words>
                  </Box>
                  <Show when={connected()} fallback={<Box m={[0, 0, 0, "auto"]} pad={[3, 7]} r={5} border={[0.5, "#d9d6cb"]} zoom={pressed() === "connect" ? 0.92 : 1}><Words size={6.6} weight={500} ink="#3d3929">Connect</Words></Box>}>
                    <Connected />
                  </Show>
                </Box>
              </Show>
              <For each={others}>
                {([mark, box, label]) => (
                  <Box h={27} row gap={7} pad={[0, 9]} lines={[0.5, 0, "#efede6"]}>
                    <Box w={14} h={14} middle>
                      <Shape w={12} h={11} viewBox={box} parts={mark} />
                    </Box>
                    <Words size={7.6}>{label}</Words>
                    <Box m={[0, 0, 0, "auto"]} pad={[3, 7]} r={5} border={[0.5, "#d9d6cb"]}>
                      <Words size={6.6} weight={500} ink="#3d3929">Connect</Words>
                    </Box>
                  </Box>
                )}
              </For>
            </Box>
          </Box>
        </Box>
        <Show when={menu()}>
          <Box x={300} y={68} w={110} pad={4} r={7} fill="#ffffff" shadow="0 8px 24px #00000033, 0 0 0 0.5px #0000001f" shows>
            <Box pad={[5, 7]} r={5} fill={pressed() === "item" ? "#ebe8df" : "#f4f2ec"}>
              <Words size={7.4} weight={500} ink="#1f1e1d">Add custom connector</Words>
            </Box>
            <Box pad={[5, 7]}>
              <Words size={7.4} ink="#5c5a52">Browse connectors</Words>
            </Box>
          </Box>
        </Show>
        <Show when={dialog() || signing()}>
          <Box x={0} y={24} right={0} bottom={0} fill="#1c1a144d" shows />
        </Show>
        <Show when={dialog()}>
          <Box x={97} y={62} w={222} pad={[13, 13, 12, 13]} r={12} fill="#ffffff" shadow="0 18px 50px #00000047, 0 0 0 0.5px #0000001a" z={5} shows>
            <Box row gap={4}>
              <Words size={11.5} ink="#1f1e1d">Add custom connector</Words>
              <Box pad={[1, 3]} r={3} fill="#e8eefc">
                <Words size={5.6} weight={600} ink="#2b59c3" spacing={0.2}>BETA</Words>
              </Box>
            </Box>
            <Words size={6.8} ink="#73726c" m={[3, 0, 9, 0]}>Connect Claude to your data and tools.</Words>
            <Field placeholder="Name" text={name()} focus={focus() === "name"} />
            <Field placeholder="Remote MCP server URL" text={address()} focus={focus() === "address"} />
            <Words size={6.6} ink="#73726c">Advanced settings ›</Words>
            <Box row gap={5} m={[10, 0, 0, 0]}>
              <Box grow={1} />
              <Box pad={[4, 11]} r={6} border={[0.5, "#d9d6cb"]}>
                <Words size={7.4} weight={600} ink="#3d3929">Cancel</Words>
              </Box>
              <Box pad={[4, 11]} r={6} fill="#1f1e1d" zoom={pressed() === "ok" ? 0.92 : 1}>
                <Words size={7.4} weight={600} ink="#ffffff">Add</Words>
              </Box>
            </Box>
          </Box>
        </Show>
      </Window>
      <Show when={pasting()}>
        <Paste x={240} y={128} />
      </Show>
      <Show when={signing()}>
        <SignIn told={props.told} ai="Claude" asking={signing() === "ask"} pressed={pressed() === "sign" ? "sign" : pressed() === "allow" ? "allow" : undefined} />
      </Show>
      <Pointer x={0} y={0} shift={pointer.at()} zoom={pointer.down() ? 0.82 : 1} />
    </>
  )
}

/// ChatGPT: Plugins, + › Add custom MCP server, its name and the address pasted, OAuth, I understand, Create as a
/// plugin; then Sign in and Allow, and it's Connected.
export function ChatGPT(props: { told: Told }) {
  const pointer = hand()
  const [menu, setMenu] = createSignal(false)
  const [dialog, setDialog] = createSignal(false)
  const [name, setName] = createSignal("")
  const [address, setAddress] = createSignal("")
  const [focus, setFocus] = createSignal<"name" | "address">()
  const [pasting, setPasting] = createSignal(false)
  const [understood, setUnderstood] = createSignal(false)
  const [added, setAdded] = createSignal(false)
  const [signing, setSigning] = createSignal<"sign" | "ask">()
  const [pressed, setPressed] = createSignal<"plus" | "item" | "box" | "ok" | "sign" | "allow">()
  const [connected, setConnected] = createSignal(false)
  const press = async (wait: (ms: number) => Promise<void>, what: NonNullable<ReturnType<typeof pressed>>) => (setPressed(what), await pointer.press(wait), setPressed())
  looping(
    () => (pointer.reset(), setMenu(false), setDialog(false), setName(""), setAddress(""), setFocus(), setPasting(false), setUnderstood(false), setAdded(false), setSigning(), setConnected(false)),
    async (wait) => {
      props.told.caption({ step: "1", text: "Plugins › + › Add custom MCP server" })
      await wait(500)
      await pointer.to(wait, 398, 52, 800)
      await press(wait, "plus")
      setMenu(true)
      await wait(300)
      await pointer.to(wait, 360, 74, 400)
      await press(wait, "item")
      setMenu(false)
      setDialog(true)
      props.told.caption({ step: "2", text: "Paste the link, then Create as a plugin" })
      await wait(450)
      await pointer.to(wait, 200, 82, 400)
      setFocus("name")
      await typed(wait, props.told.name, setName)
      await pointer.to(wait, 200, 148, 400)
      setFocus("address")
      setPasting(true)
      await wait(380)
      setAddress(props.told.mcp)
      await wait(400)
      setPasting(false)
      setFocus()
      await pointer.to(wait, 118, 213, 450)
      await press(wait, "box")
      setUnderstood(true)
      await pointer.to(wait, 295, 238, 450)
      await press(wait, "ok")
      setDialog(false)
      setAdded(true)
      props.told.caption({ step: "3", text: "Sign in, then Allow" })
      setSigning("sign")
      await wait(500)
      await pointer.to(wait, 225, 135, 600)
      await press(wait, "sign")
      setSigning("ask")
      await wait(500)
      await pointer.to(wait, 265, 148, 500)
      await press(wait, "allow")
      await wait(300)
      setSigning()
      setConnected(true)
      props.told.caption({ step: "✓", text: `ChatGPT can use ${props.told.name}` })
      await wait(400)
    },
  )
  return (
    <>
      <Window x={12} y={10} w={416} h={290} host="chatgpt.com" path="/plugins" fill="#ffffff">
        <Box row h={266}>
          <Box w={80} h="100%" fill="#f9f9f9" pad={[12, 8]} gap={6}>
            <Box h={4} w="70%" r={2} fill="#e3e3e3" />
            <Box h={4} r={2} fill="#e3e3e3" />
            <Box h={4} w="80%" r={2} fill="#e3e3e3" />
            <Box h={4} w="55%" r={2} fill="#e3e3e3" />
            <Box pad={[4, 5]} r={6} fill="#ececec" m={[4, 0, 0, 0]}>
              <Words size={7.2} weight={600} ink="#0d0d0d">Plugins</Words>
            </Box>
          </Box>
          <Box grow={1} h="100%" pad={[12, 14, 0, 14]}>
            <Box row h={20} m={[0, 0, 6, 0]}>
              <Words size={11} weight={600} ink="#0d0d0d">Plugins</Words>
              <Box m={[0, 0, 0, "auto"]} w={18} h={18} r={9} fill="#0d0d0d" middle zoom={pressed() === "plus" ? 0.88 : 1}>
                <Shape w={8} h={8} viewBox="0 0 10 10" parts={[{ d: "M5 1v8M1 5h8", stroke: "#ffffff", width: 1.5 }]} />
              </Box>
            </Box>
            <Words size={6.8} ink="#8f8f8f" m={[0, 0, 8, 0]}>Let ChatGPT use your apps.</Words>
            <Show when={added()}>
              <Box h={27} row gap={7} pad={[0, 4]} r={6} fill={connected() ? "#e6f4ea" : "#ffffff"} shows>
                <Mark size={14} logo={props.told.logo} />
                <Words size={7.6} ink="#0d0d0d">{props.told.name}</Words>
                <Show when={connected()} fallback={<Words size={6.6} ink="#8f8f8f" m={[0, 0, 0, "auto"]}>Signing in…</Words>}>
                  <Connected />
                </Show>
              </Box>
            </Show>
            <For each={others}>
              {([mark, box, label]) => (
                <Box h={27} row gap={7} pad={[0, 4]} lines={[0.5, 0, "#f0f0f0"]}>
                  <Box w={14} h={14} middle>
                    <Shape w={12} h={11} viewBox={box} parts={mark} />
                  </Box>
                  <Words size={7.6} ink="#0d0d0d">{label}</Words>
                  <Words size={8} ink="#b4b4b4" m={[0, 0, 0, "auto"]}>›</Words>
                </Box>
              )}
            </For>
          </Box>
        </Box>
        <Show when={menu()}>
          <Box x={300} y={64} w={112} pad={4} r={10} fill="#ffffff" shadow="0 8px 24px #00000033, 0 0 0 0.5px #0000001f" shows>
            <Box pad={[5, 7]} r={6} fill={pressed() === "item" ? "#e9e9e9" : "#f4f4f4"}>
              <Words size={7.4} weight={500} ink="#0d0d0d">Add custom MCP server</Words>
            </Box>
          </Box>
        </Show>
        <Show when={dialog() || signing()}>
          <Box x={0} y={24} right={0} bottom={0} fill="#00000057" shows />
        </Show>
        <Show when={dialog()}>
          <Box x={98} y={44} w={220} pad={[12, 13, 12, 13]} r={14} fill="#ffffff" shadow="0 18px 50px #00000047, 0 0 0 0.5px #0000001a" z={5} shows>
            <Words size={10.5} weight={600} ink="#0d0d0d" m={[0, 0, 8, 0]}>Add custom MCP server</Words>
            <Words size={6.4} ink="#6e6e73" m={[0, 0, 2, 1]}>Name</Words>
            <Field placeholder="Name" text={name()} focus={focus() === "name"} />
            <Words size={6.4} ink="#6e6e73" m={[0, 0, 2, 1]}>Description (optional)</Words>
            <Field placeholder="What it does" text="" focus={false} />
            <Words size={6.4} ink="#6e6e73" m={[0, 0, 2, 1]}>Server URL</Words>
            <Field placeholder="https://" text={address()} focus={focus() === "address"} />
            <Words size={6.4} ink="#6e6e73" m={[0, 0, 2, 1]}>Authentication</Words>
            <Box h={20} r={6} pad={[0, 7]} row between border={[1, "#e3e3e3"]} m={[0, 0, 6, 0]}>
              <Words size={7.4} ink="#0d0d0d">OAuth</Words>
              <Shape w={6} h={6} viewBox="0 0 10 10" parts={[{ d: "m2 4 3 3 3-3", stroke: "#6e6e73", width: 1.3 }]} />
            </Box>
            <Box row gap={5}>
              <Box w={9} h={9} r={2.5} border={[1, understood() ? "#0d0d0d" : "#b4b4b4"]} fill={understood() ? "#0d0d0d" : "#ffffff"} middle zoom={pressed() === "box" ? 0.85 : 1}>
                <Show when={understood()}>
                  <Shape w={6} h={6} viewBox="0 0 24 24" parts={[{ d: "m5 12.5 4.5 4.5L19 7.5", stroke: "#ffffff", width: 4 }]} />
                </Show>
              </Box>
              <Words size={6.8} ink="#0d0d0d">I understand and want to continue</Words>
            </Box>
            <Box row m={[10, 0, 0, 0]}>
              <Box grow={1} />
              <Box pad={[4, 11]} r={99} fill="#0d0d0d" zoom={pressed() === "ok" ? 0.92 : 1}>
                <Words size={7.4} weight={600} ink="#ffffff">Create as a plugin</Words>
              </Box>
            </Box>
          </Box>
        </Show>
      </Window>
      <Show when={pasting()}>
        <Paste x={240} y={150} />
      </Show>
      <Show when={signing()}>
        <SignIn told={props.told} ai="ChatGPT" asking={signing() === "ask"} pressed={pressed() === "sign" ? "sign" : pressed() === "allow" ? "allow" : undefined} />
      </Show>
      <Pointer x={0} y={0} shift={pointer.at()} zoom={pointer.down() ? 0.82 : 1} />
    </>
  )
}

/// A coding agent (Claude Code's look): the prompt pasted, then it reads the network's llms.txt and connects itself.
export function Agent(props: { told: Told; prompt: string }) {
  const [pasting, setPasting] = createSignal(false)
  const [typedIn, setTyped] = createSignal("")
  const [shown, setShown] = createSignal(0)
  const [working, setWorking] = createSignal<string>()
  const lines = () => [
    { text: `> ${props.prompt}`, you: true },
    { text: " " },
    { text: `Fetch(https://${props.told.host}/llms.txt)`, dot: true },
    { text: "  →  Received 4.1KB (200 OK)", grey: true },
    { text: "Bash(one --version)", dot: true },
    { text: "  →  one 0.34.441", grey: true },
    { text: "Bash(claude mcp add --scope user one -- one mcp)", dot: true },
    { text: "  →  Added stdio MCP server one to user config", grey: true },
    { text: `You're connected to ${props.told.host}. Ask me about your email, calendar, files and more.`, done: true },
  ]
  looping(
    () => (setPasting(false), setTyped(""), setShown(0), setWorking()),
    async (wait) => {
      props.told.caption({ step: "1", text: "Paste the prompt" })
      await wait(700)
      setPasting(true)
      await wait(380)
      setTyped(props.prompt)
      await wait(660)
      setPasting(false)
      await wait(350)
      setTyped("")
      setShown(2)
      props.told.caption({ step: "2", text: "It reads what to do" })
      setWorking("✻ Reading llms.txt…")
      await wait(700)
      setShown(3)
      await wait(500)
      setShown(4)
      await wait(450)
      setWorking("✻ Checking for one…")
      props.told.caption({ step: "3", text: "It connects itself" })
      setShown(5)
      await wait(450)
      setShown(6)
      await wait(450)
      setWorking("✻ Adding MCP…")
      setShown(7)
      await wait(600)
      setShown(8)
      await wait(400)
      setWorking()
      setShown(9)
      props.told.caption({ step: "✓", text: `Your agent can use ${props.told.name}` })
      await wait(400)
    },
  )
  return (
    <>
      <Window x={12} y={10} w={416} h={290} host="claude" fill="#141414">
        <Box h={266} pad={[10, 12]} gap={3}>
          <Box row start pad={[3, 6]} r={4} border={[1, "#d97757"]} m={[0, 0, 6, 0]}>
            <Words size={7} ink="#d97757">✻</Words>
            <Words size={7} ink="#e8e8e8" m={[0, 0, 0, 4]}>Welcome to Claude Code!</Words>
          </Box>
          <For each={lines()}>
            {(line, at) => (
              <Show when={at() < shown()}>
                <Box row gap={4} shows>
                  {line.dot && <Words size={6.6} ink="#4ec27a" mono>●</Words>}
                  {line.done && <Words size={6.6} ink="#e8e8e8" mono>●</Words>}
                  <Words size={6.6} ink={line.grey ? "#8c8c8c" : line.you ? "#b5b5b5" : "#e8e8e8"} mono wraps>{line.text}</Words>
                </Box>
              </Show>
            )}
          </For>
          <Box grow={1} />
          <Show when={working()}>
            <Words size={6.6} ink="#d97757" mono>{working()}</Words>
          </Show>
          <Box h={16} r={4} pad={[0, 6]} row border={[1, "#3a3a3a"]} m={[4, 0, 0, 0]}>
            <Words size={6.6} ink="#e8e8e8" mono>{`> ${typedIn()}`}</Words>
            <Box w={4} h={8} fill="#e8e8e8" m={[0, 0, 0, 1]} />
          </Box>
          <Words size={5.8} ink="#6b6b6b" mono>? for shortcuts</Words>
        </Box>
      </Window>
      <Show when={pasting()}>
        <Paste x={330} y={250} />
      </Show>
    </>
  )
}
