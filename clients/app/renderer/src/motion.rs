//! How things move by themselves, the one place it's worked out: a spring, as SwiftUI's and Motion's (a style's
//! transition, a window let go), a fling slowing down, as UIScrollView's deceleration, the rubber band past an edge, as
//! UIScrollView's bounce, and how fast a finger was going as it let go.

use web_time::Instant;

use crate::geometry::{Point, point};

/// A spring with a mass of 1, as SwiftUI's `.spring(duration:bounce:)` gives one: how stiff it is and how damped.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spring {
    pub stiffness: f32,
    pub damping: f32,
}

impl Spring {
    /// SwiftUI's: `duration` in milliseconds, and `bounce` from 0, none, to 1 (below 0, more damped than none).
    pub fn new(duration: f32, bounce: f32) -> Spring {
        let response = (duration / 1000.0).max(0.01);
        let fraction = if bounce >= 0.0 { 1.0 - bounce } else { 1.0 / (1.0 + bounce) };
        Spring { stiffness: (2.0 * std::f32::consts::PI / response).powi(2), damping: 4.0 * std::f32::consts::PI * fraction / response }
    }

    /// Where something `from` past where it's going, moving at `velocity` (each a second), is `seconds` later, and how
    /// fast it moves then: the damped spring's own solution, so it's the same at any frame rate.
    pub fn at(&self, from: f64, velocity: f64, seconds: f64) -> (f64, f64) {
        let (k, c, t) = (f64::from(self.stiffness), f64::from(self.damping), seconds);
        let natural = k.sqrt();
        let ratio = c / (2.0 * natural);
        if (ratio - 1.0).abs() < 1e-4 {
            let e = (-natural * t).exp();
            let b = velocity + natural * from;
            ((from + b * t) * e, (velocity - natural * b * t) * e)
        } else if ratio < 1.0 {
            let damped = natural * (1.0 - ratio * ratio).sqrt();
            let (a, b) = (from, (velocity + ratio * natural * from) / damped);
            let (e, (sin, cos)) = ((-ratio * natural * t).exp(), (damped * t).sin_cos());
            (e * (a * cos + b * sin), e * ((b * damped - ratio * natural * a) * cos - (a * damped + ratio * natural * b) * sin))
        } else {
            let root = natural * (ratio * ratio - 1.0).sqrt();
            let (r1, r2) = (-ratio * natural + root, -ratio * natural - root);
            let a = (velocity - r2 * from) / (r1 - r2);
            let b = from - a;
            let (e1, e2) = ((r1 * t).exp(), (r2 * t).exp());
            (a * e1 + b * e2, a * r1 * e1 + b * r2 * e2)
        }
    }

    /// Where something let go `off` from where it rests, going `velocity` (each a second), is `seconds` later, and how
    /// fast it goes then. Flung toward where it rests hard enough to get there by itself (its momentum, slowing as
    /// UIScrollView's does, carries it that far: the projection the UI library's `projected` makes), from further than
    /// this spring would let it go on without pulling it faster, it carries on at that speed till it's as near as this
    /// spring pulls it no harder than its damping holds it back (`damping · velocity / stiffness`), where this spring
    /// takes it in, so it leaves at the speed it was let go at and eases in, as a fling does; otherwise this spring takes
    /// it from where it is. A launcher's page swiped at 2,000 pt a second, 520 pt short of the next, was sped on to
    /// 4,100 by the pages' spring.
    pub fn let_go(&self, off: f64, velocity: f64, seconds: f64) -> (f64, f64) {
        let toward = -velocity * off.signum();
        let near = f64::from(self.damping) * toward / f64::from(self.stiffness);
        if toward <= 0.0 || near >= off.abs() || toward / 1000.0 * DECELERATION / (1.0 - DECELERATION) < off.abs() {
            return self.at(off, velocity, seconds);
        }
        let cruise = (off.abs() - near) / toward;
        if seconds < cruise {
            return (off + velocity * seconds, velocity);
        }
        self.at(near * off.signum(), velocity, seconds - cruise)
    }

