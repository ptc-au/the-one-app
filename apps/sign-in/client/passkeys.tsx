// Sign In & Security: the passkeys whoever's looking signs in with. One is removed here, but never the last, which says so before
// it's pressed. Another is made in the device's own browser, which has passkeys where an app's web view doesn't,
// by a link that works once. Each says whether it unlocks their key on a new device: one whose PRF output derives a
// key, which it says the next time it's used, gets the key encrypted to it by a device that holds it, here, once its
// person says it may. Whoever uses it has their key from then on, so a passkey nobody here allowed never does. Above
// them are the servers waiting for a key that a passkey hands over, their person's own or a group's or the
// network's they own, each with Use Passkey, which opens the sign-in page to do it (`unlock_with_passkey`).
import { createEffect, createMemo, createProjection, Errored, Loading, refresh, Show } from "solid-js"
import { Avatar, Button, call, changed, client, confirm, date, List, open, pickFiles, Problem, refreshAvatars, Row, Screen, Section, Spinner, toast, upload, visible } from "ui"
import { Remove } from "./mine.tsx"
import { Username } from "./username.tsx"

/** A passkey, as `sign-in_devices` answers it. */
interface Passkey {
  id: string
  name: string
  added: string
  prf_key: string | null
  unlocks: boolean
  code: string | null
  /** The device whose Add Passkey made it. */
  from: string | null
}

const mineAnswer = createProjection(() => call("sign-in_devices").then((text): { passkeys: Passkey[] } => JSON.parse(text)))
const mine = () => mineAnswer
/// Whether this device holds its person's key, which it encrypts to their passkeys.
const holdsAnswer = createProjection(() => call("encryption_key").then((text): { slot: string | null } => JSON.parse(text)))
const holds = () => holdsAnswer.slot != null
/** What `encryption_key` says of a key: whose it is, a group's or the network's encrypted to the person's own, and the servers that should hold the keys of what it encrypts and don't. */
interface Held {
  owner: string
  wrapped: string | null
  /** Left out by a server whose Encryption is older than the page, as one that's behind is (`encryption_key`'s `access` came 20 Nov). */
  access?: { missing: { key: string; name: string | null }[] }[]
}

/// Sets the picture they're shown by to one they choose from their device, which is made square and small from its middle, or
/// takes it away, which leaves Google's where signing in with Google gave one.
async function choose(upload_: boolean) {
  try {
    if (upload_) {
      const [file] = await pickFiles({ accept: ["image/*"] })
      if (!file) return
      await call("sign-in_picture", { upload: await upload(file) })
    } else await call("sign-in_picture")
  } catch (error) {
    toast(error as Error)
  }
  refreshAvatars()
  refresh(youAnswer)
}

/// Their picture, with how they came to have it, and a way to choose another, which wins over Google's.
function Picture() {
  const source = () => you().picture
  return (
    <Section heading="Picture">
      <List>
        <Row
          start={<Avatar subject={you().who} name={you().called ?? undefined} size="large" />}
          heading={you().called ?? "You"}
          text={source() === "own" ? "The picture you chose." : source() === "google" ? "From your Google account. Choose one to use instead." : "Your initials. Choose a picture to be known by."}
          action={
            <>
              <Button variant="secondary" onPress={() => choose(true)}>Choose Picture</Button>
              <Show when={source() === "own"}>
                <Button variant="ghost" onPress={() => choose(false)}>Remove</Button>
              </Show>
            </>
          }
        />
      </List>
    </Section>
  )
}

/// What's open, as the section's screen says it (`settings_section`'s own arguments): the form to change their username
/// over it, `form: "username"`, filled in with `username` where it's given (`sign-in_username`'s), a step Back goes back
/// from.
interface Shown {
  inputs: { form?: "username"; username?: string }
  show: (inputs?: { form: "username" }) => void
}

/// Their username, which their addresses are under, to change, as GitHub's account settings have it.
function Handle(props: { open: boolean; username?: string; show: Shown["show"] }) {
  const name = () => you().who.replace("users/", "")
  return (
    <Section heading="Username">
      <List>
        <Row
          heading={name()}
          text={`Your addresses are under it, like /git-repos/${name()}/notes.`}
          action={<Button variant="secondary" onPress={() => props.show({ form: "username" })}>Change</Button>}
        />
      </List>
      <Username who={you().who} you username={props.username} open={props.open} onClose={() => props.show()} onChanged={() => refresh(youAnswer)} />
    </Section>
  )
}

