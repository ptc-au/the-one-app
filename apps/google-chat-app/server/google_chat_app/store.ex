defmodule GoogleChatApp.Store do
  @moduledoc """
  Google Chat App's SQLite schema, and the rows it keeps for whoever it's installed for: what the network set it up
  with, the Workspace Events subscription of each space it watches and whose its events are, and the events it has
  already handled, so one Google sends twice is followed once.
  """
  alias OneCore.Call

  @schema [
    "create table config (name text primary key, value text not null)",
    "create table subscriptions (space text primary key, name text not null unique, expire_time text, created_at text not null)",
    "create table watchers (space text not null, owner text not null, primary key (space, owner)) without rowid",
    "create table seen_events (id text primary key, seen_at integer not null)",
    "create index seen_events_by_seen_at on seen_events (seen_at)",
    "alter table subscriptions add column last_event_at text"
  ]

  # How long an event is remembered, and how many at most: Pub/Sub sends one twice now and then, and the table never
  # grows without end.
  @seen_for 7 * 24 * 60 * 60 * 1000
  @seen_most 10_000

  def transaction(call, fun) do
    database = Call.app(call, "database")
    database.transaction(call, @schema, &fun.({database, &1}))
  end

  def query({database, db}, sql, values \\ []), do: database.query(db, sql, values)

  @doc "What it's set up with, each value by its name: `vault_item`, `pubsub_topic`, `display_name` and `webhook_path`."
  def config(call) do
    transaction(call, fn db ->
      for %{"name" => name, "value" => value} <- query(db, "select name, value from config"), into: %{}, do: {name, value}
    end)
  end

  @doc "Keeps `values` by name, or forgets those whose value is nil or empty."
  def save_config(call, values) do
    transaction(call, fn db ->
      for {name, value} <- values, do: put_value(db, name, value)
    end)
  end

  defp put_value(db, name, value) when value in [nil, ""],
    do: query(db, "delete from config where name = ?", [name])

  defp put_value(db, name, value),
    do: query(db, "insert into config (name, value) values (?, ?) on conflict (name) do update set value = excluded.value", [name, value])

  @doc "Every space it watches, by its name."
  def subscriptions(call) do
    transaction(call, fn db ->
      for row <- query(db, "select space, name, expire_time, last_event_at from subscriptions order by space"), do: row(row)
    end)
  end

  @doc "The subscription watching `space`, or nil where there's none."
  def subscription(call, space) do
    transaction(call, fn db ->
      case query(db, "select space, name, expire_time, last_event_at from subscriptions where space = ?", [space]) do
        [row] -> row(row)
        [] -> nil
      end
    end)
  end

  defp row(%{"space" => space, "name" => name, "expire_time" => expire, "last_event_at" => last_event_at}),
    do: %{space: space, subscription: name, expire_time: expire, last_event_at: last_event_at}

  @doc "Records when `subscription` last delivered an event."
  def touch_event(call, name) when is_binary(name) do
    transaction(call, fn db ->
      query(db, "update subscriptions set last_event_at = ? where name = ?", [DateTime.utc_now() |> DateTime.to_iso8601(), name])
    end)
  end

  def touch_event(_call, _name), do: :ok

  @doc "Keeps a space's subscription, and when it expires."
  def save_subscription(call, %{space: space, subscription: name, expire_time: expire}) do
    transaction(call, fn db ->
      query(
        db,
        "insert into subscriptions (space, name, expire_time, created_at) values (?, ?, ?, ?) " <>
          "on conflict (space) do update set name = excluded.name, expire_time = excluded.expire_time",
        [space, name, expire, DateTime.utc_now() |> DateTime.to_iso8601()]
      )
    end)
  end

  @doc "Forgets the subscription watching `space`, and whose its events were."
  def remove_subscription(call, space) do
    transaction(call, fn db ->
      query(db, "delete from watchers where space = ?", [space])
      query(db, "delete from subscriptions where space = ?", [space])
    end)
  end

  @doc "Keeps that `space`'s events are for `owner` too, a user, a group or the network."
  def add_watcher(call, space, owner),
    do: transaction(call, fn db -> query(db, "insert or ignore into watchers (space, owner) values (?, ?)", [space, owner]) end)

  @doc "Stops `space`'s events being for `owner`, and says whether they were."
  def remove_watcher(call, space, owner) do
    transaction(call, fn db -> query(db, "delete from watchers where space = ? and owner = ? returning 1", [space, owner]) != [] end)
  end

  @doc "Whose the events of `space` are, or of the space the subscription `name` watches with `subscription: name`."
  def watchers(call, subscription: name) do
    transaction(call, fn db ->
      for %{"owner" => owner} <- query(db, "select w.owner from watchers w join subscriptions s on s.space = w.space where s.name = ? order by w.owner", [name]),
          do: owner
    end)
  end

  def watchers(call, space) do
    transaction(call, fn db -> for %{"owner" => owner} <- query(db, "select owner from watchers where space = ? order by owner", [space]), do: owner end)
  end

  @doc """
  Whether the event `id` is one it hasn't handled: it's remembered now if it is, and the ones it needn't keep any
  more are forgotten.
  """
  def unseen?(call, id) do
    now = System.system_time(:millisecond)

    transaction(call, fn db ->
      case query(db, "select id from seen_events where id = ?", [id]) do
        [] ->
          query(db, "insert into seen_events (id, seen_at) values (?, ?)", [id, now])
          query(db, "delete from seen_events where seen_at < ?", [now - @seen_for])
          query(db, "delete from seen_events where id in (select id from seen_events order by seen_at desc limit -1 offset ?)", [@seen_most])
          true

        [_seen] ->
          false
      end
    end)
  end
end
