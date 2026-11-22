defmodule GitHubSync do
  @moduledoc """
  GitHub Sync: every repo a GitHub team may push to, kept in the network's Git Repos and in step with GitHub, which
  stays the one source of truth. It reaches GitHub as a GitHub App, made with GitHub's manifest flow (`connect`),
  whose private key the network's Vault keeps.

  - GitHub to the network: each minute (`sync`), each of the team's repos is fetched and its branches and tags
    pushed into the network's repo of the same name, made the first time, through Git Repos' own `git` tool, as any
    push is. A repo the team no longer pushes to stops syncing, and its repo in the network stays as it was.
  - The network to GitHub: Git Repos asks this app before it keeps any change to a synced repo's refs
    (`git-repos.push`), which goes to GitHub first and is kept only if GitHub took it, so its branch rules hold and
    what it refuses is refused in its words. A pull request (`refs/pull/<name>`) is the branch `pull/<name>` on GitHub
    with a pull request from it, and is merged there.

  Who pushes is Git Repos' sharing, and this adds nothing to it.
  """
  @behaviour OneCore.App
  require Logger
  alias OneCore.{Artifact, Call}
  alias GitHubSync.GitHub

  # The Vault item that keeps the GitHub App's private key.
  @item "GitHub Sync"
  @zero GitHub.zero()

  @impl true
  def icon, do: "client/icon.svg"

  # What it keeps is the network's, one for everyone: which app it is, and when each repo last synced.
  @impl true
  def own, do: :installed

  @impl true
  def requires do
    %{
      "core" => ">= 0.34.403",
      "database" => "to keep when it last synced",
      "git-repos" => "to keep each GitHub repo in your network",
      "vault" => "to keep its GitHub App's key"
    }
  end

  @impl true
  def hooks, do: ["git-repos.push", "settings.sections"]

  @impl true
  def jobs, do: [%{tool: "sync", every: 60}]

  @impl true
  def tools do
    synced = %{
      type: "object",
      properties: %{
        github: %{type: "string", description: "The repo on GitHub: owner/name"},
        repo: %{type: "string", description: "The repo in the network, as Git Repos names it"},
        synced: %{type: ["integer", "null"], description: "When it last synced, in milliseconds since 1970"},
        error: %{type: ["string", "null"], description: "Why its last sync failed, if it did"}
      },
      required: ["github", "repo", "synced", "error"]
    }

    [
      %{
        name: "connect",
        description:
          "Makes this network's GitHub App from the code GitHub's manifest flow sends back, keeps its key in the network's Vault, and has every repo the GitHub team `team` pushes to sync. Only the network's owners connect it",
        inputs: %{
          type: "object",
          properties: %{
            code: %{type: "string", description: "The code GitHub sent back once the app was made"},
            team: %{type: "string", description: "The team whose repos sync, by its slug, like ptc-app"}
          },
          required: ["code", "team"]
        },
        outputs: %{
          type: "object",
          properties: %{
            app: %{type: "string", description: "The GitHub App's slug"},
            install: %{type: "string", description: "Where it's installed on the team's organisation"}
          },
          required: ["app", "install"]
        }
      },
      %{
        name: "repos",
        read_only: true,
        description: "Which GitHub repos sync with the network, and when each last synced",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{
            app: %{type: ["string", "null"], description: "The GitHub App's slug, or null before it's connected"},
            team: %{type: ["string", "null"], description: "The team whose repos sync: org/slug"},
            repos: %{type: "array", items: synced}
          },
          required: ["app", "team", "repos"]
        }
      },
      %{
        name: "sync",
        task_support: :optional,
        description: "Brings every synced repo up to date with GitHub now, as it's done each minute",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object", properties: %{repos: %{type: "array", items: synced}}, required: ["repos"]}
      }
    ]
  end

  @impl true
  def hook("settings.sections", _about, _call), do: [%{in: "app", component: "repos"}]

  def hook("git-repos.push", %{"repo" => repo} = about, call) do
    case {connected(call), record(call, repo)} do
      {app, %{"github" => full}} when app != nil -> push_through(call, app, full, about)
      _ -> :ok
    end
  end

  @impl true
  def call("connect", %{"code" => code, "team" => team}, call) do
    if not Call.owns?(%{call | subject: "network"}),
      do: raise(OneCore.Call.Refused, "Only the network's owners connect it to GitHub.")

    made = GitHub.convert(call, code)
    vault = Call.app(call, "vault")
    vault.keep(call, @item, %{"private_key" => made["pem"]}, ["api.github.com"])

    app = %{"id" => made["id"], "slug" => made["slug"], "org" => made["owner"]["login"], "team" => team}
    Artifact.update(call.own, "app.json", fn _ -> JSON.encode!(app) end)
    %{app: app["slug"], install: "https://github.com/apps/#{app["slug"]}/installations/new"}
  end

  def call("repos", _inputs, call) do
    app = connected(call)
    %{app: app && app["slug"], team: app && "#{app["org"]}/#{app["team"]}", repos: records(call)}
  end

  def call("sync", _inputs, call) do
    case connected(call) do
      nil ->
        %{repos: []}

      app ->
        token = token(call, app)
        fulls = GitHub.team_repos(call, token, app["org"], app["team"])
        names = Map.new(fulls, &{"network/made/git-repos/" <> name(&1), &1})

        # A repo the team no longer pushes to stops syncing.
        for %{"repo" => repo} <- records(call), not Map.has_key?(names, repo), do: Artifact.remove(call.own, "repos/" <> repo)

        there = MapSet.new(Call.tool(call, "git-repos", "list", %{})["repos"], & &1["repo"])

        for {repo, full} <- names do
          error =
            try do
              if repo not in there, do: Call.tool(call, "git-repos", "create", %{"name" => name(full)})
              pull(call, token, full, repo)
              nil
            rescue
              error ->
                Logger.warning("github-sync: #{full} didn't sync: #{Exception.message(error)}")
                Exception.message(error)
            end

          record = %{"github" => full, "repo" => repo, "synced" => if(error, do: record(call, repo)["synced"], else: now()), "error" => error}
          Artifact.update(call.own, "repos/" <> repo, fn _ -> JSON.encode!(record) end)
        end

        Call.changed(call)
        %{repos: records(call)}
    end
  end

  # GitHub's branches and tags, pushed into the network's repo where they differ, through Git Repos' `git` tool as
  # git itself would push them: each from where the network has it.
  defp pull(call, token, full, repo) do
    network = advertised(call, repo)

    {commands, pack} =
      GitHub.mirrored(call, full, token, fn folder ->
        github = GitHub.refs(folder)
        theirs = Map.filter(network, fn {ref, _} -> String.starts_with?(ref, ["refs/heads/", "refs/tags/"]) end)

        commands =
          for ref <- Enum.uniq(Map.keys(github) ++ Map.keys(theirs)), github[ref] != theirs[ref],
              do: {theirs[ref] || @zero, github[ref] || @zero, ref}

        wants = for {_old, new, _ref} <- commands, new != @zero, uniq: true, do: new
        {commands, if(wants == [], do: "", else: GitHub.pack(folder, wants, Enum.uniq(Map.values(network))))}
      end)

    if commands != [] do
      [first | rest] = for {old, new, ref} <- commands, do: "#{old} #{new} #{ref}"
      body = IO.iodata_to_binary([GitHub.pkt(first <> "\0report-status\n"), Enum.map(rest, &GitHub.pkt(&1 <> "\n")), "0000", pack])
      {:blob, _type, report} = Call.tool(call, "git-repos", "git", %{"repo" => repo, "path" => "git-receive-pack", "body" => Base.encode64(body)})
      refused = for "ng " <> refused <- GitHub.pkt_lines(report), do: refused
      if refused != [], do: raise("the network refused #{Enum.join(refused, "; ")}")
    end
  end

  # The refs of the network's repo, as a push is told them first.
  defp advertised(call, repo) do
    {:blob, _type, advertised} = Call.tool(call, "git-repos", "git", %{"repo" => repo, "path" => "info/refs?service=git-receive-pack"})
    GitHub.advertisement(advertised)
  end

  # A change to a synced repo goes to GitHub first: each ref only from where GitHub has it, which is where the network
  # has it, all or none. One GitHub has already, as what `sync` brings, has nothing to send.
  defp push_through(_call, _app, full, %{"merge" => pull_request}) when is_binary(pull_request),
    do: {:refuse, "#{pull_request} is merged on GitHub, where it's the pull request from pull/#{pull_request}: https://github.com/#{full}/pulls"}

  defp push_through(call, app, full, %{"updates" => updates} = about) do
    token = token(call, app)
    github = GitHub.advertised(call, token, full)

    moved =
      for %{"ref" => ref, "old" => old, "new" => new} <- updates,
          to = github_ref(ref),
          at = github[to] || @zero,
          at != new,
          do: {at, old, new, to}

    cond do
      moved == [] ->
        :ok

      Enum.any?(moved, fn {at, old, _new, _to} -> at != old end) ->
        {:refuse, "fetch first: it moved on GitHub since you fetched"}

      true ->
        pack = about["pack"] && Base.decode64!(about["pack"])

        case GitHub.receive_pack(call, token, full, for({at, _old, new, to} <- moved, do: {at, new, to}), pack) do
          :ok ->
            for {_at, _old, new, "refs/heads/pull/" <> name} <- moved, new != @zero,
                do: pull_request(call, token, full, about, name, new)

            :ok

          {:no, why} ->
            {:refuse, "GitHub refused it: #{why}"}
        end
    end
  end

  # A pull request in Git Repos is one on GitHub from its branch, which says who opened it and where.
  defp pull_request(call, token, full, %{"repo" => repo, "by" => by}, name, tip) do
    %{"people" => [person]} = Call.tool(call, "sign-in", "people", %{"users" => [by]})
    body = "Opened by #{person["called"] || by} as `#{name}` in Git Repos (`#{repo}`)."
    GitHub.pull_request(call, token, full, "pull/" <> name, GitHub.subject(call, token, full, tip), body)
  end

  # Where a ref of Git Repos' is on GitHub: a pull request's is its branch.
  defp github_ref("refs/pull/" <> name), do: "refs/heads/pull/" <> name
  defp github_ref(ref), do: ref

  # The app's key is the network's, in its Vault, and the app uses it as the network, as its jobs run, whoever's push
  # it's passing on: who may push is Git Repos' to say, before it asks.
  defp token(call, app) do
    network = %{call | actor: nil, subject: call.installed}
    GitHub.token(call, app["id"], app["org"], Call.app(network, "vault").value(network, @item, "private_key"))
  end

  # The GitHub App this network made, once it's connected.
  defp connected(call) do
    case Artifact.read(call.own, "app.json") do
      {:ok, data, _tag} -> JSON.decode!(data)
      :absent -> nil
    end
  end

  defp record(call, repo) do
    case Artifact.read(call.own, "repos/" <> repo) do
      {:ok, data, _tag} -> JSON.decode!(data)
      :absent -> nil
    end
  end

  defp records(call) do
    keys = Artifact.list(call.own, "repos/")
    for {:ok, data, _tag} <- Artifact.read_all(call.own, keys), do: JSON.decode!(data)
  end

  # A GitHub repo's name in the network: as Git Repos names repos, lowercase letters, digits, - and _.
  defp name(full),
    do: full |> String.split("/") |> List.last() |> String.downcase() |> String.replace(~r/[^a-z0-9_-]+/, "-") |> String.trim("-")

  defp now, do: System.system_time(:millisecond)
end
