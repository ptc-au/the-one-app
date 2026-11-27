defmodule SignIn do
  @moduledoc """
  Signing in: whose each device is. People sign in at the network's address, where this app's edge function
  (`edge/`) keeps their passkeys and what they let act as them, and whose each device is, which One Core asks the edge
  (`OneCore.Hooks.whose/1`). What each person goes by
  is in this app's own artifact, `people/<name>`, which `people` tells whoever may see who's in the network, and the
  picture each is shown by in `pictures/<name>/own` (the one they set) and `pictures/<name>/google`, as the network's is
  `pictures/network` (`pictures`).

  What a person does with their devices in the app is asked of the edge function, which keeps them. A network
  with an address that isn't being built is joined by invitation, its first owner's included: until they've joined,
  the server's log says where, each time it's told who they are. A new link ends the one before.
  """
  @behaviour OneCore.App

  # Its data is the network's people and devices, which its edge function keeps for everyone.
  @impl true
  def own, do: :installed

  # Every client signs in through it.
  @impl true
  def icon, do: "client/security.svg"

  @impl true
  def requires, do: %{"core" => ">= 0.37.179", "database" => "to keep what happens in it"}

  @impl true
  def jobs, do: [%{tool: "notify", every: 60}]

  # Nothing looks into it as it runs (`server-debug`): what it's given and keeps are what people sign in with.
  @impl true
  def sensitive, do: true

  require Logger
  alias OneCore.{Artifact, Builds, Call, Edge}

  @impl true
  def tools do
    none = %{type: "object", properties: %{}}
    picture_source = %{type: ["string", "null"], enum: ["own", "google", nil], description: "Whose picture they're shown by: the one they set, Google's, or none (initials)"}
    domains = %{type: "object", properties: %{domains: %{type: "array", items: %{type: "string"}}}, required: ["domains"]}

    network = %{
      type: "object",
      properties: %{
        name: %{type: ["string", "null"]},
        icon: %{type: ["string", "null"], description: "Where its icon is, if it has one of its own"},
        logo: %{
          type: ["object", "null"],
          description: "Where its logo is, for a light page and a dark, if it has one of its own",
          properties: %{light: %{type: "string"}, dark: %{type: "string"}}
        },
        mark: %{
          type: ["object", "null"],
          description: "Its logo as a page draws it where only an app's own files load, as `data:` addresses",
          properties: %{light: %{type: "string"}, dark: %{type: "string"}}
        },
        android_package: %{type: ["string", "null"]},
        apple_app: %{type: ["string", "null"]}
      },
      required: ["name", "icon"]
    }

    [
      %{
        name: "invite",
        ui: "client/forms.html",
        runtime_version: 4,
        description: """
        Makes a link someone new joins the network by, which you send them however you like: nothing is sent for you.
        Their username comes from how they sign in, so you name none. With `email` only the Google account with that
        email joins by it. With `who`, a link for someone who has joined, as a way back when they've lost every passkey:
        it ends the one made for them before, only the network's owner makes it, and never for an owner
        """,
        inputs: %{
          type: "object",
          properties: %{
            email: %{type: "string", description: "The email of the only Google account that may join by the link"},
            who: %{type: "string", pattern: "^users/[a-z0-9][a-z0-9.-]*$", description: "Someone who has joined, to get back in: users/<name>"}
          }
        },
        outputs: %{
          type: "object",
          properties: %{link: %{type: "string", description: "Where they join, within a week. It's shown once, so pass it on now"}},
          required: ["link"]
        }
      },
      %{
        name: "cancel_invite",
        description: "Ends a link made for someone new, which nobody has joined by yet",
        inputs: %{type: "object", properties: %{id: %{type: "string", description: "The invitation, as `everyone` says"}}, required: ["id"]},
        outputs: %{type: "object", properties: %{id: %{type: "string"}}, required: ["id"]}
      },
      %{
        name: "everyone",
        read_only: true,
        description:
          "Lists everyone in the network and everyone invited to it: the name each goes by, and whether they've joined, and the links made for someone new that nobody has joined by yet",
        inputs: none,
        outputs: %{
          type: "object",
          properties: %{
            people: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  who: %{type: "string", description: "users/<name>"},
                  called: %{type: ["string", "null"], description: "The name they go by"},
                  email: %{type: ["string", "null"]},
                  joined: %{type: "boolean", description: "Whether they've joined, or are only invited"},
                  first_owner: %{type: "boolean", description: "Whether they're the network's first owner, who stays an owner"},
                  picture: picture_source
                },
                required: ["who", "called", "email", "joined", "first_owner", "picture"]
              }
            },
            invitations: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  id: %{type: "string"},
                  email: %{type: ["string", "null"], description: "The Google account it's only for"},
                  expires: %{type: "string", description: "When it ends, as ISO 8601"}
                },
                required: ["id", "email", "expires"]
              }
            }
          },
          required: ["people", "invitations"]
        }
      },
      %{
        name: "domains",
        read_only: true,
        description: """
        Says which Google Workspace domains' people join the network by signing in with Google, with no invitation
        (`set_domains`). Everyone else joins by an invitation
        """,
        inputs: none,
        outputs: domains
      },
      %{
        name: "set_domains",
        description: """
        Makes these the Google Workspace domains whose people join the network by signing in with Google, with no
        invitation. Google signs people in only where the network's edge has a Google client
        """,
        inputs: %{
          type: "object",
          properties: %{
            domains: %{type: "array", items: %{type: "string"}, description: "Its domains, like example.org: none lets nobody in this way"}
          },
          required: ["domains"]
        },
        outputs: domains
      },
      %{
        name: "network",
        read_only: true,
        description: """
        Says the network's name, icon and logo, as its sign-in page and its web app show them and as its own apps are
        finished with, and its own iPhone app's ID and Android app's package name, which its passkeys and links are
        trusted to (`set_network`). Without them, it's the One App's
        """,
        inputs: none,
        outputs: network
      },
      %{
        name: "set_network",
        description: """
        Sets the network's name, icon and logo, its own iPhone app's ID or its Android app's package name, each that's
        given, as `network` says them. Its icon is on a tile of its own, as a Home Screen, a tab and its apps show it;
        its logo is its mark alone, as its sign-in page draws it, one for a light page and one for a dark (either alone
        shows on both)
        """,
        inputs: %{
          type: "object",
          properties: %{
            name: %{type: ["string", "null"], description: "Its name, like the PTC App: null for the One App's"},
            icon: %{type: ["string", "null"], description: "Its icon, a square PNG up to 1 MB, as base64: null for the One App's"},
            logo: %{
              type: ["object", "null"],
              description: "Its logo, each a square PNG up to 1 MB, as base64: null for the One App's",
              properties: %{
                light: %{type: "string", description: "Its mark as a light page shows it"},
                dark: %{type: "string", description: "Its mark as a dark page shows it"}
              }
            },
            android_package: %{
              type: ["string", "null"],
              description: "Its own Android app's package name, like app.ptc.android (`tooling/android-apk`): null for none"
            },
            apple_app: %{
              type: ["string", "null"],
              description:
                "Its own iPhone app's ID, its team and bundle identifier, like X96JC3HCV7.au.org.powertochange.ptc.pilot (`tooling/testflight`): null for none"
            }
          }
        },
        outputs: network
      },
      %{
        name: "remove_person",
        description:
          "Takes someone out of the network: their devices, assistants and passkeys stop working, and what they made stays",
        inputs: %{
          type: "object",
          properties: %{who: %{type: "string", pattern: "^users/[a-z0-9][a-z0-9.-]*$", description: "Who: users/<name>"}},
          required: ["who"]
        },
        outputs: %{type: "object", properties: %{who: %{type: "string"}}, required: ["who"]}
      },
      %{
        name: "waiting",
        read_only: true,
        description: """
        Lists the devices that are showing a code and waiting to be let in, which only the network's owners are told (nothing
        for anyone else): each with the `link` that opens where its owner approves it, with a passkey or Google, and says
        whether the code there matches the one on the device
        """,
        inputs: none,
        outputs: %{
          type: "object",
          properties: %{
            waiting: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  device: %{type: "string", description: "Its key"},
                  name: %{type: "string", description: "What it calls itself"},
                  command: %{type: ["string", "null"], description: "The command that ran it, if a terminal did"},
                  link: %{type: "string", description: "Where its code is approved"}
                },
                required: ["device", "name", "command", "link"]
              }
            }
          },
          required: ["waiting"]
        }
      },
      %{
        name: "badge",
        read_only: true,
        description: "How many devices are waiting to be let in, the red count on Devices in Settings",
        inputs: none,
        outputs: %{type: "object", properties: %{count: %{type: "integer"}}, required: ["count"]}
      },
      %{
        name: "notify",
        description:
          "Notifies the network's owners once when a device starts waiting to be let in, as the clock runs it, and again if it waits again after it was let in or stopped. Says which devices are waiting, and which it told them of just now",
        inputs: none,
        outputs: %{
          type: "object",
          properties: %{
            waiting: %{type: "array", items: %{type: "string"}, description: "The devices waiting, by what they call themselves"},
            told: %{type: "array", items: %{type: "string"}, description: "Those it notified the owners of just now"}
          },
          required: ["waiting", "told"]
        }
      },
      %{
        name: "check",
        description: """
        Notifies the network's owners once when a server starts waiting for the network's key, which their passkey
        hands it in Sign In & Security, as the encryption app's `check` has it do every 10 minutes, and a person once
        when one starts waiting for theirs. Says which servers are waiting, and which it told them of just now
        """,
        inputs: %{
          type: "object",
          properties: %{
            waiting: %{
              type: "array",
              description: "The servers waiting for the key of whose it runs for, as the encryption app's `access` says, when no one is there to ask it for them: a job's",
              items: %{type: "object", properties: %{key: %{type: "string"}, name: %{type: ["string", "null"]}}, required: ["key"]}
            }
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            waiting: %{type: "array", items: %{type: "string"}, description: "The servers waiting, by what their machines are called"},
            told: %{type: "array", items: %{type: "string"}, description: "Those it notified the owners of just now"}
          },
          required: ["waiting", "told"]
        }
      },
      %{
        name: "add_passkey",
        description: """
        Lets you make another passkey, in a browser, within a quarter of an hour. Whoever opens its link makes a
        passkey of yours, so the link goes only to your own screen: an assistant's call notifies you instead
        """,
        inputs: none,
        outputs: %{
          type: "object",
          properties: %{
            link: %{type: "string", description: "Where to make it, given only to the app or web client on your own device"},
            message: %{type: "string", description: "What to tell your person, when you were given no link"}
          }
        }
      },
      %{
        name: "encrypt_for_passkeys",
        description: """
        Lets a passkey unlock your key on a new device, once your person has said it may: from a device that holds the
        key, encrypts it to that passkey's key, which its PRF output derives and it says as it's used to sign in.
        Whoever uses the passkey has your key from then on, so ask them first, naming it and when it was added
        """,
        inputs: %{
          type: "object",
          properties: %{
            passkey: %{type: "string", description: "The passkey your person allowed, by its id as `devices` lists it"},
            code: %{type: "string", description: "Its code as `devices` lists it, which your person checked is the one the sign-in page showed them"},
            keys: %{
              type: "string",
              format: "passkey-keys",
              passkeys: "devices",
              description: "Your key, encrypted to that passkey, which this device fills in"
            }
          },
          required: ["passkey"]
        },
        outputs: %{
          type: "object",
          properties: %{passkeys: %{type: "integer", description: "1 once it unlocks your key, 0 if it couldn't"}},
          required: ["passkeys"]
        }
      },
      %{
        name: "unlock_with_passkey",
        description: """
        Makes a link where a passkey of yours that unlocks your key hands it on, in a browser: to a device of yours
        that's asking for it, and to the servers waiting for it, yours or those of a group or the network you own
        (`scope`), whose key yours opens. A passkey that hasn't said yet says the key it unlocks with there, which a
        device that holds yours encrypts it to once you allow it (`encrypt_for_passkeys`). Open it, don't pass it on.
        """,
        inputs: %{
          type: "object",
          properties: %{
            device: %{type: "string", description: "The device's key, as `encryption_key` lists it asking"},
            scope: %{type: "string", pattern: "^(network|groups/[a-z0-9-]+)$", description: "A group or the network you own"}
          }
        },
        outputs: %{type: "object", properties: %{link: %{type: "string"}}, required: ["link"]}
      },
      %{
        name: "devices",
        read_only: true,
        description: "Lists your devices, assistants and browsers, and your passkeys",
        inputs: none,
        outputs: %{
          type: "object",
          properties: %{
            devices: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  id: %{type: "string", description: "What remove_device takes"},
                  kind: %{type: "string", description: "app, assistant or browser"},
                  name: %{type: "string"},
                  command: %{type: ["string", "null"], description: "The command a person types to run the program that was let in, if it's run from a terminal (`ptc`): a CLI, not the app"},
                  target: %{type: "string", description: "The kind of machine an app that has connected runs on, as `builds` names them (`macos-aarch64`, `windows-x86_64`, `ios-aarch64`)"},
                  added: %{type: "string", description: "When, ISO 8601"},
                  connected: %{type: "boolean", description: "Whether an app is connected now"},
                  last_seen: %{type: "string", description: "When an app that isn't connected was last, or a browser was last used, ISO 8601"}
                },
                required: ["id", "kind", "name", "added"]
              }
            },
            passkeys: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  id: %{type: "string", description: "What remove_passkey takes"},
                  name: %{type: "string"},
                  added: %{type: "string", description: "When, ISO 8601"},
                  credential: %{type: "string", description: "Its WebAuthn credential ID"},
                  prf_key: %{
                    type: ["string", "null"],
                    description:
                      "The key its PRF output derives, which your key is encrypted to so it unlocks it on a new device: empty if it has no PRF, null until it's next used"
                  },
                  unlocks: %{type: "boolean", description: "Whether it unlocks your key on a new device"},
                  from: %{
                    type: ["string", "null"],
                    description: "The device whose Add Passkey made it: where that device holds your key, it lets it unlock with no code to check"
                  },
                  code: %{
                    type: ["string", "null"],
                    description: "Its key's code, which the sign-in page showed as it was used: its person checks they're the same before it's allowed"
                  }
                },
                required: ["id", "name", "added", "credential", "prf_key", "unlocks"]
              }
            }
          },
          required: ["devices", "passkeys"]
        }
      },
      %{
        name: "people",
        read_only: true,
        description:
          "Says who people in the network are: the name each goes by, and their email where signing in has one",
        inputs: %{
          type: "object",
          properties: %{
            users: %{
              type: "array",
              items: %{type: "string", pattern: "^users/[a-z0-9][a-z0-9.-]*$"},
              description: "Who: users/<name>. You, if left out"
            }
          }
        },
        outputs: %{
          type: "object",
          properties: %{
            people: %{
              type: "array",
              items: %{
                type: "object",
                properties: %{
                  who: %{type: "string", description: "users/<name>"},
                  called: %{type: ["string", "null"], description: "The name they go by"},
                  email: %{type: ["string", "null"], description: "Their email, where signing in has one"},
                  picture: picture_source
                },
                required: ["who", "called", "email", "picture"]
              }
            }
          },
          required: ["people"]
        }
      },
      %{
        name: "pictures",
        read_only: true,
        description:
          "Gives the pictures people and the network are shown by, each a small square JPEG as a `data:` address, or null where there is none: a person's own, or the one Google has for them. A group has none: it's drawn with its members' faces, up to four people in it, those with a picture first, whose pictures come too. An app draws them with the UI library's `Avatar`",
        inputs: %{
          type: "object",
          properties: %{
            subjects: %{
              type: "array",
              items: %{type: "string"},
              maxItems: 100,
              description: "Whose: users/<name>, network or groups/<name>"
            }
          },
          required: ["subjects"]
        },
        outputs: %{
          type: "object",
          properties: %{
            pictures: %{type: "object", additionalProperties: %{type: ["string", "null"]}, description: "Each subject's picture, by the subject, and each member's in `members`"},
            members: %{
              type: "object",
              additionalProperties: %{type: "array", items: %{type: "string"}, maxItems: 4},
              description: "Each group's members it's drawn with, users/<name>, by the group: none for a group you aren't in, as you don't see who is"
            }
          },
          required: ["pictures", "members"]
        }
      },
      %{
        name: "picture",
        description:
          "Sets the picture you go by in the network, or without `upload` takes it away, which leaves your Google picture where signing in with Google gave one, and your initials where not. It's made square and small, from its middle",
        inputs: %{
          type: "object",
          properties: %{
            upload: %{type: "string", format: "upload", description: "A picture of any size up to 10 MB: its name, as the upload tool answers once it's sent (the command's --upload-from does both)"}
          }
        },
        outputs: %{
          type: "object",
          properties: %{picture: %{type: ["string", "null"], enum: ["own", "google", nil], description: "Whose picture you're shown by now"}},
          required: ["picture"]
        }
      },
      %{
        name: "name",
        ui: "client/forms.html",
        runtime_version: 4,
        description: "Changes the name you go by in the network",
        inputs: %{
          type: "object",
          properties: %{called: %{type: "string", minLength: 1, description: "Your name, as people know you"}},
          required: ["called"]
        },
        outputs: %{type: "object", properties: %{called: %{type: "string"}}, required: ["called"]}
      },
      %{
        name: "username",
        ui: "client/forms.html",
        runtime_version: 4,
        task_support: :optional,
        description: """
        Changes your username, which your addresses are under (`users/<username>`, `/git-repos/<username>/notes`), or
        with `who`, someone else's, which only the network's owners do. Everything of theirs moves with it, and their
        old addresses, sharing links, webhooks and git remotes lead to the new one, as GitHub's old usernames do: nobody
        else is given an old one. It takes as long as there is of theirs to move, saying each stage, and is done once
        they're renamed: an app that didn't hear of it is under `unheard`, which it then finds the new name for itself.
        People see each other by name and email, so change it only when asked
        """,
        inputs: %{
          type: "object",
          properties: %{
            username: %{type: "string", description: "Lowercase letters, digits, dots and hyphens, starting and ending with a letter or a digit, as jane.doe"},
            who: %{type: "string", pattern: "^users/[a-z0-9][a-z0-9.-]*$", description: "Whose: users/<name>. You, if left out"}
          },
          required: ["username"]
        },
        outputs: %{
          type: "object",
          properties: %{
            who: %{type: "string", description: "Who they are now: users/<username>"},
            unheard: %{
              type: "array",
              description: "The apps that didn't rename them in what they keep, and why: done, but with these still under the old name",
              items: %{type: "object", properties: %{app: %{type: "string"}, why: %{type: "string"}}, required: ["app", "why"]}
            }
          },
          required: ["who", "unheard"]
        }
      },
      %{
        name: "approve",
        description: "Approves a device as yours by the code it shows, which your person passed on from it. Not a server's code: one of the network's owners adds a server, with their passkey, which no assistant does",
        inputs: %{
          type: "object",
          properties: %{code: %{type: "string", description: "The code the device shows, as WDJB-MJHT"}},
          required: ["code"]
        },
        outputs: %{
          type: "object",
          properties: %{approved: %{type: "string", description: "The device's name, which is yours now"}},
          required: ["approved"]
        }
      },
      %{
        name: "browser",
        description:
          "Signs a browser in as you with no passkey, on a network being built: a new session's cookies, as " <>
            "Playwright's storage state has them (`storageState`), which a test browser loads to open the network signed in",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{cookies: %{type: "array", items: %{type: "object"}}, origins: %{type: "array"}},
          required: ["cookies", "origins"]
        }
      },
      %{
        name: "remove_device",
        description: "Removes one of your devices, assistants or browsers. It's signed out from then on",
        inputs: %{
          type: "object",
          properties: %{device: %{type: "string", description: "The device's id, as `devices` lists it"}},
          required: ["device"]
        },
        outputs: %{
          type: "object",
          properties: %{removed: %{type: "string", description: "Its name"}},
          required: ["removed"]
        }
      },
      %{
        name: "remove_passkey",
        description: "Removes one of your passkeys",
        inputs: %{
          type: "object",
          properties: %{passkey: %{type: "string", description: "The passkey's id, as `devices` lists it"}},
          required: ["passkey"]
        },
        outputs: %{
          type: "object",
          properties: %{removed: %{type: "string", description: "Its name"}},
          required: ["removed"]
        }
      }
    ]
  end

  @impl true
  def events do
    [
      %{
        name: "device_removed",
        inputs: %{type: "object", properties: %{who: %{type: "string"}}},
        outputs: %{type: "object", properties: %{device: %{type: "string"}, who: %{type: "string"}}},
        description:
          "One of a person's devices, assistants or browsers was removed with `remove_device`: its `device` key, " <>
            "as `OneCore.Hooks.whose/1` knows it, and `who` it was, users/<name>. An app that keeps anything for the " <>
            "device, as where its push service reaches it, forgets it: it's nobody's from then on."
      }
    ]
  end

  @impl true
  def hooks, do: ["owner", "renamed", "settings.sections", "privacy.sections"]

  @impl true
  # Someone renamed: the name they go by and their pictures are theirs by their new name.
  def hook("renamed", %{"who" => "users/" <> old = who, "to" => "users/" <> new = to}, call) do
    for blob <- ["people/" <> old | Artifact.list(call.own, "pictures/#{old}/")],
        {:ok, data, _tag} <- [Artifact.read(call.own, blob)] do
      Artifact.write(call.own, String.replace(blob, old, new, global: false), data)
      Artifact.remove(call.own, blob)
    end

    nil
  end

  # Its sections of Settings: whoever's looking (Sign In & Security under their name), Devices, AI, and People & Groups,
  # an admin thing, for the network's owners alone.
  def hook("settings.sections", _about, call) do
    owner? = Call.owns?(%{call | subject: "network"})
    people = %{in: "settings", name: "People & Groups", component: "people", icon: "client/users.svg", group: "network", order: 2}
    devices = %{in: "settings", name: "Devices", component: "devices", icon: "client/icon.svg", group: "network", order: 1}
    devices = if owner?, do: Map.put(devices, :badge, "badge"), else: devices

    [
      %{in: "settings", name: "Sign In & Security", component: "passkeys", icon: "client/security.svg", group: "you", order: 0},
      devices,
      %{in: "settings", name: "AI", component: "ai", icon: "client/connect.svg", group: "general", order: 3}
    ] ++ if(owner?, do: [people], else: [])
  end

  # What the network's privacy page says of who runs it, and how to ask them (`privacy.sections`).
  def hook("privacy.sections", _about, call) do
    owner = owner_name(call)
    host = address() |> URI.parse() |> Map.fetch!(:host)

    [
      %{
        order: 0,
        text: "#{host} is a private network that belongs to #{owner}. Only they and the people they invite use it. It isn't a public service."
      },
      %{
        heading: "Who's responsible",
        order: 1,
        text: "This network is run by #{owner}, who is responsible for the data kept in it."
      },
      %{
        heading: "What's kept, and where",
        order: 2,
        text:
          "What people keep here, and what the network's apps keep for them, is stored in the network's own storage bucket and on its servers, which its owner and its people run."
      },
      %{heading: "Removing access and data", order: 8, text: "- To have anything else deleted, ask #{owner}."},
      %{heading: "Questions", order: 9, text: "Contact #{owner}."}
    ]
  end

  # Only a network that has an address and isn't being built has people sign in. One being built acts as whoever a
  # client says, so its first owner joins nowhere. One who has joined is given no link to join by again.
  def hook("owner", %{"who" => "users/" <> name = who}, _call) do
    signs_in = Application.get_env(:one_core, :address) && !Application.get_env(:one_core, :development, false)

    with true <- signs_in and OneCore.User.first_owner?(who),
         %{"link" => link} <- ask(%{ask: "owner", who: name}),
         do: Logger.info(joins(name, link))

    :ok
  end

  @impl true
  # Who invites is whoever may change what this app keeps for the network: its owners, and whoever they made
  # an editor of it. Someone new gets a link nobody names them in. Whoever joins by a link for a user is that user, so
  # someone who has joined is invited again only by the network's owner, and an owner never: they add a passkey on a
  # device they're signed in on, as Apple and Google have it. The edge knows who has joined, and is told whether this
  # may be that (`again`).
  def call("invite", inputs, call) do
    Call.reach(call, Artifact.name(call.own), "editor")

    case inputs["who"] do
      nil ->
        %{"link" => link} = ask(%{ask: "invite", email: inputs["email"]})
        %{link: link}

      "users/" <> name = who ->
        again = owns_network?(call, call.actor) and not owns_network?(call, who)
        %{"link" => link} = ask(%{ask: "invite", who: name, again: again})
        %{link: link}
    end
  end

  def call("cancel_invite", %{"id" => id}, call) do
    Call.reach(call, Artifact.name(call.own), "editor")
    ask(%{ask: "cancel_invite", id: id})
    %{id: id}
  end

  def call("everyone", _inputs, call) do
    if not Call.member?(call, "network"), do: Call.refuse("Only a member of the network sees who's in it.")
    first = OneCore.User.first_owner()
    %{"people" => people, "invitations" => invitations} = ask(%{ask: "everyone"})
    pictures = kept(call, Enum.map(people, & &1["who"]))
    %{people: for(person <- people, do: person |> Map.put("first_owner", person["who"] == first) |> Map.put("picture", source(pictures[person["who"]]))), invitations: invitations}
  end

  # Whoever invites says who joins with no invitation, and any member sees it.
  def call("set_domains", %{"domains" => domains}, call) do
    Call.reach(call, Artifact.name(call.own), "editor")
    %{domains: ask(%{ask: "domains", domains: domains})["domains"]}
  end

  def call("domains", _inputs, call) do
    if not Call.member?(call, "network"), do: Call.refuse("Only a member of the network sees who joins it.")
    %{domains: ask(%{ask: "domains"})["domains"]}
  end

  # Whoever invites names the network, and any member sees what it's called.
  def call("network", _inputs, call) do
    if not Call.member?(call, "network"), do: Call.refuse("Only a member of the network sees what it's called.")
    network(%{})
  end

  def call("set_network", inputs, call) do
    Call.reach(call, Artifact.name(call.own), "editor")
    network(Map.take(inputs, ["name", "icon", "logo", "android_package", "apple_app"]))
  end

  # Whoever invites takes out, and nobody takes themselves out. Only an owner takes out an owner, as only a super
  # admin removes another in Google Workspace.
  def call("remove_person", %{"who" => who}, call) do
    Call.reach(call, Artifact.name(call.own), "editor")
    if who == call.actor, do: raise("You can't take yourself out of the network.")

    if owns_network?(call, who) and not owns_network?(call, call.actor),
      do: raise("Only the network's owners take out one of its owners.")
    ask(%{ask: "remove_person", who: who})
    Call.tool(call, "permissions", "forget", %{"who" => who})
    %{who: who}
  end

  # Whoever owns the network is told of a device when it shows its first code, which the edge says it's waiting with
  # (its newest code is the one it shows: it asks for another each time its code ends, so each is told once while it's
  # there). What's kept is who's waiting now, so one that's let in or stopped and waits again is told of again.
  def call("notify", _inputs, %Call{subject: "network"} = call) do
    waiting = waiting_devices()

    told = with {:ok, told, _tag} <- Artifact.read(call.own, "told/devices"), do: JSON.decode!(told), else: (:absent -> [])
    new = Enum.reject(waiting, &(&1["device"] in told))

    if new != [] do
      names = Enum.map(new, & &1["name"])
      {title, are} = {Enum.join(names, ", "), if(length(names) == 1, do: "is", else: "are")}
      people = for "people/" <> name <- Artifact.list(call.own, "people/"), do: "users/" <> name

      for to <- Enum.filter(people, &owns_network?(call, &1)),
          do: Call.tool(call, "notifications", "send", %{"title" => "#{title} #{are} waiting to be let in", "text" => "Open Devices and let #{if length(names) == 1, do: "it", else: "them"} in.", "to" => to, "section" => "devices", "critical" => true})
    end

    Artifact.update(call.own, "told/devices", fn _was -> JSON.encode!(Enum.map(waiting, & &1["device"])) end)
    %{waiting: Enum.map(waiting, & &1["name"]), told: Enum.map(new, & &1["name"])}
  end

  def call("notify", _inputs, _call), do: %{waiting: [], told: []}

  def call("waiting", _inputs, call) do
    %{waiting: if(owns_network?(call, person(call)), do: waiting_devices(), else: [])}
  end

  def call("badge", _inputs, call) do
    %{count: if(owns_network?(call, person(call)), do: length(waiting_devices()), else: 0)}
  end

  # The servers whose key someone was told they're waiting for are kept, so each is told of once while it waits, and again
  # if it waits again after it was handed the key. The network's owners are told of the network's, and a person of their
  # own (a job of theirs that no server can open the key for asks, `Encryption`).
  def call("check", inputs, call) do
    waiting =
      case inputs["waiting"] do
        nil ->
          %{"access" => access} = Call.tool(call, "encryption", "key", %{})
          Enum.uniq(for artifact <- access, server <- artifact["missing"], do: server)

        waiting ->
          waiting
      end

    told = with {:ok, told, _tag} <- Artifact.read(call.own, "told/" <> call.subject), do: JSON.decode!(told), else: (:absent -> [])
    new = Enum.reject(waiting, &(&1["key"] in told))
    named = &Enum.map(&1, fn server -> server["name"] || String.slice(server["key"], 0, 8) end)

    if new != [] do
      {names, are} = {named.(new), if(length(new) == 1, do: "is", else: "are")}

      {title, to} =
        if call.subject == "network" do
          # Its owners among the people it keeps, which it reads as nobody, as the clock runs it: a list of the network's
          # users is only a user's to ask for.
          people = for "people/" <> name <- Artifact.list(call.own, "people/"), do: "users/" <> name
          {"#{Enum.join(names, ", ")} #{are} waiting for the network's key", Enum.filter(people, &owns_network?(call, &1))}
        else
          {"#{Enum.join(names, ", ")} #{are} waiting for your key", [call.subject]}
        end

      for to <- to,
          do: Call.tool(call, "notifications", "send", %{"title" => title, "text" => "Open Sign In & Security and use your passkey.", "to" => to, "section" => "passkeys"})
    end

    # Its record is kept as it changes, in one step: a check that removed it to write it again met another's write as
    # :exists and failed (23 Nov: "no match of right hand side value: :exists", two checks at once, which every server
    # of a network makes at the same 10 minutes).
    Artifact.update(call.own, "told/" <> call.subject, fn _was -> JSON.encode!(Enum.map(waiting, & &1["key"])) end)
    %{waiting: named.(waiting), told: named.(new)}
  end

  # The link makes a passkey of theirs for whoever opens it, so it's shown only on their own screen, which opens it.
  # Anything else that asks, an assistant or `one`, has them notified, and Sign In & Security makes it there.
  def call("add_passkey", _inputs, call) do
    who = person(call)

    if screen?(call) do
      # The device that asks lets the passkey made by its link unlock the key itself, where it holds it (`from`).
      %{link: ask(%{ask: "passkey", who: who, device: device(call)["id"]})["link"]}
    else
      Call.tool(call, "notifications", "send", %{
        "title" => "Add a passkey",
        "text" => "Open Sign In & Security and tap Add Passkey.",
        "to" => who,
        "app" => call.app,
        "section" => "passkeys"
      })

      %{message: "Your person was notified: Sign In & Security, on a device of theirs, makes it. The link is shown only there."}
    end
  end

  def call("devices", _inputs, call), do: devices(person(call))

  def call("encrypt_for_passkeys", %{"passkey" => passkey, "keys" => keys}, call) do
    case JSON.decode(keys) do
      {:ok, %{} = keys} ->
        %{passkeys: ask(%{ask: "encrypt_for_passkeys", who: person(call), passkey: passkey, keys: keys})["passkeys"]}

      _ ->
        raise "That isn't your key encrypted to your passkey. A device that holds it fills it in."
    end
  end

  def call("encrypt_for_passkeys", _inputs, _call),
    do: raise("A device that holds your key encrypts it to a passkey your person allowed: in Sign In & Security there, or with `one` on it.")

  def call("unlock_with_passkey", inputs, _call) do
    device = inputs["device"] || ""
    if not (device =~ ~r/^([0-9a-f]{64})?$/), do: raise("A device is named by its key.")
    scope = if inputs["scope"], do: "&scope=" <> inputs["scope"], else: ""
    %{link: address() <> "/sign-in/#unlock=" <> device <> scope}
  end

  # Whoever may see who's in the network sees who each of them is: a member of it, as the apps that validate
  # `reach` say. Everyone sees who they are themselves.
  def call("people", inputs, call) do
    users = Map.get(inputs, "users", [person(call)])

    if users -- [call.actor] != [] and not Call.member?(call, "network"),
      do: Call.refuse("Only a member of the network sees who's in it.")

    %{people: people(call, users)}
  end

  # Whoever may see who's in the network sees how each is shown, as `people` has it: a member of it, and everyone sees themselves.
  def call("pictures", %{"subjects" => subjects}, call) do
    if subjects -- [call.actor] != [] and not Call.member?(call, "network"), do: Call.refuse("Only a member of the network sees who's in it.")

    in_groups = in_groups(call, Enum.filter(subjects, &String.starts_with?(&1, "groups/")))
    found = kept(call, Enum.uniq(subjects ++ Enum.concat(Map.values(in_groups))))
    members = Map.new(in_groups, fn {group, people} -> {group, people |> Enum.sort_by(&is_nil(found[&1])) |> Enum.take(4)} end)
    shown = Enum.uniq(subjects ++ Enum.concat(Map.values(members)))
    %{pictures: Map.new(shown, &{&1, found[&1] && data_address(elem(found[&1], 1))}), members: members}
  end

  # Anyone sets their own. It was sent to the bucket by itself (an upload), and the edge makes it square and small.
  def call("picture", inputs, call) do
    who = person(call)

    image =
      with upload when is_binary(upload) <- inputs["upload"] do
        case Artifact.read(call.own, upload) do
          {:ok, bytes, _tag} -> Base.encode64(bytes)
          :absent -> raise "Nothing was uploaded as #{upload}: send the picture to the link the upload tool gives (the command's --upload-from does it) and give the name it answers."
        end
      end

    ask(%{ask: "picture", who: who, image: image})
    if inputs["upload"], do: Artifact.remove(call.own, inputs["upload"])
    %{picture: source(kept(call, [who])[who])}
  end

  def call("name", %{"called" => called}, call) do
    %{"called" => called} = ask(%{ask: "called", who: person(call), called: called})
    %{called: called}
  end

  # Anyone changes their own, and the network's owners anyone's. The edge says whether the name is free, as it keeps
  # who had which; a group's or an app's name is taken too, as `alice/notes` names a repo of either. The edge is asked
  # first, everything is moved (`OneCore.Renames.rename/3`), and then the edge renames them, so they sign in as the
  # name everything's under. Once it's moved they're renamed: an app that didn't hear of it is said, not raised, as a
  # call that failed would have its caller change the name again.
  def call("username", %{"username" => username} = inputs, call) do
    me = person(call)
    old = OneCore.User.renamed(inputs["who"] || me)
    new = "users/" <> username

    if old != me and not owns_network?(call, call.actor), do: raise("Only the network's owners change someone else's username.")
    with {:error, why} <- OneCore.User.named(username), do: raise(why)

    unheard =
      if old == new do
        %{}
      else
        Call.stage(call, "Checking that #{username} is free")

        if OneCore.Bucket.folders("groups/#{username}/") != [] or "network/apps/#{username}/" in OneCore.Bucket.folders("network/apps/"),
           do: raise("#{username} is a group's or an app's name, so it isn't anyone's username.")

        ask(%{ask: "rename", who: old, to: username, check: true})
        {:ok, _heard, unheard} = OneCore.Renames.rename(old, new, &Call.stage(call, &1))
        Call.stage(call, "Signing #{new} in under the new name")
        ask(%{ask: "rename", who: old, to: username})
        unheard
      end

    %{who: new, unheard: for({app, why} <- unheard, do: %{app: app, why: "#{why}"})}
  end

  def call("approve", %{"code" => code}, call) do
    %{"approved" => name} = ask(%{ask: "approve", who: person(call), code: code})
    %{approved: name}
  end

  def call("browser", _inputs, call), do: ask(%{ask: "browser", who: person(call)})

  def call("remove_device", %{"device" => device}, call) do
    %{"removed" => name, "device" => key} = ask(%{ask: "remove_device", who: person(call), device: device})
    OneCore.Events.emit(call, "device_removed", %{"device" => key, "who" => person(call)})
    %{removed: name}
  end

  def call("remove_passkey", %{"passkey" => passkey}, call) do
    %{"removed" => name} = ask(%{ask: "remove_passkey", who: person(call), passkey: passkey})
    %{removed: name}
  end

  # Who each of `users` is, as `people` says, from one read of the bucket: each one's record and both their pictures at
  # once, where each record was read after the one before, and Google's pictures after their own (a median 150-220 ms
  # on 27 Nov, for 92 bytes). Their own picture is the one they're shown by, before Google's.
  defp people(call, users) do
    pictures = for user <- users, {source, blob} <- picture_blobs(user), do: {user, source, blob}
    records = Enum.map(users, fn "users/" <> name -> "people/" <> name end)
    {read, pictured} = Enum.split(Artifact.read_all(call.own, records ++ Enum.map(pictures, &elem(&1, 2))), length(users))
    found = for {{user, source, _blob}, {:ok, _picture, _tag}} <- Enum.zip(pictures, pictured), do: {user, source}

    for {user, record} <- Enum.zip(users, read) do
      stored = with {:ok, stored, _tag} <- record, do: JSON.decode!(stored), else: (:absent -> %{})
      picture = Enum.find(["own", "google"], &({user, &1} in found))
      %{"called" => nil, "email" => nil} |> Map.merge(stored) |> Map.put("who", user) |> Map.put("picture", picture)
    end
  end

  # What the network keeps as each subject's picture, as `{source, blob}`, a person's own before Google's, and nil for none: a
  # group has none, and a name that isn't a user's has nothing to read. Google's is read only for whoever has no
  # picture of their own: two reads for each person, where one that set theirs needs one.
  defp kept(call, subjects) do
    wanted = for subject <- subjects, {source, name} <- picture_blobs(subject), do: {subject, source, name}
    {own, google} = Enum.split_with(wanted, &(elem(&1, 1) != "google"))
    found = read(call, own)
    without = google |> Enum.reject(fn {subject, _source, _name} -> Enum.any?(found, &(elem(&1, 0) == subject)) end)
    found = found ++ read(call, without)
    Map.new(subjects, fn subject -> {subject, Enum.find_value(found, fn {^subject, source, blob} -> {source, blob}; _ -> nil end)} end)
  end

  defp read(call, wanted) do
    reads = Artifact.read_all(call.own, Enum.map(wanted, &elem(&1, 2)))
    for {{subject, source, _}, {:ok, blob, _tag}} <- Enum.zip(wanted, reads), do: {subject, source, blob}
  end

  # The people in each of `groups` that you're in too, as Permissions has them: a group in a group, a link to it and
  # everyone have no face of their own.
  defp in_groups(_call, []), do: %{}

  defp in_groups(call, groups) do
    for %{"group" => group, "members" => members} <- Call.tool(call, "permissions", "groups", %{})["groups"], group in groups, into: %{},
        do: {group, members |> Enum.filter(&person?/1) |> Enum.sort()}
  end

  defp person?(subject), do: match?("users/" <> _, subject) and OneCore.User.user(subject) == :ok

  defp picture_blobs("network"), do: [{"network", "pictures/network"}]

  defp picture_blobs("users/" <> name = subject) do
    if person?(subject), do: [{"own", "pictures/#{name}/own"}, {"google", "pictures/#{name}/google"}], else: []
  end

  defp picture_blobs(_subject), do: []

  defp source({source, _blob}) when source in ["own", "google"], do: source
  defp source(_none), do: nil

  defp data_address(blob) do
    %{"type" => type, "data" => data} = JSON.decode!(blob)
    "data:#{type};base64,#{data}"
  end

  @doc """
  What the device whose key is `device` is called where its person let it in, as `devices` lists it for them, or
  `nil` for one that's nobody's. It's for an app that shows a person's device to whoever else may use it, by the name
  its person knows it by, as Computer Use names a phone.

      Call.app(call, "sign-in").device_name(call, device)
  """
  def device_name(_call, device) do
    with "users/" <> _ = who <- OneCore.Hooks.whose(device),
         %{"devices" => devices} <- devices(who),
         do: Enum.find_value(devices, &(&1["id"] == device && &1["name"])),
         else: (_ -> nil)
  end

  # What the edge says a person's devices are, each app under the name it says it has now and the command that ran it:
  # the edge names a device as it signed in, and an app says what it's called, and its command if a terminal ran it,
  # each time it connects.
  defp devices(who) do
    %{"devices" => devices} = list = ask(%{ask: "devices", who: who})
    said = Builds.said(who, for(%{"kind" => "app", "id" => id} <- devices, do: id))
    passkeys = for passkey <- list["passkeys"] || [], do: Map.put(passkey, "code", code(passkey["prf_key"]))
    %{list | "devices" => for(device <- devices, do: Map.merge(device, Map.get(said, device["id"], %{}))), "passkeys" => passkeys}
  end

  # A passkey's key, as its person checks it's the one they used, as Signal's safety numbers are: 20 digits in fours
  # of five from its SHA-256, the same the sign-in page shows (`edge/page/passkey.ts`) and a device holds an Allow to
  # (`apps/encryption/client/native/src/device.rs`).
  defp code(key) when is_binary(key) and key != "" do
    <<number::72, _::binary>> = :crypto.hash(:sha256, "one/passkey/1/code\n" <> key)
    digits = number |> rem(Integer.pow(10, 20)) |> Integer.to_string() |> String.pad_leading(20, "0")
    digits |> String.graphemes() |> Enum.chunk_every(5) |> Enum.map_join(" ", &Enum.join/1)
  end

  defp code(_key), do: nil

  # The devices that show a code now and wait to be let in, newest code each, as the edge says, with where it's approved.
  defp waiting_devices do
    for waiting <- ask(%{ask: "waiting"})["waiting"] do
      waiting |> Map.put("link", address() <> "/sign-in/?user_code=" <> waiting["code"]) |> Map.delete("code")
    end
  end

  # Whether `who` owns the network, as the apps that validate `reach` say.
  defp owns_network?(call, who) do
    request = %{"who" => who, "relation" => "owner", "artifact" => "network"}
    OneCore.Hooks.validate("reach", request, {call.actor, call.subject}) == :ok
  end

  @doc """
  The device a call came from, as `devices` lists its person's (`kind` app, assistant or browser), or `nil` for one
  that's none of theirs, as a sharing link's holder or a scheduled job. What comes over the web is the device the
  edge proved: an app by its signature, an assistant by its token, and a browser by its session, which the edge names
  by a hash of it (`edge/auth.ts`). An app has what it said when it last connected too (`name`, `command` and
  `target`, `Builds.said/2`).

      Call.app(call, "sign-in").device(call)
  """
  def device(call) do
    with %{"device" => device} when is_binary(device) <- Call.client(call),
         "users/" <> _ = who <- call.actor do
      %{"devices" => devices} = ask(%{ask: "devices", who: who})

      case Enum.find(devices, &(&1["id"] == device or (&1["kind"] == "browser" and browser(&1["id"]) == device))) do
        %{"kind" => "app"} = found -> Map.merge(found, Map.get(Builds.said(who, [device]), device, %{}))
        found -> found
      end
    else
      _ -> nil
    end
  end

  @doc """
  Whether a call comes from its person's own screen, where they see what they're doing: the One App (`one-app`) on a
  device of theirs, or the web client (`one-web`) in a browser they signed in. A client's name is only what it says
  (`Call.client/1`), so it counts only on the kind of device it names, as that's proved: a browser by its session
  and an app by its key, over its own connection or the web. An assistant or a sharing link's holder is neither,
  whatever it says. What runs on a device with its key, as `one` does, could say it's the app, and holds what the
  device does already; `one mcp` says an agent's MCP client is never one of these (`clients/cli/src/mcp.rs`).

      Call.app(call, "sign-in").screen?(call)
  """
  def screen?(call) do
    case Call.client(call) do
      %{"web" => false, "name" => "one-app"} ->
        true

      %{"web" => true, "name" => name} when name in ["one-app", "one-web"] ->
        case device(call) do
          %{"kind" => "app"} -> name == "one-app"
          %{"kind" => "browser"} -> name == "one-web"
          _ -> false
        end

      _ ->
        false
    end
  end

  # The device a browser's session is, as the edge names it (`browserDevice`, `edge/auth.ts`).
  defp browser(session) when is_binary(session),
    do: Base.encode16(:crypto.hash(:sha256, "browser\n" <> session), case: :lower)

  defp browser(_session), do: nil

  defp joins(name, link), do: "users/#{name} joins at #{link} within a week. It's shown once, so pass it on now."

  # Devices are a person's, whoever a call runs for.
  # What the network has of a person: the name they go by and their email, `nil` for what it hasn't.
  defp stored(call, "users/" <> name) do
    case Artifact.read(call.own, "people/" <> name) do
      {:ok, stored, _tag} -> Map.merge(%{"called" => nil, "email" => nil}, JSON.decode!(stored))
      :absent -> %{"called" => nil, "email" => nil}
    end
  end

  # How the network's first owner is named where it says who runs it: the name they go by, or the one they're
  # `users/<name>` by, markdown's special characters escaped, since it's written into words that are.
  defp owner_name(call) do
    with "users/" <> name = owner <- OneCore.User.first_owner() do
      (stored(call, owner)["called"] || name) |> String.replace(~r/[\\`*_{}\[\]()#+\-.!<>|~&]/, "\\\\\\0")
    else
      _ -> "the network's owner"
    end
  end

  # The network's name, icon and logo, and its own apps, as the edge keeps them, with `given` set first.
  defp network(given), do: Map.take(ask(Map.put(given, :ask, "network")), ["name", "icon", "logo", "mark", "android_package", "apple_app"])

  defp person(%Call{actor: "users/" <> _ = by}), do: by
  defp person(_call), do: raise("This is a person's to ask, and nobody is asking.")

  # Asks this app's edge function, as this server: it answers only the network's own.
  defp address do
    Application.get_env(:one_core, :address) ||
      raise "People sign in at a network's address, and this network has none."
  end

  # What's asked that changes something once isn't sent again if its connection is closed partway
  # (`OneCore.Edge.send!/1`): a code approved twice is refused the second time, a device or passkey removed twice
  # isn't there to remove, and an invitation or a passkey's link asked for twice is made twice.
  @once ~w(approve remove_device remove_passkey remove_person invite owner passkey)

  defp ask(what) do
    # A network being built acts as whoever a client says, who joined nowhere, so the edge makes them as it's asked.
    body = JSON.encode!(Map.put(what, :building, Application.get_env(:one_core, :development, false)))

    # Signed as every ask of the edge is, so one refused for this server's clock is signed again by the edge's.
    case Edge.ask!([method: :post, url: address() <> "/sign-in/ask", body: body, retry: false, resend: what.ask not in @once], "/sign-in/ask") do
      %{status: 200, body: %{"error" => why}} -> raise why
      %{status: 200, body: response} -> response
      %{status: status} -> raise "The network's edge answered #{status}"
    end
  end
end
