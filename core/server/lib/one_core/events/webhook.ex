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
  into a machine behind it isn't sent to. Its name is looked up once at each delivery, and the delivery connects to
  the address that was checked, with the name for TLS and `Host`, so a name that leads somewhere else a moment later
  (DNS rebinding) can't take it there. Redirects aren't followed, so an answer can't lead one out of it either.
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
    uri = URI.parse(sub["url"])

    with :ok <- address(sub["url"]),
         {:ok, at} <- resolved(uri.host) do
      post(sub, %{uri | host: at}, uri.host, id, body)
    end
  end

  defp post(sub, uri, host, id, body) do
    timestamp = Integer.to_string(System.system_time(:second))

    request = [
      method: :post,
      url: uri,
      headers: headers(sub, id, timestamp, body),
      body: body,
      redirect: false,
      retry: false,
      receive_timeout: @timeout,
      connect_options: [timeout: @timeout, hostname: host]
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
      if sub["previous_secret"] && sub["previous_until"] > System.system_time(:millisecond),
        do: [sub["previous_secret"]],
        else: []

    [sub["secret"] | rotating]
  end

  # The address a name leads to that a delivery connects to, once each of the addresses it leads to is one a stranger's
  # server can reach: `{:ok, address}`, as a URL's host has it, or `{:error, why}`. A developer's own receiver, at
  # this machine while the network is being built, is the one exception.
  defp resolved(host) do
    if local?(host) do
      {:ok, host}
    else
      case addresses(host) do
        [] ->
          {:error, "#{host} isn't a name this server resolves, so it can't be sent what it subscribed to"}

        [first | _] = addresses ->
          if Enum.all?(addresses, &public?/1),
            do: {:ok, at(first)},
            else: {:error, "#{host} leads to an address in a network like this one, which a subscription isn't sent to"}
      end
    end
  end

  defp addresses(host) do
    case :inet.parse_address(String.to_charlist(host)) do
      {:ok, address} -> [address]
      {:error, _} -> for family <- [:inet, :inet6], {:ok, found} <- [:inet.getaddrs(String.to_charlist(host), family)], address <- found, do: address
    end
  end

  defp at({_, _, _, _} = address), do: to_string(:inet.ntoa(address))
  defp at(address), do: "[#{:inet.ntoa(address)}]"

  # The ranges no stranger's server is in: this machine, private networks, carrier-grade NAT, link-local, benchmarking,
  # documentation, multicast and reserved addresses, as IANA's special-purpose registries list them, and IPv6's ways of
  # carrying an IPv4 address, which are checked as that address.
  @private [
    {{0, 0, 0, 0}, 8},
    {{10, 0, 0, 0}, 8},
    {{100, 64, 0, 0}, 10},
    {{127, 0, 0, 0}, 8},
    {{169, 254, 0, 0}, 16},
    {{172, 16, 0, 0}, 12},
    {{192, 0, 0, 0}, 24},
    {{192, 0, 2, 0}, 24},
    {{192, 88, 99, 0}, 24},
    {{192, 168, 0, 0}, 16},
    {{198, 18, 0, 0}, 15},
    {{198, 51, 100, 0}, 24},
    {{203, 0, 113, 0}, 24},
    {{224, 0, 0, 0}, 3},
    {{0, 0, 0, 0, 0, 0, 0, 0}, 127},
    {{0x100, 0, 0, 0, 0, 0, 0, 0}, 64},
    {{0x2001, 0, 0, 0, 0, 0, 0, 0}, 23},
    {{0x2001, 0xDB8, 0, 0, 0, 0, 0, 0}, 32},
    {{0xFC00, 0, 0, 0, 0, 0, 0, 0}, 7},
    {{0xFE80, 0, 0, 0, 0, 0, 0, 0}, 10},
    {{0xFF00, 0, 0, 0, 0, 0, 0, 0}, 8}
  ]

  # IPv4 mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96, 64:ff9b:1::/48) and 6to4 (2002::/16) carry an IPv4 address.
  defp public?({0, 0, 0, 0, 0, 0xFFFF, high, low}), do: public?(four(high, low))
  defp public?({0x64, 0xFF9B, 0, 0, 0, 0, high, low}), do: public?(four(high, low))
  defp public?({0x64, 0xFF9B, 1, _, _, _, _, _}), do: false
  defp public?({0x2002, high, low, _, _, _, _, _}), do: public?(four(high, low))
  defp public?(address), do: not Enum.any?(@private, fn {range, bits} -> within?(address, range, bits) end)

  defp four(high, low), do: {div(high, 256), rem(high, 256), div(low, 256), rem(low, 256)}

  defp within?(address, range, bits) when tuple_size(address) == tuple_size(range) do
    size = if tuple_size(address) == 4, do: 8, else: 16
    <<a::bitstring-size(^bits), _::bitstring>> = for(part <- Tuple.to_list(address), into: <<>>, do: <<part::size(size)>>)
    <<r::bitstring-size(^bits), _::bitstring>> = for(part <- Tuple.to_list(range), into: <<>>, do: <<part::size(size)>>)
    a == r
  end

  defp within?(_address, _range, _bits), do: false

  defp local?(host), do: development?() and host in ["localhost", "127.0.0.1"]

  defp development?, do: Application.get_env(:one_core, :development, false)

  defp given(value), do: inspect(value, limit: 4, printable_limit: 60)
end
