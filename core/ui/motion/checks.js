// Plays each scene's checks, walks it by Tab and draws it the same however it came to be.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PNG } from "pngjs"
import { messages } from "../src/words.ts"
import { dark, only, out, seeds } from "./options.js"
import { build, pageFolder } from "./pages.js"
import { run, panelled, scenesOf } from "./harness.js"
import { pressed } from "./gesture.js"
import { requests, unlike, unmoved } from "./judges.js"
import { legibility } from "./output.js"

/// A page that threw while drawing shows `render`'s Problem, "Can't show this page", and nothing to press but Try Again,
/// so what a check or the Tab walk finds there says nothing of the page; what it threw fails the harness's run (it's
/// logged, as Telemetry has it). The request that finds it at a run's end, and from its answer, whether it did.
const crash = { op: "query" }
const crashed = (answer) =>
  (answer?.result?.nodes ?? []).some((node) => node.name === messages.cantShowPage) ? `the page crashed, showing "${messages.cantShowPage}"` : undefined

/// Plays each check of `scene`, once as it is and with each seed. → each check's name and how each run went.
async function check(built, scene, folder) {
  const at = pageFolder(built, scene.page, folder, scene.uses)
  const taps = scene.taps.flatMap((tap) => [pressed(tap), { op: "clock", step: 1000 }])
  const played = Object.entries(scene.checks).flatMap(([name, steps]) =>
    [0, ...Array.from({ length: seeds }, (_, n) => n + 1), ...(scene.seeds ?? [])].map((seed) => ({ name, steps, seed })),
  )
  return Promise.all(
    played.map(async ({ name, steps, seed }) => {
      const ran = requests(steps, scene.from, scene.answers)
      const own = join(folder, name.replace(/[^\w.-]+/g, "-"), String(seed))
      mkdirSync(own, { recursive: true })
      const done = await run(at, own, scene, [{ op: "clock", step: 1000 }, ...taps, ...ran.map(({ request }) => request), crash], seed)
      const answers = done.answers.slice(1 + taps.length)
      const failed = done.failed
        ? `the harness failed: ${done.said.split("\n").at(-1)}`
        : crashed(answers[ran.length]) ?? ran.map(({ judge, request, step }, n) => (answers[n]?.error ? `${step} (${request.op}): ${answers[n].error}` : judge && judge(answers[n]) ? `${step}: ${judge(answers[n])}` : undefined)).find(Boolean)
      return { name, seed, failed }
    }),
  )
}

/// How many times a scene's keyboard is moved on by Tab, at most, as `walk` goes round it.
const STOPS = 40

/// The keyboard walked round a scene by Tab, as a person at a computer moves it: what it comes to must draw otherwise
/// where it is than it did before it came or after it left, as the OS's focus ring and the web's `:focus-visible` show
/// where it is. What scrolls into sight as it comes is judged by the picture it isn't moved in. → why it failed, or
/// nothing.
async function walk(built, scene, folder) {
  mkdirSync(folder, { recursive: true })
  const at = pageFolder(built, scene.page, folder, scene.uses)
  const taps = scene.taps.flatMap((tap) => [pressed(tap), { op: "clock", step: 1000 }])
  const look = [{ op: "query" }, { op: "snap" }]
  // Each picture two of the caret's blinks after the keyboard came, where a field's caret shows.
  const asked = [{ op: "clock", step: 1000 }, ...taps, ...look, ...Array.from({ length: STOPS }, () => [{ op: "key", key: "Tab" }, { op: "clock", step: 2400 }, ...look]).flat()]
  const done = await run(at, folder, scene, asked)
  if (done.failed) return `the harness failed: ${done.said.split("\n").at(-1)}`
  const answers = done.answers.slice(1 + taps.length)
  if (crashed(answers[0])) return crashed(answers[0])
  // Each stop: what had the keyboard, where it was drawn, and the picture.
  const stops = []
  for (let n = 0; n <= STOPS; n++) {
    const [query, snap] = [answers[n * 4], answers[n * 4 + 1]]
    const node = query?.result?.nodes?.find((node) => node.focused)
    if (!snap?.result?.png) return `step ${n}: ${snap?.error ?? query?.error ?? "no picture"}`
    stops.push({ node, picture: PNG.sync.read(Buffer.from(snap.result.png, "base64")) })
    // Round to where it started.
    if (n > 1 && node && node.node === stops[1].node?.node) break
  }
  // Where a node is, in points, is in the picture's device pixels (a Surface's two a point).
  const same = (one, other, rect) => {
    const scale = one.width / scene.size[0]
    const [x0, y0] = [Math.max(0, Math.floor((rect.x - 4) * scale)), Math.max(0, Math.floor((rect.y - 4) * scale))]
    const [x1, y1] = [Math.min(one.width, Math.ceil((rect.x + rect.width + 4) * scale)), Math.min(one.height, Math.ceil((rect.y + rect.height + 4) * scale))]
    for (let y = y0; y < y1; y++) if (one.data.compare(other.data, (y * one.width + x0) * 4, (y * one.width + x1) * 4, (y * one.width + x0) * 4, (y * one.width + x1) * 4) !== 0) return false
    return true
  }
  const unseen = []
  for (const [n, { node, picture }] of stops.entries()) {
    if (!n || !node?.rect || !(node.opacity > 0) || !(node.seen > 0)) continue
    const around = [stops[n - 1], stops[n + 1]].filter((other) => other && other.node?.node !== node.node)
    if (around.some((other) => same(picture, other.picture, node.rect))) unseen.push(`${node.role ?? node.kind} "${node.name ?? ""}"`)
  }
  return unseen.length ? `Tab's keyboard focus draws nothing on ${[...new Set(unseen)].join(", ")}` : undefined
}


