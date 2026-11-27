// What this browser's client says when its network can't be reached, as `Connection::banner` and `UNANSWERED` in core/client say
// it: over the window's page (`banner`), and as what a call that couldn't be made throws, beside what to do.
export const OFFLINE = "Can't reach your network"
export const UNANSWERED = `${OFFLINE}. Check this device is online.`
