defmodule OneCore.Apps.Webhooks do
  @moduledoc """
  A webhook: an address at the network's edge that whoever a service is given it may ask, whatever it sends
  (`core/edge/mcp/mcp.ts`), `/webhooks/<owner>/<app>/<token>`, and the path after it. Nobody is signed in at it, so the
  token in it is all a caller has to know, and it's the secret: the app's `webhook/2` runs for whoever it leads to, with
  what came in, and answers the HTTP answer the caller gets (`OneCore.App`).

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
      [_, owner, app, token] -> {:ok, owner, app, token}
      nil -> {:error, "A webhook's name is #{@what}"}
    end
  end

  def named(_webhook), do: {:error, "A webhook's name is #{@what}"}

  @doc """
  The webhook a request asks for, `params`, for `owner`: `{:ok, webhook, app, token}`, its whole name, the app it runs
  and its token. What's asked has to be the webhook that came in, and one of that app's for them: otherwise it's
  `{:error, :forbidden, why}`, or `{:error, :invalid, why}` for a name that isn't a webhook's.
  """
  def asked(%{"app" => app, "webhook" => webhook} = params, owner) when is_binary(app) and is_binary(webhook) do
    with :ok <- came_in(params, webhook) do
      case named(webhook) do
        {:ok, ^owner, ^app, token} -> {:ok, webhook, app, token}
        {:ok, _owner, _app, _token} -> {:error, :forbidden, "#{app} has no webhook at that address for #{owner}"}
        {:error, why} -> {:error, :invalid, why}
      end
    end
  end

  def asked(_params, _owner),
    do: {:error, :invalid, "A webhook's request says its app, its webhook, and what came in at it"}

  @doc """
  What came in at a webhook, `said`, as its app's `webhook/2` is given it: its `method`, `path` and `query`, its
  `headers`, each a name and a value, its `body`, decoded, and the `token` from its address. `{:error, :invalid, why}`
  for what isn't what the edge sends.
  """
  def request(%{} = said, token) do
    with method when is_binary(method) <- said["method"],
         path when is_binary(path) <- said["path"],
         query when is_binary(query) <- said["query"],
         headers when is_list(headers) <- said["headers"],
         body when is_binary(body) <- said["body"],
         {:ok, body} <- Base.decode64(body) do
      {:ok, %{method: method, path: path, query: query, headers: heads(headers), body: body, token: token}}
    else
      _ -> {:error, :invalid, @came_in}
    end
  end

  def request(_said, _token), do: {:error, :invalid, @came_in}

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
