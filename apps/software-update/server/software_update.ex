defmodule SoftwareUpdate do
  @moduledoc """
  Software Update: deploys the network's edge once its servers are on a newer build (One Core's hook `edge`), as
  one server is told to by the network's update (`core/edge/updater/updater.ts`). It deploys that server's build of
  the edge (`OneCore.Release.edge/0`) with `deploy.js` beside it, which checks the edge answers as that build and
  rolls it back if not, and says how it went (`OneCore.Release.edge_deployed/2`).

  It deploys with the network's Cloudflare API token, `api_token` of the item `@item` in the network's Vault, switched
  on for this app, and only on a server that opens the Vault: the token never leaves the server that reads it, so
  one that doesn't says so, and the update has the next deploy it.

  It also keeps which of the network's devices get dev builds (`dev_builds`), as the network's one setting: every
  device is on until it's switched off, so a new one starts on. `tooling/release client` builds only for the devices
  that are, and the Home Screen widget switches them.
  """
  @behaviour OneCore.App
  require Logger
  alias OneCore.{Artifact, Call, Servers}

  @item "Cloudflare edge deploy"

  @impl true
  def icon, do: "icon.svg"

  @impl true
  def requires do
    %{
      "core" => ">= 0.34.403",
      "vault" => "to deploy your network's edge with its Cloudflare token",
      "sign-in" => "to list your devices"
    }
  end

  # Its data is the network's: one setting, kept for every device of everyone's.
  @impl true
  def own, do: :installed

  @impl true
  def widgets, do: [%{name: "Dev Builds", tool: "widget", sizes: ["4x4"]}]

  @impl true
  def tools do
    devices = %{
      type: "object",
      properties: %{
        devices: %{
          type: "array",
          items: %{
            type: "object",
            properties: %{
              id: %{type: "string", description: "What set_dev_build takes, as Sign-In's `devices` lists it"},
              name: %{type: "string"},
              on: %{type: "boolean", description: "Whether it gets dev builds"},
              connected: %{type: "boolean"},
              last_seen: %{type: "integer", description: "When it was last connected, in milliseconds since 1970"}
            },
            required: ["id", "name", "on", "connected"]
          }
        }
      },
      required: ["devices"]
    }

    [
      %{
        name: "dev_builds",
        read_only: true,
        description: "Lists your devices (Sign-In's), each with whether it gets dev builds. `tooling/release client` builds for those that do",
        inputs: %{type: "object", properties: %{}},
        outputs: devices
      },
      %{
        name: "set_dev_build",
        description: "Switches whether a device gets dev builds. A device that's off keeps its build, and gets the next release once it's on",
        inputs: %{
          type: "object",
          properties: %{
            device: %{type: "string", description: "The device's id, as `dev_builds` lists it"},
            on: %{type: "boolean", description: "Whether it gets dev builds"}
          },
          required: ["device", "on"]
        },
        outputs: devices
      },
      %{
        name: "widget",
        read_only: true,
        description: "The Home Screen widget Dev Builds: a row for each device, pressed to switch it",
        inputs: %{type: "object", properties: %{size: %{type: "string"}}},
        outputs: %{type: "object", properties: %{part: %{type: "string"}}, required: ["part"]}
      }
    ]
  end

  @impl true
  def call("dev_builds", _inputs, call), do: listed(call)

  def call("set_dev_build", %{"device" => device, "on" => on}, call) do
    if device not in Enum.map(devices(call), & &1["id"]), do: raise("There's no device with the id #{device}: `dev_builds` lists them.")

    Artifact.update(call.own, "dev_builds", fn was ->
      off = if was, do: JSON.decode!(was)["off"], else: []
      JSON.encode!(%{off: Enum.sort(if on, do: List.delete(off, device), else: Enum.uniq([device | off]))})
    end)

    listed(call)
  end

  def call("widget", _inputs, call) do
    %{devices: devices} = listed(call)
    on = Enum.count(devices, & &1.on)

    %{
      part: "column",
      title: false,
      gap: 4,
      parts: [
        %{part: "row", parts: [%{part: "text", text: "Dev Builds", weight: "bold", grow: true}, %{part: "text", text: "#{on} of #{length(devices)}", size: "sm", tone: "muted"}]}
        | for device <- devices do
            %{part: "item", title: device.name, subtitle: seen(device), on: device.on, tool: "set_dev_build", inputs: %{device: device.id}}
          end
      ]
    }
  end

  # The devices, each on unless it was switched off.
  defp listed(call) do
    off = with {:ok, was, _tag} <- Artifact.read(call.own, "dev_builds"), do: JSON.decode!(was)["off"], else: (:absent -> [])

    %{
      devices:
        for device <- devices(call) do
          %{id: device["id"], name: device["name"], on: device["id"] not in off, connected: device["connected"] == true}
          |> Map.merge(with %{"last_seen" => at} <- device, {:ok, time, _} <- DateTime.from_iso8601(at), do: %{last_seen: DateTime.to_unix(time, :millisecond)}, else: (_ -> %{}))
        end
    }
  end

  defp seen(%{connected: true}), do: "Online"
  defp seen(%{last_seen: at}), do: "Seen " <> Servers.ago(at)
  defp seen(_device), do: "Offline"

  # Your devices that run the One App, by name: apps, not the assistants and browsers signed in beside them.
  defp devices(call) do
    for(%{"kind" => "app"} = device <- Call.tool(call, "sign-in", "devices", %{})["devices"], do: device)
    |> Enum.sort_by(&String.downcase(&1["name"]))
  end

  @impl true
  def hooks, do: ["edge"]

  @impl true
  def hook("edge", %{"build" => build}, call) do
    case token(call) do
      {:ok, token} ->
        # A deploy takes minutes, and a hook ten seconds at most.
        Task.start(fn -> OneCore.Release.edge_deployed(build, deploy(build, token)) end)

      {:setup, why} ->
        OneCore.Release.edge_deployed(build, {:setup, why})
    end

    :ok
  end

  # The token, read on this server, which is never passed on to another that opens the Vault.
  defp token(call) do
    {:ok, OneCore.Call.app(call, "vault").value(%{call | forwarded: true}, @item, "api_token")}
  rescue
    error -> {:setup, "Software Update can't use the network's Cloudflare token, #{@item} in its Vault: #{Exception.message(error)}"}
  catch
    :throw, {OneCore.Call, :forwarding_loop} -> {:setup, "#{OneCore.Servers.name(call.server) || "This server"} doesn't open the network's Vault"}
  end

  # Deploys this server's build of the edge from a copy of its own, where Bun installs Wrangler, to the network's
  # address: `:ok`, or `{:error, why}`, the end of what it said.
  defp deploy(build, token) do
    with ^build <- OneCore.Builds.build(),
         from when is_binary(from) <- OneCore.Release.edge(),
         address when is_binary(address) <- Application.get_env(:one_core, :address),
         {:ok, bun} <- OneCore.Programs.path(:bun) do
      folder = Path.join([OneCore.Server.home(), "edge", build])
      File.rm_rf!(folder)
      File.cp_r!(from, folder)
      env = [{"CLOUDFLARE_API_TOKEN", token}]

      with %{exit: 0} <- OneCore.Command.run([bun, "install", "--frozen-lockfile"], 300, cd: folder),
           %{exit: 0, stdout: said} <- OneCore.Command.run([bun, "deploy.js", address], 600, cd: folder, env: env) do
        Logger.info(String.trim(said))
        File.rm_rf(folder)
        :ok
      else
        %{stdout: said, stderr: errors} ->
          said = said <> errors
          Logger.error("The edge wasn't deployed: #{said}")
          {:error, said |> String.trim() |> String.split("\n") |> List.last()}
      end
    else
      {:error, why} -> {:error, why}
      nil -> {:error, "This server has no edge to deploy, or no address to deploy it to"}
      other -> {:error, "This server is on #{other}, not #{build}"}
    end
  end
end
