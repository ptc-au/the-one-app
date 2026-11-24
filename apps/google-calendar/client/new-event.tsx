// A new event, as a form `create_event`'s arguments fill (`toolInput`): a link to it, `create_event&summary=Lunch`, at
// /google-calendar/events/new?summary=Lunch, opens it filled in, as Google Calendar's own "Add to calendar" links do,
// and nothing is added until its person presses Add. What they type stays the page's own.
import { createMemo, createSignal, Show } from "solid-js"
import { Button, call, Field, Input, leave, Metadata, open, Problem, render, Screen, Section, Status, Switch, Textarea, toolInput, toolResult } from "ui"

/** When an event starts or ends, as Calendar's EventDateTime has it. */
type When = { dateTime?: string; date?: string; timeZone?: string }
type Inputs = { summary?: string; start?: When; end?: When; location?: string; description?: string; attendees?: { email: string; optional?: boolean }[]; sendUpdates?: string }
type Added = { summary: string | null; start: When | null; htmlLink: string }

const day = (when?: When) => when?.date ?? when?.dateTime?.slice(0, 10) ?? ""
const time = (when?: When) => when?.dateTime?.slice(11, 16) ?? ""
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

function Form(props: { given: Inputs }) {
  const given = props.given
  const [summary, setSummary] = createSignal(given.summary ?? "")
  const [allDay, setAllDay] = createSignal(!!given.start?.date)
  const [date, setDate] = createSignal(day(given.start))
  const [starts, setStarts] = createSignal(time(given.start))
  const [ends, setEnds] = createSignal(time(given.end))
  const [location, setLocation] = createSignal(given.location ?? "")
  const [notes, setNotes] = createSignal(given.description ?? "")
  const [guests, setGuests] = createSignal((given.attendees ?? []).map(({ email }) => email).join(", "))
  const [tell, setTell] = createSignal(given.sendUpdates === "all")
  const [adding, setAdding] = createSignal(false)
  const [problem, setProblem] = createSignal<Error>()
  const [added, setAdded] = createSignal<Added>()
  const ready = () => summary().trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(date()) && (allDay() || /^\d{2}:\d{2}$/.test(starts()))
  // A time is the calendar's own time zone's, or the one the link named.
  const at = (clock: string) => ({ dateTime: `${date()}T${clock}:00`, ...(given.start?.timeZone && { timeZone: given.start.timeZone }) })
  async function add() {
    setAdding(true)
    setProblem(undefined)
    const emails = guests().split(/[,\s]+/).filter(Boolean)
    try {
      const event = await call("google-calendar_create_event", {
        ...given,
        summary: summary().trim(),
        start: allDay() ? { date: date() } : at(starts()),
        end: allDay() ? { date: nextDay(date()) } : ends() ? at(ends()) : undefined,
        location: location() || undefined,
        description: notes() || undefined,
        attendees: emails.length ? emails.map((email) => ({ email })) : undefined,
        sendUpdates: tell() && emails.length ? "all" : "none",
      })
      setAdded(JSON.parse(event) as Added)
    } catch (error) {
      setProblem(error as Error)
    } finally {
      setAdding(false)
    }
  }
  return (
    <Show when={added()} fallback={
      <Screen heading="New Event" action={<Button disabled={!ready() || adding()} onPress={add}>Add</Button>}>
        <Show when={problem()}>
          {(why) => (
            <Problem
              heading="Couldn't add it"
              text={why()}
              action={why().message.startsWith("Sign in") ? <Button onPress={() => open("settings#section&app=vault&section=accounts")}>Sign In</Button> : undefined}
            />
          )}
        </Show>
        <Section>
          <Field label="Title"><Input value={summary()} onChangeText={setSummary} /></Field>
          <Switch label="All day" value={allDay()} onValueChange={setAllDay} />
          <Field label="Date"><Input value={date()} onChangeText={setDate} placeholder="2026-11-25" /></Field>
          <Show when={!allDay()}>
            <>
              <Field label="Starts"><Input value={starts()} onChangeText={setStarts} placeholder="10:00" /></Field>
              <Field label="Ends" hint="An hour later if left out"><Input value={ends()} onChangeText={setEnds} placeholder="11:00" /></Field>
            </>
          </Show>
          <Field label="Location"><Input value={location()} onChangeText={setLocation} /></Field>
          <Field label="Guests" hint="Their email addresses"><Input value={guests()} onChangeText={setGuests} inputMode="email" /></Field>
          <Show when={guests().trim()}>
            <Switch label="Email the guests" value={tell()} onValueChange={setTell} />
          </Show>
          <Field label="Notes"><Textarea value={notes()} onChangeText={setNotes} /></Field>
        </Section>
      </Screen>
    }>
      {(event) => <Done event={event()} />}
    </Show>
  )
}

/** The event added: by the form's Add, or by an assistant, as it shows what `create_event` answered. */
function Done(props: { event: Added }) {
  return (
    <Screen heading="Added" action={<Button onPress={() => leave()}>Done</Button>}>
      <Status heading={props.event.summary ?? "Event"} text="It's in your calendar." />
      <Metadata>
        <Metadata.Label title="When" text={props.event.start?.dateTime?.replace("T", " ").slice(0, 16) ?? props.event.start?.date ?? ""} />
      </Metadata>
      <Button variant="secondary" onPress={() => open(props.event.htmlLink)}>Open in Google Calendar</Button>
    </Screen>
  )
}

// The form starts again from what a link says whenever another link opens it.
const given = createMemo(() => toolInput("google-calendar_create_event").arguments as Inputs)

render(() => (
  <Show when={toolResult()?.structuredContent as Added | undefined} fallback={<Show when={given()} keyed>{(inputs) => <Form given={inputs} />}</Show>}>
    {(event) => <Done event={event()} />}
  </Show>
))
