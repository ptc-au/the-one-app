// Stepper: where someone is in a flow of a few steps, as MUI's Stepper and MobileStepper show it. Written once on the
// drawing primitives (#primitives), the same on every host.
import { Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Path, Svg, Text, View } from "#primitives"
import { messages } from "../words.ts"
import { styles } from "../styles.ts"
import { tokens } from "../tokens.ts"

const look = styles({
  // A row of the steps' names, as macOS's installer and Stripe's onboarding list theirs, wrapping where it's narrow.
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: tokens.grid[2], rowGap: tokens.grid[1], font: tokens.type.small },
  step: { flexDirection: "row", alignItems: "center", gap: tokens.grid[1], color: tokens.colour.secondaryLabel },
  now: { color: tokens.colour.label, fontWeight: tokens.weight.semibold },
  name: { whiteSpace: "nowrap" },
  tick: { width: tokens.grid[3], height: tokens.grid[3] },
  tickLine: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
  // Between two steps, a short rule, as MUI's connector.
  rule: { width: tokens.grid[4], height: tokens.length.hairline, backgroundColor: tokens.colour.quaternaryLabel },
  // The dots, as iOS's page control and MobileStepper's: the step now a capsule, those done lit, those to come faint.
  dots: { alignItems: "center", gap: tokens.grid[1.5] },
  dotRow: { flexDirection: "row", alignItems: "center", gap: tokens.grid[1.5] },
  dot: { width: tokens.grid[1.5], height: tokens.grid[1.5], borderRadius: tokens.radius.full, backgroundColor: tokens.colour.quaternaryLabel },
  dotDone: { backgroundColor: tokens.colour.secondaryLabel },
  dotNow: { width: tokens.grid[5], backgroundColor: tokens.colour.label },
  count: { font: tokens.type.small, fontWeight: tokens.weight.medium, color: tokens.colour.secondaryLabel },
})

/// `<Stepper steps={["Welcome", "Connect your AI", "Open from anywhere"]} at={1} />`: where someone is in a flow they go
/// through, as onboarding's steps: those before `at` done, each with a tick, `at` bold, and the rest to come, in a row,
/// as MUI's Stepper. `dots` is a phone's, as MobileStepper's `variant="dots"`: a dot each, the one now longer, over
/// "Step 2 of 3", for a screen whose own title names its step. (`Steps` is something starting, as it goes by itself.)
export function Stepper(props: { steps: JSX.Element[]; at: number; dots?: boolean }) {
  const label = (step: JSX.Element, i: number) => (i < props.at ? messages.stepDone(String(step)) : String(step))
  return (
    <Show
      when={props.dots}
      fallback={
        <View role="list" aria-label={messages.progress} style={look.row}>
          {props.steps.map((step, i) => (
            <>
              <Show when={i > 0}>
                <View aria-hidden="true" style={look.rule} />
              </Show>
              <View role="listitem" aria-label={label(step, i)} aria-current={i === props.at ? "true" : undefined} style={[look.step, i === props.at && look.now]}>
                <Show when={i < props.at}>
                  <Svg viewBox="0 0 12 12" aria-hidden="true" style={look.tick}>
                    <Path d="M2.5 6.5 5 9l4.5-6" style={look.tickLine} />
                  </Svg>
                </Show>
                <Text style={look.name}>{step}</Text>
              </View>
            </>
          ))}
        </View>
      }
    >
      <View style={look.dots}>
        <View role="list" aria-label={messages.progress} style={look.dotRow}>
          {props.steps.map((step, i) => (
            <View role="listitem" aria-label={label(step, i)} aria-current={i === props.at ? "true" : undefined} style={[look.dot, i < props.at && look.dotDone, i === props.at && look.dotNow]} />
          ))}
        </View>
        <Text aria-hidden="true" style={look.count}>
          {messages.stepOf(props.at + 1, props.steps.length)}
        </Text>
      </View>
    </Show>
  )
}
