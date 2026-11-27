defmodule Vault.Versions do
  @moduledoc """
  What an item held before a field was replaced or removed, kept for 30 days so its person can bring it back, as a
  password manager keeps an item's history, and as soft delete keeps what's deleted. One row of the Vault's database
  each (it's encrypted with the Vault's keys), the value as the item kept it, which no tool ever gives: `all/2` says
  which field, what happened to it, by whom and when, and `restore!/3` puts one back without showing it.

      kept --restore!----------> back in its item (what it replaces is kept in its place)
      kept --forget!/forget_item--> gone
      kept --a month, or past the newest 20 of its item--> gone
  """

  alias Vault.{Items, Store}

  # How long a version is kept, in seconds, and the most an item keeps, so a loop of changes can't grow a Vault.
  @kept 30 * 86_400
  @most 20

  @doc "Keeps `field` (an item's field as it was) before it's `replaced` or `removed`, by `by`: `agent` or `person`."
  def keep(call, db, item, field, kind, by) do
    Store.transaction(call, db, fn d ->
      insert = "insert into versions (item, field, value, secret, kind, at, by) values (?, ?, ?, ?, ?, ?, ?)"
      Store.query(d, insert, [item["id"], field["name"], field["value"], if(field["secret"], do: 1, else: 0), kind, Store.now(), by])
      Store.query(d, "delete from versions where item = ? and id not in (select id from versions where item = ? order by id desc limit ?)", [item["id"], item["id"], @most])
    end)

    :ok
  end

  @doc "What's kept of each item, by its id, newest first, never a value."
  def all(call, db) do
    Store.transaction(call, db, fn d ->
      for version <- Store.query(d, "select id, item, field, secret, kind, at, by from versions where at > ? order by id desc", [Store.now() - @kept]) do
        {version["item"], %{id: version["id"], field: version["field"], secret: version["secret"] == 1, kind: version["kind"], at: version["at"], by: version["by"]}}
      end
    end)
    |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
  end

  @doc """
  Brings version `id` back into its item, which is given as it is now and gives what it's to be. A field there now by
  that name is kept in its place, so a restore is undone by one. Gives the item's name and the field's.
  """
  def restore!(call, db, id, by) do
    version = Store.transaction(call, db, &Store.query(&1, "select item, field, value, secret from versions where id = ? and at > ?", [id, Store.now() - @kept])) |> List.first()
    item = version && Store.record(db, version["item"])
    if item == nil, do: raise("That version isn't kept any more, or its item isn't in the Vault.")

    now = Enum.find(item["fields"], &(&1["name"] == version["field"]))
    if now, do: keep(call, db, item, now, "replaced", by)
    Store.change!(db, item, &Items.put_field(&1, version["field"], version["value"], version["secret"] == 1))
    Store.transaction(call, db, &Store.query(&1, "delete from versions where id = ?", [id]))
    %{item: item["name"], field: version["field"]}
  end

  @doc "Forgets one kept version by its `id`, erasing it from storage now. Raises where it isn't kept any more."
  def forget!(call, db, id) do
    removed =
      Store.transaction(call, db, fn d ->
        case Store.query(d, "select id from versions where id = ?", [id]) do
          [%{"id" => ^id}] ->
            Store.query(d, "delete from versions where id = ?", [id])
            1

          [] ->
            0
        end
      end)

    if removed == 0, do: raise("That version isn't kept any more.")
    removed
  end

  @doc "Forgets every kept version of item `item_id`, erasing them from storage now. Gives how many were forgotten."
  def forget_item(call, db, item_id) do
    Store.transaction(call, db, fn d ->
      [%{"n" => count}] = Store.query(d, "select count(*) as n from versions where item = ?", [item_id])
      if count > 0, do: Store.query(d, "delete from versions where item = ?", [item_id])
      count
    end)
  end

  @doc "When a version next goes, in seconds since 1970, or `nil` with none."
  def next(call, db) do
    Store.transaction(call, db, fn d ->
      with [%{"next" => next}] <- Store.query(d, "select min(at) + ? as next from versions", [@kept]), do: next
    end)
  end

  @doc "Lets go of what's a month old."
  def expire(call, db) do
    Store.transaction(call, db, &Store.query(&1, "delete from versions where at <= ?", [Store.now() - @kept]))
    :ok
  end
end
