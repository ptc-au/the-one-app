defmodule GoogleChatApp do
  @moduledoc """
  Google Chat App: the network in Google Chat, as its own Chat app. Its service account, its JSON key in the Vault of
  whoever it's installed for, posts, edits and deletes the app's own messages and lists the spaces it's in
  (`chat.bot`); and reads the messages of a space it's a member of and watches one with Google Workspace Events, with
  app authentication (`chat.app.messages.readonly`), whose events Google publishes to a Pub/Sub topic that pushes
  them to this app's webhook. No person's account is used, so nothing it does shows as a person. A Chat app can't
  react: Google lets only a person do that.

  What it keeps is the network's, one for everyone (`own/0`), as the Chat app is: what it's set up with, the spaces it
  watches, and what happened in them, so its calls run where the network's Vault opens. What happens in a watched
  space is said, as events and hooks, for whoever asked to watch it, so a group's apps (Board Google Chat Sync) are
  told: a message posted, edited or deleted, and a reaction added or taken off. Being mentioned, or sent a direct
  message, is said for whoever it's installed for. `renew_subscriptions` keeps the watches alive, since Google lets one last four hours at most with its events'
  data included, and runs every half hour.
  """
  @behaviour OneCore.App
  require Logger

  alias GoogleChatApp.{Api, Store}
  alias OneCore.Call

  @item "Google Chat App"

  # What Google says happened, as the hook and event it's followed by.
  @happened %{
    "google.workspace.chat.message.v1.created" => "message_created",
    "google.workspace.chat.message.v1.updated" => "message_updated",
    "google.workspace.chat.message.v1.deleted" => "message_deleted",
    "google.workspace.chat.reaction.v1.created" => "reaction_created",
    "google.workspace.chat.reaction.v1.deleted" => "reaction_deleted"
  }

  @space ~r{\Aspaces/[A-Za-z0-9_-]+\z}
  @message ~r{\Aspaces/[A-Za-z0-9_-]+/messages/[A-Za-z0-9_.-]+\z}
  @thread ~r{\Aspaces/[A-Za-z0-9_-]+/threads/[A-Za-z0-9_.-]+\z}

  @impl true
  def icon, do: "icon.png"

  # What it keeps is the network's, as its Chat app is: what's posted in a space it's in is shared with the network.
  @impl true
  def own, do: :installed

  @impl true
  def requires do
    %{
      "core" => ">= 0.37.0",
      "database" => "to keep what it's set up with, the spaces it watches and the events it has handled",
      "vault" => "to read your Chat app's service account key"
    }
  end

  @impl true
  def jobs, do: [%{tool: "renew_subscriptions", every: 1800}]

  @impl true
  def events do
    for {name, description} <- [
          {"message_created", "A message was posted in a space the Chat app watches for you."},
          {"message_updated", "A message was edited in a space the Chat app watches for you."},
          {"message_deleted", "A message was deleted in a space the Chat app watches for you."},
          {"reaction_created", "A reaction was added to a message in a space the Chat app watches for you."},
          {"reaction_deleted", "A reaction was taken off a message in a space the Chat app watches for you."},
          {"mentioned", "The Chat app was mentioned, or was sent a direct message."}
        ] do
      %{name: name, description: description, delivery: [:poll, :webhook], inputs: filter(), outputs: happened()}
    end
  end

  @impl true
  def tools do
    string = &%{type: "string", description: &1}
    nullable = &Map.update!(&1, :type, fn type -> [type, "null"] end)

    space = string.("The space's name, like spaces/AAAA, from google-chat-app_spaces or the space's link")
    message = string.("The message's name, like spaces/AAAA/messages/BBBB, from google-chat-app_messages or an event")
    page_token = string.("The next page: the next_page_token the last page gave, with the same other inputs")
    page_size = %{type: "integer", description: "At most this many, 100 at most. 25 if left out"}

    config = %{
      vault_item: string.("The Vault item that keeps the Chat app's service account key"),
      pubsub_topic: nullable.(string.("Where Google publishes the events of the spaces it watches")),
      display_name: nullable.(string.("The Chat app's name in Google Chat, as its Chat API configuration gives it")),
      webhook_path: nullable.(string.("Where Google sends events, after the network's address: /webhooks/network/google-chat-app/<token>"))
    }

    watched = %{
      type: "object",
      properties: %{
        space: space,
        subscription: string.("Its name at Google: subscriptions/DDDD"),
        expire_time: string.("When Google stops it, unless it's renewed: RFC 3339, in UTC"),
        last_event_at: nullable.(string.("When Google last sent an event for this space: RFC 3339, in UTC"))
      },
      required: ["space", "subscription", "expire_time"]
    }

    [
      %{
        name: "configure",
        description:
          "Sets Google Chat App up: the Vault item that keeps the Chat app's service account key, the Pub/Sub topic its events come to, and its name in Google Chat. The webhook_path it answers is where Google sends events, the network's address plus it: the Chat app's HTTP endpoint, and the Pub/Sub topic's push subscription",
        inputs: %{
          type: "object",
          properties: %{
            vault_item: string.("The Vault item that keeps the service account's JSON key. #{@item} if left out"),
            pubsub_topic: string.("Where Google publishes a watched space's events: projects/<project>/topics/<topic>. Empty takes it away"),
            display_name: string.("The Chat app's name, as people see it in Google Chat. Empty takes it away")
          }
        },
        outputs: %{type: "object", properties: config, required: Map.keys(config)}
      },
      %{
        name: "status",
        read_only: true,
        description: "What Google Chat App is set up with, and the spaces it watches, each with when its subscription expires. It never says a key",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: Map.put(config, :subscriptions, %{type: "array", items: watched, description: "The spaces it watches"}),
          required: Map.keys(config) ++ [:subscriptions]
        }
      },
      %{
        name: "spaces",
        read_only: true,
        description:
          "The Google Chat spaces the Chat app is a member of, each by the name its other tools take. Where there are more, next_page_token is the next page's page_token",
        inputs: %{type: "object", properties: %{page_size: page_size, page_token: page_token}},
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
          "Recent messages in a space the Chat app is a member of, newest first, as the Chat app reads them: its public messages, each with who sent it and what it says. Where there are more, next_page_token is the next page's page_token",
        inputs: %{
          type: "object",
          properties: %{space: space, page_size: page_size, page_token: page_token},
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
          "Posts a message in a space as the Chat app. In a thread with thread, or a new one. The app must be in the space. This posts a real message to real people: only what the person asked to send",
        inputs: %{
          type: "object",
          properties: %{
            space: space,
            text: string.("What it says, as plain text"),
            thread: string.("The thread to reply in, like spaces/AAAA/threads/BBBB, from google-chat-app_messages or an event. A new thread if left out")
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
        description: "Changes what one of the Chat app's messages says. Only a message the app posted",
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
        description: "Deletes one of the Chat app's messages for good. Only a message the app posted",
        inputs: %{type: "object", properties: %{message: message}, required: ["message"]},
        outputs: %{
          type: "object",
          properties: %{name: message, deleted: %{type: "boolean", description: "Whether Google deleted it"}},
          required: ["name", "deleted"]
        }
      },
      %{
        name: "watch_space",
        description:
          "Watches a space the Chat app is in, for its messages and reactions, so what happens there comes to you as Google Chat App's events and hooks. Needs a Pub/Sub topic from configure, and its push subscription pointed at webhook_path. A space it already watches is renewed",
        inputs: %{type: "object", properties: %{space: space}, required: ["space"]},
        outputs: watched
      },
      %{
        name: "unwatch_space",
        description: "Stops a space's events coming to you, and stops watching it once nobody else has them. A space it isn't watching for you is nothing to stop",
        inputs: %{type: "object", properties: %{space: space}, required: ["space"]},
        outputs: %{
          type: "object",
          properties: %{
            space: space,
            subscription: nullable.(string.("The subscription it watched with")),
            removed: %{type: "boolean", description: "Whether it was watching it for you"}
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
          properties: %{renewed: %{type: "array", items: watched, description: "The subscriptions renewed"}},
          required: ["renewed"]
        }
      }
    ]
  end

  # Whose Chat app this is, is the network's owners' to say, so what changes it, posts with it or reads through it is
  # theirs, and an app that requires it (a bridge) asks for itself. `renew_subscriptions` is the clock's too.
  @impl true
  def call(tool, inputs, %Call{caller: nil} = call) when tool != "renew_subscriptions" do
    if not Call.owns?(%{call | subject: call.installed}),
      do: raise(Call.Refused, "Only the owners of whoever Google Chat App is installed for use it.")

    run(tool, inputs, call)
  end

  def call(tool, inputs, call), do: run(tool, inputs, call)

  defp run("configure", inputs, call) do
    config = Store.config(call)
    values = %{"vault_item" => inputs["vault_item"] || config["vault_item"] || @item, "webhook_path" => config["webhook_path"] || Call.webhook(call, "events")}
    values = if Map.has_key?(inputs, "pubsub_topic"), do: Map.put(values, "pubsub_topic", topic(inputs["pubsub_topic"])), else: values
    values = if Map.has_key?(inputs, "display_name"), do: Map.put(values, "display_name", inputs["display_name"]), else: values
    Store.save_config(call, values)
    configured(Store.config(call))
  end

  defp run("status", _inputs, call) do
    Store.config(call) |> configured() |> Map.put(:subscriptions, Store.subscriptions(call))
  end

  defp run("spaces", inputs, call) do
    Api.spaces(call, configured!(call), most(inputs["page_size"]), inputs["page_token"])
  end

  defp run("messages", %{"space" => space} = inputs, call) do
    Api.messages(call, configured!(call), space!(space), most(inputs["page_size"]), inputs["page_token"])
  end

  defp run("send", %{"space" => space, "text" => text} = inputs, call) do
    Api.send_message(call, configured!(call), space!(space), text!(text), thread(inputs["thread"]))
  end

  defp run("edit", %{"message" => message, "text" => text}, call) do
    Api.edit_message(call, configured!(call), message!(message), text!(text))
  end

  defp run("delete", %{"message" => message}, call) do
    message = message!(message)
    Api.delete_message(call, configured!(call), message)
    %{name: message, deleted: true}
  end

  # Google ends a subscription four hours after it was last renewed, or earlier if suspended/deleted: one that's
  # lapsed or gone (404) is made again for the same space. One that fails doesn't stop the others being renewed: the
  # first failure is raised once they all have been.
  defp run("renew_subscriptions", _inputs, call) do
    now = DateTime.utc_now()
    config = configured!(call)

    results =
      for subscription <- Store.subscriptions(call), expiring?(subscription.expire_time, now) do
        try do
          subscription = renew_or_subscribe(call, config, subscription, now)
          Store.save_subscription(call, subscription)
          {:ok, subscription}
        rescue
          failed -> {:error, failed}
        end
      end

    with {:error, failed} <- Enum.find(results, &match?({:error, _}, &1)), do: raise(failed)
    %{renewed: for({:ok, subscription} <- results, do: subscription)}
  end

  # Whose its events are is whoever asked to watch it: a group whose app watches it, or a person.
  defp run("watch_space", %{"space" => space}, call) do
    space = space!(space)
    config = configured!(call)
    now = DateTime.utc_now()

    subscription =
      case Store.subscription(call, space) do
        nil -> Api.subscribe(call, config, space, topic!(config))
        kept -> renew_or_subscribe(call, config, kept, now)
      end

    Store.save_subscription(call, subscription)
    Store.add_watcher(call, space, call.subject)
    Store.subscription(call, space)
  end

  defp renew_or_subscribe(call, config, kept, now) do
    if lapsed?(kept.expire_time, now) do
      Api.subscribe(call, config, kept.space, topic!(config))
    else
      case Api.renew(call, config, kept.subscription) do
        {:ok, renewed} -> %{kept | expire_time: renewed.expire_time}
        :not_found -> Api.subscribe(call, config, kept.space, topic!(config))
      end
    end
  end

  defp run("unwatch_space", %{"space" => space}, call) do
    space = space!(space)
    subscription = Store.subscription(call, space)
    removed = Store.remove_watcher(call, space, call.subject)

    if subscription && Store.watchers(call, space) == [] do
      Api.unsubscribe(call, configured!(call), subscription.subscription)
      Store.remove_subscription(call, space)
    end

    %{space: space, subscription: subscription && subscription.subscription, removed: removed}
  end

  # What Google sends to the webhook configure made: a Pub/Sub push of a Workspace Events event, or an event sent
  # straight to the Chat app, as a Workspace add-on's (`chat.messagePayload`, Google's default for a new Chat app) or a
  # Chat app's own (`type`). One Core answers an address with any other token before it comes here.
  @impl true
  def webhook(call, %{method: "POST", body: body, name: "events"}) do
    case JSON.decode(body) do
      {:ok, %{"message" => %{"data" => data} = message}} -> published(call, message, data)
      {:ok, %{"chat" => %{"messagePayload" => %{"message" => message} = payload}}} -> chat_event(call, %{"message" => message, "space" => payload["space"]})
      {:ok, %{"chat" => _chat}} -> answer(200)
      {:ok, %{"type" => "MESSAGE", "message" => _} = event} -> chat_event(call, event)
      {:ok, %{"type" => _type}} -> answer(200)
      _ -> answer(400)
    end
  end

  def webhook(_call, _request), do: answer(405)

  # A Workspace Events event, in a Pub/Sub push: its type says what happened, its source which subscription it came
  # from, and its data what it happened to. It's said once, whatever sent it twice, for each it's watched for.
  defp published(call, message, data) do
    attributes = message["attributes"] || %{}

    with {:ok, json} <- Base.decode64(data),
         {:ok, event} <- JSON.decode(json) do
      name = @happened[attributes["ce-type"]]
      id = attributes["ce-id"] || message["messageId"]

      cond do
        name == nil ->
          Logger.info("google-chat-app: ignored #{attributes["ce-type"]}")
          answer(200)

        not (is_map(event["message"]) or is_map(event["reaction"])) ->
          answer(200)

        id == nil ->
          answer(400)

        true ->
          sub = subscription_of(attributes["ce-source"])
          watchers = Store.watchers(call, subscription: sub)

          if watchers != [] and Store.unseen?(call, id) do
            Store.touch_event(call, sub)
            data = Api.payload(event)

            for whose <- watchers, do: OneCore.Events.emit(%{call | actor: nil, subject: whose}, name, data)
          end

          answer(200)
      end
    else
      _ -> answer(400)
    end
  end

  # A CloudEvent's source is its subscription, as `//workspaceevents.googleapis.com/subscriptions/DDDD`.
  defp subscription_of("//workspaceevents.googleapis.com/" <> subscription), do: subscription
  defp subscription_of(_source), do: nil

  # An event the Chat app is sent: a message to it, by a mention or in a direct message, for whoever it's installed
  # for.
  defp chat_event(call, %{"message" => message} = event) do
    message = if message["space"], do: message, else: Map.put(message, "space", event["space"])
    id = message["name"] || Base.encode16(:crypto.hash(:sha256, JSON.encode!(event)), case: :lower)
    if Store.unseen?(call, "chat:" <> id), do: OneCore.Events.emit(call, "mentioned", Api.payload(%{"message" => message}))
    answer(200)
  end

  defp answer(status), do: {:ok, %{status: status, headers: [["content-type", "application/json"]], body: "{}"}}

  defp configured!(call) do
    config = Store.config(call)
    Map.put(config, "vault_item", config["vault_item"] || @item)
  end

  defp configured(config) do
    %{
      vault_item: config["vault_item"] || @item,
      pubsub_topic: config["pubsub_topic"],
      display_name: config["display_name"],
      webhook_path: config["webhook_path"]
    }
  end

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
      else: raise(Call.Refused, "That isn't a space's name. A space is spaces/AAAA: google-chat-app_spaces lists the Chat app's.")
  end

  defp message!(message) do
    if is_binary(message) and message =~ @message,
      do: message,
      else: raise(Call.Refused, "That isn't a message's name. A message is spaces/AAAA/messages/BBBB: google-chat-app_messages lists them.")
  end

  defp thread(nil), do: nil

  defp thread(thread) do
    if is_binary(thread) and thread =~ @thread,
      do: thread,
      else: raise(Call.Refused, "That isn't a thread's name. A thread is spaces/AAAA/threads/BBBB, from google-chat-app_messages or an event.")
  end

  defp text!(text) do
    if is_binary(text) and String.trim(text) != "",
      do: text,
      else: raise(Call.Refused, "A message needs text: what it says, as plain text.")
  end

  defp topic!(config),
    do: config["pubsub_topic"] || raise(Call.Refused, "Google Chat App has no Pub/Sub topic yet: configure with pubsub_topic says where Google sends a space's events.")

  defp topic(topic) when topic in [nil, ""], do: nil

  defp topic(topic) do
    if is_binary(topic) and topic =~ ~r{\Aprojects/[a-z][a-z0-9-]+/topics/[A-Za-z][A-Za-z0-9._~%+-]+\z},
      do: topic,
      else: raise(Call.Refused, "A Pub/Sub topic is projects/<project>/topics/<topic>.")
  end

  defp most(nil), do: 25
  defp most(size) when is_integer(size) and size > 0, do: min(size, 100)
  defp most(_size), do: raise(Call.Refused, "page_size is a whole number, 1 to 100.")

  # Whether Google has already ended a subscription, which it does at the time it said.
  defp lapsed?(expire_time, now) when is_binary(expire_time) do
    case DateTime.from_iso8601(expire_time) do
      {:ok, expires, _offset} -> DateTime.compare(expires, now) == :lt
      {:error, _why} -> false
    end
  end

  defp lapsed?(_expire_time, _now), do: false

  # Whether a subscription ends within two hours, as `renew_subscriptions` renews it. One it can't read the date of is
  # renewed too: Google stops it at four hours whatever it said.
  defp expiring?(nil, _now), do: true

  defp expiring?(expire_time, now) when is_binary(expire_time) do
    case DateTime.from_iso8601(expire_time) do
      {:ok, expires, _offset} -> DateTime.compare(expires, DateTime.add(now, 2 * 3600)) == :lt
      {:error, _why} -> true
    end
  end
end
