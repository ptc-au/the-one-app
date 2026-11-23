//! The launcher's shortcut, which shows it from anywhere, or puts it away: one for every network's app on this
//! computer (the One App, and a network's own, as the PTC App beside it), as a person has one keyboard. The computer
//! keeps it in one folder they share (`shared`): the shortcut chosen, which network was used last (`last`), where the
//! launcher was dragged to (`places`), and where each app running listens (`apps/<identifier>`, its channel,
//! `hosts::address`). The first of them running has it
//! (`shortcut.lock`, which it holds while it runs, its identifier in it), and the others wait on its lock, so the
//! next takes it the moment it quits, as the program after an update takes it from the one before. Pressed, it shows
//! the launcher of the network used last, which the one that has it tells over that app's channel (`toggle`), or
//! its own where that one isn't running. Their launchers switch between them too (`networks`, `switch`), each
//! showing every network's running as tabs over its search, by the logo each keeps beside where it listens
//! (`apps/<identifier>.png`, its network's `/Logo.png`).
//!
//! Each network's launcher is hidden or shown, its Home Screen or a step of its onboarding (the page's own, kept by
//! the steps' tips, so it comes back on the same step). A launcher goes as soon as anything else takes the keyboard,
//! another network's launcher too, so at most one is shown, and every way one shows makes its network the one used
//! last (`used`), onboarding too. So the shortcut puts away whichever launcher is shown, and shows the network used
//! last where none is:
//!
//! | This network's launcher | What happens | Then | `last` |
//! | --- | --- | --- | --- |
//! | hidden | the shortcut, this network `last` | shown | this |
//! | shown | the shortcut | hidden | this |
//! | hidden | the app started as it's opened, its Dock or taskbar icon, a link, a switch to it (⌘1, ⌘2) | shown | this |
//! | shown | another's launcher shown, Escape, an app opened, a click elsewhere | hidden | as it was |
//!
//! It's ⌥Space on a Mac, as Raycast suggests, which macOS leaves free (Spotlight is ⌘Space, the input source ⌃Space);
//! on Windows and Linux Alt+Space is the window menu's, and Super+Space the input source's, so it's Super+Alt+Space
//! there. Its person chooses another in Settings or onboarding (`change`), in global-hotkey's words (`alt+Space`), or
//! none, an empty file. Linux's is X11's; a Wayland session has none.

use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use global_hotkey::GlobalHotKeyManager;
use global_hotkey::hotkey::HotKey;
use serde_json::{Value, json};

use super::{Told, tell};

/// The shortcut while this app has it: what keeps it and the key.
pub(super) type Kept = (GlobalHotKeyManager, HotKey);

/// The shortcut where its person hasn't chosen one, in global-hotkey's words.
const DEFAULT: &str = if cfg!(target_os = "macos") { "alt+Space" } else { "alt+super+Space" };

/// The folder every network's app on this computer shares, beside each one's own (`home`), and the lock this one
/// holds while it has the shortcut.
static SHARED: OnceLock<PathBuf> = OnceLock::new();
static HOLDS: OnceLock<std::fs::File> = OnceLock::new();

/// The folder the apps share, beside each one's own: `app.theone.networks` in the folder of the system's that holds
/// them (`client::home`), and `app.theone.networks.dev` for a debug build, which is a client of its own and mustn't
/// take its person's shortcut.
fn shared() -> &'static Path {
    SHARED.get().map_or(Path::new(""), PathBuf::as_path)
}

/// Where the launcher was dragged to on each screen, one file for every network's app on this computer: their launchers
/// show where the one before it was (`switch`), as one launcher would.
pub(crate) fn places() -> PathBuf {
    shared().join("launcher-places.json")
}

/// Joins the computer's apps, as this one starts: says where it listens, and waits on the shortcut's lock, in a thread
/// of its own, taking the shortcut once it has it.
pub(super) fn begin(home: &Path) {
    let name = if cfg!(debug_assertions) { "app.theone.networks.dev" } else { "app.theone.networks" };
    let folder = SHARED.get_or_init(|| home.parent().unwrap_or(home).join(name));
    let listens = json!({"name": ::client::app_name(), "address": crate::hosts::address(home)});
    if let Err(error) = std::fs::create_dir_all(folder.join("apps")).and_then(|()| std::fs::write(folder.join("apps").join(::client::identifier()), listens.to_string())) {
        eprintln!("this app can't say where it listens to the computer's other apps ({}): {error}", folder.display());
    }
    crate::spawn(async {
        crate::signed_in().await;
        if let Err(error) = keep_logo().await {
            eprintln!("this app's network's logo isn't beside the computer's other apps: {error:#}");
        }
    });
    std::thread::spawn(|| {
        let taken = std::fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(shared().join("shortcut.lock")).and_then(|mut lock| {
            lock.lock()?;
            lock.set_len(0)?;
            lock.write_all(::client::identifier().as_bytes())?;
            Ok(lock)
        });
        match taken {
            Ok(lock) => {
                let _ = HOLDS.set(lock);
                tell(Told::Shortcut(0));
            }
            Err(error) => eprintln!("the launcher's shortcut couldn't be shared with the computer's other apps: {error}"),
        }
    });
}

