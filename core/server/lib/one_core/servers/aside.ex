defmodule OneCore.Servers.Aside do
  @moduledoc """
  Steps this server aside while it's behind its network (`OneCore.Servers.behind?/0`) with no update prepared, as a
  machine back after days away is, or one whose update didn't take: until it's on the network's build, whatever it
  gave would be its older build's, its UI library and One Core's skills among them. Aside, it's as if it were off:
  whoever connects or asks is refused, so clients and servers ask another, and the relay passes outsiders' calls to
  another (`OneCore.Server.aside/1`); and it runs no services, scheduled jobs or looks for apps' updates (`unless/1`).
  It still hears and takes its update, which is all it does.

  One that has prepared the build, as every server has before the first of them restarts on it in an update, takes
  it in its turn, within moments, and doesn't step aside. One that stepped aside stays aside until it's on the
  network's build, which it starts again for, or no ready server is newer.

  It looks as it starts, before its services and jobs do, and every `@every` after: a laptop that slept through
  releases is behind once it wakes, without starting again.
  """
  use GenServer
  require Logger
  alias OneCore.{Builds, Release, Server, Servers}

  @every 15_000

  # What runs only while it isn't aside, by its child's id in `OneCore.Supervisor`.
  @work [OneCore.Services, OneCore.Jobs, OneCore.Apps.Lifecycle]

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @doc """
  `child`'s child spec, as it starts only while this server isn't aside: one that's aside as it starts has it
  started once it's back.
  """
  def unless(child) do
    spec = Supervisor.child_spec(child, [])
    %{spec | start: {__MODULE__, :start, [spec.start]}}
  end

  @doc false
  def start({module, function, arguments}), do: if(Server.aside?(), do: :ignore, else: apply(module, function, arguments))

  @impl true
  def init(nil) do
    # Its supervisor is starting it, and starts what runs only while it isn't aside after it (`unless/1`).
    look(false)
    Process.send_after(self(), :look, @every)
    {:ok, nil}
  end

  @impl true
  def handle_info(:look, state) do
    look(true)
    Process.send_after(self(), :look, @every)
    {:noreply, state}
  end

  defp look(started) do
    was = Server.aside?()
    prepared = Release.status()["server_update_status"] in ["checked", "verifying"]
    aside = Servers.behind?() and (was or not prepared)
    # Said each time, as the endpoint it's said to may have opened since.
    Server.aside(aside)

    cond do
      aside == was ->
        :ok

      aside ->
        Logger.info(
          "This server steps aside while it's behind the network's build, on #{Builds.build()}: it takes no calls and runs no services or jobs until it's updated"
        )

        if started, do: for(id <- @work, do: Supervisor.terminate_child(OneCore.Supervisor, id))

      true ->
        Logger.info("This server is back: no ready server runs a newer build than its #{Builds.build()}")
        for id <- @work, do: Supervisor.restart_child(OneCore.Supervisor, id)
    end
  rescue
    # Where the bucket or the edge can't be reached, as just after a machine wakes, it can't tell, and stays as it was.
    error in OneCore.Edge.Unreachable ->
      Logger.info("Couldn't tell whether this server is behind: #{Exception.message(error)}")
  end
end
