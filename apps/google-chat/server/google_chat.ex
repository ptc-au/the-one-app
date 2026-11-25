defmodule GoogleChat do
  @moduledoc """
  Google Chat: your Chat spaces and what happens in them, through Google Chat's API.

  Two keys open it, and each does what only it can. A Chat app's service account, its JSON key in the Vault, posts,
  edits and deletes the app's own messages as the app (`chat.bot`). A Google account signed in to `google-account`,
  with the scopes this app asks, reads the person's spaces and messages, reacts as them, and watches a space with
  Google Workspace Events, whose events Google publishes to a Pub/Sub topic that pushes them to this app's webhook.

  What happens in a watched space is offered to other apps, as hooks and as events: a message posted, edited or
  deleted, a reaction added or taken off, and being mentioned. `renew_subscriptions` keeps the watches alive, since
  Google lets one last four hours at most with its events' data included, and runs every half hour.
  """
  @behaviour OneCore.App
  require Logger

  alias GoogleChat.{Api, Store}
  alias OneCore.{Call, Events}

  @item "Google Chat"

  # What Google says happened, as the hook and event it's followed by.
  @happened %{
    "google.workspace.chat.message.v1.created" => "message_created",
    "google.workspace.chat.message.v1.updated" => "message_updated",
    "google.workspace.chat.message.v1.deleted" => "message_deleted",
    "google.workspace.chat.reaction.v1.created" => "reaction_created",
    "google.workspace.chat.reaction.v1.deleted" => "reaction_deleted"
  }

  # What a Google account is signed in with, so these tools work: its spaces and their messages read, and its
  # reactions made and taken off.
  @scopes [
    "https://www.googleapis.com/auth/chat.messages.readonly",
    "https://www.googleapis.com/auth/chat.spaces.readonly",
    "https://www.googleapis.com/auth/chat.messages.reactions"
  ]

  @space ~r{\Aspaces/[A-Za-z0-9_-]+\z}
  @message ~r{\Aspaces/[A-Za-z0-9_-]+/messages/[A-Za-z0-9_.-]+\z}
  @reaction ~r{\Aspaces/[A-Za-z0-9_-]+/messages/[A-Za-z0-9_.-]+/reactions/[A-Za-z0-9_-]+\z}
  @thread ~r{\Aspaces/[A-Za-z0-9_-]+/threads/[A-Za-z0-9_.-]+\z}

  @impl true
  def icon, do: "icon.svg"

  # What it keeps is the network's, one for everyone: what it was set up with, the spaces it watches, and the events
  # it has handled.
  @impl true
  def own, do: :installed

  @impl true
  def requires do
    %{
      "core" => ">= 0.35.10",
      "database" => "to keep what it's set up with, the spaces it watches and the events it has handled",
      "vault" => "to read your Chat app's service account key",
      "google-account" => "to read your spaces and react as you"
    }
  end

  @impl true
  def hooks, do: ["google-account.scopes"]

  @impl true
  def hook("google-account.scopes", _about, _call), do: @scopes

  @impl true
  def jobs, do: [%{tool: "renew_subscriptions", every: 1800}]

  @impl true
  def offers do
    [
      %{name: "message_created", kind: :observe, description: "Someone posted a message in a watched space"},
      %{name: "message_updated", kind: :observe, description: "Someone edited a message in a watched space"},
      %{name: "message_deleted", kind: :observe, description: "Someone deleted a message in a watched space"},
      %{name: "reaction_created", kind: :observe, description: "Someone reacted to a message in a watched space"},
      %{name: "reaction_deleted", kind: :observe, description: "Someone took their reaction off a message in a watched space"},
      %{name: "mentioned", kind: :observe, description: "Someone mentioned your Chat app, or sent it a direct message"}
    ]
  end

  @impl true
  def events do
    for {name, description} <- [
          {"message_created", "A message was posted in a watched space."},
          {"message_updated", "A message was edited in a watched space."},
          {"message_deleted", "A message was deleted in a watched space."},
          {"reaction_created", "A reaction was added to a message in a watched space."},
          {"reaction_deleted", "A reaction was taken off a message in a watched space."},
          {"mentioned", "The Chat app was mentioned, or was sent a direct message."}
        ] do
      %{
        name: name,
        description: description,
        delivery: [:poll, :webhook],
        inputs: filter(),
        outputs: happened()
      }
    end
  end

  @impl true
  def tools do
    string = &%{type: "string", description: &1}
    nullable = &Map.update!(&1, :type, fn type -> [type, "null"] end)

    account =
      string.("Which account: its address, or a part of it only it has, as google-account_accounts lists them. The first if left out")

    space = string.("The space's name, like spaces/AAAA, from google-chat_spaces or the space's link")
    message = string.("The message's name, like spaces/AAAA/messages/BBBB, from google-chat_messages or an event")
    page_token = string.("The next page: the next_page_token the last page gave, with the same other inputs")

    page_size = %{
      type: "integer",
      description: "At most this many, 100 at most. 25 if left out"
    }

    subscription = %{
      type: "object",
      properties: %{
        space: space,
        subscription: string.("Its name at Google: subscriptions/DDDD"),
        expire_time: string.("When Google stops it, unless it's renewed: RFC 3339, in UTC")
      },
      required: ["space", "subscription", "expire_time"]
    }

    [
      %{
        name: "configure",
        description:
          "Sets Google Chat up: the Vault item that keeps your Chat app's service account key, the Pub/Sub topic its events come to, and the Google account that reads and watches spaces. The webhook_path it answers is where Google sends events: your network's address plus it",
        inputs: %{
          type: "object",
          properties: %{
            vault_item: string.("The Vault item that keeps the service account's JSON key. Google Chat if left out"),
            pubsub_topic: string.("Where Google publishes a watched space's events: projects/<project>/topics/<topic>. Empty takes it away"),
            account: string.("The Google account to read and watch spaces as: its address, or a part of it only it has. The first signed in if left out")
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            vault_item: string.("Where its key is kept"),
            pubsub_topic: nullable.(string.("Where Google publishes events")),
            account: nullable.(string.("The Google account it reads and watches as")),
            webhook_path: nullable.(string.("Where Google sends events, after your network's address: /webhooks/network/google-chat/<token>"))
          },
          required: ["vault_item", "pubsub_topic", "account", "webhook_path"]
        }
      },
      %{
        name: "status",
        read_only: true,
        description: "What Google Chat is set up with, and the spaces it watches, each with when its subscription expires. It never says a key or a token",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{
            vault_item: string.("The Vault item that keeps its key"),
            pubsub_topic: nullable.(string.("Where Google publishes events")),
            account: nullable.(string.("The Google account it reads and watches as")),
            webhook_path: nullable.(string.("Where Google sends events, after your network's address")),
            subscriptions: %{type: "array", items: subscription, description: "The spaces it watches"}
          },
          required: ["vault_item", "pubsub_topic", "account", "webhook_path", "subscriptions"]
        }
      },
      %{
        name: "spaces",
        read_only: true,
        description:
          "The Google Chat spaces you're a member of, as your Google account, each by the name its other tools take: spaces and direct messages too. Where there are more, next_page_token is the next page's page_token",
        inputs: %{
          type: "object",
          properties: %{account: account, page_size: page_size, page_token: page_token}
        },
        outputs: %{
          type: "object",
          properties: %{
            spaces: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  name: space,
                  display_name: nullable.(string.("Its name, as people read it")),
                  type: nullable.(string.("SPACE, GROUP_CHAT or DIRECT_MESSAGE"))
                },
                required: ["name", "display_name", "type"]
              }
            },
            next_page_token: nullable.(string.("The next page's page_token, if there are more"))
          },
          required: ["spaces", "next_page_token"]
        }
      },
      %{
        name: "messages",
        read_only: true,
        description:
          "Recent messages in a space, newest first, as your Google account: each with who sent it and what it says. Where there are more, next_page_token is the next page's page_token",
        inputs: %{
          type: "object",
          properties: %{space: space, account: account, page_size: page_size, page_token: page_token},
          required: ["space"]
        },
        outputs: %{
          type: "object",
          properties: %{
            messages: %{type: "array", items: message_event()},
            next_page_token: nullable.(string.("The next page's page_token, if there are more"))
          },
          required: ["messages", "next_page_token"]
        }
      },
      %{
        name: "send",
        description:
          "Posts a message in a space as your Chat app. In a thread with thread, or a new one. The app must be in the space. This posts a real message to real people: only what the person asked to send",
        inputs: %{
          type: "object",
          properties: %{
            space: space,
            text: string.("What it says, as plain text"),
            thread: string.("The thread to reply in, like spaces/AAAA/threads/BBBB, from google-chat_messages or an event. A new thread if left out")
          },
          required: ["space", "text"]
        },
        outputs: %{
          type: "object",
          properties: %{
            name: message,
            thread: nullable.(string.("The thread it's in")),
            text: string.("What it says"),
            create_time: string.("When it was sent: RFC 3339, in UTC")
          },
          required: ["name", "thread", "text", "create_time"]
        }
      },
      %{
        name: "edit",
        description: "Changes what one of your Chat app's messages says. Only a message the app posted",
        inputs: %{
          type: "object",
          properties: %{message: message, text: string.("What it now says, as plain text")},
          required: ["message", "text"]
        },
        outputs: %{
          type: "object",
          properties: %{name: message, text: string.("What it now says")},
          required: ["name", "text"]
        }
      },
      %{
        name: "delete",
        description: "Deletes one of your Chat app's messages for good. Only a message the app posted",
        inputs: %{type: "object", properties: %{message: message}, required: ["message"]},
        outputs: %{
          type: "object",
          properties: %{name: message, deleted: %{type: "boolean", description: "Whether Google deleted it"}},
          required: ["name", "deleted"]
        }
      },
      %{
        name: "react",
        description:
          "Reacts to a message with an emoji as your Google account, or with reaction, takes that reaction off. A reaction's name comes from a reaction event",
        inputs: %{
          type: "object",
          properties: %{
            message: message,
            emoji: string.("The emoji to react with, like 👍"),
            reaction: string.("The reaction to take off, like spaces/AAAA/messages/BBBB/reactions/CCCC. Give this, not emoji, to take one off"),
            account: account
          },
          required: ["message"]
        },
        outputs: %{
          type: "object",
          properties: %{
            name: nullable.(string.("The reaction's name: the one taken off, or the one made")),
            emoji: nullable.(string.("The emoji it is")),
            removed: %{type: "boolean", description: "Whether it was taken off, rather than made"}
          },
          required: ["name", "emoji", "removed"]
        }
      },
      %{
        name: "watch_space",
        description:
          "Watches a space for messages and reactions, so what happens there comes to Google Chat as its events and hooks. Needs a Pub/Sub topic from configure, and its push subscription pointed at webhook_path. A space it already watches is renewed instead",
        inputs: %{type: "object", properties: %{space: space}, required: ["space"]},
        outputs: %{
          type: "object",
          properties: %{
            space: space,
            subscription: string.("Its name at Google: subscriptions/DDDD"),
            expire_time: string.("When Google stops it, unless it's renewed: RFC 3339, in UTC")
          },
          required: ["space", "subscription", "expire_time"]
        }
      },
      %{
        name: "unwatch_space",
        description: "Stops watching a space, and stops its events. A space it isn't watching is nothing to stop",
        inputs: %{type: "object", properties: %{space: space}, required: ["space"]},
        outputs: %{
          type: "object",
          properties: %{
            space: space,
            subscription: nullable.(string.("The subscription it stopped")),
            removed: %{type: "boolean", description: "Whether it was watching it"}
          },
          required: ["space", "subscription", "removed"]
        }
      },
      %{
        name: "renew_subscriptions",
        description:
          "Renews every watched space whose subscription expires within two hours, as it's done every half hour: Google lets one last four hours at most",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{renewed: %{type: "array", items: subscription, description: "The subscriptions renewed"}},
          required: ["renewed"]
        }
      }
    ]
  end

  # Whose Chat app and Google account these are is the network's owners' to say, so what changes them, posts with them
  # or reads through them is theirs, and an app they installed that requires this one (a bridge) asks for itself.
  # `renew_subscriptions` is the clock's.
  @impl true
  def call(tool, inputs, %Call{caller: nil} = call) when tool != "renew_subscriptions" do
    if not Call.owns?(%{call | subject: call.installed}),
      do: raise(OneCore.Call.Refused, "Only the owners of whoever Google Chat is installed for use it.")

    run(tool, inputs, call)
  end

  def call(tool, inputs, call), do: run(tool, inputs, call)

  defp run("configure", inputs, call) do
    config = Store.config(call)
    item = inputs["vault_item"] || config["vault_item"] || @item

    values = %{"vault_item" => item, "webhook_token" => config["webhook_token"] || webhook_token()}
    values = if Map.has_key?(inputs, "pubsub_topic"), do: Map.put(values, "pubsub_topic", inputs["pubsub_topic"]), else: values
    values = if Map.has_key?(inputs, "account"), do: Map.put(values, "account", inputs["account"]), else: values
    Store.save_config(call, values)
    configured(Store.config(call), call)
  end

  defp run("status", _inputs, call) do
    Store.config(call) |> configured(call) |> Map.put(:subscriptions, Store.subscriptions(call))
  end

  defp run("spaces", inputs, call) do
    Api.spaces(call, inputs["account"] || Store.config(call)["account"], most(inputs["page_size"]), inputs["page_token"])
  end

  defp run("messages", %{"space" => space} = inputs, call) do
    Api.messages(call, inputs["account"] || Store.config(call)["account"], space!(space), most(inputs["page_size"]), inputs["page_token"])
  end

  defp run("send", %{"space" => space, "text" => text} = inputs, call) do
    Api.send_message(call, item(call), space!(space), text!(text), thread(inputs["thread"]))
  end

  defp run("edit", %{"message" => message, "text" => text}, call) do
    Api.edit_message(call, item(call), message!(message), text!(text))
  end

  defp run("delete", %{"message" => message}, call) do
    message = message!(message)
    Api.delete_message(call, item(call), message)
    %{name: message, deleted: true}
  end

  defp run("react", %{"message" => message} = inputs, call) do
    account = inputs["account"] || Store.config(call)["account"]

    case inputs["reaction"] do
      nil ->
        emoji = inputs["emoji"] || raise(OneCore.Call.Refused, "Give emoji to react with, or reaction to take one off.")
        added = Api.add_reaction(call, account, message!(message), emoji)
        %{name: added.name, emoji: added.emoji, removed: false}

      reaction ->
        reaction = reaction!(reaction)
        Api.remove_reaction(call, account, reaction)
        %{name: reaction, emoji: inputs["emoji"], removed: true}
    end
  end

  defp run("watch_space", %{"space" => space}, call) do
    space = space!(space)
    config = Store.config(call)

    topic =
      config["pubsub_topic"] ||
        raise(OneCore.Call.Refused, "Google Chat has no Pub/Sub topic yet: configure with pubsub_topic says where Google sends a space's events.")

    subscription =
      case Store.subscription(call, space) do
        nil -> Api.subscribe(call, config["account"], space, topic)
        kept -> %{kept | expire_time: Api.renew(call, config["account"], kept.subscription).expire_time}
      end

    Store.save_subscription(call, subscription)
    watched(subscription)
  end

  defp run("unwatch_space", %{"space" => space}, call) do
    space = space!(space)

    case Store.subscription(call, space) do
      nil ->
        %{space: space, subscription: nil, removed: false}

      subscription ->
        Api.unsubscribe(call, Store.config(call)["account"], subscription.subscription)
        Store.remove_subscription(call, space)
        %{space: space, subscription: subscription.subscription, removed: true}
    end
  end

  defp run("renew_subscriptions", _inputs, call) do
    now = DateTime.utc_now()
    account = Store.config(call)["account"]

    renewed =
      for subscription <- Store.subscriptions(call), expiring?(subscription.expire_time, now) do
        renewed = Api.renew(call, account, subscription.subscription)
        subscription = %{subscription | expire_time: renewed.expire_time}
        Store.save_subscription(call, subscription)
        subscription
      end

    %{renewed: renewed}
  end

  # What Google sends to the webhook: a Pub/Sub push of a Workspace Events event, or an event sent straight to a Chat
  # app. The token in the address is the secret, and the one configure made says a sender's from another's.
  @impl true
  def webhook(call, %{method: "POST", body: body, token: token}) do
    case Store.config(call)["webhook_token"] do
      nil ->
        answer(404)

      kept ->
        if same?(kept, token), do: received(call, body), else: answer(401)
    end
  end

  def webhook(_call, _request), do: answer(405)

  # The token in the address, in as much time as comparing them takes: a token that's another length isn't it.
  defp same?(kept, given) when is_binary(given) and byte_size(kept) == byte_size(given), do: :crypto.hash_equals(kept, given)
  defp same?(_kept, _given), do: false

  defp received(call, body) do
    case JSON.decode(body) do
      {:ok, %{"message" => %{"data" => data} = message}} -> published(call, message, data)
      {:ok, %{"type" => "MESSAGE"} = event} -> chat_event(call, event)
      {:ok, %{"type" => _type}} -> answer(200)
      _ -> answer(400)
    end
  end

  # A Workspace Events event, in a Pub/Sub push: its type says what happened, and its data what it happened to.
  defp published(call, message, data) do
    attributes = message["attributes"] || %{}

    case Base.decode64(data) do
      {:ok, json} ->
        case JSON.decode(json) do
          {:ok, event} ->
            case @happened[attributes["ce-type"]] do
              nil ->
                Logger.info("google-chat: ignored #{attributes["ce-type"]}")
                answer(200)

              name ->
                if is_map(event["message"]) or is_map(event["reaction"]) do
                  case attributes["ce-id"] || message["messageId"] do
                    nil -> answer(400)
                    id -> occurred(call, name, id, Api.payload(event))
                  end
                else
                  answer(200)
                end
            end

          {:error, _why} ->
            answer(400)
        end

      :error ->
        answer(400)
    end
  end

  # An event a Chat app is sent: a message to it, by a mention or in a direct message.
  defp chat_event(call, %{"message" => message} = event) do
    message = if message["space"], do: message, else: Map.put(message, "space", event["space"])
    id = message["name"] || Base.encode16(:crypto.hash(:sha256, JSON.encode!(event)), case: :lower)
    occurred(call, "mentioned", "chat:" <> id, Api.payload(%{"message" => message}))
  end

  defp chat_event(_call, _event), do: answer(400)

  # It's followed once, whatever sent it twice, and then by the apps that hook into it and by its events.
  defp occurred(call, name, id, payload) do
    if Store.unseen?(call, id) do
      Call.run_hook(call, name, payload)
      Events.emit(call, name, payload, event_id: id)
    end

    answer(200)
  end

  defp answer(status), do: {:ok, %{status: status, headers: [["content-type", "application/json"]], body: "{}"}}

  # What the events and the messages carry: the same fields, null where the thing has none.
  defp happened do
    %{
      type: "object",
      properties: %{
        space: %{type: ["string", "null"], description: "The space's name: spaces/AAAA"},
        thread: %{type: ["string", "null"], description: "The thread's name: spaces/AAAA/threads/BBBB"},
        message: %{type: ["string", "null"], description: "The message's name: spaces/AAAA/messages/BBBB"},
        text: %{type: ["string", "null"], description: "What the message says, in plain text"},
        sender: %{type: ["string", "null"], description: "Who did it, their Chat user's name: users/CCCC"},
        sender_name: %{type: ["string", "null"], description: "Their display name"},
        sender_type: %{type: ["string", "null"], description: "HUMAN or BOT"},
        emoji: %{type: ["string", "null"], description: "The reaction's emoji, where it's a reaction"},
        reaction: %{type: ["string", "null"], description: "The reaction's name: spaces/AAAA/messages/BBBB/reactions/CCCC"},
        create_time: %{type: ["string", "null"], description: "When the message was sent: RFC 3339, in UTC"}
      },
      required: ~w(space thread message text sender sender_name sender_type emoji reaction create_time)
    }
  end

  defp message_event do
    happened = happened()

    %{
      type: "object",
      properties: Map.drop(happened.properties, [:emoji, :reaction]),
      required: ~w(space thread message text sender sender_name sender_type create_time)
    }
  end

  defp filter do
    %{
      type: "object",
      properties: %{
        space: %{type: "string", description: "The space's name: spaces/AAAA"},
        message: %{type: "string", description: "The message's name: spaces/AAAA/messages/BBBB"},
        sender: %{type: "string", description: "Who did it, their Chat user's name: users/CCCC"}
      }
    }
  end

  # What a person reads, and what the caller does next, when a name isn't one Google gave.
  defp space!(space) do
    if is_binary(space) and space =~ @space,
      do: space,
      else: raise(OneCore.Call.Refused, "That isn't a space's name. A space is spaces/AAAA: google-chat_spaces lists them.")
  end

  defp message!(message) do
    if is_binary(message) and message =~ @message,
      do: message,
      else: raise(OneCore.Call.Refused, "That isn't a message's name. A message is spaces/AAAA/messages/BBBB: google-chat_messages lists them.")
  end

  defp reaction!(reaction) do
    if is_binary(reaction) and reaction =~ @reaction,
      do: reaction,
      else: raise(OneCore.Call.Refused, "That isn't a reaction's name. A reaction is spaces/AAAA/messages/BBBB/reactions/CCCC, from an event.")
  end

  defp thread(nil), do: nil
  defp thread(thread), do: if(is_binary(thread) and thread =~ @thread, do: thread, else: raise(OneCore.Call.Refused, "That isn't a thread's name. A thread is spaces/AAAA/threads/BBBB, from google-chat_messages or an event."))

  defp text!(text) do
    if is_binary(text) and String.trim(text) != "",
      do: text,
      else: raise(OneCore.Call.Refused, "A message needs text: what it says, as plain text.")
  end

  defp most(nil), do: 25
  defp most(size) when is_integer(size) and size > 0, do: min(size, 100)
  defp most(_size), do: raise(OneCore.Call.Refused, "page_size is a whole number of messages, 1 to 100.")

  # Whether a subscription ends within two hours, as `renew_subscriptions` renews it. One it can't read the date of is
  # renewed too: Google stops it at four hours whatever it said.
  defp expiring?(nil, _now), do: true

  defp expiring?(expire_time, now) when is_binary(expire_time) do
    case DateTime.from_iso8601(expire_time) do
      {:ok, expires, _offset} -> DateTime.compare(expires, DateTime.add(now, 2 * 3600)) == :lt
      {:error, _why} -> true
    end
  end

  defp item(call), do: Store.config(call)["vault_item"] || @item

  defp configured(config, call) do
    %{
      vault_item: config["vault_item"] || @item,
      pubsub_topic: config["pubsub_topic"],
      account: config["account"],
      webhook_path: webhook_path(config, call)
    }
  end

  defp webhook_path(%{"webhook_token" => token}, call) when is_binary(token),
    do: "/webhooks/#{call.installed}/google-chat/#{token}"

  defp webhook_path(_config, _call), do: nil

  defp watched(subscription) do
    %{space: subscription.space, subscription: subscription.subscription, expire_time: subscription.expire_time}
  end

  # 32 random bytes, in URL-safe base64: 43 characters a webhook's address takes, and nobody guesses.
  defp webhook_token, do: Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)
end
