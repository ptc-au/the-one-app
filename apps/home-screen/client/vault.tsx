// Set Up Your Vault, or Unlock Your Vault: onboarding's last step. Which one, or neither, is what the Vault says
// (`vault_security`): Set Up where its person has no key yet; Unlock where this device doesn't hold it, no server opens
// the Vault, or a server of theirs is waiting for its key (`encryption_key`'s `access`), as a computer that's just
// become their server is; neither once it's ready and nothing waits. Its button is Vault's own (accounts.tsx): this
// device asks for the key, then the network's sign-in page, in the device's browser, makes it, lets this device hold
// it and hands it to every server waiting for it, with one passkey. Coming back, the picture shows it done, the lock
// shut on the Vault or opened off it, and the button goes on. Later goes on without it: Vault in Settings still asks.
import { createEffect, createMemo, createProjection, createSignal, For, isPending, onCleanup, refresh, Show } from "solid-js"
import { Button, call, changed, client, defineVars, type Element, Icon, illustration, Image, open as opening, Path, Pressable, safeArea, ScrollView, styles, Svg, Text, toast, tokens, View, visible } from "ui"
import { Box, circle, Panel, type Part, rect, Shape, Words } from "./art.tsx"
import { amazon, google, microsoft, stripe } from "./slides.tsx"
import { network } from "./welcome.tsx"

const drawn = illustration("Vault's pictures: the Vault's window and its rows, the lock and its passkey beside it, the rows smudged while it's locked, and the panel of what the server sees, as a picture of what isn't ours, drawn the same in light and dark", {
  lockGlyph: "#ffffff",
  wifiTile: "#e8e8ed",
  mutedInk: "#8e8e93",
  shackle: "#b9bcc4",
  shackleSheen: "inset 0 2px 0 #ffffff99",
  lockBodyGradient: "linear-gradient(180deg, #3a3a3e, #1c1c1e)",
  lockShadow: "0 14px 22px #00000047, inset 0 1px 0 #ffffff2e",
  vaultFace: "#ffffff",
  vaultShadow: "0 10px 30px #0000001f, 0 0 0 0.5px #0000001a",
  titleRule: "#ececef",
  vaultLock: "#1d1d1f",
  rowRule: "#f1f1f3",
  smudgeCover: "#ffffff",
  nameSmudge: "#d9d9de",
  dotsSmudge: "#e3e3e8",
  captionLock: "#111111",
  serverPanel: "#ffffffb3",
  serverEdge: "0 0 0 0.5px #00000014",
  serverInk: "#6e6e73",
})

/** Which of the two a Vault needs here. */
export type VaultStepKind = "set-up" | "unlock"

/** What `vault_security` says that this step needs. */
type Security = { readiness: "not_set_up" | "no_server" | "device_lacks_key" | "ready"; device: string | null }
/** What `encryption_key` says that this step needs: each artifact encrypted for its person, the servers that hold its
 * keys and those waiting for them. */
type Key = { access: { servers: { key: string }[]; missing: unknown[] }[] }

const json = <T,>(tool: string, inputs?: object) => call(tool, inputs).then((text) => JSON.parse(text) as T)

/// Which of the two someone's Vault needs here, or neither. `server` is this device's key as a server, while it is one
/// or is becoming one: one just made a server, in the step before, isn't waiting for the key until it's joined, but will.
const needs = (security: Security, key: Key, server?: string): VaultStepKind | undefined => {
  if (security.readiness === "not_set_up") return "set-up"
  if (security.readiness !== "ready" || key.access.some((artifact) => artifact.missing.length > 0)) return "unlock"
  if (server && !key.access.some((artifact) => artifact.servers.some((held) => held.key === server))) return "unlock"
  return undefined
}

/// Which the Vault step is for whoever's looking, or none (`undefined`), and where it can't be asked, `null`: never in
/// their way, even shown again.
export const vaultStep = () =>
  Promise.all([json<Security>("vault_security"), json<Key>("encryption_key"), client()]).then(
    ([security, key, { server }]) => needs(security, key, server?.key),
    () => null,
  )

