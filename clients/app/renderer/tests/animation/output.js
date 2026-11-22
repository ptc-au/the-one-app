// What a motion keeps: its curve, filmstrip and contact sheet, and how two of them differ.
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { PNG } from "pngjs"
import pixelmatch from "pixelmatch"
import { out } from "./options.js"
import { finger } from "./gesture.js"

/// How much of what changes with less motion one frame may change: a fade, eased out, does at most about 40% of its
/// way in its first frame at 60 Hz, and a cut, all of it in one, however alike what it cuts between are (two pale pages
/// differ by few levels in every pixel).
const CUT = 0.6

/// How much each of `frames` differs from the one before it (the sum of each pixel's difference, 0 for the first), and
/// how much the last differs from the first.
function changes(frames) {
  const pictures = frames.map((frame) => (frame.png ? PNG.sync.read(Buffer.from(frame.png, "base64")) : undefined))
  const differ = (a, b) => {
    if (!a || !b || a.width !== b.width || a.height !== b.height) return 0
    let sum = 0
    for (let at = 0; at < a.data.length; at++) if (at % 4 < 3) sum += Math.abs(a.data[at] - b.data[at])
    return sum
  }
  return { steps: pictures.map((now, n) => (n ? differ(pictures[n - 1], now) : 0)), whole: differ(pictures[0], pictures.at(-1)) }
}

/// The frame of `frames` that cuts: the one that changes more than `CUT` of all that changes from the first of them to
/// the last (the sum of each pixel's difference), if any does: its number, its time and its share.
export function cut(frames) {
  const { steps, whole } = changes(frames)
  if (!whole) return undefined
  const n = steps.findIndex((step) => step / whole > CUT)
  return n < 0 ? undefined : `${((steps[n] / whole) * 100).toFixed(0)}% of all that changes changes in frame ${n + 1} (${frames[n].at} ms), a cut where less motion fades`
}

/// A frame is quiet where it changes less than `QUIET` of what the busiest changes, and a pause is quiet for `LULL` ms
/// before something changes again: a cross-fade of everything at once has none (an eased fade's tail dies away, and
/// nothing follows it), where a title and captions that wait for the icons, or the icons for them, leave one.
const QUIET = 0.01
const LULL = 40

/// The first pause in `frames` between two parts that change, if there is one: its first frame and its length.
export function lull(frames) {
  const { steps } = changes(frames)
  const loud = steps.map((step) => step >= QUIET * Math.max(...steps))
  const first = loud.indexOf(true)
  for (let n = first + 1; n < frames.length; n++) {
    if (loud[n]) continue
    let end = n
    while (end < frames.length && !loud[end]) end++
    const ms = end < frames.length ? frames[end].at - frames[n - 1].at : 0
    if (ms > LULL) return `nothing changes for ${Math.round(ms)} ms from frame ${n + 1} (${frames[n].at} ms) while it fades, as if one part waited for another`
    n = end
  }
}

/// How many levels (of 255, in any channel) a pixel differs by from the window's ground to be drawn on it, and how much
/// less of the window than its emptier end a frame of a cross-fade may draw.
const INK = 12
const EMPTIER = 0.5

/// The first of `frames` that draws on less than half as much of the window as the emptier of the first and the last:
/// a cross-fade's frames are never emptier than its emptier end, where one that fades the first out before it fades the
/// last in shows an empty window between (a launcher's page let go with less motion, frame 63). The ground is what most
/// of the last frame is.
export function dips(frames) {
  const pictures = frames.map((frame) => PNG.sync.read(Buffer.from(frame.png, "base64")))
  const last = pictures.at(-1).data
  const counts = new Map()
  for (let at = 0; at < last.length; at += 4) {
    const colour = (last[at] << 16) | (last[at + 1] << 8) | last[at + 2]
    counts.set(colour, (counts.get(colour) ?? 0) + 1)
  }
  const ground = [...counts].reduce((most, one) => (one[1] > most[1] ? one : most))[0]
  const [r, g, b] = [ground >> 16, (ground >> 8) & 255, ground & 255]
  const ink = pictures.map(({ data }) => {
    let drawn = 0
    for (let at = 0; at < data.length; at += 4) if (Math.max(Math.abs(data[at] - r), Math.abs(data[at + 1] - g), Math.abs(data[at + 2] - b)) > INK) drawn++
    return drawn
  })
  const least = Math.min(ink[0], ink.at(-1)) * EMPTIER
  const n = ink.findIndex((drawn) => drawn < least)
  return n < 0 ? undefined : `frame ${n + 1} (${frames[n].at} ms) draws on ${ink[n]} pixels, under half its emptier end's ${Math.min(ink[0], ink.at(-1))}: it fades out to an empty window and back, where less motion cross-fades`
}

