defmodule Telemetry.Store do
  @moduledoc """
  Where what's recorded is kept: blobs of the app's own artifact for the network, by the hour they're of, each an OTLP
  export request in its protobuf (`Telemetry.Otlp`), which any OpenTelemetry tool takes as it is:

      curl --data-binary @<blob> -H 'content-type: application/x-protobuf' http://localhost:4318/v1/traces

  - `otlp/<day>/<hour>/<to>-<source>-<bytes>.<signal>` is the exports of `traces`, `metrics` or `logs` that the server
    `source` held until `to`, in nanoseconds since 1970, its own SDK's and its clients' (`Telemetry.Buffer`). A busy
    server writes about two a minute of each, and an idle one none.
  - `otlp/<day>/<hour>/hour-<to>-<bytes>.<signal>.gz` is all of an hour's exports of a signal, once the hour is over
    (`prune/1`): protobuf's messages put one after the other are one message holding all of theirs, so it's still one
    export request, gzipped as OTLP/HTTP's `content-encoding: gzip` has it (`curl --data-binary @<blob> -H
    'content-encoding: gzip'`), which is what makes 14 days fit. It holds every export of its hour up to `to`, so one
    left over by a tidying that stopped partway is let go, not put in again. One kept before it was gzipped has no
    `.gz` and is read as it is.
  - `otlp/<day>/<hour>/piece-<at>-<bytes>.rollup` is what a look at the exports that arrived since the one before
    rolled up (`Telemetry.Rollup`), naming the exports it holds. Alerts write one a minute (`piece/2`) and never read
    or change one.
  - `otlp/<day>/<hour>/whole-<at>-<bytes>.rollup` is those of an hour put together once it's over (`prune/1`),
    with any export that wasn't rolled up.
  - `otlp/<day>/whole-<at>-<bytes>.rollup` is a day's hours put together, a data point of each metric for each hour
    where the hours had one for each minute, once the day is older than `@fine_days`: what a look over hours reads,
    since reading hundreds of blobs takes longer than a look should.

  What a look over hours reads of an hour is its rollups, never its exports, but for those that aren't rolled up
  yet, which are the last minute's: they're small. A trace whole is read from the blobs of the hours whose rollups
  hold its id.

  Its size is in its name, so listing them says how much is kept. What's older than `days/0`, and the oldest hours
  past `most_bytes/0`, are let go. What was kept before it was OTLP, under `batches/`, isn't read, and is let go as
  it ages.
  """
  require Logger
  require OpenTelemetry.Tracer, as: Tracer
  alias Telemetry.{Cache, Otlp, Rollup}
  alias OneCore.Artifact

  @days 14
  @most_bytes 256 * 1024 * 1024
  @hour 3_600_000_000_000
  @day 86_400_000_000_000
  # How many days back an hour keeps a rollup for each minute, which a look at a few hours steps through; before it a
  # day is one rollup, an hour a data point.
  @fine_days 2

  @doc "How many days are kept."
  def days, do: @days

  @doc "How many bytes are kept at most."
  def most_bytes, do: @most_bytes

  @doc "Keeps an OTLP export request of `signal` that the server `source` held."
  def keep(own, source, signal, otlp) when is_binary(otlp) do
    to = System.os_time(:nanosecond)
    :ok = Artifact.write(own, "#{hour(to)}/#{to}-#{source}-#{byte_size(otlp)}.#{signal}", otlp)
  end

  @doc """
  What `fun` gives of each rollup (`Telemetry.Rollup`) of what's kept of each hour that started after `from`, in
  nanoseconds since 1970, oldest first, as a stream: each hour's as its pieces and exports not rolled up yet make it, or
  its day's where the day is put together. They're read a few at a time, and `fun` is given each there, in the
  process that read it, so what a look over days holds is what `fun` gives, not the rollups. All that `Telemetry.Read`
  reads but a trace whole.
  """
  def read(call, from, fun), do: gathered(call, from, fn {_where, rollup} -> fun.(Rollup.since(rollup, from)) end)

  @doc """
  Every span and log line of the trace `id`, laid flat, from the exports of the hours that started after `from`, in
  nanoseconds since 1970, whose rollups hold its id: no other hour's is read.
  """
  def trace(call, from, id) do
    since = hour(from - @hour)

    held =
      call
      |> gathered(from, fn {_where, rollup} -> for {folder, ids} <- rollup["traces"], folder > since, Rollup.holds?(ids, id), do: folder end)
      |> Enum.concat()
      |> Enum.uniq()

    names = for folder <- held, name <- listed(call, folder), not rollup?(name), signal(name) in ["traces", "logs"], do: name

    Tracer.with_span "telemetry fetch", %{attributes: %{"one.blobs" => length(names)}} do
      for {name, {:ok, data, _tag}} <- Enum.zip(names, Artifact.read_all(call.own, names)), batch = export(name, data, id), do: batch
    end
  end

  # How many bytes of blobs are read and decoded together, before the ones read are let go of, and how many such groups
  # are read at once.
  @group_bytes 1 * 1024 * 1024
  @groups_at_once 2

  # Each rollup there is of the hours that started after `from`, with where it's from: `{where, rollup}`, an hour's
  # folder or a day's, as a stream. The rollups of an hour are those of its pieces and its whole that hold an export the
  # others don't, and its exports they don't name are rolled up as they're read. Its days and hours are read in groups,
  # each dropped once it's been through, so what a look over days holds is a few blobs, not them all.
  defp gathered(call, from, fun) do
    folders = Tracer.with_span("telemetry list", do: listed_days(call, from))
    since = hour(from - @hour)
    {days, hours} = Enum.split_with(folders, fn {folder, _names} -> day?(folder) end)
    rolled_days = for {day, names} <- Enum.sort(days), whole = latest(names), into: %{}, do: {day, whole}
    hours = for {folder, names} <- Enum.sort(hours), folder > since, not is_map_key(rolled_days, Path.dirname(folder)), do: {folder, names}

    units = Enum.map(rolled_days, fn {day, whole} -> {day, [whole]} end) ++ hours
    units = Enum.sort_by(units, fn {folder, _names} -> folder end)

    units
    |> Enum.chunk_while(
      {[], 0},
      fn {folder, names} = unit, {chunk, size} ->
        size = size + Enum.sum_by(names, &weight/1)
        if size >= @group_bytes, do: {:cont, Enum.reverse([unit | chunk]), {[], 0}}, else: {:cont, {[unit | chunk], size}}
      end,
      fn
        {[], _size} -> {:cont, []}
        {chunk, _size} -> {:cont, Enum.reverse(chunk), []}
      end
    )
    |> Task.async_stream(fn chunk -> chunk |> load_all(call) |> Enum.map(fun) end, max_concurrency: @groups_at_once, timeout: :infinity)
    |> Stream.flat_map(fn {:ok, results} -> results end)
  end

  # What reading a blob takes: its size, but not one that isn't read.
  defp weight(name), do: if(current?(name) or not (hour?(name) or rollup?(name)), do: bytes(name), else: 0)

  # The rollups of `units`, each a day's whole or an hour's folder and the names kept in it.
  defp load_all(units, call) do
    wholes = for {_folder, names} <- units, name <- names, current?(name), do: name
    read = fn _name, data -> Rollup.decode(data) end
    rollups = call |> Cache.read(wholes, read) |> Map.new()

    {days, hours} = Enum.split_with(units, fn {folder, _names} -> day?(folder) end)
    days = for {day, [whole]} <- days, rollup = rollups[whole], do: {day, rollup}

    hours =
      for {folder, names} <- hours do
        chosen = chosen(for name <- names, current?(name), rollup = rollups[name], do: {name, rollup})
        {folder, names, chosen}
      end

    unrolled = for {_folder, names, chosen} <- hours, name <- unrolled(names, chosen), do: name
    exports = call |> Cache.read(unrolled, &export_rollup/2) |> Map.new()

    days ++
      for {folder, names, chosen} <- hours,
          rollup <- chosen ++ for(name <- unrolled(names, chosen), rollup = exports[name], do: rollup),
          do: {folder, rollup}
  end

  # The rollups of an hour that hold an export no other holds, the one holding most first.
  defp chosen(rollups) do
    {chosen, _held} =
      rollups
      |> Enum.map(&elem(&1, 1))
      |> Enum.sort_by(&length(&1["exports"]), :desc)
      |> Enum.reduce({[], MapSet.new()}, fn rollup, {chosen, held} ->
        exports = MapSet.new(rollup["exports"])
        if MapSet.subset?(exports, held), do: {chosen, held}, else: {[rollup | chosen], MapSet.union(held, exports)}
      end)

    chosen
  end

  # The exports of an hour, by their names, that none of its `rolled` rollups holds, as they're read: not its hour
  # blobs, which `prune/1` has rolled up before it put them together.
  defp unrolled(names, rolled) do
    held = MapSet.new(Enum.flat_map(rolled, & &1["exports"]))
    for name <- names, not rollup?(name), not hour?(name), not MapSet.member?(held, name), do: name
  end

  defp export_rollup(name, data) do
    folder = Path.dirname(name)
    Rollup.of(List.wrap(export(name, data)), folder) |> Map.put("exports", [name])
  end

  # Each hour's folder and the names kept in it, of the hours that started after `from`, and each day's, where it's
  # put together: the days are listed at once.
  defp listed_days(call, from) do
    now = System.os_time(:nanosecond)
    days = for at <- (from - @hour)..now//@day, uniq: true, do: day(at)
    days = Enum.uniq(days ++ [day(now)])

    days
    |> Task.async_stream(&Artifact.list(call.own, "otlp/#{&1}/"), max_concurrency: 16, timeout: :infinity)
    |> Enum.flat_map(fn {:ok, names} -> names end)
    |> Enum.group_by(&Path.dirname/1)
  end

  defp listed(call, folder), do: Artifact.list(call.own, folder <> "/")

  @doc """
  Every export that ended after `from`, in nanoseconds since 1970, that isn't among `read`, by its name: the names,
  and each export laid flat with its name, read from the hours they're in before those are put together (`prune/1`).
  One put together meanwhile is named, and not given.
  """
  def since(call, from, read) do
    to = System.os_time(:nanosecond)
    hours = Enum.uniq(for(at <- from..to//@hour, do: hour(at)) ++ [hour(to)])

    names =
      for hour <- hours,
          name <- Artifact.list(call.own, hour <> "/"),
          not hour?(name),
          not rollup?(name),
          to_of(name) > from,
          name not in read,
          do: name

    {names, decoded(call.own, names)}
  end

  @doc """
  Rolls the exports `read`, each laid flat with its name, into a piece of each hour they're of, which holds only
  them. One made and never read again, as it only holds what's new: `prune/1` puts an hour's together once it's over.
  """
  def piece(_own, []), do: :ok

  def piece(own, read) do
    for {hour, read} <- Enum.group_by(read, fn {name, _batch} -> Path.dirname(name) end) do
      rollup = Rollup.of(Enum.map(read, &elem(&1, 1)), hour) |> Map.put("exports", Enum.map(read, &elem(&1, 0)))
      write(own, "#{hour}/piece-#{System.os_time(:nanosecond)}", Rollup.encode(rollup), ".rollup")
    end

    :ok
  end

  @doc "The exports kept as `names`, each by its name, as they're kept: OTLP's protobuf."
  def raw(call, names), do: for({name, {:ok, data, _tag}} <- Enum.zip(names, Artifact.read_all(call.own, names)), do: {name, data})

  @doc "The signal an export kept as `name` is of, `traces`, `metrics` or `logs`, or `nil` for one kept before OTLP."
  def signal("otlp/" <> _ = name), do: String.trim_leading(extension(name), ".")
  def signal(_name), do: nil

  @doc "How much is kept: since when, in milliseconds since 1970, how many bytes, for how many days, and the most."
  def retention(own) do
    names = Artifact.list(own, "otlp/")

    %{
      since: names |> Enum.map(&since/1) |> Enum.min(fn -> nil end),
      bytes: Enum.sum_by(names, &bytes/1),
      days: @days,
      most_bytes: @most_bytes
    }
  end

  @doc """
  Rolls up each hour that's over whole, puts its exports into one blob of each signal, puts the hours of a day that's
  older than a couple of days into one rollup, and lets go of hours older than `days/0`, and then of the oldest while
  more than `most_bytes/0` is kept. Gives what it did.
  """
  def prune(own) do
    now = System.os_time(:nanosecond)
    oldest = hour(now - @days * @day)
    names = Artifact.list(own, "otlp/") ++ Artifact.list(own, "batches/")
    kept = Enum.group_by(names, &folder/1)

    # An hour is rolled up whole and put together 10 minutes after it ends, once alerts have read its last exports
    # one by one (`since/3`, `Telemetry.Alerts`).
    # A day that's put together has nothing more to roll up.
    days = MapSet.new(for {day, _names} <- kept, String.ends_with?(day, "/24"), do: String.replace_suffix(day, "/24", ""))

    ended =
      for {hour, names} <- kept,
          hour_folder?(hour),
          hour >= oldest,
          hour < hour(now - 600_000_000_000),
          not MapSet.member?(days, Path.dirname(hour)) do
        {rolled_up, put_together} = whole(own, hour, names)
        {hour, rolled_up, put_together}
      end

    compacted = for {day, names} <- Enum.group_by(Enum.flat_map(kept, fn {_f, names} -> names end), &day_of/1), compact(own, day, names, now), do: day

    names = Artifact.list(own, "otlp/") ++ Artifact.list(own, "batches/")
    {old, retained} = Enum.split_with(Enum.sort(Enum.group_by(names, &folder/1)), fn {hour, _names} -> hour < oldest end)
    {over, _retained} = past_most(Enum.reverse(retained), 0)
    let_go = old ++ over
    let_go_names = for {_hour, names} <- let_go, name <- names, do: name

    # What it let go and why, to find out where what's kept goes: those that are older than `days/0`, and those past `most_bytes/0`.
    Tracer.set_attributes(%{
      "one.hours.old" => length(old),
      "one.hours.over" => length(over),
      "one.bytes.let_go" => Enum.sum_by(let_go_names, &bytes/1),
      "one.bytes.kept" => Enum.sum_by(retained, fn {_hour, names} -> Enum.sum_by(names, &bytes/1) end)
    })

    remove(own, let_go_names)

    %{
      put_together: Enum.count(ended, &elem(&1, 2)),
      rolled_up: Enum.count(ended, &elem(&1, 1)),
      compacted: length(compacted),
      let_go: length(let_go)
    }
  end

  # An hour that's over, rolled up whole, then its exports put together: whether each was done.
  defp whole(own, hour, names) do
    exports = Enum.reject(names, &(rollup?(&1) or hour?(&1)))
    legacy = Enum.filter(names, &(rollup?(&1) and hour?(&1)))
    rollups = Enum.filter(names, &current?/1)
    # An hour with nothing but its whole rollup and its blobs put together holds nothing to roll up.
    done = exports == [] and legacy == [] and match?([_], rollups) and Enum.all?(rollups, &whole?/1)
    rolled_up = not done and roll_up(own, hour, names, rollups)
    remove(own, legacy)

    for {signal, names} <- Enum.group_by(Enum.reject(names, &rollup?/1), &extension/1), exports != [], do: together(own, hour, signal, names)
    {rolled_up, exports != []}
  end

  # The rollup of an hour made whole: its rollups, the exports they don't name, and, where it has no rollup but one
  # kept before pieces (`legacy`) and has blobs put together, those. The pieces and the whole before it are let go.
  defp roll_up(own, hour, names, rollups) do
    read = for {name, {:ok, data, _tag}} <- Enum.zip(rollups, Artifact.read_all(own, rollups)), do: {name, Rollup.decode(data)}
    rolled = chosen(read)
    blobs = if rolled == [], do: Enum.filter(names, &(hour?(&1) and not rollup?(&1))), else: []
    fresh = for {name, batch} <- decoded(own, unrolled(names, rolled) ++ blobs), do: Rollup.of([batch], hour) |> Map.put("exports", [name])

    if rolled ++ fresh == [] do
      false
    else
      whole = Map.put(Rollup.merge(rolled ++ fresh, 60_000_000_000), "exports", Enum.flat_map(rolled ++ fresh, & &1["exports"]))
      write(own, "#{hour}/whole-#{System.os_time(:nanosecond)}", Rollup.encode(whole), ".rollup")
      remove(own, rollups)
      true
    end
  end

  # A day's hours, once the day is older than a couple of days, put into one rollup, an hour a data point. Whether it was.
  defp compact(own, day, names, now) do
    day_folder = "otlp/#{day}"

    if day_folder < "otlp/#{day(now - @fine_days * @day)}" do
      {wholes, hours} = Enum.split_with(Enum.filter(names, &rollup?/1), &day?(Path.dirname(&1)))
      {legacy, hours} = Enum.split_with(hours, &hour?/1)
      if hours == [], do: false, else: roll_day(own, day_folder, wholes, hours, legacy)
    else
      false
    end
  end

  defp roll_day(own, day_folder, wholes, hours, legacy) do
    read = for {_name, {:ok, data, _tag}} <- Enum.zip(wholes ++ hours, Artifact.read_all(own, wholes ++ hours)), do: Rollup.decode(data)
    day = Rollup.merge(read, 3_600_000_000_000)
    write(own, "#{day_folder}/whole-#{System.os_time(:nanosecond)}", Rollup.encode(day), ".rollup")
    remove(own, wholes ++ hours ++ legacy)
    true
  end

  # An hour's exports of a signal as one blob, after what it held already: an export it holds isn't added again.
  defp together(own, hour, signal, names) do
    {hours, exports} = Enum.split_with(names, &hour?/1)
    held = Enum.max(Enum.map(hours, &to_of/1), fn -> 0 end)
    {added, gone} = Enum.split_with(exports, &(to_of(&1) > held))

    if added != [] do
      read = Artifact.read_all(own, hours ++ added)
      data = for({name, {:ok, data, _tag}} <- Enum.zip(hours ++ added, read), do: if(gzipped?(name), do: :zlib.gunzip(data), else: data)) |> IO.iodata_to_binary()
      to = Enum.max(Enum.map(hours ++ added, &to_of/1))
      write(own, "#{hour}/hour-#{to}", :zlib.gzip(data), signal <> ".gz")
    end

    remove(own, if(added == [], do: gone, else: names))
  end

  # Writes a blob, its size in its name. One that's there already was written by another look at the same hour that
  # ran at the same time, as this one, from the same exports: it's the same.
  defp write(own, name, data, extension) do
    if Artifact.write(own, "#{name}-#{byte_size(data)}#{extension}", data) in [:ok, :exists], do: :ok
  end

  # Removes blobs, as many at once as the bucket takes: an hour of exports is hundreds of them.
  defp remove(own, names),
    do: names |> Task.async_stream(&Artifact.remove(own, &1), max_concurrency: 16, timeout: :infinity) |> Stream.run()

  # The newest hours that fit in `most_bytes/0`, and the rest.
  defp past_most([], _bytes), do: {[], []}

  defp past_most([{_hour, names} = latest | older], bytes) do
    bytes = bytes + Enum.sum_by(names, &bytes/1)

    if bytes > @most_bytes do
      {[latest | older], []}
    else
      {over, retained} = past_most(older, bytes)
      {over, [latest | retained]}
    end
  end

  # Each of the exports `names` laid flat, with its name. One that isn't OTLP, as a device may send anything, is passed
  # over.
  defp decoded(own, names),
    do: for({name, {:ok, data, _tag}} <- Enum.zip(names, Artifact.read_all(own, names)), batch = export(name, data), do: {name, batch})

  @doc "The export kept as `name`, laid flat, or `nil` where it isn't OTLP. Of the trace `id` only, where it's given."
  def export(name, data, id \\ nil) do
    Otlp.decode(signal(name), if(gzipped?(name), do: :zlib.gunzip(data), else: data), id)
  rescue
    ErlangError ->
      Logger.warning("Telemetry couldn't read #{name}, #{byte_size(data)} bytes starting #{inspect(binary_part(data, 0, min(8, byte_size(data))))}: it isn't OTLP")
      nil
  end

  # The latest of the rollups kept as `names`, or `nil`: a day's whole.
  defp latest(names), do: names |> Enum.filter(&current?/1) |> Enum.max_by(&to_of/1, fn -> nil end)

  defp gzipped?(name), do: Path.extname(name) == ".gz"
  # What a blob is of, `.traces`, `.metrics`, `.logs` or `.rollup`, whether or not it's gzipped.
  defp extension(name), do: name |> String.replace_suffix(".gz", "") |> Path.extname()
  defp rollup?(name), do: extension(name) == ".rollup"
  # A rollup in the form kept now: one kept before pieces is `hour-<at>-<bytes>.rollup`, and isn't read.
  defp current?(name), do: rollup?(name) and not hour?(name)
  defp hour?(name), do: String.starts_with?(Path.basename(name), "hour-")
  defp whole?(name), do: String.starts_with?(Path.basename(name), "whole-")
  defp to_of(name), do: ~r/^[a-z]+-/ |> Regex.replace(Path.basename(name), "") |> String.split("-") |> hd() |> String.to_integer()
  defp bytes(name), do: name |> String.replace_suffix(".gz", "") |> Path.rootname() |> String.split("-") |> List.last() |> String.to_integer()

  # The folder of the hour a blob is of, or of its day's: `otlp/2026-11-15/07`, `otlp/2026-11-15`. What was kept before
  # it was OTLP is of the same hour.
  defp folder(name) do
    folder = name |> Path.dirname() |> String.replace_prefix("batches/", "otlp/")
    if day?(folder), do: folder <> "/24", else: folder
  end

  # Whether a folder is a day's, `otlp/2026-11-15`, and not an hour's.
  defp day?(folder), do: length(String.split(folder, "/")) == 2
  defp hour_folder?(folder), do: length(String.split(folder, "/")) == 3 and not String.ends_with?(folder, "/24")
  defp day_of(name), do: name |> String.split("/") |> Enum.at(1)

  # When the oldest kept is from, in milliseconds since 1970: the start of its hour.
  defp since(name) do
    [_, day, hour | _] = String.split(name, "/")
    {:ok, at, 0} = DateTime.from_iso8601("#{day}T#{if String.contains?(hour, "-"), do: "00", else: hour}:00:00Z")
    DateTime.to_unix(at, :millisecond)
  end

  # The folder of the hour a time in nanoseconds since 1970 is in: `otlp/2026-11-15/07`.
  defp hour(at) do
    time = DateTime.from_unix!(div(at, 1_000_000_000))
    "otlp/#{Date.to_iso8601(time)}/#{String.pad_leading(to_string(time.hour), 2, "0")}"
  end

  defp day(at), do: at |> div(1_000_000_000) |> DateTime.from_unix!() |> Date.to_iso8601()
end
