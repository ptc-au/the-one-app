// What every scene must meet, whatever its page, light and dark, a phone's and a computer's, judged from what the native
// headless renderer drew: the inspector's every node (`query`, with `frames`) and the picture. Each kind of bug the frames showed
// more than once has a rule here, where a check of one scene (`judges.js`'s `contrast`, `whole`, `aligned`, `rounded`)
// had found it in that scene alone. screenshot.js runs them on every scene; a rule that fails says which node and why, a
// line each. An exception is a node a rule can't judge, named in the rule with why.
import { readFileSync } from "node:fs"
import { decoded } from "./animation/output.js"

/// WCAG's relative luminance of an sRGB colour, and its contrast ratio of two.
const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
/// `linear` of each channel's 256 levels, worked out once: a picture's every pixel is read by it.
const LINEAR = Float64Array.from({ length: 256 }, (_, c) => linear(c))
const luminance = ([r, g, b]) => 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b]
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/// WCAG AA: text 4.5:1, large text (24 px, or 18.66 px bold) 3:1, and a control's mark (an icon, a ring) 3:1.
const TEXT = 4.5
const LARGE_TEXT = 3
const MARK = 3
/// A line this tall or taller is large text: a title's (28 px at 1.2) or a figure's; a headline's 17 px isn't, even bold.
const LARGE_LINE = 33

/// The radius tokens' lengths in px, from the CSS the build makes of them.
const radii = Object.fromEntries([...readFileSync(new URL("../../../../core/ui/src/tokens.css", import.meta.url), "utf8").matchAll(/--(radius-[\w-]+):\s*([\d.]+)px/g)].map(([, id, px]) => [id, Number(px)]))
const length = (value) => (typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : value?.token ? radii[value.token] : undefined)

/// A picture of the window, read once: its colour at a device pixel, and how many of them a point is.
function picture(file, points) {
  const { data, width, height } = decoded(file)
  const scale = width / points
  // Where in `data` a device pixel's colour starts, the nearest in the picture to one outside it.
  const index = (x, y) => (Math.min(height - 1, Math.max(0, Math.round(y))) * width + Math.min(width - 1, Math.max(0, Math.round(x)))) * 4
  const at = (x, y) => {
    const i = index(x, y)
    return [data[i], data[i + 1], data[i + 2]]
  }
  // The colour most of a box is (in points), to within 8 levels a channel, as the ground a text or a mark is drawn on.
  // Each bin is its colour's levels, 8 to a step, 5 bits a channel; of two as full, the one found first.
  const ground = ({ x, y, width: w, height: h }) => {
    const bins = new Map()
    for (let row = Math.ceil(y * scale); row < Math.floor((y + h) * scale); row++)
      for (let column = Math.ceil(x * scale); column < Math.floor((x + w) * scale); column++) {
        const i = index(column, row)
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
        const bin = bins.get(key)
        if (!bin) {
          bins.set(key, { n: 1, r, g, b })
          continue
        }
        bin.n++
        bin.r += r
        bin.g += g
        bin.b += b
      }
    const most = [...bins.values()].reduce((best, bin) => (!best || bin.n > best.n ? bin : best), undefined)
    return most && [most.r, most.g, most.b].map((c) => Math.round(c / most.n))
  }
  // The most any pixel of a box stands off a colour, as WCAG's ratio, and the pixel's colour.
  const furthest = ({ x, y, width: w, height: h }, from) => {
    const against = luminance(from)
    let most = 1
    let at = -1
    for (let row = Math.ceil(y * scale); row < Math.floor((y + h) * scale); row++)
      for (let column = Math.ceil(x * scale); column < Math.floor((x + w) * scale); column++) {
        const i = index(column, row)
        const by = ratio(0.2126 * LINEAR[data[i]] + 0.7152 * LINEAR[data[i + 1]] + 0.0722 * LINEAR[data[i + 2]], against)
        if (by > most) [most, at] = [by, i]
      }
    return { most, colour: at < 0 ? from : [data[at], data[at + 1], data[at + 2]] }
  }
  return { scale, width, height, at, ground, furthest }
}