/// How many levels (of 255, in any channel) a pixel of the last frame may differ by from the full-motion run's, and how
/// much of the window may.
const ARRIVED = 24
const AWAY = 0.01

/// Whether the last of `frames`, played with less motion, is the last of `full`, the same gesture played with all its
/// motion: less motion changes how it gets there, never where. → what's different, if anything.
export function arrives(frames, full) {
  const [now, there] = [frames, full].map((played) => PNG.sync.read(Buffer.from(played.at(-1).png, "base64")))
  if (now.width !== there.width || now.height !== there.height) return "its last frame isn't the size of the full-motion run's"
  let changed = 0
  for (let at = 0; at < now.data.length; at += 4) if (Math.max(...[0, 1, 2].map((channel) => Math.abs(now.data[at + channel] - there.data[at + channel]))) > ARRIVED) changed++
  const share = changed / (now.width * now.height)
  return share > AWAY ? `it doesn't get where the same gesture does with full motion: ${(share * 100).toFixed(1)}% of its last frame differs from that run's` : undefined
}

/// The curve: what moved, and the finger, over time, each frame over its budget red.
export function curve(frames, way, values, stretches, budget, before, apple) {
  const [width, height, pad] = [640, 320, 40]
  const end = Math.max(...frames.map((frame) => frame.at), ...(before?.frames.map((frame) => frame.at) ?? []))
  const fingers = frames.map((frame) => finger(stretches, frame.at, way))
  const all = [...values, ...fingers, ...(before?.values ?? [])]
  const [low, high] = [Math.min(0, ...all), Math.max(1, ...all)]
  const x = (t) => pad + (t / end) * (width - 2 * pad)
  // Its legend above it.
  const y = (v) => height - pad - ((v - low) / (high - low)) * (height - 2 * pad - 20)
  const line = (points, colour, dash = "") => `<polyline fill="none" stroke="${colour}" stroke-width="2" ${dash && `stroke-dasharray="${dash}"`} points="${points.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`
  // A frame waits on its JS, its painting and its GPU before the refresh shows it (the headless renderer's `inspect::over`).
  const over = frames.filter((frame) => (frame.script_ms ?? 0) + frame.paint_ms + (frame.gpu_ms ?? 0) > budget)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui" font-size="11">
<rect width="100%" height="100%" fill="white"/>
<line x1="${pad}" y1="${y(0)}" x2="${width - pad}" y2="${y(0)}" stroke="#ddd"/>
${line(frames.map((frame, at) => [frame.at, fingers[at]]), "#999", "4 4")}
${before ? line(before.frames.map((frame, at) => [frame.at, before.values[at]]), "#e8a23a") : ""}
${apple ? line(frames.flatMap((frame, at) => (apple[at] === undefined ? [] : [[frame.at, apple[at]]])), "#3a9a4a", "2 3") : ""}
${line(frames.map((frame, at) => [frame.at, values[at]]), "#2f6fde")}
${over.map((frame) => `<circle cx="${x(frame.at).toFixed(1)}" cy="${y(values[frames.indexOf(frame)]).toFixed(1)}" r="3" fill="#d33"/>`).join("")}
<text x="${pad}" y="16">${way}, in points, over ${Math.round(end)} ms</text>
<text x="${width - pad}" y="16" text-anchor="end" fill="#2f6fde">drawn</text><text x="${width - pad}" y="30" text-anchor="end" fill="#999">finger</text>${before ? `<text x="${width - pad}" y="44" text-anchor="end" fill="#e8a23a">before</text>` : ""}${apple ? `<text x="${width - pad}" y="${before ? 58 : 44}" text-anchor="end" fill="#3a9a4a">iOS</text>` : ""}${over.length ? `<text x="${pad}" y="30" fill="#d33">${over.length} frames over ${budget.toFixed(1)} ms</text>` : ""}
<text x="${pad}" y="${height - 12}">0</text><text x="${width - pad}" y="${height - 12}" text-anchor="end">${Math.round(end)} ms</text>
<text x="4" y="${y(high) + 4}">${Math.round(high)}</text><text x="4" y="${y(low) + 4}">${Math.round(low)}</text>
</svg>`
}

/// Eight frames, evenly over its time, side by side at half their size, cut to the band of rows anything moved in.
export function filmstrip(frames, file) {
  const picked = Array.from({ length: 8 }, (_, at) => frames[Math.round((at / 7) * (frames.length - 1))])
  const pictures = picked.map((frame) => PNG.sync.read(Buffer.from(frame.png, "base64")))
  const { width, height } = pictures[0]
  const moved = (y) => pictures.some((picture) => picture.data.compare(pictures[0].data, y * width * 4, (y + 1) * width * 4, y * width * 4, (y + 1) * width * 4) !== 0)
  const rows = Array.from({ length: height }, (_, y) => y).filter(moved)
  const [top, bottom] = rows.length ? [Math.max(0, rows[0] - 24), Math.min(height, rows.at(-1) + 25)] : [0, height]
  const [w, h] = [Math.floor(width / 2), Math.floor((bottom - top) / 2)]
  const strip = new PNG({ width: w * pictures.length, height: h })
  pictures.forEach((picture, n) => {
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++)
        for (let c = 0; c < 4; c++) {
          const at = (sx, sy) => picture.data[((top + sy) * width + sx) * 4 + c]
          const sum = at(2 * px, 2 * py) + at(2 * px + 1, 2 * py) + at(2 * px, 2 * py + 1) + at(2 * px + 1, 2 * py + 1)
          strip.data[(py * strip.width + n * w + px) * 4 + c] = sum >> 2
        }
  })
  writeFileSync(file, PNG.sync.write(strip))
}

/// How far apart two curves come, at most, the earlier's read at each of the later's times.
export function apart(frames, values, before) {
  const at = (t) => {
    const next = before.frames.findIndex((frame) => frame.at >= t)
    if (next <= 0) return before.values[next === 0 ? 0 : before.values.length - 1]
    const [a, b] = [before.frames[next - 1], before.frames[next]]
    return before.values[next - 1] + ((t - a.at) / (b.at - a.at)) * (before.values[next] - before.values[next - 1])
  }
  return Math.max(...frames.map((frame, n) => Math.abs(values[n] - at(frame.at))))
}


/// A rect as it's said: where, and how big.
export const rect = ({ x, y, width, height }) => `${Math.round(x)}, ${Math.round(y)} ${Math.round(width)} × ${Math.round(height)}`

/// Where a text's glyphs are drawn against where its `box` says: the pixels of a picture (`png`, of a window `points` wide) in
/// `box` (a point out) that aren't the colour just outside its top left, as the box they fill. → why they're not where
/// `box` is, or nothing where they are: none, or a box that's much smaller than it or off its middle.
export function strayInk(png, points, box) {
  const { data, width, height } = PNG.sync.read(Buffer.from(png, "base64"))
  const scale = width / points
  const [left, right, top, bottom] = [box.x - 1, box.x + box.width + 1, box.y - 1, box.y + box.height + 1].map((point) => Math.round(point * scale))
  const page = (Math.max(top, 0) * width + Math.max(left, 0)) * 4
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
  for (let y = Math.max(top, 0); y < Math.min(bottom, height); y++)
    for (let x = Math.max(left, 0); x < Math.min(right, width); x++) {
      const at = (y * width + x) * 4
      if (Math.abs(data[at] - data[page]) + Math.abs(data[at + 1] - data[page + 1]) + Math.abs(data[at + 2] - data[page + 2]) > 120) [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)]
    }
  if (x1 < x0) return `no glyphs are drawn in ${rect(box)}`
  const ink = { x: x0 / scale, y: y0 / scale, width: (x1 - x0 + 1) / scale, height: (y1 - y0 + 1) / scale }
  const [along, across] = box.width >= box.height ? [ink.width / box.width, ink.height / box.height] : [ink.height / box.height, ink.width / box.width]
  const off = Math.max(Math.abs(ink.x + ink.width / 2 - box.x - box.width / 2) - box.width * 0.15, Math.abs(ink.y + ink.height / 2 - box.y - box.height / 2) - box.height * 0.15)
  return along < 0.6 || across < 0.35 || off > 1 ? `it's drawn at ${rect(box)} but its glyphs fill ${rect(ink)}` : undefined
}

