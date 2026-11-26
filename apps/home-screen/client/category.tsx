import { createEffect, createMemo, createSignal, For } from "solid-js"
import { covers, keydown, type Laid, Pressable, reducedMotion, type Rect, ScrollView, Text, View, viewport } from "ui"
import { type Entrypoint } from "./types.ts"
import { looks } from "./looks.ts"
import { along, home, room, tapping, windowWidth } from "./store.ts"
import { type Owner, badgeOf, opens, press } from "./owners.ts"
import { holds } from "./holds.ts"
import { Tile } from "./tiles.tsx"
import { openedCategory, places } from "./library.tsx"

/// How large an opened category's apps' icons are, how wide each is with its name, and the gap between them across,
/// as `sizes.found` and `looks.openedApps` have them.
const [ICON, APP, APART] = [60, 76, 12]

/// A category opened over its App Library, as an iPhone's is: the whole screen (in the launcher, its card), its name as
/// a large title over all its apps in a grid, as Home's, which scrolls, over the App Library blurred and lightly
/// veiled. It zooms out of its square and back into it whole, as an iOS folder does, its name and its apps' with it:
/// closed, its grid is as wide as the square and at its top, wherever the square is, on one spring the renderer draws,
/// with no bounce, the veil and the blur with it, turning back from wherever it's got to. Opening, the square goes at
/// once and it comes in quickly over it; closing, it fades as it shrinks while the square fades back in, on the same
/// spring, so they're handed over as one. Tapping beside its apps, Escape or the
/// device's own back closes it at once, however far it's got: what's still moving is the renderer's to finish. For
/// whoever asked for less motion, it fades. It's made ahead (`made`, as a press goes down on its square) and kept made,
/// closed, on its square and not shown, taking nothing, so the frame it opens or closes on only changes how it's drawn.
export function OpenCategory(props: { owner: Owner; made: string; open: boolean; within?: Rect }) {
  const category = () => openedCategory(props.owner.library, props.made)
  const close = () => home.send({ type: "close" })
  // Open, the device's own back and Escape close it.
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return
      const shut = covers(close)
      const keys = keydown((event) => event.key === "Escape" && close())
      return () => (shut(), keys())
    },
  )
  // Emptied while it's open, every app in it uninstalled, it closes, as an iPhone's folder does.
  createEffect(
    () => props.open && !category(),
    (emptied) => void (emptied && close()),
  )
  const area = () => props.within ?? { x: 0, y: 0, width: windowWidth(), height: viewport().height }
  // Where its apps start: under its title, in from the area's side.
  const inset = () => (props.within ? { top: 24, inline: 24, bottom: 24 } : { top: room().safe.top + 108, inline: 24 + room().safe.left, bottom: 32 + room().safe.bottom })
  // Where its name and its apps are in it, open, and its grid of apps: measured as each category is made in it, and
  // again as the area's width changes, which moves its columns. Till then it isn't zoomed and has no transition, so
  // it's laid out whole, and goes straight to its square once it's measured, not on its way there.
  const [laid, setLaid] = createSignal<{ content?: Rect; grid?: Rect }>({})
  const measured = () => (laid().content && laid().grid ? (laid() as { content: Rect; grid: Rect }) : undefined)
  const measure = (part: "content" | "grid") => (event: Laid) => {
    const at = event.currentTarget.getBoundingClientRect()
    setLaid((laid) => ({ ...laid, [part]: { ...at, x: at.x - area().x, y: at.y - area().y } }))
  }
  const measuring = createMemo(() => `${props.made} ${area().width}`)
  createEffect(measuring, () => void setLaid({}))
  // It moves once it's first opened since then: shrunk onto its square before, it's there at once, so it's opened from
  // there, not from on its way.
  const [moves, setMoves] = createSignal(false)
  createEffect(measuring, () => void setMoves(false))
  createEffect(
    () => props.open,
    (open) => void (open && setMoves(true)),
  )
  // The pages it's on can be swiped while it shrinks home, as the screen is a screen again the moment it closes, and its
  // square goes with them: it goes to where the square is, not where it was.
  const square = () => places[props.made]
  const carried = () => (props.open || !square() ? 0 : (square()!.along - along()) * room().width)
  // Closed, it's drawn shrunk onto its square, grown around its middle: its grid as wide as the square and at its top.
  // With less motion it stays where it is and fades, as an iPhone's folder does.
  const zoom = () => {
    const [at, from] = [measured(), square()]
    if (props.open || reducedMotion() || !at || !from) return undefined
    const scale = Math.max(from.width / at.grid.width, 0.01)
    const [middleX, middleY] = [at.content.x + at.content.width / 2, at.content.y + at.content.height / 2]
    const [toX, toY] = [from.x + carried() - area().x, from.y - area().y]
    return looks.scaledAt(scale, toX - middleX - scale * (at.grid.x - middleX), toY - middleY - scale * (at.grid.y - middleY))
  }
  // In a launcher's card, its name and its apps are a column in the card's middle, as Home's pages are, as wide as its
  // apps take, as a Mac's Launchpad's folder is; a phone's are its whole screen, as an iPhone's.
  const column = () => {
    if (!props.within) return undefined
    const room = area().width - 2 * inset().inline
    const across = Math.max(1, Math.min(category()?.entrypoints.length ?? 1, Math.floor((room + APART) / (APP + APART))))
    return looks.wide(across * APP + (across - 1) * APART)
  }
  // A tap beside its apps closes it; one on an app is the app's (`Pressable`).
  const beside = () => tapping() && close()
  return (
    <View aria-hidden={props.open ? undefined : "true"} style={[looks.dialog, looks.categoryLayer, !props.open && looks.inert, looks.sized(windowWidth(), viewport().height)]}>
      {/* What's behind blurs and is veiled. */}
      <Pressable aria-hidden="true" onPress={close} style={[looks.cover, looks.folderVeil, looks.veils, !props.open && looks.unveiled, props.within && looks.round, props.within && looks.at(area().x, area().y, area().width, area().height)]} />
      <View role="dialog" aria-description={JSON.stringify([zoom(), measured(), square(), moves()])} aria-label={category()?.category} style={[looks.opening, props.within && looks.round, looks.at(area().x, area().y, area().width, area().height)]}>
        <View style={looks.inOpened}>
          <ScrollView style={[looks.openedArea, !props.open && looks.inert, looks.sized(area().width, area().height)]}>
            <Pressable onPress={beside} style={[props.within && looks.centred, looks.libraryPadding(inset().inline, inset().top, inset().bottom), looks.atLeast(area().height)]}>
              <View onLayout={laid().content ? undefined : measure("content")} style={[looks.zoomed, (props.open || moves()) && looks.zooms, zoom()]}>
              <View style={[looks.zoomedColumn, props.open ? looks.fadesIn : moves() ? looks.fadesOut : looks.unseen]}>
              <Text role="heading" aria-level={2} style={[looks.categoryTitle, column()]}>
                {category()?.category}
              </Text>
              <View role="group" aria-label={category()?.category} style={[looks.openedApps, column()]} onLayout={laid().grid ? undefined : measure("grid")}>
                <For each={category()?.entrypoints ?? []} keyed={(entrypoint) => entrypoint.entrypoint ?? entrypoint.app}>
                  {(entrypoint) => {
                    // What's held here is an app of the App Library, as there: its menu, or carried onto Home's pages.
                    const held = holds(() => ({ item: opens(entrypoint()), listed: entrypoint(), page: 0, index: -1, from: "library" }), () => true)
                    return <Tile name={entrypoint().name} icon={entrypoint().icon} size={ICON} scale={1} badge={badgeOf(entrypoint() as Entrypoint, props.owner)} holds={held} onPress={(behind, from) => press(entrypoint(), props.owner, behind, from)} />
                  }}
                </For>
              </View>
              </View>
              </View>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </View>
  )
}
