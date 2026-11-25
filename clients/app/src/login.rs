//! Whether a computer's app starts when its person logs in, as Raycast, Dropbox and every other app that's always
//! there does: on by default, and Settings' "Open at login" turns it off. It starts with its launcher put away, holding
//! the connection and notifications (DESIGN.md, Launcher).
//!
//! Each system keeps it as its own apps do, and is the one that says whether it's on, so a person who turns it off
//! there (a Mac's System Settings → General → Login Items) finds it off here: a Mac's by `SMAppService.mainApp`, as
//! Apple names for an app's own login item, Windows' by the current user's `Run` key, and a Linux desktop's by an XDG
//! autostart entry. Only an installed build keeps it, as its program is where it will be: a developer's, or a client
//! kept somewhere of its own (`ONE_HOME`), has none.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

/// The name it's kept by, a `Run` key's value and an autostart entry's: the app's, so a network's own app has one of
/// its own beside the One App's (`app_name` in core/client).
fn key() -> &'static str {
    ::client::app_name()
}

/// Whether this build keeps one.
pub fn available() -> bool {
    !cfg!(debug_assertions) && std::env::var_os("ONE_HOME").is_none()
}

/// Whether it starts at login, as the system last said. Asking a Mac takes ServiceManagement a round trip to its
/// daemon, 200 ms and more (574 ms on a busy Mac, 25 Nov), which every page asking `client()` waited on, on the
/// windows' thread: so it's kept, read as the app starts and again behind each ask, and a change made in the system's
/// own settings shows from the ask after.
static KEPT: Mutex<Option<bool>> = Mutex::new(None);
static READING: AtomicBool = AtomicBool::new(false);

fn kept() -> std::sync::MutexGuard<'static, Option<bool>> {
    KEPT.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Asks the system, and keeps what it says.
fn read() -> bool {
    let on = is_on();
    *kept() = Some(on);
    on
}

/// Asks the system again on a thread of its own, unless that's already under way.
fn read_again() {
    if !READING.swap(true, Ordering::AcqRel) {
        std::thread::spawn(|| {
            read();
            READING.store(false, Ordering::Release);
        });
    }
}

/// Whether the app starts at login, as the system last said (`KEPT`); `None` where this build keeps none.
pub fn enabled() -> Option<bool> {
    if !available() {
        return None;
    }
    let was = *kept();
    read_again();
    Some(was.unwrap_or_else(read))
}

/// Makes the app start at login, or not.
pub fn set(on: bool) -> anyhow::Result<()> {
    anyhow::ensure!(available(), "This build of the app doesn't open at login.");
    if on == read() {
        return Ok(());
    }
    change(on)?;
    *kept() = Some(on);
    Ok(())
}

/// A new install opens at login, once: after that it's what its person chose, which the system keeps.
pub fn begin(home: &std::path::Path) {
    if !available() {
        return;
    }
    read_again();
    let chosen: PathBuf = home.join("login");
    if chosen.exists() {
        return;
    }
    match set(true) {
        Ok(()) => {
            let _ = std::fs::write(chosen, "");
        }
        Err(error) => eprintln!("this app doesn't open at login: {error:#}"),
    }
}

#[cfg(target_os = "macos")]
mod system {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    #[link(name = "ServiceManagement", kind = "framework")]
    unsafe extern "C" {}

    /// `SMAppService.mainApp`, which ServiceManagement keeps registered for the running app's bundle.
    fn service() -> *mut AnyObject {
        unsafe { msg_send![objc2::class!(SMAppService), mainAppService] }
    }

    /// `SMAppServiceStatusEnabled`; the others are not registered (0), needing its person's say in System Settings
    /// (2) and not found (3).
    pub fn is_on() -> bool {
        let status: isize = unsafe { msg_send![service(), status] };
        status == 1
    }

    pub fn change(on: bool) -> anyhow::Result<()> {
        let mut error: *mut AnyObject = std::ptr::null_mut();
        let done: bool = unsafe {
            if on {
                msg_send![service(), registerAndReturnError: &mut error]
            } else {
                msg_send![service(), unregisterAndReturnError: &mut error]
            }
        };
        if done {
            return Ok(());
        }
        let why = unsafe {
            let text: *mut AnyObject = if error.is_null() { error } else { msg_send![error, localizedDescription] };
            let utf8: *const std::ffi::c_char = if text.is_null() { std::ptr::null() } else { msg_send![text, UTF8String] };
            if utf8.is_null() { "macOS gave no reason".to_owned() } else { std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned() }
        };
        anyhow::bail!("macOS wouldn't {} it as a login item: {why}", if on { "register" } else { "unregister" })
    }
}

#[cfg(windows)]
mod system {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ, RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW};
    use windows::core::HSTRING;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    pub fn is_on() -> bool {
        unsafe { RegGetValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN), &HSTRING::from(super::key()), RRF_RT_REG_SZ, None, None, None) }.is_ok()
    }

    pub fn change(on: bool) -> anyhow::Result<()> {
        if on {
            let program = cli::serving::program()?;
            let value: Vec<u16> = format!("\"{}\"", program.display()).encode_utf16().chain([0]).collect();
            unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN), &HSTRING::from(super::key()), REG_SZ.0, Some(value.as_ptr().cast()), (value.len() * 2) as u32) }.ok()?;
        } else {
            unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN), &HSTRING::from(super::key())) }.ok()?;
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod system {
    use std::path::PathBuf;

    fn entry() -> anyhow::Result<PathBuf> {
        Ok(dirs::config_dir().ok_or_else(|| anyhow::anyhow!("this user has no config folder"))?.join("autostart").join(format!("{}.desktop", ::client::command())))
    }

    pub fn is_on() -> bool {
        entry().is_ok_and(|entry| entry.exists())
    }

    pub fn change(on: bool) -> anyhow::Result<()> {
        let entry = entry()?;
        if on {
            let program = cli::serving::program()?;
            std::fs::create_dir_all(entry.parent().expect("a file has a folder"))?;
            std::fs::write(&entry, format!("[Desktop Entry]\nType=Application\nName={}\nExec=\"{}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n", super::key(), program.display()))?;
        } else {
            std::fs::remove_file(&entry)?;
        }
        Ok(())
    }
}

use system::{change, is_on};
