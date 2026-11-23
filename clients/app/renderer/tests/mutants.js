#!/usr/bin/env bun
// Mutation testing for the headless renderer: puts back each bug we've had (a mutant, as cargo-mutants and Stryker call one),
// one at a time, runs the checks that could show it, and says which caught it, by which check, and which it missed:
//
//     bun mutants.js [<mutant>…] [--light | --dark] [--out <dir>] [--jobs <n>] [--list]
//
// Each mutant is planted where its bug was (`renderer::mutants`, `ONE_MUTANT=<name>`, in the headless renderer's builds alone:
// the headless renderer's and the web gate's frame) and plays only the scenes, motions and checks
// that could show it, light and dark (or the one asked), so a run is as short as it can be. First, as cargo-mutants
// does, every play runs with no mutant (the baseline): one that fails then catches nothing, and is said. It exits 1
// where a mutant was missed or the baseline failed. What each run said is kept in `--out` (`target/mutants` unless
// said), `<mutant>/<light|dark>/<play>.log`.
//
// It builds what it plays first: core/ui (`bun build.js`), and the headless renderer, a release build, which plays them
// several times faster than a debug build (animation.js's `built`); screenshot.js builds the web's frame.
//
// A mutant for a bug a device found and the headless renderer missed is added here with the check that now catches it: the check
// is the fix's, the mutant shows it stays caught.
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { jobs as renderers, pLimit } from "./animation/options.js"

const root = resolve(import.meta.dir, "../../../..")
const here = import.meta.dir
const args = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const out = resolve(option("--out") ?? join(root, "target/mutants"))

/// What plays a mutant: `animation` (animation.js's motions), `checks` (animation.js --checks: a scene's checks, its Tab walk and
/// its being drawn the same however it came to be), `web` (screenshot.js --web: native and the web's frame), `screenshot`
/// (screenshot.js natively), each of a folder's scenes whose names have `scene`'s words.
const animation = (folder, scene) => ({ tool: "animation", folder, scene })
const checks = (folder, scene) => ({ tool: "checks", folder, scene })
const web = (folder, scene) => ({ tool: "web", folder, scene })
const screenshot = (folder, scene) => ({ tool: "screenshot", folder, scene })

/// Every mutant: the bug it puts back, what plays it, and the appearances it can show in (both unless said).
const MUTANTS = {
  "damage-short": { bug: "a damage rectangle 1 px short", plays: [animation("clients/app/renderer/tests/gallery", "Card dragged along")] },
  "dropped-refresh": { bug: "a dropped refresh while moving", plays: [animation("clients/app/renderer/tests/gallery", "Card dragged along")] },
  "double-frame": { bug: "a frame drawn twice in one refresh", plays: [animation("clients/app/renderer/tests/gallery", "Card dragged along")] },
  "late-tick-held": { bug: "a window held a refresh where its link said the refresh a fraction of a ms sooner than the tick before (a Surface's windows drew every other refresh, 22 Nov)", plays: [animation("clients/app/renderer/tests/gallery", "Motion/Long list")] },
  "paint-order": { bug: "the wrong paint order for positioned elements", plays: [checks("clients/app/renderer/tests/gallery", "Styling/Painting order")] },
  "dark-token": { bug: "dark mode not applied to one token (the text's, `label`)", plays: [checks("clients/app/renderer/tests/gallery", "Text/Type styles")], only: "dark" },
  "rounded-clip": { bug: "rounded clip off", plays: [checks("clients/app/renderer/tests/gallery", "Styling/Rounded corners clip")] },
  "text-stretched": { bug: "text drawn from a stretched picture", plays: [animation("clients/app/renderer/tests/gallery", "Text/Flying")] },
  "late-tap": { bug: "a tap delivered a frame late", plays: [checks("clients/app/renderer/tests/gallery", "Buttons/Pressed")] },
  "stale-rect": { bug: "a stale inspector rect", plays: [animation("clients/app/renderer/tests/gallery", "Text/Flying")] },
  "wrong-node": { bug: "a selector matching the wrong node", plays: [checks("clients/app/renderer/tests/gallery", "Buttons/Alike")] },
  "web-clock": { bug: "the web clock running during the gate", plays: [web("clients/app/renderer/tests/gallery", "Text/Type styles")] },
  "web-blank": { bug: "a blank web canvas", plays: [web("clients/app/renderer/tests/gallery", "Text/Type styles")] },
  "spring-rest": { bug: "spring rest at 0.1 pt", plays: [animation("clients/app/renderer/tests/gallery", "Card dragged along")] },
  "safe-area": { bug: "safe area ignored in a frame", plays: [screenshot("apps/vault", "in its own frame")] },
  // From the reports and look-issues.
  "held-redraw": { bug: "what the finger holds still drawn again each third frame (L86)", plays: [animation("clients/app/renderer/tests/gallery", "Card dragged along")] },
  "surface-dropped": { bug: "a moving surface dropped and what's in it painted again each third frame", plays: [animation("clients/app/renderer/tests/gallery", "Card dragged along")] },
  "hit-layer": { bug: "what a moving layer draws taking a press where it rests, not where it's drawn", plays: [checks("clients/app/renderer/tests/gallery", "Styling/Hit areas")] },
  "leaving-loop": { bug: "what's closed with a spinner in it never gone, its see-through scrim taking every press (Vault on Andre's Mac and ptcau.app in Chrome, 23 Nov)", plays: [checks("clients/app/renderer/tests/gallery", "Over the page/A sheet closed as something's under way")] },
  "leaving-pointer": { bug: "what's in a layer drawn going taking a press where its style says it takes the pointer, as a sheet's scrim did", plays: [checks("clients/app/renderer/tests/gallery", "Over the page/A sheet closed as something's under way")] },
  "hit-scroll": { bug: "what's in a scroll taking a press where it'd be unscrolled", plays: [checks("clients/app/renderer/tests/gallery", "Styling/Hit areas")] },
  // Planted hangs (22 Nov, a Surface's Intel driver hung on our frames): the app recovers on a new device, or stops
  // saying why, never freezes, and the headless renderer fails.
  "gpu-hang": { bug: "a fence that never signals: the GPU hung on a frame, which the system never says", plays: [checks("clients/app/renderer/tests/gallery", "Buttons/Pressed")] },
  "present-hang": { bug: "a present that never returns: the GPU's driver hung", plays: [checks("apps/settings", "Recently Deleted, an app and its older copy")] },
  "summon-after-draw": { bug: "a panel summoned before it had drawn put on the screen only once it had, which a Mac never lets it (The PTC App's launcher opened again on its app's new version, blank, 23 Nov)", plays: [checks("apps/home-screen", "Launcher on a computer")] },
  "picture-retry": { bug: "a picture that failed to decode left blank, never tried again (f0db8c31f)", plays: [checks("clients/app/renderer/tests/gallery", "Images/SVG tiles")] },
}

