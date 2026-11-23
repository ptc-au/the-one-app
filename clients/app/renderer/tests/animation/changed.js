// Which of a pass's folders a change can draw differently, by what it changed since it left main (`git diff` against
// their merge base, with what isn't committed yet): a pass with no folders named draws those, and `--all` every one.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { flag, root } from "./options.js"

const git = (...args) => Bun.spawnSync(["git", "-C", root, ...args]).stdout.toString()

/// What a change to `file` draws differently: everything, where it's what draws every page (the renderer, its tests,
/// the UI library, the Rust they're built with), or the folder it's in.
const everywhere = (file) => ["clients/app/renderer/", "core/ui/", "Cargo.lock", "Cargo.toml"].some((path) => file.startsWith(path)) && !file.startsWith("clients/app/renderer/tests/gallery/")

/// Of `all`, a pass's folders, those this change draws differently, every one with `--all`, saying which on stderr.
export function changed(all) {
  if (flag("--all")) return all
  const base = git("merge-base", "HEAD", "origin/main").trim()
  const files = [...git("diff", "--name-only", base).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean)
  // An app's page is what's in its client; the gallery's, all of it.
  const drawn = (folder) => (existsSync(join(folder, "client")) ? join(folder, "client") : folder)
  const chosen = files.some(everywhere) ? all : all.filter((folder) => files.some((file) => join(root, file).startsWith(`${drawn(folder)}/`)))
  console.error(`${chosen.length === all.length ? "Every folder" : chosen.length ? chosen.map((folder) => folder.slice(root.length)).join(", ") : "Nothing"}: what changed since main (${base.slice(0, 9)}) draws there; name folders, or --all for every one`)
  return chosen
}