const rgb = (colour) => `rgb(${colour.join(", ")})`
const box = ({ x, y, width, height }) => `${Math.round(x)},${Math.round(y)} ${Math.round(width)}×${Math.round(height)}`
const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
/// What of `a` is in `b`, if any of it is.
const within = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : undefined
}
const inside = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5

/// Each page's nodes by themselves (a frame's page has ids of its own, `in` says which frames it's in), with each node's
/// parent, and what's above it.
function pages(nodes) {
  return [...Map.groupBy(nodes, (node) => JSON.stringify(node.in ?? [])).values()].map((here) => {
    const byId = new Map(here.map((node) => [node.node, node]))
    const parent = new Map(here.flatMap((node) => (node.children ?? []).map((child) => [child, node])))
    const above = (node) => {
      const all = []
      for (let up = parent.get(node.node); up; up = parent.get(up.node)) all.push(up)
      return all
    }
    const below = (node) => (node.children ?? []).flatMap((child) => (byId.has(child) ? [byId.get(child), ...below(byId.get(child))] : []))
    // What scrolls past what's over it: in a scroll view that's scrolled, or that has more to scroll to, which takes
    // what's in it under a bar or a footer, as UIKit's content goes under its bars.
    const scrolled = (node) =>
      above(node).some((up) => up.kind === "scroll" && up.rect && (up.children ?? []).some((child) => byId.get(child)?.rect && (byId.get(child).rect.y < up.rect.y - 0.5 || byId.get(child).rect.x < up.rect.x - 0.5 || byId.get(child).rect.y + byId.get(child).rect.height > up.rect.y + up.rect.height + 0.5)))
    // What's drawn over it, which the tree's order is: a sheet, a menu, an open folder, a dialog, filled or glass, after it
    // in the tree and over some of its box, as what's under a layer is veiled or hidden, not read.
    const order = new Map(here.map((node, at) => [node.node, at]))
    const layers = here.filter((node) => node.rect && node.opacity > 0 && node.resolved && ((node.resolved.backgroundColor && node.resolved.backgroundColor.token !== "transparent") || node.resolved.backdropFilter))
    const covered = (node) => node.rect && layers.some((layer) => order.get(layer.node) > order.get(node.node) && !above(node).includes(layer) && !above(layer).includes(node) && overlap(layer.rect, node.rect))
    // What's drawn after it, not in it nor holding it, with a shadow reaching over `rect`: a floating panel's shadow lies
    // over what's beside it, as a corner past its rounding may show.
    const shadowed = (node, rect) => here.some((one) => one.rect && one.opacity > 0 && one.resolved?.boxShadow && order.get(one.node) > order.get(node.node) && !above(node).includes(one) && !above(one).includes(node) && overlap({ x: one.rect.x - SHADOW, y: one.rect.y - SHADOW, width: one.rect.width + 2 * SHADOW, height: one.rect.height + 2 * SHADOW }, rect))
    return { here, byId, parent, above, below, scrolled, covered, shadowed }
  })
}

/// What a person sees whole: drawn opaque, all of its box in the window, and nothing above it disabled (WCAG asks no
/// contrast of what's disabled).
const seen = (node) => node.rect && node.rect.width > 0 && node.rect.height > 0 && node.opacity >= 0.99 && node.seen >= 0.99
const disabled = (node, above) => [node, ...above].some((one) => one.states?.disabled === true || one.states?.disabled === "true")
const said = (node) => JSON.stringify(node.name ?? node.role ?? node.kind)

