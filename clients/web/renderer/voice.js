// A page's `voice` nodes on the web (renderer.ts's `voice`): each a call's audio over WebRTC, which the browser
// connects and plays as the DOM does (core/ui/src/drawing-primitives/primitives.tsx, whose connection this is), with
// the microphone's one Opus track sent and each track it receives played, and the microphone's level saying whether
// the person is speaking. What it says the page hears as events (`offer`, `answer`, `state`, `speaking`).

/** How loud the microphone is when the person starts speaking, and when they've stopped, in RMS (`voice.rs`'s). */
const SPEAKING = 0.02
const QUIET = 0.008

/**
 * The page's voices: `created`, `set` and `dropped` follow its mutations.
 */
export function voices() {
  /** @type {Map<number, any>} */
  const all = new Map()
  const tell = (/** @type {object} */ event) => globalThis.ui?.event({ timeStamp: performance.now(), ...event })

  /** Its local description once its candidates are gathered, or a relay's came, as an SFU needs to reach it. */
  const gathered = (/** @type {RTCPeerConnection} */ pc) =>
    new Promise((done) => {
      const timer = setTimeout(done, 5000)
      pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && (clearTimeout(timer), done(undefined))
      pc.onicecandidate = ({ candidate }) => candidate?.type === "relay" && (clearTimeout(timer), setTimeout(done, 300))
    })

  /** Whether the person is speaking, from the microphone's level, as its own audio plays: `onSpeaking`. */
  const listen = (/** @type {any} */ voice) => {
    if (!voice.mic || !globalThis.AudioContext || voice.timer) return
    const context = (voice.context = new AudioContext())
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(voice.mic).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    voice.timer = setInterval(() => {
      if (!all.has(voice.id)) return
      analyser.getFloatTimeDomainData(samples)
      const level = Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / samples.length)
      const speaking = !voice.muted && level > (voice.speaking ? QUIET : SPEAKING)
      if (speaking !== voice.speaking) {
        voice.speaking = speaking
        tell({ id: voice.id, name: "speaking", speaking })
      }
    }, 100)
  }

  /** @param {number} id */
  const make = (id) => {
    const audio = document.createElement("audio")
    Object.assign(audio, { autoplay: true, playsInline: true })
    // In the frame, unseen, so it plays: the browser plays the call's sound, not a picture.
    audio.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none"
    document.body.append(audio)
    const voice = { id, audio, peer: null, sender: null, mic: null, track: null, muted: false, context: null, timer: null, speaking: false, offer: null, over: () => {} }
    // The microphone, with the system's own echo cancellation and noise suppression, as a call asks for. Without one,
    // the call is heard and not heard from.
    navigator.mediaDevices
      ?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((mic) => {
        if (!all.has(id)) return mic.getTracks().forEach((/** @type {MediaStreamTrack} */ track) => track.stop())
        voice.mic = mic
        voice.track = mic.getAudioTracks()[0] ?? null
        if (voice.track) voice.track.enabled = !voice.muted
        voice.sender?.replaceTrack(voice.track).catch(() => {})
        listen(voice)
      }, () => {})
    return voice
  }

  /** A new connection, each `ice`, the last one closed, as the DOM's `Voice` makes one. */
  const connect = (/** @type {any} */ voice, /** @type {RTCConfiguration} */ ice) => {
    voice.over()
    if (!globalThis.RTCPeerConnection) return tell({ id: voice.id, name: "state", state: "lost" })
    const pc = (voice.peer = new RTCPeerConnection(ice))
    let over = false
    const lost = () => !over && ((over = true), tell({ id: voice.id, name: "state", state: "lost" }))
    voice.over = () => ((over = true), pc.close())
    tell({ id: voice.id, name: "state", state: "connecting" })
    // The one track it sends, and the ones it receives: each remote track plays with the others.
    const transceiver = pc.addTransceiver("audio", { direction: "sendrecv" })
    voice.sender = transceiver.sender
    if (voice.track) voice.sender.replaceTrack(voice.track).catch(() => {})
    pc.ontrack = ({ track }) => {
      if (track.kind !== "audio") return
      const mix = (voice.mix ??= new MediaStream())
      if (!mix.getTracks().includes(track)) mix.addTrack(track)
      voice.audio.srcObject = mix
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") tell({ id: voice.id, name: "state", state: "connected" })
      else if (["failed", "closed"].includes(pc.connectionState)) lost()
    }
    pc.oniceconnectionstatechange = () => pc.iceConnectionState === "disconnected" && lost()
    pc.setLocalDescription()
      .then(() => gathered(pc))
      .then(
        () => {
          if (over) return
          tell({ id: voice.id, name: "offer", sdp: pc.localDescription?.sdp })
          // An SFU's offer, which its page set before it had a connection to answer: answered once its own offer's
          // been sent.
          if (voice.offer) answered(voice, voice.offer)
        },
        lost,
      )
  }

  /** An SFU's offer, which it answers as the polite peer: its own offer is rolled back first, as browsers do. */
  const answered = async (/** @type {any} */ voice, /** @type {string} */ sdp) => {
    const pc = voice.peer
    if (!pc) return
    try {
      if (pc.signalingState !== "stable") await pc.setLocalDescription({ type: "rollback" }).catch(() => {})
      await pc.setRemoteDescription({ type: "offer", sdp })
      await pc.setLocalDescription()
      await gathered(pc)
      tell({ id: voice.id, name: "answer", sdp: pc.localDescription?.sdp })
    } catch {
      voice.over()
    }
  }

  return {
    created: (/** @type {number} */ id) => all.set(id, make(id)),
    /** @param {number} id @param {string} name @param {any} value */
    set(id, name, value) {
      const voice = all.get(id)
      if (!voice) return
      if (name === "ice" && value) connect(voice, value)
      else if (name === "answer" && value && voice.peer?.signalingState === "have-local-offer") voice.peer.setRemoteDescription({ type: "answer", sdp: value }).catch(() => voice.over())
      else if (name === "offer" && value) {
        // Answered once it has a connection, as an SFU's offer is, and not twice.
        if (voice.offer === value) return
        voice.offer = value
        if (voice.peer) answered(voice, value)
      } else if (name === "muted") {
        voice.muted = !!value
        if (voice.track) voice.track.enabled = !voice.muted
      }
    },
    dropped(/** @type {number} */ id) {
      const voice = all.get(id)
      if (!voice) return
      voice.over()
      clearInterval(voice.timer)
      voice.context?.close()
      voice.mic?.getTracks().forEach((/** @type {MediaStreamTrack} */ track) => track.stop())
      voice.audio.remove()
      all.delete(id)
    },
  }
}
