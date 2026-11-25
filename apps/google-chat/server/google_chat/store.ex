defmodule GoogleChat.Store do
  @moduledoc """
  Google Chat's SQLite schema, and the rows it keeps. A person's are the Workspace Events subscriptions they watch,
  each with the account it watches as. Whoever the app is installed for keeps what the network set it up with, whose
  each subscription is, and the events it has already handled, so one Google sends twice is followed once.
  """
  alias OneCore.Call

  @schema [
    "create table config (name text primary key, value text not null)",
    "create table subscriptions (space text primary key, name text not null, account text, expire_time text, created_at text not null)",
    "create table routes (subscription text primary key, owner text not null)",
    "create table seen_events (id text primary key, seen_at integer not null)",
    "create index seen_events_by_seen_at on seen_events (seen_at)"
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

  @doc "What it's set up with, each value by its name: `pubsub_topic` and `webhook_path`."
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
      for row <- query(db, "select space, name, account, expire_time from subscriptions order by space"), do: row(row)
    end)
  end

  @doc "The subscription watching `space`, or nil where there's none."
  def subscription(call, space) do
    transaction(call, fn db ->
      case query(db, "select space, name, account, expire_time from subscriptions where space = ?", [space]) do
        [row] -> row(row)
        [] -> nil
      end
    end)
  end

  defp row(%{"space" => space, "name" => name, "account" => account, "expire_time" => expire}),
    do: %{space: space, subscription: name, account: account, expire_time: expire}

  @doc "Keeps a space's subscription, the account it watches as, and when it expires."
  def save_subscription(call, %{space: space, subscription: name, account: account, expire_time: expire}) do
    transaction(call, fn db ->
      query(
        db,
        "insert into subscriptions (space, name, account, expire_time, created_at) values (?, ?, ?, ?, ?) " <>
          "on conflict (space) do update set name = excluded.name, account = excluded.account, expire_time = excluded.expire_time",
        [space, name, account, expire, DateTime.utc_now() |> DateTime.to_iso8601()]
      )
    end)
  end

  @doc "Forgets the subscription watching `space`."
  def remove_subscription(call, space) do
    transaction(call, fn db -> query(db, "delete from subscriptions where space = ?", [space]) end)
  end

  @doc "Keeps whose the subscription `name` is, a user, or forgets it where that's nil."
  def save_route(call, name, nil), do: transaction(call, fn db -> query(db, "delete from routes where subscription = ?", [name]) end)

  def save_route(call, name, owner) do
    transaction(call, fn db ->
      query(db, "insert into routes (subscription, owner) values (?, ?) on conflict (subscription) do update set owner = excluded.owner", [name, owner])
    end)
  end

  @doc "Whose the subscription `name` is, or nil where it's nobody's."
  def route(_call, nil), do: nil

  def route(call, name) do
    transaction(call, fn db ->
      case query(db, "select owner from routes where subscription = ?", [name]) do
        [%{"owner" => owner}] -> owner
        [] -> nil
      end
    end)
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
