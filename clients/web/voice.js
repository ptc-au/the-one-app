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

/** Telemetry reporter wired from `host.js` (`report`). @type {(record: Record<string, unknown>) => void} */
let reportVoice = () => {}

/** Wires `host.js`'s Telemetry reporter into voice diagnostics. */
export function setVoiceReporter(/** @type {(record: Record<string, unknown>) => void} */ fn) {
  reportVoice = fn
}

const logVoice = (/** @type {string} */ step, /** @type {any} */ voice, /** @type {unknown} */ err, /** @type {Record<string, unknown>} */ extra = {}) => {
  const pc = voice?.peer
  const error = err instanceof Error ? err.message : err ? String(err) : undefined
  reportVoice({
    name: "one.client.voice",
    error: error ?? `${step} (${pc?.connectionState ?? "no-pc"})`,
    attributes: {
      "voice.step": step,
      "voice.connection_state": pc?.connectionState ?? "none",
      "voice.ice_state": pc?.iceConnectionState ?? "none",
      "voice.signaling_state": pc?.signalingState ?? "none",
      "voice.has_mic": !!voice?.track,
      "voice.remote_tracks": voice?.audios?.size ?? 0,
      ...extra,
    },
  })
}

/** Its local description once its candidates are all gathered, as an SFU needs to reach it: its gathering's own event says so. */
const gathered = (/** @type {RTCPeerConnection} */ pc) => {
  if (pc.iceGatheringState === "complete") return Promise.resolve()
  return new Promise((done) => {
    const changed = () => {
      if (pc.iceGatheringState !== "complete") return
      pc.removeEventListener("icegatheringstatechange", changed)
      done(undefined)
    }
    pc.addEventListener("icegatheringstatechange", changed)
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

/** Audio constraints for `getUserMedia`, targeting `deviceId` when one is chosen. */
const audioConstraints = (/** @type {string | null} */ deviceId) => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
})

/** Routes an `<audio>` element to the chosen output device where the browser supports `setSinkId`. */
const applyOutput = (/** @type {any} */ one, /** @type {HTMLAudioElement} */ el) => {
  if (typeof el.setSinkId !== "function") return
  el.setSinkId(one.output || "").catch((/** @type {unknown} */ err) => logVoice("set_sink_id", one, err))
}

/** Enumerates audio inputs and outputs and tells the page (`onDevices`). */
const listDevices = async (/** @type {any} */ one, /** @type {(event: Record<string, unknown>) => void} */ tell) => {
  if (!navigator.mediaDevices?.enumerateDevices) return
  try {
    const found = await navigator.mediaDevices.enumerateDevices()
    if (all.get(one.key) !== one) return
    const seen = new Set()
    /** @type {{ id: string; label: string }[]} */
    const inputs = []
    /** @type {{ id: string; label: string }[]} */
    const outputs = []
    for (const d of found) {
      if (!d.deviceId || d.deviceId === "default" || d.deviceId === "communications") continue
      const key = `${d.kind}:${d.deviceId}`
      if (seen.has(key)) continue
      seen.add(key)
      if (d.kind === "audioinput") inputs.push({ id: d.deviceId, label: d.label || `Microphone ${inputs.length + 1}` })
      else if (d.kind === "audiooutput") outputs.push({ id: d.deviceId, label: d.label || `Speaker ${outputs.length + 1}` })
    }
    tell({ name: "devices", inputs, outputs })
  } catch (err) {
    logVoice("enumerate_devices", one, err)
  }
}

/** Releases the current microphone stream and its speaking analyser. */
const stopMic = (/** @type {any} */ one) => {
  clearInterval(one.timer)
  one.timer = null
  one.context?.close().catch((/** @type {unknown} */ err) => logVoice("close_audio_context", one, err))
  one.context = null
  one.mic?.getTracks().forEach((/** @type {MediaStreamTrack} */ track) => track.stop())
  one.mic = null
  one.track = null
}

/** Opens (or switches to) the chosen microphone, falling back to system default if a saved device is gone. */
const openMic = async (/** @type {any} */ one, /** @type {(event: Record<string, unknown>) => void} */ tell) => {
  const seq = ++one.micSeq
  const wanted = one.input
  if (!navigator.mediaDevices?.getUserMedia) return
  let mic
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(wanted) })
  } catch (/** @type {any} */ err) {
    if (wanted && (err?.name === "OverconstrainedError" || err?.name === "NotFoundError")) {
      one.input = null
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(null) })
      } catch (fallbackErr) {
        if (all.get(one.key) !== one || one.micSeq !== seq) return
        logVoice("get_user_media", one, fallbackErr)
        tell({ name: "state", state: "lost" })
        return
      }
    } else {
      if (all.get(one.key) !== one || one.micSeq !== seq) return
      logVoice("get_user_media", one, err)
      tell({ name: "state", state: "lost" })
      return
    }
  }
  if (all.get(one.key) !== one || one.micSeq !== seq) {
    mic.getTracks().forEach((/** @type {MediaStreamTrack} */ track) => track.stop())
    return
  }
  stopMic(one)
  one.mic = mic
  one.track = mic.getAudioTracks()[0] ?? null
  if (one.track) one.track.enabled = !one.muted
  one.sender?.replaceTrack(one.track).catch((/** @type {unknown} */ err) => logVoice("replace_track", one, err))
  listen(one, tell)
  void listDevices(one, tell)
}

/** Stops a voice's remote audio, which a connection made as its tracks came: each element is let go of, and its sound with it. */
const hush = (/** @type {any} */ voice) => {
  for (const el of voice.audios) {
    el.pause()
    el.srcObject = null
    el.remove()
  }
  voice.audios.clear()
}

