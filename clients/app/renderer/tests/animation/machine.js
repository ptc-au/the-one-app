// One pool of jobs for the whole machine, shared by every pass any agent runs on it, as make's jobserver shares one
// between makes: a job holds a slot, a file of SLOTS's locked with flock(2), which the system lets go of as its process
// ends, however it ends.
import { mkdirSync, openSync } from "node:fs"
import { availableParallelism, homedir, totalmem } from "node:os"
import { join } from "node:path"
import { dlopen, FFIType } from "bun:ffi"
import { TOGETHER } from "./workers.js"

const { flock } = dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } }).symbols
const [LOCK_EX, LOCK_NB, LOCK_UN] = [2, 4, 8]

/// Where the slots are, a file each.
const SLOTS = join(homedir(), ".cache/the-one-app/jobs")
/// What a headless renderer holds as it runs, at most, but for a page that runs away: 300 MB, and a long motion's
/// frames.
const RUN = 600 * 2 ** 20
/// How many jobs the machine runs at once: one a core, as a headless renderer's run keeps one busy, and no more than
/// the memory every headless renderer shares (`TOGETHER`) has room for.
export const machineJobs = Math.max(1, Math.min(availableParallelism(), Math.floor((TOGETHER * totalmem()) / RUN)))
/// How often a job waiting for a slot tries again, in ms: flock(2) has no form a promise waits on.
const RETRY_MS = 50

mkdirSync(SLOTS, { recursive: true })
/// Each slot's file, opened once, and those this process holds, which flock(2) would let it take again.
const files = []
const held = new Set()

function take() {
  for (let at = 0; at < machineJobs; at++) {
    if (held.has(at)) continue
    files[at] ??= openSync(join(SLOTS, String(at)), "a")
    if (flock(files[at], LOCK_EX | LOCK_NB) === 0) {
      held.add(at)
      return at
    }
  }
}

/// `job` run once one of the machine's slots is free, which it holds till it's done.
export async function machine(job) {
  let at = take()
  while (at === undefined) {
    await Bun.sleep(RETRY_MS)
    at = take()
  }
  try {
    return await job()
  } finally {
    flock(files[at], LOCK_UN)
    held.delete(at)
  }
}
