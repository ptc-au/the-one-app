defmodule Encryption do
  @moduledoc """
  Encryption: a kind of artifact whose blobs are encrypted before they're stored, so that whoever runs the bucket
  can't read them, and nor can a server its owner didn't choose.

  An encrypted artifact's key is its owner's to give. Their key is made on the network's sign-in page, the first
  time their passkey unlocks it, and kept only encrypted to their passkeys and the devices they let in, in an
  artifact this app makes for them, so no server ever holds it. A server opens an artifact once its owner's passkey
  handed it the artifact's keys there, encrypted to the server's own key, as the blobs `keys/<server>` in the
  artifact (`store`), with a relation tuple naming it. A server that holds none passes a call on to one that does,
  and reads nothing.

  What a device does is the client's (`apps/encryption/client/native/src/lib.rs`), and what each thing is encrypted with is
  `apps/encryption/client/native/src/cipher.rs`, which a server runs too (`Cipher`).
  """
  @behaviour OneCore.App
  alias Encryption.Keys
  alias OneCore.{Artifact, Call, Hooks, Server, Servers, User}
  alias OneCore.Apps.Calls

  # Every device's key is kept with it, and the Vault and notifications use it.
  @impl true
  def icon, do: "icon.svg"

  # It reads which apps run inside a call as `call.loaded` names them.
  @impl true
  def requires,
    do: %{
      "core" => ">= 0.35.34",
      "database" => "to keep when it last checked who holds your keys",
      "telemetry" => "to raise an alert while a server that acts for you is waiting for your key",
      "sign-in" => "to tell a device that can hold your key, an app's, from a browser or an assistant, which can't"
    }

  # Whether each server that should hold what's encrypted for someone does, said to Telemetry (`check`).
  @impl true
  def jobs, do: [%{tool: "check", every: 600}]

  # Nothing looks into it as it runs (`server-debug`): what it's given and keeps are keys, and what they decrypt.
  @impl true
  def sensitive, do: true

  # Whether a device of the app holds your key is a group on its page in Settings.
  @impl true
  def hooks, do: ["settings.sections", "renamed"]

  @impl true
  def hook("settings.sections", _about, _call), do: [%{in: "device", component: "device", kinds: ["app"]}]

  # Someone renamed keeps the key they had, sealed by the name it was made under (`keyed/1`), and what's encrypted for
  # them is listed by its new name. Asked for the network or a group, its key is wrapped for them by their new name.
  def hook("renamed", %{"who" => old, "to" => new}, %Call{subject: new}) do
    key = key_of(new)
    if Artifact.read(key, "check") != :absent and Artifact.read(key, "name") == :absent, do: Artifact.write(key, "name", old)

    for name <- Artifact.list(index(new)), String.starts_with?(name, old <> "/") do
      Artifact.write(index(new), new <> String.replace_prefix(name, old, ""), "")
      Artifact.remove(index(new), name)
    end

    nil
  end

  def hook("renamed", %{"who" => old, "to" => new}, %Call{subject: scope}) do
    with {:ok, wrapped, _tag} <- Artifact.read(key_of(scope), "owners/" <> old) do
      Artifact.write(key_of(scope), "owners/" <> new, wrapped)
      Artifact.remove(key_of(scope), "owners/" <> old)
    end

    nil
  end

  @doc """
  The name `owner`'s key was made under, which what's sealed with it names (`client/native/src/cipher.rs`), and what an
  artifact's keys are made from: their name now, unless they were renamed after it was made.
  """
  def keyed(owner) do
    case Artifact.read(key_of(owner), "name") do
      {:ok, name, _tag} -> name
      :absent -> owner
    end
  end

  @doc "An artifact's name as its keys were made from it: under the name its owner's key was made under (`keyed/1`)."
  def keyed_name(name) do
    owner = User.owner(name)
    keyed = keyed(owner)
    if keyed == owner, do: name, else: keyed <> String.replace_prefix(name, owner, "")
  end

  defp key_of(owner), do: %Artifact{prefix: "#{owner}/made/encryption/key/"}


  @doc """
  `artifact`, encrypted: its blobs are encrypted as they're written and opened as they're read, by everything that
  uses what this gives. Only a server the artifact's owner chose gives it. Any other has a server that was chosen and
  acts for whose it is run the call instead, which ends here with that server's answer, and raises if none is up,
  saying which servers should hold its keys and don't (`access/1`).
  """
  def encrypted(%Call{} = call, %Artifact{codec: nil} = artifact) do
    name = Artifact.name(artifact)
    keys = Call.process(call, Keys, name, {%{artifact | reached: nil}, call.server})

    with :ok <- chosen(call, name, call.server),
         {:ok, codec} <- GenServer.call(keys, :keys) do
      %{artifact | codec: codec}
    else
      refused ->
        # A server that's no longer chosen lets go of the keys it held, whatever still holds them.
        with {:refuse, _why} <- refused, do: GenServer.call(keys, :forget)
        should = should(name)
        held = servers(artifact)
        # Only a server that both holds its keys and acts for whose it is runs the call. With none but this one, it
        # isn't passed on: one passed here already would come back as a loop, and say no server answered.
        others = Enum.filter(held, &(&1 in should)) -- [call.server]
        if others != [], do: :no_response = Call.forward(call, others)
        waiting(call, should, held)
        # Nothing failed: it can't run until a passkey hands the key over, so it isn't an error to Telemetry.
        raise Call.Refused, unopened(name, should, held)
    end
  end

  # A job of someone's own that no server that acts for them can open the key for waits until their passkey hands it
  # over, and they're told to use it, once while it waits (`Sign-In`'s `check`). Whoever is there to read a call's
  # answer needs no notification.
  defp waiting(%Call{subject: "users/" <> _} = call, should, held) do
    if Call.client(call) == nil and Enum.all?(held, &(&1 not in should)),
      do: Call.tool(call, "sign-in", "check", %{"waiting" => for(server <- should, do: %{"key" => server, "name" => Servers.name(server)})})
  end

  defp waiting(_call, _should, _held), do: nil

  # Why nothing opens an encrypted artifact for a call: which servers that act for whose it is lack its keys, and which
  # hold them but don't act for them, so can't run the call.
  defp unopened(name, should, held) do
    owner = User.owner(name)
    open = Enum.filter(held, &(&1 in should))

    said =
      cond do
        held == [] -> "#{name} is encrypted, and no server holds #{whose(owner)} key for it yet."
        open == [] -> "#{name} is encrypted, and no server that acts for #{whom(owner)} holds #{whose(owner)} key for it."
        true -> "#{name} is encrypted, and no server that may open it is up: #{named(open)}."
      end

    Enum.join([said | gaps(owner, should -- held, held -- should)], " ")
  end

  # What's missing of an owner's servers holding an artifact's keys, as a person reads it, a sentence each: `missing`
  # act for them and wait for the keys, and `extra` hold them and don't act for them.
  defp gaps(owner, missing, extra) do
    Enum.map(missing, &"#{named([&1])} is waiting for #{whose(owner)} key.") ++
      Enum.map(extra, &"#{named([&1])} holds #{whose(owner)} key and no longer acts for #{whom(owner)}.")
  end

  defp named(servers), do: servers |> Enum.map(&(Servers.name(&1) || String.slice(&1, 0, 8))) |> Enum.join(", ")
  defp whom("network"), do: "the network"
  defp whom(owner), do: owner |> String.split("/") |> List.last()
  defp whose(owner), do: whom(owner) <> "'s"

  @doc """
  The keys of the servers that should hold an encrypted artifact's keys: those acting for whose it is, as scopes nest,
  their own first, then a group's they're in, then the network's (`OneCore.Apps.covering/1`). They're who run its
  calls, so one that lacks them can't, and one that holds them and isn't here has access it doesn't need.
  """
  def should(name), do: OneCore.Apps.covering(User.owner(name))

  @doc """
  How each artifact encrypted for `owner` stands: its epoch, the servers that hold its keys, those that should and don't
  (`missing`), and those that hold them and shouldn't (`extra`), each with what its machine is called, and each of
  those as a person reads it (`problems`). An artifact is known once a server that should hold its keys ran a call of it (`Encryption.Keys`).
  """
  def access(owner) do
    # Each artifact's blobs are read at once, and every artifact at once: a bucket that's far away, as R2 is from a
    # server in Australia, takes a round trip for each (2 s for one artifact, read one by one, on 23 Nov).
    Artifact.list(index(owner))
    |> Task.async_stream(&standing(owner, &1), max_concurrency: 16, timeout: :infinity)
    |> Enum.map(fn {:ok, standing} -> standing end)
  end

  defp standing(owner, name) do
    artifact = %Artifact{prefix: name <> "/"}
    epoch = Task.async(fn -> epoch(artifact) end)
    held = servers(artifact)
    should = should(name)
    {missing, extra} = {should -- held, held -- should}

    %{
      artifact: keyed_name(name),
      epoch: Task.await(epoch, :infinity),
      servers: names(held),
      missing: names(missing),
      extra: names(extra),
      problems: gaps(owner, missing, extra)
    }
  end

  defp names(servers), do: for(server <- servers, do: %{key: server, name: Servers.name(server)})

  @doc "Where the artifacts encrypted for `owner` are listed: an empty blob each, named by the artifact."
  def index(owner), do: %Artifact{prefix: "#{owner}/made/encryption/encrypted/"}

  @doc """
  Lists an artifact with what's encrypted for its owner (`access/1`), where `server` should hold its keys, as one that
  acts for its owner and so writes their blobs, whether or not it holds them yet; once, as it's first used or looked at.
  """
  def known(name, server) do
    index = index(User.owner(name))

    if server in should(name) and Artifact.read(index, name) == :absent,
      do: Artifact.write(index, name, "")
  end

  # Whether the artifact's owner chose a server: a relation tuple names it as an `editor`, which the apps that
  # decide `reach` say. One Core keeps their answer, so a call asks once.
  defp chosen(call, artifact, server) do
    about = %{"who" => "servers/" <> server, "relation" => "editor", "artifact" => artifact}
    Hooks.validate("reach", about, {call.actor, call.subject})
  end

  @doc "The keys of the servers that hold an artifact's keys."
  def servers(%Artifact{} = artifact) do
    for "keys/" <> server <- Artifact.list(%{artifact | codec: nil}, "keys/"),
        server =~ ~r/^[0-9a-f]{64}$/,
        do: server
  end

  @doc """
  What a device needs of an artifact to encrypt for it, for an app's read-only tool to answer: the artifact's
  name, its `epoch`, the `servers` that open it, by their keys, and the ones that `may` be chosen, which are those
  that act for whose it is (`should/1`),
  each with what its machine is called.
  """
  def unlocked_on(%Call{} = call, %Artifact{} = artifact) do
    # Known from the first look, so the passkey that first makes its owner's key hands its keys too, before any call of
    # it. Its blobs are read at once, as `access/1`'s are.
    [_known, epoch, servers, signed] =
      [fn -> known(Artifact.name(artifact), call.server) end, fn -> epoch(artifact) end, fn -> servers(artifact) end, fn -> signed(artifact) end]
      |> Enum.map(&Task.async/1)
      |> Task.await_many(:infinity)

    Map.merge(%{artifact: keyed_name(Artifact.name(artifact)), epoch: epoch, servers: servers, may: names(should(Artifact.name(artifact)))}, signed)
  end

  # Its owner's signature of which servers open it at its epoch, and the public key that signed it, as the device that
  # chose them gave them: a device checks it before it encrypts to them (`device.rs`). A server can't make one.
  defp signed(artifact) do
    case Artifact.read(%{artifact | codec: nil}, "keys/signed") do
      {:ok, json, _tag} -> Map.take(JSON.decode!(json), ["signature", "signer"])
      :absent -> %{}
    end
  end

  defp epoch(artifact) do
    case Artifact.read(%{artifact | codec: nil}, "keys/epoch") do
      {:ok, epoch, _tag} -> String.to_integer(epoch)
      :absent -> 0
    end
  end

  # Makes the servers that open an artifact the ones its owner's passkey handed keys on the sign-in page (`store`):
  # `given` is the artifact's keys encrypted to each, with its owner's signature of which. Each server newly chosen gets a
  # relation tuple naming it as an `editor`, and each one taken off loses its tuple and its keys. Only whoever the
  # artifact belongs to chooses: the call is theirs, and by them.
  defp choose(%Call{} = call, given) do
    with %{"artifact" => keyed, "epoch" => epoch, "was" => was, "slots" => %{} = slots} = given when is_binary(keyed) <- given,
         # A device names it as its keys were made (`keyed_name/1`), which leads to its name now.
         name = User.renamed(keyed),
         %{"signature" => signature, "signer" => signer} when is_binary(signature) and is_binary(signer) <- given,
         true <- is_integer(was) and epoch in [was, was + 1] do
      artifact = %Artifact{prefix: name <> "/"}
      owner!(call, name)

      if was != epoch(artifact),
        do: raise("Which servers open #{name} was changed from another device just now. Look, and do this again.")

      had = servers(artifact)

      for server <- Map.keys(slots) -- had, do: share(call, "share", name, server)
      # Written at once, as `access/1` reads them.
      puts = for({server, slot} <- slots, do: {"keys/" <> server, Base.decode64!(slot)}) ++ [{"keys/epoch", Integer.to_string(epoch)}, {"keys/signed", JSON.encode!(%{signature: signature, signer: signer})}]
      wrote = Task.async_stream(puts, fn {blob, data} -> put(artifact, blob, data) end, max_concurrency: 16, timeout: :infinity)

      if Enum.any?(wrote, &(&1 != {:ok, :ok})),
        do: raise("#{name}'s keys were changed from another device just now. Look, and do this again.")

      for server <- had -- Map.keys(slots) do
        Artifact.remove(artifact, "keys/" <> server)
        share(call, "unshare", name, server)
      end

      GenServer.call(Call.process(call, Keys, name, {artifact, call.server}), :look)
      look(call, name, Enum.uniq(had ++ Map.keys(slots)))
      %{artifact: name, servers: Map.keys(slots)}
    else
      _ -> raise "That isn't an artifact's keys as the sign-in page encrypts them with your passkey."
    end
  end

  # Has each of `servers` look at what it's handed of an artifact now, so one that was taken off lets go of its
  # keys at once, and one that was handed a new epoch's writes with them, all asked at once (`OneCore.Asks.each/3`),
  # and not waited for: the keys are kept already, and one that isn't up, as a laptop asleep, or doesn't answer in
  # time looks when it starts or once it gets to it (`Encryption.Keys`), so the sign-in page says they're handed over
  # without waiting up to 8 s for it.
  defp look(%Call{} = call, name, servers) do
    {at, app} = OneCore.Apps.installed(call.subject, call.app_artifact)
    meta = %{actor: nil, subject: User.owner(name), forwarded: true}
    ask = %{installed: at, app: app, function: "looked", arguments: [name], _meta: meta}
    trace = OpenTelemetry.Ctx.get_current()

    Task.Supervisor.start_child(OneCore.Asks, fn ->
      OpenTelemetry.Ctx.attach(trace)
      OneCore.Asks.each(servers -- [call.server], &Server.request(&1, "apps/call", ask))
    end)
  end

  @doc false
  # What another server asks of this one once the servers that open an artifact were chosen again.
  def looked(%Call{} = call, name) do
    GenServer.call(Call.process(call, Keys, name, {%Artifact{prefix: name <> "/"}, call.server}), :look)
  end

  # A relation tuple is the permissions app's to write, as whoever asked.
  defp share(call, tool, artifact, server) do
    inputs = %{"artifact" => artifact, "relation" => "editor", "who" => "servers/" <> server}

    case Calls.call("permissions", tool, inputs, {call.actor, call.subject}) do
      {:ok, _said} -> :ok
      {:forwarded, %{"isError" => true, "content" => [%{"text" => why} | _]}} -> raise why
      {:forwarded, _result} -> :ok
      {:error, why} -> raise why
    end
  end

  # A blob of an artifact's keys, written whether or not there's one: `:ok`, or not where another device wrote it meanwhile.
  defp put(artifact, name, data) do
    case Artifact.read(artifact, name) do
      {:ok, _was, tag} -> Artifact.replace(artifact, name, data, tag)
      :absent -> Artifact.write(artifact, name, data)
    end
  end

  @doc """
  What a person typed on their device, which encrypted it for the servers that open what it's kept in: `given` is
  what the device filled in for an input whose format is `secret`. Raises if it wasn't encrypted for this server.
  """
  def secret(%Call{server: server}, given) do
    with {:ok, %{^server => sealed}} <- JSON.decode(given),
         {:ok, sealed} <- Base.decode64(sealed),
         {:ok, own} <- Cipher.key(Server.key_file()),
         {:ok, secret} <- Cipher.open(own, "one/encryption/1/secret\n#{server}", sealed) do
      secret
    else
      _ ->
        raise "That wasn't encrypted on a device for this server, so it isn't kept.\n\nA secret is typed on a device of yours, or given there to `one`'s own tool, never in code mode. An assistant in code mode or anywhere else asks its person for it with `vault_request`, which has them type it on their device."
    end
  end

  # What's encrypted for someone is theirs alone to hand keys for: a user's by that user, and a group's or the
  # network's by an owner of it. No relation tuple lets anyone else, the network's owner included.
  defp owner!(%Call{subject: subject, actor: actor} = call, artifact) do
    cond do
      User.owner(artifact) != subject ->
        raise "#{artifact} isn't #{subject}'s"

      String.starts_with?(subject, "users/") and actor != subject ->
        raise "What's encrypted for #{subject} is theirs alone to hand the keys of."

      String.starts_with?(subject, "users/") ->
        :ok

      true ->
        with {:refuse, why} <-
               Hooks.validate(
                 "reach",
                 %{"who" => actor, "relation" => "owner", "artifact" => subject},
                 {actor, subject}
               ),
             do: raise(why)
    end

    call
  end

  @impl true
  def tools do
    device = %{type: "string", format: "device", description: "The device's key. This device's, if left out"}

    named = %{
      type: "object",
      properties: %{device: %{type: "string", description: "The device's key"}, name: %{type: "string"}},
      required: ["device", "name"]
    }

    server = %{
      type: "object",
      properties: %{key: %{type: "string"}, name: %{type: ["string", "null"], description: "What its machine is called"}},
      required: ["key", "name"]
    }

    access = %{
      type: "array",
      description: """
      Each artifact encrypted for you, and which servers hold your key for it: every server that acts for you
      should, as it runs what uses it, and none other. One that lacks it is waiting for it, and its calls of that
      artifact fail until it has it.
      """,
      items: %{
        type: "object",
        properties: %{
          artifact: %{type: "string"},
          servers: %{type: "array", items: server, description: "The servers that hold it"},
          missing: %{type: "array", items: server, description: "Servers that act for you and are waiting for it"},
          extra: %{type: "array", items: server, description: "Servers that hold it and don't act for you"},
          problems: %{type: "array", items: %{type: "string"}, description: "Each of those, as a person reads it"}
        },
        required: ["artifact", "servers", "missing", "extra", "problems"]
      }
    }

    [
      %{
        name: "key",
        read_only: true,
        no_store: true,
        description: "Says which of your devices are trusted, which want to be, what this device holds of your key, and which servers hold the keys of what's encrypted for you, and which should",
        inputs: %{type: "object", properties: %{device: device}},
        outputs: %{
          type: "object",
          properties: %{
            owner: %{type: "string", description: "Whose key"},
            device: %{type: ["string", "null"], description: "The device asked about: none for a browser or an assistant, which can't hold a key"},
            check: %{type: ["string", "null"], description: "What tells the key from another, once there's one"},
            slot: %{
              type: ["string", "null"],
              description: "The key, encrypted to the device asked about, if it holds it"
            },
            devices: %{type: "array", items: named, description: "The devices that hold it"},
            asking: %{type: "array", items: named, description: "The devices asking to"},
            wrapped: %{
              type: ["string", "null"],
              description: "A group's or the network's key, encrypted to your own, which your passkey opens on the sign-in page"
            },
            access: access
          },
          required: ["owner", "device", "check", "slot", "devices", "asking", "wrapped", "access"]
        }
      },
      %{
        name: "check",
        description: """
        Says to Telemetry how what's encrypted for you stands, as the clock does every 10 minutes: an alert is open
        while a server that acts for you is waiting for your key, or one that doesn't holds it. For the network, its
        owners are notified once when a server starts waiting (`sign-in`'s `check`). Answers as `key`'s `access`.
        """,
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object", properties: %{access: access}, required: ["access"]}
      },
      %{
        name: "store",
        description: """
        Stores what the network's sign-in page encrypted with your passkey, which nothing else can make: your new key's
        check, as it's first made (`check`), your key for a
        device of yours (`device`), the keys of what's encrypted for you for the servers that act for you
        (`artifacts`), or a group's or the network's key encrypted to your own (`wrapped`). Only the sign-in page calls it.
        """,
        inputs: %{
          type: "object",
          properties: %{
            check: %{type: "string", description: "What tells your key from another, as it's first made"},
            device: %{
              type: "object",
              properties: %{key: %{type: "string"}, name: %{type: "string"}, check: %{type: "string"}, slot: %{type: "string"}},
              required: ["key", "name", "check", "slot"]
            },
            wrapped: %{
              type: "object",
              properties: %{check: %{type: "string"}, slot: %{type: "string"}},
              required: ["check", "slot"]
            },
            artifacts: %{type: "array", items: %{type: "object"}}
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            device: %{type: ["string", "null"]},
            wrapped: %{type: "boolean"},
            artifacts: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{artifact: %{type: "string"}, servers: %{type: "array", items: %{type: "string"}}},
                required: ["artifact", "servers"]
              }
            }
          },
          required: ["device", "wrapped", "artifacts"]
        }
      },
      %{
        name: "ask",
        description: "Asks for your key: Unlock with Passkey, on the sign-in page, then lets this device hold it",
        inputs: %{
          type: "object",
          properties: %{device: device, name: %{type: "string", format: "device-name", description: "What to call it"}}
        },
        outputs: %{type: "object", properties: %{device: %{type: "string"}}, required: ["device"]}
      },
      %{
        name: "revoke",
        description: "Takes a device's copy of your key away, or its asking for one",
        inputs: %{type: "object", properties: %{device: device}, required: ["device"]},
        outputs: %{type: "object", properties: %{device: %{type: "string"}}, required: ["device"]}
      }
    ]
  end

  @impl true
  def call("key", inputs, call) do
    key = key(call)
    inputs = Map.update(inputs, "device", nil, &holder(call, &1))
    access = Task.async(fn -> access(call.subject) end)
    # A scheduled call is nobody's, so no key is encrypted to its owner's.
    wrapped = if is_binary(call.actor), do: "owners/" <> call.actor
    # Every blob this says is read at once, as `access/1`'s are.
    names =
      for name <- Artifact.list(key),
          name in ["check", wrapped] or String.starts_with?(name, ["devices/", "asking/"]),
          do: name

    read = for {name, {:ok, data, _tag}} <- Enum.zip(names, Artifact.read_all(key, names)), into: %{}, do: {name, data}
    held = for {"devices/" <> device, data} <- read, do: %{device: device, name: JSON.decode!(data)["name"]}
    asking = for {"asking/" <> device, data} <- read, do: %{device: device, name: JSON.decode!(data)["name"]}

    slot =
      with device when is_binary(device) <- inputs["device"],
           data when is_binary(data) <- read["devices/" <> device],
           do: JSON.decode!(data)["slot"],
           else: (_ -> nil)

    %{
      owner: keyed(call.subject),
      device: inputs["device"],
      check: read["check"],
      slot: slot,
      devices: held,
      asking: asking,
      wrapped: wrapped && read[wrapped],
      access: Task.await(access, :infinity)
    }
  end

  # Each artifact as a record Telemetry keeps, whose alert is open while it says what's missing (`Telemetry.Alerts`).
  def call("check", _inputs, call) do
    access = access(call.subject)

    records =
      for artifact <- access do
        outcome = if artifact.problems == [], do: "complete", else: "incomplete"
        attributes = %{"one.artifact" => artifact.artifact, "one.outcome" => outcome, "one.problem" => Enum.join(artifact.problems, " ")}
        %{"name" => "one.encryption.access", "attributes" => Map.reject(attributes, &match?({_, ""}, &1))}
      end

    if records != [], do: Call.tool(call, "telemetry", "record", %{"records" => records})
    # The network's owners are told once when a server starts waiting for its key, by Sign-In, whose Sign In & Security
    # hands it over, so its notification opens there.
    if call.subject == "network", do: Call.tool(call, "sign-in", "check", %{})
    %{access: access}
  end

  # What the sign-in page encrypted with a passkey: each part is checked against the key it says it's of, by the key's
  # `check`, so nothing but a holder of that key makes one that's kept.
  def call("store", inputs, call) do
    key = key(owner!(call, call.subject))
    if check = inputs["check"], do: checked!(key, check)

    device =
      with %{"key" => device, "name" => name, "check" => check, "slot" => slot} <- inputs["device"] do
        if not (device =~ ~r/^[0-9a-f]{64}$/), do: raise("A device is named by its key.")
        checked!(key, check)
        Artifact.remove(key, "devices/" <> device)
        :ok = Artifact.write(key, "devices/" <> device, JSON.encode!(%{name: name, slot: slot}))
        Artifact.remove(key, "asking/" <> device)
        device
      end

    wrapped =
      with %{"check" => check, "slot" => slot} <- inputs["wrapped"] do
        if String.starts_with?(call.subject, "users/"), do: raise("Your own key is encrypted to your passkeys, not to itself.")
        with {:ok, held, _tag} when held != check <- Artifact.read(key, "check"), do: raise("That isn't #{whose(call.subject)} key.")
        if Artifact.read(key, "check") == :absent, do: raise("#{whom(call.subject)} has no key yet.")
        Artifact.remove(key, "owners/" <> call.actor)
        :ok = Artifact.write(key, "owners/" <> call.actor, slot)
        true
      end

    artifacts = Enum.map(inputs["artifacts"] || [], &choose(call, &1))
    # What they were told is waiting for their key is forgotten once it's handed over, so a server that waits again is told of.
    if String.starts_with?(call.subject, "users/"), do: Call.tool(call, "sign-in", "check", %{})
    %{device: device, wrapped: wrapped == true, artifacts: artifacts}
  end

  def call("ask", %{"device" => device} = inputs, call) do
    key = key(call)
    if holder(call, device) == nil, do: raise("A browser can't hold your key. Use the app on your phone or computer for that.")
    if not (device =~ ~r/^[0-9a-f]{64}$/), do: raise("A device is named by its key.")
    Artifact.write(key, "asking/" <> device, JSON.encode!(%{name: inputs["name"] || "A device"}))
    %{device: device}
  end

  def call("ask", _inputs, _call), do: raise("A device asks for your key from itself: in the app there, or with `one` on it.")

  def call("revoke", %{"device" => device}, call) do
    key = key(owner!(call, call.subject))
    if not (device =~ ~r/^[0-9a-f]{64}$/), do: raise("A device is named by its key.")
    for prefix <- ["devices/", "asking/"], do: Artifact.remove(key, prefix <> device)
    %{device: device}
  end

  # The device a call names, where it can hold a key: any but the one it came from over the web, unless that's an
  # app's, proved by its signature. A browser or an assistant is named there by a hash of its session or token
  # (`apps/sign-in/edge/auth.ts`), which is no key anything can be encrypted to, so it holds none.
  defp holder(call, device) do
    case Call.client(call) do
      %{"web" => true, "device" => ^device} -> if Call.app(call, "sign-in").device(call)["kind"] == "app", do: device
      _ -> device
    end
  end

  # Where an owner's key is kept, encrypted to each of their devices. It's theirs alone: nobody asks for a user.
  # Who holds a group's or the network's key is its owners' to say, as which servers open what's theirs is
  # (`owner!/2`): store and revoke ask that first. Anyone it's for reads what their own device holds.
  defp key(%Call{subject: subject, actor: actor} = call) do
    if String.starts_with?(subject, "users/") and actor != subject, do: raise("#{subject}'s key is theirs alone.")
    Call.make(call, "key")
  end

  # The first key's check written is the owner's from then on: what's handed over is kept only if it's that one's.
  defp checked!(key, check) do
    Artifact.write(key, "check", check)

    if Artifact.read(key, "check") |> elem(1) != check,
      do: raise("That isn't your key: another was made before it. Use your passkey that unlocks it, or your recovery key.")
  end
end
