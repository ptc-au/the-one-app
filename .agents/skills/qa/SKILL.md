---
name: qa
description: Use before you commit a change, to check it works and doesn't break what it could touch, and whenever you change a screen, which is shown with real pictures before it's called done. There are no kept tests but the renderer's: you check your own change.
---

Check your work with a throwaway check and never commit it. The one exception is the renderer's tests (`clients/app/renderer/tests`, below). Use the cheapest thing that shows it works: call the
tool on a local network (`local-network`), open the screen (Screens, below), or run the function in `iex -S mix`
in `core/server/`.

Work out what your change touches, or could touch, including things that look unrelated, and check those too. The skill
`blast-radius` finds what it could break beyond the diff. If
that includes secrets, who may do what, an app's entrypoint reaching another's, or data kept and restored, try to break
it yourself on a local network. You decide the attacks; there is no fixed list.

A change to One Core's or an app's Elixir runs `mix credo` in `core/server/`, which refuses what its checks
(`core/server/credo/`) say, such as a wait without end on another machine. One that asks several servers or devices
is tried with one of them faulted (`local-network`'s Faults).

A failing check is chased until you know why, and reported. Never skip it, loosen it, or commit "a small fix" on a
guess you haven't reproduced.

## Types

A change to `clients/web/host.js` or the window's page (`clients/app/page/`, `host.d.ts` types what both are given)
runs `bunx --package typescript@7.0.2 tsc -p .` in `clients/web` and in `clients/app/page` (after `bun install` in
`clients/web` and in `core/ui`), which must print nothing: fix the type, never `any` or `@ts-ignore`.

## State machines

Changing a pure state machine (a function from a state and an event to the next state), such as the Home Screen's
`apps/home-screen/client/machine.ts`, `clients/cli/src/serving.rs`, the edge's `core/edge/updater/updater.ts` or the
database's `apps/database/server/database/lease.ex`, is checked well by a throwaway property test: random sequences
of events, and after each, what must always hold (one lease holder, no state it can't leave, every event answered).
Use the ecosystem's own: fast-check from a script in your scratch folder (`bun add fast-check` there, importing the
machine by its path), proptest in a `#[cfg(test)]` module with it added to the crate's dev-dependencies, or
StreamData in a script with `Mix.install([:stream_data])`. Like every check here it isn't committed: drop the module
and the dev-dependency before you commit. A sequence it finds that breaks the machine is a bug to fix, and the
shrunk sequence is what the commit says.

## Screens

UI work is shown with real pictures of the real app, never described. Pictures are for checking your own change:
take the few that check it, not every size and theme, a before only where judging it needs one, and where motion
is what changed, its filmstrip and curve (Animation tests, below). A change that goes live in seconds, as an app deploy does, is seen live.
A phone-sized desktop window (390×844) shows most screen changes; build for a phone or simulator only when the change
is about that platform. Save pictures in your scratch folder, never in the repo, and look at each before
you show it. Screen wording and look follow `DESIGN.md`: read the section of the screen you change first.

### Screenshot tests: every UI change

The renderer's tests are kept in `clients/app/renderer/tests`, the one exception to "no kept tests" (AGENTS.md): a
subtle pixel bug only a picture comparison finds. A screen's states are scenes (the gallery's, a component's in
`clients/app/renderer/tests/gallery/*.scenes.tsx`) or previews (an app's, in `apps/<app>/client/previews.json`, what each
screen shows with what it's given, as SwiftUI and Compose have them; the format is `screenshot.js`'s header). No network
is needed to see either. A change that makes a screen, or a state of one, adds its preview. An app's previews hold no
expectations of its own: the renderer's tests run over every one. Every change to how something looks runs, in
`clients/app/renderer/tests`, after `bun build.js` in `core/ui`:

    bun screenshot.js --release --out <scratch>/after [<folder>…]                    # on your branch: says its folders
    bun screenshot.js --release --out <scratch>/before <its folders>                 # on main, the same folders
    bun screenshot.js --release --out <scratch>/after --against <scratch>/before [<folder>…]

Without folders named, a pass (here and in animation.js) draws only the folders what changed since your branch left
main can draw differently (`git diff` from their merge base, uncommitted too, `animation/changed.js`): every one for a
change to the renderer, its tests or the UI library, else the gallery's or an app's
client's own; it says which on stderr, and `--all` draws every one. Main's pictures are kept for the machine, so a
pass of main another agent made costs little.