/// How wide the heading's words go before they wrap, as the mockup's 34em.
const READABLE = 460

/// What the server keeps of a Vault: six groups of four hex digits, new each time it's drawn.
const scrambled = () => Array.from({ length: 6 }, () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0")).join(" ")

/// A padlock, and a passkey (a person and a key) on its body, in white.
const lock = (colour: `#${string}`, width = 1.6): Part[] => [{ d: rect(2.5, 7, 11, 8, 2), fill: colour }, { d: "M5 7V5a3 3 0 0 1 6 0v2", stroke: colour, width }]
/// A tick, in white.
const tick: Part[] = [{ d: "M2.2 6.3 4.8 9 9.8 3.2", stroke: drawn.lockGlyph, width: 2 }]
const passkey: Part[] = [{ d: circle(18, 15, 7.5), fill: drawn.lockGlyph }, { d: "M4 38c0-8 6.3-12.5 14-12.5 3 0 5.8.7 8 2V38z", fill: drawn.lockGlyph }, { d: circle(34, 21, 6), stroke: drawn.lockGlyph, width: 3.4 }, { d: "M34 27v14l3-2.5-1.8-2 1.8-2-3-2.5", fill: drawn.lockGlyph, stroke: drawn.lockGlyph, width: 3.4 }]

/// Wi-Fi's mark: a plus on grey, as an item with no site's.
const wifi: Part[] = [{ d: rect(0, 0, 16, 16, 3.5), fill: drawn.wifiTile }, { d: "M5 8h6M8 5v6", stroke: drawn.mutedInk, width: 1.4 }]

/// The Vault's rows in the picture: each one's mark, name, dots, and how large its mark is drawn.
const rows: [Part[], string, number, number, string][] = [
  [amazon, "Amazon", 12, 15, "0 0 24 24"],
  [google, "Google", 10, 14, "0 0 48 48"],
  [microsoft, "Microsoft", 11, 13, "0 0 16 16"],
  [stripe, "Stripe", 14, 15, "0 0 16 16"],
]

const own = defineVars({
  title: 24,
  titlePhone: 20,
  titleLeading: 28,
  titleLeadingPhone: 23,
  titleSpacing: -0.48,
  titleSpacingPhone: -0.4,
  mark: 34,
  markPhone: 28,
  text: 13.5,
  textLeading: 18.25,
  perk: 14.5,
  perkLeading: 19,
  faq: 14,
  faqLeading: 19,
  faqText: 13.5,
  faqTextLeading: 19.5,
  tick: 18,
  tickGlyph: 11,
  caption: 12.5,
  captionLeading: 16,
  captionDot: 19,
  perksGap: 11,
  nudge: 1,
  questionPad: 9,
  glyphRoom: 17,
  answerIndent: 27,
  phoneGap: 14,
  captionBottom: 10,
  pillGap: 7,
  pillPad: 5,
  pillEnd: 12,
  ...illustration("Vault's caption pill: its dark fill, its white words and dot, and its dot green once it's done", { pill: "#18181adb", white: "#ffffff", done: "#34c759" }),
})

const look = styles({
  screen: (width: number, height: number) => ({ width, height, alignItems: "center", justifyContent: "center" }),
  wide: (width: number) => ({ width, flexDirection: "column", gap: tokens.grid[4] }),
  columns: (height: number) => ({ height, flexDirection: "row", gap: tokens.grid[5] }),
  side: (width: number) => ({ width, flexDirection: "column", justifyContent: "space-between" }),
  brand: (width: number) => ({ width, flexDirection: "column", alignItems: "flex-start", gap: tokens.grid[1], paddingStart: tokens.grid[0.5] }),
  brandPhone: { flexDirection: "column", alignItems: "center", gap: tokens.grid[1.5] },
  named: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2.5] },
  logo: { width: own.mark, height: own.mark },
  logoPhone: { width: own.markPhone, height: own.markPhone },
  title: { fontSize: own.title, fontWeight: 700, lineHeight: own.titleLeading, letterSpacing: own.titleSpacing, color: tokens.colour.label },
  titlePhone: { fontSize: own.titlePhone, fontWeight: 700, lineHeight: own.titleLeadingPhone, letterSpacing: own.titleSpacingPhone, color: tokens.colour.label },
  text: { fontSize: own.text, lineHeight: own.textLeading, color: tokens.colour.secondaryLabel },
  textPhone: { textAlign: "center" },
  body: { flexDirection: "column", gap: tokens.grid[3] },
  perks: { flexDirection: "column", gap: own.perksGap },
  perk: { flexDirection: "row", alignItems: "flex-start", gap: tokens.grid[2.5] },
  tick: { width: own.tick, height: own.tick, marginTop: own.nudge, flexShrink: 0, borderRadius: tokens.radius.full, alignItems: "center", justifyContent: "center" },
  yes: { backgroundColor: tokens.colour.greenTint },
  no: { backgroundColor: tokens.colour.redTint },
  tickGlyph: { width: own.tickGlyph, height: own.tickGlyph },
  yesInk: { fill: "none", stroke: tokens.colour.green, strokeWidth: 2 },
  noInk: { fill: "none", stroke: tokens.colour.red, strokeWidth: 2 },
  perkText: { flexShrink: 1, fontSize: own.perk, fontWeight: 550, lineHeight: own.perkLeading, color: tokens.colour.label },
  faq: { borderTopWidth: tokens.length.hairline, borderColor: tokens.colour.quinaryLabel, paddingTop: tokens.grid[0.5] },
  question: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2.5], paddingBlock: own.questionPad, cursor: "pointer", color: { default: tokens.colour.secondaryLabel, hover: tokens.colour.label } },
  asked: { color: tokens.colour.label },
  caret: { width: own.glyphRoom, alignItems: "center", rotate: -90, transitionProperty: ["rotate"], transition: tokens.motion.settle },
  caretOpen: { rotate: 0 },
  questionText: { fontSize: own.faq, fontWeight: 500, lineHeight: own.faqLeading },
  answer: { marginStart: own.answerIndent, marginBottom: tokens.grid[1], fontSize: own.faqText, lineHeight: own.faqTextLeading, color: tokens.colour.secondaryLabel },
  tip: { flexDirection: "row", alignItems: "flex-start", gap: tokens.grid[2.5], color: tokens.colour.secondaryLabel },
  tipMark: { width: own.glyphRoom, alignItems: "center", paddingTop: own.nudge },
  tipText: { flexShrink: 1, fontSize: own.faq, lineHeight: own.faqLeading, color: tokens.colour.secondaryLabel },
  tipWords: { fontWeight: 550, color: tokens.colour.label },
  actions: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2] },
  actionsPhone: { flexDirection: "column", alignItems: "stretch", gap: tokens.grid[1] },
  grow: { flexGrow: 1 },
  stretch: { alignSelf: "stretch" },
  scroll: (width: number, height: number) => ({ width, height }),
  phone: (width: number, paddingTop: number, paddingBottom: number) => ({ width, alignSelf: "center", paddingTop, paddingBottom, paddingInline: tokens.grid[4], flexDirection: "column", gap: own.phoneGap }),
  caption: { position: "absolute", start: 0, end: 0, bottom: own.captionBottom, alignItems: "center", pointerEvents: "none" },
  pill: illustration("Vault's caption pill, with its shadow and its words rising as it appears, as the mockup draws it", { flexDirection: "row", alignItems: "center", gap: own.pillGap, paddingBlock: own.pillPad, paddingStart: own.pillPad, paddingEnd: own.pillEnd, borderRadius: tokens.radius.full, backgroundColor: own.pill, boxShadow: "0 4px 14px #0000002e", animationName: { from: { opacity: 0, translateY: 4 }, to: { opacity: 1, translateY: 0 } }, animationDuration: 300, animationTimingFunction: "ease", animationFillMode: "both" }),
  dot: { width: own.captionDot, height: own.captionDot, borderRadius: tokens.radius.full, backgroundColor: own.white, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: own.done },
  captionText: { fontSize: own.caption, fontWeight: 600, lineHeight: own.captionLeading, color: own.white, whiteSpace: "nowrap" },
})

