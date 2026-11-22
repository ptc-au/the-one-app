// Builds the renderer's frame into a folder, `bun build.js <out> [--mutants]`, as the edge serves it at `/renderer/`
// (core/edge/edge.js): its page and scripts, and the renderer as WebAssembly, built by Cargo, bound to its JS by
// wasm-bindgen and made smaller by binaryen's wasm-opt (mise.toml has both), each once on this machine for what it's made
// from (tooling/cached-build). `--mutants` builds the web gate's own, which puts back a bug its address asks for
// (`renderer::mutants`): never one the edge serves.
import { $ } from "bun"
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { brotliCompressSync, constants } from "node:zlib"

const [out, mutants] = process.argv.slice(2)
const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16)
const root = here("../../../")
mkdirSync(out, { recursive: true })
for (const file of ["index.html", "renderer.js", "text-input.js", "semantics.js", "video.js", "check.html", "check.js"]) copyFileSync(here(file), `${out}/${file}`)
// The gate's check page, an app's page built as a server builds one (core/ui/app.js), which check.html hosts.
await $`bun ${root}/core/ui/dist/build/app.js ${here("check")} ${out}/check`.quiet()
const compiled = (await $`${root}/tooling/cached-build ${here(".")} --target wasm32-unknown-unknown ${mutants === "--mutants" ? ["--profile", "web-tests", "--features", "mutants"] : ["--profile", "web"]}`.quiet().text()).trim()
// What's made of Cargo's WebAssembly, by wasm-bindgen, binaryen's wasm-opt and Brotli at its most, takes most of a build
// (17 of a local network's edge's 28 s to start, 22 Nov), and is the same for the same WebAssembly, so it's kept by its
// hash beside the builds, for every worktree on the machine: a build of a renderer built before copies it.
const bound = `${process.env.XDG_CACHE_HOME ?? `${homedir()}/.cache`}/the-one-app/bound`
const kept = `${bound}/${hash(readFileSync(compiled))}`
if (!existsSync(kept)) {
  const making = `${kept}-${process.pid}`
  await $`wasm-bindgen --target web --no-typescript --out-dir ${making} ${compiled}`.quiet()
  // Smaller for the edge to send, which the web gate's own needn't be.
  if (mutants !== "--mutants") await $`wasm-opt -Oz --strip-debug --strip-producers ${making}/web_renderer_bg.wasm -o ${making}/web_renderer_bg.wasm`.quiet()
  // Named by what's in it, so a browser keeps it for good (clients/web/_headers) and a new build is a new name, which
  // the frame's page and script are given; and kept compressed at Brotli's most too, which the edge sends as it's kept
  // (core/edge/web/web.ts), but for the web gate's own, which no edge serves (7 s of its start).
  const wasm = readFileSync(`${making}/web_renderer_bg.wasm`)
  const named = `web_renderer_bg-${hash(wasm)}.wasm`
  renameSync(`${making}/web_renderer_bg.wasm`, `${making}/${named}`)
  if (mutants !== "--mutants") writeFileSync(`${making}/${named}.br`, brotliCompressSync(wasm, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: wasm.length } }))
  // Another build of the same renderer that finished first kept the same files.
  try { renameSync(making, kept) } catch { rmSync(making, { recursive: true }) }
  // The last few builds are kept, the tests' (`--mutants`) and the edge's among them, of the renderers the machine's
  // worktrees build.
  const older = readdirSync(bound).map((name) => `${bound}/${name}`).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const old of older.slice(8)) rmSync(old, { recursive: true, force: true })
}
cpSync(kept, out, { recursive: true })
const named = readdirSync(kept).find((file) => file.endsWith(".wasm"))
for (const file of ["index.html", "renderer.js"]) writeFileSync(`${out}/${file}`, readFileSync(`${out}/${file}`, "utf8").replaceAll("web_renderer_bg.wasm", named))
