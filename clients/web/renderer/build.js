// Builds the renderer's frame into a folder, `bun build.js <out>`, as the edge serves it at `/renderer/`
// (core/edge/edge.js): its page and scripts, and the renderer as WebAssembly, built by Cargo, bound to its JS by
// wasm-bindgen and made smaller by binaryen's wasm-opt (mise.toml has both), each once on this machine for what it's made
// from (tooling/cached-build).
import { $ } from "bun"
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { brotliCompressSync, constants } from "node:zlib"

const [out] = process.argv.slice(2)
const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16)
const root = here("../../../")
mkdirSync(out, { recursive: true })
for (const file of ["index.html", "renderer.js", "text-input.js", "semantics.js", "video.js", "check.html", "check.js"]) copyFileSync(here(file), `${out}/${file}`)
// The frame's check page, an app's page built as a server builds one (core/ui/app.js), which check.html hosts.
await $`bun ${root}/core/ui/dist/build/app.js ${here("check")} ${out}/check`.quiet()
const compiled = (await $`${root}/tooling/cached-build ${here(".")} --target wasm32-unknown-unknown --profile web`.quiet().text()).trim()
// What's made of Cargo's WebAssembly, by wasm-bindgen, binaryen's wasm-opt and Brotli at its most, takes most of a build
// (17 of a local network's edge's 28 s to start, 22 Nov), and is the same for the same WebAssembly, so it's kept by its
// hash beside the builds, for every worktree on the machine: a build of a renderer built before copies it.
const bound = `${process.env.XDG_CACHE_HOME ?? `${homedir()}/.cache`}/the-one-app/bound`
const kept = `${bound}/${hash(readFileSync(compiled))}`
if (!existsSync(kept)) {
  const making = `${kept}-${process.pid}`
  await $`wasm-bindgen --target web --no-typescript --out-dir ${making} ${compiled}`.quiet()
  // Smaller for the edge to send.
  await $`wasm-opt -Oz --strip-debug --strip-producers ${making}/web_renderer_bg.wasm -o ${making}/web_renderer_bg.wasm`.quiet()
  // Named by what's in it, so a browser keeps it for good (clients/web/_headers) and a new build is a new name, which
  // the frame's page and script are given; and kept compressed at Brotli's most too, which the edge sends as it's kept
  // (core/edge/web/web.ts).
  const wasm = readFileSync(`${making}/web_renderer_bg.wasm`)
  const named = `web_renderer_bg-${hash(wasm)}.wasm`
  renameSync(`${making}/web_renderer_bg.wasm`, `${making}/${named}`)
  writeFileSync(`${making}/${named}.br`, brotliCompressSync(wasm, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: wasm.length } }))
  // Another build of the same renderer that finished first kept the same files.
  try { renameSync(making, kept) } catch { rmSync(making, { recursive: true }) }
  // The last few builds used are kept, of the renderers the machine's
  // worktrees build; never one another build is still making (`-<pid>`, while that pid runs), which a dozen side by side lost.
  const unfinished = (name) => name.includes("-") && (() => { try { return process.kill(Number(name.split("-")[1]), 0) } catch { return false } })()
  const older = readdirSync(bound).filter((name) => !unfinished(name)).map((name) => `${bound}/${name}`).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const old of older.slice(8)) rmSync(old, { recursive: true, force: true })
}
// Used now, so it's among the last few another build keeps as it copies it.
utimesSync(kept, new Date(), new Date())
cpSync(kept, out, { recursive: true })
const named = readdirSync(kept).find((file) => file.endsWith(".wasm"))
for (const file of ["index.html", "renderer.js"]) writeFileSync(`${out}/${file}`, readFileSync(`${out}/${file}`, "utf8").replaceAll("web_renderer_bg.wasm", named))
// Each script the frame loads is named by what's in it too, as the WebAssembly is, beside its own name (by which the
// Sign-In and Vault pages load renderer.js), and the frame's page loads those, so a browser that opened it before asks
// for none of them again (clients/web/_headers): not renderer.js, then each module it imports, each asked again.
const hashed = (/** @type {string} */ file, /** @type {string} */ text) => {
  const name = file.replace(/\.js$/, `-${hash(text)}.js`)
  writeFileSync(`${out}/${name}`, text)
  return name
}
// The modules it imports are fetched from the start too, beside it, as `modulepreload` has a page say.
let script = readFileSync(`${out}/renderer.js`, "utf8")
const modules = ["web_renderer.js", "text-input.js", "semantics.js", "video.js"].map((module) => [module, hashed(module, readFileSync(`${out}/${module}`, "utf8"))])
for (const [module, name] of modules) script = script.replaceAll(`"./${module}"`, `"./${name}"`)
const preloads = modules.map(([, name]) => `<link rel="modulepreload" href="${name}" crossorigin>\n  `).join("")
writeFileSync(`${out}/index.html`, readFileSync(`${out}/index.html`, "utf8").replace('<script src="renderer.js"', `${preloads}<script src="${hashed("renderer.js", script)}"`))