/// How well a text's words in `box` of a picture (`png`, of a window `points` wide) stand off what's behind them: WCAG's
/// contrast ratio between the colour most of its box is (what's behind it) and the pixel furthest from it in light (its
/// ink), as a person reads the darkest stroke of a glyph against its ground. → the ratio, or nothing where its box is
/// all one colour (nothing drawn there to judge).
export function legibility(png, points, box) {
  const { data, width, height } = typeof png === "string" ? PNG.sync.read(Buffer.from(png, "base64")) : png
  const scale = width / points
  const [x0, x1, y0, y1] = [Math.max(Math.round(box.x * scale), 0), Math.min(Math.round((box.x + box.width) * scale), width), Math.max(Math.round(box.y * scale), 0), Math.min(Math.round((box.y + box.height) * scale), height)]
  const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = (at) => 0.2126 * linear(data[at]) + 0.7152 * linear(data[at + 1]) + 0.0722 * linear(data[at + 2])
  const counts = new Map()
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const at = (y * width + x) * 4
      const key = (data[at] << 16) | (data[at + 1] << 8) | data[at + 2]
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  if (counts.size < 2) return
  const ground = [...counts].reduce((most, one) => (one[1] > most[1] ? one : most))[0]
  const light = 0.2126 * linear(ground >> 16) + 0.7152 * linear((ground >> 8) & 255) + 0.0722 * linear(ground & 255)
  let most = 1
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const other = luminance((y * width + x) * 4)
      most = Math.max(most, (Math.max(other, light) + 0.05) / (Math.min(other, light) + 0.05))
    }
  return most
}

