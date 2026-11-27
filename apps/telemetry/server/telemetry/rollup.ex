defmodule Telemetry.Rollup do
  @moduledoc """
  What's kept of an hour of exports, or of a day, rolled up as observability stores roll up what they're sent: all that
  `Telemetry.Read` needs but a trace whole, in a form small enough that a look over days reads a few blobs, each a few
  hundred kilobytes, and keeps none of them decoded for long. It's a map:

  - `errors`: each kind of error that happened in an hour, once (`Telemetry.Read.errors/2`'s records): how often,
    when it was first and last, how often in each minute, and what its newest was. Its failed spans and the warnings
    and errors logged outside a call, whichever server.
  - `seen`: each kind of error as `Telemetry.Alerts` tells of it when it's new, `{kind, device, place, message}`.
  - `series`: each metric with its attributes, once, as a list of data points that are added up by the minute they end
    in (the hour, in a day's), as `Telemetry.Read` steps through them: whichever server they're from. A point is a tuple,
    `{time, count, sum, min, max, buckets}`, its time in milliseconds and its buckets' counts each 32 bits in a binary,
    which is a fifth of what the same as a map is in memory.
  - `traces`: the ids of the traces that have a span here, by the hour's folder, each 16 bytes, one after the
    other. Whether a trace is here is read of it, and the trace from the hour's exports.
  - `exports`: the exports it holds, by their names, where it's an hour's.

  It's kept as Erlang's external term format, compressed.
  """
  alias Telemetry.{Alerts, Read}

  @minute 60_000_000_000

  @doc "The rollup of `batches`, exports laid flat, of the hour in `folder`."
  def of(batches, folder) do
    %{
      "errors" => batches |> Read.error_events() |> Read.folded(),
      "seen" => Alerts.seen(batches),
      "series" => series(batches),
      "traces" => %{folder => ids(batches)},
      "exports" => []
    }
  end

  # The ids of the traces that have a span in `batches`, 16 bytes each, none twice.
  defp ids(batches) do
    for(batch <- batches, span <- batch["spans"], into: MapSet.new(), do: span["traceId"])
    |> Enum.map(&Base.decode16!(&1, case: :lower))
    |> IO.iodata_to_binary()
  end

  @doc "Whether `ids`, a rollup's, has the trace `id`, 32 hexadecimal digits."
  def holds?(ids, id) do
    id = Base.decode16!(id, case: :lower)
    Enum.any?(:binary.matches(ids, id), fn {at, _size} -> rem(at, 16) == 0 end)
  end

  defp series(batches) do
    for {{name, attributes}, points} <- batches |> Enum.flat_map(& &1["metrics"]) |> Enum.group_by(&{&1["name"], &1["attributes"]}) do
      %{"name" => name, "attributes" => attributes, "bounds" => bounds(Enum.find_value(points, & &1["bounds"])), "points" => binned(points, @minute)}
    end
  end

  # Every series of a server's counts in the same buckets (`OneCore.Otlp.buckets/0`), which a rollup says as `:default`
  # rather than once for each series.
  @default_bounds Enum.map([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000, 300_000], &(&1 / 1))

  defp bounds(@default_bounds), do: :default
  defp bounds(bounds), do: bounds

  @doc "A series' histogram bounds, as the points in it were counted in them."
  def bounds_of(%{"bounds" => :default}), do: @default_bounds
  def bounds_of(%{"bounds" => bounds}), do: bounds

  # Data points, laid flat, added up by the `bin` they end in, oldest first, as they're kept.
  defp binned(points, bin) do
    points
    |> Enum.group_by(&div(&1["time"] - 1, bin))
    |> Enum.sort()
    |> Enum.map(fn {_bin, points} -> points |> Read.added() |> pack() end)
  end

  defp pack(point),
    do: {div(point["time"], 1_000_000), point["count"], point["sum"], point["min"], point["max"], for(n <- point["buckets"], into: <<>>, do: <<n::32>>)}

  @doc "A data point as it's kept, laid flat, its time in nanoseconds."
  def unpack({time, count, sum, min, max, buckets}),
    do: %{"start" => time * 1_000_000, "time" => time * 1_000_000, "count" => count, "sum" => sum, "min" => min, "max" => max, "buckets" => for(<<n::32 <- buckets>>, do: n)}

  @doc """
  `rollups` as one, whose data points are added up by the `bin` they end in, nanoseconds, so a day's is a rollup
  with a point for each hour.
  """
  def merge(rollups, bin) do
    series =
      for {{name, attributes}, all} <- rollups |> Enum.flat_map(& &1["series"]) |> Enum.group_by(&{&1["name"], &1["attributes"]}) do
        %{
          "name" => name,
          "attributes" => attributes,
          "bounds" => Enum.find_value(all, & &1["bounds"]),
          "points" => all |> Enum.flat_map(& &1["points"]) |> Enum.map(&unpack/1) |> binned(bin)
        }
      end

    %{
      "errors" => rollups |> Enum.flat_map(& &1["errors"]) |> Read.folded(),
      "seen" => rollups |> Enum.flat_map(& &1["seen"]) |> Enum.uniq(),
      "series" => series,
      "traces" => Enum.reduce(rollups, %{}, fn rollup, all -> Map.merge(all, rollup["traces"], fn _folder, ids, more -> ids <> more end) end),
      "exports" => []
    }
  end

  @doc """
  `rollup` without the errors of hours before the one `from`, nanoseconds since 1970, is in: a day's has each hour's, and
  a look starts at an hour.
  """
  def since(rollup, from) do
    hour = div(from, 3_600_000_000_000)
    %{rollup | "errors" => Enum.filter(rollup["errors"], &(&1["hour"] >= hour))}
  end

  @doc """
  The data points of the metrics in `rollup` for which `keep` is true of the name and the attributes, laid flat: each
  with its `name`, its `attributes` and, where a histogram's, its `bounds`.
  """
  def points(rollup, keep) do
    for series <- rollup["series"], keep.(series["name"], series["attributes"]), point <- series["points"] do
      point = Map.merge(unpack(point), %{"name" => series["name"], "attributes" => series["attributes"]})
      if series["bounds"], do: Map.put(point, "bounds", bounds_of(series)), else: point
    end
  end

  def encode(rollup), do: :erlang.term_to_binary(rollup, compressed: 6)
  def decode(data), do: :erlang.binary_to_term(data, [:safe])
end
