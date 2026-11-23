//! The app keeps itself on its network's latest build, and its window on the latest page (`page`), by itself and
//! without asking, as Chrome and VS Code update and start again: the network's only channel is its dev channel, where
//! its person sees each change as soon as it's live. Its servers tell it as the network's update moves
//! (`notifications/one/update`, `OneCore.Release.instructed/1`), with the latest build of each `one` and the build of
//! the edge, which serves the page; it asks as it opens, as it reconnects, as a window comes on screen, and every
//! five minutes while it runs, whatever its windows are doing, for what it missed, at most once a minute: a server
//! that couldn't reach it forgets it watches (`core/server/nif/one_core_iroh`'s `notify`), and one that wrote into a
//! connection that had gone said it was sent, so a notice alone can be missed for good. A computer's app also hears
//! its own program replaced, as its device's server or `one update` replaces it, so that alone has it start again,
//! whatever it heard. What it decides it reports (`one.client.update.*`), as Telemetry shows.
//!
//! A computer's app takes a newer build of itself (on a device that's also a server, beside its server, which runs it
//! from its next start, or by its server as it restarts on one that changed what it runs, `cli::serving`), or keeps a
//! newer page, and starts again on it (`computer::restart`), its app windows
//! opening again where they were. A phone's app reloads a newer page once it's off screen. An iPhone's own builds come
//! from its store (TestFlight), and an Android phone's from its network, whose own APK Software Update publishes
//! (`tooling/installers`): downloaded, and installed in place once the app's off screen (`apk`). Either waits while a
//! window on screen holds something its person typed and hasn't sent: in a web view a field typed in that still holds
//! text, which its page says (`editing`),
//! and in a native window an input with typing to undo (`renderer::typed`), until that window is put away or closed, or
//! what's typed is sent.

use std::collections::BTreeSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// The windows whose page says they hold something typed, by their label (`hosts::command`): `main`, the Home
/// Screen's, and each app's.
static EDITING: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());
/// A newer build or page is in place, to start again on, or reload, once nothing typed is in the way.
static DUE: AtomicBool = AtomicBool::new(false);
/// The edge's build the network last said, whose page has been asked for.
#[cfg(mobile)]
static EDGE: Mutex<Option<String>> = Mutex::new(None);
/// One build taken at a time.
#[cfg(not(mobile))]
static TAKING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
/// When the network was last asked what the app missed (`looked`).
static ASKED: Mutex<Option<Instant>> = Mutex::new(None);
/// Whether what it waits for has been reported, once for each time something's due.
static WAITING: AtomicBool = AtomicBool::new(false);
/// The network's newer APK of the app, downloaded, to install once nothing's in the way (`apk`).
#[cfg(target_os = "android")]
static APK: Mutex<Option<std::path::PathBuf>> = Mutex::new(None);

/// How long the app goes between asking the network what it missed, whatever its windows are doing: a notice it
/// didn't hear, as a Mac's locked app napping through one, is found within this after it was sent.
const EVERY: Duration = Duration::from_secs(300);

/// Starts keeping the app on what's latest, as it opens: a computer's hears its own program replaced, and it asks the
/// network what it has.
pub fn start() {
    #[cfg(not(mobile))]
    replaced();
    // An Android APK it downloaded is gone once it's installed, or is downloaded again.
    #[cfg(target_os = "android")]
    if let Ok(home) = crate::app().shell.home() {
        let _ = std::fs::remove_file(home.join("update.apk"));
    }
    looked();
    asking();
}

/// Asks the network what the app missed every `EVERY`, for as long as it runs: the servers tell it when a build is
/// there, and one of those notices can be lost, so nothing is left waiting for one.
fn asking() {
    crate::spawn(async {
        loop {
            tokio::time::sleep(EVERY).await;
            looked();
        }
    });
}

