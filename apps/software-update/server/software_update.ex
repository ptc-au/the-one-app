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
  that are, and the Home Screen widget switches them. A device that's one of the network's servers isn't one of them:
  a server runs `one` too and gets every release, so it's nobody's to switch off, and it's no row.

  And it keeps the network's own installers, one for each kind of computer and phone (`@platforms`), the network's app
  as a person installs it the first time, which `tooling/release client` publishes (`publish_installer`) and the
  Downloads app offers. Each is the upload it was sent as, never copied, and the one it replaces is removed. Beside
  them it keeps what a Windows app takes as it updates, the network's own program (`windows-program`), named, iconed
  and signed as its installer's is, which the Downloads app doesn't offer: Windows' installer closes the app and its
  server, the updater among them, so it can't be the update, as a Mac's disk image is.
  """
  @behaviour OneCore.App
  require Logger
  alias OneCore.{Artifact, Bucket, Call, Servers}

  @item "Cloudflare edge deploy"

  # The kinds of computer and phone an installer is for: a Mac with Apple silicon or Intel, Windows, Linux as an
  # AppImage or a .deb, and Android; and Windows' program, which its app updates to.
  @platforms ~w(mac mac-intel windows windows-program linux-appimage linux-deb android)

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

    installer = %{
      type: "object",
      properties: %{
        platform: %{type: "string", enum: @platforms},
        name: %{type: "string", description: "Its file's name, as it's downloaded"},
        build: %{type: "string", description: "The build of the network's app it installs"},
        size: %{type: "integer", description: "In bytes"},
        sha256: %{type: "string", description: "Its SHA-256, in hex, where its publisher said it"}
      },
      required: ["platform", "name", "build", "size"]
    }

    [
      %{
        name: "dev_builds",
        read_only: true,
        description:
          "Lists your devices (Sign-In's), each with whether it gets dev builds. `tooling/release client` builds for those that do. A server's own device isn't among them: it gets every release, and isn't yours to switch off",
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
        name: "installers",
        read_only: true,
        description: "Lists the network's own installers, each the network's app for a kind of computer or phone as a person installs it the first time",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object", properties: %{installers: %{type: "array", items: installer}}, required: ["installers"]}
      },
      %{
        name: "installer",
        read_only: true,
        description: "Gives one of the network's installers, by its file's name, with a link that downloads it within a minute",
        inputs: %{type: "object", properties: %{name: %{type: "string", description: "Its file's name, as `installers` lists it"}}, required: ["name"]},
        outputs: put_in(installer, [:properties, :link], %{type: "string", description: "Downloads it, within a minute"})
      },
      %{
        name: "publish_installer",
        description:
          "Publishes the network's installer for a kind of computer or phone, in place of the one before: the network's app as a person installs it the first time, which the Downloads app offers",
        inputs: %{
          type: "object",
          properties: %{
            platform: %{type: "string", enum: @platforms},
            name: %{type: "string", description: "Its file's name, as it's downloaded: The PTC App.dmg"},
            build: %{type: "string", description: "The build of the network's app it installs, as `one builds` names it"},
            file: %{type: "string", format: "upload", description: "The installer"},
            sha256: %{type: "string", description: "Its SHA-256, in hex, which whatever downloads it checks"}
          },
          required: ["platform", "name", "build", "file"]
        },
        outputs: %{type: "object", properties: %{installers: %{type: "array", items: installer}}, required: ["installers"]}
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

  def call("installers", _inputs, call), do: %{installers: installers(call)}

  def call("installer", %{"name" => name}, call) do
    case Enum.find(kept(call), fn {_platform, installer} -> installer["name"] == name end) do
      {platform, installer} -> Map.merge(shown(platform, installer), %{link: Artifact.link(call.own, installer["file"], :read).url})
      nil -> raise "The network has no installer named #{name}: `installers` lists them."
    end
  end

  def call("publish_installer", %{"platform" => platform, "name" => name, "build" => build, "file" => file} = inputs, call) do
    if String.contains?(name, ["/", "\\"]) or String.trim(name) != name or name == "", do: raise("An installer's name is a file's name, with no folder: The PTC App.dmg")

    size =
      case Artifact.size(call.own, file) do
        {:ok, size} -> size
        _absent -> raise "#{file} didn't arrive: send the installer to its upload's link first."
      end

    before = kept(call)[platform]

    Artifact.update(call.own, "installers", fn was ->
      published = %{name: name, build: build, file: file, size: size, sha256: inputs["sha256"]}
      JSON.encode!(Map.put(if(was, do: JSON.decode!(was), else: %{}), platform, published))
    end)

    if before && before["file"] != file, do: Artifact.remove(call.own, before["file"])
    %{installers: installers(call)}
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

  # The network's installers, by kind of computer or phone, each with the upload it is (`file`).
  defp kept(call) do
    with {:ok, was, _tag} <- Artifact.read(call.own, "installers"), do: JSON.decode!(was), else: (:absent -> %{})
  end

  defp installers(call), do: for({platform, installer} <- Enum.sort(kept(call)), do: shown(platform, installer))

  defp shown(platform, installer) do
    shown = %{platform: platform, name: installer["name"], build: installer["build"], size: installer["size"]}
    if installer["sha256"], do: Map.put(shown, :sha256, installer["sha256"]), else: shown
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

  # Your devices that run the One App, by name: apps, not the assistants and browsers signed in beside them, and not
  # a server's own, which `tooling/release` builds for whatever this says (`OneCore.Builds.say/1`).
  defp devices(call) do
    servers = server_devices()

    for(%{"kind" => "app"} = device <- Call.tool(call, "sign-in", "devices", %{})["devices"],
        device["id"] not in servers,
        do: device)
    |> Enum.sort_by(&String.downcase(&1["name"]))
  end

  # The devices the network's servers are on, each one's own `one` (`OneCore.Builds.say/1`), read as `one builds`
  # reads them.
  defp server_devices do
    for {:ok, said, _tag} <- Bucket.read_all(for key <- Servers.all(), do: "servers/#{key}/build"),
        device = JSON.decode!(said)["device"],
        is_binary(device),
        do: device
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
