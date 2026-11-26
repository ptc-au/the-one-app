// Board: shared message board and task queue for people and agents. Channels and threads sit beside the open thread
// where there's room (`Split`), and push on a phone. Its screens are tools: the list `board_read { channel, state }` and a
// thread `board_thread { id }`, which keeps the list's filters beside it (`toolInput("board_read")`).
import { createEffect, createProjection, createSignal, Errored, For, Loading, refresh, Show } from "solid-js"
import {
  Badge,
  Button,
  call,
  changed,
  confirm,
  Empty,
  Field,
  Input,
  List,
  ListStyle,
  Menu,
  Metadata,
  navigate,
  Problem,
  render,
  Row,
  Screen,
  Section,
  Sheet,
  since,
  size,
  Spinner,
  Split,
  styles,
  Switch,
  Tabs,
  Text,
  Textarea,
  toast,
  tokens,
  toolInput,
  toolResult,
  View,
} from "ui"

interface ChannelInfo {
  channel: string
  threads: number
  ready: number
  claimed: number
  blocked: number
  last_at: string
}

interface SchemaBlock {
  schema: string
  version: number
  data: Record<string, unknown>
}

interface ReactionInfo {
  emoji: string
  glyph: string
  count: number
  by: string[]
}

interface AttachmentInfo {
  id: string
  name: string
  mime_type: string
  size: number
  created_at: string
}

interface TaskInfo {
  state: "waiting" | "ready" | "claimed" | "blocked" | "completed" | "failed" | "canceled"
  owner: string
  owner_display: string
  assigned_profile?: string | null
  epoch: number
  claimed_by?: string | null
  lease_until?: number | null
  block_kind?: string | null
  result?: string | null
  needs: string[]
  updated_at: string
}

interface BoardMessage {
  id: string
  channel: string
  root_id?: string | null
  reply_to?: string | null
  author: string
  profile?: string | null
  display_author: string
  body?: string
  blocks?: SchemaBlock[]
  labels?: Record<string, string>
  reactions?: ReactionInfo[]
  attachments?: AttachmentInfo[]
  revision: number
  deleted?: boolean
  created_at: string
  edited_at?: string | null
  reply_count?: number
  task?: TaskInfo | null
}

const look = styles({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: tokens.grid[1.5], paddingHorizontal: tokens.grid[4], paddingBottom: tokens.grid[2] },
  card: {
    backgroundColor: tokens.colour.card,
    borderRadius: tokens.radius.medium,
    padding: tokens.grid[4],
    gap: tokens.grid[2],
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: tokens.grid[2] },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: tokens.grid[1.5] },
  author: { fontWeight: tokens.weight.medium, color: tokens.colour.label },
  meta: { color: tokens.colour.secondaryLabel },
  body: { color: tokens.colour.label },
  deleted: { color: tokens.colour.secondaryLabel },
  schemaBox: {
    backgroundColor: tokens.colour.selection,
    borderRadius: tokens.radius.small,
    padding: tokens.grid[3],
    gap: tokens.grid[1],
  },
  schemaHead: { fontWeight: tokens.weight.medium, color: tokens.colour.secondaryLabel },
  mono: { fontFamily: tokens.font.mono, color: tokens.colour.label },
  composer: { gap: tokens.grid[2], paddingTop: tokens.grid[2] },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: tokens.grid[2] },
})

const screen = () => toolInput("board_read")
const route = () => screen().arguments as { id?: string; channel?: string; state?: string; body?: string }
/// The new post's form, over the list, filled in from `board_post`'s arguments; and the reply's, in the thread, from `board_reply`'s.
const composing = () => screen().name === "board_post"
const openId = () => (screen().name === "board_thread" || screen().name === "board_reply" ? route().id || "" : "")
const selectedChannel = () => route().channel || ""
const selectedState = () => route().state || ""

const goList = (opts: { channel?: string; state?: string; id?: string } = {}) => {
  const args: Record<string, string> = {}
  if (opts.channel) args.channel = opts.channel
  if (opts.state) args.state = opts.state
  if (opts.id) navigate("board_thread", { ...args, id: opts.id })
  else navigate("board_read", args)
}

// Under a call of `board_post` or `board_reply` that was answered, it's sent: its thread is shown, not its form again.
const sent = () => {
  if (!toolResult()) return undefined
  if (screen().name === "board_reply") return route().id
  if (screen().name === "board_post") return (toolResult()!.structuredContent as { id?: string } | undefined)?.id
}
createEffect(sent, (id) => void (id && goList({ id })))

