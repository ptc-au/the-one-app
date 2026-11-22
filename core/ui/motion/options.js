// What a run is asked (the command line), where it runs, and the most a harness may use.
import { fileURLToPath } from "node:url"
import { join, resolve } from "node:path"

/// `path` in core/ui, where motion.js is, whichever file of motion/ asks.
export const here = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url))
export const root = here("../../")
const args = process.argv.slice(2)
export const flag = (name) => args.includes(name)
export const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
// Its own worktree's, never a folder every agent on the machine shares, where one ran with another's UI build.
export const out = resolve(option("--out") ?? join(root, "target", "motion"))
export const against = option("--against") && resolve(option("--against"))
export const rates = (option("--hz") ?? "60,120").split(",").map(Number)
export const only = option("--scene")?.toLowerCase()
/// Only the motions that keep a tier (`keeps`), which calibrate.js checks the tiers' model against a device by.
export const keeping = flag("--keeps")
export const dark = flag("--dark")
/// Which glass the renderer draws, whatever its GPU says (`ONE_GLASS`): `tinted`, a plain tint, as it is on a weak GPU
/// (devices.json's low-end Android and Intel UHD laptop), or `blurred`. Unsaid, the GPU's own.
export const glass = option("--glass")
export const checking = flag("--checks")
export const seeds = Number(option("--seeds") ?? 3)
export const folders = args.filter((arg, at) => !arg.startsWith("--") && !["--out", "--against", "--hz", "--scene", "--seeds", "--ssh", "--harness", "--glass"].includes(args[at - 1])).map((folder) => resolve(folder))
// On a device of devices.json's tiers over ssh (the one whose `measured` it is), with a harness built for it, its own
// GPU and CPU draw each frame, as calibrate.js has them, and its tier is judged by the times it took there.
export const ssh = option("--ssh")
export const present = flag("--present")
export let harness = ssh ? option("--harness") && resolve(option("--harness")) : join(root, `target/${flag("--release") ? "release" : "debug"}/examples/screenshot`)
/// Where every harness draws, here and in scenes.js: on the machine's GPU, the one wgpu prefers (Vulkan, or lavapipe
/// where there's none), or with `--lavapipe` on Mesa's software Vulkan, which draws on the CPU with 2 threads rather
/// than one a core (`LP_NUM_THREADS`), as a few run at once: a second GPU whose frames must agree with the first's.
export const lavapipe = flag("--lavapipe")
export const env = { ...process.env, ...(glass ? { ONE_GLASS: glass } : {}), ...(lavapipe ? { VK_ICD_FILENAMES: "/usr/share/vulkan/icd.d/lvp_icd.json", LP_NUM_THREADS: process.env.LP_NUM_THREADS ?? "2" } : {}) }
/// The most a harness may use, and for how long: a page that grows or never ends is stopped, not the machine.
const MEMORY = "3G"
const MINUTES = 10
/// `command` run within those, in a systemd scope of its own on Linux, where systemd is; elsewhere as it is.
export const capped = (command) => (Bun.which("systemd-run") ? ["systemd-run", "--user", "--scope", "--quiet", "-p", `MemoryMax=${MEMORY}`, "-p", "MemorySwapMax=0", "timeout", `${MINUTES}m`, ...command] : command)

/// The faces the harness falls back to where its own font hasn't a character, this machine's, which a device it's sent
/// to is sent beside it (renderer's `fake::fallback_fonts`).
export const FACES = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"]

/// Why a capped harness was stopped, by its exit status, if it was.
export const stopped = (status) => ({ 137: `it used more than ${MEMORY}B of memory, and was stopped`, 124: `it ran for ${MINUTES} minutes, and was stopped` })[status]

/// `--watch` plays the harness a pass copied (`copied`), not the one it was given.
export const setHarness = (path) => {
  harness = path
}
