// Deploys a built edge (`bun edge.js build <folder>`, which copies this in beside it) to a network's address, checks
// Cloudflare says it's live as that build, and rolls each Worker back to the version it ran before if it doesn't:
//
//     bun install --frozen-lockfile && bun deploy.js https://<the network's address> [--allow-downgrade]
//
// with the network's Cloudflare token in CLOUDFLARE_API_TOKEN. It needs nothing of the repo: each Worker is bundled
// already (`workers/<name>/`), as Wrangler bundles it, and is deployed as it is, with the web client's files
// (`web/`). A network's servers each have the edge of the build they run (`server-code`'s `edge/`), and one deploys
// it as the network's update asks (`core/edge/updater/updater.ts`).
//
// It never replaces a newer build with an older one, as a server refuses to go back: it reads the build the edge says
// it is first, and where that's newer than this build it says both and deploys nothing. `--allow-downgrade` goes back
// on purpose.
import { existsSync } from "node:fs";
import { $ } from "bun";

const here = import.meta.dir;
const [address, ...flags] = process.argv.slice(2);
const at = new URL(address ?? "");
if (at.protocol !== "https:" || at.pathname !== "/") throw new Error("bun deploy.js https://<address> [--allow-downgrade]: a network's address, with no path");
const allowDowngrade = flags.includes("--allow-downgrade");
const unknown = flags.filter((flag) => flag !== "--allow-downgrade");
if (unknown.length) throw new Error(`bun deploy.js https://<address> [--allow-downgrade]: not ${unknown.join(" ")}`);
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("No Cloudflare token: CLOUDFLARE_API_TOKEN isn't set");

// Wrangler deploys to the account of the zone the address is on, as Cloudflare says to the token, and nothing is
// deployed where the token can't see the zone: a token taken for another network's, as Andre's was the only one read,
// once deployed one network's Workers in place of another's (20 Nov).
const labels = at.hostname.split(".");
let zone;
for (let from = 0; !zone && from < labels.length - 1; from++) {
  const asked = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${labels.slice(from).join(".")}`, { headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
  zone = asked.ok ? (await asked.json()).result?.[0] : undefined;
}
if (!zone) throw new Error(`The Cloudflare token for ${at.hostname} reaches no zone it's on, so nothing was deployed: it's another network's token, or it can't read the zone`);
process.env.CLOUDFLARE_ACCOUNT_ID = zone.account.id;
console.log(`Deploying to ${zone.account.name}, the account of ${zone.name}`);

/**
 * The Workers, in the order they're deployed, as `edge.js` built them: a Worker after the ones it's bound to, so the
 * tail parts first, which the rest name as their tail consumers, then the relay, the other parts and the edge.
 * @type {{version: string, workers: {name: string, kind: "tail" | "relay" | "part" | "edge", tag: string, d1: string[]}[]}}
 */
const built = await Bun.file(`${here}/workers.json`).json();
/** The build the edge says it is, from the window page's `update.json` (`edge.js` writes it), or `null` where nothing answers. */
const said = () => fetch(new URL("/page/update.json", at), { cache: "no-store" }).then((answer) => (answer.ok ? answer.json() : null), () => null).catch(() => null);
/** Whether `a` is a newer build than `b`: the count of commits in its `+<count>.`, as the network update reads them. */
const newer = (a, b) => Number(/\+(\d+)/.exec(a)?.[1] ?? 0) > Number(/\+(\d+)/.exec(b)?.[1] ?? 0);
// Two deploys at once, from checkouts on builds apart, left a network's web clients on an older renderer: the newer
// build's deploy was replaced a minute later by the older one's (22 Nov). A deploy reads the build the edge says it is
// before it deploys anything, and one older than it deploys nothing.
const liveEdge = await said();
if (!allowDowngrade && liveEdge?.version && newer(liveEdge.version, built.version))
  throw new Error(`The edge at ${at.host} is ${liveEdge.version}, newer than this build, ${built.version}: nothing was deployed. Deploy that or a newer build, or \`--allow-downgrade\` to go back on purpose`);
