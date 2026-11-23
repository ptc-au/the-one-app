// Who or what is shown by a picture: a person's, as they set it or Google has it, the network's icon, and else their
// initials on a colour of their own. Drawn on the drawing primitives, the same on every host.
import { createEffect, createSignal, Show } from "solid-js"
import { Image, Text, View } from "#primitives"
import { call, changed } from "#bridge"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

const look = styles({
  frame: { alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" },
  small: { width: tokens.grid[6], height: tokens.grid[6] },
  medium: { width: tokens.grid[8], height: tokens.grid[8] },
  large: { width: tokens.grid[16], height: tokens.grid[16] },
  // A person's is round; the network's is an app's icon, and a group's a rounded square.
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
})

/** The colours an avatar with no picture is, one by its subject, so it's the same wherever it shows. */
const fills = [look.blue, look.green, look.purple, look.orange, look.magenta, look.red]
const hue = (subject: string) => [...subject].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % fills.length

/** What a picture is kept for, in milliseconds, before the next avatar of its subject asks again: someone changes theirs on another device. */
const KEPT = 5 * 60 * 1000
const kept = new Map<string, { at: number; picture: Promise<string | null> }>()
const wanted = new Map<string, (picture: string | null) => void>()
/** How many pictures one ask is for, as `sign-in_pictures` takes. */
const MOST = 100

/** Asks for every picture the avatars drawn in this turn want, together. One that can't be had is none until it's asked for again. */
async function ask() {
  const subjects = [...wanted.keys()]
  const resolve = new Map(wanted)
  wanted.clear()
  for (let from = 0; from < subjects.length; from += MOST) {
    const these = subjects.slice(from, from + MOST)
    try {
      const { pictures }: { pictures: Record<string, string | null> } = JSON.parse(await call("sign-in_pictures", { subjects: these }))
      for (const subject of these) resolve.get(subject)!(pictures[subject] ?? null)
    } catch (error) {
      console.error(`Couldn't ask for the pictures of ${these.join(", ")}: ${(error as Error).message}`)
      for (const subject of these) {
        kept.delete(subject)
        resolve.get(subject)!(null)
      }
    }
  }
}

function picture(subject: string) {
  const known = kept.get(subject)
  if (known && Date.now() - known.at < KEPT) return known.picture
  const asked = new Promise<string | null>((resolve) => {
    if (wanted.size === 0) queueMicrotask(ask)
    wanted.set(subject, resolve)
  })
  kept.set(subject, { at: Date.now(), picture: asked })
  return asked
}

const [version, setVersion] = createSignal(0)
/// `refreshAvatars()`: has every avatar ask for its picture again, as it's set or changed in this page. Avatars ask
/// again by themselves as what the page was answered changes, and five minutes after they were last drawn.
export function refreshAvatars() {
  kept.clear()
  setVersion((was) => was + 1)
}
changed(refreshAvatars)

/** A subject's initials: its name's first two words' first letters, or its name's, `users/andre-van-tonder` being "AV". */
function initials(subject: string, name?: string) {
  const words = (name ?? subject.split("/").pop() ?? "").split(/[\s_-]+/).filter(Boolean)
  return words.slice(0, 2).map((word) => [...word][0].toUpperCase()).join("")
}

/// `<Avatar subject="users/andre" name="Andre" />`: who or what a thing is, as a picture: a person's (`users/…`), as they
/// set it in Sign In & Security, or the one Google has for them, round; the network's (`network`), its icon, as an
/// app's is rounded; and else the initials of `name` (a person's or a group's, by its id if there's none) on a colour of
/// their own, round for a person, a rounded square for a group. The picture is asked of Sign-In as the avatar is
/// drawn, with every other in the same turn, and shows as it arrives. `size` is `small` (24), `medium` (32, the default) or `large` (64).
export function Avatar(props: { subject: string; name?: string; size?: "small" | "medium" | "large" }) {
  const [src, setSrc] = createSignal<string | null>(null)
  createEffect(
    () => [props.subject, version()] as const,
    ([subject]) => {
      setSrc(null)
      picture(subject).then((found) => subject === props.subject && setSrc(found))
    },
  )
  const kind = () => (props.subject === "network" ? look.network : props.subject.startsWith("users/") ? look.person : look.group)
  return (
    <View aria-hidden="true" style={[look.frame, look[props.size ?? "medium"], kind(), !src() && (props.subject === "network" ? look.mark : fills[hue(props.subject)])]}>
      <Show when={src()} fallback={<Text style={[look.initials, props.size === "large" && look.initialsLarge]}>{initials(props.subject, props.name)}</Text>}>
        {(picture) => <Image src={picture()} alt="" style={[look.picture, kind()]} />}
      </Show>
    </View>
  )
}
