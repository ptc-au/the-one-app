defmodule OneCore.User do
  @moduledoc """
  Who a request is from and who it's for, each one value, which is how relation tuples name them. A user is
  `users/<name>`, a group is `groups/<name>` and the network is `network`: each is their prefix in the bucket
  without its last `/`. The holder of a sharing link is `users/<name>/links/<the link's name>`, after whoever the
  link leads to, and is nobody else.

  Which of them a request is by and for is `OneCore.Mcp.Principal`'s to say.
  """
  alias OneCore.{Bucket, Servers}

  # Who was renamed (`OneCore.Renames`): a JSON object of each name a user had, `users/<old>`, and their name now.
  @renamed "network/renamed"

  @doc "The blob that says who was renamed, and their name now."
  def renames_blob, do: @renamed

  @doc """
  The key of the device a request is from, or `nil`: the device the network's edge says, for what came in
  there over the web, and otherwise the key the connection proved. A run of a client has a key of its own, since
  a device runs many at once and each is reached by its key, and a request from one names the device it runs for
  with that device's signature of `one/run/1`, a line, and the run's key (`core/client/src/lib.rs`). A run whose device
  doesn't attestation for it is nobody's.
  """
  def device(nil, %{"device" => device}) when is_binary(device), do: device

  def device(from, %{"device" => device, "attestation" => attestation}) when is_binary(from) do
    with true <- is_binary(device) and is_binary(attestation),
         {:ok, key} <- Base.decode16(device, case: :lower),
         {:ok, signature} <- Base.decode16(attestation, case: :lower),
         true <- byte_size(key) == 32 and byte_size(signature) == 64,
         true <- :crypto.verify(:eddsa, :none, "one/run/1\n" <> from, signature, [key, :ed25519]) do
      device
    else
      _ -> nil
    end
  end

  def device(from, _meta) when is_binary(from), do: from
  def device(_from, _meta), do: nil

  @doc """
  The network's first owner, or `nil` while it has none. One Core keeps who that is itself, in the blob
  `network/owner`, since it's who may do anything where no app decides who may (`OneCore.Hooks.validate/3`).
  """
  def first_owner do
    Servers.cached(:first_owner, fn ->
      with {:ok, who, _tag} <- Bucket.read("network/owner"), do: who, else: (:absent -> nil)
    end)
  end

  @doc """
  Whether `who` is the network's first owner as the bucket says now, uncached: for an app that writes down who owns
  the network once told so (the hook `owner`), since any of the network's servers may tell it, and only this is
  believed.
  """
  def first_owner?(who), do: is_binary(who) and match?({:ok, ^who, _tag}, Bucket.read("network/owner"))

  @doc """
  Whose `who` is, or who they are: the user, the group or the network that an artifact's name, or a who's, starts
  with. A sharing link's holder is whoever's the link leads to: their servers answer the holder, with the apps
  installed for them. `nil` for a name that starts with nobody's.
  """
  def owner(who) do
    case String.split(who, "/") do
      [kind, name | _] when kind in ["users", "groups"] -> kind <> "/" <> name
      ["network" | _] -> "network"
      _ -> nil
    end
  end

  @doc "Whether `who` names a user, a group or the network: someone things belong to."
  def owner?("network"), do: true
  def owner?("users/" <> name), do: named(name) == :ok
  def owner?("groups/" <> name), do: named(name) == :ok
  def owner?(_who), do: false

  @doc "Whether `who` is a user, `users/<name>`: `:ok`, or `{:error, why}`."
  def user("users/" <> name), do: named(name)
  def user(who), do: {:error, "#{inspect(who)} isn't a user, users/<name>"}

  @doc """
  Whether `name` is a user's or a group's name, after `users/` or `groups/`: `:ok`, or `{:error, why}`. A user's is
  their username, as GitHub's: lowercase letters, digits, dots and hyphens, starting and ending with a letter or a
  digit, at most 39 of them.
  """
  def named(name) do
    if is_binary(name) and name =~ ~r/^[a-z0-9](?:[a-z0-9.-]{0,37}[a-z0-9])?\z/,
      do: :ok,
      else:
        {:error,
         "A username is lowercase letters, digits, dots and hyphens, starting and ending with a letter or a digit"}
  end

  @doc """
  The who that is the holder of a sharing link. A link starts with whose it leads to, as their name: that's how
  the network's edge finds a server for it. Its holder is named after them and by the link's hash, so a
  relation tuple that names the holder doesn't hold the link. A link that starts with nobody's is nobody's.
  """
  def link(link) do
    Enum.join(
      List.wrap(owner(renamed(link))) ++ ["links", Base.encode16(:crypto.hash(:sha256, link), case: :lower)],
      "/"
    )
  end

  @doc """
  What `name` is called now: a name under a user who was renamed since (`rename/2`) is under their username now, as
  GitHub's old usernames lead to the new one, so an old address, a sharing link or a git remote keeps working. Any
  other name is as it is.
  """
  def renamed(name) when is_binary(name) do
    with owner when owner != nil <- owner(name),
         now when now != nil <- renames()[owner] do
      now <> String.replace_prefix(name, owner, "")
    else
      _ -> name
    end
  end

  def renamed(name), do: name

  # Each user who was renamed, by every name they had: their name now (`OneCore.Renames`). Kept by One Core, as it
  # keeps whose each prefix in the bucket is.
  defp renames do
    Servers.cached(:renamed, fn ->
      with {:ok, json, _tag} <- Bucket.read(@renamed), do: JSON.decode!(json), else: (:absent -> %{})
    end)
  end

  @doc """
  A JSON value with each text in it that names `old`, or something of theirs, naming `new`: `users/old`,
  `users/old/apps/notes`, and a git remote's `one::users/old/made/git-repos/notes`. For an app that keeps records
  of names, as it hears of a rename (the hook `renamed`).
  """
  def renamed_in(text, old, new) when is_binary(text) do
    cond do
      text == old -> new
      String.starts_with?(text, old <> "/") -> new <> String.replace_prefix(text, old, "")
      true -> String.replace(text, "::" <> old <> "/", "::" <> new <> "/")
    end
  end

  def renamed_in(map, old, new) when is_map(map),
    do: Map.new(map, fn {key, value} -> {renamed_in(key, old, new), renamed_in(value, old, new)} end)

  def renamed_in(list, old, new) when is_list(list), do: Enum.map(list, &renamed_in(&1, old, new))
  def renamed_in(other, _old, _new), do: other

  @doc "Whether `who` is the holder of a sharing link, who is in no network: nothing is theirs, and nothing is installed for them."
  def link?(who), do: match?(["links", _name], Enum.take(String.split(who, "/"), -2))
end
