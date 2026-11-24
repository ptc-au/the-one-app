//! Where the builds come from: downloaded, checked against the platform's signing key and put in place.

use super::*;

/// Downloads the build `one` of the program `program` beside what an update replaces (`installed`), and gives where,
/// once it has said it's that build. It's under a name of this process's own (`<name>.<pid>.new`, `beside`): the app
/// and the server's `one serve run` each take the same build at once, which on Windows one couldn't write while the
/// other held it (os error 32). A network's own app takes its network's own build (`networks_build`), as its name and
/// icon are in it, and otherwise it's the platform's.
pub(super) async fn fetched_program(client: &Client, one: &Value, program: &Path) -> Result<PathBuf> {
    let build = one["build"].as_str().context("a build says which it is")?;
    ensure!(count(build) >= count(BUILD), "The network's build of one, {build}, is older than this one, {BUILD}.");
    let program = program.canonicalize()?;
    let new = match networks_own(&program) {
        true => networks_build(client, build, &program).await?,
        false => unpacked(one, &program).await?,
    };
    let started = checked(&new, &program).await;
    if !started.as_ref().is_ok_and(|started| started.as_deref() == Some(build)) {
        remove(&new);
        started?;
        bail!("The build {build} of one doesn't start here.")
    }
    Ok(new)
}

/// The platform's build `one`, downloaded beside `program` and unpacked (`one.<pid>.new`).
async fn unpacked(one: &Value, program: &Path) -> Result<PathBuf> {
    let packed = program.with_extension(format!("{}.new.gz", std::process::id()));
    fetch(&name(), one, &packed).await?;
    let new = packed.with_extension("");
    let unpacked =
        std::io::copy(&mut flate2::read::GzDecoder::new(fs::File::open(&packed)?), &mut fs::File::create(&new)?);
    fs::remove_file(&packed)?;
    unpacked.with_context(|| format!("The build {} of one didn't unpack.", one["build"]))?;
    #[cfg(unix)]
    fs::set_permissions(&new, std::os::unix::fs::PermissionsExt::from_mode(0o755))?;
    Ok(new)
}

/// Whether `program` is a network's own app's, which takes its network's own build of itself (`networks_build`),
/// with its name and icon: on a Mac, a bundle that's another app's than the One App's (`bundle_of`), and on Windows, one
/// its network's installer put in place, with its `network` beside it (`tooling/installers`). On Linux a network's own
/// program is the platform's, as nothing of its network is in it, and its `network` stays beside it as it's replaced.
pub(super) fn networks_own(program: &Path) -> bool {
    #[cfg(target_os = "macos")]
    return bundle_of(program).is_some_and(|(_, another)| another);
    #[cfg(windows)]
    return program.with_file_name("network").exists();
    #[cfg(not(any(target_os = "macos", windows)))]
    return {
        let _ = program;
        false
    };
}

/// What an update replaces of `program`: on a Mac, a network's own app's whole bundle, as its network's disk image has
/// it (`networks_build`), and otherwise the program alone.
pub(super) fn installed(program: &Path) -> Result<PathBuf> {
    let program = program.canonicalize()?;
    #[cfg(target_os = "macos")]
    if let Some((contents, true)) = bundle_of(&program) {
        return Ok(contents.parent().context("a bundle is in a folder")?.to_owned());
    }
    Ok(program)
}

/// Where a build to put in place of `program` is put first, beside what it replaces (`installed`), as it's moved
/// there in one step: `ptc.<pid>.new`, `The PTC App.app.<pid>.new`.
pub(super) fn beside(program: &Path) -> Result<PathBuf> {
    let installed = installed(program)?;
    let name = installed.file_name().context("what's installed has a name")?.to_string_lossy();
    Ok(installed.with_file_name(format!("{name}.{}.new", std::process::id())))
}

/// Copies a build, a program or a Mac's app (`installed`), from `from` to `to`, in place of what's there.
pub(super) fn copied(from: &Path, to: &Path) -> Result<()> {
    remove(to);
    #[cfg(target_os = "macos")]
    if from.is_dir() {
        // As a Mac copies an app, its links and extended attributes too, which its signature covers.
        let copied = command("ditto").arg(from).arg(to).output()?;
        ensure!(copied.status.success(), "{}", String::from_utf8_lossy(&copied.stderr).trim());
        return Ok(());
    }
    fs::copy(from, to)?;
    Ok(())
}

