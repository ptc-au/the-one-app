// The headless renderer as persistent workers (its `--persistent_worker`, Bazel's JSON worker protocol): each draws
// one run after another, keeping the GPU whose start took a run most of its time, and everything else its own each run.

/// The most a headless renderer may use, and for how long a run: a page that grows or never ends is stopped, not the
/// machine.
const MEMORY = "3G"
const MINUTES = 10
/// The most every headless renderer on the machine may use together, whoever started them, as a share of its memory:
/// past it the system stops one of them, never another program (22 Nov: the machine's 26 GB ran out, and the
/// system stopped an agent).
export const TOGETHER = 0.4
/// `command` within that memory, in a systemd scope of its own in the slice they all share, on Linux where systemd
/// is; elsewhere as it is.
const capped = (command) => (Bun.which("systemd-run") ? ["systemd-run", "--user", "--scope", "--quiet", "--slice=headless.slice", "-p", `MemoryMax=${MEMORY}`, "-p", "MemorySwapMax=0", ...command] : command)
if (Bun.which("systemctl")) Bun.spawnSync(["systemctl", "--user", "set-property", "--runtime", "headless.slice", `MemoryMax=${Math.round(TOGETHER * 100)}%`, "MemorySwapMax=0"])

/// Why a run's headless renderer was stopped, by its exit status, if it was.
export const stopped = (status) => ({ 137: `it was stopped for its memory: past its own ${MEMORY}B, or the machine's headless renderers' together past ${TOGETHER * 100}% of its memory`, 124: `it ran for ${MINUTES} minutes, and was stopped` })[status]

/// The workers waiting for a run, by the headless renderer and environment they were started with.
const idle = new Map()

/// The headless renderer at `headless` run with `args` in `env` (its requests, `--requests`, a file), by a worker of
/// its that's free, or one started for it. → its exit status, stdout and stderr, as a process of its own said them.
export async function work(headless, args, env) {
  const key = JSON.stringify([headless, env])
  const free = idle.get(key) ?? []
  idle.set(key, free)
  const worker = free.pop() ?? started(headless, env)
  const ran = await worker.ask(args)
  if (worker.alive()) free.push(worker)
  return ran
}

/// Each line of `stream`, to `line`, as it comes.
async function lines(stream, line) {
  let parts = []
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    let start = 0
    for (let end = chunk.indexOf("\n"); end >= 0; end = chunk.indexOf("\n", start)) {
      parts.push(chunk.slice(start, end))
      line(parts.join(""))
      parts = []
      start = end + 1
    }
    parts.push(chunk.slice(start))
  }
}

function started(headless, env) {
  const child = Bun.spawn(capped([headless, "--persistent_worker"]), { stdin: "pipe", stdout: "pipe", stderr: "pipe", env })
  // It ends as this does, its stdin closed, and keeps no pass alive meanwhile.
  child.unref()
  // What it said outside its runs (its renderer's log), the last of it, for where it stops.
  let said = []
  lines(child.stderr, (line) => (said = [...said.slice(-20), line]))
  const answers = []
  lines(child.stdout, (line) => {
    const response = JSON.parse(line)
    answers.shift()?.({ exitCode: response.exitCode, stdout: response.stdout, stderr: response.output })
  })
  let requestId = 0
  return {
    alive: () => child.exitCode === null && !child.killed,
    ask(args) {
      let timer
      return Promise.race([
        new Promise((answer) => {
          answers.push(answer)
          child.stdin.write(JSON.stringify({ arguments: args, requestId: ++requestId }) + "\n")
          child.stdin.flush()
        }),
        child.exited.then((status) => ({ exitCode: status, stdout: "", stderr: said.join("\n") })),
        new Promise((answer) => (timer = setTimeout(() => (child.kill(), answer({ exitCode: 124, stdout: "", stderr: "" })), MINUTES * 60_000))),
      ]).finally(() => clearTimeout(timer))
    },
  }
}
