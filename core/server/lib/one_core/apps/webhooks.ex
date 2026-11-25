defmodule OneCore.Apps.Webhooks do
  @moduledoc """
  A webhook: an address at the network's edge that whoever a service is given it may ask, whatever it sends
  (`core/edge/mcp/mcp.ts`), `/webhooks/<owner>/<app>/<token>`, and the path after it. Nobody is signed in at it, so the
  token in it is all a caller has to know, and it's the secret: the app's `webhook/2` runs for whoever it leads to, with
  what came in, and answers the HTTP answer the caller gets (`OneCore.App`).

  One Core makes each token (`create/3`) and keeps only its SHA-256, by the name the app gave it, in
  `<owner>/webhooks/<app>.json`, as GitHub keeps its tokens. A token it didn't make is answered 404 before any of the
  app's code runs, and the app is given the webhook's name, never the token.

  It's one JSON-RPC request, `webhooks/http`, which says which webhook came in in its `_meta`, and asks for that one
  and nothing else (`OneCore.Mcp`). A server that runs the app elsewhere passes on what it was asked, as it does any
  call of its (`OneCore.Apps.Calls`), in the shape `said/1` gives one and `request/2` takes back.
  """

  # A webhook's name, as the edge says it: whose it leads to, the app it runs and its token.
  @named ~r"\A((?:users|groups)/[^/]+|network)/([a-z0-9][a-z0-9-]*)/([A-Za-z0-9_-]{32,128})\z"
  @what "<owner>/<app>/<token>, where owner is users/<name>, groups/<name> or network"
  @came_in """
  What came in at a webhook says its method, the path after the token and the query, its headers, and its body in
  base64.
  """
  @answers """
  A webhook answers {:ok, %{status: 200, headers: [], body: ""}}: a status from 100 to 599, each header a name and a
  value, as a list, and the text to send.
  """

  @doc """
  Whose a webhook named `webhook` leads to, the app it runs and its token, or `{:error, why}` for a name that isn't
  one: `users/alice/todo/<token>` leads to `users/alice` and runs `todo`.
  """
  def named(webhook) when is_binary(webhook) do
    case Regex.run(@named, webhook) do
      # A webhook given to a service before its owner was renamed leads to them still.
      [_, owner, app, token] -> {:ok, OneCore.User.renamed(owner), app, token}
      nil -> {:error, "A webhook's name is #{@what}"}
    end
  end

  def named(_webhook), do: {:error, "A webhook's name is #{@what}"}

  @doc """
  Makes a webhook named `name` for the app `app` installed for `owner`, in place of the one of that name before, and
  gives its address after the network's: `/webhooks/<owner>/<app>/<token>`. Its token is shown only here, so the app
  keeps the address it's given, to tell a service.
  """
  def create(owner, app, name) when is_binary(name) and name != "" do
    token = Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)

    :ok =
      OneCore.Bucket.update(kept(owner, app), fn was ->
        made = if was, do: JSON.decode!(was), else: %{}
        JSON.encode!(made |> Map.reject(fn {_hash, named} -> named == name end) |> Map.put(hashed(token), name))
      end)

    "/webhooks/#{owner}/#{app}/#{token}"
  end

  @doc """
  The webhook a request asks for, `params`, for `owner`: `{:ok, webhook, app, name}`, its whole address, the app it
  runs and the name the app gave it (`create/3`). What's asked has to be the webhook that came in, one of that app's
  for them, and one One Core made: otherwise it's `{:error, :forbidden, why}`, `{:error, :not_found, why}`, or
  `{:error, :invalid, why}` for an address that isn't a webhook's.
  """
  def asked(%{"app" => app, "webhook" => webhook} = params, owner) when is_binary(app) and is_binary(webhook) do
    with :ok <- came_in(params, webhook) do
      case named(webhook) do
        {:ok, ^owner, ^app, token} -> made(owner, app, token, OneCore.User.renamed(webhook))
        {:ok, _owner, _app, _token} -> {:error, :forbidden, "#{app} has no webhook at that address for #{owner}"}
        {:error, why} -> {:error, :invalid, why}
      end
    end
  end

  def asked(_params, _owner),
    do: {:error, :invalid, "A webhook's request says its app, its webhook, and what came in at it"}

  @doc """
  What came in at a webhook, `said`, as its app's `webhook/2` is given it: its `method`, `path` and `query`, its
  `headers`, each a name and a value, its `body`, decoded, and the `name` the app gave the webhook (`create/3`).
  `{:error, :invalid, why}` for what isn't what the edge sends.
  """
  def request(%{} = said, name) do
    with method when is_binary(method) <- said["method"],
         path when is_binary(path) <- said["path"],
         query when is_binary(query) <- said["query"],
         headers when is_list(headers) <- said["headers"],
         body when is_binary(body) <- said["body"],
         {:ok, body} <- Base.decode64(body) do
      {:ok, %{method: method, path: path, query: query, headers: heads(headers), body: body, name: name}}
    else
      _ -> {:error, :invalid, @came_in}
    end
  end

  def request(_said, _name), do: {:error, :invalid, @came_in}

  @doc """
  What came in at a webhook, `request`, as the edge says one, which `request/2` reads back: what a server that runs the
  app elsewhere passes on as it was asked.
  """
  def said(request) do
    %{
      "method" => request.method,
      "path" => request.path,
      "query" => request.query,
      "headers" => for({name, value} <- request.headers, do: [name, value]),
      "body" => Base.encode64(request.body)
    }
  end

  @doc """
  What an app answered a webhook, `answer`, as the edge answers the caller with it: `{:ok, answer}` with the `status`,
  each header a name and a value, and the `body` in base64, or `{:error, why}` with what a webhook answers said.
  """
  def answered(%{} = answer) do
    answer = Map.new(answer, fn {name, value} -> {to_string(name), value} end)

    %{"status" => status, "headers" => headers, "body" => body} =
      Map.merge(%{"status" => 200, "headers" => [], "body" => ""}, answer)

    with true <- is_integer(status) and status in 100..599,
         {:ok, headers} <- sent(headers),
         true <- is_binary(body) do
      {:ok, %{"status" => status, "headers" => headers, "body" => Base.encode64(body)}}
    else
      _ -> {:error, @answers}
    end
  end

  def answered(_answer), do: {:error, @answers}

  # The webhook at `token` of `app` for `owner`, by the name the app gave it, where One Core made it. Each kept hash is
  # compared in constant time, so how long that takes says nothing of a token.
  defp made(owner, app, token, webhook) do
    hash = hashed(token)

    found =
      case OneCore.Bucket.read(kept(owner, app)) do
        {:ok, data, _tag} -> Enum.find_value(JSON.decode!(data), fn {kept, name} -> :crypto.hash_equals(kept, hash) && name end)
        :absent -> nil
      end

    if found,
      do: {:ok, webhook, app, found},
      else: {:error, :not_found, "#{app} has no webhook at that address for #{owner}"}
  end

  defp kept(owner, app), do: "#{owner}/webhooks/#{app}.json"
  defp hashed(token), do: Base.encode16(:crypto.hash(:sha256, token), case: :lower)

  # What came in at the network's address says which webhook it came in at, and asks for that one. A server that runs
  # the app elsewhere passes on what it was asked instead, and says who asked and who for, which it's held to there.
  defp came_in(%{"_meta" => %{"webhook" => said}}, webhook) when said != webhook,
    do: {:error, :forbidden, "A webhook asks only for the webhook that came in"}

  defp came_in(_params, _webhook), do: :ok

  # Headers a caller sent, as the edge says them, each a name and a value, which an app is given as a pair.
  defp heads(headers), do: for([name, value] <- headers, is_binary(name) and is_binary(value), do: {name, value})

  # The headers an app answers with, each a name and a value: it writes each as a pair or a list.
  defp sent(headers) when is_list(headers) do
    pairs = Enum.map(headers, &pair/1)
    if nil in pairs, do: :error, else: {:ok, pairs}
  end

  defp sent(_headers), do: :error

  defp pair({name, value}) when is_binary(name) and is_binary(value), do: [name, value]
  defp pair([name, value]) when is_binary(name) and is_binary(value), do: [name, value]
  defp pair(_header), do: nil
end