/// A window came on screen, or the app opened: the network is asked what the app missed, if it wasn't in the last
/// minute.
pub fn looked() {
    let mut asked = ASKED.lock().expect("nothing panics holding it");
    if asked.is_some_and(|at| at.elapsed() < Duration::from_secs(60)) {
        return;
    }
    *asked = Some(Instant::now());
    crate::spawn(caught_up());
}

/// Says what it decided to Telemetry, as `name`.
pub(crate) fn report(name: &str, attributes: Value) {
    eprintln!("{name} {attributes}");
    if let Ok(views) = crate::views() {
        views.client.report(json!({"name": name, "attributes": attributes}));
    }
}

/// Hears this program's file replaced, by its device's server, `one update` or anyone, and starts again on it once
/// it's a newer build (`in_place`), whether or not the network said so: the system says each change to its folder
/// (FSEvents, inotify, ReadDirectoryChangesW).
#[cfg(not(mobile))]
fn replaced() {
    use notify::{RecursiveMode, Watcher};
    let Ok(program) = cli::serving::program() else { return };
    let (Some(folder), Some(name)) = (program.parent().map(std::path::Path::to_owned), program.file_name().map(ToOwned::to_owned)) else { return };
    let heard = move |event: notify::Result<notify::Event>| {
        // Opening it isn't changing it: inotify says each open, and asking its build (`one --version`) opens it, which
        // on Linux heard itself over and over, hundreds of programs started a second.
        if event.is_ok_and(|event| !event.kind.is_access() && event.paths.iter().any(|path| path.file_name() == Some(&name))) {
            crate::spawn(in_place())
        }
    };
    let watching = notify::recommended_watcher(heard).and_then(|mut watcher| watcher.watch(&folder, RecursiveMode::NonRecursive).map(|()| watcher));
    match watching {
        // It hears for as long as the app runs.
        Ok(watcher) => std::mem::forget(watcher),
        Err(error) => eprintln!("the app doesn't hear its program replaced: {error}"),
    }
}

/// What the network's update says, as a server tells the app (`notifications/one/update`).
pub async fn heard(update: Value) {
    report("one.client.update.heard", json!({"one.build.latest": update["latest"][cli_name()], "one.edge.build": update["edge"]}));
    // What it says of each `one` is what servers run (`serving`, `OneCore.Builds`), which may be older than the app's
    // latest build, so the network is asked for that.
    #[cfg(not(mobile))]
    caught_up().await;
    #[cfg(target_os = "android")]
    apk().await;
    #[cfg(mobile)]
    if let Some(edge) = update["edge"].as_str() {
        let before = EDGE.lock().expect("nothing panics holding it").replace(edge.to_owned());
        if before.as_deref() != Some(edge) {
            page().await
        }
    }
}

/// Asks the network for what the app missed while it didn't reach it: its latest build, and its page.
pub async fn caught_up() {
    #[cfg(not(mobile))]
    if let Ok(views) = crate::views() {
        match cli::serving::latest_program(&views.client).await {
            Ok(Some(latest)) => take(&latest).await,
            Ok(None) => {}
            Err(error) => eprintln!("couldn't ask the network for its latest build: {error:#}"),
        }
    }
    #[cfg(target_os = "android")]
    apk().await;
    #[cfg(mobile)]
    page().await
}

/// Downloads the network's APK of the app into its home, if it's a newer build than this one, which is then due. It's
/// the network's own (its name, icon and address), signed with the platform's Android release key, which Android
/// checks against the app it replaces, so nobody else's APK takes its place. A developer's build is what they're
/// trying, which the network's never takes the place of.
#[cfg(target_os = "android")]
async fn apk() {
    static ASKING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _one = ASKING.lock().await;
    if cfg!(debug_assertions) || APK.lock().expect("nothing panics holding it").is_some() {
        return;
    }
    match downloaded().await {
        Ok(Some((build, file))) => {
            report("one.client.update.due", json!({"one.build.next": build}));
            *APK.lock().expect("nothing panics holding it") = Some(file);
            due().await
        }
        Ok(None) => {}
        Err(error) => eprintln!("couldn't ask the network for its Android app: {error:#}"),
    }
}

