import { Chart, type Scenes, styles, tokens, View } from "ui"

const look = styles({
  page: { gap: tokens.grid[4], padding: tokens.grid[4] },
  chart: { height: tokens.grid[24] },
})

const weeks = ["6/10", "13/10", "20/10", "27/10", "3/11", "10/11", "17/11", "24/11"]

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
} satisfies Scenes