/// Removes a build, a program or a Mac's app, where it's there.
pub(super) fn remove(path: &Path) {
    let _ = fs::remove_dir_all(path).or_else(|_| fs::remove_file(path));
}

/// The build the build `new` says it is, as `program` is to run it, once it's checked it may: on a Mac, signed by the
/// platform for its bundle (`bundled`); on Windows, signed by whoever signed the program in place (`signed_alike`).
async fn checked(new: &Path, program: &Path) -> Result<Option<String>> {
    #[cfg(target_os = "macos")]
    return bundled(new, program).await;
    #[cfg(windows)]
    signed_alike(new, program).await?;
    #[cfg(not(target_os = "macos"))]
    return {
        let _ = program;
        build_of(new).await
    };
}

/// The kind of computer a network's own app is published for, as its Software Update names it: a Mac's `mac`, and
/// Windows' `windows-program`, which its app updates to where the installer itself would close it (`tooling/installers`).
#[cfg(target_os = "macos")]
const PLATFORM: &str = "mac";
#[cfg(windows)]
const PLATFORM: &str = "windows-program";

/// The network's own build of its app for this kind of computer, as its Software Update publishes it
/// (`tooling/installers`): its build, name, size and SHA-256, with a link that downloads it (`download_to`). `None`
/// where the network publishes none for this kind of computer.
#[cfg(any(target_os = "macos", windows))]
async fn networks_published(client: &Client) -> Result<Option<Value>> {
    let listed: Value = serde_json::from_str(&tool(client, "software-update_installers", json!({})).await?)?;
    let Some(found) = listed["installers"].as_array().into_iter().flatten().find(|installer| installer["platform"] == PLATFORM).cloned() else {
        return Ok(None);
    };
    let installer: Value = serde_json::from_str(&tool(client, "software-update_installer", json!({"name": found["name"]})).await?)?;
    Ok(Some(json!({"build": found["build"], "name": found["name"], "size": found["size"], "sha256": found["sha256"], "link": {"url": installer["link"]}})))
}

/// The network's own build `build` of its app for this kind of computer, `networks_published`'s: a network's own
/// app's latest is its network's installer's build (`download`), so it's there.
#[cfg(any(target_os = "macos", windows))]
async fn networks_published_build(client: &Client, build: &str) -> Result<Value> {
    let published = networks_published(client).await?;
    let published = published.with_context(|| format!("The network's Software Update has no {PLATFORM} for this app to take its build from."))?;
    let has = published["build"].as_str().unwrap_or_default();
    ensure!(has == build, "The network's {PLATFORM} is the build {has}, not {build}: this app takes the build its network's is.");
    Ok(published)
}

/// Never a network's own app, which a Mac's bundle and Windows' `network` say (`networks_own`).
#[cfg(not(any(target_os = "macos", windows)))]
async fn networks_published(_: &Client) -> Result<Option<Value>> {
    Ok(None)
}

/// The build `build` of a network's own app on Windows: its program, named, iconed and signed as the network's
/// installer's is, which `tooling/installers` publishes beside it with its SHA-256 (`windows-program`), so an update
/// keeps the app's name and icon, where the platform's `one.exe` took them (Task Manager and Explorer said the One App).
/// The installer itself isn't the update: it closes the app and its server, the updater among them.
#[cfg(windows)]
async fn networks_build(client: &Client, build: &str, program: &Path) -> Result<PathBuf> {
    let published = networks_published_build(client, build).await?;
    ensure!(published["sha256"].is_string(), "The network's program for Windows says no SHA-256 to check it by.");
    let new = beside(program)?;
    download_to(&published, &new).await?;
    Ok(new)
}

/// The program `new`, beside Windows' `program`, is signed with Authenticode by whoever signed `program`, where
/// `program` is signed: the certificate's subject is compared, as Sparkle compares a new app's signer with the old
/// one's, and Windows checks its chain. One in place that isn't signed, as none was before the network's certificate,
/// is checked against the SHA-256 its network published (`networks_build`). It's the build it says it is.
#[cfg(windows)]
async fn signed_alike(new: &Path, program: &Path) -> Result<()> {
    let Some(ours) = signer(program).await? else { return Ok(()) };
    let theirs = signer(new).await?;
    ensure!(
        theirs.as_deref() == Some(ours.as_str()),
        "It isn't signed by {ours}, as the app in place is, so the one there is kept: it's signed by {}.",
        theirs.as_deref().unwrap_or("nobody")
    );
    Ok(())
}

