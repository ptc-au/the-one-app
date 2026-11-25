defmodule OneCore.Icon do
  @moduledoc "Checking an app's icon as a deploy does (`OneCore.Apps.Deploy`): a server's Rust NIF (`nif/icon`)."
  use OneCore.Nif, library: "icon"

  @doc """
  Whether `data`, a picture of the MIME type `kind`, is a square opaque to its corners, as every client clips an
  app's icon to its squircle: `:ok`, or `{:error, why}`.
  """
  def check(_data, _kind), do: :erlang.nif_error(:nif_not_loaded)
end
