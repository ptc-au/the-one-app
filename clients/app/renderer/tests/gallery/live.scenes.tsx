import { type Scenes, type ScreenInputs, Steps, LiveScreen } from "ui"

/** A network with no TURN key: its screen's stream says so. */
const unkeyed = async ({ action }: ScreenInputs) => {
  if (action === "stream") throw new Error("Live video needs a Cloudflare TURN key, which the network's owners add in the Vault and switch on for WebRTC.")
  return { done: action }
}

/** A network whose key Cloudflare turned down. */
const refused = async ({ action }: ScreenInputs) => {
  if (action === "stream") throw new Error("Cloudflare refused the network's TURN key (401).")
  return { done: action }
}

export default {
  "Live screen/No TURN key": {
    errors: ["Live video didn't connect: Live video needs a Cloudflare TURN key"],
    render: () => <LiveScreen label="The desktop" screen={unkeyed} />,
  },
  "Live screen/Key refused": {
    errors: ["Live video didn't connect: Cloudflare refused"],
    render: () => <LiveScreen label="The desktop" screen={refused} />,
  },
  "Live screen/Starting": () => (
    <LiveScreen label="The browser">
      <Steps steps={["Getting a browser ready", "Opening Work"]} at={0} />
    </LiveScreen>
  ),
} satisfies Scenes
