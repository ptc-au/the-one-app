defmodule OneCore.Tools.Builds do
  @moduledoc "One Core's own tools for the platform's builds: which there are, downloading them, and the network's update, as `OneCore.Tools` calls them, with their definitions in `OneCore.Tools.Definitions`."
  import OneCore.Tools.Helpers
  alias OneCore.{Apps, Bucket, Builds, Cache, Protocol, Release, Server, Servers, User}
  alias OneCore.Apps.{Installed, Store}

  @doc "Runs its tool `name` with `inputs`, as `OneCore.Tools.call/5` hands it on."
  def run("builds", inputs, {actor, subject} = principal, _pass, _request) do
    on(inputs["server"], "builds", inputs, principal, fn ->
      list(actor, User.owner(subject) || "network")
    end)
  end

  def run("download", %{"target" => target}, _principal, _pass, _request), do: Builds.download(target)

  # What takes the latest builds is the program that keeps an installed server running, which hears this said.
  def run("update", _inputs, principal, _pass, _request) do
    reaches!(principal, "network", "owner")
    network = Release.update_now()
    {:content, %{network: network}, [%{type: "text", text: Release.software_update(network)}]}
  end

  # What the edge says of a server: whether it's connected now, whether it's ready, why not, and when it was last seen
  # if it isn't connected.
  @presence ~w(connected server_membership server_daemon_status server_ready server_ready_reason last_seen)

  # What a server said of its update as it last spoke, which isn't what it's doing now once it's gone quiet.
  @update ~w(server_update_status server_update_stage went_back)

  # Which build each of `owner`'s servers runs, with what its machine is called and what it is (`OneCore.Builds.say/1`), as it says
  # it and, where the network's edge says it now, whether it's ready (`OneCore.Servers.edge/1`), and which each
  # of `by`'s devices last said it is, with when it was last seen, and the latest for each kind of machine: what shows
  # whether everything is on the same build; the protocol each part speaks (`OneCore.Protocol.of/1`), which says which
  # talk; and `apps`, whether what runs on the server that answers is what's installed, `synced`, or it's `syncing`
  # (`OneCore.Apps.sync/2`).
  defp list(by, owner) do
    # `by`'s devices are theirs, which a group's server reads by the network's word that it acts for them, asked for
    # here: a call from a device asks it as it comes in, and one passed on to a server that's asked about itself
    # (`server`) doesn't, so the edge refused its read of them.
    Apps.here?(by) || raise "This server doesn't act for #{by}, so it can't say which of their devices it has seen"
    keys = OneCore.Apps.covering(owner)
    # What doesn't need the servers and devices read below is read alongside them, each a trip of its own.
    latest = Task.async(&Builds.latest/0)
    update = Task.async(&Servers.network/0)
    waiting = Task.async(fn -> waiting(owner) end)

    # Each blob is a trip across the internet where the bucket is far away, so they're all read at once. Every client
    # that shows it asks again as each server of a release comes and goes, so what's read is kept for a few seconds,
    # and asked for once while it's read: each ask was a request for each server and each device.
    {devices, read} =
      Cache.fetch(__MODULE__, {by, keys}, fn ->
        devices = Bucket.list("#{by}/devices/")
        {:commit, {devices, Bucket.read_all(Enum.map(keys, &"servers/#{&1}/build") ++ devices)}, expire: 10_000}
      end)

    {server_reads, device_reads} = Enum.split(read, length(keys))

    # Whether each server and device is there, asked of the network's edge at once, where a request for each server took
    # most of a second.
    edge = Servers.edge(Enum.map(devices, &Path.basename/1) ++ keys) || %{}

    servers =
      for {key, read} <- Enum.zip(keys, server_reads) do
        info = with {:ok, info, _tag} <- read, do: JSON.decode!(info), else: (:absent -> %{})
        presence = Map.take(edge["presence"][key] || %{}, @presence)
        info = Map.put(info, "protocol", Protocol.of(info["protocol"]))
        server = Map.merge(info, Map.merge(presence, %{"server" => key, "name" => Servers.name(key)})) |> asleep()
        if why = why(server, edge), do: Map.put(server, "why", why), else: server
      end

    devices =
      for {blob, {:ok, info, _tag}} <- Enum.zip(devices, device_reads) do
        info = JSON.decode!(info)
        device = Path.basename(blob)
        seen = Map.take(edge["presence"][device] || %{}, ~w(connected last_seen))

        Map.merge(info, Map.put(seen, "device", device))
        |> Map.put("protocol", Protocol.of(info["protocol"]))
      end

    %{
      server: Server.key(),
      build: Builds.build(),
      protocol: Protocol.range(),
      network: network(Task.await(update, :infinity), servers),
      edge: edge["build"],
      edge_protocol: edge["protocol"],
      latest: Task.await(latest, :infinity),
      servers: servers,
      devices: devices,
      apps: Apps.synced(),
      waiting: Task.await(waiting, :infinity)
    }
  end

  # A server the edge says isn't connected (asleep, suspended, off the internet or stopped: it knows only that no
  # heartbeat answers) said what its update is as of when it was last seen, so that's under `last_said`, with when,
  # where a reader can't take it for what it's doing.
  defp asleep(%{"connected" => false} = server) do
    {said, server} = Map.split(server, @update)
    Map.put(server, "last_said", Map.put(said, "at", server["last_seen"]))
  end

  defp asleep(server), do: server

  # The network's update, as its updater says it, with the servers here that take builds and aren't on its build and
  # `one` yet. One that isn't connected, as a fallback stopped until it's needed or a laptop off, takes it as it comes,
  # and the updater says which it missed (`skipped`).
  defp network(update, servers) do
    with {:ok, %{} = network} <- update do
      behind =
        for server <- servers,
            server["installed"],
            server["connected"] != false,
            not Release.on?(Release.target(network, server), server),
            do: server["name"]

      Map.put(network, "behind", behind)
    else
      _ -> nil
    end
  end

  # The apps installed for `owner` whose version doesn't run on this server's platform, and why
  # (`OneCore.Apps.Version.platform/1`). Only one not running here is read from what it said of itself, all at once.
  defp waiting(owner) do
    running = Apps.running(owner)
    apps = for {name, %{"app" => app}} <- Installed.read(owner), is_binary(app) and not is_map_key(running, name), do: {name, app}
    latest = Bucket.read_all(Enum.map(apps, fn {_name, app} -> app <> "/latest" end))

    for {{name, app}, latest} <- Enum.zip(apps, latest),
        about = with({:ok, json, _tag} <- latest, do: JSON.decode!(json), else: (_ -> %{})),
        %{state: state, why: why} when state != :runs <- [Store.platform(name, app, about)],
        do: %{name: name, state: state, why: why}
  end

  # Why `server` doesn't talk with this one or the edge, for speaking none of the protocols theirs does, or `nil`
  # where it does. The edge sends one behind its own nothing until it's updated.
  defp why(%{"protocol" => theirs, "name" => name}, edge) do
    cond do
      not Protocol.speaks?(theirs) ->
        "It speaks protocol #{Protocol.name(theirs)} and #{Servers.name(Server.key()) || "this server"} #{Protocol.name(Protocol.range())}, so they don't talk until one is updated"

      edge["protocol"] != nil and not Protocol.overlap?(theirs, edge["protocol"]) ->
        "It speaks protocol #{Protocol.name(theirs)} and the edge #{Protocol.name(edge["protocol"])}, so the edge sends #{name || "it"} nothing until one is updated"

      true ->
        nil
    end
  end

  defp why(_server, _edge), do: nil
end
