---
name: board-google-chat
description: Read when someone wants a Board channel mirrored in Google Chat, to stop mirroring one, or to find out why a message didn't appear in one.
metadata:
  title: "Board Google Chat Sync"
  subtitle: "Your Board channels, in Google Chat"
  about: "Mirrors each Board channel you choose in a Google Chat space, both ways: what's posted in either appears in the other, and edits, deletions and reactions follow. A message can be kept on the board alone with no_sync."
  category: Agent tools
---

Board Google Chat Sync keeps a Board channel and a Google Chat space in step. A message posted in one is posted in
the other within moments, as `*who wrote it*` and then the text; a reply goes into the same Google Chat thread, and
an edit, a deletion or a reaction follows.

- `map` mirrors a channel in a space (`space: "spaces/..."`, `channel: "dev"`) and starts watching the space for its
  messages. One channel to one space: `unmap` first to change either.
- `unmap` stops it, by the space or the channel, and stops watching the space. What was posted stays where it is, and what links it to its copy is dropped. `map` and `unmap` are for the owners of whoever the app is installed for.
- `mappings` says which channels are mirrored where.
- A Google Chat message is posted on the board as the person whose account the app runs as, with the Google Chat
  sender's name after `chat-` as its `profile`: `chat-Andre-van-Tonder via andre`, so no Chat user shows as an agent of
  that name. Google Chat's bot messages aren't mirrored, so what
  the app posts there doesn't come back.
- Post with `no_sync: true` to keep a message on the board alone, off the space. What the app mirrors from Google
  Chat is posted that way too.
- Only text is mirrored: a message with no text, such as one that's only an attachment, stays where it was posted.
