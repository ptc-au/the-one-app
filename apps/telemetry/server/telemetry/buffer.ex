defmodule Telemetry.Buffer do
  @moduledoc """
  What servers and clients export, held in memory on this server and kept every `@every` (`Telemetry.Store.keep/4`),
  as the OpenTelemetry Collector's batch processor holds what it's sent: so a hook that's told of an export answers
  at once, however slow the bucket is just then, and an hour's exports are a few blobs a minute rather than one for
  each.

  OTLP's export requests put one after the other are one request holding all of theirs, so what's held of a signal
  is kept as one blob. What couldn't be kept is held for the next time, up to `@most` bytes, past which the oldest
  is let go, saying how much. What's held when the server stops is kept as it stops.

  What's held is on this server's disk too, as the Collector's file storage holds its queue: each export is added to
  the app's own file (`buffered.otlp` in `OneCore.Call`'s `folder`) as it arrives, and the file is written again as
  what's held changes, so a crash or a reboot loses none of it, and it's kept after the server starts again. An export
  there is its signal's name and its bytes, each after its size: a byte for the name, 4 for the bytes.
  """
  use GenServer
  require Logger
  alias OneCore.Call
  alias Telemetry.{Otlp, Store}

  @every 30_000
  @most 16 * 1024 * 1024

  @doc "Holds `otlp`, an export request of `signal`, to be kept in `call`'s own artifact with the next."
  def add(%Call{} = call, signal, otlp) when is_binary(otlp) do
    if signal not in Otlp.signals(), do: raise("There's no signal #{signal}: it's one of #{Enum.join(Otlp.signals(), ", ")}")
    buffer = Call.process(call, __MODULE__, call.own.prefix, {String.slice(call.server, 0, 8), Path.join(call.folder, "buffered.otlp")})
    GenServer.cast(buffer, {:add, call.own, signal, otlp})
  end

  # `held` is each signal's exports, newest first, as `file` has them, and `own` the artifact they're kept in, as the
  # last call had it: none until a call says, after the server starts.
  @impl true
  def init({source, file}) do
    Process.flag(:trap_exit, true)
    Process.send_after(self(), :keep, @every)
    File.mkdir_p!(Path.dirname(file))

    held =
      case File.read(file) do
        {:ok, data} -> read(data, %{})
        {:error, :enoent} -> %{}
      end

    {:ok, at_most(%{source: source, file: file, own: nil, held: held, bytes: bytes(held)})}
  end

  @impl true
  def handle_cast({:add, own, signal, otlp}, buffer) do
    File.write!(buffer.file, frame(signal, otlp), [:append])
    held = Map.update(buffer.held, signal, [otlp], &[otlp | &1])
    {:noreply, at_most(%{buffer | own: own, held: held, bytes: buffer.bytes + byte_size(otlp)})}
  end

  @impl true
  def handle_info(:keep, buffer) do
    Process.send_after(self(), :keep, @every)
    {:noreply, kept(buffer)}
  end

  def handle_info(_message, buffer), do: {:noreply, buffer}

  # A buffer that ran on as its app was updated from a version that held its exports only in memory: its file is in its
  # app's own folder, as a call's (`OneCore.Call`), and holds what it holds from now on.
  @impl true
  def code_change(_old, %{file: _} = buffer, _extra), do: {:ok, buffer}

  def code_change(_old, %{own: own} = buffer, _extra) do
    folder = Path.join(OneCore.Server.home(), OneCore.Artifact.name(own))
    File.mkdir_p!(folder)
    {:ok, written(Map.put(buffer, :file, Path.join(folder, "buffered.otlp")))}
  end

  @impl true
  def terminate(_why, buffer), do: kept(buffer)

  # Keeps each signal's exports as one blob, and holds on to those it couldn't keep.
  defp kept(%{own: nil} = buffer), do: buffer
  defp kept(%{held: held} = buffer) when held == %{}, do: buffer

  defp kept(buffer) do
    held =
      Map.filter(buffer.held, fn {signal, exports} ->
        try do
          Store.keep(buffer.own, buffer.source, signal, IO.iodata_to_binary(Enum.reverse(exports)))
          false
        rescue
          error ->
            Logger.warning("Telemetry couldn't keep #{length(exports)} #{signal} exports, and tries again in #{div(@every, 1000)} s: #{Exception.message(error)}")
            true
        end
      end)

    written(%{buffer | held: held, bytes: bytes(held)})
  end

  # Lets go of the oldest exports while more than `@most` bytes are held, and writes what's held again if it did.
  defp at_most(%{bytes: bytes} = buffer) when bytes <= @most, do: buffer
  defp at_most(buffer), do: written(over(buffer))

  defp over(%{bytes: bytes} = buffer) when bytes <= @most, do: buffer

  defp over(buffer) do
    {signal, exports} = Enum.max_by(buffer.held, fn {_signal, exports} -> Enum.sum_by(exports, &byte_size/1) end)
    {kept, [oldest]} = Enum.split(exports, -1)
    Logger.warning("Telemetry let go of a #{signal} export of #{byte_size(oldest)} bytes: more than #{div(@most, 1024 * 1024)} MB was waiting to be kept")
    held = if kept == [], do: Map.delete(buffer.held, signal), else: Map.put(buffer.held, signal, kept)
    over(%{buffer | held: held, bytes: buffer.bytes - byte_size(oldest)})
  end

  # Writes what's held to its file again, whole, or removes the file with nothing held.
  defp written(%{held: held, file: file} = buffer) when held == %{} do
    File.rm(file)
    buffer
  end

  defp written(buffer) do
    File.write!(buffer.file <> ".part", for({signal, exports} <- buffer.held, otlp <- Enum.reverse(exports), do: frame(signal, otlp)))
    File.rename!(buffer.file <> ".part", buffer.file)
    buffer
  end

  defp frame(signal, otlp), do: [<<byte_size(signal)::8>>, signal, <<byte_size(otlp)::32>>, otlp]

  # Each signal's exports in a file's `data`, newest first. An export cut short, as one written as the server
  # crashed, is the file's end.
  defp read(<<size::8, signal::binary-size(size), bytes::32, otlp::binary-size(bytes), rest::binary>>, held),
    do: read(rest, Map.update(held, signal, [otlp], &[otlp | &1]))

  defp read(_rest, held), do: held

  defp bytes(held), do: Enum.sum_by(held, fn {_signal, exports} -> Enum.sum_by(exports, &byte_size/1) end)
end
