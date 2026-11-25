defmodule BoardGoogleChat do
  @moduledoc """
  Board Google Chat Sync: a Board channel mirrored in a Google Chat space, both ways, through the network's Chat app
  (Google Chat App), so nothing it does in Google Chat shows as a person. `map` says which channel is which space and
  starts watching the space for whoever it's installed for; from then on each message posted in either is posted in
  the other, and edits and deletions follow. A reaction in Google Chat is mirrored on the board, but not the other way:
  Google lets only a person react, never a Chat app. `no_sync` keeps a message on the board alone, as each one this
  app mirrors from Google Chat does, so nothing goes round.

  Which channel is which space is kept in this app's database, with each Google Chat thread and message made for a
  Board thread or message: a reply lands in the thread it belongs to, and an edit or a deletion finds its message.
  Google Chat's bot messages and their edits aren't mirrored, so what this app posts there doesn't come back.
  Mapping and unmapping are for the owners of whoever it's installed for.
  """
  @behaviour OneCore.App
  alias OneCore.Call
  alias BoardGoogleChat.Store

  @space ~r{\Aspaces/[A-Za-z0-9_-]+\z}
  @channel ~r{\A[a-z0-9_-]+(?:/[a-z0-9_-]+)*\z}

  @impl true
  def icon, do: "icon.svg"

  @impl true
  def own, do: :installed

  @impl true
  def requires do
    %{
      "core" => ">= 0.35.10",
      "database" => "to keep which channel is mirrored in which space",
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
      "google-chat-app.message_created",
      "google-chat-app.message_updated",
      "google-chat-app.message_deleted",
      "google-chat-app.reaction_created",
      "google-chat-app.reaction_deleted"
    ]
  end

  @impl true
  def tools do
    mapped = %{
      type: "object",
      properties: %{
        space: %{type: "string", description: "The space, as Google Chat names it: spaces/..."},
        channel: %{type: "string", description: "The Board channel, such as dev or work/checkout"},
        created_at: %{type: "string", description: "When it was mapped, as ISO 8601"}
      },
      required: ["space", "channel", "created_at"]
    }

    [
      %{
        name: "map",
        description:
          "Mirrors a Board channel in a Google Chat space, both ways, and watches the space for its messages",
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
          properties:
            Map.put(mapped.properties, :watching, %{
              type: "boolean",
              description: "Whether the space is watched for its messages"
            }),
          required: ["space", "channel", "created_at", "watching"]
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
        description: "Which Board channels are mirrored in which Google Chat spaces",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{mappings: %{type: "array", items: mapped}},
          required: ["mappings"]
        }
      }
    ]
  end

  @impl true
  def call(tool, inputs, call) do
    if tool in ["map", "unmap"] and not Call.owns?(%{call | subject: call.installed}),
      do: raise(Call.Refused, "Only the owners of whoever Board Google Chat Sync is installed for map and unmap channels.")

    case dispatch(tool, inputs, call) do
      {:error, why} -> raise Call.Refused, why
      result -> result
    end
  end

  defp dispatch("map", inputs, call) do
    with {:ok, space} <- space_name(inputs["space"]),
         {:ok, channel} <- channel_name(inputs["channel"]) do
      case Store.transaction(call, fn db -> put_mapping(db, space, channel) end) do
        {:ok, mapping} ->
          watching = if inputs["watch"] == false, do: false, else: watch(call, space)
          %{space: mapping.space, channel: mapping.channel, created_at: mapping.created_at, watching: watching}

        {:error, why} ->
          {:error, why}
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
    mappings =
      Store.transaction(call, fn db ->
        for %{"space_name" => space, "channel" => channel, "created_at" => created_at} <-
              Store.query(db, "select space_name, channel, created_at from mappings order by created_at, space_name") do
          %{space: space, channel: channel, created_at: created_at}
        end
      end)

    %{mappings: mappings}
  end

  # What reaches outside, the space no longer watched, after the transaction that unmapped it.
  defp unwrap({:ok, %{space: space} = answer}, call) do
    Call.tool(call, "google-chat-app", "unwatch_space", %{"space" => space})
    answer
  end

  defp unwrap({:error, why}, _call), do: {:error, why}

  defp put_mapping(db, space, channel) do
    case Store.query(db, "select channel, created_at from mappings where space_name = ?", [space]) do
      [%{"channel" => ^channel, "created_at" => created_at}] ->
        {:ok, %{space: space, channel: channel, created_at: created_at}}

      [%{"channel" => other}] ->
        {:error, "#{space} is already mirrored in ##{other}. `unmap` it first."}

      [] ->
        case Store.query(db, "select space_name from mappings where channel = ?", [channel]) do
          [%{"space_name" => other}] ->
            {:error, "##{channel} is already mirrored in #{other}. `unmap` it first."}

          [] ->
            created_at = Store.now_iso()

            Store.query(db, "insert into mappings (space_name, channel, created_at) values (?, ?, ?)", [
              space,
              channel,
              created_at
            ])

            {:ok, %{space: space, channel: channel, created_at: created_at}}
        end
    end
  end

  # What was mirrored stays where it is, and nothing of it is linked any more: a space mapped again starts afresh.
  defp unmap(db, space, channel) do
    for table <- ["message_links", "thread_links", "mappings"],
        do: Store.query(db, "delete from #{table} where space_name = ?", [space])

    {:ok, %{space: space, channel: channel, unmapped: true}}
  end

  defp watch(call, space) do
    Call.tool(call, "google-chat-app", "watch_space", %{"space" => space})
    true
  end

  # --- Google Chat to the board ---

  @impl true
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
    case outbound_state(call, about["channel"], about["id"], about["root_id"] || about["id"]) do
      nil -> :ok
      state -> post_to_chat(call, state, about)
    end
  end

  def hook("board.message_edited", about, call) do
    case board_message_link(call, about["id"]) do
      %{origin: "board"} = link ->
        text = chat_text(about["profile"], about["display_author"], about["body"])
        Call.tool(call, "google-chat-app", "edit", %{"message" => link.chat_message_name, "text" => text})
        :ok

      _ ->
        :ok
    end
  end

  def hook("board.message_deleted", about, call) do
    case board_message_link(call, about["id"]) do
      %{origin: "board"} = link ->
        forget(call, about["id"])
        Call.tool(call, "google-chat-app", "delete", %{"message" => link.chat_message_name})
        :ok

      %{origin: _} ->
        forget(call, about["id"])
        :ok

      nil ->
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

  # A reaction in Google Chat, a person's, is made or taken off on the board too. The Chat app makes none there, so none
  # comes back.
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

  defp post_to_chat(call, state, about) do
    text = chat_text(about["profile"], about["display_author"], about["body"])

    sent =
      if state.thread do
        send_message(call, state.space, text, state.thread)
      else
        send_message(call, state.space, text)
      end

    Store.transaction(call, fn db ->
      if state.thread == nil and is_binary(sent["thread"]) do
        Store.query(
          db,
          "insert or ignore into thread_links (board_root_id, space_name, chat_thread_name) values (?, ?, ?)",
          [about["root_id"] || about["id"], state.space, sent["thread"]]
        )
      end

      Store.query(
        db,
        "insert or ignore into message_links (board_message_id, chat_message_name, board_root_id, space_name, origin) values (?, ?, ?, ?, 'board')",
        [about["id"], sent["name"], about["root_id"] || about["id"], state.space]
      )
    end)

    :ok
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

  # What's known of a Google Chat message this app hasn't posted: the channel its space mirrors, and the board
  # thread it belongs to, if one was made for it. Nothing where the space isn't mirrored or the message is already
  # linked, so what this app posts there doesn't come back.
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

  # What's known of a board message this app hasn't posted to Google Chat: the space its channel mirrors, and the
  # Google Chat thread it belongs to, if one was made for it.
  defp outbound_state(call, channel, id, root) do
    Store.transaction(call, fn db ->
      with [%{"space_name" => space}] <- Store.query(db, "select space_name from mappings where channel = ?", [channel]),
           [] <- Store.query(db, "select 1 from message_links where board_message_id = ?", [id]) do
        thread =
          case Store.query(db, "select chat_thread_name from thread_links where board_root_id = ? and space_name = ?", [
                 root,
                 space
               ]) do
            [%{"chat_thread_name" => thread}] -> thread
            [] -> nil
          end

        %{space: space, thread: thread}
      else
        _ -> nil
      end
    end)
  end

  # The board message a Google Chat message was mirrored as.
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

  # The Google Chat message a board message was mirrored as.
  defp board_message_link(call, id) do
    case Store.transaction(call, fn db ->
           Store.query(db, "select board_message_id, chat_message_name, origin from message_links where board_message_id = ?", [
             id
           ])
         end) do
      [%{"board_message_id" => id, "chat_message_name" => name, "origin" => origin}] ->
        %{board_message_id: id, chat_message_name: name, origin: origin}

      [] ->
        nil
    end
  end

  # A message that's gone on one side takes its links with it, so nothing tries to change it on the other.
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

  # Board's profile is a letter, then up to 31 letters, digits or hyphens: a Google Chat name, as close as that allows,
  # and always `chat-` first, so a Chat user named after an agent isn't shown as that agent.
  defp profile_for(name) do
    clean =
      name
      |> to_string()
      |> String.replace(~r/[^A-Za-z0-9-]+/, "-")
      |> String.trim("-")

    String.slice("chat-" <> clean, 0, 32) |> String.trim_trailing("-")
  end
end
