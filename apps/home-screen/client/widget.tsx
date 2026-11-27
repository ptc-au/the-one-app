// An app's widget in an assistant's chat, under the call of the tool it's drawn from, as it is on a Home Screen page: at
// the size the call asked for or the widget's first, with its buttons and switches calling their tools, and asked again
// as its app says something changed, and as often as its layout says while it's shown. The assistant is told how tall it is.
import { createEffect, createProjection, Loading, onSettled, refresh, Show, untrack } from "solid-js"
import { call, changed, Errored, type Layout, render, sizeChanged, styles, toolInput, toolResult, View, visible, Widget } from "ui"
import { type Size } from "./types.ts"

/// A widget's size on a phone's Home Screen, in points, as the cells of its page have it.
const SIZES: Record<Size, [number, number]> = { "2x2": [170, 170], "4x2": [352, 170], "4x4": [352, 352] }

const looks = styles({
  box: (width: number, height: number) => ({ width, height, maxWidth: "100%", display: "grid" }),
})

/// Runs `then` every `every` seconds, while the page is shown.
function Refresh(props: { every?: number; then: () => void }) {
  createEffect(
    () => props.every,
    (every) => {
      if (!every) return
      const timer = setInterval(() => untrack(visible) && props.then(), every * 1000)
      return () => clearInterval(timer)
    },
  )
  return null
}

function Shown(props: { tool: string; name: string; size: Size }) {
  const layoutAnswer = createProjection(() => call(props.tool, { size: props.size }).then((answer): Layout & { refresh?: number } => JSON.parse(answer)))
  const layout = () => layoutAnswer
  const again = () => refresh(layoutAnswer)
  onSettled(() => changed(again))
  // The assistant's page is told a tool that changes something was called (`changed`), and asks again.
  const act = (name: string | undefined, inputs: Record<string, unknown>) => call(`${props.tool.split("_")[0]}_${name}`, inputs)
  createEffect(
    () => props.size,
    (size) => void sizeChanged({ height: SIZES[size][1] }),
  )
  return (
    <View style={looks.box(...SIZES[props.size])}>
      <Errored fallback={(error) => <Widget name={props.name} size={props.size} problem={String((error() as Error).message ?? error())} />}>
        <Loading fallback={<Widget name={props.name} size={props.size} />}>
          <Widget name={props.name} size={props.size} layout={layout()} onCall={act} />
          <Refresh every={layout().refresh} then={again} />
        </Loading>
      </Errored>
    </View>
  )
}

/// What the tool answered says which widget it is (`_meta.widget`), and the call, which size it was asked for.
function Page() {
  const widget = () => toolResult()?._meta?.widget as { name: string; sizes: Size[] } | undefined
  const asked = () => toolInput("home-screen_pages")
  const size = () => {
    const said = asked().arguments.size as Size | undefined
    return said && said in SIZES ? said : (widget()?.sizes[0] ?? "2x2")
  }
  return (
    <Show when={widget()}>
      {(widget) => <Shown tool={asked().name} name={widget().name} size={size()} />}
    </Show>
  )
}

render(() => <Page />)
