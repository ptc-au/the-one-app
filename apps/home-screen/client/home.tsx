// The Home Screen: two sections side by side, Home and the App Library, as an iPhone's. Home is every owner's pages:
// yours, everyone's, then each of your groups', one owner above another, each a row of screenfuls, each as many of
// their pages side by side as fit, a phone's page drawn larger to suit the window's height on a wide one, and centred
// where there are fewer (layout.ts). The App Library, every app you can reach, by category, is one page, for everyone,
// a screen wide, that scrolls up and down. Left and right moves a screenful, as a phone's pages do, through Home's
// screenfuls and on to the App Library; up and down on Home moves between owners. The pages move by hand, as a
// phone's do (pager.ts). On Home, a small pill at the top in the middle says whose pages they are and opens a list of
// every owner. At the bottom, just clear of the home indicator, the dots pill has the owner's page dots, then the App
// Library's glyph, lit there. The App Store is an app like any other, in the App Library. A page never scrolls: it's a
// fixed grid, and what doesn't fit goes on to the next. Whoever arranges an owner's pages edits them as a phone's Home
// Screen is edited: touch and hold an app or a widget (press and hold it, or right-click it, with a mouse), then Edit
// Home Screen, or hold it a while longer, or touch and hold a page's empty space. An app held in the App Library is
// carried onto any owner's pages. Where it is, what's open over it and the editing are one state machine (machine.ts),
// whose snapshot is one signal here. It's written on the UI library's primitives, so a native host draws it as the DOM does.
import { createEffect, createMemo, createSignal, Errored, Loading, onCleanup, refresh, Show } from "solid-js"
import { Button, call, client, connection, covers, type Element, haptic, keydown, PresentationContext, Problem, render, Screen, Status, Stepper, styles, toast, tokens, View, viewport } from "ui"
import { looks } from "./looks.ts"
import { home, state, at, editing, launcher, windowWidth, device } from "./store.ts"
import { json, type Owner, owners } from "./owners.ts"
import { OpenCategory } from "./category.tsx"
import { made } from "./library.tsx"
import { Holding } from "./holding.tsx"
import { Overview } from "./overview.tsx"
import { Gallery, Asking, Refused, EditBar } from "./editing.tsx"
import { createLauncher, LauncherPanel, launcherKeys } from "./launcher.tsx"
import { Phone } from "./phone.tsx"
import { createScreens } from "./screens.ts"
import { createPaging } from "./paging.ts"
import { Carried, createCarry } from "./carry.tsx"
import { Welcome } from "./welcome.tsx"
import { ConnectAI } from "./connect.tsx"
import { computer, OwnServer } from "./own-server.tsx"
import { OpenFromAnywhere } from "./open-from-anywhere.tsx"
import { shortcut } from "./shortcut.tsx"
import { VaultStep, vaultStep } from "./vault.tsx"