/// The servers waiting for a key a passkey of this person's hands them: their own, and those of the network and the
/// groups they own, whose keys are encrypted to theirs. One row each, by whose key it is.
const waitingForAnswer = createProjection(async () => {
  const me: Held = JSON.parse(await call("encryption_key"))
  const groups: { group: string; owners: string[] }[] = JSON.parse(await call("permissions_groups")).groups
  // A key's `owner` is who it was made for, by the username they had then: the groups they own say who they are now.
  const who: string = JSON.parse(await call("sign-in_people")).people[0].who
  const scopes = ["network", ...groups.filter((group) => group.owners.includes(who)).map((group) => group.group)]
  const theirs = await Promise.all(scopes.map((subject) => call("encryption_key", {}, { subject }).then((text): Held => JSON.parse(text), () => null)))
  return {
    waiting: [me, ...theirs.filter((held): held is Held => !!held?.wrapped)]
      .map((held) => ({ scope: held.owner === me.owner ? undefined : held.owner, servers: [...new Set((held.access ?? []).flatMap((artifact) => artifact.missing.map((server) => server.name ?? server.key.slice(0, 8))))] }))
      .filter((waiting) => waiting.servers.length),
  }
})
const waitingFor = () => waitingForAnswer.waiting
/// Who they are here, and whose picture they're shown by: the one they set (`own`), Google's, or none.
const youAnswer = createProjection(() => call("sign-in_people").then((text): { people: { who: string; called: string | null; picture: "own" | "google" | null }[] } => JSON.parse(text)))
const you = () => youAnswer.people[0]

const again = () => [mineAnswer, holdsAnswer, waitingForAnswer, youAnswer].forEach(refresh)
changed(again)
// A passkey made or used in the browser says its key there, which nothing here hears of: it's looked at again as
// this screen comes back.
createEffect(visible, (now, was) => void (now && was === false && again()))

/// Whether a passkey could unlock the key, and waits for its person to say it may.
const waiting = (passkey: Passkey) => !!passkey.prf_key && !passkey.unlocks

/// What a passkey does for a new device: unlocks the key there, can't, waits to be allowed, or hasn't said since it
/// was made.
const unlocks = (passkey: Passkey) =>
  passkey.unlocks
    ? "Unlocks your key on a new device"
    : passkey.prf_key === ""
      ? "Can't unlock your key on a new device"
      : passkey.prf_key
        ? "Waiting for you to allow it"
        : "Set it up to unlock your key on a new device"

/// Asks whether a new passkey may unlock the key, then encrypts the key to it from this device, which holds it.
async function allow(passkey: Passkey) {
  const when = new Date(passkey.added).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  const question = {
    heading: "Let it unlock your encrypted data?",
    text: `${passkey.name}, added ${date(passkey.added)} at ${when}. The sign-in page showed a code as you set it up: allow it only if that code is ${passkey.code}. Whoever uses it can open everything encrypted for you.`,
    action: "Allow",
  }
  if (!(await confirm(question))) return
  await call("sign-in_encrypt_for_passkeys", { passkey: passkey.id, code: passkey.code }).catch(toast)
  refresh(mineAnswer)
}

/// This device, which lets a passkey its own Add Passkey made unlock the key at once, where it holds it: that link was
/// shown only here, and the edge ties the passkey to it (`from`, `edge/auth.ts`), so there's no code to check.
const here = createMemo(() => client().then((it) => it.device))
const allowing = new Set<string>()
createEffect(
  () => [mine(), holds(), here()] as const,
  ([list, holding, device]) => {
    if (!holding) return
    for (const passkey of list.passkeys.filter((passkey) => waiting(passkey) && passkey.from === device && !allowing.has(passkey.id))) {
      allowing.add(passkey.id)
      call("sign-in_encrypt_for_passkeys", { passkey: passkey.id, code: passkey.code }).then(() => refresh(mineAnswer), toast)
    }
  },
)

async function remove(passkey: Passkey) {
  if (!(await confirm({ heading: `Remove ${passkey.name}?`, text: "You won't be able to sign in with it again, or unlock your key with it.", action: "Remove", destructive: true }))) return
  await call("sign-in_remove_passkey", { passkey: passkey.id }).catch(toast)
  refresh(mineAnswer)
}