/// Where what a press reaches isn't what's drawn there, in a picture (`png`) of a window `points` wide and what the
/// inspector says a press at each point of a grid over it reaches (`reaches`): wherever a pressable is drawn solid (the
/// same colour a few pixels each way), a press there reaches it, and wherever a press reaches it, it's drawn. A
/// pressable's colour is the one most of the points that reach it show, so each pressable is drawn in a colour of its
/// own, square, and nothing in another colour is drawn over it that a press passes through. → why, or nothing.
export function wrongHits(png, points, { step, reached, names }) {
  const { data, width, height } = PNG.sync.read(Buffer.from(png, "base64"))
  const scale = width / points
  const near = Math.ceil(2 * scale)
  const colour = (x, y) => [0, 1, 2].map((channel) => data[(y * width + x) * 4 + channel])
  const same = (a, b) => a.every((channel, at) => Math.abs(channel - b[at]) <= 3)
  const around = [-near, 0, near].flatMap((dx) => [-near, 0, near].map((dy) => [dx, dy]))
  const solid = (x, y) => around.every(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < width && y + dy < height && same(colour(x + dx, y + dy), colour(x, y))) && colour(x, y)
  const probes = reached.flatMap((row, y) => row.map((node, x) => ({ at: [(x + 0.5) * step, (y + 0.5) * step], node })))
  for (const probe of probes) probe.colour = solid(Math.floor(probe.at[0] * scale), Math.floor(probe.at[1] * scale))
  const counts = new Map()
  for (const { node, colour } of probes.filter((probe) => probe.node !== null && probe.colour)) {
    const of = counts.get(node) ?? new Map()
    of.set(colour.join(), (of.get(colour.join()) ?? 0) + 1)
    counts.set(node, of)
  }
  const colours = new Map([...counts].map(([node, of]) => [node, [...of].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number)]))
  const name = (node) => (node === null ? "nothing" : names[node] ? `"${names[node]}"` : `node ${node}`)
  for (const { at, node, colour } of probes.filter((probe) => probe.colour)) {
    if (node !== null && !same(colour, colours.get(node))) return `a press at ${at} reaches ${name(node)}, drawn rgb(${colours.get(node)}), where rgb(${colour}) is drawn`
    const drawn = [...colours].filter(([, of]) => same(of, colour)).map(([node]) => node)
    if (drawn.length === 1 && drawn[0] !== node) return `${name(drawn[0])} is drawn at ${at}, where a press reaches ${name(node)}`
  }
}

