defmodule GoogleChat.Api do
  @moduledoc """
  Google Chat's APIs, as a Chat app reaches them: as itself, with the service account key its person keeps in the
  Vault, for what it posts and changes in a space (`chat.bot`), and as its person, through `google-account`, for what
  Google only lets a person do: reading their spaces, reacting, and watching one for what happens in it.

  A space's name is `spaces/AAAA`, a message's `spaces/AAAA/messages/BBBB`, a reaction's
  `spaces/AAAA/messages/BBBB/reactions/CCCC`, and a workspace subscription's `subscriptions/DDDD`, as Google names
  each.
  """
  alias OneCore.Call

  @chat "https://chat.googleapis.com/v1/"
  @events "https://workspaceevents.googleapis.com/v1/"
  @token "https://oauth2.googleapis.com/token"
  @grant "urn:ietf:params:oauth:grant-type:jwt-bearer"
  @scope "https://www.googleapis.com/auth/chat.bot"

  @event_types ~w(
    google.workspace.chat.message.v1.created
    google.workspace.chat.message.v1.updated
    google.workspace.chat.message.v1.deleted
    google.workspace.chat.reaction.v1.created
    google.workspace.chat.reaction.v1.deleted
  )

  @doc "The service account `item` keeps, as its JSON key file has it: its `client_email` and `private_key`."
  def key(call, item) do
    call = vault(call)

    json =
      try do
        Call.app(call, "vault").value(call, item, "service_account_json")
      rescue
        error ->
          raise OneCore.Call.Refused,
                "Google Chat can't use its Chat app's service account key yet.\n\n" <>
                  "Ask the Vault for it: vault_request with title #{item}, the field service_account_json (secret), " <>
                  "hosts [\"googleapis.com\"] and app google-chat. Its person answers on their own device. " <>
                  "The Vault said: #{Exception.message(error)}"
      end

    case JSON.decode(json) do
      {:ok, %{"client_email" => email, "private_key" => pem} = key} when is_binary(email) and is_binary(pem) ->
        key

      _ ->
        raise OneCore.Call.Refused, "#{item}'s service_account_json isn't a service account's JSON key file."
    end
  end

  # The Vault whose item keeps the key: the one of whoever this app is installed for.
  defp vault(%Call{installed: installed} = call), do: %{call | actor: nil, subject: installed}

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

  @doc "Posts `text` in `space` as the Chat app, in `thread` if it's given, and says what Google made of it."
  def send_message(call, item, space, text, thread) do
    body = if thread, do: %{"text" => text, "thread" => %{"name" => thread}}, else: %{"text" => text}

    message =
      chat(call, item, "POST", space <> "/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD", %{
        body: JSON.encode!(body)
      })

    %{name: message["name"], thread: get_in(message, ["thread", "name"]) || thread, text: message["text"], create_time: message["createTime"]}
  end

  @doc "Changes what the message `name` says, as the Chat app, for a message the app posted."
  def edit_message(call, item, name, text) do
    message = chat(call, item, "PATCH", name <> "?updateMask=text", %{body: JSON.encode!(%{"text" => text})})
    %{name: message["name"], text: message["text"]}
  end

  @doc "Deletes the message `name`, as the Chat app, for a message the app posted."
  def delete_message(call, item, name) do
    chat(call, item, "DELETE", name)
    :ok
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
  A message as what happened in a space, for the events and hooks it's followed by and for `messages`: the space,
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
  What one Workspace Events event, or one event a Chat app is sent, says happened, in the same shape whatever
  happened: a message event's `message`, or a reaction's `reaction`.
  """
  def payload(%{"message" => message} = event) do
    space = get_in(message, ["space", "name"]) || parts(message["name"], 2) || get_in(event, ["space", "name"])

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

  # Google Chat, as the Chat app: a token from its key, good for an hour, then the call itself.
  defp chat(call, item, method, path, options \\ %{}) do
    %{"client_email" => email, "private_key" => pem} = key(call, item)

    headers = %{"authorization" => "Bearer " <> app_token(call, email, pem), "content-type" => "application/json"}
    request(call, method, @chat <> path, Map.put(options, :headers, headers))
  end

  defp app_token(call, email, pem) do
    form = URI.encode_query(%{"grant_type" => @grant, "assertion" => assertion(email, pem)})

    case request(call, "POST", @token, %{headers: %{"content-type" => "application/x-www-form-urlencoded"}, body: form}) do
      %{"access_token" => token} -> token
      _answer -> raise "Google gave Google Chat no access token."
    end
  end

  # A JSON Web Token that says it's the service account, signed with its key (RS256), for the Chat API's own scope.
  defp assertion(email, pem) do
    now = System.system_time(:second)
    encode = &Base.url_encode64(JSON.encode!(&1), padding: false)
    signed = encode.(%{"alg" => "RS256", "typ" => "JWT"}) <> "." <> encode.(%{"iss" => email, "scope" => @scope, "aud" => @token, "iat" => now, "exp" => now + 3600})
    [entry] = :public_key.pem_decode(pem)
    signed <> "." <> Base.url_encode64(:public_key.sign(signed, :sha256, :public_key.pem_entry_decode(entry)), padding: false)
  end

  # Google's API as the account `account` names, through google-account, which gives the answer's body or raises with
  # what went wrong.
  defp user(call, account, method, url, options \\ %{}) do
    inputs =
      Map.merge(%{"account" => account, "method" => method, "url" => url}, options)
      |> Map.reject(fn {_name, value} -> is_nil(value) end)

    Call.tool(call, "google-account", "request", inputs)["body"]
  end

  defp request(call, method, url, options) do
    case Call.fetch(call, Map.merge(%{url: url, method: method}, options)) do
      %{status: status, body: body} when status in 200..299 ->
        if body in [nil, ""], do: nil, else: JSON.decode!(body)

      %{status: status, body: body} ->
        raise "Google answered #{method} #{URI.parse(url).path} with #{status}: #{reason(body)}"
    end
  end

  defp reason(body) when is_binary(body) do
    case JSON.decode(body) do
      {:ok, %{"error" => %{"message" => message}}} when is_binary(message) -> message
      {:ok, %{"error_description" => message}} when is_binary(message) -> message
      {:ok, %{"error" => message}} when is_binary(message) -> message
      _ -> String.slice(body, 0, 300)
    end
  end

  defp reason(_body), do: "no answer"
end
