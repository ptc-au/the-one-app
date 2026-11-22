// The harness process: here, or on `--ssh`'s device, and the scenes it lists and draws.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { capped, checking, dark, env, FACES, glass, harness, out, slot, ssh, stopped } from "./options.js"
import { COMPONENTS, library, pageFolder } from "./pages.js"
import { device, devices, hostScore } from "./tiers.js"


/// Whether `--ssh`'s device is a Mac, whose shell is sh, where a Windows PC's is cmd.
export const mac = Boolean(ssh) && Bun.spawnSync(["ssh", ssh, "uname -s"]).stdout.toString().trim() === "Darwin"
/// What a path joins with there, and what the harness is called there.
const sep = mac ? "/" : "\\"
const exe = mac ? "screenshot" : "screenshot.exe"
/// `args` quoted for the shell there: sh's, each in single quotes, or cmd's, each in double quotes as Windows' C runtime
/// reads them, a quote in one escaped (an `--errors` list's).
const quoted = (args) => args.map((arg) => (mac ? `'${arg.replaceAll("'", "'\\''")}'` : `"${arg.replaceAll('"', '\\"')}"`)).join(" ")

/// The folder on `--ssh`'s device that each run there is in, with the UI library and the harness beside them, made
/// as the first run needs it and taken away as this ends.
let remote
function onDevice() {
  if (remote) return remote
  const said = (command) => {
    const ran = Bun.spawnSync(["ssh", ssh, command], { stdout: "pipe", stderr: "pipe" })
    if (ran.exitCode !== 0) throw new Error(`${ssh}: ${command}: ${ran.stderr.toString().trim()}`)
    return ran.stdout.toString().trim()
  }
  remote = mac ? said("mktemp -d -t one-motion") : `${said("echo %TEMP%")}\\one-motion-${process.pid}`
  const staged = join(out, ".device")
  rmSync(staged, { recursive: true, force: true })
  cpSync(library("client"), join(staged, "ui"), { recursive: true, dereference: true })
  cpSync(harness, join(staged, exe))
  for (const face of FACES) cpSync(face, join(staged, basename(face)))
  const sent = Bun.spawnSync(["sh", "-c", `tar -C "${staged}" -cf - . | ssh ${ssh} '${mac ? "" : `mkdir "${remote}" && `}tar -xf - -C "${remote}"'`], { stdout: "pipe", stderr: "pipe" })
  if (sent.exitCode !== 0) throw new Error(`${ssh}: the harness didn't go there: ${sent.stderr.toString().trim()}`)
  process.on("exit", () => Bun.spawnSync(["ssh", ssh, mac ? `rm -rf "${remote}"` : `rmdir /s /q "${remote}"`]))
  return remote
}

