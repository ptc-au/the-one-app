defmodule Board.Store do
  @moduledoc """
  Board's SQLite schema and pure data helpers: channel/label/profile validation, reaction normalization, fenced
  structured-data schema block parsing and validation (`ExJsonSchema`), DAG cycle detection, and lease hashing.
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
    "create index schedules_by_due on schedules (next_run_at)"
  ]

  @channel_re ~r"\A[a-z0-9_-]+(?:/[a-z0-9_-]+)*\z"
  @profile_re ~r"\A[A-Za-z][A-Za-z0-9-]{0,31}\z"
  @label_key_re ~r"\A[a-z0-9][a-z0-9_.-]{0,63}\z"
  @schema_name_re ~r"\A([a-z][a-z0-9-]{0,63})@([1-9][0-9]*)\z"
  @block_re ~r/```json#([a-z][a-z0-9-]*@[1-9][0-9]*)\r?\n([\s\S]*?)```/

  @emoji_aliases %{
    "+1" => "thumbs_up",
    "👍" => "thumbs_up",
    "-1" => "thumbs_down",
    "👎" => "thumbs_down",
    "white_check_mark" => "check",
    "✅" => "check",
    "👀" => "eyes",
    "🔥" => "fire",
    "🚀" => "rocket",
    "🎉" => "tada",
    "❤️" => "heart",
    "❤" => "heart",
    "🙏" => "pray",
    "⚠️" => "warning",
    "⚠" => "warning"
  }

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

  @doc "Expires any claimed tasks whose lease has elapsed, returning the newly ready task IDs."
  def expire_leases(db) do
    now = now_ms()
    iso = now_iso()

    expired =
      query(db, "select root_id from tasks where state = 'claimed' and lease_until is not null and lease_until <= ?", [now])

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

      set_board_task_label(db, root_id, "ready")
    end

    Enum.map(expired, & &1["root_id"])
  end

  def set_board_task_label(db, root_id, state) do
    query(db, "insert or replace into labels (message_id, key, value) values (?, 'board.task', ?)", [root_id, state])
  end

  @doc "Returns true if adding `task_id -> needs_id` would create a cycle in `task_deps`."
  def creates_cycle?(db, task_id, needs_id) do
    task_id == needs_id or reachable?(db, needs_id, task_id, MapSet.new())
  end

  defp reachable?(_db, current, target, _visited) when current == target, do: true

  defp reachable?(db, current, target, visited) do
    if MapSet.member?(visited, current) do
      false
    else
      visited = MapSet.put(visited, current)
      nexts = query(db, "select needs_id from task_deps where task_id = ?", [current]) |> Enum.map(& &1["needs_id"])
      Enum.any?(nexts, &reachable?(db, &1, target, visited))
    end
  end

  @doc "Checks whether every prerequisite of `task_id` is completed."
  def deps_satisfied?(db, task_id) do
    case query(
           db,
           """
           select count(*) as n from task_deps d
           join tasks t on t.root_id = d.needs_id
           where d.task_id = ? and t.state != 'completed'
           """,
           [task_id]
         ) do
      [%{"n" => 0}] -> true
      _ -> false
    end
  end

  @doc "Transitions any `waiting` tasks that depended on `completed_id` to `ready` if all deps are met."
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

    for id <- candidates, deps_satisfied?(db, id) do
      query(db, "update tasks set state = 'ready', updated_at = ? where root_id = ?", [iso, id])
      set_board_task_label(db, id, "ready")
      id
    end
  end

  def labels_for(db, message_id) do
    query(db, "select key, value from labels where message_id = ? order by key", [message_id])
    |> Map.new(fn %{"key" => k, "value" => v} -> {k, v} end)
  end

  def reactions_for(db, message_id) do
    query(db, "select emoji, actor, profile from reactions where message_id = ? order by emoji, actor", [message_id])
    |> Enum.group_by(& &1["emoji"], fn %{"actor" => actor, "profile" => profile} -> display_author(actor, profile) end)
    |> Enum.map(fn {emoji, actors} -> %{emoji: emoji, count: length(actors), by: actors} end)
  end

  def deps_for(db, root_id) do
    query(db, "select needs_id from task_deps where task_id = ? order by needs_id", [root_id])
    |> Enum.map(& &1["needs_id"])
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
        %{
          state: state,
          owner: oa,
          owner_display: display_author(oa, op),
          assigned_profile: ap,
          epoch: epoch,
          claimed_by: if(cba, do: display_author(cba, cbp)),
          lease_until: lease,
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
        "no_sync" => no_sync,
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
        revision: rev,
        no_sync: no_sync == 1,
        created_at: created_at,
        edited_at: edited_at
      }
    end
  end
end
