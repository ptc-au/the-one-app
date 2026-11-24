// A calendar's week or day as Google Calendar and Apple Calendar draw one, FullCalendar's timeGrid: a column for
// each day, its hours down the side, each event a block where its time is, those that overlap side by side, what
// takes whole days in a lane over it, and now a red line across today. Written once on the drawing primitives, the
// same on every host.
import { For, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Pressable, Text, View } from "#primitives"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

// Points an hour takes, and a lane of whole days, as Google Calendar's week has them.
const HOUR = 44
const LANE = 24

const look = styles({
  grid: { borderRadius: tokens.radius.large, backgroundColor: tokens.colour.card, overflow: "hidden" },
  days: {
    flexDirection: "row",
    paddingBlock: tokens.grid[2],
    paddingStart: tokens.grid[12],
    borderBottomWidth: tokens.length.hairline,
    borderColor: tokens.colour.quinaryLabel,
  },
  day: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    alignItems: "center",
    gap: tokens.grid[0.5],
    marginInline: tokens.grid[0.5],
    paddingBlock: tokens.grid[0.5],
    borderRadius: tokens.radius.medium,
    backgroundColor: { hover: tokens.colour.quinaryLabel, pressed: tokens.colour.quaternaryLabel },
  },
  chosen: { backgroundColor: tokens.colour.selection },
  weekday: { font: tokens.type.small, color: tokens.colour.secondaryLabel },
  date: { width: tokens.grid[8], height: tokens.grid[8], alignItems: "center", justifyContent: "center", borderRadius: tokens.radius.full },
  dateText: { font: tokens.type.large, color: tokens.colour.label },
  today: { backgroundColor: tokens.colour.red },
  todayText: { color: tokens.colour.onAccent },
  todayWeekday: { color: tokens.colour.red },
  lanes: (height: number) => ({ position: "relative", height, borderBottomWidth: tokens.length.hairline, borderColor: tokens.colour.quinaryLabel }),
  allDayLabel: { position: "absolute", start: tokens.grid[1], top: tokens.grid[1], font: tokens.type.small, color: tokens.colour.secondaryLabel },
  bars: { position: "relative", flexGrow: 1, flexBasis: 0, minWidth: 0, marginStart: tokens.grid[12] },
  placed: { position: "absolute", flexDirection: "row" },
  bar: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.grid[1.5],
    paddingInline: tokens.grid[2],
    overflow: "hidden",
    borderRadius: tokens.radius.small,
    backgroundColor: { default: tokens.colour.quinaryLabel, hover: tokens.colour.quaternaryLabel },
  },
  barSwatch: { width: tokens.grid[1], height: tokens.grid[3], borderRadius: tokens.radius.full, backgroundColor: tokens.colour.label },
  barTitle: { flexGrow: 1, flexBasis: 0, minWidth: 0, font: tokens.type.small, color: tokens.colour.label, lineClamp: 1 },
  body: (height: number) => ({ flexDirection: "row", height }),
  hours: { position: "relative", width: tokens.grid[12] },
  hour: (top: number) => ({ position: "absolute", end: tokens.grid[2], top, font: tokens.type.small, color: tokens.colour.secondaryLabel }),
  column: { position: "relative", flexGrow: 1, flexBasis: 0, minWidth: 0, borderStartWidth: tokens.length.hairline, borderColor: tokens.colour.quinaryLabel },
  todayColumn: { backgroundColor: tokens.colour.stripe },
  line: (top: number) => ({ position: "absolute", start: 0, end: 0, top, borderTopWidth: tokens.length.hairline, borderColor: tokens.colour.quinaryLabel }),
  now: (top: number) => ({ position: "absolute", start: 0, end: 0, top, height: tokens.grid[0.5], backgroundColor: tokens.colour.red }),
  event: {
    flexGrow: 1,
    flexDirection: "row",
    overflow: "hidden",
    borderRadius: tokens.radius.small,
    borderWidth: tokens.length.hairline,
    borderColor: tokens.colour.quinaryLabel,
    backgroundColor: { default: tokens.colour.quinaryLabel, hover: tokens.colour.quaternaryLabel },
  },
  place: (start: `${number}%`, width: `${number}%`, top: number, height: number) => ({ start, width, top, height }),
  over: { opacity: 0.5 },
  swatch: { width: tokens.grid[1], backgroundColor: tokens.colour.label },
  colour: (colour: `#${string}`) => ({ backgroundColor: colour }),
  words: { flexGrow: 1, flexBasis: 0, minWidth: 0, paddingInline: tokens.grid[1.5], paddingBlock: tokens.grid[0.5] },
  title: { font: tokens.type.small, fontWeight: tokens.weight.semibold, color: tokens.colour.label },
  text: { font: tokens.type.small, color: tokens.colour.secondaryLabel, lineClamp: 1 },
  oneLine: { lineClamp: 1 },
  twoLines: { lineClamp: 2 },
  action: { justifyContent: "center", paddingEnd: tokens.grid[1] },
})

