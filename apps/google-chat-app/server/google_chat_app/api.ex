defmodule GoogleChatApp.Api do
  @moduledoc """
  Google Chat's APIs, as the network's Chat app reaches them: as itself, with the service account key kept in the
  Vault of whoever the app is installed for. It posts, edits and deletes its own messages and lists its spaces with
  `chat.bot`, and reads the messages of a space it's a member of, and watches one with Google Workspace Events, with
  app authentication (`chat.app.messages.readonly`), which a Workspace admin approves once. No person's account is
  used: what it does shows as the Chat app.

  A space's name is `spaces/AAAA`, a message's `spaces/AAAA/messages/BBBB`, a reaction's
  `spaces/AAAA/messages/BBBB/reactions/CCCC`, and a workspace subscription's `subscriptions/DDDD`, as Google names
  each.
  """
  alias OneCore.Call

  @chat "https://chat.googleapis.com/v1/"
  @events "https://workspaceevents.googleapis.com/v1/"
  @token "https://oauth2.googleapis.com/token"
  @grant "urn:ietf:params:oauth:grant-type:jwt-bearer"

  # What it does as a Chat app, which needs no approval, and what it reads with app authentication, which does.
  @bot "https://www.googleapis.com/auth/chat.bot"
  @read "https://www.googleapis.com/auth/chat.app.messages.readonly"

  @event_types ~w(
    google.workspace.chat.message.v1.created
    google.workspace.chat.message.v1.updated
    google.workspace.chat.message.v1.deleted
    google.workspace.chat.reaction.v1.created
    google.workspace.chat.reaction.v1.deleted
  )

  @doc "The spaces the Chat app is a member of, as Google Chat names each."
  def spaces(call, config, page_size, page_token) do
    found = chat(call, config, @bot, "GET", "spaces?" <> query(pageSize: page_size, pageToken: page_token))
    %{spaces: Enum.map(found["spaces"] || [], &space/1), next_page_token: found["nextPageToken"]}
  end

  @doc "The messages in `space`, newest first, as the Chat app reads them: the space's public messages."
  def messages(call, config, space, page_size, page_token) do
    found =
      chat(call, config, @read, "GET", space <> "/messages?" <> query(pageSize: page_size, pageToken: page_token, orderBy: "createTime desc"))

    %{messages: Enum.map(found["messages"] || [], &message(&1, space)), next_page_token: found["nextPageToken"]}
  end

  # Where a reply goes when its thread is gone: a thread of its own.
  @fallback "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"

  @doc "Posts `text` in `space` as the Chat app, in `thread` if it's given, and says what Google made of it."
  def send_message(call, config, space, text, thread) do
    # A reply option only where there's a thread to reply in: with none, Google refuses it ("does not specify which
    # message to reply to") in a space whose messages are threaded.
    {body, path} =
      if thread,
        do: {%{"text" => text, "thread" => %{"name" => thread}}, "/messages?messageReplyOption=" <> @fallback},
        else: {%{"text" => text}, "/messages"}

    message = chat(call, config, @bot, "POST", space <> path, JSON.encode!(body))

    %{name: message["name"], thread: get_in(message, ["thread", "name"]) || thread, text: message["text"], create_time: message["createTime"]}
  end

  @doc "Changes what the message `name` says, for a message the Chat app posted."
  def edit_message(call, config, name, text) do
    message = chat(call, config, @bot, "PATCH", name <> "?updateMask=text", JSON.encode!(%{"text" => text}))
    %{name: message["name"], text: message["text"]}
  end

  @doc "Deletes the message `name`, for a message the Chat app posted."
  def delete_message(call, config, name) do
    chat(call, config, @bot, "DELETE", name)
    :ok
  end

  @doc "Watches `space` for messages and reactions, as the Chat app, with the events sent to the Pub/Sub topic `topic`."
  def subscribe(call, config, space, topic) do
    body = %{
      "targetResource" => "//chat.googleapis.com/" <> space,
      "eventTypes" => @event_types,
      "notificationEndpoint" => %{"pubsubTopic" => topic},
      "payloadOptions" => %{"includeResource" => true}
    }

    subscription = subscription!(request(call, config, @read, "POST", @events <> "subscriptions", JSON.encode!(body)))
    %{space: space, subscription: subscription["name"], expire_time: subscription["expireTime"]}
  end

  @doc "Stops watching the subscription `name`. One Google already ended (404) is already stopped."
  def unsubscribe(call, config, name) do
    case fetch(call, config, @bot, "DELETE", @events <> name) do
      %{status: status} when status in 200..299 or status == 404 -> :ok
      response -> refuse_or_raise!(config, @bot, "DELETE", @events <> name, response)
    end
  end

  @doc "Renews the subscription `name` for as long as Google lets it last, or `:not_found` where Google already ended it."
  def renew(call, config, name) do
    url = @events <> name <> "?updateMask=ttl"

    case fetch(call, config, @read, "PATCH", url, JSON.encode!(%{"ttl" => "0s"})) do
      %{status: status, body: body} when status in 200..299 ->
        renewed = subscription!(JSON.decode!(body))
        {:ok, %{subscription: renewed["name"], expire_time: renewed["expireTime"]}}

      %{status: 404} ->
        :not_found

      response ->
        refuse_or_raise!(config, @read, "PATCH", url, response)
    end
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
  What one Workspace Events event, or one event the Chat app is sent, says happened, in the same shape whatever
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

  defp query(values), do: values |> Enum.reject(fn {_name, value} -> is_nil(value) end) |> URI.encode_query()

  defp chat(call, config, scope, method, path, body \\ nil), do: request(call, config, scope, method, @chat <> path, body)

  # Google's API as the Chat app: a token from its key for `scope`, good for an hour, then the call itself. What a
  # person reads where Google refuses says what's missing for that call: adding the app to the space, or the admin's
  # approval for reading and watching.
  defp request(call, config, scope, method, url, body \\ nil) do
    case fetch(call, config, scope, method, url, body) do
      %{status: status, body: body} when status in 200..299 ->
        if body in [nil, ""], do: nil, else: JSON.decode!(body)

      response ->
        refuse_or_raise!(config, scope, method, url, response)
    end
  end

  defp fetch(call, config, scope, method, url, body \\ nil) do
    headers = %{"authorization" => "Bearer " <> token(call, config, scope), "content-type" => "application/json"}
    request = %{url: url, method: method, headers: headers}
    Call.fetch(call, if(body, do: Map.put(request, :body, body), else: request))
  end

  defp refuse_or_raise!(config, scope, method, url, %{status: status, body: body}) when status in [403, 404] do
    path = URI.parse(url).path
    msg = reason(body)
    app = config["display_name"] || "The Chat app"
    raise Call.Refused, "Google answered #{method} #{path} with #{status}: #{msg}\n\n#{advice(status, scope, path, msg, app)}"
  end

  defp refuse_or_raise!(_config, _scope, method, url, %{status: status, body: body}) do
    raise "Google answered #{method} #{URI.parse(url).path} with #{status}: #{reason(body)}"
  end

  defp advice(404, _scope, "/v1/subscriptions/" <> _, _msg, _app),
    do: "That Workspace Events subscription no longer exists at Google."

  defp advice(_status, @bot, _path, _msg, app),
    do: "#{app} posts, edits and deletes only in a space it's a member of: add it to the space in Google Chat."

  defp advice(404, @read, _path, _msg, app),
    do: "#{app} couldn't find that space: check the space name and make sure #{app} is a member of it in Google Chat."

  defp advice(403, @read, _path, msg, app) do
    if String.downcase(msg) =~ ~r/not a member|not in (this|the) space/,
      do: "#{app} reads only in a space it's a member of: add it to the space in Google Chat.",
      else: "Reading messages and watching a space need a Workspace admin's one-time approval of #{app} (Google Chat App's skill says how), and #{app} must be a member of the space."
  end

  defp token(call, config, scope) do
    %{"client_email" => email, "private_key" => pem} = key(call, config["vault_item"])
    form = URI.encode_query(%{"grant_type" => @grant, "assertion" => assertion(email, pem, scope)})

    case Call.fetch(call, %{url: @token, method: "POST", headers: %{"content-type" => "application/x-www-form-urlencoded"}, body: form}) do
      %{status: 200, body: body} ->
        JSON.decode!(body)["access_token"] || raise("Google gave Google Chat App no access token.")

      %{status: status, body: body} when status in [400, 403] and scope == @read ->
        msg = reason(body)
        app = config["display_name"] || "The Chat app"

        if String.downcase(msg) =~ ~r/unauthorized_client|access_denied|invalid_scope|admin|approv/,
          do: raise(Call.Refused, "Google gave Google Chat App no access token (#{status}): #{msg}\n\nReading messages and watching a space need a Workspace admin's one-time approval of #{app} (Google Chat App's skill says how)."),
          else: raise("Google gave Google Chat App no access token (#{status}): #{msg}")

      %{status: status, body: body} ->
        raise "Google gave Google Chat App no access token (#{status}): #{reason(body)}"
    end
  end

  # A JSON Web Token that says it's the service account, signed with its key (RS256), for `scope`.
  defp assertion(email, pem, scope) do
    now = System.system_time(:second)
    encode = &Base.url_encode64(JSON.encode!(&1), padding: false)
    signed = encode.(%{"alg" => "RS256", "typ" => "JWT"}) <> "." <> encode.(%{"iss" => email, "scope" => scope, "aud" => @token, "iat" => now, "exp" => now + 3600})
    [entry] = :public_key.pem_decode(pem)
    signed <> "." <> Base.url_encode64(:public_key.sign(signed, :sha256, :public_key.pem_entry_decode(entry)), padding: false)
  end

  # The service account the Vault item `item` keeps, as its JSON key file has it: its `client_email` and `private_key`.
  # It's in the Vault of whoever the app is installed for.
  defp key(call, item) do
    vault = %{call | actor: nil, subject: call.installed}

    json =
      try do
        Call.app(vault, "vault").value(vault, item, "service_account_json")
      rescue
        error ->
          raise Call.Refused,
                "Google Chat App can't use its Chat app's service account key yet.\n\n" <>
                  "Ask the Vault for it: vault_request with title #{item}, the field service_account_json (secret), " <>
                  "hosts [\"googleapis.com\"] and app google-chat-app. Its person answers on their own device. " <>
                  "The Vault said: #{Exception.message(error)}"
      end

    case JSON.decode(json) do
      {:ok, %{"client_email" => email, "private_key" => pem} = key} when is_binary(email) and is_binary(pem) -> key
      _ -> raise Call.Refused, "#{item}'s service_account_json isn't a service account's JSON key file."
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