/// The network's Android installer (Software Update's), downloaded into the app's home where it's a newer build, with
/// its build.
#[cfg(target_os = "android")]
async fn downloaded() -> anyhow::Result<Option<(String, std::path::PathBuf)>> {
    let views = crate::views().map_err(anyhow::Error::msg)?;
    let call = async |name: &str, arguments: Value| -> anyhow::Result<Value> {
        let mut result = views.client.request("tools/call", json!({"name": name, "arguments": arguments})).await?;
        if result["isError"] == true {
            anyhow::bail!("{name}: {}", result["content"][0]["text"].as_str().unwrap_or("it failed"));
        }
        Ok(result["structuredContent"].take())
    };
    let listed = call("software-update_installers", json!({})).await?;
    let Some(installer) = listed["installers"].as_array().into_iter().flatten().find(|installer| installer["platform"] == "android") else {
        return Ok(None);
    };
    let build = installer["build"].as_str().unwrap_or_default().to_owned();
    if cli::serving::count(&build) <= cli::serving::count(::client::BUILD) {
        return Ok(None);
    }
    let link = call("software-update_installer", json!({"name": installer["name"]})).await?;
    let file = crate::app().shell.home()?.join("update.apk");
    let bytes = ::client::web()?.get(link["link"].as_str().unwrap_or_default()).send().await?.error_for_status()?.bytes().await?;
    if Some(bytes.len() as u64) != installer["size"].as_u64() {
        anyhow::bail!("the APK of {build} didn't download whole");
    }
    std::fs::write(&file, &bytes)?;
    Ok(Some((build, file)))
}

