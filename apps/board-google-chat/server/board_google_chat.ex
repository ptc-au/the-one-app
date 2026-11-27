defmodule BoardGoogleChat do
  @moduledoc """
  Board Google Chat Sync: a Board channel mirrored in a Google Chat space, both ways, through the network's Chat app
  (Google Chat App), so nothing it does in Google Chat shows as a person. `map` says which channel is which space and
  starts watching the space for whoever it's installed for; where Workspace admin approval for reading is still pending,
  it maps one way (Board → Chat) and says so. From then on each message or task posted in either is mirrored in the
  other, and edits and deletions follow. Messages over Google Chat's 4,096-character limit are split across replies in
  the same thread. Outbound sends are kept in an outbox and retried with backoff until sent or clearly failed, and
  failed messages are marked on Board.
  """
  @behaviour OneCore.App
  require Logger
  alias OneCore.Call
  alias BoardGoogleChat.Store

  @space ~r{\Aspaces/[A-Za-z0-9_-]+\z}
  @channel ~r{\A[a-z0-9_-]+(?:/[a-z0-9_-]+)*\z}
  @chat_limit 4096
  # Bounded retry backoff in seconds after the initial attempt fails transiently (5 retries over ~48 minutes).
  @backoff [15, 60, 300, 900, 1800]

  @impl true
  def icon, do: "icon.svg"

  @impl true
  def own, do: :installed

  @impl true
  def requires do
    %{
      "core" => ">= 0.35.10",
      "database" => "to keep which channel is mirrored in which space and the outbound retry queue",
      "board" => "to read and write each mirrored channel",
      "google-chat-app" => "to send, edit and delete in a space as the network's Chat app, and to watch it"
    }
  end

  @impl true
  def hooks do
    [
      "board.message_posted",
      "board.message_edited",
      "board.message_deleted",
      "board.channel_status",
      "board.message_status",
      "google-chat-app.message_created",
      "google-chat-app.message_updated",
      "google-chat-app.message_deleted",
      "google-chat-app.reaction_created",
      "google-chat-app.reaction_deleted"
    ]
  end

  @impl true
  def tools do
    nullable = &Map.update!(&1, :type, fn type -> [type, "null"] end)

    mapped = %{
      type: "object",
      properties: %{
        space: %{type: "string", description: "The space, as Google Chat names it: spaces/..."},
        channel: %{type: "string", description: "The Board channel, such as dev or work/checkout"},
        created_at: %{type: "string", description: "When it was mapped, as ISO 8601"},
        watching: %{type: "boolean", description: "Whether Chat → Board is currently active (space watched)"},
        state: %{type: "string", description: "The mapping's current state in words, both directions"},
        expires: nullable.(%{type: "string", description: "When the Chat subscription expires, if watched"}),
        last_event_at: nullable.(%{type: "string", description: "When Google last sent an event for this space"}),
        pending: %{type: "integer", description: "Board messages waiting to be retried to Chat"},
        failed: %{type: "integer", description: "Board messages that failed to reach Chat"},
        last_error: nullable.(%{type: "string", description: "Why the last outbound message failed, if any"})
      },
      required: ["space", "channel", "created_at", "watching", "state"]
    }

    [
      %{
        name: "map",
        description:
          "Mirrors a Board channel in a Google Chat space, both ways, and watches the space for its messages. If Workspace admin approval for reading is still pending, maps one way (Board → Chat) and says so",
        inputs: %{
          type: "object",
          required: ["space", "channel"],
          properties: %{
            space: %{type: "string", description: "The space, as Google Chat names it: spaces/..."},
            channel: %{type: "string", description: "The Board channel, such as dev or work/checkout"},
            watch: %{type: "boolean", description: "Whether to watch the space for its messages. True unless said"}
          }
        },
        outputs: %{
          type: "object",
          properties: Map.take(mapped.properties, [:space, :channel, :created_at, :watching, :state]),
          required: ["space", "channel", "created_at", "watching", "state"]
        }
      },
      %{
        name: "unmap",
        description: "Stops mirroring a space or a channel",
        inputs: %{
          type: "object",
          properties: %{
            space: %{type: "string", description: "The space to stop mirroring, as Google Chat names it: spaces/..."},
            channel: %{type: "string", description: "The Board channel to stop mirroring"}
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            space: %{type: "string"},
            channel: %{type: "string"},
            unmapped: %{type: "boolean"}
          },
          required: ["space", "channel", "unmapped"]
        }
      },
      %{
        name: "mappings",
        read_only: true,
        description: "Which Board channels are mirrored in which Google Chat spaces, and each one's live sync state",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{mappings: %{type: "array", items: mapped}},
          required: ["mappings"]
        }
      },
      %{
        name: "retry_outbox",
        description:
          "Retries Board messages queued to reach Google Chat. Called by the database timer on backoff, or manually with force: true to retry failed messages too",
        inputs: %{
          type: "object",
          properties: %{
            force: %{type: "boolean", description: "Also retry messages already marked failed. False if left out"}
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            sent: %{type: "integer"},
            pending: %{type: "integer"},
            failed: %{type: "integer"}
          },
          required: ["sent", "pending", "failed"]
        }
      }
    ]
  end

  @impl true
  def call(tool, inputs, call) do
    owner_only = tool in ["map", "unmap"] or (tool == "retry_outbox" and call.actor != nil)

    if owner_only and not Call.owns?(%{call | subject: call.installed}),
      do: raise(Call.Refused, "Only the owners of whoever Board Google Chat Sync is installed for map, unmap or retry channels.")

    case dispatch(tool, inputs, call) do
      {:error, why} -> raise Call.Refused, why
      result -> result
    end
  end

  defp dispatch("map", inputs, call) do
    with {:ok, space} <- space_name(inputs["space"]),
         {:ok, channel} <- channel_name(inputs["channel"]),
         {:ok, _created_at} <- Store.transaction(call, fn db -> mapped(db, space, channel) end) do
      {watching, watch_state, watch_error} =
        if inputs["watch"] == false do
          {false, "unwatched", nil}
        else
          try_watch(call, space)
        end

      with {:ok, mapping} <- Store.transaction(call, fn db -> put_mapping(db, space, channel, watch_state, watch_error) end) do
        {state, _tone} = describe_state(watching, nil, watch_state, 0, 0)
        %{space: mapping.space, channel: mapping.channel, created_at: mapping.created_at, watching: watching, state: state}
      end
    end
  end

  defp dispatch("unmap", %{"space" => space}, call) when is_binary(space) and space != "" do
    with {:ok, space} <- space_name(space) do
      unwrap(
        Store.transaction(call, fn db ->
          case Store.query(db, "select space_name, channel from mappings where space_name = ?", [space]) do
            [%{"space_name" => space, "channel" => channel}] -> unmap(db, space, channel)
            [] -> {:error, "Nothing is mirrored from #{space}."}
          end
        end),
        call
      )
    end
  end

  defp dispatch("unmap", %{"channel" => channel}, call) when is_binary(channel) and channel != "" do
    with {:ok, channel} <- channel_name(channel) do
      unwrap(
        Store.transaction(call, fn db ->
          case Store.query(db, "select space_name, channel from mappings where channel = ?", [channel]) do
            [%{"space_name" => space, "channel" => channel}] -> unmap(db, space, channel)
            [] -> {:error, "Nothing is mirrored in ##{channel}."}
          end
        end),
        call
      )
    end
  end

  defp dispatch("unmap", _inputs, _call), do: {:error, "Say the space or the channel to stop mirroring."}

  defp dispatch("mappings", _inputs, call) do
    %{mappings: list_mappings(call)}
  end

  defp dispatch("retry_outbox", inputs, call) do
    force = inputs["force"] == true
    now = Store.now_sec()

    rows =
      Store.transaction(call, fn db ->
        if force do
          Store.query(
            db,
            "select board_message_id, board_root_id, space_name, channel, text, attempts from outbox order by created_at asc"
          )
        else
          Store.query(
            db,
            "select board_message_id, board_root_id, space_name, channel, text, attempts from outbox where status = 'pending' and (next_attempt_at is null or next_attempt_at <= ?) order by created_at asc",
            [now]
          )
        end
      end)

    counts =
      Enum.reduce(rows, %{sent: 0, pending: 0, failed: 0}, fn row, acc ->
        case deliver_one(call, row, force) do
          :sent -> %{acc | sent: acc.sent + 1}
          :pending -> %{acc | pending: acc.pending + 1}
          :failed -> %{acc | failed: acc.failed + 1}
        end
      end)

    schedule_outbox(call)
    counts
  end

  defp unwrap({:ok, %{space: space} = answer}, call) do
    schedule_outbox(call)
    Call.tool(call, "google-chat-app", "unwatch_space", %{"space" => space})
    answer
  end

  defp unwrap({:error, why}, _call), do: {:error, why}

  defp mapped(db, space, channel) do
    case Store.query(db, "select channel, created_at from mappings where space_name = ?", [space]) do
      [%{"channel" => ^channel, "created_at" => created_at}] ->
        {:ok, created_at}

      [%{"channel" => other}] ->
        {:error, "#{space} is already mirrored in ##{other}. `unmap` it first."}

      [] ->
        case Store.query(db, "select space_name from mappings where channel = ?", [channel]) do
          [%{"space_name" => other}] -> {:error, "##{channel} is already mirrored in #{other}. `unmap` it first."}
          [] -> {:ok, nil}
        end
    end
  end

  defp put_mapping(db, space, channel, watch_state, watch_error) do
    with {:ok, existing} <- mapped(db, space, channel) do
      created_at = existing || Store.now_iso()

      if existing == nil do
        Store.query(
          db,
          "insert into mappings (space_name, channel, created_at, watch_state, watch_error) values (?, ?, ?, ?, ?)",
          [space, channel, created_at, watch_state, watch_error]
        )
      else
        Store.query(
          db,
          "update mappings set watch_state = ?, watch_error = ? where space_name = ?",
          [watch_state, watch_error, space]
        )
      end

      {:ok, %{space: space, channel: channel, created_at: created_at}}
    end
  end

  # What was mirrored stays where it is, and nothing of it is linked any more: a space mapped again starts afresh.
  defp unmap(db, space, channel) do
    for table <- ["outbox", "message_links", "thread_links", "mappings"],
        do: Store.query(db, "delete from #{table} where space_name = ?", [space])

    {:ok, %{space: space, channel: channel, unmapped: true}}
  end

  # Watches the space for Chat → Board. Where Workspace admin approval for reading is still pending, falls back to
  # one-way mapping (Board → Chat) and records why so `map`, `mappings` and Board's screen say so in words.
  defp try_watch(call, space) do
    try do
      Call.tool(call, "google-chat-app", "watch_space", %{"space" => space})
      {true, "watching", nil}
    rescue
      error ->
        msg = Exception.message(error)

        if admin_approval_error?(msg) do
          {false, "waiting_for_admin_approval", short_error(msg)}
        else
          reraise error, __STACKTRACE__
        end
    end
  end

  defp admin_approval_error?(msg) when is_binary(msg) do
    down = String.downcase(msg)
    (down =~ ~r/workspace admin|administrator approval|app authentication|chat\.app\.messages\.readonly/) and not (down =~ ~r/not a member|not in (this|the) space/)
  end

  defp list_mappings(call) do
    subs = live_subscriptions(call)
    now = DateTime.utc_now()

    Store.transaction(call, fn db ->
      rows =
        Store.query(
          db,
          "select space_name, channel, created_at, watch_state, watch_error from mappings order by created_at, space_name"
        )

      for %{"space_name" => space, "channel" => channel, "created_at" => created_at, "watch_state" => watch_state} <- rows do
        sub = Map.get(subs, space)
        expired? = sub != nil and sub_expired?(sub["expire_time"], now)
        watching = sub != nil and not expired?

        [%{"pending" => pending, "failed" => failed}] =
          Store.query(
            db,
            "select sum(case when status = 'pending' then 1 else 0 end) as pending, sum(case when status = 'failed' then 1 else 0 end) as failed from outbox where space_name = ?",
            [space]
          )

        last_error =
          case Store.query(db, "select last_error from outbox where space_name = ? and last_error is not null order by updated_at desc limit 1", [space]) do
            [%{"last_error" => err}] -> err
            [] -> nil
          end

        pending = pending || 0
        failed = failed || 0
        {state, tone} = describe_state(watching, expired?, watch_state, pending, failed)

        %{
          space: space,
          channel: channel,
          created_at: created_at,
          watching: watching,
          state: state,
          tone: tone,
          expires: sub && sub["expire_time"],
          last_event_at: sub && sub["last_event_at"],
          pending: pending,
          failed: failed,
          last_error: last_error
        }
      end
    end)
  end

  defp live_subscriptions(call) do
    try do
      status = Call.tool(call, "google-chat-app", "status", %{})
      for sub <- status["subscriptions"] || [], into: %{}, do: {sub["space"], sub}
    rescue
      _ -> %{}
    end
  end

  defp sub_expired?(expire_time, now) when is_binary(expire_time) do
    case DateTime.from_iso8601(expire_time) do
      {:ok, dt, _} -> DateTime.compare(dt, now) == :lt
      _ -> false
    end
  end

  defp sub_expired?(_, _), do: false

  defp describe_state(watching, expired?, watch_state, pending, failed) do
    inbound =
      cond do
        watching -> "Chat → Board on"
        expired? -> "Chat → Board paused (subscription expired)"
        watch_state == "waiting_for_admin_approval" -> "Chat → Board waiting for your Workspace admin's approval"
        watch_state == "unwatched" -> "Chat → Board off (not watching)"
        true -> "Chat → Board off (not watching — run map again once your Workspace admin approves the Chat app)"
      end

    suffix =
      cond do
        failed > 0 -> "; #{failed} failed to send"
        pending > 0 -> "; #{pending} retrying"
        true -> ""
      end

    tone =
      cond do
        failed > 0 -> "error"
        not watching -> "warn"
        true -> "ok"
      end

    {"Board → Chat on; #{inbound}#{suffix}", tone}
  end

  # --- Board status hooks (shown on Board's screens) ---

  @impl true
  def hook("board.channel_status", about, call) do
    wanted = about["channel"]

    for m <- list_mappings(call), wanted == nil or m.channel == wanted, into: %{} do
      {m.channel, %{"label" => "Google Chat", "state" => m.state, "tone" => m.tone}}
    end
  end

  def hook("board.message_status", %{"ids" => ids}, call) when is_list(ids) and ids != [] do
    placeholders = Enum.map_join(ids, ", ", fn _ -> "?" end)

    Store.transaction(call, fn db ->
      for %{"board_message_id" => id, "status" => status, "last_error" => err} <-
            Store.query(
              db,
              "select board_message_id, status, last_error from outbox where board_message_id in (#{placeholders}) and status in ('pending', 'failed')",
              ids
            ),
          into: %{} do
        text =
          case status do
            "failed" -> "Couldn't send to Google Chat: #{err || "unknown error"}"
            "pending" -> if(err, do: "Sending to Google Chat… (retrying: #{err})", else: "Sending to Google Chat…")
          end

        {id, %{"label" => "Google Chat", "status" => status, "text" => text}}
      end
    end)
  end

  def hook("board.message_status", _about, _call), do: %{}

  # --- Google Chat to the board ---

  def hook("google-chat-app.message_created", %{"sender_type" => "BOT"}, _call), do: :ok

  def hook("google-chat-app.message_created", about, call) do
    if text?(about["text"]) do
      case inbound_state(call, about["space"], about["message"], about["thread"]) do
        nil -> :ok
        state -> post_from_chat(call, state, about)
      end
    else
      :ok
    end
  end

  def hook("google-chat-app.message_updated", %{"sender_type" => "BOT"}, _call), do: :ok

  def hook("google-chat-app.message_updated", about, call) do
    if text?(about["text"]) do
      case chat_message_link(call, about["message"]) do
        nil -> :ok
        link -> edit_from_chat(call, link, about["text"])
      end
    else
      :ok
    end
  end

  def hook("google-chat-app.message_deleted", about, call) do
    case chat_message_link(call, about["message"]) do
      nil ->
        :ok

      link ->
        forget(call, link.board_message_id)
        Call.tool(call, "board", "delete", %{"id" => link.board_message_id})
        :ok
    end
  end

  def hook("google-chat-app.reaction_created", about, call), do: reaction_from_chat(call, about, false)

  def hook("google-chat-app.reaction_deleted", about, call), do: reaction_from_chat(call, about, true)

  # --- The board to Google Chat ---

  def hook("board.message_posted", %{"no_sync" => true}, _call), do: :ok

  def hook("board.message_posted", about, call) do
    id = about["id"]
    root_id = about["root_id"] || id
    is_reply = root_id != id

    case enqueue_outbound(call, about["channel"], id, root_id, is_reply, chat_text(about["profile"], about["display_author"], about["body"])) do
      {:ok, row} ->
        deliver_one(call, row, false)
        schedule_outbox(call)
        :ok

      :skip ->
        :ok
    end
  end

  def hook("board.message_edited", about, call) do
    text = chat_text(about["profile"], about["display_author"], about["body"])

    case board_message_link(call, about["id"]) do
      %{origin: "board"} = link ->
        first = hd(split_text(text, @chat_limit))
        Call.tool(call, "google-chat-app", "edit", %{"message" => link.chat_message_name, "text" => first})
        :ok

      nil ->
        Store.transaction(call, fn db ->
          Store.query(db, "update outbox set text = ?, updated_at = ? where board_message_id = ?", [text, Store.now_iso(), about["id"]])
        end)

        :ok

      _ ->
        :ok
    end
  end

  def hook("board.message_deleted", about, call) do
    case board_message_link(call, about["id"]) do
      %{origin: "board"} = link ->
        forget(call, about["id"])

        for msg_name <- [link.chat_message_name | link.extra_chat_messages] do
          Call.tool(call, "google-chat-app", "delete", %{"message" => msg_name})
        end

        :ok

      %{origin: _} ->
        forget(call, about["id"])
        :ok

      nil ->
        Store.transaction(call, fn db ->
          Store.query(db, "delete from outbox where board_message_id = ?", [about["id"]])
        end)

        schedule_outbox(call)
        :ok
    end
  end

  # A hook this app names but isn't told, as a newer version of it offers: nothing to do.
  def hook(_hook, _about, _call), do: :ok

  defp post_from_chat(call, state, about) do
    profile = profile_for(about["sender_name"] || about["sender"])
    text = about["text"]

    posted =
      if state.root do
        Call.tool(call, "board", "reply", %{"id" => state.root, "body" => text, "profile" => profile, "no_sync" => true})
      else
        Call.tool(call, "board", "post", %{
          "channel" => state.channel,
          "body" => text,
          "profile" => profile,
          "no_sync" => true
        })
      end

    Store.transaction(call, fn db ->
      if state.root == nil do
        Store.query(
          db,
          "insert or ignore into thread_links (board_root_id, space_name, chat_thread_name) values (?, ?, ?)",
          [posted["id"], about["space"], about["thread"]]
        )
      end

      Store.query(
        db,
        "insert or ignore into message_links (board_message_id, chat_message_name, board_root_id, space_name, origin) values (?, ?, ?, ?, 'chat')",
        [posted["id"], about["message"], posted["root_id"] || posted["id"], about["space"]]
      )
    end)

    :ok
  end

  defp edit_from_chat(call, link, text) do
    Call.tool(call, "board", "edit", %{"id" => link.board_message_id, "body" => text})
    :ok
  end

  defp reaction_from_chat(_call, %{"sender_type" => "BOT"}, _remove), do: :ok

  defp reaction_from_chat(call, about, remove) do
    case chat_message_link(call, about["message"]) do
      nil ->
        :ok

      link ->
        Call.tool(call, "board", "react", %{
          "id" => link.board_message_id,
          "emoji" => about["emoji"],
          "remove" => remove,
          "profile" => profile_for(about["sender_name"] || about["sender"]),
          "no_sync" => true
        })

        :ok
    end
  end

  # Writes the outbound message to `outbox` before calling Google Chat so a failure, timeout or crash never loses it.
  # A reply whose root isn't mirrored (and isn't pending in the outbox) is skipped so it never lands as a lone top-level
  # message in Google Chat.
  defp enqueue_outbound(call, channel, id, root_id, is_reply, text) do
    now_iso = Store.now_iso()
    now_sec = Store.now_sec()

    Store.transaction(call, fn db ->
      with [%{"space_name" => space}] <- Store.query(db, "select space_name from mappings where channel = ?", [channel]),
           [] <- Store.query(db, "select 1 from message_links where board_message_id = ?", [id]),
           [] <- Store.query(db, "select 1 from outbox where board_message_id = ?", [id]),
           true <- not is_reply or root_mirrored_or_pending?(db, root_id, space) do
        Store.query(
          db,
          """
          insert into outbox (board_message_id, board_root_id, space_name, channel, text, status, attempts, next_attempt_at, created_at, updated_at)
          values (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
          """,
          [id, root_id, space, channel, text, now_sec, now_iso, now_iso]
        )

        {:ok, %{"board_message_id" => id, "board_root_id" => root_id, "space_name" => space, "channel" => channel, "text" => text, "attempts" => 0}}
      else
        _ -> :skip
      end
    end)
  end

  defp root_mirrored_or_pending?(db, root_id, space) do
    Store.query(db, "select 1 from thread_links where board_root_id = ? and space_name = ?", [root_id, space]) != [] or
      Store.query(db, "select 1 from outbox where board_message_id = ? and status = 'pending'", [root_id]) != []
  end

  defp deliver_one(call, %{"board_message_id" => id, "board_root_id" => root_id, "space_name" => space, "text" => text, "attempts" => attempts}, force) do
    is_reply = root_id != id

    thread_state =
      if is_reply do
        Store.transaction(call, fn db ->
          case Store.query(db, "select chat_thread_name from thread_links where board_root_id = ? and space_name = ?", [root_id, space]) do
            [%{"chat_thread_name" => thread}] ->
              {:ok, thread}

            [] ->
              case Store.query(db, "select status, next_attempt_at from outbox where board_message_id = ?", [root_id]) do
                [%{"status" => "pending", "next_attempt_at" => at}] -> {:wait, at}
                _ -> :root_failed
              end
          end
        end)
      else
        {:ok, nil}
      end

    case thread_state do
      {:wait, at} ->
        Store.transaction(call, fn db ->
          Store.query(db, "update outbox set next_attempt_at = ?, updated_at = ? where board_message_id = ?", [at || Store.now_sec() + 15, Store.now_iso(), id])
        end)

        :pending

      :root_failed ->
        mark_failed(call, id, root_id, "The thread's first message couldn't be sent to Google Chat.")
        :failed

      {:ok, thread} ->
        try do
          [first | rest] = split_text(text, @chat_limit)
          sent1 = send_message(call, space, first, thread)
          reply_thread = thread || sent1["thread"]
          extras = for chunk <- rest, do: send_message(call, space, chunk, reply_thread)["name"]

          Store.transaction(call, fn db ->
            if not is_reply and is_binary(sent1["thread"]) do
              Store.query(
                db,
                "insert or ignore into thread_links (board_root_id, space_name, chat_thread_name) values (?, ?, ?)",
                [root_id, space, sent1["thread"]]
              )
            end

            extra_json = if extras == [], do: nil, else: JSON.encode!(extras)

            Store.query(
              db,
              "insert or ignore into message_links (board_message_id, chat_message_name, board_root_id, space_name, origin, extra_chat_messages) values (?, ?, ?, ?, 'board', ?)",
              [id, sent1["name"], root_id, space, extra_json]
            )

            Store.query(db, "delete from outbox where board_message_id = ?", [id])
          end)

          :sent
        rescue
          error ->
            msg = Exception.message(error)
            err = short_error(msg)
            permanent? = match?(%Call.Refused{}, error) or permanent_error?(msg)
            next_attempts = if(force, do: 1, else: attempts + 1)

            if permanent? or next_attempts > length(@backoff) do
              Logger.warning("board-google-chat: failed to send #{id} to #{space}: #{err}")
              mark_failed(call, id, root_id, err)
              :failed
            else
              delay = Enum.at(@backoff, next_attempts - 1)
              next_at = Store.now_sec() + delay
              Logger.warning("board-google-chat: send #{id} to #{space} failed (attempt #{next_attempts}), retrying in #{delay}s: #{err}")

              Store.transaction(call, fn db ->
                Store.query(
                  db,
                  "update outbox set status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? where board_message_id = ?",
                  [next_attempts, next_at, err, Store.now_iso(), id]
                )
              end)

              :pending
            end
        end
    end
  end

  defp mark_failed(call, id, root_id, err) do
    now = Store.now_iso()

    Store.transaction(call, fn db ->
      Store.query(
        db,
        "update outbox set status = 'failed', next_attempt_at = null, last_error = ?, updated_at = ? where board_message_id = ?",
        [err, now, id]
      )

      if id == root_id do
        Store.query(
          db,
          "update outbox set status = 'failed', next_attempt_at = null, last_error = ?, updated_at = ? where board_root_id = ? and board_message_id != ? and status = 'pending'",
          ["The thread's first message couldn't be sent to Google Chat.", now, root_id, id]
        )
      end
    end)
  end

  defp schedule_outbox(call) do
    due =
      Store.transaction(call, fn db ->
        [%{"at" => at}] = Store.query(db, "select min(next_attempt_at) as at from outbox where status = 'pending' and next_attempt_at is not null")
        at
      end)

    Call.app(call, "database").timer(call, "retry_outbox", %{}, due)
  end

  defp permanent_error?(msg) when is_binary(msg), do: msg =~ ~r/with (400|403|404):/
  defp permanent_error?(_), do: false

  defp short_error(msg) when is_binary(msg) do
    msg |> String.split("\n", parts: 2) |> hd() |> String.trim() |> String.slice(0, 240)
  end

  # Splits a message over Google Chat's 4,096-character limit on a newline or space where possible.
  defp split_text(text, max) do
    if String.length(text) <= max do
      [text]
    else
      head = String.slice(text, 0, max)
      min_break = div(max, 2)

      cut =
        case last_index(head, "\n") do
          idx when is_integer(idx) and idx >= min_break -> idx
          _ ->
            case last_index(head, " ") do
              idx when is_integer(idx) and idx >= min_break -> idx
              _ -> max
            end
        end

      chunk = String.slice(text, 0, cut) |> String.trim_trailing()
      rest = String.slice(text, cut..-1//1) |> String.trim_leading()

      if rest == "" do
        [chunk]
      else
        [chunk | split_text(rest, max)]
      end
    end
  end

  defp last_index(str, needle) do
    case :binary.matches(str, needle) do
      [] ->
        nil

      matches ->
        {byte_pos, _len} = List.last(matches)
        str |> binary_part(0, byte_pos) |> String.length()
    end
  end

  defp send_message(call, space, text, thread \\ nil) do
    inputs = %{"space" => space, "text" => text}
    inputs = if thread, do: Map.put(inputs, "thread", thread), else: inputs
    Call.tool(call, "google-chat-app", "send", inputs)
  end

  defp chat_text(profile, display_author, body) do
    who = if is_binary(profile) and profile != "", do: profile, else: display_author
    "*#{who}*\n#{body}"
  end

  defp inbound_state(call, space, message, thread) do
    Store.transaction(call, fn db ->
      with [%{"channel" => channel}] <- Store.query(db, "select channel from mappings where space_name = ?", [space]),
           [] <- Store.query(db, "select 1 from message_links where chat_message_name = ?", [message]) do
        root =
          case Store.query(db, "select board_root_id from thread_links where chat_thread_name = ? and space_name = ?", [
                 thread,
                 space
               ]) do
            [%{"board_root_id" => root}] -> root
            [] -> nil
          end

        %{channel: channel, root: root}
      else
        _ -> nil
      end
    end)
  end

  defp chat_message_link(call, message) do
    case Store.transaction(call, fn db ->
           Store.query(
             db,
             "select board_message_id, chat_message_name from message_links where chat_message_name = ?",
             [message]
           )
         end) do
      [%{"board_message_id" => id, "chat_message_name" => name}] ->
        %{board_message_id: id, chat_message_name: name}

      [] ->
        nil
    end
  end

  defp board_message_link(call, id) do
    case Store.transaction(call, fn db ->
           Store.query(db, "select board_message_id, chat_message_name, origin, extra_chat_messages from message_links where board_message_id = ?", [
             id
           ])
         end) do
      [%{"board_message_id" => id, "chat_message_name" => name, "origin" => origin, "extra_chat_messages" => extras}] ->
        %{
          board_message_id: id,
          chat_message_name: name,
          origin: origin,
          extra_chat_messages: if(is_binary(extras) and extras != "", do: JSON.decode!(extras), else: [])
        }

      [] ->
        nil
    end
  end

  defp forget(call, board_message_id) do
    Store.transaction(call, fn db ->
      Store.query(db, "delete from message_links where board_message_id = ?", [board_message_id])
    end)
  end

  defp space_name(space) when is_binary(space) do
    if Regex.match?(@space, space),
      do: {:ok, space},
      else: {:error, "A space is named as Google Chat names it, spaces/..., and #{inspect(space)} isn't."}
  end

  defp space_name(_), do: {:error, "A space is required, named as Google Chat names it: spaces/..."}

  defp channel_name(channel) when is_binary(channel) do
    clean = String.trim_trailing(channel, "/")

    if Regex.match?(@channel, clean),
      do: {:ok, clean},
      else: {:error, "A channel is lowercase letters, digits, _ or - separated by / (e.g. dev, work/checkout)."}
  end

  defp channel_name(_), do: {:error, "A channel is required."}

  defp text?(text), do: is_binary(text) and text != ""

  defp profile_for(name) do
    clean =
      name
      |> to_string()
      |> String.replace(~r/[^A-Za-z0-9-]+/, "-")
      |> String.trim("-")

    String.slice("chat-" <> clean, 0, 32) |> String.trim_trailing("-")
  end
end
