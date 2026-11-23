defmodule Privacy do
  @moduledoc """
  Privacy: the network's privacy page (`/privacy`, served by its edge function, `edge/`), made of what each app that
  keeps people's data says of it, as Settings is made of what each app adds to it. This app only collects them, by the
  hook it offers, `privacy.sections` (SKILL.md), from the apps the network has installed, and the page asks for them as
  the holder of a link to the network, since whoever opens it is nobody the network knows.
  """
  @behaviour OneCore.App

  alias OneCore.Call

  @impl true
  def requires, do: %{"core" => ">= 0.34.440"}

  @impl true
  def icon, do: "icon.svg"

  @impl true
  def offers do
    [
      %{
        name: "sections",
        kind: :collect,
        # An app's part is only words, whoever's the app is.
        untrusted: true,
        description:
          "What an app says of the data it keeps, on the network's privacy page. It's about nothing. An app answers " <>
            "with a list, each a map: `text`, what it says, in Markdown; `heading`, the heading it's under, which " <>
            "sections that use the same words share (none is the page's opening); and `order`, a number, lowest first. " <>
            "SKILL.md says more."
      }
    ]
  end

  @impl true
  def tools do
    [
      %{
        name: "sections",
        read_only: true,
        # The page is opened by anyone, who is no user: the network's edge asks as the holder of a link to the network.
        by_link: true,
        description:
          "What the apps the network has say of the data they keep (`privacy.sections`), in the order the page shows " <>
            "them: each with its `text` in Markdown, the `heading` it's under, if it has one, and the `app` that says it.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{
            sections: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  app: %{type: "string"},
                  heading: %{type: ["string", "null"]},
                  order: %{type: "integer"},
                  text: %{type: "string"}
                },
                required: ["app", "heading", "order", "text"]
              }
            }
          },
          required: ["sections"]
        }
      }
    ]
  end

  @impl true
  def call("sections", _inputs, call) do
    {:ok, parts, _failed} = Call.run_hook(call, "sections", %{})

    sections =
      for {app, part} <- parts,
          %{"text" => text} = section <- List.wrap(JSON.decode!(JSON.encode!(part))),
          is_binary(text) do
        %{app: app, heading: section["heading"], order: section["order"] || 0, text: text}
      end

    %{sections: Enum.sort_by(sections, &{&1.order, &1.app})}
  end
end
