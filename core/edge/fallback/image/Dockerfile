# What the network's fallback server runs in (`../worker.ts`), a Cloudflare Container. It holds no build of the One App:
# the entrypoint downloads the core's latest `one` as it starts, which takes the latest server build, and from then on
# the network's own update takes both to each new build, as any server's, so a release never rebuilds this. Ubuntu
# 24.04 has the glibc (2.35 or newer) and OpenSSL 3 the server's builds need. What a server runs beside One Core is
# only what's on it: Git for apps from git, and bubblewrap and prlimit for untrusted apps (`apps/sandbox`).
FROM ubuntu:24.04
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq git bubblewrap util-linux tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV ONE_HOME=/data/home ONE_PROGRAM=/data/bin/one ONE_SUBJECT=network
COPY --chmod=755 entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
