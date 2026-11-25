//! Whether this computer's person is away from it, which every page hears (`idle` in its host context, the UI library's
//! `idle()`): its screen is locked, or nobody has touched its keyboard or pointer for `AWAY`, as its system counts its
//! idle time (a Mac's `CGEventSourceSecondsSinceLastEventType`, Windows' `GetLastInputInfo`). Asleep, its pages don't
//! run, and woken they hear it at once, as nobody has touched it since. A Linux desktop says neither here, so its person
//! is never away.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::json;

/// How long untouched it's away, as chat apps count someone away.
const AWAY: Duration = Duration::from_secs(5 * 60);

/// How often it's asked: neither system tells an app its idle time as it passes, only as it's asked, as Slack's and
/// Teams' presence asks it.
const EVERY: Duration = Duration::from_secs(5);

static IDLE: AtomicBool = AtomicBool::new(false);

/// Whether its person is away, as it was last asked.
pub(crate) fn now() -> bool {
    IDLE.load(Ordering::Relaxed)
}

/// Asks, every `EVERY`, whether its person is away, and tells every page as it changes.
pub(crate) fn watch() {
    crate::spawn(async {
        let mut every = tokio::time::interval(EVERY);
        loop {
            every.tick().await;
            let idle = locked() || since_input().is_some_and(|since| since >= AWAY);
            if IDLE.swap(idle, Ordering::Relaxed) != idle {
                eprintln!("its person is {} this computer", if idle { "away from" } else { "back at" });
                crate::app().shell.emit("idle", json!(idle));
            }
        }
    });
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void};

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        pub fn CGEventSourceSecondsSinceLastEventType(state: i32, event: u32) -> f64;
        pub fn CGSessionCopyCurrentDictionary() -> *const c_void;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        pub fn CFDictionaryGetValue(dictionary: *const c_void, key: *const c_void) -> *const c_void;
        pub fn CFStringCreateWithCString(allocator: *const c_void, text: *const c_char, encoding: u32) -> *const c_void;
        pub fn CFBooleanGetValue(boolean: *const c_void) -> bool;
        pub fn CFRelease(object: *const c_void);
    }
}

/// How long since its keyboard or pointer was last touched, by anything on its session.
#[cfg(target_os = "macos")]
fn since_input() -> Option<Duration> {
    // kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType.
    let seconds = unsafe { mac::CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
    Duration::try_from_secs_f64(seconds).ok()
}

/// Whether its screen is locked, as its session says (`CGSSessionScreenIsLocked`).
#[cfg(target_os = "macos")]
fn locked() -> bool {
    unsafe {
        let session = mac::CGSessionCopyCurrentDictionary();
        if session.is_null() {
            return false;
        }
        // kCFStringEncodingUTF8.
        let key = mac::CFStringCreateWithCString(std::ptr::null(), c"CGSSessionScreenIsLocked".as_ptr(), 0x0800_0100);
        let value = mac::CFDictionaryGetValue(session, key);
        let locked = !value.is_null() && mac::CFBooleanGetValue(value);
        mac::CFRelease(key);
        mac::CFRelease(session);
        locked
    }
}

#[cfg(windows)]
fn since_input() -> Option<Duration> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut last = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    unsafe { GetLastInputInfo(&mut last) }.as_bool().then(|| Duration::from_millis(u64::from(unsafe { GetTickCount() }.wrapping_sub(last.dwTime))))
}

/// Whether its workstation is locked, as its session says (`WTSSessionInfoEx`'s `SessionFlags`, which Windows 10 and
/// later say the right way round).
#[cfg(windows)]
fn locked() -> bool {
    use windows::Win32::System::RemoteDesktop::{WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK, WTSFreeMemory, WTSINFOEXW, WTSQuerySessionInformationW, WTSSessionInfoEx};
    let (mut info, mut size) = (windows::core::PWSTR::null(), 0u32);
    if unsafe { WTSQuerySessionInformationW(None, WTS_CURRENT_SESSION, WTSSessionInfoEx, &mut info, &mut size) }.is_err() || info.is_null() {
        return false;
    }
    let flags = unsafe { (*info.0.cast::<WTSINFOEXW>()).Data.WTSInfoExLevel1.SessionFlags };
    unsafe { WTSFreeMemory(info.0.cast()) };
    flags == WTS_SESSIONSTATE_LOCK as i32
}

#[cfg(target_os = "linux")]
fn since_input() -> Option<Duration> {
    None
}

#[cfg(target_os = "linux")]
fn locked() -> bool {
    false
}