/// Who signed the program `program` with Authenticode, its certificate's subject, where Windows says the signature
/// is valid (PowerShell's `Get-AuthenticodeSignature`, which asks WinVerifyTrust).
#[cfg(windows)]
async fn signer(program: &Path) -> Result<Option<String>> {
    let mut asked = command("powershell");
    asked.args(["-NoProfile", "-NonInteractive", "-Command"]);
    asked.arg("$s = Get-AuthenticodeSignature -LiteralPath $env:ONE_SIGNED; if ($s.Status -eq 'Valid') { $s.SignerCertificate.Subject }");
    asked.env("ONE_SIGNED", program);
    let said = ran(asked, Duration::from_secs(60)).await?;
    ensure!(said.status.success(), "Windows didn't say who signed {}: {}", program.display(), String::from_utf8_lossy(&said.stderr).trim());
    let subject = String::from_utf8_lossy(&said.stdout).trim().to_owned();
    Ok((!subject.is_empty()).then_some(subject))
}

#[cfg(not(any(target_os = "macos", windows)))]
async fn networks_build(_: &Client, _: &str, _: &Path) -> Result<PathBuf> {
    bail!("A network's own app updates itself only on a Mac and on Windows.")
}

/// The One App's bundle but its program: its Info.plist, icon and seal, the same for every build, which each build of
/// `one` is signed in (`tooling/release`), so an update replaces the program alone, as before it was signed. macOS
/// runs a program signed in a bundle only as a bundle's program, with an Info.plist, and kills it anywhere else in it.
/// A change to these files goes out in a build signed without them first.
#[cfg(target_os = "macos")]
pub(super) const BUNDLE: &[(&str, &[u8])] = &[
    ("Info.plist", include_bytes!("../../../app/macos/Contents/Info.plist")),
    ("Resources/The One App.icns", include_bytes!("../../../app/macos/Contents/Resources/The One App.icns")),
    ("_CodeSignature/CodeResources", include_bytes!("../../../app/macos/Contents/_CodeSignature/CodeResources")),
];

/// The platform's Apple Developer ID team, which signs every program it makes for a Mac, the One App's and each
/// network's app's (`tooling/developer-id-sign`), as `KEY` is its key for every build: a program is put in a Mac's
/// bundle only signed by it, for that bundle.
#[cfg(target_os = "macos")]
const TEAM: &str = "X96JC3HCV7";

/// The `Contents` of the app bundle a Mac's `program` is the program of, if it's one, and whether the bundle is
/// another app's than the One App's, as a network's own app is (`tooling/mac-app`), by its identifier.
#[cfg(target_os = "macos")]
pub(super) fn bundle_of(program: &Path) -> Option<(PathBuf, bool)> {
    let contents = program.parent().filter(|folder| folder.ends_with("Contents/MacOS"))?.parent()?.to_owned();
    let identifier = |info: Option<plist::Value>| Some(info?.into_dictionary()?.get("CFBundleIdentifier")?.as_string()?.to_owned());
    let ours = identifier(plist::from_bytes(BUNDLE[0].1).ok());
    let another = identifier(plist::Value::from_file(contents.join("Info.plist")).ok()).is_some_and(|its| Some(its) != ours);
    Some((contents, another))
}