/// Every text a person reads stands off what's drawn behind it by WCAG AA's 4.5:1, 3:1 if it's large: its ink, the
/// pixel of its glyphs' boxes furthest from their ground, the colour most of them is, so what's measured is what's
/// drawn, over whatever card, tint, picture or glass it's on. → what's wrong, a line each.
export function contrast(nodes, file, [width]) {
  const shot = picture(file, width)
  return pages(nodes).flatMap(({ here, byId, above, covered }) =>
    here.flatMap((node) => {
      if (node.kind !== "text" || !node.name?.trim() || !seen(node) || disabled(node, above(node)) || covered(node)) return []
      // Its glyphs' boxes: its pieces of text's, which are as wide as their words, else its own.
      const pieces = (node.children ?? []).map((child) => byId.get(child)).filter((child) => child?.kind === "raw-text" && child.rect?.width > 0)
      const boxes = pieces.length ? pieces.map((piece) => piece.rect) : [node.rect]
      const lines = node.lines?.length || 1
      const least = node.rect.height / lines >= LARGE_LINE ? LARGE_TEXT : TEXT
      const worst = boxes.map((rect) => {
        const ground = shot.ground(rect)
        return ground && { ground, ...shot.furthest(rect, ground) }
      })
      // A piece that's only a space has no ink: a text's spans of another style are texts of their own, judged as they are.
      .filter((one) => one && one.most > 1.01).reduce((low, one) => (!low || one.most < low.most ? one : low), undefined)
      return worst && worst.most < least ? [`${said(node)} stands off what's behind it at ${worst.most.toFixed(2)}:1, under ${least}:1: ${rgb(worst.colour)} on ${rgb(worst.ground)}`] : []
    }),
  )
}

/// Every control a person presses with no words of its own (an icon, a ring, dots) has a mark that stands off what's
/// around it by WCAG's 3:1 for what isn't text: the pixel of its box furthest from the colour most of it is, or that
/// colour's from what's just outside it, as a filled button's is. → what's wrong, a line each.
export function marks(nodes, file, [width]) {
  const shot = picture(file, width)
  return pages(nodes).flatMap(({ here, above, below, covered }) =>
    here.flatMap((node) => {
      if (!node.actions?.includes("click") || !seen(node) || disabled(node, above(node)) || covered(node)) return []
      // One with words is read by them, which `contrast` judges; a control inside another's box is judged as it.
      if (node.name === undefined || below(node).some((one) => one.kind === "text" && one.name?.trim() && one.opacity > 0)) return []
      const ground = shot.ground(node.rect)
      if (!ground) return []
      const { most } = shot.furthest(node.rect, ground)
      const around = shot.at((node.rect.x - 3) * shot.scale, (node.rect.y + node.rect.height / 2) * shot.scale)
      const filled = ratio(luminance(ground), luminance(around))
      const best = Math.max(most, filled)
      return best < MARK ? [`${said(node)} (${box(node.rect)}) has no mark standing off what's around it at ${MARK}:1: ${best.toFixed(2)}:1 at most`] : []
    }),
  )
}

/// No two words in sight are drawn over each other, at rest or in any frame of a motion (animation/play.js), as a large
/// title over a bar's (L24) or a folder's names twice over (L37) were: what scrolls under a bar while it's scrolled is
/// meant to, and a cross-fade's two are each less than opaque. → what's wrong, a line each.
export function wordsApart(nodes) {
  return pages(nodes).flatMap(({ here, byId, above, scrolled, covered }) => {
    const related = (a, b) => above(a).includes(b) || above(b).includes(a)
    const texts = here.filter((node) => node.kind === "text" && node.name?.trim() && node.opacity >= 0.99 && node.seen > 0 && node.rect && !covered(node))
    // A text's ink is its pieces' boxes, which a text box wider than its words isn't, cut to what shows of each scroll
    // it's in: a row scrolled half out of a card's list, under the card's title, is drawn only in the list.
    const inked = (node) => {
      const pieces = (node.children ?? []).map((child) => byId.get(child)).filter((child) => child?.kind === "raw-text" && child.rect?.width > 0)
      const scrolls = above(node).filter((up) => up.kind === "scroll" && up.rect)
      return (pieces.length ? pieces.map((piece) => piece.rect) : [node.rect]).map((rect) => scrolls.reduce((shown, up) => shown && within(shown, up.rect), rect)).filter(Boolean)
    }
    const wrong = []
    for (const [n, a] of texts.entries())
      for (const b of texts.slice(n + 1))
        if (!related(a, b) && !(scrolled(a) !== scrolled(b)) && inked(a).some((one) => inked(b).some((other) => overlap(one, other)))) wrong.push(`${said(a)} (${box(a.rect)}) and ${said(b)} (${box(b.rect)}) are drawn over each other`)
    return wrong
  })
}

