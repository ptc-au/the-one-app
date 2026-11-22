//! The windows' thread's calls into the GPU's driver that a wait of ours can't bound (taking an image to draw on,
//! submitting, presenting, configuring or letting go of a surface), watched from a thread of their own. One that hasn't
//! returned in `HANG` (`renderer::HANG`) is a driver that hung, as a Surface's Intel driver did as it failed its reset (22 Nov), and
//! nothing on that thread runs again: whoever started the renderer is told (`when_stuck`), and with no one told, the
//! program ends, saying why, rather than showing a window that never changes.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

/// The call into the driver the windows' thread is in, and since when.
static CALLING: Mutex<Option<(&'static str, Instant)>> = Mutex::new(None);
static STUCK: OnceLock<Box<dyn Fn(&str) + Send + Sync>> = OnceLock::new();

/// Has `stuck` told why the windows' thread is stuck in the GPU's driver, once, from the watchdog's thread: the app
/// tells Telemetry and starts again.
pub fn when_stuck(stuck: impl Fn(&str) + Send + Sync + 'static) {
    let _ = STUCK.set(Box::new(stuck));
}

/// The windows' thread is in a call into the driver, `what`, till it's dropped.
pub(crate) struct Calling;

impl Drop for Calling {
    fn drop(&mut self) {
        *CALLING.lock().expect("nothing panics holding it") = None;
    }
}

/// The windows' thread is calling `what` into the driver, till what this gives is dropped. The browser's GPU has its
/// own watchdog, which loses the device.
pub(crate) fn calling(what: &'static str) -> Calling {
    #[cfg(not(target_arch = "wasm32"))]
    {
        static WATCHING: std::sync::Once = std::sync::Once::new();
        WATCHING.call_once(|| drop(std::thread::Builder::new().name("gpu-watchdog".into()).spawn(watch)));
        *CALLING.lock().expect("nothing panics holding it") = Some((what, Instant::now()));
    }
    let _ = what;
    Calling
}

#[cfg(not(target_arch = "wasm32"))]
fn watch() {
    use super::renderer::HANG;
    loop {
        std::thread::sleep(HANG / 8);
        let Some((what, since)) = *CALLING.lock().expect("nothing panics holding it") else { continue };
        if since.elapsed() < HANG {
            continue;
        }
        let said = format!("the GPU hung: {what} didn't return in {} s", HANG.as_secs());
        log::error!("{said}");
        match STUCK.get() {
            Some(stuck) => stuck(&said),
            None => {
                eprintln!("{said}");
                std::process::exit(3)
            }
        }
        return;
    }
}
