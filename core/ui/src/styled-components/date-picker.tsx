// A day chosen from a calendar: its face in a field's box, as a select's is, and a month of days in a sheet.
// Written once on the drawing primitives (#primitives), the same on every host.
import { createSignal, For, Show } from "solid-js"
import { Pressable, Text, View } from "#primitives"
import { createControllableSignal } from "../behavior-primitives/controllable.ts"
import { createButton } from "../headless-components/button.ts"
import { useField } from "../headless-components/field.ts"
import { messages } from "../words.ts"
import { Button, Icon } from "./button.tsx"
import { Sheet } from "./sheet.tsx"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

const look = styles({
  face: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.grid[2],
    width: "100%",
    minWidth: 0,
    height: tokens.length.control,
    paddingInline: tokens.grid[3],
    borderRadius: tokens.radius.medium,
    font: tokens.type.field,
    color: tokens.colour.label,
    textAlign: "start",
    cursor: "pointer",
    userSelect: "none",
    boxShadow: { default: tokens.shadow.edge, focused: tokens.shadow.focus },
    transitionProperty: ["boxShadow"],
    transition: tokens.motion.quick,
  },
  wrong: { boxShadow: { default: tokens.shadow.wrongEdge, focused: tokens.shadow.wrongFocus } },
  off: { opacity: 0.5, cursor: "default" },
  chosen: { flexGrow: 1, flexShrink: 1, minWidth: 0, lineClamp: 1 },
  placeholder: { color: tokens.colour.secondaryLabel },
  icon: { color: tokens.colour.secondaryLabel },
  month: { gap: tokens.grid[1] },
  bar: { flexDirection: "row", alignItems: "center", gap: tokens.grid[1] },
  name: { flexGrow: 1, minWidth: 0, font: tokens.type.headline, textAlign: "start" },
  week: { flexDirection: "row" },
  weekday: { flexGrow: 1, flexBasis: 0, height: tokens.grid[8], font: tokens.type.small, color: tokens.colour.secondaryLabel, textAlign: "center" },
  cell: { flexGrow: 1, flexBasis: 0, height: tokens.length.control, alignItems: "center", justifyContent: "center" },
  day: {
    width: tokens.length.control,
    height: tokens.length.control,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.full,
    font: tokens.type.medium,
    color: tokens.colour.label,
    cursor: "pointer",
    backgroundColor: { default: tokens.colour.transparent, hover: tokens.colour.quinaryLabel },
    boxShadow: { default: "none", focused: tokens.shadow.focus },
  },
  today: { boxShadow: { default: tokens.shadow.tick, focused: tokens.shadow.focus } },
  picked: { backgroundColor: { default: tokens.colour.label, hover: tokens.colour.label }, color: tokens.colour.background },
})

/** A day as the year, month and day it's of: the month from 0. */
type Day = { year: number; month: number; day: number }

const pad = (count: number) => String(count).padStart(2, "0")
/** `2026-10-14`, as an ISO 8601 date. */
const iso = ({ year, month, day }: Day) => `${year}-${pad(month + 1)}-${pad(day)}`
const parse = (value?: string): Day | undefined => {
  const [, year, month, day] = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? []
  return year ? { year: +year, month: +month - 1, day: +day } : undefined
}
const utc = ({ year, month, day }: Day) => new Date(Date.UTC(year, month, day))
const written = (day: Day, format: Intl.DateTimeFormatOptions) => utc(day).toLocaleDateString(undefined, { ...format, timeZone: "UTC" })
const today = (): Day => {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }
}

/** The day a week starts on, 0 for Sunday, as the language has it (Monday where it doesn't say). */
const weekStart = () => {
  const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }
  return (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay ?? 1
}

/** A `DatePicker`'s props. */
export interface DatePickerProps {
  /** The day chosen, as an ISO 8601 date: `"2026-10-14"`. */
  value?: string
  placeholder?: string
  disabled?: boolean
  "aria-label"?: string
  onValueChange?: (value: string) => void
}

function DayButton(props: { day: Day; picked: boolean; now: boolean; onPress: () => void }) {
  const button = createButton({ onPress: () => props.onPress() })
  return (
    <Pressable {...button.root()} aria-label={written(props.day, { dateStyle: "full" })} aria-pressed={props.picked ? "true" : "false"} style={[look.day, props.now && look.today, props.picked && look.picked]}>
      <Text>{String(props.day.day)}</Text>
    </Pressable>
  )
}