/// The once-only tips whoever's looking has seen (`tips`), or nothing where they can't be asked.
const tips = createMemo(() => json<{ seen: string[] }>("home-screen_tips").then(({ seen }) => seen, () => undefined))
/// The runtime version this device's renderer draws: Welcome's pictures need 6 (CSS's own values and keyframes that
/// end), which a device on an older build doesn't draw, so it isn't shown there until it's updated; nor is the Vault's.
const drawn = createMemo(() => client().then(({ runtimeVersion }) => runtimeVersion ?? 0, () => 0))
/// Which the Vault's step is, Set Up or Unlock, while either is still to be seen, asked again as each step goes on: the
/// one before may have made this computer a server that's waiting for its person's key.
const vaultNeed = createMemo(() => (["vault", "vault-unlock"].some((tip) => tips()?.includes(tip) === false) ? vaultStep() : undefined))
/// Whether an AI already uses the network as whoever's looking: an assistant let in (Claude, ChatGPT), or `one` run in a
/// terminal, as a coding agent runs it (`command`), among their devices. Where that can't be asked, it's taken as one
/// that does, so Connect your AI is never in the way.
const assisted = createMemo(() =>
  json<{ devices: { kind: string; command?: string | null }[] }>("sign-in_devices").then(({ devices }) => devices.some((device) => device.kind === "assistant" || !!device.command), () => true),
)
/// Onboarding's steps, in order, each by the tip that keeps that its person's gone on from it, its name in the progress
/// over it, and the devices it's for: Welcome on every one that draws it, Connect your AI after it where no AI uses the network as them yet, Open from
/// anywhere on a computer's app, whose launcher has a shortcut, Your own server on a computer's app that isn't one of the network's
/// servers, and last the Vault's where it needs a passkey: Set Up Your Vault once, and Unlock Your Vault once, on the
/// first device that can't open it (`vaultStep`).
const steps = [
  { tip: "welcome", name: "Welcome", Step: Welcome, here: () => drawn() >= 6 },
  { tip: "connect-ai", name: "Connect your AI", Step: ConnectAI, here: () => drawn() >= 6 && !assisted() },
  { tip: "shortcut", name: "Open from anywhere", Step: OpenFromAnywhere, here: () => drawn() >= 6 && !!shortcut() },
  { tip: "own-server", name: "Your own server", Step: OwnServer, here: () => !!computer(device().target) && !device().server },
  { tip: "vault", name: "Vault", Step: (size: StepProps) => <VaultStep kind="set-up" {...size} />, here: () => drawn() >= 6 && vaultNeed() === "set-up" },
  { tip: "vault-unlock", name: "Vault", Step: (size: StepProps) => <VaultStep kind="unlock" {...size} />, here: () => drawn() >= 6 && vaultNeed() === "unlock" },
]
type StepProps = { width: number; height: number; onContinue: () => void; progress?: Element }
type Step = (typeof steps)[number]
/// Each step gone on from (true), or started again (false), here since `tips` was asked, by its tip.
const [continued, setContinued] = createSignal<Record<string, boolean>>({})
/// Whether a step shows: until they go on from it, on this device or another (its tip, theirs).
const showing = (tip: string) => (tips()?.includes(tip) === false ? continued()[tip] !== true : continued()[tip] === false)
/// The step shown: the first for this device that shows. Where their tips can't be asked, none is: never in the way of
/// their Home Screen.
const step = () => steps.find(({ tip, here }) => here() && showing(tip))
/// The steps this device shows, which the progress counts: each for it still to be seen as `tips` was asked, or gone on
/// from or started again here since. One seen on another device before isn't one of them.
const counted = () => steps.filter(({ tip, here }) => here() && (tips()?.includes(tip) === false || continued()[tip] !== undefined))
/// Goes on from a step, showing the next, or the Home Screen, at once and keeping that it's been seen behind it, or
/// (`again`) starts it again, as its tip set unseen has it.
const go = (tip: string, again = false) => {
  setContinued((done) => ({ ...done, [tip]: !again }))
  refresh(vaultNeed)
  call("home-screen_tip", { name: tip, seen: !again }).catch((error) => toast(error as Error))
}
/// Whether they've been through Welcome, so the Home Screen's tips offer it again (pills.tsx).
export const welcomed = () => !showing("welcome") && tips() !== undefined
/// Goes on from Welcome, or (`again`) starts it again from its first step, as the tip `welcome` set unseen has it.
export const welcome = (again = false) => go("welcome", again)

function HomeScreen(props: { owners: Owner[] }) {
  const layout = createScreens(props)
  const paging = createPaging(props, layout)
  const launching = createLauncher(props, layout, paging)
  const carrying = createCarry(props, layout, paging)
  const { library } = layout
  const { cardRect, found, openTarget, move, toggleLibrary } = launching
  // Editing begins with a tick, as an iPhone's does; lifting something into it plays its own.
  createEffect(
    createMemo(() => state().matches("editing")),
    (now) => void (now && home.getSnapshot().matches({ editing: "still" }) && haptic("selection")),
    { defer: true },
  )
  // While pages are edited, the device's own back ends editing, as Done does, and the window's rail keeps out of the
  // way, as iOS's chrome does while its icons are rearranged: something of the Home Screen's own is open over it.
  createEffect(
    createMemo(() => state().matches("editing")),
    (now) => (now ? covers(() => home.send({ type: "done" })) : undefined),
  )

  // The launcher's keys are the page's, heard whatever has the keyboard, as what's open over it (a category, a held app's
  // menu, the page overview) hears Escape, so Escape closes what's open before it empties the search or puts it away.
  createEffect(
    () => launcher(),
    (now) => (now ? keydown(launcherKeys({ move, open: openTarget, toggleLibrary, library, found: () => found().length })) : undefined),
  )
  // Onboarding first, each step once, until they go on from it (`step`); in the launcher, in its card.
  // In the launcher, its sheets are its card's, as Raycast's are its panel's: nothing's drawn outside its panes.
  return (
    <PresentationContext value={() => (launcher() ? cardRect() : undefined)}>
      <View
        style={[looks.root, looks.sized(windowWidth(), viewport().height)]}
      >
        <Show when={step()} keyed fallback={<HomeScreenShown owners={props.owners} layout={layout} paging={paging} launching={launching} carrying={carrying} />}>
          {(shown) => (
            <Show when={launcher()} fallback={<Onboarding step={shown} width={viewport().width} height={viewport().height} />}>
              <View style={[looks.surface, looks.at(cardRect().x, cardRect().y, cardRect().width, cardRect().height)]}>
                <Onboarding step={shown} width={cardRect().width} height={cardRect().height} />
              </View>
            </Show>
          )}
        </Show>
      </View>
    </PresentationContext>
  )
}

/// How tall the progress over a step laid out wide is: its row, and room above it.
const PROGRESS = 44
const look = styles({
  column: { flexDirection: "column" },
  progress: (height: number) => ({ height, justifyContent: "flex-end", paddingInline: tokens.grid[6] }),
})

