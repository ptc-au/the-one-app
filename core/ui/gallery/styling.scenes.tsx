import { createSignal, For } from "solid-js"
import { Button, Image, Pressable, ScrollView, type Scenes, type Styles, styles, Text, tokens, View } from "ui"
import { brand } from "./brand.ts"

const look = styles({
  row: { flexDirection: "row", gap: tokens.grid[3], alignItems: "flex-end" },
  column: { gap: tokens.grid[1], alignItems: "center" },
  stack: { gap: tokens.grid[4] },
  tile: { width: brand.tile, height: brand.tile, borderRadius: tokens.radius.medium, backgroundColor: brand.accent },
  ours: { width: brand.tile, height: brand.tile, borderRadius: tokens.radius.medium, backgroundColor: tokens.colour.magenta },
  tint: { width: brand.tile, height: brand.tile, borderRadius: tokens.radius.medium, backgroundColor: tokens.colour.magentaTint },
  label: { font: tokens.type.small, color: tokens.colour.secondaryLabel },
  bar: (height: number, colour: `#${string}`) => ({ width: tokens.grid[8], height, borderRadius: tokens.radius.small, backgroundColor: colour }),
  track: { position: "relative", width: "100%", height: tokens.grid[8], borderRadius: tokens.radius.full, backgroundColor: tokens.colour.quinaryLabel },
  marker: (start: number, size: number, turn: number) => ({ position: "absolute", top: 0, start, width: size, height: size, borderRadius: tokens.radius.small, backgroundColor: tokens.colour.blue, rotate: turn }),
  cases: { flexDirection: "row", flexWrap: "wrap", gap: tokens.grid[4] },
  case: { width: 96, gap: tokens.grid[2] },
  room: { position: "relative", height: 136 },
  box: { width: 64, height: 64, alignItems: "center", justifyContent: "center", borderRadius: tokens.radius.small },
  name: { font: tokens.type.medium, color: "#ffffff" },
  first: { backgroundColor: tokens.colour.blue },
  second: { backgroundColor: tokens.colour.orange },
  relative: { position: "relative", top: 40 },
  absolute: { position: "absolute", top: 8, start: 0 },
  raised: { zIndex: 1 },
  highest: { zIndex: 2 },
  stacking: { zIndex: 0 },
  later: { position: "relative" },
  plain: { flexShrink: 0 },
  rounded: { width: 120, height: 120, overflow: "hidden", borderRadius: tokens.radius.large },
  inner: { width: "100%", height: "100%", overflow: "hidden", borderRadius: tokens.radius.small },
  fill: { width: "100%", height: "100%" },
  page: { width: 120, height: "100%", flexShrink: 0 },
  pages: { flexDirection: "row", width: "100%", height: "100%" },
  slid: (translateX: number) => ({ width: "100%", height: "100%", backgroundColor: tokens.colour.orange, translateX, transitionProperty: ["translateX"], transition: tokens.motion.smooth }),
  words: { width: "100%", height: "100%", font: tokens.type.title, color: "#ffffff", backgroundColor: tokens.colour.green },
})

