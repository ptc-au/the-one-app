// Who or what is shown by a picture: a person's, as they set it or Google has it, the network's icon, a group's
// members' faces, and else their initials on a colour of their own. Drawn on the drawing primitives, the same on every host.
import { createEffect, createSignal, For, Show, untrack } from "solid-js"
import { Image, Text, View } from "#primitives"
import { call } from "#bridge"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

/** Each size across, in points where the grid's rem is 16, which a group's rings and initials are sized by, as Forge's are. */
const across = { small: 24, medium: 32, large: 64 } as const

const look = styles({
  frame: { alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" },
  small: { width: tokens.grid[6], height: tokens.grid[6] },
  medium: { width: tokens.grid[8], height: tokens.grid[8] },
  large: { width: tokens.grid[16], height: tokens.grid[16] },
  // A person's is round; the network's is an app's icon, and a group's with no one in it a rounded square.
  person: { borderRadius: tokens.radius.full },
  network: { borderRadius: tokens.radius.icon },
  group: { borderRadius: tokens.radius.medium },
  picture: { width: "100%", height: "100%" },
  initials: { font: tokens.type.small, fontWeight: tokens.weight.semibold, color: tokens.colour.label },
  initialsLarge: { font: tokens.type.title },
  mark: { backgroundColor: tokens.colour.tile },
  blue: { backgroundColor: tokens.colour.blueTint },
  green: { backgroundColor: tokens.colour.greenTint },
  purple: { backgroundColor: tokens.colour.purpleTint },
  orange: { backgroundColor: tokens.colour.orangeTint },
  magenta: { backgroundColor: tokens.colour.magentaTint },
  red: { backgroundColor: tokens.colour.redTint },
  faces: { position: "relative", flexShrink: 0 },
  // A face of a group's, placed as a part of the whole, over a ring of the background's colour a little wider, which
  // keeps it apart from the face it overlaps.
  place: (start: `${number}%`, top: `${number}%`, width: `${number}%`, height: `${number}%`, zIndex: number) => ({ position: "absolute", start, top, width, height, zIndex }),
  ring: (inset: number) => ({ position: "absolute", start: inset, top: inset, end: inset, bottom: inset }),
  ringFill: { borderRadius: tokens.radius.full, backgroundColor: tokens.colour.background },
  face: { position: "absolute", start: 0, top: 0, end: 0, bottom: 0, alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: tokens.radius.full },
  faceInitials: (fontSize: number) => ({ fontSize, lineHeight: fontSize, fontWeight: tokens.weight.medium, color: tokens.colour.label }),
})

/** The colours an avatar with no picture is, one by its subject, so it's the same wherever it shows. */
const fills = [look.blue, look.green, look.purple, look.orange, look.magenta, look.red]
const hue = (subject: string) => [...subject].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % fills.length

/** A face a group is drawn with: one of its members, and their picture where they have one. */
export type Face = { subject: string; name?: string; picture?: string | null }
/** What Sign-In says a subject is drawn with: its picture, and a group's faces. */
type Seen = { picture: string | null; faces?: Face[] }

/** Where each of a group's faces sits, as Forge's GroupAvatar and an iMessage group place them: one fills the
 * circle, two overlap on a diagonal, three make a triangle, four sit in a square. Each [left, top, across], as parts
 * of the whole. */
const layouts: Record<number, [number, number, number][]> = {
  1: [[0, 0, 1]],
  2: [[0, 0, 0.64], [0.36, 0.36, 0.64]],
  3: [[0.23, 0, 0.54], [0, 0.46, 0.54], [0.46, 0.46, 0.54]],
  4: [[0, 0, 0.5], [0.5, 0, 0.5], [0, 0.5, 0.5], [0.5, 0.5, 0.5]],
}

/** What a picture is kept for, in milliseconds, before the next avatar of its subject asks again: someone changes theirs on another device. */
const KEPT = 5 * 60 * 1000
const kept = new Map<string, { at: number; seen: Promise<Seen> }>()
/** What each subject was last answered, which an avatar of it is drawn with at once, as it mounts again and while it's asked again. */
const known = new Map<string, Seen>()
const wanted = new Map<string, (seen: Seen) => void>()
/** How many pictures one ask is for, as `sign-in_pictures` takes. */
const MOST = 100

/** Asks for every picture the avatars drawn in this turn want, together. One that can't be had, as a non-member is refused, is none, kept as an answer is, until `KEPT` has passed or `refreshAvatars`. */
async function ask() {
  const subjects = [...wanted.keys()]
  const resolve = new Map(wanted)
  wanted.clear()
  for (let from = 0; from < subjects.length; from += MOST) {
    const these = subjects.slice(from, from + MOST)
    try {
      // `members` is new beside `pictures`: a network whose Sign-In is older answers none, and a group is its initials.
      const { pictures, members = {} }: { pictures: Record<string, string | null>; members?: Record<string, string[]> } = JSON.parse(await call("sign-in_pictures", { subjects: these }))
      for (const subject of these) {
        const answer = { picture: pictures[subject] ?? null, faces: members[subject]?.map((member) => ({ subject: member, picture: pictures[member] })) }
        // The same as before is the same object, so nothing drawn with it is drawn again.
        if (JSON.stringify(answer) !== JSON.stringify(known.get(subject))) known.set(subject, answer)
        resolve.get(subject)!(known.get(subject)!)
      }
    } catch (error) {
      console.error(`Couldn't ask for the pictures of ${these.join(", ")}: ${(error as Error).message}`)
      for (const subject of these) resolve.get(subject)!(known.get(subject) ?? { picture: null })
    }
  }
}

function seen(subject: string) {
  const known = kept.get(subject)
  if (known && Date.now() - known.at < KEPT) return known.seen
  const asked = new Promise<Seen>((resolve) => {
    if (wanted.size === 0) queueMicrotask(ask)
    wanted.set(subject, resolve)
  })
  kept.set(subject, { at: Date.now(), seen: asked })
  return asked
}

const [version, setVersion] = createSignal(0)
/// `refreshAvatars()`: has every avatar ask for its picture again, as it's set or changed in this page. Avatars ask
/// again by themselves five minutes after they were last drawn, as a picture changed on another device is drawn: not
/// as the page is told something changed, which it is as often as anything does, and every picture was asked for again.
export function refreshAvatars() {
  kept.clear()
  setVersion((was) => was + 1)
}

/** A subject's initials: its name's first two words' first letters, or its name's, `users/andre-van-tonder` being "AV". */
function initials(subject: string, name?: string) {
  const words = (name ?? subject.split("/").pop() ?? "").split(/[\s_-]+/).filter(Boolean)
  return words.slice(0, 2).map((word) => [...word][0].toUpperCase()).join("")
}

/// `<Avatar subject="users/andre" name="Andre" />`: who or what a thing is, as a picture: a person's (`users/…`), as they
/// set it in Sign In & Security, or the one Google has for them, round; the network's (`network`), its icon, as an
/// app's is rounded; a group's (`groups/…`), up to four of its members' faces, those with a picture first, as an
/// iMessage group's; and else the initials of `name` (a person's or a group's with no one in it, by its id if there's
/// none) on a colour of their own, round for a person, a rounded square for a group. The pictures are asked of Sign-In
/// as the avatar is drawn, with every other in the same turn, and show as they arrive; `faces`, where they're known
/// already (a scene's, which calls no tools), are drawn as they are. `size` is `small` (24), `medium` (32, the default)
/// or `large` (64). A subject's picture once had is drawn at once wherever it's drawn again, and kept while it's asked again.
export function Avatar(props: { subject: string; name?: string; size?: keyof typeof across; faces?: Face[] }) {
  const [found, setFound] = createSignal<Seen>(untrack(() => known.get(props.subject)) ?? { picture: null })
  createEffect(
    () => [props.faces ? undefined : props.subject, version()] as const,
    ([subject], was) => {
      if (subject !== was?.[0]) setFound((subject && known.get(subject)) || { picture: null })
      if (subject) seen(subject).then((answer) => subject === props.subject && setFound(answer))
    },
  )
  const size = () => across[props.size ?? "medium"]
  const src = () => found().picture
  const faces = () => (props.faces ?? found().faces ?? []).slice(0, 4)
  const kind = () => (props.subject === "network" ? look.network : props.subject.startsWith("users/") ? look.person : look.group)
  return (
    <Show
      when={faces().length}
      fallback={
        <View aria-hidden="true" style={[look.frame, look[props.size ?? "medium"], kind(), !src() && (props.subject === "network" ? look.mark : fills[hue(props.subject)])]}>
          <Show when={src()} fallback={<Text style={[look.initials, props.size === "large" && look.initialsLarge]}>{initials(props.subject, props.name)}</Text>}>
            {(picture) => <Image src={picture()} alt="" style={[look.picture, kind()]} />}
          </Show>
        </View>
      }
    >
      <View aria-hidden="true" style={[look.faces, look[props.size ?? "medium"]]}>
        <For each={faces()}>
          {(face, index) => {
            const placed = () => {
              const [left, top, part] = layouts[faces().length][index()]
              // The first face is on top, so the pictures, which come first, are never under initials.
              const percent = (part: number) => `${Math.round(part * 1000) / 10}%` as const
              const across = size() * part
              return { start: percent(left), top: percent(top), part: percent(part), across, ring: faces().length > 1 && (across >= 20 ? "wide" : "thin"), above: faces().length - index() }
            }
            return (
              <View style={look.place(placed().start, placed().top, placed().part, placed().part, placed().above)}>
                <Show when={placed().ring}>{(ring) => <View style={[look.ring(ring() === "thin" ? -1.5 : -2), look.ringFill]} />}</Show>
                <View style={[look.face, !face.picture && fills[hue(face.subject)]]}>
                  <Show when={face.picture} fallback={<Text style={look.faceInitials(Math.max(7, Math.round(placed().across * 0.4)))}>{initials(face.subject, face.name)}</Text>}>
                    {(picture) => <Image src={picture()} alt="" style={[look.picture, look.person]} />}
                  </Show>
                </View>
              </View>
            )
          }}
        </For>
      </View>
    </Show>
  )
}
