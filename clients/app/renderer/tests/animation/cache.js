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

/// What a run of the headless renderer at `headless` with `args` in `env` is by: the renderer, each argument (a path that
/// exists by what's in it, an output by its name) and what changes how it draws.
const runKey = (headless, args, env, outputs) => sha(JSON.stringify([digest(headless), args.map((arg) => (outputs.includes(arg) ? `out:${basename(arg)}` : existsSync(arg) ? `in:${digest(arg)}` : arg)), drawing(env)]))

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
/// or what it drew with the same before, anywhere on the machine. → its exit status, stdout and stderr, whether it
/// was kept (`kept`), and where it's kept (`at`, for `judged`), where it drew.
export async function cached(headless, args, env, outputs, run) {
  mkdirSync(KEPT, { recursive: true })
  if (!pruned) prune()
  const at = join(KEPT, runKey(headless, args, env, outputs))
  const lock = openSync(`${at}.lock`, "a")
  while (flock(lock, LOCK_EX | LOCK_NB) !== 0) await Bun.sleep(RETRY_MS)
  try {
    if (existsSync(join(at, "ran.json"))) {
      for (const output of outputs) if (existsSync(join(at, basename(output)))) cpSync(join(at, basename(output)), output)
      const now = new Date()
      utimesSync(at, now, now)
      return { ...JSON.parse(readFileSync(join(at, "ran.json"), "utf8")), kept: true, at }
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
      return { ...ran, at }
    }
    return ran
  } finally {
    flock(lock, LOCK_UN)
    closeSync(lock)
  }
}

/// What `judge()` says of a drawing kept at `at` (`cached`'s), by `by` (what else it depends on: the code that judges and
/// what it's told), kept beside it, so a drawing judged before isn't judged again, by any worktree on the machine, and
/// goes as it goes. Nowhere to keep it (`at` unsaid: a drawing that wasn't kept), it's judged.
export function judged(at, by, judge) {
  if (!at) return judge()
  const file = join(at, `judged-${sha(JSON.stringify(by))}.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"))
  const said = judge()
  writeFileSync(`${file}.${process.pid}`, JSON.stringify(said))
  renameSync(`${file}.${process.pid}`, file)
  return said
}

/// What `judge()` says of the headless renderer's run, as `cached` has them (its arguments), kept by that run and by
/// `by` (what else it's judged by), as a verdict is: a run that went as it went before, and was judged by the same, isn't
/// run or judged again, by any worktree on the machine. Only what `passed(said)` is kept: what failed is run again,
/// for the pictures it leaves where it's run. → what `judge` said, or said before.
export async function verdict(headless, args, env, outputs, by, judge, passed) {
  mkdirSync(KEPT, { recursive: true })
  if (!pruned) prune()
  const at = join(KEPT, sha(JSON.stringify(["verdict", runKey(headless, args, env, outputs), by])))
  const file = join(at, "verdict.json")
  if (existsSync(file)) {
    const now = new Date()
    utimesSync(at, now, now)
    return JSON.parse(readFileSync(file, "utf8")).said
  }
  const said = await judge()
  if (passed(said)) {
    mkdirSync(at, { recursive: true })
    writeFileSync(`${file}.${process.pid}`, JSON.stringify({ said }))
    renameSync(`${file}.${process.pid}`, file)
  }
  return said
}
