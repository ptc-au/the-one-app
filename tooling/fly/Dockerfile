# What a One App server runs in on a Fly Machine. It holds no build of the One App: the entrypoint puts `one` on the
# machine's volume, and from then on the network's own update takes the server and `one` to each new build, as any
# server takes them, so a release never rebuilds this. Ubuntu 24.04 has the glibc (2.35 or newer) and OpenSSL 3 the
# server's builds need. What a server runs beside One Core is only what's on it: Git for apps from git, bubblewrap
# and prlimit for untrusted apps (`apps/sandbox`), and, with --build-arg CONTAINERS=1, Podman for Containers and Chrome
# (`apps/containers`), which its services find as they do on any machine.
FROM ubuntu:24.04
ARG CONTAINERS=
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq git bubblewrap util-linux tzdata \
 && if [ -n "$CONTAINERS" ]; then apt-get install -y --no-install-recommends podman uidmap fuse-overlayfs passt netavark aardvark-dns crun; fi \
 && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
