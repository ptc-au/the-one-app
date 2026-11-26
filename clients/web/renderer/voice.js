// A page's `voice` nodes on the web: each a call's audio, which the client's own page connects and plays
// (`../../web/voice.js`), not this frame, which a browser gives no origin to take a microphone from. What the page
// gives its voice, and what it hears from it, pass between the two as `one/voice`.

/**
 * The page's voices: `created`, `set` and `dropped` follow its mutations, and `heard` is what its client says of one.
 * @param {(message: object) => void} post its client's
 */
export function voices(post) {
  /** @type {Set<number>} */
  const all = new Set()
  const tell = (/** @type {object} */ event) => globalThis.ui?.event({ timeStamp: performance.now(), ...event })
  const ask = (/** @type {number} */ id, /** @type {string} */ op, /** @type {object} */ params = {}) =>
    post({ jsonrpc: "2.0", id: `voice:${id}:${op}:${crypto.randomUUID()}`, method: "one/voice", params: { op, id, ...params } })

  return {
    created: (/** @type {number} */ id) => {
      all.add(id)
      ask(id, "create")
    },
    /** @param {number} id @param {string} name @param {unknown} value */
    set(id, name, value) {
      if (!all.has(id)) return
      if (name === "ice" || name === "answer" || name === "offer" || name === "muted" || name === "volume" || name === "input" || name === "output") ask(id, "set", { name, value })
    },
    dropped(/** @type {number} */ id) {
      if (all.delete(id)) ask(id, "drop")
    },
    /** What its client says of a voice, which its page hears as the event it is. */
    heard(/** @type {{ id: number } & object} */ { id, ...event }) {
      if (all.has(id)) tell({ id, ...event })
    },
    /** Ends each voice this page made, as its frame unloads and its page is gone. */
    ended() {
      for (const id of [...all]) ask(id, "drop")
      all.clear()
    },
  }
}
