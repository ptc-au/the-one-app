defmodule GoogleDocs.Markdown do
  @moduledoc """
  Markdown (parsed by `EarmarkParser`) as the `batchUpdate` requests that write it into an empty document or tab:
  one `insertText` of its text, then each paragraph's style, each run's text style and, last, its lists, since
  `createParagraphBullets` takes the tabs that nest an item out of the text and so moves every index after it. Docs
  counts indexes in UTF-16 code units, so a character outside the Basic Multilingual Plane, an emoji, counts for two.
  """

  @code_font "Courier New"
  @reset "bold,italic,strikethrough,underline,link,weightedFontFamily"

  @doc "The requests that write `markdown` at the start of the body of `tab` (its id, or `nil` for the first), or `[]` for none."
  def requests(markdown, tab) do
    {:ok, ast, _messages} = EarmarkParser.as_ast(markdown)

    case ast |> Enum.flat_map(&block(&1, false)) |> place(1) do
      {[], _end} ->
        []

      {paragraphs, last} ->
        text = Enum.map_join(paragraphs, "\n", & &1.text)
        everything = %{startIndex: 1, endIndex: last}

        [
          %{insertText: %{text: text, location: at(1, tab)}},
          %{updateTextStyle: %{range: range(everything, tab), textStyle: %{}, fields: @reset}},
          %{deleteParagraphBullets: %{range: range(everything, tab)}}
          | paragraph_styles(paragraphs, tab) ++ text_styles(paragraphs, tab) ++ bullets(paragraphs, tab)
        ]
    end
  end

  # What a block is: its paragraphs, each with its runs of text and its style (Docs' ParagraphStyle) as `kind` says.
  defp block({"h" <> level, _attrs, children, _meta}, _quote) when level in ~w(1 2 3 4 5 6),
    do: [paragraph(children, %{namedStyleType: "HEADING_#{level}"})]

  defp block({"p", _attrs, children, _meta}, quote?), do: [paragraph(children, normal(quote?))]

  defp block({"blockquote", _attrs, children, _meta}, _quote),
    do: Enum.flat_map(children, &block(&1, true))

  defp block({list, _attrs, items, _meta}, _quote) when list in ["ul", "ol"],
    do: list(items, list == "ol", make_ref(), 0)

  defp block({"pre", _attrs, [{"code", _, [code], _}], _meta}, _quote) do
    lines = code |> String.trim_trailing("\n") |> String.split("\n")

    for {line, number} <- Enum.with_index(lines, 1) do
      last = number == length(lines)
      grey = %{color: %{rgbColor: %{red: 0.95, green: 0.95, blue: 0.95}}}
      style = %{namedStyleType: "NORMAL_TEXT", spaceBelow: points(if(last, do: 8, else: 0)), shading: %{backgroundColor: grey}}
      %{runs: [{line, %{code: true}}], style: style}
    end
  end

  defp block({"hr", _attrs, _children, _meta}, _quote) do
    line = %{color: %{color: %{rgbColor: %{red: 0.7, green: 0.7, blue: 0.7}}}, width: points(1), padding: points(1), dashStyle: "SOLID"}
    [%{runs: [], style: Map.put(normal(false), :borderBottom, line)}]
  end

  # A table has no place in a paragraph: each row is one, its cells apart by " | " and the heading row bold.
  defp block({"table", _attrs, parts, _meta}, _quote),
    do: for({section, _, rows, _} <- parts, row <- rows, do: row_paragraph(row, if(section == "thead", do: %{bold: true}, else: %{})))

  defp block(text, quote?) when is_binary(text),
    do: if(String.trim(text) == "", do: [], else: [paragraph([text], normal(quote?))])

  defp block({_tag, _attrs, children, _meta}, quote?), do: [paragraph(children, normal(quote?))]

  defp row_paragraph({"tr", _, cells, _}, style) do
    runs =
      cells
      |> Enum.map(fn {_cell, _, children, _} -> inline(children, style) end)
      |> Enum.intersperse([{" | ", %{}}])
      |> Enum.concat()

    %{runs: runs, style: Map.put(normal(false), :spaceBelow, points(0))}
  end

  # A list's items, each nested list after the item that has it, as Docs nests them: one level deeper by a tab.
  defp list(items, ordered, id, level) do
    Enum.flat_map(items, fn {"li", _attrs, children, _meta} ->
      {nested, text} = Enum.split_with(children, &match?({tag, _, _, _} when tag in ["ul", "ol"], &1))

      text =
        Enum.flat_map(text, fn
          {"p", _, content, _} -> content
          other -> [other]
        end)

      item = %{runs: [{String.duplicate("\t", level), %{}} | inline(text, %{})], style: %{namedStyleType: "NORMAL_TEXT", spaceBelow: points(2)}, list: {id, ordered}}
      [item | Enum.flat_map(nested, fn {tag, _, items, _} -> list(items, tag == "ol", id, level + 1) end)]
    end)
  end

  defp normal(quote?) do
    base = %{namedStyleType: "NORMAL_TEXT", spaceBelow: points(8), indentStart: points(0), indentFirstLine: points(0)}

    if quote? do
      bar = %{color: %{color: %{rgbColor: %{red: 0.7, green: 0.7, blue: 0.7}}}, width: points(3), padding: points(8), dashStyle: "SOLID"}
      Map.merge(base, %{indentStart: points(36), indentFirstLine: points(36), borderLeft: bar})
    else
      base
    end
  end

  defp paragraph(children, style), do: %{runs: inline(children, %{}), style: style}

  # A paragraph's text in runs, each with the style it has: bold, italic, strikethrough, code or a link.
  defp inline(nodes, style), do: Enum.flat_map(nodes, &inline_node(&1, style))

  defp inline_node(text, style) when is_binary(text), do: [{String.replace(text, ~r/\s*\n\s*/, " "), style}]
  defp inline_node({"strong", _, children, _}, style), do: inline(children, Map.put(style, :bold, true))
  defp inline_node({"em", _, children, _}, style), do: inline(children, Map.put(style, :italic, true))
  defp inline_node({"del", _, children, _}, style), do: inline(children, Map.put(style, :strikethrough, true))
  defp inline_node({"code", _, children, _}, style), do: inline(children, Map.put(style, :code, true))
  defp inline_node({"br", _, _, _}, style), do: [{"\v", style}]
  defp inline_node({"a", attrs, children, _}, style), do: inline(children, Map.put(style, :link, List.keyfind(attrs, "href", 0, {nil, nil}) |> elem(1)))
  defp inline_node({"img", attrs, _, _}, style), do: [{List.keyfind(attrs, "alt", 0, {nil, ""}) |> elem(1), style}]
  defp inline_node({_tag, _, children, _}, style), do: inline(children, style)

  # Each paragraph's text and where it starts, from index `from`, and the index after the last one's end.
  defp place(paragraphs, from) do
    {placed, next} =
      Enum.map_reduce(paragraphs, from, fn paragraph, start ->
        text = Enum.map_join(paragraph.runs, &elem(&1, 0))
        {Map.merge(paragraph, %{text: text, start: start}), start + size(text) + 1}
      end)

    {placed, next}
  end

  defp paragraph_styles(paragraphs, tab) do
    paragraphs
    |> Enum.chunk_by(& &1.style)
    |> Enum.map(fn [first | _] = chunk ->
      last = List.last(chunk)
      range = %{startIndex: first.start, endIndex: last.start + size(last.text) + 1}
      %{updateParagraphStyle: %{range: range(range, tab), paragraphStyle: first.style, fields: fields(first.style)}}
    end)
  end

  defp text_styles(paragraphs, tab) do
    for paragraph <- paragraphs,
        {{text, style}, offset} <- Enum.zip(paragraph.runs, offsets(paragraph.runs, paragraph.start)),
        style != %{} and String.trim(text) != "" do
      {text_style, fields} = text_style(style)
      range = %{startIndex: offset, endIndex: offset + size(text)}
      %{updateTextStyle: %{range: range(range, tab), textStyle: text_style, fields: fields}}
    end
  end

  defp offsets(runs, start) do
    {offsets, _end} = Enum.map_reduce(runs, start, fn {text, _style}, from -> {from, from + size(text)} end)
    offsets
  end

  defp text_style(style) do
    pairs =
      for {key, value} <- style do
        case key do
          :code -> {{:weightedFontFamily, %{fontFamily: @code_font}}, "weightedFontFamily"}
          :link -> {{:link, %{url: value}}, "link"}
          other -> {{other, value}, to_string(other)}
        end
      end

    {Map.new(pairs, &elem(&1, 0)), pairs |> Enum.map(&elem(&1, 1)) |> Enum.sort() |> Enum.join(",")}
  end

  # A list is its run of items, as its first one's tabs and the items after it, later ones first so that the
  # tabs one takes out move none that is still to come.
  defp bullets(paragraphs, tab) do
    paragraphs
    |> Enum.chunk_by(&Map.get(&1, :list))
    |> Enum.reject(&(Map.get(hd(&1), :list) == nil))
    |> Enum.reverse()
    |> Enum.map(fn [first | _] = items ->
      last = List.last(items)
      {_id, ordered} = first.list
      preset = if ordered, do: "NUMBERED_DECIMAL_ALPHA_ROMAN", else: "BULLET_DISC_CIRCLE_SQUARE"
      range = %{startIndex: first.start, endIndex: last.start + size(last.text) + 1}
      %{createParagraphBullets: %{range: range(range, tab), bulletPreset: preset}}
    end)
  end

  defp fields(style), do: style |> Map.keys() |> Enum.sort() |> Enum.join(",")

  defp points(magnitude), do: %{magnitude: magnitude, unit: "PT"}

  defp at(index, nil), do: %{index: index}
  defp at(index, tab), do: %{index: index, tabId: tab}

  defp range(range, nil), do: range
  defp range(range, tab), do: Map.put(range, :tabId, tab)

  # A text's length in UTF-16 code units, as Docs' indexes count: two for a character beyond U+FFFF.
  defp size(text), do: for(<<char::utf8 <- text>>, reduce: 0, do: (size -> size + if(char > 0xFFFF, do: 2, else: 1)))
end
