// What the core has released, which every network takes (`OneCore.Builds`): its release's list for each kind of
// machine, `builds` on GitHub, as `tooling/release` keeps it. The edge reads them every few minutes (`wrangler.jsonc`'s
// cron) and tells the network's updater, through the relay, as a build published to the network told it before, so a
// release reaches every network without naming any. Only a newer build moves the updater, so telling it again is
// nothing.
import { relay } from "../relay/common.ts";

const RELEASES = "https://github.com/ptc-au/the-one-app/releases/download/builds";
/** The kinds of machine the core makes builds for, as `OneCore.Builds` names them. */
const TARGETS = ["linux-x86_64", "linux-aarch64", "macos-aarch64", "windows-x86_64"];

/** A build of a list, as `tooling/release` writes it: `serving` is the build that first had what a server runs of a `one`. */
interface Listed {
  build: string;
  serving?: string;
}

/** The count of commits in a build's metadata, which only grows on main: `0.32.198+4449.03d2afd33ea1` is 4449. */
const count = (build: string) => Number(build.split("+")[1]?.split(".")[0] ?? 0);

/**
 * Tells the network's updater the newest build of each name, `latest`, and the pair a server takes, `serving`: the
 * server build and each `one` that runs one, by the build that first ran a server as it runs it, so one that changed
 * only the app around `one serve run` restarts no server (`OneCore.Builds`). `published` is the newest of those.
 */
export async function followCore(env: Env) {
  const lists = await Promise.all(
    TARGETS.map(async (target) => {
      const response = await fetch(`${RELEASES}/${target}.json`, { cf: { cacheTtl: 60 } });
      return [target, response.ok ? ((await response.json()) as Record<string, Listed>) : {}] as const;
    }),
  );
  const latest: Record<string, string> = {};
  const serving: Record<string, string> = {};
  for (const [target, list] of lists) {
    if (list["server-code"]) latest["server-code"] = serving["server-code"] = list["server-code"].build;
    for (const what of ["one", "one-cli"]) {
      if (!list[what]) continue;
      latest[`${what}/${target}`] = list[what].build;
      serving[`${what}/${target}`] = list[what].serving ?? list[what].build;
    }
  }
  const published = Object.values(serving).sort((a, b) => count(b) - count(a))[0];
  if (published) await relay(env.RELAY, (relay) => relay.updated({ published, latest, serving }));
}
