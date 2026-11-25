// Changing a username, as GitHub's Change Username does: Sign In & Security for whoever's looking, and People & Groups
// for anyone, by the network's owners. It says what changes before it's saved, as GitHub warns, and the tool says
// whether the name is free.
import { createSignal } from "solid-js"
import { Button, call, Field, Input, Sheet, styles, Text, tokens, View } from "ui"

const look = styles({
  form: { gap: tokens.length.gutter },
})

/// The rule a username keeps (`OneCore.User.named/1`), as it's said under the field.
export const RULE = "Lowercase letters, digits, dots and hyphens, starting and ending with a letter or a digit."

/// A sheet to change `who`'s username, `users/<username>`, filled in with `username` where one's given, which calls
/// `onChanged` with who they are once it's done.
export function Username(props: { who: string; you: boolean; username?: string; open: boolean; onClose: () => void; onChanged: (who: string) => void }) {
  const was = () => props.who.replace("users/", "")
  const [name, setName] = createSignal(() => props.username ?? was())
  const [error, setError] = createSignal<string>()
  const [working, setWorking] = createSignal(false)
  const save = async () => {
    const username = name().trim().toLowerCase()
    if (username === was()) return props.onClose()
    setWorking(true)
    setError()
    try {
      const { who } = JSON.parse(await call("sign-in_username", props.you ? { username } : { username, who: props.who }))
      props.onChanged(who)
      props.onClose()
    } catch (thrown) {
      setError((thrown as Error).message)
    } finally {
      setWorking(false)
    }
  }
  return (
    <Sheet heading="Change Username" open={props.open} onClose={() => (props.onClose(), setError())}>
      <View style={look.form}>
        <Field label="Username" hint={RULE} error={error()}>
          <Input name="username" required autoFocus autoCapitalize="none" autoComplete="username" spellCheck={false} value={name()} onChangeText={setName} onSubmitEditing={save} />
        </Field>
        <Text>
          {`${props.you ? "Your" : "Their"} addresses, like /git-repos/${was()}/notes, move to the new username, with everything ${props.you ? "you" : "they"} made and installed. The old ones, sharing links, webhooks and git remotes lead to the new one, and nobody else can take ${was()}.`}
        </Text>
        <Button loading={working()} onPress={save}>Change Username</Button>
      </View>
    </Sheet>
  )
}
