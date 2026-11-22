//! When this program last couldn't run: its device went to sleep, or its system suspended it in the background. A
//! thread asks the time every `TICK`, and one that finds it came `GAP` or more late says the program was stopped for
//! what's between. A time measured across it, an app's open, counts the sleep (24 to 40 minutes on a Mac and an iPhone,
//! 22 Nov), so it isn't told: `within`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const TICK: Duration = Duration::from_secs(2);
const GAP: Duration = Duration::from_secs(4);

/// When it last came back, in milliseconds since 1970, or 0.
static CAME_BACK: AtomicU64 = AtomicU64::new(0);

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |now| now.as_millis() as u64)
}

/// Starts watching, on a thread of its own.
pub(crate) fn watch() {
    std::thread::spawn(|| {
        let mut before = now();
        loop {
            std::thread::sleep(TICK);
            let at = now();
            if at.saturating_sub(before) >= (TICK + GAP).as_millis() as u64 {
                CAME_BACK.store(at, Ordering::Relaxed);
            }
            before = at;
        }
    });
}

/// Whether the program was stopped in the last `ms` milliseconds.
pub(crate) fn within(ms: u64) -> bool {
    let came_back = CAME_BACK.load(Ordering::Relaxed);
    came_back > 0 && now().saturating_sub(came_back) <= ms
}