It draws every scene and preview, or those of the folders named, on a native host by the headless renderer, which it
builds, or takes the one any worktree on the machine built from the same (`tooling/cached-build`; `--release` for a
release build: a debug build draws several times slower), on the machine's
GPU (the Linux machine's RTX 5070 Ti; lavapipe where there's none), every one in about a minute. Like animation.js, it
runs headless renderers side by side, at most half the machine's pool (8 on the Linux machine), and says
what it found in the same order whatever finished first; `--jobs <n>` sets how many. The pool is the machine's, shared by
every pass any agent runs, as make's jobserver is (`animation/machine.js`: a core each, 16 there), so three agents' passes
take turns rather than load it to 50. A screenshot drawn from the same headless renderer, page, UI library, answers and
requests as one any worktree drew before is taken from `~/.cache/the-one-app/screenshots` (`animation/cache.js`, 2 GB, the least
recently used going), so main's "before" is drawn once for every agent, and a pass after a change draws only what it changed. Each is a persistent worker
(`--persistent_worker`, Bazel's protocol) that keeps its GPU and draws one run after another, every run else its own;
together, whoever started them, they have at most 40% of the machine's memory (systemd's `headless.slice`). `--lavapipe` draws on Mesa's lavapipe, on the CPU, instead: the second
GPU, whose frames must agree with the first's (within 0.1% on 22 Nov), run once at the end of a change to the renderer,
not every time. Compare only runs made on the same GPU. What counts is **what changed since `--against`** on our renderer
(`changed.png`, drawn where they differ): a tree that changed, or pictures more than 2% apart, is looked at. A difference that's meant is said
in the commit; one that isn't is fixed. Our renderer is the reference, judged against DESIGN.md (Raycast-inspired), not
the browser: it draws the web too. A native host that hasn't the runtime version the UI library needs draws nothing, which it says.
Every scene and preview is held to the same rules too, whatever its page (`rules.js`, and `core/ui/lint-tokens.js` for the colours
styles give words): a kind of bug found once in one gets a rule there, with any exception named and why, not a
check of that one alone.

### Checks: every change to the UI library or the renderer