/// The build `build` of a network's own app for a Mac: the whole app, from the network's installer for a Mac, its
/// disk image, signed and notarised, which `tooling/installers` publishes in its Software Update (`networks_published`),
/// as Sparkle and Tauri's updater take a whole app. So a network that changed its app's name or
/// icon has it changed by the update: a program alone is signed with its bundle's Info.plist and icon, and is killed in
/// another bundle ("Code Signature Invalid", on Andre's Mac on 23 Nov 2026). It's put beside the app it replaces
/// (`beside`), on the same volume, to be swapped with it in one step (`put`).
#[cfg(target_os = "macos")]
async fn networks_build(client: &Client, build: &str, program: &Path) -> Result<PathBuf> {
    let published = networks_published_build(client, build).await?;
    let name = published["name"].as_str().context("an installer has a name")?.to_owned();
    let image = env::temp_dir().join(format!("one.{}.dmg", std::process::id()));
    let volume = env::temp_dir().join(format!("one.{}.volume", std::process::id()));
    let downloaded = download_to(&published, &image).await;
    let new = beside(program)?;
    let taken = async {
        downloaded?;
        let mut attach = command("hdiutil");
        attach.args(["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint"]).arg(&volume).arg(&image);
        let attached = ran(attach, Duration::from_secs(120)).await?;
        ensure!(attached.status.success(), "{name} didn't open: {}", String::from_utf8_lossy(&attached.stderr).trim());
        let app = fs::read_dir(&volume)?.flatten().map(|entry| entry.path()).find(|path| path.extension().is_some_and(|it| it == "app"));
        copied(&app.with_context(|| format!("{name} holds no app"))?, &new)
    }
    .await;
    if volume.exists() {
        let mut detach = command("hdiutil");
        detach.args(["detach", "-force"]).arg(&volume);
        let _ = ran(detach, Duration::from_secs(60)).await;
    }
    let _ = fs::remove_file(&image);
    let _ = fs::remove_dir(&volume);
    if let Err(error) = taken {
        remove(&new);
        return Err(error.context(format!("This app couldn't take the network's app from {name}")));
    }
    Ok(new)
}

/// The build a Mac's build `new` says it is, as `program` is to run it, once macOS would: a network's whole app
/// (`networks_build`) signed by the platform as this app, by its identifier, and notarised (`checked_app`); and a
/// program alone run as the program of a copy of the bundle it's to be put in, once it's signed for it (`Checking`).
/// The One App's bundle has `BUNDLE` put in place first, which each build of `one` is signed in.
#[cfg(target_os = "macos")]
pub(super) async fn bundled(new: &Path, program: &Path) -> Result<Option<String>> {
    let Some((contents, another)) = bundle_of(program) else { return build_of(new).await };
    if new.is_dir() {
        checked_app(new, program)?;
        let named = new.join("Contents/MacOS").join(program.file_name().context("a program has a name")?);
        ensure!(named.exists(), "The network's app names its program otherwise now, so it's installed again from its download page.");
        return build_of(&named).await;
    }
    if !another {
        for (file, bytes) in BUNDLE {
            let path = contents.join(file);
            if fs::read(&path).is_ok_and(|was| was == *bytes) {
                continue;
            }
            fs::create_dir_all(path.parent().context("a file is in a folder")?)?;
            let writing = path.with_extension(format!("{}.new", std::process::id()));
            fs::write(&writing, bytes)?;
            fs::rename(&writing, &path)?;
        }
    }
    let checking = Checking::new(new, program)?;
    build_of(&checking.checked).await
}

/// Checks the app `new` is the app `program` is in, as macOS opens it: signed by the platform (`TEAM`) with the same
/// identifier, `codesign --verify --strict`, as Sparkle checks a new app's signer against the old's, and accepted by
/// Gatekeeper, notarised (`spctl --assess`).
#[cfg(target_os = "macos")]
pub(super) fn checked_app(new: &Path, program: &Path) -> Result<()> {
    let (contents, _) = bundle_of(program).context("a program in a bundle")?;
    let info = plist::Value::from_file(contents.join("Info.plist"))?;
    let identifier = info.as_dictionary().and_then(|info| info.get("CFBundleIdentifier")?.as_string()).context("an app has an identifier")?;
    let requirement = format!("=identifier \"{identifier}\" and anchor apple generic and certificate leaf[subject.OU] = \"{TEAM}\"");
    let verified = command("codesign").args(["--verify", "--strict", "-R", &requirement]).arg(new).output()?;
    ensure!(
        verified.status.success(),
        "It isn't this app signed by the platform, so the one there is kept: {}",
        String::from_utf8_lossy(&verified.stderr).trim()
    );
    let assessed = command("spctl").args(["--assess", "--type", "execute"]).arg(new).output()?;
    ensure!(
        assessed.status.success(),
        "Gatekeeper doesn't accept it, so the one there is kept: {}",
        String::from_utf8_lossy(&assessed.stderr).trim()
    );
    Ok(())
}

