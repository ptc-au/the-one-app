defmodule OneCore.Asks do
  @moduledoc """
  What this server asks of others, in processes of their own under the `Task.Supervisor` of this name
  (`OneCore.Application`), and the one way to ask several at once: `each/3`.

  A target that missed its deadline is given a short one (`@short`) for a while after (`@open`), as a circuit
  breaker is open: a machine that's connected but too slow to answer, as the Surface was, cost every call that asked
  every server its full wait, each time (1,304 times in 6 days). Once that while has passed it's given the full
  deadline again, and keeps it once it answers in time.
  """
  require Logger

  # How long each has to answer `each/3`, in milliseconds, unless it says otherwise: short of the ten seconds an app
  # has to answer a hook (`OneCore.Hooks.within/3`), so a hook that asks several still has what the others said when
  # one doesn't.
  @deadline 8_000

  # How long a target that missed its deadline has to answer, in milliseconds, and for how long after it missed it: a
  # server that's up answers in well under a second.
  @short 1_000
  @open 60_000

  @doc "Makes the table of when each target last missed its deadline. Whatever calls this owns it."
  def table, do: :ets.new(__MODULE__, [:named_table, :public, write_concurrency: true])

  @doc """
  Asks each of `targets` (servers, devices, apps) at once, by calling `ask` with it, each under its own deadline of
  `deadline` milliseconds, eight seconds unless given, or `@short` for one that missed its own lately, as
  `Promise.allSettled` does, in this call's trace. Gives `{answers, failed}`: what each that answered gave, as
  `{target, answer}` in the order of `targets`, and why each that didn't couldn't, by target: it raised or exited, or
  didn't answer in time and was stopped. One that doesn't answer takes away only its own part, and none keeps the
  caller past its deadline.
  """
  def each(targets, ask, deadline \\ @deadline) do
    {trace, call} = {OpenTelemetry.Ctx.get_current(), OneCore.Call.State.id()}
    began = System.monotonic_time(:millisecond)

    asked = fn target ->
      OpenTelemetry.Ctx.attach(trace)
      OneCore.Call.State.follow(call)

      try do
        {:ok, ask.(target)}
      rescue
        problem -> {:error, Exception.message(problem)}
      catch
        kind, reason -> {:error, Exception.format_banner(kind, reason)}
      end
    end

    asking = for target <- targets, do: {target, within(target, deadline, began), Task.Supervisor.async_nolink(__MODULE__, fn -> asked.(target) end)}

    results =
      for {target, within, task} <- asking do
        left = max(began + within - System.monotonic_time(:millisecond), 0)
        result = Task.yield(task, left) || Task.shutdown(task, :brutal_kill) || {:exit, :timeout}
        missed(target, result, within == deadline, began)
        {target, within, result}
      end

    answers = for {target, _within, {:ok, {:ok, answer}}} <- results, do: {target, answer}
    failed = for {target, within, result} <- results, why = why(result, within), into: %{}, do: {target, why}
    for {target, why} <- failed, do: Logger.warning("Asking #{inspect(target)} failed: #{why}")
    {answers, failed}
  end

  # The deadline `target` has: `@short` where it missed its own within `@open`.
  defp within(target, deadline, now) do
    case :ets.lookup(__MODULE__, target) do
      [{_target, at}] when now - at < @open -> min(deadline, @short)
      _ -> deadline
    end
  end

  # One that missed its full deadline has a short one from now; one that missed only its short one keeps when it
  # missed the full one, so it's given that again once `@open` has passed.
  defp missed(target, {:exit, :timeout}, true, now), do: :ets.insert(__MODULE__, {target, now})
  defp missed(_target, {:exit, :timeout}, false, _now), do: :ok
  defp missed(target, _answered, _full, _now), do: :ets.delete(__MODULE__, target)

  defp why({:ok, {:ok, _answer}}, _within), do: nil
  defp why({:ok, {:error, why}}, _within), do: why
  defp why({:exit, :timeout}, within), do: "didn't answer within #{div(within, 1000)} seconds"
  defp why({:exit, reason}, _within), do: Exception.format_exit(reason)
end