    /// Whether something `off` from where it's going, at `velocity`, has arrived: within `near`, and moving no faster
    /// than ten times that a second. What moves on the screen is near within `NEAR`.
    pub fn arrived(off: f64, velocity: f64, near: f64) -> bool {
        // Mutant: at rest ten times as far off, a tenth of a point, as springs were before dc4643aa1.
        let near = if crate::mutants::mutant("spring-rest") { near * 10.0 } else { near };
        off.abs() < near && velocity.abs() < near * 10.0
    }
}

/// How near where it's going, in points, what a spring moves on the screen has arrived and is put there: a hundredth of
/// a point, a thirtieth of a pixel at 3x, where text is drawn in quarters of one (`text::SUBPIXEL_VARIANTS`), so putting
/// it there moves it less than its last steps did. Within a tenth, its last step was several times the ones before it,
/// over a quarter pixel, and redrew its text a quarter pixel along: a card let go went 34.11, 34.09, then 34.00 pt,
/// changing 13,399 pixels by up to 21 levels where each step before changed 2,800 by 5.
pub const NEAR: f64 = 0.01;

/// How much of its speed a fling keeps each millisecond: UIScrollView's normal deceleration rate.
const DECELERATION: f64 = 0.998;

/// A fling going `velocity` (each a second), `seconds` later: how far it's gone, and how fast it goes then, as
/// UIScrollView's deceleration has it.
pub fn decay(velocity: f64, seconds: f64) -> (f64, f64) {
    let kept = DECELERATION.powf(seconds * 1000.0);
    (velocity * (kept - 1.0) / DECELERATION.ln() / 1000.0, velocity * kept)
}

/// How far something pulled `past` an edge shows past it, in something `size` long: less the further it's pulled,
/// never as far as `size`, as UIScrollView's rubber band. `elastic` is how loose it is: iOS's is 0.55.
pub fn rubber_band(past: f32, size: f32, elastic: f32) -> f32 {
    if size <= 0.0 || elastic <= 0.0 {
        return 0.0;
    }
    (1.0 - 1.0 / (past.abs() * elastic / size + 1.0)) * size * past.signum()
}

/// How far what `rubber_band` gives moves for each point it's pulled on, `past` its end: its slope there, by which a
/// stretch let go goes on at the speed it was drawn going, not the finger's.
pub fn rubber_band_slope(past: f32, size: f32, elastic: f32) -> f32 {
    if size <= 0.0 || elastic <= 0.0 {
        return 0.0;
    }
    let pulled = past.abs() * elastic / size + 1.0;
    elastic / (pulled * pulled)
}

/// Where a finger has been lately, for how fast it was going as it lets go, by whatever clock its caller keeps, in
/// milliseconds: a screen's, which an agent's paused clock steps, or the system's (`now`).
#[derive(Default)]
pub struct Velocity {
    lately: Vec<(f64, Point<f32>)>,
}

/// How far back a finger's speed is measured, in milliseconds: UIScrollView's pan measures it over its last tenth of
/// a second.
const LATELY: f64 = 100.0;

/// The system's clock, in milliseconds since this process first asked.
pub fn now() -> f64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

impl Velocity {
    /// The finger is at `at` at `time`.
    pub fn add(&mut self, at: Point<f32>, time: f64) {
        self.lately.retain(|(when, _)| time - when <= LATELY);
        self.lately.push((time, at));
    }

    /// Where it was last.
    pub fn last(&self) -> Option<Point<f32>> {
        self.lately.last().map(|(_, at)| *at)
    }

    /// How fast it's been going over its last tenth of a second until `time`, in its points a second, along and down:
    /// a finger that stopped before it let go was going slower, and one still all that time not at all.
    pub fn get(&self, time: f64) -> Point<f32> {
        let first = self.lately.iter().find(|(when, _)| time - when <= LATELY);
        let (Some(first), Some(last)) = (first, self.lately.last()) else { return point(0.0, 0.0) };
        let seconds = ((time - first.0) / 1000.0).max(0.008) as f32;
        point((last.1.x - first.1.x) / seconds, (last.1.y - first.1.y) / seconds)
    }
}