/// A step of onboarding, `width` by `height`, with where it is among the steps this device shows (`counted`), where
/// there's more than one: their names in a row over it where it's laid out wide, as a computer's is, and as dots over
/// its title where it's narrow, as a phone's is (its `progress`), whose title names it.
function Onboarding(props: { step: Step; width: number; height: number }) {
  const among = () => counted()
  const at = () => among().indexOf(props.step)
  const shows = () => among().length > 1 && at() >= 0
  const progress = (dots: boolean) => <Stepper steps={among().map(({ name }) => name)} at={at()} dots={dots} />
  const Step = props.step.Step
  const onContinue = () => go(props.step.tip)
  return (
    <Show when={shows() && props.width >= 600} fallback={<Step width={props.width} height={props.height} onContinue={onContinue} progress={shows() ? progress(true) : undefined} />}>
      <View style={look.column}>
        <View style={look.progress(PROGRESS)}>{progress(false)}</View>
        <Step width={props.width} height={props.height - PROGRESS} onContinue={onContinue} />
      </View>
    </Show>
  )
}

/// The Home Screen as it is once onboarding's been seen: its pages, or a computer's launcher, and what's open over them.
function HomeScreenShown(props: { owners: Owner[]; layout: ReturnType<typeof createScreens>; paging: ReturnType<typeof createPaging>; launching: ReturnType<typeof createLauncher>; carrying: ReturnType<typeof createCarry> }) {
  const { layout, paging, launching } = props
  const { editBar, editBarGoing, overview, overviewGoing } = layout
  const { cardRect } = launching
  const { copy } = props.carrying
  const opened = () => state().context.category
  const held = () => (state().matches("holding") ? state().context.held : undefined)
  const owner = () => props.owners[at().owner]
  return (
      <>
        <Show
          when={launcher()}
          fallback={<Phone owners={props.owners} layout={layout} paging={paging} />}
        >
          <LauncherPanel owners={props.owners} layout={layout} paging={paging} launching={launching} />
        </Show>
        <Show when={editBar()}>
          <EditBar going={editBarGoing()} within={launcher() ? cardRect() : undefined} />
        </Show>
        <Show when={copy()}>{(now) => <Carried now={now} owner={owner()} />}</Show>
        <Show when={made()}>{(made) => <OpenCategory owner={props.owners[0]} made={made()} open={made() === opened()} within={launcher() ? cardRect() : undefined} />}</Show>
        <Show when={held()}>{(held) => <Holding owner={owner()} index={at().owner} held={held()} />}</Show>
        <Show when={overview()}>
          {(edited) => <Overview owner={props.owners[edited().owner]} index={edited().owner} going={overviewGoing()} />}
        </Show>
        <Show when={editing()}>{(edited) => <Gallery owner={props.owners[edited().owner]} />}</Show>
        <Show when={state().matches("editing") && !state().context.held?.item?.widget && state().context.held?.item && state().context.held}>
          {(held) => (
            <>
              <Asking owner={owner()} held={held()} />
              <Show when={owner().subject}>
                <Refused owner={owner()} held={held()} />
              </Show>
            </>
          )}
        </Show>
      </>
  )
}

/// The Home Screen didn't draw: what DESIGN.md says of a launcher that doesn't, with Try Again, which asks for it
/// again, and what went wrong under it. Its client loads it again by itself once a newer version is out, as the older
/// one meeting what's new is the likeliest cause.
function Broken(props: { error: Error }) {
  return (
    <Screen heading="Home Screen">
      <Problem
        heading="Home Screen didn't open."
        text={new Error(`Try again in a moment.\n\n${typeof props.error?.cause === "string" ? props.error.cause : (props.error?.message ?? props.error)}`)}
        action={<Button onPress={() => refresh(owners)}>Try Again</Button>}
      />
    </Screen>
  )
}

/// The Home Screen while what it shows hasn't come: nothing for a moment, as most of the time it's there at once, then
/// that it's opening, and once that lasts, its problem box with Try Again, as DESIGN.md has one, never a blank screen,
/// which a phone that asked as a server restarted showed until its person closed the app (20 Nov).
function Waiting() {
  const [waited, setWaited] = createSignal(0)
  const ticking = setInterval(() => setWaited((seconds) => seconds + 1), 1000)
  onCleanup(() => clearInterval(ticking))
  const said = () => (connection() === "online" ? "Your network hasn't answered yet." : "This device isn't reaching your network.")
  return (
    <Show
      when={waited() >= 10}
      fallback={
        <View style={[looks.broken, looks.tall(viewport().height)]}>
          <Show when={waited() >= 1}>
            <Status heading="Opening your Home Screen…" />
          </Show>
        </View>
      }
    >
      <Screen heading="Home Screen">
        <Problem heading="Home Screen didn't open." text={said()} action={<Button onPress={() => (setWaited(0), refresh(owners))}>Try Again</Button>} />
      </Screen>
    </Show>
  )
}

render(() => (
  <Errored fallback={(error) => <Broken error={error() as Error} />}>
    <Loading fallback={<Waiting />}>
      <HomeScreen owners={owners()} />
    </Loading>
  </Errored>
))
