// The pictures people and the network are shown by (`Avatar` in the UI library): one square JPEG each, small, kept in
// this app's own artifact where a server reads it (`pictures` in `server/sign_in.ex`), so a backup of the bucket holds
// them. A person has up to two: the one they set themselves, `pictures/<name>/own`, which wins, and Google's,
// `pictures/<name>/google`, taken again whenever Google's profile gives another address for it. The network's is
// `pictures/network`, its icon.
import { env } from "cloudflare:workers";

declare global {
  namespace Cloudflare {
    interface Env {
      IMAGES: ImagesBinding;
    }
  }
}

/** How wide and tall a picture is kept, in pixels: an avatar at its largest, 64 points, on a 3x screen. */
const SIZE = 192;

/** The most a picture someone sets may be as it's sent, in bytes. */
export const MOST = 10 * 1024 * 1024;

/** A picture, as bytes, made `SIZE` square, its middle (or where Cloudflare finds what matters in it) kept, as a kept picture's JSON: its type and its bytes as base64. */
async function shrink(bytes: Uint8Array, more: object = {}) {
  const result = await env.IMAGES.input(new Blob([bytes]).stream())
    .transform({ width: SIZE, height: SIZE, fit: "cover", gravity: "auto", background: "#ffffff" })
    .output({ format: "image/jpeg", quality: 85 });
  return JSON.stringify({ type: result.contentType(), data: await new Response(result.image({ encoding: "base64" })).text(), ...more });
}

/** Makes `bytes` the picture a person goes by, or with none, takes theirs away, which leaves Google's. Throws what Cloudflare says if it isn't a picture. */
export async function setOwn(name: string, bytes: Uint8Array | null) {
  if (!bytes) return env.OWN.remove(`pictures/${name}/own`);
  const picture = await shrink(bytes);
  await env.OWN.update(`pictures/${name}/own`, () => picture);
}

/**
 * Takes Google's picture for a person, whose profile has it at `from` (Better Auth's `image`), as Google sizes it,
 * unless it's what's kept already. A profile with none has none kept.
 */
export async function keepGoogle(name: string, from: string | null | undefined) {
  const key = `pictures/${name}/google`;
  if (!from?.startsWith("https://")) return env.OWN.remove(key);
  await env.OWN.update(key, async (was) => {
    if (was && JSON.parse(was).from === from) return was;
    const response = await fetch(from.replace(/=s\d+(-c)?$/, `=s${SIZE}-c`));
    if (!response.ok) throw new Error(`Google answered ${response.status} for the picture of ${name}`);
    return shrink(new Uint8Array(await response.arrayBuffer()), { from });
  });
}

/**
 * The network's picture: its icon, or the One App's where it has none of its own, made as the others are. With
 * `again` it's made from the icon it has now, as it was set; otherwise only where it isn't kept.
 */
export async function keepNetwork(icon: string | null, again: boolean) {
  await env.OWN.update("pictures/network", async (was) => {
    if (was && !again) return was;
    const bytes = icon ? Uint8Array.from(atob(icon), (char) => char.charCodeAt(0)) : new Uint8Array(await (await env.ASSETS.fetch(new Request("https://assets.invalid/apple-touch-icon.png"))).arrayBuffer());
    return shrink(bytes);
  });
}

/** Takes a person's pictures away, as they are taken out of the network. */
export async function removeAll(name: string) {
  await Promise.all([env.OWN.remove(`pictures/${name}/own`), env.OWN.remove(`pictures/${name}/google`)]);
}
