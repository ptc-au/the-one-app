// `bun lint-tokens.js` in core/ui: every colour a style gives words or a glyph (`color`), in the UI library and every
// app, stands off what it's drawn on by WCAG AA's 4.5:1, light and dark: the style's own fill where it has one (a badge,
// a filled button), else each surface a page draws on (the page, a card, a sheet, glass, a panel, a field). So a token
// pair that can't be read is found where it's written, before any scene draws it, as orange words on a grey tile were
// (L79). screenshot.js runs it first; it says each pair that falls short, a line each, and fails. A style that isn't words a
// person must read (a chevron, a disabled pill) is named in `EXCEPT` with why.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { tokens } from "./src/tokens.ts"

const root = fileURLToPath(new URL("../../", import.meta.url))
const TEXT = 4.5
/// What a glyph that isn't words needs, as WCAG's non-text contrast has it.
const GLYPH = 3

/// Styles that aren't words a person must read, or are drawn on a fill another style gives, by `<file>:<style>`, each
/// with what it needs, why, and that fill.
const EXCEPT = {
  "core/ui/src/styled-components/field.tsx:tick": [TEXT, "its tick is drawn only ticked, on `ticked`'s blue", "blue"],
  "core/ui/src/styled-components/time-grid.tsx:todayText": [TEXT, "today's date is drawn only in `today`'s red circle", "red"],
  "apps/settings/client/app.tsx:initials": [TEXT, "on its `avatar`'s fill", "secondaryLabel"],
  "apps/home-screen/client/looks.ts:installing": [0, "a progress ring over an app's icon, on that icon's picture, which screenshot.js's contrast judges as drawn"],
  "core/ui/src/styled-components/list.tsx:chevron": [0, "a row's chevron says nothing its row doesn't, as iOS's tertiary one"],
  "core/ui/src/styled-components/screen.tsx:pillOff": [0, "a pill that's off is disabled, which WCAG asks no contrast of"],
  "core/ui/src/styled-components/widget.tsx:track": [0, "a gauge's track is the ground its fill is read against"],
  "core/ui/src/styled-components/states.tsx:warnSymbol": [GLYPH, "a symbol beside words that say it"],
  "core/ui/src/styled-components/actions.tsx:destructiveGlyph": [GLYPH, "a symbol beside the action's words"],
  "core/ui/src/styled-components/sign-in.tsx:warns": [GLYPH, "a warning's symbol, beside its words in the label's colour"],
  "apps/sign-in/edge/page/page.tsx:warns": [GLYPH, "a warning's symbol, beside its words in the label's colour"],
  "apps/sign-in/edge/page/page.tsx:done": [GLYPH, "a check symbol on green, as big as a title"],
  "core/ui/src/styled-components/widget.tsx:warn": [GLYPH, "a widget's warning tone colours its symbols, bars and gauges; its words are the label's (`plain`)"],
}

/// `oklch(L C H)` or `oklch(L C H / A%)`, or `#rrggbb`, as sRGB 0–255 and alpha 0–1 (Björn Ottosson's OKLab, as
/// tokens.rs reads it).
function parse(value) {
  if (value.startsWith("#")) return [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)).concat(1)
  const [lch, alpha = "1"] = value.slice(6, -1).split("/").map((part) => part.trim())
  const [l, c, h] = lch.split(/\s+/).map((part) => (part.endsWith("%") ? parseFloat(part) / 100 : parseFloat(part)))
  const [a, b] = [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
  const [l_, m_, s_] = [(l + 0.3963377774 * a + 0.2158037573 * b) ** 3, (l - 0.1055613458 * a - 0.0638541728 * b) ** 3, (l - 0.0894841775 * a - 1.291485548 * b) ** 3]
  const linear = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_]
  const gamma = (x) => 255 * (Math.min(1, Math.max(0, x)) <= 0.0031308 ? 12.92 * Math.max(0, x) : 1.055 * Math.min(1, x) ** (1 / 2.4) - 0.055)
  return [...linear.map(gamma), alpha.endsWith("%") ? parseFloat(alpha) / 100 : parseFloat(alpha)]
}

