// Settings: one place where every app brings its settings, laid out as Raycast's Settings: a sidebar with its search,
// whoever's looking (Sign In & Security under their name), the apps' sections in their groups, then every app they
// have, A to Z. What's chosen opens beside it on a computer and is pushed over it on a phone. A section is its app's
// component (`settings.sections`), drawn here if the app is trusted and by its page in a frame if it isn't, as the
// Vault draws an item type's. Updates and an app's page are Settings' own.
import { createMemo, createSignal, Errored, For, Loading, refresh, Show } from "solid-js"
import { Avatar, Badge, Button, call, changed, client, component, confirm, Empty, Frame, History, Image, List, ListStyle, navigate, Problem, render, Row, Screen, Search, Section, Spinner, Split, styles, Switch, Text, toast, tokens, toolInput, View, viewport } from "ui"

/** What an app adds to Settings, as `settings_sections` answers it. */
interface Added {
  id: string
  app: string
  title: string
  icon: string | null
  app_icon: string | null
  trusted: boolean
  component: string
  in: "settings" | "device" | "app"
  name: string | null
  group: "you" | "network" | "general" | "system" | null
  order: number
  count: number | null
  kinds: string[] | null
  service: boolean
  /** What this device must say of itself (a `client()` field that isn't `null`) for the section to be listed: where it has none, the section has nothing to show. */
  needs: string | null
}

/** Where an app's update is, as `apps` answers it. */
interface Update {
  state: string
  stage?: string | null
}

/** An app as Settings lists it: `settings_apps` with what `apps` says of it. */
interface App {
  name: string
  app: string
  for: string
  title: string
  icon: string | null
  removes: boolean
  state?: string
  trusted?: boolean | null
  update?: Update | null
  required_by?: string[]
}

/// What an update says to a person. Why one failed is for Telemetry and the agents (`apps`), never a person's screen.
const updateText = (update: Update) => (update.state === "failed" ? "This update can't be installed yet" : "Update ready")

/// Whether an app has an update to take: not one whose updates can't be checked (`unchecked`), as a private repo's
/// can't from servers that can't sign in there, which its page says instead.
const updating = (app: App) => !!app.update && app.update.state !== "unchecked"

/** What `services` answers that an app's page shows: where its services run, and what the machines that can't lack. */
interface Serving {
  names: Record<string, string | null>
  services: { app: string; service: string; called: string; servers: string[]; lacks: Record<string, string> }[]
}

/** What `builds` answers that Updates shows. */
interface Builds {
  devices: { device: string; build?: string; target?: string }[]
  latest: Record<string, { build: string }>
}

const json = <T,>(tool: string, inputs?: object, subject?: string): Promise<T> => call(tool, inputs, { subject }).then(JSON.parse)

const added = createMemo(async () => {
  const [{ sections }, here] = await Promise.all([json<{ sections: Added[] }>("settings_sections"), client()])
  return sections.filter((one) => !one.needs || (here as Record<string, unknown>)[one.needs] != null)
})
const apps = createMemo(async () => {
  const [{ apps: listed }, { apps: installed }] = await Promise.all([json<{ apps: App[] }>("settings_apps"), json<{ apps: App[] }>("apps")])
  return listed.map((app) => ({ ...installed.find((one) => one.name === app.name && one.for === app.for), ...app }))
})
/// Whoever's looking, as they named themselves, or nothing where Sign-In can't say.
const me = createMemo(() => json<{ people: { who: string; called: string | null }[] }>("sign-in_people").then(({ people }) => people[0], () => undefined))
changed(() => [added, apps, me].forEach(refresh))

