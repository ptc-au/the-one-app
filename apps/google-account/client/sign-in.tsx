// Signing a Google account in, as a page: what `sign_in` answered (`toolResult`), or where a link opened it, a button that
// starts one. Google can't be signed in to in a frame, so the person's own browser does it (`ServiceSignIn`).
import { createSignal, Show } from "solid-js"
import { Button, call, open, render, Screen, ServiceSignIn, toolInput, toolResult } from "ui"

function Start() {
  const [started, setUrl] = createSignal<string>()
  const url = () => started() ?? (toolResult()?.structuredContent as { url?: string } | undefined)?.url
  const [starting, setStarting] = createSignal(false)
  const start = async () => {
    setStarting(true)
    try {
      const { url } = JSON.parse(await call("google-account_sign_in", toolInput("google-account_sign_in").arguments)) as { url: string }
      setUrl(url)
      await open(url)
    } finally {
      setStarting(false)
    }
  }
  return (
    <Screen heading="Google account">
      <Show when={url()} fallback={<Button loading={starting()} onPress={start}>Sign in with Google</Button>} keyed>
        {(url) => <ServiceSignIn url={url} />}
      </Show>
    </Screen>
  )
}

render(() => <Start />)