/// No control is drawn over part of another, as a chevron over a tile's edge is, at rest. (In motion, what flies over
/// what is a motion's own `apart`.) → what's wrong, a line each.
export function controlsApart(nodes) {
  return pages(nodes).flatMap(({ here, above, scrolled, covered }) => {
    const related = (a, b) => above(a).includes(b) || above(b).includes(a)
    const controls = here.filter((node) => node.actions?.includes("click") && node.opacity >= 0.99 && node.seen >= 0.99 && node.rect && !covered(node))
    const wrong = []
    for (const [n, a] of controls.entries())
      for (const b of controls.slice(n + 1))
        if (!related(a, b) && !scrolled(a) && !scrolled(b) && overlap(a.rect, b.rect) && !inside(a.rect, b.rect) && !inside(b.rect, a.rect)) wrong.push(`${said(a)} (${box(a.rect)}) is drawn over part of ${said(b)} (${box(b.rect)})`)
    return wrong
  })
}

/// The controls at the ends of a list's rows form a column, as iOS's and Raycast's do: each row's last control, where
/// it ends the row, ends as far from the row's end as every other's. → what's wrong, a line each.
export function rowEnds(nodes) {
  return pages(nodes).flatMap(({ here, byId, below }) =>
    here
      .filter((node) => node.kind === "list" && node.rect)
      .flatMap((list) => {
        const ends = (list.children ?? [])
          .map((child) => byId.get(child))
          .filter((row) => row?.rect && row.opacity >= 0.99 && row.seen >= 0.99)
          .flatMap((row) => {
            const last = below(row).filter((one) => one.actions?.includes("click") && one.rect && one.opacity >= 0.99).reduce((end, one) => (!end || one.rect.x + one.rect.width > end.rect.x + end.rect.width ? one : end), undefined)
            const from = last && row.rect.x + row.rect.width - (last.rect.x + last.rect.width)
            return last && from <= row.rect.width / 4 ? [{ row, last, from }] : []
          })
        const [least, most] = [Math.min(...ends.map((end) => end.from)), Math.max(...ends.map((end) => end.from))]
        return ends.length > 1 && most - least > 1 ? [`the controls ending ${list.name ? said(list) : "a list"}'s rows end ${ends.map((end) => `${Math.round(end.from)}`).join(", ")} pt from their rows' ends: ${ends.map((end) => said(end.last)).join(", ")}`] : []
      }),
  )
}

/// What stops at a readable width (a column, a form, a page's content, `maxWidth` a token) sits in the middle of what
/// it's in, as macOS's System Settings' column does, where it's narrower: never hugging its start with the room at its
/// end, as forms on a computer did (L12, L40, L80). → what's wrong, a line each.
export function centred(nodes) {
  return pages(nodes).flatMap(({ here, parent, covered }) =>
    here.flatMap((node) => {
      // A sidebar and a split's list column are at the start of their window by design.
      if (!node.resolved?.maxWidth?.token || ["sidebar", "column", "column-min"].includes(node.resolved.maxWidth.token) || !seen(node) || covered(node)) return []
      const within = parent.get(node.node)
      if (!within?.rect || within.rect.width - node.rect.width < 2) return []
      const off = node.rect.x + node.rect.width / 2 - (within.rect.x + within.rect.width / 2)
      return Math.abs(off) > 1 ? [`${said(node)} (${box(node.rect)}), as wide as its ${node.resolved.maxWidth.token} at most, is ${Math.round(off)} pt off the middle of what it's in (${box(within.rect)})`] : []
    }),
  )
}

