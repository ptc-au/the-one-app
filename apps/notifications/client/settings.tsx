// Notifications, as Settings draws it: whether this phone or browser is woken by them, and each app that has told you
// something, which you hear from or not.
import { createProjection, Loading, refresh, Show } from "solid-js"
import { call, changed, client, Empty, Errored, List, Row, Screen, Section, Spinner, Switch, toast } from "ui"
import { type Push, PushState } from "./push.tsx"

/** An app that has told its person something, as `notifications_apps` answers it. */
interface App {
  app: string
  name: string
  allowed: boolean
}

const stateAnswer = createProjection(async (): Promise<{ apps: App[]; push?: Push; settings: boolean }> => {
  const [apps, { push, settings }]: [App[], { push?: Push; settings?: boolean }] = await Promise.all([call("notifications_apps").then((text) => JSON.parse(text).apps), client()])
  return { apps, push, settings: settings === true }
})
const state = () => stateAnswer
changed(() => refresh(stateAnswer))

async function allow(app: string, allow: boolean) {
  try {
    await call("notifications_allow", { app, allow })
  } catch (error) {
    toast(error as Error)
  }
  refresh(stateAnswer)
}

export default function NotificationSettings() {
  return (
    <Screen heading="Notifications" back>
      <Errored heading="Can't show your notifications">
        <Loading fallback={<Spinner delay />}>
          <Show when={state().push}>{(push) => <PushState push={push()} settings={state().settings} again={() => refresh(stateAnswer)} />}</Show>
          <Section heading="Allow Notifications">
            <Show when={state().apps.length} fallback={<Empty>No app has told you anything yet.</Empty>}>
              <List each={state().apps} keyed={(app) => app.app}>
                {(app) => <Row heading={app().name} end={<Switch aria-label={app().name} value={app().allowed} onValueChange={(on) => allow(app().app, on)} />} />}
              </List>
            </Show>
          </Section>
        </Loading>
      </Errored>
    </Screen>
  )
}
