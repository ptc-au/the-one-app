// Builds the renderer's frame into a folder, `bun build.js <out>`, as the edge serves it at `/renderer/`
// (core/edge/edge.js): its page and scripts, and the renderer as WebAssembly, built by Cargo, bound to its JS by
// wasm-bindgen and made smaller by binaryen's wasm-opt (mise.toml has both), each once on this machine for what it's made
// from (tooling/cached-build); and the same renderer as plain JavaScript, which renderer.js loads instead where a page's
// frame refuses WebAssembly, as an assistant's chat does where its Content Security Policy has no `'wasm-unsafe-eval'`
// (T3's and VS Code's).
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
for (const file of ["index.html", "renderer.js", "text-input.js", "semantics.js", "video.js", "voice.js", "sound.js", "check.html", "check.js"]) copyFileSync(here(file), `${out}/${file}`)
// The frame's check page, an app's page built as a server builds one (core/ui/app.js), which check.html hosts.
await $`bun ${root}/core/ui/dist/build/app.js ${here("check")} ${out}/check`.quiet()
// What's made of Cargo's WebAssembly, by wasm-bindgen, binaryen's wasm-opt and Brotli at its most, takes most of a build
// (17 of a local network's edge's 28 s to start, 22 Nov), and is the same for the same WebAssembly, so it's kept by its
// hash beside the builds, for every worktree on the machine: a build of a renderer built before copies it.
const stores = `${process.env.XDG_CACHE_HOME ?? `${homedir()}/.cache`}/the-one-app`
/** Gives `make` a folder to make what's made of Cargo's `compiled`, once for each, and copies it into the frame. → its files. */
const kept = async (/** @type {string} */ store, /** @type {string} */ compiled, /** @type {(into: string) => Promise<void>} */ make) => {
  const at = `${store}/${hash(readFileSync(compiled))}`
  if (!existsSync(at)) {
    const making = `${at}-${process.pid}`
    mkdirSync(making, { recursive: true })
    await make(making)
    // Another build of the same renderer that finished first kept the same files.
    try { renameSync(making, at) } catch { rmSync(making, { recursive: true }) }
    // The last few builds used are kept, of the renderers the machine's
    // worktrees build; never one another build is still making (`-<pid>`, while that pid runs), which a dozen side by side lost.
    const unfinished = (/** @type {string} */ name) => name.includes("-") && (() => { try { return process.kill(Number(name.split("-")[1]), 0) } catch { return false } })()
    const older = readdirSync(store).filter((name) => !unfinished(name)).map((name) => `${store}/${name}`).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    for (const old of older.slice(8)) rmSync(old, { recursive: true, force: true })
  }
  // Used now, so it's among the last few another build keeps as it copies it.
  utimesSync(at, new Date(), new Date())
  cpSync(at, out, { recursive: true })
  return readdirSync(at)
}
// Named by what's in it, so a browser keeps it for good (clients/web/_headers) and a new build is a new name, which
// the frame's page and script are given; and kept compressed at Brotli's most too, which the edge sends as it's kept
// (core/edge/web/web.ts).
const named = (/** @type {string} */ into, /** @type {string} */ file, /** @type {string} */ ext, /** @type {Uint8Array} */ bytes) => {
  const name = `${file}-${hash(bytes)}.${ext}`
  writeFileSync(`${into}/${name}`, bytes)
  writeFileSync(`${into}/${name}.br`, brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }))
}

const compiled = (await $`${root}/tooling/cached-build ${here(".")} --target wasm32-unknown-unknown --profile web`.quiet().text()).trim()
const wasm = (await kept(`${stores}/bound`, compiled, async (making) => {
  await $`wasm-bindgen --target web --no-typescript --out-dir ${making} ${compiled}`.quiet()
  // Smaller for the edge to send.
  await $`wasm-opt -Oz --strip-debug --strip-producers ${making}/web_renderer_bg.wasm -o ${making}/web_renderer_bg.wasm`.quiet()
  const bytes = readFileSync(`${making}/web_renderer_bg.wasm`)
  rmSync(`${making}/web_renderer_bg.wasm`)
  named(making, "web_renderer_bg", "wasm", bytes)
})).find((file) => file.endsWith(".wasm"))