/// Opens a link in the device's browser, from a tool that makes it.
const opens = (tool: string, inputs?: object) => async () => {
  try {
    await open(JSON.parse(await call(tool, inputs)).link)
  } catch (error) {
    toast(error as Error)
  }
}

/// Whose key servers wait for, as a row says it.
const whose = (scope?: string) => (scope === undefined ? "your" : scope === "network" ? "the network's" : `${scope.split("/").pop()}'s`)
const listed = (names: string[]) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)

/// The servers waiting for a key, in one row whose passkey hands each its keys at once (the sign-in page's Unlock with
/// Passkey, with no `scope`, hands over every key the person's opens).
function Waiting() {
  const servers = () => [...new Set(waitingFor()?.flatMap((waiting) => waiting.servers))]
  const keys = () => {
    const named = waitingFor()?.map((waiting) => whose(waiting.scope)) ?? []
    return named.length === 1 ? `${named[0]} key` : `${listed(named)} keys`
  }
  return (
    <Show when={waitingFor()?.length}>
      <Section heading="Waiting for Your Passkey">
        <List>
          <Row
            heading={`${listed(servers())} ${servers().length === 1 ? "is" : "are"} waiting for ${keys()}`}
            text={`Your passkey hands ${waitingFor()!.length === 1 ? "it" : "them"} over.`}
            action={<Button variant="secondary" onPress={opens("sign-in_unlock_with_passkey")}>Use Passkey</Button>}
          />
        </List>
      </Section>
    </Show>
  )
}

// A button of its own for each screen that has it: one made here would be shared by all, outside any of them.
const opening = () => <Button onPress={opens("sign-in_add_passkey")}>Add Passkey</Button>

// The devices are read by `<Show>`, outside the `<Screen>`, which keeps what's thrown inside it to itself and draws nothing.
/// Sign In & Security, as Settings draws it: a section of its own, which Back leaves on a phone.
export default function SignInAndSecurity(props: Shown) {
  return (
  <Errored
    fallback={(error, retry) => (
      <Screen heading="Sign In & Security" back action={opening()}>
        <Problem
          heading="Can't show your passkeys"
          text={error() as Error}
          action={<Button onPress={() => (refresh(mineAnswer), retry())}>Try Again</Button>}
        />
      </Screen>
    )}
  >
    <Loading fallback={<Screen heading="Sign In & Security" back action={opening()}><Spinner delay /></Screen>}>
      <Show when={mine()}>
        {(all) => (
          <Screen heading="Sign In & Security" back action={all().passkeys.length ? opening() : undefined}>
            <Picture />
            <Handle open={props.inputs.form === "username"} username={props.inputs.username} show={props.show} />
            <Waiting />
            <Show
              when={all().passkeys.length}
              fallback={
                <List>
                  <Row heading="No passkey" text="Add one to sign in on a new device, and to unlock your key there." action={<Button variant="secondary" onPress={opens("sign-in_add_passkey")}>Add Passkey</Button>} />
                </List>
              }
            >
            <List each={all().passkeys} keyed={(passkey) => passkey.id}>
          {(passkey) => {
            const only = () => all().passkeys.length === 1
            // What it can do now, under its words on a phone; the trash after it there, and beside the words where it has none.
            const set = () => passkey().prf_key === null
            const allows = () => !set() && waiting(passkey()) && holds()
            const trash = () => <Remove name={passkey().name} disabled={only()} onPress={() => remove(passkey())} />
            return (
              <Row
                heading={passkey().name}
                text={`${unlocks(passkey())} · ${only() ? "Your only one" : `Made ${date(passkey().added)}`}`}
                end={set() || allows() ? undefined : trash()}
                action={
                  set() || allows() ? (
                    <>
                      {set() ? (
                        <Button variant="secondary" onPress={opens("sign-in_unlock_with_passkey")}>Set Up</Button>
                      ) : (
                        <Button variant="secondary" onPress={() => allow(passkey())}>Allow</Button>
                      )}
                      {trash()}
                    </>
                  ) : undefined
                }
              />
            )
          }}
            </List>
            </Show>
          </Screen>
        )}
      </Show>
    </Loading>
  </Errored>
)
}
