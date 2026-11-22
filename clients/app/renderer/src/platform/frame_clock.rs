//! The windows' one frame clock, as Chromium's begin-frame source and Core Animation's display link have it: the
//! display's refreshes, each a whole refresh interval from the one its link last said a frame shows at (`tick`), and a
//! frame begun at the start of each while something moves (`begin`). A frame is for the refresh it's shown at
//! (`shows`), and what moves, by itself or as JS, Rust's springs or a test move it, is drawn where it is at that
//! frame's time (`time`). Each platform's link (CVDisplayLink, CADisplayLink, Choreographer, the compositor clock,
//! Present, `requestAnimationFrame`, the fake display's) only says when the frame begun at its tick shows, and the
//! refresh: where it hasn't ticked yet, is late, or has stopped, the refreshes go on as it last said, so nothing else
//! stands in for it and nothing hands over. Frames begin, and windows wait, at the refreshes as the link last said;
//! what a frame draws is where it is at the refreshes the ticks say over time (`steady`), so a link whose tick wobbles
//! moves no frame's time with it.

use std::time::Duration;
use web_time::Instant;

/// How far a refresh's time, as a clock gives it in whole ns, is from a refresh's length (60 Hz's 16.666667 ms) on from
/// another's: a few ns either side, which held a frame due at the refresh it came at for a refresh more, the App
/// Library's category opening at 60 Hz showing its 8th frame twice and then jumping 45 pt. A time within it of a
/// refresh is at it.
const ROUNDING: Duration = Duration::from_micros(1);

/// How much of the way to a tick `steady`'s refreshes move at each: a link that times its tick as its thread wakes
/// (Windows' compositor clock) says each refresh a few tenths of a ms later or sooner than the last, and with each
/// frame's time taken from it as it said, a fling at 60 Hz sped and slowed by 3% a refresh. An eighth leaves a tenth of
/// that, and still follows a display whose refresh is a little off what it said within a few refreshes.
const FOLLOW: f64 = 1.0 / 8.0;

#[derive(Default)]
pub(super) struct FrameClock {
    /// A refresh the display shows a frame at, as its link last said, or where it never has, the one the first frame
    /// was begun at: every other is whole refreshes from it.
    anchor: Option<Instant>,
    /// A refresh the display shows a frame at, as its link's ticks say over time: each moves it `FOLLOW` of the way to
    /// what it says, or all the way where that's a quarter of a refresh or more from it. A frame's time is its.
    steady: Option<Instant>,
    /// The refresh the last frame was begun at, or the one the loop was in as it first asked for frames since.
    begun: Option<Instant>,
    /// Whether the loop asked for the next frame as it last turned (`ask`).
    asked: bool,
}

impl FrameClock {
    /// The display's link ticked: the frame begun now shows at `shows`.
    pub(super) fn tick(&mut self, shows: Instant, refresh: Duration) {
        self.anchor = Some(shows);
        self.steady = Some(match self.steady {
            Some(steady) => {
                let at = refresh_at(steady, refresh, shows, f64::round);
                match shows.checked_duration_since(at) {
                    Some(late) if late < refresh / 4 => at + late.mul_f64(FOLLOW),
                    None if at.duration_since(shows) < refresh / 4 => at - at.duration_since(shows).mul_f64(FOLLOW),
                    _ => shows,
                }
            }
            None => shows,
        });
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

    /// Whether a window whose last frame shows at `shows` waits for it to before it draws again, at `now`: while that's
    /// a refresh after the one the display is in, a window handing the display at most one frame a refresh. Taken by
    /// refresh, half of one either side, as `begin` is: a link that times its tick as its thread wakes (Windows'
    /// compositor clock) says each refresh a few tenths of a ms later or sooner than the tick before, and a window whose
    /// frame showed at the refresh just begun, as the last tick had it, waited a whole refresh more where this one had
    /// it begin a fraction of a ms sooner: a Surface's windows drew every other refresh, 22 Nov.
    pub(super) fn waits(&mut self, now: Instant, refresh: Duration, shows: Instant) -> bool {
        // Mutant: taken to the microsecond, as before 22 Nov.
        if crate::mutants::mutant("late-tick-held") {
            return now + ROUNDING < shows;
        }
        shows >= self.current(now, refresh) + refresh / 2
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
    /// as it came, taken at `steady`'s refreshes. Each frame's is a whole refresh on from the one before.
    pub(super) fn time(&self, at: Instant, refresh: Duration) -> Instant {
        let shows = self.shows(at, refresh);
        self.steady.map_or(shows, |steady| refresh_at(steady, refresh, shows, f64::round)) - refresh
    }
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
