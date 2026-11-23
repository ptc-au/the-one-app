defmodule Sandbox.Wall do
  @moduledoc """
  Says on each server whether its machine has the wall an untrusted app runs behind (`Sandbox`), so a server that
  doesn't says what it lacks, where its owner reads the servers (`services`, Device Activity, this app's page in
  Settings), and not only when an untrusted app fails to start there. It does nothing else.
  """
  use GenServer
  @behaviour OneCore.Service

  @impl OneCore.Service
  def called, do: "Sandbox's wall"

  @impl OneCore.Service
  def needs do
    "On Linux, bubblewrap (the package bubblewrap) and prlimit (util-linux), which can make the namespaces a sandbox " <>
      "needs; on a Mac, its own sandbox-exec. Windows has what it needs."
  end

  @impl OneCore.Service
  def lacks do
    case :os.type() do
      {:unix, :linux} -> linux()
      {:unix, :darwin} -> if File.exists?("/usr/bin/sandbox-exec"), do: nil, else: "sandbox-exec isn't on this Mac"
      _ -> nil
    end
  end

  # Where bubblewrap can't make a sandbox, as in a container whose host doesn't allow one inside it, or Ubuntu's AppArmor
  # when it isn't the distro's own bwrap, it says so when it's asked for one around a program that does nothing.
  defp linux do
    cond do
      System.find_executable("bwrap") == nil ->
        "bubblewrap isn't installed, so untrusted apps can't run here"

      System.find_executable("prlimit") == nil ->
        "prlimit isn't installed (it's in util-linux), so untrusted apps can't run here"

      true ->
        case OneCore.Command.run(["bwrap", "--unshare-all", "--ro-bind", "/", "/", "--", "true"], 30) do
          %{exit: 0} -> nil
          %{stderr: stderr} -> "bubblewrap is installed, but it can't make a sandbox on this machine: #{stderr |> String.trim() |> String.split("\n") |> List.last()}"
        end
    end
  end

  @impl GenServer
  def init(_), do: {:ok, nil}
end
