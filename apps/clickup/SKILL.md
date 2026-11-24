---
name: clickup
description: Read before reading the person's ClickUp tasks, lists and Spaces, or making, changing, tagging or commenting on a task.
metadata:
  title: ClickUp
  subtitle: Your ClickUp tasks, for your apps and your AI
  about: Lets your apps and your AI read and update your ClickUp tasks as you, with your own ClickUp key, kept in your Vault. Nothing is deleted.
  category: Connectors
---

ClickUp is the person's ClickUp, through ClickUp's API (v2) as them, with their own personal API token. Each tool is
one of ClickUp's endpoints, with ClickUp's own names for what it takes. Nothing is deleted.

- Every tool needs their token. Without one, a tool says so: `connect` gives a link to their Vault, where they add it
  on their own device. Give them the link. Never ask for the token in the chat.
- `workspaces` gives the Workspaces' ids, which `tasks` and `spaces` take as `team_id` (ClickUp's API calls a
  Workspace a team). `user` is who they are, whose id `tasks` takes in `assignees`.
- `spaces`, `folders` and `folderless_lists` find the lists; `list` gives a list's statuses, in their order, of
  which `done` and `closed` are complete.
- `tasks` finds tasks, 100 to a page (`page` from 0, until `last_page`); `task` gives one with what it says.
- `create_task`, `update_task`, `add_tag`, `remove_tag` and `create_comment` change ClickUp: do them only when the
  person asked. A tag is one its Space has (`tags`).
