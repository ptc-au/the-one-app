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
import { Button, call, client, connection, covers, haptic, keydown, PresentationContext, Problem, render, Screen, Status, toast, View, viewport } from "ui"
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
import { computer, OwnServer } from "./own-server.tsx"
import { VaultStep, vaultStep } from "./vault.tsx"

/// The once-only tips whoever's looking has seen (`tips`), or nothing where they can't be asked.
const tips = createMemo(() => json<{ seen: string[] }>("home-screen_tips").then(({ seen }) => seen, () => undefined))
/// The runtime version this device's renderer draws: Welcome's pictures need 6 (CSS's own values and keyframes that
/// end), which a device on an older build doesn't draw, so it isn't shown there until it's updated; nor is the Vault's.
const drawn = createMemo(() => client().then(({ runtimeVersion }) => runtimeVersion ?? 0, () => 0))
/// Which the Vault's step is, Set Up or Unlock, while either is still to be seen, asked again as each step goes on: the
/// one before may have made this computer a server that's waiting for its person's key.
const vaultNeed = createMemo(() => (["vault", "vault-unlock"].some((tip) => tips()?.includes(tip) === false) ? vaultStep() : undefined))
/// Onboarding's steps, in order, each by the tip that keeps that its person's gone on from it, and the devices it's
/// for: Welcome on every one that draws it, Your own server on a computer's app that isn't one of the network's
/// servers, and last the Vault's where it needs a passkey: Set Up Your Vault once, and Unlock Your Vault once, on the
/// first device that can't open it (`vaultStep`).
const steps = [
  { tip: "welcome", Step: Welcome, here: () => drawn() >= 6 },
  { tip: "own-server", Step: OwnServer, here: () => !!computer(device().target) && !device().server },
  { tip: "vault", Step: (size: StepProps) => <VaultStep kind="set-up" {...size} />, here: () => drawn() >= 6 && vaultNeed() === "set-up" },
  { tip: "vault-unlock", Step: (size: StepProps) => <VaultStep kind="unlock" {...size} />, here: () => drawn() >= 6 && vaultNeed() === "unlock" },
]
type StepProps = { width: number; height: number; onContinue: () => void }
/// Each step gone on from (true), or started again (false), here since `tips` was asked, by its tip.
const [continued, setContinued] = createSignal<Record<string, boolean>>({})
/// Whether a step shows: until they go on from it, on this device or another (its tip, theirs).
const showing = (tip: string) => (tips()?.includes(tip) === false ? continued()[tip] !== true : continued()[tip] === false)
/// The step shown: the first for this device that shows. Where their tips can't be asked, none is: never in the way of
/// their Home Screen.
const step = () => steps.find(({ tip, here }) => here() && showing(tip))
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
          {({ tip, Step }) => (
            <Show when={launcher()} fallback={<Step width={viewport().width} height={viewport().height} onContinue={() => go(tip)} />}>
              <View style={[looks.surface, looks.at(cardRect().x, cardRect().y, cardRect().width, cardRect().height)]}>
                <Step width={cardRect().width} height={cardRect().height} onContinue={() => go(tip)} />
              </View>
            </Show>
          )}
        </Show>
      </View>
    </PresentationContext>
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
