defmodule ClickUp do
  @moduledoc """
  ClickUp: the person's ClickUp, through ClickUp's API (v2), with their own personal API token, which is kept in their
  Vault and sent only to api.clickup.com, so this app never sees it. Each tool is one of ClickUp's endpoints, for other
  apps and agents to build on. Nothing is deleted.
  """
  @behaviour OneCore.App

  @api "https://api.clickup.com/api/v2"

  # What a person or an agent does for a key: it's theirs to add, in their Vault, which ClickUp's connect page asks.
  @ask ~s|clickup_connect shows them how, or ask with vault_request: title "ClickUp <their email>", fields {"token": {"secret": true}}, hosts ["api.clickup.com"], app clickup.|

  # It has no app, so it draws itself, in the App Store.
  @impl true
  def icon, do: "icon.png"

  @impl true
  def requires, do: %{"vault" => "to keep your ClickUp key"}

  # A person's ClickUp key is an item of their Vault, listed under Accounts, which they add on the connect page.
  @impl true
  def hooks, do: ["vault.types"]

  @impl true
  def hook("vault.types", _about, _call),
    do: [%{name: "ClickUp account", section: "Accounts", prefix: "ClickUp ", create: %{label: "Connect", page: "client/connect.html"}}]

  # What a task's answer passes on of ClickUp's Task, and of the people, statuses and places in it.
  @task ~w(id custom_id name status date_created date_updated date_closed date_done archived creator assignees tags parent priority due_date start_date url list folder space)
  @person ~w(id username email)

  @impl true
  def tools do
    string = &%{type: "string", description: &1}
    nullable = &%{type: [&1, "null"], description: &2}
    ms = &nullable.("string", "#{&1}, in milliseconds since 1970, as ClickUp writes it")
    strings = &%{type: "array", items: %{type: "string"}, description: &1}

    person = %{
      type: "object",
      properties: %{id: %{type: "integer"}, username: %{type: ["string", "null"]}, email: %{type: ["string", "null"]}},
      required: ["id"]
    }

    place = %{type: "object", properties: %{id: %{type: "string"}, name: %{type: "string"}}, required: ["id"]}

    status = %{
      type: "object",
      properties: %{
        status: string.("Its name, like in progress"),
        color: string.("Its colour, as a hex colour"),
        type: string.("open, custom, done or closed: done and closed are complete"),
        orderindex: %{description: "Where it is in its list's order, as a number or its text"}
      },
      required: ["status", "type"]
    }

    task = %{
      type: "object",
      properties: %{
        id: string.("Its id"),
        custom_id: nullable.("string", "Its custom id, where the Workspace gives them"),
        name: string.("Its name"),
        status: status,
        date_created: ms.("When it was made"),
        date_updated: ms.("When it last changed"),
        date_closed: ms.("When it was closed"),
        date_done: ms.("When it was done"),
        archived: %{type: ["boolean", "null"]},
        creator: Map.put(person, :type, ["object", "null"]),
        assignees: %{type: "array", items: person},
        tags: %{type: "array", items: %{type: "object", properties: %{name: %{type: "string"}}, required: ["name"]}},
        parent: nullable.("string", "The task it's a subtask of"),
        priority: %{type: ["object", "null"], description: "ClickUp's own priority: {priority: urgent, high, normal or low, color}"},
        due_date: ms.("When it's due"),
        start_date: ms.("When it starts"),
        url: string.("Its page in ClickUp"),
        list: place,
        folder: Map.put(place, :type, ["object", "null"]),
        space: %{type: "object", properties: %{id: %{type: "string"}}, required: ["id"]}
      },
      required: @task
    }

    whole =
      task
      |> put_in([:properties, :markdown_description], nullable.("string", "What it says, in Markdown"))
      |> Map.update!(:required, &(&1 ++ ["markdown_description"]))

    task_id = string.("The task's id, from clickup_tasks")
    list_id = string.("The list's id, from clickup_folders or clickup_folderless_lists")
    space_id = string.("The Space's id, from clickup_spaces")
    team_id = string.("The Workspace's id, which ClickUp's API calls a team, from clickup_workspaces")
    due = %{type: "integer", description: "When it's due, in milliseconds since 1970"}
    due_time = %{type: "boolean", description: "Whether due_date has a time of day, or only says its day (false)"}
    markdown = string.("What it says, in Markdown")
    object = fn properties, required -> %{type: "object", properties: properties, required: required} end
    lists = %{type: "array", items: place}

    [
      %{
        name: "connect",
        read_only: true,
        ui: "client/connect.html",
        runtime_version: 5,
        description:
          "Shows the person how to connect ClickUp, on a page of its own: they add their personal API token in their Vault, on their own device. Says whether they have, as which item. Every other tool needs it.",
        inputs: object.(%{}, []),
        outputs: object.(%{item: nullable.("string", "Their ClickUp key's item in their Vault, or null where there's none")}, ["item"])
      },
      %{
        name: "user",
        read_only: true,
        description: "Who the token is: the person's ClickUp user.",
        inputs: object.(%{}, []),
        outputs: object.(%{user: person}, ["user"])
      },
      %{
        name: "workspaces",
        read_only: true,
        description: "The Workspaces the person is in, whose ids clickup_tasks and clickup_spaces take as team_id.",
        inputs: object.(%{}, []),
        outputs: object.(%{workspaces: %{type: "array", items: place}}, ["workspaces"])
      },
      %{
        name: "spaces",
        read_only: true,
        description: "A Workspace's Spaces.",
        inputs: object.(%{team_id: team_id, archived: %{type: "boolean", description: "Archived ones instead"}}, ["team_id"]),
        outputs: object.(%{spaces: %{type: "array", items: place}}, ["spaces"])
      },
      %{
        name: "tags",
        read_only: true,
        description: "The tags a Space has, which its tasks can be given.",
        inputs: object.(%{space_id: space_id}, ["space_id"]),
        outputs: object.(%{tags: %{type: "array", items: object.(%{name: %{type: "string"}}, ["name"])}}, ["tags"])
      },
      %{
        name: "folders",
        read_only: true,
        description: "A Space's folders, each with its lists.",
        inputs: object.(%{space_id: space_id, archived: %{type: "boolean", description: "Archived ones instead"}}, ["space_id"]),
        outputs:
          object.(
            %{folders: %{type: "array", items: %{place | properties: Map.put(place.properties, :lists, lists), required: ["id", "lists"]}}},
            ["folders"]
          )
      },
      %{
        name: "folderless_lists",
        read_only: true,
        description: "A Space's lists that aren't in a folder.",
        inputs: object.(%{space_id: space_id, archived: %{type: "boolean", description: "Archived ones instead"}}, ["space_id"]),
        outputs: object.(%{lists: lists}, ["lists"])
      },
      %{
        name: "list",
        read_only: true,
        description: "A list, with the statuses its tasks can have, in their order.",
        inputs: object.(%{list_id: list_id}, ["list_id"]),
        outputs:
          object.(
            %{
              id: %{type: "string"},
              name: %{type: "string"},
              statuses: %{type: "array", items: status},
              folder: Map.put(place, :type, ["object", "null"]),
              space: Map.put(place, :type, ["object", "null"])
            },
            ["id", "name", "statuses", "folder", "space"]
          )
      },
      %{
        name: "tasks",
        read_only: true,
        description:
          "Finds a Workspace's tasks, 100 to a page, newest changed first unless order_by says: open ones, and closed ones too with include_closed. Each filter narrows it.",
        inputs:
          object.(
            %{
              team_id: team_id,
              page: %{type: "integer", description: "Which page, from 0"},
              include_closed: %{type: "boolean", description: "Closed tasks too"},
              subtasks: %{type: "boolean", description: "Subtasks too"},
              space_ids: strings.("Only in these Spaces"),
              list_ids: strings.("Only in these lists"),
              statuses: strings.("Only with these statuses"),
              assignees: strings.("Only assigned to these users, by their ids, as clickup_user gives one's"),
              tags: strings.("Only with these tags"),
              date_updated_gt: %{type: "integer", description: "Only changed after this, in milliseconds since 1970"},
              due_date_lt: %{type: "integer", description: "Only due before this, in milliseconds since 1970"},
              order_by: %{type: "string", enum: ~w(id created updated due_date), description: "What they're in order of"},
              reverse: %{type: "boolean", description: "The other way round"}
            },
            ["team_id"]
          ),
        outputs: object.(%{tasks: %{type: "array", items: task}, last_page: %{type: "boolean"}}, ["tasks", "last_page"])
      },
      %{
        name: "task",
        read_only: true,
        description: "One task, with what it says.",
        inputs: object.(%{task_id: task_id}, ["task_id"]),
        outputs: whole
      },
      %{
        name: "create_task",
        description: "Makes a task in a list. Do it only when the person asked.",
        inputs:
          object.(
            %{
              list_id: list_id,
              name: string.("Its name"),
              markdown_description: markdown,
              assignees: %{type: "array", items: %{type: "integer"}, description: "Who it's for, by their user ids"},
              tags: strings.("Its tags, by name"),
              status: string.("Its status, one its list has; the list's first if left out"),
              due_date: due,
              due_date_time: due_time
            },
            ["list_id", "name"]
          ),
        outputs: task
      },
      %{
        name: "update_task",
        description: "Changes a task's name, status, due date or what it says. Do it only when the person asked.",
        inputs:
          object.(
            %{
              task_id: task_id,
              name: string.("Its new name"),
              status: string.("Its new status, one its list has, as clickup_list gives them"),
              due_date: Map.put(due, :type, ["integer", "null"]),
              due_date_time: due_time,
              markdown_description: markdown
            },
            ["task_id"]
          ),
        outputs: task
      },
      %{
        name: "add_tag",
        description: "Gives a task a tag its Space has.",
        inputs: object.(%{task_id: task_id, tag_name: string.("The tag, as clickup_tags names it")}, ["task_id", "tag_name"]),
        outputs: object.(%{task_id: %{type: "string"}, tag_name: %{type: "string"}}, ["task_id", "tag_name"])
      },
      %{
        name: "remove_tag",
        description: "Takes a tag off a task.",
        inputs: object.(%{task_id: task_id, tag_name: string.("The tag")}, ["task_id", "tag_name"]),
        outputs: object.(%{task_id: %{type: "string"}, tag_name: %{type: "string"}}, ["task_id", "tag_name"])
      },
      %{
        name: "create_comment",
        description: "Comments on a task, in plain text, whose links ClickUp makes links. Do it only when the person asked.",
        inputs:
          object.(
            %{
              task_id: task_id,
              comment_text: string.("What it says"),
              notify_all: %{type: "boolean", description: "Whether everyone on the task is told, as well as its assignees"}
            },
            ["task_id", "comment_text"]
          ),
        outputs: object.(%{id: %{type: "string", description: "The comment's id"}}, ["id"])
      }
    ]
  end

  @impl true
  def call("connect", _inputs, call), do: %{item: with(%{"name" => name} <- item(call), do: name)}

  def call("user", _inputs, call), do: %{user: Map.take(api(call, "GET", "/user")["user"], @person)}

  def call("workspaces", _inputs, call),
    do: %{workspaces: for(team <- api(call, "GET", "/team")["teams"], do: Map.take(team, ~w(id name)))}

  def call("spaces", %{"team_id" => team} = inputs, call),
    do: %{spaces: for(space <- api(call, "GET", "/team/#{part(team)}/space", archived(inputs))["spaces"], do: Map.take(space, ~w(id name)))}

  def call("tags", %{"space_id" => space}, call),
    do: %{tags: for(tag <- api(call, "GET", "/space/#{part(space)}/tag")["tags"], do: Map.take(tag, ["name"]))}

  def call("folders", %{"space_id" => space} = inputs, call) do
    folders =
      for folder <- api(call, "GET", "/space/#{part(space)}/folder", archived(inputs))["folders"],
          do: %{id: folder["id"], name: folder["name"], lists: Enum.map(folder["lists"] || [], &Map.take(&1, ~w(id name)))}

    %{folders: folders}
  end

  def call("folderless_lists", %{"space_id" => space} = inputs, call),
    do: %{lists: Enum.map(api(call, "GET", "/space/#{part(space)}/list", archived(inputs))["lists"], &Map.take(&1, ~w(id name)))}

  def call("list", %{"list_id" => list}, call) do
    found = api(call, "GET", "/list/#{part(list)}")

    %{
      id: found["id"],
      name: found["name"],
      statuses: found["statuses"] |> Enum.sort_by(&to_number(&1["orderindex"])) |> Enum.map(&Map.take(&1, ~w(status color type orderindex))),
      folder: found["folder"] && Map.take(found["folder"], ~w(id name)),
      space: found["space"] && Map.take(found["space"], ~w(id name))
    }
  end

  def call("tasks", %{"team_id" => team} = inputs, call) do
    query =
      for {key, value} <- Map.delete(inputs, "team_id"), value != nil, value <- List.wrap(value) do
        {if(is_list(inputs[key]), do: "#{key}[]", else: key), to_string(value)}
      end

    found = api(call, "GET", "/team/#{part(team)}/task", query)
    %{tasks: Enum.map(found["tasks"], &task/1), last_page: found["last_page"] == true}
  end

  def call("task", %{"task_id" => id}, call) do
    found = api(call, "GET", "/task/#{part(id)}", [{"include_markdown_description", "true"}])
    Map.put(task(found), "markdown_description", found["markdown_description"])
  end

  def call("create_task", %{"list_id" => list} = inputs, call),
    do: task(api(call, "POST", "/list/#{part(list)}/task", [], Map.delete(inputs, "list_id")))

  def call("update_task", %{"task_id" => id} = inputs, call),
    do: task(api(call, "PUT", "/task/#{part(id)}", [], Map.delete(inputs, "task_id")))

  def call("add_tag", %{"task_id" => id, "tag_name" => tag}, call) do
    api(call, "POST", "/task/#{part(id)}/tag/#{part(tag)}")
    %{task_id: id, tag_name: tag}
  end

  def call("remove_tag", %{"task_id" => id, "tag_name" => tag}, call) do
    api(call, "DELETE", "/task/#{part(id)}/tag/#{part(tag)}")
    %{task_id: id, tag_name: tag}
  end

  def call("create_comment", %{"task_id" => id} = inputs, call) do
    made = api(call, "POST", "/task/#{part(id)}/comment", [], Map.merge(%{"notify_all" => false}, Map.delete(inputs, "task_id")))
    %{id: to_string(made["id"])}
  end

  # A task as the tools answer it: what `tools/0` says of ClickUp's Task.
  defp task(found) do
    found = Map.merge(Map.new(@task, &{&1, nil}), Map.take(found, @task))

    %{
      found
      | "assignees" => Enum.map(found["assignees"] || [], &Map.take(&1, @person)),
        "creator" => found["creator"] && Map.take(found["creator"], @person),
        "tags" => Enum.map(found["tags"] || [], &Map.take(&1, ["name"])),
        "status" => found["status"] && Map.take(found["status"], ~w(status color type orderindex)),
        "list" => found["list"] && Map.take(found["list"], ~w(id name)),
        "folder" => found["folder"] && Map.take(found["folder"], ~w(id name)),
        "space" => found["space"] && Map.take(found["space"], ["id"])
    }
  end

  defp archived(%{"archived" => archived}), do: [{"archived", to_string(archived)}]
  defp archived(_inputs), do: []

  defp to_number(number) when is_number(number), do: number
  defp to_number(text) when is_binary(text), do: with({number, _} <- Float.parse(text), do: number, else: (_ -> 0))
  defp to_number(_none), do: 0

  # A part of a URL's path, with anything but letters and digits escaped.
  defp part(text), do: URI.encode(to_string(text), &URI.char_unreserved?/1)

  # ClickUp's API with the person's key, through the Vault, which fills it in and sends it only to ClickUp. Gives the
  # answer's JSON, or raises with what went wrong.
  defp api(call, method, path, query \\ [], body \\ nil) do
    url = @api <> path <> if(query == [], do: "", else: "?" <> URI.encode_query(query))

    item = item(call) || raise(OneCore.Call.Refused, "Connect ClickUp first: add your personal API token.\n\n#{@ask}")

    request = %{
      "item" => item["name"],
      "url" => url,
      "method" => method,
      "headers" => %{"authorization" => "{{token}}", "content-type" => "application/json"}
    }

    request = if body, do: Map.put(request, "body", unfilled(JSON.encode!(body))), else: request
    response = OneCore.Call.tool(call, "vault", "fetch", request)
    found = decoded(response["body"])

    case response["status"] do
      status when status in 200..299 ->
        if item["state"], do: state(call, item["name"], "ready")
        found

      401 ->
        state(call, item["name"], "needs_action", "ClickUp turned down this key", %{"label" => "Connect", "page" => "client/connect.html"})
        raise OneCore.Call.Refused, "ClickUp turned down your key. Connect ClickUp again with a new personal API token.\n\n#{@ask}"

      status ->
        raise "ClickUp: #{String.trim_trailing(to_string(found["err"] || found["error"] || status), ".")} (#{status})."
    end
  end

  # The person's ClickUp key: the newest of their items of its type, or nil.
  defp item(call), do: OneCore.Call.tool(call, "vault", "items", %{})["items"] |> Enum.filter(&String.starts_with?(&1["name"], "ClickUp ")) |> List.last()

  defp state(call, item, state, message \\ nil, action \\ nil),
    do: OneCore.Call.tool(call, "vault", "state", Map.reject(%{"item" => item, "state" => state, "message" => message, "action" => action}, &(elem(&1, 1) == nil)))

  defp decoded(body) when body in [nil, ""], do: %{}

  defp decoded(body) do
    case JSON.decode(body) do
      {:ok, json} when is_map(json) -> json
      _ -> %{"err" => String.slice(body, 0, 300)}
    end
  end

  # The Vault fills {{<field>}} in wherever it's written in a body, so what a person or an agent wrote, as a task's
  # name, must never say one. In JSON a { inside a string can be written as \u007b, and a { that starts an object
  # is never followed by another.
  defp unfilled(json), do: String.replace(json, ~r/\{(?=\{)/, fn _brace -> "\\u007b" end)
end