/// Keeps this app's network's logo, as its pages draw it (`/Logo.png`), beside where it listens, for the switcher.
async fn keep_logo() -> anyhow::Result<()> {
    let address = crate::views().map_err(anyhow::Error::msg)?.client.address().ok_or_else(|| anyhow::anyhow!("this client has no network's address"))?;
    let logo = ::client::web()?.get(format!("{}/Logo.png", address.trim_end_matches('/'))).send().await?.error_for_status()?.bytes().await?;
    std::fs::write(shared().join("apps").join(format!("{}.png", ::client::identifier())), logo)?;
    Ok(())
}

/// Every network's app running on this computer, this one too, by name, as its launcher's switcher shows them: each
/// one's `identifier`, `name`, `logo` (a `data:` address) and whether it's this one (`current`).
pub(crate) fn networks() -> Value {
    use data_encoding::BASE64;
    let apps = shared().join("apps");
    let mut running: Vec<Value> = std::fs::read_dir(&apps)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let identifier = entry.file_name().into_string().ok().filter(|name| !name.ends_with(".png"))?;
            let said: Value = serde_json::from_str(&std::fs::read_to_string(entry.path()).ok()?).ok()?;
            let current = identifier == ::client::identifier();
            // One that's quit, or was uninstalled, isn't listening.
            (current || ask(said["address"].as_str()?, &json!({})).is_ok()).then_some(())?;
            let logo = std::fs::read(apps.join(format!("{identifier}.png"))).ok().map(|logo| format!("data:image/png;base64,{}", BASE64.encode(&logo)));
            Some(json!({"identifier": identifier, "name": said["name"], "logo": logo, "current": current}))
        })
        .collect();
    running.sort_by(|one, other| one["name"].as_str().cmp(&other["name"].as_str()));
    json!(running)
}

/// Shows the launcher of the network's app `identifier` in place of this one's, as its person chose its tab or its
/// key (⌘2), which that app is told over its channel.
pub(crate) fn switch(identifier: &str) -> Result<Value, String> {
    let address = address(identifier).ok_or_else(|| format!("No app on this computer is {identifier}."))?;
    ask(&address, &json!({"again": {"link": null}})).map_err(|error| format!("{identifier} didn't answer: {error}"))?;
    tell(Told::Hide(false));
    Ok(json!({}))
}

/// The shortcut's keys as the computer keeps them, or the default: empty for none.
fn wanted() -> String {
    std::fs::read_to_string(shared().join("shortcut")).map(|chosen| chosen.trim().to_owned()).unwrap_or_else(|_| DEFAULT.to_owned())
}

/// Takes the shortcut, as this app comes to have it. One the system says another program has is asked for again
/// every tenth of a second, for up to 5 s (`Told::Shortcut`), as the system lets go of one a program had a moment
/// after it ends: an X server once it gets to that program's closed connection, as global-hotkey sends its ungrab
/// without flushing it (2 of 20 updates on Linux left the app with none, 20 Nov). `asked` is how many times it was
/// before. → what keeps it, for as long as the app runs.
pub(super) fn take(asked: u32) -> Option<Kept> {
    let wanted = wanted();
    if wanted.is_empty() {
        return None;
    }
    let key: HotKey = match wanted.parse() {
        Ok(key) => key,
        Err(error) => {
            eprintln!("the launcher's shortcut isn't one ({wanted}): {error}");
            return None;
        }
    };
    let keeper = GlobalHotKeyManager::new().and_then(|keeper| keeper.register(key).map(|()| keeper));
    match keeper {
        Ok(keeper) => {
            listen(key);
            eprintln!("the launcher's shortcut is {wanted}, for every network's app on this computer");
            Some((keeper, key))
        }
        Err(global_hotkey::Error::AlreadyRegistered(_)) if asked < 50 => {
            crate::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                tell(Told::Shortcut(asked + 1))
            });
            None
        }
        Err(error) => {
            eprintln!("the launcher has no shortcut ({wanted}): {error}");
            None
        }
    }
}