/// How much of a window's images (its surface's, as `Renderer::memory` counts three, the frame it kept and spare ones,
/// its backdrops' and blurs) its renderers hold, as `memory` answers: hidden, a 1×1 surface's at most.
const images = (answer) => (answer?.result?.windows ?? []).flatMap((window) => window.renderers).reduce((all, held) => all + held.surface + held.canvas + held.spare + held.backdrop, 0)
const IMAGES_HIDDEN = 4096

/// A scene drawn the same however it came to be, as a frame drawn on what was kept from frames before must be, by what
/// changes under a page that isn't its own: opened and at rest, then after the app's been in the background and back
/// (`away`, which on an iPhone draws it in the other appearance and back for the app switcher, and puts a Mac's launcher
/// away as it takes the keyboard, so it's summoned again, as its person does), the system's appearance switched, hidden
/// under an app as a phone's root window is (a panel put away) and shown again, holding none of its window's images
/// meanwhile, and on a computer its window made smaller, but for a panel, which is as big as its page asks. And at rest
/// it's drawn the same moved by whole device pixels (`moved`), as a surface moved across its window must be. → why each
/// failed, or nothing: `{ fresh, moved }`.
async function agrees(built, scene, folder) {
  mkdirSync(folder, { recursive: true })
  const at = pageFolder(built, scene.page, folder, scene.uses)
  const taps = scene.taps.flatMap((tap) => [pressed(tap), { op: "clock", step: 1000 }])
  const rest = { op: "clock", step: 2000 }
  const changes = [
    ["at rest", []],
    ["back from the background", [{ op: "away", ms: 1000 }, ...(panelled(scene) ? [{ op: "summon" }] : [])]],
    [`switched to ${dark ? "Light" : "Dark"}`, [{ op: "appearance", dark: !dark }]],
    panelled(scene) ? ["put away and summoned again", [{ op: "put_away" }, { op: "memory" }, { op: "summon" }]] : ["hidden under an app and shown again", [{ op: "hide" }, { op: "memory" }, { op: "hide", hidden: false }]],
    ...(scene.touch || panelled(scene) ? [] : [["made smaller", [{ op: "resize", width: scene.size[0] - 120, height: scene.size[1] - 80 }]]]),
  ]
  const asked = [{ op: "clock", step: 1000 }, ...taps, { op: "query", text: "" }, ...OVER.map((role) => ({ op: "query", role, descendants: true })), { op: "snap" }, rest, { op: "moved" }, ...changes.flatMap(([, ops]) => [...ops, rest, { op: "fresh" }]), crash]
  const done = await run(at, folder, scene, asked)
  if (done.failed) return { fresh: `the harness failed: ${done.said.split("\n").at(-1)}` }
  const answers = done.answers.slice(1 + taps.length)
  if (crashed(answers.at(-1))) return { fresh: crashed(answers.at(-1)) }
  const moved = unmoved(answers[3 + OVER.length], join(folder, "moved"))
  const faint = illegible(answers[0], answers.slice(1, 1 + OVER.length), answers[1 + OVER.length], scene.size[0], folder)
  if (faint) return { moved, fresh: faint }
  let n = 4 + OVER.length
  for (const [what, ops] of changes) {
    const memory = ops.findIndex((op) => op.op === "memory")
    const held = memory < 0 ? 0 : images(answers[n + memory])
    if (held > IMAGES_HIDDEN) return { moved, fresh: `${what}: hidden, it still holds ${(held / 1e6).toFixed(1)} MB of images its window's size (its surface's, the frame it kept, its blurs)` }
    n += ops.length + 1
    const own = join(folder, what.replace(/[^\w.-]+/g, "-"))
    mkdirSync(own, { recursive: true })
    const why = unlike(answers[n++], own)
    if (why) return { moved, fresh: `${what}: ${why} (${own})` }
  }
  return { moved }
}

