// The rail's line, over an app, which a finger pulls in to go home.
import { call, launcher } from "./apps.js"
import { homes } from "./chrome.js"
import { backHome, here, moving, on, showing, shown, windows } from "./client.js"
import { listen } from "./host.js"
import { HELD } from "./move-machine.js"
import { byId } from "./util.js"

/// The rail: every app's way back to the Home Screen, above every app on a phone or a tablet: a home line on the
/// window's right edge, iOS's home indicator on its side, which a finger pulls in to go home (`pull`). It keeps out of
/// the way while something of the app's is open over it (a sheet, a menu), as the device's back does. A computer has
/// none: each app is a window of its own there, which the computer's own Dock or taskbar goes between.
const line = byId("line")
/// On a wider screen in a browser, the Home button over an app (index.html's #home), which goes home as Back does.
const home = byId("home")

/// Whether the rail's line shows: while the window shows its apps and has a Home Screen to go back to, over an app,
/// at any of its screens, unless something is drawn over it, a sheet or a menu (`data-away`). Android is told where
/// the line is, which its back gesture leaves to it.
/** @type {string | undefined} */
let excluded
/// The fingers on the line, by their pointers, where each came down, and the one pulling it (`pull`, below).
/** @type {Map<number, { x: number, y: number }>} */
const touching = new Map()
/** @type {{ id: number, x: number, recent: [number, number][] } | undefined} */
let pull
export function rail() {
  const now = shown.getSnapshot()
  // A computer's windows have none: its own Dock or taskbar goes between them.
  const homed = Boolean(launcher) && !windows && now.hasTag("pages") && !now.matches("app_store")
  const lined = homed && here() !== null && !showing(here())?.layer
  line.toggleAttribute("data-away", !lined)
  // On a wider screen in a browser, its Home button too, at the top of the app's frame (chrome.js's `homes`), whose
  // top bar starts after it, as every app is told as it opens and as the window's width changes (`titleRow`).
  const view = showing(here())
  const button = lined && !!view && homes(view)
  home.toggleAttribute("data-away", !button)
  if (view && button) home.style.top = `${view.frame.offsetTop}px`
  if (homed) ask()
  tipping(lined)
  // A line that went home under a finger comes back with its app; the tip's hint's finger has it while it pulls.
  if (lined && !pull && !hinting?.grabbed) line.toggleAttribute("data-pulled", false)
  const at = lined ? line.getBoundingClientRect() : undefined
  const edge = at ? [at.left, at.top, at.right, at.bottom].map(Math.round).join(",") : ""
  if (edge !== excluded) globalThis.androidEdge?.postMessage(edge)
  excluded = edge
}
addEventListener("resize", rail)
home.addEventListener("click", backHome)

/// How far in, as a share of the window's width, past which a finger let go of the line goes home.
const PULLED = 0.18
/// A finger on the line, pulling it in: once it has come in far enough to say so, the window's move to the Home
/// Screen follows it (`grab` with `home`, and `drag`), the app as far shrunk as `p`, and let go, it goes home if it
/// came in past `PULLED` or was flicked in, and otherwise springs back. A tap does nothing. The first finger to come
/// in takes it, and only its lifting lets go: another on the line meanwhile, as the hand holding the phone touches
/// its edge, is ignored, as iOS's swipe home ignores a second finger.
line.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return
  line.setPointerCapture(event.pointerId)
  touching.set(event.pointerId, { x: event.clientX, y: event.clientY })
})
line.addEventListener("pointermove", (event) => {
  const down = touching.get(event.pointerId)
  if (!pull && down) {
    // Too little yet to say which way it goes; up or down isn't a pull.
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) < 8) return
    touching.delete(event.pointerId)
    if (!(down.x > event.clientX && Math.abs(event.clientX - down.x) > Math.abs(event.clientY - down.y))) return
    // A finger takes the line from the hint, wherever its app had got to.
    stopHint()
    on({ type: "grab", home: true })
    if (moving()?.matches("tracking")) pull = { id: event.pointerId, x: down.x, recent: [] }
    rail()
  }
  if (event.pointerId !== pull?.id) return
  // Its button is up, and the line never heard it go: it's let go here.
  if (event.buttons === 0) return letGo(event)
  const inward = (pull.x - event.clientX) / innerWidth
  // The app follows the finger, and past the card (`HELD`) slows to a stop, as a rubber band does.
  const p = HELD * Math.tanh(Math.max(0, inward) / HELD)
  pull.recent = [...pull.recent.filter(([then]) => event.timeStamp - then <= 100), [event.timeStamp, inward]]
  line.toggleAttribute("data-pulled", true)
  on({ type: "drag", p })
})
/** @param {{ pointerId: number, type: string }} event */
function letGo(event) {
  touching.delete(event.pointerId)
  if (event.pointerId !== pull?.id) return
  const moves = pull.recent
  // How fast it was coming in over its last tenth of a second, in widths a second.
  const [[since, was] = [0, 0]] = moves
  const [at, inward] = moves.at(-1) ?? [0, 0]
  const velocity = at - since >= 20 ? ((inward - was) / (at - since)) * 1000 : 0
  const home = event.type !== "pointercancel" && (inward >= PULLED || velocity > 0.6)
  if (!home) line.toggleAttribute("data-pulled", false)
  on({ type: "release", velocity: Math.max(0, velocity) * (home ? 1 : 0), end: home ? 1 : 0 })
  // Going home, it stays hidden as the window's history follows.
  pull = undefined
  if (home && unseen) tipped()
  rail()
}
line.addEventListener("pointerup", letGo)
line.addEventListener("pointercancel", letGo)
// A pull the browser stops telling the line about lets go as a lift would, where it is: its capture lost before the
// button was let go (the button then let go over an app's frame, which hears it), or the window put away under it
// (another app, a menu), where the button is let go. Waiting for a lift the line never hears left the app frozen as a
// card over the Home Screen (22 Nov). After a lift, the capture lost says nothing more.
line.addEventListener("lostpointercapture", letGo)
addEventListener("blur", () => pull && letGo({ pointerId: pull.id, type: "blur" }))