/// What's never broken across lines, as a person reads it whole: a date, a time and a number and its unit; and a code
/// of groups of digits is broken evenly, two groups and two, never three and a lone fourth (L85). → what's wrong, a
/// line each.
const WHOLE = [/[A-Z][a-z]{2}[ \u00a0]\d{1,2},[ \u00a0]\d{4}/g, /\d{1,2}:\d{2}(?:[ \u00a0\u202f][AP]M)?/g, /\d[\d.,]*[ \u00a0\u202f](?:B|KB|MB|GB|TB|ms|min|pt|px)\b/g]
const CODE = /^\d{4,}(?:[ \u00a0]\d{4,})+$/
export function unbroken(nodes) {
  return nodes.flatMap((node) => {
    if (!node.lines || node.lines.length < 2 || !(node.opacity > 0)) return []
    const text = node.lines.join(" ")
    const groups = node.lines.map((line) => line.trim().split(/[ \u00a0]+/).length)
    if (CODE.test(text)) return Math.max(...groups) - Math.min(...groups) > 1 ? [`the code ${JSON.stringify(text)} is broken unevenly: ${node.lines.map((line) => JSON.stringify(line)).join(", ")}`] : []
    const joins = []
    let at = -1
    for (const line of node.lines.slice(0, -1)) joins.push((at += line.length + 1))
    return WHOLE.flatMap((pattern) => [...text.matchAll(pattern)].filter((found) => joins.some((join) => join >= found.index && join < found.index + found[0].length)).map((found) => `${JSON.stringify(found[0])} is broken across lines: ${node.lines.map((line) => JSON.stringify(line)).join(", ")}`))
  })
}

/// How much room a text cut short with "…" may have beside it, in points, as the padding of what it's in.
const ROOM = 24
/// No text is cut short with room beside it to show it whole: from its end to the next thing drawn on its line, or to
/// the end of what it's in. → what's wrong, a line each.
export function roomy(nodes) {
  return pages(nodes).flatMap(({ here, above, below }) =>
    here.flatMap((node) => {
      if (node.kind !== "text" || !node.cut || !seen(node)) return []
      const end = node.rect.x + node.rect.width
      const within = above(node).find((up) => up.rect && up.rect.width > node.rect.width + ROOM)
      if (!within) return []
      const mine = new Set([node, ...below(node), ...above(node)])
      const onItsLine = (one) => one.rect && one.rect.width > 0 && one.rect.x >= end - 1 && one.rect.y < node.rect.y + node.rect.height && one.rect.y + one.rect.height > node.rect.y
      const beside = below(within).filter((one) => !mine.has(one) && onItsLine(one) && (one.actions || ["text", "raw-text", "image", "path", "picture", "input"].includes(one.kind)))
      const next = Math.min(within.rect.x + within.rect.width, ...beside.map((one) => one.rect.x))
      return next - end > ROOM ? [`${said(node)} is cut short with ${Math.round(next - end)} pt of room beside it`] : []
    }),
  )
}

/// How far a shadow reaches past its box, at most, in points: the window's and a lifted card's, 48 pt of blur.
const SHADOW = 48

