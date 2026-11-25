defmodule Encryption.Keyed do
  @moduledoc """
  The codec of an encrypted artifact whose owner was renamed after its keys were made: each blob is encrypted with its
  name as it was then, which is authenticated with it (`client/native/src/cipher.rs`), so it's passed to the keys'
  own codec under that name: its owner's name then, `keyed`, in place of their prefix now. A blob may be of another
  artifact its app opens with these keys, as a Vault item is.
  """

  def encode({{cipher, keys}, prefix, keyed}, name, data), do: cipher.encode(keys, keyed(name, prefix, keyed), data)
  def decode({{cipher, keys}, prefix, keyed}, name, blob), do: cipher.decode(keys, keyed(name, prefix, keyed), blob)

  defp keyed(name, prefix, keyed), do: keyed <> String.replace_prefix(name, prefix, "")
end
