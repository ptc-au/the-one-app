defmodule WebRTC do
  @moduledoc """
  WebRTC: what an app needs to stream something to a person's app as live video, a screen most of all. It hands
  out ICE servers for one stream: TURN credentials of Cloudflare Realtime's, made with the TURN key in the Vault of
  whoever this is installed for (`Cloudflare TURN`, its `key_id` and `api_token`), which no code here ever holds.

  A stream's two ends reach each other only through TURN (`iceTransportPolicy: "relay"`), so neither learns the
  other's addresses, and every network can reach Cloudflare's. Signalling is the streaming app's own: its tool
  takes the app's SDP offer, whole, with its candidates, and answers with its end's SDP answer, as WHEP does, so a
  stream is two tool calls (`ice_servers`, then the offer) and needs nothing pushed.

  It drives Cloudflare Realtime's SFU too, with the SFU key in the same Vault (`Cloudflare SFU`, its `app_id` and
  `app_token`): a session, its tracks, renegotiation and closing, for a stream the SFU carries. The app's code
  drives it session by session, with the SDP offers and answers its own end makes, as Cloudflare's client does.

  The sender is this app's program, `server/bin/stream/`, one for every kind of screen: `sender` gives where each
  kind of machine's build is published, which the streaming app's code on that machine downloads once, checks and
  runs. Its `src/main.rs` says what it takes.

  Only an app gets them: it's the app that knows who may see what it streams.
  """
  @behaviour OneCore.App
  alias OneCore.Call

  @item "Cloudflare TURN"
  @sfu "Cloudflare SFU"
  # How long a stream's credentials last. A stream that outlives them loses its relay, and its app connects again.
  @ttl 4 * 3600

  @impl true
  def icon, do: "icon.svg"

  # It keeps nothing of anyone's and uses the Vault of whoever it's installed for, whose servers alone hold that key: so
  # it runs on theirs, for whoever asks, as the network's own apps do.
  @impl true
  def own, do: :installed

  @impl true
  def requires, do: %{"core" => ">= 0.22.18", "vault" => "to use your Cloudflare TURN and SFU keys"}

  @impl true
  def tools do
    session = %{type: "string", description: "The session's id, as `sfu_session` answered"}

    offer = %{
      type: "object",
      description: "The SDP offer the app's end makes",
      properties: %{type: %{type: "string", enum: ["offer"]}, sdp: %{type: "string"}},
      required: ["type", "sdp"]
    }

    answer = %{
      type: "object",
      description: "The SDP answer the app's end makes to the SFU's offer",
      properties: %{type: %{type: "string", enum: ["answer"]}, sdp: %{type: "string"}},
      required: ["type", "sdp"]
    }

    reply = %{
      type: ["object", "null"],
      description: "Cloudflare's SDP, where it sent one: an answer to apply, or an offer to answer",
      properties: %{type: %{type: "string", enum: ~w(answer offer)}, sdp: %{type: "string"}}
    }

    track = %{
      type: "object",
      description:
        "A track to add: this end's (`location: local`, by `mid`) or another session's (`location: remote`, by `sessionId` and `trackName`)",
      properties: %{
        location: %{type: "string", enum: ~w(local remote)},
        mid: %{type: "string", description: "Its transceiver's mid, or #<trackName> for an existing one"},
        trackName: %{type: "string"},
        sessionId: %{type: "string", description: "The session that publishes it, for a remote track"}
      }
    }

    closing = %{
      type: "object",
      description: "A track to close, by the mid of its transceiver on this session",
      properties: %{mid: %{type: "string"}},
      required: ["mid"]
    }

    [
      %{
        name: "ice_servers",
        description:
          "For an app's code that streams to a person's app over WebRTC: ICE servers for one stream, TURN only, as RTCPeerConnection takes them (`iceServers`), good for #{div(@ttl, 3600)} hours. Both ends take them, with iceTransportPolicy relay. Not for a person or an agent.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          properties: %{
            iceServers: %{
              type: "array",
              description: "As RTCPeerConnection takes them",
              items: %{
                type: "object",
                properties: %{
                  urls: %{type: "array", items: %{type: "string"}},
                  username: %{type: "string"},
                  credential: %{type: "string"}
                },
                required: ["urls"]
              }
            }
          },
          required: ["iceServers"]
        }
      },
      %{
        name: "sender",
        description:
          "For an app's code that streams to a person's app over WebRTC: the program that sends a screen, `stream <file>`, built for each kind of machine (linux-x86_64, linux-aarch64, macos-aarch64, windows-x86_64), as its `url` and `sha256`. The app's code on that machine downloads it once, checks it, and runs it with the viewer's offer, the ICE servers and its screen's source. Not for a person or an agent.",
        inputs: %{type: "object", properties: %{}},
        outputs: %{
          type: "object",
          description: "By kind of machine",
          additionalProperties: %{
            type: "object",
            properties: %{url: %{type: "string"}, sha256: %{type: "string"}},
            required: ["url", "sha256"]
          }
        }
      },
      %{
        name: "sfu_session",
        description:
          "For an app's code that streams over WebRTC through Cloudflare Realtime's SFU: a new session, with the SDP offer its end makes where it has one, as `sessionId` and Cloudflare's SDP. The app's code drives the session with the other SFU tools. Not for a person or an agent.",
        inputs: %{type: "object", properties: %{sessionDescription: offer}},
        outputs: %{
          type: "object",
          properties: %{
            sessionId: %{type: "string", description: "The session's id"},
            sessionDescription: reply
          },
          required: ["sessionId"]
        }
      },
      %{
        name: "sfu_tracks",
        description:
          "For an app's code using a Cloudflare Realtime SFU session: tracks added to it, each this end's (`location: local`) or another session's (`location: remote`), with the SDP offer its end makes where it has one. As Cloudflare answers: whether the app must renegotiate now, Cloudflare's SDP (an offer to answer with `sfu_renegotiate` when it must), and the tracks. Not for a person or an agent.",
        inputs: %{
          type: "object",
          properties: %{
            sessionId: session,
            tracks: %{type: "array", items: track, description: "The tracks to add"},
            sessionDescription: offer
          },
          required: ["sessionId", "tracks"]
        },
        outputs: %{
          type: "object",
          properties: %{
            requiresImmediateRenegotiation: %{
              type: "boolean",
              description: "Whether the app renegotiates now, with `sfu_renegotiate`"
            },
            sessionDescription: reply,
            tracks: %{
              type: "array",
              items: %{type: "object"},
              description: "As Cloudflare answered, with an `errorCode` on any it couldn't add"
            }
          }
        }
      },
      %{
        name: "sfu_renegotiate",
        description:
          "For an app's code using a Cloudflare Realtime SFU session: the answer its end makes to the SFU's offer, when `sfu_tracks` says it must renegotiate now, as Cloudflare answers. Not for a person or an agent.",
        inputs: %{
          type: "object",
          properties: %{sessionId: session, sessionDescription: answer},
          required: ["sessionId", "sessionDescription"]
        },
        outputs: %{type: "object", description: "As Cloudflare answered"}
      },
      %{
        name: "sfu_close",
        description:
          "For an app's code using a Cloudflare Realtime SFU session: tracks closed, each by its `mid`, with the SDP offer its end makes where it has one, and `force` to close them without an SDP exchange. As Cloudflare answers. Not for a person or an agent.",
        inputs: %{
          type: "object",
          properties: %{
            sessionId: session,
            tracks: %{type: "array", items: closing, description: "The tracks to close"},
            sessionDescription: offer,
            force: %{type: "boolean", description: "Close without an SDP exchange"}
          },
          required: ["sessionId", "tracks"]
        },
        outputs: %{type: "object", description: "As Cloudflare answered"}
      }
    ]
  end

  @impl true
  def call(tool, _inputs, %Call{caller: nil})
      when tool in ~w(ice_servers sender sfu_session sfu_tracks sfu_renegotiate sfu_close),
      do: raise("WebRTC's #{tool} is for an app's code, which knows who may see what it streams")

  # As published (`server/checksums.json`), each build named by its path.
  def call("sender", _inputs, _call) do
    for {"server/bin/stream/" <> kind, build} <- JSON.decode!(OneCore.App.file(__MODULE__, "server/checksums.json")),
        into: %{},
        do: {kind, Map.take(build, ["url", "sha256"])}
  end

  def call("ice_servers", _inputs, call) do
    # The key is whoever this is installed for's, the network's most often, which every member uses.
    call = %{call | subject: call.installed}
    needed!(call, @item)

    request = %{
      "item" => @item,
      "method" => "POST",
      "url" => "https://rtc.live.cloudflare.com/v1/turn/keys/{{key_id}}/credentials/generate-ice-servers",
      "headers" => %{"authorization" => "Bearer {{api_token}}", "content-type" => "application/json"},
      "body" => JSON.encode!(%{ttl: @ttl})
    }

    case vault(call, "fetch", request, @item <> " key") do
      %{"status" => 201, "body" => body} -> %{"iceServers" => turn(JSON.decode!(body)["iceServers"])}
      %{"status" => status, "body" => body} -> raise "Cloudflare refused the network's TURN key (#{status}), so live video can't connect.\n\n#{body}"
    end
  end

  def call("sfu_session", inputs, call),
    do: sfu(call, "POST", "/sessions/new", sent(inputs, ~w(sessionDescription)), "new session")

  def call("sfu_tracks", inputs, call) do
    session = session!(inputs["sessionId"])

    sfu(call, "POST", "/sessions/#{session}/tracks/new", sent(inputs, ~w(tracks sessionDescription)), "new tracks")
  end

  def call("sfu_renegotiate", inputs, call) do
    session = session!(inputs["sessionId"])

    sfu(call, "PUT", "/sessions/#{session}/renegotiate", sent(inputs, ~w(sessionDescription)), "renegotiation")
  end

  def call("sfu_close", inputs, call) do
    session = session!(inputs["sessionId"])

    sfu(
      call,
      "PUT",
      "/sessions/#{session}/tracks/close",
      sent(inputs, ~w(tracks sessionDescription force)),
      "closing tracks"
    )
  end

  # Cloudflare Realtime's SFU, which a stream's app drives session by session: the same Vault, its own key.
  defp sfu(call, method, path, body, what) do
    call = %{call | subject: call.installed}
    needed!(call, @sfu)

    request = %{
      "item" => @sfu,
      "method" => method,
      "url" => "https://rtc.live.cloudflare.com/v1/apps/{{app_id}}" <> path,
      "headers" => %{"authorization" => "Bearer {{app_token}}", "content-type" => "application/json"},
      "body" => JSON.encode!(body)
    }

    case vault(call, "fetch", request, @sfu <> " key") do
      %{"status" => status, "body" => body} when status in 200..299 ->
        answered(body)

      %{"status" => status, "body" => body} ->
        raise "Cloudflare refused the SFU's #{what} (#{status}), so live video can't connect.\n\n#{body}"
    end
  end

  # What a tool sends: the fields it was given, the ones left out left out.
  defp sent(inputs, fields) do
    inputs |> Map.take(fields) |> Map.reject(fn {_field, value} -> is_nil(value) end)
  end

  # A session's id goes in a URL, so only what an id is.
  defp session!(session) do
    if is_binary(session) and session =~ ~r/\A[A-Za-z0-9_-]+\z/,
      do: session,
      else: raise("An SFU session's id is letters, digits, dashes and underscores, as `sfu_session` answered.")
  end

  defp answered(""), do: %{}
  defp answered(body), do: JSON.decode!(body)

  # Without it there's nothing to ask Cloudflare, and what a person reads says who can add it.
  defp needed!(call, item) do
    if not Enum.any?(vault(call, "items", %{}, item <> " key")["items"], &(&1["name"] == item)),
      do: raise("Live video needs a #{item} key, which the network's owners add in the Vault and switch on for WebRTC.")
  end

  # A tool's error is what a person reads first, its first paragraph, and the rest is for support (`ui`'s `Problem`).
  defp vault(call, tool, inputs, what) do
    Call.tool(call, "vault", tool, inputs)
  rescue
    error in RuntimeError ->
      reraise "Live video can't use the network's #{what}, which its owners can check in the Vault.\n\n#{error.message}",
              __STACKTRACE__
  end

  # TURN over UDP, over TCP, and over TLS on 443 where only that gets out: each a way to the same relay, which an end
  # gathers through before it answers. The others' ports, and STUN, which is no use to a relay, are left out.
  defp turn(servers) do
    for server <- servers,
        urls = Enum.filter(List.wrap(server["urls"]), &(&1 =~ ~r/^turn:.*:3478\?transport=(udp|tcp)$|^turns:.*:443\?transport=tcp$/)),
        urls != [],
        do: Map.put(server, "urls", urls)
  end
end