/// `<Field label="Date"><DatePicker value={receipt().date} onValueChange={setDate} /></Field>`: a day, chosen from a month of
/// days in a sheet that opens from its face (up from the foot of a narrow window, in the middle of a wide one),
/// as the date pickers of iOS, Android and shadcn's are drawn. `value` is an ISO 8601 date, `"2026-10-14"`, and
/// `onValueChange` is told the day pressed in the same form; `placeholder` says what it is until one's chosen. Its
/// weeks start on the day the language's do.
export function DatePicker(props: DatePickerProps) {
  const field = useField()
  const [value, choose] = createControllableSignal<string>({ value: () => props.value, onChange: (value) => props.onValueChange?.(value) })
  const [open, setOpen] = createSignal(false)
  const [shown, setShown] = createSignal<Pick<Day, "year" | "month">>(today())
  const off = () => !!props.disabled || !!field?.disabled()
  const chosen = () => parse(value())
  const label = () => props["aria-label"] ?? field?.label()
  const show = () => {
    if (off()) return
    const start = chosen() ?? today()
    setShown({ year: start.year, month: start.month })
    setOpen(true)
  }
  const move = (by: number) => setShown(({ year, month }) => ({ year: year + Math.floor((month + by) / 12), month: (((month + by) % 12) + 12) % 12 }))
  // The month's weeks, each seven places from the week's first day, a place with no day in it has none.
  const weeks = () => {
    const { year, month } = shown()
    const lead = (utc({ year, month, day: 1 }).getUTCDay() - weekStart() + 7) % 7
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const places = Array.from({ length: Math.ceil((lead + length) / 7) * 7 }, (_, at) => ({ day: at >= lead && at < lead + length ? at - lead + 1 : undefined }))
    return Array.from({ length: places.length / 7 }, (_, at) => places.slice(at * 7, at * 7 + 7))
  }
  const names = () => Array.from({ length: 7 }, (_, at) => ({ name: written({ year: 2026, month: 0, day: 4 + ((weekStart() + at) % 7) }, { weekday: "narrow" }) }))
  const press = (day: Day) => {
    choose(iso(day))
    setOpen(false)
  }
  const face = createButton({
    get disabled() {
      return off()
    },
    onPress: show,
  })
  return (
    <View>
      <Pressable
        {...face.root()}
        aria-label={label()}
        aria-haspopup="dialog"
        aria-description={field?.message()}
        aria-invalid={field?.invalid() ? "true" : undefined}
        style={[look.face, field?.invalid() && look.wrong, off() && look.off]}
      >
        <Text style={[look.chosen, !chosen() && look.placeholder]}>{chosen() ? written(chosen()!, { day: "numeric", month: "short", year: "numeric" }) : props.placeholder || " "}</Text>
        <View style={look.icon}>
          <Icon name="calendar-blank" />
        </View>
      </Pressable>
      <Sheet heading={label() ?? messages.chooseDate} open={open()} onClose={() => setOpen(false)}>
        <View style={look.month}>
          <View style={look.bar}>
            <Text role="heading" aria-level={3} style={look.name}>
              {written({ ...shown(), day: 1 }, { month: "long", year: "numeric" })}
            </Text>
            <Button variant="ghost" size="icon" aria-label={messages.previousMonth} onPress={() => move(-1)}>
              <Icon name="caret-left" />
            </Button>
            <Button variant="ghost" size="icon" aria-label={messages.nextMonth} onPress={() => move(1)}>
              <Icon name="caret-right" />
            </Button>
          </View>
          <View style={look.week} aria-hidden="true">
            <For each={names()}>{(one) => <Text style={look.weekday}>{one.name}</Text>}</For>
          </View>
          <For each={weeks()}>
            {(week) => (
              <View style={look.week}>
                <For each={week}>
                  {(day) => (
                    <View style={look.cell}>
                      <Show when={day.day}>
                        {(of) => {
                          const here = (): Day => ({ ...shown(), day: of() })
                          return <DayButton day={here()} picked={value() === iso(here())} now={iso(today()) === iso(here())} onPress={() => press(here())} />
                        }}
                      </Show>
                    </View>
                  )}
                </For>
              </View>
            )}
          </For>
        </View>
      </Sheet>
    </View>
  )
}
