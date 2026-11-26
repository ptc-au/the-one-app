defmodule Vault.Handles do
  @moduledoc """
  A handle: one secret, from an item or from a page in a browser, that a command is handed once, while whoever asked
  for it (an agent) holds only the handle, as 1Password's `op run` hands a command what it names and Docker's build
  secrets mount one for one step. It's used once, within `@lasts`, and then it's spent: as `one vault run` on a device
  of its person's, which the Vault answers sealed to that device's key (`OneCore.Iroh.seal/3`), so a tool's answer, a
  log and the agent never hold it; or by the code of a trusted app that runs a command (Remote Shell's `run`,
  Containers' `exec`), as `Vault.value/3` hands one.

  Each handle is kept in its Vault's database, which is encrypted with its keys, and is the log of what was handed to
  commands: what it's of (an item and field, or a site), who made it and when, and when it was used and where, kept a
  month as a request is (`Vault.Requests`), never with a value. What a browser sent is kept there until it's used or
  its time is over, and no longer. An item's value is read as it's used, so access taken away before then holds.

      made --one vault run, Remote Shell or Containers--> used
      made --@lasts with no use--------------------------> expired

  It keeps the Vault's rules. A handle to an item is made only where its person switched on Commands for it, which,
  as every grant, only they do, on their own screen (`Vault.Access.person!/2`): an agent is refused, and never answers
  a request of its own. One to a browser's is of what the agent's own browser shows it anyway. It's spent only by the
  person's own device over its own connection, sealed to that device's key, or by a trusted app's code, never over the
  web; only in the Vault of whoever it was made for, so nobody else's call finds it; and once.
  """

  alias Vault.{Access, Items, Store}

  # How long a handle may be used for, and how long one is kept as the log of it, in seconds.
  @lasts 300
  @kept 30 * 86_400

  @doc "How long a handle may be used for, in seconds."
  def lasts, do: @lasts

  @doc """
  Makes a handle to one field of an item (`{:item, name, field}`), which its person lets commands have, or to what a
  browser sent (`{:site, site, value}`), for the agent `by`. Gives it.
  """
  def create(call, db, of, by) do
    id = Store.random(18)
    now = Store.now()

    {item, field, site, value} =
      case of do
        {:item, name, field} ->
          found = Access.may!(Items.find!(call, db, name), :commands)
          if Items.fields(found)[field] == nil, do: raise("#{found["name"]} has no field named #{field}.")
          {found["name"], field, nil, nil}

        {:site, site, value} ->
          {nil, nil, site, value}
      end

    Store.transaction(call, db, fn d ->
      Store.query(
        d,
        "insert into handles (id, item, field, site, value, by, at, expires) values (?, ?, ?, ?, ?, ?, ?, ?)",
        [id, item, field, site, value, by, now, now + @lasts]
      )
    end)

    id
  end

  @doc """
  Spends the handle `id`, as `where` (a device's name, or an app's) uses it, and gives its value: once, within its
  time. One that's spent, past its time or never was is refused alike.
  """
  def use(call, db, id, where) do
    now = Store.now()

    made =
      Store.transaction(call, db, fn d ->
        found = Store.query(d, "select item, field, value from handles where id = ? and used is null and expires > ?", [id, now])
        spent = Store.query(d, "update handles set used = ?, used_by = ?, value = null where id = ? and used is null and expires > ? returning id", [now, where, id, now])

        case {found, spent} do
          {[made], [_spent]} -> made
          _ -> raise "That handle was used already, or its #{div(@lasts, 60)} minutes are over: make another."
        end
      end)

    case made do
      %{"item" => nil, "value" => value} ->
        value

      %{"item" => name, "field" => field} ->
        found = Access.may!(Items.find!(call, db, name), :commands)
        Items.fields(found)[field] || raise("#{found["name"]} has no field named #{field}.")
    end
  end

  @doc "The handles kept, newest first: what each was of, by whom, and how it was used, never a value."
  def all(call, db) do
    Store.transaction(call, db, fn d ->
      for handle <- Store.query(d, "select id, item, field, site, by, at, expires, used, used_by from handles order by at desc") do
        %{
          handle: handle["id"],
          item: handle["item"],
          field: handle["field"],
          site: handle["site"],
          by: handle["by"],
          at: handle["at"],
          state: state(handle),
          used: handle["used"],
          where: handle["used_by"]
        }
      end
    end)
  end

  defp state(%{"used" => used}) when used != nil, do: "used"
  defp state(%{"expires" => expires}), do: if(expires > Store.now(), do: "made", else: "expired")

  @doc "When a handle's value next goes, or one is let go of, in seconds since 1970, or `nil` with none."
  def next(call, db) do
    Store.transaction(call, db, fn d ->
      next = "select min(case when value is not null then expires else at + ? end) as next from handles"
      with [%{"next" => next}] <- Store.query(d, next, [@kept]), do: next
    end)
  end

  @doc "What a browser sent is let go of once its handle's time is over, and a handle a month old is let go."
  def expire(call, db) do
    now = Store.now()

    Store.transaction(call, db, fn d ->
      Store.query(d, "update handles set value = null where value is not null and expires <= ?", [now])
      Store.query(d, "delete from handles where at < ?", [now - @kept])
    end)

    :ok
  end
end
