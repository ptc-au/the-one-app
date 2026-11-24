// GitHub Sync's group in its page in Settings: which GitHub repos sync with the network, and when each last did.
import { createMemo, Errored, For, Loading, refresh, Show } from "solid-js"
import { call, changed, List, Problem, Row, since, Spinner } from "ui"

/** What `github-sync_repos` answers. */
interface Synced {
  app: string | null
  org: string | null
  repos: { github: string; repo: string; synced: number | null; error: string | null }[]
}

export default function Repos() {
  const synced = createMemo(async (): Promise<Synced> => JSON.parse(await call("github-sync_repos", {})))
  changed(() => refresh(synced))
  const text = (repo: Synced["repos"][number]) =>
    repo.error ? `Couldn't sync: ${repo.error}` : repo.synced ? `Synced ${since(repo.synced)}` : "Not synced yet"
  return (
    <Errored fallback={(error) => <Problem heading="Can't say what syncs" text={error() as Error} />}>
      <Loading fallback={<Spinner delay />}>
        <List>
          <Show when={synced().app} fallback={<Row heading="Not connected to GitHub" text="The network's owner connects its GitHub App." />}>
            <Row heading="GitHub" text={`Every repo it's installed on in ${synced().org} syncs.`} />
            <For each={synced().repos}>{(repo) => <Row heading={repo.github} text={text(repo)} />}</For>
          </Show>
        </List>
      </Loading>
    </Errored>
  )
}
