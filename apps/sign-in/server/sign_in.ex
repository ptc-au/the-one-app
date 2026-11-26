defmodule SignIn do
  @moduledoc """
  Signing in: whose each device is. People sign in at the network's address, where this app's edge function
  (`edge/`) keeps their passkeys and what they let act as them. Whose each device is, the server keeps a copy of
  in its database, which it copies from the edge (`copy`) as a device it doesn't know asks, and as the edge has it do
  once one is removed, and every ten minutes. One Core asks whose a device is, the `device` hook, and it's answered from
  that copy, so a call asks nothing of the edge or the bucket but what the database does. What each person goes by
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

  # One Core asks it whose a device is, and every client signs in through it.
  @impl true
  def icon, do: "client/security.svg"

  @impl true
  def requires, do: %{"core" => ">= 0.37.0", "database" => "to keep a copy of whose each device is"}

  # Whose each device is, as the edge last said, and which version of that it was (`changed` in `edge/auth.ts`).
  @schema [
    "create table devices (device text primary key, who text not null)",
    "create table copied (version integer not null)"
  ]

  # Nothing looks into it as it runs (`server-debug`): what it's given and keeps are what people sign in with.
  @impl true
  def sensitive, do: true

  require Logger
  alias OneCore.{Artifact, Builds, Call, Edge}

  @impl true
  def tools do
    none = %{type: "object", properties: %{}}
    picture_source = %{type: ["string", "null"], enum: ["own", "google", nil], description: "Whose picture they're shown by: the one they set, Google's, or none (initials)"}

    [
      %{
        name: "invite",
        ui: "client/forms.html",
        runtime_version: 4,
        description: """
        Makes a link someone joins the network by, as the user you name. It ends the one made for them before. Only the
        network's owner invites someone who has joined again, and never an owner
        """,
        inputs: %{
          type: "object",
          properties: %{name: %{type: "string", description: "Their username: lowercase letters, digits, dots and hyphens, as their email's name before the @"}},
          required: ["name"]
        },
        outputs: %{
          type: "object",
          properties: %{
            who: %{type: "string", description: "users/<name>"},
            link: %{type: "string", description: "Where they join, within a week. It's shown once, so pass it on now"}
          },
          required: ["who", "link"]
        }
      },
      %{
        name: "everyone",
        read_only: true,
        description:
          "Lists everyone in the network and everyone invited to it: the name each goes by, and whether they've joined",
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
            }
          },
          required: ["people"]
        }
      },
      %{
        name: "domains",
        description: """
        Says which Google Workspace domains' people join the network by signing in with Google, with no invitation,
        or, given `domains`, makes those the ones. Google signs people in only where the network's edge has a Google
        client. Everyone else joins by an invitation
        """,
        inputs: %{
          type: "object",
          properties: %{
            domains: %{type: "array", items: %{type: "string"}, description: "Its domains, like example.org: none lets nobody in this way"}
          }
        },
        outputs: %{type: "object", properties: %{domains: %{type: "array", items: %{type: "string"}}}, required: ["domains"]}
      },
      %{
        name: "network",
        description: """
        Says the network's name, icon and logo, as its sign-in page and its web app show them and as its own apps are
        finished with, and its own iPhone app's ID and Android app's package name, which its passkeys and links are
        trusted to, or, given `name`, `icon`, `logo`, `apple_app` or `android_package`, makes them those. Its icon is on a tile of its own, as a Home
        Screen, a tab and its apps show it; its logo is its mark alone, as its sign-in page draws it, one for a light
        page and one for a dark (either alone shows on both). Without them, it's the One App's
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
        outputs: %{
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
        name: "check",
        description: """
        Notifies the network's owners once when a server starts waiting for the network's key, which their passkey
        hands it in Sign In & Security, as the encryption app's `check` has it do every 10 minutes. Says which servers
        are waiting, and which it told them of just now
        """,
        inputs: none,
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
        name: "copy",
        by_link: true,
        description: """
        Copies whose each device is from the network's edge, which keeps it, as the edge has a server do once one is
        removed, and every ten minutes. Anyone may ask: it only reads what the edge says
        """,
        inputs: none,
        outputs: %{
          type: "object",
          properties: %{devices: %{type: "integer", description: "How many devices are someone's"}},
          required: ["devices"]
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
        description: """
        Changes your username, which your addresses are under (`users/<username>`, `/git-repos/<username>/notes`), or
        with `who`, someone else's, which only the network's owners do. Everything of theirs moves with it, and their
        old addresses, sharing links, webhooks and git remotes lead to the new one, as GitHub's old usernames do: nobody
        else is given an old one. People see each other by name and email, so change it only when asked
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
          properties: %{who: %{type: "string", description: "Who they are now: users/<username>"}},
          required: ["who"]
        }
      },
      %{
        name: "approve",
        description: "Approves a device as yours by the code it shows, which your person passed on from it",
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
            "as the `device` hook knows it, and `who` it was, users/<name>. An app that keeps anything for the " <>
            "device, as where its push service reaches it, forgets it: it's nobody's from then on."
      }
    ]
  end

  @impl true
  def hooks, do: ["device", "owner", "renamed", "settings.sections", "privacy.sections"]

  @impl true
  # A device the copy doesn't have is copied again first, as a device that was just let in asks. One the edge doesn't
  # know either is nobody's. A copy that couldn't be read raises: that's not knowing, not nobody's.
  def hook("device", %{"device" => device}, call) do
    with true <- device =~ ~r/^[0-9a-f]{64}$/,
         who when is_binary(who) <- whose(call, device) || (copy(call) && whose(call, device)) do
      %{"who" => who}
    else
      _nobody -> %{}
    end
  end

  # Someone renamed: their devices are theirs by their new name, as are the name they go by and their pictures.
  def hook("renamed", %{"who" => "users/" <> old = who, "to" => "users/" <> new = to}, call) do
    transaction(call, fn {database, db} -> database.query(db, "update devices set who = ? where who = ?", [to, who]) end)

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
    people = %{in: "settings", name: "People & Groups", component: "people", icon: "client/users.svg", group: "network", order: 2}

    [
      %{in: "settings", name: "Sign In & Security", component: "passkeys", icon: "client/security.svg", group: "you", order: 0},
      %{in: "settings", name: "Devices", component: "devices", icon: "client/icon.svg", group: "network", order: 1},
      %{in: "settings", name: "AI", component: "ai", icon: "client/connect.svg", group: "general", order: 3}
    ] ++ if(Call.owns?(%{call | subject: "network"}), do: [people], else: [])
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
  # an editor of it. Whoever joins by an invitation is that user, so someone who has joined is invited again only by
  # the network's owner, and an owner never: they add a passkey on a device they're signed in on, as Apple and
  # Google have it. The edge knows who has joined, and is told whether this may be that (`again`). A name someone was
  # taken out of while what they made is kept is theirs still, since all of it is reached by that name, so nobody
  # else is invited by it, as GitHub retires the name of an account that still has repos.
  def call("invite", %{"name" => name}, call) do
    Call.reach(call, Artifact.name(call.own), "editor")
    who = "users/#{name}"

    if not Enum.any?(ask(%{ask: "everyone"})["people"], &(&1["who"] == who)) and OneCore.Bucket.list(who <> "/") != [],
      do: raise("#{who} was taken out of the network, and what they made is kept under that name, so nobody else is given it. Invite them by another name.")

    again = owns_network?(call, call.actor) and not owns_network?(call, who)
    %{"link" => link} = ask(%{ask: "invite", who: name, again: again})
    %{who: "users/#{name}", link: link}
  end

  def call("everyone", _inputs, call) do
    if not Call.member?(call, "network"), do: raise("Only a member of the network sees who's in it.")
    first = OneCore.User.first_owner()
    people = ask(%{ask: "everyone"})["people"]
    pictures = kept(call, Enum.map(people, & &1["who"]))
    %{people: for(person <- people, do: person |> Map.put("first_owner", person["who"] == first) |> Map.put("picture", source(pictures[person["who"]])))}
  end

  # Whoever invites says who joins with no invitation, and any member sees it.
  def call("domains", %{"domains" => domains}, call) do
    Call.reach(call, Artifact.name(call.own), "editor")
    %{domains: ask(%{ask: "domains", domains: domains})["domains"]}
  end

  def call("domains", _inputs, call) do
    if not Call.member?(call, "network"), do: raise("Only a member of the network sees who joins it.")
    %{domains: ask(%{ask: "domains"})["domains"]}
  end

  # Whoever invites names the network, and any member sees what it's called.
  def call("network", inputs, call) do
    given = Map.take(inputs, ["name", "icon", "logo", "android_package", "apple_app"])

    if given == %{} do
      if not Call.member?(call, "network"), do: raise("Only a member of the network sees what it's called.")
    else
      Call.reach(call, Artifact.name(call.own), "editor")
    end

    Map.take(ask(Map.put(given, :ask, "network")), ["name", "icon", "logo", "mark", "android_package", "apple_app"])
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

  # The servers the network's owners were told are waiting are kept, so each is told of once while it waits, and again
  # if it waits again after it was handed the key.
  def call("check", _inputs, call) do
    %{"access" => access} = Call.tool(call, "encryption", "key", %{})
    waiting = Enum.uniq(for artifact <- access, server <- artifact["missing"], do: server)
    told = with {:ok, told, _tag} <- Artifact.read(call.own, "told/network"), do: JSON.decode!(told), else: (:absent -> [])
    new = Enum.reject(waiting, &(&1["key"] in told))
    named = &Enum.map(&1, fn server -> server["name"] || String.slice(server["key"], 0, 8) end)

    if new != [] do
      {names, are} = {named.(new), if(length(new) == 1, do: "is", else: "are")}
      title = "#{Enum.join(names, ", ")} #{are} waiting for the network's key"
      # Its owners among the people it keeps, which it reads as nobody, as the clock runs it: a list of the network's
      # users is only a user's to ask for.
      people = for "people/" <> name <- Artifact.list(call.own, "people/"), do: "users/" <> name
      owners = Enum.filter(people, &owns_network?(call, &1))

      for owner <- owners,
          do: Call.tool(call, "notifications", "send", %{"title" => title, "text" => "Open Sign In & Security and use your passkey.", "to" => owner, "section" => "passkeys"})
    end

    # Its record is kept as it changes, in one step: a check that removed it to write it again met another's write as
    # :exists and failed (23 Nov: "no match of right hand side value: :exists", two checks at once, which every server
    # of a network makes at the same 10 minutes).
    Artifact.update(call.own, "told/network", fn _was -> JSON.encode!(Enum.map(waiting, & &1["key"])) end)
    %{waiting: named.(waiting), told: named.(new)}
  end

  def call("copy", _inputs, call), do: %{devices: copy(call)}

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
      do: raise("Only a member of the network sees who's in it.")

    pictures = kept(call, users)
    people = for user <- users, do: stored(call, user) |> Map.put("who", user) |> Map.put("picture", source(pictures[user]))

    %{people: people}
  end

  # Whoever may see who's in the network sees how each is shown, as `people` has it: a member of it, and everyone sees themselves.
  def call("pictures", %{"subjects" => subjects}, call) do
    if subjects -- [call.actor] != [] and not Call.member?(call, "network"), do: raise("Only a member of the network sees who's in it.")

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
  # first, everything is moved (`OneCore.Renames.rename/2`), and then the edge renames them, so they sign in as the
  # name everything's under.
  def call("username", %{"username" => username} = inputs, call) do
    me = person(call)
    old = OneCore.User.renamed(inputs["who"] || me)
    new = "users/" <> username

    if old != me and not owns_network?(call, call.actor), do: raise("Only the network's owners change someone else's username.")
    with {:error, why} <- OneCore.User.named(username), do: raise(why)

    if old != new do
      if OneCore.Bucket.folders("groups/#{username}/") != [] or "network/apps/#{username}/" in OneCore.Bucket.folders("network/apps/"),
         do: raise("#{username} is a group's or an app's name, so it isn't anyone's username.")

      ask(%{ask: "rename", who: old, to: username, check: true})
      {:ok, _heard, unheard} = OneCore.Renames.rename(old, new)
      ask(%{ask: "rename", who: old, to: username})
      copy(call)

      if unheard != %{},
        do: raise("#{old} is #{new} now, but these didn't hear it: #{Enum.map_join(unheard, ", ", fn {app, why} -> "#{app} (#{why})" end)}.")
    end

    %{who: new}
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

  defp whose(call, device) do
    transaction(call, fn {database, db} ->
      with [%{"who" => who}] <- database.query(db, "select who from devices where device = ?", [device]), do: who, else: (_ -> nil)
    end)
  end

  # Copies what the edge says, unless the copy is of the same or a newer version, as a copy asked for before another
  # that wrote first is. It gives how many devices are someone's.
  defp copy(call) do
    %{"version" => version, "devices" => devices} = ask(%{ask: "whose"})

    transaction(call, fn {database, db} ->
      case database.query(db, "select version from copied") do
        [%{"version" => copied}] when copied >= version ->
          :ok

        _older ->
          database.query(db, "delete from devices")
          database.query(db, "insert into devices (device, who) select key, value from json_each(?)", [JSON.encode!(devices)])
          database.query(db, "delete from copied")
          database.query(db, "insert into copied (version) values (?)", [version])
      end
    end)

    map_size(devices)
  end

  # The database module goes with the database it opened.
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

  defp transaction(call, fun) do
    database = Call.app(call, "database")
    database.transaction(call, @schema, &fun.({database, &1}))
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
