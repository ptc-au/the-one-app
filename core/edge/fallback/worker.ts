// The network's fallback server (`network-fallback`, `wrangler.jsonc` beside this): one of the network's own servers,
// in a Cloudflare Container, for when none of the others is on, as when the one machine they run on is off. Its
// Durable Object (`Fallback`) starts it once the network has had no server ready for `GONE`, and stops it once another
// has been ready for `COVERED`, keeping it on meanwhile, so the network's scheduled jobs (backups, the Board's
// schedules, Google's subscriptions renewed) go on as its calls do.
//
// It's a server as any other is (`image/entrypoint.sh`): the first time, it joins the network as one whose owner adds it
// at the network's address with a passkey, and it says the link and code for that in its log. Its disk is its image's
// again at every start, so what makes it the same server each time, its keys and its record, `ONE_HOME`'s `key`,
// `network`, `server/state.json` and `server/home/key`, is kept here once it's joined, in the Durable Object's storage,
// and handed to it as it starts (`ONE_IDENTITY`), which it then takes the network's latest build from.
//
// Its container runs where its Durable Object is, so the object is made where the network's bucket is (`here`): every
// call a server answers asks the bucket, which a container on another continent waited a round trip for each time
// (San Jose to Oceania, 27 Nov: calls took 4 to 15 times as long as on the network's other servers).
//
// It looks every minute, as the Worker's cron says, and at the moment something it waits for is due, by its alarm.
// Being asked every minute is also what keeps the container on: Cloudflare stops one whose Durable Object hasn't been
// asked anything for its inactivity timeout.
import { DurableObject } from "cloudflare:workers";
import { hex } from "../ask.ts";
import type { Network } from "../presigner/presigner.ts";
import { relay, type Presence } from "../relay/common.ts";
import type { Relay } from "../relay/worker.ts";

declare global {
  interface FallbackEnv {
    FALLBACK: DurableObjectNamespace<Fallback>;
    RELAY: DurableObjectNamespace<Relay>;
    NETWORK: Service<Network>;
    /** The network's address, which `deploy.js` gives it. */
    ADDRESS: string;
  }
}

/**
 * How long the network has had no server ready before it starts: a server restarting, to take an update, is back in
 * 7 to 24 s (PTC, 23 Nov), and the relay takes one that left within a minute as coming back (`LEFT` in `relay.ts`).
 */
const GONE = 60_000;
/** How long another server has been ready before it stops. */
const COVERED = 10 * 60_000;
/**
 * How long it has to stop once it's asked to, as `one serve run` drains the server as the system stops it (`STOP` in
 * `clients/cli/src/serving.rs`, 20 s, and 10 more for the program), before it's stopped outright.
 */
const STOP = 30_000;
/** Cloudflare's longest inactivity timeout for a container, which it's given each time it's looked at. */
const INACTIVE = 6 * 60 * 60_000;
/**
 * Its size: 4 GiB, as a network's server takes 450 to 560 MB with 650 to 740 MB at its peak, but Telemetry's `spending` took
 * it past 2 GiB, which ended the container (27 Nov), and 4 vCPUs, as it builds
 * every app again on a fresh disk as it starts: ready in 11 s, where 2 vCPUs took 17 s, 1 vCPU 95 s, standard-1's ½ 135 s
 * and basic's ¼ 230 s (27 Nov). CPU is billed as it's used, so the 4 cost only that minute more, and memory by the hour it's on.
 */
const INSTANCE = { vcpu: 4, memoryMib: 4096, diskMb: 8000 };
/** The server's `ONE_HOME` in its image (`image/Dockerfile`), named here as what's run in it is given none of its environment. */
const HOME = "/data/home";
/** What's kept of a joined server, from its `ONE_HOME`, as a gzipped tar in base64, once its record says it's active. */
const IDENTITY = `cd ${HOME} && jq -e '.server_membership == "active"' server/state.json >/dev/null && tar cz key network server/state.json server/home/key | base64 -w0`;
/** The DER of a PKCS #8 Ed25519 private key, but for its 32-byte seed, which follows. */
const PKCS8 = hex.decode("302e020100300506032b657004220420");

/** The places a Durable Object can be asked to be made in, which are those R2 says its buckets are in (lowercased). */
const PLACES = ["wnam", "enam", "sam", "weur", "eeur", "apac", "oc", "afr", "me"] as const;

/**
 * The server's Durable Object, made where the network's bucket is, as the edge says (`Network.location`): only its first
 * call is placed by the hint, and none is given where the bucket's place is none of those, as where it's up to Cloudflare.
 */
