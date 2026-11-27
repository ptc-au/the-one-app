defmodule Board do
  @moduledoc """
  Shared message board and task queue for people and coding agents: hierarchical channels, one-level threads,
  compare-and-swap labels, normalized reactions, lease-fenced tasks with dependency DAGs, versioned JSON Schema
  blocks, self-scheduled follow-ups, and MCP Events (`OneCore.Events`).
  """
  @behaviour OneCore.App

  alias Board.Store
  require Logger
  alias OneCore.{Artifact, Call, Events}

  @default_lease 900
  @min_lease 30
  @max_lease 3600
  @max_attachments 10
  @max_attachment_bytes 100 * 1024 * 1024

  # What a write changes, of Board's reads (`changes` in `tools/0`): clients ask only those again.
  @new_thread ["read", "channels"]
  @in_thread ["read", "thread"]
  @queue ["read", "thread", "channels", "widget"]
  @needs_you ["read", "thread", "channels", "widget", "badge"]

  @impl true
  def icon, do: "client/icon.svg"

  @impl true
  def own, do: :installed

  @impl true
  def requires do
    %{
      "core" => ">= 0.37.0",
      "database" => "to keep channels, threads, tasks, schemas, and schedules",
      "notifications" => "to alert people when a task is blocked"
    }
  end

  @impl true
  def entrypoints do
    [
      %{page: "client/index.html", badge: "badge", runtime_version: 4}
    ]
  end

  @impl true
  def widgets, do: [%{name: "Board", tool: "widget", sizes: ["2x2", "4x2"]}]

  @impl true
  def hooks, do: ["renamed"]

  # Someone renamed wrote, reacted to, owns and claimed what they did by their new name.
  @impl true
  def hook("renamed", %{"who" => old, "to" => new}, call) do
    columns = [messages: "author", reactions: "actor", tasks: "owner_actor", tasks: "claimed_by_actor", schemas: "created_by", schedules: "author"]
    Store.transaction(call, fn db -> for {table, column} <- columns, do: Store.query(db, "update or replace #{table} set #{column} = ? where #{column} = ?", [new, old]) end)
    nil
  end

  @impl true
  def events do
    [
      %{
        name: "message_posted",
        description: "A message or reply was posted to a channel or thread.",
        inputs: %{
          type: "object",
          properties: %{
            channel: %{type: "string"},
            root_id: %{type: "string"},
            author: %{type: "string"},
            profile: %{type: "string"}
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            id: %{type: "string"},
            channel: %{type: "string"},
            root_id: %{type: ["string", "null"]},
            author: %{type: "string"},
            profile: %{type: ["string", "null"]},
            display_author: %{type: "string"},
            body: %{type: "string"},
            no_sync: %{type: "boolean"}
          }
        }
      },
      %{
        name: "message_edited",
        description: "A message was edited.",
        inputs: %{type: "object", properties: %{channel: %{type: "string"}, root_id: %{type: "string"}}},
        outputs: %{
          type: "object",
          properties: %{
            id: %{type: "string"},
            channel: %{type: "string"},
            root_id: %{type: ["string", "null"]},
            profile: %{type: ["string", "null"]},
            display_author: %{type: "string"},
            body: %{type: "string"},
            revision: %{type: "integer"}
          }
        }
      },
      %{
        name: "message_deleted",
        description: "A message was deleted.",
        inputs: %{type: "object", properties: %{channel: %{type: "string"}, root_id: %{type: "string"}}},
        outputs: %{
          type: "object",
          properties: %{id: %{type: "string"}, channel: %{type: "string"}, root_id: %{type: ["string", "null"]}}
        }
      },
      %{
        name: "reaction_changed",
        description: "A reaction was added to a message or taken off it.",
        inputs: %{type: "object", properties: %{channel: %{type: "string"}, actor: %{type: "string"}}},
        outputs: %{
          type: "object",
          properties: %{
            id: %{type: "string"},
            channel: %{type: "string"},
            emoji: %{type: "string"},
            glyph: %{type: "string"},
            remove: %{type: "boolean"},
            actor: %{type: "string"},
            profile: %{type: ["string", "null"]},
            no_sync: %{type: "boolean"}
          }
        }
      },
      %{
        name: "labels_changed",
        description: "Labels on a message or task root changed.",
        inputs: %{type: "object", properties: %{channel: %{type: "string"}, message_id: %{type: "string"}}},
        outputs: %{
          type: "object",
          properties: %{message_id: %{type: "string"}, channel: %{type: "string"}, labels: %{type: "object"}}
        }
      },
      %{
        name: "task_ready",
        description: "A task is ready to be claimed.",
        inputs: %{
          type: "object",
          properties: %{channel: %{type: "string"}, owner: %{type: "string"}, assigned_profile: %{type: "string"}}
        },
        outputs: %{
          type: "object",
          properties: %{
            id: %{type: "string"},
            channel: %{type: "string"},
            body: %{type: "string"},
            owner: %{type: "string"},
            assigned_profile: %{type: ["string", "null"]}
          }
        }
      },
      %{
        name: "task_blocked",
        description: "A task is held waiting on a person.",
        inputs: %{type: "object", properties: %{channel: %{type: "string"}, owner: %{type: "string"}, kind: %{type: "string"}}},
        outputs: %{
          type: "object",
          properties: %{
            id: %{type: "string"},
            channel: %{type: "string"},
            question: %{type: "string"},
            kind: %{type: ["string", "null"]},
            owner: %{type: "string"},
            author: %{type: "string"},
            profile: %{type: ["string", "null"]}
          }
        }
      },
      %{
        name: "task_completed",
        description: "A task was completed with its result.",
        inputs: %{type: "object", properties: %{channel: %{type: "string"}, owner: %{type: "string"}}},
        outputs: %{
          type: "object",
          properties: %{
            id: %{type: "string"},
            channel: %{type: "string"},
            result: %{type: "string"},
            owner: %{type: "string"},
            author: %{type: "string"},
            profile: %{type: ["string", "null"]}
          }
        }
      }
    ]
  end

  @impl true
  def tools do
    [
      %{
        name: "channels",
        read_only: true,
        description: "List channels with thread, ready-task, and blocked-task counts.",
        inputs: %{type: "object", properties: %{prefix: %{type: "string", description: "Optional channel prefix filter"}}},
        outputs: %{type: "object", properties: %{channels: %{type: "array", items: %{type: "object"}}}}
      },
      %{
        name: "read",
        read_only: true,
        ui: "client/index.html",
        runtime_version: 4,
        description:
          "Read thread summaries in a channel/subtree (channel, state, label, limit): Board's first screen, its list. One thread in full is `thread`.",
        inputs: %{
          type: "object",
          properties: %{
            channel: %{type: "string", description: "Channel path or trailing-/ subtree (e.g. dev or work/)"},
            state: %{type: "string", description: "Filter tasks by state (waiting, ready, claimed, blocked, completed, failed, canceled)"},
            label: %{type: "string", description: "Filter by key=value label on root or reply"},
            limit: %{type: "integer", description: "Max threads to return (default 50, max 200)"},
            before: %{type: "string", description: "Page: the `next` of the answer before, which gives the threads older than that one"}
          }
        },
        outputs: %{type: "object", properties: %{threads: %{type: "array", items: %{type: "object"}}, next: %{type: ["string", "null"], description: "Where the next page starts, for `before`; none on the last"}}}
      },
      %{
        name: "thread",
        read_only: true,
        ui: "client/index.html",
        path: "threads/{id}",
        runtime_version: 4,
        description:
          "One thread in full, with its replies and its task: Board's screen of it, at /board/threads/msg_…, with the list beside it, which `channel` and `state` filter as `read`'s do.",
        inputs: %{
          type: "object",
          required: ["id"],
          properties: %{
            id: %{type: "string", description: "Thread root ID"},
            channel: %{type: "string", description: "The list beside it: its channel path or trailing-/ subtree"},
            state: %{type: "string", description: "The list beside it: its tasks' state"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "post",
        changes: @new_thread,
        ui: "client/index.html",
        runtime_version: 4,
        description:
          "Start a new thread in a channel. Always pass profile (your agent name) when acting as an agent. Under this call, and as a link with its arguments (/board/post?channel=dev&body=…), Board opens the new post's form filled in, which is never sent until its person sends it.",
        inputs: %{
          type: "object",
          required: ["channel", "body"],
          properties: %{
            channel: %{type: "string"},
            body: %{type: "string"},
            profile: %{type: "string"},
            labels: %{type: "object"},
            no_sync: %{type: "boolean", description: "Don't pass it to apps that mirror this channel elsewhere, such as a chat app"},
            file: %{type: "string", format: "upload", description: "Optional uploaded file attachment"},
            file_name: %{type: "string", description: "Filename for the attachment"},
            mime_type: %{type: "string", description: "Its kind: kept for a picture or a PDF, application/octet-stream for anything else"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "reply",
        changes: @in_thread,
        ui: "client/index.html",
        path: "threads/{id}/reply",
        runtime_version: 4,
        description:
          "Reply in an existing thread. Pass after=<msg_id> to ensure no newer message landed first. Under this call, and as a link with its arguments, Board opens the thread with the reply filled in, which is never sent until its person sends it.",
        inputs: %{
          type: "object",
          required: ["id", "body"],
          properties: %{
            id: %{type: "string", description: "Thread root ID"},
            body: %{type: "string"},
            profile: %{type: "string"},
            reply_to: %{type: "string", description: "Specific message ID replied to within the thread"},
            after: %{type: "string", description: "Compare-and-swap: fail if another reply landed after this message ID"},
            no_sync: %{type: "boolean", description: "Don't pass it to apps that mirror this channel elsewhere, such as a chat app"},
            file: %{type: "string", format: "upload", description: "Optional uploaded file attachment"},
            file_name: %{type: "string", description: "Filename for the attachment"},
            mime_type: %{type: "string", description: "Its kind: kept for a picture or a PDF, application/octet-stream for anything else"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "edit",
        changes: @needs_you,
        description: "Edit a message you wrote. Pass if_revision for compare-and-swap.",
        inputs: %{
          type: "object",
          required: ["id", "body"],
          properties: %{
            id: %{type: "string"},
            body: %{type: "string"},
            profile: %{type: "string"},
            if_revision: %{type: "integer"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "delete",
        changes: @needs_you,
        description: "Delete a message you wrote (leaves a tombstone; deleting a task root cancels it unless completed).",
        inputs: %{
          type: "object",
          required: ["id"],
          properties: %{id: %{type: "string"}, profile: %{type: "string"}, if_revision: %{type: "integer"}}
        },
        outputs: %{type: "object"}
      },
      %{
        name: "react",
        changes: @in_thread,
        description: "Add or remove a normalized emoji reaction on a message.",
        inputs: %{
          type: "object",
          required: ["id", "emoji"],
          properties: %{
            id: %{type: "string"},
            emoji: %{type: "string"},
            profile: %{type: "string"},
            remove: %{type: "boolean"},
            no_sync: %{type: "boolean", description: "Don't pass it to apps that mirror this channel elsewhere, such as a chat app"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "label",
        changes: @in_thread,
        description: "Set or unset labels on a message with optional atomic compare-and-swap (if, if_unset).",
        inputs: %{
          type: "object",
          required: ["id"],
          properties: %{
            id: %{type: "string"},
            profile: %{type: "string"},
            set: %{type: "object", description: "Map of key -> value to set"},
            unset: %{type: "array", items: %{type: "string"}, description: "Keys to remove"},
            if: %{type: "object", description: "Require these key -> value pairs before writing"},
            if_unset: %{type: "array", items: %{type: "string"}, description: "Require these keys to be unset"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "attach",
        changes: @in_thread,
        description: "Attach an uploaded file (up to 10 per message, 100 MB each) to an existing message.",
        inputs: %{
          type: "object",
          required: ["id", "file"],
          properties: %{
            id: %{type: "string", description: "Message ID to attach the file to"},
            profile: %{type: "string"},
            file: %{type: "string", format: "upload", description: "Uploaded file blob"},
            name: %{type: "string", description: "Filename shown to readers"},
            mime_type: %{type: "string", description: "Its kind: kept for a picture or a PDF, application/octet-stream for anything else"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "download",
        read_only: true,
        description: "Download a message attachment by its attachment ID.",
        inputs: %{type: "object", required: ["id"], properties: %{id: %{type: "string"}}},
        outputs: %{type: "object", properties: %{mimeType: %{type: "string"}}, required: ["mimeType"]}
      },
      %{
        name: "schemas_create",
        changes: ["schemas_list"],
        description: "Register an immutable versioned JSON Schema (e.g. security-finding@1) for fenced data blocks.",
        inputs: %{
          type: "object",
          required: ["name", "schema"],
          properties: %{name: %{type: "string"}, schema: %{type: "object"}, description: %{type: "string"}}
        },
        outputs: %{type: "object"}
      },
      %{
        name: "schemas_list",
        read_only: true,
        description: "List registered structured-data JSON Schemas.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object", properties: %{schemas: %{type: "array", items: %{type: "object"}}}}
      },
      %{
        name: "task_create",
        changes: @queue,
        description:
          "Create a task (channel + body), convert an existing thread (id), or create an atomic multi-task plan (channel + plan array up to 100 items with key/needs).",
        inputs: %{
          type: "object",
          properties: %{
            id: %{type: "string", description: "Existing thread root ID to convert into a task"},
            channel: %{type: "string"},
            body: %{type: "string"},
            profile: %{type: "string"},
            assigned_profile: %{type: "string"},
            labels: %{type: "object"},
            needs: %{type: "array", items: %{type: "string"}, description: "Task IDs this task waits on"},
            plan: %{type: "array", items: %{type: "object"}, description: "Atomic list of up to 100 tasks with optional key and needs"},
            no_sync: %{type: "boolean", description: "Don't pass it to apps that mirror this channel elsewhere, such as a chat app"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "task_claim",
        changes: @queue,
        description:
          "Claim a specific task (id) or the oldest ready task (ready: true, channel). Only claims your own user's tasks unless from is passed explicitly.",
        inputs: %{
          type: "object",
          properties: %{
            id: %{type: "string"},
            ready: %{type: "boolean"},
            channel: %{type: "string"},
            label: %{type: "string"},
            from: %{type: "string", description: "Explicit owner actor (e.g. users/alice) whose tasks you agree to claim"},
            profile: %{type: "string"},
            lease_seconds: %{type: "integer", description: "Lease duration in seconds (30..3600, default 900)"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "task_renew",
        changes: @in_thread,
        description: "Renew an active task lease.",
        inputs: %{
          type: "object",
          required: ["id", "epoch", "token"],
          properties: %{
            id: %{type: "string"},
            epoch: %{type: "integer"},
            token: %{type: "string"},
            lease_seconds: %{type: "integer"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "task_complete",
        changes: @needs_you,
        description: "Complete a claimed task with its result and unblock dependent tasks.",
        inputs: %{
          type: "object",
          required: ["id", "result"],
          properties: %{
            id: %{type: "string"},
            result: %{type: "string"},
            epoch: %{type: "integer"},
            token: %{type: "string"},
            profile: %{type: "string"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "task_fail",
        changes: @needs_you,
        description: "Fail a claimed task with a reason.",
        inputs: %{
          type: "object",
          required: ["id", "reason"],
          properties: %{
            id: %{type: "string"},
            reason: %{type: "string"},
            epoch: %{type: "integer"},
            token: %{type: "string"},
            profile: %{type: "string"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "task_release",
        changes: @queue,
        description: "Release a claimed task back to ready.",
        inputs: %{
          type: "object",
          required: ["id", "epoch", "token"],
          properties: %{id: %{type: "string"}, epoch: %{type: "integer"}, token: %{type: "string"}, profile: %{type: "string"}}
        },
        outputs: %{type: "object"}
      },
      %{
        name: "task_block",
        changes: @needs_you,
        description: "Hold a task for a person, post the question in its thread, and notify them.",
        inputs: %{
          type: "object",
          required: ["id", "question"],
          properties: %{
            id: %{type: "string"},
            question: %{type: "string"},
            kind: %{type: "string", description: "e.g. needs_input, awaiting_approval"},
            epoch: %{type: "integer"},
            token: %{type: "string"},
            profile: %{type: "string"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "task_unblock",
        changes: @needs_you,
        description: "Unblock a held task back to ready (or waiting if prerequisites remain). A person does this, not an agent, so it takes no profile.",
        inputs: %{type: "object", required: ["id"], properties: %{id: %{type: "string"}}},
        outputs: %{type: "object"}
      },
      %{
        name: "task_cancel",
        changes: @needs_you,
        description: "Cancel a task. Only its owner can.",
        inputs: %{type: "object", required: ["id"], properties: %{id: %{type: "string"}, reason: %{type: "string"}, profile: %{type: "string"}}},
        outputs: %{type: "object"}
      },
      %{
        name: "task_reopen",
        changes: @needs_you,
        description: "Reopen a failed or canceled task back to ready (or waiting). A person does this, not an agent, so it takes no profile.",
        inputs: %{type: "object", required: ["id"], properties: %{id: %{type: "string"}}},
        outputs: %{type: "object"}
      },
      %{
        name: "schedule_create",
        changes: ["schedules_list"],
        description: "Schedule a future or recurring post in a channel or reply in a thread.",
        inputs: %{
          type: "object",
          required: ["target", "body"],
          properties: %{
            target: %{type: "string", description: "Channel path or existing thread root ID"},
            body: %{type: "string"},
            in_seconds: %{type: "integer"},
            at: %{type: "string", description: "ISO 8601 timestamp"},
            every_seconds: %{type: "integer", description: "Repeat interval (min 60s)"},
            until: %{type: "string", description: "ISO 8601 stop time"},
            times: %{type: "integer", description: "Max sends"},
            profile: %{type: "string"},
            no_sync: %{type: "boolean", description: "Don't pass what it posts to apps that mirror this channel elsewhere, such as a chat app"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "schedules_list",
        read_only: true,
        description: "List scheduled messages, with `failed` saying why one that couldn't be posted won't be.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object", properties: %{schedules: %{type: "array", items: %{type: "object"}}}}
      },
      %{
        name: "schedule_cancel",
        changes: ["schedules_list"],
        description: "Cancel a scheduled message. Only whoever scheduled it can.",
        inputs: %{type: "object", required: ["id"], properties: %{id: %{type: "string"}, profile: %{type: "string"}}},
        outputs: %{type: "object"}
      },
      %{
        name: "tick_schedules",
        changes: [],
        description: "Posts due scheduled messages and expires lapsed task leases. Board's timer calls it when the next lease lapses or schedule is due, and again for the next.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object"}
      },
      %{
        name: "badge",
        read_only: true,
        description: "Count of tasks waiting on a person: blocked, or failed and not yet reopened or left.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object", properties: %{count: %{type: "integer"}}}
      },
      %{
        name: "widget",
        read_only: true,
        description: "Home Screen widget showing the tasks waiting on a person, and the ready and active counts.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object"}
      }
    ]
  end

  # --- Tool Dispatch ---

  @impl true
  def call(tool, inputs, call) do
    case dispatch(tool, inputs, call) do
      {:error, why} -> raise Call.Refused, why
      result -> result
    end
  end

  defp dispatch("channels", inputs, call) do
    prefix = inputs["prefix"]

    channels =
      Store.transaction(call, fn db ->
        rows =
          Store.query(
            db,
            """
            select m.channel,
                   count(distinct m.id) as threads,
                   sum(case when #{Store.state_sql()} = 'ready' then 1 else 0 end) as ready_tasks,
                   sum(case when #{Store.state_sql()} = 'claimed' then 1 else 0 end) as claimed_tasks,
                   sum(case when #{Store.state_sql()} = 'blocked' then 1 else 0 end) as blocked_tasks,
                   max(m.created_at) as last_at
            from messages m
            left join tasks t on t.root_id = m.id
            where m.root_id is null and m.deleted_at is null
            group by m.channel
            order by last_at desc
            """
          )

        for %{
              "channel" => ch,
              "threads" => threads,
              "ready_tasks" => ready,
              "claimed_tasks" => claimed,
              "blocked_tasks" => blocked,
              "last_at" => last_at
            } <- rows,
            prefix == nil or prefix == "" or ch == prefix or String.starts_with?(ch, String.trim_trailing(prefix, "/") <> "/") do
          %{channel: ch, threads: threads, ready: ready || 0, claimed: claimed || 0, blocked: blocked || 0, last_at: last_at}
        end
      end)

    %{channels: channels}
  end

  defp dispatch("thread", %{"id" => id}, call) do
    Store.transaction(call, fn db ->
      case Store.query(
             db,
             """
             select id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at, edited_at, deleted_at
             from messages where id = ?
             """,
             [id]
           ) do
        [root_row] ->
          root = Store.format_message(db, root_row)

          replies =
            Store.query(
              db,
              """
              select id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at, edited_at, deleted_at
              from messages where root_id = ? order by created_at asc
              """,
              [id]
            )
            |> Enum.map(&Store.format_message(db, &1))

          %{thread: Map.put(root, :task, Store.task_row(db, id)), replies: replies}

        [] ->
          {:error, "Thread #{id} not found."}
      end
    end)
  end

  defp dispatch("read", inputs, call) do
    channel = inputs["channel"]
    state = inputs["state"]
    label = inputs["label"]
    limit = min(max(inputs["limit"] || 50, 1), 200)

    Store.transaction(call, fn db ->
      {where_sql, params} = read_filters(channel, state, label, inputs["before"])

      roots =
        Store.query(
          db,
          """
          select m.id, m.channel, m.root_id, m.reply_to, m.author, m.profile, m.body, m.blocks,
                 m.revision, m.no_sync, m.created_at, m.edited_at, m.deleted_at
          from messages m
          #{where_sql}
          order by m.created_at desc, m.id desc
          limit ?
          """,
          params ++ [limit + 1]
        )

      {roots, next} = if length(roots) > limit, do: {Enum.take(roots, limit), List.last(Enum.take(roots, limit))["id"]}, else: {roots, nil}

      threads =
        Enum.map(roots, fn %{"id" => id} = row ->
          msg = Store.format_message(db, row)
          [%{"n" => reply_count}] = Store.query(db, "select count(*) as n from messages where root_id = ? and deleted_at is null", [id])
          msg |> Map.put(:reply_count, reply_count) |> Map.put(:task, Store.task_row(db, id))
        end)

      %{threads: threads, next: next}
    end)
  end

  defp dispatch("post", inputs, call) do
    with {:ok, channel} <- Store.validate_channel(inputs["channel"]),
         {:ok, body} <- Store.validate_body(inputs["body"]),
         {:ok, profile} <- Store.validate_profile(inputs["profile"]),
         :ok <- validate_labels_map(inputs["labels"]),
         {:ok, upload} <- validate_optional_upload(call, inputs["file"], inputs["file_name"], inputs["mime_type"]) do
      author = call.actor || call.subject
      no_sync = if inputs["no_sync"] == true, do: 1, else: 0

      result =
        Store.transaction(call, fn db ->
          with {:ok, blocks} <- Store.parse_and_validate_blocks(db, body) do
            id = Store.new_id("msg")
            now = Store.now_iso()

            Store.query(
              db,
              """
              insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
              values (?, ?, null, null, ?, ?, ?, ?, 1, ?, ?)
              """,
              [id, channel, author, profile, body, JSON.encode!(blocks), no_sync, now]
            )

            for {k, v} <- inputs["labels"] || %{} do
              Store.query(db, "insert or replace into labels (message_id, key, value) values (?, ?, ?)", [id, k, v])
            end

            if upload, do: insert_attachment(db, id, upload, now)

            {:ok,
             %{
               id: id,
               channel: channel,
               root_id: nil,
               author: author,
               profile: profile,
               display_author: Store.display_author(author, profile),
               body: body,
               blocks: blocks,
               labels: Store.labels_for(db, id),
               attachments: Store.attachments_for(db, id),
               revision: 1,
               no_sync: no_sync == 1,
               created_at: now
             }}
          end
        end)

      case result do
        {:ok, msg} ->
          posted(call, msg)
          msg

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("reply", inputs, call) do
    with root_id when is_binary(root_id) <- inputs["id"] || {:error, "Thread id is required."},
         {:ok, body} <- Store.validate_body(inputs["body"]),
         {:ok, profile} <- Store.validate_profile(inputs["profile"]),
         {:ok, upload} <- validate_optional_upload(call, inputs["file"], inputs["file_name"], inputs["mime_type"]) do
      author = call.actor || call.subject
      no_sync = if inputs["no_sync"] == true, do: 1, else: 0

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select channel, deleted_at from messages where id = ? and root_id is null", [root_id]) do
            [%{"channel" => channel, "deleted_at" => nil}] ->
              with :ok <- check_after(db, root_id, inputs["after"]),
                   {:ok, blocks} <- Store.parse_and_validate_blocks(db, body) do
                id = Store.new_id("msg")
                now = Store.now_iso()

                Store.query(
                  db,
                  """
                  insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
                  values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                  """,
                  [id, channel, root_id, inputs["reply_to"], author, profile, body, JSON.encode!(blocks), no_sync, now]
                )

                if upload, do: insert_attachment(db, id, upload, now)

                {:ok,
                 %{
                   id: id,
                   channel: channel,
                   root_id: root_id,
                   reply_to: inputs["reply_to"],
                   author: author,
                   profile: profile,
                   display_author: Store.display_author(author, profile),
                   body: body,
                   blocks: blocks,
                   attachments: Store.attachments_for(db, id),
                   revision: 1,
                   no_sync: no_sync == 1,
                   created_at: now
                 }}
              end

            [_deleted] ->
              {:error, "Thread #{root_id} was deleted."}

            [] ->
              {:error, "Thread #{root_id} not found."}
          end
        end)

      case result do
        {:ok, msg} ->
          posted(call, msg)
          msg

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("edit", inputs, call) do
    with id when is_binary(id) <- inputs["id"] || {:error, "Message id is required."},
         {:ok, body} <- Store.validate_body(inputs["body"]),
         {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select channel, root_id, author, profile, revision, deleted_at from messages where id = ?", [id]) do
            [%{"channel" => channel, "root_id" => root_id, "author" => msg_author, "profile" => msg_profile, "revision" => rev, "deleted_at" => nil}] ->
              cond do
                not can_edit?(actor, profile, msg_author, msg_profile) ->
                  {:error, "Only the author can edit this message."}

                inputs["if_revision"] != nil and inputs["if_revision"] != rev ->
                  {:error, "revision_conflict: message is at revision #{rev}, not #{inputs["if_revision"]}."}

                true ->
                  with {:ok, blocks} <- Store.parse_and_validate_blocks(db, body) do
                    now = Store.now_iso()
                    new_rev = rev + 1

                    Store.query(
                      db,
                      "update messages set body = ?, blocks = ?, revision = ?, edited_at = ? where id = ?",
                      [body, JSON.encode!(blocks), new_rev, now, id]
                    )

                    # Prompt-injection guard: editing a task root by someone other than the task owner holds it.
                    if root_id == nil do
                      case Store.query(db, "select owner_actor, state from tasks where root_id = ?", [id]) do
                        [%{"owner_actor" => owner, "state" => state}] when owner != actor and state not in ["completed", "canceled"] ->
                          Store.query(
                            db,
                            """
                            update tasks
                            set state = 'blocked', block_kind = 'edited', claim_token_hash = null,
                                claimed_by_actor = null, claimed_by_profile = null, lease_until = null, updated_at = ?
                            where root_id = ?
                            """,
                            [now, id]
                          )

                        _ ->
                          :ok
                      end
                    end

                    {:ok,
                     %{
                       id: id,
                       channel: channel,
                       root_id: root_id,
                       author: msg_author,
                       profile: msg_profile,
                       display_author: Store.display_author(msg_author, msg_profile),
                       body: body,
                       blocks: blocks,
                       revision: new_rev,
                       edited_at: now
                     }}
                  end
              end

            [%{"deleted_at" => _deleted}] ->
              {:error, "Message #{id} has been deleted."}

            [] ->
              {:error, "Message #{id} not found."}
          end
        end)

      case result do
        {:ok, msg} ->

          Events.emit(call, "message_edited", %{
            "id" => msg.id,
            "channel" => msg.channel,
            "root_id" => msg.root_id,
            "profile" => msg.profile,
            "display_author" => msg.display_author,
            "body" => msg.body,
            "revision" => msg.revision
          })

          msg

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("delete", inputs, call) do
    with id when is_binary(id) <- inputs["id"] || {:error, "Message id is required."},
         {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select channel, root_id, author, profile, revision, deleted_at from messages where id = ?", [id]) do
            [%{"channel" => channel, "root_id" => root_id, "author" => msg_author, "profile" => msg_profile, "revision" => rev, "deleted_at" => nil}] ->
              cond do
                not can_edit?(actor, profile, msg_author, msg_profile) ->
                  {:error, "Only the author can delete this message."}

                inputs["if_revision"] != nil and inputs["if_revision"] != rev ->
                  {:error, "revision_conflict: message is at revision #{rev}, not #{inputs["if_revision"]}."}

                true ->
                  now = Store.now_iso()
                  [%{"body" => body}] = Store.query(db, "select body from messages where id = ?", [id])
                  blobs = tombstone(db, id, rev + 1, now)

                  # A thread's replies are deleted with it, and what waited on its task is blocked.
                  {replies, blocked} =
                    if root_id == nil do
                      replies = Store.query(db, "select id, revision from messages where root_id = ? and deleted_at is null", [id])
                      blobs = blobs ++ for(%{"id" => rid, "revision" => r} <- replies, blob <- tombstone(db, rid, r + 1, now), do: blob)

                      Store.query(
                        db,
                        "update tasks set state = 'canceled', claim_token_hash = null, lease_until = null, updated_at = ? where root_id = ? and state != 'completed'",
                        [now, id]
                      )

                      {for(%{"id" => rid} <- replies, do: rid), block_waiting(db, id, body, actor, profile, "was deleted")}
                    else
                      {[], []}
                    end

                  {:ok, %{id: id, channel: channel, root_id: root_id, deleted: true, revision: rev + 1, blobs: blobs, replies: replies, blocked: blocked}}
              end

            [%{"deleted_at" => _deleted}] ->
              {:ok, %{id: id, deleted: true}}

            [] ->
              {:error, "Message #{id} not found."}
          end
        end)

      case result do
        {:ok, %{channel: channel, root_id: root_id, blobs: blobs} = res} ->
          for blob <- blobs, do: Artifact.remove(call.own, blob)
          for rid <- res.replies, do: Events.emit(call, "message_deleted", %{"id" => rid, "channel" => channel, "root_id" => res.id})
          Events.emit(call, "message_deleted", %{"id" => res.id, "channel" => channel, "root_id" => root_id})
          announce_blocked(call, actor, profile, channel, hd(res.blocked ++ [%{id: res.id}]).id, res.blocked, "deleted a task")
          Map.take(res, [:id, :channel, :root_id, :deleted, :revision])

        {:ok, res} ->
          res

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("react", inputs, call) do
    with id when is_binary(id) <- inputs["id"] || {:error, "Message id is required."},
         {:ok, emoji} <- Store.normalize_emoji(inputs["emoji"]),
         {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject
      prof_key = profile || ""

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select channel, deleted_at from messages where id = ?", [id]) do
            [%{"channel" => channel, "deleted_at" => nil}] ->
              if inputs["remove"] == true do
                Store.query(db, "delete from reactions where message_id = ? and actor = ? and profile = ? and emoji = ?", [id, actor, prof_key, emoji])
              else
                Store.query(db, "insert or ignore into reactions (message_id, actor, profile, emoji) values (?, ?, ?, ?)", [id, actor, prof_key, emoji])
              end

              {:ok, %{id: id, channel: channel, reactions: Store.reactions_for(db, id)}}

            _ ->
              {:error, "Message #{id} not found."}
          end
        end)

      case result do
        {:ok, res} ->

          Events.emit(call, "reaction_changed", %{
            "id" => id,
            "channel" => res.channel,
            "emoji" => emoji,
            "glyph" => Store.glyph(emoji),
            "remove" => inputs["remove"] == true,
            "actor" => actor,
            "profile" => profile,
            "no_sync" => inputs["no_sync"] == true
          })

          res

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("label", inputs, call) do
    with id when is_binary(id) <- inputs["id"] || {:error, "Message id is required."},
         {:ok, profile} <- Store.validate_profile(inputs["profile"]),
         :ok <- validate_labels_map(inputs["set"]),
         :ok <- validate_unset_list(inputs["unset"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select channel, author, profile from messages where id = ? and deleted_at is null", [id]) do
            [%{"channel" => channel, "author" => author, "profile" => msg_profile}] ->
              current = Store.labels_for(db, id)

              with :ok <- author_only(actor, profile, author, msg_profile, "label"),
                   :ok <- check_if_labels(current, inputs["if"]),
                   :ok <- check_if_unset(current, inputs["if_unset"]) do
                for k <- inputs["unset"] || [] do
                  Store.query(db, "delete from labels where message_id = ? and key = ?", [id, k])
                end

                for {k, v} <- inputs["set"] || %{} do
                  Store.query(db, "insert or replace into labels (message_id, key, value) values (?, ?, ?)", [id, k, v])
                end

                {:ok, %{message_id: id, channel: channel, labels: Store.labels_for(db, id)}}
              end

            [] ->
              {:error, "Message #{id} not found."}
          end
        end)

      case result do
        {:ok, res} ->
          Events.emit(call, "labels_changed", res)
          res

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("attach", %{"id" => msg_id, "file" => blob} = inputs, call) when is_binary(msg_id) and is_binary(blob) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]),
         {:ok, upload} <- validate_optional_upload(call, blob, inputs["name"], inputs["mime_type"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select author, profile, deleted_at from messages where id = ?", [msg_id]) do
            [%{"author" => author, "profile" => msg_profile, "deleted_at" => nil}] ->
              [%{"n" => count}] = Store.query(db, "select count(*) as n from attachments where message_id = ?", [msg_id])

              with :ok <- author_only(actor, profile, author, msg_profile, "attach to") do
                if count >= @max_attachments do
                  {:error, "A message can have at most #{@max_attachments} attachments."}
                else
                  {:ok, insert_attachment(db, msg_id, upload, Store.now_iso())}
                end
              end

            _ ->
              {:error, "Message #{msg_id} not found."}
          end
        end)

      case result do
        {:ok, att} ->
          att

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("download", %{"id" => att_id}, call) when is_binary(att_id) do
    found =
      Store.transaction(call, fn db ->
        Store.query(
          db,
          """
          select a.blob, a.mime_type from attachments a
          join messages m on m.id = a.message_id
          where a.id = ? and m.deleted_at is null
          """,
          [att_id]
        )
      end)

    case found do
      [%{"blob" => blob, "mime_type" => mime}] -> {:file, safe_mime_type(mime), call.own, blob}
      [] -> {:error, "Attachment #{att_id} not found."}
    end
  end

  defp dispatch("schemas_create", inputs, call) do
    with {:ok, _base, _ver} <- Store.validate_schema_name(inputs["name"]),
         %{} = defn <- inputs["schema"] || {:error, "schema object is required."} do
      name = inputs["name"]
      desc = inputs["description"] || ""
      encoded = JSON.encode!(defn)
      actor = call.actor || call.subject

      Store.transaction(call, fn db ->
        case Store.query(db, "select definition from schemas where name = ?", [name]) do
          [%{"definition" => existing}] ->
            if JSON.decode!(existing) == defn,
              do: %{name: name, description: desc, created: false},
              else: {:error, "schema_immutable: #{name} already exists with a different definition. Register a new version."}

          [] ->
            now = Store.now_iso()

            Store.query(
              db,
              "insert into schemas (name, description, definition, created_by, created_at) values (?, ?, ?, ?, ?)",
              [name, desc, encoded, actor, now]
            )

            %{name: name, description: desc, created: true, created_at: now}
        end
      end)
    end
  end

  defp dispatch("schemas_list", _inputs, call) do
    schemas =
      Store.transaction(call, fn db ->
        for %{"name" => name, "description" => desc, "definition" => defn, "created_by" => by, "created_at" => at} <-
              Store.query(db, "select name, description, definition, created_by, created_at from schemas order by name") do
          %{name: name, description: desc, schema: JSON.decode!(defn), created_by: by, created_at: at}
        end
      end)

    %{schemas: schemas}
  end

  defp dispatch("task_create", %{"plan" => plan} = inputs, call) when is_list(plan) do
    with {:ok, channel} <- Store.validate_channel(inputs["channel"]),
         {:ok, profile} <- Store.validate_profile(inputs["profile"]),
         true <- length(plan) in 1..100 || {:error, "Plan must contain between 1 and 100 tasks."} do
      owner = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          create_plan(db, channel, owner, profile, plan)
        end)

      case result do
        {:ok, created} ->

          for t <- created, t.state == "ready" do
            Events.emit(call, "task_ready", %{id: t.id, channel: channel, body: t.body, owner: owner, assigned_profile: t.assigned_profile})
          end

          %{tasks: created}

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_create", %{"id" => root_id} = inputs, call) when is_binary(root_id) and root_id != "" do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]),
         {:ok, assigned} <- Store.validate_profile(inputs["assigned_profile"]) do
      owner = call.actor || call.subject
      needs = inputs["needs"] || []

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select channel, body from messages where id = ? and root_id is null and deleted_at is null", [root_id]) do
            [%{"channel" => channel, "body" => body}] ->
              case Store.query(db, "select state from tasks where root_id = ?", [root_id]) do
                [_] -> {:error, "Thread #{root_id} is already a task."}
                [] -> insert_task(db, root_id, channel, body, owner, profile, assigned, needs)
              end

            [] ->
              {:error, "Thread #{root_id} not found."}
          end
        end)

      finish_task_create(call, result)
    end
  end

  defp dispatch("task_create", inputs, call) do
    with {:ok, channel} <- Store.validate_channel(inputs["channel"]),
         {:ok, body} <- Store.validate_body(inputs["body"]),
         {:ok, profile} <- Store.validate_profile(inputs["profile"]),
         {:ok, assigned} <- Store.validate_profile(inputs["assigned_profile"]),
         :ok <- validate_labels_map(inputs["labels"]) do
      owner = call.actor || call.subject
      no_sync = if inputs["no_sync"] == true, do: 1, else: 0
      needs = inputs["needs"] || []

      result =
        Store.transaction(call, fn db ->
          with {:ok, blocks} <- Store.parse_and_validate_blocks(db, body) do
            id = Store.new_id("msg")
            now = Store.now_iso()

            Store.query(
              db,
              """
              insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
              values (?, ?, null, null, ?, ?, ?, ?, 1, ?, ?)
              """,
              [id, channel, owner, profile, body, JSON.encode!(blocks), no_sync, now]
            )

            for {k, v} <- inputs["labels"] || %{} do
              Store.query(db, "insert or replace into labels (message_id, key, value) values (?, ?, ?)", [id, k, v])
            end

            insert_task(db, id, channel, body, owner, profile, assigned, needs)
          end
        end)

      finish_task_create(call, result)
    end
  end

  defp dispatch("task_claim", inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject
      lease_s = min(max(inputs["lease_seconds"] || @default_lease, @min_lease), @max_lease)
      lease_until = Store.now_ms() + lease_s * 1_000
      target_owner = inputs["from"] || actor

      result =
        Store.transaction(call, fn db ->
          cond do
            is_binary(inputs["id"]) and inputs["id"] != "" ->
              claim_by_id(db, inputs["id"], target_owner, actor, profile, lease_until)

            inputs["ready"] == true ->
              claim_oldest_ready(db, inputs["channel"], inputs["label"], target_owner, actor, profile, lease_until)

            true ->
              {:error, "Provide either id or ready: true."}
          end
        end)

      case result do
        {:ok, claimed} ->
          timed(call)
          claimed

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_renew", %{"id" => id, "epoch" => epoch, "token" => token} = inputs, call) do
    lease_s = min(max(inputs["lease_seconds"] || @default_lease, @min_lease), @max_lease)
    lease_until = Store.now_ms() + lease_s * 1_000

    result =
      Store.transaction(call, fn db ->
        with :ok <- verify_claim(db, id, epoch, token) do
          Store.query(db, "update tasks set lease_until = ?, updated_at = ? where root_id = ?", [lease_until, Store.now_iso(), id])
          {:ok, %{id: id, epoch: epoch, lease_until: lease_until}}
        end
      end)

    case result do
      {:ok, res} ->
        res

      {:error, why} ->
        {:error, why}
    end
  end

  defp dispatch("task_complete", %{"id" => id, "result" => res_text} = inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          with :ok <- verify_claim_or_owner(db, id, inputs["epoch"], inputs["token"], actor, profile),
               [%{"channel" => channel, "owner_actor" => owner}] <- Store.query(db, "select m.channel, t.owner_actor from tasks t join messages m on m.id = t.root_id where t.root_id = ?", [id]) do
            now = Store.now_iso()

            Store.query(
              db,
              """
              update tasks
              set state = 'completed', result = ?, claim_token_hash = null, lease_until = null, updated_at = ?
              where root_id = ?
              """,
              [res_text, now, id]
            )

            reply_msg = append_system_reply(db, id, channel, actor, profile, "Completed: #{res_text}")
            newly_ready = Store.ready_dependents(db, id)

            ready_details =
              for rid <- newly_ready do
                [%{"channel" => rch, "body" => rbody, "owner_actor" => rowner, "assigned_profile" => rassigned}] =
                  Store.query(db, "select m.channel, m.body, t.owner_actor, t.assigned_profile from tasks t join messages m on m.id = t.root_id where t.root_id = ?", [rid])

                %{id: rid, channel: rch, body: rbody, owner: rowner, assigned_profile: rassigned}
              end

            {:ok, %{id: id, channel: channel, owner: owner, result: res_text, readied: ready_details, reply: reply_msg}}
          else
            [] -> {:error, "Task #{id} not found."}
            {:error, why} -> {:error, why}
          end
        end)

      case result do
        {:ok, done} ->
          posted(call, done.reply)
          Events.emit(call, "task_completed", %{id: done.id, channel: done.channel, result: done.result, owner: done.owner, author: actor, profile: profile})

          for r <- done.readied do
            Events.emit(call, "task_ready", r)
          end

          %{id: done.id, state: "completed", result: done.result, readied: Enum.map(done.readied, & &1.id)}

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_fail", %{"id" => id, "reason" => reason} = inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          with :ok <- verify_claim_or_owner(db, id, inputs["epoch"], inputs["token"], actor, profile),
               [%{"channel" => channel}] <- Store.query(db, "select channel from messages where id = ?", [id]) do
            now = Store.now_iso()

            Store.query(
              db,
              "update tasks set state = 'failed', result = ?, claim_token_hash = null, lease_until = null, updated_at = ? where root_id = ?",
              [reason, now, id]
            )

            reply_msg = append_system_reply(db, id, channel, actor, profile, "Failed: #{reason}")
            [%{"body" => body}] = Store.query(db, "select body from messages where id = ?", [id])
            {:ok, %{id: id, channel: channel, state: "failed", reason: reason, reply: reply_msg, blocked: block_waiting(db, id, body, actor, profile, "failed")}}
          else
            [] -> {:error, "Task #{id} not found."}
            {:error, why} -> {:error, why}
          end
        end)

      case result do
        {:ok, res} ->
          posted(call, res.reply)
          announce_blocked(call, actor, profile, res.channel, id, res.blocked, "failed a task", reason)
          %{id: id, state: "failed", reason: reason, blocked: Enum.map(res.blocked, & &1.id)}

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_release", %{"id" => id, "epoch" => epoch, "token" => token} = inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          with :ok <- verify_claim(db, id, epoch, token),
               [%{"channel" => channel}] <- Store.query(db, "select channel from messages where id = ?", [id]) do
            now = Store.now_iso()

            Store.query(
              db,
              """
              update tasks
              set state = 'ready', claim_token_hash = null, claimed_by_actor = null,
                  claimed_by_profile = null, lease_until = null, updated_at = ?
              where root_id = ?
              """,
              [now, id]
            )

            reply_msg = append_system_reply(db, id, channel, actor, profile, "Released back to queue.")
            {:ok, %{id: id, state: "ready", reply: reply_msg}}
          end
        end)

      case result do
        {:ok, res} ->
          posted(call, res.reply)
          Map.delete(res, :reply)

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_block", %{"id" => id, "question" => question} = inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject
      kind = inputs["kind"] || "needs_input"

      result =
        Store.transaction(call, fn db ->
          with :ok <- verify_claim_or_owner(db, id, inputs["epoch"], inputs["token"], actor, profile),
               [%{"channel" => channel, "owner_actor" => owner}] <- Store.query(db, "select m.channel, t.owner_actor from tasks t join messages m on m.id = t.root_id where t.root_id = ?", [id]) do
            now = Store.now_iso()

            Store.query(
              db,
              """
              update tasks
              set state = 'blocked', block_kind = ?, claim_token_hash = null,
                  claimed_by_actor = null, claimed_by_profile = null, lease_until = null, updated_at = ?
              where root_id = ?
              """,
              [kind, now, id]
            )

            reply_msg = append_system_reply(db, id, channel, actor, profile, question)
            {:ok, %{id: id, channel: channel, owner: owner, question: question, kind: kind, reply: reply_msg}}
          else
            [] -> {:error, "Task #{id} not found."}
            {:error, why} -> {:error, why}
          end
        end)

      case result do
        {:ok, blocked} ->
          posted(call, blocked.reply)
          Events.emit(call, "task_blocked", %{id: blocked.id, channel: blocked.channel, question: blocked.question, kind: blocked.kind, owner: blocked.owner, author: actor, profile: profile})
          notify_blocked(call, blocked, profile)
          %{id: blocked.id, state: "blocked", kind: blocked.kind}

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_unblock", %{"id" => id}, call) do
    actor = call.actor || call.subject

    result =
      Store.transaction(call, fn db ->
        case Store.query(db, "select m.channel, m.body, t.state, t.owner_actor, t.assigned_profile from tasks t join messages m on m.id = t.root_id where t.root_id = ?", [id]) do
          [%{"channel" => channel, "body" => body, "state" => "blocked", "owner_actor" => owner, "assigned_profile" => assigned}] ->
            case Store.state_for(db, Store.deps_for(db, id)) do
              "blocked" ->
                {:error, "It needs a task that failed or was canceled: reopen that one first."}

              next_state ->
                Store.query(db, "update tasks set state = ?, block_kind = null, updated_at = ? where root_id = ?", [next_state, Store.now_iso(), id])
                reply_msg = append_system_reply(db, id, channel, actor, nil, "Unblocked.")
                {:ok, %{id: id, state: next_state, channel: channel, body: body, owner: owner, assigned_profile: assigned, reply: reply_msg}}
            end

          [%{"state" => state}] ->
            {:error, "Task #{id} is #{state}, not blocked."}

          [] ->
            {:error, "Task #{id} not found."}
        end
      end)

    case result do
      {:ok, res} ->
        posted(call, res.reply)

        if res.state == "ready" do
          Events.emit(call, "task_ready", %{id: res.id, channel: res.channel, body: res.body, owner: res.owner, assigned_profile: res.assigned_profile})
        end

        %{id: res.id, state: res.state}

      {:error, why} ->
        {:error, why}
    end
  end

  defp dispatch("task_cancel", %{"id" => id} = inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject
      reason = inputs["reason"] || "Canceled."

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select m.channel, m.body, m.profile, t.state, t.owner_actor from tasks t join messages m on m.id = t.root_id where t.root_id = ?", [id]) do
            [%{"owner_actor" => owner, "profile" => msg_profile}] when owner != actor or (profile not in [nil, ""] and profile != msg_profile) ->
              {:error, "Only the task's owner can cancel it."}

            [%{"state" => "completed"}] ->
              {:error, "Task #{id} is already completed."}

            [%{"channel" => channel, "body" => body}] ->
              Store.query(
                db,
                "update tasks set state = 'canceled', result = ?, claim_token_hash = null, lease_until = null, updated_at = ? where root_id = ?",
                [reason, Store.now_iso(), id]
              )

              reply_msg = append_system_reply(db, id, channel, actor, profile, "Canceled: #{reason}")
              {:ok, %{id: id, channel: channel, state: "canceled", reply: reply_msg, blocked: block_waiting(db, id, body, actor, profile, "was canceled")}}

            [] ->
              {:error, "Task #{id} not found."}
          end
        end)

      case result do
        {:ok, res} ->
          posted(call, res.reply)
          announce_blocked(call, actor, profile, res.channel, id, res.blocked, "canceled a task")
          %{id: id, state: "canceled", blocked: Enum.map(res.blocked, & &1.id)}

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_reopen", %{"id" => id}, call) do
    actor = call.actor || call.subject

    result =
      Store.transaction(call, fn db ->
        case Store.query(db, "select m.channel, m.body, t.state, t.owner_actor, t.assigned_profile from tasks t join messages m on m.id = t.root_id where t.root_id = ?", [id]) do
          [%{"channel" => channel, "body" => body, "state" => state, "owner_actor" => owner, "assigned_profile" => assigned}] when state in ["failed", "canceled"] ->
            next_state = Store.state_for(db, Store.deps_for(db, id))
            kind = if next_state == "blocked", do: "needs_failed_task"
            Store.query(db, "update tasks set state = ?, result = null, block_kind = ?, updated_at = ? where root_id = ?", [next_state, kind, Store.now_iso(), id])
            reply_msg = append_system_reply(db, id, channel, actor, nil, "Reopened.")

            # What was blocked on it waits again.
            waiting = for w <- Store.unblock_dependents(db, id), do: append_system_reply(db, w.id, w.channel, actor, nil, "Waiting again: a task it needs was reopened.")

            {:ok, %{id: id, state: next_state, channel: channel, body: body, owner: owner, assigned_profile: assigned, reply: reply_msg, waiting: waiting}}

          [%{"state" => state}] ->
            {:error, "Only failed or canceled tasks can be reopened (currently #{state})."}

          [] ->
            {:error, "Task #{id} not found."}
        end
      end)

    case result do
      {:ok, res} ->
        posted(call, res.reply)
        for reply <- res.waiting, do: posted(call, reply)

        if res.state == "ready" do
          Events.emit(call, "task_ready", %{id: res.id, channel: res.channel, body: res.body, owner: res.owner, assigned_profile: res.assigned_profile})
        end

        %{id: res.id, state: res.state}

      {:error, why} ->
        {:error, why}
    end
  end

  defp dispatch("schedule_create", inputs, call) do
    with target when is_binary(target) and target != "" <- inputs["target"] || {:error, "target is required."},
         {:ok, body} <- Store.validate_body(inputs["body"]),
         {:ok, profile} <- Store.validate_profile(inputs["profile"]),
         {:ok, next_run_at} <- compute_next_run(inputs["in_seconds"], inputs["at"]),
         {:ok, every_ms} <- validate_every(inputs["every_seconds"]),
         {:ok, until_at} <- parse_optional_time(inputs["until"]) do
      author = call.actor || call.subject
      no_sync = if inputs["no_sync"] == true, do: 1, else: 0
      times = inputs["times"]

      result =
        Store.transaction(call, fn db ->
          with :ok <- known_target(db, target),
               {:ok, _blocks} <- Store.parse_and_validate_blocks(db, body) do
            id = Store.new_id("sch")
            now = Store.now_iso()

            Store.query(
              db,
              """
              insert into schedules (id, target, body, author, profile, no_sync, next_run_at, every_ms, until_at, remaining, sent_count, created_at)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
              """,
              [id, target, body, author, profile, no_sync, next_run_at, every_ms, until_at, times, now]
            )

            {:ok, %{id: id, target: target, next_run_at: DateTime.from_unix!(next_run_at, :millisecond) |> DateTime.to_iso8601()}}
          end
        end)

      case result do
        {:ok, res} ->
          timed(call)
          res

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("schedules_list", _inputs, call) do
    schedules =
      Store.transaction(call, fn db ->
        for %{
              "id" => id,
              "target" => target,
              "body" => body,
              "author" => author,
              "profile" => profile,
              "no_sync" => no_sync,
              "next_run_at" => next_run,
              "every_ms" => every_ms,
              "until_at" => until_at,
              "remaining" => rem,
              "sent_count" => sent,
              "failed" => failed
            } <-
              Store.query(db, "select id, target, body, author, profile, no_sync, next_run_at, every_ms, until_at, remaining, sent_count, failed from schedules order by next_run_at asc") do
          %{
            id: id,
            target: target,
            body: body,
            author: Store.display_author(author, profile),
            no_sync: no_sync == 1,
            next_run_at: DateTime.from_unix!(next_run, :millisecond) |> DateTime.to_iso8601(),
            every_seconds: if(every_ms, do: div(every_ms, 1000)),
            until: if(until_at, do: DateTime.from_unix!(until_at, :millisecond) |> DateTime.to_iso8601()),
            remaining: rem,
            sent_count: sent,
            failed: failed
          }
        end
      end)

    %{schedules: schedules}
  end

  defp dispatch("schedule_cancel", %{"id" => id} = inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select author, profile from schedules where id = ?", [id]) do
            [%{"author" => author, "profile" => scheduled_profile}] ->
              with :ok <- author_only(actor, profile, author, scheduled_profile, "cancel") do
                Store.query(db, "delete from schedules where id = ?", [id])
                {:ok, %{id: id, canceled: true}}
              end

            [] ->
              {:error, "Schedule #{id} not found."}
          end
        end)

      case result do
        {:ok, canceled} ->
          canceled

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("tick_schedules", _inputs, call) do
    now = Store.now_ms()

    {expired, fired} =
      Store.transaction(call, fn db ->
        expired = Store.expire_leases(db)

        due =
          Store.query(
            db,
            "select id, target, body, author, profile, no_sync, every_ms, until_at, remaining, sent_count from schedules where next_run_at <= ? and failed is null order by next_run_at asc",
            [now]
          )

        fired =
          for %{
                "id" => sid,
                "target" => target,
                "body" => body,
                "author" => author,
                "profile" => profile,
                "no_sync" => no_sync,
                "every_ms" => every_ms,
                "until_at" => until_at,
                "remaining" => rem,
                "sent_count" => sent_count
              } <- due do
            case fire_scheduled_message(db, target, body, author, profile, no_sync) do
              {:ok, msg} ->
                next_rem = if is_integer(rem), do: rem - 1, else: nil
                next_at = if every_ms, do: now + every_ms, else: nil

                keep =
                  next_at != nil and (next_rem == nil or next_rem > 0) and (until_at == nil or next_at <= until_at)

                if keep do
                  Store.query(db, "update schedules set next_run_at = ?, remaining = ?, sent_count = ? where id = ?", [next_at, next_rem, sent_count + 1, sid])
                else
                  Store.query(db, "delete from schedules where id = ?", [sid])
                end

                {:sent, msg}

              # It stays, with its reason, for whoever scheduled it to read in `schedules_list`, and is fired no more.
              {:error, why} ->
                Store.query(db, "update schedules set failed = ? where id = ?", [why, sid])
                {:failed, sid, why}
            end
          end

        {expired, fired}
      end)

    sent = for {:sent, msg} <- fired, do: msg
    failed = for {:failed, sid, why} <- fired, do: {sid, why}

    # The database's timer calls this, and nobody is told that a timer's call ran: it says so itself, as `changes: []` leaves it to.
    if expired != [] or fired != [] do
      Call.changed(call)
    end

    for {sid, why} <- failed, do: Logger.error("Board's scheduled message #{sid} couldn't be posted, and is marked failed: #{why}")

    for r <- expired do
      Events.emit(call, "task_ready", r)
    end

    for msg <- sent do
      posted(call, msg)
    end

    timed(call)
    %{expired_leases: length(expired), sent_schedules: length(sent), failed_schedules: length(failed)}
  end

  defp dispatch("badge", _inputs, call) do
    count =
      Store.transaction(call, fn db ->
        [%{"n" => n}] = Store.query(db, "select count(*) as n from tasks t join messages m on m.id = t.root_id where t.state in ('blocked', 'failed') and m.deleted_at is null")
        n
      end)

    %{count: count}
  end

  defp dispatch("widget", _inputs, call) do
    {waiting, count, ready, claimed} =
      Store.transaction(call, fn db ->
        waiting =
          Store.query(
            db,
            """
            select m.id, m.channel, m.body, t.state, t.block_kind
            from tasks t join messages m on m.id = t.root_id
            where t.state in ('blocked', 'failed') and m.deleted_at is null
            order by t.updated_at desc limit 3
            """
          )

        [%{"n" => count}] = Store.query(db, "select count(*) as n from tasks t join messages m on m.id = t.root_id where t.state in ('blocked', 'failed') and m.deleted_at is null")
        [%{"n" => ready}] = Store.query(db, "select count(*) as n from tasks t where #{Store.state_sql()} = 'ready'")
        [%{"n" => claimed}] = Store.query(db, "select count(*) as n from tasks t where #{Store.state_sql()} = 'claimed'")
        {waiting, count, ready, claimed}
      end)

    rows =
      if waiting == [] do
        [%{part: "text", text: "Nothing waiting on you · #{ready} ready, #{claimed} active", size: "sm", tone: "muted"}]
      else
        for %{"channel" => ch, "body" => body, "state" => state, "block_kind" => kind} <- waiting do
          %{part: "item", title: title_of(body), subtitle: "#{ch} · #{words(kind || state)}"}
        end
      end

    %{
      part: "column",
      title: false,
      gap: 4,
      parts: [
        %{
          part: "row",
          parts: [
            %{part: "text", text: "Board", weight: "bold", grow: true},
            %{part: "text", text: "#{count} waiting on you", size: "sm", tone: if(count == 0, do: "muted", else: "warn")}
          ]
        }
        | rows
      ]
    }
  end

  # --- Private Helpers ---

  defp finish_task_create(call, {:ok, task}) do
    if task.state == "ready" do
      Events.emit(call, "task_ready", %{id: task.id, channel: task.channel, body: task.body, owner: task.owner, assigned_profile: task.assigned_profile})
    end

    task
  end

  defp finish_task_create(_call, {:error, why}), do: {:error, why}

  defp create_plan(db, channel, owner, profile, plan) do
    # Two passes: insert messages + validate keys, then wire tasks & dependencies atomically.
    with {:ok, key_map, items} <- insert_plan_messages(db, channel, owner, profile, plan) do
      Enum.reduce_while(items, {:ok, []}, fn {id, item}, {:ok, acc} ->
        needs =
          Enum.map(item["needs"] || [], fn dep ->
            cond do
              is_map(dep) and is_binary(dep["key"]) -> Map.get(key_map, dep["key"], dep["key"])
              is_map(dep) and is_binary(dep["id"]) -> dep["id"]
              is_binary(dep) -> Map.get(key_map, dep, dep)
              true -> ""
            end
          end)

        with {:ok, assigned} <- Store.validate_profile(item["assigned_profile"]),
             {:ok, task} <- insert_task(db, id, channel, item["body"], owner, profile, assigned, needs) do
          {:cont, {:ok, acc ++ [task]}}
        else
          {:error, why} -> {:halt, {:error, why}}
        end
      end)
    end
  end

  defp insert_plan_messages(db, channel, owner, profile, plan) do
    Enum.reduce_while(plan, {:ok, %{}, []}, fn item, {:ok, keys, items} ->
      with {:ok, body} <- Store.validate_body(item["body"]),
           :ok <- validate_labels_map(item["labels"]),
           {:ok, blocks} <- Store.parse_and_validate_blocks(db, body) do
        id = Store.new_id("msg")
        now = Store.now_iso()

        Store.query(
          db,
          """
          insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
          values (?, ?, null, null, ?, ?, ?, ?, 1, 0, ?)
          """,
          [id, channel, owner, profile, body, JSON.encode!(blocks), now]
        )

        for {k, v} <- item["labels"] || %{} do
          Store.query(db, "insert or replace into labels (message_id, key, value) values (?, ?, ?)", [id, k, v])
        end

        keys = if is_binary(item["key"]), do: Map.put(keys, item["key"], id), else: keys
        {:cont, {:ok, keys, items ++ [{id, item}]}}
      else
        {:error, why} -> {:halt, {:error, why}}
      end
    end)
  end

  defp insert_task(db, root_id, channel, body, owner, profile, assigned, needs) do
    with :ok <- validate_needs(db, needs) do
      now = Store.now_iso()
      state = Store.state_for(db, needs)
      kind = if state == "blocked", do: "needs_failed_task"

      Store.query(
        db,
        """
        insert into tasks (root_id, state, owner_actor, owner_profile, assigned_profile, claim_epoch, block_kind, updated_at)
        values (?, ?, ?, ?, ?, 0, ?, ?)
        """,
        [root_id, state, owner, profile, assigned, kind, now]
      )

      for dep <- Enum.uniq(needs) do
        Store.query(db, "insert or ignore into task_deps (task_id, needs_id) values (?, ?)", [root_id, dep])
      end

      {:ok, %{id: root_id, channel: channel, body: body, state: state, owner: owner, assigned_profile: assigned, needs: Enum.uniq(needs)}}
    end
  end

  defp validate_needs(db, needs) do
    Enum.reduce_while(needs, :ok, fn dep, :ok ->
      cond do
        not is_binary(dep) or dep == "" ->
          {:halt, {:error, "invalid_needs: dependency ID must be a non-empty string."}}

        Store.query(db, "select 1 from tasks where root_id = ?", [dep]) == [] ->
          {:halt, {:error, "invalid_needs: dependency #{dep} is not a task."}}

        true ->
          {:cont, :ok}
      end
    end)
  end

  defp claim_by_id(db, id, target_owner, actor, profile, lease_until) do
    case Store.query(db, "select state, owner_actor, assigned_profile, claim_epoch, lease_until from tasks where root_id = ?", [id]) do
      [%{"owner_actor" => owner}] when owner != target_owner ->
        {:error, "Task #{id} is #{Store.display_author(owner, nil)}'s: claim it with from: #{owner}."}

      [%{"state" => state, "assigned_profile" => assigned, "claim_epoch" => epoch, "lease_until" => lease}] ->
        case Store.effective_state(state, lease) do
          "ready" when assigned != nil and assigned != profile -> {:error, "Task #{id} is assigned to profile #{assigned}."}
          "ready" -> do_claim(db, id, epoch, actor, profile, lease_until)
          "claimed" -> {:error, "task_claimed: task #{id} is already claimed."}
          state -> {:error, "Task #{id} is #{state}, not ready."}
        end

      [] ->
        {:error, "Task #{id} not found."}
    end
  end

  defp claim_oldest_ready(db, channel, label, target_owner, actor, profile, lease_until) do
    {extra_sql, extra_params} = extra_filters(channel, label)

    candidates =
      Store.query(
        db,
        """
        select t.root_id, t.claim_epoch
        from tasks t
        join messages m on m.id = t.root_id
        where #{Store.state_sql()} = 'ready' and t.owner_actor = ? and m.deleted_at is null
          and (t.assigned_profile is null or t.assigned_profile = ?)
          #{extra_sql}
        order by case when t.assigned_profile = ? then 0 else 1 end, m.created_at asc
        limit 1
        """,
        [target_owner, profile || ""] ++ extra_params ++ [profile || ""]
      )

    case candidates do
      [%{"root_id" => id, "claim_epoch" => epoch}] -> do_claim(db, id, epoch, actor, profile, lease_until)
      [] -> {:error, "nothing_ready: no ready task matching your criteria."}
    end
  end

  defp do_claim(db, id, epoch, actor, profile, lease_until) do
    new_epoch = epoch + 1
    token = Store.new_token()
    token_hash = Store.hash_token(token)
    now = Store.now_iso()

    Store.query(
      db,
      """
      update tasks
      set state = 'claimed', claim_epoch = ?, claim_token_hash = ?,
          claimed_by_actor = ?, claimed_by_profile = ?, lease_until = ?, updated_at = ?
      where root_id = ?
      """,
      [new_epoch, token_hash, actor, profile, lease_until, now, id]
    )

    [%{"channel" => ch, "body" => body}] = Store.query(db, "select channel, body from messages where id = ?", [id])
    {:ok, %{id: id, channel: ch, body: body, state: "claimed", epoch: new_epoch, token: token, lease_until: lease_until}}
  end

  defp verify_claim(db, id, epoch, token) when is_integer(epoch) and is_binary(token) do
    case Store.query(db, "select state, claim_epoch, claim_token_hash, lease_until from tasks where root_id = ?", [id]) do
      [%{"state" => "claimed", "claim_epoch" => ^epoch, "claim_token_hash" => stored_hash, "lease_until" => lease}] ->
        cond do
          Store.effective_state("claimed", lease) != "claimed" -> {:error, "claim_lost: the lease has run out."}
          stored_hash == Store.hash_token(token) -> :ok
          true -> {:error, "claim_lost: invalid claim token."}
        end

      [%{"state" => "claimed", "claim_epoch" => cur}] ->
        {:error, "claim_lost: task is at epoch #{cur}, not #{epoch}."}

      [%{"state" => state}] ->
        {:error, "claim_lost: task is #{state}, not claimed."}

      [] ->
        {:error, "Task #{id} not found."}
    end
  end

  defp verify_claim(_db, _id, _epoch, _token), do: {:error, "claim_not_held: epoch and token are required."}

  # The claim holder, by epoch and token, or the task's owner while no one holds it: ready or blocked, never one that's
  # finished. A person, who passes no `profile`, as an agent does, settles one that an agent holds too: the agent's
  # epoch and token then fail, as they do for any task that's no longer claimed.
  defp verify_claim_or_owner(db, id, epoch, token, _actor, _profile) when is_integer(epoch) and is_binary(token) do
    verify_claim(db, id, epoch, token)
  end

  defp verify_claim_or_owner(db, id, _epoch, _token, actor, profile) do
    case Store.query(db, "select state, owner_actor, lease_until from tasks where root_id = ?", [id]) do
      [%{"state" => state, "owner_actor" => ^actor, "lease_until" => lease}] ->
        case Store.effective_state(state, lease) do
          held when held in ["ready", "blocked"] -> :ok
          "claimed" when profile == nil -> :ok
          "claimed" -> {:error, "claim_not_held: task is currently claimed; pass epoch and token."}
          other -> {:error, "Task #{id} is #{other}, not ready or blocked."}
        end

      [_] ->
        {:error, "Only the claim holder or task owner can update this task."}

      [] ->
        {:error, "Task #{id} not found."}
    end
  end

  defp append_system_reply(db, root_id, channel, actor, profile, body) do
    id = Store.new_id("msg")
    now = Store.now_iso()

    Store.query(
      db,
      """
      insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
      values (?, ?, ?, null, ?, ?, ?, '[]', 1, 0, ?)
      """,
      [id, channel, root_id, actor, profile, body, now]
    )

    %{
      id: id,
      channel: channel,
      root_id: root_id,
      author: actor,
      profile: profile,
      display_author: Store.display_author(actor, profile),
      body: body,
      no_sync: false
    }
  end

  # A schedule's target was checked when it was made, but a thread can be deleted since, so it's looked at again.
  defp fire_scheduled_message(db, target, body, author, profile, no_sync) do
    with {:ok, blocks} <- Store.parse_and_validate_blocks(db, body),
         {:ok, channel, root_id} <- scheduled_in(db, target) do
      id = Store.new_id("msg")

      Store.query(
        db,
        """
        insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
        values (?, ?, ?, null, ?, ?, ?, ?, 1, ?, ?)
        """,
        [id, channel, root_id, author, profile, body, JSON.encode!(blocks), no_sync, Store.now_iso()]
      )

      {:ok, %{id: id, channel: channel, root_id: root_id, author: author, profile: profile, display_author: Store.display_author(author, profile), body: body, no_sync: no_sync == 1}}
    end
  end

  defp scheduled_in(db, target) do
    case Store.query(db, "select channel, deleted_at from messages where id = ? and root_id is null", [target]) do
      [%{"channel" => channel, "deleted_at" => nil}] -> {:ok, channel, target}
      [_deleted] -> {:error, "The thread #{target} was deleted."}
      [] -> with {:ok, channel} <- Store.validate_channel(target), do: {:ok, channel, nil}
    end
  end

  # Has the database's timer go off when the next lease lapses or schedule is due (`Database.timer/5`), and not before,
  # so a Board with neither is called by nothing. `tick_schedules` sets it again for the next.
  defp timed(call) do
    due =
      Store.transaction(call, fn db ->
        [%{"at" => at}] =
          Store.query(
            db,
            """
            select min(at) as at from (
              select min(lease_until) as at from tasks where state = 'claimed' and lease_until is not null
              union all
              select min(next_run_at) from schedules where failed is null
            )
            """
          )

        at && div(at + 999, 1000)
      end)

    Call.app(call, "database").timer(call, "tick_schedules", %{}, due)
  end

  defp known_target(db, target) do
    with [] <- Store.query(db, "select 1 from messages where id = ? and root_id is null", [target]),
         {:error, why} <- Store.validate_channel(target) do
      {:error, "A schedule's target is a thread's id or a channel. #{why}"}
    else
      _ -> :ok
    end
  end

  defp read_filters(channel, state, label, before) do
    {clauses, params} = {["m.root_id is null", "m.deleted_at is null"], []}

    {clauses, params} =
      if is_binary(before) and before != "" do
        {clauses ++ ["(m.created_at, m.id) < (select created_at, id from messages where id = ?)"], params ++ [before]}
      else
        {clauses, params}
      end

    {clauses, params} =
      if is_binary(state) and state != "" do
        {clauses ++ ["exists (select 1 from tasks t where t.root_id = m.id and #{Store.state_sql()} = ?)"], params ++ [state]}
      else
        {clauses, params}
      end

    {extra_sql, extra_params} = extra_filters(channel, label)
    {"where " <> Enum.join(clauses, " and ") <> " " <> extra_sql, params ++ extra_params}
  end

  defp extra_filters(channel, label) do
    {clauses, params} = {[], []}

    {clauses, params} =
      cond do
        not is_binary(channel) or channel == "" ->
          {clauses, params}

        String.ends_with?(channel, "/") ->
          base = String.trim_trailing(channel, "/")
          escaped = String.replace(channel, ["\\", "%", "_"], &"\\#{&1}") <> "%"
          {clauses ++ ["(m.channel = ? or m.channel like ? escape '\\')"], params ++ [base, escaped]}

        true ->
          {clauses ++ ["m.channel = ?"], params ++ [channel]}
      end

    {clauses, params} =
      case is_binary(label) and String.split(label, "=", parts: 2) do
        [k, v] ->
          sql =
            "exists (select 1 from labels l left join messages r on r.id = l.message_id where l.key = ? and l.value = ? and (l.message_id = m.id or r.root_id = m.id))"

          {clauses ++ [sql], params ++ [k, v]}

        _ ->
          {clauses, params}
      end

    sql = if clauses == [], do: "", else: "and " <> Enum.join(clauses, " and ")
    {sql, params}
  end

  defp check_after(_db, _root_id, nil), do: :ok

  defp check_after(db, root_id, expected) do
    latest =
      case Store.query(db, "select id from messages where root_id = ? order by created_at desc limit 1", [root_id]) do
        [%{"id" => id}] -> id
        [] -> root_id
      end

    if latest == expected, do: :ok, else: {:error, "newer_message: thread has moved past #{expected} (latest is #{latest})."}
  end

  defp can_edit?(actor, profile, msg_author, msg_profile) do
    actor == msg_author and (profile == nil or profile == "" or profile == msg_profile)
  end

  # What's part of a message, or a schedule, is its author's to change, as the message is (`can_edit?/4`).
  defp author_only(actor, profile, author, author_profile, what) do
    if can_edit?(actor, profile, author, author_profile), do: :ok, else: {:error, "Only the author can #{what} this."}
  end

  defp validate_labels_map(nil), do: :ok

  defp validate_labels_map(%{} = map) do
    Enum.reduce_while(map, :ok, fn {k, v}, :ok ->
      with :ok <- Store.validate_label_key(k),
           :ok <- Store.validate_label_value(v) do
        {:cont, :ok}
      else
        {:error, why} -> {:halt, {:error, why}}
      end
    end)
  end

  defp validate_labels_map(_), do: {:error, "labels must be an object of string keys and values."}

  defp validate_unset_list(nil), do: :ok

  defp validate_unset_list(list) when is_list(list) do
    Enum.reduce_while(list, :ok, fn k, :ok ->
      case Store.validate_label_key(k) do
        :ok -> {:cont, :ok}
        {:error, why} -> {:halt, {:error, why}}
      end
    end)
  end

  defp validate_unset_list(_), do: {:error, "unset must be a list of label keys."}

  defp check_if_labels(_current, nil), do: :ok

  defp check_if_labels(current, %{} = expected) do
    if Enum.all?(expected, fn {k, v} -> Map.get(current, k) == v end),
      do: :ok,
      else: {:error, "label_conflict: expected labels did not match."}
  end

  defp check_if_unset(_current, nil), do: :ok

  defp check_if_unset(current, keys) when is_list(keys) do
    if Enum.all?(keys, &(not Map.has_key?(current, &1))),
      do: :ok,
      else: {:error, "label_conflict: expected unset labels were present."}
  end

  defp compute_next_run(in_s, nil) when is_integer(in_s) and in_s > 0 and in_s <= 31_536_000 do
    {:ok, Store.now_ms() + in_s * 1_000}
  end

  defp compute_next_run(nil, at) when is_binary(at) do
    case DateTime.from_iso8601(at) do
      {:ok, dt, _} -> {:ok, DateTime.to_unix(dt, :millisecond)}
      _ -> {:error, "at must be a valid ISO 8601 timestamp."}
    end
  end

  defp compute_next_run(_, _), do: {:error, "Provide either in_seconds (1..31536000) or at (ISO 8601), not both."}

  defp validate_every(nil), do: {:ok, nil}
  defp validate_every(s) when is_integer(s) and s >= 60 and s <= 31_536_000, do: {:ok, s * 1_000}
  defp validate_every(_), do: {:error, "every_seconds must be between 60 and 31536000."}

  defp parse_optional_time(nil), do: {:ok, nil}

  defp parse_optional_time(at) when is_binary(at) do
    case DateTime.from_iso8601(at) do
      {:ok, dt, _} -> {:ok, DateTime.to_unix(dt, :millisecond)}
      _ -> {:error, "until must be a valid ISO 8601 timestamp."}
    end
  end

  defp validate_optional_upload(_call, nil, _name, _mime), do: {:ok, nil}
  defp validate_optional_upload(_call, "", _name, _mime), do: {:ok, nil}

  defp validate_optional_upload(call, blob, name, mime) when is_binary(blob) do
    case Artifact.size(call.own, blob) do
      {:ok, sz} when sz <= @max_attachment_bytes ->
        filename = if is_binary(name) and name != "", do: Path.basename(name), else: Path.basename(blob)
        {:ok, %{blob: blob, name: filename, mime_type: safe_mime_type(mime), size: sz}}

      {:ok, _sz} ->
        {:error, "Attachment exceeds 100 MB limit."}

      _ ->
        {:error, "Uploaded file #{blob} was not found in the bucket."}
    end
  end

  # What a file is served as: a picture or a PDF as itself, and anything else, an HTML page or an SVG that runs script
  # included, as plain bytes.
  @safe_mime_types ~w(image/png image/jpeg image/gif image/webp image/avif application/pdf)

  defp safe_mime_type(mime) when is_binary(mime) do
    kind = mime |> String.split(";") |> hd() |> String.trim() |> String.downcase()
    if kind in @safe_mime_types, do: kind, else: "application/octet-stream"
  end

  defp safe_mime_type(_mime), do: "application/octet-stream"

  defp insert_attachment(db, msg_id, %{blob: blob, name: name, mime_type: mime, size: sz}, now) do
    att_id = Store.new_id("att")

    Store.query(
      db,
      """
      insert into attachments (id, message_id, blob, name, mime_type, size, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      """,
      [att_id, msg_id, blob, name, mime, sz, now]
    )

    %{id: att_id, message_id: msg_id, name: name, mime_type: mime, size: sz, created_at: now}
  end

  # A message that's now on the board: the event says it happened, and each app observing the board hears it. Both
  # are told whether it's `no_sync`, so a bridge that posted it on the board's behalf doesn't hear its own post.
  defp posted(call, msg) do
    data = %{
      "id" => msg.id,
      "channel" => msg.channel,
      "root_id" => msg.root_id,
      "author" => msg.author,
      "profile" => msg.profile,
      "display_author" => msg.display_author,
      "body" => msg.body,
      "no_sync" => msg.no_sync
    }

    Events.emit(call, "message_posted", data)
  end

  defp notify_blocked(call, blocked, profile) do
    who = Store.display_author(call.actor || call.subject, profile)
    notify(call, "#{who} blocked a task in #{blocked.channel}", blocked.question, blocked.id)
  end

  # Tells whoever the board is for, and a tap opens the thread.
  defp notify(call, title, text, thread_id) do
    Call.app(call, "notifications").send(call, %{
      "title" => title,
      "text" => String.slice(text, 0, 140),
      "page" => "client/index.html#thread&id=#{thread_id}"
    })
  end

  # A task that failed, was canceled or deleted: each task waiting on it is blocked, with a note in its thread saying why,
  # as one that needs a person is (`Store.block_dependents/2`). `what` says it as a title does, "failed a task".
  defp block_waiting(db, id, body, actor, profile, what) do
    for dependent <- Store.block_dependents(db, id) do
      note = "Blocked: \"#{title_of(body)}\" #{what}, and this needs it."
      Map.put(dependent, :reply, append_system_reply(db, dependent.id, dependent.channel, actor, profile, note))
    end
  end

  # Tells observers of the board about those notes, and the person: a failed task is theirs to clear, and so is whatever
  # now waits on one that's gone. `opens` is the thread a tap opens (the first blocked, where the task itself is deleted).
  defp announce_blocked(call, actor, profile, channel, opens, blocked, what, reason \\ nil) do
    for dependent <- blocked, do: posted(call, dependent.reply)

    if reason != nil or blocked != [] do
      count = length(blocked)
      waiting = if count > 0, do: "#{count} #{if count == 1, do: "task", else: "tasks"} waiting on it #{if count == 1, do: "is", else: "are"} blocked."
      who = Store.display_author(actor, profile)
      notify(call, "#{who} #{what} in #{channel}", Enum.join(Enum.reject([reason, waiting], &is_nil/1), " · "), opens)
    end
  end

  defp title_of(body), do: body |> String.split("\n") |> hd() |> String.slice(0, 48)

  # A message deleted: its text, labels, reactions and attachments go, and a tombstone stays. Gives the attachments' blobs.
  defp tombstone(db, id, revision, now) do
    Store.query(db, "update messages set body = '', blocks = '[]', revision = ?, deleted_at = ? where id = ?", [revision, now, id])
    Store.query(db, "delete from labels where message_id = ?", [id])
    Store.query(db, "delete from reactions where message_id = ?", [id])
    for %{"blob" => blob} <- Store.query(db, "delete from attachments where message_id = ? returning blob", [id]), do: blob
  end

  # What a task's state or block kind says, as a person reads it: `awaiting_approval` is "Awaiting approval".
  defp words(kind), do: kind |> String.replace("_", " ") |> String.capitalize()
end