/// What's rounded and clips what's in it shows nothing past its rounding, as CSS clips it: each corner, more than a
/// pixel and a half outside its arc, is the colour just outside its box (within 24 levels a channel); and what blurs
/// what's behind it (glass) is the same material to its corners as along its edges, within 16 levels, as a blur clamped
/// to its box is. Only where the window has room around it to compare with, and not where what's drawn after it casts
/// its shadow over the corner (`shadowed`). → what's wrong, a line each.
const CORNERS = [["borderTopStartRadius", 1, 1], ["borderTopEndRadius", -1, 1], ["borderBottomEndRadius", -1, -1], ["borderBottomStartRadius", 1, -1]]
export function corners(nodes, file, [width, height]) {
  const shot = picture(file, width)
  const wrong = []
  for (const { here, covered, shadowed } of pages(nodes)) for (const node of here) {
    if (!seen(node) || !node.resolved || covered(node)) continue
    // What casts a shadow draws it past its rounding, as it should.
    const clips = node.resolved.overflow === "hidden" && !node.resolved.boxShadow
    const glass = node.resolved.backdropFilter !== undefined
    if (!clips && !glass) continue
    const { x, y, width: w, height: h } = node.rect
    if (x < 3 || y < 3 || x + w > width - 3 || y + h > height - 3) continue
    for (const [property, sx, sy] of CORNERS) {
      const r = Math.min(length(node.resolved[property]) ?? 0, w / 2, h / 2)
      if (r < 4) continue
      const [cx, cy] = [sx > 0 ? x : x + w, sy > 0 ? y : y + h]
      if (clips && !shadowed(node, { x: sx > 0 ? cx : cx - r, y: sy > 0 ? cy : cy - r, width: r, height: r })) {
        // What's around the corner: outside it, and outside each edge beside it, any of which past the arc may show
        // where the box sits on a line or beside another (a chart's bar on its axis).
        const outsides = [[cx - sx * 2, cy - sy * 2], [cx - sx * 2, cy + sy * r], [cx + sx * r, cy - sy * 2]].map(([px, py]) => shot.at(px * shot.scale, py * shot.scale))
        const across = Math.ceil(r * shot.scale)
        const [ox, oy] = [cx + sx * r, cy + sy * r]
        let found
        for (let i = 0; i < across && !found; i++)
          for (let j = 0; j < across && !found; j++) {
            const [column, row] = [sx > 0 ? Math.round(cx * shot.scale) + i : Math.round(cx * shot.scale) - 1 - i, sy > 0 ? Math.round(cy * shot.scale) + j : Math.round(cy * shot.scale) - 1 - j]
            // On the arc, or its border's width and a pixel's smoothing past it.
            if ((Math.hypot((column + 0.5) / shot.scale - ox, (row + 0.5) / shot.scale - oy) - r) * shot.scale <= 2.5) continue
            const there = shot.at(column, row)
            if (outsides.every((outside) => there.some((c, k) => Math.abs(c - outside[k]) > 24))) found = `${said(node)} (${box(node.rect)}) shows ${rgb(there)} past its ${r} pt rounding where what's around it is ${rgb(outsides[0])}`
          }
        if (found) wrong.push(found)
      }
      if (glass && r >= 8) {
        const toward = (r - 3) / Math.SQRT2
        const corner = shot.at((cx + sx * (r - toward)) * shot.scale, (cy + sy * (r - toward)) * shot.scale)
        // Along each edge past its rounding, where the box is that long.
        const along = [...(r + 12 < w - r ? [[cx + sx * (r + 12), cy + sy * 3]] : []), ...(r + 12 < h - r ? [[cx + sx * 3, cy + sy * (r + 12)]] : [])]
        for (const beside of along.map(([px, py]) => shot.at(px * shot.scale, py * shot.scale))) {
          const off = Math.max(...corner.map((c, k) => Math.abs(c - beside[k])))
          if (off > 16) {
            wrong.push(`${said(node)}'s glass (${box(node.rect)}) is ${rgb(corner)} in its corner where its edge is ${rgb(beside)}, ${off} levels apart`)
            break
          }
        }
      }
    }
  }
  return wrong
}

/// Scenes a rule doesn't hold for, by `<folder> · <scene>` or a whole folder, each with why.
const EXCEPT = {
  "gallery · Styling/Painting order": { apart: "its boxes overlap to show which of them paints over which" },
  "gallery · Styling/Hit areas": { apart: "its squares overlap to show a press reaches the one drawn on top", marks: "each square is a plain fill, told apart by its colour alone, which a press is judged by" },
  "gallery · Careless/On a phone": { corners: "its glass bar is over pictures that scroll under it, so what's behind its corner isn't what's behind its edge" },
  "gallery · Careless/On a computer": { corners: "its glass bar is over pictures that scroll under it, so what's behind its corner isn't what's behind its edge" },
  // Its scenes draw a component alone in the window, not in a screen's column, which an app's are.
  gallery: { centred: "a component drawn alone sits where the gallery puts it, at the window's start" },
}

/// Every rule, by its name, as screenshot.js says what fails: each a line. The nodes are kept beside the picture
/// (`native-nodes.json`), so a rule can be tried again on a run's scenes without drawing them.
export function rules(nodes, file, size, scene) {
  return Object.entries({ contrast: contrast(nodes, file, size), marks: marks(nodes, file, size), apart: [...wordsApart(nodes), ...controlsApart(nodes)], "row ends": rowEnds(nodes), centred: centred(nodes), unbroken: unbroken(nodes), "room to show it": roomy(nodes), corners: corners(nodes, file, size) }).filter(([rule]) => !EXCEPT[scene]?.[rule] && !EXCEPT[scene.split(" · ")[0]]?.[rule]).flatMap(([rule, lines]) => lines.map((line) => `${rule}: ${line}`))
}
