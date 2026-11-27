// What the core has released, which every network takes (`OneCore.Builds`): its release's list for each kind of
// machine, `builds` on GitHub, as `tooling/release` keeps it. The edge reads them every few minutes (`wrangler.jsonc`'s
// cron) and tells the network's updater, through the relay, as a build published to the network told it before, so a
// release reaches every network without naming any. Only a newer build moves the updater, so telling it again is
// nothing. A network's own app is the build its own installer is, which `tooling/installers` makes from the platform's
// after it publishes that, so a network's `latest` for a kind of machine moves once its installer is published, and a
// client is never told of a build its network has no app of.
import { networkApp } from "../presigner/presigner.ts";
import { relay } from "../relay/common.ts";

const RELEASES = "https://github.com/ptc-au/the-one-app/releases/download/builds";
/** The kinds of machine the core makes builds for, as `OneCore.Builds` names them. */
const TARGETS = ["linux-x86_64", "linux-aarch64", "macos-aarch64", "windows-x86_64"];

/**
 * The network's own installer of its app for a kind of machine, where it has one (`tooling/installers`): a Mac's app in
 * a disk image, and the program an app on Windows takes as it updates, where the installer itself would close it.
 */
const OWN: Record<string, string> = { "macos-aarch64": "mac", "windows-x86_64": "windows-program" };

/** The network's own installers, by the kind of computer or phone each is for, as its Software Update keeps them. */
type Installers = Record<string, { build: string }>;

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
  const [lists, own] = await Promise.all([
    Promise.all(
      TARGETS.map(async (target) => {
        const response = await fetch(`${RELEASES}/${target}.json`, { cf: { cacheTtl: 60 } });
        return [target, response.ok ? ((await response.json()) as Record<string, Listed>) : {}] as const;
      }),
    ),
    installers(env),
  ]);
  const latest: Record<string, string> = {};
  const serving: Record<string, string> = {};
  for (const [target, list] of lists) {
    if (list["server-code"]) latest["server-code"] = serving["server-code"] = list["server-code"].build;
    for (const what of ["one", "one-cli"]) {
      if (!list[what]) continue;
      // A network's own app is its installer's build, and no other until its network has one: a client told of the
      // platform's build would hear of one its network has no app of, and wait for it (`fetched_program` in
      // clients/cli). A network with no app of its own takes the platform's builds, as before. What a server runs
      // (`serving`) is the platform's either way, which its update takes a `one` from.
      latest[`${what}/${target}`] = (what === "one" && own[OWN[target]]?.build) || list[what].build;
      serving[`${what}/${target}`] = list[what].serving ?? list[what].build;
    }
  }
  const published = Object.values(serving).sort((a, b) => count(b) - count(a))[0];
  if (published) await relay(env.RELAY, (relay) => relay.updated({ published, latest, serving }));
}

/**
 * The network's own installers, by the platform each is for, as its Software Update keeps them (`tooling/installers`),
 * or none where the network has no Software Update, or no installer of its own app.
 */
async function installers(env: Env): Promise<Installers> {
  try {
    const kept = await networkApp(env, "software-update", "installers");
    return kept ? (JSON.parse(kept) as Installers) : {};
  } catch (error) {
    // The core's builds reach the network's servers regardless, and its own app's is the platform's until its
    // installers can be read.
    console.log(JSON.stringify({ telemetry: { error: `The network's installers couldn't be read: ${error}` } }));
    return {};
  }
}
