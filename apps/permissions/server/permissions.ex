defmodule Permissions do
  @moduledoc """
  Relation tuples: who may do what in a network, each one line of an artifact, a relation and who. They're kept in
  this app's database, and it decides the `reach` hook from them, so an app reaches an artifact only where a
  tuple says both it and whoever it runs for may.

  Nothing here knows how anyone signs in. Who asks is the call's actor, as One Core says it: a member runs a call
  for a group or the network, and may share, list and check only what they may themselves. A scheduled job is asked
  by nobody, so it's whoever it runs for.

  An artifact an app made for someone (`users/alice/made/notes/7`) is moved to whoever else it's to belong to with
  `transfer`, as GitHub's transfer of a repo and Google Workspace's data transfer do: its blobs go to the new owner's
  place by their names (`Bucket.move/2`), the tuples that name it follow it, and its old name says where it went
  (`moved`, which the `reach` hook answers with) for as long as nothing else is made there. A transfer to someone
  whose it doesn't already is the actor's (a network's owner owns everything, so anyone) waits in `transfers` for
  that someone to `accept` it, as GitHub's does. The apps that hook `permissions.transferred` keep what they made a
  list of in step.
  """
  @behaviour OneCore.App
  alias OneCore.{Bucket, Hooks, User}

  # One Core asks it who may reach what: without it, only the network's first owner reaches anything.
  @impl true
  def icon, do: "icon.svg"

  # An owner is an editor, and an editor is a viewer: what each relation is enough for. An installer adds apps
  # for a user, a group or the network, which their owner does too, and is nothing more.
  @enough %{
    "viewer" => ~w(viewer editor owner),
    "editor" => ~w(editor owner owner),
    "owner" => ~w(owner owner owner),
    "installer" => ~w(installer owner owner)
  }

  @schema [
    """
    create table tuples (
      artifact text not null, relation text not null, who text not null, primary key (artifact, relation, who)
    ) without rowid
    """,
    "create index tuples_by_who on tuples (who, relation)",
    # What each group is called, as whoever made it wrote it. A group made before this is called what it's named.
    "create table names (artifact text primary key, called text not null) without rowid",
    "insert into names select distinct artifact, substr(artifact, 8) from tuples where artifact like 'groups/%'",
    # A transfer waiting to be accepted: one for an artifact at a time, and who it's to.
    "create table transfers (artifact text primary key, receiver text not null, sender text not null, at integer not null) without rowid",
    # Where an artifact went, by its old name: the old name says so while nothing's been made there since.
    "create table moved (old text primary key, new text not null) without rowid"
  ]
  @made ~r{^(users/[^/]+|groups/[^/]+|network)/made/([^/]+)/([A-Za-z0-9_-]+)$}

  # What's followed from one who or artifact to the next: the groups a who is a member of, and an artifact's
  # parents.
  @groups "select artifact as next from tuples where relation = 'member' and who = ?"
  @parents "select who as next from tuples where relation = 'parent' and artifact = ?"
  @members "select who as next from tuples where relation = 'member' and artifact = ?"
  @having "select who from tuples where artifact = ? and relation = ? order by who"
  @tuple "select 1 from tuples where artifact = ? and who = ? and relation in (?, ?, ?) limit 1"

  # Its data is the network's relation tuples, one graph every call is checked against, whoever it's for.
  @impl true
  def own, do: :installed

  @impl true
  def requires, do: %{"core" => ">= 0.37.50", "database" => "to keep who may reach what"}

  @impl true
  def offers do
    [
      %{
        name: "transferred",
        kind: :collect,
        description:
          "An artifact an app made was moved to another owner: `artifact` is its name until now and `to` its name " <>
            "now. An app that keeps a list of what it made keeps it true from it. A transfer waits for the answers, " <>
            "and says which apps didn't give one."
      }
    ]
  end

  @impl true
  def tools do
    artifact = %{type: "string", description: "The artifact's name, such as users/alice/made/notes/7"}

    who = %{
      type: "string",
      description: "Who: users/<name>, groups/<name>, everyone, an app's artifact's name, or a link's holder"
    }

    relation = %{type: "string", enum: ~w(viewer editor owner installer member parent), description: "The relation"}
    reaching = %{type: "string", enum: ~w(viewer editor owner), description: "The relation. viewer if left out"}
    tuple = %{type: "object", properties: %{artifact: artifact, relation: relation, who: who}}
    tuple = Map.put(tuple, :required, ["artifact", "relation", "who"])

    transfer = %{
      type: "object",
      properties: %{
        artifact: artifact,
        to: %{type: "string", description: "Whose it is to be"},
        now: %{type: "string", description: "What it's named once it's moved"},
        state: %{type: "string", enum: ~w(moved waiting), description: "waiting for them to accept, or moved"}
      },
      required: ["artifact", "to", "now", "state"]
    }

    [
      %{
        name: "share",
        description: "Writes a relation tuple: who has which relation to an artifact",
        inputs: tuple,
        outputs: tuple
      },
      %{name: "unshare", description: "Removes a relation tuple, if it's there", inputs: tuple, outputs: tuple},
      %{
        name: "shared",
        read_only: true,
        description: "Lists an artifact's relation tuples: who it's shared with, and as what",
        inputs: %{type: "object", properties: %{artifact: artifact}, required: ["artifact"]},
        outputs: %{
          type: "object",
          properties: %{
            tuples: %{
              type: "array",
              items: %{type: "object", properties: %{relation: relation, who: who}, required: ["relation", "who"]}
            }
          },
          required: ["tuples"]
        }
      },
      %{
        name: "check",
        read_only: true,
        description: "Says whether someone may reach an artifact",
        inputs: %{
          type: "object",
          properties: %{
            artifact: artifact,
            relation: reaching,
            who: Map.put(who, :description, "Who. You, if left out")
          },
          required: ["artifact"]
        },
        outputs: %{
          type: "object",
          properties: %{
            who: who,
            relation: reaching,
            artifact: artifact,
            may: %{type: "boolean", description: "Whether they may"}
          },
          required: ["who", "relation", "artifact", "may"]
        }
      },
      %{
        name: "users",
        read_only: true,
        description:
          "Lists the users who have a relation to an artifact, through the groups they're in: who owns the network, " <>
            "or may install apps for it",
        inputs: %{
          type: "object",
          properties: %{artifact: artifact, relation: Map.put(relation, :enum, ~w(viewer editor owner installer))},
          required: ["artifact", "relation"]
        },
        outputs: %{type: "object", properties: %{users: %{type: "array", items: %{type: "string"}, description: "users/<name>, or everyone"}}, required: ["users"]}
      },
      %{
        name: "members",
        read_only: true,
        description: "Lists the users in a group, through the groups in it, or every user the network's tuples name",
        inputs: %{
          type: "object",
          properties: %{of: %{type: "string", description: "groups/<name>, or network"}},
          required: ["of"]
        },
        outputs: %{type: "object", properties: %{members: %{type: "array", items: %{type: "string"}, description: "users/<name>, or everyone"}}, required: ["members"]}
      },
      %{
        name: "group",
        ui: "client/forms.html",
        runtime_version: 4,
        description: "Makes a group, with you as its owner and its first member",
        inputs: %{
          type: "object",
          properties: %{name: %{type: "string", description: "What it's called, as people write it: The Smiths"}},
          required: ["name"]
        },
        outputs: %{
          type: "object",
          properties: %{
            group: %{type: "string", description: "groups/<name>"},
            called: %{type: "string", description: "What it's called, as people write it"}
          },
          required: ["group", "called"]
        }
      },
      %{
        name: "groups",
        read_only: true,
        description: "Lists the groups you're in, each with what it's called, its members and its owners",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{
            groups: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  group: %{type: "string", description: "groups/<name>"},
                  called: %{type: "string", description: "What it's called, as people write it"},
                  members: %{type: "array", items: %{type: "string"}},
                  owners: %{type: "array", items: %{type: "string"}}
                },
                required: ["group", "called", "members", "owners"]
              }
            }
          },
          required: ["groups"]
        }
      },
      %{
        name: "forget",
        description:
          "Removes every tuple naming someone removed from the network as subject: the groups they were in, and what " <>
            "was shared with them. Taking someone out calls it",
        inputs: %{
          type: "object",
          properties: %{who: %{type: "string", pattern: "^users/[a-z0-9][a-z0-9.-]*$", description: "Who: users/<name>"}},
          required: ["who"]
        },
        outputs: %{
          type: "object",
          properties: %{who: %{type: "string"}, tuples: %{type: "integer", description: "How many tuples named them"}},
          required: ["who", "tuples"]
        }
      },
      %{
        name: "transfer",
        description:
          "Moves something an app made to another owner, a person, a group or the network, who it's then " <>
            "`<owner>/made/<app>/<name>` of: its history, its other shares and its links go with it, and its old " <>
            "name says where it went. Its owner moves it, and the network's owner moves anything, to anyone at once. " <>
            "Anyone else's waits for whoever it's to be moved to to `accept` it. Whatever is encrypted for its owner " <>
            "isn't moved: the key stays theirs",
        inputs: %{
          type: "object",
          properties: %{
            artifact: %{type: "string", description: "What an app made, as its app names it: users/alice/made/notes/7"},
            to: %{type: "string", description: "Whose it is to be: users/<name>, groups/<name> or network"}
          },
          required: ["artifact", "to"]
        },
        outputs: transfer
      },
      %{
        name: "transfers",
        read_only: true,
        description: "Lists the transfers waiting to be accepted that you asked for, or that are to you or a group you own",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{transfers: %{type: "array", items: Map.merge(transfer, %{properties: Map.put(transfer.properties, :by, %{type: "string", description: "Who asked for it"})})}},
          required: ["transfers"]
        }
      },
      %{
        name: "moved",
        read_only: true,
        description: "Says where an artifact you could read went, if it was moved to another owner and nothing has been made at its old name since",
        inputs: %{type: "object", properties: %{artifact: artifact}, required: ["artifact"]},
        outputs: %{
          type: "object",
          properties: %{now: %{type: ["string", "null"], description: "What it's named now, or null for what wasn't moved"}},
          required: ["now"]
        }
      },
      %{
        name: "accept",
        description: "Accepts a transfer waiting for you, or a group you own: it's moved to them now",
        inputs: %{type: "object", properties: %{artifact: artifact}, required: ["artifact"]},
        outputs: transfer
      },
      %{
        name: "decline",
        description: "Declines a transfer waiting for you or a group you own, or takes back one you asked for",
        inputs: %{type: "object", properties: %{artifact: artifact}, required: ["artifact"]},
        outputs: %{type: "object", properties: %{artifact: artifact}, required: ["artifact"]}
      },
      %{
        name: "link",
        description: "Makes a sharing link to an artifact. Whoever holds it reaches the artifact without signing in",
        inputs: %{
          type: "object",
          properties: %{
            artifact: artifact,
            relation: %{type: "string", enum: ~w(viewer editor), description: "What its holder is. viewer if left out"}
          },
          required: ["artifact"]
        },
        outputs: %{
          type: "object",
          properties: %{
            link: %{type: "string", description: "The link, which its holder shows: keep it as a secret"},
            who: %{type: "string", description: "Its holder, as tuples name them"},
            relation: %{type: "string", enum: ~w(viewer editor)},
            artifact: artifact
          },
          required: ["link", "who", "relation", "artifact"]
        }
      }
    ]
  end

  @impl true
  def hooks, do: ["reach", "owner", "renamed", "groups"]

  # The network is the top parent of every artifact, and its first owner's tuple is the one nobody shares: it's
  # written as One Core makes them.
  @impl true
  def hook("owner", %{"who" => who}, call) do
    if OneCore.User.first_owner?(who) do
      transaction(call, fn db ->
        query(db, "insert or ignore into tuples (artifact, relation, who) values ('network', 'owner', ?)", [who])
      end)

      :ok
    else
      {:refuse, "#{who} isn't the network's first owner"}
    end
  end

  # Someone renamed is named by their new name in every tuple, transfer and move, as everything of theirs is.
  def hook("renamed", %{"who" => old, "to" => new}, call) do
    transaction(call, fn db ->
      for {table, column} <- [tuples: "artifact", tuples: "who", moved: "old", moved: "new", transfers: "artifact", transfers: "receiver", transfers: "sender"],
          do: query(db, "update or replace #{table} set #{column} = ? || substr(#{column}, length(?) + 1) where #{under(column)}", [new, old, old, old, old])
    end)

    nil
  end

  # The groups someone is in, as `member?/3` has them, for an assistant to list those groups' apps beside theirs.
  def hook("groups", %{"who" => who}, call) do
    %{"groups" => for("groups/" <> _ = group <- transaction(call, &followed(&1, @groups, [who], [])), do: group)}
  end

  def hook("reach", %{"who" => who, "relation" => "member", "artifact" => of}, call) do
    if transaction(call, &member?(&1, who, of)),
      do: :ok,
      else: {:refuse, "#{who} isn't a member of #{of}. Whoever owns it adds them, with permissions_share."}
  end

  def hook("reach", %{"who" => who, "relation" => "installer", "artifact" => artifact}, call) do
    if transaction(call, &may?(&1, who, "installer", artifact)),
      do: :ok,
      else:
        {:refuse,
         "#{who} can't install apps for #{artifact}. Whoever can installs it for them, or its owner lets them, " <>
           "with permissions_share --relation installer."}
  end

  def hook("reach", %{"who" => who, "relation" => relation, "artifact" => artifact}, call) do
    transaction(call, fn db ->
      cond do
        now = gone(db, artifact) ->
          {:refuse, "#{artifact} was moved to #{now}. Use that name."}

        may?(db, who, relation, artifact) ->
          :ok

        true ->
          {:refuse, "#{who} isn't #{a(relation)} of #{artifact}. Whoever owns it shares it, with permissions_share."}
      end
    end)
  end

  @impl true
  def call("share", %{"artifact" => artifact, "relation" => relation, "who" => who}, call) do
    transaction(call, fn db ->
      shares!(db, call, artifact, relation)
      query(db, "insert or ignore into tuples (artifact, relation, who) values (?, ?, ?)", [artifact, relation, who])
      %{artifact: artifact, relation: relation, who: who}
    end)
  end

  def call("unshare", %{"artifact" => artifact, "relation" => relation, "who" => who}, call) do
    transaction(call, fn db ->
      shares!(db, call, artifact, relation)
      keeps_an_owner!(db, artifact, relation, who)
      query(db, "delete from tuples where artifact = ? and relation = ? and who = ?", [artifact, relation, who])
      %{artifact: artifact, relation: relation, who: who}
    end)
  end

  def call("shared", %{"artifact" => artifact}, call) do
    transaction(call, fn db ->
      reaches!(db, asking(call), "viewer", artifact)
      %{tuples: query(db, "select relation, who from tuples where artifact = ? order by relation, who", [artifact])}
    end)
  end

  def call("check", %{"artifact" => artifact} = inputs, call) do
    who = Map.get(inputs, "who", asking(call))
    relation = Map.get(inputs, "relation", "viewer")

    transaction(call, fn db ->
      if who != asking(call), do: reaches!(db, asking(call), "viewer", artifact)
      %{who: who, relation: relation, artifact: artifact, may: may?(db, who, relation, artifact)}
    end)
  end

  # Whoever may see an artifact, or is in it, sees who has which relation to it: everyone in the network sees who
  # owns it and installs its apps. A tuple's who is a user, a group, whose members are followed, or everyone,
  # which is said as it is.
  def call("users", %{"artifact" => artifact, "relation" => relation}, call) do
    transaction(call, fn db ->
      if not (member?(db, asking(call), artifact) or may?(db, asking(call), "viewer", artifact)),
        do: raise("#{asking(call)} isn't in #{artifact}, nor sees it, so doesn't see who has it.")

      %{users: users_with(db, artifact, relation)}
    end)
  end

  # Every user is in the network, so its members are every user a tuple names, as who or as whose an artifact is.
  def call("members", %{"of" => "network"}, call) do
    if not user?(asking(call)), do: raise("Only a user lists the network's users.")

    transaction(call, fn db ->
      named = query(db, "select distinct who as name from tuples union select distinct artifact from tuples", [])

      members = for %{"name" => name} <- named, owner <- [OneCore.User.owner(name)], owner, user?(owner), do: owner
      %{members: Enum.sort(Enum.uniq(members))}
    end)
  end

  def call("members", %{"of" => "groups/" <> _ = group}, call) do
    transaction(call, fn db ->
      if not (member?(db, asking(call), group) or may?(db, asking(call), "viewer", group)),
        do: raise("#{asking(call)} isn't in #{group}, so doesn't see who is.")

      %{members: Enum.sort(Enum.filter(followed(db, @members, [group], []), &user?/1))}
    end)
  end

  def call("members", %{"of" => of}, _call), do: raise("#{of} isn't a group or the network.")

  # Someone out of the network is in nothing, so their name is free for someone new to join by and inherits none
  # of it. Who's in the network is the app that signs people in's to say, so it's asked: it took them out first.
  def call("forget", %{"who" => who}, call) do
    if Enum.any?(OneCore.Call.tool(call, "sign-in", "everyone", %{})["people"], &(&1["who"] == who)),
      do: raise("#{who} is in the network. Taking them out with sign-in_remove_person forgets them here too.")

    transaction(call, fn db ->
      forgotten = query(db, "delete from tuples where who = ? returning artifact", [who])
      %{who: who, tuples: length(forgotten)}
    end)
  end

  # A group is named after what it's called, in lowercase letters, digits and hyphens: The Smiths is
  # groups/the-smiths, and Wiśniewski groups/wisniewski. What's called in a script with no such letters (نور,
  # 王家) or starts with a digit gets a name of its own, groups/group-<random>, and keeps what it's called.
  def call("group", %{"name" => called}, call) do
    called = String.trim(called)
    if called == "", do: raise("A group needs a name.")
    plain = called |> String.normalize(:nfd) |> String.replace(~r/\p{Mn}/u, "") |> String.downcase()
    name = plain |> String.replace(~r/[^a-z0-9]+/, "-") |> String.trim("-")
    name = if name =~ ~r/^[a-z]/, do: name, else: "group-" <> Base.encode32(:crypto.strong_rand_bytes(5), case: :lower, padding: false)
    group = "groups/" <> name

    transaction(call, fn db ->
      if query(db, "select 1 from tuples where artifact = ? limit 1", [group]) != [],
        do: raise("There's a group called #{called} already.")

      for relation <- ["owner", "member"],
          do: query(db, "insert into tuples (artifact, relation, who) values (?, ?, ?)", [group, relation, asking(call)])

      query(db, "insert into names (artifact, called) values (?, ?)", [group, called])
      %{group: group, called: called}
    end)
  end

  def call("groups", _inputs, call) do
    transaction(call, fn db ->
      groups =
        for "groups/" <> _ = group <- Enum.sort(followed(db, @groups, [asking(call)], []) -- [asking(call)]) do
        having = &for %{"who" => who} <- query(db, @having, [group, &1]), do: who
        # A group that sharing with it made, and not `group`, is called what it's named.
        called =
          with [%{"called" => called}] <- query(db, "select called from names where artifact = ?", [group]),
               do: called,
               else: (_ -> String.replace_prefix(group, "groups/", ""))

          %{group: group, called: called, members: having.("member"), owners: having.("owner")}
        end

      %{groups: groups}
    end)
  end

  # An artifact's owner moves it, and so does the network's, to anyone. Whoever it's to be, if it isn't the actor's to
  # give it to, accepts it first. It goes to the new owner's place by the same name, `<owner>/made/<app>/<name>`.
  def call("transfer", %{"artifact" => artifact, "to" => to}, call) do
    by = asking(call)
    now = renamed!(artifact, to)
    exists!(call, to)

    {waits, receivers} =
      transaction(call, fn db ->
        reaches!(db, by, "owner", artifact)
        movable!(db, artifact, now)
        waits = not mine?(db, by, to)

        if waits do
          at = System.system_time(:millisecond)
          query(db, "insert or replace into transfers (artifact, receiver, sender, at) values (?, ?, ?, ?)", [artifact, to, by, at])
        end

        {waits, receivers(db, to) -- [by]}
      end)

    if waits do
      told(call, receivers, "#{named(by)} wants to move #{short(artifact)} to #{whom(to)}", "Accept it, or decline it, in #{app_of(artifact)}.")
      %{artifact: artifact, to: to, now: now, state: "waiting"}
    else
      moved!(call, artifact, to, now)
      told(call, receivers, "#{short(artifact)} is #{if(user?(to), do: "yours", else: whose(to))} now", "#{named(by)} moved it to #{whom(to)}. It's at #{now}.")
      %{artifact: artifact, to: to, now: now, state: "moved"}
    end
  end

  def call("transfers", _inputs, call) do
    by = asking(call)

    transaction(call, fn db ->
      waiting = query(db, "select artifact, receiver, sender from transfers order by at", [])

      transfers =
        for %{"artifact" => artifact, "receiver" => to, "sender" => sender} <- waiting,
            sender == by or mine?(db, by, to),
            do: %{artifact: artifact, to: to, now: renamed!(artifact, to), state: "waiting", by: sender}

      %{transfers: transfers}
    end)
  end

  def call("moved", %{"artifact" => artifact}, call) do
    transaction(call, fn db ->
      reaches!(db, asking(call), "viewer", artifact)
      %{now: gone(db, artifact)}
    end)
  end

  def call("accept", %{"artifact" => artifact}, call) do
    by = asking(call)

    {to, sender} =
      transaction(call, fn db ->
        %{"receiver" => to, "sender" => sender} = waiting!(db, artifact)
        if not mine?(db, by, to), do: raise("Only #{whom(to)}, or whoever owns it, accepts #{artifact}.")
        if not may?(db, sender, "owner", artifact), do: raise("#{sender} doesn't own #{artifact} any more, so it isn't theirs to move.")
        movable!(db, artifact, renamed!(artifact, to))
        {to, sender}
      end)

    now = renamed!(artifact, to)
    moved!(call, artifact, to, now)
    told(call, [sender] -- [by], "#{short(artifact)} was moved to #{whom(to)}", "#{named(by)} accepted it. It's at #{now}.")
    %{artifact: artifact, to: to, now: now, state: "moved"}
  end

  def call("decline", %{"artifact" => artifact}, call) do
    by = asking(call)

    {to, sender} =
      transaction(call, fn db ->
        %{"receiver" => to, "sender" => sender} = waiting!(db, artifact)

        if by != sender and not mine?(db, by, to),
          do: raise("Only #{named(sender)}, who asked for it, or #{whom(to)}, or whoever owns it, declines #{artifact}.")

        query(db, "delete from transfers where artifact = ?", [artifact])
        {to, sender}
      end)

    told(call, [sender] -- [by], "#{short(artifact)} wasn't moved to #{whom(to)}", "#{named(by)} declined it.")
    %{artifact: artifact}
  end

  # The link is random, after whose the artifact is, and the tuple names it by its hash, as One Core names whoever
  # shows it. So the tuples don't hold the link, and nothing but the link gives it.
  def call("link", %{"artifact" => artifact} = inputs, call) do
    relation = Map.get(inputs, "relation", "viewer")
    owner = OneCore.User.owner(artifact) || raise "#{artifact} has no owner, so no link leads to it."
    link = owner <> "/" <> Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false)
    who = OneCore.User.link(link)

    transaction(call, fn db ->
      shares!(db, call, artifact, relation)
      query(db, "insert into tuples (artifact, relation, who) values (?, ?, ?)", [artifact, relation, who])
      %{link: link, who: who, relation: relation, artifact: artifact}
    end)
  end

  # What an artifact is called once it's moved to `to`: `<to>/made/<app>/<name>`. Raises for what no app made for someone,
  # for what isn't a user, a group or the network, and for what's `to`'s already.
  defp renamed!(artifact, to) do
    case Regex.run(@made, artifact) do
      [_, from, app, id] ->
        cond do
          User.owner(to) != to -> raise("#{to} isn't a user, a group or the network: users/<name>, groups/<name>, network")
          from == to -> raise("#{artifact} is #{whose(to)} already.")
          true -> "#{to}/made/#{app}/#{id}"
        end

      nil ->
        raise("#{artifact} isn't something an app made for someone: users/alice/made/notes/7")
    end
  end

  # Raises unless `to` is a user in the network, a group that's made, or the network.
  defp exists!(call, to) do
    here =
      case to do
        # Whoever sign-in lists, or whom the network's tuples name: a network being built lists nobody.
        "users/" <> _ ->
          to in for(%{"who" => who} <- OneCore.Call.tool(call, "sign-in", "everyone", %{})["people"], do: who) or
            to in OneCore.Call.tool(call, "permissions", "members", %{"of" => "network"})["members"]
        "groups/" <> _ -> transaction(call, &(query(&1, "select 1 from tuples where artifact = ? limit 1", [to]) != []))
        "network" -> true
      end

    if not here, do: raise("#{to} isn't in this network.")
  end

  # Raises unless the artifact can be moved to `now` as it is: it's there and not moved already, its app says it can be, nothing is at its new
  # name, and nothing of it is encrypted for its owner, whose key it's under: a key reaches someone else only by their
  # passkey, so it stays where it is.
  defp movable!(db, artifact, now) do
    blobs = Bucket.list(artifact <> "/")
    [_, owner, app, _id] = Regex.run(@made, artifact)
    version = OneCore.Apps.running(owner)[app]

    cond do
      moved = gone(db, artifact) ->
        raise("#{artifact} was moved to #{moved} already.")

      # What an app made may be tied to what it keeps, as the Vault's items are to its database, so only an app that
      # hears of the move (`permissions.transferred`) says it's safe to move what it made.
      not (version && "permissions.transferred" in version.hooks) ->
        raise("#{app} doesn't say that what it made can be moved to someone else, so #{artifact} stays #{whose(owner)}. An app says so by hooking permissions.transferred.")

      blobs == [] ->
        raise("There's nothing at #{artifact}.")

      Bucket.list(now <> "/") != [] ->
        raise("#{now} is something already. Whoever owns it renames or removes it first.")

      Bucket.size("#{owner}/made/encryption/encrypted/#{artifact}") != :absent or
          Enum.any?(blobs, &String.starts_with?(&1, artifact <> "/keys/")) ->
        raise(
          "#{artifact} is encrypted, and its key is #{whose(owner)}. A key reaches someone else only by their passkey " <>
            "and nothing hands one on yet, so it stays #{whose(owner)}."
        )

      true ->
        :ok
    end
  end

  # Moves the artifact: its blobs to the new name, then its tuples and where it went, and what waited for it is done.
  # Then every app that hooks the move is told, and one that couldn't hear it fails the call, saying who: it's moved
  # all the same.
  defp moved!(call, artifact, to, now) do
    from = User.owner(artifact)
    Bucket.move(artifact <> "/", now <> "/")

    transaction(call, fn db ->
      rename = "? || substr(%s, length(?) + 1)"

      query(db, "update or replace tuples set artifact = #{String.replace(rename, "%s", "artifact")} where #{under("artifact")}", [now, artifact, artifact, artifact, artifact])
      query(db, "update or replace tuples set who = #{String.replace(rename, "%s", "who")} where relation = 'parent' and #{under("who")}", [now, artifact, artifact, artifact, artifact])
      # Whoever it was whose, and whoever it's whose now, have it by its name: a tuple that says so is no more than that.
      query(db, "delete from tuples where relation = 'owner' and who in (?, ?) and #{under("artifact")}", [from, to, now, now, now])
      query(db, "delete from moved where old = ?", [now])
      query(db, "update moved set new = ? where new = ?", [now, artifact])
      query(db, "insert or replace into moved (old, new) values (?, ?)", [artifact, now])
      query(db, "delete from transfers where artifact = ?", [artifact])
    end)

    {:ok, _heard, unheard} = Hooks.collect("permissions.transferred", %{"artifact" => artifact, "to" => now}, {call.actor, to})

    if unheard != %{},
      do: raise("#{artifact} is moved to #{now}, but these didn't hear it: #{Enum.map_join(unheard, ", ", fn {app, why} -> "#{app} (#{why})" end)}.")
  end

  # SQL for whether `column` is a name, given twice more, or something under it: `users/alice`, `users/alice/made/notes/7`.
  defp under(column), do: "(#{column} = ? or substr(#{column}, 1, length(?) + 1) = ? || '/')"

  defp waiting!(db, artifact) do
    case query(db, "select receiver, sender from transfers where artifact = ?", [artifact]) do
      [waiting] -> waiting
      [] -> raise("Nothing is waiting to move #{artifact}. `transfers` lists what is.")
    end
  end

  # Whether `who` is `to`, or owns it: a group's or the network's owner, whoever a user is told apart from, or the
  # network's owner for anyone. It's who gives something to `to`, and who accepts it for them.
  defp mine?(db, who, to), do: who == to or may?(db, who, "owner", to)

  # What an artifact was moved to, if it was and nothing has been made at its old name since: its name there, below a moved
  # artifact's name.
  defp gone(db, artifact) do
    names = up(artifact)
    marks = Enum.map_join(names, ", ", fn _ -> "?" end)

    Enum.find_value(query(db, "select old, new from moved where old in (#{marks})", names), fn %{"old" => old, "new" => new} ->
      if Bucket.list(old <> "/") == [], do: new <> String.replace_prefix(artifact, old, "")
    end)
  end

  # Whoever accepts what's to be moved to `to`: a user, or the owners of a group or of the network.
  defp receivers(_db, "users/" <> _ = user), do: [user]
  defp receivers(db, to), do: Enum.filter(users_with(db, to, "owner"), &user?/1)

  # Tells each of them, as the network does, so whoever asks needn't share a group with them, which a person must to tell
  # someone. It's a notification, never an email.
  defp told(_call, [], _title, _text), do: :ok

  defp told(call, users, title, text) do
    as = %{call | actor: nil, subject: "network"}
    for to <- users, do: OneCore.Call.tool(as, "notifications", "send", %{"title" => title, "text" => text, "to" => to})
    :ok
  end

  # How people say an artifact and whoever it is: its app and its name, a name, `the family group`.
  defp short(artifact), do: artifact |> String.split("/") |> Enum.take(-2) |> Enum.join("/")
  defp app_of(artifact), do: artifact |> String.split("/") |> Enum.at(-2) |> String.split("-") |> Enum.map_join(" ", &String.capitalize/1)
  defp named(who), do: who |> String.split("/") |> List.last()
  defp whom("network"), do: "the network"
  defp whom("groups/" <> name), do: "the #{name} group"
  defp whom("users/" <> name), do: name
  defp whose(who), do: whom(who) <> "'s"

  # The users, and `everyone`, who have the relation to an artifact, through the groups they're in.
  defp users_with(db, artifact, relation) do
    up = followed(db, @parents, up(artifact), [])
    tuples = "select who as next from tuples where artifact = ? and relation in (?, ?, ?)"
    named = for at <- up, %{"next" => who} <- query(db, tuples, [at | Map.fetch!(@enough, relation)]), do: who
    Enum.sort(Enum.filter(followed(db, @members, named, []), &(user?(&1) or &1 == "everyone")))
  end

  # Raises unless whoever asks may write or remove a tuple with this relation to the artifact: an owner or an
  # editor shares up to their own relation, and only an owner adds or removes an owner, a member or a parent, or
  # says who installs apps: a group's members see what's made for it.
  defp shares!(db, call, artifact, relation) do
    owner = relation in ["owner", "member", "installer", "parent"]
    reaches!(db, asking(call), if(owner, do: "owner", else: "editor"), artifact)
  end

  # The network and a group are owned only by their owner tuples, so removing the last one leaves nobody who can
  # change who owns it. Whatever is a user's, by its name, has an owner whatever its tuples say. The network's first
  # owner is its owner whatever they say: the `owner` hook writes the tuple again each time the network is set up.
  defp keeps_an_owner!(db, artifact, "owner", who) do
    if artifact == "network" and OneCore.User.first_owner?(who),
      do: raise("#{who} is the network's first owner, and stays an owner: it's written again each time the network is set up.")

    others = query(db, "select who from tuples where artifact = ? and relation = 'owner' and who != ?", [artifact, who])

    if (artifact == "network" or String.match?(artifact, ~r{^groups/[^/]+$})) and others == [] and
         query(db, "select 1 from tuples where artifact = ? and relation = 'owner' and who = ?", [artifact, who]) != [],
       do: raise("#{who} is the last owner of #{artifact}. Make someone else its owner first.")
  end

  defp keeps_an_owner!(_db, _artifact, _relation, _who), do: :ok

  # Whoever asks: the call's actor, or whoever it runs for where nobody asked, as for a scheduled job.
  defp asking(call), do: call.actor || call.subject

  defp reaches!(db, who, relation, artifact) do
    if not may?(db, who, relation, artifact), do: raise("#{who} isn't #{a(relation)} of #{artifact}.")
  end

  # Whether `who` has the relation to the artifact. `whos` is everyone `who` counts as: themselves, everyone if
  # they're a user, and each group they're a member of, however far that goes. `up` is the artifact, what it's in, by
  # its name, and their parents, as far as those go, ending at the network: a tuple on `network/made/vault` is one on
  # each of the network's Vault items. Each step is one small question of the database, which is many times faster
  # than asking it all of this at once.
  defp may?(db, who, relation, artifact) do
    whos = followed(db, @groups, if(user?(who), do: [who, "everyone"], else: [who]), [])
    enough = Map.fetch!(@enough, relation)

    Enum.any?(followed(db, @parents, up(artifact), []), fn artifact ->
      named?(who, whos, relation, artifact) or Enum.any?(whos, &(query(db, @tuple, [artifact, &1 | enough]) != []))
    end)
  end

  # The artifact and what it's in, by its name, then the network: `network/made/vault/x1`, `network/made/vault`,
  # `network/made`, `network`.
  defp up(artifact) do
    parts = String.split(artifact, "/")
    Enum.uniq(for(n <- length(parts)..2//-1, do: Enum.join(Enum.take(parts, n), "/")) ++ ["network"])
  end

  # What an artifact's name says with no tuple: a user owns all that's theirs, and a group or the network what was
  # made for it, which their members see, as a GitHub organization's members read its repositories by default. Who
  # changes it is its owners, and whoever they share it with: `editor` of `network/made`, or of one app's,
  # `network/made/vault`.
  defp named?(who, whos, relation, artifact) do
    member_of = (whos -- [who]) ++ if(user?(who), do: ["network"], else: [])

    String.starts_with?(artifact, theirs(who)) or
      (relation == "viewer" and Enum.any?(member_of, &String.starts_with?(artifact, theirs(&1))))
  end

  # How the names start of what's a who's own with no tuple saying so: all of a user's, and what was made for a
  # group or the network. Their apps and what those keep are whoever owns them to say, with a tuple.
  defp theirs("users/" <> _ = user), do: user <> "/"
  defp theirs(who), do: who <> "/made/"

  # Whether `who` is in a group, themselves or through a group that is, or is a user asking about the network,
  # which every user is in.
  defp member?(db, who, of) do
    (of == "network" and user?(who)) or of in (followed(db, @groups, [who], []) -- [who])
  end

  # A user is in the network, as the holder of a link that leads to what's theirs isn't.
  defp user?(who), do: String.starts_with?(who, "users/") and not OneCore.User.link?(who)

  # Everything reached from `from` by following `next`, each once.
  defp followed(_db, _next, [], found), do: found

  defp followed(db, next, [one | rest], found) do
    if one in found,
      do: followed(db, next, rest, found),
      else: followed(db, next, rest ++ for(%{"next" => next} <- query(db, next, [one]), do: next), [one | found])
  end

  defp a("viewer"), do: "a viewer"
  defp a("member"), do: "a member"
  defp a("parent"), do: "a parent"
  defp a(relation), do: "an " <> relation

  # The database module goes with the database it opened, so one `query` serves every tool.
  defp transaction(call, fun) do
    database = OneCore.Call.app(call, "database")
    database.transaction(call, @schema, &fun.({database, &1}))
  end

  defp query({database, db}, sql, values), do: database.query(db, sql, values)
end
