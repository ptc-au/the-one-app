defmodule OneCore.Events.Webhook do
  @moduledoc """
  A subscription's address, sent what happened as Standard Webhooks says
  (https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md): its `webhook-id`,
  `webhook-timestamp` and `webhook-signature`, each a `v1,<base64 HMAC-SHA256>` of `"<id>.<timestamp>.<body>"`, keyed
  with the subscription's secret, which starts with `whsec_` and is the key in base64.

  An id is the one message, kept for each of its tries; a timestamp is when each try is sent. A secret that was just
  replaced is signed beside the new one, space-delimited, until the one before is five minutes old
  (`OneCore.Events`).

  An address is sent to only if it's https, or http at this machine while the network is being built, and only if its
  name leads to public addresses: an event says what happened to someone, so one whose name leads into the network or
  into a machine behind it isn't sent to. That's checked again at each delivery, as a name may lead somewhere else than
  when it was subscribed, and redirects aren't followed, so an answer can't lead one out of it.
  """

  @timeout 5_000

  @doc """
  Whether `url` is an address an event is sent to: https, or http at `localhost` or `127.0.0.1` while the network is
  being built (`:development`), as a developer's own receiver is. `:ok`, or `{:error, why}`.
  """
  def address(url) when is_binary(url) do
    uri = URI.parse(url)

    cond do
      uri.scheme == "https" and is_binary(uri.host) ->
        :ok

      uri.scheme == "http" and local?(uri.host) ->
        :ok

      true ->
        {:error,
         "A subscription's delivery.url is an https address, whose receiver checks each delivery's signature, and " <>
           "#{given(url)} isn't one#{if development?(), do: " (http at localhost is, while a network is being built)"}"}
    end
  end

  def address(url),
    do: {:error, "A subscription's delivery.url is an https address, and #{given(url)} isn't one"}

  @doc """
  Whether events may be sent to `url` now: `address/1`, at a public address, as its name leads today. `:ok`, or
  `{:error, why}`.
  """
  def allowed?(url) do
    with :ok <- address(url) do
      host = URI.parse(url).host
      if local?(host), do: :ok, else: public(host)
    end
  end

  @doc """
  The headers a body is sent with, as Standard Webhooks has them: its kind, its id, the time it's sent at, its
  signature (`signature/4`) and the subscription it's for.
  """
  def headers(sub, id, timestamp, body) do
    [
      {"content-type", "application/json"},
      {"webhook-id", id},
      {"webhook-timestamp", timestamp},
      {"webhook-signature", signature(sub, id, timestamp, body)},
      {"x-mcp-subscription-id", sub["id"]}
    ]
  end

  @doc """
  The signature of `body`, sent as `id` at `timestamp`: `v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">` with
  the subscription's secret, and with the one it had before where that's still kept, space-delimited.
  """
  def signature(sub, id, timestamp, body) do
    signed = "#{id}.#{timestamp}.#{body}"

    sub
    |> secrets()
    |> Enum.map_join(" ", fn secret -> "v1," <> Base.encode64(:crypto.mac(:hmac, :sha256, key(secret), signed)) end)
  end

  # The key a Standard Webhooks secret is: its bytes after `whsec_`, in base64.
  defp key("whsec_" <> encoded), do: Base.decode64!(encoded)

  @doc """
  Sends `body` as the message `id` to the subscription's address, once: `:ok` where the receiver answered 2xx, or
  `{:error, why}` with what it answered, or why it wasn't reached. It's given five seconds, and follows no redirect.
  """
  def send(sub, id, body) do
    with :ok <- allowed?(sub["url"]) do
      post(sub, id, body)
    end
  end

  defp post(sub, id, body) do
    timestamp = Integer.to_string(System.system_time(:second))

    request = [
      method: :post,
      url: sub["url"],
      headers: headers(sub, id, timestamp, body),
      body: body,
      redirect: false,
      retry: false,
      receive_timeout: @timeout,
      connect_options: [timeout: @timeout]
    ]

    case Req.request(request) do
      {:ok, %{status: status}} when status in 200..299 -> :ok
      {:ok, %{status: status}} -> {:error, "it answered #{status}"}
      {:error, error} -> {:error, Exception.message(error)}
    end
  end

  # The secret now, and the one it replaced while that's still kept, the new one first.
  defp secrets(sub) do
    rotating =
      if sub["previousSecret"] && sub["previousSecretUntil"] > System.system_time(:millisecond),
        do: [sub["previousSecret"]],
        else: []

    [sub["secret"] | rotating]
  end

  # Whether a name leads only to addresses an event may be sent to: none of them is this network's or this machine's.
  defp public(host) do
    case addresses(host) do
      [] ->
        {:error, "#{host} isn't a name this server resolves, so it can't be sent what it subscribed to"}

      addresses ->
        if Enum.all?(addresses, &public?/1),
          do: :ok,
          else: {:error, "#{host} leads to an address in a network like this one, which a subscription isn't sent to"}
    end
  end

  defp addresses(host) do
    name = String.to_charlist(host)
    for family <- [:inet, :inet6], {:ok, found} <- [:inet.getaddrs(name, family)], address <- found, do: address
  end

  # An address a stranger's server can't reach: this machine's own, its network's, or one that's no machine's.
  defp public?({0, _, _, _}), do: false
  defp public?({10, _, _, _}), do: false
  defp public?({127, _, _, _}), do: false
  defp public?({169, 254, _, _}), do: false
  defp public?({172, second, _, _}) when second in 16..31, do: false
  defp public?({192, 168, _, _}), do: false
  defp public?({100, second, _, _}) when second in 64..127, do: false
  defp public?({first, _, _, _}) when first >= 224, do: false
  defp public?({_, _, _, _}), do: true

  # An IPv6 address mapped to IPv4 is the IPv4 address, as the IPv4 rules say.
  defp public?({0, 0, 0, 0, 0, 0xffff, high, low}),
    do: public?({div(high, 256), rem(high, 256), div(low, 256), rem(low, 256)})

  defp public?({0, 0, 0, 0, 0, 0, 0, 0}), do: false
  defp public?({0, 0, 0, 0, 0, 0, 0, 1}), do: false
  defp public?({first, _, _, _, _, _, _, _}) when first in 0xfe80..0xfebf, do: false
  defp public?({first, _, _, _, _, _, _, _}) when first in 0xfc00..0xfdff, do: false
  defp public?({first, _, _, _, _, _, _, _}) when first in 0xff00..0xffff, do: false
  defp public?({_, _, _, _, _, _, _, _}), do: true

  defp local?(host), do: development?() and host in ["localhost", "127.0.0.1"]

  defp development?, do: Application.get_env(:one_core, :development, false)

  defp given(value), do: inspect(value, limit: 4, printable_limit: 60)
end
