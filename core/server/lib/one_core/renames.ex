defmodule OneCore.Renames do
  @moduledoc """
  Renaming a user, as GitHub renames an account. Their old name leads to the new one from then on
  (`OneCore.User.renamed/1`), as `network/renamed` says: a JSON object of each name a user had, `users/<old>`, and
  their name now.
  """
  alias OneCore.{Bucket, Servers, User}

  @doc """
  Renames a user, `users/<old>` to `users/<new>`, as GitHub renames an account: everything that's theirs in the bucket
  goes to their new prefix (`OneCore.Bucket.move/2`, as a transfer moves one artifact), what One Core keeps that names
  them says their new name (the network's first owner, the servers that act for them, what's installed and deployed),
  and their old name leads to the new one from now on (`OneCore.User.renamed/1`). Then every server looks again, and the apps that
  hook `renamed` rename them in what they keep: `{:ok, heard, unheard}`, as `OneCore.Hooks.collect/3` gives it. Each place
  it looks and every blob it writes, which is a round trip to the bucket, is asked at once, and each part says what it's
  at to `stage`, a function of one sentence, as `OneCore.Call.stage/2` says it.

  Whoever may rename someone, and whether the new name is free, is the sign-in app's to say before it calls this.
  """
  def rename("users/" <> _ = old, "users/" <> _ = new, stage) when is_function(stage, 1) do
    with :ok <- User.user(old), :ok <- User.user(new) do
      # Only a server of the network's may write everyone's blobs (`core/edge/presigner/presigner.ts`), so a rename
      # isn't begun anywhere else, where it would stop partway.
      if not Servers.here?("network"),
        do: raise("A rename moves what's everyone's, so only a server acting for the network does it")

      if Bucket.list(new <> "/") != [],
        do: raise("#{new} has things in the bucket already, so #{old} isn't renamed to it")

      stage.("Moving everything of #{old}'s to #{new}")
      Bucket.move(old <> "/", new <> "/")
      renamed_in = &User.renamed_in(&1, old, new)

      Bucket.update(User.renames_blob(), fn was ->
        names = if was, do: JSON.decode!(was), else: %{}

        names
        |> Map.delete(new)
        |> Map.new(fn {from, to} -> {from, if(to == old, do: new, else: to)} end)
        |> Map.put(old, new)
        |> JSON.encode!()
      end)

      if User.first_owner?(old), do: Bucket.update("network/owner", fn _was -> new end)

      owners = [
        "network" | Enum.map(Bucket.folders("users/") ++ Bucket.folders("groups/"), &String.trim_trailing(&1, "/"))
      ]

      stage.("Renaming #{old} where servers, groups and apps name them")

      blobs =
        for(key <- Servers.all(), do: "servers/#{key}/members") ++
          for(owner <- owners, do: "#{owner}/installs") ++
          for(app <- Bucket.folders(new <> "/apps/"), do: app <> "latest")

      each(blobs, fn blob ->
        Bucket.update(blob, fn was ->
          if was && String.contains?(was, old), do: was |> JSON.decode!() |> renamed_in.() |> JSON.encode!(), else: was
        end)
      end)

      # What names them in its blob's name: that they installed an app, and what they deployed.
      moved = fn from, to ->
        with {:ok, data, _tag} <- Bucket.read(from) do
          Bucket.write(to, renamed_in.(data))
          Bucket.remove(from)
        end
      end

      owners
      |> each(&Bucket.folders(&1 <> "/apps/"))
      |> Enum.flat_map(& &1)
      |> each(&moved.(&1 <> "installed/" <> old, &1 <> "installed/" <> new))

      each(
        Bucket.list("network/deployed/#{old}/"),
        &moved.(&1, String.replace_prefix(&1, "network/deployed/#{old}/", "network/deployed/#{new}/"))
      )

      OneCore.Server.notify_servers([old, new, "network"])
      OneCore.Apps.Deploy.forget(:all)
      Servers.invalidate()
      OneCore.Apps.reload(new)
      OneCore.Hooks.invalidate()
      # Asked for them, for the network and for each group, whose apps keep what they did there too: an app asked for
      # one renames them in what it keeps for that one, where its server may write it. Each is asked at once, as an app
      # that doesn't answer is waited for up to `OneCore.Hooks`' timeout, which one after another was a minute.
      stage.("Telling the apps, who rename them in what they keep")
      scopes = [new, "network" | Enum.filter(owners, &String.starts_with?(&1, "groups/"))]

      scopes
      |> each(&OneCore.Hooks.collect("renamed", %{"who" => old, "to" => new}, {nil, &1}))
      |> Enum.reduce({:ok, %{}, %{}}, fn {:ok, more, failed}, {:ok, heard, unheard} ->
        {:ok, Map.merge(heard, more), Map.merge(unheard, failed)}
      end)
    end
  end

  defp each(list, fun),
    do: list |> Task.async_stream(fun, max_concurrency: 16, timeout: :infinity) |> Enum.map(fn {:ok, done} -> done end)
end
