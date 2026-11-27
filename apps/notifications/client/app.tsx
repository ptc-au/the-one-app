// Notifications: what you've been told, newest first. Tapping one marks it read and opens the app it's from. Swipe on
// a phone, or press the clear button on a computer, to clear one; Older loads past the first page. A phone or
// a browser that isn't woken by them says so first, and why, and a browser turns them on here. Which apps may notify you
// is in Settings (settings.tsx). Its one screen is `notifications_inbox` (`toolInput`).
import { createProjection, createSignal, Loading, refresh, Show } from "solid-js"
import { Button, call, changed, client, confirm, Empty, Errored, Icon, List, ListStyle, Menu, open, render, Row, Screen, Section, since, Spinner, styles, Text, toast, tokens, toolInput, touch, View } from "ui"
import { type Push, PushState } from "./push.tsx"

/** What hasn't been read has a blue dot before it, as Mail's rows do, and a heavier weight. */
const look = styles({
  unread: { fontWeight: tokens.weight.medium },
  dot: { width: tokens.grid[2.5], height: tokens.grid[2.5], borderRadius: tokens.radius.full },
  blue: { backgroundColor: tokens.colour.blue },
})

/** A notification, as `notifications_inbox` answers it. */
interface Received {
  id: number | string
  title: string
  text?: string
  from?: string
  app?: string
  /// Its app's page a tap opens, where it isn't its first.
  page?: string
  /// What a tap opens, as `open` takes it: its app's page, or its section in Settings.
  opens?: string
  at: string
  read: boolean
}

const [older, setOlder] = createSignal<Received[]>([])
const [moreOlder, setMoreOlder] = createSignal<boolean | undefined>()
const [loadingOlder, setLoadingOlder] = createSignal(false)

const inboxAnswer = createProjection(async (): Promise<{ notifications: Received[]; more: boolean; push?: Push; settings: boolean }> => {
  const [{ notifications, more }, { push, settings }]: [{ notifications: Received[]; more?: boolean }, { push?: Push; settings?: boolean }] = await Promise.all([
    call("notifications_inbox", toolInput("notifications_inbox").arguments).then(JSON.parse),
    client(),
  ])
  return { notifications, more: more === true, push, settings: settings === true }
})
const inbox = () => inboxAnswer
changed(() => refresh(inboxAnswer))

/// Does something to the inbox, and says what the server said if it wouldn't.
async function change(tool: string, input = {}) {
  try {
    await call(tool, input)
  } catch (error) {
    toast(error as Error)
  }
  refresh(inboxAnswer)
}

function tapped(notification: Received) {
  if (!notification.read) {
    setOlder((items) => items.map((item) => (item.id === notification.id ? { ...item, read: true } : item)))
    change("notifications_read", { id: notification.id })
  }
  if (notification.opens) open(notification.opens)
}

function clearOne(id: Received["id"]) {
  setOlder((items) => items.filter((item) => item.id !== id))
  change("notifications_clear", { id })
}

async function clearAll() {
  const question = { heading: "Clear all notifications?", text: "They're gone from every device of yours.", action: "Clear All", destructive: true }
  if (await confirm(question)) {
    setOlder([])
    setMoreOlder(false)
    change("notifications_clear")
  }
}

async function loadOlder(before: Received["id"]) {
  setLoadingOlder(true)
  try {
    const { notifications, more }: { notifications: Received[]; more?: boolean } = JSON.parse(await call("notifications_inbox", { before }))
    setOlder((items) => {
      const seen = new Set(items.map((item) => item.id))
      return [...items, ...notifications.filter((item) => !seen.has(item.id))]
    })
    setMoreOlder(more === true)
  } catch (error) {
    toast(error as Error)
  } finally {
    setLoadingOlder(false)
  }
}

const More = () => (
  <Menu.Root onSelect={(value) => (value === "read" ? (setOlder((items) => items.map((item) => ({ ...item, read: true }))), change("notifications_read")) : clearAll())}>
    <Menu.Trigger />
    <Menu.Positioner>
      <Menu.Content>
        <Menu.Item value="read">Mark All Read</Menu.Item>
        <Menu.Separator />
        <Menu.Item value="clear" destructive>Clear All</Menu.Item>
      </Menu.Content>
    </Menu.Positioner>
  </Menu.Root>
)

/** What `inbox` answers, once it has. */
type Inbox = Awaited<ReturnType<typeof inbox>>

function Inbox(props: { inbox: Inbox }) {
  const shown = () => {
    const first = props.inbox.notifications
    const ids = new Set(first.map((item) => item.id))
    return [...first, ...older().filter((item) => !ids.has(item.id))]
  }
  const hasMore = () => (moreOlder() !== undefined ? moreOlder()! : props.inbox.more)
  return (
    <ListStyle value="insetGrouped">
    <Screen heading="Notifications" action={<Show when={shown().length}><More /></Show>}>
      <Show when={props.inbox.push}>{(push) => <PushState push={push()} settings={props.inbox.settings} again={() => refresh(inboxAnswer)} />}</Show>
      <Section>
        <Show when={shown().length} fallback={<Empty>No notifications.</Empty>}>
          <List each={shown()} keyed={(notification) => String(notification.id)}>
            {(notification) => {
              let last = notification()
              const item = () => (last = notification() ?? last)
              return (
                <Row
                  start={<View style={[look.dot, !item().read && look.blue]} />}
                  heading={<Text style={!item().read && look.unread}>{item().title}</Text>}
                  text={[item().from, item().text].filter(Boolean).join(" · ")}
                  end={
                    <>
                      {since(item().at, "narrow")}
                      <Menu.Root onSelect={(value) => value === "clear" && clearOne(item().id)}>
                        <Menu.Positioner>
                          <Menu.Content>
                            <Menu.Item value="clear" destructive>Clear</Menu.Item>
                          </Menu.Content>
                        </Menu.Positioner>
                      </Menu.Root>
                    </>
                  }
                  action={
                    !touch() ? (
                      <Button variant="ghost" size="icon" aria-label={`Clear ${item().title}`} onPress={() => clearOne(item().id)}>
                        <Icon name="x" />
                      </Button>
                    ) : undefined
                  }
                  onPress={() => tapped(item())}
                />
              )
            }}
          </List>
          <Show when={hasMore()}>
            <Button variant="outline" loading={loadingOlder()} onPress={() => loadOlder(shown().at(-1)!.id)}>
              Older
            </Button>
          </Show>
        </Show>
      </Section>
    </Screen>
    </ListStyle>
  )
}

render(
  () => (
    <Errored heading="Can't show your notifications" screen={{ heading: "Notifications" }}>
      <Loading fallback={<Screen heading="Notifications"><Spinner delay /></Screen>}>
        <Inbox inbox={inbox()} />
      </Loading>
    </Errored>
  ),
)