if (args.includes("--list")) {
  for (const [name, { bug, plays }] of Object.entries(MUTANTS)) console.log(`${name}: ${bug} (${plays.map(said).join("; ")})`)
  process.exit(0)
}
const asked = args.filter((arg, at) => !arg.startsWith("--") && !["--out", "--jobs"].includes(args[at - 1]))
const unknown = asked.filter((name) => !MUTANTS[name])
if (unknown.length) throw new Error(`no mutant ${unknown.join(", ")}: \`bun mutants.js --list\` lists them`)
const chosen = asked.length ? asked : Object.keys(MUTANTS)
const appearances = args.includes("--light") ? ["light"] : args.includes("--dark") ? ["dark"] : ["light", "dark"]

/// A play, as it's said.
function said(play) {
  return `${play.tool} ${play.folder.split("/").at(-1)} "${play.scene}"`
}

/// The command a play runs, in light or dark, its output in `folder`.
function command(play, dark, folder) {
  const theme = ["--release", ...(dark ? ["--dark"] : [])]
  if (play.tool === "animation") return { cwd: here, argv: ["bun", "animation.js", join(root, play.folder), "--scene", play.scene, "--out", folder, ...theme] }
  if (play.tool === "checks") return { cwd: here, argv: ["bun", "animation.js", "--checks", join(root, play.folder), "--scene", play.scene, "--out", folder, ...theme] }
  return { cwd: here, argv: ["bun", "screenshot.js", join(root, play.folder), "--scene", play.scene, "--out", folder, ...(play.tool === "web" ? ["--web"] : []), ...theme] }
}

/// The lines of what a play said that failed it: a motion's `FAILS` (under the motion it's of), a check's `✗` and
/// why, a scene's `✗` (under the scene it's of).
function failures(text) {
  const lines = text.split("\n")
  const found = []
  let heading
  for (const [at, line] of lines.entries()) {
    if (/^\S.* · /.test(line) && !line.startsWith("✗") && !line.startsWith("✓")) heading = line
    if (line.includes("FAILS") || /^\s*✗ /.test(line)) {
      if (heading && !/^✗ /.test(line)) found.push(`${heading}: ${line.trim()}`)
      else found.push(line.trim())
      if (line.startsWith("✗ ")) for (const next of lines.slice(at + 1)) if (/^ {4}\S/.test(next)) found.push(`  ${next.trim()}`); else break
    }
  }
  return found
}

