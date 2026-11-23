// What the UI library is built from: what git has in this folder, and DESIGN.md, as their hash, which its build keeps
// (`dist/.inputs`), so a build of those is as good as another, whatever the files' times (a pull or a rebase rewrites
// them unchanged).
import { readFileSync } from "node:fs"
import { join } from "node:path"

export function inputs() {
  const here = import.meta.dir
  const listed = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard", "-z", ".", "../../DESIGN.md"], { cwd: here }).stdout.toString()
  const hasher = new Bun.CryptoHasher("sha256")
  for (const file of listed.split("\0").filter(Boolean).sort()) hasher.update(file).update(readFileSync(join(here, file)))
  return hasher.digest("hex")
}
