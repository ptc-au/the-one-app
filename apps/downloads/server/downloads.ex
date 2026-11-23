defmodule Downloads do
  @moduledoc """
  Downloads: the network's download page, <address>/download, where someone signed in to the network gets its app for
  their computer or phone, as other apps' download pages have it (`edge/`). It offers the network's installers,
  which Software Update publishes and keeps, and serves each at /download/<its name>; and for an iPhone, TestFlight,
  with the network's public TestFlight link where it has one (its one setting, `set_testflight_link`), or else
  TestFlight itself, where its app is listed for whoever the network has invited.
  """
  @behaviour OneCore.App
  alias OneCore.{Artifact, Call}

  @impl true
  def icon, do: "icon.svg"

  @impl true
  def requires do
    %{
      "core" => ">= 0.34.403",
      "software-update" => "to offer the installers it publishes",
      "sign-in" => "to show the network's name"
    }
  end

  # Its data is the network's: its TestFlight link, the same for everyone.
  @impl true
  def own, do: :installed

  @impl true
  def tools do
    testflight = %{type: ["string", "null"], description: "The network's public TestFlight link, or null where its app is for its internal testers only"}

    [
      %{
        name: "list",
        read_only: true,
        description:
          "Says what the network's download page, <address>/download, offers: the network's name, its installers (Software Update's), each downloaded at <address>/download/<its name>, and its public TestFlight link",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{
            name: %{type: ["string", "null"], description: "The network's name, or null for the One App's"},
            installers: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  platform: %{type: "string"},
                  name: %{type: "string", description: "Its file's name"},
                  build: %{type: "string"},
                  size: %{type: "integer", description: "In bytes"}
                },
                required: ["platform", "name", "build", "size"]
              }
            },
            testflight: testflight
          },
          required: ["name", "installers", "testflight"]
        }
      },
      %{
        name: "set_testflight_link",
        description:
          "Sets the network's public TestFlight link (https://testflight.apple.com/join/...), which its download page offers an iPhone, or null for none: then it opens TestFlight, where the app is listed for its internal testers",
        inputs: %{type: "object", properties: %{link: testflight}, required: ["link"]},
        outputs: %{type: "object", properties: %{testflight: testflight}, required: ["testflight"]}
      }
    ]
  end

  @impl true
  def call("list", _inputs, call) do
    %{
      name: Call.tool(call, "sign-in", "network", %{})["name"],
      installers: Call.tool(call, "software-update", "installers", %{})["installers"],
      testflight: testflight(call)
    }
  end

  def call("set_testflight_link", %{"link" => link}, call) do
    if link != nil and not String.starts_with?(link, "https://testflight.apple.com/join/"),
      do: raise("A public TestFlight link is https://testflight.apple.com/join/<code>, as App Store Connect gives it.")

    if link, do: Artifact.update(call.own, "testflight", fn _was -> link end), else: Artifact.remove(call.own, "testflight")
    %{testflight: link}
  end

  defp testflight(call) do
    with {:ok, link, _tag} <- Artifact.read(call.own, "testflight"), do: link, else: (:absent -> nil)
  end
end
