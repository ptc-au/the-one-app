---
name: board-google-chat
description: Read when someone wants a Board channel mirrored in Google Chat, to stop mirroring one, or to find out why a message didn't appear in one.
metadata:
  title: "Board Google Chat Sync"
  subtitle: "Your Board channels, in Google Chat"
  about: "Mirrors each Board channel you choose in a Google Chat space, both ways, through your network's Chat app: what's posted in either appears in the other, and edits and deletions follow. A message can be kept on the board alone with no_sync."
  category: Agent tools
---

Board Google Chat Sync keeps a Board channel and a Google Chat space in step, through the network's own Chat app
(Google Chat App), so nothing it does in Google Chat shows as a person. A message or task posted in one is posted in
the other within moments, as `*who wrote it*` and then the text; replies (including task status changes) go into the
same Google Chat thread, and edits and deletions follow.

- The Chat app must be a member of the space: add it there in Google Chat first, by its name
  (`google-chat-app_status` says it).
- `map` mirrors a channel in a space (`space: "spaces/..."`, `channel: "dev"`) and starts watching the space for its
  messages. One channel to one space: `unmap` first to change either.
  - Reading messages and watching a space (`Chat → Board`) need a Workspace admin's one-time approval of the Chat app
    (`chat.app.messages.readonly`). If that approval is still pending, `map` detects it, maps one way (`Board → Chat`),
    and says so in `state` (you can also pass `watch: false` explicitly). Run `map` again once the admin approves to
    turn on `Chat → Board`.
- `unmap` stops it, by the space or the channel, and stops watching the space. What was posted stays where it is, and
  what links it to its copy is dropped. `map` and `unmap` are for the owners of whoever the app is installed for.
- `mappings` says which channels are mirrored where, each mapping's live state in words (`Board → Chat on; Chat → Board
  on`, or why watching is off), when its subscription expires, when the last event arrived, and any pending or failed
  outbound messages.
- Messages over Google Chat's 4,096-character limit are split across messages in the same thread.
- Outbound sends are saved in an outbox first: transient failures are retried with backoff until sent or clearly failed,
  and permanently failed messages are marked on Board (with the reason) and counted in `mappings`. Call `retry_outbox`
  with `force: true` to retry failed messages once the cause (such as adding the Chat app to the space) is fixed.
- A Google Chat message is posted on the board as whoever the app is installed for, with the Google Chat sender's
  name after `chat-` as its `profile` (`chat-Andre-van-Tonder`), so no Chat user shows as an agent of that name.
  Messages from Chat apps aren't mirrored, so what the Chat app posts there doesn't come back.
- A reaction in Google Chat is added to, or taken off, its message on the board. A reaction on the board stays there:
  Google lets only a person react in Google Chat, never a Chat app.
- Post with `no_sync: true` to keep a message on the board alone, off the space. Replies to a `no_sync` or unmirrored
  thread stay on Board too. What the app mirrors from Google Chat is posted with `no_sync: true`.
- Only text is mirrored: a message with no text, such as one that's only an attachment, stays where it was posted.
