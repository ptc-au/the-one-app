// The Downloads app's edge function: the network's download page (`page/download.html`), at `/download`, for whoever's
// signed in to the network, and each of its installers, at `/download/<its name>`. Someone who isn't signed in is sent
// to sign in first, and back to the page after. The page offers what the app's `list` says, which a server of the
// network answers as whoever opened it: the network's installers, which Software Update keeps, with the one for the
// computer or phone it's opened on first, as other apps' download pages have it, and an iPhone's TestFlight. Whatever
// has no app gets the web app. An installer is read from the bucket by the link Software Update gives for it.
import { env } from "cloudflare:workers";
import Bowser from "bowser";
import { renderSVG } from "uqr";

declare global {
  namespace Cloudflare {
    /** Its bindings: its page's files, and what the edge gives every app's part (`core/edge/edge.js`). */
    interface Env {
      ASSETS: Fetcher;
      NETWORK: { servers(of?: string): Promise<string[]> };
      RELAY: { forward(servers: string[], message: string): Promise<{ server: string; answer: string } | null> };
      WHO: { who(request: Request): Promise<Signed | { refused: Response }> };
    }
  }
}

/** Someone signed in to the network, as the part that signs people in says (`Who` in `apps/sign-in/edge`). */
type Signed = { device: string; who: string; cookies?: string[] };

/** What the page offers, as the app's `list` says it (`server/downloads.ex`). */
type Listed = { name: string | null; installers: { platform: string; name: string }[]; testflight: string | null };

/** the One App's name, where the network has none of its own. */
const ONE_APP = "the One App";

/** A kind of device the page knows, which `?for=` names to show it first. */
type Device = "mac" | "windows" | "linux" | "iphone" | "android";

/** Apple's logo, a Mac's and an iPhone's. */
const APPLE = "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";

/** What each kind of device is called, and its maker's logo (Simple Icons' paths, as each company draws it). */
const DEVICES: Record<Device, { name: string; logo: string }> = {
  mac: { name: "Mac", logo: APPLE },
  windows: { name: "Windows", logo: "M0 0h11.377v11.372H0Zm12.623 0H24v11.372H12.623ZM0 12.623h11.377V24H0Zm12.623 0H24V24H12.623" },
  linux: { name: "Linux", logo: "M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" },
  iphone: { name: "iPhone", logo: APPLE },
  android: { name: "Android", logo: "M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z" },
};

/** Each kind of device's downloads, its first the one it's offered, and what each of them is called beside it. */
const FILES: Record<Device, [string, string][]> = {
  mac: [["mac", "Apple silicon"], ["mac-intel", "Intel"]],
  windows: [["windows", "Download"]],
  linux: [["linux-appimage", "AppImage"], ["linux-deb", ".deb"]],
  iphone: [["iphone", "TestFlight"]],
  android: [["android", "APK"]],
};

/** Apple's TestFlight, which an iPhone gets a network's app from before it's on the App Store. */
const TESTFLIGHT = "https://apps.apple.com/app/testflight/id899247664";
/** TestFlight itself, opened on an iPhone or a Mac, where an app is listed for whoever was invited to test it. */
const OPEN_TESTFLIGHT = "itms-beta://";

/** Which kind of device a browser is on, by its user agent, as `?for=` can say instead. */
function device(request: Request, url: URL): Device | null {
  const asked = url.searchParams.get("for");
  if (asked && asked in DEVICES) return asked as Device;
  const os = Bowser.parse(request.headers.get("user-agent") || " ").os.name;
  return ({ macOS: "mac", Windows: "windows", Linux: "linux", iOS: "iphone", Android: "android" } as Record<string, Device>)[os ?? ""] ?? null;
}

/** Text as HTML says it. */
const text = (words: string) => words.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const logo = (device: Device) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${DEVICES[device].logo}"/></svg>`;
/** The file a link downloads, by the last part of its path: `the PTC App.dmg`. */
const file = (link: string) => decodeURIComponent(new URL(link).pathname.split("/").pop() || "") || link;