/// Runs the harness on `--ssh`'s device, in a folder of its own there with what it's given: its page, its answers and
/// its requests. → what it said on stdout and stderr, and whether it failed; its `end.json` back in `folder`.
export async function runThere(at, folder, args, lines) {
  const base = onDevice()
  const run = `${base}${sep}${basename(folder)}-${Math.random().toString(36).slice(2, 8)}`
  const staged = join(folder, ".device")
  rmSync(staged, { recursive: true, force: true })
  cpSync(at, join(staged, "page"), { recursive: true, dereference: true })
  cpSync(join(folder, "answers.json"), join(staged, "answers.json"))
  writeFileSync(join(staged, "requests.jsonl"), lines)
  const there = args.map((arg) => (arg === at ? `${run}${sep}page` : arg === join(folder, "answers.json") ? `${run}${sep}answers.json` : arg === "-" ? `${run}${sep}requests.jsonl` : arg.startsWith(folder) ? `${run}${sep}${basename(arg)}` : arg === library("client") ? `${base}${sep}ui` : arg))
  // Its tree after what it said, whether it drew or not, and its folder taken away; the whole quoted for the shell here.
  const command = mac
    ? `mkdir "${run}" && tar -xf - -C "${run}" && ${glass ? `ONE_GLASS=${glass} ` : ""}"${base}/${exe}" ${quoted(there)}; cat "${run}/end.json" 1>&2; rm -rf "${run}"`
    : `${glass ? `set "ONE_GLASS=${glass}" && ` : ""}mkdir "${run}" && tar -xf - -C "${run}" && "${base}\\${exe}" ${quoted(there)} & type "${run}\\end.json" 1>&2 & rmdir /s /q "${run}"`
  const ran = Bun.spawn(["sh", "-c", `tar -C "${staged}" -cf - . | ssh ${ssh} '${command.replaceAll("'", "'\\''")}'`], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(ran.stdout).text(), new Response(ran.stderr).text(), ran.exited])
  rmSync(staged, { recursive: true, force: true })
  // Its tree (its nodes, a JSON array), which it writes at its end, comes back after what it said, if it said anything.
  const tree = /^[[{]/.test(stderr) ? 0 : Math.max(stderr.lastIndexOf("\n["), stderr.lastIndexOf("\n{")) + 1 || -1
  if (tree >= 0) writeFileSync(join(folder, "end.json"), stderr.slice(tree))
  return { stdout, stderr: tree >= 0 ? stderr.slice(0, tree) : stderr, failed: ran.exitCode !== 0 || !stdout.trim() }
}

/// A motion played in a real window on `--ssh`'s device, in its person's session, by the `window` example
/// (`--present`): the inspector's requests it's `played`, each at its time, after the scene's `taps`, in a window
/// opened afresh for each of three rounds. On Windows a scheduled task runs it there, and says it's done on a named pipe,
/// which is every session's, that this waits on there, five minutes at most; a Mac's person's session takes a window
/// from their own ssh login as it is. → what it said of each motion's frames, as JSON lines, and whether it failed.
export const presentThere = (at, folder, scene, played, taps) => slot(() => presented(at, folder, scene, played, taps))

async function presented(at, folder, scene, played, taps) {
  // A locked screen's windows are drawn but not shown, so presenting costs nothing there.
  const locked = mac ? ["ioreg -n Root -d1", 'CGSSessionScreenIsLocked"=Yes'] : ['tasklist /FI "IMAGENAME eq LogonUI.exe" /NH', "LogonUI"]
  if (Bun.spawnSync(["ssh", ssh, locked[0]]).stdout.toString().includes(locked[1])) return { said: [], stderr: `${ssh}'s screen is locked, so a window there isn't shown: unlock it first`, failed: true }
  const base = onDevice()
  // A GPU's driver that hung and failed its reset hangs every program that draws there, and each run on it is another
  // hang (a Surface's Intel, 22 Nov): a device must start there before each run (`window --gpu`), and the first hang
  // stops every run.
  const gpu = Bun.spawnSync(["ssh", ssh, `"${base}${sep}${exe}" --gpu`], { stdout: "pipe", stderr: "pipe", timeout: 60000 })
  if (gpu.exitCode !== 0) stop(`${ssh}'s GPU started no device: ${gpu.stderr.toString().trim() || "it didn't answer in a minute"}`)
  const name = `${basename(folder)}-${Math.random().toString(36).slice(2, 8)}`.replace(/[^\w-]/g, "")
  const run = `${base}${sep}${name}`
  const staged = join(folder, ".device")
  rmSync(staged, { recursive: true, force: true })
  cpSync(at, join(staged, "page"), { recursive: true, dereference: true })
  cpSync(join(folder, "answers.json"), join(staged, "answers.json"))
  writeFileSync(join(staged, "played.json"), JSON.stringify(played))
  writeFileSync(join(staged, "before.jsonl"), taps.map((tap, id) => JSON.stringify({ v: 1, id: id + 1, ...tap })).join("\n"))
  const args = ["page", "--play", "played.json", "--before", "before.jsonl", "--ui", `${base}${sep}ui`, "--answers", "answers.json", "--size", `${scene.size[0]}x${scene.size[1]}`, "--rounds", "3", ...panel(scene)]
  if (mac) {
    const command = `mkdir "${run}" && tar -xf - -C "${run}" && cd "${run}" && { ${glass ? `ONE_GLASS=${glass} ` : ""}"${base}/${exe}" ${quoted(args)} > said.txt 2> err.txt; echo $?; cat said.txt; cat err.txt 1>&2; }; rm -rf "${run}"`
    const ran = Bun.spawn(["sh", "-c", `tar -C "${staged}" -cf - . | ssh ${ssh} '${command.replaceAll("'", "'\\''")}'`], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr] = await Promise.all([new Response(ran.stdout).text(), new Response(ran.stderr).text(), ran.exited])
    rmSync(staged, { recursive: true, force: true })
    return saidThere(stdout, stderr)
  }
  writeFileSync(join(staged, "run.cmd"), ["@echo off", `cd /d "${run}"`, ...(glass ? [`set "ONE_GLASS=${glass}"`] : []), `start "" /b /wait "${base}\\screenshot.exe" ${args.map((arg) => `"${arg}"`).join(" ")} > said.txt 2> err.txt`, "echo %errorlevel% > exit.txt", `echo done> \\\\.\\pipe\\${name}`].join("\r\n"))
  writeFileSync(
    join(staged, "wait.ps1"),
    [
      // Its person may write to it from their session, which a pipe's own permissions don't let them.
      "$security = New-Object System.IO.Pipes.PipeSecurity",
      "$security.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule([System.Security.Principal.WindowsIdentity]::GetCurrent().User, 'ReadWrite', 'Allow')))",
      `$pipe = New-Object System.IO.Pipes.NamedPipeServerStream('${name}', 'In', 1, 'Byte', 'None', 0, 0, $security)`,
      // Through a console host with no window of its own: a console's window (Windows Terminal's, on Windows 11) took the
      // foreground over the window being measured. Its window is started shown (`start`), as a window's first
      // ShowWindow takes how it was started, and the console host's is hidden.
      `schtasks /Create /F /SC ONCE /ST 23:59 /TN ${name} /TR 'conhost.exe --headless cmd.exe /c "${run}\\run.cmd"' /IT | Out-Null`,
      `schtasks /Run /TN ${name} | Out-Null`,
      "$null = $pipe.WaitForConnectionAsync().Wait(300000)",
      "$pipe.Dispose()",
      `schtasks /Delete /F /TN ${name} | Out-Null`,
    ].join("\r\n"),
  )
  const sent = Bun.spawnSync(["sh", "-c", `tar -C "${staged}" -cf - . | ssh ${ssh} 'mkdir "${run}" && tar -xf - -C "${run}"'`], { stdout: "pipe", stderr: "pipe" })
  rmSync(staged, { recursive: true, force: true })
  if (sent.exitCode !== 0) return { stdout: "", stderr: sent.stderr.toString(), failed: true }
  const task = `powershell -NoProfile -ExecutionPolicy Bypass -File "${run}\\wait.ps1" & type "${run}\\exit.txt" & type "${run}\\said.txt" & type "${run}\\err.txt" 1>&2 & rmdir /s /q "${run}"`
  const ran = Bun.spawn(["ssh", ssh, task], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(ran.stdout).text(), new Response(ran.stderr).text(), ran.exited])
  return saidThere(stdout, stderr)
}

