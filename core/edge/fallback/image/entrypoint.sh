#!/bin/bash
# The fallback server's one process: the network's server, as `one serve run` runs it, which its Durable Object starts
# again where it ends (`../worker.ts`). Its disk is the image's again at each start, so it downloads the core's latest
# `one` each time. It's handed what makes it the same server as before, once it has joined (`ONE_IDENTITY`, its keys and
# record, a gzipped tar in base64), which nothing it runs is given; `serve run` then takes the latest server build. The
# first time, with none, it joins the network as any server whose owner adds it does (`one serve on`): it says the link
# and code to approve it at, in its log and in `/data/joining`, which its Durable Object reads.
set -euo pipefail
: "${ONE_ADDRESS:?the network address, https://<host>}"
RELEASES=https://github.com/ptc-au/the-one-app/releases/download/builds
mkdir -p "$ONE_HOME" "$(dirname "$ONE_PROGRAM")"
curl -fsSL "$RELEASES/linux-x86_64.json" | jq -r '."one-cli".link.url' | xargs curl -fsSL | gunzip >"$ONE_PROGRAM"
chmod +x "$ONE_PROGRAM"
if [ -n "${ONE_IDENTITY:-}" ]; then
  (umask 077 && base64 -d <<<"$ONE_IDENTITY" | tar xz -C "$ONE_HOME")
fi
unset ONE_IDENTITY
if [ ! -e "$ONE_HOME/server/state.json" ]; then
  printf '{"address":"%s"}' "$ONE_ADDRESS" >"$ONE_HOME/network"
  "$ONE_PROGRAM" serve on 2>&1 | tee /data/joining
fi
exec "$ONE_PROGRAM" serve run
