defmodule Board.Store do
  @moduledoc """
  Board's SQLite schema and pure data helpers: channel/label/profile validation, reaction normalization, fenced
  structured-data schema block parsing and validation (`ExJsonSchema`), and lease hashing.
  """

  alias OneCore.Call

  @schema [
    """
    create table messages (
      id text primary key,
      channel text not null,
      root_id text,
      reply_to text,
      author text not null,
      profile text,
      body text not null,
      blocks text not null default '[]',
      revision integer not null default 1,
      no_sync integer not null default 0,
      created_at text not null,
      edited_at text,
      deleted_at text
    )
    """,
    "create index messages_by_channel on messages (channel, root_id, created_at)",
    "create index messages_by_root on messages (root_id, created_at)",
    """
    create table labels (
      message_id text not null,
      key text not null,
      value text not null,
      primary key (message_id, key)
    ) without rowid
    """,
    "create index labels_by_kv on labels (key, value)",
    """
    create table reactions (
      message_id text not null,
      actor text not null,
      profile text not null default '',
      emoji text not null,
      primary key (message_id, actor, profile, emoji)
    ) without rowid
    """,
    """
    create table tasks (
      root_id text primary key,
      state text not null,
      owner_actor text not null,
      owner_profile text,
      assigned_profile text,
      claim_epoch integer not null default 0,
      claim_token_hash text,
      claimed_by_actor text,
      claimed_by_profile text,
      lease_until integer,
      block_kind text,
      result text,
      updated_at text not null
    )
    """,
    "create index tasks_by_state on tasks (state, updated_at)",
    """
    create table task_deps (
      task_id text not null,
      needs_id text not null,
      primary key (task_id, needs_id)
    ) without rowid
    """,
    "create index task_deps_by_needs on task_deps (needs_id)",
    """
    create table schemas (
      name text primary key,
      description text not null default '',
      definition text not null,
      created_by text not null,
      created_at text not null
    )
    """,
    """
    create table schedules (
      id text primary key,
      target text not null,
      body text not null,
      author text not null,
      profile text,
      no_sync integer not null default 0,
      next_run_at integer not null,
      every_ms integer,
      until_at integer,
      remaining integer,
      sent_count integer not null default 0,
      created_at text not null
    )
    """,
    "create index schedules_by_due on schedules (next_run_at)",
    """
    create table attachments (
      id text primary key,
      message_id text not null,
      blob text not null,
      name text not null,
      mime_type text not null,
      size integer not null,
      created_at text not null
    )
    """,
    "create index attachments_by_message on attachments (message_id, created_at)",
    "alter table schedules add column failed text"
  ]

  @channel_re ~r"\A[a-z0-9_-]+(?:/[a-z0-9_-]+)*\z"
  @profile_re ~r"\A[A-Za-z][A-Za-z0-9-]{0,31}\z"
  @label_key_re ~r"\A[a-z0-9][a-z0-9_.-]{0,63}\z"
  @schema_name_re ~r"\A([a-z][a-z0-9-]{0,63})@([1-9][0-9]*)\z"
  @block_re ~r/```json#([a-z][a-z0-9-]*@[1-9][0-9]*)\r?\n([\s\S]*?)```/

  # A reaction is kept by a name, and shown and sent as its emoji: Google Chat, a person's screen and an agent each take the
  # emoji itself. What isn't named here is kept, and shown, as it was given.
  @glyphs %{
    "thumbs_up" => "👍",
    "thumbs_down" => "👎",
    "check" => "✅",
    "eyes" => "👀",
    "fire" => "🔥",
    "rocket" => "🚀",
    "tada" => "🎉",
    "heart" => "❤️",
    "pray" => "🙏",
    "warning" => "⚠️"
  }

  @emoji_aliases Map.merge(
                   Map.new(@glyphs, fn {name, glyph} -> {glyph, name} end),
                   %{"+1" => "thumbs_up", "-1" => "thumbs_down", "white_check_mark" => "check", "❤" => "heart", "⚠" => "warning"}
                 )

  def schema, do: @schema

  def transaction(call, fun) do
    database = Call.app(call, "database")
    database.transaction(call, @schema, &fun.({database, &1}))
  end

  def query({database, db}, sql, values \\ []), do: database.query(db, sql, values)

  def now_ms, do: System.system_time(:millisecond)
  def now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
  def new_id(prefix), do: prefix <> "_" <> Base.url_encode64(:crypto.strong_rand_bytes(9), padding: false)
  def new_token, do: Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false)
  def hash_token(token), do: :crypto.hash(:sha256, token) |> Base.encode16(case: :lower)

  def validate_channel(channel) when is_binary(channel) do
    clean = String.trim_trailing(channel, "/")

    if byte_size(clean) in 1..2048 and Regex.match?(@channel_re, clean),
      do: {:ok, clean},
      else: {:error, "Channel must be lowercase letters, digits, _ or - separated by / (e.g. dev, work/checkout)."}
  end

  def validate_channel(_), do: {:error, "Channel is required."}

  def validate_profile(nil), do: {:ok, nil}
  def validate_profile(""), do: {:ok, nil}

  def validate_profile(profile) when is_binary(profile) do
    if Regex.match?(@profile_re, profile),
      do: {:ok, profile},
      else: {:error, "Profile must start with a letter and use up to 32 letters, digits, or hyphens."}
  end

  def validate_profile(_), do: {:error, "Profile must be a string."}

  def validate_body(body) when is_binary(body) do
    if byte_size(body) in 1..10_000,
      do: {:ok, body},
      else: {:error, "Message body must be between 1 and 10,000 bytes."}
  end

  def validate_body(_), do: {:error, "Message body is required."}

  def validate_label_key(key) when is_binary(key) do
    cond do
      String.starts_with?(key, "board.") -> {:error, "Labels under board. are reserved."}
      Regex.match?(@label_key_re, key) -> :ok
      true -> {:error, "Label key #{inspect(key)} must be lowercase letters, digits, _, . or - (max 64 chars)."}
    end
  end

  def validate_label_key(_), do: {:error, "Label key must be a string."}

  def validate_label_value(val) when is_binary(val) do
    if byte_size(val) <= 256 and not String.contains?(val, ["\n", "\r", "\0"]),
      do: :ok,
      else: {:error, "Label value must be at most 256 bytes with no newlines."}
  end

  def validate_label_value(_), do: {:error, "Label value must be a string."}

  def validate_schema_name(name) when is_binary(name) do
    case Regex.run(@schema_name_re, name) do
      [_, base, ver] -> {:ok, base, String.to_integer(ver)}
      nil -> {:error, "Schema name must be <name>@<version> (e.g. security-finding@1)."}
    end
  end

  def validate_schema_name(_), do: {:error, "Schema name is required."}

  def normalize_emoji(emoji) when is_binary(emoji) do
    trimmed = emoji |> String.trim() |> String.trim(":")
    normalized = Map.get(@emoji_aliases, trimmed, trimmed)

    if byte_size(normalized) in 1..64,
      do: {:ok, normalized},
      else: {:error, "Emoji must be 1 to 64 characters."}
  end

  def normalize_emoji(_), do: {:error, "Emoji is required."}

  @doc "The emoji a reaction's `name` is, or the name itself where it isn't one of ours."
  def glyph(name), do: Map.get(@glyphs, name, name)

  def display_author(author, nil), do: short_actor(author)
  def display_author(author, ""), do: short_actor(author)
  def display_author(author, profile), do: "#{profile} via #{short_actor(author)}"

  def short_actor("users/" <> name), do: name
  def short_actor("groups/" <> name), do: name
  def short_actor(other) when is_binary(other), do: other
  def short_actor(_), do: "system"

  @doc """
  Parses every fenced ` ```json#<name>@<version> ` block in `body` and validates each against the registered JSON
  Schema in SQLite. Returns `{:ok, blocks}` or `{:error, why}`.
  """
  def parse_and_validate_blocks(db, body) do
    matches = Regex.scan(@block_re, body)

    Enum.reduce_while(matches, {:ok, []}, fn [_, schema_name, raw_json], {:ok, acc} ->
      with {:ok, base, version} <- validate_schema_name(schema_name),
           {:ok, data} <- decode_object(raw_json, schema_name),
           {:ok, definition} <- fetch_schema(db, schema_name),
           :ok <- validate_against(definition, data, schema_name) do
        {:cont, {:ok, acc ++ [%{"schema" => base, "version" => version, "data" => data}]}}
      else
        {:error, why} -> {:halt, {:error, why}}
      end
    end)
  end

  defp decode_object(raw_json, schema_name) do
    case JSON.decode(raw_json) do
      {:ok, %{} = map} -> {:ok, map}
      {:ok, _} -> {:error, "Block #{schema_name} must be a JSON object."}
      {:error, _} -> {:error, "Block #{schema_name} contains invalid JSON."}
    end
  end

  defp fetch_schema(db, schema_name) do
    case query(db, "select definition from schemas where name = ?", [schema_name]) do
      [%{"definition" => raw}] -> {:ok, JSON.decode!(raw)}
      [] -> {:error, "Schema #{schema_name} is not registered. Register it with schemas_create first."}
    end
  end

  defp validate_against(definition, data, schema_name) do
    resolved = ExJsonSchema.Schema.resolve(definition)

    case ExJsonSchema.Validator.validate(resolved, data) do
      :ok ->
        :ok

      {:error, errors} ->
        details = Enum.map_join(errors, "; ", fn {msg, path} -> "#{path}: #{msg}" end)
        {:error, "Block #{schema_name} failed schema validation: #{details}"}
    end
  rescue
    e -> {:error, "Schema #{schema_name} validation error: #{Exception.message(e)}"}
  end

  @doc """
  A task's state as it stands now: a claimed task whose lease has run out is ready again, whether or not
  `expire_leases` has written that yet, so a read never has to.
  """
  def effective_state("claimed", lease_until), do: if(is_integer(lease_until) and lease_until <= now_ms(), do: "ready", else: "claimed")
  def effective_state(state, _lease_until), do: state

  @doc "The same as `effective_state/2`, for a query over `tasks` as `t`."
  def state_sql do
    "(case when t.state = 'claimed' and t.lease_until <= #{now_ms()} then 'ready' else t.state end)"
  end

  @doc "Expires any claimed tasks whose lease has elapsed, returning details of the newly ready tasks."
  def expire_leases(db) do
    now = now_ms()
    iso = now_iso()

    expired =
      query(
        db,
        """
        select t.root_id, m.channel, m.body, t.owner_actor, t.assigned_profile
        from tasks t join messages m on m.id = t.root_id
        where t.state = 'claimed' and t.lease_until is not null and t.lease_until <= ?
        """,
        [now]
      )

    for %{"root_id" => root_id} <- expired do
      query(
        db,
        """
        update tasks
        set state = 'ready', claim_token_hash = null, claimed_by_actor = null,
            claimed_by_profile = null, lease_until = null, updated_at = ?
        where root_id = ?
        """,
        [iso, root_id]
      )
    end

    for %{"root_id" => id, "channel" => ch, "body" => body, "owner_actor" => owner, "assigned_profile" => assigned} <- expired do
      %{id: id, channel: ch, body: body, owner: owner, assigned_profile: assigned}
    end
  end

  @doc """
  What a task with these prerequisites is: `ready` once every one is completed, `blocked` while one failed or was
  canceled, which only a person clears (reopening it), and else `waiting`.
  """
  def state_for(db, needs) do
    states = for dep <- needs, %{"state" => state} <- query(db, "select state from tasks where root_id = ?", [dep]), do: state

    cond do
      Enum.any?(states, &(&1 in ["failed", "canceled"])) -> "blocked"
      Enum.all?(states, &(&1 == "completed")) -> "ready"
      true -> "waiting"
    end
  end

  @doc "Moves any `waiting` tasks that depended on `completed_id` to `ready` if all deps are met."
  def ready_dependents(db, completed_id) do
    iso = now_iso()

    candidates =
      query(
        db,
        """
        select t.root_id from task_deps d
        join tasks t on t.root_id = d.task_id
        where d.needs_id = ? and t.state = 'waiting'
        """,
        [completed_id]
      )
      |> Enum.map(& &1["root_id"])

    for id <- candidates, state_for(db, deps_for(db, id)) == "ready" do
      query(db, "update tasks set state = 'ready', updated_at = ? where root_id = ?", [iso, id])
      id
    end
  end

  @doc """
  Holds the `waiting` tasks that need `failed_id`, which failed or was canceled, as `blocked` (kind `needs_failed_task`),
  so they're a person's to clear and not waiting for good. Gives each one's id, channel, body and owner.
  """
  def block_dependents(db, failed_id) do
    iso = now_iso()

    waiting =
      query(
        db,
        """
        select t.root_id as id, m.channel, m.body, t.owner_actor as owner
        from task_deps d
        join tasks t on t.root_id = d.task_id
        join messages m on m.id = t.root_id
        where d.needs_id = ? and t.state = 'waiting'
        """,
        [failed_id]
      )

    for %{"id" => id, "channel" => channel, "body" => body, "owner" => owner} <- waiting do
      query(db, "update tasks set state = 'blocked', block_kind = 'needs_failed_task', updated_at = ? where root_id = ?", [iso, id])
      %{id: id, channel: channel, body: body, owner: owner}
    end
  end

  @doc "Puts back to `waiting` the tasks that `block_dependents` held for `reopened_id`, and whose other prerequisites hold no failed one. Gives each one's id and channel."
  def unblock_dependents(db, reopened_id) do
    iso = now_iso()

    for %{"id" => id, "channel" => channel} <-
          query(
            db,
            """
            select t.root_id as id, m.channel from task_deps d
            join tasks t on t.root_id = d.task_id
            join messages m on m.id = t.root_id
            where d.needs_id = ? and t.state = 'blocked' and t.block_kind = 'needs_failed_task'
            """,
            [reopened_id]
          ),
        state_for(db, deps_for(db, id)) != "blocked" do
      query(db, "update tasks set state = 'waiting', block_kind = null, updated_at = ? where root_id = ?", [iso, id])
      %{id: id, channel: channel}
    end
  end

  def labels_for(db, message_id) do
    query(db, "select key, value from labels where message_id = ? order by key", [message_id])
    |> Map.new(fn %{"key" => k, "value" => v} -> {k, v} end)
  end

  def reactions_for(db, message_id) do
    query(db, "select emoji, actor, profile from reactions where message_id = ? order by emoji, actor", [message_id])
    |> Enum.group_by(& &1["emoji"], fn %{"actor" => actor, "profile" => profile} -> display_author(actor, profile) end)
    |> Enum.map(fn {emoji, actors} -> %{emoji: emoji, glyph: glyph(emoji), count: length(actors), by: actors} end)
  end

  def deps_for(db, root_id) do
    query(db, "select needs_id from task_deps where task_id = ? order by needs_id", [root_id])
    |> Enum.map(& &1["needs_id"])
  end

  def attachments_for(db, message_id) do
    for %{"id" => id, "name" => name, "mime_type" => mime, "size" => sz, "created_at" => at} <-
          query(db, "select id, name, mime_type, size, created_at from attachments where message_id = ? order by created_at asc", [message_id]) do
      %{id: id, name: name, mime_type: mime, size: sz, created_at: at}
    end
  end

  def task_row(db, root_id) do
    case query(
           db,
           """
           select state, owner_actor, owner_profile, assigned_profile, claim_epoch,
                  claimed_by_actor, claimed_by_profile, lease_until, block_kind, result, updated_at
           from tasks where root_id = ?
           """,
           [root_id]
         ) do
      [
        %{
          "state" => state,
          "owner_actor" => oa,
          "owner_profile" => op,
          "assigned_profile" => ap,
          "claim_epoch" => epoch,
          "claimed_by_actor" => cba,
          "claimed_by_profile" => cbp,
          "lease_until" => lease,
          "block_kind" => bk,
          "result" => res,
          "updated_at" => updated
        }
      ] ->
        lapsed = effective_state(state, lease) != state

        %{
          state: effective_state(state, lease),
          owner: oa,
          owner_display: display_author(oa, op),
          assigned_profile: ap,
          epoch: epoch,
          claimed_by: if(cba && not lapsed, do: display_author(cba, cbp)),
          lease_until: if(not lapsed, do: lease),
          block_kind: bk,
          result: res,
          needs: deps_for(db, root_id),
          updated_at: updated
        }

      [] ->
        nil
    end
  end

  def format_message(db, %{
        "id" => id,
        "channel" => channel,
        "root_id" => root_id,
        "reply_to" => reply_to,
        "author" => author,
        "profile" => profile,
        "body" => body,
        "blocks" => blocks_raw,
        "revision" => rev,
        "created_at" => created_at,
        "edited_at" => edited_at,
        "deleted_at" => deleted_at
      }) do
    if deleted_at do
      %{
        id: id,
        channel: channel,
        root_id: root_id,
        reply_to: reply_to,
        author: author,
        profile: profile,
        display_author: display_author(author, profile),
        deleted: true,
        revision: rev,
        created_at: created_at,
        deleted_at: deleted_at
      }
    else
      %{
        id: id,
        channel: channel,
        root_id: root_id,
        reply_to: reply_to,
        author: author,
        profile: profile,
        display_author: display_author(author, profile),
        body: body,
        blocks: JSON.decode!(blocks_raw),
        labels: labels_for(db, id),
        reactions: reactions_for(db, id),
        attachments: attachments_for(db, id),
        revision: rev,
        created_at: created_at,
        edited_at: edited_at
      }
    end
  end
end
