// Privacy's edge function. It serves the network's privacy page (`/privacy`, `page/`), which anyone opens without
// signing in, as an OAuth client's consent screen links to it. What it says is what the apps the network has say of the
// data they keep (the hook `privacy.sections`), which a server collects: this asks it as the holder of a link to the
// network, whom nothing is theirs.
import { env } from "cloudflare:workers";
import MarkdownIt from "markdown-it";

declare global {
  namespace Cloudflare {
    /** Its bindings: its page's files, and what the edge gives every app's part (`core/edge/edge.js`). */
    interface Env {
      ASSETS: Fetcher;
      NETWORK: { servers(of?: string): Promise<string[]> };
      RELAY: { forward(servers: string[], message: string): Promise<{ server: string; answer: string } | null> };
    }
  }
}

/** What an app says, as the tool of the server answers it. */
interface Section {
  app: string;
  heading: string | null;
  order: number;
  text: string;
}

/** Markdown, as an app writes its words: no HTML of its own is let through, and no link that runs a script. */
const markdown = new MarkdownIt();

/** What the network's apps say, in the order the page shows it, or why a server couldn't say. */
async function sections(): Promise<Section[] | string> {
  const call = { name: "privacy_sections", arguments: {}, _meta: { link: "network/privacy" } };
  const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: call });
  const reached = await env.RELAY.forward(await env.NETWORK.servers(), message);
  if (!reached) return "None of this network's servers answered.";
  type Result = { isError?: boolean; content?: { text?: string }[]; structuredContent?: { sections: Section[] } };
  const { result, error }: { result?: Result; error?: { message?: string } } = JSON.parse(reached.answer);
  if (result && !result.isError && result.structuredContent) return result.structuredContent.sections;
  return result?.content?.[0]?.text ?? error?.message ?? "The server didn't say what happened.";
}

/** The page's words as HTML: each heading once, over what every app under it says, the first heading's place its own. */
function page(parts: Section[]) {
  const headings = [...new Set(parts.map((part) => part.heading))];
  return headings
    .map((heading) => {
      const words = markdown.render(parts.filter((part) => part.heading === heading).map((part) => part.text).join("\n\n"));
      return heading === null ? `<div class="lead">${words}</div>` : `<section><h2>${markdown.utils.escapeHtml(heading)}</h2>${words}</section>`;
    })
    .join("");
}

/** How long the page's words are answered from Cloudflare's cache before the servers are asked again behind it, in seconds. */
const FRESH = 60;
/** How long a request waits for a server when it has no words from before, in seconds: a page Google's consent screen links to answers. */
const WAIT = 2;

/**
 * The page's words, as the servers last said them and this data center kept (`caches.default`, which Sign-In's
 * discovery documents are kept in too): they're answered at once, whatever the servers are doing, and the servers
 * are asked again behind the answer once they're older than `FRESH`, as stale-while-revalidate has it. A server that's
 * slow or gone changes nothing, as with stale-if-error. Only a data center that has none yet waits for one, and for
 * `WAIT` seconds at most: what it asked goes on behind that, so the next request has it.
 */
async function words(ctx: ExecutionContext): Promise<string> {
  const kept = "https://privacy.network/words";
  const refresh = async () => {
    const parts = await sections();
    if (typeof parts === "string") throw new Error(parts);
    const html = page(parts);
    // The cache keeps it as long as its headers say, and it's asked for again behind it as it's answered, so it's kept for a year.
    await caches.default.put(kept, new Response(html, { headers: { "cache-control": "public, max-age=31536000", date: new Date().toUTCString() } }));
    return html;
  };
  const cached = await caches.default.match(kept);
  if (cached) {
    if (!(Date.now() - Date.parse(cached.headers.get("date") ?? "") < FRESH * 1000)) ctx.waitUntil(refresh().catch(() => {}));
    return cached.text();
  }
  const asked = refresh();
  ctx.waitUntil(asked.catch(() => {}));
  const slow = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`No server answered within ${WAIT} seconds.`)), WAIT * 1000));
  return Promise.race([asked, slow]);
}

export default {
  async fetch(request: Request, _: unknown, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname !== "/privacy") return env.ASSETS.fetch(request);
    let inner: string;
    try {
      inner = await words(ctx);
    } catch (error) {
      return new Response(`This network's privacy page isn't available now: ${(error as Error).message}`, { status: 503 });
    }
    return new HTMLRewriter()
      // It's at `/privacy`, and its files are beside it, in `/privacy/`, before whatever names them.
      .on("html", { element: (html) => void html.prepend(`<base href="/privacy/">`, { html: true }) })
      .on("[data-sections]", { element: (element) => void element.setInnerContent(inner, { html: true }) })
      .transform(await env.ASSETS.fetch(new URL("/privacy/", url)));
  },
} satisfies ExportedHandler;