/// What a window said there: its exit status, then a JSON line for each motion. A GPU that hung there (the window's
/// thread stuck in its driver, which ends it with 3, or a frame or a wait that ran out) stops every run.
const saidThere = (stdout, stderr) => {
  const [exit, ...said] = stdout.split("\n")
  const hung = stderr.split("\n").find((line) => line.includes("the GPU hung"))
  if (hung || exit.trim() === "3") stop(`${ssh}'s GPU hung: ${hung ?? "its window's thread was stuck in its driver"}`)
  return { said: said.filter((line) => line.trim().startsWith("{")).map((line) => JSON.parse(line)), stderr, failed: exit.trim() !== "0" }
}

/// Stops every run, saying why.
function stop(why) {
  console.log(`--present stopped: ${why}`)
  process.exit(1)
}


/// Whether `scene`'s window is a panel: a computer's launcher is drawn as one on every computer, its glass the system's
/// (`native::launcher`), as its client says it is.
export const panelled = (scene) => {
  const client = scene.answers?.["one/client"]
  return Boolean(client?.launcher)
}

/// The harness's flags that open `scene`'s window as the app does: a launcher as a panel with a computer's corners,
/// 18 pt (clients/app/src/computer.rs `CORNER`), over the system's glass, in every harness alike.
export const panel = (scene) => (panelled(scene) ? ["--panel", "18"] : [])

/// The harness run on a scene, with `requests`, once a slot of `jobs` is free: each answer, its stderr, and how long it
/// ran. → `{ answers, said, failed, ms }`.
export const run = (at, folder, scene, requests, seed = 0) =>
  slot(async () => {
    const started = performance.now()
    return { ...(await harnessed(at, folder, scene, requests, seed)), ms: performance.now() - started }
  })

