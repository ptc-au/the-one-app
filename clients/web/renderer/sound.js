// A page's `play` on the web: a short sound its app ships, played by this frame's own Web Audio on the browser's default
// output, as any page's sound is, so it follows the device's volume and mute and goes beside a call, which is the client's
// page's (`../voice.js`), not this frame's. A browser lets a page play a sound once its person has pressed something in it
// (autoplay), which is why a sound before that throws instead of waiting and playing late.

/** @type {AudioContext | undefined} */
let speakers

/** Plays the sound at `url` once. @param {URL} url */
export async function play(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url.pathname.split("/").slice(-3).join("/").replace(/@[^/]+/, "")} answered ${response.status}`)
  speakers ??= new AudioContext()
  const buffer = await speakers.decodeAudioData(await response.arrayBuffer())
  // A context a browser keeps from starting never answers `resume`.
  await Promise.race([speakers.resume(), new Promise((later) => setTimeout(later, 200))])
  if (speakers.state !== "running") throw new Error("The browser plays a page's sounds once its person has pressed something in it")
  const sound = new AudioBufferSourceNode(speakers, { buffer })
  sound.connect(speakers.destination)
  sound.start()
}
