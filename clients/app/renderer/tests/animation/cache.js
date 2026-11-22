// What a headless renderer drew, kept for every worktree on the machine by everything that decides it, as a build cache
// keeps a build: a pass on main, which every agent runs as its "before", draws once for them all.
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { flock, LOCK_EX, LOCK_NB, LOCK_UN } from "./machine.js"

const KEPT = join(homedir(), ".cache/the-one-app/screenshots")
/// The most it keeps, the least recently used going first.
const MOST = 2 * 2 ** 30
/// How often a run waiting for another's drawing of the same tries again, in ms: flock(2) has no form a promise waits on.
const RETRY_MS = 50

const sha = (data) => createHash("sha256").update(data).digest("hex")
/// Each file's and folder's digest, by its real path, while it's as it was: a pass's scenes share their app's build.
const digests = new Map()
function digest(path) {
  const real = realpathSync(path)
  const stat = statSync(real)
  const { mtimeMs, size } = stat
  if (stat.isDirectory()) return sha(readdirSync(real).sort().map((entry) => `${entry}:${digest(join(real, entry))}`).join("\n"))
  const known = digests.get(real)
  if (known?.mtimeMs === mtimeMs && known.size === size) return known.digest
  const made = sha(readFileSync(real))
  digests.set(real, { mtimeMs, size, digest: made })
  return made
}

/// What changes how it draws, of its environment: its glass, its atlas, a mutant, a device's costs, and the GPU.
const DRAWING = ["ONE_GLASS", "ONE_ATLAS", "ONE_MUTANT", "ONE_PIPELINES_MS", "ONE_WINDOW_MS", "VK_ICD_FILENAMES", "LP_NUM_THREADS"]
const drawing = (env) => DRAWING.map((name) => [name, env[name]])

let pruned = false
/// Keeps no more than MOST, the least recently used going first, once a pass.
function prune() {
  pruned = true
  const all = readdirSync(KEPT).filter((key) => !key.includes(".")).map((key) => {
    const at = join(KEPT, key)
    return { at, used: statSync(at).mtimeMs, size: readdirSync(at).reduce((sum, file) => sum + statSync(join(at, file)).size, 0) }
  })
  let total = all.reduce((sum, one) => sum + one.size, 0)
  for (const one of all.sort((a, b) => a.used - b.used)) {
    if (total <= MOST) break
    rmSync(one.at, { recursive: true, force: true })
    rmSync(`${one.at}.lock`, { force: true })
    total -= one.size
  }
}

/// `run(args)` of the headless renderer at `headless` in `env`, whose `outputs` (paths among `args`) are what it draws,
/// or what it drew with the same before, anywhere on the machine. → its exit status, stdout and stderr, and whether it
/// was kept (`kept`).
export async function cached(headless, args, env, outputs, run) {
  mkdirSync(KEPT, { recursive: true })
  if (!pruned) prune()
  const said = args.map((arg) => (outputs.includes(arg) ? `out:${basename(arg)}` : existsSync(arg) ? `in:${digest(arg)}` : arg))
  const key = sha(JSON.stringify([digest(headless), said, drawing(env)]))
  const at = join(KEPT, key)
  const lock = openSync(`${at}.lock`, "a")
  while (flock(lock, LOCK_EX | LOCK_NB) !== 0) await Bun.sleep(RETRY_MS)
  try {
    if (existsSync(join(at, "ran.json"))) {
      for (const output of outputs) if (existsSync(join(at, basename(output)))) cpSync(join(at, basename(output)), output)
      const now = new Date()
      utimesSync(at, now, now)
      return { ...JSON.parse(readFileSync(join(at, "ran.json"), "utf8")), kept: true }
    }
    const ran = await run(args)
    // Only what drew: what failed is said again by the next run, which may not.
    if (ran.exitCode === 0) {
      const making = `${at}.${process.pid}`
      rmSync(making, { recursive: true, force: true })
      mkdirSync(making)
      for (const output of outputs) if (existsSync(output)) cpSync(output, join(making, basename(output)))
      writeFileSync(join(making, "ran.json"), JSON.stringify(ran))
      renameSync(making, at)
    }
    return ran
  } finally {
    flock(lock, LOCK_UN)
    closeSync(lock)
  }
}