async function harnessed(at, folder, scene, requests, seed) {
  const answers = { ...scene.answers, "ui/initialize": scene.answers?.["ui/initialize"] ?? { hostContext: { link: scene.link, containerDimensions: { width: scene.size[0], height: scene.size[1] }, deviceCapabilities: { touch: scene.touch, hover: !scene.touch } } } }
  writeFileSync(join(folder, "answers.json"), JSON.stringify(answers))
  const lines = requests.map((request, id) => JSON.stringify({ v: 1, id: id + 1, ...request })).join("\n")
  // Its pictures decode as slowly as on the slowest device of its kind: as this machine's CPU is to that one's, at
  // that one's device pixels a point, where it's drawn at one here; on a device, as that decodes them.
  const slowest = devices.tiers.find((tier) => tier.name === (scene.touch ? "low-end Android" : "Intel UHD laptop at 4K"))
  const slower = hostScore && !ssh ? ["--slower", String((hostScore / slowest.cpu) * slowest.scale ** 2)] : []
  const args = [at, join(folder, "end.png"), join(folder, "end.json"), "--ui", library("client"), "--answers", join(folder, "answers.json"), "--size", `${scene.size[0]}x${scene.size[1]}`, "--scale", String(scene.scale ?? device?.scale ?? 1), "--requests", "-", ...(dark ? ["--dark"] : []), ...(scene.touch ? ["--touch"] : []), ...(scene.reducedMotion ? ["--reduced-motion"] : []), ...(scene.errors ? ["--errors", JSON.stringify(scene.errors)] : []), ...(scene.safeArea ? ["--safe-area", scene.safeArea.join(",")] : []), ...(scene.latency ? ["--latency", String(scene.latency)] : []), "--time-zone", scene.timeZone ?? "UTC", ...(scene.hz ? ["--hz", String(scene.hz)] : []), ...(seed ? ["--seed", String(seed)] : []), ...panel(scene), ...slower]
  if (ssh) {
    const { stdout, stderr, failed } = await runThere(at, folder, args, lines)
    return { answers: stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)), said: stderr.trim(), failed }
  }
  // Its pipelines compile as slowly as the Surface's (`open.pipelines_ms`), so a frame that waits for some is a long one.
  const compiling = { ONE_PIPELINES_MS: String(devices.measured.surface.open.pipelines_ms) }
  const harnessed = Bun.spawn(capped([harness, ...args]), { stdin: new TextEncoder().encode(lines), stdout: "pipe", stderr: "pipe", env: { ...env, ...compiling } })
  const [stdout, stderr] = await Promise.all([new Response(harnessed.stdout).text(), new Response(harnessed.stderr).text(), harnessed.exited])
  return { answers: stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)), said: [stderr.trim(), stopped(harnessed.exitCode)].filter(Boolean).join("\n"), failed: harnessed.exitCode !== 0 }
}


/// A phone's safe area, top, right, bottom and left, as an iPhone with a Dynamic Island has it upright (14 Pro to 17):
/// its status bar and its home indicator.
export const IPHONE = [59, 0, 34, 0]
/// The narrowest a window is that isn't a phone's, in points: Material's compact width class ends there.
export const COMPACT = 600

/// A scene as a person has it: a window narrower than COMPACT is a phone's, under a finger and with IPHONE's safe area,
/// unless the scene says otherwise (`touch: false` for a narrow computer window, which it says it's for, or its own
/// `safeArea`); a wider one is a computer's.
export const phone = ({ touch, safeArea, ...scene }) => {
  const fingered = touch ?? scene.size[0] < COMPACT
  return { ...scene, touch: fingered, safeArea: safeArea ?? (fingered ? IPHONE : undefined) }
}

/// A folder's scenes that have motions, or with `all`, every one an app's page draws, each with its page, link,
/// answers, taps, size and touch.
export async function scenesOf(target, built, folder, all = false) {
  if (existsSync(join(target, "client/scenes.json"))) {
    const scenes = JSON.parse(readFileSync(join(target, "client/scenes.json"), "utf8"))
    const whole = (scene) => (scene.like ? { ...whole(scenes[scene.like]), taps: undefined, ...scene, answers: { ...whole(scenes[scene.like]).answers, ...scene.answers } } : scene)
    return Object.entries(scenes)
      .map(([name, scene]) => ({ name, ...whole(scene) }))
      .filter((scene) => all || (checking ? scene.checks : scene.motions))
      .map(({ name, page, component, uses = [], answers = {}, taps = [], size = [390, 844], touch, timeZone = "UTC", safeArea, errors, latency, motions, checks, seeds }) => {
        const [at, link] = (page ?? (component ? `${COMPONENTS}/${component}.html` : "client/index.html")).split("#")
        return phone({ name, page: at, link, uses, answers, taps, size, touch, timeZone, safeArea, errors, latency, motions, checks, seeds })
      })
  }
  // The gallery lists its own, drawn at `#scenes`.
  const listing = { link: "scenes", size: [390, 844], answers: {} }
  mkdirSync(folder, { recursive: true })
  const at = pageFolder(built, "index.html", folder)
  const listed = await run(at, folder, listing, [])
  const text = JSON.stringify(JSON.parse(readFileSync(join(folder, "end.json"), "utf8"))).match(/"name":"(\[.*?\])"/)?.[1]
  if (!text) throw new Error(`The gallery listed no scenes: ${listed.said}`)
  return JSON.parse(JSON.parse(`"${text}"`))
    .filter((scene) => all || (checking ? scene.checks : scene.motions))
    .map(({ name, taps = [], size = [390, 844], touch, safeArea, errors, motions, checks, seeds }) => phone({ name, page: "index.html", link: name, answers: {}, taps, size, touch, safeArea, errors, motions, checks, seeds }))
}