/// How the picture's parts move: the lock's shackle shutting, its passkey lighting, the shackle lifting and the lock
/// going as it opens, and the smudges over the Vault's rows clearing, each as the mockup's keyframes.
const moves = styles({
  shut: illustration("The lock's shackle coming down as it shuts", { animationName: { from: { translateY: -14 }, to: { translateY: 0 } }, animationDelay: 150, animationDuration: 500, animationTimingFunction: [0.5, 0, 0.2, 1.4], animationFillMode: "both" }),
  glow: { animationName: { "0%": { opacity: 0.35 }, "50%": { opacity: 1 }, "100%": { opacity: 1 } }, animationDelay: 400, animationDuration: 1400, animationTimingFunction: "ease", animationFillMode: "both" },
  lift: illustration("The lock's shackle lifting as it opens", { animationName: { from: { translateY: 0 }, to: { translateY: -14 } }, animationDuration: 450, animationTimingFunction: [0.3, 1.4, 0.5, 1], animationFillMode: "both" }),
  go: { animationName: { from: { opacity: 1, scale: 1 }, to: { opacity: 0, scale: 0.85 } }, animationDelay: 500, animationDuration: 500, animationTimingFunction: "ease", animationFillMode: "both" },
  clear: { animationName: { from: { opacity: 1 }, to: { opacity: 0 } }, animationDuration: 600, animationTimingFunction: "ease", animationFillMode: "both" },
  shackle: { borderBottomWidth: 0 },
})