/// Runs `play` with `mutant` (or none), in light or dark. → whether it failed, and the lines that did.
async function run(play, mutant, dark) {
  const folder = join(out, mutant ?? "baseline", dark ? "dark" : "light", said(play).replace(/[^\w.-]+/g, "-"))
  mkdirSync(folder, { recursive: true })
  const { cwd, argv } = command(play, dark, folder)
  const ran = Bun.spawn([...argv, "--jobs", "2"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ONE_MUTANT: mutant ?? "" } })
  const [stdout, stderr] = await Promise.all([new Response(ran.stdout).text(), new Response(ran.stderr).text(), ran.exited])
  writeFileSync(`${folder}.log`, `${argv.join(" ")}\n\n${stdout}\n${stderr}`)
  const lines = failures(stdout)
  const failed = ran.exitCode !== 0
  // One that stopped without a check failing (it didn't build, or crashed) shows nothing of the mutant.
  const broke = failed && !lines.length && (stderr.trim().split("\n").find((line) => /error/i.test(line)) ?? `it exited ${ran.exitCode}`)
  return { failed, broke, lines: broke ? [broke] : lines }
}

const started = performance.now()
const minutes = () => `${((performance.now() - started) / 60000).toFixed(1)} min`
for (const [what, argv, cwd] of [
  ["core/ui", ["bun", "build.js"], join(root, "core/ui")],
  ["the headless renderer", [join(root, "tooling/cached-build"), join(root, "clients/app/renderer"), "--example", "headless", "--features", "fake", "--profile", "headless"], root],
]) {
  const built = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" })
  if (built.exitCode !== 0) throw new Error(`${what} didn't build: ${built.stderr.toString().trim().split("\n").slice(-5).join("\n")}`)
}

// Half as many plays at once as a pass runs headless renderers (`--jobs`, animation.js's default unless said), each running two.
const together = pLimit(Math.max(1, Math.floor(renderers / 2)))
const each = (plays, work) => Promise.all(plays.map((play) => together(() => work(play))))

// The baseline: each play once with no mutant, in each appearance it's played in.
const plays = [...new Map(chosen.flatMap((name) => MUTANTS[name].plays.flatMap((play) => appearances.filter((theme) => !MUTANTS[name].only || MUTANTS[name].only === theme).map((theme) => [`${said(play)} ${theme}`, { play, theme }])))).values()]
const baseline = new Map(await each(plays, async ({ play, theme }) => [`${said(play)} ${theme}`, await run(play, undefined, theme === "dark")]))
const broken = [...baseline].filter(([, result]) => result.failed)
console.log(`baseline (${minutes()}): ${broken.length ? `${broken.length} of ${baseline.size} plays fail with no mutant` : `all ${baseline.size} plays pass`}`)
for (const [key, result] of broken) console.log(`  ${key}:\n${result.lines.map((line) => `    ${line}`).join("\n")}`)

// Each mutant in each appearance it shows in: caught where a play that passes with no mutant fails with it.
const jobs = chosen.flatMap((name) => appearances.map((theme) => ({ name, theme })))
const results = await each(jobs, async ({ name, theme }) => {
  const mutant = MUTANTS[name]
  if (mutant.only && mutant.only !== theme) return { name, theme, outcome: "unviable", lines: [`it shows in ${mutant.only} alone`] }
  const [lines, broken] = [[], []]
  for (const play of mutant.plays) {
    const result = await run(play, name, theme === "dark")
    if (baseline.get(`${said(play)} ${theme}`).failed) continue
    if (result.failed) (result.broke ? broken : lines).push(...result.lines.map((line) => `${said(play)}: ${line}`))
  }
  return { name, theme, outcome: lines.length ? "caught" : broken.length ? "error" : "missed", lines: lines.length ? lines : broken }
})

const missed = results.filter((result) => ["missed", "error"].includes(result.outcome))
for (const { name, theme, outcome, lines } of results) {
  console.log(`${outcome === "caught" ? "✓" : outcome === "unviable" ? "-" : "✗"} ${name} (${MUTANTS[name].bug}), ${theme}: ${outcome}`)
  for (const line of lines.slice(0, 4)) console.log(`    ${line}`)
  if (lines.length > 4) console.log(`    and ${lines.length - 4} more`)
}
console.log(`${results.filter((result) => result.outcome === "caught").length} caught, ${results.filter((result) => result.outcome === "missed").length} missed, ${results.filter((result) => result.outcome === "error").length} errors, ${results.filter((result) => result.outcome === "unviable").length} unviable, in ${minutes()}: ${out}`)
process.exit(missed.length || broken.length ? 1 : 0)
