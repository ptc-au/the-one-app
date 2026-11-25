// What only a person's own device may do (answering a request, giving an agent a key, their recovery key), where the page
// is drawn in an assistant's chat and the call it makes is the assistant's, which the network refuses: written once on
// the drawing primitives (#primitives), so every such action says so where its button is.
import { Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { renderSVG } from "uqr"
import { Image, Text, View } from "#primitives"
import { inChat, open } from "#bridge"
import { Button } from "./button.tsx"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

const look = styles({
  box: { alignSelf: "stretch", alignItems: "flex-start", gap: tokens.grid[3], padding: tokens.grid[3], borderRadius: tokens.radius.medium, backgroundColor: tokens.colour.orangeTint, color: tokens.colour.label, textAlign: "start" },
  words: { gap: tokens.grid[0.5] },
  said: { color: tokens.colour.secondaryLabel },
  beside: { flexDirection: "row", alignItems: "center", gap: tokens.grid[4], flexWrap: "wrap" },
  code: { width: tokens.grid[24], height: tokens.grid[24], borderRadius: tokens.radius.small },
})

/// `<OwnDevice what="Answering a request" link={`${network}/vault/request?id=${id}`}><Button>Allow</Button></OwnDevice>`:
/// what only its person's own device may do. Where the page is in a computer's or phone's own window, a browser, it's
/// its `children`, the action, as they are. In an assistant's chat (`inChat`), where every call the page makes is the
/// assistant's and the network refuses this, the action isn't there: it says `what` is theirs to do on their own device,
/// and gives the `link` that opens it there, in the One App or the browser, as a button and as a code a phone's camera reads.
export function OwnDevice(props: { what: string; link: string; children: JSX.Element }) {
  const code = () => `data:image/svg+xml,${encodeURIComponent(renderSVG(props.link, { border: 1 }))}`
  return (
    <Show when={inChat()} fallback={props.children}>
      <View role="group" aria-label={props.what} style={look.box}>
        <View style={look.words}>
          <Text>{`${props.what} is for you to do on your own device.`}</Text>
          <Text style={look.said}>Open this there, in the One App or your browser, or point a phone's camera at the code.</Text>
        </View>
        <View style={look.beside}>
          <Button variant="outline" onPress={() => open(props.link)}>Open</Button>
          <Image src={code()} alt={`A code that opens ${props.what.toLowerCase()} on your device`} style={look.code} />
        </View>
      </View>
    </Show>
  )
}