/** What each kind of installer is, by its file's ending, as a browser is told. */
const TYPES: Record<string, string> = {
  dmg: "application/x-apple-diskimage",
  exe: "application/vnd.microsoft.portable-executable",
  apk: "application/vnd.android.package-archive",
  deb: "application/vnd.debian.binary-package",
};

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/download/page/")) return env.ASSETS.fetch(request);
    const signed = await env.WHO.who(new Request(request.url, { headers: request.headers }));
    if ("refused" in signed) {
      // Someone who isn't signed in signs in first, and comes back to the page: an installer is only for the network's
      // own people.
      if (url.pathname !== "/download") return new Response("Sign in to this network to download its app.", { status: 401 });
      return Response.redirect(new URL(`/sign-in/?callbackURL=${encodeURIComponent(url.pathname + url.search)}`, url).href, 302);
    }
    // What the network's servers couldn't answer is said as they said it.
    const answer = await (url.pathname === "/download" ? page(request, url, signed) : installer(request, decodeURIComponent(url.pathname.slice("/download/".length)), signed)).catch(
      (error: Error) => new Response(error.message, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }),
    );
    // Better Auth sends a session that's being used a later end.
    const headers = new Headers(answer.headers);
    for (const cookie of signed.cookies ?? []) headers.append("set-cookie", cookie);
    return new Response(answer.body, { status: answer.status, headers });
  },
} satisfies ExportedHandler;

/** Calls the tool `name` of the network's apps as whoever's signed in, as their device, and gives what it answered. */
async function call<T>(signed: Signed, name: string, args: object): Promise<T> {
  const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: { device: signed.device } } });
  const servers = new Set([...(await env.NETWORK.servers(`${signed.who}/`)), ...(await env.NETWORK.servers())]);
  const reached = await env.RELAY.forward([...servers], message);
  if (!reached) throw new Error("None of this network's servers answered. Try again once one is on.");
  type Result = { isError?: boolean; content?: { text?: string }[]; structuredContent?: T };
  const { result, error }: { result?: Result; error?: { message?: string } } = JSON.parse(reached.answer);
  if (result && !result.isError && result.structuredContent) return result.structuredContent;
  throw new Error(result?.content?.[0]?.text ?? error?.message ?? "The server didn't say what happened.");
}

