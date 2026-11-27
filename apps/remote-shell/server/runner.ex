defmodule RemoteShell.Runner do
  @moduledoc """
  Runs a command or file transfer on its device, and logs each in its folder there, a line of JSON each in
  `ran.jsonl`: when, what ran, its folder/path, its outcome and who asked.

  Commands write stdout and stderr to temporary files rather than the port's pipe, so a background process the
  command detached (`nohup … >/tmp/log 2>&1 &`, `setsid … &`) doesn't hold the call open until its timeout, and keeps
  running after the call ends. If the command itself times out, its foreground process group is killed.
  """
  use GenServer
  @behaviour OneCore.Service

  # The most of each of what a command prints that's given back: the end of it, where errors usually are.
  @max_bytes 64 * 1024
  @chunk 1024 * 1024

  @impl OneCore.Service
  def called, do: "Remote Shell's runner"

  @impl OneCore.Service
  def os, do: ["linux", "darwin"]

  @impl OneCore.Service
  def needs do
    "A Linux or Mac machine, with sh. It runs any command and copies any file it's given, as the user this server runs as, for everyone this server acts for, and keeps a log of each on this machine."
  end

  @impl GenServer
  def init(_) do
    System.find_executable("sh") || raise "This machine has no sh to run commands with"
    {:ok, nil}
  end

  @doc """
  Runs `command` in `dir`, the home folder if `nil`, for at most `timeout` seconds, for `by`, with `secrets`, values by
  the variables they're given in, which the log never holds and what it printed has `<concealed>` in place of. Gives
  its exit code, -1 if it was stopped, and what it printed.
  """
  def run(service, command, dir, timeout, by, secrets \\ %{}) do
    dir = dir || System.user_home!()
    if not File.dir?(dir), do: raise("There's no folder #{dir} on this device")
    # Run as its person's own shell runs it, as ssh does, without what tells this server which client and server it
    # is (`ONE_HOME`, `ONE_DEVICE`…): with them, another network's app started here took the One App's home for its
    # own, found that app running there and quit (the PTC App on Andre's Mac, 23 Nov).
    unset = for {"ONE_" <> _ = name, _} <- System.get_env(), do: {name, nil}
    env = unset ++ Enum.to_list(secrets)
    %{exit: exit, stdout: stdout, stderr: stderr} = exec_sh(command, timeout, dir, env)
    {stdout, stderr} = {concealed(stdout, secrets), concealed(stderr, secrets)}
    log(service, %{time: System.system_time(:millisecond), command: command, dir: dir, exit: exit, by: by})
    %{exit: exit, stdout: stdout, stderr: stderr}
  end

  @doc """
  Uploads a file or folder at `raw_path` to `link` (streaming, never loading the whole file into memory).
  Folders are packed with `:erl_tar` (gzipped), keeping file modes and symlinks.
  """
  def send_file(service, raw_path, link, by) do
    resolved = expand_path(raw_path)
    trailing_slash = String.ends_with?(raw_path, "/")

    case File.stat(resolved) do
      {:error, reason} ->
        %{"error" => format_fs_error("read", raw_path, reason)}

      {:ok, %{type: :regular, size: size, mode: mode}} ->
        with :ok <- upload_stream(resolved, size, link) do
          log(service, %{time: System.system_time(:millisecond), transfer: "send", path: resolved, kind: "file", bytes: size, by: by})

          %{
            "ok" => true,
            "kind" => "file",
            "path" => resolved,
            "name" => Path.basename(resolved),
            "mode" => Bitwise.band(mode, 0o7777),
            "files" => 1,
            "bytes" => size,
            "trailing_slash" => false
          }
        end

      {:ok, %{type: :directory, mode: mode}} ->
        tmp_tar = Path.join(System.tmp_dir!(), "one-rs-send-#{System.unique_integer([:positive])}.tar.gz")

        try do
          with {:ok, files, bytes} <- pack_folder(resolved, tmp_tar),
               {:ok, %{size: tar_size}} <- File.stat(tmp_tar),
               :ok <- upload_stream(tmp_tar, tar_size, link) do
            log(service, %{time: System.system_time(:millisecond), transfer: "send", path: resolved, kind: "folder", files: files, bytes: bytes, by: by})

            %{
              "ok" => true,
              "kind" => "folder",
              "path" => resolved,
              "name" => Path.basename(resolved),
              "mode" => Bitwise.band(mode, 0o7777),
              "files" => files,
              "bytes" => bytes,
              "trailing_slash" => trailing_slash
            }
          else
            {:error, reason} -> %{"error" => format_fs_error("pack", raw_path, reason)}
            %{"error" => _} = err -> err
          end
        after
          File.rm(tmp_tar)
        end

      {:ok, %{type: other}} ->
        %{"error" => "#{raw_path} is a #{other}, not a file or folder."}
    end
  end

  @doc """
  Downloads a file or tar.gz folder from `link` and writes it to `raw_to`, keeping file modes.
  """
  def receive_file(service, raw_to, link, meta, by) do
    resolved = expand_path(raw_to)
    device_name = OneCore.Service.name(OneCore.Service.server())

    case meta["kind"] do
      "file" ->
        dest =
          if String.ends_with?(raw_to, "/") or File.dir?(resolved),
            do: Path.join(resolved, meta["name"]),
            else: resolved

        parent = Path.dirname(dest)

        with :ok <- mkdir_p(parent, raw_to) do
          tmp = Path.join(parent, ".one-rs-recv-#{System.unique_integer([:positive])}")

          try do
            with :ok <- download_stream(link, tmp, raw_to),
                 :ok <- maybe_chmod(tmp, meta["mode"], raw_to),
                 :ok <- rename_file(tmp, dest, raw_to) do
              log(service, %{time: System.system_time(:millisecond), transfer: "receive", path: dest, kind: "file", by: by})
              %{"ok" => true, "path" => dest, "device" => device_name}
            end
          rescue
            e in File.Error ->
              File.rm(tmp)
              %{"error" => format_fs_error("write", raw_to, e.reason)}
          after
            if File.exists?(tmp), do: File.rm(tmp)
          end
        end

      "folder" ->
        cond do
          File.regular?(resolved) ->
            %{"error" => "#{raw_to} is a file, not a folder."}

          true ->
            dest_dir =
              if File.dir?(resolved) and not meta["trailing_slash"],
                do: Path.join(resolved, meta["name"]),
                else: resolved

            existed = File.dir?(dest_dir)
            tmp_tar = Path.join(System.tmp_dir!(), "one-rs-recv-#{System.unique_integer([:positive])}.tar.gz")

            try do
              with :ok <- mkdir_p(dest_dir, raw_to),
                   :ok <- download_stream(link, tmp_tar, raw_to),
                   :ok <- extract_folder(tmp_tar, dest_dir, raw_to),
                   :ok <- if(existed, do: :ok, else: maybe_chmod(dest_dir, meta["mode"], raw_to)) do
                log(service, %{time: System.system_time(:millisecond), transfer: "receive", path: dest_dir, kind: "folder", by: by})
                %{"ok" => true, "path" => dest_dir, "device" => device_name}
              end
            after
              File.rm(tmp_tar)
            end
        end
    end
  end

  @doc """
  Copies a file or folder locally on this same device, keeping file modes.
  """
  def copy_local(service, raw_from, raw_to, by) do
    from = expand_path(raw_from)
    to = expand_path(raw_to)
    trailing_slash = String.ends_with?(raw_from, "/")

    case File.stat(from) do
      {:error, reason} ->
        %{"error" => format_fs_error("read", raw_from, reason)}

      {:ok, %{type: :regular, size: size, mode: mode}} ->
        dest = if String.ends_with?(raw_to, "/") or File.dir?(to), do: Path.join(to, Path.basename(from)), else: to
        parent = Path.dirname(dest)

        with :ok <- mkdir_p(parent, raw_to) do
          tmp = Path.join(parent, ".one-rs-cp-#{System.unique_integer([:positive])}")

          try do
            with :ok <- copy_file_to(from, tmp, raw_to),
                 :ok <- maybe_chmod(tmp, Bitwise.band(mode, 0o7777), raw_to),
                 :ok <- rename_file(tmp, dest, raw_to) do
              log(service, %{time: System.system_time(:millisecond), transfer: "copy_local", from: from, to: dest, kind: "file", bytes: size, by: by})
              %{"ok" => true, "from" => from, "to" => dest, "kind" => "file", "files" => 1, "bytes" => size}
            end
          after
            if File.exists?(tmp), do: File.rm(tmp)
          end
        end

      {:ok, %{type: :directory, mode: mode}} ->
        if File.regular?(to) do
          %{"error" => "#{raw_to} is a file, not a folder."}
        else
          dest_dir = if File.dir?(to) and not trailing_slash, do: Path.join(to, Path.basename(from)), else: to
          existed = File.dir?(dest_dir)
          tmp_tar = Path.join(System.tmp_dir!(), "one-rs-cp-#{System.unique_integer([:positive])}.tar.gz")

          try do
            with {:ok, files, bytes} <- pack_folder(from, tmp_tar),
                 :ok <- mkdir_p(dest_dir, raw_to),
                 :ok <- extract_folder(tmp_tar, dest_dir, raw_to),
                 :ok <- if(existed, do: :ok, else: maybe_chmod(dest_dir, Bitwise.band(mode, 0o7777), raw_to)) do
              log(service, %{time: System.system_time(:millisecond), transfer: "copy_local", from: from, to: dest_dir, kind: "folder", files: files, bytes: bytes, by: by})
              %{"ok" => true, "from" => from, "to" => dest_dir, "kind" => "folder", "files" => files, "bytes" => bytes}
            else
              {:error, reason} -> %{"error" => format_fs_error("copy", raw_from, reason)}
              %{"error" => _} = err -> err
            end
          after
            File.rm(tmp_tar)
          end
        end

      {:ok, %{type: other}} ->
        %{"error" => "#{raw_from} is a #{other}, not a file or folder."}
    end
  end

  # Runs `sh -c command` with stdout and stderr redirected to temp files so background processes don't hold the
  # port's stdout pipe open until timeout. Only if `sh` itself outlives `timeout` is its process group killed.
  defp exec_sh(command, timeout, dir, env) do
    id = System.unique_integer([:positive])
    out_file = Path.join(System.tmp_dir!(), "one-rs-out-#{id}")
    err_file = Path.join(System.tmp_dir!(), "one-rs-err-#{id}")
    env = for {name, value} <- env, do: {String.to_charlist(name), if(value, do: String.to_charlist(value), else: false)}

    port =
      Port.open(
        {:spawn_executable, System.find_executable("sh")},
        [
          :binary,
          :exit_status,
          :hide,
          cd: dir,
          env: env,
          args: ["-c", ~s(exec </dev/null >"$0" 2>"$1"; shift 1; exec "$@"), out_file, err_file, "sh", "-c", command]
        ]
      )

    exit_code = wait_exit(port, System.monotonic_time(:millisecond) + timeout * 1000)
    stdout = read_tail(out_file, @max_bytes)
    stderr = read_tail(err_file, @max_bytes)
    File.rm(out_file)
    File.rm(err_file)

    stderr =
      if exit_code == -1 do
        note = "(stopped after #{timeout}s)"
        if stderr == "" or String.ends_with?(stderr, "\n"), do: stderr <> note, else: stderr <> "\n" <> note
      else
        stderr
      end

    %{exit: exit_code, stdout: stdout, stderr: stderr}
  end

  defp wait_exit(port, until) do
    receive do
      {^port, {:data, _}} -> wait_exit(port, until)
      {^port, {:exit_status, status}} -> status
    after
      max(0, until - System.monotonic_time(:millisecond)) ->
        with {:os_pid, pid} <- Port.info(port, :os_pid) do
          System.cmd("kill", ["-KILL", "--", "-#{pid}"])
        end

        receive do
          {^port, {:exit_status, _}} -> :ok
        after
          1_000 -> Port.close(port)
        end

        -1
    end
  end

  defp read_tail(path, max) do
    case File.stat(path) do
      {:ok, %{size: size}} when size > max ->
        case File.open(path, [:read, :binary, :raw]) do
          {:ok, fd} ->
            try do
              case :file.pread(fd, size - max, max) do
                {:ok, tail} ->
                  tail = String.replace_invalid(tail, "")
                  "(#{size - byte_size(tail)} earlier bytes cut) …" <> tail

                _ ->
                  ""
              end
            after
              File.close(fd)
            end

          _ ->
            ""
        end

      {:ok, _} ->
        case File.read(path) do
          {:ok, text} -> String.replace_invalid(text)
          _ -> ""
        end

      _ ->
        ""
    end
  end

  defp expand_path("~"), do: System.user_home!()
  defp expand_path("~/" <> rest), do: Path.join(System.user_home!(), rest)
  defp expand_path("/" <> _ = abs), do: Path.expand(abs)
  defp expand_path(rel), do: Path.expand(rel, System.user_home!())

  defp pack_folder(dir, tar_path) do
    with {:ok, names} <- File.ls(dir),
         {:ok, {files, bytes}} <- count_tree(dir) do
      entries = for name <- names, do: {String.to_charlist(name), String.to_charlist(Path.join(dir, name))}

      case :erl_tar.create(String.to_charlist(tar_path), entries, [:compressed]) do
        :ok -> {:ok, files, bytes}
        {:error, {_path, reason}} -> {:error, reason}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp count_tree(dir) do
    case File.ls(dir) do
      {:ok, names} ->
        Enum.reduce_while(names, {:ok, {0, 0}}, fn name, {:ok, {files, bytes}} ->
          full = Path.join(dir, name)

          case File.lstat(full) do
            {:ok, %{type: :regular, size: size}} ->
              {:cont, {:ok, {files + 1, bytes + size}}}

            {:ok, %{type: :symlink}} ->
              {:cont, {:ok, {files + 1, bytes}}}

            {:ok, %{type: :directory}} ->
              case count_tree(full) do
                {:ok, {sub_files, sub_bytes}} -> {:cont, {:ok, {files + sub_files, bytes + sub_bytes}}}
                {:error, reason} -> {:halt, {:error, reason}}
              end

            {:ok, _} ->
              {:cont, {:ok, {files, bytes}}}

            {:error, reason} ->
              {:halt, {:error, reason}}
          end
        end)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp extract_folder(tar_path, dest_dir, raw_to) do
    case :erl_tar.extract(String.to_charlist(tar_path), [:compressed, {:cwd, String.to_charlist(dest_dir)}]) do
      :ok -> :ok
      {:error, {_path, reason}} -> %{"error" => format_fs_error("write", raw_to, reason)}
      {:error, reason} -> %{"error" => format_fs_error("write", raw_to, reason)}
    end
  end

  defp upload_stream(path, size, %{"method" => method, "url" => url, "headers" => headers}) do
    body = if size == 0, do: "", else: File.stream!(path, @chunk)

    response =
      Req.request!(
        method: method |> String.downcase() |> String.to_existing_atom(),
        url: url,
        headers: Map.to_list(Map.put(headers, "content-length", Integer.to_string(size))),
        body: body,
        retry: false,
        decode_body: false,
        receive_timeout: 600_000
      )

    if response.status in 200..299,
      do: :ok,
      else: %{"error" => "Couldn't upload the file to storage (HTTP #{response.status})."}
  rescue
    e in File.Error -> %{"error" => format_fs_error("read", path, e.reason)}
  end

  defp download_stream(%{"method" => method, "url" => url, "headers" => headers}, dest, raw_to) do
    response =
      Req.request!(
        method: method |> String.downcase() |> String.to_existing_atom(),
        url: url,
        headers: Map.to_list(headers),
        into: File.stream!(dest),
        retry: :transient,
        raw: true,
        receive_timeout: 600_000
      )

    if response.status in 200..299,
      do: :ok,
      else: %{"error" => "Couldn't download the file from storage (HTTP #{response.status})."}
  rescue
    e in File.Error -> %{"error" => format_fs_error("write", raw_to, e.reason)}
  end

  defp mkdir_p(dir, raw_to) do
    case File.mkdir_p(dir) do
      :ok -> :ok
      {:error, reason} -> %{"error" => format_fs_error("create folder for", raw_to, reason)}
    end
  end

  defp maybe_chmod(_path, nil, _raw_to), do: :ok

  defp maybe_chmod(path, mode, raw_to) do
    case File.chmod(path, mode) do
      :ok -> :ok
      {:error, reason} -> %{"error" => format_fs_error("set permissions on", raw_to, reason)}
    end
  end

  defp rename_file(from, to, raw_to) do
    case File.rename(from, to) do
      :ok -> :ok
      {:error, reason} -> %{"error" => format_fs_error("write", raw_to, reason)}
    end
  end

  defp copy_file_to(from, to, raw_to) do
    case File.cp(from, to) do
      :ok -> :ok
      {:error, reason} -> %{"error" => format_fs_error("write", raw_to, reason)}
    end
  end

  defp format_fs_error(_verb, path, :enoent), do: "There's no file or folder #{path} on this device."
  defp format_fs_error(_verb, path, :enospc), do: "There's no room on this device to write #{path}."
  defp format_fs_error(verb, path, :eacces), do: "Permission denied to #{verb} #{path} on this device."
  defp format_fs_error(_verb, path, :eisdir), do: "#{path} is a folder, not a file."
  defp format_fs_error(_verb, path, :enotdir), do: "Part of #{path} is a file, not a folder."
  defp format_fs_error(_verb, path, :erofs), do: "The filesystem for #{path} is read-only."

  defp format_fs_error(verb, path, reason) when is_atom(reason),
    do: "Couldn't #{verb} #{path}: #{:file.format_error(reason)}."

  defp format_fs_error(verb, path, reason),
    do: "Couldn't #{verb} #{path}: #{inspect(reason)}."

  defp log(service, entry) do
    File.write!(Path.join(OneCore.Service.folder(service), "ran.jsonl"), JSON.encode!(entry) <> "\n", [:append])
  end

  # What it printed with `<concealed>` in place of each secret it was given, as 1Password's `op run` conceals them.
  defp concealed(text, secrets) do
    case Enum.reject(Map.values(secrets), &(&1 == "")) do
      [] -> text
      values -> String.replace(text, values, "<concealed>")
    end
  end
end