/// The shortcut, as `client()` says it: what it is (`keys`), null for none, and what it is where its person hasn't
/// chosen one (`default`), each in global-hotkey's words.
pub(crate) fn now() -> Value {
    let canonical = |keys: &str| keys.parse::<HotKey>().map_or_else(|_| keys.to_owned(), HotKey::into_string);
    let keys = Some(wanted()).filter(|keys| !keys.is_empty()).map(|keys| canonical(&keys));
    json!({"keys": keys, "default": canonical(DEFAULT)})
}

/// Makes the shortcut `keys`, in global-hotkey's words, or with none its default, as its person chose it in Settings
/// or onboarding, at once, with no restart, for every network's app on this computer: the app that has it takes it,
/// told over its channel where that's another. → what it is now (`now`), or why it couldn't be: one the system keeps
/// for itself, or what the system said as it refused it.
pub(crate) async fn change(keys: Option<String>) -> Result<Value, String> {
    if HOLDS.get().is_none() {
        return holder(json!({"shortcut": keys})).await;
    }
    let (answer, answered) = tokio::sync::oneshot::channel();
    tell(Told::Choose(keys, answer));
    answered.await.map_err(|_| "The app is quitting.".to_owned())?
}

/// Lets go of the shortcut while its person records another, so pressing it records it, as Raycast's and
/// KeyboardShortcuts' recorders do (`isPaused`), or takes it again: the app that has it does.
pub(crate) async fn pause(paused: bool) -> Result<Value, String> {
    if HOLDS.get().is_none() {
        return holder(json!({"shortcutPaused": paused})).await;
    }
    tell(Told::Paused(paused));
    Ok(json!({}))
}

