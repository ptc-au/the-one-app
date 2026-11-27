defmodule RemoteShell do
  @moduledoc """
  Remote Shell: commands and file transfers on the user's own devices, by name. Its service, `RemoteShell.Runner`, on
  each device it's installed on, runs them as the user that device's server runs as, and logs each there.
  """
  @behaviour OneCore.App
  alias OneCore.{Artifact, Call, Service}
  alias RemoteShell.Runner

  # Downloaded blobs stay long enough for the caller to fetch their short-lived link, then are pruned on later calls.
  @download_ttl_ms 60 * 60 * 1000

  @impl true
  def icon, do: "icon.svg"

  @impl true
  def requires, do: %{"core" => ">= 0.32.47"}

  @impl true
  def tools do
    [
      %{
        name: "run",
        description:
          ~s|Run a shell command on one of your devices, as its owner, and wait for it to finish. Gives { exit, stdout, stderr }: exit 0 when it worked, and what it printed, the last 64 KB of each when longer. To leave a process running in the background after the call ends, start it detached with its output redirected (like "nohup python3 -m http.server 8123 >/tmp/http.log 2>&1 & echo $!"); stop it later with "kill <pid>". Only the call's own foreground process group is stopped if it times out. Every command is logged on the device it ran on.|,
        inputs: %{
          type: "object",
          required: ["command"],
          properties: %{
            command: %{
              type: "string",
              description: ~s(the command line, run by sh -c, like "df -h" or "cd src && git status"; it reads no input)
            },
            dir: %{type: "string", description: "the folder to run it in, as an absolute path; default the home folder"},
            secrets: %{
              type: "object",
              additionalProperties: %{type: "string"},
              description:
                ~s(variables it's given, each the secret of a handle from vault_handle, by name, like {"AZURE_CLIENT_SECRET": "<handle>"}: the command sees them, you don't, and what it prints of them is <concealed>)
            },
            timeout: %{
              type: "integer",
              minimum: 1,
              maximum: 600,
              description: "seconds to wait before stopping it, 1 to 600; default 60"
            },
            device: %{
              type: "string",
              description:
                "the device to run it on, by name, as `services` names it; else the one asked if it has Remote Shell, or the first that's up"
            }
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            exit: %{type: "integer", description: "Its exit code: 0 when it worked, -1 when it was stopped"},
            stdout: %{type: "string", description: "What it printed, its last 64 KB"},
            stderr: %{type: "string", description: "What it printed as errors, its last 64 KB"}
          },
          required: ["exit", "stdout", "stderr"]
        }
      },
      %{
        name: "copy",
        task_support: :optional,
        description:
          ~s|Copy a file or folder from one of your devices to another (like scp/rsync), of any size, keeping file modes. Give from and to as "<device>:<path>", where ~ is the user's home folder and relative paths are from home.|,
        inputs: %{
          type: "object",
          required: ["from", "to"],
          properties: %{
            from: %{
              type: "string",
              description: ~s(source as "<device>:<path>", like "MacBook:~/Desktop/shots" or "workspace:/tmp/out.png")
            },
            to: %{
              type: "string",
              description:
                ~s(destination as "<device>:<path>", like "workspace:/tmp/shots"; copying a file into an existing folder keeps its name, and copying a folder into an existing folder puts it inside unless from ends with /)
            }
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            from: %{type: "string", description: "Resolved source as <device>:<path>"},
            to: %{type: "string", description: "Resolved destination as <device>:<path>"},
            kind: %{type: "string", enum: ["file", "folder"], description: "Whether a file or folder was copied"},
            files: %{type: "integer", description: "Number of files copied"},
            bytes: %{type: "integer", description: "Total bytes of the copied files"}
          },
          required: ["from", "to", "kind", "files", "bytes"]
        }
      },
      %{
        name: "download",
        read_only: true,
        description:
          ~s|Download a file from one of your devices to where you are, of any size (if path is a folder, returns it as a .tar.gz archive). The CLI writes the file to stdout (e.g. one remote-shell download --device MacBook --path ~/shot.png > shot.png); over MCP, returns a resource_link you can download.|,
        inputs: %{
          type: "object",
          required: ["path"],
          properties: %{
            path: %{
              type: "string",
              description: ~s(path on the device, like "~/Desktop/shot.png" or "/tmp/logs"; ~ expands to home)
            },
            device: %{
              type: "string",
              description:
                "the device to download from, by name, as `services` names it; else the one asked if it has Remote Shell, or the first that's up"
            }
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            mimeType: %{type: "string", description: "The file's MIME type (application/gzip for a folder)"}
          },
          required: ["mimeType"]
        }
      },
      %{
        name: "upload",
        task_support: :optional,
        description:
          ~s|Upload a file from where you are to one of your devices, of any size. In the CLI, pass --file-from <local path>; over MCP, upload the file first with the upload tool (app: "remote-shell") and pass its upload name as file.|,
        inputs: %{
          type: "object",
          required: ["file", "path"],
          properties: %{
            file: %{
              type: "string",
              format: "upload",
              description: "the file to send, from the upload tool (or --file-from <path> in the CLI)"
            },
            path: %{
              type: "string",
              description: ~s(destination path on the device, like "~/Desktop/shot.png" or "/tmp/out.bin")
            },
            device: %{
              type: "string",
              description:
                "the device to upload to, by name, as `services` names it; else the one asked if it has Remote Shell, or the first that's up"
            },
            mode: %{
              type: "string",
              description: ~s(optional Unix file permissions in octal, like "0755" or "644")
            }
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            device: %{type: "string", description: "The device the file was written on"},
            path: %{type: "string", description: "The resolved path written on that device"},
            bytes: %{type: "integer", description: "Bytes written"}
          },
          required: ["device", "path", "bytes"]
        }
      }
    ]
  end

  @impl true
  def call("run", %{"command" => command} = inputs, call) do
    if String.trim(command) == "", do: raise(Call.Refused, "Give a command")
    run = [command, inputs["dir"], Map.get(inputs, "timeout", 60), call.actor]
    secrets = Map.get(inputs, "secrets", %{})
    # Only with secrets is the runner asked with them, so one on a device that hasn't updated yet runs the rest.
    run = if secrets == %{}, do: run, else: run ++ [redeemed(call, secrets)]
    Service.call(call, Runner, :run, run, device(call, inputs["device"]))
  end

  def call("copy", %{"from" => from, "to" => to}, call) do
    {from_device, from_path} = parse_spec(from)
    {to_device, to_path} = parse_spec(to)
    from_server = online!(call, from_device)
    to_server = online!(call, to_device)
    from_name = Service.name(from_server) || from_device
    to_name = Service.name(to_server) || to_device

    if from_server == to_server do
      copied = unwrap!(Service.call(call, Runner, :copy_local, [from_path, to_path, call.actor], from_server))

      %{
        from: "#{from_name}:#{copied["from"]}",
        to: "#{to_name}:#{copied["to"]}",
        kind: copied["kind"],
        files: copied["files"],
        bytes: copied["bytes"]
      }
    else
      blob = "transfers/" <> Base.encode16(:crypto.strong_rand_bytes(16), case: :lower)

      try do
        Call.stage(call, "Uploading from #{from_name}")
        sent = unwrap!(Service.call(call, Runner, :send_file, [from_path, link(call.own, blob, :write), call.actor], from_server))

        Call.stage(call, "Downloading to #{to_name}")
        received = unwrap!(Service.call(call, Runner, :receive_file, [to_path, link(call.own, blob, :read), sent, call.actor], to_server))

        %{
          from: "#{from_name}:#{sent["path"]}",
          to: "#{to_name}:#{received["path"]}",
          kind: sent["kind"],
          files: sent["files"],
          bytes: sent["bytes"]
        }
      after
        Artifact.remove(call.own, blob)
      end
    end
  end

  def call("download", %{"path" => path} = inputs, call) do
    prune_downloads(call.own)
    server = if inputs["device"], do: online!(call, inputs["device"]), else: nil
    blob = "downloads/#{System.system_time(:millisecond)}-#{Base.encode16(:crypto.strong_rand_bytes(8), case: :lower)}"

    try do
      sent = unwrap!(Service.call(call, Runner, :send_file, [path, link(call.own, blob, :write), call.actor], server))
      mime = if sent["kind"] == "folder", do: "application/gzip", else: MIME.from_path(sent["path"])
      {:file, mime, call.own, blob}
    rescue
      error ->
        Artifact.remove(call.own, blob)
        reraise error, __STACKTRACE__
    end
  end

  def call("upload", %{"file" => upload, "path" => path} = inputs, call) do
    if String.trim(path) == "" or String.ends_with?(path, "/"),
      do: raise(Call.Refused, "Give a file path for path, not a folder ending in /.")

    bytes =
      case Artifact.size(call.own, upload) do
        {:ok, size} -> size
        :absent -> raise Call.Refused, "The uploaded file #{upload} wasn't found. Send it with the upload tool first."
      end

    mode = parse_mode(inputs["mode"])
    server = if inputs["device"], do: online!(call, inputs["device"]), else: nil

    try do
      meta = %{"kind" => "file", "name" => Path.basename(path), "mode" => mode}
      received = unwrap!(Service.call(call, Runner, :receive_file, [path, link(call.own, upload, :read), meta, call.actor], server))
      %{device: received["device"] || inputs["device"] || "device", path: received["path"], bytes: bytes}
    after
      Artifact.remove(call.own, upload)
    end
  end

  # Each handle's secret, by the variable it's given in: the Vault hands it to this app's code, once.
  defp redeemed(call, secrets) do
    for {name, handle} <- secrets, into: %{} do
      if not (name =~ ~r/^[A-Za-z_][A-Za-z0-9_]*$/),
        do: raise(Call.Refused, "A variable's name is letters, digits and _, like AZURE_CLIENT_SECRET.")

      {name, Call.tool(call, "vault", "redeem", %{"handle" => handle})["value"]}
    end
  end

  # The server that is the device called `name`, or nil for none named: whichever runs Remote Shell then answers.
  defp device(_call, nil), do: nil

  defp device(call, name) do
    servers = Service.servers(call, Runner)
    called = &String.downcase(Service.name(&1) || "")

    Enum.find(servers, &(called.(&1) == String.downcase(name))) ||
      raise Call.Refused,
            "No device called #{name} has Remote Shell. " <>
              if(servers == [],
                do: "None does yet: `install_service` runs RemoteShell.Runner on one.",
                else: "It's on #{Enum.map_join(servers, ", ", &Service.name/1)}."
              )
  end

  # Resolves `name` and refuses fast if it's currently offline, before any upload starts.
  defp online!(call, name) do
    server = device(call, name)

    if is_integer(Service.seen(server)) do
      raise Call.Refused, "#{Service.name(server) || name} is off."
    end

    server
  end

  defp parse_spec(spec) do
    case String.split(spec, ":", parts: 2) do
      [dev, path] ->
        dev = String.trim(dev)
        if dev == "" or String.trim(path) == "" do
          raise Call.Refused, ~s(Give "<device>:<path>", like "MacBook:~/Desktop/shot.png".)
        end
        {dev, path}

      _ ->
        raise Call.Refused, ~s(Give "<device>:<path>", like "MacBook:~/Desktop/shot.png".)
    end
  end

  defp parse_mode(nil), do: nil

  defp parse_mode(mode) do
    case Integer.parse(String.trim(mode), 8) do
      {int, ""} when int in 0..0o7777 -> int
      _ -> raise Call.Refused, ~s(mode must be octal permissions like "0755" or "644".)
    end
  end

  defp link(artifact, blob, mode) do
    artifact |> Artifact.link(blob, mode) |> JSON.encode!() |> JSON.decode!()
  end

  defp unwrap!(%{"error" => why}), do: raise(Call.Refused, why)
  defp unwrap!(result), do: result

  # Removes old temporary download blobs so they don't accumulate in the bucket.
  defp prune_downloads(own) do
    cutoff = System.system_time(:millisecond) - @download_ttl_ms

    Task.start(fn ->
      for blob <- Artifact.list(own, "downloads/") do
        with "downloads/" <> rest <- blob,
             {ts, "-" <> _} <- Integer.parse(rest),
             true <- ts < cutoff do
          Artifact.remove(own, blob)
        end
      end
    end)
  end
end
