defmodule Board do
  @moduledoc """
  Shared message board and task queue for people and coding agents: hierarchical channels, one-level threads,
  compare-and-swap labels, normalized reactions, lease-fenced tasks with dependency DAGs, versioned JSON Schema
  blocks, self-scheduled follow-ups, and MCP Events (`OneCore.Events`).
  """
  @behaviour OneCore.App
  require Logger

  alias Board.Store
  alias OneCore.{Artifact, Call, Events}

  @default_lease 900
  @min_lease 30
  @max_lease 3600
  @max_attachments 10
  @max_attachment_bytes 100 * 1024 * 1024

  @impl true
  def icon, do: "client/icon.svg"

  @impl true
  def own, do: :installed

  @impl true
  def requires do
    %{
      "core" => ">= 0.35.7",
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
  def jobs, do: [%{tool: "tick_schedules", every: 60}]

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
            body: %{type: "string"}
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
        description:
          "Read thread summaries in a channel/subtree (channel, state, label, limit) or a single thread in full (id).",
        inputs: %{
          type: "object",
          properties: %{
            id: %{type: "string", description: "Thread root ID to read in full with replies"},
            channel: %{type: "string", description: "Channel path or trailing-/ subtree (e.g. dev or work/)"},
            state: %{type: "string", description: "Filter tasks by state (waiting, ready, claimed, blocked, completed, failed, canceled)"},
            label: %{type: "string", description: "Filter by key=value label on root or reply"},
            limit: %{type: "integer", description: "Max threads to return (default 50, max 200)"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "post",
        description: "Start a new thread in a channel. Always pass profile (your agent name) when acting as an agent.",
        inputs: %{
          type: "object",
          required: ["channel", "body"],
          properties: %{
            channel: %{type: "string"},
            body: %{type: "string"},
            profile: %{type: "string"},
            labels: %{type: "object"},
            file: %{type: "string", format: "upload", description: "Optional uploaded file attachment"},
            file_name: %{type: "string", description: "Filename for the attachment"},
            mime_type: %{type: "string", description: "MIME type for the attachment"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "reply",
        description: "Reply in an existing thread. Pass after=<msg_id> to ensure no newer message landed first.",
        inputs: %{
          type: "object",
          required: ["id", "body"],
          properties: %{
            id: %{type: "string", description: "Thread root ID"},
            body: %{type: "string"},
            profile: %{type: "string"},
            reply_to: %{type: "string", description: "Specific message ID replied to within the thread"},
            after: %{type: "string", description: "Compare-and-swap: fail if another reply landed after this message ID"},
            file: %{type: "string", format: "upload", description: "Optional uploaded file attachment"},
            file_name: %{type: "string", description: "Filename for the attachment"},
            mime_type: %{type: "string", description: "MIME type for the attachment"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "edit",
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
        description: "Add or remove a normalized emoji reaction on a message.",
        inputs: %{
          type: "object",
          required: ["id", "emoji"],
          properties: %{
            id: %{type: "string"},
            emoji: %{type: "string"},
            profile: %{type: "string"},
            remove: %{type: "boolean"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "label",
        description: "Set or unset labels on a message with optional atomic compare-and-swap (if, if_unset).",
        inputs: %{
          type: "object",
          required: ["id"],
          properties: %{
            id: %{type: "string"},
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
        description: "Attach an uploaded file (up to 10 per message, 100 MB each) to an existing message.",
        inputs: %{
          type: "object",
          required: ["id", "file"],
          properties: %{
            id: %{type: "string", description: "Message ID to attach the file to"},
            file: %{type: "string", format: "upload", description: "Uploaded file blob"},
            name: %{type: "string", description: "Filename shown to readers"},
            mime_type: %{type: "string", description: "MIME type (default application/octet-stream)"}
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
            plan: %{type: "array", items: %{type: "object"}, description: "Atomic list of up to 100 tasks with optional key and needs"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "task_claim",
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
        description: "Unblock a held task back to ready (or waiting if prerequisites remain).",
        inputs: %{type: "object", required: ["id"], properties: %{id: %{type: "string"}, profile: %{type: "string"}}},
        outputs: %{type: "object"}
      },
      %{
        name: "task_cancel",
        description: "Cancel a task.",
        inputs: %{type: "object", required: ["id"], properties: %{id: %{type: "string"}, reason: %{type: "string"}, profile: %{type: "string"}}},
        outputs: %{type: "object"}
      },
      %{
        name: "task_reopen",
        description: "Reopen a failed or canceled task back to ready (or waiting).",
        inputs: %{type: "object", required: ["id"], properties: %{id: %{type: "string"}, profile: %{type: "string"}}},
        outputs: %{type: "object"}
      },
      %{
        name: "schedule_create",
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
            profile: %{type: "string"}
          }
        },
        outputs: %{type: "object"}
      },
      %{
        name: "schedules_list",
        read_only: true,
        description: "List active scheduled messages.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object", properties: %{schedules: %{type: "array", items: %{type: "object"}}}}
      },
      %{
        name: "schedule_cancel",
        description: "Cancel a scheduled message.",
        inputs: %{type: "object", required: ["id"], properties: %{id: %{type: "string"}}},
        outputs: %{type: "object"}
      },
      %{
        name: "tick_schedules",
        description: "Internal periodic job that posts due scheduled messages and expires lapsed task leases.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object"}
      },
      %{
        name: "badge",
        read_only: true,
        description: "Count of blocked tasks waiting on a person.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object", properties: %{count: %{type: "integer"}}}
      },
      %{
        name: "widget",
        read_only: true,
        description: "Home Screen widget showing blocked tasks and active swarm counts.",
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
        Store.expire_leases(db)

        rows =
          Store.query(
            db,
            """
            select m.channel,
                   count(distinct m.id) as threads,
                   sum(case when t.state = 'ready' then 1 else 0 end) as ready_tasks,
                   sum(case when t.state = 'claimed' then 1 else 0 end) as claimed_tasks,
                   sum(case when t.state = 'blocked' then 1 else 0 end) as blocked_tasks,
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

  defp dispatch("read", %{"id" => id}, call) when is_binary(id) and id != "" do
    Store.transaction(call, fn db ->
      Store.expire_leases(db)

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
      Store.expire_leases(db)
      {where_sql, params} = read_filters(channel, state, label)

      roots =
        Store.query(
          db,
          """
          select m.id, m.channel, m.root_id, m.reply_to, m.author, m.profile, m.body, m.blocks,
                 m.revision, m.no_sync, m.created_at, m.edited_at, m.deleted_at
          from messages m
          #{where_sql}
          order by m.created_at desc
          limit ?
          """,
          params ++ [limit]
        )

      threads =
        Enum.map(roots, fn %{"id" => id} = row ->
          msg = Store.format_message(db, row)
          [%{"n" => reply_count}] = Store.query(db, "select count(*) as n from messages where root_id = ? and deleted_at is null", [id])
          msg |> Map.put(:reply_count, reply_count) |> Map.put(:task, Store.task_row(db, id))
        end)

      %{threads: threads}
    end)
  end

  defp dispatch("post", inputs, call) do
    with {:ok, channel} <- Store.validate_channel(inputs["channel"]),
         {:ok, body} <- Store.validate_body(inputs["body"]),
         {:ok, profile} <- Store.validate_profile(inputs["profile"]),
         :ok <- validate_labels_map(inputs["labels"]),
         {:ok, upload} <- validate_optional_upload(call, inputs["file"], inputs["file_name"], inputs["mime_type"]) do
      author = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          with {:ok, blocks} <- Store.parse_and_validate_blocks(db, body) do
            id = Store.new_id("msg")
            now = Store.now_iso()

            Store.query(
              db,
              """
              insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
              values (?, ?, null, null, ?, ?, ?, ?, 1, 0, ?)
              """,
              [id, channel, author, profile, body, JSON.encode!(blocks), now]
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
               created_at: now
             }}
          end
        end)

      case result do
        {:ok, msg} ->
          Call.changed(call)
          emit_safe(call, "message_posted", Map.take(msg, [:id, :channel, :root_id, :author, :profile, :display_author, :body]), event_id: msg.id)
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

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select channel from messages where id = ? and root_id is null", [root_id]) do
            [%{"channel" => channel}] ->
              with :ok <- check_after(db, root_id, inputs["after"]),
                   {:ok, blocks} <- Store.parse_and_validate_blocks(db, body) do
                id = Store.new_id("msg")
                now = Store.now_iso()

                Store.query(
                  db,
                  """
                  insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
                  values (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
                  """,
                  [id, channel, root_id, inputs["reply_to"], author, profile, body, JSON.encode!(blocks), now]
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
                   created_at: now
                 }}
              end

            [] ->
              {:error, "Thread #{root_id} not found."}
          end
        end)

      case result do
        {:ok, msg} ->
          Call.changed(call)
          emit_safe(call, "message_posted", Map.take(msg, [:id, :channel, :root_id, :author, :profile, :display_author, :body]), event_id: msg.id)
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

                    {:ok, %{id: id, channel: channel, body: body, blocks: blocks, revision: new_rev, edited_at: now}}
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
          Call.changed(call)
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
          case Store.query(db, "select root_id, author, profile, revision, deleted_at from messages where id = ?", [id]) do
            [%{"root_id" => root_id, "author" => msg_author, "profile" => msg_profile, "revision" => rev, "deleted_at" => nil}] ->
              cond do
                not can_edit?(actor, profile, msg_author, msg_profile) ->
                  {:error, "Only the author can delete this message."}

                inputs["if_revision"] != nil and inputs["if_revision"] != rev ->
                  {:error, "revision_conflict: message is at revision #{rev}, not #{inputs["if_revision"]}."}

                true ->
                  now = Store.now_iso()
                  new_rev = rev + 1
                  Store.query(db, "update messages set body = '', blocks = '[]', revision = ?, deleted_at = ? where id = ?", [new_rev, now, id])
                  Store.query(db, "delete from labels where message_id = ?", [id])
                  Store.query(db, "delete from reactions where message_id = ?", [id])

                  if root_id == nil do
                    Store.query(
                      db,
                      "update tasks set state = 'canceled', claim_token_hash = null, lease_until = null, updated_at = ? where root_id = ? and state != 'completed'",
                      [now, id]
                    )
                  end

                  {:ok, %{id: id, deleted: true, revision: new_rev}}
              end

            [%{"deleted_at" => _deleted}] ->
              {:ok, %{id: id, deleted: true}}

            [] ->
              {:error, "Message #{id} not found."}
          end
        end)

      case result do
        {:ok, res} ->
          Call.changed(call)
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
          case Store.query(db, "select deleted_at from messages where id = ?", [id]) do
            [%{"deleted_at" => nil}] ->
              if inputs["remove"] == true do
                Store.query(db, "delete from reactions where message_id = ? and actor = ? and profile = ? and emoji = ?", [id, actor, prof_key, emoji])
              else
                Store.query(db, "insert or ignore into reactions (message_id, actor, profile, emoji) values (?, ?, ?, ?)", [id, actor, prof_key, emoji])
              end

              {:ok, %{id: id, reactions: Store.reactions_for(db, id)}}

            _ ->
              {:error, "Message #{id} not found."}
          end
        end)

      case result do
        {:ok, res} ->
          Call.changed(call)
          res

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("label", inputs, call) do
    with id when is_binary(id) <- inputs["id"] || {:error, "Message id is required."},
         :ok <- validate_labels_map(inputs["set"]),
         :ok <- validate_unset_list(inputs["unset"]) do
      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select channel from messages where id = ? and deleted_at is null", [id]) do
            [%{"channel" => channel}] ->
              current = Store.labels_for(db, id)

              with :ok <- check_if_labels(current, inputs["if"]),
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
          Call.changed(call)
          emit_safe(call, "labels_changed", res)
          res

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("attach", %{"id" => msg_id, "file" => blob} = inputs, call) when is_binary(msg_id) and is_binary(blob) do
    with {:ok, upload} <- validate_optional_upload(call, blob, inputs["name"], inputs["mime_type"]) do
      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select deleted_at from messages where id = ?", [msg_id]) do
            [%{"deleted_at" => nil}] ->
              [%{"n" => count}] = Store.query(db, "select count(*) as n from attachments where message_id = ?", [msg_id])

              if count >= @max_attachments do
                {:error, "A message can have at most #{@max_attachments} attachments."}
              else
                att = insert_attachment(db, msg_id, upload, Store.now_iso())
                {:ok, att}
              end

            _ ->
              {:error, "Message #{msg_id} not found."}
          end
        end)

      case result do
        {:ok, att} ->
          Call.changed(call)
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
      [%{"blob" => blob, "mime_type" => mime}] -> {:file, mime, call.own, blob}
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
          Call.changed(call)

          for t <- created, t.state == "ready" do
            emit_safe(call, "task_ready", %{id: t.id, channel: channel, body: t.body, owner: owner, assigned_profile: t.assigned_profile}, event_id: "ready_" <> t.id)
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
          Store.expire_leases(db)

          cond do
            is_binary(inputs["id"]) and inputs["id"] != "" ->
              claim_by_id(db, inputs["id"], actor, profile, lease_until)

            inputs["ready"] == true ->
              claim_oldest_ready(db, inputs["channel"], inputs["label"], target_owner, actor, profile, lease_until)

            true ->
              {:error, "Provide either id or ready: true."}
          end
        end)

      case result do
        {:ok, claimed} ->
          Call.changed(call)
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
        Store.expire_leases(db)

        with :ok <- verify_claim(db, id, epoch, token) do
          Store.query(db, "update tasks set lease_until = ?, updated_at = ? where root_id = ?", [lease_until, Store.now_iso(), id])
          {:ok, %{id: id, epoch: epoch, lease_until: lease_until}}
        end
      end)

    case result do
      {:ok, res} ->
        Call.changed(call)
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
          Store.expire_leases(db)

          with :ok <- verify_claim_or_owner(db, id, inputs["epoch"], inputs["token"], actor),
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
          Call.changed(call)
          emit_safe(call, "message_posted", done.reply, event_id: done.reply.id)
          emit_safe(call, "task_completed", %{id: done.id, channel: done.channel, result: done.result, author: actor, profile: profile}, match: %{channel: done.channel, owner: done.owner})

          for r <- done.readied do
            emit_safe(call, "task_ready", r, event_id: "ready_" <> r.id)
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
          Store.expire_leases(db)

          with :ok <- verify_claim_or_owner(db, id, inputs["epoch"], inputs["token"], actor),
               [%{"channel" => channel}] <- Store.query(db, "select channel from messages where id = ?", [id]) do
            now = Store.now_iso()

            Store.query(
              db,
              "update tasks set state = 'failed', result = ?, claim_token_hash = null, lease_until = null, updated_at = ? where root_id = ?",
              [reason, now, id]
            )

            reply_msg = append_system_reply(db, id, channel, actor, profile, "Failed: #{reason}")
            {:ok, %{id: id, state: "failed", reason: reason, reply: reply_msg}}
          else
            [] -> {:error, "Task #{id} not found."}
            {:error, why} -> {:error, why}
          end
        end)

      case result do
        {:ok, res} ->
          Call.changed(call)
          emit_safe(call, "message_posted", res.reply, event_id: res.reply.id)
          Map.delete(res, :reply)

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
          Store.expire_leases(db)

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
          Call.changed(call)
          emit_safe(call, "message_posted", res.reply, event_id: res.reply.id)
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
          Store.expire_leases(db)

          with :ok <- verify_claim_or_owner(db, id, inputs["epoch"], inputs["token"], actor),
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
          Call.changed(call)
          emit_safe(call, "message_posted", blocked.reply, event_id: blocked.reply.id)
          emit_safe(call, "task_blocked", %{id: blocked.id, channel: blocked.channel, question: blocked.question, kind: blocked.kind, author: actor, profile: profile}, match: %{channel: blocked.channel, owner: blocked.owner, kind: blocked.kind})
          notify_blocked(call, blocked, profile)
          %{id: blocked.id, state: "blocked", kind: blocked.kind}

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_unblock", %{"id" => id} = inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select m.channel, m.body, t.state, t.owner_actor, t.assigned_profile from tasks t join messages m on m.id = t.root_id where t.root_id = ?", [id]) do
            [%{"channel" => channel, "body" => body, "state" => "blocked", "owner_actor" => owner, "assigned_profile" => assigned}] ->
              next_state = if Store.deps_satisfied?(db, id), do: "ready", else: "waiting"
              Store.query(db, "update tasks set state = ?, block_kind = null, updated_at = ? where root_id = ?", [next_state, Store.now_iso(), id])
              reply_msg = append_system_reply(db, id, channel, actor, profile, "Unblocked.")
              {:ok, %{id: id, state: next_state, channel: channel, body: body, owner: owner, assigned_profile: assigned, reply: reply_msg}}

            [%{"state" => state}] ->
              {:error, "Task #{id} is #{state}, not blocked."}

            [] ->
              {:error, "Task #{id} not found."}
          end
        end)

      case result do
        {:ok, res} ->
          Call.changed(call)
          emit_safe(call, "message_posted", res.reply, event_id: res.reply.id)

          if res.state == "ready" do
            emit_safe(call, "task_ready", %{id: res.id, channel: res.channel, body: res.body, owner: res.owner, assigned_profile: res.assigned_profile})
          end

          %{id: res.id, state: res.state}

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_cancel", %{"id" => id} = inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject
      reason = inputs["reason"] || "Canceled."

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select m.channel, t.state from tasks t join messages m on m.id = t.root_id where t.root_id = ?", [id]) do
            [%{"state" => "completed"}] ->
              {:error, "Task #{id} is already completed."}

            [%{"channel" => channel}] ->
              Store.query(
                db,
                "update tasks set state = 'canceled', result = ?, claim_token_hash = null, lease_until = null, updated_at = ? where root_id = ?",
                [reason, Store.now_iso(), id]
              )

              reply_msg = append_system_reply(db, id, channel, actor, profile, "Canceled: #{reason}")
              {:ok, %{id: id, state: "canceled", reply: reply_msg}}

            [] ->
              {:error, "Task #{id} not found."}
          end
        end)

      case result do
        {:ok, res} ->
          Call.changed(call)
          emit_safe(call, "message_posted", res.reply, event_id: res.reply.id)
          Map.delete(res, :reply)

        {:error, why} ->
          {:error, why}
      end
    end
  end

  defp dispatch("task_reopen", %{"id" => id} = inputs, call) do
    with {:ok, profile} <- Store.validate_profile(inputs["profile"]) do
      actor = call.actor || call.subject

      result =
        Store.transaction(call, fn db ->
          case Store.query(db, "select m.channel, m.body, t.state, t.owner_actor, t.assigned_profile from tasks t join messages m on m.id = t.root_id where t.root_id = ?", [id]) do
            [%{"channel" => channel, "body" => body, "state" => state, "owner_actor" => owner, "assigned_profile" => assigned}] when state in ["failed", "canceled"] ->
              next_state = if Store.deps_satisfied?(db, id), do: "ready", else: "waiting"
              Store.query(db, "update tasks set state = ?, result = null, block_kind = null, updated_at = ? where root_id = ?", [next_state, Store.now_iso(), id])
              reply_msg = append_system_reply(db, id, channel, actor, profile, "Reopened.")
              {:ok, %{id: id, state: next_state, channel: channel, body: body, owner: owner, assigned_profile: assigned, reply: reply_msg}}

            [%{"state" => state}] ->
              {:error, "Only failed or canceled tasks can be reopened (currently #{state})."}

            [] ->
              {:error, "Task #{id} not found."}
          end
        end)

      case result do
        {:ok, res} ->
          Call.changed(call)
          emit_safe(call, "message_posted", res.reply, event_id: res.reply.id)

          if res.state == "ready" do
            emit_safe(call, "task_ready", %{id: res.id, channel: res.channel, body: res.body, owner: res.owner, assigned_profile: res.assigned_profile})
          end

          %{id: res.id, state: res.state}

        {:error, why} ->
          {:error, why}
      end
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
          with {:ok, _blocks} <- Store.parse_and_validate_blocks(db, body) do
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
          Call.changed(call)
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
              "sent_count" => sent
            } <-
              Store.query(db, "select id, target, body, author, profile, no_sync, next_run_at, every_ms, until_at, remaining, sent_count from schedules order by next_run_at asc") do
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
            sent_count: sent
          }
        end
      end)

    %{schedules: schedules}
  end

  defp dispatch("schedule_cancel", %{"id" => id}, call) do
    Store.transaction(call, fn db -> Store.query(db, "delete from schedules where id = ?", [id]) end)
    Call.changed(call)
    %{id: id, canceled: true}
  end

  defp dispatch("tick_schedules", _inputs, call) do
    now = Store.now_ms()

    {expired, sent_msgs} =
      Store.transaction(call, fn db ->
        expired = Store.expire_leases(db)

        due =
          Store.query(
            db,
            "select id, target, body, author, profile, no_sync, every_ms, until_at, remaining, sent_count from schedules where next_run_at <= ? order by next_run_at asc",
            [now]
          )

        sent =
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
            msg = fire_scheduled_message(db, target, body, author, profile, no_sync)
            next_rem = if is_integer(rem), do: rem - 1, else: nil
            next_at = if every_ms, do: now + every_ms, else: nil

            keep =
              next_at != nil and (next_rem == nil or next_rem > 0) and (until_at == nil or next_at <= until_at)

            if keep do
              Store.query(db, "update schedules set next_run_at = ?, remaining = ?, sent_count = ? where id = ?", [next_at, next_rem, sent_count + 1, sid])
            else
              Store.query(db, "delete from schedules where id = ?", [sid])
            end

            msg
          end
          |> Enum.reject(&is_nil/1)

        {expired, sent}
      end)

    if expired != [] or sent_msgs != [] do
      Call.changed(call)
    end

    for r <- expired do
      emit_safe(call, "task_ready", r)
    end

    for msg <- sent_msgs do
      emit_safe(call, "message_posted", msg, event_id: msg.id)
    end

    %{expired_leases: length(expired), sent_schedules: length(sent_msgs)}
  end

  defp dispatch("badge", _inputs, call) do
    count =
      Store.transaction(call, fn db ->
        Store.expire_leases(db)
        [%{"n" => n}] = Store.query(db, "select count(*) as n from tasks where state = 'blocked'")
        n
      end)

    %{count: count}
  end

  defp dispatch("widget", _inputs, call) do
    {blocked, ready, claimed} =
      Store.transaction(call, fn db ->
        Store.expire_leases(db)

        blocked =
          Store.query(
            db,
            """
            select m.id, m.channel, m.body, t.block_kind
            from tasks t join messages m on m.id = t.root_id
            where t.state = 'blocked' and m.deleted_at is null
            order by t.updated_at desc limit 3
            """
          )

        [%{"n" => ready}] = Store.query(db, "select count(*) as n from tasks where state = 'ready'")
        [%{"n" => claimed}] = Store.query(db, "select count(*) as n from tasks where state = 'claimed'")
        {blocked, ready, claimed}
      end)

    rows =
      if blocked == [] do
        [%{part: "text", text: "Nothing blocked · #{ready} ready, #{claimed} active", size: "sm", tone: "muted"}]
      else
        for %{"channel" => ch, "body" => body, "block_kind" => kind} <- blocked do
          title = body |> String.split("\n") |> hd() |> String.slice(0, 48)
          %{part: "item", title: title, subtitle: "#{ch} · #{kind || "blocked"}"}
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
            %{part: "text", text: "#{length(blocked)} blocked", size: "sm", tone: if(blocked == [], do: "muted", else: "warn")}
          ]
        }
        | rows
      ]
    }
  end

  # --- Private Helpers ---

  defp finish_task_create(call, {:ok, task}) do
    Call.changed(call)

    if task.state == "ready" do
      emit_safe(call, "task_ready", %{id: task.id, channel: task.channel, body: task.body, owner: task.owner, assigned_profile: task.assigned_profile}, event_id: "ready_" <> task.id)
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
    with :ok <- validate_needs(db, root_id, needs) do
      now = Store.now_iso()
      state = if needs == [] or all_completed?(db, needs), do: "ready", else: "waiting"

      Store.query(
        db,
        """
        insert into tasks (root_id, state, owner_actor, owner_profile, assigned_profile, claim_epoch, updated_at)
        values (?, ?, ?, ?, ?, 0, ?)
        """,
        [root_id, state, owner, profile, assigned, now]
      )

      for dep <- Enum.uniq(needs) do
        Store.query(db, "insert or ignore into task_deps (task_id, needs_id) values (?, ?)", [root_id, dep])
      end

      {:ok, %{id: root_id, channel: channel, body: body, state: state, owner: owner, assigned_profile: assigned, needs: Enum.uniq(needs)}}
    end
  end

  defp validate_needs(db, root_id, needs) do
    Enum.reduce_while(needs, :ok, fn dep, :ok ->
      cond do
        not is_binary(dep) or dep == "" ->
          {:halt, {:error, "invalid_needs: dependency ID must be a non-empty string."}}

        Store.query(db, "select 1 from tasks where root_id = ?", [dep]) == [] ->
          {:halt, {:error, "invalid_needs: dependency #{dep} is not a task."}}

        Store.creates_cycle?(db, root_id, dep) ->
          {:halt, {:error, "invalid_needs: dependency #{dep} creates a cycle."}}

        true ->
          {:cont, :ok}
      end
    end)
  end

  defp all_completed?(db, needs) do
    Enum.all?(needs, fn dep ->
      Store.query(db, "select state from tasks where root_id = ?", [dep]) == [%{"state" => "completed"}]
    end)
  end

  defp claim_by_id(db, id, actor, profile, lease_until) do
    case Store.query(db, "select state, assigned_profile, claim_epoch from tasks where root_id = ?", [id]) do
      [%{"state" => "ready", "assigned_profile" => assigned, "claim_epoch" => epoch}] ->
        if assigned != nil and assigned != profile do
          {:error, "Task #{id} is assigned to profile #{assigned}."}
        else
          do_claim(db, id, epoch, actor, profile, lease_until)
        end

      [%{"state" => "claimed"}] ->
        {:error, "task_claimed: task #{id} is already claimed."}

      [%{"state" => state}] ->
        {:error, "Task #{id} is #{state}, not ready."}

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
        where t.state = 'ready' and t.owner_actor = ? and m.deleted_at is null
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
    case Store.query(db, "select state, claim_epoch, claim_token_hash from tasks where root_id = ?", [id]) do
      [%{"state" => "claimed", "claim_epoch" => ^epoch, "claim_token_hash" => stored_hash}] ->
        if stored_hash == Store.hash_token(token),
          do: :ok,
          else: {:error, "claim_lost: invalid claim token."}

      [%{"state" => "claimed", "claim_epoch" => cur}] ->
        {:error, "claim_lost: task is at epoch #{cur}, not #{epoch}."}

      [%{"state" => state}] ->
        {:error, "claim_lost: task is #{state}, not claimed."}

      [] ->
        {:error, "Task #{id} not found."}
    end
  end

  defp verify_claim(_db, _id, _epoch, _token), do: {:error, "claim_not_held: epoch and token are required."}

  defp verify_claim_or_owner(db, id, epoch, token, _actor) when is_integer(epoch) and is_binary(token) do
    verify_claim(db, id, epoch, token)
  end

  defp verify_claim_or_owner(db, id, _epoch, _token, actor) do
    case Store.query(db, "select state, owner_actor from tasks where root_id = ?", [id]) do
      [%{"state" => state, "owner_actor" => ^actor}] when state != "claimed" -> :ok
      [%{"state" => "claimed"}] -> {:error, "claim_not_held: task is currently claimed; pass epoch and token."}
      [_] -> {:error, "Only the claim holder or task owner can update this task."}
      [] -> {:error, "Task #{id} not found."}
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

    %{id: id, channel: channel, root_id: root_id, author: actor, profile: profile, display_author: Store.display_author(actor, profile), body: body}
  end

  defp fire_scheduled_message(db, target, body, author, profile, no_sync) do
    id = Store.new_id("msg")
    now = Store.now_iso()
    blocks_json = case Store.parse_and_validate_blocks(db, body) do
      {:ok, blocks} -> JSON.encode!(blocks)
      {:error, _} -> "[]"
    end

    case Store.query(db, "select channel from messages where id = ? and root_id is null", [target]) do
      [%{"channel" => channel}] ->
        Store.query(
          db,
          """
          insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
          values (?, ?, ?, null, ?, ?, ?, ?, 1, ?, ?)
          """,
          [id, channel, target, author, profile, body, blocks_json, no_sync, now]
        )

        %{id: id, channel: channel, root_id: target, author: author, profile: profile, display_author: Store.display_author(author, profile), body: body}

      [] ->
        case Store.validate_channel(target) do
          {:ok, channel} ->
            Store.query(
              db,
              """
              insert into messages (id, channel, root_id, reply_to, author, profile, body, blocks, revision, no_sync, created_at)
              values (?, ?, null, null, ?, ?, ?, ?, 1, ?, ?)
              """,
              [id, channel, author, profile, body, blocks_json, no_sync, now]
            )

            %{id: id, channel: channel, root_id: nil, author: author, profile: profile, display_author: Store.display_author(author, profile), body: body}

          _ ->
            nil
        end
    end
  end

  defp read_filters(channel, state, label) do
    {clauses, params} = {["m.root_id is null", "m.deleted_at is null"], []}

    {clauses, params} =
      if is_binary(state) and state != "" do
        {clauses ++ ["exists (select 1 from tasks t where t.root_id = m.id and t.state = ?)"], params ++ [state]}
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
        mime_type = if is_binary(mime) and mime != "", do: mime, else: "application/octet-stream"
        {:ok, %{blob: blob, name: filename, mime_type: mime_type, size: sz}}

      {:ok, _sz} ->
        {:error, "Attachment exceeds 100 MB limit."}

      _ ->
        {:error, "Uploaded file #{blob} was not found in the bucket."}
    end
  end

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

  defp emit_safe(call, event, data, opts \\ []) do
    Events.emit(call, event, data, opts)
  rescue
    e ->
      Logger.warning("board failed to emit #{event}: #{Exception.message(e)}")
      :ok
  end

  defp notify_blocked(call, blocked, profile) do
    who = Store.display_author(call.actor || call.subject, profile)
    notifications = Call.app(call, "notifications")

    notifications.send(call, %{
      "title" => "#{who} blocked a task in #{blocked.channel}",
      "text" => String.slice(blocked.question, 0, 140),
      "page" => "read&id=#{blocked.id}"
    })
  rescue
    e ->
      Logger.warning("board failed to notify blocked task #{blocked.id}: #{Exception.message(e)}")
      :ok
  end
end
