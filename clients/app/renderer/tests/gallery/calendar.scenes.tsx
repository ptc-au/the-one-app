import { createSignal } from "solid-js"
import { Button, Icon, type Scenes, Text, TimeGrid, type TimeGridDay, View } from "ui"

const day = (key: string, weekday: string, date: number, events: TimeGridDay["events"], today = false): TimeGridDay => ({ key, weekday, date, today, events })

// A week as a busy person has one: meetings that overlap (two, then three at once), one past, one with a colour of
// Google's, one short, one with a long title, one running past the evening, and nothing on the weekend.
const week = [
  day("2026-11-23", "MON", 23, [
    { id: "standup", start: 9 * 60, end: 9 * 60 + 15, title: "Standup", text: "9:00 am – 9:15 am", over: true },
    {
      id: "review",
      start: 10 * 60,
      end: 11 * 60,
      title: "Quarterly review with the national leadership team and every state director",
      text: "10:00 am – 11:00 am",
      colour: "#e67c73",
      over: true,
    },
  ]),
  day(
    "2026-11-24",
    "TUE",
    24,
    [
      { id: "one", start: 9 * 60, end: 10 * 60 + 30, title: "Planning", text: "9:00 am – 10:30 am", colour: "#33b679", over: true },
      { id: "two", start: 9 * 60 + 30, end: 10 * 60, title: "Call with Sam", text: "9:30 am – 10:00 am", over: true },
      { id: "three", start: 9 * 60 + 45, end: 11 * 60, title: "Budget", text: "9:45 am – 11:00 am", colour: "#f6bf26", over: true },
      { id: "lunch", start: 12 * 60 + 30, end: 13 * 60 + 30, title: "Lunch", text: "12:30 pm – 1:30 pm" },
      { id: "late", start: 17 * 60, end: 20 * 60, title: "Evening event", text: "5:00 pm – 8:00 pm", colour: "#8e24aa" },
    ],
    true,
  ),
  day("2026-11-25", "WED", 25, [{ id: "focus", start: 8 * 60, end: 12 * 60, title: "Focus time", text: "8:00 am – 12:00 pm", colour: "#039be5" }]),
  day("2026-11-26", "THU", 26, [{ id: "one-on-one", start: 14 * 60, end: 14 * 60 + 30, title: "1:1", text: "2:00 pm – 2:30 pm" }]),
  day("2026-11-27", "FRI", 27, [{ id: "drinks", start: 16 * 60, end: 17 * 60, title: "Team drinks", text: "4:00 pm – 5:00 pm", colour: "#0b8043" }]),
  day("2026-11-28", "SAT", 28, []),
  day("2026-11-29", "SUN", 29, []),
]

const allDay = [
  { id: "conference", title: "National conference", from: 1, to: 3, colour: "#3f51b5" as const },
  { id: "leave", title: "Annual leave", from: 4, to: 6 },
  { id: "birthday", title: "Sam's birthday", from: 2, to: 2, colour: "#f4511e" as const },
]

/// The week with a day chosen by its header, which it says as text, so a check can.
const Week = () => {
  const [chosen, setChosen] = createSignal("2026-11-24")
  return (
    <View>
      <TimeGrid days={week} allDay={allDay} hours={[7, 21]} now={11 * 60 + 20} selected={chosen()} onSelect={setChosen} />
      <Text>{`Chosen: ${chosen()}`}</Text>
    </View>
  )
}

export default {
  "Calendar/Week": {
    render: () => <Week />,
    size: [1100, 900],
    checks: {
      "A day's header chooses it": [{ role: "button", name: "Show THU 26" }, { expect: { text: "Chosen: 2026-11-26" } }],
    },
  },
  // One day, its own bar naming it, with Join on a call that's still to come.
  "Calendar/Day": () => (
    <TimeGrid
      header={false}
      days={[
        {
          ...week[1],
          events: week[1].events.map((event) =>
            event.id === "lunch"
              ? {
                  ...event,
                  action: (
                    <Button size="icon" variant="ghost" aria-label="Join">
                      <Icon name="video-camera" />
                    </Button>
                  ),
                }
              : event,
          ),
        },
      ]}
      allDay={[{ id: "conference", title: "National conference", from: 0, to: 0, colour: "#3f51b5" }]}
      hours={[7, 21]}
      now={11 * 60 + 20}
    />
  ),
  "Calendar/Empty week": { render: () => <TimeGrid days={week.map((one) => ({ ...one, today: false, events: [] }))} />, size: [1100, 900] },
} satisfies Scenes