/** One event at a time of day: where it starts and ends in its day, in minutes from midnight. */
export type TimeGridEvent = {
  id: string
  start: number
  end: number
  title: string
  /** A grey line under its title, where there's room: when it is, where. */
  text?: string
  /** Its own colour, as Google's event colours, from data; the text's where it has none. */
  colour?: `#${string}` | null
  /** It's over, so it's faded. */
  over?: boolean
  /** Something to do with it, drawn at its end where it's tall enough: a Join button. */
  action?: JSX.Element
  onPress?: () => void
}

/** A day's column, with its events. */
export type TimeGridDay = { key: string; weekday: string; date: number | string; today?: boolean; events: TimeGridEvent[] }

/** Something that takes whole days, from the column `from` to the column `to`. */
export type TimeGridAllDay = { id: string; title: string; from: number; to: number; colour?: `#${string}` | null; onPress?: () => void }

type Placed = TimeGridEvent & { top: number; bottom: number; column: number; columns: number }

// Events that overlap side by side, as Google Calendar sets them: soonest first, each in the first column free
// where it starts, and every event of a run of overlapping ones as wide as that run has columns. An event shorter
// than 20 minutes takes 20, so it can be read.
function place(events: TimeGridEvent[]): Placed[] {
  const placed = [...events]
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .map((event) => ({ ...event, top: event.start, bottom: Math.max(event.start + 20, event.end), column: 0, columns: 1 }))
  let run: Placed[] = []
  let ends: number[] = []
  let runEnd = -Infinity
  const close = () => {
    for (const event of run) event.columns = ends.length
    run = []
    ends = []
  }
  for (const event of placed) {
    if (event.top >= runEnd) close()
    let column = ends.findIndex((end) => end <= event.top)
    if (column < 0) {
      column = ends.length
      ends.push(event.bottom)
    } else ends[column] = event.bottom
    event.column = column
    run.push(event)
    runEnd = Math.max(runEnd, event.bottom)
  }
  close()
  return placed
}

// Whole days in lanes, each in the first lane free from its first day, as Google Calendar stacks them.
function lanes(bars: TimeGridAllDay[]) {
  const ends: number[] = []
  return [...bars]
    .sort((a, b) => a.from - b.from || b.to - a.to)
    .map((bar) => {
      let lane = ends.findIndex((end) => end < bar.from)
      if (lane < 0) {
        lane = ends.length
        ends.push(bar.to)
      } else ends[lane] = bar.to
      return { ...bar, lane }
    })
}

const hourName = (hour: number) => `${hour % 12 || 12} ${hour < 12 || hour === 24 ? "am" : "pm"}`
const percent = (share: number) => `${share * 100}%` as const

