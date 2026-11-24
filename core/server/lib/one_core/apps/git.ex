defmodule OneCore.Apps.Git do
  @moduledoc """
  An app's git source, as a server reads it to find a newer version: a copy of the repo kept in the server's folder,
  `git/<the source's hash>`, made with `git clone --mirror --filter=blob:none`, so a fetch brings only the commits and
  the files a server reads. It's git itself that's run (`OneCore.Programs`). For a trusted app, whose code runs with
  the machine's access anyway, it's signed in as the machine's user is, so a private repo is fetched where that user
  may fetch it. For an untrusted one, git fetches over https alone, signed in as nobody (git's `protocol.allow` and
  an empty `credential.helper`): what the machine's user may reach isn't the app's. What's named after an option
  (`--`, `--end-of-options`) is never taken as one.

  A source git reaches through a remote helper, `<transport>::<address>`, as a repo of the network's Git Repos is
  cloned (`one::users/alice/made/git-repos/notes`), is the apps' that hold it: they give it as a git bundle, where
  whoever the app is may read it (the hook `source`, which `OneCore.Apps.Lifecycle` asks), kept beside the copy as
  `<copy>.bundle`, which git fetches as any remote. No server has a remote helper signed in, and none is needed to read what the network holds.
  """
  alias OneCore.{Command, Programs, Server}

  # How git is run for an untrusted app: over https alone, signed in as nobody.
  @untrusted ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "credential.helper="]

  # A file is its committed bytes, whatever machine reads it: a version's hashes are the same on every server. Git for
  # Windows installs with `core.autocrlf=true`, and `git archive` then writes every text file with CRLF line endings,
  # which breaks a shell script (`exec: desktop: not found`) and makes the same commit two versions.
  @bytes ["-c", "core.autocrlf=false", "-c", "core.eol=lf"]

  # A clone or a fetch of a repo takes minutes, and one that stops answering is ended.
  @timeout 600

  @doc """
  Fetches `source` (a URL, `owner/repo` on GitHub, `<transport>::<address>`, or for a trusted app a path), for an
  app that's `trusted` or not: `{:ok, copy}`, or `{:error, why}`. `bundle.(source)` gives a
  `<transport>::<address>`'s bundle, `{:ok, bundle}` or `{:error, why}`. A copy is used with the other functions
  here as it was fetched.
  """
  def fetch(source, trusted, bundle \\ &{:error, "Nothing gives #{&1}"}) do
    hash = Base.encode16(:crypto.hash(:sha256, "#{trusted}\n#{source}"), case: :lower)
    copy = Path.join([Server.home(), "git", if(trusted, do: hash, else: "untrusted-" <> hash)])
    File.mkdir_p!(Path.dirname(copy))

    # A bundle is a file this server wrote, which git reads as it would any: only a fetch from elsewhere is limited.
    with {:ok, url} <- url(source, trusted, bundle, copy),
         limit = if(trusted or url == copy <> ".bundle", do: [], else: @untrusted) do
      if File.dir?(copy) do
        with {:ok, _} <- git(copy, limit ++ ["fetch", "--quiet", "--prune", "--force"]), do: {:ok, copy}
      else
        # Cloned beside it, then renamed into place, so a clone cut short never leaves a copy that looks whole.
        # Another fetch may have cloned it meanwhile, which is as good.
        cloning = copy <> "." <> Base.encode16(:crypto.strong_rand_bytes(8), case: :lower)
        clone = ["clone", "--quiet", "--mirror", "--filter=blob:none", "--", url, cloning]

        case git(Path.dirname(copy), limit ++ clone) do
          {:ok, _} ->
            with {:error, _} <- File.rename(cloning, copy), do: File.rm_rf!(cloning)
            {:ok, copy}

          error ->
            File.rm_rf!(cloning)
            error
        end
      end
    end
  end

  # What git fetches a source from: `owner/repo` is on GitHub, as `one install` reads it, and `<transport>::<address>`
  # its bundle.
  defp url(source, trusted, bundle, copy) do
    cond do
      source =~ ~r{^[a-z][a-z0-9+.-]*::.} ->
        with {:ok, bundle} <- bundle.(source) do
          File.write!(copy <> ".bundle", bundle)
          {:ok, copy <> ".bundle"}
        end

      source =~ ~r{^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$} and not (trusted and File.exists?(source)) ->
        {:ok, "https://github.com/#{source}.git"}

      true ->
        {:ok, source}
    end
  end

  @doc "The commit `ref` is in a copy, or what the repo has by default where it's `nil`."
  def commit(copy, ref) do
    git(copy, ["rev-parse", "--verify", "--quiet", "--end-of-options", "#{ref || "HEAD"}^{commit}"])
  end

  @doc "Whether `ancestor` is `commit` or comes before it, so moving to `commit` loses nothing of it."
  def ancestor?(copy, ancestor, commit), do: match?({:ok, _}, git(copy, ["merge-base", "--is-ancestor", "--end-of-options", ancestor, commit]))

  @doc "The tree of `path` at `commit`, which is the same for two commits only where its files are."
  def tree(copy, commit, path), do: git(copy, ["rev-parse", "--verify", "--quiet", "--end-of-options", "#{commit}:#{path}"])

  @doc """
  The commits after `from` up to `to` that changed `path`, newest first, each with its `commit`, `subject`,
  `author` and `date`: what an update brings, for whoever decides whether to take it.
  """
  def commits(copy, from, to, path) do
    range = if from && ancestor?(copy, from, to), do: "#{from}..#{to}", else: to

    with {:ok, log} <- git(copy, ["log", "--max-count=50", "--format=%H%x1f%s%x1f%an%x1f%aI", "--end-of-options", range, "--", path]) do
      {:ok,
       for line <- String.split(log, "\n", trim: true), [commit, subject, author, date] = String.split(line, "\x1f") do
         %{"commit" => commit, "subject" => subject, "author" => author, "date" => date}
       end}
    end
  end

  @doc "The files of `path` at `commit`, by their paths in it: `{:ok, files}`, or `{:error, why}`."
  def files(copy, commit, path) do
    with {:ok, tar} <- git(copy, ["archive", "--format=tar", "--end-of-options", commit, path], false),
         {:ok, entries} <- :erl_tar.extract({:binary, tar}, [:memory]) do
      {:ok, Map.new(entries, fn {name, data} -> {String.replace_prefix(to_string(name), path <> "/", ""), data} end)}
    else
      {:error, why} when is_binary(why) -> {:error, why}
      {:error, why} -> {:error, inspect(why)}
    end
  end

  defp git(folder, args, trim \\ true) do
    with {:ok, git} <- Programs.path(:git) do
      # An archive is its output alone; anything else is said with what git says.
      case Command.run([git | @bytes] ++ ["-C", folder | args], @timeout, env: [{"GIT_TERMINAL_PROMPT", "0"}], binary: !trim) do
        %{exit: 0, stdout: out} -> {:ok, if(trim, do: String.trim(out), else: out)}
        %{stdout: out, stderr: errors} -> {:error, "git #{hd(args -- @untrusted)} said: #{String.trim(out <> errors)}"}
      end
    end
  end
end
