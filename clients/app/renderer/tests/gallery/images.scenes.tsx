import { For } from "solid-js"
import { Avatar, type Face, Image, type Scenes, styles, Text, tokens, View } from "ui"

const look = styles({
  column: { gap: tokens.grid[3] },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.grid[3] },
  tile: { width: tokens.grid[8], height: tokens.grid[8], borderRadius: tokens.radius.medium },
  large: (width: number, height: number) => ({ width, height, borderRadius: tokens.radius.medium }),
})

/// A letter on a colour, as an SVG an app draws for an item with no icon of its own: its fill in oklch(), as CSS
/// colours are, and its letter as SVG text.
const tile = (letter: string, fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" style="fill:${fill}"/><text x="16" y="16" dy="0.35em" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="#fff">${letter}</text></svg>`)}`

/// A picture that takes a while to decode, as a large photo does: two circles blurred, which resvg draws at the
/// size it's shown. Its frame, drawn as it decodes in the background, doesn't wait for it (the headless renderer's
/// `worst_paint_ms`).
const blurred = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><filter id="b"><feGaussianBlur stdDeviation="30"/></filter><g filter="url(#b)"><circle cx="120" cy="120" r="90" fill="#e33"/><circle cx="280" cy="190" r="110" fill="#33e"/></g></svg>`)}`

/// A person's photo, drawn: a head and shoulders on a colour.
const photo = (ground: string, skin: string, shirt: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${ground}"/><circle cx="20" cy="16" r="7" fill="${skin}"/><path d="M6 40a14 13 0 0 1 28 0z" fill="${shirt}"/></svg>`)}`

/** A group's members, two with a photo and two with none, as a scene has them (it calls no tools). */
const members: Face[] = [
  { subject: "users/sam-lee", picture: photo("#f4c7a1", "#8a5a3b", "#3b6fb6") },
  { subject: "users/jo-park" },
  { subject: "users/ana-diaz", picture: photo("#cfe3d4", "#e0b48c", "#b6473b") },
  { subject: "users/kim-ng" },
]
const sizes = ["small", "medium", "large"] as const

const tiles = [
  ["G", "oklch(0.55 0.13 110)"],
  ["C", "oklch(0.55 0.13 15)"],
  ["E", "oklch(0.55 0.13 140 / 80%)"],
  ["H", "#3b82f6"],
] as const

export default {
  // Under the seeds a check is played with, a picture's first decode is cut short for one in three: it's tried again, and
  // drawn, never left blank.
  "Images/SVG tiles": {
    checks: { "Every tile is drawn": [{ expect: { text: "#3b82f6" } }] },
    render: () => (
      <View style={look.column}>
        <For each={tiles}>
          {(tile_) => (
            <View style={look.row}>
              <Image src={tile(tile_[0], tile_[1])} alt="" style={look.tile} />
              <Text>{tile_[1]}</Text>
            </View>
          )}
        </For>
      </View>
    ),
  },
  // A group's avatar, by how many of its members it's drawn with, 1 to 4, at each size, photos and initials mixed;
  // and last a group with no one in it, its initials on a rounded square.
  "Images/Group avatars": () => (
    <View style={look.column}>
      <For each={[1, 2, 3, 4]}>
        {(count) => (
          <View style={look.row}>
            <For each={sizes}>{(size) => <Avatar subject="groups/family" faces={members.slice(0, count)} size={size} />}</For>
            <Text>{count}</Text>
          </View>
        )}
      </For>
      <View style={look.row}>
        <For each={sizes}>{(size) => <Avatar subject="groups/family" name="Family" faces={[]} size={size} />}</For>
        <Text>None</Text>
      </View>
    </View>
  ),
  "Images/Slow to decode": () => <Image src={blurred} alt="" style={look.large(358, 268)} />,
  // A picture whose bytes aren't one, beside one that is: tried again, then shown broken, never as nothing. One that
  // says nothing (`alt=""`, only how a page looks) is nothing once it's broken, as a browser draws it: the last box is
  // empty.
  "Images/Broken": () => (
    <View style={look.row}>
      <Image src={tile("G", "oklch(0.55 0.13 110)")} alt="" style={look.tile} />
      <Image src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAAA" alt="A broken picture" style={look.tile} />
      <Image src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAAA" alt="" style={look.tile} />
    </View>
  ),
} satisfies Scenes
