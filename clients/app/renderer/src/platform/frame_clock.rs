//! The windows' one frame clock, as Chromium's begin-frame source and Core Animation's display link have it: the
//! display's refreshes, each a whole refresh interval from the one its link last said a frame shows at (`tick`), and a
//! frame begun at the start of each while something moves (`begin`). A frame is for the refresh it's shown at
//! (`shows`), and what moves, by itself or as JS, Rust's springs or a harness move it, is drawn where it is at that
//! frame's time (`time`). Each platform's link (CVDisplayLink, CADisplayLink, Choreographer, the compositor clock,
//! Present, `requestAnimationFrame`, the fake display's) only says when the frame begun at its tick shows, and the
//! refresh: where it hasn't ticked yet, is late, or has stopped, the refreshes go on as it last said, so nothing else
//! stands in for it and nothing hands over.

use std::time::Duration;
use web_time::Instant;

/// How far a refresh's time, as a clock gives it in whole ns, is from a refresh's length (60 Hz's 16.666667 ms) on from
/// another's: a few ns either side, which held a frame due at the refresh it came at for a refresh more, the App
/// Library's category opening at 60 Hz showing its 8th frame twice and then jumping 45 pt. A time within it of a
/// refresh is at it.
const ROUNDING: Duration = Duration::from_micros(1);

#[derive(Default)]
pub(super) struct FrameClock {
    /// A refresh the display shows a frame at, as its link last said, or where it never has, the one the first frame
    /// was begun at: every other is whole refreshes from it.
    anchor: Option<Instant>,
    /// The refresh the last frame was begun at, or the one the loop was in as it first asked for frames since.
    begun: Option<Instant>,
    /// Whether the loop asked for the next frame as it last turned (`ask`).
    asked: bool,
}

impl FrameClock {
    /// The display's link ticked: the frame begun now shows at `shows`.
    pub(super) fn tick(&mut self, shows: Instant) {
        self.anchor = Some(shows);
    }

    /// Whether a frame begins now, at the refresh the display is in: once a refresh, as a link's tick begins one.
    pub(super) fn begin(&mut self, now: Instant, refresh: Duration) -> bool {
        let current = self.current(now, refresh);
        if self.begun.is_some_and(|begun| current < begun + refresh / 2) {
            return false;
        }
        self.begun = Some(current);
        true
    }

    /// The loop asks for frames from now on, or for none. Asked anew, the next begins at the display's next refresh,
    /// what's changed meanwhile being drawn at once (`Windows::turned`).
    pub(super) fn ask(&mut self, wanted: bool, now: Instant, refresh: Duration) {
        if wanted && !self.asked {
            let current = self.current(now, refresh);
            self.begun = Some(self.begun.map_or(current, |begun| begun.max(current)));
        }
        self.asked = wanted;
    }

    /// The refresh the display is in at `now`.
    fn current(&mut self, now: Instant, refresh: Duration) -> Instant {
        let anchor = *self.anchor.get_or_insert(now);
        refresh_at(anchor, refresh, now + ROUNDING, f64::floor)
    }

    /// Whether the loop asked for frames as it last turned.
    pub(super) fn asked(&self) -> bool {
        self.asked
    }

    /// How long until the next frame begins: at once where none has in the refresh the display is in.
    pub(super) fn due(&self, now: Instant, refresh: Duration) -> Duration {
        match (self.anchor, self.begun) {
            (Some(anchor), Some(begun)) => {
                refresh_at(anchor, refresh, begun + refresh / 2, f64::ceil).saturating_duration_since(now)
            }
            _ => Duration::ZERO,
        }
    }

    /// Whether frames are asked for and the display has begun a refresh no frame has yet: what the person does now came
    /// after its start, so it waits for the frame begun for it, and is drawn in the next, as a browser's input is in
    /// the frame begun after it.
    pub(super) fn overdue(&self, now: Instant, refresh: Duration) -> bool {
        self.asked && self.due(now, refresh).is_zero()
    }

    /// The refresh a frame presented at `at` shows at: the first a quarter of a refresh or more after it, as one
    /// presented in the quarter before a refresh is too late for it.
    pub(super) fn shows(&self, at: Instant, refresh: Duration) -> Instant {
        match self.anchor {
            Some(anchor) => refresh_at(anchor, refresh, at + refresh / 4 - ROUNDING, f64::ceil),
            None => at + refresh,
        }
    }

    /// The time a frame presented at `at` draws what moves at: the start of the refresh before the one it shows at, as
    /// a link's tick (`CADisplayLink.timestamp`) and `requestAnimationFrame` say it, where what the person does is drawn
    /// as it came. Each frame's is a whole refresh on from the one before.
    pub(super) fn time(&self, at: Instant, refresh: Duration) -> Instant {
        self.shows(at, refresh) - refresh
    }
}

/// Whether a window whose last frame shows at `shows` waits for it to before it draws again, at `now`: a window hands
/// the display at most one frame a refresh.
pub(super) fn waits(now: Instant, shows: Instant) -> bool {
    now + ROUNDING < shows
}

/// The refresh `at` is at, of those whole `refresh`es from `anchor`, rounded to one by `round` (the one before it, or
/// after).
fn refresh_at(anchor: Instant, refresh: Duration, at: Instant, round: fn(f64) -> f64) -> Instant {
    let from = match at.checked_duration_since(anchor) {
        Some(after) => after.as_secs_f64(),
        None => -anchor.duration_since(at).as_secs_f64(),
    };
    let refreshes = round(from / refresh.as_secs_f64());
    let by = refresh.mul_f64(refreshes.abs());
    if refreshes >= 0.0 { anchor + by } else { anchor.checked_sub(by).unwrap_or(anchor) }
}
