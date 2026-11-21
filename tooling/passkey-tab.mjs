// The sign-in page in one browser tab, as an iPhone's Safari reuses one: `bun tooling/passkey-tab.mjs <first> <then>`
// opens <first> (Unlock with Passkey's link), then <then> (Add Passkey's) in the same tab, presses Create a passkey with
// Chrome's virtual passkey, which has PRF, and prints what the page says then. The app harness's `passkey` check.
import { chromium } from "../core/ui/node_modules/playwright-core/index.mjs"

const [first, then] = process.argv.slice(2)
// WebGPU drawn on the CPU, as scenes.js draws the web.
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--use-webgpu-adapter=opengles"] })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } })
  const says = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))
  await page.goto(first)
  await page.getByRole("button", { name: "Continue" }).waitFor({ timeout: 20_000 })
  await page.goto(then)
  // What the page draws is on its canvas, so the button is pressed where its accessible node is.
  const create = page.getByRole("button", { name: /create a passkey/i })
  await create.waitFor({ timeout: 20_000 })
  const box = await create.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForFunction(() => /created|wasn't|Not saved/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {})
  console.log(await says())
} finally {
  await browser.close()
}
