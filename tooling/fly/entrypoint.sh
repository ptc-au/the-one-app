#!/bin/sh
# The Fly Machine's one process: the network's server, as `one serve run` runs it, which Fly starts again whenever it
# ends. A machine's root filesystem is the image's again at each start, so everything that lasts, `one` too, is on
# the volume at /data. The first start joins the network as any server does (`one serve on`): the machine asks to be
# let in and says the code it's shown in its log (`fly logs`), which one of the network's owners approves from their
# own device (`one sign-in approve --code <code>`), and then it downloads the server's build and starts it. Every
# start after goes straight to `one serve run`, which takes the network's updates itself.
set -eu
: "${ONE_ADDRESS:?the network address, https://<host>}"
RELEASES=https://github.com/ptc-au/the-one-app/releases/download/builds
mkdir -p "$ONE_HOME" "$(dirname "$ONE_PROGRAM")"
if [ ! -x "$ONE_PROGRAM" ]; then
  curl -fsSL "$RELEASES/linux-x86_64.json" | jq -r '."one-cli".link.url' | xargs curl -fsSL | gunzip >"$ONE_PROGRAM.new"
  chmod +x "$ONE_PROGRAM.new" && mv "$ONE_PROGRAM.new" "$ONE_PROGRAM"
fi
[ -e "$ONE_HOME/network" ] || printf '{"address":"%s"}' "$ONE_ADDRESS" >"$ONE_HOME/network"
[ -e "$ONE_HOME/server/state.json" ] || "$ONE_PROGRAM" serve on
exec "$ONE_PROGRAM" serve run
