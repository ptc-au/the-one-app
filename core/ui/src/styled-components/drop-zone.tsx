// Where files from the computer's own are dropped: its look, over its headless component (createDropZone).
import { children, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Text, View } from "#primitives"
import { touch } from "#bridge"
import { createDropZone } from "../headless-components/drop-zone.ts"
import { Button, Icon } from "./button.tsx"
import { messages } from "../words.ts"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

const look = styles({
  zone: { position: "relative" },
  // Over what it holds while files are over it, hiding it: tinted, its edge dashed, and what dropping does in its
  // middle.
  over: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    borderRadius: tokens.radius.medium,
    backgroundColor: tokens.colour.background,
    pointerEvents: "none",
    opacity: { default: 1, entering: 0, exiting: 0 },
    transitionProperty: ["opacity"],
    transition: tokens.motion.quick,
  },
  tint: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.grid[2],
    borderWidth: tokens.grid[0.5],
    borderStyle: "dashed",
    borderColor: tokens.colour.blue,
    borderRadius: tokens.radius.medium,
    backgroundColor: tokens.colour.blueTint,
    color: tokens.colour.blue,
  },
  // With nothing in it: a dashed area, plainly where files go, with the picker's way in under its words.
  empty: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.grid[3],
    paddingBlock: tokens.grid[8],
    paddingInline: tokens.grid[4],
    borderWidth: tokens.grid[0.5],
    borderStyle: "dashed",
    borderColor: tokens.colour.quaternaryLabel,
    borderRadius: tokens.radius.medium,
    color: tokens.colour.secondaryLabel,
    textAlign: "center",
    transitionProperty: ["borderColor", "backgroundColor", "color"],
    transition: tokens.motion.quick,
  },
  dragging: { borderColor: tokens.colour.blue, backgroundColor: tokens.colour.blueTint, color: tokens.colour.blue },
  label: { font: tokens.type.medium, fontWeight: tokens.weight.medium },
})

/// `<DropZone accept={["image/*", ".pdf"]} multiple label="Drop receipts here" onDrop={add} />`: where files dragged
/// from the computer's own (a Finder's, an Explorer's, a browser's desktop) are dropped, as a web app's drop zone
/// (react-dropzone's) takes them: while they're over it, it's tinted and says "Drop to add", and dropped, `onDrop` is
/// told those of `accept`'s kinds (as `pickFiles` takes them: `.pdf`, `image/*`), one unless `multiple`, as `File`s.
/// Around `children` (`<DropZone onDrop={add}><List>…</List></DropZone>`), it's only them until files come over; with
/// none, it's the empty state: a dashed area saying `label` ("Drop files here" unless said), with Choose Files…, the
/// device's picker. On a phone, where nothing is dragged in, it's its content, and the empty state is its Choose Files.
export function DropZone(props: { onDrop: (files: File[]) => void; accept?: string[]; multiple?: boolean; label?: string; children?: JSX.Element }) {
  const zone = createDropZone(props)
  // What it holds, made once.
  const inside = children(() => props.children)
  return (
    <Show
      when={inside.toArray().length > 0}
      fallback={
        <View {...zone.root()} style={[look.empty, zone.dragging() && look.dragging]}>
          <Icon name="file-arrow-up" large />
          <Show when={!touch()}>
            <Text style={look.label}>{zone.dragging() ? messages.dropToAdd : (props.label ?? messages.dropFiles)}</Text>
          </Show>
          <Button variant="outline" onPress={zone.open}>
            {messages.chooseFiles}
          </Button>
        </View>
      }
    >
      <View {...zone.root()} style={look.zone}>
        {inside()}
        <Show when={zone.dragging()}>
          <View style={look.over}>
            <View style={look.tint}>
              <Icon name="file-arrow-up" large />
              <Text style={look.label}>{messages.dropToAdd}</Text>
            </View>
          </View>
        </Show>
      </View>
    </Show>
  )
}