/// The program `new`, beside a Mac's `program`, checked as the program of a copy of the app bundle `program` is in
/// (`Contents/Updates/<pid>.app`), its own files but the program copied as `ditto` copies a bundle: made only where
/// it's signed by the platform for that bundle (`TEAM`), `codesign --verify --strict`, as macOS kills one that isn't
/// there ("Code Signature Invalid"). It's put back beside `program` as it's dropped.
#[cfg(target_os = "macos")]
pub(super) struct Checking {
    new: PathBuf,
    checked: PathBuf,
    contents: PathBuf,
}

#[cfg(target_os = "macos")]
impl Checking {
    pub(super) fn new(new: &Path, program: &Path) -> Result<Self> {
        let (contents, _) = bundle_of(program).context("a program in a bundle")?;
        let copy = contents.join("Updates").join(format!("{}.app", std::process::id()));
        let checked = copy.join("Contents/MacOS").join(program.file_name().context("a program has a name")?);
        fs::create_dir_all(checked.parent().context("a program is in a folder")?)?;
        fs::rename(new, &checked)?;
        let checking = Checking { new: new.to_owned(), checked, contents: contents.clone() };
        for entry in fs::read_dir(&contents)?.flatten() {
            if !["MacOS", "Updates"].contains(&entry.file_name().to_string_lossy().as_ref()) {
                let copied = command("ditto").arg(entry.path()).arg(copy.join("Contents").join(entry.file_name())).output()?;
                ensure!(copied.status.success(), "{}", String::from_utf8_lossy(&copied.stderr).trim());
            }
        }
        let requirement = format!("=anchor apple generic and certificate leaf[subject.OU] = \"{TEAM}\"");
        let verified = command("codesign").args(["--verify", "--strict", "-R", &requirement]).arg(&copy).output()?;
        ensure!(
            verified.status.success(),
            "It isn't signed by the platform for this app, so macOS would kill it there, and the one there is kept: {}",
            String::from_utf8_lossy(&verified.stderr).trim()
        );
        Ok(checking)
    }
}

#[cfg(target_os = "macos")]
impl Drop for Checking {
    fn drop(&mut self) {
        let _ = fs::rename(&self.checked, &self.new);
        let updates = self.contents.join("Updates");
        let _ = fs::remove_dir_all(updates.join(format!("{}.app", std::process::id())));
        // Another's may be checking beside it, as the app and the server take a build at once.
        let _ = fs::remove_dir(&updates);
    }
}

/// The build the program `program` says it is (`one --version`), if it starts. It's run as `tar` is (`ran`), on a
/// thread of its own and with a minute, and the one thread all of `one serve` runs on goes on meanwhile: a build of
/// `one` that hangs as it starts fails the update that asked for it, saying so, where it held the server for hours.
pub async fn build_of(program: &Path) -> Result<Option<String>> {
    let mut version = command(program);
    version.arg("--version");
    let output = match ran(version, Duration::from_secs(60)).await {
        // One that doesn't start here says no build, which whoever asked says in its own words (`fetched_program`).
        Err(error) if error.downcast_ref::<std::io::Error>().is_some() => return Ok(None),
        output => output?,
    };
    Ok(String::from_utf8_lossy(&output.stdout).split_whitespace().nth(1).map(str::to_owned))
}

/// Puts the build `new` in place of `program`, in one step: a program, or on a Mac a network's whole app, swapped with
/// the one there (`renamex_np`'s `RENAME_SWAP`, as Sparkle swaps an app), which then goes, at the same path, so its
/// server's agent, its Dock icon and its link on the PATH find it as before. Windows replaces or removes no program
/// that's running, but lets it be renamed: the one before is put aside under a name of its own (`one.<ms>.old`), as one
/// put aside before may still be running (the app, or the `one serve run` that's putting this in place, started from
/// it), and those put aside before that nothing runs any more go.
pub(super) fn put(new: &Path, program: &Path) -> Result<()> {
    let program = program.canonicalize()?;
    #[cfg(target_os = "macos")]
    if new.is_dir() {
        use std::os::unix::ffi::OsStrExt;
        let app = installed(&program)?;
        ensure!(app.is_dir(), "{} is no app to put {} in place of", program.display(), new.display());
        let (from, to) = (std::ffi::CString::new(new.as_os_str().as_bytes())?, std::ffi::CString::new(app.as_os_str().as_bytes())?);
        if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_SWAP) } != 0 {
            return Err(std::io::Error::last_os_error()).with_context(|| format!("{} couldn't be put in place", app.display()));
        }
        remove(new);
        return Ok(());
    }
    #[cfg(windows)]
    {
        let stem = program.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        let folder = program.parent().context("a program is in a folder")?;
        for aside in fs::read_dir(folder)?.flatten().map(|entry| entry.path()) {
            let name = aside.file_name().unwrap_or_default().to_string_lossy();
            if name.starts_with(&format!("{stem}.")) && name.ends_with(".old") {
                let _ = fs::remove_file(&aside);
            }
        }
        fs::rename(&program, program.with_extension(format!("{}.old", now())))?;
    }
    Ok(fs::rename(new, program)?)
}