/** One of the network's installers, read from the bucket as it's sent, with its name to save it by. */
async function installer(request: Request, name: string, signed: Signed) {
  const found = await call<{ link: string }>(signed, "software-update_installer", { name }).catch((error: Error) => error);
  if (found instanceof Error) return new Response(found.message, { status: 404 });
  // A download that broke off carries on where it stopped, as a browser asks for the rest.
  const range = request.headers.get("range");
  const got = await fetch(found.link, { headers: range ? { range } : {} });
  if (!got.ok) return new Response("The installer couldn't be read. Try again.", { status: 502 });
  const headers = new Headers({
    "content-type": TYPES[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
  });
  for (const kept of ["content-length", "content-range", "etag", "last-modified"]) if (got.headers.has(kept)) headers.set(kept, got.headers.get(kept)!);
  return new Response(got.body, { status: got.status, headers });
}

/** The page, with what the network offers whoever opened it. */
async function page(request: Request, url: URL, signed: Signed) {
  const page = await env.ASSETS.fetch(new URL("/download/page/download", url));
  const listed = await call<Listed>(signed, "downloads_list", {});
  const downloads: Record<string, string> = Object.fromEntries(listed.installers.map(({ platform, name }) => [platform, `${url.origin}/download/${encodeURIComponent(name)}`]));
  // An iPhone's is TestFlight's: the network's public link, or TestFlight itself, where it's listed for whoever the
  // network has invited.
  downloads.iphone = listed.testflight ?? OPEN_TESTFLIGHT;
  const name = text(listed.name ?? ONE_APP);
  const here = device(request, url);
  const offered = (device: Device) => FILES[device].filter(([platform]) => downloads[platform]).map(([platform, label]) => ({ link: downloads[platform]!, label }));
  const phone = here === "iphone" || here === "android";
  const first = here && offered(here).length ? here : null;
  const fill = (html: string) => ({ element: (element: Element) => void element.setInnerContent(html, { html: true }) });
  const others = (Object.keys(DEVICES) as Device[]).filter((device) => device !== first && offered(device).length);

  return new HTMLRewriter()
    // It's at `/download`, and its files are in `/download/page/`, before whatever names them.
    .on("html", { element: (html) => void html.prepend(`<base href="/download/page/">`, { html: true }) })
    .on("title", fill(`Download ${name}`))
    .on("[data-name]", fill(name))
    .on("[data-host]", fill(text(url.host)))
    .on("[data-hero]", fill(hero(first, name, first ? offered(first) : [])))
    .on("[data-platforms]", fill(others.map((device) => platform(device, offered(device))).join("")))
    .on("[data-others]", { element: (element) => void (others.length || element.remove()) })
    // A code that opens this page on a phone, which a phone has no need of.
    .on("[data-phone]", { element: (element) => void (phone && element.remove()) })
    .on("[data-qr]", fill(renderSVG(`${url.origin}/download`, { border: 0 }).replace("<svg ", `<svg role="img" aria-label="A code that opens ${text(url.host)}/download" `)))
    .on("[data-address]", fill(text(`${url.host}/download`)))
    .transform(new Response(page.body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", vary: "user-agent" } }));
}

/** The download for the device the page is opened on, or the web app where it has none. */
function hero(device: Device | null, name: string, files: { link: string; label: string }[]) {
  const icon = `<img class="icon" src="/apple-touch-icon.png" alt="">`;
  const web = `<p class="note">Prefer your browser? <a href="/">Open Web App</a></p>`;
  if (!device) return `${icon}<h1>Get ${name}</h1><p class="lede">Use it in your browser on any device.</p><a class="button large" href="/">Open Web App</a>`;
  const [main, other] = files;
  if (device === "iphone")
    return `${icon}<h1>Download ${name}</h1><p class="lede">Two quick steps on your iPhone.</p>
      <ol class="steps">
        <li><img class="step-icon" src="./testflight.png" alt=""><span class="words"><b>1. Get TestFlight</b><small>Apple's free app for trying new apps.</small></span><a class="button outline" href="${TESTFLIGHT}">Get</a></li>
        ${
          main.link === OPEN_TESTFLIGHT
            ? `<li><img class="step-icon" src="/apple-touch-icon.png" alt=""><span class="words"><b>2. Install ${name}</b><small>It's in TestFlight for everyone this network invited. Tap Install.</small></span><a class="button" href="${OPEN_TESTFLIGHT}">Open</a></li>`
            : `<li><img class="step-icon" src="/apple-touch-icon.png" alt=""><span class="words"><b>2. Install ${name}</b><small>It opens in TestFlight. Tap Install.</small></span><a class="button" href="${text(main.link)}">Install</a></li>`
        }
      </ol>${web}`;
  const button = `<a class="button large" href="${text(main.link)}">${logo(device)}Download for ${DEVICES[device].name}</a>`;
  const saved = text(file(main.link));
  if (device === "android")
    return `${icon}<h1>Download ${name}</h1><p class="lede">Get it on your Android phone.</p>${button}
      <ol class="steps">
        <li><span class="number">1</span><span class="words">Open <b>${saved}</b> once it downloads.</span></li>
        <li><span class="number">2</span><span class="words">If you're asked, allow installs from your browser.</span></li>
        <li><span class="number">3</span><span class="words">Tap <b>Install</b>.</span></li>
        <li><span class="number">4</span><span class="words">If Google Play Protect recommends a scan, tap <b>Scan app</b>. It sends the app's details to Google to check it.</span></li>
      </ol>${web}`;
  const lede = { mac: `For Mac with ${main.label === "Intel" ? "Intel" : "Apple silicon"}.`, windows: "For Windows 10 and 11.", linux: `For Linux, as an ${main.label}.` }[device];
  const then = { mac: `Open ${saved}, then drag ${name} to Applications.`, windows: `Open ${saved} to install it.`, linux: `Open ${saved} to start it.` }[device];
  const instead = other && `<p class="note">${device === "mac" ? "Have an Intel Mac?" : "Prefer a package?"} <a href="${text(other.link)}">Download ${device === "mac" ? "for Intel" : other.label}</a></p>`;
  return `${icon}<h1>Download ${name}</h1><p class="lede">${lede}</p>${button}<p class="note">${then}</p>${instead ?? ""}${web}`;
}

/** Another platform there's an app for, with a link to each of its downloads. */
function platform(device: Device, files: { link: string; label: string }[]) {
  const links = files.map(({ link, label }) => `<a href="${text(link)}">${device !== "iphone" ? label : link === OPEN_TESTFLIGHT ? "Open TestFlight" : "Get on TestFlight"}</a>`).join("");
  return `<li>${logo(device)}<b>${DEVICES[device].name}</b><span class="links">${links}</span></li>`;
}