/// Asks the app that has the shortcut to change it (`args`, as `client({ ... })` says it), over its channel.
async fn holder(args: Value) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut holder = String::new();
        std::fs::File::open(shared().join("shortcut.lock")).and_then(|mut lock| lock.read_to_string(&mut holder)).map_err(|error| error.to_string())?;
        let address = address(&holder).ok_or("No app on this computer has the shortcut just now.")?;
        let answer = ask(&address, &json!({"id": 1, "command": "change", "args": args})).map_err(|error| format!("{holder}, which has the shortcut, didn't answer: {error}"))?;
        match answer.get("error") {
            Some(error) => Err(error.as_str().map_or_else(|| error.to_string(), str::to_owned)),
            None => Ok(answer["result"].clone()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Where the app `identifier` listens, as it said as it started.
fn address(identifier: &str) -> Option<String> {
    let said = std::fs::read_to_string(shared().join("apps").join(identifier)).ok()?;
    serde_json::from_str::<Value>(&said).ok()?["address"].as_str().map(str::to_owned)
}

/// Sends `message` on the channel at `address`, and with an `id`, reads its answer.
fn ask(address: &str, message: &Value) -> std::io::Result<Value> {
    #[cfg(unix)]
    let mut channel = std::os::unix::net::UnixStream::connect(address)?;
    #[cfg(windows)]
    let mut channel = std::fs::OpenOptions::new().read(true).write(true).open(address)?;
    channel.write_all(format!("{message}\n").as_bytes())?;
    if message.get("id").is_none() {
        return Ok(Value::Null);
    }
    let mut line = String::new();
    std::io::BufReader::new(channel).read_line(&mut line)?;
    serde_json::from_str(&line).map_err(std::io::Error::other)
}

/// This app's launcher was shown, whichever way and whatever it shows (onboarding too), so its network is the one used
/// last, which the shortcut puts away, or shows next.
pub(super) fn used() {
    let _ = std::fs::write(shared().join("last"), ::client::identifier());
}

/// The shortcut was pressed, with `key` the key it ends with: the launcher of the network used last shows, or goes,
/// told over its channel where it's another app's, and this one's where that one isn't running.
fn pressed(key: String) {
    let asked = std::time::Instant::now();
    let last = std::fs::read_to_string(shared().join("last")).unwrap_or_default();
    if !last.is_empty() && last != ::client::identifier() {
        if let Some(address) = address(&last) {
            if ask(&address, &json!({"toggle": {"key": key}})).is_ok() {
                return;
            }
        }
    }
    tell(Told::Toggle(asked, Some(key)));
}

/// The shortcut each system keeps for itself, which another app can't have, and what has it: macOS's own (Keyboard
/// Shortcuts in System Settings), Windows' (Windows keyboard shortcuts) and a Linux desktop's window menu and input
/// source, as each documents them.
const RESERVED: &[(&str, &str)] = if cfg!(target_os = "macos") {
    &[
        ("super+Space", "Spotlight uses ⌘ Space."),
        ("control+Space", "macOS uses ⌃ Space to switch input sources."),
        ("control+super+Space", "macOS uses ⌃ ⌘ Space for emoji."),
        ("alt+super+Space", "Finder uses ⌥ ⌘ Space to search."),
        ("super+Tab", "macOS uses ⌘ Tab to switch apps."),
        ("super+KeyQ", "⌘ Q quits the app in front."),
        ("super+KeyW", "⌘ W closes the window in front."),
    ]
} else if cfg!(windows) {
    &[
        ("alt+Space", "Windows uses Alt Space for the window menu."),
        ("super+Space", "Windows uses this to switch keyboard language."),
        ("alt+Tab", "Windows uses Alt Tab to switch apps."),
        ("alt+F4", "Alt F4 closes the window in front."),
        ("super+KeyL", "Windows uses this to lock the PC."),
        ("super+KeyD", "Windows uses this to show the desktop."),
        ("super+KeyE", "Windows uses this to open File Explorer."),
        ("super+KeyR", "Windows uses this to open Run."),
        ("super+Tab", "Windows uses this for Task View."),
    ]
} else {
    &[
        ("alt+Space", "Your desktop uses Alt Space for the window menu."),
        ("super+Space", "Your desktop uses this to switch input source."),
        ("alt+Tab", "Your desktop uses Alt Tab to switch apps."),
        ("alt+F4", "Alt F4 closes the window in front."),
    ]
};

/// Makes the shortcut `keys`, or its default with none (`change`), where `kept` is the one this app has: a new one is
/// taken before the one it had is let go of, so a refused one leaves it as it was.
pub(super) fn choose(kept: &mut Option<Kept>, keys: Option<String>) -> Result<Value, String> {
    let file = shared().join("shortcut");
    let Some(keys) = keys else {
        if let Some((keeper, key)) = kept.take() {
            let _ = keeper.unregister(key);
        }
        std::fs::remove_file(&file).or_else(|error| if error.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(error) }).map_err(|error| error.to_string())?;
        *kept = take(0);
        return Ok(now());
    };
    let key: HotKey = keys.parse().map_err(|error| format!("That isn't a shortcut: {error}"))?;
    let keys = key.into_string();
    if let Some((_, why)) = RESERVED.iter().find(|(reserved, _)| reserved.parse::<HotKey>().is_ok_and(|reserved| reserved.id() == key.id())) {
        return Err(format!("{why} Try another."));
    }
    if kept.as_ref().is_none_or(|(_, now)| now.id() != key.id()) {
        let keeper = match kept.take() {
            Some((keeper, before)) => {
                let _ = keeper.unregister(before);
                keeper
            }
            None => GlobalHotKeyManager::new().map_err(|error| error.to_string())?,
        };
        if let Err(error) = keeper.register(key) {
            // The one it had comes back, as it was.
            *kept = take(0);
            return Err(match error {
                global_hotkey::Error::AlreadyRegistered(_) => "Another app uses it. Try another.".to_owned(),
                error => format!("The system won't let the app have it: {error}"),
            });
        }
        listen(key);
        *kept = Some((keeper, key));
        eprintln!("the launcher's shortcut is {keys}, as its person chose");
    }
    std::fs::write(&file, &keys).map_err(|error| error.to_string())?;
    Ok(now())
}

/// Hears `key` pressed, with the key it ends with, as the DOM names it, which a page it summons doesn't take as its
/// own.
fn listen(key: HotKey) {
    use global_hotkey::{GlobalHotKeyEvent, HotKeyState};
    let code = format!("{:?}", key.key);
    let last = match code.as_str() {
        "Space" => " ".to_owned(),
        letter if letter.starts_with("Key") => letter[3..].to_lowercase(),
        digit if digit.starts_with("Digit") => digit[5..].to_owned(),
        other => other.to_owned(),
    };
    GlobalHotKeyEvent::set_event_handler(Some(move |pressed_now: GlobalHotKeyEvent| {
        if pressed_now.id == key.id() && pressed_now.state == HotKeyState::Pressed {
            pressed(last.clone());
        }
    }));
}