/// What starts a build of the server: its release's script, a batch file on Windows.
pub(super) fn release(build: &Path) -> PathBuf {
    build.join(if cfg!(windows) { "bin/one_core.bat" } else { "bin/one_core" })
}

/// A program this one starts, which has no window of its own: on Windows a console program started by one with no
/// console, as a server's is, would open one.
pub(super) fn command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut command = std::process::Command::new(program);
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut command, 0x0800_0000); // CREATE_NO_WINDOW
    command
}

/// Runs `command` to its end, for at most `within`, giving what it printed. It's started on a thread of its own and
/// waited for without holding the one thread all of this program runs on (`lib.rs`), and killed once `within`
/// passes, so a program that hangs, even as it starts, fails what started it and the rest carries on: on 22 Nov
/// 2026 a Surface's tar hung in Windows unpacking a build, once its GPU driver had, and its server's log and updates
/// stopped with it.
pub(super) async fn ran(command: std::process::Command, within: Duration) -> Result<std::process::Output> {
    let program = command.get_program().to_string_lossy().into_owned();
    let mut command = Command::from(command);
    command.kill_on_drop(true).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let run = async {
        Ok::<_, anyhow::Error>(tokio::task::spawn_blocking(move || command.spawn()).await??.wait_with_output().await?)
    };
    timeout(within, run).await.with_context(|| format!("{program} didn't end within {} s", within.as_secs()))?
}

/// The latest builds for this kind of machine, by what they are (`server-code`, `one`), each with a link to it, as this
/// program takes them (`own`).
pub(super) async fn download(client: &Client, program: &Path) -> Result<Map<String, Value>> {
    let response = tool(client, "download", json!({"target": target()})).await?;
    let Value::Object(builds) = serde_json::from_str(&response)? else { bail!("the network didn't list its builds") };
    own(client, program, builds).await
}

/// The platform's latest `builds`, with a network's own app's `one` its network's own build of itself
/// (`networks_published`), which its Software Update has once `tooling/installers` has made it from the platform's
/// build, minutes after the platform publishes that (`tooling/release`). So a network's own app is never told of a build
/// its network has no app of, nor waits for one to be published: a build of the platform is the platform's own app's,
/// and every other's. It holds for a server that's one as much as for the app: its pair, the server build and `one`
/// (`latest_pair`), is the latest server build with the `one` its network has, so a server doesn't wait for a disk
/// image that's yet to be made to take a build of the server.
pub(super) async fn own(client: &Client, program: &Path, mut builds: Map<String, Value>) -> Result<Map<String, Value>> {
    if networks_own(program) {
        // What a server takes of it is the platform's (`serving`), which a device that's also one pairs with.
        let serving = builds.get(PROGRAM).and_then(|one| one.get("serving")).cloned();
        if let Some(mut own) = networks_published(client).await? {
            if let Some(serving) = serving {
                own["serving"] = serving;
            }
            builds.insert(PROGRAM.to_owned(), own);
        }
    }
    Ok(builds)
}

