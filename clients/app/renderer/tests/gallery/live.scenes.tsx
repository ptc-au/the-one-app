import type { JSX } from "@solidjs/web"
import { type Scenes, type ScreenInputs, Screen, Section, Steps, LiveScreen } from "ui"

/** A network with no TURN key: its screen's stream says so. */
const unkeyed = async ({ action }: ScreenInputs) => {
  if (action === "stream") throw new Error("Live video needs a Cloudflare TURN key, which the network's owners add in the Vault and switch on for WebRTC.")
  return { done: action }
}

/** A network whose key Cloudflare turned down. */
const refused = async ({ action }: ScreenInputs) => {
  if (action === "stream") throw new Error("Cloudflare refused the network's TURN key (401), so live video can't connect.\n\n" + '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}')
  return { done: action }
}

/** A live screen as an app draws it: in a screen's section, with the page's text under it. */
const inScreen = (screen: JSX.Element) => (
  <Screen heading="Profile">
    <Section heading="Updating">{screen}</Section>
  </Screen>
)

export default {
  "Live screen/No TURN key": {
    errors: ["Live video didn't connect: Live video needs a Cloudflare TURN key"],
    render: () => inScreen(<LiveScreen label="The desktop" screen={unkeyed} />),
  },
  "Live screen/Full": {
    errors: ["Live video didn't connect: Live video needs a Cloudflare TURN key"],
    taps: ["Full Screen"],
    render: () => inScreen(<LiveScreen label="The desktop" screen={unkeyed} />),
  },
  "Live screen/Key refused": {
    errors: ["Live video didn't connect: Cloudflare refused"],
    taps: ["Show Details"],
    render: () => inScreen(<LiveScreen label="The desktop" screen={refused} />),
  },
  "Live screen/Starting": () =>
    inScreen(
      <LiveScreen label="The browser">
        <Steps steps={["Getting a browser ready", "Opening Work"]} at={0} />
      </LiveScreen>,
    ),
  // The room a window gives: a chat column's, and a wide window's, where the view runs out beyond the readable column.
  "Live screen/Chat column": {
    alone: true,
    layout: "fullscreen",
    size: [728, 600],
    errors: ["Live video didn't connect: Live video needs a Cloudflare TURN key"],
    render: () => inScreen(<LiveScreen label="The desktop" screen={unkeyed} />),
  },
  "Live screen/Wide window": {
    alone: true,
    layout: "fullscreen",
    size: [1900, 1000],
    errors: ["Live video didn't connect: Live video needs a Cloudflare TURN key"],
    render: () => inScreen(<LiveScreen label="The desktop" screen={unkeyed} />),
  },
} satisfies Scenes
