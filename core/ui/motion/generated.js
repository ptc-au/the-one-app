// Plays generated scenes (gallery/generated.scenes.tsx): pages no app draws, each a random tree and its changes, under
// a person's random drags or wheel, every frame checked as it's drawn.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { here, out } from "./options.js"
import { build, pageFolder } from "./pages.js"
import { phone, run } from "./harness.js"

/// Mulberry32, as the page's own: a number from 0 to below 1, the same sequence for the same seed.
const random = (seed) => {
  // Mixed first, as seeds one apart start alike.
  seed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/// How long each page changes, in seconds, and a person's input goes on over it.
const SECONDS = 2

/// What seed `seed` plays: a phone's window under a finger or a computer's under a wheel, how many device pixels a
/// point, how often its display refreshes, and what the person does, as a trace's events: drags and flings, or a
/// wheel's notches and the pointer moved, anywhere in the window, over `SECONDS`.
export function played(seed) {
  const next = random(seed)
  const pick = (of) => of[Math.floor(next() * of.length)]
  const between = (least, most) => least + next() * (most - least)
  const touch = next() < 0.5
  const size = touch ? pick([[390, 844], [375, 667], [430, 932]]) : pick([[800, 600], [1024, 720], [640, 900]])
  const events = []
  for (let ms = between(0, 200); ms < SECONDS * 1000; ms += between(50, 500)) {
    const [x, y] = [between(10, size[0] - 10), between(80, size[1] - 80)]
    if (touch) {
      // A drag of 10 to 40 moves, a frame or so apart, lifted at speed (a fling) or held still first.
      const [dx, dy] = [between(-60, 60), between(-400, 400)]
      const moves = Math.round(between(10, 40))
      const every = between(6, 17)
      events.push({ ms, kind: "touch", phase: "down", x, y })
      for (let n = 1; n <= moves; n++) events.push({ ms: ms + n * every, kind: "touch", phase: "moved", x: x + (dx * n) / moves, y: y + (dy * n) / moves })
      ms += moves * every + (next() < 0.5 ? 0 : between(50, 200))
      events.push({ ms, kind: "touch", phase: "up", x: x + dx, y: y + dy })
    } else {
      events.push({ ms, kind: "move", x, y })
      for (let n = Math.round(between(1, 8)); n > 0; n--) events.push({ ms: (ms += between(16, 60)), kind: "wheel", x, y, notchesY: pick([-1, 1, 1, 2]), dy: 0 })
    }
  }
  return { touch, size, scale: touch ? pick([2, 3]) : pick([1, 2]), hz: pick([60, 120]), events }
}

/// Plays `count` seeds from `from`, four at a time: each frame drawn on what was kept must be the one drawn whole, and
/// drawn moved by whole device pixels the same (the harness's `replay`, `whole` and `moved`). → each line it says,
/// and how many failed.
export async function generated(count, from = 1) {
  const built = join(out, "generated", ".build")
  const unbuilt = build(here("gallery"), built)
  if (unbuilt) return { said: [`generated: ${unbuilt}`], failed: 1 }
  const said = []
  let [failed, frames] = [0, 0]
  const seeds = Array.from({ length: count }, (_, n) => from + n)
  for (let at = 0; at < seeds.length; at += 4)
    for (const line of await Promise.all(seeds.slice(at, at + 4).map(async (seed) => {
      const { touch, size, scale, hz, events } = played(seed)
      const folder = join(out, "generated", String(seed))
      mkdirSync(folder, { recursive: true })
      const link = `Generated/Random?seed=${seed}&seconds=${SECONDS}`
      const scene = phone({ name: link, page: "index.html", link, answers: {}, taps: [], size, touch, scale })
      const page = pageFolder(built, "index.html", folder)
      const done = await run(page, folder, scene, [{ op: "replay", events, hz, whole: true, moved: true, after: 1000 }], seed)
      const shown = `seed ${seed}: ${size.join("×")} pt at ${scale}× and ${hz} Hz, ${touch ? "a finger" : "a wheel"}`
      const replay = done.answers[0]
      if (done.failed || replay?.error) {
        failed++
        return `✗ ${shown}: the harness failed: ${replay?.error ?? done.said.split("\n").at(-1)}`
      }
      const drawn = replay.result.frames
      frames += drawn.length
      // Each frame that's wrong, with its pictures: as it was presented, drawn whole, and drawn where it is and moved.
      const wrong = drawn.flatMap((frame, n) => [
        ...(frame.unlike_whole ?? []).map(({ whole, presented, window, differ, most, box }) => {
          writeFileSync(join(folder, `${n}-whole.png`), Buffer.from(whole, "base64"))
          if (presented) writeFileSync(join(folder, `${n}-presented.png`), Buffer.from(presented, "base64"))
          return `frame ${n} (${frame.at} ms) differs from the same drawn whole in ${differ} pixels of window ${window}, by up to ${most} levels, from ${box.x},${box.y} ${box.width}×${box.height} px`
        }),
        ...(frame.unlike_moved ?? []).map(({ by, here, moved, differ, most, box }) => {
          writeFileSync(join(folder, `${n}-here.png`), Buffer.from(here, "base64"))
          writeFileSync(join(folder, `${n}-moved-${by.join(",")}.png`), Buffer.from(moved, "base64"))
          return `frame ${n} (${frame.at} ms) drawn moved by ${by.join(",")} px differs in ${differ} pixels, by up to ${most} levels, from ${box.x},${box.y} ${box.width}×${box.height} px`
        }),
      ])
      if (!wrong.length) return `✓ ${shown}: ${drawn.length} frames`
      failed++
      writeFileSync(join(folder, "wrong.txt"), wrong.join("\n"))
      return `✗ ${shown}: ${wrong.length} wrong of ${drawn.length} frames, the first ${wrong[0]} (${folder})`
    })))
      said.push(line)
  said.push(`${count - failed} seeds passed, ${failed} failed, ${frames} frames`)
  return { said, failed }
}
