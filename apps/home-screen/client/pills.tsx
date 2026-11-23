// The pills: the owner's name, which opens the list of every owner, and the page dots with the App Library's glyph.
import { createEffect, createSignal, For, Show, untrack } from "solid-js"
import { Button, type Element, haptic, Icon, Menu, Pressable, type Pressed, ReorderList, Sheet, Text, type Tip, Tips, View } from "ui"
import { BAR, DOTS } from "./layout.ts"
import { type Kind } from "./machine.ts"
import { looks } from "./looks.ts"
import { home, state, seen, along, rolled, at, screensOf, lastOf, editingNow, editingOwner, launcher, device } from "./store.ts"
import { onboarded, showOnboarding } from "./home.tsx"
import { group, type Owner, owners as all, reorder } from "./owners.ts"

/// A window onto a row for each owner, which rolls as the owners move up and down, `at` in owners, each row `height`
/// tall: the row nearest is laid out, and so says how wide the window is, and the others are drawn above and below
/// it, fading as they roll away, as a picker's do.
function Roll(props: { count: number; height: number; row: (index: number) => Element }) {
  const nearest = () => Math.max(0, Math.min(props.count - 1, Math.round(rolled())))
  // In the launcher each row goes where it's going by a spring, as the owners' pages roll.
  const rolling = () => launcher() && looks.rolling
  return (
    <View style={[looks.roll, looks.tall(props.height)]}>
      <View inert aria-hidden="true" style={[looks.rollSizer, looks.tall(props.height)]}>
        {props.row(nearest())}
      </View>
      <For each={Array.from({ length: props.count }, (_, index) => index)}>
        {(index) => (
          <View inert={index !== nearest() || undefined} style={[looks.row, rolling(), looks.top(0), looks.drifted(Math.max(0, 1 - Math.abs(index - rolled()) * 1.5), (index - rolled()) * props.height), looks.tall(props.height)]}>
            {props.row(index)}
          </View>
        )}
      </For>
    </View>
  )
}

/// An owner's page dots, a dot a screenful, the one shown brighter; tapping one goes there, and sliding along them
/// moves a screenful every 28 points, as an iPhone's do. While their pages are edited, a tap opens the page overview.
/// Only the owner shown's take a finger.
function Dots(props: { owner: Owner; index: number; count: number; size: number }) {
  const current = () => (seen().owner === props.index ? seen().screen : (lastOf()[props.index] ?? 0))
  // A dot a screenful, as many pages side by side as fit, the one shown lit; as the pages move, each is lit as much as
  // its screenful shows.
  // The App Library, after the last screenful of pages, lights the glyph and none of them.
  const library = () => screensOf()[props.index]?.indexOf("library") ?? -1
  const onLibrary = () => library() >= 0 && current() >= library()
  const lit = (screen: number) => !onLibrary() && screen === current()
  const shown = (screen: number) => {
    const from = seen().owner === props.index ? along() : current()
    return Math.max(0, Math.min(1, screen + 1 - from, from + 1 - screen))
  }
  const last = () => props.count - 1
  let slid: { x: number; from: number; sliding: boolean; id: number } | undefined
  let quietDots = 0
  const slide = {
    onPointerDown: (event: Pressed) => {
      if (editingOwner(props.index) || seen().owner !== props.index) return
      slid = { x: event.clientX, from: current(), sliding: false, id: event.pointerId }
    },
    onPointerMove: (event: Pressed) => {
      if (!slid || event.pointerId !== slid.id) return
      const across = event.clientX - slid.x
      if (!slid.sliding && Math.abs(across) < 10) return
      slid.sliding = true
      const screen = Math.max(0, Math.min(props.count, slid.from + Math.trunc(across / 28)))
      if (screen === current()) return
      home.send({ type: "go", screen })
      haptic("selection")
    },
    onPointerUp: () => {
      if (slid?.sliding) quietDots = Date.now() + 300
      slid = undefined
    },
    onPointerCancel: () => (slid = undefined),
  }
  const press = (screen: number) => () => {
    if (seen().owner !== props.index) return
    if (editingOwner(props.index)) return home.send({ type: "overview" })
    if (Date.now() > quietDots) home.send({ type: "go", screen: Math.max(0, Math.min(screen, last())) })
  }
  return (
    <View role="navigation" aria-label={`${props.owner.name}'s pages`} aria-hidden={seen().owner !== props.index ? "true" : undefined} {...slide} style={looks.dots}>
      <For each={Array.from({ length: Math.max(1, props.count) }, (_, at) => at)}>
        {(screen) => (
          <Pressable role="button" aria-label={`Page ${screen + 1} of ${props.count}`} aria-current={lit(screen) ? "true" : undefined} onPress={press(screen)} style={looks.dotButton}>
            <View style={[looks.dot, shown(screen) >= 0.5 && looks.dotLit, looks.dotAt(props.size, props.size * 0.64, 0.85 + 0.15 * shown(screen))]} />
          </Pressable>
        )}
      </For>
    </View>
  )
}

