---
name: google-chat
description: Read before reading or sending Google Chat messages, reacting in a space, or watching a space for what happens in it.
metadata:
  title: "Google Chat"
  subtitle: "Your Chat spaces, and what happens in them"
  about: "Reads your Google Chat spaces and messages, posts and changes what your Chat app says, reacts as you, and watches a space so its messages and reactions reach your AI and your agents."
  category: Connectors
---

Google Chat reaches a space two ways. As your **Chat app**, with a service account's key, it posts, edits
and deletes the app's own messages. As **you**, through the Google account signed in to `google-account`, it reads
your spaces and messages, reacts, and watches a space with Google Workspace Events.

## Set it up once

1. In a Google Cloud project, turn on the **Google Chat API** and the **Google Workspace Events API**, and create a
   service account with a **JSON key**. Download that key file.
2. Put the key in the Vault, switched on for Google Chat: `vault_save_from_browser` takes the file the browser
   downloaded, or `vault_request` with `app: "google-chat"`, the title **Google Chat** and the field
   `service_account_json` asks the person to add it on their own device. Google Chat never asks for the key in chat.
3. Create a Pub/Sub topic, `projects/<project>/topics/<topic>`, and a **push subscription** to it whose endpoint is
   your network's address plus the `webhook_path` that `configure` answers. Give
   `chat-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher** role on the topic.
4. Call `configure` with the topic and, if you have more than one, the `account` to act as. It makes the webhook's
   secret and answers the path Google needs.
5. To have the app itself mentioned in a space come straight to it, set the Chat app's connection settings to an
   **HTTP endpoint URL** at that same `webhook_path`.

The Chat app must be a member of a space to post in it. `google-account_sign_in` grants the scopes it needs; if the
account was signed in before this app was installed, sign it in again.

## Tools

- `spaces` lists the spaces you're in, and `messages` recent messages in one, newest first, as you. Their names,
  like `spaces/AAAA` and `spaces/AAAA/messages/BBBB`, are what every other tool takes.
- `send` posts in a space as the Chat app, in a thread if you give one: only when the person asked you to send.
  `edit` and `delete` change only the app's own messages.
- `react` adds an emoji to a message as you, or takes off the reaction whose name you give. A reaction's name comes
  from a `reaction_created` event.
- `watch_space` subscribes a space to Google's events, and `unwatch_space` stops it. `status` says what's watched
  and when each subscription ends; `renew_subscriptions` extends them, as it does every half hour by itself. Google
  lets one last four hours at most with messages in its events.

## What happens in a watched space

Other apps follow it by hooking into `google-chat.message_created`, `message_updated`, `message_deleted`,
`reaction_created`, `reaction_deleted` and `mentioned`, or by subscribing to the events of the same names. Each says
the space, thread and message, what it says, who did it (`sender`, `sender_name` and `sender_type`, `HUMAN` or
`BOT`), the reaction's `emoji` and name, and the message's `create_time`. `mentioned` is the Chat app being
mentioned, or sent a direct message.
