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

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname !== "/privacy") return env.ASSETS.fetch(request);
    const parts = await sections();
    if (typeof parts === "string") return new Response(`This network's privacy page isn't available now: ${parts}`, { status: 503 });
    const words = page(parts);
    return new HTMLRewriter()
      // It's at `/privacy`, and its files are beside it, in `/privacy/`, before whatever names them.
      .on("html", { element: (html) => void html.prepend(`<base href="/privacy/">`, { html: true }) })
      .on("[data-sections]", { element: (element) => void element.setInnerContent(words, { html: true }) })
      .transform(await env.ASSETS.fetch(new URL("/privacy/", url)));
  },
} satisfies ExportedHandler;