/// Edit Order's sheet: every owner in the order they're moved between, You first and Everyone last where they stay,
/// and your groups between, each dragged by its handle, as iOS's lists and macOS's System Settings reorder. Done keeps
/// the order for you on every device; closed any other way, it's as it was.
function EditOrder(props: { open: boolean; onClose: () => void }) {
  // Opened, it's the order they're in now.
  const [order, setOrder] = createSignal<Owner[]>([])
  createEffect(
    () => props.open,
    (open) => void (open && setOrder(untrack(all)!)),
  )
  const done = () => {
    reorder(order().filter(group).map((owner) => owner.subject!))
    props.onClose()
  }
  return (
    <Sheet heading="Edit Order" open={props.open} onClose={props.onClose}>
      <ReorderList label="Home Screens" each={order()} keyed={(owner) => owner.key} heading={(owner) => owner.name} fixed={(owner) => !group(owner)} onReorder={setOrder} />
      <View style={looks.orderDone}>
        <Button onPress={done}>Done</Button>
      </View>
    </Sheet>
  )
}

/// The owner pill, at the top of Home in the middle, and of the launcher's card: whose pages they are, "You ⌄", which
/// opens the list of every owner, the current one ticked, in a pill of Liquid Glass as the dots have, and after them
/// Edit Order…, which puts your groups in the order they come in, once there are two to order. Its name rolls as the
/// owners move. While pages are edited, + and Done are either side of it, and it opens nothing.
export function OwnerPill(props: { owners: Owner[] }) {
  const shown = () => at().owner
  return (
    <>
    <Menu.Root
      open={state().matches("listing")}
      // The machine as it is now, not as last drawn: Edit Order… has just moved it on as the menu closes.
      onOpenChange={(open) => (open ? home.getSnapshot().matches("nothing") && home.send({ type: "list" }) : home.getSnapshot().matches("listing") && home.send({ type: "dismiss" }))}
      onSelect={(value) => home.send(value === "order" ? { type: "order" } : { type: "pick", owner: Number(value) })}
    >
      <View style={[looks.pill, looks.glass, looks.ownerPill]}>
        <Menu.Trigger variant="ghost" shape="capsule" aria-label={props.owners[shown()]?.name}>
          <View style={looks.ownerRow}>
            <Roll count={props.owners.length} height={BAR - 8} row={(index) => <Text style={looks.ownerName}>{props.owners[index]?.name}</Text>} />
            <View style={looks.caret}>
              <Icon name="caret-down" />
            </View>
          </View>
        </Menu.Trigger>
      </View>
      <Menu.Positioner>
        <Menu.Content>
          {/* Each owner's item stays as the owners are asked for again, as anything changes, so a press on one isn't
              lost to a new one drawn in its place. */}
          <For each={props.owners} keyed={(owner) => owner.key}>
            {(owner, index) => (
              <Menu.Item value={String(index())}>
                <View style={looks.ownerItem}>
                  <View style={looks.opacity(index() === shown() ? 1 : 0)}>
                    <Icon name="check" />
                  </View>
                  <Text>{owner().name}</Text>
                </View>
              </Menu.Item>
            )}
          </For>
          <Menu.Separator />
          <Menu.Item value="order" disabled={props.owners.filter(group).length < 2}>
            <View style={looks.ownerItem}>
              <View style={looks.opacity(0)}>
                <Icon name="check" />
              </View>
              <Text>Edit Order…</Text>
            </View>
          </Menu.Item>
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
    <EditOrder open={state().matches("ordering")} onClose={() => state().matches("ordering") && home.send({ type: "dismiss" })} />
    </>
  )
}

