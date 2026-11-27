defmodule GoogleChat do
  @moduledoc """
  Google Chat: a person's own Chat spaces, through Google Chat's API, as them. Their Google account, signed in to
  `google-account` with the scopes this app asks, reads their spaces and messages, reacts as them, and watches a space
  with Google Workspace Events, whose events Google publishes to a Pub/Sub topic that pushes them to this app's
  webhook. Posting as the network's own Chat app is Google Chat App's.

  What each person keeps is their own (`own/0` is left as it is): the spaces they watch, with the account each is
  watched as, and what happened there, as events only they follow. What's the network's, kept for whoever the app is
  installed for, is how Google reaches it: the Pub/Sub topic, the one webhook its push subscription sends to, and
  whose each Workspace Events subscription is, so that an event goes to the person whose it is (`deliver`), and to
  nobody else. A person's call reaches that for whoever it's installed for, asked by them still, so a server acting
  for them may ask a server acting for the network.

  What happens in a watched space is offered to its person's other apps and agents, as events: a message posted,
  edited or deleted, and a reaction added or taken off. `renew_subscriptions` keeps the watches alive, since Google
  lets one last four hours at most with its events' data included, and runs every half hour.
  """
  @behaviour OneCore.App
  require Logger

  alias GoogleChat.{Api, Store}
  alias OneCore.Call

  # What Google says happened, as the event it's followed by.
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

  # The tools only this app calls, for itself: to keep whose a subscription is, for whoever it's installed for, and to
  # say what happened for the person whose it is.
  @own ~w(route deliver)

  @space ~r{\Aspaces/[A-Za-z0-9_-]+\z}
  @message ~r{\Aspaces/[A-Za-z0-9_-]+/messages/[A-Za-z0-9_.-]+\z}
  @reaction ~r{\Aspaces/[A-Za-z0-9_-]+/messages/[A-Za-z0-9_.-]+/reactions/[A-Za-z0-9_-]+\z}
  @subscription ~r{\Asubscriptions/[A-Za-z0-9_-]+\z}

  @impl true
  def icon, do: "icon.png"

  @impl true
  def requires do
    %{
      "core" => ">= 0.37.0",
      "database" => "to keep the spaces you watch and what happened in them",
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
  def events do
    for {name, description} <- [
          {"message_created", "A message was posted in a space you watch."},
          {"message_updated", "A message was edited in a space you watch."},
          {"message_deleted", "A message was deleted in a space you watch."},
          {"reaction_created", "A reaction was added to a message in a space you watch."},
          {"reaction_deleted", "A reaction was taken off a message in a space you watch."}
        ] do
      %{name: name, description: description, delivery: [:poll, :webhook], inputs: filter(), outputs: happened()}
    end
  end

  @impl true
  def tools do
    string = &%{type: "string", description: &1}
    nullable = &Map.update!(&1, :type, fn type -> [type, "null"] end)

    account =
      string.("Which of your Google accounts: its address, or a part of it only it has, as google-account_accounts lists them. The first if left out")

    space = string.("The space's name, like spaces/AAAA, from google-chat_spaces or the space's link")
    message = string.("The message's name, like spaces/AAAA/messages/BBBB, from google-chat_messages or an event")
    page_token = string.("The next page: the next_page_token the last page gave, with the same other inputs")
    page_size = %{type: "integer", description: "At most this many, 100 at most. 25 if left out"}
    subscription_name = string.("Its name at Google: subscriptions/DDDD")

    subscription = %{
      type: "object",
      properties: %{
        space: space,
        subscription: subscription_name,
        account: nullable.(string.("The account it watches as, as it was given. The first if null")),
        expire_time: string.("When Google stops it, unless it's renewed: RFC 3339, in UTC")
      },
      required: ["space", "subscription", "account", "expire_time"]
    }

    [
      %{
        name: "configure",
        description:
          "Sets up where Google sends the events of the spaces people watch, for the whole network: the Pub/Sub topic. The webhook_path it answers is where that topic's push subscription sends them: the network's address plus it. For the network's owners",
        inputs: %{
          type: "object",
          properties: %{
            pubsub_topic: string.("Where Google publishes a watched space's events: projects/<project>/topics/<topic>. Empty takes it away")
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            pubsub_topic: nullable.(string.("Where Google publishes events")),
            webhook_path: string.("Where Google sends events, after the network's address: /webhooks/network/google-chat/<token>")
          },
          required: ["pubsub_topic", "webhook_path"]
        }
      },
      %{
        name: "status",
        read_only: true,
        description: "Whether watching a space is set up for the network, and the spaces you watch, each with when its subscription expires",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{
            pubsub_topic: nullable.(string.("Where Google publishes events. Watching a space needs it")),
            subscriptions: %{type: "array", items: subscription, description: "The spaces you watch"}
          },
          required: ["pubsub_topic", "subscriptions"]
        }
      },
      %{
        name: "spaces",
        read_only: true,
        description:
          "The Google Chat spaces you're a member of, as your Google account, each by the name its other tools take: spaces and direct messages too. Where there are more, next_page_token is the next page's page_token",
        inputs: %{type: "object", properties: %{account: account, page_size: page_size, page_token: page_token}},
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
          "Watches a space as your Google account, for its messages and reactions, so what happens there comes to you as Google Chat's events. A space you already watch is renewed instead",
        inputs: %{type: "object", properties: %{space: space, account: account}, required: ["space"]},
        outputs: subscription
      },
      %{
        name: "unwatch_space",
        description: "Stops watching a space, and its events. A space you aren't watching is nothing to stop",
        inputs: %{type: "object", properties: %{space: space}, required: ["space"]},
        outputs: %{
          type: "object",
          properties: %{
            space: space,
            subscription: nullable.(string.("The subscription it stopped")),
            removed: %{type: "boolean", description: "Whether you were watching it"}
          },
          required: ["space", "subscription", "removed"]
        }
      },
      %{
        name: "renew_subscriptions",
        description:
          "Renews each space you watch whose subscription expires within two hours, as it's done every half hour: Google lets one last four hours at most",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{renewed: %{type: "array", items: subscription, description: "The subscriptions renewed"}},
          required: ["renewed"]
        }
      },
      %{
        name: "route",
        description: "Google Chat's own, which only it calls: keeps whose a Workspace Events subscription is, or forgets it",
        inputs: %{
          type: "object",
          properties: %{
            subscription: subscription_name,
            for: nullable.(string.("Whose it is: users/<name>. Null forgets it"))
          },
          required: ["subscription", "for"]
        },
        outputs: %{type: "object"}
      },
      %{
        name: "deliver",
        description: "Google Chat's own, which only it calls: says what happened in a watched space, for the person who watches it",
        inputs: %{
          type: "object",
          properties: %{event: string.("The event: message_created, reaction_deleted and the others"), data: happened()},
          required: ["event", "data"]
        },
        outputs: %{type: "object"}
      }
    ]
  end

  @impl true
  def call(tool, inputs, call) when tool in @own do
    if not itself?(call), do: raise(Call.Refused, "Only Google Chat calls #{tool}, for itself.")
    run(tool, inputs, call)
  end

  # What's the network's is set up by its owners, and kept for whoever the app is installed for.
  def call("configure", inputs, call) do
    cond do
      not installed?(call) and Call.owns?(%{call | subject: call.installed}) -> Call.tool(installed(call), call.app, "configure", inputs)
      installed?(call) and (itself?(call) or Call.owns?(call)) -> run("configure", inputs, call)
      true -> raise Call.Refused, "Only the network's owners set up where Google sends Google Chat's events."
    end
  end

  def call(tool, inputs, call), do: run(tool, inputs, call)

  defp run("configure", inputs, call) do
    config = Store.config(call)
    values = %{"webhook_path" => config["webhook_path"] || Call.webhook(call, "events")}
    values = if Map.has_key?(inputs, "pubsub_topic"), do: Map.put(values, "pubsub_topic", topic(inputs["pubsub_topic"])), else: values
    Store.save_config(call, values)
    config = Store.config(call)
    %{pubsub_topic: config["pubsub_topic"], webhook_path: config["webhook_path"]}
  end

  defp run("status", _inputs, call) do
    %{pubsub_topic: pubsub_topic(call), subscriptions: Store.subscriptions(call)}
  end

  defp run("spaces", inputs, call) do
    Api.spaces(call, inputs["account"], most(inputs["page_size"]), inputs["page_token"])
  end

  defp run("messages", %{"space" => space} = inputs, call) do
    Api.messages(call, inputs["account"], space!(space), most(inputs["page_size"]), inputs["page_token"])
  end

  defp run("react", %{"message" => message} = inputs, call) do
    case inputs["reaction"] do
      nil ->
        emoji = inputs["emoji"] || raise(Call.Refused, "Give emoji to react with, or reaction to take one off.")
        added = Api.add_reaction(call, inputs["account"], message!(message), emoji)
        %{name: added.name, emoji: added.emoji, removed: false}

      reaction ->
        reaction = reaction!(reaction)
        Api.remove_reaction(call, inputs["account"], reaction)
        %{name: reaction, emoji: inputs["emoji"], removed: true}
    end
  end

  defp run("watch_space", %{"space" => space} = inputs, call) do
    space = space!(space)

    subscription =
      case Store.subscription(call, space) do
        nil ->
          made = Map.put(Api.subscribe(call, inputs["account"], space, topic!(call)), :account, inputs["account"])
          route(call, made.subscription, call.subject)
          made

        kept ->
          if lapsed?(kept.expire_time, DateTime.utc_now()),
            do: resubscribe(call, kept),
            else: %{kept | expire_time: Api.renew(call, kept.account, kept.subscription).expire_time}
      end

    Store.save_subscription(call, subscription)
    subscription
  end

  defp run("unwatch_space", %{"space" => space}, call) do
    space = space!(space)

    case Store.subscription(call, space) do
      nil ->
        %{space: space, subscription: nil, removed: false}

      subscription ->
        Api.unsubscribe(call, subscription.account, subscription.subscription)
        route(call, subscription.subscription, nil)
        Store.remove_subscription(call, space)
        %{space: space, subscription: subscription.subscription, removed: true}
    end
  end

  # Google ends a subscription four hours after it was last renewed, so one that wasn't, in an outage of every server,
  # is gone: it's made again, for the same space and whoever's it was. One that fails doesn't stop the others being
  # renewed: the first failure is raised once they all have been.
  defp run("renew_subscriptions", _inputs, call) do
    now = DateTime.utc_now()

    results =
      for subscription <- Store.subscriptions(call), expiring?(subscription.expire_time, now) do
        try do
          subscription =
            if lapsed?(subscription.expire_time, now),
              do: resubscribe(call, subscription),
              else: %{subscription | expire_time: Api.renew(call, subscription.account, subscription.subscription).expire_time}

          Store.save_subscription(call, subscription)
          {:ok, subscription}
        rescue
          failed -> {:error, failed}
        end
      end

    with {:error, failed} <- Enum.find(results, &match?({:error, _}, &1)), do: raise(failed)
    %{renewed: for({:ok, subscription} <- results, do: subscription)}
  end

  defp run("route", %{"subscription" => subscription} = inputs, call) do
    if not (is_binary(subscription) and subscription =~ @subscription), do: raise(Call.Refused, "That isn't a subscription's name.")
    Store.save_route(call, subscription, inputs["for"])
    %{}
  end

  defp run("deliver", %{"event" => event, "data" => data}, call) do
    if event not in Map.values(@happened), do: raise(Call.Refused, "Google Chat has no event #{event}.")
    OneCore.Events.emit(call, event, data)
    %{}
  end

  # What Google sends to the webhook configure made: a Pub/Sub push of a Workspace Events event. It's for the person
  # whose subscription it came from, once, whatever sent it twice. One Core answers an address with any other token
  # before it comes here.
  @impl true
  def webhook(call, %{method: "POST", body: body, name: "events"}) do
    case JSON.decode(body) do
      {:ok, %{"message" => %{"data" => data} = message}} -> published(call, message, data)
      _ -> answer(400)
    end
  end

  def webhook(_call, _request), do: answer(405)

  # A Workspace Events event, in a Pub/Sub push: its type says what happened, its source which subscription it came
  # from, and its data what it happened to.
  defp published(call, message, data) do
    attributes = message["attributes"] || %{}

    with {:ok, json} <- Base.decode64(data),
         {:ok, event} <- JSON.decode(json) do
      name = @happened[attributes["ce-type"]]
      id = attributes["ce-id"] || message["messageId"]

      cond do
        name == nil ->
          Logger.info("google-chat: ignored #{attributes["ce-type"]}")
          answer(200)

        not (is_map(event["message"]) or is_map(event["reaction"])) ->
          answer(200)

        id == nil ->
          answer(400)

        true ->
          with whose when is_binary(whose) <- Store.route(call, subscription_of(attributes["ce-source"])),
               true <- Store.unseen?(call, id) do
            Call.tool(%{call | actor: nil, subject: whose}, call.app, "deliver", %{"event" => name, "data" => Api.payload(event)})
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

  defp answer(status), do: {:ok, %{status: status, headers: [["content-type", "application/json"]], body: "{}"}}

  # Whether the call runs for whoever the app is installed for, where what's the network's is kept.
  defp installed?(call), do: call.subject == call.installed

  # The same call, for whoever the app is installed for. Whoever asked still asks: a server acting for a person asks
  # one acting for the network only for someone who may ask for it.
  defp installed(call), do: %{call | subject: call.installed}

  # Whether this app called it, for itself: One Core says which app called, and nothing asked can say.
  defp itself?(call), do: call.caller == call.app_artifact

  defp pubsub_topic(call) do
    if installed?(call),
      do: Store.config(call)["pubsub_topic"],
      else: Call.tool(installed(call), call.app, "status", %{})["pubsub_topic"]
  end

  defp topic!(call),
    do: pubsub_topic(call) || raise(Call.Refused, "Watching a space isn't set up for the network yet: one of its owners calls google-chat_configure with pubsub_topic.")

  # A subscription Google ended, made again as the account it was, its events going to whoever's they were.
  defp resubscribe(call, lapsed) do
    made = Map.put(Api.subscribe(call, lapsed.account, lapsed.space, topic!(call)), :account, lapsed.account)
    route(call, made.subscription, Store.route(call, lapsed.subscription))
    route(call, lapsed.subscription, nil)
    made
  end

  defp route(call, subscription, whose),
    do: Call.tool(installed(call), call.app, "route", %{"subscription" => subscription, "for" => whose})

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
      else: raise(Call.Refused, "That isn't a space's name. A space is spaces/AAAA: google-chat_spaces lists them.")
  end

  defp message!(message) do
    if is_binary(message) and message =~ @message,
      do: message,
      else: raise(Call.Refused, "That isn't a message's name. A message is spaces/AAAA/messages/BBBB: google-chat_messages lists them.")
  end

  defp reaction!(reaction) do
    if is_binary(reaction) and reaction =~ @reaction,
      do: reaction,
      else: raise(Call.Refused, "That isn't a reaction's name. A reaction is spaces/AAAA/messages/BBBB/reactions/CCCC, from an event.")
  end

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