/// Installs `apk` in place of this app with Android's PackageInstaller (`Updates.kt`), which ends this process.
#[cfg(target_os = "android")]
fn install(apk: &std::path::Path) -> jni::errors::Result<()> {
    use jni::objects::{JClass, JObject};
    let (vm, context) = ::client::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(vm.cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let context = unsafe { JObject::from_raw(context.cast()) };
    let mut installed = || -> jni::errors::Result<()> {
        // The app's own class, by its class loader: this thread's is the system's, which doesn't have it.
        let loader = env.call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
        let name = env.new_string("app.theone.client.Updates")?;
        let class = env.call_method(&loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;", &[(&name).into()])?.l()?;
        let path = env.new_string(apk.to_string_lossy())?;
        let signature = "(Landroid/content/Context;Ljava/lang/String;)V";
        env.call_static_method(JClass::from(class), "install", signature, &[(&context).into(), (&path).into()])?;
        Ok(())
    };
    let done = installed();
    if done.is_err() {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
    }
    done
}

/// Takes `latest`, if it's newer than this build: downloaded here, and on a device that's also a server put in place
/// beside it (`cli::serving::take_program`) or by it.
#[cfg(not(mobile))]
async fn take(latest: &str) {
    // A developer's build is what they're trying, which the network's never takes the place of: one on a network
    // being built took the network's latest release and started again on that (21 Nov).
    if cfg!(debug_assertions) || cli::serving::count(latest) <= cli::serving::count(::client::BUILD) {
        return;
    }
    {
        let _one = TAKING.lock().await;
        if !DUE.load(Ordering::Relaxed) {
            let Ok(views) = crate::views() else { return };
            // On a device that's also a server, it's put in place beside the server, which runs it from its next
            // start, or, where it changed what a server runs, by its server as it restarts on it (`replaced`).
            let taken = match cli::serving::server() {
                None => cli::serving::update(&views.client).await.map(|said| eprintln!("{said}")),
                Some(_) => cli::serving::take_program(&views.client).await.map(|_| ()),
            };
            if let Err(error) = taken {
                return report("one.client.update.failed", json!({"one.build.latest": latest, "error": format!("{error:#}")}));
            }
        }
    }
    in_place().await
}

/// Whether the program's file is a newer build than the one running, which is then due: what's started again is that
/// file.
#[cfg(not(mobile))]
async fn in_place() {
    let Ok(program) = cli::serving::program() else { return };
    let Ok(Some(there)) = cli::serving::build_of(&program).await else { return };
    // The system says each change to the program's folder, often several for one replacement: the first is taken.
    if cli::serving::count(&there) > cli::serving::count(::client::BUILD) && !DUE.swap(true, Ordering::Relaxed) {
        report("one.client.update.due", json!({"one.build.next": there}));
        WAITING.store(false, Ordering::Relaxed);
        ready().await
    }
}

/// Asks the network for its page, which is due once a newer one is kept: one ask at a time, as each keeps what it
/// downloads in the same folder (`page::update`). A computer's windows are native, with no page.
#[cfg(mobile)]
pub async fn page() {
    static ASKING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _one = ASKING.lock().await;
    let Ok(views) = crate::views() else { return };
    let kept = async { crate::page::update(&views.client, &crate::app().shell.home()?).await }.await;
    match kept {
        Ok(true) => {
            report("one.client.update.due", json!({"one.page": true}));
            due().await
        }
        Ok(false) => {}
        Err(error) => eprintln!("couldn't ask the network for its page: {error:#}"),
    }
}

#[cfg(mobile)]
async fn due() {
    DUE.store(true, Ordering::Relaxed);
    WAITING.store(false, Ordering::Relaxed);
    ready().await
}

/// Window `label`'s page says whether it holds something typed.
pub fn editing(label: &str, editing: bool) {
    let mut typed = EDITING.lock().expect("nothing panics holding it");
    if editing {
        typed.insert(label.to_owned());
    } else {
        typed.remove(label);
    }
    drop(typed);
    crate::spawn(ready());
}

/// Window `label` closed, or went off screen: what it held is no longer in the way.
pub fn gone(label: &str) {
    EDITING.lock().expect("nothing panics holding it").remove(label);
    crate::spawn(ready());
}

/// Starts again on what's due, or on a phone reloads it, unless a window on screen holds something typed, or a phone's
/// window is on screen.
pub async fn ready() {
    if !DUE.load(Ordering::Relaxed) {
        return;
    }
    if let Some(typed) = typing().await {
        if !WAITING.swap(true, Ordering::Relaxed) {
            report("one.client.update.waiting", json!({"one.typed_in": typed}));
        }
        return;
    }
    #[cfg(mobile)]
    if crate::views().is_ok_and(|views| views.on_screen()) {
        return;
    }
    if !DUE.swap(false, Ordering::Relaxed) {
        return;
    }
    #[cfg(not(mobile))]
    {
        // What it reports is kept, and told from the next start where it isn't before.
        report("one.client.update.restart", json!({}));
        crate::app().shell.restart()
    }
    #[cfg(target_os = "android")]
    if let Some(apk) = APK.lock().expect("nothing panics holding it").take() {
        report("one.client.update.install", json!({}));
        if let Err(error) = install(&apk) {
            report("one.client.update.failed", json!({"error": format!("Android didn't install it: {error}")}));
        }
        return;
    }
    #[cfg(mobile)]
    {
        eprintln!("reloading the window's new page");
        if let Ok(home) = crate::app().shell.home() {
            crate::page::load(&home);
        }
        crate::app().shell.reload()
    }
}

/// Which window on screen holds something its person typed and hasn't sent, if one does: its label, or `native`.
async fn typing() -> Option<String> {
    let shown = crate::views().map(|views| views.on_screen.lock().expect("no view panics").clone()).unwrap_or_default();
    if let Some(label) = EDITING.lock().expect("nothing panics holding it").iter().find(|label| shown.contains(*label)) {
        return Some(label.clone());
    }
    if crate::native::typed().await {
        return Some("native".to_owned());
    }
    None
}

/// This program's name among the network's builds, on a computer.
fn cli_name() -> String {
    #[cfg(not(mobile))]
    return cli::serving::name();
    #[cfg(mobile)]
    return String::new();
}