A change under `core/ui/` or `clients/app/renderer/` runs the checks before it's committed, in `clients/app/renderer/tests`, after `bun
build.js` in `core/ui` (under a minute for all 663 on
the Linux machine at a load of 25, 8 headless renderers at once; a debug build takes several times as long, so name the folders your change
can touch while you work):

    bun animation.js --checks --release [<folder>…]
    bun animation.js --checks --release --dark [<folder>…]
    bun animation.js --generated 4 --release
    bun animation.js --generated 4 --release --dark

A gallery scene's `checks` (the `CheckStep` type in `core/ui/src/types/ui.d.ts`) are what people do with it and what must
hold, as the UI SDK's own tests have them, played on the headless renderer's window, a fake platform's under the loop
every host's windows run, once as it is and again with seeds that make it adversarial (refreshes late, input as
things move, presses held as long as a person's). A failure says its seed; a fix keeps it in the scene's `seeds`. Every scene at rest is drawn the same moved by whole device pixels too.
`--generated` plays pages no app draws (random cards, shadows, glass, lists, transforms and text, changing under random
drags or a wheel), every frame against the same drawn whole and moved, as other people's apps will draw what the
gallery doesn't: a seed that fails plays again alone with `--generated 1 --from <seed>`. A
component or primitive changed or added gets checks for what it promises, ported from its upstream file's tests where
it's copied from the UI SDK. A bug a device showed that the checks passed is the tests' too: make a check fail on
it first (a scene shaped like where it happened), say why the tests missed it, then fix both.

### The web

The check every change runs is the native pass above: our renderer draws the web too, so a change's web pictures are its
native ones (Andre, 23 Nov). `--web` draws each scene on the web as well, in headless Chromium (Playwright's, which
`bunx playwright-core install chromium` fetches where it's missing), on the machine's GPU, and compares `web.png` with
`native.png`: a tool for debugging the web client itself, on the scenes it's about (`--scene`), never a routine check.

### Mutants: every change to the renderer's tests

The checks are shown to work by putting back the bugs we've had, one at a time, and seeing a check fail on each, as
mutation testing does (cargo-mutants, Stryker):

    bun mutants.js [<mutant>…] [--light | --dark]

Each mutant is a bug planted where it was, behind `ONE_MUTANT=<name>` (`renderer::mutants`), which only the headless renderer's
builds have; each plays only the scenes, motions and checks that could show it, after a baseline run
of them with none. It says which it caught, by which check, and which it missed (`--list` lists them). A change to the
headless renderer, animation.js, screenshot.js or a check runs it, and must miss none. A bug a device found that the tests
missed gets a mutant beside the check that now catches it.

### Animation tests: every change to how something moves

What moves under a finger or a pointer (a drag, a swipe, a sheet pulled, a list flung or pulled past its end) and how
it springs is played headless, through the real gesture and spring code, on a paused clock, at 60 and 120 Hz, in a
few seconds: give the gallery scene that shows it `motions` (the `Motion` type in `core/ui/src/types/ui.d.ts`), then, in
`clients/app/renderer/tests`, after `bun build.js` in `core/ui`:

    bun animation.js --release --out <scratch>/before [<folder>…]          # on main, before the change
    bun animation.js --release --out <scratch>/after --against <scratch>/before [<folder>…] [--watch]

(every motion in about 20 seconds) and the same again with `--dark` (an `--out` of its own): a frame drawn on what was kept is checked against the same
drawn whole, and a light card on a near-white page leaves little to be wrong by, so on 22 Nov partial redraws that
passed in light failed 4 motions in dark.

Each motion gets a filmstrip, a position-over-time curve beside the finger's and before's, and the frames that went
over their budget, and how many frames each tier of device in `clients/app/renderer/tests/devices.json` would drop (with `--release`,
whose CPU times are a shipped build's); `index.html` there is the contact sheet. `bun calibrate.js` measures a real
device's GPU against the same work, keeping what it found there. `--watch` plays them again as you edit. A live window
takes the same `replay` through the inspector.



On a computer every app's page opens as a native window: drive it with the inspector (Native windows, below). A
screen's states with no network → `bun screenshot.js` (above): before against after.

### Native windows

An app's window is drawn natively by the launcher's process, so WebDriver doesn't reach it: drive it with the
inspector, which every native window answers (`clients/app/renderer/src/inspect.rs` is its
protocol). Find nodes by role and text, tap, type, `settle`, then `snap`, never a sleep:

- Offscreen, the same on every run, with no network: `bun dist/build/app.js apps/<app>/client <out>` in `core/ui`
  (after `bun build.js`), then `cargo run -p renderer --example headless --features fake -- <out> <png> <json>
  --ui core/ui/dist/client --answers <answers.json> --requests <requests.jsonl>`, its header says how. Its clock is
  paused: `clock` `step` moves it.
- On Windows (the Surface, `ssh surface`): build with `cargo xwin build --target x86_64-pc-windows-msvc` (the
  headless renderer as `--example headless --features fake`, the app as `-p app`) and copy it to a folder of your own in `%TEMP%`; the headless renderer
  runs over ssh as it is (Direct3D 12 draws offscreen without a desktop). The app's windows need the logged-in
  session: start it there with a scheduled task (`schtasks /Create … /IT`, `conhost.exe --headless <a .cmd setting
  ONE_HOME>`), and a second `one.exe one:<app>` with the same `ONE_HOME`, even over ssh, hands it the link. A local
  network's edge is on this machine's localhost: `ssh -N -R <port>:localhost:<port> surface` puts it at the same
  address there. Its screen is often locked: `computer-use screenshot` with the window's `pid` and `window_id`
  still pictures it. Delete the folder, the tasks and the debug build's `%LOCALAPPDATA%\app.theone.client.dev` after.
- In the app on a local network (about 9 s to a picture), with your worktree's build, `target/debug/one` (the
  `one` on your PATH is the live release, which hasn't your change; the app and the CLI are that one program):
  install the Inspector once (`target/debug/one install --app network/apps/inspector`), start `openbox` and
  `target/debug/one one:<app>` in a desktop of your own, so nothing is shared with other agents and nothing is left
  running (`ONE_HOME=<folder>/client ONE_AS=owner dbus-run-session -- xvfb-run -a -s "-screen 0 1280x900x24" sh -c
  'openbox & target/debug/one one:<app>'`: without a window manager the launcher loses its focus as it resizes and
  puts itself away, and without `dbus-run-session` GTK waits half a minute), then call its tools as that user:
  `target/debug/one inspector windows`, `… inspector tap --text …`, `… inspector settle`, `… inspector snap >
  <scratch>/<name>.png` (stdout is the PNG, the window's own size,
  1024×720 at first). They reach the window through the launcher, as an agent on another device does: it draws every
  native window itself.

### The app around its windows: every change to `clients/app/src/`

What a device does with the app itself, not one page (its launcher, an app's window opened, closed and opened
again, a second start, an update's restart, pages gone stale as it starts) is checked by a throwaway check: the app
on a local network of your own (`local-network`), in a desktop of your own (Native windows, above), driven with the
inspector and capped as every process an agent starts on a machine others share is (one render grew to 28 GB and froze
the whole container, 21 Nov). Nothing of it is kept. A bug a device found there is reproduced first, then fixed.

### Android

An emulator with the AVD `one-phone` (Android 36, x86_64, KVM) is set up here:

    ~/Android/Sdk/emulator/emulator -avd one-phone -no-window -no-audio &
    adb install -r <the APK `cargo tauri android build` says it made>
    adb exec-out screencap -p > <scratch>/<name>.png

How to build the APK is in `clients/app/README.md`. Rust alone checks for Android with the NDK's compilers on `PATH`:
`PATH=~/Android/Sdk/ndk/<version>/toolchains/llvm/prebuilt/linux-x86_64/bin:$PATH cargo check -p renderer --target
x86_64-linux-android`. In a worktree that hasn't built yet, run `tooling/copy-build --android` first
(Cargo's Android target, Gradle's build folders and the generated project come from the worktree that built an APK last, so the
build is about a minute, not minutes); sccache and `~/.gradle` are already shared by every worktree. A new AVD's Chrome asks to
sign in and about notifications the first time it opens, and ignores its command-line file (`--disable-fre`) on a phone that
isn't debuggable: tap "Use without an account" and "No thanks" once (find them with `adb shell uiautomator dump`), and the
AVD keeps that. A phone's app needs a network's address
(the one `tooling/network` prints, in its home's `network` file: `clients/app/README.md`); `adb reverse tcp:<port> tcp:<port>` makes
the emulator's `localhost:<port>` this machine's. Stop the emulator when you're done (`adb emu kill`).

A debug build's app is a WebView that takes CDP: `adb forward tcp:0 localabstract:webview_devtools_remote_$(adb
shell pidof app.theone.client)` gives the port, `/json` there its page, and an app's frame is in `Page.getFrameTree`.
That's how touch and a second finger reach it (`Input.dispatchTouchEvent`); `adb shell input` has one finger.

### iPhone simulator

On the Mac (the `iphone` skill for ssh), build with `--target aarch64-sim --debug`, then:

    xcrun simctl boot "one throwaway iPhone"
    xcrun simctl install booted <the .app>
    xcrun simctl launch booted app.theone.client
    xcrun simctl io booted screenshot <file>.png

`scp mac:<file>.png` brings the picture back. Shut the simulator down after (`xcrun simctl shutdown booted`).

The app keeps its client in its App Group, which the simulator gives it, so `main.mm` sets `ONE_HOME` to that and
`SIMCTL_CHILD_ONE_HOME` changes nothing. To open it on a network of your own, set aside what's in
`xcrun simctl get_app_container booted app.theone.client group.app.theone.client`, put your client's `key` and
`network` there, make the network's address the Mac's too (`ssh -N -R <port>:localhost:<port> mac`), launch with
`SIMCTL_CHILD_ONE_AS=owner`, and put back what was there after. `axe tap -x <x> -y <y> --udid <udid>` taps, in points. `axe swipe` and drags need `--delta 4` to move like a finger: its default
steps of 50 px look like a velocity bug in any gesture.

## Mistakes already made

- Pictures in the web client (`clients/web`) in Chrome: a browser signs in with a passkey and holds nobody's key, so
  the Vault and what's encrypted don't open there as they do in the app.

- Checking again after rebasing onto other people's unrelated commits.
- A check that read a log before the process had created it, and failed for that. Follow a log with `tail -F`, as
  `tooling/network` does, never by reading it once.
- Merging a fix whose check was failing, on the guess that the check was wrong.
- Reproducing a reported bug in your own setup when it only happens in the reporter's: half an hour at the default
  text size for a bug that showed only at the owner's. Start with their exact device, size, text size and build.