async function here(env: FallbackEnv) {
  const place = (await env.NETWORK.location())?.toLowerCase();
  return env.FALLBACK.getByName("server", { locationHint: PLACES.find((one) => one === place) });
}

export default {
  async scheduled(_controller, env) {
    await (await here(env)).look();
  },
} satisfies ExportedHandler<FallbackEnv>;

export class Fallback extends DurableObject<FallbackEnv> {
  /** Its container, which every Fallback has (`wrangler.jsonc`). */
  container = this.ctx.container!;

  async alarm() {
    await this.look();
  }

  /**
   * Starts the server where the network has had no other ready for `GONE`, stops it where another has been for
   * `COVERED`, and keeps what makes it the same server once it's joined.
   */
  async look() {
    const { container } = this;
    const { storage } = this.ctx;
    const mine = await storage.get<string>("key");
    const servers = (await this.env.NETWORK.servers()).filter((key) => key !== mine);
    let here: Record<string, Presence | null> = {};
    if (servers.length) {
      // Disposed of once it's copied, so the relay's call ends as it answers.
      using presence = await relay(this.env.RELAY, (relay) => relay.ready(servers, 0));
      here = Object.fromEntries(Object.entries(presence));
    }
    const ready = servers.some((key) => here[key]?.server_ready);
    const now = Date.now();
    if (container.running) {
      await container.setInactivityTimeout(INACTIVE);
      await this.keep();
      await storage.delete("none");
      if (!ready) return void (await storage.delete("covered"));
      const covered = (await storage.get<number>("covered")) ?? now;
      await storage.put("covered", covered);
      if (now - covered < COVERED) return void (await storage.setAlarm(covered + COVERED));
      return this.stop(`${servers.filter((key) => here[key]?.server_ready).map((key) => key.slice(0, 8)).join(", ")} has been ready for ${COVERED / 60_000} min`);
    }
    await storage.delete("covered");
    if (ready) return void (await storage.delete("none"));
    // Since when none has been: since the last of them left, or now where one is here and not ready.
    const left = servers.map((key) => (here[key]?.connected ? now : (here[key]?.last_seen ?? 0)));
    const none = (await storage.get<number>("none")) ?? Math.max(0, ...left);
    await storage.put("none", none);
    if (now - none < GONE) return void (await storage.setAlarm(none + GONE));
    await this.start(servers.length ? `none of its ${servers.length} servers has been ready since ${new Date(none).toISOString()}` : "it has no other server");
  }

  async start(why: string) {
    const identity = await this.ctx.storage.get<string>("identity");
    this.container.start({
      image: this.container.images.server,
      instance: INSTANCE,
      enableInternet: true,
      env: { ONE_ADDRESS: this.env.ADDRESS, ...(identity && { ONE_IDENTITY: identity }) },
    });
    await this.container.setInactivityTimeout(INACTIVE);
    await this.ctx.storage.delete("none");
    console.log(JSON.stringify({ fallback: "started", why, joined: !!identity }));
  }

  /** Has the server drain and stop, as the system stops one (SIGTERM), and stops it outright after `STOP`. */
  async stop(why: string) {
    const { container } = this;
    container.signal(15);
    const stopped = await Promise.race([container.monitor().then(() => true, () => true), scheduler.wait(STOP).then(() => false)]);
    if (!stopped && container.running) await container.destroy();
    await this.ctx.storage.delete("covered");
    console.log(JSON.stringify({ fallback: "stopped", why, drained: stopped }));
  }

  /**
   * Keeps what makes the server the same server next time, once it's joined, and its key, by which it's told from the
   * others. Until it has joined, says the link and code its owner adds it by, which `one serve on` printed.
   */
  async keep() {
    const { container } = this;
    const { storage } = this.ctx;
    const said = async (command: string) => {
      const output = await (await container.exec(["bash", "-c", command])).output();
      return output.exitCode === 0 ? new TextDecoder().decode(output.stdout).trim() : null;
    };
    const identity = await said(IDENTITY);
    if (!identity) return void console.log(JSON.stringify({ fallback: "joining", said: await said(`tail -n 4 ${HOME}/../joining`) }));
    if (identity === (await storage.get<string>("identity"))) return;
    const seed = Uint8Array.from(atob((await said(`base64 -w0 ${HOME}/server/home/key`))!), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", new Uint8Array([...PKCS8, ...seed]), "Ed25519", true, ["sign"]);
    const { x } = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
    const mine = hex.encode(Uint8Array.from(atob(x!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
    await storage.put({ identity, key: mine });
    console.log(JSON.stringify({ fallback: "kept", key: mine.slice(0, 8) }));
  }
}