const channelsAnswer = createProjection(async (): Promise<{ channels: ChannelInfo[] }> => {
  const res: { channels: ChannelInfo[] } = JSON.parse(await call("board_channels", {}))
  return res
})
const channelsData = () => channelsAnswer.channels

const threadsAnswer = createProjection(async (): Promise<{ threads: BoardMessage[] }> => {
  const args: Record<string, unknown> = { limit: 100 }
  if (selectedChannel()) args.channel = selectedChannel()
  if (selectedState()) args.state = selectedState()
  const res: { threads: BoardMessage[] } = JSON.parse(await call("board_read", args))
  return res
})
const threadsData = () => threadsAnswer.threads

const detailAnswer = createProjection(async (): Promise<{ value: { thread: BoardMessage; replies: BoardMessage[] } | null }> => {
  const id = openId()
  if (!id) return { value: null }
  const res: { thread: BoardMessage; replies: BoardMessage[] } = JSON.parse(await call("board_thread", { id }))
  return { value: res }
})
const detailData = () => detailAnswer.value

changed(() => {
  refresh(channelsAnswer)
  refresh(threadsAnswer)
  if (openId()) refresh(detailAnswer)
})

const FENCE_RE = /```json#[a-z][a-z0-9-]*@[1-9][0-9]*\r?\n[\s\S]*?```/g

function cleanBody(body?: string) {
  if (!body) return ""
  return body.replace(FENCE_RE, "").trim()
}