/// The lock: its shackle over its body, the passkey on it. `shut` plays its shackle coming down and the passkey lighting;
/// `open` lifts it and the lock goes.
function Lock(props: { x: number; y: number; shut?: boolean; open?: boolean }) {
  return (
    <Box x={props.x} y={props.y} w={84} h={104} z={4} style={props.open ? moves.go : undefined}>
      <Box x={19} y={0} w={46} h={52} border={[8, drawn.shackle]} r={[23, 23, 0, 0]} shadow={drawn.shackleSheen} style={[moves.shackle, props.shut && moves.shut, props.open && moves.lift]} />
      <Box x={0} y={38} w={84} h={66} r={16} image={drawn.lockBodyGradient} shadow={drawn.lockShadow} middle>
        <Shape w={40} h={40} viewBox="0 0 48 48" parts={passkey} style={props.shut ? moves.glow : undefined} />
      </Box>
    </Box>
  )
}

/// The Vault, as its window shows it: its rows, names and dots, smudged while it's locked.
function Vault(props: { x: number; locked?: boolean; cleared?: boolean }) {
  return (
    <Box x={props.x} y={30} w={266} r={12} fill={drawn.vaultFace} shadow={drawn.vaultShadow} clip>
      <Box h={26} row gap={6} pad={[0, 10]} lines={[0, 1, drawn.titleRule]}>
        <Shape w={12} h={12} viewBox="0 0 16 16" parts={lock(drawn.vaultLock)} />
        <Words size={9.5} weight={600}>Vault</Words>
      </Box>
      <Box>
        <For each={rows}>
          {([mark, name, dots, size, box]) => (
            <Box h={29} row gap={8} pad={[0, 10]} lines={[0, 1, drawn.rowRule]}>
              <Box w={16} h={16} middle>
                <Shape w={size} h={size} viewBox={box} parts={mark} />
              </Box>
              <Words size={8.5}>{name}</Words>
              <Words size={8} ink={drawn.mutedInk} spacing={0.5} mono m={[0, 0, 0, "auto"]}>{"•".repeat(dots)}</Words>
            </Box>
          )}
        </For>
        <Box h={29} row gap={8} pad={[0, 10]}>
          <Box w={16} h={16} middle>
            <Shape w={14} h={14} viewBox="0 0 16 16" parts={wifi} />
          </Box>
          <Words size={8.5} ink={drawn.mutedInk}>Wi-Fi</Words>
          <Words size={8} ink={drawn.mutedInk} spacing={0.5} mono m={[0, 0, 0, "auto"]}>{"•".repeat(9)}</Words>
        </Box>
        {/* Locked, each row is only a smudge of its mark and its words, which clears as it's unlocked. */}
        <Show when={props.locked}>
          <Box x={0} y={0} right={0} bottom={0} fill={drawn.smudgeCover} style={props.cleared ? moves.clear : undefined}>
            <For each={[...rows.map(([mark, name, dots, size, box]) => [mark, name.length, dots, size, box] as const), [wifi, 5, 9, 14, "0 0 16 16"] as const]}>
              {([mark, letters, dots, size, box]) => (
                <Box h={29} row gap={8} pad={[0, 10]} opacity={0.55}>
                  <Box w={16} h={16} middle opacity={0.5}>
                    <Shape w={size} h={size} viewBox={box} parts={mark} />
                  </Box>
                  <Box w={letters * 5} h={6} r={3} fill={drawn.nameSmudge} />
                  <Box w={dots * 5} h={4} r={2} fill={drawn.dotsSmudge} m={[0, 0, 0, "auto"]} />
                </Box>
              )}
            </For>
          </Box>
        </Show>
      </Box>
    </Box>
  )
}