/// The dots, at the bottom in the middle, just clear of the home indicator, floating with nothing behind them, as an
/// iPhone's are: the dots of the owner shown, then the App Library's glyph, which says there's one more page and goes
/// there, lit as it's reached, as the dots are. They stay where they are as the owners move, their dots rolling to the
/// next owner's and taking their number, and go with Home to the App Library, which has none. While pages are edited
/// the glyph stays, dimmed, and goes nowhere. The launcher's have no glyph (`glyph`): its App Library button does that.
export function DotsPill(props: { owners: Owner[]; laid: Kind[][]; glyph?: boolean }) {
  const count = (owner: number) => (props.laid[owner] ?? []).filter((kind) => kind === "home").length
  const library = () => props.laid[seen().owner]?.[seen().screen] === "library"
  const go = () => {
    if (state().matches("editing")) return
    const screen = props.laid[state().context.at.owner]?.indexOf("library") ?? -1
    if (screen >= 0) home.send({ type: "go", screen })
  }
  return (
    <View style={[looks.pill, looks.live, looks.tall(DOTS)]}>
      <Roll count={props.owners.length} height={DOTS} row={(index) => <Dots owner={props.owners[index]} index={index} count={count(index)} size={7} />} />
      <Show when={props.glyph !== false}>
        <Pressable
          role="button"
          aria-label="App Library"
          aria-current={library() ? "true" : undefined}
          aria-disabled={editingNow() ? "true" : undefined}
          onPress={go}
          style={[looks.libraryGlyph, library() && looks.lit, looks.opacity(editingNow() ? 0.35 : library() ? 1 : 0.4)]}
        >
          <View style={looks.smaller}>
            <Icon name="squares-four" />
          </View>
        </Pressable>
      </Show>
    </View>
  )
}

/// The ?, round and of glass as the pills are, at the end of the owner pill's row: the Home Screen's tips, for a
/// phone's Home and for the launcher's card, which a computer's shortcut summons from anywhere, ⌥Space on a Mac and
/// Super+Alt+Space elsewhere (computer.rs). Not while pages are edited, as Done is there.
export function TipsPill() {
  const shortcut = (): Tip[] => {
    const { target, web } = device()
    if (web) return []
    const mac = target?.startsWith("macos")
    const keys = mac ? ["⌥", "Space"] : [target?.startsWith("windows") ? "Win" : "Super", "Alt", "Space"]
    return [{ title: "Open it from anywhere", body: `Press ${keys.join(mac ? "" : "+")} in any app to bring this back.`, keys }]
  }
  const tips = (): Tip[] =>
    launcher()
      ? [
          ...shortcut(),
          { title: "Just start typing", body: "Type a few letters to find any app or widget.", picture: "tip-search.svg" },
          { title: "Turn the page", body: "Use ← and → or swipe with two fingers.", keys: ["left", "right"] },
          { title: "Every app, in one place", body: "Past your last page, the App Library has them all.", picture: "tip-library.svg" },
        ]
      : [
          { title: "Swipe for more pages", body: "Swipe left and right to move between your pages.", picture: "tip-pages.svg" },
          { title: "Touch and hold to edit", body: "Move apps, add widgets, or take an app off a page.", picture: "tip-touch.svg" },
          { title: "Switch whose Home", body: "Swipe up or down, or tap the name at the top.", picture: "tip-owners.svg" },
          { title: "Every app, in one place", body: "Past your last page, the App Library has them all.", picture: "tip-library.svg" },
        ]
  return (
    <View style={[looks.pill, looks.glass, looks.ownerPill]}>
      <Tips tips={tips()} action={onboarded() ? { label: "Show Onboarding Again", icon: "arrow-counter-clockwise", onAction: showOnboarding } : undefined} />
    </View>
  )
}
