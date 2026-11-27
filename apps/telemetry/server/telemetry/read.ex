defmodule Telemetry.Read do
  @moduledoc """
  What's kept, read: errors by kind, tools by how long they took, a trace whole and a metric over time, from OTLP laid
  flat (`Telemetry.Otlp`). Numbers are OpenTelemetry's histograms, with explicit buckets, which add up by their buckets and give quantiles within a bucket; times out of here are milliseconds.
  """

  @doc """
  The errors in `records`, each kind once (`kind/1`), most recent first: failed spans by their name, and
  warnings and errors that were logged (`span: false`), whichever server logged them. A span another server ran is
  that one's. Each is `from` the client that asked, or where none did, the server or the edge it happened on. A call refused for what it was given or who asked is the caller's mistake, not an error. `shown` says
  whether whose a call was may be shown. `records` are those of `error_events/1`, folded by the hour they happened in
  (`folded/2`), as `Telemetry.Rollup` keeps them.
  """
  def errors(records, shown) do
    records
    |> folded(&{&1["span"], &1["where"], &1["kind"]})
    |> Enum.map(fn record ->
      %{
        where: if(record["span"] or record["servers"] == [], do: record["where"], else: "#{record["where"]} on #{Enum.join(record["servers"], ", ")}"),
        message: record["message"],
        count: record["count"],
        first: record["first"],
        minutes: record["minutes"] |> Enum.sort() |> Enum.map(fn {at, count} -> %{at: at, count: count} end),
        at: record["at"],
        took: record["took"],
        trace: record["trace"],
        server: record["server"],
        from: record["from"],
        whose: if(record["whose"] != nil and shown.(record["whose"]), do: record["whose"]),
        span: record["span"],
        code: record["code"],
        stack: record["stack"]
      }
    end)
    |> Enum.sort_by(& &1.at, :desc)
  end

  @doc """
  What of `batches` is an error, one record for each occurrence: a failed span, or a warning or error logged outside
  a call (what was logged during a call is that call's, read in its trace: what failed of it is its span). A client's
  request that a server answered with an error is that server's span, said to be from the client.
  """
  def error_events(batches) do
    all = Enum.flat_map(batches, & &1["spans"])
    clients = for %{"kind" => "client"} = span <- all, into: %{}, do: {span["traceId"], from(span)}
    failed_traces = for span <- all, span["kind"] == "server", failed?(span) or refused?(span), into: MapSet.new(), do: span["traceId"]

    spans =
      for span <- all,
          failed?(span),
          span["attributes"]["one.forwarded"] != true,
          span["kind"] != "client" or not MapSet.member?(failed_traces, span["traceId"]) do
        event(%{
          "span" => true,
          "where" => span["name"],
          "message" => message(span["status"]["message"]),
          "at" => ms(span["end"]),
          "took" => took(span),
          "trace" => span["traceId"],
          "whose" => span["attributes"]["one.for"],
          "server" => span["server"],
          "from" => from(span) || clients[span["traceId"]] || span["server"],
          "code" => nil,
          "stack" => nil
        })
      end

    logs =
      for log <- Enum.flat_map(batches, & &1["logs"]),
          log["severity"] in ["WARN", "ERROR"],
          log["spanId"] == nil,
          log["attributes"]["one.outcome"] != "refused" do
        event(%{
          "span" => false,
          "where" => logged(log),
          "message" => message(log["body"]),
          "at" => ms(log["time"]),
          "took" => nil,
          "trace" => log["traceId"],
          "whose" => nil,
          "server" => log["server"],
          "from" => from(log) || log["server"],
          "code" => code(log["attributes"]),
          "stack" => log["attributes"]["exception.stacktrace"]
        })
      end

    spans ++ logs
  end

  # One occurrence as a record that more fold into (`folded/2`).
  defp event(record) do
    Map.merge(record, %{
      "kind" => kind(record["message"]),
      "hour" => div(record["at"], 3_600_000),
      "count" => 1,
      "first" => record["at"],
      "minutes" => %{div(record["at"], 60_000) * 60_000 => 1},
      "servers" => if(record["server"], do: [record["server"]], else: [])
    })
  end

  @doc """
  `records` as one for each hour and kind that has some, or by `key`: the newest one's, with how often they were, when
  the first was, how often in each minute, and which servers.
  """
  def folded(records, key \\ &{&1["hour"], &1["span"], &1["where"], &1["kind"]}) do
    for {_key, all} <- Enum.group_by(records, key) do
      %{
        Enum.max_by(all, & &1["at"])
        | "count" => Enum.sum_by(all, & &1["count"]),
          "first" => all |> Enum.map(& &1["first"]) |> Enum.min(),
          "minutes" => Enum.reduce(all, %{}, fn record, minutes -> Map.merge(minutes, record["minutes"], fn _minute, a, b -> a + b end) end),
          "servers" => all |> Enum.flat_map(& &1["servers"]) |> Enum.uniq() |> Enum.sort()
      }
    end
  end

  @minute 60_000_000_000
  @hour 60 * @minute

  @doc """
  What each of the rollups says of how long tools took and how many calls failed, and of the errors there were, as the
  step grids `grids/2` says: each rollup's partial answer, which `scan/1` puts together. They're made one rollup at a
  time, as it's read (`Telemetry.Store.read/3`), so what a look over days holds is the answers, not the rollups.
  """
  def scan_rollup(rollup, {slow, calls}) do
    acc = %{errors: [rollup["errors"]], tools: %{}, opens: %{}, calls: %{}}
    Enum.reduce(rollup["series"], acc, &tally(&1, &2, slow, calls))
  end

  @doc """
  The step grids of a look from `from` to `to`: where each starts and how long each step is, of about 24 steps for how
  long tools took and about 48 for calls.
  """
  def grids(from, to), do: {grid(from, max(div(to - from, 24), @minute)), grid(from, max(div(to - from, 48), @minute))}

  @doc """
  The partial answers of `scan_rollup/2` put together, oldest first, with the grids they were made with: the errors, the
  tools by their histograms for all of `from` to `to` and for each step, how long each app took to open the same, and
  each step's calls and failed calls (`slowest/2`, `calls/1`).
  """
  def scan(partials, {slow, calls}, to) do
    empty = %{errors: [], tools: %{}, opens: %{}, calls: %{}}

    all =
      Enum.reduce(partials, empty, fn partial, all ->
        %{
          errors: partial.errors ++ all.errors,
          tools:
            Map.merge(all.tools, partial.tools, fn _key, a, b ->
              %{failed: a.failed + b.failed, task: a.task or b.task, total: plus(a.total, b.total), steps: merge_steps(a.steps, b.steps)}
            end),
          opens: Map.merge(all.opens, partial.opens, fn _key, a, b -> %{total: plus(a.total, b.total), steps: merge_steps(a.steps, b.steps)} end),
          calls: Map.merge(all.calls, partial.calls, fn _index, {n, f}, {n2, f2} -> {n + n2, f + f2} end)
        }
      end)

    %{all | errors: Enum.concat(all.errors)} |> Map.merge(%{slow: slow, steps: calls, to: to})
  end

  defp merge_steps(a, b), do: Map.merge(a, b, fn _index, x, y -> plus(x, y) end)

  # A step's grid from `from` to `to`: where its first starts and how long each is. Steps start on a whole minute and are
  # whole minutes, as a rollup adds a metric's points up by the minute they end in (`Telemetry.Rollup`), so none is
  # split. Where a step is an hour or more they're whole hours, as a rollup of a day has a point for each hour.
  defp grid(from, step) do
    unit = if step >= @hour, do: @hour, else: @minute
    {from - rem(from, unit), step + rem(unit - rem(step, unit), unit)}
  end

  # The step a point is in, after the grid's start, up to its end, or `nil` for one before it.
  defp step_of({time, _count, _sum, _min, _max, _buckets}, {from, step}) do
    time = time * 1_000_000
    if time > from, do: div(time - from - 1, step)
  end

  defp histogram({_time, count, sum, min, max, buckets}, series),
    do: %{"count" => count, "sum" => sum, "buckets" => for(<<n::32 <- buckets>>, do: n), "min" => min, "max" => max, "bounds" => Telemetry.Rollup.bounds_of(series)}

  defp tally(%{"name" => "one.tool.duration", "attributes" => a} = series, acc, slow, calls) do
    key = {a["one.app"], a["one.tool"]}
    tool = Map.get(acc.tools, key, %{failed: 0, task: false, total: nil, steps: %{}})
    failed? = a["one.outcome"] == "error"

    tool =
      Enum.reduce(series["points"], %{tool | task: tool.task or a["one.task"] == true}, fn {_time, count, _sum, _min, _max, _buckets} = point, tool ->
        hist = histogram(point, series)

        %{
          tool
          | failed: tool.failed + if(failed?, do: count, else: 0),
            total: plus(tool.total, hist),
            steps: add_step(tool.steps, point, slow, hist)
        }
      end)

    called =
      Enum.reduce(series["points"], acc.calls, fn {_time, count, _sum, _min, _max, _buckets} = point, called ->
        failed = if failed?, do: count, else: 0
        if index = step_of(point, calls), do: Map.update(called, index, {count, failed}, fn {n, f} -> {n + count, f + failed} end), else: called
      end)

    %{acc | tools: Map.put(acc.tools, key, tool), calls: called}
  end

  defp tally(%{"name" => "one.client.open.duration", "attributes" => a} = series, acc, slow, _calls) do
    view = Map.get(acc.opens, a["one.view"], %{total: nil, steps: %{}})

    view =
      Enum.reduce(series["points"], view, fn point, view ->
        hist = histogram(point, series)
        %{view | total: plus(view.total, hist), steps: add_step(view.steps, point, slow, hist)}
      end)

    %{acc | opens: Map.put(acc.opens, a["one.view"], view)}
  end

  defp tally(_series, acc, _slow, _calls), do: acc

  defp add_step(steps, point, grid, hist) do
    if index = step_of(point, grid), do: Map.update(steps, index, hist, &plus(&1, hist)), else: steps
  end

  # Two histograms counted in the same buckets, added up.
  defp plus(nil, hist), do: hist
  defp plus(hist, nil), do: hist

  defp plus(a, b) do
    %{
      "count" => a["count"] + b["count"],
      "sum" => a["sum"] + b["sum"],
      "buckets" => Enum.zip_with(a["buckets"], b["buckets"], &(&1 + &2)),
      "min" => Enum.min(Enum.reject([a["min"], b["min"]], &is_nil/1), fn -> nil end),
      "max" => Enum.max(Enum.reject([a["max"], b["max"]], &is_nil/1), fn -> nil end),
      "bounds" => a["bounds"]
    }
  end

  @doc """
  How long each tool took, slowest first by its 95th percentile, then how long each app took to open: its calls,
  its failures, its 50th, 95th and 99th percentiles in milliseconds, and its 95th over time, about 24 steps from
  `from` to `to`. `names` is what a person calls each app.
  """
  def slowest(%{slow: {from, step}, to: to} = scan, names) do
    count = count_steps(from, to, step)

    tools =
      for {{app, tool}, tool_read} <- scan.tools do
        quantiles = quantiles(tool_read.total)

        Map.merge(quantiles, %{
          app: app,
          tool: tool,
          called: Map.get(names, app, app),
          failed: tool_read.failed,
          # A tool that keeps its caller waiting this long should let them carry on meanwhile.
          should_be_task: quantiles.p95 > 10_000 and not tool_read.task,
          over_time: over_time(tool_read.steps, count)
        })
      end

    opens =
      for {view, opened} <- scan.opens do
        Map.merge(quantiles(opened.total), %{view: view, called: Map.get(names, view, view), failed: 0, over_time: over_time(opened.steps, count)})
      end

    Enum.sort_by(tools, & &1.p95, :desc) ++ Enum.sort_by(opens, & &1.p95, :desc)
  end

  defp count_steps(from, to, step), do: if(to < from, do: 0, else: div(to - from, step) + 1)
  defp over_time(steps, count), do: for(index <- 0..(count - 1)//1, do: if(hist = steps[index], do: quantiles(hist).p95))

  @doc "Calls and failed calls in about 48 steps from `from` to `to`: each step's start in milliseconds and its counts."
  def calls(%{steps: {from, step}, to: to, calls: called}) do
    for index <- 0..(count_steps(from, to, step) - 1)//1 do
      {calls, failed} = Map.get(called, index, {0, 0})
      %{at: ms(from + index * step), calls: calls, failed: failed}
    end
  end

  @doc """
  One trace's spans, by when each started: its depth under the span it's in, its server, its start since the
  trace's and its duration in milliseconds, its outcome and its events.
  """
  def trace(batches, id, shown) do
    spans = for b <- batches, s <- b["spans"], s["traceId"] == id, uniq: true, do: s
    logs = for b <- batches, l <- b["logs"], l["traceId"] == id, uniq: true, do: l

    case spans do
      [] ->
        []

      spans ->
        began = Enum.min(Enum.map(spans, & &1["start"]))
        parents = Map.new(spans, &{&1["spanId"], &1["parentSpanId"]})
        depth = fn span -> depth(parents, span["parentSpanId"], 0) end

        spans
        |> Enum.sort_by(& &1["start"])
        |> Enum.map(fn span ->
          logged =
            for l <- logs,
                l["spanId"] == span["spanId"],
                do: %{name: l["eventName"] || l["severity"], at: ms(l["time"] - began), body: l["body"]}

          %{
            span: span["spanId"],
            parent: span["parentSpanId"],
            name: span["name"],
            depth: depth.(span),
            server: from(span) || span["server"],
            client: from(span) != nil,
            start: ms(span["start"] - began),
            took: took(span),
            outcome: if(failed?(span), do: "error", else: "ok"),
            message: span["status"]["message"],
            attributes:
              Map.delete(span["attributes"], if(shown.(span["attributes"]["one.for"]), do: nil, else: "one.for")),
            events:
              Enum.map(span["events"], &%{name: &1["name"], at: ms(&1["time"] - began), attributes: &1["attributes"]}) ++
                logged
          }
        end)
    end
  end

  defp depth(parents, parent, depth) when is_map_key(parents, parent), do: depth(parents, parents[parent], depth + 1)
  defp depth(_parents, _parent, depth), do: depth

  @doc "Every metric there is in a rollup, with the names of its attributes and how many it counted: `metrics/1` puts them together."
  def metrics_rollup(rollup) do
    Enum.reduce(rollup["series"], %{}, fn series, all ->
      {keys, count} = Map.get(all, series["name"], {MapSet.new(), 0})
      keys = Enum.reduce(Map.keys(series["attributes"]), keys, &MapSet.put(&2, &1))
      Map.put(all, series["name"], {keys, count + Enum.sum_by(series["points"], &elem(&1, 1))})
    end)
  end

  @doc "Every metric there is, with the names of its attributes and how many it counted, of the answers of `metrics_rollup/1`."
  def metrics(partials) do
    partials
    |> Enum.reduce(%{}, fn partial, all -> Map.merge(all, partial, fn _name, {keys, count}, {keys2, count2} -> {MapSet.union(keys, keys2), count + count2} end) end)
    |> Enum.map(fn {name, {keys, count}} -> %{name: name, attributes: Enum.sort(keys), count: count} end)
    |> Enum.sort_by(& &1.name)
  end

  @doc """
  What a rollup says of the metric `name`, of the data with all of `attributes`, split by `by`, in steps of the grid: each
  group by its values of them, with which client it's from and its histogram for each step. `series/6` puts them
  together.
  """
  def series_rollup(rollup, name, attributes, by, grid) do
    for series <- rollup["series"],
        series["name"] == name,
        Enum.all?(attributes, fn {k, v} -> series["attributes"][k] == v end),
        reduce: %{} do
      groups ->
        values = Map.new(by, &{&1, series["attributes"][&1]})
        group = Map.get(groups, values, %{from: from(%{"attributes" => series["attributes"]}), steps: %{}})
        steps = Enum.reduce(series["points"], group.steps, fn point, steps -> add_step(steps, point, grid, histogram(point, series)) end)
        Map.put(groups, values, %{group | steps: steps})
    end
  end

  @doc "The grid of the steps of a metric from `from` to `to`, of `step` minutes, or about 48 steps if `nil`."
  def series_grid(from, to, step), do: grid(from, if(step, do: step * @minute, else: max(div(to - from, 48), @minute)))

  @doc """
  The metric `name` in steps from the grid's start to `to`, by the answers of `series_rollup/5`: each step's start in
  milliseconds, its count, its sum and its quantiles. Split by the attributes named in `by`, as `one.device` and
  `service.version`, it's `groups`: each with its values of them, which client it's from where it's one's, and its own
  steps.
  """
  def series(partials, name, {from, step}, to, by \\ []) do
    groups =
      Enum.reduce(partials, %{}, fn partial, all ->
        Map.merge(all, partial, fn _values, a, b -> %{from: a.from || b.from, steps: merge_steps(a.steps, b.steps)} end)
      end)

    if groups == %{},
      do: raise(OneCore.Call.Refused, "Nothing's recorded of #{name} with those attributes then. `metric` with no name lists what is.")

    steps = fn group ->
      for index <- 0..(count_steps(from, to, step) - 1)//1 do
        Map.put(if(hist = group.steps[index], do: quantiles(hist), else: %{count: 0}), :at, ms(from + index * step))
      end
    end

    if by == [] do
      %{name: name, steps: steps.(groups[%{}])}
    else
      groups = for {values, group} <- groups, do: %{by: values, from: group.from, steps: steps.(group)}
      %{name: name, groups: Enum.sort_by(groups, & &1.by)}
    end
  end

  # Where a log line is from, as a person reads it: an app's page or a client that failed, or the server that logged
  # it.
  # Where an exception threw, as OpenTelemetry's `code` attributes say it: a page's, in its app's source.
  defp code(%{"code.file.path" => file, "code.line.number" => line}) when is_binary(file), do: "#{file}:#{line}"
  defp code(%{"code.file.path" => file}) when is_binary(file), do: file
  defp code(_attributes), do: nil

  defp logged(%{"eventName" => "exception", "attributes" => %{"one.app" => app}}), do: "#{app} page"
  defp logged(%{"eventName" => name}) when is_binary(name) and name != "", do: name
  defp logged(%{"severity" => "WARN"}), do: "Warning"
  # One kind of log line is the same on every server: which servers it was on is said once (`errors/2`).
  defp logged(_log), do: "Error"

  @doc """
  A kind of error, by its message: its first line, as Elixir's banner says it whether or not it starts `** `, up to
  where its stack starts, an S3 error's XML as its `Code`, and what changes from one to the next, numbers, ids and
  processes, taken out: what `Telemetry.Alerts` tells of when it's new. So one cause is one kind however many servers, builds and requests it was on.
  """
  def kind(message) do
    message
    |> message()
    |> String.replace(~r/, (\([\w]+ [^)]*\) )?[^,]*\.exs?:\d+:.*$/, "")
    |> String.replace(~r/#PID<[^>]*>/, "#PID<…>")
    |> String.replace(~r/\breference\s*=\s*[\w-]+/i, "reference = …")
    |> String.replace(~r/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, "…")
    |> String.replace(~r/\b(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{12,}\b/i, "…")
    |> String.replace(~r/[0-9a-f]{8,}/i, "…")
    |> String.replace(~r/\d+/, "#")
    |> String.slice(0, 300)
  end

  # A message as it's shown: its first line, without the `** ` Elixir puts before a banner, and an S3 error's XML as
  # its `Code`.
  defp message(text) do
    text
    |> first_line()
    |> String.replace_prefix("** ", "")
    |> String.replace(~r/\\?"?<\?xml.*?<Code>([^<]+)<\/Code>.*?<\/Error>\\?"?/, "\\1")
  end

  @doc """
  Which client a record is from, as a person reads it, from what the client said of itself: "App on Andre's
  iPhone", "claude-code (MCP) on linux". `nil` for a server's own.
  """
  def from(%{"attributes" => %{"service.name" => service} = attributes}) when service not in ["one-server", "one-edge"] do
    on = if attributes["host.name"], do: " on #{attributes["host.name"]}", else: ""

    case service do
      "app" -> "App#{on}"
      "mcp" -> "#{attributes["mcp.client.name"] || "An assistant"} (MCP)#{on}"
      "cli" -> "one#{on}"
      "web" -> "Web, #{attributes["user_agent.name"] || "a browser"}"
      other -> "#{other}#{on}"
    end
  end

  def from(_record), do: nil

  ## Histograms

  @doc false
  # Histograms of one metric added up, bucket by bucket: they're counted in the same buckets (`OneCore.Otlp.buckets/0`).
  # A sum's points add up as one with no buckets.
  def added([first | _] = points) do
    buckets = points |> Enum.map(&(&1["buckets"] || [])) |> Enum.zip_with(&Enum.sum/1)

    Map.merge(first, %{
      "start" => Enum.min(Enum.map(points, & &1["start"])),
      "time" => Enum.max(Enum.map(points, & &1["time"])),
      "count" => Enum.sum_by(points, & &1["count"]),
      "sum" => Enum.sum_by(points, & &1["sum"]),
      "buckets" => buckets,
      "min" => points |> Enum.map(& &1["min"]) |> Enum.reject(&is_nil/1) |> Enum.min(fn -> nil end),
      "max" => points |> Enum.map(& &1["max"]) |> Enum.reject(&is_nil/1) |> Enum.max(fn -> nil end)
    })
  end

  @doc false
  # A histogram's count, sum, and its 50th, 95th and 99th percentiles, each placed in its bucket as a straight line
  # from the bucket's lower bound to its upper, the lowest and the highest bound being the smallest and largest seen.
  def quantiles(%{"count" => count} = histogram) do
    %{
      count: count,
      sum: Float.round(histogram["sum"] / 1, 3),
      p50: quantile(histogram, 0.5),
      p95: quantile(histogram, 0.95),
      p99: quantile(histogram, 0.99)
    }
  end

  defp quantile(%{"count" => 0}, _q), do: nil
  defp quantile(%{"buckets" => []} = histogram, _q), do: Float.round(histogram["sum"] / histogram["count"], 3)

  defp quantile(%{"count" => count, "buckets" => buckets, "bounds" => bounds} = histogram, q) do
    low = histogram["min"] || 0
    high = histogram["max"] || List.last(bounds) || 0
    edges = Enum.zip([low | bounds], bounds ++ [high])
    rank = q * count

    Enum.zip(buckets, edges)
    |> Enum.reduce_while(0, fn {n, {from, to}}, below ->
      if n > 0 and below + n >= rank do
        {from, to} = {max(from, low), min(to, high)}
        {:halt, {:at, from + (to - from) * (rank - below) / n}}
      else
        {:cont, below + n}
      end
    end)
    |> case do
      {:at, at} -> Float.round(at / 1, 3)
      _ -> Float.round(high / 1, 3)
    end
  end

  ## Spans

  defp failed?(span), do: span["status"]["code"] == "error"
  defp refused?(span), do: span["attributes"]["one.outcome"] == "refused"
  defp took(span), do: Float.round((span["end"] - span["start"]) / 1_000_000, 3)

  @doc """
  The first line of an error's message. Where that's the plain "Something went wrong." a person's screen shows of a
  fault (`OneCore.Apps.held/2`), it's followed by the cause it wraps, whose first line is the rest of the kind.
  """
  def first_line(nil), do: ""

  def first_line(text) do
    case text |> String.split("\n", trim: true, parts: 3) do
      ["Something went wrong." = plain, cause | _] -> plain <> " " <> cause
      [line | _] -> line
      [] -> ""
    end
  end

  defp ms(ns), do: div(ns, 1_000_000)
end
