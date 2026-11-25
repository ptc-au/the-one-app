defmodule GoogleChat.Api do
  @moduledoc """
  Google Chat's APIs, as a person reaches them, through `google-account`: reading their spaces and messages, reacting,
  and watching a space for what happens in it, with Google Workspace Events.

  A space's name is `spaces/AAAA`, a message's `spaces/AAAA/messages/BBBB`, a reaction's
  `spaces/AAAA/messages/BBBB/reactions/CCCC`, and a workspace subscription's `subscriptions/DDDD`, as Google names
  each.
  """
  alias OneCore.Call

  @chat "https://chat.googleapis.com/v1/"
  @events "https://workspaceevents.googleapis.com/v1/"

  @event_types ~w(
    google.workspace.chat.message.v1.created
    google.workspace.chat.message.v1.updated
    google.workspace.chat.message.v1.deleted
    google.workspace.chat.reaction.v1.created
    google.workspace.chat.reaction.v1.deleted
  )

  @doc "The spaces its person is a member of, as Google Chat names each."
  def spaces(call, account, page_size, page_token) do
    found = user(call, account, "GET", @chat <> "spaces", %{"query" => %{"pageSize" => page_size, "pageToken" => page_token}})
    %{spaces: Enum.map(found["spaces"] || [], &space/1), next_page_token: found["nextPageToken"]}
  end

  @doc "The messages in `space`, newest first, as Google Chat names each."
  def messages(call, account, space, page_size, page_token) do
    found =
      user(call, account, "GET", @chat <> space <> "/messages", %{
        "query" => %{"pageSize" => page_size, "pageToken" => page_token, "orderBy" => "createTime desc"}
      })

    %{messages: Enum.map(found["messages"] || [], &message(&1, space)), next_page_token: found["nextPageToken"]}
  end

  @doc "Reacts to `message` with `emoji`, as its person."
  def add_reaction(call, account, message, emoji) do
    reaction = user(call, account, "POST", @chat <> message <> "/reactions", %{"json" => %{"emoji" => %{"unicode" => emoji}}})
    %{name: reaction["name"], emoji: emoji(reaction["emoji"])}
  end

  @doc "Takes the reaction `name` off its message, as its person."
  def remove_reaction(call, account, name) do
    user(call, account, "DELETE", @chat <> name)
    :ok
  end

  @doc "Watches `space` for messages and reactions, with the events sent to the Pub/Sub topic `topic`."
  def subscribe(call, account, space, topic) do
    body = %{
      "targetResource" => "//chat.googleapis.com/" <> space,
      "eventTypes" => @event_types,
      "notificationEndpoint" => %{"pubsubTopic" => topic},
      "payloadOptions" => %{"includeResource" => true}
    }

    subscription = subscription!(user(call, account, "POST", @events <> "subscriptions", %{"json" => body}))
    %{space: space, subscription: subscription["name"], expire_time: subscription["expireTime"]}
  end

  @doc "Stops watching the subscription `name`."
  def unsubscribe(call, account, name) do
    user(call, account, "DELETE", @events <> name)
    :ok
  end

  @doc "Renews the subscription `name` for as long as Google lets it last, and says when it now expires."
  def renew(call, account, name) do
    renewed = subscription!(user(call, account, "PATCH", @events <> name, %{"query" => %{"updateMask" => "ttl"}, "json" => %{"ttl" => "0s"}}))
    %{subscription: renewed["name"], expire_time: renewed["expireTime"]}
  end

  # The subscription a Workspace Events call made. Google answers one of its long-running operations, with the
  # subscription in it once it's done.
  defp subscription!(%{"response" => %{"name" => _} = subscription}), do: subscription

  defp subscription!(%{"error" => %{"message" => message}}) when is_binary(message),
    do: raise("Google Workspace Events failed: #{message}")

  defp subscription!(operation),
    do: raise("Google Workspace Events gave no subscription: #{String.slice(JSON.encode!(operation), 0, 300)}")

  @doc "A space as Google says it, with the fields its tools pass on."
  def space(space) do
    %{name: space["name"], display_name: space["displayName"], type: space["type"]}
  end

  @doc """
  A message as what happened in a space, for the events it's followed by and for `messages`: the space,
  its thread, who sent it and what it says.
  """
  def message(message, space) do
    %{
      "space" => space,
      "thread" => get_in(message, ["thread", "name"]),
      "message" => message["name"],
      "text" => message["text"],
      "sender" => get_in(message, ["sender", "name"]),
      "sender_name" => get_in(message, ["sender", "displayName"]),
      "sender_type" => get_in(message, ["sender", "type"]),
      "create_time" => message["createTime"]
    }
  end

  @doc """
  What one Workspace Events event says happened, in the same shape whatever happened: a message event's `message`,
  or a reaction's `reaction`.
  """
  def payload(%{"message" => message}) do
    space = get_in(message, ["space", "name"]) || parts(message["name"], 2)

    Map.merge(message(message, space), %{"emoji" => nil, "reaction" => nil})
  end

  def payload(%{"reaction" => reaction}) do
    %{
      "space" => parts(reaction["name"], 2),
      "thread" => nil,
      "message" => parts(reaction["name"], 4),
      "text" => nil,
      "sender" => get_in(reaction, ["user", "name"]),
      "sender_name" => nil,
      "sender_type" => get_in(reaction, ["user", "type"]),
      "emoji" => emoji(reaction["emoji"]),
      "reaction" => reaction["name"],
      "create_time" => nil
    }
  end

  # A name's first parts, as Google names resources: spaces/AAAA/messages/BBBB's first two are spaces/AAAA.
  defp parts(nil, _count), do: nil

  defp parts(name, count) when is_binary(name) do
    name = String.split(name, "/")
    if length(name) >= count, do: name |> Enum.take(count) |> Enum.join("/")
  end

  # The emoji a reaction is, as one string: its Unicode emoji, or a custom emoji's name.
  defp emoji(nil), do: nil
  defp emoji(%{"unicode" => unicode}) when is_binary(unicode), do: unicode

  defp emoji(%{"customEmoji" => custom}) when is_map(custom),
    do: custom["name"] || custom["uid"]

  defp emoji(_emoji), do: nil

  # Google's API as the account `account` names, through google-account, which gives the answer's body or raises with
  # what went wrong.
  defp user(call, account, method, url, options \\ %{}) do
    inputs =
      Map.merge(%{"account" => account, "method" => method, "url" => url}, options)
      |> Map.reject(fn {_name, value} -> is_nil(value) end)

    Call.tool(call, "google-account", "request", inputs)["body"]
  end
end