// The same renderer as JavaScript, made by binaryen's wasm2js from a build of its own, which has none of the WebAssembly
// features wasm2js has no way to make (`wasm2js` stops at a second table, which wasm-bindgen's `externref` is, and
// at bulk memory, sign extension and saturating float-to-int, which the standard library's code uses, and which
// binaryen's passes lower to what MVP WebAssembly has). Turned off for this build only: the WebAssembly build above
// keeps them.
const mvp = ["-reference-types", "-bulk-memory", "-sign-ext", "-nontrapping-fptoint", "-multivalue"]
const features = ["--enable-bulk-memory", "--enable-sign-ext", "--enable-nontrapping-float-to-int", "--enable-mutable-globals", "--enable-multivalue", "--enable-reference-types"]
const compiledForJs = (await $`${root}/tooling/cached-build ${here(".")} --target wasm32-unknown-unknown --profile web --config ${`target.wasm32-unknown-unknown.rustflags=["-C","target-feature=${mvp.join(",")}"]`}`.env({ ...process.env, CARGO_TARGET_DIR: `${root}/target/javascript` }).quiet().text()).trim()
const javascript = (await kept(`${stores}/bound-javascript`, compiledForJs, async (making) => {
  const work = `${stores}/work-${process.pid}`
  mkdirSync(work, { recursive: true })
  // wasm-bindgen makes what `externref` says only for a module that says it has reference types, which the standard
  // library's code does as it's linked, so the section that says what it has goes, and the module is bound as one that has none.
  await $`wasm-opt ${features} --strip-target-features ${compiledForJs} -o ${work}/renderer.wasm`.quiet()
  await $`wasm-bindgen --target bundler --no-typescript --out-dir ${work} ${work}/renderer.wasm`.quiet()
  await $`wasm-opt ${features.slice(0, -1)} --llvm-memory-copy-fill-lowering --signext-lowering --llvm-nontrapping-fptoint-lowering -Oz --strip-debug --strip-producers ${work}/renderer_bg.wasm -o ${work}/lowered.wasm`.quiet()
  await $`wasm2js -O3 ${work}/lowered.wasm -o ${work}/wasm.js`.quiet()
  // A WebAssembly memory that grows detaches its old buffer, which wasm-bindgen's JS tells by its length (0) to take a
  // view of the new one; wasm2js's keeps the old, still the length it was, so that JS wrote to a memory the code no
  // longer read, and the allocator found its blocks overwritten ("dealloc" panicked). `transfer` detaches it.
  const grow = /var newBuffer = new ArrayBuffer\((\w+) << 16\);\s*var (\w+) = new Int8Array\(newBuffer\);\s*\2\.set\(HEAP8\);/
  const text = readFileSync(`${work}/wasm.js`, "utf8")
  if (!grow.test(text)) throw new Error("wasm2js's memory.grow isn't what the renderer's build patches")
  writeFileSync(`${work}/wasm.js`, text.replace(grow, "var newBuffer = buffer.transfer($1 << 16);"))
  // What wasm-bindgen's `web` build does as it starts (`init`), which has nothing to load here.
  writeFileSync(`${work}/entry.js`, `import * as wasm from "./wasm.js"\nimport { __wbg_set_wasm } from "./renderer_bg.js"\n__wbg_set_wasm(wasm)\nexport * from "./renderer_bg.js"\nexport default async () => {}\n`)
  const [bundle] = (await Bun.build({ entrypoints: [`${work}/entry.js`], target: "browser", format: "esm", minify: true })).outputs
  named(making, "web_renderer_js", "js", new Uint8Array(await bundle.arrayBuffer()))
  rmSync(work, { recursive: true })
})).find((file) => file.endsWith(".js") && !file.endsWith(".br"))
for (const file of ["index.html", "renderer.js"]) writeFileSync(`${out}/${file}`, readFileSync(`${out}/${file}`, "utf8").replaceAll("web_renderer_bg.wasm", wasm).replaceAll("web_renderer_js.js", javascript))
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
const modules = ["web_renderer.js", "text-input.js", "semantics.js", "video.js", "voice.js", "sound.js"].map((module) => [module, hashed(module, readFileSync(`${out}/${module}`, "utf8"))])
for (const [module, name] of modules) script = script.replaceAll(`"./${module}"`, `"./${name}"`)
const preloads = modules.map(([, name]) => `<link rel="modulepreload" href="${name}" crossorigin>\n  `).join("")
writeFileSync(`${out}/index.html`, readFileSync(`${out}/index.html`, "utf8").replace('<script src="renderer.js"', `${preloads}<script src="${hashed("renderer.js", script)}"`))
