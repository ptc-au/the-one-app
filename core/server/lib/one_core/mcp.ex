defmodule OneCore.Mcp do
  @moduledoc """
  Answers what a client asks, in MCP's JSON-RPC: a message in, and its answer out. So a server is an MCP server to
  whatever reaches it, and the tools it lists are One Core's own and those of the apps installed for whoever asks
  and for the network.

  Every request is from someone and for someone, which `OneCore.Mcp.Principal.asking/3` says, and an app's tool runs for
  them.

  Servers ask each other the same way, and four things only a server acting for whoever it asks for may ask: to call a
  function of an app's service running here (`services/call`), and to run what was passed on of a service's
  call into its app (`apps/call`), of an app's hook (`hooks/call`) or of having an app's scheduled jobs
  called (`apps/schedule`).

  A webhook is the other way in: an address at the network's edge that anyone a service is given it may ask, with
  nobody signed in (`OneCore.Apps.Webhooks`). It's `webhooks/http`, which runs the app's `webhook/2` for whoever the
  address leads to, and what came in at it is the app's to answer. A request that came in at one says which webhook it
  is in `_meta`, and asks for that one and nothing else.

  What of an app runs in a client, its folder `client/`, is MCP resources: `ui://<app>/<code>/<path>`, where
  `code` names the set of files a version runs, so a file at an address never changes. What a page loads is listed,
  an app's entrypoints among it as an MCP App is, and the rest of `client/` is read by name. The UI library every app
  loads is One Core's own, the one this server ships with, at `ui://ui/<its code>/client/<path>` (`OneCore.Entrypoint`).

  Skills are served as MCP's Skills Extension says (SEP-2640), in the shapes it gives for the protocol versions a
  server speaks: `skills/list` lists them, `skills/get` gives one by its address, and each of a skill's files is
  a resource too, `skill://<path>/<file>`, which `resources/read` reads (`OneCore.Skills`).

  A tool its app makes a task (`task_support`) is answered as MCP's Tasks have it, to a client that says it takes
  them (`OneCore.Tasks`), and every call is in a state while it runs (`OneCore.Call.State`): a client cancels one
  that isn't a task with `notifications/cancelled`, and is told what it's doing in its progress notifications.

  What happens in an app, which its `events/0` declares, is MCP's Events (`OneCore.Events`): `events/list` lists the
  events of the apps installed for whoever asks, `events/poll` says what happened since a cursor, and
  `events/subscribe` has each one sent to an address, as Standard Webhooks says. Each runs where the app's database
  is, as its tools do.

  An agent's client chooses how it calls tools, by what its requests say (`_meta.mode`), which the CLI says for
  `one mcp --code` and the network's address for `/mcp?code`. With none, every tool is listed, and `skills`, and the
  client finds tools itself, as Claude Code's tool search and the model APIs' deferred tools do. In code mode, as
  Executor's MCP server has it, only `search`, which finds them (`OneCore.Search`), `execute`, which runs a script that
  calls them, `call`, which calls them without one (`OneCore.CodeMode`), and `skills` (`OneCore.Skills`). `one search`
  says `cli`, for calls written as commands.
  """
  require Logger

  alias OneCore.{
    Entrypoint,
    Artifact,
    Builds,
    Edge,
    Events,
    Hooks,
    Apps,
    Protocol,
    Server,
    Servers,
    Services,
    Skills,
    Tasks,
    Tools,
    User,
    Writes
  }

  alias OneCore.Call.State
  alias OneCore.Mcp.Principal
  alias OneCore.Apps.{Calls, Icons, Store, Version, Webhooks}

  # The rules every agent is told first, here and in the network's `/llms.txt` (`core/edge/mcp/mcp.ts`).
  @external_resource Path.expand("../../priv/rules.md", __DIR__)
  @rules File.read!(Path.expand("../../priv/rules.md", __DIR__))

  # Claude Code keeps only the first 4,096 characters of a server's instructions, so they stay under that.
  @instructions_limit 4000

  # What a server speaks of MCP is the same in each of these. A client of the versions since 2026-07-28 says its
  # version in each request (`_meta`), and one of the earlier ones in `initialize`.
  @versions ~w(2026-07-28)
  @initialized ~w(2025-11-25 2025-06-18 2025-03-26 2024-11-05)

  @capabilities %{
    tools: %{},
    resources: %{},
    extensions:
      Map.merge(%{"io.modelcontextprotocol/skills" => %{}}, Map.merge(Tasks.extension(), Events.extension()))
  }

  # What a client keeps a list or a file of these for, before it asks again: none of it, since who's asking and
  # what's installed for them changes what's there.
  @cacheable ~w(server/discover tools/list resources/list resources/read)

  # The page of the Home Screen that draws a widget, which every widget's tool shows its answer on.
  @widget_page "client/widget.html"

  # A local network's code reloader (`tooling/code_reloader.exs`), its `:reloader` setting, loads what a
  # developer changed before a client's request is answered, as Phoenix's code reloader does before a request in
  # development. A server's request, which names who it acts for, came from a client's that was.
  defp reloaded(%{"actor" => _}), do: :ok

  defp reloaded(_meta) do
    case Application.get_env(:one_core, :reloader) do
      nil -> :ok
      {module, function, arguments} -> apply(module, function, arguments)
    end
  end

  @doc """
  The answer to one message from whoever holds the key `from`, as JSON. A notification's is empty. `ask` is the
  message as this server took it, which says what a call it asks for is doing while it runs (`OneCore.Iroh`), with
  the build of the NIF that took it, which is the one it's used with: `{nif, ask}`.
  """
  def handle(message, from, ask \\ nil) do
    case JSON.decode(message) do
      # MCP's ping is about this server and nobody else, so it's answered whoever asks, on whatever version, before
      # anyone is asked who they are, saying which build it is.
      {:ok, %{"method" => "ping", "id" => id}} ->
        JSON.encode!(%{
          jsonrpc: "2.0",
          id: id,
          result: %{_meta: %{"io.modelcontextprotocol/serverInfo" => server_info()}}
        })

      {:ok, %{"method" => method, "id" => id} = request} ->
        params = Map.get(request, "params", %{})
        if method == "tools/call", do: OneCore.Release.called()
        # What a call it asks for is cancelled by, and where its progress is told.
        Process.put(:"$one_request", %{
          request: {from, User.device(from, meta(params)), id},
          ask: ask,
          client: client(from, meta(params))
        })

        version = meta(params)["io.modelcontextprotocol/protocolVersion"]

        try do
          # The span it's under, W3C's `traceparent`, or none: a call run here next is its child.
          OpenTelemetry.Ctx.clear()
          :otel_propagator_text_map.extract(Enum.filter(meta(params), &match?({"traceparent", parent} when is_binary(parent), &1)))

          with :ok <- speaks(version),
               :ok <- talks(method, params),
               :ok <- confined(method, meta(params)),
               {:ok, principal, forwarded} <-
                 Principal.asking(from, asking(method, meta(params)), question?(method, params), relations(method, params)),
               :ok <- reloaded(meta(params)),
               {:ok, result} <- result(method, params, from, principal, forwarded) do
            JSON.encode!(%{jsonrpc: "2.0", id: id, result: complete(result, method, version)})
          else
            {:error, why} ->
              JSON.encode!(%{jsonrpc: "2.0", id: id, error: %{code: -32000, message: why}})

            {:error, code, why} ->
              JSON.encode!(%{jsonrpc: "2.0", id: id, error: %{code: code, message: why}})

            {:error, code, why, data} ->
              JSON.encode!(%{jsonrpc: "2.0", id: id, error: %{code: code, message: why, data: data}})
          end
        rescue
          error ->
            Logger.error(OneCore.Redact.format(:error, error, __STACKTRACE__))
            message = Exception.message(OneCore.Redact.redact(error))
            JSON.encode!(%{jsonrpc: "2.0", id: id, error: %{code: -32603, message: OneCore.Apps.fault(message)}})
        catch
          # What exits, as a call that took too long does, is answered too: only a server that went away answers
          # nothing.
          :exit, why ->
            Logger.error(OneCore.Redact.format(:exit, why, __STACKTRACE__))
            message = Exception.format_exit(OneCore.Redact.redact(why))
            JSON.encode!(%{jsonrpc: "2.0", id: id, error: %{code: -32603, message: OneCore.Apps.fault(message)}})
        end

      # A client saying an app of its is on screen, and where a server reaches it, or with no address, that none is,
      # with the device it runs for, where it proves one as a request does.
      {:ok, %{"method" => "notifications/one/watch", "params" => params} = notification} when from != nil ->
        device = User.device(from, meta(params))
        Server.watch(from, notification["params"]["address"], if(device != from, do: device))
        ""

      # A client saying what it measured of itself, as from the device and person its request proves it is, which
      # is all that's believed of who said it.
      {:ok, %{"method" => "notifications/one/measured", "params" => %{} = params}} ->
        with {:ok, {by, _for}, false} <- Principal.asking(from, meta(params)) do
          said = if params["otlp"], do: %{"otlp" => List.wrap(params["otlp"])}, else: %{"records" => List.wrap(params["records"])}
          about = Map.merge(said, %{"device" => User.device(from, meta(params)), "who" => by})
          Hooks.observe("measured", about, {nil, User.owner(by)})
        end

        ""

      # The network's updater, through the relay at the network's address, saying where the network's update is and
      # what each server is to do: only the edge says it.
      {:ok, %{"method" => "notifications/one/update", "params" => %{} = update}} when from == nil ->
        # Where this server is to deploy its build's edge, the apps that deploy it do (`OneCore.Release.edge/0`): only
        # on one of the network's own servers, which runs them, as a person's own server passing it on is refused.
        deploys = Servers.here?("network") and Hooks.hooking("edge", "network") != []

        if OneCore.Release.instructed(update, deploys) == :deploy_edge,
          do: Hooks.observe("edge", %{"build" => OneCore.Builds.build()}, {nil, "network"})

        ""

      # What the network's own say of what servers keep: its edge (by its relay, or an app's edge function), this
      # server itself, or another server of the network. A device tells servers nothing of it, so what one says is
      # ignored.
      {:ok, %{"method" => "notifications/one/" <> said} = notification}
      when said in ["seen", "invalidate", "reload", "changed"] ->
        if from == nil or Servers.acts_for(from) != [], do: told(said, notification["params"] || %{})
        ""

      # A client cancelling a call it asked for that isn't a task, by the request's id, as only it may.
      {:ok, %{"method" => "notifications/cancelled", "params" => %{"requestId" => id} = params}} ->
        State.cancel_request({from, User.device(from, meta(params)), id})
        ""

      # A client going away before its answer, by the request's id: the network's edge says it for one over the web,
      # and this server's connections (`one_core_iroh`) for one that asked here.
      {:ok, %{"method" => "notifications/one/gone", "params" => %{"requestId" => id} = params}} ->
        State.gone({from, User.device(from, meta(params)), id})
        ""

      {:ok, %{"method" => _notification}} ->
        ""

      _ ->
        JSON.encode!(%{jsonrpc: "2.0", id: nil, error: %{code: -32700, message: "That isn't a JSON-RPC request"}})
    end
  end

  # The relay at the network's address saying one of its servers came or went, or said what it is (`moved` false).
  defp told("seen", params), do: Servers.presence_again(:all, params["moved"] != false)

  # Another server, or an app's edge function, saying that what this one kept of some hooks was decided from what has
  # since changed.
  defp told("invalidate", params), do: Hooks.invalidate(for hook <- List.wrap(params["hooks"]), is_binary(hook), do: hook)

  # Another server saying there's something new in the bucket for some owners, in some apps if it says which, or with
  # no owners, this server saying it can reach its network's address again.
  defp told("reload", %{"owners" => owners} = params) when owners != nil do
    # Each app with its new version, where the server that deployed it says (`versions`), which isn't read again.
    versions = if is_map(params["versions"]), do: params["versions"], else: %{}

    only =
      if is_list(params["apps"]),
        do: for(app <- params["apps"], is_binary(app), into: %{}, do: {app, deployed_version(versions[app])}),
        else: :all

    deployed = for {name, at} <- params["deployed"] || %{}, is_binary(name) and is_integer(at), into: %{}, do: {name, at}
    for owner <- List.wrap(owners), User.owner?(owner), do: Apps.reload(owner, only, if(deployed != %{}, do: deployed))
  end

  defp told("reload", _params), do: Apps.reconnected()

  # Another server saying where an app is in its life for someone moved, which this one's clients ask again.
  defp told("changed", params),
    do: Apps.changed(for owner <- List.wrap(params["owners"]), is_binary(owner), User.owner?(owner), do: owner)

  # An app's new version as the server that deployed it said (`versions`): its number, code and whether it's trusted.
  defp deployed_version(%{"number" => number, "code" => code} = version) when is_integer(number) and is_binary(code),
    do: Map.take(version, ["number", "code", "trusted"])

  defp deployed_version(_version), do: nil

  # What a request says of itself.
  defp meta(%{"_meta" => %{} = meta}), do: meta
  defp meta(_params), do: %{}

  # Which client asked (`OneCore.Call.client/1`): the device it's from, whether it came in at the network's address
  # over the web, and the name and title its MCP client says it goes by in each request from MCP's 2026-07-28. A
  # server passing on what it was asked says which client asked it, which is believed as it's believed about who
  # asked (`OneCore.Mcp.Principal.asking/3`).
  defp client(_from, %{"actor" => _actor, "client" => %{} = client}), do: client

  defp client(from, meta) do
    said = with %{} = info <- meta["io.modelcontextprotocol/clientInfo"], do: info, else: (_ -> %{})
    named = fn key -> with name when is_binary(name) <- said[key], do: name, else: (_ -> nil) end
    %{"device" => User.device(from, meta), "web" => from == nil, "name" => named.("name"), "title" => named.("title")}
  end

  # Who a request is from and for, as it says. A task is only whoever started it's, so a client checking on one, or
  # answering or cancelling it, asks as themselves, whoever it runs for: that's what the task says, not the request.
  # A hook that validates or mutates is asked a question, whose answer goes only to whoever asked
  # (`OneCore.Mcp.Principal.asking/3`).
  defp question?("hooks/call", %{"kind" => kind}), do: kind in ["validate", "mutate"]
  defp question?(_method, _params), do: false

  # What whoever asked is to be of whoever else a request is for: their member, or for a tool of One Core's that
  # changes what's installed for them, their installer too (`OneCore.Mcp.Principal`), who lists their tools as a
  # client does before it calls one, and whose install's moments a server asks another's apps about (a hook).
  defp relations(method, _params) when method in ["tools/list", "hooks/call"], do: ["member", "installer"]

  defp relations("tools/call", %{"name" => name}) do
    if Enum.find(OneCore.Tools.Definitions.tools(), &(&1.name == name))[:installs],
      do: ["member", "installer"],
      else: ["member"]
  end

  defp relations(_method, _params), do: ["member"]

  defp asking("tasks/" <> _method, %{"actor" => _actor} = meta), do: meta
  defp asking("tasks/" <> _method, meta), do: Map.delete(meta, "subject")
  defp asking(_method, meta), do: meta

  # A request with no version is of a client that said its version in `initialize`, or of a server.
  defp speaks(nil), do: :ok
  defp speaks(version) when version in @versions, do: :ok

  defp speaks(version),
    do: {:error, -32022, "Unsupported protocol version", %{supported: @versions, requested: version}}

  # Parts of the platform talk where the protocols they speak overlap (`OneCore.Protocol`): a server, a client and the
  # edge each say theirs as `_meta.protocol`, and a request of one that speaks none this server does is refused before
  # anything of it is read, as MCP refuses a protocol version it doesn't speak (-32022), saying the range this one
  # speaks. The refusal says this server's build too, by which a client from before parts said their protocol (0.24 to
  # 0.26) knows it's the one to update. What updates a part that's behind is answered whatever it speaks, as an app
  # store always lets an old app update, since it's how a part catches up: the builds it downloads, an update, the
  # task an update is followed by (`tasks/get`, as a client's Update follows it), the list of tools a client reads
  # before it calls one, and which builds run, by which the program keeping a server running, still the build before,
  # tells a build it tries answers (`clients/cli/src/serving.rs`). That's this exception's whole list, and it's
  # permanent: a client of any version must always be able to update.
  defp talks(method, _params) when method in ["tools/list", "tasks/get"], do: :ok
  defp talks("tools/call", %{"name" => name}) when name in ["builds", "download", "update"], do: :ok

  defp talks(_method, params) do
    theirs = Protocol.of(meta(params)["protocol"])

    if Protocol.speaks?(theirs) do
      :ok
    else
      here = Servers.name(Server.key()) || "This server"
      speaks = "#{here} speaks protocol #{Protocol.name(Protocol.range())}, and what asked #{Protocol.name(theirs)}"

      why =
        if Protocol.behind?(theirs),
          do: "#{speaks}, which is older: they talk once what asked is updated (`one update`)",
          else: "#{speaks}, which is newer: they talk once #{here} is updated"

      {:error, -32022, why, %{supported: Protocol.range(), requested: theirs, version: Builds.build()}}
    end
  end

  # A request that came in at a public webhook's address (`OneCore.Apps.Webhooks`) says which webhook it is, and asks
  # only for that one to run: nobody is signed in there, and everything else this server answers is for someone. A
  # server that runs the app elsewhere passes on what it was asked, as it does any call (`OneCore.Call`).
  defp confined("webhooks/http", %{"webhook" => _}), do: :ok
  defp confined("webhooks/http", %{"actor" => _}), do: :ok

  defp confined("webhooks/http", _meta),
    do: {:error, -32024, "Only a webhook, or a server passing one on, asks for a webhook to be run"}

  defp confined(method, %{"webhook" => _}),
    do: {:error, -32024, "A webhook asks only for its own webhook to be run, and this asks for #{method}"}

  defp confined(_method, _meta), do: :ok

  # A result to a client of a version that says what kind of result it is, and how long it may keep it.
  defp complete(result, _method, nil), do: result

  defp complete(result, method, _version) when is_map(result) do
    result = put_new(result, :resultType, "complete")
    if method in @cacheable, do: result |> put_new(:ttlMs, 0) |> put_new(:cacheScope, "private"), else: result
  end

  defp complete(result, _method, _version), do: result

  # A result is this server's, keyed by atoms, or another server's that it passed on, keyed by strings.
  defp put_new(result, key, value) do
    if Map.has_key?(result, key) or Map.has_key?(result, Atom.to_string(key)),
      do: result,
      else: Map.put(result, key, value)
  end

  # What another server asks of this one for whoever it acts for, which `Principal.asking/3` checked, as one check
  # for every kind: a service's function, an app's function or scheduled job, and a hook.
  defp result("services/call", %{"app" => app, "service" => service} = params, _from, _principal, forwarded) do
    between(forwarded, fn -> Services.run(app, service, params["function"], params["arguments"]) end)
  end

  defp result("apps/call", %{"installed" => at, "app" => app} = params, _from, principal, forwarded) do
    between(forwarded, fn -> Calls.function(at, app, params["function"], params["arguments"], principal, true) end)
  end

  # A group's server asks one of the network's for its word that it acts for a member of the group, which the
  # presigner takes as it does a device's token (`OneCore.Edge.token/2`): it's given only by a server acting for the
  # network, for whoever the apps that decide `reach` say is a member.
  defp result("servers/token", %{"who" => who}, from, {_actor, group}, forwarded) do
    between(forwarded, fn ->
      about = %{"who" => who, "relation" => "member", "artifact" => group}

      cond do
        not (Servers.here?("network") and String.starts_with?(group, "groups/") and group in Servers.acts_for(from)) ->
          {:error, "Only one of the network's servers vouches for a group's server, and only for the group's members"}

        Hooks.validate("reach", about, {nil, "network"}) != :ok ->
          {:error, "#{who} isn't a member of #{group}"}

        true ->
          {:ok, Edge.token(from, who)}
      end
    end)
  end

  defp result("apps/schedule", %{"installed" => at, "app" => app}, _from, {_actor, subject}, forwarded) do
    between(forwarded, fn -> Calls.schedule(at, app, subject, true) end)
  end

  defp result(
         "hooks/call",
         %{"installed" => at, "app" => app, "kind" => kind, "hook" => hook} = params,
         _from,
         principal,
         forwarded
       )
       when kind in ["observe", "mutate", "validate", "collect"] do
    between(forwarded, fn ->
      Calls.hook(at, app, String.to_existing_atom(kind), hook, params["about"], principal, true)
    end)
  end

  # A webhook, which came in at the app's address at the network's edge: it runs the app's `webhook/2` for whoever the
  # address leads to, and what it answers is the HTTP answer the edge sends whoever asked (`OneCore.Apps.Webhooks`).
  defp result("webhooks/http", %{"request" => request} = params, _from, {_actor, owner}, forwarded) do
    with :ok <- if(forwarded != false or is_map_key(meta(params), "webhook"), do: :ok, else: {:error, :forbidden, "Only a webhook, or a server passing one on, asks for a webhook to be run"}),
         {:ok, webhook, app, name} <- Webhooks.asked(params, owner),
         {:ok, request} <- Webhooks.request(request, name) do
      case Calls.webhook(app, webhook, request, {owner, owner}, forwarded) do
        {:ok, answer} -> Webhooks.answered(answer)
        {:error, :not_found, why} -> {:error, -32023, why}
        {:error, why} -> {:error, why}
      end
    else
      {:error, :forbidden, why} -> {:error, -32024, why}
      {:error, :not_found, why} -> {:error, -32023, why}
      {:error, :invalid, why} -> {:error, -32602, why}
    end
  end

  defp result("tools/call", %{"name" => name} = params, from, principal, forwarded) do
    with {:ok, principal, params} <- whose(name, params, principal, forwarded),
         {:ok, caller} <- caller(name, meta(params), principal, from) do
      {_actor, subject} = principal
      request = %{mode: mode(params), tools: fn -> scripted(principal) end, call: called(from, principal, forwarded)}

      found = tool(name, subject)

      run = fn ->
        inputs = Map.get(params, "arguments", %{})
        unkept(aged(paged(rendered(name, call(name, inputs, principal, forwarded, caller, request), principal), name, found, principal), found), found)
      end

      # A write asked again isn't run again, and what it answered is kept for when it is (`OneCore.Writes`).
      write = Writes.asked(meta(params), from, Process.get(:"$one_request", %{})[:client], subject, acting(meta(params), principal))
      outcome = asked(found, name, run, params, principal, caller, write)
      Writes.answered(write, outcome)
      outcome
    else
      {:error, why} -> rendered(name, {:error, why}, principal)
    end
  end

  defp result("tasks/" <> method, params, _from, principal, forwarded) when method in ["get", "update", "cancel"] do
    cond do
      not Tasks.capable?(params) -> Tasks.required()
      true -> with({:forwarded, result} <- Tasks.handle(method, params, principal, forwarded), do: {:ok, result})
    end
  end

  defp result("initialize", params, _from, {actor, subject}, _forwarded) do
    requested = params["protocolVersion"]

    {:ok,
     %{
       protocolVersion: if(requested in @initialized, do: requested, else: hd(@initialized)),
       capabilities: @capabilities,
       serverInfo: server_info(),
       instructions: instructions(if(holder?(actor), do: :holder, else: mode(params)), subject)
     }}
  end

  # What a client of a version since 2026-07-28 may ask first, or to tell whether a server speaks one at all.
  defp result("server/discover", params, _from, {actor, subject}, _forwarded) do
    {:ok,
     %{
       supportedVersions: @versions,
       capabilities: @capabilities,
       _meta: %{"io.modelcontextprotocol/serverInfo" => server_info()},
       instructions: instructions(if(holder?(actor), do: :holder, else: mode(params)), subject)
     }}
  end

  # A user's device asks for its token to the relay at the network's address, and for the next before that one
  # ends, and is told whose it is: the device a run of it proved here, or the edge did there. It says which
  # build it is as it asks, which is kept in the bucket after it's answered: a device waits a few seconds for its
  # token, and a slow bucket would otherwise keep it from joining at all.
  defp result("one/token", params, from, {"users/" <> _ = by, _for}, _forwarded) do
    device = User.device(from, meta(params))

    if not User.link?(by) and is_binary(device) and device =~ ~r/^[0-9a-f]{64}\z/ do
      Task.Supervisor.start_child(OneCore.Asks, fn -> Builds.seen(by, device, params["build"]) end)
      {:ok, %{token: Edge.token(device), who: by}}
    else
      {:error, "A token is for a user's device, by its key"}
    end
  end

  # A sharing link's holder is told of the tools they may call, and of nothing else that's in the network.
  defp result("tools/list", params, _from, principal, _forwarded) do
    {:ok, %{tools: listed(principal, mode(params))}}
  end

  defp result("skills/list", _params, _from, principal, _forwarded),
    do: {:ok, %{resultType: "complete", skills: skills(principal)}}

  # MCP's Events, as its extension has them (`OneCore.Events`): the events of the apps installed for whoever asks,
  # what happened since a cursor, and an address that's sent each one.
  defp result("events/list", params, _from, {_actor, subject}, _forwarded), do: Events.list(params, subject)
  defp result("events/poll", params, _from, principal, forwarded), do: Events.poll(params, principal, forwarded)
  defp result("events/subscribe", params, _from, principal, forwarded), do: Events.subscribe(params, principal, forwarded)
  defp result("events/unsubscribe", params, _from, principal, forwarded), do: Events.unsubscribe(params, principal, forwarded)

  defp result("skills/get", params, _from, principal, _forwarded) do
    case Enum.find(skills(principal), &(&1.uri == params["uri"])) do
      nil -> {:error, -32602, "There's no skill at #{params["uri"]}. skills/list says what there is."}
      skill -> {:ok, %{resultType: "complete", skill: skill}}
    end
  end

  defp result("resources/" <> _ = method, params, _from, {actor, subject}, _forwarded) do
    if holder?(actor),
      do: {:error, -32002, "A sharing link's holder reads nothing of a network but what a tool gives them"},
      else: resources(method, params, subject)
  end

  defp result(method, _params, _from, _principal, _forwarded),
    do: {:error, -32601, "This server has no method #{method}"}

  # Who a call of an app's tool is for, where whoever asks asks for themselves: the copy of the app it's of that `for`
  # names, or the narrowest (`copies/1`), unless that's one of two or more groups', which `for` then says. A group's
  # runs for the group, by whoever asked, once they may ask for it as they would by naming it (`OneCore.Mcp.Principal`).
  # Their own, or else the network's, runs for them, as any of theirs does. A call another server passed on was
  # decided there, and a request that names whose it is says it already.
  defp whose(name, params, {actor, actor} = principal, false) do
    arguments = Map.get(params, "arguments") || %{}

    with [app, tool] <- String.split(name, "_", parts: 2),
         false <- Enum.any?(Tools.tools(), &(&1.name == name)),
         [{first, version} | _] = having <- having(copies(principal)[app] || [], tool) do
      owners = Enum.map(having, &elem(&1, 0))

      cond do
        length(having) == 1 or takes_for?(version, tool) ->
          ran(first, arguments, params, principal)

        owner = arguments["for"] ->
          if owner in owners,
            do: ran(owner, Map.delete(arguments, "for"), params, principal),
            else: {:error, "`for` is whose #{app} it is, one of #{Enum.join(owners, ", ")}"}

        owner = chosen(having) ->
          ran(owner, arguments, params, principal)

        true ->
          {:error, "#{app} is installed for more than one of your groups, so say which, as `for`: #{Enum.join(owners, ", ")}"}
      end
    else
      _ -> {:ok, principal, params}
    end
  end

  defp whose(_name, params, principal, _forwarded), do: {:ok, principal, params}

  defp ran("groups/" <> _ = group, arguments, params, {actor, _subject}) do
    with :ok <- Principal.acts(actor, group, relations("tools/call", params)),
         do: {:ok, {actor, group}, Map.put(params, "arguments", arguments)}
  end

  defp ran(_owner, arguments, params, principal), do: {:ok, principal, Map.put(params, "arguments", arguments)}

  # The copies of the apps whoever asks reaches, by each app's name, narrowest first: someone asking for themselves
  # those of the groups they're in too (`OneCore.Apps.copies/1`), which they'd otherwise reach only by asking for the
  # group, as an assistant such as claude.ai's can't. A request for someone else, a group or the network, reaches
  # theirs.
  defp copies({actor, actor}), do: Apps.copies(actor)
  defp copies({_actor, subject}), do: Map.new(Apps.running(subject), fn {name, version} -> {name, [{subject, version}]} end)

  # The copies that have the tool `tool`.
  defp having(copies, tool), do: Enum.filter(copies, fn {_owner, version} -> Enum.any?(version.tools, &(&1.name == tool)) end)

  # The copy a call that doesn't say `for` runs, of those that have its tool: the narrowest, or `nil` where that's
  # one of two or more groups'.
  defp chosen([{owner, _} | rest]) do
    groups = &match?({"groups/" <> _, _}, &1)
    if groups.({owner, nil}) and Enum.any?(rest, groups), do: nil, else: owner
  end

  # Whether an app's tool takes an input `for` of its own, as Server Debug's does, which is then its own: it's
  # called for the narrowest copy, and ours isn't added.
  defp takes_for?(version, tool) do
    found = Enum.find(version.tools, &(&1.name == tool))
    properties = found.inputs[:properties] || found.inputs["properties"] || %{}
    is_map_key(properties, :for) or is_map_key(properties, "for")
  end

  # Who acts for a write asked here (`OneCore.Writes.asked/5`), a group's servers for its members too
  # (`OneCore.Apps.covering/1`): whether this server does for whose it is, and so keeps its key, and, for one asked
  # again, the servers that could have been asked it first, any of which may have run it.
  defp acting(%{"idempotencyKey" => _} = meta, {actor, subject}) do
    owner = User.owner(subject)
    owners = Enum.reject(Enum.uniq(Enum.map([actor, subject], &User.owner/1)), &is_nil/1)
    asked = if meta["resent"] == true, do: Enum.uniq(Enum.flat_map(owners, &Apps.covering/1)), else: []
    %{here: owner != nil and Apps.here?(owner), asked: asked}
  end

  defp acting(_meta, _principal), do: nil

  # A skill is listed here too, for an agent whose client lists resources and not yet skills.
  defp resources("resources/list", _params, who) do
    skills =
      for %{uri: uri, frontmatter: %{"name" => name, "description" => description}} <- Skills.list(who),
          do: %{uri: uri, name: name, description: description, mimeType: "text/markdown"}

    # Each copy of an app whoever asks reaches (`OneCore.Apps.copies/1`), a group's too: its tools' pages are under
    # its own version.
    running = Enum.uniq(for {app, copies} <- Enum.sort(Apps.copies(who)), {_owner, version} <- copies, do: {app, version})

    # A tool's page is listed as an entrypoint's is, under its app's name, with the runtime version it says, but
    # with no icon: it isn't an app on a device's list of them (`clients/app/src/shortcuts.rs`).
    uis =
      Map.new(
        for {app, version} <- running, %{ui: ui} = tool when is_binary(ui) <- version.tools,
            do: {{app, ui}, %{name: version.title, runtime_version: tool[:runtime_version]}}
      )
      |> Map.put_new({"home-screen", @widget_page}, %{name: "Widget"})

    %{files: files, code: code} = Entrypoint.library()

    library =
      for path <- Enum.sort(Map.keys(files)),
          Version.loaded?(path),
          do: %{uri: "ui://ui/#{code}/#{path}", name: path, mimeType: Version.kind(path)}

    resources =
      for {app, version} <- running, hashes = Version.hashes(version), path <- Version.files(version) do
        resource = %{uri: "ui://#{app}/#{version.code}/#{path}", name: path, mimeType: Version.kind(path)}

        # What's in it, by its SHA-256, so a client that has the same file of a version before keeps that rather than
        # read it again. A page is served with its import map in it (`mapped`), so it's read each time.
        hash = if Path.extname(path) != ".html", do: hashes[path]
        resource = if hash, do: Map.put(resource, :_meta, %{sha256: Base.encode16(hash, case: :lower)}), else: resource

        # An entrypoint's category goes as it is: a client opens the launcher first, and what the rest mean is the
        # launcher's. A page that's a tool's UI is an MCP App's page too, and so is its menu bar extra's, whose icon
        # a computer's client puts in its menu bar (`menuBarExtra`).
        extra = if version.menu_bar_extra && version.menu_bar_extra.page == path, do: version.menu_bar_extra

        case Enum.find(version.entrypoints, &(&1.page == path)) || uis[{app, path}] ||
               (extra && %{name: version.title, runtime_version: extra.runtime_version}) do
          nil ->
            %{resource | mimeType: String.replace_suffix(resource.mimeType, ";profile=mcp-app", "")}

          # Whether its app is trusted goes too: the client lets only a trusted app's page change the device
          # or ask for someone else (`clients/app/page/bridge.js`). So does the runtime version its native page needs
          # (`runtimeVersion`), which a native host that has it draws itself, and one that hasn't says it needs updating.
          entrypoint ->
            Map.merge(resource, %{
              name: entrypoint.name,
              icons: if(entrypoint[:icon], do: [%{src: entrypoint.icon}], else: []),
              _meta:
                Map.reject(
                  %{
                    category: entrypoint[:category],
                    trusted: version.trusted,
                    runtimeVersion: entrypoint[:runtime_version] || (extra && extra.runtime_version),
                    menuBarExtra: extra && %{icon: extra.icon}
                  },
                  &match?({_, nil}, &1)
                )
            })
        end
      end

    {:ok, %{resources: skills ++ library ++ resources}}
  end

  defp resources("resources/read", %{"uri" => "skill://" <> _ = uri}, who) do
    case Skills.text(who, uri) do
      {:ok, text} -> {:ok, %{contents: [%{uri: uri, mimeType: "text/markdown", text: text}]}}
      :absent -> {:error, -32602, "There's no skill at #{uri}. skills/list says what there is."}
    end
  end

  defp resources("resources/read", %{"uri" => "ui://ui/" <> _ = uri}, _who) do
    library = Entrypoint.library()

    with ["ui:", "", "ui", code, path] when code == library.code <- String.split(uri, "/", parts: 5),
         true <- Version.client?(path),
         %{^path => data} <- library.files do
      {:ok, %{contents: [Map.merge(%{uri: uri, mimeType: Version.kind(path)}, content(data))]}}
    else
      _ -> {:error, -32002, "There's nothing at #{uri}"}
    end
  end

  defp resources("resources/read", %{"uri" => "ui://icons/" <> _ = uri}, _who) do
    case Icons.read(uri) do
      {:ok, kind, data} -> {:ok, %{contents: [Map.merge(%{uri: uri, mimeType: kind}, content(data))]}}
      :absent -> {:error, -32002, "There's nothing at #{uri}"}
    end
  end

  defp resources("resources/read", %{"uri" => uri}, who) do
    with ["ui:", "", app, code, path] <- String.split(uri, "/", parts: 5),
         true <- Version.client?(path),
         {_owner, version} <- Enum.find(Apps.copies(who)[app] || [], &(elem(&1, 1).code == code)),
         {:ok, data} <- Store.file(version.artifact, code, path) do
      data = if Path.extname(path) == ".html", do: mapped(data, path, [app | Map.keys(version.requires)]), else: data
      {:ok, %{contents: [Map.merge(%{uri: uri, mimeType: Version.kind(path)}, content(data))]}}
    else
      _ -> {:error, -32002, "There's nothing at #{uri}"}
    end
  end

  defp resources(method, _params, _who), do: {:error, -32601, "This server has no method #{method}"}

  # A page, with the import map its modules are resolved by in its head, before anything loads: what every app shares
  # by name, the UI library's one copy, which an app's build already imports by where it's served (`core/ui/app.js`),
  # and as `<app>/` the client of its own app and of each app it requires, which a client serves beside it, at
  # <its address>/<app>/client/, for what's imported by name as it runs. So separately built apps share one
  # Solid. It depends on nothing but the page's own version, so the page is still read once.
  @shared %{
    "solid-js" => "/ui/client/solid.js",
    "solid-js/internal" => "/ui/client/internal.js",
    "@solidjs/web" => "/ui/client/web.js",
    "ui" => "/ui/client/ui.js"
  }
  defp mapped(page, path, apps) do
    up = String.duplicate("../", length(Path.split(path)))
    imports = Map.merge(@shared, Map.new(apps, &{"#{&1}/", "#{up}#{&1}/client/"}))
    map = ~s(<script type="importmap">#{JSON.encode!(%{imports: imports})}</script>)

    case Regex.split(~r/<!doctype html>|<head(?:\s[^>]*)?>/i, page, parts: 2, include_captures: true) do
      [before, tag, rest] -> before <> tag <> map <> rest
      [_page] -> map <> page
    end
  end

  # A file that isn't text, such as a picture or a font, is base64 as MCP's `blob`.
  defp content(data), do: if(String.valid?(data), do: %{text: data}, else: %{blob: Base.encode64(data)})

  # What one server asks of another is run only for a server that says who it asks for, which only one acting
  # for them is believed about. This server runs it if it acts for whoever it's for too.
  defp between(forwarded, run) when forwarded in [true, :to] do
    case run.() do
      {:ok, result} -> {:ok, %{answer: result}}
      {:error, why} -> {:error, -32000, why}
      {:forwarded, result} -> {:ok, result}
      :forwarding_loop -> Server.forwarding_loop("that")
    end
  end

  defp between(_forwarded, _run), do: {:error, -32000, "Only a server acting for whoever it asks for may ask that"}

  # A script waits on each call it makes, so none is a task.
  defp called(from, principal, forwarded),
    do: fn name, inputs ->
      result("tools/call", %{"name" => name, "arguments" => inputs, script: true}, from, principal, forwarded)
    end

  # The tools a script has, and that `search` finds among: those every client is listed but code mode's own, and but
  # those a device fills in with what only it holds, its own key, which a script on a server has none of. An agent calls those as plain tools on the device (`one mcp`, `one encryption …`).
  defp scripted(principal), do: Enum.reject(listed(principal, :mcp), &on_device?/1)

  @on_device ~w(device device-name)

  defp on_device?(tool),
    do: Enum.any?(Map.values(tool.inputSchema[:properties] || %{}), &(&1[:format] in @on_device))

  # How whoever asks calls tools: as MCP's tools, in a code mode script, or as commands.
  defp mode(params) do
    case meta(params)["mode"] do
      "code" -> :code
      "cli" -> :cli
      _ -> :mcp
    end
  end

  # Every tool there is for whoever asks as `mode` lists them, One Core's own first, or only those a sharing link's
  # holder may call. Code mode lists only One Core's that say so (`OneCore.Tools`). An app's says whose it is, and one
  # with a page of its own names it as an MCP App's tool names its UI, and the address its screen is at, its `path`.
  # One whose app they reach more than one copy of (`copies/1`) takes `for`, whose it is (`whose/4`), listed once by
  # the narrowest copy that has it.
  defp listed({actor, _subject} = principal, mode) do
    holder = holder?(actor)
    open = fn tools -> if holder, do: Enum.filter(tools, &(&1[:by_link] == true)), else: tools end

    listed = fn name, tool ->
      listed = %{
        name: name,
        description: tool.description,
        inputSchema: tool.inputs,
        annotations: %{readOnlyHint: tool[:read_only] == true}
      }

      if tool[:outputs], do: Map.put(listed, :outputSchema, tool.outputs), else: listed
    end

    own =
      for tool <- open.(Tools.tools()),
          holder or if(mode == :code, do: tool[:listed] in [:code, :always], else: tool[:listed] != :code),
          do: listed.(tool.name, tool)

    apps =
      for {app, copies} <- Enum.sort(copies(principal)),
          holder or mode != :code,
          tool <- Enum.uniq_by(Enum.flat_map(copies, &open.(elem(&1, 1).tools)), & &1.name) do
        ui = if tool[:ui] || tool[:widget], do: %{:ui => %{resourceUri: router()}, "openai/outputTemplate" => router()}, else: %{}
        ui = if tool[:ui] && tool[:path], do: Map.put(ui, :path, tool.path), else: ui
        meta = if is_list(tool[:changes]), do: Map.put(ui, :changes, changes(app, tool.changes)), else: ui
        listed = Map.put(listed.("#{app}_#{tool.name}", tool), :_meta, Map.put(meta, :app, app))
        having = having(copies, tool.name)
        if length(having) > 1 and not takes_for?(elem(hd(having), 1), tool.name), do: with_for(listed, app, having), else: listed
      end

    own ++ apps
  end

  # A tool's schema with `for`, whose copy of `app` it's called for, of those it's in, as whoever asks names them.
  defp with_for(listed, app, having) do
    owners = Enum.map(having, &elem(&1, 0))
    default = chosen(having)

    said =
      if default,
        do: "Whose #{app} this is for: #{Enum.join(owners, ", ")}. Left out, it's #{default}'s.",
        else: "Whose #{app} this is for: #{Enum.join(owners, ", ")}. It's installed for more than one of your groups, so say which."

    # A schema an untrusted app said is JSON, by text, and one in Elixir by atoms: `for` is said the same way.
    schema = listed.inputSchema
    key = if Enum.any?(Map.keys(schema), &is_binary/1), do: &Atom.to_string/1, else: & &1
    property = %{key.(:type) => "string", key.(:enum) => owners, key.(:description) => said}
    schema = Map.update(schema, key.(:properties), %{key.(:for) => property}, &Map.put(&1, key.(:for), property))
    schema = if default, do: schema, else: Map.update(schema, key.(:required), ["for"], &(&1 ++ ["for"]))
    %{listed | inputSchema: schema}
  end

  # The page an assistant shows every app's tool with a page of its own in, as one MCP App (Sentry's MCP server's
  # charts share one): a router, which opens the page the tool's answer says (`paged`) with our renderer, and what a
  # link in it opens, as the web client does. The network's edge writes it (`core/edge/mcp/mcp.ts`), where whoever let
  # the assistant in has their apps' files. It's named by this build, so an assistant that keeps a page reads it again
  # once it may have changed.
  defp router, do: "ui://one/#{Builds.build()}/app.html"

  # Which app called a tool is said only by a server that runs the apps of whoever it asks for, its subject: one
  # acting for them (a request that says its `actor`). Any other server's call is its person's. A client calls as nobody's app, unless it says an app's page asked
  # (`app`, which the app's window says of each page: `clients/app/page/bridge.js`). A trusted app's page then calls
  # as its person does, since its server code may do anything they may. An untrusted app's calls as its server code
  # does in its sandbox (`OneCore.Sandbox`): its own app's tools as its person, the tools of the apps it requires as
  # itself, and nothing else. A client may say an app asked that didn't, which is its person's to do, and gives them
  # nothing they couldn't do themselves.
  defp caller(_name, %{"actor" => _} = meta, {_actor, subject}, from),
    do: {:ok, if(Apps.acts_for?(from, User.owner(subject) || "network"), do: meta["caller"])}

  defp caller(name, %{"app" => app}, {actor, subject}, _from) when is_binary(app) do
    # The app is whoever the page was opened for's, or for a trusted app, the person's own, asking for someone else.
    version = Apps.versions(Enum.uniq(Apps.chain(subject) ++ Apps.chain(actor)))[app]
    tool = Enum.find(Tools.tools(), &(&1.name == name))
    called = if tool == nil, do: hd(String.split(name, "_", parts: 2))

    cond do
      version == nil ->
        {:error, "#{app} isn't installed for whoever its page asked for, so its page calls nothing"}

      version.trusted or called == app ->
        {:ok, nil}

      is_map_key(version.requires, called) ->
        {:ok, version.artifact}

      true ->
        why = if called, do: "its requires/0 doesn't name #{called}", else: "#{name} is One Core's own"

        {:error,
         "#{app}'s page may not call #{name}: #{app} is installed untrusted, and #{why}. An untrusted app's page " <>
           "calls the tools of only its own app and the apps it requires."}
    end
  end

  defp caller(_name, _meta, _principal, _from), do: {:ok, nil}

  # Runs the call of `tool`, named `name`, by `run`. A tool made a task (`task_support`) is one for a person's client
  # that takes tasks, and refused to one that doesn't if it needs one. A script's calls are never tasks, since it
  # waits on each.
  defp asked(tool, name, run, params, {actor, _subject} = principal, caller, write) do
    case Tasks.support(tool) do
      support when support != nil and is_binary(actor) and caller == nil and not is_map_key(params, :script) ->
        cond do
          Tasks.capable?(params) and not User.link?(actor) -> Tasks.start(run, name, principal, write)
          support == :required -> Tasks.required()
          true -> plainly(run, write)
        end

      _never ->
        plainly(run, write)
    end
  end

  # A call that isn't a task, run in the process answering it, which its client cancels by the request's id. One
  # cancelled is answered as MCP has a cancelled request: it's said, and its client has stopped listening. A script's
  # call is in the state its run began for it, which cancels it when the run stops (`OneCore.CodeMode`).
  defp plainly(run, write) do
    case State.current() do
      {_id, %{state: :asked}} ->
        run.()

      _none ->
        asked = Process.get(:"$one_request", %{})
        id = State.begin(asked |> Map.take([:request, :ask, :client]) |> Map.put(:write, write))

        try do
          run.()
        after
          State.finish(id)
        end
    end
  end

  # What MCP's `tools/call` answers of a call: its answer, the error it ended with, or another server's answer.
  defp rendered(name, outcome, principal) do
    case outcome do
      {:ok, result} -> changed(name, answer(name, result), principal)
      {:error, why} -> {:ok, %{content: [%{type: "text", text: why}], isError: true}}
      {:error, why, details} -> {:ok, %{content: [%{type: "text", text: why}], structuredContent: details, isError: true}}
      # Another server ran it and told every client watching, as each watches every server. This one may not
      # know the tool, as while its apps load, so it can't tell whether it only read.
      {:forwarded, result} -> {:ok, result}
      :forwarding_loop -> Server.forwarding_loop(name)
      # A write asked again that isn't run here (`OneCore.Writes`).
      {:not_run, why} -> {:error, Writes.not_run(), why}
    end
  end

  # What an app's tool with a page of its own answered says which page shows it (`_meta.page`, `<app>/<path>`), which
  # the page an assistant shows every app's tool in opens (`router/0`), and which tool it was (`_meta.tool`), which
  # that page is told as MCP Apps' `toolInfo`, as the screen it shows is that tool and what it was given. A call made
  # for someone else than its caller, a group whose app it is, says for whom (`_meta.subject`): the page is that
  # app's, and asks for them too.
  defp paged({:ok, %{} = result}, name, %{ui: ui}, {actor, subject}) when is_binary(ui) do
    meta = %{page: "#{hd(String.split(name, "_", parts: 2))}/#{ui}", tool: name}
    {:ok, with_meta(result, if(subject == actor, do: meta, else: Map.put(meta, :subject, subject)))}
  end

  # A widget's tool answers a layout, which the Home Screen draws (`@widget_page`), at the size it was asked for or its
  # first, and says its name and sizes (`_meta.widget`) as a Home Screen page's card has them. One that shows what only
  # time changes says how often it's asked again (`refresh`, in seconds), which is how long a client takes it as fresh
  # (`_meta.maxAge`, as HTTP's `Cache-Control: max-age`), where it keeps other answers until a server says they changed.
  defp paged({:ok, %{} = result}, name, %{widget: widget}, {actor, subject}) do
    meta = Map.merge(%{page: "home-screen/#{@widget_page}", tool: name, widget: widget}, max_age(result))
    {:ok, with_meta(result, if(subject == actor, do: meta, else: Map.put(meta, :subject, subject)))}
  end

  defp paged(outcome, _name, _tool, _principal), do: outcome

  # Its layout's `refresh` as `maxAge`: this server's answer has `structuredContent`, another's decoded "structuredContent".
  defp max_age(result) do
    layout = Map.get(result, :structuredContent) || Map.get(result, "structuredContent")
    refresh = is_map(layout) && (Map.get(layout, "refresh") || Map.get(layout, :refresh))
    if is_number(refresh) and refresh > 0, do: %{maxAge: refresh}, else: %{}
  end

  # What a tool that says `max_age` answered says how long it's fresh, in seconds (`_meta.maxAge`), as it does for a
  # widget's, which a client then asks again by its age (`stale` in `core/client/src/cache.rs`).
  defp aged({:ok, %{} = result}, %{max_age: seconds}) when is_number(seconds),
    do: {:ok, with_meta(result, %{maxAge: seconds})}

  defp aged(outcome, _tool), do: outcome

  # What a tool that says `no_store` answered says no device may keep it (`_meta.noStore`), as HTTP's
  # `Cache-Control: no-store` does: what an encrypted item holds.
  defp unkept({:ok, %{} = result}, %{no_store: true}),
    do: {:ok, with_meta(result, %{noStore: true})}

  defp unkept(outcome, _tool), do: outcome

  # `result` with `more` in its `_meta`, beside what's there: another server's answer, decoded, says it as "_meta", and
  # a write's that was done already keeps there what only its device opens (`OneCore.Writes`).
  defp with_meta(%{"_meta" => meta} = result, more),
    do: %{result | "_meta" => Map.merge(meta, Map.new(more, fn {k, v} -> {to_string(k), v} end))}

  defp with_meta(result, more), do: Map.update(result, :_meta, more, &Map.merge(&1, more))

  # The tool `name` is for `who`, with what One Core's own take and give read as its schemas.
  defp tool(name, who), do: Calls.find(name, who, Tools.tools())

  # A tool is one of One Core's own, or an app's by its name and the app's.
  defp call(name, inputs, principal, forwarded, caller, request) do
    with :none <- Tools.call(name, inputs, principal, forwarded, request),
         [app, tool] <- String.split(name, "_", parts: 2),
         {:ok, result} <- Calls.call(app, tool, inputs, principal, forwarded, caller) do
      {:ok, result}
    else
      [_] -> {:error, "#{name} isn't a tool. tools/list says what there is."}
      other -> other
    end
  end

  # An answer as MCP's result: what it is as JSON, `structuredContent`, with the same as text for a client from before
  # that, as MCP says. A file is content of its kind, and its `structuredContent` says what kind of file it is. A
  # tool of a version from before tools said what they answer may answer text, which is only text.
  defp answer(_name, text) when is_binary(text), do: %{content: [%{type: "text", text: text}]}

  # An answer that's only text is read as that text, which JSON would put on one line.
  defp answer(_name, %{text: text} = answer) when map_size(answer) == 1,
    do: %{content: [%{type: "text", text: text}], structuredContent: answer}

  defp answer(name, {:content, answer, parts}) do
    answered = answer(name, answer)
    %{answered | content: answered.content ++ parts}
  end

  defp answer(name, file) when is_tuple(file),
    do: %{content: file(name, file), structuredContent: Calls.structured(file)}

  defp answer(_name, answer) do
    structured = Calls.structured(answer)
    result = %{content: [%{type: "text", text: JSON.encode!(structured)}]}
    if is_map(structured), do: Map.put(result, :structuredContent, structured), else: result
  end

  # A picture is an image, which an agent that sees pictures sees, and any other file is a resource inside the answer,
  # unless it's large.
  defp file(_name, {:blob, "image/" <> _ = kind, data}),
    do: [%{type: "image", mimeType: kind, data: Base.encode64(data)}]

  defp file(name, {:blob, kind, data}),
    do: [%{type: "resource", resource: %{uri: "one://#{name}", mimeType: kind, blob: Base.encode64(data)}}]

  # A large file is a short-lived link to its blob in the bucket, under the blob's key, which never names another.
  defp file(_name, {:file, kind, %Artifact{prefix: prefix} = artifact, blob}) do
    [%{type: "resource_link", uri: Artifact.link(artifact, blob, :read).url, name: prefix <> blob, mimeType: kind}]
  end

  # After a tool that doesn't only read, every client connected here is told that something changed: the tool's
  # app, or anything for One Core's own. An app's tool that says which of its reads it changes (`changes`) tells
  # only those, and one that says none tells nobody.
  defp changed(name, result, {_actor, subject}) do
    tool = Calls.find(name, subject, Tools.Definitions.tools())

    case tool do
      %{read_only: true} -> :ok
      %{changes: []} -> :ok
      %{changes: [_ | _] = reads} -> Apps.changed([], app(name), nil, changes(app(name), reads))
      _ -> Apps.changed([], app(name))
    end

    {:ok, result}
  end

  # The names a client knows an app's tools by, for the ones its tool says it changes.
  defp changes(app, reads), do: Enum.map(reads, &"#{app}_#{&1}")

  defp app(name) do
    if not Enum.any?(Tools.tools(), &(&1.name == name)), do: hd(String.split(name, "_", parts: 2))
  end

  defp holder?(by), do: by != nil and User.link?(by)

  defp server_info, do: %{name: "one", version: Builds.build()}

  # A sharing link's holder sees no skill.
  defp skills({actor, subject}), do: if(holder?(actor), do: [], else: Skills.list(subject))

  # What an agent is told when it connects: the rules first, then how it finds tools as it calls them, then where
  # the skills are, which say the rest, and the apps there are, as many as fit. Not every client lists skills yet,
  # and any reads one that it has the address of.
  defp instructions(mode, who) do
    network = """
    This is a network of the One App: what one user, family or workplace keeps and makes, which you use as whoever you act \
    for. Its tools are its apps', each named <app>_<tool>, and One Core's own, which add and remove apps, \
    servers and services.

    Rules, before anything else:
    #{String.trim(@rules)}\
    """

    finding =
      case mode do
        :code ->
          """
          `search` finds the tools for a task across every app, with each one's exact call in a script and its \
          app's skill: search before you guess, to learn an app, and before saying you can't, since it offers \
          apps you could install. `call` calls one or several at once, by their paths, and `execute` runs a short \
          script where one call's answer feeds the next, `const r = await tools.<app>.<tool>({ ... }); return r`: \
          what it returns comes back to you. Skills name tools <app>_<tool>, which in a script is \
          tools.<app>.<tool>, and One Core's own are tools.<tool>.\
          """

        _ ->
          """
          Every tool is listed, and your client's own tool search finds them. Where `one` runs, every tool is also a \
          command: gmail_search is `one gmail search`, and `one search <words>` finds the tools for a task and offers \
          apps you could install: use it before saying you can't.\
          """
      end

    skills = """
    An app's skill says when and how to use its tools, and the skill building-apps how to make an app: when \
    the person asks for an app, tracker or tool, make it here, where it's on all their devices. `skills` lists them \
    and reads one, as do skills/list and resources/read: an app's are under skill://<app>/, and building-apps \
    is skill://building-apps/SKILL.md.\
    """

    case mode do
      :holder -> network
      _ -> fitted(Enum.join([network, finding, skills], "\n\n"), Enum.sort(Map.keys(Apps.copies(who))))
    end
  end

  # The instructions, with the apps there are, as many as fit under the limit.
  defp fitted(text, []), do: text

  defp fitted(text, apps) do
    more = ", and more: `skills` lists them."
    instructions = text <> "\n\nThe apps here, whose tools start with their names: "

    Enum.reduce_while(apps, {instructions, ""}, fn app, {instructions, sep} ->
      if length16(instructions <> sep <> app <> more) > @instructions_limit,
        do: {:halt, {instructions <> more, :full}},
        else: {:cont, {instructions <> sep <> app, ", "}}
    end)
    |> case do
      {instructions, :full} -> instructions
      {instructions, _sep} -> instructions <> "."
    end
  end

  # What Claude Code counts a length in: UTF-16's units.
  defp length16(text), do: div(byte_size(:unicode.characters_to_binary(text, :utf8, :utf16)), 2)
end
