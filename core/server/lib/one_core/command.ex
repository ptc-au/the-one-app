defmodule OneCore.Command do
  @moduledoc """
  Runs a program on this machine for at most a while, as an app's service runs adb, simctl, podman or a person's
  command. It leads a process group of its own, as every program a server starts does (`erl_child_setup` starts each
  in a session of its own), and once it takes too long the group is killed whole, so whatever it started goes too.

  A Unix server runs it through `sh`, which gives it `/dev/null` (or the file it's given) as its input and another
  file as its errors', since a port reads a program's output as one stream. Windows has no `sh`: there a program runs
  alone, with nothing to read and what it writes as errors beside what it prints, as Windows gives them; one that has
  a file given it as its input runs through `cmd`, which puts its errors in a file of their own, as does one whose
  output isn't text, whose errors go where this server's do instead. What took too long is ended with `taskkill /T /F`,
  its tree with it, since a Windows program leads no group of its own.
  """

  # What `cmd` reads as more than one word, where the program would read it as one.
  @words [" ", "\t", "\"", "&", "|", "<", ">", "^", "(", ")"]

  @doc """
  Runs `[program | args]` for at most `timeout` seconds. Gives its exit code, -1 where it was stopped (its errors
  then end "(stopped after <timeout>s)"), and all it printed and wrote as errors, in `stdout` and `stderr`.

  Options: `env`, the variables it's given beside this server's, as `{name, value}`s; `cd`, the folder it runs in;
  `in`, a file it's given as its input, where it reads one; `binary`, whether what it prints isn't text; `each`,
  `{fun, first}`, which is given each line it prints and what it gave for the line before, `first` for the first.
  """
  def run([program | args], timeout, options \\ []) do
    errors = Path.join(System.tmp_dir!(), "one-command-#{System.unique_integer([:positive])}")
    {shell, arguments, env, shared} = shell(program, args, errors, options)
    env = for {name, value} <- Keyword.get(options, :env, []) ++ env, do: {String.to_charlist(name), String.to_charlist(value)}

    port =
      Port.open(
        {:spawn_executable, shell},
        # Started hidden, as a `cmd` whose console shows has what it runs write there, and not into the port.
        [:binary, :exit_status, :hide, args: arguments, env: env] ++
          (if shared, do: [:stderr_to_stdout], else: []) ++
          Enum.flat_map(options, fn
            {:env, _} -> []
            {:cd, folder} -> [cd: folder]
            {:each, _} -> [line: 16_384]
            {:in, _} -> []
            {:binary, _} -> []
          end)
      )

    {exit, stdout} = read(port, System.monotonic_time(:millisecond) + timeout * 1000, [], options[:each])
    stderr = with {:ok, text} <- File.read(errors), do: text, else: (_ -> "")
    File.rm(errors)

    # Where its errors went beside what it printed, being stopped is said there too.
    note = "(stopped after #{timeout}s)"
    stdout = if exit == -1 and shared, do: noted(stdout, note), else: stdout
    stderr = if exit == -1 and not shared, do: noted(stderr, note), else: stderr

    %{exit: exit, stdout: stdout, stderr: stderr}
  end

  # The shell that runs it, what it's told, the variables that tell it, and whether its errors share its output.
  defp shell(program, args, errors, options) do
    case :os.type() do
      {:win32, _} ->
        cond do
          options[:in] ->
            given = Enum.map_join([program | args], " ", &word/1)
            command = "#{given} < #{word(options[:in])} 2> #{word(errors)}"

            # `cmd` takes its command line as one word of its own, read from a variable of this run's: a port puts a
            # backslash before each quote it's given, which `cmd` would read as a letter.
            {System.find_executable("cmd.exe"), ["/d", "/v:off", "/c", "%ONE_COMMAND%"], [{"ONE_COMMAND", command}], false}

          true ->
            {System.find_executable(program) || program, args, [], !options[:binary]}
        end

      _ ->
        {System.find_executable("sh"),
         ["-c", ~s(exec <"$0" 2>"$1"; shift 1; exec "$@"), options[:in] || "/dev/null", errors, program | args], [], false}
    end
  end

  # An argument as the program reads it: quoted where it's more than one word, with the backslashes before a quote
  # doubled, which is how a program finds its quotes again.
  defp word(argument) do
    if argument != "" and not Enum.any?(@words, &String.contains?(argument, &1)) do
      argument
    else
      escaped = Regex.replace(~r/(\\*)"/, argument, fn _, slashes -> slashes <> slashes <> ~S(\") end)
      escaped = Regex.replace(~r/(\\+)$/, escaped, fn _, slashes -> slashes <> slashes end)
      ~s(") <> escaped <> ~s(")
    end
  end

  defp noted(text, note) do
    cond do
      text == "" or String.ends_with?(text, "\n") -> text <> note
      true -> text <> "\n" <> note
    end
  end

  # Reads what it prints until it ends, or kills its group once `until` passes. Its id is asked for only then: one
  # that has ended has none.
  defp read(port, until, printed, each) do
    receive do
      {^port, {:data, {:noeol, part}}} -> read(port, until, [printed | part], each)
      {^port, {:data, {:eol, line}}} -> read(port, until, [printed, line, "\n"], with({fun, at} <- each, do: {fun, fun.(line, at)}))
      {^port, {:data, data}} -> read(port, until, [printed | data], each)
      {^port, {:exit_status, status}} -> {status, IO.iodata_to_binary(printed)}
    after
      max(0, until - System.monotonic_time(:millisecond)) ->
        kill(port)
        {-1, killed(port, printed)}
    end
  end

  # Ends what it runs with everything it started. A Windows program leads no group, so its tree goes by the id it
  # started from, which `taskkill` takes; a `taskkill` that doesn't end in 10 s is let go, since saying it was stopped
  # matters more than whatever it leaves. Run through `System.cmd`, as `run` would ask this of itself.
  defp kill(port) do
    with {:os_pid, pid} <- Port.info(port, :os_pid) do
      case :os.type() do
        {:win32, _} ->
          task = Task.async(fn -> System.cmd("taskkill", ["/T", "/F", "/PID", to_string(pid)], stderr_to_stdout: true) end)
          Task.yield(task, 10_000) || Task.shutdown(task, :brutal_kill)

        _ ->
          System.cmd("kill", ["-KILL", "--", "-#{pid}"])
      end
    end
  end

  # What it printed before its group was killed, read until its port ends with it, as it does at once. One the kill
  # didn't reach (it left its group) is let go after a second.
  defp killed(port, printed) do
    receive do
      {^port, {:data, {:eol, line}}} -> killed(port, [printed, line, "\n"])
      {^port, {:data, {:noeol, part}}} -> killed(port, [printed | part])
      {^port, {:data, data}} -> killed(port, [printed | data])
      {^port, {:exit_status, _}} -> IO.iodata_to_binary(printed)
    after
      1000 ->
        Port.close(port)
        IO.iodata_to_binary(printed)
    end
  end

  @doc "The end of `text`, at most `max` bytes of it, where errors usually are, saying how much was cut before."
  def clip(text, max) do
    text = String.replace_invalid(text)

    if byte_size(text) <= max do
      text
    else
      tail = String.replace_invalid(binary_part(text, byte_size(text) - max, max), "")
      "(#{byte_size(text) - byte_size(tail)} earlier bytes cut) …" <> tail
    end
  end
end
