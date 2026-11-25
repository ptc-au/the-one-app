defmodule OneCore.Events do
  @moduledoc """
  What happens in an app, as MCP's extension `io.modelcontextprotocol/events` has it (SEP-3415): an agent or another
  app follows it by polling for it, by being sent each one at an address it gives, or, inside the network, by hooking
  into it as an observe hook.

  An app declares what happens in it with `events/0`, each with the `inputs` a subscriber filters by and the
  `outputs` that happened, and says one happened with `OneCore.Events.emit/3`, once: each app that hooks into it
  (`hooks/0`) is told, as of any observe hook (`OneCore.Hooks.observe/3`), and each subscription is sent it. An event is
  named as a hook is, the app's name where it's installed and the event's: `board.message_posted`.

  What happened and who subscribed are kept in the app's own database (the `database` app, which an app with events
  requires), in the tables `events_log`, `events_subscriptions` and `events_retries`, so every server acting for
  whoever it's for sees the same order, and each event costs one write. The last 1,000 events of the last seven days
  are kept. A client reads them from a cursor, `ev_<n>`, which only moves forward. One whose events have since gone is
  answered `truncated`. `events/list` says the events of the apps installed for whoever asks, `events/poll` what
  happened since a cursor, and `events/subscribe` has each one sent to an address.

  A subscription is a webhook, delivered as Standard Webhooks says (`OneCore.Events.Webhook`). Its id is made from who
  subscribed, who for, the address, the event and what it's filtered by, so the same subscription asked again is the
  same one. A secret that changed is kept beside the one before for five minutes, and each delivery in that time is
  signed with both. Its secret is kept with the rest of the app's data, which is encrypted where its owner has a key
  (the `encryption` app). What its deliveries have been like is written only when it changes. A delivery that fails
  is tried again, as Standard Webhooks' senders do, by a timer of the app's database, three times at most. A
  subscription stops when it's unsubscribed, or when what it lasts is over (`ttlMs`).
  """
  alias OneCore.{Apps, Call, Hooks, Server}
  alias OneCore.Apps.Calls
  alias OneCore.Events.Webhook

  @extension "io.modelcontextprotocol/events"

  # What's kept of what happened for each app and owner: the last of these events, of those this long, in
  # milliseconds.
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

  # How long a delivery that failed waits before it's tried again, in seconds, each time: a receiver that's down for a
  # while still gets what happened, and one that's gone is given up on within the hour. A database timer fires within
  # a minute of when it's due (`OneCore.Jobs`).
  @waits [60, 300, 1_800]

  # The timer of an app's database that tries again what failed (`Database.timer/5`), which `OneCore.Apps.Calls.fire/4`
  # has this module run.
  @retry "events/deliver"

  @delivery [:poll, :webhook]

  @tables [
    "create table if not exists events_log (seq integer primary key, at integer not null, name text not null, occurrence text not null)",
    "create table if not exists events_subscriptions (id text primary key, actor text, name text not null, url text not null, secret text not null, previous_secret text, previous_until integer, arguments text not null, expires_at integer, cursor integer not null, active integer not null, last_delivery_at integer, last_error text, failed_since integer)",
    "create table if not exists events_retries (id text primary key, subscription text not null, body text not null, tries integer not null, at integer not null)"
  ]

  @doc "What a server says it has of events, among its capabilities' extensions."
  def extension, do: %{@extension => %{}}

  @doc "The timer of an app's database that tries again a delivery that failed."
  def retry, do: @retry

  @doc """
  Says `event` happened in the app whose call is `call`, with `data` about it, for whoever that call runs for: it's
  kept from now on, each app that hooks into it is told, and each webhook subscribed to it is sent it in the
  background. Raises where the app has no such event of its own, as `events/0` says.
  """
  def emit(%Call{app: app, actor: actor, subject: subject} = call, event, data) do
    name = "#{app}.#{event}"
    with {:error, _code, why} <- declared(name, subject), do: raise(why)
    data = OneCore.JSON.normalize(data)
    now = System.system_time(:millisecond)

    {occurrence, subscriptions} =
      transaction(call, fn db ->
        [%{"seq" => seq}] = query(db, "select coalesce(max(seq), 0) + 1 as seq from events_log")
        occurrence = occurrence(name, data, seq)
        query(db, "insert into events_log (seq, at, name, occurrence) values (?, ?, ?, ?)", [seq, now, name, JSON.encode!(occurrence)])
        query(db, "delete from events_log where seq <= ? or at < ?", [seq - @most, now - @kept])
        query(db, "delete from events_subscriptions where expires_at <= ?", [now])
        {occurrence, query(db, "select * from events_subscriptions where name = ?", [name])}
      end)

    Hooks.observe(name, data, {actor, subject})
    body = JSON.encode!(occurrence)

    for subscription <- subscriptions, matches?(JSON.decode!(subscription["arguments"]), data) do
      Task.Supervisor.start_child(OneCore.Asks, fn -> delivered(call, subscription, "msg_" <> random(), body) end)
    end

    :ok
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
  def poll(params, principal, forwarded) do
    with {:ok, name} <- asked(params["name"]),
         {:ok, arguments} <- arguments(params["arguments"]),
         {:ok, from} <- cursor_of(params["cursor"]),
         {:ok, age} <- aged(params["maxAgeMs"]),
         {:ok, most} <- capped(params["maxEvents"]),
         {:ok, _event} <- declared(name, elem(principal, 1)) do
      within(name, {"events/poll", params}, principal, forwarded, fn call ->
        now = System.system_time(:millisecond)

        {head, oldest, rows} =
          transaction(call, fn db ->
            [%{"head" => head, "oldest" => oldest}] = query(db, "select coalesce(max(seq), 0) as head, min(seq) as oldest from events_log")
            rows = if from, do: query(db, "select seq, occurrence from events_log where seq > ? and at >= ? and name = ? order by seq", [from, now - age, name]), else: []
            {head, oldest, rows}
          end)

        matched =
          for %{"seq" => seq, "occurrence" => kept} <- rows,
              occurrence = JSON.decode!(kept),
              matches?(arguments, occurrence["data"]),
              do: {seq, occurrence}

        # The cursor is after what's given, or after everything that's there where nothing more matches.
        {given, more} = Enum.split(matched, most)
        last = if more == [], do: head, else: elem(List.last(given), 0)

        {:ok,
         %{
           resultType: "complete",
           events: Enum.map(given, &elem(&1, 1)),
           cursor: cursor(last),
           truncated: truncated?(from, head, oldest),
           hasMore: more != [],
           nextPollMs: if(more != [], do: 0, else: @poll)
         }}
      end)
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
  def subscribe(params, {actor, subject} = principal, forwarded) do
    with {:ok, name} <- asked(params["name"]),
         {:ok, event} <- declared(name, subject),
         {:ok, url, secret} <- delivery(params["delivery"], event),
         {:ok, ttl} <- ttl(Map.fetch(params, "ttlMs")),
         {:ok, arguments} <- arguments(params["arguments"]),
         {:ok, from} <- cursor_of(params["cursor"]) do
      id = id(actor, subject, url, name, arguments)

      within(name, {"events/subscribe", params}, principal, forwarded, fn call ->
        now = System.system_time(:millisecond)
        expires = if ttl, do: now + ttl

        {kept, head, oldest} =
          transaction(call, fn db ->
            [%{"head" => head, "oldest" => oldest}] = query(db, "select coalesce(max(seq), 0) as head, min(seq) as oldest from events_log")
            live = List.first(query(db, "select * from events_subscriptions where id = ? and (expires_at is null or expires_at > ?)", [id, now]))

            # A secret that changed is kept beside the one before for five minutes, so what's sent while the receiver
            # moves to the new one is taken with either.
            {previous, until} =
              cond do
                live == nil -> {nil, nil}
                live["secret"] == secret -> {live["previous_secret"], live["previous_until"]}
                true -> {live["secret"], now + @rotated}
              end

            kept =
              Map.merge(live || %{"active" => 1, "last_delivery_at" => nil, "last_error" => nil, "failed_since" => nil}, %{
                "id" => id,
                "actor" => actor,
                "name" => name,
                "url" => url,
                "secret" => secret,
                "previous_secret" => previous,
                "previous_until" => until,
                "arguments" => JSON.encode!(arguments),
                "expires_at" => expires,
                "cursor" => from || (live && live["cursor"]) || head
              })

            columns = Map.keys(kept)

            query(
              db,
              "insert or replace into events_subscriptions (#{Enum.join(columns, ", ")}) values (#{Enum.map_join(columns, ", ", fn _ -> "?" end)})",
              Enum.map(columns, &kept[&1])
            )

            {kept, head, oldest}
          end)

        {:ok,
         %{
           resultType: "complete",
           id: id,
           refreshBefore: if(expires, do: iso(expires)),
           cursor: cursor(kept["cursor"]),
           truncated: truncated?(kept["cursor"], head, oldest),
           deliveryStatus: status(kept)
         }}
      end)
    end
  end

  @doc "Unsubscribes the address a client gave from `name`, as `events/unsubscribe` answers it: `%{}`."
  def unsubscribe(params, {actor, subject} = principal, forwarded) do
    with {:ok, name} <- asked(params["name"]),
         {:ok, url} <- url(params["delivery"]),
         {:ok, arguments} <- arguments(params["arguments"]),
         {:ok, _event} <- declared(name, subject) do
      id = id(actor, subject, url, name, arguments)

      within(name, {"events/unsubscribe", params}, principal, forwarded, fn call ->
        transaction(call, fn db ->
          query(db, "delete from events_subscriptions where id = ?", [id])
          query(db, "delete from events_retries where subscription = ?", [id])
        end)

        {:ok, %{resultType: "complete"}}
      end)
    end
  end

  @doc """
  Tries again each delivery of the app whose call is `call` that failed and is due, as its database's timer has it,
  and sets that timer for the next. One whose subscription has gone, or whose tries are over, is given up on.
  """
  def redeliver(%Call{} = call) do
    now = System.system_time(:millisecond)

    due =
      transaction(call, fn db ->
        query(db, "select r.id as retry, r.body, r.tries, s.* from events_retries r join events_subscriptions s on s.id = r.subscription where r.at <= ?", [div(now, 1000)])
      end)

    for retry <- due do
      case Webhook.send(retry, retry["retry"], retry["body"]) do
        :ok ->
          transaction(call, fn db ->
            query(db, "delete from events_retries where id = ?", [retry["retry"]])
            succeeded(db, retry)
          end)

        {:error, why} ->
          transaction(call, fn db ->
            case Enum.at(@waits, retry["tries"]) do
              nil -> query(db, "delete from events_retries where id = ?", [retry["retry"]])
              wait -> query(db, "update events_retries set tries = tries + 1, at = ? where id = ?", [div(now, 1000) + wait, retry["retry"]])
            end

            failed(db, retry, why)
          end)
      end
    end

    timed(call)
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

  # Runs `fun` with a call of the app whose event `name` is, for whoever `principal` is for, where its database is. A
  # server that doesn't run the app passes it on, and answers what the server that does answered.
  defp within(name, ask, principal, forwarded, fun) do
    [app, _event] = String.split(name, ".", parts: 2)

    case Calls.within(app, ask, principal, forwarded, fun) do
      {:forwarded, result} -> {:ok, result}
      :forwarding_loop -> Server.forwarding_loop(name)
      outcome -> outcome
    end
  end

  defp transaction(call, fun) do
    database = Call.app(call, "database")

    database.transaction(call, fn db ->
      for table <- @tables, do: database.query(db, table)
      fun.({database, db})
    end)
  end

  defp query({database, db}, sql, values \\ []), do: database.query(db, sql, values)

  # A delivery, sent once at once. One that failed is tried again later, by a timer of the app's database.
  defp delivered(call, subscription, id, body) do
    case Webhook.send(subscription, id, body) do
      :ok ->
        if subscription["active"] != 1 or subscription["last_delivery_at"] == nil,
          do: transaction(call, &succeeded(&1, subscription))

      {:error, why} ->
        now = System.system_time(:second)

        transaction(call, fn db ->
          query(db, "insert into events_retries (id, subscription, body, tries, at) values (?, ?, ?, 0, ?)", [id, subscription["id"], body, now + hd(@waits)])
          failed(db, subscription, why)
        end)

        timed(call)
    end
  end

  # What a subscription's deliveries have been like, written only where it changed.
  defp succeeded(db, subscription) do
    query(
      db,
      "update events_subscriptions set active = 1, last_delivery_at = ?, last_error = null, failed_since = null where id = ? and (active = 0 or last_error is not null or last_delivery_at is null)",
      [System.system_time(:millisecond), subscription["id"]]
    )
  end

  defp failed(db, subscription, why) do
    query(
      db,
      "update events_subscriptions set last_error = ?, failed_since = coalesce(failed_since, ?) where id = ? and (last_error is null or last_error != ?)",
      [why, System.system_time(:millisecond), subscription["id"], why]
    )
  end

  # Sets the app's database timer for its next retry, or takes it away where there's none.
  defp timed(call) do
    next = transaction(call, fn db -> with [%{"next" => next}] <- query(db, "select min(at) as next from events_retries"), do: next end)
    Call.app(call, "database").timer(call, @retry, %{}, next)
  end

  defp status(subscription) do
    %{
      active: subscription["active"] == 1,
      lastDeliveryAt: if(subscription["last_delivery_at"], do: iso(subscription["last_delivery_at"])),
      lastError: subscription["last_error"],
      failedSince: if(subscription["failed_since"], do: iso(subscription["failed_since"]))
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
  defp occurrence(name, data, seq) do
    %{
      "eventId" => "evt_" <> random(),
      "name" => name,
      "timestamp" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "data" => data,
      "cursor" => cursor(seq)
    }
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

  # Whether some of what happened after the cursor `from` has gone: it's older than the oldest that's kept.
  defp truncated?(nil, _head, _oldest), do: false
  defp truncated?(from, head, nil), do: from < head
  defp truncated?(from, _head, oldest), do: from < oldest - 1

  # Whether what happened is what a subscription's arguments filter by: each of them, by its name, is what happened's.
  defp matches?(arguments, _data) when map_size(arguments) == 0, do: true
  defp matches?(arguments, data) when is_map(data), do: Enum.all?(arguments, fn {name, value} -> data[name] == value end)
  defp matches?(_arguments, _data), do: false

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
