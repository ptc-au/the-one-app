defmodule Raster do
  @moduledoc """
  Photos and PDF pages: the images app's NIF (`nif/raster`), which its Elixir calls. A file is opened, drawn on,
  cropped and made smaller, and given back as a JPEG.
  """
  use OneCore.Nif

  @doc """
  Opens a photo (JPEG, PNG or WebP, turned upright as its camera recorded) or a page of a PDF and gives
  `{:ok, {jpeg, width, height}}`, or `{:error, why}`. `options` is a map: `page` (a PDF's, from 0), `render` (a PDF
  page's long side in pixels before it's cropped), `crop` (`[left, top, right, bottom]` as fractions of the picture, or `[]`),
  `max` (the long side it's made smaller to, 0 to keep it), `enlarge`, `quality` and `cover` (rectangles drawn over,
  as `crop` is, before it's cropped).
  """
  def render(_file, _options), do: :erlang.nif_error(:nif_not_loaded)

  @doc "A PDF's pages, each whether it's typed: it shows text, not only a scan. `{:ok, [boolean]}`."
  def pdf(_file), do: :erlang.nif_error(:nif_not_loaded)
end