/// Downloads the build of `name` the network gives, `build`, by its link into `file`, once it's checked it's the
/// platform's, and checks it's the size and SHA-256 it said. A download that fails, or stalls (`STALLED`), is tried
/// again soon, waiting twice as long each time, as curl's `--retry` does: a home router's NAT, or GitHub, now and then
/// drops a connection, or leaves it open with nothing coming. On 22 Nov a Mac just back online waited 18 minutes on
/// one that had stalled, until the connection was reset, and its try 2 s later downloaded it.
pub(super) async fn fetch(name: &str, build: &Value, file: &Path) -> Result<()> {
    signed(name, build)?;
    for wait in [2, 4, 8, 16, 32, 60] {
        match download_to(build, file).await {
            Err(error) => {
                eprintln!("The build {} didn't download ({error:#}); trying again in {wait} s", build["build"]);
                tokio::time::sleep(Duration::from_secs(wait)).await;
            }
            done => return done,
        }
    }
    download_to(build, file).await
}

/// How long a download may go with nothing arriving before it's taken as failed: a connection can stay open with
/// nothing coming, and nothing else ends it.
const STALLED: Duration = Duration::from_secs(30);

/// Downloads `build` by its link into `file`, and checks it's the size and SHA-256 it said.
pub(super) async fn download_to(build: &Value, file: &Path) -> Result<()> {
    let link = &build["link"];
    let method = reqwest::Method::from_bytes(link["method"].as_str().unwrap_or("GET").as_bytes())?;
    let mut request = client::web()?.request(method, link["url"].as_str().context("a build has a link")?);
    for (name, value) in link["headers"].as_object().into_iter().flatten() {
        request = request.header(name, value.as_str().unwrap_or_default());
    }
    let stalled = || format!("nothing arrived for {} s", STALLED.as_secs());
    let mut response = tokio::time::timeout(STALLED, request.send()).await.map_err(|_| anyhow::anyhow!(stalled()))??.error_for_status()?;
    let mut out = tokio::fs::File::create(file).await?;
    let (mut hash, mut size) = (Sha256::new(), 0);
    while let Some(part) = tokio::time::timeout(STALLED, response.chunk()).await.map_err(|_| anyhow::anyhow!(stalled()))?? {
        hash.update(&part);
        size += part.len() as u64;
        out.write_all(&part).await?;
    }
    out.flush().await?;
    // A network's installer says no SHA-256: its app's Apple signature is checked instead (`bundled`).
    let hashed = data_encoding::HEXLOWER.encode(&hash.finalize());
    if build["sha256"].as_str().is_some_and(|said| said != hashed) || build["size"] != size {
        fs::remove_file(file)?;
        bail!("The build {} didn't download whole.", build["build"]);
    }
    Ok(())
}

/// Checks the network's `build` of `name` (`one/linux-x86_64`, `server-code`) is the platform's: its Ed25519 signature
/// of its name, build and SHA-256, checked with the public half built in here, `KEY`, as Tauri's updater and Sparkle
/// check theirs. So whoever publishes to the network, its owner too, can give this no program but the platform's, nor
/// one in another's place, and as each says its build, an older one is told by it.
pub(super) fn signed(name: &str, build: &Value) -> Result<()> {
    let which = build["build"].as_str().context("a build says which it is")?;
    let said = format!("{name} {which} {}", build["sha256"].as_str().context("a build says its SHA-256")?);
    let signature = build["signature"].as_str().with_context(|| format!("The build {which} of {name} isn't signed."))?;
    let signature = data_encoding::BASE64.decode(signature.as_bytes()).ok().and_then(|sig| Signature::from_slice(&sig).ok());
    let key = data_encoding::HEXLOWER.decode(KEY.as_bytes()).ok().and_then(|key| VerifyingKey::try_from(key.as_slice()).ok());
    let signed = signature.is_some_and(|sig| key.expect("KEY is a public key").verify_strict(said.as_bytes(), &sig).is_ok());
    ensure!(signed, "The build {which} of {name} isn't signed by the platform.");
    Ok(())
}

/// The count of commits in a build's metadata (`tooling/version`), which only grows on main: `0.25.13+3670.9046435e40b3`
/// is 3670, as `OneCore.Builds.count/1` reads it.
pub fn count(build: &str) -> u64 {
    build.split_once('+').and_then(|(_, metadata)| metadata.split('.').next()?.parse().ok()).unwrap_or(0)
}

/// Calls one of the network's tools and gives what it said, or the error it said.
pub(super) async fn tool(client: &Client, name: &str, arguments: Value) -> Result<String> {
    crate::said(client.request("tools/call", json!({"name": name, "arguments": arguments})).await?)
}
