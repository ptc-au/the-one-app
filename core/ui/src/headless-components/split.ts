// A list and what it opens pushed over it, with its state and no look: what's pushed is swiped back by a finger, as
// UINavigationController's interactive pop is, from its left edge or anywhere on it where nothing in it scrolls or
// drags across (iOS 26's content swipe). The host moves it as the finger does (`drag`): let go a third of the way
// across, or flicked so it would carry on past that, it closes; otherwise it springs back.
import { projected } from "../behavior-primitives/velocity.ts"
import type { Dragged } from "../types/ui.d.ts"

/** `{...createPop({ enabled: () => pushed() && touch(), onClose })}` on what's pushed over the list. Where it can't
 * be swiped, it has none of them, so it's nothing to a pointer or the keyboard. */
export function createPop(options: { enabled: () => boolean; onClose: () => void }) {
  const end = ({ offset, velocity, canceled, currentTarget }: Dragged) => {
    const width = currentTarget.getBoundingClientRect().width
    if (!canceled && Math.max(0, offset.x) + Math.max(0, projected(velocity.x / 1000)) > width / 3) options.onClose()
  }
  return {
    get drag() {
      return options.enabled() ? ("x" as const) : undefined
    },
    // It goes only toward the end, and not at all the other way, as a pushed screen does.
    get dragConstraints() {
      return options.enabled() ? { left: 0 } : undefined
    },
    get dragElastic() {
      return options.enabled() ? 0 : undefined
    },
    get onDragEnd() {
      return options.enabled() ? end : undefined
    },
  }
}