/// How sharp a text's glyphs are drawn in `box` of a picture (`png`, of a window `points` wide): the steepest tenth of the
/// steps in light between pixels beside each other across its edges, against all the light there is between its ink and
/// what's behind it. A glyph drawn where it is has its edges a pixel or two across, about 0.9; a picture of it grown or
/// moved by a fraction of a pixel spreads them, about 0.5 to 0.6 at 1.6 times.
export function sharpness(png, points, box) {
  const { data, width, height } = PNG.sync.read(Buffer.from(png, "base64"))
  const scale = width / points
  const [left, right, top, bottom] = [box.x, box.x + box.width, box.y, box.y + box.height].map((point) => Math.round(point * scale))
  const [x0, x1, y0, y1] = [Math.max(left, 0), Math.min(right, width), Math.max(top, 0), Math.min(bottom, height)]
  const light = (x, y) => {
    const at = (y * width + x) * 4
    return 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]
  }
  let [least, most] = [Infinity, -Infinity]
  const steps = []
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const here = light(x, y)
      ;[least, most] = [Math.min(least, here), Math.max(most, here)]
      if (x + 1 < x1) steps.push(Math.abs(light(x + 1, y) - here))
      if (y + 1 < y1) steps.push(Math.abs(light(x, y + 1) - here))
    }
  const contrast = most - least
  const edges = steps.filter((step) => step > contrast * 0.1).sort((a, b) => b - a)
  if (contrast < 16 || !edges.length) return undefined
  const steepest = edges.slice(0, Math.max(1, Math.floor(edges.length / 10)))
  return steepest.reduce((sum, step) => sum + step, 0) / steepest.length / contrast
}

/// The pictures a pass read last, by their files, each kept while its file is as it was.
const read = new Map()
/// A PNG file's picture, read once for everything a pass judges of it (its rules, whether it's blank, what changed).
export function decoded(file) {
  const { mtimeMs, size } = statSync(file)
  const kept = read.get(file)
  if (kept?.mtimeMs === mtimeMs && kept.size === size) return kept.png
  const png = PNG.sync.read(readFileSync(file))
  read.delete(file)
  read.set(file, { mtimeMs, size, png })
  if (read.size > 16) read.delete(read.keys().next().value)
  return png
}

/// How much of two pictures differs, from 0 to 1, where they're the same size, with where in `diff`, which is drawn only
/// where some does.
export function differs(one, other, diff) {
  rmSync(diff, { force: true })
  // The same bytes are the same picture: almost every one, where a change changed little.
  if (readFileSync(one).equals(readFileSync(other))) return 0
  const [a, b] = [one, other].map(decoded)
  if (a.width !== b.width || a.height !== b.height) return undefined
  const marked = new PNG({ width: a.width, height: a.height })
  const changed = pixelmatch(a.data, b.data, marked.data, a.width, a.height, { threshold: 0.1 })
  if (changed) writeFileSync(diff, PNG.sync.write(marked))
  return changed / (a.width * a.height)
}

/// The contact sheet: every motion's filmstrip and curve, before beside after where there's a before.
export function contactSheet(rows) {
  const cell = (folder) => `<figure><img src="${folder}/filmstrip.png"><img src="${folder}/curve.svg"></figure>`
  const body = rows
    .map((row) => `<section><h2>${row.scene} · ${row.motion} · ${row.hz} Hz</h2>${row.before ? `<div class="pair"><div><h3>Before</h3>${cell(relative(out, row.before))}</div><div><h3>After</h3>${cell(row.folder)}</div></div>` : cell(row.folder)}</section>`)
    .join("\n")
  writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Motion</title>
<style>body{font-family:system-ui;margin:16px;background:#f6f6f7}h2{font-size:15px;margin:24px 0 8px}h3{font-size:12px;margin:0 0 4px;color:#666}figure{margin:0;display:flex;flex-direction:column;gap:8px}img{max-width:100%;background:white;border-radius:6px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}</style>
<h1>Motion</h1>${body}`)
}
