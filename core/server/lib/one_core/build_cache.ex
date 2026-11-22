defmodule OneCore.BuildCache do
  @moduledoc """
  The folder this machine's servers keep what they make or download from an app's files in, by its hash, as Mix and
  Hex keep theirs: what an app's Elixir compiles to (`OneCore.Apps.Version.Compile`) and its files beside it
  (`OneCore.Apps.Store.files/3`), what its app builds to and the UI library's build (`OneCore.Entrypoint`), and its
  precompiled NIFs (`OneCore.Apps.Precompiled`). It's every server's on the machine, so what one made, another, of
  any network, takes as it is. What wasn't taken for a month goes.
  """
  require Logger

  @month 30 * 24 * 3600

  @doc "The path of what's kept under `parts`."
  def path(parts), do: Path.join([:filename.basedir(:user_cache, "one_core") | parts])

  @doc "What's kept at `path`, as `write/2` kept it, or `nil`."
  def read(path) do
    with {:ok, binary} <- File.read(path) do
      File.touch(path)
      binary
    else
      _ -> nil
    end
  end

  @doc """
  Keeps `binary` at `path`: written beside, then renamed into place, so what's kept is all there, and another server
  keeping the same meanwhile is as good. What's beside it that wasn't taken for a month goes.
  """
  def write(path, binary) do
    writing = "#{path}.#{System.unique_integer([:positive])}"
    File.mkdir_p!(Path.dirname(path))
    File.write!(writing, binary)
    File.rename!(writing, path)
    prune(Path.dirname(path))
  rescue
    error -> Logger.warning("#{path} wasn't kept on this machine: #{Exception.message(error)}")
  end

  @doc "Removes what's in `folder` that wasn't taken for a month."
  def prune(folder) do
    month_ago = System.os_time(:second) - @month

    for path <- Path.wildcard(Path.join(folder, "*")),
        {:ok, %{mtime: used}} <- [File.stat(path, time: :posix)],
        used < month_ago,
        do: File.rm_rf!(path)
  end
end