/// The least contrast (WCAG's ratio) a text drawn whole and in sight may have with what's behind it: the faintest any
/// scene draws is 2.2:1 in light and 2.8:1 in dark (22 Nov), and a text left in the other appearance's colour, as dark
/// text on a dark page, 1.2:1.
const LEGIBLE = 1.6

/// What's over the page and covers what's behind it, so only its own words are read where one is open.
const OVER = ["dialog", "alertdialog"]

/// Why some of a scene's words can't be read, if they can't: a text in sight, opaque, and inside what's `over` the page
/// where something is, whose ink stands off what's behind it at under LEGIBLE (`legibility`), of the `query` and `snap`
/// answers, in a window `points` wide. Every text's is kept in `folder`'s `words.json`.
function illegible(query, over, snap, points, folder) {
  if (!snap?.result?.png) return `no picture to read its words in: ${snap?.error ?? query?.error}`
  const picture = PNG.sync.read(Buffer.from(snap.result.png, "base64"))
  const covering = new Set(over.flatMap((answer) => (answer?.result?.nodes ?? []).map((node) => node.node)))
  const texts = (query?.result?.nodes ?? []).filter((node) => (!covering.size || covering.has(node.node)) && ["text", "raw-text"].includes(node.kind) && node.name?.trim() && node.rect && node.opacity > 0.99 && node.seen > 0.99 && node.rect.width >= 2 && node.rect.height >= 4)
  const read = texts.map((node) => ({ name: node.name, rect: node.rect, contrast: legibility(picture, points, node.rect) })).filter((text) => text.contrast !== undefined)
  writeFileSync(join(folder, "words.json"), JSON.stringify(read))
  const faint = read.filter((text) => text.contrast < LEGIBLE)
  return faint.length ? `its words can't be read: ${faint.slice(0, 3).map((text) => `"${text.name}" stands off what's behind it at ${text.contrast.toFixed(2)}:1, under ${LEGIBLE}:1`).join(", ")}${faint.length > 3 ? `, and ${faint.length - 3} more` : ""}` : undefined
}

/// Plays every check of `targets`' scenes, every target and scene at once, its harnesses as many at once as `jobs`.
/// → each line it says, in the order of `targets` and their scenes, and how many failed.
export async function checks(targets) {
  const played = await Promise.all(
    targets.map(async (target) => {
      const name = target.endsWith("core/ui/gallery") ? "gallery" : target.split("/").at(-1)
      const built = join(out, name, ".build")
      const unbuilt = await build(target, built)
      if (unbuilt) return [{ said: [`${name}: ${unbuilt}`], failed: 1, passed: 0 }]
      // Every scene is drawn the same however it came to be, each on a computer walked by Tab too, and those with checks
      // played.
      const scenes = (await scenesOf(target, built, join(out, name, ".scenes"), true)).filter((scene) => !only || scene.name.toLowerCase().includes(only))
      return Promise.all(
        scenes.map(async (scene) => {
          // A trace a check plays is beside its scenes: the gallery's, or an app's client.
          scene.from = target.endsWith("core/ui/gallery") ? target : join(target, "client")
          const own = join(out, name, scene.name.replace(/[^\w.-]+/g, "-"))
          const [results, tab, { fresh, moved }] = await Promise.all([scene.checks ? check(built, scene, own) : [], scene.touch ? undefined : walk(built, scene, join(own, "tab")), agrees(built, scene, join(own, "fresh"))])
          if (!scene.touch) results.push({ name: "Tab shows where the keyboard is", seed: 0, failed: tab })
          results.push({ name: "Drawn the same however it came to be", seed: 0, failed: fresh }, { name: "Drawn the same moved by whole device pixels", seed: 0, failed: moved })
          const said = []
          let [failed, passed] = [0, 0]
          for (const [check, runs] of Object.entries(Object.groupBy(results, (result) => result.name))) {
            const bad = runs.filter((run) => run.failed)
            bad.length ? failed++ : passed++
            said.push(`${bad.length ? "✗" : "✓"} ${name} · ${scene.name} · ${check}${bad.length ? "" : ` (${runs.length} runs)`}`)
            for (const run of bad) said.push(`    ${run.seed ? `seed ${run.seed}` : "as it is"}: ${run.failed}`)
          }
          return { said, failed, passed }
        }),
      )
    }),
  )
  const all = played.flat()
  const [failed, passed] = [all.reduce((sum, scene) => sum + scene.failed, 0), all.reduce((sum, scene) => sum + scene.passed, 0)]
  return { said: [...all.flatMap((scene) => scene.said), `${passed} checks passed, ${failed} failed`], failed }
}