/** A new connection, each `ice`, the last one closed, as the DOM's `Voice` makes one. */
const connect = (/** @type {any} */ voice, /** @type {RTCConfiguration} */ ice, /** @type {(event: Record<string, unknown>) => void} */ tell) => {
  voice.over()
  if (!globalThis.RTCPeerConnection) return tell({ name: "state", state: "lost" })
  let over = false
  let pc = /** @type {RTCPeerConnection | null} */ (null)
  const lost = () => !over && ((over = true), tell({ name: "state", state: "lost" }))
  voice.over = () => {
    over = true
    pc?.close()
    hush(voice)
  }
  tell({ name: "state", state: "connecting" })
  // Wait for getUserMedia before creating the offer so the SDP carries the real track's msid and SSRC;
  // Cloudflare Realtime SFU drops RTP packets whose SSRC wasn't declared in the initial tracks/new offer.
  Promise.resolve(voice.ready).then(() => {
    if (over) return
    pc = voice.peer = new RTCPeerConnection(ice)
    const transceiver = voice.track
      ? pc.addTransceiver(voice.track, { direction: "sendonly", streams: voice.mic ? [voice.mic] : [] })
      : pc.addTransceiver("audio", { direction: "sendonly" })
    voice.sender = transceiver.sender
    pc.ontrack = ({ track }) => {
      if (track.kind !== "audio") return
      // Each remote track gets its own <audio> element and explicit play() so Chrome starts newly negotiated tracks.
      const el = document.createElement("audio")
      Object.assign(el, { autoplay: true, playsInline: true })
      el.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none"
      el.srcObject = new MediaStream([track])
      applyOutput(voice, el)
      document.body.append(el)
      voice.audios.add(el)
      el.play().catch((err) => logVoice("audio_play", voice, err))
      track.addEventListener("ended", () => {
        voice.audios.delete(el)
        el.remove()
      })
    }
    pc.onconnectionstatechange = () => {
      if (over || !pc) return
      if (pc.connectionState === "connected") {
        tell({ name: "state", state: "connected" })
      } else if (pc.connectionState === "connecting" || pc.connectionState === "disconnected") {
        tell({ name: "state", state: "connecting" })
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        logVoice("connection_lost", voice, `connectionState=${pc.connectionState} iceState=${pc.iceConnectionState}`)
        lost()
      }
    }
    pc.setLocalDescription()
      .then(() => gathered(/** @type {RTCPeerConnection} */ (pc)))
      .then(
        () => {
          if (over || !pc) return
          tell({ name: "offer", sdp: pc.localDescription?.sdp })
          // An SFU's offer, which its page set before it had a connection to answer: answered once its own offer's
          // been sent.
          if (voice.offer) answered(voice, voice.offer, tell)
        },
        lost,
      )
  })
}

/** An SFU's offer, which it answers as the polite peer: its own offer is rolled back first, as browsers do. */
const answered = async (/** @type {any} */ voice, /** @type {string} */ sdp, /** @type {(event: Record<string, unknown>) => void} */ tell) => {
  const pc = voice.peer
  if (!pc) return
  try {
    if (pc.signalingState !== "stable") await pc.setLocalDescription({ type: "rollback" })
    await pc.setRemoteDescription({ type: "offer", sdp })
    await pc.setLocalDescription()
    await gathered(pc)
    tell({ name: "answer", sdp: pc.localDescription?.sdp })
  } catch (err) {
    logVoice("renegotiate_offer", voice, err)
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
    const one = {
      key,
      audios: new Set(),
      peer: null,
      sender: null,
      mic: null,
      track: null,
      ready: null,
      micSeq: 0,
      micStarted: false,
      input: null,
      output: null,
      muted: false,
      context: null,
      timer: null,
      speaking: false,
      offer: null,
      onDeviceChange: () => void listDevices(one, tell),
      over: () => {},
    }
    all.set(key, one)
    navigator.mediaDevices?.addEventListener?.("devicechange", one.onDeviceChange)
    // Defer getUserMedia by one microtask so initial `input`/`output`/`muted` props from the same render batch apply
    // before the microphone is opened.
    one.ready = Promise.resolve().then(() => {
      if (all.get(key) !== one || one.micStarted) return
      one.micStarted = true
      return openMic(one, tell)
    })
    return
  }
  const one = all.get(key)
  if (!one) return
  if (op === "set") {
    const { name, value } = params
    if (name === "ice" && value) connect(one, value, tell)
    else if (name === "answer" && value && one.peer?.signalingState === "have-local-offer")
      one.peer.setRemoteDescription({ type: "answer", sdp: value }).catch((/** @type {unknown} */ err) => {
        logVoice("set_remote_answer", one, err)
        one.over()
      })
    else if (name === "offer" && value) {
      // Answered once it has a connection, as an SFU's offer is, and not twice.
      if (one.offer === value) return
      one.offer = value
      if (one.peer) answered(one, value, tell)
    } else if (name === "muted") {
      one.muted = !!value
      if (one.track) one.track.enabled = !one.muted
    } else if (name === "input") {
      const next = typeof value === "string" && value ? value : null
      if (next === one.input) return
      one.input = next
      if (one.micStarted) one.ready = openMic(one, tell)
    } else if (name === "output") {
      const next = typeof value === "string" && value ? value : null
      if (next === one.output) return
      one.output = next
      for (const el of one.audios) applyOutput(one, el)
    }
    return
  }
  if (op === "drop") {
    one.over()
    navigator.mediaDevices?.removeEventListener?.("devicechange", one.onDeviceChange)
    stopMic(one)
    all.delete(key)
  }
}

/** Ends each voice a frame made, as its window closes: its page is gone, and its microphone with it. */
export function dropped(/** @type {string} */ key) {
  for (const one of [...all.keys()]) if (one.startsWith(`${key}|`)) voice("drop", one, {}, () => {})
}