// Wrangler replaces every Custom Domain of the edge with the one it's deployed to, so a deploy to a network's old
// address takes its name off the edge where it moved (PTC's, from v2.ptcau.app to ptcau.app, 22 Nov): one to an address
// the edge doesn't answer at, where it answers at another, deploys nothing. A network moves by removing its old name
// from the edge first.
const edgeName = built.workers.find(({ kind }) => kind === "edge").name;
const domains = await fetch(`https://api.cloudflare.com/client/v4/accounts/${zone.account.id}/workers/domains?service=${edgeName}`, { headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
if (!domains.ok) throw new Error(`Cloudflare didn't say where the edge answers (${domains.status}), so nothing was deployed`);
const elsewhere = (await domains.json()).result.map((/** @type {{hostname: string}} */ domain) => domain.hostname).filter((hostname) => hostname !== at.hostname);
if (elsewhere.length)
  throw new Error(`The edge answers at ${elsewhere.join(", ")}, not ${at.hostname}: nothing was deployed. Deploy to https://${elsewhere[0]}, or remove that name from the edge first to move the network`);
const wrangler = (/** @type {string[]} */ ...args) => Bun.spawn(["bun", "x", "wrangler", ...args], { cwd: here, env: process.env, stdio: ["inherit", "inherit", "inherit"] }).exited;
const config = (/** @type {string} */ name, file = "wrangler.jsonc") => `workers/${name}/${file}`;

/**
 * What Cloudflare says is live of `name`, its active deployment's version (`percentage`, of the traffic it takes) with
 * the tag and `VERSION` it was deployed with, or `null` where there's none.
 */
async function live(/** @type {string} */ name) {
  const status = await $`bun x wrangler deployments status --name ${name} --json`.cwd(here).quiet().nothrow();
  const active = status.exitCode === 0 ? JSON.parse(status.text()).versions?.[0] : null;
  if (!active) return null;
  const viewed = JSON.parse((await $`bun x wrangler versions view ${active.version_id} --name ${name} --json`.cwd(here).quiet()).text());
  const bound = viewed.resources?.bindings?.find((/** @type {{name: string}} */ binding) => binding.name === "VERSION");
  return { version: active.version_id, percentage: active.percentage, tag: viewed.annotations?.["workers/tag"], build: bound?.text };
}

// The edge answers at the network's address, which Cloudflare attaches to it, making its DNS record and certificate.
const edge = built.workers.find(({ kind }) => kind === "edge");
const edgeConfig = await Bun.file(`${here}/${config(edge.name)}`).json();
await Bun.write(`${here}/${config(edge.name, "deployed.jsonc")}`, JSON.stringify({ ...edgeConfig, routes: [{ pattern: at.hostname, custom_domain: true }] }, null, 2));

const before = Object.fromEntries(await Promise.all(built.workers.map(async ({ name }) => [name, await live(name)])));
/** The Workers deployed here, which are rolled back if the edge doesn't answer as its build. */
const deployed = [];
const deploy = async (/** @type {string} */ name, /** @type {string} */ file, /** @type {string[]} */ ...more) => {
  // A Worker's secrets are kept between deploys; a network's first deploy is given them by a file `secrets` beside it.
  const secrets = `workers/${name}/secrets`;
  const failed = await wrangler("deploy", "-c", config(name, file), ...(existsSync(`${here}/${secrets}`) ? ["--secrets-file", secrets] : []), ...more);
  if (failed) await back(`${name} didn't deploy`);
  deployed.push(name);
};

// The edge, the relay and the parts are bound to each other, and Cloudflare refuses a binding to a Worker that isn't
// there yet, so on an account that has no edge yet it's deployed first without its bindings to the others or its address.
if (!before[edge.name]) await deploy(edge.name, "bare.jsonc");
for (const { name, kind, tag, d1 } of built.workers) {
  if (kind === "edge") await deploy(name, "deployed.jsonc");
  // The relay is deployed only when what it runs changed: a deploy ends every connection it holds.
  else if (kind === "relay" && before[name]?.tag === tag) console.log(`The relay is as deployed (${tag}), so it's left running`);
  else await deploy(name, "wrangler.jsonc", "--tag", tag);
  // A part's D1 databases are made what they should be by their migrations, as Wrangler applies them, just after it's
  // deployed, since Wrangler makes a database a part names on its first deploy, and refuses migrations for one that
  // isn't there yet.
  for (const binding of d1) if (await wrangler("d1", "migrations", "apply", binding, "-c", config(name), "--remote")) await back(`${name}'s ${binding} didn't migrate`);
}

// It's checked by what Cloudflare says: a Worker's deployment is all at once, taking all the traffic as it's made, so a
// deployment that's the version just deployed at 100% is live (its API states it, as `wrangler deployments status`
// reads it), where the edge's own page can answer with the old build for a while after, in a location Cloudflare hasn't
// reached or a CDN that hasn't the new page yet. The edge is of this build and answers at the network's address, which
// Cloudflare says of its Custom Domains.
let why = "";
for (const { name, kind, tag } of built.workers) {
  if (!deployed.includes(name)) continue;
  const now = await live(name);
  if (now?.version === before[name]?.version || now?.percentage !== 100 || (kind === "edge" ? now.build !== built.version : now.tag !== tag)) {
    why = `Cloudflare says ${name} runs ${now ? `${now.version} at ${now.percentage}%` : "nothing"}, not the build deployed`;
    break;
  }
}
if (!why) {
  const attached = await fetch(`https://api.cloudflare.com/client/v4/accounts/${zone.account.id}/workers/domains?service=${edgeName}`, { headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
  if (!attached.ok || !(await attached.json()).result.some((/** @type {{hostname: string}} */ domain) => domain.hostname === at.hostname)) why = `Cloudflare doesn't say the edge answers at ${at.hostname}`;
}
if (why) await back(`The edge at ${at.host} didn't deploy as ${built.version}: ${why}`);
console.log(`The edge at ${at.host} is ${built.version}`);

/** Rolls each Worker deployed here back to the version it ran before, and ends saying `failed`. */
async function back(/** @type {string} */ failed) {
  console.error(failed);
  for (const name of deployed.reverse()) {
    if (!before[name]) continue;
    console.error(`Rolling ${name} back to ${before[name].version}`);
    await wrangler("rollback", before[name].version, "--name", name, "--message", failed.slice(0, 100), "--yes");
  }
  // Said last, as why it went back (`apps/software-update`).
  console.error(failed);
  process.exit(1);
}