/// The step, in `width` by `height`. `kind` is which, as `vaultStep` said; `onContinue` goes on, done or Later.
/// `progress` is where it is among onboarding's steps, over its title where it's narrow.
export function VaultStep(props: { kind: VaultStepKind; width: number; height: number; onContinue: () => void; progress?: Element }) {
  const security = createProjection(() => json<Security>("vault_security"))
  const key = createProjection(() => json<Key>("encryption_key"))
  const again = () => [security, key].forEach(refresh)
  // The sign-in page stores what the passkey opened, which the server says has changed; coming back from the browser
  // shows the page again, which asks once more, where a change wasn't told.
  onCleanup(changed(again))
  createEffect(visible, (shown) => void (shown && again()), { defer: true })

  // Done once the Vault has its key, set up, or nothing here or on a server waits for it, unlocked, and done it stays.
  const [done, setDone] = createSignal(false)
  createEffect(
    () => (props.kind === "set-up" ? security.readiness !== "not_set_up" : needs(security, key) === undefined),
    (now) => void (now && setDone(true)),
  )
  const [open, setOpen] = createSignal(false)

  // "this Mac", "this phone": where it's locked, as the device says what it is.
  const [where, setWhere] = createSignal("this device")
  client().then(
    ({ target }) => setWhere(/^macos/.test(target ?? "") ? "this Mac" : /^windows/.test(target ?? "") ? "this PC" : /^(ios|android)/.test(target ?? "") ? "this phone" : "this device"),
    () => {},
  )
  // How they signed in: with Google, which is the only sign-in that proves an email, or else with a passkey.
  const [google, setGoogle] = createSignal(false)
  call("sign-in_people").then(
    (answer) => setGoogle(!!(JSON.parse(answer) as { people: { email: string | null }[] }).people[0]?.email),
    () => {},
  )
  // What the server sees changes as it's looked at, as the mockup's does, until it's done.
  const [cipher, setCipher] = createSignal(scrambled())
  const ticking = setInterval(() => !done() && setCipher(scrambled()), 900)
  onCleanup(() => clearInterval(ticking))

  const setUp = () => props.kind === "set-up"
  const subtitle = () =>
    setUp()
      ? "Store your passwords and accounts privately."
      : `Your Vault holds your saved passwords and accounts. ${google() ? "Google signed you in" : "You signed in"}, but only your passkey can unlock it on this device.`

  // Vault's own Unlock with Passkey (accounts.tsx): this device asks for the key, then the sign-in page, in the device's
  // browser, makes it if there's none, lets this device hold it and hands it to the servers waiting for it. The ask and
  // the link are asked at once, and the page reads who's asking only once its passkey is used.
  const [starting, setStarting] = createSignal(false)
  const [asked, setAsked] = createSignal(false)
  const unlock = async () => {
    setStarting(true)
    try {
      const { device } = security
      const [, { link }] = await Promise.all([device ? call("encryption_ask", {}) : undefined, json<{ link: string }>("sign-in_unlock_with_passkey", device ? { device } : {})])
      setAsked(true)
      await opening(link)
    } catch (error) {
      toast(error as Error)
    } finally {
      setStarting(false)
    }
  }
  // Unlocking, as its button says, while it opens the page, and once it's been opened, while what it did is asked
  // again, as it is the moment its person comes back and as the server says it changed, until it's done.
  const unlocking = () => !done() && (starting() || (asked() && (isPending(() => security.readiness) || isPending(() => key.access))))

  const wide = () => props.width >= 600

  const Brand = (brand: { phone?: boolean }) => (
    <View style={brand.phone ? look.brandPhone : look.brand(Math.min(props.width - 48, READABLE))}>
      <View style={look.named}>
        <Image src={network().light} srcDark={network().dark} alt="" style={brand.phone ? look.logoPhone : look.logo} />
        <Text role="heading" aria-level={1} style={brand.phone ? look.titlePhone : look.title}>
          {setUp() ? "Set Up Your Vault" : "Unlock Your Vault"}
        </Text>
      </View>
      <Text style={[look.text, brand.phone && look.textPhone]}>{subtitle()}</Text>
    </View>
  )

  const Perk = (perk: { yes?: boolean; children: string }) => (
    <View style={look.perk}>
      <View style={[look.tick, perk.yes ? look.yes : look.no]}>
        <Svg viewBox="0 0 12 12" aria-hidden="true" style={look.tickGlyph}>
          <Path d={perk.yes ? "M2.2 6.3 4.8 9 9.8 3.2" : "M3 3l6 6M9 3 3 9"} style={perk.yes ? look.yesInk : look.noInk} />
        </Svg>
      </View>
      <Text style={look.perkText}>{perk.children}</Text>
    </View>
  )

  const Body = () => (
    <View style={look.body}>
      <Show when={setUp()}>
        <View style={look.perks}>
          <Perk yes>Apps and AI can use your logins</Perk>
          <Perk yes>You approve each access</Perk>
          <Perk>They can’t see your passwords</Perk>
          <Perk>The server can’t read your Vault</Perk>
        </View>
      </Show>
      <View style={look.faq}>
        <Pressable role="button" aria-expanded={open() ? "true" : "false"} onPress={() => setOpen(!open())} style={[look.question, open() && look.asked]}>
          <View style={[look.caret, open() && look.caretOpen]}>
            <Icon name="caret-down" />
          </View>
          <Text style={look.questionText}>Why not just Sign in with Google?</Text>
        </Pressable>
        <Show when={open()}>
          <Text style={look.answer}>Google only signs you in. A passkey locks your Vault with a key on your device, so not even Google or the server can read what’s inside.</Text>
        </Show>
      </View>
      <Show when={!setUp()}>
        <View style={look.tip}>
          <View style={look.tipMark}>
            <Icon name="device-mobile" />
          </View>
          <Text style={look.tipText}>
            Passkey on your phone? Pick <Text style={look.tipWords}>Use a phone</Text> when asked.
          </Text>
        </View>
      </Show>
    </View>
  )

  const Actions = () => (
    <View style={wide() ? look.actions : look.actionsPhone}>
      <Show
        when={done()}
        fallback={
          <>
            <Show when={wide()}>
              <Button variant="ghost" onPress={props.onContinue}>Later</Button>
            </Show>
            <Button shape={wide() ? undefined : "capsule"} loading={unlocking()} onPress={unlock} style={wide() ? look.grow : look.stretch}>
              {unlocking() ? (setUp() ? "Setting Up…" : "Unlocking…") : setUp() ? "Set Up Passkey" : "Unlock with Passkey"}
            </Button>
            <Show when={!wide()}>
              <Button variant="ghost" shape="capsule" onPress={props.onContinue} style={look.stretch}>Later</Button>
            </Show>
          </>
        }
      >
        <Button shape={wide() ? undefined : "capsule"} onPress={props.onContinue} style={wide() ? look.grow : look.stretch}>
          <Icon name="check" /> Continue
        </Button>
      </Show>
    </View>
  )

  // The picture: the Vault, what the server sees of it and the lock beside it, shut as it's set up; or the Vault
  // smudged under its lock, which opens off it as it's unlocked. Its caption says which.
  const Picture = (size: { width: number; height: number }) => {
    const caption = () => (setUp() ? (done() ? "Your Vault is protected" : "Encrypted to your passkey") : done() ? `Unlocked on ${where()}` : `Locked on ${where()}`)
    return (
      <Panel
        width={size.width}
        height={size.height}
        over={
          <View style={look.caption}>
            <Show when={caption()} keyed>
              {(words) => (
                <View style={look.pill}>
                  <View style={[look.dot, done() && look.dotDone]}>
                    <Shape w={11} h={11} viewBox={done() ? "0 0 12 12" : "0 0 16 16"} parts={done() ? tick : lock(drawn.captionLock, 1.8)} />
                  </View>
                  <Text style={look.captionText}>{words}</Text>
                </View>
              )}
            </Show>
          </View>
        }
      >
          <Show
            when={setUp()}
            fallback={
              <>
                <Vault x={108} locked cleared={done()} />
                <Lock x={199} y={62} open={done()} />
              </>
            }
          >
            <Vault x={150} />
            <Box x={150} y={222} w={266} pad={[8, 10]} r={10} fill={drawn.serverPanel} shadow={drawn.serverEdge}>
              <Box row gap={5} m={[0, 0, 4, 0]}>
                <Shape w={9} h={9} viewBox="0 0 16 16" parts={lock(drawn.serverInk)} />
                <Words size={7.5} weight={600} ink={drawn.serverInk}>What the server sees</Words>
              </Box>
              <Words size={8.4} ink={drawn.mutedInk} spacing={0.4} mono>{cipher()}</Words>
            </Box>
            {/* Shut again as it's done, as the mockup's lock is. */}
            <Show when={done()} fallback={<Lock x={22} y={150} shut />}>
              <Lock x={22} y={150} shut />
            </Show>
          </Show>
      </Panel>
    )
  }

  return (
    <View style={look.screen(props.width, props.height)}>
      <Show
        when={wide()}
        fallback={(() => {
          const width = Math.min(props.width, 480)
          const inner = width - 32
          return (
            <ScrollView style={look.scroll(props.width, props.height)}>
              <View style={look.phone(width, safeArea().top + 20, safeArea().bottom + 18)}>
                {props.progress}
                <Brand phone />
                <Picture width={inner} height={Math.round((inner * 3.4) / 4)} />
                <Body />
                <Actions />
              </View>
            </ScrollView>
          )
        })()}
      >
        {(() => {
          const width = Math.min(props.width - 48, 960)
          const side = Math.round((width - 20) / 2.2)
          // As tall as the mockup's picture, never under 330, and what's left of the window under the heading.
          const height = Math.max(260, Math.min(props.height - 148, Math.max(330, Math.round((width - 20 - side) * 0.62))))
          return (
            <View style={look.wide(width)}>
              <Brand />
              <View style={look.columns(height)}>
                <View style={look.side(side)}>
                  <Body />
                  <Actions />
                </View>
                <Picture width={width - 20 - side} height={height} />
              </View>
            </View>
          )
        })()}
      </Show>
    </View>
  )
}
