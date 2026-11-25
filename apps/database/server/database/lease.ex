defmodule Database.Lease do
  @moduledoc """
  One database on this server: open here while this server holds its lease, and otherwise only known to be held by
  another.

  The server holding the lease keeps the database as a file of its own, which is only a copy: the log in the
  bucket is the database. A transaction commits to that file, and its pages are then written as the log's next
  entry. Only once that's written is the transaction answered, so nothing answered is lost with this server. If
  another server wrote that entry first, this one lost the lease without knowing: it throws its copy away, and
  what it had committed there with it.

  A server that can't reach the one holding the lease takes it, even while that one is up and answering others, and
  that one learns so only by looking at the log. So a server answers from its copy only for a few seconds after it
  last saw the log's next entry free, and looks again before it answers after that; and a server that has just
  opened the database writes nothing to it for a little longer. One that lost the lease without knowing has stopped
  answering from what it had before the database changes.

  One transaction that writes runs at a time, and the next begins after the last is in the bucket, so none sees what
  could still be lost. Its write is sent in a process of its own, and meanwhile a transaction that only reads is
  answered from the copy as it was before that write (a second connection to it, in a read transaction begun before
  the write was committed, as SQLite's write-ahead log keeps it), while the lease holds: a bucket that's slow to answer
  a write, or gone, holds up none of the reads, as every call's hooks read Permissions' and Sign-in's databases. A
  write the bucket hasn't answered within `@written_within` is answered as taking longer, never as failed, and its copy
  thrown away, since whether the write got there only the log says.

  The server holding the lease also makes the calls of the app's scheduled jobs. When each job last ran is a
  row of the database, in `database_scheduled`: the time it was due at. A job that's due is called in a process
  of its own, whose transactions carry the job and that time (`job/0`), and the first that commits marks it as run,
  in that same transaction, or is refused where it's marked already. So the mark and what the call wrote reach the
  log in one entry, or neither does, whichever process keeps the database by then: a server that takes the lease, or
  this one's started again, reads from the log whether the call is still to make, and a call it makes again meanwhile
  writes nothing. A call that made no transaction is marked when it ends.

  A call says what wraps the artifact it has (`OneCore.Artifact`). If that isn't what this was opened with, the
  database closes, and the call opens it again: an encrypted artifact's keys are given anew to a server that was
  taken off it and chosen again, and what it had open is from before another server wrote.

  It's a `:gen_statem`, in one of these states:

  - `:looking`: it's reading the log, in a process of its own, as it does when it starts, after it lost the
    lease or a write it couldn't finish, and to take the lease over from the server it follows. A transaction waits for it, until the bucket hasn't answered its first read
    for `@renew_within`; then it's `:unreached`, and a transaction is refused at once while it reads the log again
    every `@renew_every`. So a database started again while the bucket is away doesn't hold up whoever asked for it.
  - `{:following, server}`: `server` holds the lease. A transaction is answered with who holds it, to be passed on
    to them, and how long they may still be settling (`settles_in/2`). One they didn't run has this server read what
    was logged after the last entry it read, and take the lease if they handed it on, or if that's nothing and it's not the one out of reach (`Database.transaction/3`),
    looking at the log meanwhile; one that another server took meanwhile is followed there. `nil` is nobody: the log is empty or handed on, and this server isn't up
    to take it.
  - `:settling`: this server has just opened the database, and writes nothing until `@writes_after` has passed.
    Its copy is read-only meanwhile: a transaction that only reads is answered from it at once, and one that would
    write raises there, is rolled back, and waits until then to run again, with any that came after it that write.
  - `:holding`: each transaction's write is logged as it commits.
  - `:writing`: a transaction's write is being logged. One that only reads is answered from the copy as it was
    before it, and one that would write raises there, is rolled back, and waits for that write, as while settling.

  It moves between them by reading the log (`look/2`): to `:settling` with the database opened if the log names
  this server, after taking the lease if the log is empty, and otherwise to following the server it names. One that
  finds another server wrote the log's next entry has lost the lease, and reads the log again.

  Only a server that's up takes the lease (`OneCore.Server.up?/0`): a build being tried that can't be reached by its
  key, or a server that's stopping, would have everyone pass their calls to it and wait. It still holds the lease
  the log gave it before it started, which everyone passes their calls to already.

  A server whose own work on the database fails, as one out of files does, hands its lease on as well, and takes
  none for a while: an app's own error is its caller's, but one opening its copy or reading SQLite's log is this
  server's, and every call passed to it would fail the same way while it kept the lease.

  A server that stops as it's asked to hands its leases on: it writes the log's next entry naming nobody, once it
  answers nothing more from its copy, and whoever asks next takes it and writes at once, with nothing to wait out. It
  does so as soon as it says it's stopping, not once its process stops: a server stopping answers what it took
  already, for up to 15 s (`OneCore.Application.prep_stop/1`), and takes nothing new, so every other server's call
  waited on a lease it held meanwhile, and Permissions' and Sign-in's hooks gave up at 10 s, as servers restarted for
  an update (21 Nov). What it's still running is passed to whoever takes the lease.

  A lease belongs to whichever server the others reach, whatever its machine, as a lease in Chubby or etcd lasts only
  while its holder answers: a holder frozen, asleep, or behind a firewall that keeps the others out, though it still
  reaches the bucket, is taken over from once a server that can't reach it finds that another can't either, or that
  there's no other to ask (`Database.transaction/3`). One that couldn't reach a holder that took the lease from it, and
  found no other server to ask, doesn't take it back while the relay at the network's address still reaches that one
  (`OneCore.Servers.answers?/2`): it's the one out of reach, as a laptop that has just woken is, and taking the lease
  back would have it move back and forth. A holder that answers neither has lost it, however recently the relay last
  saw it: being connected there isn't answering.

  Whether a server may answer from its copy isn't a state of its own. It's the time since it last saw the log's next
  entry free, read after the transaction ran by both its clocks, since a state timeout fires only between events,
  and by the monotonic clock alone, which stops while a machine sleeps.

  A server looks at the log's next entry in the background, as a Chubby or etcd client renews its lease ahead of its
  end, every `@renew_every` while it has been asked for a transaction in the last `@renewed_while`. So a database in
  use answers from its copy without waiting on the bucket, and one whose bucket doesn't answer refuses at once once
  its lease has run out, saying so, rather than having every call wait on the bucket in turn. Every hook that decides
  who may reach what reads a database (`OneCore.Hooks`), so every tool call would wait.
  """
  @behaviour :gen_statem
  require Logger
  alias Database.Log
  alias OpenTelemetryAPIExperimental.{Counter, Histogram}
  require Counter
  require Histogram

  # The fewest pages logged since a snapshot before the next, so that a small database isn't kept whole on every
  # other write. An entry that only takes the lease counts as a page: a server opening the database reads every
  # entry since the snapshot, while every call waits, and servers taking the lease from each other log nothing else.
  @least 64

  # How long, in milliseconds, a server answers from its copy after it last saw the log's next entry free, and how
  # long one that has just opened the database waits before it writes to it, from when it began reading the log
  # that names it. The second is longer by far more than two machines' clocks drift apart in that time.
  @lease_ttl 4_000
  @writes_after 5_000

  # How often a server looks at the log's next entry in the background while its database is in use, and for how long
  # after its last transaction. Half the lease leaves the bucket half of it to answer before the lease runs out.
  @renew_every div(@lease_ttl, 2)
  @renewed_while 60_000

  # How long a call that finds the lease run out, with no look in the background under way, as on a database that
  # wasn't in use, waits for one: the bucket answers a read well within a second (`OneCore.Bucket.S3`), and one that
  # hasn't in this long isn't answering.
  @renew_within 2_000

  # How long, in milliseconds, a transaction's write may take to reach the bucket before it's answered as taking
  # longer (`unwritten/4`), and this many
  # more for each kilobyte of it: the bucket answers a write well within a second, and every hook gives up at 10 s
  # (`OneCore.Hooks`).
  @written_within 8_000

  # What SQLite says of a write to a copy that's read-only (`pragma query_only`), as `Database.query/3` raises it.
  @read_only "attempt to write a readonly database"

  # What it keeps besides its state. `db` is the copy while it's open, with the build of `Sqlite` that opened it,
  # `{sqlite, db}`, which is the build it's used with (`OneCore.Nif`), `number` the log's last entry it read or
  # wrote, `logged` the pages logged since the last snapshot and `pages` the copy's size, `proved` its clocks when it
  # last saw the log's next entry free, `settled` when by its monotonic clock it may write, and `firing` the
  # scheduled jobs being called here: each one's `job` and the time it was due `at`, by its call's process, and
  # whether it's `marked` as run yet; `lost_to` the server that last took the lease from this one; `followed` the server
  # it follows and when by its monotonic clock it first read that one holds it (`settles_in/2`); `renewing` the look
  # at the log under way in the background, `unreached` why the last look couldn't read the bucket, `used` when by its
  # monotonic clock it last ran a transaction, and `ticking` whether it looks again every `@renew_every`; `reader` the
  # copy's second connection, which only reads, `writing` the write being logged (`write/4`), `looking` the
  # process reading the log (`looking/3`), and `taking` the take-over waiting on it, to be answered. A field's default is what's safe for a database that was open under a
  # version of this module without it (`code_change/4`): never seen free, so it looks before it answers.
  defstruct [
    :artifact,
    :server,
    :folder,
    :db,
    :reader,
    :writing,
    :looking,
    :proved,
    :settled,
    :failed,
    :lost_to,
    :followed,
    :taking,
    :renewing,
    :unreached,
    :used,
    ticking: false,
    number: 0,
    logged: 0,
    pages: 0,
    firing: %{}
  ]

  # How long, in milliseconds, a server that's stopping waits for the bucket to answer its handing the lease on: the
  # bucket answers a write well within a second, and OTP gives a process 5 s to stop.
  @handed_within 2_000

  # How long, in milliseconds, a server whose own copy of the database failed takes no lease after it handed this one
  # on, so a server that can open files takes it rather than this one again (`failed/4`).
  @failed_for 60_000

  @doc """
  The scheduled job of the database `lease` that this process is the call of, `{job, at}`, until a transaction it
  made there has marked it as run (`marked/0`), or `nil`. A job's call may write to other apps' databases too, as
  one keeping something in its person's Vault does, and those have no schedule of its.
  """
  def job(lease) do
    case Process.get(__MODULE__) do
      {^lease, job, at} -> {job, at}
      _ -> nil
    end
  end

  @doc "This process's scheduled job is marked as run."
  def marked, do: Process.delete(__MODULE__)

  @doc """
  The process for the database that is the calling app's own artifact, on the server running the call. It
  outlives the call that started it, and carries on through this app's updates with the database open.
  """
  def of(%OneCore.Call{own: artifact, server: server, folder: folder} = call) do
    OneCore.Call.process(call, __MODULE__, {server, artifact.prefix}, {artifact, server, Path.join(folder, "database")})
  end

  @impl true
  def callback_mode, do: :handle_event_function

  # `folder` is where this server keeps its copy, which is nobody else's.
  @impl true
  def init({artifact, server, folder}) do
    # So it hears that its server is stopping, and hands its lease on (`terminate/3`), from when it says so.
    Process.flag(:trap_exit, true)
    Registry.register(OneCore.Waiting, :status, nil)
    measures()
    {:next_state, state, data, actions} = looking(%__MODULE__{artifact: artifact, server: server, folder: folder})
    {:ok, state, data, actions}
  end

  # What the process reading the log found, where it's `{answer, {state, looked}}`, of which only what reading the log
  # changes is kept, and a take-over waiting on it is answered `answer`. One that couldn't read it has calls refused,
  # and reads it again in a while.
  @impl true
  def handle_event(:info, {ref, found}, state, %{looking: %Task{ref: ref}} = data) when state in [:looking, :unreached] do
    Process.demonitor(ref, [:flush])
    data = %{data | looking: nil}

    case found do
      {:unreached, why} ->
        Logger.warning("#{data.artifact.prefix}: couldn't read its log: #{why}")
        {:next_state, :unreached, %{data | unreached: why, taking: nil}, [{:state_timeout, @renew_every, :look} | told(data, :unreached)]}

      {answer, {state, looked}} ->
        kept = Map.take(looked, [:number, :db, :reader, :proved, :settled, :logged, :failed, :lost_to, :followed])
        moved({state, Map.merge(%{data | unreached: nil, taking: nil}, kept)}, told(data, answer))
    end
  end

  # The bucket answered its first read: calls wait for the rest.
  def handle_event(:info, {:reached, pid}, :looking, %{looking: %Task{pid: pid}}),
    do: {:keep_state_and_data, {:state_timeout, :cancel}}

  def handle_event(:state_timeout, :unreached, :looking, data),
    do: {:next_state, :unreached, %{data | unreached: "the bucket hasn't answered for #{@renew_within} ms", taking: nil}, told(data, :unreached)}

  def handle_event(:state_timeout, :look, :unreached, data), do: {:keep_state, in_task(data, looks(data, false))}

  # Once settled, its copy takes writes, and the transactions that would have written while settling run again.
  def handle_event(:state_timeout, :settled, :settling, data) do
    {:ok, _} = sqlite(data.db, "pragma query_only = off")
    {:next_state, :holding, data}
  end

  # The server this one follows didn't run a call passed on to it, `why` (`taken/4`): the log is read in a process of
  # its own, as it is to look at it, and the call is answered once it's read, or refused once the bucket hasn't answered
  # for `@renew_within`.
  def handle_event({:call, from}, {:take_over, server, why}, {:following, server}, data),
    do: looking(%{data | taking: from}, [], fn reached -> taken(data, server, why, reached) end)

  # Another holds it now, or this server does: the call is asked again, and goes there.
  def handle_event({:call, from}, {:take_over, _server, _why}, _state, _data),
    do: {:keep_state_and_data, {:reply, from, :ok}}

  # Anything else is asked with what wraps the artifact of the call that asks: once a write being logged is done.
  def handle_event({:call, _from}, {codec, _ask}, :writing, %{artifact: %{codec: was}}) when codec != was,
    do: {:keep_state_and_data, :postpone}

  def handle_event({:call, from}, {codec, _ask}, _state, %{artifact: %{codec: was}}) when codec != was,
    do: {:stop_and_reply, :normal, {:reply, from, :codec_changed}}

  def handle_event({:call, from}, {_codec, ask}, {:following, server}, data)
      when elem(ask, 0) in [:transaction, :schedule],
      do: {:keep_state_and_data, {:reply, from, {:held_by, server, settles_in(data, server)}}}

  def handle_event({:call, _from}, {_codec, ask}, :looking, _data) when elem(ask, 0) in [:transaction, :schedule],
    do: {:keep_state_and_data, :postpone}

  def handle_event({:call, from}, {_codec, ask}, :unreached, data) when elem(ask, 0) in [:transaction, :schedule] do
    Logger.warning("#{data.artifact.prefix}: refused a transaction, as it couldn't read its log: #{data.unreached}")
    {:keep_state_and_data, {:reply, from, :unreached}}
  end

  # A transaction on a database that isn't being looked at in the background starts that first.
  def handle_event({:call, _from} = type, {_codec, {:transaction, _, _, _}} = content, state, %{ticking: false} = data)
      when state in [:settling, :holding, :writing] do
    {:keep_state, %{data | ticking: true}, [{{:timeout, :renew}, @renew_every, nil}, {:next_event, type, content}]}
  end

  def handle_event({:call, _from} = type, {_codec, {:transaction, schema, fun, job}} = content, state, data) do
    data = %{data | used: System.monotonic_time(:millisecond)}

    transact({type, content}, state, data, fn db ->
      migrate(db, schema)
      result = fun.(db)
      if job, do: mark(db, job)
      result
    end)
  end

  def handle_event({:call, _from} = type, {_codec, {:schedule, jobs, _fire, now}} = content, state, data),
    do: transact({type, content}, state, data, &due(&1, jobs, now))

  # What the look in the background found. One that finds another server took the lease has it lose it now.
  def handle_event(:info, {ref, renewal}, state, %{renewing: {%Task{ref: ref}, _began}} = data) do
    Process.demonitor(ref, [:flush])

    case renewed(renewal, %{data | renewing: nil}) do
      {:lost, data} when state in [:settling, :holding, :writing] -> lost(data, "as it found looking at the log")
      {_ok_or_lost, data} -> {:keep_state, data}
      {:unreached, data, _why} -> {:keep_state, data}
    end
  end

  # What logging a transaction's write found: it's in the bucket, and the transaction is answered; another server wrote
  # the log's next entry first, so the lease is theirs; or the bucket couldn't be reached, so the transaction is told
  # it may still be done and the copy, which holds it, thrown away, as whether it got there only the log says.
  def handle_event(:info, {ref, wrote}, :writing, %{writing: %{task: %Task{ref: ref}} = writing} = data) do
    Process.demonitor(ref, [:flush])
    data = %{data | writing: nil}
    cancel = {{:timeout, :written}, :cancel}

    case wrote do
      :ok ->
        unpin(data.reader)
        checkpoint(data.db)
        logged = %{data | number: data.number + 1, logged: data.logged + writing.pages, pages: writing.size, proved: writing.began}
        {data, actions} = done(writing.event, writing.ran, logged)
        {:next_state, :holding, data, [cancel | actions]}

      :exists ->
        lost(data, "and the write it hadn't answered with it", [cancel | next(writing.event)])

      {:unreached, why} ->
        unwritten(writing.event, data, why, [cancel])
    end
  end

  def handle_event({:timeout, :written}, nil, :writing, %{writing: writing} = data) do
    {_event, data} = abandon(data)
    unwritten(writing.event, data, "the bucket hasn't answered its write for #{System.monotonic_time(:millisecond) - elem(writing.began, 0)} ms")
  end

  def handle_event({:timeout, :written}, nil, _state, _data), do: :keep_state_and_data

  # A job's call ended. One that committed no transaction is marked as run now, unless the lease has gone: then the
  # server holding it makes the call.
  def handle_event(:info, {:DOWN, _monitor, :process, caller, _why} = down, state, data) do
    case pop_in(data.firing[caller]) do
      {%{marked: false} = firing, data} when state in [:settling, :holding, :writing] ->
        transact({:info, down}, state, data, &mark(&1, {firing.job, firing.at}))

      {_firing, data} ->
        {:keep_state, data}
    end
  end

  # Its server says it's stopping: the lease is handed on now, once a write being logged is done.
  def handle_event(:info, :status, :writing, _data), do: {:keep_state_and_data, :postpone}

  def handle_event(:info, :status, state, data) when state in [:settling, :holding] do
    if OneCore.Release.status()["server_daemon_status"] == "stopping",
      do: {:next_state, {:following, nil}, hand_on(close(data))},
      else: :keep_state_and_data
  end

  def handle_event(:info, _message, _state, _data), do: :keep_state_and_data

  # It looks at the log in the background while it's in use, and stops once it hasn't been for `@renewed_while`, when
  # what its last look found is too old to go by.
  def handle_event({:timeout, :renew}, nil, state, data) do
    if state in [:settling, :holding, :writing] and System.monotonic_time(:millisecond) - data.used < @renewed_while,
      do: {:keep_state, renew(data), {{:timeout, :renew}, @renew_every, nil}},
      else: {:keep_state, %{data | ticking: false, unreached: nil}}
  end

  # A server stopping as it was asked to hands on the lease it holds, if it hasn't as it said it was stopping.
  @impl true
  def terminate(why, state, data) do
    {_event, data} = abandon(data)
    data = close(data)
    if state in [:settling, :holding, :writing] and (why == :shutdown or match?({:shutdown, _}, why)), do: hand_on(data)
  end

  # Hands on the lease, its copy closed first, so it answers nothing from it after: the log's next entry names nobody,
  # unless the bucket hasn't answered that within `@handed_within`, when nobody could take the lease anyway. One that has
  # lost the lease meanwhile writes nothing.
  defp hand_on(data) do
    {artifact, number} = {data.artifact, data.number + 1}
    handing = Task.async(fn -> Log.write(artifact, number, %{server: nil}) end)

    wrote =
      case Task.yield(handing, @handed_within) || Task.shutdown(handing, :brutal_kill) do
        {:ok, wrote} -> wrote
        {:exit, why} -> Exception.format_exit(why)
        nil -> "the bucket hasn't answered for #{@handed_within} ms"
      end

    Logger.info("#{data.artifact.prefix}: handing its lease on at #{number}: #{wrote}")
    data
  end

  # A database open under an earlier version of this module carries on open under this one, in the state it was in,
  # with what this one keeps that that one didn't at its default. One opened by another build of `Sqlite` is opened
  # with this version's, and closed with that one's, which is still loaded now.
  @impl true
  def code_change(_vsn, state, data, _extra) do
    # One started by a version before it handed its lease on hears its server stopping from now on (`init/1`).
    Process.flag(:trap_exit, true)
    Registry.unregister(OneCore.Waiting, :status)
    Registry.register(OneCore.Waiting, :status, nil)
    data = struct(__MODULE__, Map.from_struct(data))
    data = if match?({sqlite, _db} when sqlite != Sqlite, data.db), do: reopened(data, state), else: data
    {:ok, state, if(data.db && is_nil(data.reader), do: %{data | reader: reader(file(data))}, else: data)}
  end

  # Opened before it's closed, so SQLite keeps its write-ahead log: the last connection to close empties it into the
  # file. One that's settling is read-only still.
  defp reopened(%{db: {sqlite, db}} = data, state) do
    opened = connected(file(data))
    if state == :settling, do: {:ok, _} = sqlite(opened, "pragma query_only = on")
    sqlite.close(db)
    with {sqlite, reader} <- data.reader, do: sqlite.close(reader)
    %{data | db: opened, reader: reader(file(data))}
  end

  # Runs `work` with the database in a transaction, for `event`, which is answered once what it changed is in the
  # bucket (`done/3`). One that changed nothing, raised or not, is answered from the copy, while the copy is still the
  # database. While settling the copy is read-only, and while writing it's read by the connection that only reads, so
  # one that raised for writing, as SQLite says (`SQLITE_READONLY`), waits, with nothing it did kept, to run again once
  # settled or written, which is the state it changes to next; one that raised for anything else is answered with that
  # now. The rest of what `data` changed for it is left as it was, for then.
  defp transact(event, state, data, work) do
    transacted(event, state, data, work)
  rescue
    unreachable in OneCore.Edge.Unreachable -> reraise unreachable, __STACKTRACE__
    error -> failed(event, data, error, __STACKTRACE__)
  end

  # One that finds the lease run out while a look in the background hasn't come back waits for it (`proved/1`), and is
  # refused before it runs if it doesn't, a write too, which would wait on the same bucket.
  # One run while holding has the connection that only reads keep the copy as it was before it, in case it writes.
  defp transacted(event, state, data, work) do
    case if(data.renewing, do: proved(data), else: {:ok, data}) do
      {:ok, data} when state == :writing -> committed(event, state, data, run(data.reader, work))
      {:ok, data} -> committed(event, state, data, run(data.db, work, state == :holding && data.reader))
      {:lost, data} -> lost(data, "so it didn't run a transaction", next(event))
      {:unreached, data, why} -> refused(event, data, why)
    end
  end

  defp committed(event, state, data, ran) do
    case {if(state == :holding, do: changed(data, ran)), state, read_only?(ran)} do
      {nil, state, true} when state in [:settling, :writing] ->
        {:keep_state, data, :postpone}

      {nil, _state, _read_only} ->
        case proved(data) do
          {:ok, data} -> answered(event, ran, data)
          {:lost, data} -> lost(data, "so it didn't answer from its copy", next(event))
          {:unreached, data, why} -> refused(event, data, why)
        end

      {changed, :holding, _read_only} ->
        write(event, ran, data, changed)
    end
  end

  # What a transaction run while holding changed (`Log.changed/1`), or `nil`, once the connection that only reads has
  # let go of the copy as it was before it. One that raised changed nothing, though SQLite may have put some of its
  # pages in its write-ahead log before it rolled back, which is emptied.
  defp changed(data, {:raised, _kind, _reason, _stacktrace}) do
    unpin(data.reader)
    checkpoint(data.db)
    nil
  end

  defp changed(data, _ran) do
    changed = Log.changed(file(data))
    if is_nil(changed), do: unpin(data.reader)
    changed
  end

  defp next({type, content}), do: [{:next_event, type, content}]

  # The bucket didn't answer in time to keep the lease: a call is refused at once, saying only that its app couldn't
  # be reached (`Database.transaction/3`), and why goes to this server's log.
  defp refused(event, data, why) do
    Logger.warning("#{data.artifact.prefix}: refused a transaction, as its lease ran out and #{why}")
    {:keep_state, data, reply(event, :unreached)}
  end

  defp reply({{:call, from}, _content}, answer), do: [{:reply, from, answer}]
  defp reply({:info, _message}, _answer), do: []

  # A transaction whose write the bucket didn't answer may still get there, so it's answered `:ambiguous`, as
  # CockroachDB's ambiguous result is: whoever asked is told it's taking longer, and isn't to do it again
  # (`Database.transaction/3`), and why goes to this server's log. Its copy holds that write, so it's thrown away, and
  # the log read again, which says whether it got there.
  defp unwritten(event, data, why, actions \\ []) do
    Logger.warning("#{data.artifact.prefix}: didn't answer a transaction, as the bucket didn't answer its write: #{why}")
    looking(close(data), actions ++ reply(event, :ambiguous))
  end

  defp read_only?({:raised, :error, error, _stacktrace}) when is_exception(error), do: Exception.message(error) =~ @read_only
  defp read_only?(_ran), do: false

  # This server's own work on the database failed, not the app's (`run/2` answers that): its lease is handed on, and
  # a call is answered with what failed, to be asked of whoever takes the lease. Not reaching the bucket isn't this:
  # nothing could be handed on then, and nobody else would reach it either.
  # A write being logged is given up on with it.
  defp failed(event, data, error, stacktrace) do
    {writing, data} = abandon(data)
    abandoned = if writing, do: reply(writing, :ambiguous), else: []
    {:next_state, {:following, nil}, hand_on_failed(data, error), abandoned ++ reply(event, {:raised, :error, error, stacktrace})}
  end

  # Its copy is thrown away, which may fail too where files can't be opened, and is made anew where it's opened next:
  # then the log's next entry names nobody, as a server stopping writes it, in a process of its own, which nothing waits
  # for: this server takes no lease for `@failed_for` meanwhile, and of it and another server taking the lease, only one
  # writes that entry.
  defp hand_on_failed(data, error) do
    data =
      try do
        close(data)
      rescue
        _closing -> %{data | db: nil}
      end

    {prefix, artifact, number} = {data.artifact.prefix, data.artifact, data.number + 1}
    Logger.error("#{prefix}: this server's copy failed (#{Exception.message(error)}), so it hands its lease on at #{number}")

    Task.start(fn ->
      try do
        Log.write(artifact, number, %{server: nil})
      catch
        kind, reason -> Logger.warning("#{prefix}: didn't hand its lease on at #{number}: #{Exception.format_banner(kind, reason)}")
      end
    end)

    %{data | failed: System.monotonic_time(:millisecond)}
  end

  defp failed?(%{failed: nil}), do: false
  defp failed?(%{failed: at}), do: System.monotonic_time(:millisecond) - at < @failed_for

  defp answered(event, ran, data) do
    {data, actions} = done(event, ran, data)
    {:keep_state, data, actions}
  end

  # What a transaction gave, once that's safe to say, and what follows from it: a call that asked is answered, the
  # job whose call made it is marked as run, and the jobs a schedule found due are called, each in a process of its
  # own. A call that has marked its job as run is done with it, even while its process is still ending. A database
  # is kept as a snapshot once its log is long enough.
  defp done({{:call, {caller, _tag} = from}, {_codec, {:transaction, _schema, _fun, job}}}, ran, data) do
    data =
      if job && data.firing[caller] && match?({:ok, _}, ran), do: put_in(data.firing[caller].marked, true), else: data

    {snapshot(data, ran), [{:reply, from, ran}]}
  end

  defp done({{:call, from}, {_codec, {:schedule, _jobs, fire, _now}}}, {:ok, due} = ran, data) do
    calling = for {_caller, %{job: job, marked: false}} <- data.firing, do: job

    lease = self()

    firing =
      for {job, at, called} <- due, job not in calling, into: data.firing do
        {caller, _monitor} =
          spawn_monitor(fn ->
            Process.put(__MODULE__, {lease, job, at})
            fire.(called)
          end)

        {caller, %{job: job, at: at, marked: false}}
      end

    {snapshot(%{data | firing: firing}, ran), [{:reply, from, :ok}]}
  end

  defp done({{:call, from}, {_codec, {:schedule, _jobs, _fire, _now}}}, raised, data),
    do: {data, [{:reply, from, raised}]}

  defp done({:info, {:DOWN, _monitor, :process, _caller, _why}}, ran, data), do: {snapshot(data, ran), []}

  # Another server wrote the log's next entry: the lease is theirs, and what this one committed to its copy since
  # is thrown away with it, a write being logged too. An event in `actions` is handled again where it is now, which for
  # a call is with who holds it.
  defp lost(data, what, actions \\ []) do
    Logger.info("#{data.artifact.prefix}: lost its lease, #{what}")
    {writing, data} = abandon(data)
    data = close(data)
    looking(data, actions ++ if(writing, do: next(writing), else: []), looks(data, true))
  end

  # Reads the log in a process of its own, by `look/2` or as `read` does, which is given what to call once the bucket
  # has answered its first read.
  defp looking(data, actions \\ [], read \\ nil),
    do: {:next_state, :looking, in_task(data, read || looks(data, false)), [{:state_timeout, @renew_within, :unreached} | actions]}

  defp in_task(data, read) do
    lease = self()

    task =
      Task.async(fn ->
        try do
          read.(fn -> send(lease, {:reached, self()}) end)
        catch
          kind, reason -> {:unreached, Exception.format_banner(kind, reason)}
        end
      end)

    %{data | looking: task}
  end

  # Looks at the log (`look/2`), for `data`. One that `lost` the lease notes who it lost it to.
  defp looks(data, lost) do
    fn reached ->
      case look(data, reached) do
        {{:following, holder}, data} when lost -> {:ok, {{:following, holder}, %{data | lost_to: holder}}}
        looked -> {:ok, looked}
      end
    end
  end

  # A take-over waiting on the log being read is answered `answer`.
  defp told(%{taking: nil}, _answer), do: []
  defp told(%{taking: from}, answer), do: [{:reply, from, answer}]

  # Where it is once it has read the log: settling waits out its time before it writes.
  defp moved(looked, actions \\ [])
  defp moved({:settling, data}, actions), do: {:next_state, :settling, data, [settle(data) | actions]}
  defp moved({state, data}, actions), do: {:next_state, state, data, actions}

  defp settle(data), do: {:state_timeout, data.settled, :settled, abs: true}

  # Runs `work` with the database in a transaction: `{:ok, result}` once it's committed to the copy, or
  # `{:raised, kind, reason, stacktrace}` if it raised, with nothing kept. It's a savepoint, which is a transaction of
  # its own on a connection that's in none, and on the one that only reads, which is in one while a write is being
  # logged, a part of that. With `pinned`, that connection is put in one first, which keeps the copy as it was before.
  defp run(db, work, pinned \\ nil) do
    if pinned, do: pin(pinned)
    {:ok, _} = sqlite(db, "savepoint run")

    try do
      result = work.(db)
      with {:error, why} <- sqlite(db, "release run"), do: raise(why)
      {:ok, result}
    catch
      kind, reason ->
        {:ok, _} = sqlite(db, "rollback to run")
        {:ok, _} = sqlite(db, "release run")
        {:raised, kind, reason, __STACKTRACE__}
    end
  end

  # A read transaction begun on the connection that only reads keeps the copy as it is now for it, whatever's
  # committed after, until it ends: SQLite's write-ahead log keeps each reader's snapshot.
  defp pin(reader) do
    {:ok, _} = sqlite(reader, "begin")
    {:ok, _} = sqlite(reader, "select count(*) from sqlite_master")
  end

  defp unpin(reader), do: {:ok, _} = sqlite(reader, "commit")

  # The jobs and timers that are due at `now`: each one's name here, the time it was due at, and the job. A job is due
  # at each whole multiple of its `every` seconds, and the newest of those that passed is the one that's made up
  # for. One that's new is first due at the next. A timer is due at its `at` (`Database.timer/5`).
  defp due(db, jobs, now), do: jobs_due(db, jobs, now) ++ timers_due(db, now)

  defp timers_due(db, now) do
    Database.query(db, Database.timers())

    for %{"job" => job, "tool" => tool, "inputs" => inputs, "at" => at} <-
          Database.query(db, "select job, tool, inputs, at from database_timers where at <= ?", [now]),
        do: {"timer " <> job, at, %{tool: tool, inputs: JSON.decode!(inputs)}}
  end

  defp jobs_due(db, jobs, now) do
    Database.query(db, """
    create table if not exists database_scheduled (job text primary key, fired integer not null) without rowid
    """)

    fired = Map.new(Database.query(db, "select job, fired from database_scheduled"), &{&1["job"], &1["fired"]})

    Enum.flat_map(jobs, fn called ->
      job = "#{called.tool} #{JSON.encode!(called.inputs)}"
      at = div(now, called.every) * called.every

      case fired[job] do
        nil ->
          Database.query(db, "insert into database_scheduled (job, fired) values (?, ?)", [job, at])
          []

        fired when fired < at ->
          [{job, at, called}]

        _fired ->
          []
      end
    end)
  end

  # Marks a job as run for the time it was due at. If it's marked already, a server that held the lease
  # meanwhile made the call, and this one's writes aren't kept.
  defp mark(db, {"timer " <> job, at}) do
    # One that repeats is next due at the first of its times after now, and one that doesn't is done.
    repeated = """
    update database_timers set at = at + every * ((cast(strftime('%s', 'now') as integer) - at) / every + 1)
    where job = ? and at = ? and every is not null returning job
    """

    if Database.query(db, repeated, [job, at]) == [] and
         Database.query(db, "delete from database_timers where job = ? and at = ? and every is null returning job", [job, at]) == [],
       do: raise("Another server made this timer's call")
  end

  defp mark(db, {job, at}) do
    marked = "update database_scheduled set fired = ? where job = ? and fired < ? returning job"
    if Database.query(db, marked, [at, job, at]) == [], do: raise("Another server made this scheduled call")
  end

  # Reads the log: following the server it names, or settling with the database opened if it names this one. The
  # entry after the last it read was free when it read it, which is after it began. `reached` is called once the
  # bucket has answered its first read.
  defp look(data, reached \\ fn -> :ok end) do
    began = clocks()
    snapshot = Log.snapshot(data.artifact)
    reached.()
    entries = Log.since(data.artifact, snapshot)
    data = %{data | number: snapshot + length(entries)}

    case List.last(entries) || Log.entry(data.artifact, snapshot) do
      free when free in [nil, %{server: nil}] ->
        if OneCore.Server.up?() and not failed?(data),
          do: take(data, if(free, do: "handed_on", else: "free")),
          else: {{:following, nil}, %{data | followed: nil}}

      %{server: server} when server == data.server ->
        Logger.info("#{data.artifact.prefix}: holds its lease, from snapshot #{snapshot} and the log to #{data.number}")
        open(%{data | proved: began, followed: nil}, snapshot, entries)

      %{server: server} ->
        Logger.info("#{data.artifact.prefix}: its lease is held by #{server}")
        follow(data, server)
    end
  end

  # Follows `server`, which the log names as holding the lease, keeping when this server first read that it does, since
  # it last held it or followed nobody.
  defp follow(data, server) do
    case data.followed do
      {^server, _at} -> {{:following, server}, data}
      _other -> {{:following, server}, %{data | followed: {server, System.monotonic_time(:millisecond)}}}
    end
  end

  # How long, in milliseconds, `server`, which holds the lease, may still be settling, writing nothing (`opened/3`): it
  # began reading the log before it wrote the entry naming it, which this server read when it first followed it, so
  # it writes within `@writes_after` of then. A write passed to it waits that out there, as the call is queued, and is
  # given that long more before it's taken over from (`Database.transaction/3`): given only the time a holder that's up
  # runs one in, every server that had just taken the lease was taken over from by the next write passed to it, which
  # took it on to another, four servers in 17 s (backups, 24 Nov, after an update restarted every server).
  defp settles_in(%{followed: {server, at}}, server), do: max(at + @writes_after - System.monotonic_time(:millisecond), 0)
  defp settles_in(_data, _server), do: 0

  # Reads what was logged after the last entry it read, as the server it follows, `server`, didn't run a call passed on to
  # it, `why`: `:stopping` where this server is stopping, handed its lease on, and has a call it took before that still
  # to run, which no other server could (`Database.transaction/3`), `:cannot_run` where it answered that it would pass
  # it on in turn, `:unanswered` where neither this server nor another it asked reached it, and `:alone` where this one
  # couldn't and had no other to ask, or `:relayed` where the relay at the network's address still reached it meanwhile (`Database.transaction/3`). If it handed the lease on,
  # this server takes it; if the log names nobody after it, this server takes it, unless it's `:relayed` and that server
  # took it from this one; and otherwise it has learnt who holds it now. Only what was logged after the last entry it
  # read is read, which is one request. One that isn't up takes nothing, and says so. Gives `{answer, {state, looked}}`.
  defp taken(data, server, why, reached) do
    entries = Log.since(data.artifact, data.number)
    reached.()
    data = %{data | number: data.number + length(entries)}
    kept = {{:following, server}, data}

    case List.last(entries) do
      _free when not is_nil(server) and entries == [] ->
        cond do
          not OneCore.Server.up?() ->
            {:not_up, kept}

          failed?(data) ->
            {:failed, kept}

          why == :relayed and data.lost_to == server ->
            {:connected, kept}

          true ->
            Logger.info("#{data.artifact.prefix}: #{server}, which holds its lease, didn't run a call passed to it")
            {:ok, take(data, "unanswered")}
        end

      free when free in [nil, %{server: nil}] ->
        cond do
          not OneCore.Server.up?() and why != :stopping -> {:not_up, kept}
          failed?(data) -> {:failed, kept}
          true -> {:ok, take(data, if(free, do: "handed_on", else: "free"))}
        end

      %{server: holder} when holder != data.server ->
        Logger.info("#{data.artifact.prefix}: its lease is held by #{holder}")
        {:ok, follow(data, holder)}

      _this ->
        {:ok, look(data)}
    end
  end

  # Writing the log's next entry is taking the lease. If another server wrote it first, the lease is theirs. A lease
  # this server took is said as a number of its app's, with why: `free`, as nobody held it, `handed_on`, as its holder
  # stopped and said so, or `unanswered`, as its holder didn't run a call passed to it (Telemetry's
  # `one.database.lease.moves`).
  defp take(data, why) do
    wrote = Log.write(data.artifact, data.number + 1, %{server: data.server})
    Logger.info("#{data.artifact.prefix}: taking its lease at #{data.number + 1}: #{wrote}")
    if wrote == :ok, do: Counter.add(:"one.database.lease.moves", 1, %{"one.app" => app(data.artifact), "one.reason" => why})
    look(data)
  end

  @doc """
  Makes what a lease is measured by, OpenTelemetry's instruments, where they aren't yet: how long a call waited on
  another server holding it (`Database.transaction/3`), and how often it moved here. A meter that can't say which it
  has, as the API's own with no SDK, in an untrusted app's sandbox, has them made, which makes nothing.
  """
  def measures do
    {module, _} = meter = :opentelemetry_experimental.get_meter(:opentelemetry.get_application_scope(__MODULE__))

    if not function_exported?(module, :lookup_instrument, 2) or
         :otel_meter.lookup_instrument(meter, :"one.database.lease.moves") == :undefined do
      Counter.create(:"one.database.lease.moves", %{description: "A database's lease that moved to this server, and why"})

      Histogram.create(:"one.database.lease.wait", %{
        unit: :ms,
        description: "How long a call waited on the server holding its database's lease before this one took it",
        advisory_params: %{explicit_bucket_boundaries: OneCore.Otlp.buckets()}
      })
    end
  end

  @doc "Says how long a call waited on another server holding its database's lease, in milliseconds."
  def waited(ms, attributes), do: Histogram.record(:"one.database.lease.wait", ms, attributes)

  @doc "The app whose database `artifact` is, by the name it's installed by: `permissions` of `network/own/permissions/`."
  def app(artifact) do
    case Regex.run(~r{(?:^|/)(?:own|apps)/([^/]+)}, artifact.prefix) do
      [_, app] -> app
      nil -> artifact.prefix
    end
  end

  # The copy is made anew each time: one left by an earlier run may hold what was never in the bucket. One this server
  # can't make, as one out of files can't, has its lease handed on (`failed/4`).
  defp open(data, snapshot, entries) do
    File.rm_rf!(data.folder)
    File.mkdir_p!(data.folder)

    case Log.restore(data.artifact, snapshot, entries, file(data)) do
      :ok -> {:settling, opened(data, snapshot, entries)}
      :gone -> look(data)
    end
  rescue
    unreachable in OneCore.Edge.Unreachable -> reraise unreachable, __STACKTRACE__
    error -> {{:following, nil}, hand_on_failed(data, error)}
  end

  # It writes nothing for `@writes_after` from when it began reading the log (`proved`), by when one that held the
  # lease before and doesn't know it lost it has stopped answering from its copy (`proved/1`): that one last saw the
  # entry naming this server free before it was written, which was before this began. Until then its copy is
  # read-only. The monotonic clock stops while the machine sleeps, which only makes it wait longer. A new database,
  # whose log is only this server taking its lease, has nothing anyone could answer from, so it writes at once, as
  # does one whose last holder handed it on, which it did once it answered nothing more.
  defp opened(%{proved: {began, _system}} = data, snapshot, entries) do
    logged = Enum.sum_by(entries, &max(length(Map.get(&1, :pages, [])), 1))

    wait =
      case Enum.take(entries, -2) do
        [%{server: nil}, %{server: server}] when server == data.server -> 0
        [%{server: server}] when server == data.server and snapshot == 0 -> 0
        _held -> @writes_after
      end

    db = connected(file(data))
    {:ok, _} = sqlite(db, "pragma query_only = on")
    %{data | db: db, reader: reader(file(data)), logged: logged, settled: began + wait}
  end

  # The copy's second connection, which only reads: what's answered while a write is being logged.
  defp reader(file) do
    reader = connected(file)
    {:ok, _} = sqlite(reader, "pragma query_only = on")
    reader
  end

  # The bucket is what keeps a write, so SQLite needn't wait for the disk. Its write-ahead log is emptied here
  # after each transaction, never by SQLite itself.
  defp connected(file) do
    {:ok, db} = Sqlite.open(file)
    db = {Sqlite, db}

    for pragma <- ["journal_mode = wal", "synchronous = off", "wal_autocheckpoint = 0"],
        do: {:ok, _} = sqlite(db, "pragma " <> pragma)

    db
  end

  defp sqlite({sqlite, db}, sql), do: sqlite.query(db, sql, [])

  # Logs what the transaction `event` changed, which SQLite's write-ahead log holds, as the log's next entry, in a
  # process of its own, which answers `:ok`, `:exists` where another server wrote that entry first, or `{:unreached,
  # why}`; and the transaction is answered once it's there. One the bucket hasn't answered within `@written_within`
  # is refused. What it proves of the lease is from when it began.
  defp write(event, ran, data, {size, pages}) do
    began = clocks()
    {artifact, number, entry} = {data.artifact, data.number + 1, %{server: data.server, size: size, pages: pages}}

    task =
      Task.async(fn ->
        try do
          Log.write(artifact, number, entry)
        catch
          kind, reason -> {:unreached, Exception.format_banner(kind, reason)}
        end
      end)

    writing = %{task: task, event: event, ran: ran, began: began, size: size, pages: length(pages)}
    within = @written_within + div(Enum.sum_by(pages, &byte_size(elem(&1, 1))), 1000)
    {:next_state, :writing, %{data | writing: writing}, {{:timeout, :written}, within, nil}}
  end

  # The write being logged is given up on, and its transaction, `{event, data}`: whatever it sent may still get there,
  # which only the log says.
  defp abandon(%{writing: nil} = data), do: {nil, data}

  defp abandon(%{writing: writing} = data) do
    Task.shutdown(writing.task, :brutal_kill)
    {writing.event, %{data | writing: nil}}
  end

  # A server that couldn't reach this one may have taken the lease by writing the log's next entry, and this one
  # only finds out by looking. So it answers from its copy for `@lease_ttl` after it last saw that entry free, by
  # both its clocks, the monotonic one, which never goes back, and the system's, which goes on while the machine
  # sleeps; and then looks again. A server that took the lease meanwhile writes nothing until that's passed.
  #
  # It looks in the background while the database is in use (`renew/1`), so this most often finds it seen free
  # already. Where it isn't, a look is begun, unless one is under way, and waited for until `@renew_within` after it
  # began: one begun in the background a moment ago, as a database that has just settled has one begun with its lease
  # run out, is waited for, and one the bucket hasn't answered for that long isn't. The call isn't kept waiting where
  # the last look couldn't read the bucket.
  defp proved(data) do
    if proved?(data.proved, clocks()) do
      {:ok, data}
    else
      %{renewing: {task, began}} = data = renew(data)
      waits = if data.unreached, do: 0, else: max(began + @renew_within - System.monotonic_time(:millisecond), 0)

      case Task.yield(task, waits) do
        {:ok, renewal} ->
          with {:ok, data} <- renewed(renewal, %{data | renewing: nil}) do
            if proved?(data.proved, clocks()),
              do: {:ok, data},
              else: {:unreached, data, "the bucket was slow to answer"}
          end

        nil ->
          waited = System.monotonic_time(:millisecond) - began
          {:unreached, data, data.unreached || "the bucket hasn't answered for #{waited} ms"}
      end
    end
  end

  # Looks at the log's next entry in a process of its own, unless it's being looked at already: `renewing` is that
  # task and when it began, by the monotonic clock, and it answers with when it began by both clocks, the number of
  # the last entry this server had read, and the entry, `{:unreached, why}` where the bucket couldn't be read.
  defp renew(%{renewing: nil, artifact: artifact, number: number} = data) do
    began = clocks()

    task =
      Task.async(fn ->
        try do
          {began, number, Log.entry(artifact, number + 1)}
        catch
          kind, reason -> {began, number, {:unreached, Exception.format_banner(kind, reason)}}
        end
      end)

    %{data | renewing: {task, elem(began, 0)}}
  end

  defp renew(data), do: data

  # What a look at the log found: the entry after the last this server read free, which proves the lease from when
  # it began, or written by another server, which took it. One begun before this server wrote that entry itself is
  # older than what the write proved.
  defp renewed({_began, _number, {:unreached, why}}, data), do: {:unreached, %{data | unreached: why}, why}
  defp renewed({_began, number, _entry}, %{number: now} = data) when number != now, do: {:ok, %{data | unreached: nil}}
  defp renewed({began, _number, nil}, data), do: {:ok, %{data | proved: began, unreached: nil}}
  # This server's own write, being logged, which proves the lease once it's answered.
  defp renewed({_began, _number, %{server: server}}, %{server: server, writing: %{}} = data), do: {:ok, %{data | unreached: nil}}
  defp renewed({_began, _number, _taken}, data), do: {:lost, %{data | unreached: nil}}

  defp proved?({monotonic, system}, {now_monotonic, now_system}),
    do: now_monotonic < monotonic + @lease_ttl and now_system >= system and now_system < system + @lease_ttl

  defp proved?(nil, _now), do: false

  defp clocks, do: {System.monotonic_time(:millisecond), System.os_time(:millisecond)}

  # A snapshot is kept once the log since the last one holds as many pages as the database, and at least `@least`,
  # after a transaction that didn't raise, in a process of its own: nothing waits for it, as the log is whole without
  # it, and one that fails is only a longer log to read for whoever opens the database next.
  defp snapshot(%{logged: logged, pages: pages} = data, {:ok, _result}) when logged >= pages and logged >= @least do
    {prefix, artifact, number, copy} = {data.artifact.prefix, data.artifact, data.number, File.read!(file(data))}

    Task.start(fn ->
      try do
        Log.keep(artifact, number, copy)
        Logger.info("#{prefix}: kept snapshot #{number}")
      catch
        kind, reason -> Logger.warning("#{prefix}: didn't keep snapshot #{number}: #{Exception.format_banner(kind, reason)}")
      end
    end)

    %{data | logged: 0}
  end

  defp snapshot(data, _ran), do: data

  # Moves the write-ahead log's pages into the database file, and empties it for the next transaction.
  defp checkpoint(db) do
    {:ok, [%{"busy" => 0}]} = sqlite(db, "pragma wal_checkpoint(truncate)")
  end

  defp close(%{db: nil} = data), do: data

  defp close(%{db: {sqlite, db}} = data) do
    sqlite.close(db)
    with {sqlite, reader} <- data.reader, do: sqlite.close(reader)
    File.rm_rf!(data.folder)
    %{data | db: nil, reader: nil}
  end

  defp file(data), do: Path.join(data.folder, "copy.sqlite")

  # The schema's statements this database hasn't run, which SQLite's `user_version` counts.
  defp migrate(db, schema) do
    [%{"user_version" => ran}] = Database.query(db, "pragma user_version")

    if length(schema) > ran do
      for statement <- Enum.drop(schema, ran), do: Database.query(db, statement)
      Database.query(db, "pragma user_version = #{length(schema)}")
    end
  end
end