/// Where a client reads an icon a tool gave as `ui://<app>/<code>/<path>`: beside this page's own files.
const src = (icon: string) => icon.replace(/^ui:\/\/([^/]+)\/([^/]+)\//, "../../$1@$2/")

const look = styles({
  icon: { width: tokens.length.sidebarIcon, height: tokens.length.sidebarIcon },
  /// A group's heading in another section's page: its app's icon and name.
  heading: { flexDirection: "row", alignItems: "center", gap: tokens.grid[2] },
  small: { width: tokens.grid[4], height: tokens.grid[4] },
  /// Why an app can't be removed, under Remove App.
  why: { font: tokens.type.small, color: tokens.colour.secondaryLabel, paddingInline: tokens.grid[3] },
  muted: { color: tokens.colour.secondaryLabel },
  personName: { fontWeight: tokens.weight.semibold },
  readable: { gap: tokens.length.gutter, maxWidth: tokens.length.readable },
})

/// What's open beside the sidebar, by its id: a section's (`<app>/<component>`), `updates`, or an app's page
/// (`app:<for>:<name>`), as the screen shown says it, a tool and its arguments (`toolInput`): `settings_section
/// { app: "sign-in", section: "devices" }` at /settings/sign-in/devices, `settings_updates`, `settings_app { name }`.
/// The section's own arguments are the section's (Vault's `request`).
const open = () => {
  const { name, arguments: inputs } = toolInput("settings_sections")
  if (name === "settings_updates") return "updates"
  if (name === "settings_app") {
    const app = apps().find((one) => one.name === inputs.name && (inputs.for === undefined || one.for === inputs.for))
    return app ? `app:${app.for}:${app.name}` : undefined
  }
  if (name !== "settings_section") return undefined
  if (inputs.section) return `${inputs.app}/${inputs.section}`
  const theirs = sidebar(added()).filter((one) => one.app === inputs.app)
  return (theirs.find((one) => one.group !== "you") ?? theirs[0])?.id
}
/// What a section's own screen says beyond which it is: `settings_section`'s other arguments (`device` in
/// `settings_section { app: "sign-in", section: "devices", device: "mac" }`, at /settings/sign-in/devices?device=mac).
const sectionInputs = () => {
  const { name, arguments: { app, section, ...inputs } } = toolInput("settings_sections")
  return name === "settings_section" ? inputs : {}
}
/// Shows what an id names beside the sidebar, as a step Back goes back from, or the sidebar alone.
function setOpen(id?: string) {
  if (!id) return navigate("settings_sections")
  if (id === "updates") return navigate("settings_updates")
  const [kind, owner, name] = id.split(":")
  if (kind === "app") return navigate("settings_app", { name, for: owner })
  const [app, ...section] = id.split("/")
  navigate("settings_section", { app, section: section.join("/") })
}

/// Whether what's open sits beside the sidebar, where the first section shows until another is chosen.
const beside = () => viewport().width >= 768

/// The sidebar's groups, in order: whoever's looking, then the three the apps' sections are in.
const groups = ["you", "network", "general", "system"] as const
const sidebar = (all: Added[]) =>
  all.filter((one) => one.in === "settings").toSorted((a, b) => groups.indexOf(a.group!) - groups.indexOf(b.group!) || a.order - b.order)

function Tile(props: { icon: string | null; small?: boolean }) {
  return <Show when={props.icon}>{(icon) => <Image src={src(icon())} alt="" style={props.small ? look.small : look.icon} />}</Show>
}

/// What the ? in the sidebar's bar says.
const tips = [
  { title: "Find a setting fast", body: "Type a few letters in Search to find a setting or an app." },
  { title: "Every app has a page", body: "Open an app under Apps to see who has it, update it or remove it." },
  { title: "Updates in one place", body: "Updates shows when this device or an app has a new version ready." },
]

/// The sidebar: search, whoever's looking, the apps' sections by group, then every app A to Z.
function Sidebar(props: { shown?: string }) {
  const [words, setWords] = createSignal("")
  const wanted = (name: string) => name.toLowerCase().includes(words().trim().toLowerCase())
  const of = (group: Added["group"]) => sidebar(added()).filter((one) => one.group === group && wanted(one.name!))
  const person = () => sidebar(added()).find((one) => one.group === "you")
  const choose = (id: string) => choosing(id)
  const row = (section: () => Added) => (
    <Row
      start={<Tile icon={section().icon ?? section().app_icon} />}
      heading={section().name!}
      text={words() ? "Settings" : undefined}
      end={<Show when={section().count}><Badge variant="destructive">{section().count}</Badge></Show>}
      current={props.shown === section().id}
      onPress={() => choose(section().id)}
    />
  )
  const own = () => wanted("Updates")
  // What a search found: sections, Updates or apps.
  const found = () => groups.slice(1).some((group) => of(group).length) || own() || apps().some((app) => wanted(app.title))
  return (
    <Screen heading="Settings" tips={tips}>
      <Search placeholder="Search settings…" aria-label="Search Settings" value={words()} onChangeText={setWords} />
      <Show when={person() && !words()}>
        <List>
          <Row
            start={<Show when={me()}>{(you) => <Avatar subject={you().who} name={you().called ?? undefined} />}</Show>}
            heading={<Text style={look.personName}>{me()?.called ?? "You"}</Text>}
            text={person()!.name!}
            current={props.shown === person()!.id}
            onPress={() => choose(person()!.id)}
          />
        </List>
      </Show>
      <For each={groups.slice(1)}>
        {(group) => (
          <Show when={of(group).length || (group === "system" && own())}>
            <List>
              <For each={of(group)} keyed={(one) => one.id}>{row}</For>
              <Show when={group === "system" && own()}>
                <Row start={<Image src="updates.svg" alt="" style={look.icon} />} heading="Updates" current={props.shown === "updates"} onPress={() => choose("updates")} />
              </Show>
            </List>
          </Show>
        )}
      </For>
      <Show when={words().trim() && !found()}>
        <Empty>{`No Results for "${words().trim()}"`}</Empty>
      </Show>
      <Show when={apps().filter((app) => wanted(app.title)).length}>
        <Section heading="Apps">
          <List each={apps().filter((app) => wanted(app.title))} keyed={(app) => `${app.for}:${app.name}`}>
            {(app) => (
              <Row
                start={<Tile icon={app().icon} />}
                heading={app().title}
                text={words() ? "App" : undefined}
                end={<Show when={updating(app())}><Badge variant="secondary">Update</Badge></Show>}
                current={props.shown === `app:${app().for}:${app().name}`}
                onPress={() => choose(`app:${app().for}:${app().name}`)}
              />
            )}
          </List>
        </Section>
      </Show>
    </Screen>
  )
}

/// What's open: a section of an app's, Updates, or an app's page.
function Detail(props: { id: string }) {
  // The same section while what draws it is: `added` asked again, as it is whenever anything changes, gives new
  // objects, and a new one would draw the section from scratch, losing what's open in it (a live screen's stream).
  const section = createMemo(() => added().find((one) => one.id === props.id && one.in === "settings"), {
    equals: (a, b) => a?.id === b?.id && a?.app === b?.app && a?.component === b?.component && a?.name === b?.name && a?.title === b?.title,
  })
  // The same page while it's the same app: `apps` asked again gives new objects, and a page keyed on one would be drawn
  // from scratch on every change, flashing it. `AppPage` reads `apps` again itself, so what changed in it still shows.
  const identity = createMemo(() => {
    const one = apps().find((one) => props.id === `app:${one.for}:${one.name}`)
    return one && `${one.for}:${one.name}`
  })
  return (
    <Show when={section()} keyed fallback={<Show when={props.id === "updates"} fallback={<Show when={identity()} keyed>{(identity) => <AppPage identity={identity} />}</Show>}><Updates /></Show>}>
      {(section) => <Drawn section={section} />}
    </Show>
  )
}

/// A section, drawn by its app's own component in this page, with what Settings' page may do. It's given the groups
/// other apps add to the places it offers (`Groups`), the arguments its screen has beyond which it is (`inputs`), and
/// `show(inputs)` to go to another of its screens, a step Back goes back from, as `navigate` does for a page's.
function Drawn(props: { section: Added }) {
  const drawn = createMemo(() => component(props.section.app, props.section.component).then((module) => module.default))
  const heading = () => props.section.name ?? props.section.title
  return (
    <Errored fallback={(error) => <Screen heading={heading()} back><Problem heading={`Can't show ${heading()}`} text={error() as Error} /></Screen>}>
      <Loading fallback={<Screen heading={heading()} back><Spinner delay /></Screen>}>
        <Show when={drawn()} keyed>
          {(Drawn) => <Drawn groups={Groups} inputs={sectionInputs()} show={(inputs?: object, options?: { replace?: boolean }) => navigate("settings_section", { app: props.section.app, section: props.section.component, ...inputs }, options)} />}
        </Show>
      </Loading>
    </Errored>
  )
}

/// What other apps add to a place a section offers (`in`): each a group headed by its app's icon and name, drawn by
/// its app's component, given what the place is about (`device`), or where its app is untrusted, by its page for it
/// in a frame (`client/<component>.html`, the device after `#`), as tall as the page says it is. An app's own page has
/// only that app's.
function Groups(props: { in: Added["in"]; device?: string; kind?: string; server?: string; services?: string[]; app?: string }) {
  const fits = (one: Added) =>
    props.in === "app" ? one.app === props.app : (!one.kinds || one.kinds.includes(props.kind!)) && (!one.service || !!props.services?.includes(one.app))
  const here = () => added().filter((one) => one.in === props.in && fits(one))
  return (
    <For each={here()} keyed={(one) => one.id}>
      {(one) => (
        <Section
          heading={
            <View style={look.heading}>
              <Tile icon={one().app_icon} small />
              <Text>{one().title}</Text>
            </View>
          }
        >
          <Show
            when={one().trusted}
            fallback={<Frame src={`${one().app}/client/${one().component}.html${props.device ? `#${props.device}` : ""}`} title={one().title} />}
          >
            <Group added={one()} device={props.device} server={props.server} />
          </Show>
        </Section>
      )}
    </For>
  )
}

function Group(props: { added: Added; device?: string; server?: string }) {
  // `added` asked again gives a new object for the same section: drawing it again for that returns a new promise, which
  // drops what's drawn for a spinner. Only a different app or component draws it anew.
  const app = createMemo(() => props.added.app)
  const comp = createMemo(() => props.added.component)
  const drawn = createMemo(() => component(app(), comp()).then((module) => module.default))
  return (
    <Errored fallback={(error) => <Problem heading={`Can't show ${props.added.title}`} text={error() as Error} />}>
      <Loading fallback={<Spinner delay />}>
        <Show when={drawn()} keyed>
          {(Drawn) => <Drawn device={props.device} server={props.server} />}
        </Show>
      </Loading>
    </Errored>
  )
}

/// Does something, saying why where it couldn't, and shows everything as it is after. → whether it was done.
async function doing(does: () => Promise<unknown>) {
  try {
    await does()
    return true
  } catch (error) {
    toast(error as Error)
    return false
  } finally {
    ;[added, apps].forEach(refresh)
  }
}

/// The apps with a newer version waiting, as Settings' Updates answers them (`settings_updates`).
const waiting = createMemo(() => json<{ apps: App[] }>("settings_updates"))
changed(() => refresh(waiting))

/// What's waiting to update: this device and each app with a newer version ready. The network's servers' is Software
/// Update's, at the top of Servers (Devices).
const updates = createMemo(async () => {
  const [mine, network, here] = await Promise.all([json<Builds>("builds"), json<Builds>("builds", {}, "network").catch(() => undefined), client()])
  const latest = { ...network?.latest, ...mine.latest }
  const target = mine.devices.find((device) => device.device === here.device)?.target
  const newest = target && latest[`one/${target}`]?.build
  return { behind: !!newest && newest !== here.build }
})

function Updates() {
  const [working, setWorking] = createSignal<string>()
  const press = (id: string, does: () => Promise<unknown>) => async () => {
    setWorking(id)
    await doing(does)
    ;[updates, waiting].forEach(refresh)
    setWorking()
  }
  const ready = () => waiting().apps
  return (
    <Screen heading="Updates" back>
      <Errored fallback={(error) => <Problem heading="Can't show what's waiting to update" text={error() as Error} />}>
        <Loading fallback={<Spinner delay />}>
          <List>
            <Row
              heading="This Device"
              text={updates().behind ? "Update ready" : "Up to date"}
              action={<Show when={updates().behind}><Button variant="outline" loading={working() === "here"} onPress={press("here", () => client({ update: true }).then(({ message }) => toast(message)))}>Update</Button></Show>}
            />
          </List>
          <Show when={ready().length}>
            <Section heading="Apps">
              <List each={ready()} keyed={(app) => `${app.for}:${app.name}`}>
                {(app) => (
                  <Row
                    start={<Tile icon={app().icon} />}
                    heading={app().title}
                    text={updateText(app().update!)}
                    action={<Button variant="outline" loading={working() === app().name} onPress={press(app().name, () => call("apps_update", { name: app().name }, { subject: app().for }))}>Update</Button>}
                  />
                )}
              </List>
            </Section>
          </Show>
        </Loading>
      </Errored>
    </Screen>
  )
}

/// Who an app is installed for, as a person reads it.
const whose = (owner: string) => (owner === "network" ? "Everyone" : owner === me()?.who ? "You" : owner.split("/").pop()!)

/// Whether each app may notify whoever's looking, as Notifications keeps it, or nothing where it isn't installed.
/// Where services run, for whoever's looking and for the network, whose apps are theirs.
const serving = createMemo(() => Promise.all([json<Serving>("services"), json<Serving>("services", {}, "network")]).then(([mine, network]) => ({ mine, network }), () => undefined))
changed(() => refresh(serving))
const notifying = createMemo(() => json<{ apps: { app: string; allowed: boolean }[] }>("notifications_apps").then(({ apps }) => apps, () => undefined))

/// An app's page: who it's for, whether it's trusted, its notifications, its update, what it adds here, and Remove App.
function AppPage(props: { identity: string }) {
  const found = () => apps().find((one) => `${one.for}:${one.name}` === props.identity)
  // Where the app was just removed, `apps` has lost it a tick before this page closes: what it was until it does.
  let last = found()!
  const app = () => (last = found() ?? last)
  const [working, setWorking] = createSignal<string>()
  const allowed = () => notifying()?.find((one) => one.app === app().app)
  // Each of the app's services that runs somewhere or can't where it should, with its machines: running, or what each lacks.
  const services = () => {
    const of = app().for === "network" ? serving()?.network : serving()?.mine
    return (of?.services ?? [])
      .filter((one) => one.app === app().name && (one.servers.length || Object.keys(one.lacks).length))
      .map((one) => ({
        called: one.called,
        key: one.service,
        machines: [
          ...one.servers.map((key) => ({ key, machine: of?.names[key] ?? key, why: undefined as string | undefined })),
          ...Object.entries(one.lacks).map(([key, why]) => ({ key, machine: of?.names[key] ?? key, why })),
        ],
      }))
  }
  const trust = (trusted: boolean) => doing(() => call("apps_trust", { name: app().name, trusted }, { subject: app().for }))
  const allow = (allow: boolean) => doing(() => call("notifications_allow", { app: app().app, allow }).then(() => refresh(notifying)))
  const update = async () => {
    setWorking("update")
    await doing(() => call("apps_update", { name: app().name }, { subject: app().for }))
    setWorking()
  }
  const remove = async () => {
    const also = app().required_by ?? []
    const text = also.length
      ? `${also.join(", ")} ${also.length === 1 ? "needs" : "need"} it and will be removed too. They're in Recently Deleted for 30 days.`
      : "It's in Recently Deleted for 30 days, with what it kept."
    if (!(await confirm({ heading: `Remove ${app().title}?`, text, action: "Remove", destructive: true }))) return
    if (await doing(() => call("uninstall", { name: app().name, confirm: also.length > 0 }, { subject: app().for }))) setOpen()
  }
  return (
    <Screen heading={app().title} back>
      <List>
        <Row heading="Installed For" end={<Text>{whose(app().for)}</Text>} />
        <Show when={app().trusted != null}>
          <Row
            heading="Trusted"
            text={app().trusted ? "Runs on your servers, with everything you can reach." : "Runs in a sandbox, with only what it's given."}
            end={<Switch aria-label="Trusted" value={!!app().trusted} disabled={!app().removes} onValueChange={trust} />}
          />
        </Show>
        <Show when={allowed()}>
          {(allowed) => <Row heading="Notifications" end={<Switch aria-label="Notifications" value={allowed().allowed} onValueChange={allow} />} />}
        </Show>
        <Show when={app().update?.state === "unchecked"}>
          <Row heading="Updates aren't checked" text="Your network's servers can't read where it's from." />
        </Show>
        <Show when={updating(app())}>
          <Row heading="Update ready" text={app().update!.state === "failed" ? updateText(app().update!) : undefined} action={<Button variant="outline" loading={working() === "update"} onPress={update}>Update</Button>} />
        </Show>
      </List>
      <For each={services()} keyed={(one) => one.key}>
        {(service) => (
          <Section heading={service().called}>
            <List each={service().machines} keyed={(machine) => machine.key}>
              {(machine) => <Row heading={machine().machine} text={machine().why} end={<Text style={look.muted}>{machine().why ? "Can't run it" : "Running"}</Text>} />}
            </List>
          </Section>
        )}
      </For>
      <Groups in="app" app={app().name} />
      <List>
        <Row
          heading="Remove App…"
          text={app().removes ? "It's in Recently Deleted for 30 days, with what it kept." : `This is ${whose(app().for)}'s, and you're not one of its owners.`}
          destructive={app().removes}
          onPress={app().removes ? remove : undefined}
        />
      </List>
    </Screen>
  )
}

function Settings() {
  // Beside the sidebar, the first section shows until another is chosen, as Raycast's Settings opens on General.
  const shown = () => {
    const id = open()
    return id ? id : beside() ? (sidebar(added()).find((one) => one.group !== "you")?.id ?? "updates") : undefined
  }
  // Back and Forward go through what was open beside the sidebar, as macOS's System Settings' do.
  const [past, setPast] = createSignal<string[]>([])
  const [future, setFuture] = createSignal<string[]>([])
  const history = () => ({
    back: past().length ? () => (setFuture([shown()!, ...future()]), setOpen(past().at(-1)), setPast(past().slice(0, -1))) : undefined,
    forward: future().length ? () => (setPast([...past(), shown()!]), setOpen(future()[0]), setFuture(future().slice(1))) : undefined,
  })
  choosing = (id) => {
    if (id === shown()) return
    if (beside() && shown()) setPast([...past(), shown()!])
    setFuture([])
    setOpen(id)
  }
  // A section is a page of settings, its lists grouped cards, as Raycast's Settings and iOS's Settings draw them.
  return (
    <ListStyle value="sidebar">
    <Split
      open={!!open()}
      onClose={() => setOpen()}
      pick="Choose a section."
      detail={
        <ListStyle value="insetGrouped">
          <History value={beside() ? history() : null}>
            <Show when={shown()} keyed>{(id) => <Detail id={id} />}</Show>
          </History>
        </ListStyle>
      }
    >
      <Sidebar shown={shown()} />
    </Split>
    </ListStyle>
  )
}

/// Opens a section beside the sidebar, which Back then goes back from (`Settings`).
let choosing = (id: string) => void setOpen(id)

render(() => (
  <Errored fallback={(error, retry) => <Screen heading="Settings"><Problem heading="Can't show Settings" text={error() as Error} action={<Button onPress={() => ([added, apps].forEach(refresh), retry())}>Try Again</Button>} /></Screen>}>
    <Loading fallback={<Screen heading="Settings"><Spinner delay /></Screen>}>
      <Settings />
    </Loading>
  </Errored>
))