/// The rail's tip, "Pull to go home" (index.html's `#tip`): over the first app a person opens where a finger works the
/// line (a phone, a tablet, the mobile web; not a computer's browser, though its line is there too), until they pull it
/// home or tap Got it, once for them on every device, as Home Screen keeps it (its `tips`). Until then, unless they
/// asked for less motion, it shows how (`hint`), and while a finger is on the line, it's away.
const tip = byId("tip")
const touch = matchMedia("(pointer: coarse)")
/// Whether this person has yet to see it: asked of Home Screen as the Home Screen first shows, before any app opens,
/// and `false` until it answers, or where there's no Home Screen to ask (a network whose launcher is another app's).
/// A phone draws its apps' windows itself, so it's told as each opens (`tip` with `open_window`), and says when it was
/// seen there (`tipped`).
export let unseen = false
let asked = false
function ask() {
  if (asked || !touch.matches) return
  asked = true
  call("home-screen_tips").then(({ seen }) => {
    unseen = !seen.includes("pull-home")
    rail()
  })
}
// What it said kept from before is asked again, and once what the client's asked has changed, it's asked once more.
listen("changed", ({ payload: view }) => {
  if (view !== "client" || !asked) return
  asked = false
  ask()
})
/** @param {boolean} lined */
function tipping(lined) {
  tip.hidden = !(lined && touch.matches && unseen && !pull)
  if (tip.hidden) stopHint()
  else if (!hinting && !matchMedia("(prefers-reduced-motion: reduce)").matches) hint((hinting = {}))
}
/// They've seen it: it goes, for good, on every device.
function tipped() {
  unseen = false
  rail()
  call("home-screen_tip", { name: "pull-home", seen: true })
}
byId("tip-done").addEventListener("click", tipped)
listen("tipped", tipped)

/// The hint, the mockup's: a see-through finger comes down on the line and pulls the app in a little, a pull home as a
/// finger's (`grab` with `home`, then `drag`), its trail behind it, then lets go, and the app springs back; again
/// every few seconds, for as long as the tip shows. A finger on the line takes the app from it (`stopHint`).
/** @type {{ grabbed?: boolean } | undefined} */
let hinting
/// How far in the finger pulls the app, as a share of the window's width: its right edge there, a little shrunk.
const HINTED = 0.3
const [finger, trail] = [/** @type {HTMLElement} */ (tip.querySelector(".finger")), /** @type {HTMLElement} */ (tip.querySelector(".trail"))]
/** @param {{ grabbed?: boolean }} run */
async function hint(run) {
  const wait = (/** @type {number} */ ms) => new Promise((resolve, reject) => setTimeout(() => (run === hinting ? resolve(undefined) : reject()), ms))
  try {
    for (;;) {
      await wait(600)
      // Not while the window moves (an app opening, a finger's pull springing back).
      if (!moving()?.matches("still")) continue
      finger.animate([{ opacity: 0, scale: 1.35 }, { opacity: 1, scale: 1 }], { duration: 240, easing: "ease-out", fill: "forwards" })
      await wait(380)
      on({ type: "grab", home: true })
      if (!moving()?.matches("tracking")) {
        for (const animation of finger.getAnimations()) animation.cancel()
        continue
      }
      run.grabbed = true
      line.toggleAttribute("data-pulled", true)
      const reach = -HINTED * innerWidth
      const timing = { duration: 820, easing: "cubic-bezier(.45,0,.25,1)", fill: /** @type {const} */ ("forwards") }
      const along = finger.animate([{ opacity: 1, translate: "0px 0px" }, { opacity: 1, translate: `${reach}px 0px` }], timing)
      trail.animate([{ opacity: 1, width: "0px" }, { opacity: 1, width: `${-reach}px` }], timing)
      // The app follows the finger, frame by frame, as a finger's pull has it follow its moves.
      while (along.playState === "running") {
        await new Promise(requestAnimationFrame)
        if (run !== hinting) throw undefined
        on({ type: "drag", p: HINTED * (along.effect?.getComputedTiming().progress ?? 1) })
      }
      await wait(220)
      finger.animate([{ opacity: 1 }, { opacity: 0, scale: 1.25 }], { duration: 220, fill: "forwards" })
      trail.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" })
      run.grabbed = false
      on({ type: "release", velocity: 0, end: 0 })
      await wait(480)
      line.toggleAttribute("data-pulled", false)
      for (const part of [finger, trail]) for (const animation of part.getAnimations()) animation.cancel()
      await wait(1100)
    }
  } catch {
    // Stopped (`stopHint`).
  }
}
/// The hint stops where it is: the app it held springs back, and the finger goes.
function stopHint() {
  if (!hinting) return
  if (hinting.grabbed) on({ type: "release", velocity: 0, end: 0 })
  hinting = undefined
  if (!pull) line.toggleAttribute("data-pulled", false)
  for (const part of [finger, trail]) for (const animation of part.getAnimations()) animation.cancel()
}
