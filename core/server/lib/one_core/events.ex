defmodule OneCore.Events do
  @moduledoc """
  MCP's Events, as its extension `io.modelcontextprotocol/events` has them (SEP-3415): what happens in an app, which
  an agent or another app follows by polling for it, or by being sent each one at an address it gives.

  An app declares what happens in it with `events/0`, each with the `inputs` a subscriber filters by and the
  `outputs` that happened, and says one happened with `OneCore.Events.emit/4`. An event is named as an offered hook
  is, the app's name where it's installed and the event's: `board.message_posted`.

  What's emitted is kept here, for whoever the call that emitted it ran for, in the order it happened: the last 1,000
  events of the last seven days. A client reads them from a cursor, `ev_<n>`, which only moves forward. One that isn't
  one this server gave is refused, and one whose events have since gone is answered `truncated`, since some between
  it and what's kept aren't there any more. `events/list` says the events of the apps installed for whoever asks,
  `events/poll` what happened since a cursor, and `events/subscribe` has each one sent to an address.

  A subscription is a webhook, delivered as Standard Webhooks says (`OneCore.Events.Webhook`). Its id is made from who
  subscribed, who for, the address, the event and what it's filtered by, so the same subscription asked again is the
  same one. A secret that changed is kept beside the one before for five minutes, and each delivery in that time is
  signed with both. A subscription stops when it's unsubscribed, when what it lasts is over (`ttlMs`), or when the app
  that says the event is no longer installed for whoever it was subscribed for, whose address is told so.
  """
  use GenServer
  alias OneCore.Apps
  alias OneCore.Events.Webhook

  @extension "io.modelcontextprotocol/events"

  # What's kept of what happened for each owner: the last of these events, of those this long, in milliseconds.
  @most 1_000
  @kept :timer.hours(24 * 7)

  # How many events a poll gives at most where it doesn't say, and how long a client may wait before it polls again:
  # as a task's client checks back (`OneCore.Tasks`). It may ask for no more than are kept.
  @page 100
  @poll 1_000

  # How long a subscription lasts where it doesn't say, and at most, and how long the secret it had before a new one
  # is kept beside it, which each delivery in that time is signed with too.
  @ttl :timer.hours(1)
  @ttl_most :timer.hours(24)
  @rotated :timer.minutes(5)

  # How long a delivery waits before trying again, and how many times: a receiver that's down for a moment still gets
  # what happened, and one that's gone holds no task for long.
  @waits [1_000, 4_000, 16_000]

  @delivery [:poll, :webhook]

  @doc "What a server says it has of events, among its capabilities' extensions."
  def extension, do: %{@extension => %{}}

  @doc "Starts what keeps what happened, and what is sent it."
  def start_link(_args), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(nil) do
    :ets.new(__MODULE__, [:named_table, :public, :ordered_set, read_concurrency: true])
    {:ok, nil}
  end

  @doc """
  Says `event` happened in the app whose call is `call`, with `data` about it, for whoever that call runs for: it's
  kept from now on, and each webhook subscribed to it is sent it in the background.

  `opts` says what a subscription's `arguments` are matched against (`match`, which is `data` unless it says, for what
  a subscriber filters by that the app chose not to put in it), and the event's `_meta`. Raises where the app has no
  such event of its own, as `tools/0` says.
  """
  def emit(%OneCore.Call{app: app, subject: subject}, event, data, opts \\ []) do
    name = "#{app}.#{event}"

    case declared(name, subject) do
      {:ok, _event} ->
        now = System.system_time(:millisecond)
        seq = :ets.update_counter(__MODULE__, :seq, 1, {:seq, 0})
        normalized = OneCore.JSON.normalize(data)
        matched = if opts[:match], do: OneCore.JSON.normalize(opts[:match]), else: normalized
        occurrence = occurrence(name, normalized, seq, opts[:event_id], opts[:meta])
        :ets.insert(__MODULE__, {{:event, subject, seq}, now, occurrence})
        pruned(subject, now)

        for sub <- subscribed(subject, name), matches?(sub["arguments"], matched), do: told(sub, occurrence)

        :ok

      {:error, _code, why} ->
        raise why
    end
  end

  @doc """
  The events the apps installed for `subject` declare, as `events/list` answers them: each one's `name`, as
  `<app>.<event>`, its `description`, its `delivery` (of `"poll"` and `"webhook"`), the `inputSchema` a subscriber
  filters by and the `payloadSchema` that happened. A hundred are given at a time, and `cursor` goes on after the last
  one's name.
  """
  def list(params, subject) do
    events =
      for {app, version} <- Apps.running(subject), event <- version.events || [] do
        %{
          name: "#{app}.#{event.name}",
          description: event.description,
          delivery: for(step <- delivery(event), do: Atom.to_string(step)),
          inputSchema: event.inputs,
          payloadSchema: event.outputs
        }
      end
      |> Enum.sort_by(& &1.name)

    case params["cursor"] do
      nil -> page(events)
      cursor when is_binary(cursor) -> page(Enum.drop_while(events, &(&1.name <= cursor)))
      cursor -> {:error, -32602, "A cursor is one events/list gave, and #{given(cursor)} isn't."}
    end
  end

  @doc """
  What happened since a client's `cursor`, as `events/poll` answers it: `%{events, cursor, truncated, hasMore,
  nextPollMs}`. With no cursor, nothing is given and the cursor is now, so a client begins at what happens next.

  `maxAgeMs` leaves out what's older than that (the seven days that are kept, unless it says), `maxEvents` is how many
  at most are given (100, and 1,000 at most), and `arguments` filters them, as a subscription's do.
  """
  def poll(params, {_actor, subject}) do
    with {:ok, name} <- asked(params["name"]),
         {:ok, arguments} <- arguments(params["arguments"]),
         {:ok, from} <- cursor_of(params["cursor"]),
         {:ok, age} <- aged(params["maxAgeMs"]),
         {:ok, most} <- capped(params["maxEvents"]),
         {:ok, _event} <- declared(name, subject) do
      answered(name, arguments, from, age, most, logged(subject))
    end
  end

  @doc """
  Subscribes an address to `name`, as `events/subscribe` answers it: `%{id, refreshBefore, cursor, truncated,
  deliveryStatus}`.

  The address is a webhook, `delivery: %{mode: "webhook", url: "https://…", secret: "whsec_…"}`, and `ttlMs` is how
  long it lasts: an hour, and 24 hours at most, or nil for until it's unsubscribed, which `refreshBefore` is nil for.
  A cursor begins at what the client last polled, if it says. The same subscription asked again is the same one,
  keeping its place and what its deliveries have been like, unless what it lasts ran out meanwhile.
  """
  def subscribe(params, {actor, subject}) do
    with {:ok, name} <- asked(params["name"]),
         {:ok, event} <- declared(name, subject),
         {:ok, url, secret} <- delivery(params["delivery"], event),
         {:ok, ttl} <- ttl(Map.fetch(params, "ttlMs")),
         {:ok, arguments} <- arguments(params["arguments"]),
         {:ok, from} <- cursor_of(params["cursor"]) do
      now = System.system_time(:millisecond)
      id = id(actor, subject, url, name, arguments)

      record =
        upserted(existing(id, subject, name), %{
          id: id,
          actor: actor,
          subject: subject,
          name: name,
          url: url,
          secret: secret,
          ttl: ttl,
          arguments: arguments,
          from: from,
          now: now
        })

      :ets.insert(__MODULE__, {{:subscription, subject, name, id}, record})

      {:ok,
       %{
         resultType: "complete",
         id: id,
         refreshBefore: if(record["expiresAt"], do: iso(record["expiresAt"])),
         cursor: cursor(record["cursor"]),
         truncated: truncated?(record["cursor"], logged(subject)),
         deliveryStatus: record["deliveryStatus"]
       }}
    end
  end

  @doc "Unsubscribes the address a client gave from `name`, as `events/unsubscribe` answers it: `%{}`."
  def unsubscribe(params, {actor, subject}) do
    with {:ok, name} <- asked(params["name"]),
         {:ok, url} <- url(params["delivery"]),
         {:ok, arguments} <- arguments(params["arguments"]) do
      :ets.delete(__MODULE__, {:subscription, subject, name, id(actor, subject, url, name, arguments)})
      {:ok, %{resultType: "complete"}}
    end
  end

  # The event `name`, as the app installed for `subject` declares it (`OneCore.App`), or why no app of theirs says it.
  defp declared(name, subject) do
    found =
      for {app, version} <- Apps.running(subject),
          event <- version.events || [],
          "#{app}.#{event.name}" == name,
          do: event

    case found do
      [event | _] -> {:ok, event}
      [] -> {:error, -32023, "There's no event #{name} for #{subject}. events/list says the events there are."}
    end
  end

  # What a client polled for, from its params: `events/poll`'s answer.
  defp answered(_name, _arguments, nil, _age, _most, _events) do
    {:ok, polled([], head(), false, false)}
  end

  defp answered(name, arguments, from, age, most, events) do
    now = System.system_time(:millisecond)

    matched =
      for {seq, at, occurrence} <- events,
          seq > from,
          at >= now - age,
          occurrence["name"] == name,
          matches?(arguments, occurrence["data"]),
          do: {seq, occurrence}

    {given, more} = Enum.split(matched, most)

    last =
      case List.last(given) do
        {seq, _occurrence} -> seq
        nil -> head()
      end

    {:ok, polled(Enum.map(given, &elem(&1, 1)), last, truncated?(from, events), more != [])}
  end

  defp polled(events, last, truncated, has_more) do
    %{
      resultType: "complete",
      events: events,
      cursor: cursor(last),
      truncated: truncated,
      hasMore: has_more,
      nextPollMs: if(has_more, do: 0, else: @poll)
    }
  end

  # What's listed, a page at a time, and where to go on after it.
  defp page(events) do
    {page, more} = Enum.split(events, @page)
    listed = %{resultType: "complete", events: page}

    case more do
      [] -> {:ok, listed}
      _ -> {:ok, Map.put(listed, :nextCursor, List.last(page).name)}
    end
  end

  # An event as it's kept, and as a client is told it: its id, its name, when it happened, what happened, and the
  # cursor it's at.
  defp occurrence(name, data, seq, event_id, meta) do
    Map.merge(
      %{
        "eventId" => if(is_binary(event_id) and event_id != "", do: event_id, else: "evt_" <> random()),
        "name" => name,
        "timestamp" => DateTime.utc_now() |> DateTime.to_iso8601(),
        "data" => data,
        "cursor" => cursor(seq)
      },
      if(meta, do: %{"_meta" => OneCore.JSON.normalize(meta)}, else: %{})
    )
  end

  defp cursor(seq), do: "ev_#{seq}"
  defp cursor_of(nil), do: {:ok, nil}

  defp cursor_of(cursor) when is_binary(cursor) do
    case cursor do
      "ev_" <> digits when digits != "" -> {:ok, String.to_integer(digits)}
      _ -> refused(cursor)
    end
  rescue
    ArgumentError -> refused(cursor)
  end

  defp cursor_of(cursor), do: refused(cursor)

  defp refused(cursor),
    do: {:error, -32602, "A cursor is one this server gave, as ev_12, and #{given(cursor)} isn't one."}

  # The last cursor given out here, whether or not anything happened for this owner.
  defp head do
    case :ets.lookup(__MODULE__, :seq) do
      [{:seq, seq}] -> seq
      [] -> 0
    end
  end

  # What happened for `subject`, in the order it happened: `{seq, when it happened, event}`.
  defp logged(subject) do
    :ets.select(__MODULE__, [{{{:event, subject, :"$1"}, :"$2", :"$3"}, [], [{{:"$1", :"$2", :"$3"}}]}])
    |> Enum.sort()
  end

  # Whether some of what happened after the cursor `from` has gone: it's older than the oldest that's kept.
  defp truncated?(nil, _events), do: false

  defp truncated?(from, events) do
    oldest =
      case events do
        [{seq, _at, _occurrence} | _] -> seq
        [] -> head() + 1
      end

    from < oldest - 1
  end

  # What's kept of what happened for `subject`: the newest, and the last seven days' of them.
  defp pruned(subject, now) do
    events = logged(subject)
    expired = for {seq, at, _occurrence} <- events, at < now - @kept, do: seq
    excess = for {seq, _at, _occurrence} <- Enum.take(events, max(length(events) - @most, 0)), do: seq

    for seq <- Enum.uniq(expired ++ excess), do: :ets.delete(__MODULE__, {:event, subject, seq})
  end

  # The subscriptions that say `name` happened for `subject`, each as it's kept.
  defp subscribed(subject, name) do
    :ets.select(__MODULE__, [{{{:subscription, subject, name, :_}, :"$1"}, [], [:"$1"]}])
  end

  # Whether what happened is what a subscription's arguments filter by: each of them, by its name, is what happened's.
  defp matches?(arguments, _data) when map_size(arguments) == 0, do: true
  defp matches?(arguments, data) when is_map(data), do: Enum.all?(arguments, fn {name, value} -> data[name] == value end)
  defp matches?(_arguments, _data), do: false

  # What a subscription is sent, and what it's sent it as: an id that's the same for every try, and a body of JSON.
  defp told(sub, occurrence) do
    Task.Supervisor.start_child(OneCore.Asks, fn -> delivered(sub, occurrence) end)
  end

  defp delivered(sub, occurrence) do
    tried(sub, "msg_" <> random(), JSON.encode!(occurrence), @waits)
  end

  # A delivery, tried again after each wait where the receiver didn't take it, and what the subscription's deliveries
  # have been like said as it goes. One unsubscribed meanwhile, or whose time is up, is sent nothing more, and one whose
  # event's app is no longer installed for whoever it was for is told it stops.
  defp tried(sub, id, body, waits) do
    cond do
      subscription(sub) == nil -> :ok
      expired?(sub) -> forgotten(sub)
      not installed?(sub) -> terminated(sub)
      true -> attempt(sub, id, body, waits)
    end
  end

  defp attempt(sub, id, body, waits) do
    case Webhook.send(sub, id, body) do
      :ok ->
        status(sub, %{
          "active" => true,
          "lastDeliveryAt" => iso(System.system_time(:millisecond)),
          "lastError" => nil,
          "failedSince" => nil
        })

      {:error, why} ->
        failed(sub, why)

        case waits do
          [] ->
            :ok

          [wait | rest] ->
            # A receiver that's briefly unreachable is sent it again, as Standard Webhooks' senders do.
            Process.sleep(wait)
            tried(sub, id, body, rest)
        end
    end
  end

  # The app that says `name` isn't installed for whoever the subscription was for any more: its address is told that
  # it stops, and it's gone.
  defp terminated(sub) do
    body = %{"type" => "terminated", "error" => %{"code" => -32024, "message" => "Forbidden"}}
    Webhook.send(sub, "msg_terminated_" <> random(), JSON.encode!(body))
    forgotten(sub)
  end

  defp forgotten(sub) do
    :ets.delete(__MODULE__, key(sub))
    :ok
  end

  defp expired?(sub) do
    expires = sub["expiresAt"]
    expires != nil and expires <= System.system_time(:millisecond)
  end

  defp installed?(sub), do: match?({:ok, _event}, declared(sub["name"], sub["subject"]))

  defp subscription(sub), do: stored(key(sub))

  defp stored(key) do
    case :ets.lookup(__MODULE__, key) do
      [{_key, record}] -> record
      [] -> nil
    end
  end

  defp key(sub), do: {:subscription, sub["subject"], sub["name"], sub["id"]}

  defp status(sub, status), do: update(sub, fn _stored -> status end)

  defp failed(sub, why) do
    now = iso(System.system_time(:millisecond))
    update(sub, &Map.merge(&1, %{"lastError" => why, "failedSince" => &1["failedSince"] || now}))
  end

  # What a subscription's deliveries have been like, where it's still subscribed.
  defp update(sub, change) do
    case subscription(sub) do
      nil -> :ok
      stored -> :ets.insert(__MODULE__, {key(stored), %{stored | "deliveryStatus" => change.(stored["deliveryStatus"])}})
    end
  end

  defp upserted(nil, fresh) do
    %{
      "id" => fresh.id,
      "actor" => fresh.actor,
      "subject" => fresh.subject,
      "name" => fresh.name,
      "url" => fresh.url,
      "secret" => fresh.secret,
      "previousSecret" => nil,
      "previousSecretUntil" => nil,
      "arguments" => fresh.arguments,
      "expiresAt" => expires(fresh),
      "cursor" => fresh.from || head(),
      "deliveryStatus" => active()
    }
  end

  defp upserted(existing, fresh) do
    live = if existing["expiresAt"] == nil or existing["expiresAt"] > fresh.now, do: existing

    # A secret that changed is kept beside the one before for five minutes, so what's sent while the receiver moves to
    # the new one is taken with either.
    {previous, until} =
      case live && live["secret"] do
        nil -> {nil, nil}
        secret when secret == fresh.secret -> {live["previousSecret"], live["previousSecretUntil"]}
        secret -> {secret, fresh.now + @rotated}
      end

    %{
      "id" => fresh.id,
      "actor" => fresh.actor,
      "subject" => fresh.subject,
      "name" => fresh.name,
      "url" => fresh.url,
      "secret" => fresh.secret,
      "previousSecret" => previous,
      "previousSecretUntil" => until,
      "arguments" => fresh.arguments,
      "expiresAt" => expires(fresh),
      "cursor" => fresh.from || (live && live["cursor"]) || head(),
      "deliveryStatus" => (live && live["deliveryStatus"]) || active()
    }
  end

  defp expires(fresh), do: if(fresh.ttl, do: fresh.now + fresh.ttl)
  defp active, do: %{"active" => true, "lastDeliveryAt" => nil, "lastError" => nil, "failedSince" => nil}

  defp existing(id, subject, name), do: stored({:subscription, subject, name, id})

  # A subscription's id: the same for the same subscriber, address, event and filter, on any server that speaks this.
  defp id(actor, subject, url, name, arguments) do
    key = JSON.encode!([actor, subject, url, name, canonical(arguments)])

    "sub_" <> (Base.encode16(:crypto.hash(:sha256, key), case: :lower) |> binary_part(0, 16))
  end

  # What a value is, as JSON holds it, whatever order a map's keys came in: so the same arguments are the same key.
  defp canonical(value) when is_map(value) do
    keys = Enum.sort(Map.keys(value))
    "{" <> Enum.map_join(keys, ",", fn key -> JSON.encode!(key) <> ":" <> canonical(value[key]) end) <> "}"
  end

  defp canonical(value) when is_list(value), do: "[" <> Enum.map_join(value, ",", &canonical/1) <> "]"
  defp canonical(value), do: JSON.encode!(value)

  defp delivery(%{"mode" => "webhook"} = said, event) do
    with {:ok, url} <- url(said),
         :ok <- addressed(url),
         :ok <- secret(said["secret"]),
         :ok <- webhook?(event),
         do: {:ok, url, said["secret"]}
  end

  defp delivery(said, _event) do
    mode = with %{} <- said, do: said["mode"]

    {:error, -32602,
     "An event is subscribed to with delivery: %{mode: \"webhook\", url: \"https://…\", secret: \"whsec_…\"}, and this " <>
       "says #{given(mode)}. Polling needs no subscription: events/poll reads what happened."}
  end

  defp url(%{"url" => url}) when is_binary(url), do: {:ok, url}

  defp url(said),
    do: {:error, -32602, "A delivery says the url it's sent to, at least: %{url: \"https://…\"}, and this is #{given(said)}."}

  # Whether the url is one an event is sent to, as a refused subscription is told.
  defp addressed(url) do
    case Webhook.address(url) do
      :ok -> :ok
      {:error, why} -> {:error, -32602, why}
    end
  end

  # The secret is Standard Webhooks': the prefix `whsec_` and the key in base64, 24 to 64 bytes of it.
  defp secret("whsec_" <> encoded = secret) do
    case Base.decode64(encoded) do
      {:ok, key} when byte_size(key) in 24..64 -> :ok
      _ -> {:error, -32602, secret_problem(secret)}
    end
  end

  defp secret(secret), do: {:error, -32602, secret_problem(secret)}

  defp secret_problem(_secret) do
    "A delivery's secret is whsec_ and the key in base64, as Standard Webhooks has it, 24 to 64 bytes of it: a " <>
      "receiver checks each delivery's signature with it."
  end

  # An event that's polled only isn't subscribed to.
  defp webhook?(event) do
    if :webhook in delivery(event),
      do: :ok,
      else: {:error, -32602, "That event is polled only: its events/0 says delivery: [:poll]."}
  end

  defp delivery(event), do: event[:delivery] || @delivery

  defp ttl(:error), do: {:ok, @ttl}

  defp ttl({:ok, nil}), do: {:ok, nil}

  defp ttl({:ok, ttl}) when is_integer(ttl) and ttl > 0 and ttl <= @ttl_most, do: {:ok, ttl}

  defp ttl({:ok, ttl}) do
    {:error, -32602,
     "A subscription lasts ttlMs milliseconds, at most #{@ttl_most}, or null for until it's unsubscribed, and this is #{given(ttl)}."}
  end

  defp arguments(nil), do: {:ok, %{}}

  defp arguments(%{} = arguments) do
    {:ok, OneCore.JSON.normalize(arguments)}
  rescue
    _ -> {:error, -32602, "An event's arguments are a map of what it's filtered by, as JSON holds one."}
  end

  defp arguments(arguments),
    do: {:error, -32602, "An event's arguments are a map of what it's filtered by, and this is #{given(arguments)}."}

  defp aged(nil), do: {:ok, @kept}

  defp aged(age) when is_integer(age) and age >= 0 and age <= @kept, do: {:ok, age}

  defp aged(age), do: {:error, -32602, "maxAgeMs is how long ago events may be, up to #{@kept}, and this is #{given(age)}."}

  defp capped(nil), do: {:ok, @page}

  defp capped(most) when is_integer(most) and most > 0 and most <= @most, do: {:ok, most}

  defp capped(most), do: {:error, -32602, "maxEvents is how many events at most, at most #{@most}, and this is #{given(most)}."}

  defp asked(name) when is_binary(name) and name != "", do: {:ok, name}
  defp asked(name), do: {:error, -32602, "An event is named <app>.<event>, as events/list gives it, and this is #{given(name)}."}

  defp iso(milliseconds), do: milliseconds |> DateTime.from_unix!(:millisecond) |> DateTime.to_iso8601()

  defp random, do: Base.url_encode64(:crypto.strong_rand_bytes(12), padding: false)

  defp given(value), do: inspect(value, limit: 4, printable_limit: 40)
end
