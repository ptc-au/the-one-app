defmodule Telemetry.Cache do
  @moduledoc """
  What this server has read of what's kept, by each blob's name, as `Telemetry.Store` reads it, kept between calls: a
  blob never changes once it's kept, and every look reads the same ones again, each rollup and the exports not rolled
  up yet. It's in a table of the process that owns it, so a look takes only the blobs it asks for out of it. What no
  look has asked for in `@unused` is let go, and so is the least recently asked for while more than `@most_bytes` is
  held, so a look over days can't take a server's memory, however many there are. A new build of Telemetry starts
  with nothing (`code_change/3`), since what an older one kept may be in another shape.
  """
  use GenServer
  alias OpenTelemetry.Tracer
  alias OneCore.{Artifact, Call}

  @unused 600_000
  @most_bytes 64 * 1024 * 1024

  @doc """
  Each of the blobs `names` that's there, by its name, as `read` gives it from its name and what's in it, reading from
  the bucket only those not kept here, and keeping them.
  """
  def read(_call, [], _read), do: []

  def read(call, names, read) do
    cache = Call.process(call, __MODULE__, :read, nil)
    table = GenServer.call(cache, :table)
    now = System.monotonic_time(:millisecond)

    kept =
      for name <- names, [{_name, value, _bytes, _at}] <- [:ets.lookup(table, name)], into: %{} do
        :ets.update_element(table, name, {4, now})
        {name, value}
      end

    missing = Enum.reject(names, &is_map_key(kept, &1))
    Tracer.set_attribute("one.read", length(missing))
    got = for {name, {:ok, data, _tag}} <- Enum.zip(missing, Artifact.read_all(call.own, missing)), into: %{}, do: {name, read.(name, data)}

    for {name, value} <- got, do: :ets.insert(table, {name, value, :erts_debug.flat_size(value) * :erlang.system_info(:wordsize), now})
    GenServer.cast(cache, :trim)
    for name <- names, value = Map.get_lazy(kept, name, fn -> got[name] end), do: {name, value}
  end

  # The table: each blob read, by its name, what it was, its size in bytes in memory and when a look last asked for it.
  @impl true
  def init(nil), do: {:ok, :ets.new(__MODULE__, [:set, :public, read_concurrency: true])}

  @impl true
  def handle_call(:table, _from, table), do: {:reply, table, table}

  @impl true
  def handle_cast(:trim, table) do
    now = System.monotonic_time(:millisecond)
    all = :ets.select(table, [{{:"$1", :_, :"$2", :"$3"}, [], [{{:"$3", :"$1", :"$2"}}]}])
    {unused, kept} = Enum.split_with(all, fn {at, _name, _bytes} -> now - at > @unused end)
    for {_at, name, _bytes} <- unused, do: :ets.delete(table, name)
    drop(table, Enum.sort(kept), Enum.sum_by(kept, &elem(&1, 2)))
    {:noreply, table}
  end

  # Lets go of the least recently asked for while more than `@most_bytes` is held.
  defp drop(_table, [], _total), do: :ok
  defp drop(_table, _entries, total) when total <= @most_bytes, do: :ok

  defp drop(table, [{_at, name, bytes} | rest], total) do
    :ets.delete(table, name)
    drop(table, rest, total - bytes)
  end

  @impl true
  def code_change(_version, kept, _extra) do
    if is_reference(kept) or is_integer(kept), do: :ets.delete(kept)
    {:ok, :ets.new(__MODULE__, [:set, :public, read_concurrency: true])}
  end
end
