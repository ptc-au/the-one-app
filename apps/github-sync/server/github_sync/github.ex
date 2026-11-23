defmodule GitHubSync.GitHub do
  @moduledoc """
  GitHub, as its GitHub App reaches it: its REST API with an installation's token, and git's smart HTTP protocol with
  the same token, as `actions/checkout` sends it (an `Authorization` header, never in a command line or a URL).

  A push goes straight to GitHub's `git-receive-pack` with the pack git sent the network, as a proxy passes it on:
  thin against what the network has, which GitHub has too, since everything the network has of a synced repo came
  from GitHub or went there first. A sync fetches GitHub into a bare mirror of it on the server that runs it, in the
  app's folder: a cache, fetched each time it's used.
  """
  alias OneCore.Call

  @api "https://api.github.com"
  @zero String.duplicate("0", 40)
  # How long git is given: a first fetch of a large repo takes minutes.
  @timeout 600

  def zero, do: @zero

  @doc "Makes a GitHub App from the manifest flow's `code`, as GitHub's docs say: its id, slug, owner and private key."
  def convert(call, code) do
    if not (code =~ ~r/^[A-Za-z0-9_-]+$/), do: raise(OneCore.Call.Refused, "That isn't a code GitHub gives.")
    request(call, "POST", "/app-manifests/#{code}/conversions", nil, nil)
  end

  @doc "A token for the app's installation on `org`, good for an hour, from its private key `pem`."
  def token(call, app_id, org, pem) do
    jwt = jwt(app_id, pem)
    %{"id" => installation} = request(call, "GET", "/orgs/#{org}/installation", nil, {:bearer, jwt})
    request(call, "POST", "/app/installations/#{installation}/access_tokens", nil, {:bearer, jwt})["token"]
  end

  # A JSON Web Token that says it's the app, signed with its key (RS256), as GitHub asks for: issued a minute ago, for
  # clocks that differ, and good for nine more.
  defp jwt(app_id, pem) do
    now = System.system_time(:second)
    encode = &Base.url_encode64(JSON.encode!(&1), padding: false)
    signed = encode.(%{alg: "RS256", typ: "JWT"}) <> "." <> encode.(%{iat: now - 60, exp: now + 540, iss: app_id})
    [entry] = :public_key.pem_decode(pem)
    signed <> "." <> Base.url_encode64(:public_key.sign(signed, :sha256, :public_key.pem_entry_decode(entry)), padding: false)
  end

  @doc "The repos the app's installation reaches, by their full names: owner/name."
  def repos(call, token, page \\ 1) do
    %{"repositories" => repos} = request(call, "GET", "/installation/repositories?per_page=100&page=#{page}", nil, {:token, token})
    fulls = for %{"full_name" => full} <- repos, do: full
    if length(repos) == 100, do: fulls ++ repos(call, token, page + 1), else: fulls
  end

  @doc """
  Makes the repo `name` on `org` as the app, which its installation then reaches whichever repos it was given
  (GitHub's "Create an organization repository", with Administration: write). Gives its full name.
  """
  def create(call, token, org, name, private) do
    request(call, "POST", "/orgs/#{org}/repos", %{name: name, private: private}, {:token, token})["full_name"]
  end

  @doc "Deletes the repo `full` on GitHub, as the app (GitHub's \"Delete a repository\", with Administration: write)."
  def delete(call, token, full), do: request(call, "DELETE", "/repos/#{full}", nil, {:token, token})

  @doc "The pull request from `branch` that's open on `full`, or one opened from it, with `title` and `body`."
  def pull_request(call, token, full, branch, title, body) do
    [owner, _] = String.split(full, "/")

    case request(call, "GET", "/repos/#{full}/pulls?state=open&head=#{owner}:#{URI.encode_www_form(branch)}", nil, {:token, token}) do
      [open | _] ->
        open

      [] ->
        %{"default_branch" => base} = request(call, "GET", "/repos/#{full}", nil, {:token, token})
        pull = %{title: title, head: branch, base: base, body: body}
        request(call, "POST", "/repos/#{full}/pulls", pull, {:token, token})
    end
  end

  defp request(call, method, path, body, auth) do
    headers =
      %{"accept" => "application/vnd.github+json", "x-github-api-version" => "2022-11-28", "user-agent" => "one-github-sync"}
      |> Map.merge(case auth do
        {:bearer, jwt} -> %{"authorization" => "Bearer " <> jwt}
        {:token, token} -> %{"authorization" => "token " <> token}
        nil -> %{}
      end)
      |> Map.merge(if body, do: %{"content-type" => "application/json"}, else: %{})

    response = Call.fetch(call, %{url: @api <> path, method: method, headers: headers, body: body && JSON.encode!(body)})

    case response do
      %{status: status, body: answer} when status in 200..299 ->
        if answer == "", do: nil, else: JSON.decode!(answer)

      %{status: status, body: answer} ->
        message = with {:ok, %{"message" => message}} <- JSON.decode(answer), do: message, else: (_ -> answer)
        raise "GitHub answered #{method} #{String.replace(path, ~r/\?.*/, "")} with #{status}: #{message}"
    end
  end

  @doc """
  Runs `fun` with the mirror of `full` on this server, fetched from GitHub first, and nothing else using it
  meanwhile: its folder. Its branches and tags are GitHub's.
  """
  def mirrored(call, full, token, fun) do
    folder = Path.join([call.folder, "mirrors", String.replace(full, "/", "--") <> ".git"])

    :global.trans({{__MODULE__, folder}, self()}, fn ->
      if not File.dir?(folder) do
        File.mkdir_p!(Path.dirname(folder))
        git!(Path.dirname(folder), ["init", "-q", "--bare", folder])
      end

      git!(folder, ["fetch", "-q", "--prune", url(full), "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"], token: token)
      fun.(folder)
    end, [node()])
  end

  @doc "The mirror's branches and tags, each ref's sha by its name."
  def refs(folder) do
    for line <- lines(git!(folder, ["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/tags"])),
        into: %{} do
      [sha, ref] = String.split(line, " ", parts: 2)
      {ref, sha}
    end
  end

  @doc "GitHub's refs of `full`, each sha by its name, as a push is told them first (git's smart HTTP protocol)."
  def advertised(call, token, full) do
    case Call.fetch(call, %{url: url(full) <> "/info/refs?service=git-receive-pack", headers: git_headers(token)}) do
      %{status: 200, body: body} -> advertisement(body)
      %{status: status} -> raise "GitHub answered #{status} for #{full}'s refs"
    end
  end

  @doc "The refs a push is told first, each sha by its name, from what was told."
  def advertisement(told) do
    for line <- pkt_lines(told),
        [sha, ref] <- [line |> String.trim_trailing("\n") |> String.split("\0") |> hd() |> String.split(" ", parts: 2)],
        sha =~ ~r/^[0-9a-f]{40}$/ and sha != @zero,
        into: %{},
        do: {ref, sha}
  end

  @doc """
  Pushes each `{old, new, ref}` to GitHub with `pack`, the objects the push brought (thin, against what GitHub has
  already), every one or none, each only from `old`: what git sends a push as, straight to GitHub's
  `git-receive-pack`. Gives `:ok` or `{:no, what GitHub said}`.
  """
  def receive_pack(call, token, full, commands, pack) do
    [first | rest] = for {old, new, ref} <- commands, do: "#{old} #{new} #{ref}"
    caps = "report-status side-band-64k atomic delete-refs ofs-delta agent=one-github-sync"
    body = IO.iodata_to_binary([pkt(first <> "\0" <> caps <> "\n"), Enum.map(rest, &pkt(&1 <> "\n")), "0000", pack || ""])

    headers =
      Map.merge(git_headers(token), %{
        "content-type" => "application/x-git-receive-pack-request",
        "accept" => "application/x-git-receive-pack-result"
      })

    case Call.fetch(call, %{url: url(full) <> "/git-receive-pack", method: "POST", headers: headers, body: body}) do
      %{status: 200, body: answer} ->
        # What it says comes in bands: 1 its report, 2 what its hooks said (GitHub's words), 3 why it failed.
        bands = Enum.group_by(pkt_lines(answer), &binary_part(&1, 0, 1), &binary_part(&1, 1, byte_size(&1) - 1))
        report = bands |> Map.get(<<1>>, []) |> Enum.join() |> pkt_lines() |> Enum.map(&String.trim_trailing(&1, "\n"))
        # GitHub starts its band 2 with a NUL, which git would read a refusal as ending at.
        said = Enum.join(Map.get(bands, <<2>>, []) ++ Map.get(bands, <<3>>, [])) |> String.split(~r/[\x00\r\n]+/, trim: true)
        refused = for "ng " <> refused <- report, do: refused

        if "unpack ok" in report and refused == [] and not Map.has_key?(bands, <<3>>),
          do: :ok,
          else: {:no, Enum.join(Enum.uniq(Enum.map(said, &String.trim/1) ++ refused), " ")}

      %{status: status, body: answer} ->
        {:no, "#{status} #{String.slice(answer, 0, 300)}"}
    end
  end

  @doc "A commit's subject, its first line, as GitHub has it."
  def subject(call, token, full, sha) do
    %{"commit" => %{"message" => message}} = request(call, "GET", "/repos/#{full}/commits/#{sha}", nil, {:token, token})
    message |> String.split("\n") |> hd()
  end

  defp git_headers(token),
    do: %{"authorization" => "Basic " <> Base.encode64("x-access-token:" <> token), "user-agent" => "git/one-github-sync"}

  @doc "A pkt-line of `line`."
  def pkt(line), do: [String.pad_leading(Integer.to_string(byte_size(line) + 4, 16), 4, "0") |> String.downcase(), line]

  @doc "Git's pkt-lines, each line's data; flushes are left out."
  def pkt_lines(""), do: []
  def pkt_lines("0000" <> rest), do: pkt_lines(rest)

  def pkt_lines(<<size::binary-4, rest::binary>>) do
    size = String.to_integer(size, 16) - 4
    <<line::binary-size(^size), rest::binary>> = rest
    [line | pkt_lines(rest)]
  end

  @doc "A pack of what `wants` reach that `haves` don't, those of them the mirror has, which isn't thin."
  def pack(folder, wants, haves) do
    have = known(folder, haves)
    file = Path.join(System.tmp_dir!(), "github-sync-" <> Base.encode16(:crypto.strong_rand_bytes(8)))
    File.write!(file, Enum.map(wants, &(&1 <> "\n")) ++ Enum.map(have, &("^" <> &1 <> "\n")))

    try do
      %{exit: 0, stdout: pack} = git(folder, ["pack-objects", "--stdout", "--revs", "-q"], in: file, binary: true)
      pack
    after
      File.rm(file)
    end
  end

  # Those of `shas` the mirror has.
  defp known(_folder, []), do: []

  defp known(folder, shas) do
    file = Path.join(System.tmp_dir!(), "github-sync-" <> Base.encode16(:crypto.strong_rand_bytes(8)))
    File.write!(file, Enum.map(shas, &(&1 <> "\n")))

    try do
      for line <- lines(git(folder, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], in: file).stdout),
          [sha, _type] <- [String.split(line, " ")],
          do: sha
    after
      File.rm(file)
    end
  end

  defp url(full), do: "https://github.com/#{full}.git"

  defp git!(folder, args, options \\ []) do
    case git(folder, args, options) do
      %{exit: 0, stdout: out} -> out
      %{stdout: out, stderr: errors} -> raise "git #{hd(args)} failed: #{String.trim(out <> errors)}"
    end
  end

  # Git, with the token as an HTTP header for github.com where it's given, and nothing of this machine's config.
  defp git(folder, args, options) do
    git = System.find_executable("git") || raise "This server can't find git, which GitHub Sync needs."
    env = [{"GIT_CONFIG_NOSYSTEM", "1"}, {"GIT_CONFIG_GLOBAL", "/dev/null"}, {"GIT_TERMINAL_PROMPT", "0"}]

    env =
      case options[:token] do
        nil ->
          env

        token ->
          basic = Base.encode64("x-access-token:" <> token)

          env ++
            [
              {"GIT_CONFIG_COUNT", "1"},
              {"GIT_CONFIG_KEY_0", "http.https://github.com/.extraheader"},
              {"GIT_CONFIG_VALUE_0", "AUTHORIZATION: basic " <> basic}
            ]
      end

    OneCore.Command.run([git | args], @timeout, cd: folder, env: env, in: options[:in], binary: options[:binary])
  end

  defp lines(text), do: String.split(text, "\n", trim: true)
end
