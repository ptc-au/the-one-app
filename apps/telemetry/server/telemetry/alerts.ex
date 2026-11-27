defmodule Telemetry.Alerts do
  @moduledoc """
  What needs a person, kept as alerts that are read in the Telemetry app and by `alerts`, never sent to anyone: whoever
  wants them elsewhere has a copy of everything kept forwarded (`Telemetry.Forward`). As SRE alerts are, each is a
  symptom someone would notice, not a cause: a problem is one alert however often it recurs.

  | Kind | Fires when | Clears when |
  | --- | --- | --- |
  | `server` | One of the network's servers, as the relay says (`active`): its machine's `one serve run` said its server didn't start or stopped without being asked, and it hasn't started since, for 5 min, unless the relay says it's ready; or it said its server ended unasked 3 times in 10 min (`one.server.crash_loop`), heard in the last 10 min. Or, as the edge saw from outside, none of the network's servers answered its requests for 5 min or more (`network unreachable`, which the edge keeps once one answers again): it's resolved as it's read, with the outage's own times | It says it started, or the relay says it's ready, or a server on the same machine started after it failed (its machine's server has a new key), and no loop has been heard of for 10 min |
  | `update` | The network's update (`core/edge/updater/updater.ts`) left a server behind, as it went back from the build or didn't take it in time, or the edge couldn't update itself, as it needs setting up or its deploy failed | The updater hasn't said so for 10 min, while no update or edge deploy is under way: the edge's deploy begins a few minutes after the servers' update ends |
  | `error` | A kind of error that wasn't in the last 14 days on the device or server it's on, as `errors` lists them: a span that failed, and an error logged outside one, by its first line, numbers and ids aside. A fault, a crash, a call that failed or a client's exception, not a call refused for what it was given or who asked (`one.outcome` `refused`, whose span isn't an error) | None arrives for 10 min, or it stops being new an hour after it first arrived |
  | `failing` | Half or more of an app's tool calls failed, of 10 or more in 10 min | 10 min with fewer |
  | `unanswered` | An app didn't answer, in 2 or more of the last 5 minutes: a hook it didn't answer in time (`one.hook.timeouts`), or its database's server kept a call waiting without running it (`one.database.lease.wait`, `not_answered`) | 5 min without |
  | `deploy` | An app's deploy took over its 500 ms budget to show in a window, from when it began (`one.client.deploy.window`), in 2 or more of the last 10 minutes: a server release building every app again is one | 10 min without |
  | `open` | The median of an app's last 5 opens on a device (at least 3) took over its 300 ms budget, from being asked to open to its page's first frame (`one.client.native.open`, which a client says of each open, with each step's time; one that lasted across the device's sleep isn't told) | Its median is within its budget there, or it hasn't opened there for a day |
  | `backup` | A destination's last backup is older than its schedule and a day, or its last backup failed, as Backups last said (`one.backup`, which it says each hour and as each backup ends) | Backups says it's backed up, or that the destination is gone |
  | `behind` | A server or a desktop client has last said, by when what it said arrived, that it's on an older build than the latest of its kind (`OneCore.Builds.latest/0`, as `builds` says), which has been the latest for over an hour, while the network isn't updating its servers, and something of it arrived in the last day | It says it's on the latest, a newer build comes out (its hour begins again), or nothing of it arrives for a day |
  | `memory` | A device's app held more than its budget in a state (`background`, `launcher`, `windows`) the last time it measured it there (`one.client.memory.over`, which the app says as it measures over budget, beside `one.client.memory` each time) | It measures that state within its budget there, or nothing of it arrives for a day |
  | `frames` | A device's share of long frames (shown twice or more, `one.client.native.frames.long` of `one.client.native.frames`, which a client says of each motion) passed 5% of at least 600 frames over the last hour of real use: those it drew while its system wasn't busy (`one.system.busy`) | The share is back under 5%, or under 600 frames: the hour moves on |
  | `access` | A server that acts for someone lacks the keys of something encrypted for them, or one that doesn't act for them has them, as Encryption last said (`one.encryption.access`, which it says every 10 minutes) | Encryption says every server that should hold its keys does, and no other |

  Each alert is a row of Telemetry's database, one per kind and key (the server, the build, the error's kind, the
  app), moved only by `evaluate/1`, the clock's job every minute: it's `firing` while its symptom is seen, and
  `resolved` once the symptom has been gone for its kind's while. The same kind and key firing again after it's
  resolved is a new alert.

  What it reads is each batch kept since it last looked that it hasn't read, by its name (`Telemetry.Store.since/3`),
  so one kept late is read all the same, and it keeps of that only what its rules need: each server's last start and
  failure, each kind of error and when it first and last arrived, and per app per minute its calls, its failures and
  how often it didn't answer, what AI used each day per model (`spending/2`), what Backups last said of each destination, and what Encryption last said of each encrypted artifact. Its first look reads the last 14 days for the kinds of error there were, and has no alert for
  any of them. An error and a crash loop are judged by when they arrive, not when they happened, as Prometheus's alerts
  are by when they're evaluated: what a device kept while it was away, or a server said once it was back, is told
  when it's heard. Whether a server is one of the network's and ready, and how the network's update is, it asks of the relay
  as it looks (`OneCore.Servers.presence/1`, `OneCore.Servers.network/0`): where the relay doesn't answer, what it
  would have said of stays as it was.
  """
  alias Telemetry.{Read, Store}
  alias OneCore.Call

  # How far back it looks for batches it hasn't read, in milliseconds: a minute's batches are put together in their
  # hour's blob 10 minutes after it ends (`Store.prune/1`), and the rules look back no further.
  @gap 5 * 60_000
  @minute 60_000
  @day 86_400_000
  # How long an error kind isn't logged before its alert resolves: its recovery window, as Grafana's and Datadog's.
  @recovery 10 * @minute

  @schema [
    "create table looked (id integer primary key check (id = 1), at integer not null)",
    "create table batches (name text primary key, at integer not null) without rowid",
    """
    create table servers (
      server text primary key, name text, failing integer, failed integer, started integer, looping integer,
      why text
    )
    """,
    "create table seen (kind text primary key, place text, message text, first integer, last integer, new integer)",
    """
    create table minutes (
      app text not null, minute integer not null, calls integer not null default 0, failed integer not null default 0,
      unanswered integer not null default 0, primary key (app, minute)
    ) without rowid
    """,
    """
    create table alerts (
      id integer primary key, kind text not null, key text not null, state text not null, title text not null,
      text text, began integer not null, last integer not null, ended integer
    )
    """,
    # Kept in its place, since statements already run are counted by position: a kind's mute, dropped below.
    "create table muted (kind text primary key) without rowid",
    # Where a copy of what's kept is sent (`Telemetry.Forward`).
    "create table forward (id integer primary key check (id = 1), endpoint text not null, who text not null, item text not null, headers text not null)",
    # Alerts that were told, and a kind's mute, from when it notified people.
    "update alerts set state = 'firing' where state = 'notified'",
    "update alerts set state = 'resolved' where state = 'resolving'",
    "drop table muted",
    # Each app's slowest deploy to show in a window, per minute.
    "create table deploys (app text not null, minute integer not null, slowest integer not null, primary key (app, minute)) without rowid",
    # What Backups last said of each destination (`one.backup`).
    "create table backups (destination text primary key, at integer not null, last integer not null, every integer not null, outcome text not null, problem text)",
    # Each app's window's last open on each device, and its steps (`one.client.native.open`).
    "create table opens (device text not null, view text not null, name text, at integer not null, took integer not null, steps text, primary key (device, view)) without rowid",
    # What Encryption last said of who holds each encrypted artifact's keys (`one.encryption.access`).
    "create table access (artifact text primary key, at integer not null, outcome text not null, problem text) without rowid",
    # Spans' errors are kinds too: the next look reads the last 14 days again for every kind there was.
    "delete from looked",
    # Which build each server and client last said it is (`service.version`), as what it said arrived, and since when
    # that's been older than the latest of its kind.
    "create table builds (key text primary key, name text, build text not null, kind text not null, at integer not null, behind integer) without rowid",
    # Each device's app's last memory over budget in each state, and its last measure there (`one.client.memory`).
    "create table memory (device text not null, state text not null, name text, over integer, said text, measured integer, gpu real, graphics real, heap real, at integer not null, primary key (device, state)) without rowid",
    # Each kind of error on each device or server it's on: the next look reads the last 14 days again for them.
    "drop table seen",
    "create table seen (kind text not null, device text not null, place text, message text, first integer, last integer, new integer, primary key (kind, device)) without rowid",
    "delete from looked",
    # Each device's frames and long frames in each minute it drew some (`one.client.native.frames`).
    "create table frames (device text not null, minute integer not null, name text, frames integer not null default 0, long integer not null default 0, primary key (device, minute)) without rowid",
    # Each app's window's last opens on each device, not only the last: the `open` alert reads their median.
    "drop table opens",
    "create table opens (device text not null, view text not null, name text, at integer not null, took integer not null, steps text, primary key (device, view, at)) without rowid",
    # Since when each latest build is the latest of its name (`OneCore.Builds.latest/0`): a machine is behind from then.
    "alter table builds drop column behind",
    "create table newest (name text primary key, build text not null, since integer not null) without rowid",
    # What AI used each day, per model, added up as it's read (`spending/2`): '' is a model not said.
    "create table spending (day text not null, model text not null, input real not null default 0, output real not null default 0, cost real, primary key (day, model)) without rowid"
  ]

  @kinds %{
    "server" => "A server isn't running for 5 minutes, or keeps restarting, or none answered the edge for 5 minutes",
    "update" => "A server didn't take the network's update, or the edge couldn't update itself",
    "error" => "A kind of error not seen on its device or server in the last 14 days",
    "failing" => "Half or more of an app's tool calls fail, of 10 or more in 10 minutes",
    "unanswered" => "An app doesn't answer for more than a minute",
    "deploy" => "An app's deploys take over 500 ms to show in its window, in 2 or more of the last 10 minutes",
    "backup" => "A backup isn't made within its schedule and a day, or the last one failed",
    "open" => "The median of an app's last 5 opens on a device took over 300 ms to show its page",
    "access" => "A server that acts for someone can't open what's encrypted for them, or one that doesn't can",
    "behind" => "A server or a desktop client is on an older build than the latest, which has been out for over an hour",
    "memory" => "A device's app held more memory than its budget the last time it measured it",
    "frames" => "Over 5% of the frames a device drew in the last hour were long"
  }

  # How long a deploy has to show in a window, from when it began, in milliseconds.
  @deploy_budget 500
  # How long an app's window has to show its page, from being asked to open, in milliseconds: a cached app's should
  # feel instant.
  @open_budget 300
  # How many of a device's last opens of an app the `open` alert reads, and how few it needs: one slow open, as one
  # that lasted across a device's sleep was, fires nothing.
  @opens_kept 5
  @opens_least 3
  # What a device's frames in the last hour may have long, as a percentage, of at least this many: ten seconds of
  # motion at 60 Hz.
  @long_share 5
  @long_least 600

  # How long each kind's alert stays after its symptom was last seen before it's resolved, in milliseconds.
  @cool %{"server" => 0, "update" => 10 * 60_000, "error" => 0, "failing" => 10 * 60_000, "unanswered" => 5 * 60_000, "deploy" => 10 * 60_000, "backup" => 0, "open" => 0, "access" => 0, "behind" => 0, "memory" => 0, "frames" => 0}

  @doc "Each kind of alert, with what fires it."
  def kinds, do: @kinds

  @doc """
  The alerts not resolved, and those resolved in the last `hours`, newest first, each kind of alert, and where a copy
  is sent (`Telemetry.Forward`).
  """
  def list(call, hours) do
    since = System.os_time(:millisecond) - hours * 3_600_000

    transaction(call, fn db ->
      alerts =
        query(
          db,
          """
          select id, kind, key, state, title, text, began, last, ended from alerts
          where state = 'firing' or ended > ? order by began desc
          """,
          [since]
        )

      kinds = for {kind, about} <- Enum.sort(@kinds), do: %{kind: kind, about: about}
      forwarding = for %{"endpoint" => endpoint} <- query(db, "select endpoint from forward", []), do: endpoint
      %{alerts: alerts, kinds: kinds, forwarding: List.first(forwarding)}
    end)
  end

  @doc """
  Reads what was recorded since it last looked, moves each alert on (the moduledoc's state machine) and sends a copy of what it
  read where its owner said (`Telemetry.Forward`).
  """
  def evaluate(call) do
    now = System.os_time(:millisecond)

    # Its first transaction, which marks the job as run: whether it has looked before, the batches it has read, and
    # the servers that may be down, whose presence is asked of the relay here rather than while the database is
    # held.
    {looked, read, failing} =
      transaction(call, fn db ->
        sql = "select server from servers where failing is not null or looping is not null"

        {query(db, "select at from looked", []) != [],
         MapSet.new(for %{"name" => name} <- query(db, "select name from batches", []), do: name),
         for(%{"server" => server} <- query(db, sql, []), do: server)}
      end)

    asked = %{presence: Map.new(failing, &{&1, presence(&1)}), update: update(), latest: latest(), names: Map.new(Call.apps(call), &{&1.name, &1.title})}

    {names, exports} = if looked, do: Store.since(call, (now - @gap) * 1_000_000, read), else: {[], []}
    batches = if looked, do: Enum.map(exports, &elem(&1, 1)), else: Store.read(call, (now - Store.days() * 86_400_000) * 1_000_000)

    signals = signals(batches)

    fresh =
      transaction(call, fn db ->
        # Another evaluation read them already, as one that ran long overlapping the next does.
        if looked == (query(db, "select at from looked", []) != []) and not read?(db, names) do
          keep(db, signals, not looked, now)
          newest(db, asked.latest, now)
          for name <- names, do: query(db, "insert into batches (name, at) values (?, ?)", [name, now])
          query(db, "delete from batches where at < ?", [now - 2 * @gap])
          # Said once: a minute that read nothing writes nothing, so it adds nothing to the database's log.
          if not looked, do: query(db, "insert into looked (id, at) values (1, ?)", [now])
          step(db, now, conditions(db, now, asked), unknown(asked))
          names
        else
          []
        end
      end)

    # What's newly kept is rolled up, for looks over hours to read, and sent where its owner said, if they did.
    Store.roll_up(call.own, for({name, _batch} = export <- exports, name in fresh, do: export))
    Telemetry.Forward.send(call, fresh)
  end

  defp read?(_db, []), do: false

  defp read?(db, names),
    do: query(db, "select 1 from batches where name in (select value from json_each(?))", [JSON.encode!(names)]) != []

  # Whether a server is one of the network's and ready, as the relay says, or `:unknown` where it can't be asked.
  defp presence(server) do
    OneCore.Servers.presence(server) || %{}
  rescue
    # The edge didn't answer: what's known of the server stays as it was.
    OneCore.Edge.Unreachable -> :unknown
  end

  # The network's update, as its updater says, or `:unknown` where it can't be asked.
  defp update do
    case OneCore.Servers.network() do
      {:ok, update} -> update || %{}
      {:error, _why} -> :unknown
    end
  end

  # The latest build of each kind, as the core's release lists them (`OneCore.Builds.latest/0`), or `:unknown` where
  # none can be read now.
  defp latest do
    case OneCore.Builds.latest() do
      latest when map_size(latest) == 0 -> :unknown
      latest -> Map.new(latest, fn {name, %{"build" => build}} -> {name, build} end)
    end
  end

  # The alerts whose symptom couldn't be asked of the relay this time, which stay as they are, by kind and key: an
  # update's too while an update or the edge's deploy is under way, which takes back what it said went wrong
  # (`went_back`, `edge_update`) until it says again how it went.
  defp unknown(asked) do
    fn
      {"server", server} -> asked.presence[server] == :unknown
      {"update", _key} -> asked.update == :unknown or under_way?(asked.update)
      {"behind", _key} -> asked.latest == :unknown or under_way?(asked.update)
      _ -> false
    end
  end

  ## Signals

  # What the rules need of what was recorded, as one list of tuples, from the batches' spans, logs and metrics.
  defp signals(batches) do
    builds =
      for batch <- batches, record <- batch["spans"] ++ batch["logs"], said = build(record), into: %{}, do: {elem(said, 1), said}

    Enum.flat_map(batches, fn batch ->
      Enum.flat_map(batch["spans"], &span/1) ++
        Enum.flat_map(batch["logs"], &log/1) ++ Enum.flat_map(batch["metrics"], &metric/1)
    end) ++ Map.values(builds)
  end

  # Which build a server or a desktop client says it is, as each of its spans and log lines does: a server's is the
  # same code whatever its machine (`server-code`), and a client's is its system's `one`. A phone's has no latest.
  defp build(%{"attributes" => %{"service.version" => build, "service.name" => "one-server"}} = record),
    do: {:build, "server|#{record["server"]}", "#{record["server"]}'s server", build, "server-code"}

  defp build(%{"attributes" => %{"service.version" => build, "one.device" => device, "service.name" => service, "os.type" => os}} = record)
       when os in ["macos", "linux", "windows"],
       do: {:build, "#{device}|#{service}", Read.from(record), build, "one/#{os}"}

  defp build(_record), do: nil

  defp span(%{"name" => "one.server.start", "attributes" => %{"one.server" => server} = a} = span) do
    case span["status"] do
      %{"code" => "error", "message" => why} -> [{:server, server, a["host.name"], ms(span["end"]), {:failed, why}}]
      _ -> [{:server, server, a["host.name"], ms(span["end"]), :started}]
    end
  end

  # A client's window that opened (`one.steps`, as it said each step), not one that didn't (`error`).
  defp span(%{"name" => "one.client.native.open", "attributes" => %{"one.view" => view} = a} = span) do
    case span["status"] do
      %{"code" => "error"} -> []
      _ -> [{:open, a["one.device"] || span["server"] || "", view, Read.from(span), ms(span["end"]), ms(span["end"]) - ms(span["start"]), a["one.steps"]}]
    end
  end

  # An outage the edge saw, once a server answered it again (`apps/telemetry/edge/worker.ts`): when none answered.
  defp span(%{"name" => "network unreachable", "status" => %{"message" => message}} = span),
    do: [{:unreachable, ms(span["start"]), ms(span["end"]), message}]

  # What the network's updater says is the `update` alert's, read of it as it is (`OneCore.Servers.network/0`).
  defp span(%{"name" => name}) when name in ["network update", "edge update"], do: []

  # A span that failed: a call's, whose log lines are under it, a client's request that reached no server, a page's or
  # the edge's. A call passed on is the server's that ran it, and a client's request that reached a server
  # (`one.reached`, `direct` or `relay`) that server's, which refused it or failed, whichever export arrives first.
  defp span(%{"status" => %{"code" => "error", "message" => message}, "attributes" => a} = span) when is_binary(message) do
    if a["one.forwarded"] == true or a["one.reached"] not in [nil, "none"],
      do: [],
      else: [{:error, Read.kind(message), device(span), place(span), first_line(message)}]
  end

  defp span(_span), do: []

  defp log(%{"eventName" => "one.server.stop", "severity" => "ERROR", "attributes" => %{"one.server" => server} = a} = log),
    do: [{:server, server, a["host.name"], ms(log["time"]), {:failed, log["body"]}}]

  defp log(%{"eventName" => "one.server.crash_loop", "attributes" => %{"one.server" => server} = a} = log),
    do: [{:server, server, a["host.name"], ms(log["time"]), {:looping, log["body"]}}]

  defp log(%{"eventName" => "one.backup", "attributes" => %{"one.destination" => destination} = a} = log),
    do: [{:backup, destination, ms(log["time"]), a["one.backup.last"] || 0, a["one.backup.every"] || 0, a["one.outcome"], a["one.problem"]}]

  defp log(%{"eventName" => "one.encryption.access", "attributes" => %{"one.artifact" => artifact} = a} = log),
    do: [{:access, artifact, ms(log["time"]), a["one.outcome"], a["one.problem"]}]

  # The app's memory over its budget is its alert's, a device's, not a new kind of error.
  defp log(%{"eventName" => "one.client.memory.over", "attributes" => %{"one.device" => device, "one.state" => state}} = log),
    do: [{:memory_over, device, state, Read.from(log), ms(log["time"]), log["body"]}]

  # What a server's own program says of it is its alert's, not a new kind of error.
  defp log(%{"eventName" => "one.server." <> _}), do: []

  # What's logged during a call is its span's, which is the error where it failed.
  defp log(%{"severity" => "ERROR", "body" => body, "spanId" => nil} = log) when is_binary(body),
    do: [{:error, Read.kind(body), device(log), place(log), first_line(body)}]

  defp log(_log), do: []

  defp metric(%{"name" => "one.tool.duration", "attributes" => a} = point) do
    failed = if a["one.outcome"] == "error", do: point["count"], else: 0
    [{:calls, a["one.app"], minute(point["time"]), point["count"], failed}]
  end

  defp metric(%{"name" => "one.hook.timeouts", "attributes" => %{"one.app" => app}} = point),
    do: [{:unanswered, app, minute(point["time"]), point["count"]}]

  defp metric(%{"name" => "one.database.lease.wait", "attributes" => %{"one.app" => app, "one.outcome" => "not_answered"}} = point),
    do: [{:unanswered, app, minute(point["time"]), point["count"]}]

  defp metric(%{"name" => "one.client.deploy.window", "attributes" => %{"one.app" => app}} = point),
    do: [{:deploy, app, minute(point["time"]), round(point["max"] || point["sum"] || 0)}]

  defp metric(%{"name" => "one.client.memory" <> part, "attributes" => %{"one.device" => device, "one.state" => state}, "count" => count} = point)
       when part in ["", ".gpu", ".graphics", ".heap"] and count > 0,
       do: [{:memory, device, state, String.trim_leading(part, "."), ms(point["start"]), Float.round(point["sum"] / count, 1)}]

  # A client's frames and its long ones, as it said them of each motion, unless its system was busy then.
  defp metric(%{"name" => "one.client.native.frames" <> part, "attributes" => %{"one.device" => device} = a} = point)
       when part in ["", ".long"] do
    count = round(point["sum"])

    if a["one.system.busy"] == true,
      do: [],
      else: [{:frames, device, Read.from(point), minute(point["time"]), if(part == "", do: count, else: 0), if(part == "", do: 0, else: count)}]
  end

  # What AI used, as apps record it (OpenTelemetry's `gen_ai.client.token.usage`, and `gen_ai.client.cost` in US dollars).
  defp metric(%{"name" => "gen_ai.client.token.usage", "attributes" => %{"gen_ai.token.type" => type} = a} = point)
       when type in ["input", "output"],
       do: [{:spent, day(ms(point["time"])), a["gen_ai.request.model"] || "", if(type == "input", do: point["sum"], else: 0), if(type == "output", do: point["sum"], else: 0), nil}]

  defp metric(%{"name" => "gen_ai.client.cost", "attributes" => a} = point),
    do: [{:spent, day(ms(point["time"])), a["gen_ai.request.model"] || "", 0, 0, point["sum"]}]

  defp metric(_point), do: []

  # The device or server an error was on: a client's, as its request proved it is, a server's machine, or the edge.
  defp device(record), do: record["attributes"]["one.device"] || record["server"] || record["attributes"]["service.name"] || ""

  # Where an error was, as a person reads it: the span, or what logged it if it said, on the server or client it was on.
  defp place(record) do
    on = Read.from(record) || record["server"]
    if what = record["name"] || record["eventName"], do: "#{what}, on #{on}", else: "On #{on}"
  end

  # Keeps what the rules need of `signals`. Its first look keeps only the kinds of error there were, as seen, and
  # none is new.
  defp keep(db, signals, true, now) do
    signals = for signal <- signals, elem(signal, 0) in [:error, :spent], do: signal
    keep(db, signals, false, now)
    query(db, "update seen set new = 0", [])
  end

  defp keep(db, signals, false, now) do
    servers = Enum.sort_by(for({:server, _, _, _, _} = said <- signals, do: said), &elem(&1, 3))

    for {:server, server, name, at, said} <- servers do
      row =
        case query(db, "select * from servers where server = ?", [server]) do
          [row] -> row
          [] -> %{"failing" => nil, "failed" => nil, "started" => nil, "looping" => nil, "why" => nil}
        end

      row =
        case said do
          :started -> %{row | "started" => max(row["started"] || 0, at), "failing" => if(row["failing"] && row["failing"] < at, do: nil, else: row["failing"])}
          {:failed, why} -> %{row | "failing" => row["failing"] || at, "failed" => at, "why" => why}
          {:looping, why} -> %{row | "looping" => now, "why" => why}
        end

      query(
        db,
        "insert or replace into servers (server, name, failing, failed, started, looping, why) values (?, ?, ?, ?, ?, ?, ?)",
        [server, name, row["failing"], row["failed"], row["started"], row["looping"], row["why"]]
      )
    end

    # An outage is over by the time it's read, so its alert is resolved as it's kept, with its own times.
    for {:unreachable, start, stop, message} <- signals, stop - start >= 5 * @minute do
      query(
        db,
        "insert into alerts (kind, key, state, title, text, began, last, ended) values ('server', 'network', 'resolved', ?, ?, ?, ?, ?)",
        ["None of the network's servers answered for #{took(stop - start)}", message, start, stop, stop]
      )
    end

    for {:spent, day, model, input, output, cost} <- signals do
      query(
        db,
        """
        insert into spending (day, model, input, output, cost) values (?, ?, ?, ?, ?)
        on conflict (day, model) do update set input = input + excluded.input, output = output + excluded.output,
          cost = case when excluded.cost is null then cost else coalesce(cost, 0) + excluded.cost end
        """,
        [day, model, input, output, cost]
      )
    end

    for {:error, kind, device, place, message} <- signals do
      query(
        db,
        """
        insert into seen (kind, device, place, message, first, last, new) values (?, ?, ?, ?, ?, ?, ?)
        on conflict (kind, device) do update set last = excluded.last
        """,
        [kind, device, place, message, now, now, 1]
      )
    end

    for {:calls, app, minute, calls, failed} <- signals do
      query(
        db,
        """
        insert into minutes (app, minute, calls, failed) values (?, ?, ?, ?)
        on conflict (app, minute) do update set calls = calls + excluded.calls, failed = failed + excluded.failed
        """,
        [app, minute, calls, failed]
      )
    end

    for {:unanswered, app, minute, count} <- signals do
      query(
        db,
        """
        insert into minutes (app, minute, unanswered) values (?, ?, ?)
        on conflict (app, minute) do update set unanswered = unanswered + excluded.unanswered
        """,
        [app, minute, count]
      )
    end

    for {:deploy, app, minute, took} <- signals do
      query(
        db,
        """
        insert into deploys (app, minute, slowest) values (?, ?, ?)
        on conflict (app, minute) do update set slowest = max(slowest, excluded.slowest)
        """,
        [app, minute, took]
      )
    end

    for {:backup, destination, at, last, every, outcome, problem} <- Enum.sort_by(for({:backup, _, _, _, _, _, _} = said <- signals, do: said), &elem(&1, 2)) do
      if outcome == "removed",
        do: query(db, "delete from backups where destination = ? and at <= ?", [destination, at]),
        else:
          query(
            db,
            """
            insert into backups (destination, at, last, every, outcome, problem) values (?, ?, ?, ?, ?, ?)
            on conflict (destination) do update set at = excluded.at, last = excluded.last, every = excluded.every,
              outcome = excluded.outcome, problem = excluded.problem where excluded.at >= backups.at
            """,
            [destination, at, last, every, outcome, problem]
          )
    end

    for {:access, artifact, at, outcome, problem} <- signals do
      query(
        db,
        """
        insert into access (artifact, at, outcome, problem) values (?, ?, ?, ?)
        on conflict (artifact) do update set at = excluded.at, outcome = excluded.outcome, problem = excluded.problem
        where excluded.at >= access.at
        """,
        [artifact, at, outcome, problem]
      )
    end

    for {:build, key, name, build, kind} <- signals do
      query(
        db,
        """
        insert into builds (key, name, build, kind, at) values (?, ?, ?, ?, ?)
        on conflict (key) do update set name = excluded.name, build = excluded.build, kind = excluded.kind, at = excluded.at
        """,
        [key, name, build, kind, now]
      )
    end

    for {:memory_over, device, state, name, at, said} <- signals do
      query(
        db,
        """
        insert into memory (device, state, name, over, said, at) values (?, ?, ?, ?, ?, ?)
        on conflict (device, state) do update set name = excluded.name, over = max(coalesce(over, 0), excluded.over),
          said = iif(excluded.over >= coalesce(over, 0), excluded.said, said), at = excluded.at
        """,
        [device, state, name, at, said, now]
      )
    end

    # Each measure's interval starts after what it measured before: one that starts after the last over is within
    # budget, as one over would have said so.
    for {:memory, device, state, part, start, mb} <- signals do
      column = if part == "", do: "measured", else: part
      value = if part == "", do: start, else: mb

      query(
        db,
        """
        insert into memory (device, state, #{column}, at) values (?, ?, ?, ?)
        on conflict (device, state) do update set #{column} = #{if part == "", do: "max(coalesce(measured, 0), excluded.measured)", else: "excluded.#{column}"}, at = excluded.at
        """,
        [device, state, value, now]
      )
    end

    for {:frames, device, name, minute, frames, long} <- signals do
      query(
        db,
        """
        insert into frames (device, minute, name, frames, long) values (?, ?, ?, ?, ?)
        on conflict (device, minute) do update set name = coalesce(excluded.name, name), frames = frames + excluded.frames,
          long = long + excluded.long
        """,
        [device, minute, name, frames, long]
      )
    end

    for {:open, device, view, from, at, took, steps} <- signals do
      query(
        db,
        """
        insert into opens (device, view, name, at, took, steps) values (?, ?, ?, ?, ?, ?)
        on conflict (device, view, at) do nothing
        """,
        [device, view, from, at, took, steps]
      )
    end

    # What no rule looks at any more.
    query(db, "delete from minutes where minute < ?", [now - 15 * @minute])
    query(db, "delete from deploys where minute < ?", [now - 15 * @minute])
    query(db, "delete from opens where at < ?", [now - @day])

    query(
      db,
      "delete from opens where (select count(*) from opens o where o.device = opens.device and o.view = opens.view and o.at > opens.at) >= ?",
      [@opens_kept]
    )

    query(db, "delete from builds where at < ?", [now - @day])
    query(db, "delete from memory where at < ?", [now - @day])
    query(db, "delete from frames where minute < ?", [now - 60 * @minute])
    query(db, "delete from spending where day < ?", [day(now - Store.days() * @day)])
    query(db, "delete from seen where last < ?", [now - Store.days() * 86_400_000])
    query(db, "delete from servers where max(coalesce(failed, 0), coalesce(started, 0), coalesce(looping, 0)) < ?", [now - Store.days() * 86_400_000])
    query(db, "delete from alerts where ended < ?", [now - 7 * 86_400_000])
  end

  # Marks since when each latest build has been the latest of its name, as it's first seen to be: a machine is behind
  # it from then, however long it's been on the build before.
  defp newest(_db, :unknown, _now), do: :ok

  defp newest(db, latest, now) do
    for {name, build} <- latest do
      query(
        db,
        """
        insert into newest (name, build, since) values (?, ?, ?)
        on conflict (name) do update set build = excluded.build, since = excluded.since where newest.build != excluded.build
        """,
        [name, build, now]
      )
    end
  end

  # The latest build of a kind, with its name: `server-code`, or a client's `one/<system>` whichever its machine.
  defp latest_of(latest, "server-code"), do: Enum.find(latest, &match?({"server-code", _}, &1))
  defp latest_of(latest, "one/" <> _ = kind), do: Enum.find(latest, fn {name, _build} -> String.starts_with?(name, kind <> "-") end)

  ## Rules

  # Each alert whose symptom is there now, by its kind and key: what it's called.
  defp conditions(db, now, asked) do
    called = fn "one" -> "The network's own tools"; app -> Map.get(asked.names, app, app) end

    rows = query(db, "select * from servers", [])
    # Each machine's latest start, by whichever key its server had: a machine's server given a new key leaves its
    # old one down for good, which a start under the new one answers.
    started = rows |> Enum.group_by(& &1["name"]) |> Map.new(fn {name, rows} -> {name, rows |> Enum.map(&(&1["started"] || 0)) |> Enum.max()} end)

    servers =
      rows
      |> Enum.reject(&(&1["name"] && &1["failing"] && started[&1["name"]] > &1["failing"]))
      |> Enum.flat_map(fn row ->
        case server(row, row["name"] || "A server", now, asked.presence[row["server"]]) do
          nil -> []
          condition -> [{{"server", row["server"]}, condition}]
        end
      end)
      |> Map.new()

    update = went_wrong(asked.update)

    errors =
      for row <- query(db, "select * from seen where new = 1 and first > ? and last > ?", [now - 60 * @minute, now - @recovery]), into: %{} do
        {{"error", "#{row["device"]}|#{row["kind"]}"}, %{title: "New error: #{String.slice(row["message"], 0, 100)}", text: row["place"]}}
      end

    failing =
      for row <-
            query(
              db,
              """
              select app, sum(calls) as calls, sum(failed) as failed from minutes where minute > ?
              group by app having sum(calls) >= 10 and sum(failed) * 2 >= sum(calls)
              """,
              [now - 10 * @minute]
            ),
          into: %{} do
        app = called.(row["app"])

        {{"failing", row["app"]},
         %{
           title: "#{app} is failing",
           text: "#{row["failed"]} of its #{row["calls"]} calls failed in the last 10 minutes."
         }}
      end

    unanswered =
      for row <-
            query(
              db,
              "select app, count(*) as minutes from minutes where unanswered > 0 and minute > ? group by app having count(*) >= 2",
              [now - 5 * @minute]
            ),
          into: %{} do
        app = called.(row["app"])

        {{"unanswered", row["app"]},
         %{
           title: "#{app} isn't answering",
           text: "It didn't answer in #{row["minutes"]} of the last 5 minutes, so what needed it failed."
         }}
      end

    deploys =
      for row <-
            query(
              db,
              """
              select app, count(*) as minutes, max(slowest) as slowest from deploys where slowest > ? and minute > ?
              group by app having count(*) >= 2
              """,
              [@deploy_budget, now - 10 * @minute]
            ),
          into: %{} do
        {{"deploy", row["app"]},
         %{
           title: "#{called.(row["app"])} is slow to show its deploys",
           text:
             "In #{row["minutes"]} of the last 10 minutes a deploy took up to #{row["slowest"]} ms to show in its " <>
               "window, over its #{@deploy_budget} ms budget."
         }}
      end

    opens =
      for {{device, view}, rows} <-
            Enum.group_by(query(db, "select * from opens order by at desc", []), &{&1["device"], &1["view"]}),
          rows = Enum.take(rows, @opens_kept),
          length(rows) >= @opens_least,
          median = rows |> Enum.map(& &1["took"]) |> Enum.sort() |> Enum.at(div(length(rows), 2)),
          median > @open_budget,
          into: %{} do
        [last | _] = rows

        {{"open", "#{device}|#{view}"},
         %{
           title: "#{called.(view)} is slow to open#{String.replace_prefix(last["name"] || "", "App", "")}",
           text:
             "The median of its last #{length(rows)} opens is #{median} ms to show its page, over its " <>
               "#{@open_budget} ms budget; the last took #{last["took"]} ms: #{last["steps"]}."
         }}
      end

    # A destination's last backup older than its schedule and a day, or one that failed: as Time Machine says it
    # couldn't complete the backup after a missed day.
    backups =
      for row <- query(db, "select * from backups", []),
          row["outcome"] == "failed" or (row["every"] > 0 and now - row["last"] > row["every"] * 1000 + @day),
          into: %{} do
        {{"backup", row["destination"]},
         %{
           title: "Backups couldn't complete the backup to #{row["destination"]}",
           text: Enum.join(Enum.reject([last_backup(row["last"], now), row["problem"]], &is_nil/1), " ")
         }}
      end

    access =
      for row <- query(db, "select * from access where outcome = 'incomplete'", []), into: %{} do
        {{"access", row["artifact"]}, %{title: "A server is waiting for a key to #{row["artifact"]}", text: row["problem"]}}
      end

    # Not while the network is updating its servers: that's how a machine comes to the build.
    behind =
      for row <- query(db, "select * from builds", []),
          asked.latest != :unknown and not under_way?(asked.update),
          {name, newest} <- [latest_of(asked.latest, row["kind"])],
          apart = OneCore.Builds.count(newest) - OneCore.Builds.count(row["build"]),
          apart > 0,
          %{"since" => since} <- query(db, "select since from newest where name = ? and build = ? and since < ?", [name, newest, now - 60 * @minute]),
          into: %{} do
        hours = div(now - since, 3_600_000)

        {{"behind", row["key"]},
         %{
           title: "#{row["name"] || "A device"} is behind, on #{version(row["build"])}",
           text: "It's #{apart} #{if apart == 1, do: "build", else: "builds"} behind #{version(newest)}, and #{version(newest)} has been out for over #{hours} #{if hours == 1, do: "hour", else: "hours"}."
         }}
      end

    memory =
      for row <- query(db, "select * from memory where over >= coalesce(measured, 0)", []), into: %{} do
        parts = for {part, called} <- [{"gpu", "the GPU"}, {"graphics", "graphics"}, {"heap", "the heap"}], row[part], do: "#{called} #{row[part]} MB"
        held = if parts == [], do: "", else: " Of what it holds, #{Enum.join(parts, ", ")}."

        {{"memory", "#{row["device"]}|#{row["state"]}"},
         %{
           title: "#{row["name"] || "An app"} holds more memory than its budget #{in_state(row["state"])}",
           text: "#{sentence(row["said"])}.#{held}"
         }}
      end

    frames =
      for row <-
            query(
              db,
              """
              select device, max(name) as name, sum(frames) as frames, sum(long) as long from frames where minute > ?
              group by device having sum(frames) >= ? and sum(long) * 100 >= sum(frames) * ?
              """,
              [now - 60 * @minute, @long_least, @long_share]
            ),
          into: %{} do
        {{"frames", row["device"]},
         %{
           title: "#{row["name"] || "An app"} drops frames",
           text: "#{row["long"]} of the #{row["frames"]} frames it drew in the last hour were long, shown twice or more: #{Float.round(row["long"] * 100 / row["frames"], 1)}%, over #{@long_share}%."
         }}
      end

    Enum.reduce([servers, update, errors, failing, unanswered, deploys, opens, backups, access, behind, memory, frames], &Map.merge/2)
  end

  # What the network's updater says went wrong: each server behind, which went back from the build or didn't take it
  # in time (its alarm's deadline, `until`), and the edge, where it needs setting up to update itself or its deploy
  # failed.
  defp went_wrong(%{} = update) do
    servers =
      for %{"server" => server, "why" => why} = behind <- update["went_back"] || [], into: %{} do
        {{"update", server}, %{title: "#{behind["name"] || "A server"} didn't update to #{version(update["build"])}", text: why}}
      end

    case update["edge_update"] do
      %{"status" => "needs_setup", "why" => why} ->
        Map.put(servers, {"update", "edge"}, %{title: "The edge needs setting up to update itself", text: why})

      %{"status" => "failed", "build" => build, "why" => why} ->
        Map.put(servers, {"update", "edge"}, %{title: "The edge didn't update to #{version(build)}", text: why})

      _ ->
        servers
    end
  end

  defp went_wrong(:unknown), do: %{}

  defp under_way?(%{} = update),
    do: update["network_update_status"] in ["preparing", "restarting"] or match?(%{"status" => "deploying"}, update["edge_update"])

  defp under_way?(_update), do: false

  # A build as a person reads it, its version: `0.34.363`.
  defp version(build), do: (build || "") |> String.split("+") |> hd()

  # What a client said, as a sentence begins.
  defp sentence(nil), do: ""
  defp sentence(<<first::utf8, rest::binary>>), do: String.upcase(<<first::utf8>>) <> rest

  # The app's state, as a person says it.
  defp in_state("background"), do: "in the background"
  defp in_state("launcher"), do: "with the launcher open"
  defp in_state(_windows), do: "with windows open"

  # How long something took, as a person says it: `7 min`, `2 h 12 min`.
  defp took(ms) when ms < 3_600_000, do: "#{div(ms, @minute)} min"
  defp took(ms), do: "#{div(ms, 3_600_000)} h #{div(rem(ms, 3_600_000), @minute)} min"

  # When the last backup was, as a person says it.
  defp last_backup(0, _now), do: "It hasn't been backed up yet."
  defp last_backup(at, now) when now - at < 2 * 3_600_000, do: "The last backup was #{div(now - at, @minute)} minutes ago."
  defp last_backup(at, now) when now - at < 2 * @day, do: "The last backup was #{div(now - at, 3_600_000)} hours ago."
  defp last_backup(at, now), do: "The last backup was #{div(now - at, @day)} days ago."

  # A server's symptom, if it has one, while the relay says it's one of the network's (`active`), not one joining or
  # one that left: it keeps restarting, or it's been down 5 minutes and the relay doesn't say it's ready.
  defp server(_row, _name, _now, nil), do: nil
  defp server(_row, _name, _now, :unknown), do: nil

  defp server(row, name, now, presence) do
    cond do
      presence["server_membership"] != "active" ->
        nil

      row["looping"] && now - row["looping"] < 10 * @minute ->
        %{title: "#{name}'s server keeps restarting", text: row["why"]}

      row["failing"] && now - row["failing"] >= 5 * @minute && presence["server_ready"] != true ->
        %{title: "#{name}'s server isn't running", text: row["why"]}

      true ->
        nil
    end
  end

  ## The state machine

  # Moves every alert on by what fires now, `conditions`: a new one fires, one still firing is kept up to date,
  # and one whose symptom has been gone for its kind's while clears, unless it couldn't be asked this time (`unknown`).
  defp step(db, now, conditions, unknown) do
    firing = query(db, "select * from alerts where state = 'firing' order by id", [])
    # One alert per kind and key, the newest: any other left firing beside it, as one from before a server's
    # restart, is resolved with the rest below.
    open = Map.new(firing, &{{&1["kind"], &1["key"]}, &1})

    for {{kind, key} = id, condition} <- conditions do
      case open[id] do
        nil ->
          query(
            db,
            "insert into alerts (kind, key, state, title, text, began, last) values (?, ?, 'firing', ?, ?, ?, ?)",
            [kind, key, condition.title, condition.text, now, now]
          )

        row ->
          query(db, "update alerts set title = ?, text = ?, last = ? where id = ?", [
            condition.title,
            condition.text,
            now,
            row["id"]
          ])
      end
    end

    for %{"kind" => kind, "key" => key} = row <- firing,
        id = {kind, key},
        open[id]["id"] != row["id"] or (not Map.has_key?(conditions, id) and not unknown.(id) and now - row["last"] >= @cool[kind]) do
      query(db, "update alerts set state = 'resolved', ended = ? where id = ?", [now, row["id"]])
    end
  end

  ## Spending

  @doc """
  What AI used per model per day, newest first, over the last `hours`: tokens in and out, and what it cost where the
  endpoint said. It's added up as it's read each minute, so reading it takes no more of what's kept however far back.
  """
  def spending(call, hours) do
    since = day(System.os_time(:millisecond) - hours * 3_600_000)

    transaction(call, fn db ->
      for row <- query(db, "select day, nullif(model, '') as model, input, output, cost from spending where day >= ?", [since]) do
        %{
          day: row["day"],
          model: row["model"],
          input: round(row["input"]),
          output: round(row["output"]),
          cost: row["cost"] && Float.round(row["cost"] / 1, 6)
        }
      end
      |> Enum.sort_by(&{&1.day, &1.model}, :desc)
    end)
  end

  ## The database

  @doc "Runs `fun` in a transaction on Telemetry's database, whose tables are this module's `@schema`."
  def transaction(call, fun) do
    database = Call.app(call, "database")
    database.transaction(call, @schema, &fun.({database, &1}))
  end

  @doc "Runs one statement in a `transaction/2`."
  def query({database, db}, sql, values), do: database.query(db, sql, values)

  defp ms(ns), do: div(ns, 1_000_000)
  defp minute(ns), do: div(ms(ns), @minute) * @minute
  defp day(ms), do: ms |> DateTime.from_unix!(:millisecond) |> DateTime.to_date() |> Date.to_iso8601()
  defp first_line(text), do: Read.first_line(text)
end