/// `<TimeGrid days={week()} hours={[7, 19]} now={minutes()} selected={day()} onSelect={setDay} />`: a calendar's
/// week, or with one day its day, as Google Calendar and Apple Calendar draw them (FullCalendar's timeGrid): a column
/// for each day under its weekday and date, which `onSelect` is told the `key` of when it's pressed and `selected`
/// marks, today's date in a red circle; the `hours` from the first to the last down the side; each event a block
/// where its time is, those that overlap side by side, with its colour at its start, its title and, where there's
/// room, its `text` and its `action`; `allDay`, what takes whole days, in lanes over the hours; and `now`, in minutes
/// from today's midnight, a red line across today. `header={false}` leaves out the row of days, for a day whose own
/// bar names it.
export function TimeGrid(props: {
  days: TimeGridDay[]
  hours?: [number, number]
  allDay?: TimeGridAllDay[]
  now?: number | null
  selected?: string
  onSelect?: (key: string) => void
  header?: boolean
}) {
  const first = () => props.hours?.[0] ?? 7
  const last = () => props.hours?.[1] ?? 19
  const y = (minutes: number) => ((minutes - first() * 60) * HOUR) / 60
  const marks = () => Array.from({ length: Math.max(0, last() - first() - 1) }, (_, i) => first() + 1 + i)
  const bars = () => lanes(props.allDay ?? [])
  const laneCount = () => Math.max(1, ...bars().map((bar) => bar.lane + 1))
  const width = () => props.days.length
  return (
    <View style={look.grid}>
      <Show when={props.header !== false}>
        <View style={look.days}>
          <For each={props.days} keyed={(day) => day.key}>
            {(day) => (
              <Pressable
                role="button"
                aria-label={`Show ${day().weekday} ${day().date}`}
                aria-selected={day().key === props.selected ? "true" : "false"}
                onPress={() => props.onSelect?.(day().key)}
                style={[look.day, day().key === props.selected && look.chosen]}
              >
                <Text style={[look.weekday, day().today && look.todayWeekday]}>{day().weekday}</Text>
                <View style={[look.date, day().today && look.today]}>
                  <Text style={[look.dateText, day().today && look.todayText]}>{String(day().date)}</Text>
                </View>
              </Pressable>
            )}
          </For>
        </View>
      </Show>
      <View style={look.lanes(laneCount() * LANE + 6)}>
        <Text style={look.allDayLabel}>all-day</Text>
        <View role="list" aria-label="All-day" style={look.bars}>
          <For each={bars()} keyed={(bar) => bar.id}>
            {(bar) => (
              <View
                role="listitem"
                style={[
                  look.placed,
                  look.place(percent(bar().from / width()), percent((bar().to - bar().from + 1) / width()), 3 + bar().lane * LANE, LANE - 3),
                ]}
              >
                <Pressable role="button" aria-label={bar().title} onPress={() => bar().onPress?.()} style={look.bar}>
                  <View style={[look.barSwatch, bar().colour && look.colour(bar().colour!)]} />
                  <Text style={look.barTitle}>{bar().title}</Text>
                </Pressable>
              </View>
            )}
          </For>
        </View>
      </View>
      <View style={look.body((last() - first()) * HOUR)}>
        <View style={look.hours}>
          <For each={marks()}>{(hour) => <Text style={look.hour(y(hour * 60) - 8)}>{hourName(hour)}</Text>}</For>
        </View>
        <For each={props.days} keyed={(day) => day.key}>
          {(day) => (
            <View role="list" aria-label={`${day().weekday} ${day().date}`} style={[look.column, day().today && look.todayColumn]}>
              <For each={marks()}>{(hour) => <View style={look.line(y(hour * 60))} />}</For>
              <For each={place(day().events)} keyed={(event) => event.id}>
                {(event) => {
                  const height = () => Math.max(18, ((event().bottom - event().top) * HOUR) / 60 - 2)
                  return (
                    <View
                      role="listitem"
                      style={[look.placed, look.place(percent(event().column / event().columns), percent(1 / event().columns), y(event().top), height())]}
                    >
                      <Pressable
                        role="button"
                        aria-label={event().text ? `${event().title}, ${event().text}` : event().title}
                        onPress={() => event().onPress?.()}
                        style={[look.event, event().over && look.over]}
                      >
                        <View style={[look.swatch, event().colour && look.colour(event().colour!)]} />
                        <View style={look.words}>
                          <Text style={[look.title, height() >= 54 ? look.twoLines : look.oneLine]}>{event().title}</Text>
                          <Show when={event().text && height() >= 36}>
                            <Text style={look.text}>{event().text}</Text>
                          </Show>
                        </View>
                        <Show when={event().action && height() >= 36}>
                          <View style={look.action}>{event().action}</View>
                        </Show>
                      </Pressable>
                    </View>
                  )
                }}
              </For>
              <Show when={day().today && props.now != null && props.now >= first() * 60 && props.now <= last() * 60}>
                <View style={look.now(y(props.now!))} />
              </Show>
            </View>
          )}
        </For>
      </View>
    </View>
  )
}
