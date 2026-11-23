defmodule GoogleSlides do
  @moduledoc """
  Google Slides: the person's own presentations, through Slides' API (v1), read as text: each slide's title, body
  and speaker notes. Signing in and the accounts are the `google-account` app's, the same for every Google app.
  """
  @behaviour OneCore.App

  @api "https://slides.googleapis.com/v1/"
  @titles ~w(TITLE CENTERED_TITLE)
  @ordered ~r/DECIMAL|ALPHA|ROMAN|ZERO/

  # What the text needs, without the layouts and masters a presentation also holds.
  @fields "presentationId,title,slides(pageElements,slideProperties)"

  # It has no app, so it draws itself, in the App Store.
  @impl true
  def icon, do: "icon.png"

  @impl true
  def requires, do: %{"core" => ">= 0.22.18", "google-account" => "to reach your presentations"}

  # Its person's Google accounts are google-account's, which signs one in with what each Google app asks of Google.
  @impl true
  def hooks, do: ["google-account.scopes"]

  @impl true
  def hook("google-account.scopes", _about, _call), do: ["https://www.googleapis.com/auth/presentations.readonly"]

  @impl true
  def tools do
    string = &%{type: "string", description: &1}
    account = string.("Which account: its address, or a part of it only it has, as google-account_accounts lists them. The first if left out")

    [
      %{
        name: "read",
        read_only: true,
        description:
          "A presentation (Slides' presentations.get): its title, address and, slide by slide in order, each one's title, text (text boxes, tables, grouped shapes) and speaker notes, as markdown.",
        inputs: %{
          type: "object",
          properties: %{
            presentationId:
              string.(
                "The presentation's id, or its address, like https://docs.google.com/presentation/d/1AbC.../edit. google-drive_files_list finds presentations (q mimeType = 'application/vnd.google-apps.presentation' and name contains '...')"
              ),
            account: account
          },
          required: ["presentationId"]
        },
        outputs: %{
          type: "object",
          properties: %{
            id: string.("The presentation's id"),
            title: %{type: "string"},
            url: string.("Its address"),
            slides: %{type: "integer", description: "How many slides it has"},
            text: string.("Each slide's title, text and speaker notes, as markdown")
          },
          required: ["id", "title", "url", "slides", "text"]
        }
      }
    ]
  end

  @impl true
  def call("read", %{"presentationId" => given} = inputs, call) do
    id = id(given)

    presentation =
      request(call, inputs["account"], "GET", @api <> "presentations/" <> URI.encode(id, &URI.char_unreserved?/1),
        query: %{fields: @fields},
        missing: "No presentation #{id}: give its id or its address (docs.google.com/presentation/d/...). google-drive_files_list finds presentations."
      )["body"]

    slides = presentation["slides"] || []

    %{
      id: presentation["presentationId"],
      title: presentation["title"],
      url: "https://docs.google.com/presentation/d/#{presentation["presentationId"]}/edit",
      slides: length(slides),
      text: slides |> Enum.with_index(1) |> Enum.map_join("\n\n", fn {slide, number} -> slide(slide, number) end)
    }
  end

  # A slide as markdown: a heading with its title, what's on it, and its speaker notes.
  defp slide(slide, number) do
    {titles, rest} =
      slide["pageElements"]
      |> flatten()
      |> Enum.split_with(&(get_in(&1, ["shape", "placeholder", "type"]) in @titles))

    title = titles |> Enum.flat_map(&lines/1) |> Enum.join(" ") |> String.trim()
    heading = if title == "", do: "## Slide #{number}", else: "## Slide #{number}: #{title}"
    body = rest |> Enum.flat_map(&lines/1) |> Enum.join("\n") |> String.trim()
    notes = notes(slide)

    [heading, body, if(notes != "", do: "Speaker notes:\n#{notes}", else: "")]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  # A slide's speaker notes: the text of the one shape of its notes page that Slides says holds them.
  defp notes(slide) do
    page = get_in(slide, ["slideProperties", "notesPage"]) || %{}
    id = get_in(page, ["notesProperties", "speakerNotesObjectId"])

    (page["pageElements"] || [])
    |> flatten()
    |> Enum.filter(&(&1["objectId"] == id))
    |> Enum.flat_map(&lines/1)
    |> Enum.join("\n")
    |> String.trim()
  end

  # A page's elements in order, with the ones in a group in place of the group.
  defp flatten(elements) do
    Enum.flat_map(elements || [], fn element ->
      if group = element["elementGroup"], do: flatten(group["children"]), else: [element]
    end)
  end

  defp lines(%{"shape" => %{"text" => text}}), do: paragraphs(text)

  defp lines(%{"table" => table}) do
    rows =
      for row <- table["tableRows"] || [] do
        for cell <- row["tableCells"] || [] do
          cell["text"] |> paragraphs() |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == "")) |> Enum.join("<br>") |> String.replace("|", "\\|")
        end
      end

    case rows do
      [head | rest] ->
        ["| #{Enum.join(head, " | ")} |", "| #{Enum.map_join(head, " | ", fn _ -> "---" end)} |"] ++ Enum.map(rest, &"| #{Enum.join(&1, " | ")} |")

      [] ->
        []
    end
  end

  defp lines(_element), do: []

  # The paragraphs of a text, each a line, with a list's items as markdown items. Slides gives a text as runs, each
  # paragraph starting at a paragraphMarker.
  defp paragraphs(text) do
    {paragraphs, _counters} =
      Enum.reduce(text["textElements"] || [], {[], %{}}, fn element, {paragraphs, counters} ->
        cond do
          marker = element["paragraphMarker"] ->
            {counters, mark} = bullet(marker["bullet"], text["lists"], counters)
            {[{mark, ""} | paragraphs], counters}

          run = element["textRun"] ->
            {add(paragraphs, run["content"]), counters}

          auto = element["autoText"] ->
            {add(paragraphs, auto["content"] || ""), counters}

          true ->
            {paragraphs, counters}
        end
      end)

    paragraphs |> Enum.reverse() |> Enum.map(fn {mark, text} -> mark <> String.trim_trailing(text) end) |> Enum.reject(&(&1 == ""))
  end

  defp add([{mark, text} | paragraphs], content),
    do: [{mark, text <> (content |> String.replace(~r/\n$/, "") |> String.replace("\v", "\n"))} | paragraphs]

  defp add([], content), do: [{"", content}]

  defp bullet(%{"listId" => list} = bullet, lists, counters) do
    level = bullet["nestingLevel"] || 0
    glyph = get_in(lists, [list, "listProperties", "nestingLevels", Access.at(level), "glyphType"]) || ""
    counters = Map.update(counters, {list, level}, 1, &(&1 + 1))
    mark = if glyph =~ @ordered, do: "#{counters[{list, level}]}.", else: "-"
    {counters, "#{String.duplicate("  ", level)}#{mark} "}
  end

  defp bullet(_none, _lists, _counters), do: {%{}, ""}

  defp id(given) do
    given = String.trim(given)
    if given == "", do: raise("Give presentationId: the presentation's id or address.")

    case Regex.run(~r/\/d\/([a-zA-Z0-9_-]+)/, given) do
      [_all, id] -> id
      nil -> given
    end
  end

  # Google's API as the account names, through google-account, which gives the answer's status, headers and body, or
  # raises with what went wrong.
  defp request(call, account, method, url, options),
    do: OneCore.Call.tool(call, "google-account", "request", JSON.decode!(JSON.encode!(Map.new([account: account, method: method, url: url] ++ options))))
end
