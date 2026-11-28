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
    "On Linux, bubblewrap (the package bubblewrap), which can make the namespaces a sandbox needs, and the user's " <>
      "systemd (systemd-run --user), which limits its memory; on a Mac, its own sandbox-exec. " <>
      "On Windows, its firewall isolating apps (it does unless a loopback exemption or a policy ends that), which keeps an " <>
      "untrusted app from this machine's own ports."
  end

  @impl OneCore.Service
  def lacks do
    case :os.type() do
      {:unix, :linux} -> linux()
      {:unix, :darwin} -> if File.exists?("/usr/bin/sandbox-exec"), do: nil, else: "sandbox-exec isn't on this Mac"
      {:win32, _} -> windows()
      _ -> nil
    end
  end

  # Windows keeps an AppContainer from this machine's own ports by its firewall's isolation, which the wall tries
  # (`wall --check`), as it does before each program it starts.
  defp windows do
    case OneCore.Command.run([Sandbox.wall(), "--check"], 30) do
      %{exit: 0} -> nil
      %{stdout: stdout} -> stdout |> String.trim() |> String.replace_prefix("The wall didn't start it: ", "")
    end
  end

  # Where bubblewrap can't make a sandbox, as in a container whose host doesn't allow one inside it, or Ubuntu's AppArmor
  # when it isn't the distro's own bwrap, it says so when it's asked for one around a program that does nothing.
  defp linux do
    cond do
      System.find_executable("bwrap") == nil ->
        "bubblewrap isn't installed, so untrusted apps can't run here"

      System.find_executable("systemd-run") == nil ->
        "systemd-run isn't installed (it's in systemd), so untrusted apps can't run here"

      true ->
        wall = ["systemd-run" | Sandbox.scope(64 * 1024 * 1024)] ++ ["bwrap", "--unshare-all", "--ro-bind", "/", "/", "--", "true"]

        case OneCore.Command.run(wall, 30) do
          %{exit: 0} -> nil
          %{stderr: stderr} -> "bubblewrap or the user's systemd can't make a sandbox on this machine: #{stderr |> String.trim() |> String.split("\n") |> List.last()}"
        end
    end
  end

  @impl GenServer
  def init(_), do: {:ok, nil}
end
