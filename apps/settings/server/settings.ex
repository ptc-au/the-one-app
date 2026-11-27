defmodule Settings do
  @moduledoc """
  Settings: one app where every app brings its settings, as macOS's System Settings has its panes and Raycast's
  Settings its extensions. Its own are Updates and an app's page; the rest are other apps' components, which they
  place by answering the hook it offers, `settings.sections` (SKILL.md): a section in its sidebar, or a group in a
  page another section offers (a device's), each drawn by the app that brings it.
  """
  @behaviour OneCore.App

  alias OneCore.{Apps, Call, Hooks}

  @impl true
  def icon, do: "client/icon.svg"

  # It's about whoever opens it, wherever it's installed, as Vault and Devices are.
  @impl true
  def entrypoints, do: [%{page: "client/index.html", category: "settings", subject: "user", badge: "badge", runtime_version: 4}]

  @impl true
  def requires, do: %{"core" => ">= 0.37.24"}

  @impl true
  def offers do
    [
      %{
        name: "sections",
        kind: :collect,
        # An untrusted app's part is only data, drawn by its own page in a frame.
        untrusted: true,
        description:
          "What an app adds to Settings, and where. It's about nothing. An app answers with a list, each a map: " <>
            "`component`, a Solid component its client exports (client/package.json's `exports`, as ./<component>), " <>
            "which draws it; and `in`, where: \"settings\", a section of the sidebar, with its `name`, its `icon` (a " <>
            "file of the app's client/), its `group` (\"you\", \"network\", \"general\", \"system\") and `order` in it, and a " <>
            "`badge`, a tool of the app's that only reads, whose answer's `count` is the red count on its row and on " <>
            "Settings' icon, and `needs`, a field of what a client says of itself (`login`) that must not be null there for " <>
            "the section to be listed, as a device without it has nothing to show in it; or a place a section offers, as a group headed by the app's icon and name: \"device\", " <>
            "a device's page, given `device`, with the `kinds` of device it's for (app, browser, assistant, server) and " <>
            "`service: true` where it's only for a server running the app's service; or \"app\", the app's own page " <>
            "in Settings. SKILL.md says more."
      }
    ]
  end

  @impl true
  def tools do
    count = %{type: "object", properties: %{count: %{type: "integer"}}, required: ["count"]}

    [
      %{
        name: "sections",
        read_only: true,
        ui: "client/index.html",
        runtime_version: 4,
        description:
          "What the apps you have add to Settings (`settings.sections`): each with the app that adds it and its " <>
            "title, icon and whether it's trusted, which decides where its component is drawn, and a section's " <>
            "red count where it says one. It's Settings' first screen, its sidebar.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{
            sections: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  id: %{type: "string", description: "<app>/<component>"},
                  app: %{type: "string", description: "The name the app's installed by"},
                  title: %{type: "string", description: "What a person calls the app"},
                  icon: %{type: ["string", "null"], description: "Where a client reads it: ui://<app>/<code>/<path>"},
                  app_icon: %{type: ["string", "null"], description: "The app's own icon, as Home Screen gives it"},
                  trusted: %{type: "boolean"},
                  component: %{type: "string"},
                  in: %{type: "string"},
                  name: %{type: ["string", "null"]},
                  group: %{type: ["string", "null"]},
                  order: %{type: "integer"},
                  kinds: %{type: ["array", "null"], items: %{type: "string"}, description: "The kinds of device a device's group is for"},
                  service: %{type: "boolean", description: "Whether a device's group is only where the app's service runs"},
                  needs: %{type: ["string", "null"], description: "What a client must say of itself (a `one/client` field that isn't null) for a section to be listed there"},
                  count: %{type: ["integer", "null"], description: "Its red count, where it has a badge"}
                },
                required: ["id", "app", "title", "trusted", "component", "in", "order"]
              }
            },
            failed: %{
              type: "array",
              items: %{type: "string"},
              description: "Apps whose `settings.sections` hook didn't answer"
            }
          },
          required: ["sections"]
        }
      },
      %{
        name: "section",
        read_only: true,
        ui: "client/index.html",
        path: "{app}/{section}",
        runtime_version: 4,
        description:
          "One section of Settings' sidebar, as `sections` lists it, by the app that adds it and its component: " <>
            "Settings' screen of it, /settings/vault/accounts. Without `section`, the app's first. Its other inputs are the section's own, " <>
            "which its component reads for its screens: a device or a group open in it, a form (`/settings/sign-in/devices?device=mac`).",
        inputs: %{
          type: "object",
          properties: %{
            app: %{type: "string", description: "The app that adds it, like vault"},
            section: %{type: "string", description: "Its component, like accounts"}
          },
          required: ["app"]
        },
        outputs: %{type: "object", properties: %{section: %{type: "object"}}, required: ["section"]}
      },
      %{
        name: "updates",
        read_only: true,
        ui: "client/index.html",
        path: "updates",
        runtime_version: 4,
        description: "The apps you have with a newer version waiting, each with its update, as `apps` says it: Settings' Updates.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{type: "object", properties: %{apps: %{type: "array", items: %{type: "object"}}}, required: ["apps"]}
      },
      %{
        name: "app",
        read_only: true,
        ui: "client/index.html",
        path: "apps/{name}",
        runtime_version: 4,
        description:
          "One app you have, as `apps` lists it: Settings' page of it, who has it, its update and Remove App, at /settings/apps/notes.",
        inputs: %{
          type: "object",
          properties: %{
            name: %{type: "string", description: "The name it's installed by"},
            for: %{type: "string", description: "Who it's installed for, where more than one has it: users/sam, groups/family or network"}
          },
          required: ["name"]
        },
        outputs: %{type: "object", properties: %{app: %{type: "object"}}, required: ["app"]}
      },
      %{
        name: "badge",
        read_only: true,
        description: "The red count on Settings' icon: what waits in its sections, together",
        inputs: %{type: "object", properties: %{}},
        outputs: count
      },
      %{
        name: "apps",
        read_only: true,
        description:
          "The apps you have, as Settings lists them: each one's name, who it's installed for, its title and icon, " <>
            "and whether you may remove it. `apps` says the rest: its state, whether it's trusted, its update.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{
            apps: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  name: %{type: "string", description: "The name it's installed by"},
                  app: %{type: "string", description: "Its artifact"},
                  for: %{type: "string", description: "Who it's installed for"},
                  title: %{type: "string"},
                  icon: %{type: ["string", "null"], description: "ui://icons/<sha256>/icon.<ext>"},
                  category: %{type: ["string", "null"]},
                  removes: %{type: "boolean", description: "Whether whoever asked may remove it"}
                },
                required: ["name", "app", "for", "title", "removes"]
              }
            }
          },
          required: ["apps"]
        }
      }
    ]
  end

  @impl true
  def call("sections", _inputs, call) do
    {sections, failed_apps, _failed_badges} = sections_with_failures(call)
    %{sections: sections, failed: failed_apps}
  end

  def call("section", %{"app" => app} = inputs, call) do
    theirs = Enum.filter(sections(call), &(&1.in == "settings" and &1.app == app))
    one = if inputs["section"], do: Enum.find(theirs, &(&1.component == inputs["section"])), else: List.first(theirs)
    if one, do: %{section: one}, else: raise(Call.Refused, "#{app} adds no section #{inputs["section"]} to Settings.")
  end

  def call("updates", _inputs, call) do
    %{apps: apps} = call("apps", %{}, call)
    # Each app's record is read at once: one after another, they took 6 to 7 s on a network of 60 apps.
    updates = Apps.Update.read_all(Enum.map(apps, & &1.app))
    waiting = for {app, update} <- Enum.zip(apps, updates), update["state"] not in [nil, "unchecked"], do: Map.put(app, :update, update)
    %{apps: waiting}
  end

  def call("app", %{"name" => name} = inputs, call) do
    %{apps: apps} = call("apps", %{}, call)

    case Enum.find(apps, &(&1.name == name and inputs["for"] in [nil, &1.for])) do
      nil -> raise Call.Refused, "You have no app #{name}."
      app -> %{app: app}
    end
  end

  def call("badge", _inputs, call) do
    {sections, failed_apps, failed_badges} = sections_with_failures(call)

    if failed_apps != [] or failed_badges != %{} do
      names = Enum.uniq(failed_apps ++ for({{app, _badge}, _why} <- failed_badges, do: app))
      raise "Couldn't read every section's badge (#{Enum.join(names, ", ")})."
    end

    %{count: sections |> Enum.map(&(&1.count || 0)) |> Enum.sum()}
  end

  def call("apps", _inputs, call) do
    listed = Call.apps(call)
    # Whether whoever asks owns what each is installed for, asked once for each of those (the network, a group, them),
    # all at once: each is a question for the app that decides who may reach what. One it didn't answer in time isn't
    # removable from here now.
    {owns, _failed} = OneCore.Asks.each(Enum.uniq(Enum.map(listed, & &1.installed)), &Call.owns?(%{call | subject: &1}))
    owns = Map.new(owns)

    apps =
      for app <- listed do
        %{
          name: app.name,
          app: app.app,
          for: app.installed,
          title: app.title || app.name,
          icon: Apps.Icons.address(app.icon),
          category: app.category,
          removes: owns[app.installed] == true
        }
      end

    %{apps: Enum.sort_by(apps, &String.downcase(&1.title))}
  end

  defp sections(call), do: elem(sections_with_failures(call), 0)

  # What every app whoever this runs for has adds, as each app answered `settings.sections`, each with its app's title
  # and icon. One that doesn't say what it must is left out; apps whose hook didn't answer are returned in `failed_apps`.
  defp sections_with_failures(call) do
    {sections, failed_apps} = listed(call)

    # Each section's red count, as its app's badge tool says it, all at once: one after another, a slow badge held up
    # every section's.
    {counts, failed_badges} =
      sections
      |> Enum.flat_map(&if(&1.badge, do: [{&1.app, &1.badge}], else: []))
      |> Enum.uniq()
      |> OneCore.Asks.each(fn {app, badge} -> Call.tool(call, app, badge, %{})["count"] end)

    counts = Map.new(counts)
    items = for section <- sections, do: section |> Map.put(:count, counts[{section.app, section.badge}]) |> Map.delete(:badge)
    {items, failed_apps, failed_badges}
  end

  defp listed(call) do
    {:ok, parts, failed} = Hooks.collect("settings.sections", %{}, {call.actor, call.subject})
    running = Apps.running(call.subject)

    items =
      for {app, part} <- Enum.sort(parts),
          version = running[app],
          version != nil,
          trusted <- [Map.get(version, :trusted, true)],
          section <- List.wrap(JSON.decode!(JSON.encode!(part))),
          section?(section, trusted) do
        %{
          id: "#{app}/#{section["component"]}",
          app: app,
          title: version.title || app,
          icon: if(section["icon"], do: "ui://#{app}/#{version.code}/#{section["icon"]}"),
          app_icon: Apps.Icons.address(version.icon),
          trusted: trusted,
          component: section["component"],
          in: section["in"],
          name: section["name"],
          group: section["group"],
          order: section["order"] || 0,
          kinds: section["kinds"],
          service: section["service"] == true,
          needs: section["needs"],
          badge: section["badge"]
        }
      end

    {items, Map.keys(failed)}
  end

  # A section of the sidebar is the network's own apps', which are trusted; any app adds a group to a page, an untrusted
  # one's drawn by its page in a frame.
  defp section?(%{"component" => component, "in" => "settings", "name" => name, "group" => group}, true)
       when is_binary(component) and is_binary(name) and group in ~w(you network general system),
       do: true

  defp section?(%{"component" => component, "in" => place}, _trusted) when is_binary(component) and place in ~w(device app),
    do: true

  defp section?(_section, _trusted), do: false
end
