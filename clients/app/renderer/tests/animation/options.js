// What a run is asked (the command line), where it runs, and the most a headless renderer may use.
import { fileURLToPath } from "node:url"
import { availableParallelism } from "node:os"
import { join, resolve } from "node:path"
import pLimit from "p-limit"

/// `path` in the renderer's tests, where animation.js is, whichever file of animation/ asks.
export const here = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url))
export const root = here("../../../../")
/// `path` in the UI library (core/ui), which the tests draw.
export const ui = (path) => join(root, "core/ui", path)
const args = process.argv.slice(2)
export const flag = (name) => args.includes(name)
export const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
// Its own worktree's, never a folder every agent on the machine shares, where one ran with another's UI build.
export const out = resolve(option("--out") ?? join(root, "target", "animation"))
export const against = option("--against") && resolve(option("--against"))
export const rates = (option("--hz") ?? "60,120").split(",").map(Number)
export const only = option("--scene")?.toLowerCase()
/// Only the motions that keep a tier (`keeps`), which calibrate.js checks the tiers' model against a device by.
export const keeping = flag("--keeps")
export const dark = flag("--dark")
/// Which glass the renderer draws, whatever its GPU says (`ONE_GLASS`): `tinted`, a plain tint, as it is on a weak GPU
/// (devices.json's low-end Android and Intel UHD laptop), or `blurred`. Unsaid, the GPU's own.
export const glass = option("--glass")
/// The atlas a device short of memory has (`ONE_ATLAS`, `starved`): what it draws again is packed anew beside other glyphs and
/// pictures, as `played twice` shows. Unsaid, as a device with room has it.
export const atlas = option("--atlas")
export const checking = flag("--checks")
export const seeds = Number(option("--seeds") ?? 3)
/// How many generated scenes to play (`--generated`), from which seed (`--from`).
export const generating = option("--generated") && Number(option("--generated"))
export const firstSeed = Number(option("--from") ?? 1)
export const folders = args.filter((arg, at) => !arg.startsWith("--") && !["--out", "--against", "--hz", "--scene", "--seeds", "--ssh", "--headless", "--glass", "--atlas", "--generated", "--from", "--jobs"].includes(args[at - 1])).map((folder) => resolve(folder))
// On a device of devices.json's tiers over ssh (the one whose `measured` it is), with a headless renderer built for it, its own
// GPU and CPU draw each frame, as calibrate.js has them, and its tier is judged by the times it took there.
export const ssh = option("--ssh")
export const present = flag("--present")
/// How many agents usually share a machine, each running a pass: its cores are theirs between them.
const AGENTS = 4
/// How many headless renderers a pass runs at once (`--jobs`): twice this machine's share of its cores, as a headless renderer waits for
/// about half of its run (the Surface's pipelines compiling, `ONE_PIPELINES_MS`, and its GPU), or on `--ssh`'s device
/// one, whose GPU each frame's time is of. Every headless renderer and build a pass starts, here and in screenshot.js, takes
/// one (`slot`).
export const jobs = ssh ? 1 : Number(option("--jobs") ?? Math.max(2, Math.floor((2 * availableParallelism()) / AGENTS)))
export const slot = pLimit(jobs)
// For clients/app/renderer/tests/mutants.js, which runs passes a few at once, and has no packages of its own.
export { pLimit }
export let headless = ssh ? option("--headless") && resolve(option("--headless")) : undefined
/// This machine's headless renderer, built once for what it's built from and kept for every worktree
/// (tooling/cached-build): a debug build, or with `--release` the `headless` profile's, a release build built again
/// incrementally. → its path.
export function built() {
  const cargo = Bun.spawnSync([join(root, "tooling/cached-build"), join(root, "clients/app/renderer"), "--example", "headless", "--features", "fake", ...(flag("--release") ? ["--profile", "headless"] : [])], { stdout: "pipe", stderr: "inherit" })
  if (cargo.exitCode !== 0) throw new Error("The headless renderer didn't build: Cargo says why above")
  return cargo.stdout.toString().trim()
}
/// Where every headless renderer draws, here and in screenshot.js: on the machine's GPU, the one wgpu prefers (Vulkan, or lavapipe
/// where there's none), or with `--lavapipe` on Mesa's software Vulkan, which draws on the CPU with 2 threads rather
/// than one a core (`LP_NUM_THREADS`), as a few run at once: a second GPU whose frames must agree with the first's.
export const lavapipe = flag("--lavapipe")
export const env = { ...process.env, ...(glass ? { ONE_GLASS: glass } : {}), ...(atlas ? { ONE_ATLAS: atlas } : {}), ...(lavapipe ? { VK_ICD_FILENAMES: "/usr/share/vulkan/icd.d/lvp_icd.json", LP_NUM_THREADS: process.env.LP_NUM_THREADS ?? "2" } : {}) }
/// The most a headless renderer may use, and for how long: a page that grows or never ends is stopped, not the machine.
const MEMORY = "3G"
const MINUTES = 10
/// `command` run within those, in a systemd scope of its own on Linux, where systemd is; elsewhere as it is.
export const capped = (command) => (Bun.which("systemd-run") ? ["systemd-run", "--user", "--scope", "--quiet", "-p", `MemoryMax=${MEMORY}`, "-p", "MemorySwapMax=0", "timeout", `${MINUTES}m`, ...command] : command)

/// The faces the headless renderer falls back to where its own font hasn't a character, this machine's, which a device it's sent
/// to is sent beside it (renderer's `fake::fallback_fonts`).
export const FACES = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"]

/// Why a capped headless renderer was stopped, by its exit status, if it was.
export const stopped = (status) => ({ 137: `it used more than ${MEMORY}B of memory, and was stopped`, 124: `it ran for ${MINUTES} minutes, and was stopped` })[status]

/// `--watch` plays the headless renderer a pass copied (`copied`), not the one it was given.
export const setHeadless = (path) => {
  headless = path
}
