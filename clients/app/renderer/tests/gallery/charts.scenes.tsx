import { createSignal } from "solid-js"
import { Chart, type Scenes, styles, Text, Tile, tokens, View } from "ui"

const look = styles({
  page: { gap: tokens.grid[4], padding: tokens.grid[4] },
  chart: { height: tokens.grid[24] },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: tokens.grid[2] },
})

const weeks = ["6/10", "13/10", "20/10", "27/10", "3/11", "10/11", "17/11", "24/11"]

/// Tiles as My Tasks has them: a status's, with its colour, and one with a note; pressing one chooses it, which it
/// says as text, so a check can.
const Tiles = () => {
  const [chosen, setChosen] = createSignal("in progress")
  const tile = (id: string, value: number, label: string, colour?: `#${string}`, note?: string) => (
    <Tile value={value} label={label} colour={colour} note={note} chosen={chosen() === id} onPress={() => setChosen(id)} />
  )
  return (
    <View style={look.page}>
      <View style={look.tiles}>
        {tile("to do", 7, "To do", "#87909e")}
        {tile("in progress", 4, "In progress", "#5f55ee")}
        {tile("review", 2, "Review required", "#f8ae00")}
        {tile("waiting", 1234, "Waiting on a response from someone outside", "#e16b16")}
      </View>
      <View style={look.tiles}>
        {tile("priority", 3, "Priority")}
        {tile("overdue", 1, "Overdue")}
        {tile("stuck", 0, "Stuck", undefined, "no update 14+ days")}
      </View>
      <Text>{`Chosen: ${chosen()}`}</Text>
    </View>
  )
}

export default {
  // Eight weeks' bars, this week's picked out, each with its figure over it, and an empty week.
  "Charts/Bars with figures, one picked out": () => (
    <View style={look.page}>
      <Chart values={[3, 5, 2, 6, 4, 7, 0, 2]} labels={weeks} highlight={7} figures label="Closed per week" style={look.chart} />
    </View>
  ),
  "Charts/Bars, all nothing": () => (
    <View style={look.page}>
      <Chart values={[0, 0, 0, 0, 0, 0, 0, 0]} labels={weeks} highlight={7} figures label="Closed per week" style={look.chart} />
    </View>
  ),
  "Charts/A line": () => (
    <View style={look.page}>
      <Chart kind="line" values={[3, 5, 4, 8, 12, 9, 14, 11, 7, 9, 13, 10]} label="Network" style={look.chart} />
    </View>
  ),
  "Tiles/Statuses and what needs attention": {
    render: () => <Tiles />,
    checks: {
      "A tile chooses itself": [{ role: "button", name: "Overdue: 1" }, { expect: { text: "Chosen: overdue" } }],
    },
  },
} satisfies Scenes
