/**
 * The web client's files, as the edge builds them (`core/edge/edge.js`). One kept compressed already, as Brotli at its
 * most (`<file>.br` beside it: the renderer's WebAssembly, `clients/web/renderer/build.js`), goes as it's kept to a
 * browser that takes Brotli, where Cloudflare would compress it again as it sends, at a lower level: 1.1 MB, not 1.4.
 */
/** Whether a browser is going to a page, which isn't a file the client has where it's an app's place in it
 * (`/settings/vault/accounts`, as `pathOf` in clients/app/page/path.js makes it): the client's page answers it. */
export const browsing = (request: Request) => request.method === "GET" && request.headers.get("sec-fetch-dest") === "document";
/** The client's page, for a page a browser goes to. */
export const page = async (request: Request, env: Env) => named(await env.ASSETS.fetch(new Request(new URL("/", request.url), request)), request, env);

/**
 * A page of the client's files with the network's name where it says the app's (`data-name`: its tab's title, and its
 * text), as Downloads' page has it (`apps/downloads/edge/worker.ts`), so a browser's tab, a link's preview and Add to
 * Home Screen say "the PTC App" from its first byte. The name is the one its web app's manifest says, which Sign-In's
 * part answers from what the network's owner set (`sign-in network`), kept as long as the manifest says; without that
 * part, the page says the One App's, as its file does. A page with its name is sent without its file's ETag, which
 * would let a browser keep it as it was named before.
 */
async function named(answer: Response, request: Request, env: Env): Promise<Response> {
  const part = env.PARTS["manifest.webmanifest"];
  if (!part || !answer.headers.get("content-type")?.startsWith("text/html")) return answer;
  const manifest = new URL("/manifest.webmanifest", request.url);
  let said = await caches.default.match(manifest);
  if (!said) {
    said = await (env[part as keyof Env] as unknown as Fetcher).fetch(manifest);
    if (said.ok) await caches.default.put(manifest, said.clone());
  }
  const { name } = said.ok ? await said.json<{ name?: string }>() : {};
  if (!name) return answer;
  const page = new Response(answer.body, answer);
  page.headers.delete("etag");
  return new HTMLRewriter().on("[data-name]", { element: (element) => void element.setInnerContent(name) }).transform(page);
}

/** What a kept file is, by its extension. */
const TYPES: Record<string, string> = { wasm: "application/wasm", js: "text/javascript" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const type = TYPES[url.pathname.split(".").pop() ?? ""];
    if (type && /\bbr\b/.test(request.headers.get("accept-encoding") ?? "")) {
      const kept = await env.ASSETS.fetch(new Request(new URL(`${url.pathname}.br`, url), request));
      if (kept.ok) {
        const headers = new Headers(kept.headers);
        headers.set("content-type", type);
        headers.set("content-encoding", "br");
        headers.append("vary", "accept-encoding");
        return new Response(kept.body, { headers, encodeBody: "manual" });
      }
    }
    const answer = await env.ASSETS.fetch(request);
    return answer.status === 404 && browsing(request) ? page(request, env) : named(answer, request, env);
  },
} satisfies ExportedHandler<Env>;