/// A colour token's value in light or dark, as sRGB and alpha.
function colour(token, dark) {
  const value = token.value
  if (typeof value === "string") return parse(value)
  if (value.of) {
    const [r, g, b, a] = colour(value.of, dark)
    return [r, g, b, a * value.alpha]
  }
  return parse(dark && value.dark ? value.dark : value.default)
}
/// `above` drawn over the opaque `below`.
const over = ([r, g, b, a], below) => [r, g, b].map((c, at) => c * a + below[at] * (1 - a)).concat(1)
const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
const ratio = (one, other) => (Math.max(luminance(one), luminance(other)) + 0.05) / (Math.min(luminance(one), luminance(other)) + 0.05)

/// What a page draws words on, each over the page: a widget's card is a quiet fill (`quinaryLabel`).
const SURFACES = ["background", "card", "elevated", "glass", "panel", "field", "quinaryLabel"]
const named = Object.fromEntries(Object.entries(tokens.colour).map(([key, token]) => [key, token]))
const ground = (key, dark) => {
  const page = colour(named.background, dark)
  // A field is on a card; the rest are on the page.
  return key === "field" ? over(colour(named.field, dark), over(colour(named.card, dark), page)) : over(colour(named[key], dark), page)
}

/// Each style object in the UI library's and the apps' code that gives words a colour token: its file, its name, the
/// token, and its own fill's token, if it has one.
function styles() {
  const files = []
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name)) files.push(path)
    }
  }
  walk(join(root, "core/ui/src"))
  for (const app of readdirSync(join(root, "apps"))) for (const part of ["client", "edge"]) {
    const at = join(root, "apps", app, part)
    if (statSync(at, { throwIfNoEntry: false })?.isDirectory()) walk(at)
  }
  return files.flatMap((file) => {
    const code = readFileSync(file, "utf8")
    return [...code.matchAll(/(?<![\w-])color: tokens\.colour\.(\w+)/g)].map((found) => {
      // The object it's in: back to its unmatched `{`, and on to the `}` that closes it.
      let [start, depth] = [found.index, 0]
      while (start > 0 && !(code[start] === "{" && depth === 0)) {
        if (code[start] === "}") depth++
        if (code[start] === "{") depth--
        start--
      }
      let [end, open] = [start + 1, 1]
      while (end < code.length && open) {
        if (code[end] === "{") open++
        if (code[end] === "}") open--
        end++
      }
      const object = code.slice(start, end)
      const key = code.slice(0, start).match(/(\w+):\s*$/)?.[1] ?? "?"
      const fill = object.match(/backgroundColor: (?:\{ default: )?tokens\.colour\.(\w+)/)?.[1]
      return { file: relative(root, file), key, token: found[1], fill }
    })
  })
}

/// Each pair that falls short, a line each.
export function lint() {
  const wrong = []
  for (const { file, key, token, fill } of styles()) {
    const [least, why, on = fill] = EXCEPT[`${file}:${key}`] ?? [TEXT]
    if (!least || !named[token] || token === "transparent") continue
    for (const dark of [false, true]) {
      const grounds = on ? [[on, over(colour(named[on], dark), colour(named.background, dark))]] : SURFACES.map((surface) => [surface, ground(surface, dark)])
      for (const [name, under] of grounds) {
        const by = ratio(over(colour(named[token], dark), under), under)
        if (by < least) wrong.push(`${file} ${key}: ${token} on ${name}, ${dark ? "dark" : "light"}, at ${by.toFixed(2)}:1, under ${least}:1${why ? ` (${why})` : ""}`)
      }
    }
  }
  return wrong
}

if (import.meta.main) {
  const wrong = lint()
  for (const line of wrong) console.log(line)
  if (wrong.length) process.exitCode = 1
}