function firstLine(body?: string) {
  const cleaned = cleanBody(body)
  if (!cleaned) return "(Deleted)"
  const line = cleaned.split("\n").find((l) => l.trim().length > 0) || cleaned
  return line.replace(/^#+\s*/, "").slice(0, 96)
}

function stateTone(state: TaskInfo["state"]): "default" | "destructive" | "secondary" | "outline" {
  if (state === "blocked") return "default"
  if (state === "failed") return "destructive"
  if (state === "claimed") return "secondary"
  return "outline"
}

function stateLabel(task: TaskInfo, detailed = false) {
  if (detailed && task.state === "blocked" && task.block_kind) return `Blocked · ${task.block_kind}`
  if (task.state === "claimed") return "Active"
  if (task.state === "completed") return "Done"
  return task.state.charAt(0).toUpperCase() + task.state.slice(1)
}

async function runTool(tool: string, args: Record<string, unknown>) {
  try {
    await call(tool, args)
    refresh(channelsAnswer)
    refresh(threadsAnswer)
    if (openId()) refresh(detailAnswer)
    return true
  } catch (error) {
    toast(error as Error)
    return false
  }
}

function ComposeSheet() {
  const [channel, setChannel] = createSignal(selectedChannel() || "general")
  const [body, setBody] = createSignal("")
  const [asTask, setAsTask] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  // Each time it opens, it's as its arguments say.
  createEffect(composing, (open) => {
    if (!open) return
    setChannel(selectedChannel() || "general")
    setBody(route().body ?? "")
  })
  const close = () => goList({ channel: selectedChannel(), state: selectedState() })

  const submit = async () => {
    const ch = channel().trim()
    const text = body().trim()
    if (!ch || !text || busy()) return
    setBusy(true)
    try {
      const tool = asTask() ? "board_task_create" : "board_post"
      const created: { id: string } = JSON.parse(await call(tool, { channel: ch, body: text }))
      close()
      setBody("")
      refresh(channelsAnswer)
      refresh(threadsAnswer)
      goList({ channel: selectedChannel(), state: selectedState(), id: created.id })
    } catch (error) {
      toast(error as Error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet heading={asTask() ? "New Task" : "New Post"} open={composing()} onClose={close}>
      <Field label="Channel" hint="Lowercase path, e.g. dev or work/checkout.">
        <Input value={channel()} onChangeText={setChannel} autoCapitalize="none" autoCorrect={false} />
      </Field>
      <Field label="Message">
        <Textarea value={body()} onChangeText={setBody} placeholder={asTask() ? "Describe the task…" : "Write an update…"} />
      </Field>
      <List>
        <Row heading="Track as task" end={<Switch aria-label="Track as task" value={asTask()} onValueChange={setAsTask} />} />
      </List>
      <Button onPress={submit} disabled={busy() || !channel().trim() || !body().trim()}>
        {asTask() ? "Create Task" : "Post"}
      </Button>
    </Sheet>
  )
}

function SchemaCard(props: { block: SchemaBlock }) {
  const entries = () => Object.entries(props.block.data)
  return (
    <View style={look.schemaBox}>
      <Text style={look.schemaHead}>{`${props.block.schema}@${props.block.version}`}</Text>
      <For each={entries()}>
        {([k, v]) => (
          <View style={look.rowBetween}>
            <Text style={look.meta}>{k}</Text>
            <Text style={look.mono}>{typeof v === "string" ? v : JSON.stringify(v)}</Text>
          </View>
        )}
      </For>
    </View>
  )
}

function MessageCard(props: { msg: BoardMessage }) {
  const visibleLabels = () => Object.entries(props.msg.labels || {})
  const prose = () => cleanBody(props.msg.body)
  return (
    <View style={look.card}>
      <View style={look.rowBetween}>
        <Text style={look.author}>{props.msg.display_author}</Text>
        <Text style={look.meta}>{since(props.msg.created_at, "narrow")}</Text>
      </View>
      <Show when={!props.msg.deleted} fallback={<Text style={look.deleted}>Deleted</Text>}>
        <Show when={prose().length > 0}>
          <Text style={look.body}>{prose()}</Text>
        </Show>
        <Show when={(props.msg.blocks || []).length > 0}>
          <For each={props.msg.blocks}>{(block) => <SchemaCard block={block} />}</For>
        </Show>
        <Show when={(props.msg.attachments || []).length > 0}>
          <View style={look.rowWrap}>
            <For each={props.msg.attachments || []}>
              {(att) => <Badge variant="outline">{`${att.name} · ${size(att.size)}`}</Badge>}
            </For>
          </View>
        </Show>
        <Show when={visibleLabels().length > 0 || (props.msg.reactions || []).length > 0}>
          <View style={look.rowWrap}>
            <For each={visibleLabels()}>
              {([k, v]) => <Badge variant="secondary">{`${k}=${v}`}</Badge>}
            </For>
            <For each={props.msg.reactions || []}>
              {(r) => <Badge variant="secondary">{`${r.glyph} ${r.count}`}</Badge>}
            </For>
          </View>
        </Show>
      </Show>
    </View>
  )
}

function ThreadDetail(props: { id: string }) {
  const [replyText, setReplyText] = createSignal(screen().name === "board_reply" ? (route().body ?? "") : "")
  const [sending, setSending] = createSignal(false)

  const sendReply = async () => {
    const text = replyText().trim()
    if (!text || sending()) return
    setSending(true)
    if (await runTool("board_reply", { id: props.id, body: text })) {
      setReplyText("")
      // Its link was the reply filled in: it's sent now, and the thread is the screen.
      if (screen().name === "board_reply") goList({ channel: selectedChannel(), state: selectedState(), id: props.id })
    }
    setSending(false)
  }

  const cancelTask = async () => {
    const ok = await confirm({ heading: "Cancel task?", text: "Workers won't claim it unless it's reopened.", action: "Cancel Task", destructive: true })
    if (ok) await runTool("board_task_cancel", { id: props.id, reason: "Canceled from Board." })
  }

  return (
    <Errored fallback={(error) => <Screen heading="Thread"><Problem heading="Can't open thread" text={error() as Error} /></Screen>}>
      <Loading fallback={<Screen heading="Thread"><Spinner delay /></Screen>}>
        <Show when={detailData()}>
          {(data) => {
            const thread = () => data().thread
            const task = () => thread().task
            const actionButton = () => {
              const t = task()
              if (!t) return undefined
              if (t.state === "blocked") {
                return <Button onPress={() => runTool("board_task_unblock", { id: props.id })}>Unblock</Button>
              }
              if (t.state === "failed" || t.state === "canceled") {
                return <Button variant="secondary" onPress={() => runTool("board_task_reopen", { id: props.id })}>Reopen</Button>
              }
              if (t.state !== "completed") {
                return (
                  <Menu.Root onSelect={(v) => (v === "cancel" ? cancelTask() : runTool("board_task_complete", { id: props.id, result: "Completed." }))}>
                    <Menu.Trigger />
                    <Menu.Positioner>
                      <Menu.Content>
                        <Menu.Item value="complete">Mark Completed</Menu.Item>
                        <Menu.Separator />
                        <Menu.Item value="cancel" destructive>Cancel Task</Menu.Item>
                      </Menu.Content>
                    </Menu.Positioner>
                  </Menu.Root>
                )
              }
              return undefined
            }

            return (
              <Screen heading={`#${thread().channel}`} action={actionButton()}>
                <Show when={task()}>
                  {(t) => {
                    const rows = () =>
                      [
                        { title: "Status", text: stateLabel(t(), true) },
                        { title: "Owner", text: t().owner_display },
                        t().claimed_by ? { title: "Claimed by", text: t().claimed_by! } : null,
                        t().assigned_profile ? { title: "Assigned to", text: t().assigned_profile! } : null,
                        t().needs.length > 0 ? { title: "Needs", text: t().needs.join(", ") } : null,
                        t().result ? { title: "Result", text: t().result! } : null,
                      ].filter((r): r is { title: string; text: string } => r !== null)
                    return (
                      <Section heading="Task">
                        <Metadata>
                          {rows().map((r) => (
                            <Metadata.Label title={r.title} text={r.text} />
                          ))}
                        </Metadata>
                      </Section>
                    )
                  }}
                </Show>

                <Section heading="Thread">
                  <MessageCard msg={thread()} />
                  <For each={data().replies}>{(reply) => <MessageCard msg={reply} />}</For>
                  <View style={look.composer}>
                    <Textarea value={replyText()} onChangeText={setReplyText} placeholder="Reply in thread…" />
                    <View style={look.actions}>
                      <Button onPress={sendReply} disabled={sending() || !replyText().trim()}>Reply</Button>
                    </View>
                  </View>
                </Section>
              </Screen>
            )
          }}
        </Show>
      </Loading>
    </Errored>
  )
}

const STATES = [
  { value: "", label: "All" },
  { value: "blocked", label: "Blocked" },
  { value: "ready", label: "Ready" },
  { value: "claimed", label: "Active" },
  { value: "completed", label: "Done" },
]

function BoardApp() {
  const threads = () => threadsData()
  const channels = () => channelsData()
  const hasAny = () => channels().length > 0 || threads().length > 0 || selectedChannel() !== "" || selectedState() !== ""

  return (
    <ListStyle value="insetGrouped">
      <Split
        open={!!openId()}
        onClose={() => goList({ channel: selectedChannel(), state: selectedState() })}
        pick="Pick a thread to read it."
        detail={<Show when={openId()}>{(id) => <ThreadDetail id={id()} />}</Show>}
      >
        <Screen heading="Board" action={<Button onPress={() => navigate("board_post", selectedChannel() ? { channel: selectedChannel() } : {})}>New Post</Button>}>
          <Show when={hasAny()}>
            <Section>
              <Tabs.Root value={selectedState()} onValueChange={(v) => goList({ channel: selectedChannel(), state: v, id: openId() })}>
                <Tabs.List>
                  <For each={STATES}>
                    {(st) => <Tabs.Trigger value={st.value}>{st.label}</Tabs.Trigger>}
                  </For>
                </Tabs.List>
              </Tabs.Root>
            </Section>
          </Show>

          <Show when={channels().length > 1}>
            <View style={look.chips}>
              <Button variant={selectedChannel() === "" ? "secondary" : "ghost"} onPress={() => goList({ state: selectedState(), id: openId() })}>
                All channels
              </Button>
              <For each={channels()}>
                {(ch) => (
                  <Button
                    variant={selectedChannel() === ch.channel ? "secondary" : "ghost"}
                    onPress={() => goList({ channel: ch.channel, state: selectedState(), id: openId() })}
                  >
                    {`#${ch.channel}`}
                  </Button>
                )}
              </For>
            </View>
          </Show>

          <Section>
            <Show
              when={threads().length > 0}
              fallback={
                <Empty>
                  {hasAny() ? "No matching threads." : "No threads yet."}
                </Empty>
              }
            >
              <List each={threads()} keyed={(t) => t.id}>
                {(t) => {
                  const task = () => t().task
                  const subtitle = () =>
                    [
                      `#${t().channel}`,
                      t().display_author,
                      (t().reply_count || 0) > 0 ? `${t().reply_count} ${t().reply_count === 1 ? "reply" : "replies"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  return (
                    <Row
                      heading={firstLine(t().body)}
                      text={subtitle()}
                      current={openId() === t().id}
                      end={
                        task() ? (
                          <Badge variant={stateTone(task()!.state)}>{stateLabel(task()!)}</Badge>
                        ) : (
                          since(t().created_at, "narrow")
                        )
                      }
                      onPress={() => goList({ channel: selectedChannel(), state: selectedState(), id: t().id })}
                    />
                  )
                }}
              </List>
            </Show>
          </Section>
        </Screen>
      </Split>
      <ComposeSheet />
    </ListStyle>
  )
}

render(() => (
  <Errored fallback={(error) => <Screen heading="Board"><Problem heading="Can't open Board" text={error() as Error} /></Screen>}>
    <Loading fallback={<Screen heading="Board"><Spinner delay /></Screen>}>
      <BoardApp />
    </Loading>
  </Errored>
))
