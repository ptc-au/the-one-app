defmodule Images do
  @moduledoc """
  Images: photos and PDF pages made small, cropped and drawn on, for an app that requires it. It gives functions only,
  which run inside the app that calls them (`OneCore.Call.app(call, "images")`).

      images = OneCore.Call.app(call, "images")
      {:ok, %{data: jpeg}} = images.render(photo, max: 1600)
  """
  @behaviour OneCore.App

  @impl true
  def icon, do: "icon.svg"

  @impl true
  def requires, do: %{"core" => ">= 0.37.0"}

  @defaults %{page: 0, render: 1600, crop: [], max: 0, enlarge: false, quality: 85, cover: []}

  @doc """
  A photo (JPEG, PNG or WebP) or a page of a PDF as a JPEG: `{:ok, %{data: jpeg, width: w, height: h}}`, or
  `{:error, why}`. Options: `page` (a PDF's, from 0), `render` (a PDF page's long side in pixels, 1600), `crop`
  (`[left, top, right, bottom]` as fractions of the picture, from its top left), `max` (the long side it's made
  smaller to), `enlarge` (made bigger to `max` too), `quality` (85) and `cover` (rectangles, as `crop` is, drawn over
  in dark grey before it's cropped).
  """
  def render(file, options \\ []) when is_binary(file) do
    case Raster.render(file, Map.merge(@defaults, Map.new(options))) do
      {:ok, {data, width, height}} -> {:ok, %{data: data, width: width, height: height}}
      {:error, why} -> {:error, why}
    end
  end

  @doc "A PDF's pages, each whether it's typed: it shows text, not only a scan. `{:ok, [boolean]}` or `{:error, why}`."
  def pdf(file) when is_binary(file), do: Raster.pdf(file)

  @doc """
  JPEGs as one PDF, a page each, A4 wide and as tall as its photo. `{:ok, pdf}`, or `{:error, why}` where one isn't a JPEG.
  """
  def pdf_of(photos) when is_list(photos) do
    with {:ok, sizes} <- sizes(photos) do
      pages = Enum.with_index(photos)

      objects =
        Enum.flat_map(Enum.zip(pages, sizes), fn {{photo, i}, {width, height, gray}} ->
          page(photo, i, width, height, gray)
        end)

      kids = Enum.map_join(pages, " ", fn {_, i} -> "#{3 + i * 3} 0 R" end)

      body =
        [{1, "<< /Type /Catalog /Pages 2 0 R >>"}, {2, "<< /Type /Pages /Kids [#{kids}] /Count #{length(photos)} >>"}] ++
          objects

      {iodata, offsets, size} =
        Enum.reduce(body, {["%PDF-1.4\n"], [], 9}, fn {n, content}, {out, offsets, at} ->
          object = [Integer.to_string(n), " 0 obj\n", content, "\nendobj\n"]
          {[out, object], [{n, at} | offsets], at + IO.iodata_length(object)}
        end)

      table =
        offsets
        |> Enum.sort()
        |> Enum.map_join(fn {_, at} -> "#{String.pad_leading(Integer.to_string(at), 10, "0")} 00000 n \n" end)

      count = length(offsets) + 1

      trailer =
        "xref\n0 #{count}\n0000000000 65535 f \n#{table}trailer\n<< /Size #{count} /Root 1 0 R >>\nstartxref\n#{size}\n%%EOF\n"

      {:ok, IO.iodata_to_binary([iodata, trailer])}
    end
  end

  # Objects of a page of a photo: the page, what it draws, and the photo.
  defp page(photo, i, width, height, gray) do
    n = 3 + i * 3
    w = 595
    h = round(595 * height / width)
    draw = "q #{w} 0 0 #{h} 0 0 cm /P Do Q"
    space = if gray, do: "DeviceGray", else: "DeviceRGB"

    [
      {n,
       "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 #{w} #{h}] /Resources << /XObject << /P #{n + 2} 0 R >> >> /Contents #{n + 1} 0 R >>"},
      {n + 1, "<< /Length #{byte_size(draw)} >>\nstream\n#{draw}\nendstream"},
      {n + 2,
       [
         "<< /Type /XObject /Subtype /Image /Width #{width} /Height #{height} /ColorSpace /#{space} /BitsPerComponent 8 /Filter /DCTDecode /Length #{byte_size(photo)} >>\nstream\n",
         photo,
         "\nendstream"
       ]}
    ]
  end

  defp sizes(photos) do
    Enum.reduce_while(photos, {:ok, []}, fn photo, {:ok, sizes} ->
      case size(photo) do
        {:ok, size} -> {:cont, {:ok, sizes ++ [size]}}
        :error -> {:halt, {:error, "Only photos can be joined."}}
      end
    end)
  end

  # A JPEG's size and whether it's grey, from its frame header.
  defp size(<<0xFF, 0xD8, rest::binary>>), do: frame(rest)
  defp size(_), do: :error

  defp frame(<<0xFF, marker, _length::16, _precision, height::16, width::16, components, _::binary>>)
       when marker in 0xC0..0xC2,
       do: {:ok, {width, height, components == 1}}

  defp frame(<<0xFF, _marker, size::16, rest::binary>>) when size >= 2 and byte_size(rest) >= size - 2 do
    frame(binary_part(rest, size - 2, byte_size(rest) - (size - 2)))
  end

  defp frame(_), do: :error
end
