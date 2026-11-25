defmodule OneCore.Mcp.Principal do
  @moduledoc """
  Who a request is by and who it's for, its principal (`OneCore.User` says who each is). Signing in is an app,
  which tells One Core whose device a request came from: `asking/3` is the one place that's decided, and it asks
  the apps that mutate `device` (`OneCore.Hooks.whose/1`). A device no app places is nobody's, and nobody is
  refused everything: so with no app signing anyone in, a network answers nobody.

  A request is for whoever it's from, unless it says who else: a group, the network, or a person. It then runs for
  them, with their artifacts, once the apps that validate `reach` say whoever asked is their `member`, or, for a tool
  of One Core's that says `installs` (what's installed for them), their `installer`, as a network's owner is of each
  person, as Google Workspace's admin assigns an app to one user. An app's tool runs only as far as whoever asked may
  what that app made for them (`OneCore.Apps.Calls`).
  """
  alias OneCore.{Hooks, Servers, User}

  @nobody "This device isn't signed in here. Sign in on it, or approve it from a device of yours."

  @doc "The JSON-RPC error a device that's nobody's is answered, so whatever passed its request on can tell."
  def nobody, do: -32003

  @doc """
  Who a request is by and who it's for, its actor and its subject: `{:ok, {actor, subject}, forwarded}`, or
  `{:error, why}`. `from` is the key of whatever sent it, which its connection proved, or `nil` for what came in at
  the network's address over the web. `said` is what the request says of itself, its `_meta`. `question` is whether
  it asks an app's hook a question, one that validates or mutates, whose answer goes only to whoever asked: any of the
  network's servers asks those as nobody, about whoever it's about, where only one acting for someone is believed
  about what they asked for, or about what happened.

  - `actor` and `subject`, from a server acting for whoever asked, are who that server was asked by and for: it
    passes on what it was asked, and `forwarded` says so: `:to` from a server that couldn't run it, and `true` from
    one that handed it to this one for what it holds (`OneCore.Call`). A scheduled job is asked by nobody, so its
    `actor` is `nil`, and the server acts for its `subject`. A server is believed about who asked only: whether they
    may ask for their subject, a group or the network, is asked here again, as it is of a device.
  - `link` is a sharing link, and whoever shows one is its holder.
  - `webhook` is an app's webhook, and it's from whoever its address leads to and for them: nobody's signed in at it,
    and the token in its address is all whoever asks it knows (`OneCore.Apps.Webhooks`).
  - `as` names a user to act as. It's for a network being built, to show who may do what with nobody signing
    in, and is refused unless the server's `:development` setting is on.
  - `device`, in what came in at the network's address, is the device the edge says it's from: it proved
    that there, as a connection proves a key here. Over a connection, it's the device a run of a client runs for,
    with `attestation` (`OneCore.User.device/2`).
  - `subject` names who else the request is for: a group, the network, or for a tool that `installs`, a person.

  Otherwise it's from whoever's device `from` is. `relations` are what whoever asked is to be of whoever else it's
  for, any one of them.
  """
  def asking(from, meta, question \\ false, relations \\ ["member"])

  def asking(from, %{"actor" => actor} = meta, question, relations) when is_binary(actor) or is_nil(actor) do
    {actor, subject} = {User.renamed(actor), User.renamed(meta["subject"])}
    whose = User.owner(actor || subject || "") || "network"
    asks = question and actor == nil and is_binary(from) and Servers.acts_for(from) != []

    cond do
      not is_binary(subject) ->
        {:error, "A server says who it asks for too"}

      not (OneCore.Apps.acts_for?(from, whose) or asks) ->
        {:error, "Only a server acting for #{whose} says it asks for them"}

      true ->
        with :ok <- if(actor, do: acts(actor, subject, relations), else: :ok),
             do: {:ok, {actor, subject}, if(meta["forwarded"] == "to", do: :to, else: meta["forwarded"] == true)}
    end
  end

  # A public webhook is from whoever its address leads to, and for them, as a sharing link's holder is from the link:
  # nobody's signed in at it, and it asks only for its own webhook (`OneCore.Mcp`'s `confined/2`, and
  # `OneCore.Apps.Webhooks` for whose it is).
  def asking(_from, %{"webhook" => webhook}, _question, _relations) when is_binary(webhook) do
    case OneCore.Apps.Webhooks.named(webhook) do
      {:ok, owner, _app, _token} ->
        with :ok <- here(owner), do: {:ok, {owner, owner}, false}

      {:error, why} ->
        {:error, -32602, why}
    end
  end

  def asking(from, meta, _question, relations) do
    with {:ok, actor} <- by(from, meta),
         :ok <- here(actor),
         subject = User.renamed(Map.get(meta, "subject", actor)),
         :ok <- acts(actor, subject, relations),
         do: {:ok, {actor, subject}, false}
  end

  defp by(_from, %{"link" => link}) when is_binary(link), do: {:ok, User.link(link)}

  defp by(_from, %{"as" => name}) when is_binary(name) do
    if Application.get_env(:one_core, :development, false),
      do: with(:ok <- User.named(name), do: {:ok, User.renamed("users/" <> name)}),
      else: {:error, "Acting as a user is for a network being built, and this one wasn't started as one"}
  end

  defp by(from, meta) do
    case User.device(from, meta) do
      nil -> {:error, nobody(), @nobody}
      device -> whose(device)
    end
  end

  defp whose(device) do
    case Hooks.whose(device) do
      nil -> {:error, nobody(), @nobody}
      {:error, why} -> {:error, "Couldn't check whose this device is, so nothing was done: #{why}. Try again."}
      who -> {:ok, who}
    end
  end

  # A server answers whoever it acts for, and the holder of a link that leads to them.
  defp here(by) do
    owner = User.owner(by)

    if owner == nil or OneCore.Apps.here?(owner),
      do: :ok,
      else: {:error, "This server doesn't act for #{owner}. The ones that do are the ones to ask."}
  end

  @doc """
  Whether a request by `by` runs for `subject`: themselves, or whoever the apps that validate `reach` say they're one
  of `relations` of. `:ok`, or where they're none, `{:error, why}` they aren't the first.
  """
  def acts(by, by, _relations), do: :ok

  def acts(by, subject, relations) do
    cond do
      not User.owner?(subject) ->
        {:error, "A request is for a user, a group or the network: users/<name>, groups/<name> or network"}

      User.link?(by) ->
        {:error, "A sharing link's holder asks for nobody else"}

      true ->
        Enum.reduce_while(relations, nil, fn relation, refused ->
          case Hooks.validate("reach", %{"who" => by, "relation" => relation, "artifact" => subject}, {by, subject}) do
            :ok -> {:halt, :ok}
            {:refuse, why} -> {:cont, refused || {:error, why}}
          end
        end)
    end
  end
end
