defmodule RemoteShell.Runner do
  @moduledoc """
  Runs a command on its device, as `sh -c` does, and logs each in its folder there, a line of JSON each in
  `ran.jsonl`: when, the command, its folder, its exit code and who ran it.

  Each command is a program of its own (`OneCore.Command`), so stopping one that took too long stops whatever it
  started too.
  """
  use GenServer
  @behaviour OneCore.Service

  # The most of each of what a command prints that's given back: the end of it, where errors usually are.
  @max_bytes 64 * 1024

  @impl OneCore.Service
  def called, do: "Remote Shell's runner"

  @impl OneCore.Service
  def os, do: ["linux", "darwin"]

  @impl OneCore.Service
  def needs do
    "A Linux or Mac machine, with sh. It runs any command it's given, as the user this server runs as, for everyone this server acts for, and keeps a log of each on this machine."
  end

  @impl GenServer
  def init(_) do
    System.find_executable("sh") || raise "This machine has no sh to run commands with"
    {:ok, nil}
  end

  @doc """
  Runs `command` in `dir`, the home folder if `nil`, for at most `timeout` seconds, for `by`. Gives its exit code,
  -1 if it was stopped, and what it printed.
  """
  def run(service, command, dir, timeout, by) do
    dir = dir || System.user_home!()
    if not File.dir?(dir), do: raise("There's no folder #{dir} on this device")
    # Run as its person's own shell runs it, as ssh does, without what tells this server which client and server it
    # is (`ONE_HOME`, `ONE_DEVICE`…): with them, another network's app started here took the One App's home for its
    # own, found that app running there and quit (the PTC App on Andre's Mac, 23 Nov).
    unset = for {"ONE_" <> _ = name, _} <- System.get_env(), do: {name, nil}
    %{exit: exit, stdout: stdout, stderr: stderr} = OneCore.Command.run(["sh", "-c", command], timeout, cd: dir, env: unset)
    ran = %{time: System.system_time(:millisecond), command: command, dir: dir, exit: exit, by: by}
    File.write!(Path.join(OneCore.Service.folder(service), "ran.jsonl"), JSON.encode!(ran) <> "\n", [:append])
    %{exit: exit, stdout: OneCore.Command.clip(stdout, @max_bytes), stderr: OneCore.Command.clip(stderr, @max_bytes)}
  end
end