/// A square of one colour, as a photo reaching its box's every corner is.
const square = (fill: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/></svg>`)}`

/// Boxes rounded, with `overflow: hidden`, each with what's in it reaching into its corners, which its rounding cuts as
/// CSS's does: a picture, a card that slides, words, a box rounded less inside it, and pages.
const Rounded = () => {
  const [slid, slide] = createSignal(false)
  return (
    <View style={look.stack}>
      <Button onPress={() => slide(!slid())}>Slide</Button>
      <View style={look.cases}>
        <View aria-label="Picture" style={look.rounded}>
          <Image src={square("#3e63dd")} alt="" style={look.fill} />
        </View>
        <View aria-label="Card" style={look.rounded}>
          <View style={look.slid(slid() ? 60 : 0)} />
        </View>
        <View aria-label="Words" style={look.rounded}>
          <Text style={look.words}>Words that fill a rounded box</Text>
        </View>
        <View aria-label="Nested" style={look.rounded}>
          <View style={look.inner}>
            <Image src={square("#e5484d")} alt="" style={look.fill} />
          </View>
        </View>
        <View aria-label="Pages" style={look.rounded}>
          <ScrollView style={look.pages}>
            <Image src={square("#30a46c")} alt="" style={look.page} />
            <Image src={square("#f5a524")} alt="" style={look.page} />
          </ScrollView>
        </View>
      </View>
    </View>
  )
}

const cases = ["Picture", "Card", "Words", "Nested", "Pages"]

/** Two boxes, the first (A) moved over the second (B), which follows it, in a box of its own or not, each with its
 * styles, as CSS paints them (CSS 2.1, Appendix E): what's positioned or says its `zIndex` after its stacking
 * context's flow, by `zIndex`, then in the tree's order. */
const order: [string, string, Styles[], Styles | undefined, Styles[]][] = [
  ["Relative", "1", [look.relative], undefined, []],
  ["In a box", "2", [look.relative], look.plain, []],
  ["zIndex 2 in a zIndex 0 box, then 1", "3", [look.relative, look.highest], look.stacking, [look.later, look.raised]],
  ["zIndex 1, then relative", "4", [look.relative, look.raised], look.plain, [look.later]],
  ["Absolute, then relative", "5", [look.absolute], undefined, [look.later]],
]

/** What a chart has from its data: a height and a colour for each bar. */
const bars: [number, `#${string}`][] = [
  [24, "#e5484d"],
  [64, "#f5a524"],
  [96, "#30a46c"],
  [48, "#3e63dd"],
]

export default {
  "Styling/An app's own tokens": () => (
    <View style={look.row}>
      <View style={look.column}>
        <View style={look.tile} />
        <Text style={look.label}>brand.accent</Text>
      </View>
      <View style={look.column}>
        <View style={look.ours} />
        <Text style={look.label}>magenta</Text>
      </View>
      <View style={look.column}>
        <View style={look.tint} />
        <Text style={look.label}>its tint</Text>
      </View>
    </View>
  ),
  "Styling/Dynamic styles": () => (
    <View style={look.stack}>
      <View style={look.row}>
        <For each={bars}>{([height, colour]) => <View style={look.bar(height, colour)} />}</For>
      </View>
      <View style={look.track}>
        <View style={look.marker(40, 20, 0)} />
        <View style={look.marker(120, 20, 45)} />
      </View>
    </View>
  ),
  "Styling/Painting order": {
    render: () => {
      const [pressed, press] = createSignal("nothing")
      const box = (name: string, style: Styles[]) => (
        <Pressable role="button" aria-label={name} onPress={() => press(name)} style={[look.box, ...style]}>
          <Text aria-hidden="true" style={look.name}>{name}</Text>
        </Pressable>
      )
      return (
        <View style={look.stack}>
          <Text style={look.label}>{`Pressed ${pressed()}`}</Text>
          <View style={look.cases}>
            <For each={order}>
              {([caption, n, first, around, second]) => (
                <View style={look.case}>
                  <Text style={look.label}>{caption}</Text>
                  <View style={look.room}>
                    {around ? <View style={around}>{box(`A${n}`, [look.first, ...first])}</View> : box(`A${n}`, [look.first, ...first])}
                    {box(`B${n}`, [look.second, ...second])}
                  </View>
                </View>
              )}
            </For>
          </View>
        </View>
      )
    },
    // A press reaches what's drawn over the rest: each presses where the two overlap, the middle of the one CSS draws on
    // top, and that's the one pressed.
    checks: Object.fromEntries(
      (
        [
          ["A relative box is over what follows it", "A1"],
          ["One in a box is over what follows the box", "A2"],
          ["A zIndex in a stacking context counts only in it", "B3"],
          ["zIndex 1 is over a relative box that follows it", "A4"],
          ["A relative box is over an absolute one before it", "B5"],
        ] as const
      ).map(([check, top]) => [check, [{ role: "button", name: top }, { expect: { text: `Pressed ${top}` } }]]),
    ),
  },
  "Styling/Rounded corners clip": {
    render: () => <Rounded />,
    checks: {
      "Nothing in a rounded box shows past its corners": cases.map((name) => ({ expect: { rounded: { of: name, radius: 18 } } })),
      "Nor as its card slides": [{ role: "button", name: "Slide" }, { wait: 120 }, { expect: { rounded: { of: "Card", radius: 18 } } }, { wait: 120 }, { expect: { rounded: { of: "Card", radius: 18 } } }],
    },
  },
} satisfies Scenes
