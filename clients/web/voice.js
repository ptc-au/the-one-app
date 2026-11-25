// A page's `voice` nodes' audio, run here in the client's own page rather than in the app's frame: a frame is given
// an origin of its own that reaches nothing (`host.js`'s `sandbox`), and a browser refuses a microphone to a page
// without one before it asks anyone, so the app's page hands the SDP to its tools and hears the events, and the
// microphone, the connection and the sound are this page's.

/** How loud the microphone is when the person starts speaking, and when they've stopped, in RMS (`voice.rs`'s). */
const SPEAKING = 0.02
const QUIET = 0.008

/** Each voice by its frame and node, as the frame names it (`bridge.js`'s `one/voice`). */
/** @type {Map<string, any>} */
const all = new Map()

/** Its local description once its candidates are gathered, or a relay's came, as an SFU needs to reach it. */
const gathered = (/** @type {RTCPeerConnection} */ pc) => {
  if (pc.iceGatheringState === "complete") return Promise.resolve()
  return new Promise((done) => {
    const timer = setTimeout(done, 5000)
    pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && (clearTimeout(timer), done(undefined))
    pc.onicecandidate = ({ candidate }) => candidate?.type === "relay" && (clearTimeout(timer), setTimeout(done, 300))
  })
}

/** Whether the person is speaking, from the microphone's level, as its own audio plays: `onSpeaking`. */
const listen = (/** @type {any} */ voice, /** @type {(event: Record<string, unknown>) => void} */ tell) => {
  if (!voice.mic || !globalThis.AudioContext || voice.timer) return
  const context = (voice.context = new AudioContext())
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  context.createMediaStreamSource(voice.mic).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  voice.timer = setInterval(() => {
    if (all.get(voice.key) !== voice) return
    analyser.getFloatTimeDomainData(samples)
    const level = Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / samples.length)
    const speaking = !voice.muted && level > (voice.speaking ? QUIET : SPEAKING)
    if (speaking !== voice.speaking) {
      voice.speaking = speaking
      tell({ name: "speaking", speaking })
    }
  }, 100)
}

/** A new connection, each `ice`, the last one closed, as the DOM's `Voice` makes one. */
const connect = (/** @type {any} */ voice, /** @type {RTCConfiguration} */ ice, /** @type {(event: Record<string, unknown>) => void} */ tell) => {
  voice.over()
  if (!globalThis.RTCPeerConnection) return tell({ name: "state", state: "lost" })
  const pc = (voice.peer = new RTCPeerConnection(ice))
  let over = false
  const lost = () => !over && ((over = true), tell({ name: "state", state: "lost" }))
  voice.over = () => ((over = true), pc.close())
  tell({ name: "state", state: "connecting" })
  // One sendonly track for the local microphone; remote tracks arrive on their own transceivers via SFU offers.
  const transceiver = pc.addTransceiver("audio", { direction: "sendonly" })
  voice.sender = transceiver.sender
  if (voice.track) voice.sender.replaceTrack(voice.track).catch(() => {})
  pc.ontrack = ({ track }) => {
    if (track.kind !== "audio") return
    // Each remote track gets its own <audio> element and explicit play() so Chrome starts newly negotiated tracks.
    const el = document.createElement("audio")
    Object.assign(el, { autoplay: true, playsInline: true })
    el.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none"
    el.srcObject = new MediaStream([track])
    document.body.append(el)
    voice.audios.add(el)
    el.play().catch(() => {})
    track.addEventListener("ended", () => {
      voice.audios.delete(el)
      el.remove()
    })
  }
  pc.onconnectionstatechange = () => {
    if (over) return
    if (pc.connectionState === "connected") tell({ name: "state", state: "connected" })
    else if (pc.connectionState === "connecting" || pc.connectionState === "disconnected") tell({ name: "state", state: "connecting" })
    else if (pc.connectionState === "failed" || pc.connectionState === "closed") lost()
  }
  pc.setLocalDescription()
    .then(() => gathered(pc))
    .then(
      () => {
        if (over) return
        tell({ name: "offer", sdp: pc.localDescription?.sdp })
        // An SFU's offer, which its page set before it had a connection to answer: answered once its own offer's
        // been sent.
        if (voice.offer) answered(voice, voice.offer, tell)
      },
      lost,
    )
}

/** An SFU's offer, which it answers as the polite peer: its own offer is rolled back first, as browsers do. */
const answered = async (/** @type {any} */ voice, /** @type {string} */ sdp, /** @type {(event: Record<string, unknown>) => void} */ tell) => {
  const pc = voice.peer
  if (!pc) return
  try {
    if (pc.signalingState !== "stable") await pc.setLocalDescription({ type: "rollback" }).catch(() => {})
    await pc.setRemoteDescription({ type: "offer", sdp })
    await pc.setLocalDescription()
    await gathered(pc)
    tell({ name: "answer", sdp: pc.localDescription?.sdp })
  } catch {
    voice.over()
  }
}

/**
 * One of a page's voices: `create` makes it, taking the microphone; `set` hands it what its page gives it (`ice`,
 * `answer`, `offer`, `muted`); `drop` ends it. What it hears comes back through `tell`, to the page that made it.
 * @param {string} op @param {string} key @param {any} params @param {(event: Record<string, unknown>) => void} tell
 */
export function voice(op, key, params, tell) {
  if (op === "create") {
    if (all.has(key)) return
    /** @type {any} */
    const one = { key, audios: new Set(), peer: null, sender: null, mic: null, track: null, muted: false, context: null, timer: null, speaking: false, offer: null, over: () => {} }
    all.set(key, one)
    // The microphone, with the system's own echo cancellation and noise suppression, as a call asks for. Without one,
    // the call is heard and not heard from.
    navigator.mediaDevices
      ?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(
        (mic) => {
          if (all.get(key) !== one) return mic.getTracks().forEach((/** @type {MediaStreamTrack} */ track) => track.stop())
          one.mic = mic
          one.track = mic.getAudioTracks()[0] ?? null
          if (one.track) one.track.enabled = !one.muted
          one.sender?.replaceTrack(one.track).catch(() => {})
          listen(one, tell)
        },
        // Refused, by the person or the browser: the page hears it as a call that's lost.
        () => tell({ name: "state", state: "lost" }),
      )
    return
  }
  const one = all.get(key)
  if (!one) return
  if (op === "set") {
    const { name, value } = params
    if (name === "ice" && value) connect(one, value, tell)
    else if (name === "answer" && value && one.peer?.signalingState === "have-local-offer") one.peer.setRemoteDescription({ type: "answer", sdp: value }).catch(() => one.over())
    else if (name === "offer" && value) {
      // Answered once it has a connection, as an SFU's offer is, and not twice.
      if (one.offer === value) return
      one.offer = value
      if (one.peer) answered(one, value, tell)
    } else if (name === "muted") {
      one.muted = !!value
      if (one.track) one.track.enabled = !one.muted
    }
    return
  }
  if (op === "drop") {
    one.over()
    clearInterval(one.timer)
    one.context?.close()
    one.mic?.getTracks().forEach((/** @type {MediaStreamTrack} */ track) => track.stop())
    for (const el of one.audios) el.remove()
    one.audios.clear()
    all.delete(key)
  }
}

/** Ends each voice a frame made, as its window closes: its page is gone, and its microphone with it. */
export function dropped(/** @type {string} */ key) {
  for (const one of [...all.keys()]) if (one.startsWith(`${key}|`)) voice("drop", one, {}, () => {})
}
