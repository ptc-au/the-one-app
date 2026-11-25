//! What scrolls under a finger, as UIScrollView's does: dragged past its end, it gives as a rubber band; let go there,
//! it springs back; flung, it slows as UIScrollView's deceleration has it and bounces off its end. The screen does it
//! all, where the touch arrives, each frame on its own clock (`motion`), and draws how far it's stretched past its end
//! as its content moved (`Screen::stretched`), never as how far it's scrolled, which its page is told.

use serde_json::json;

use super::Screen;
use crate::geometry::{Point, point};
use crate::motion::{Spring, decay, decay_for, rubber_band, rubber_band_slope};
use crate::tree::Id;

/// How loose the rubber band is: UIScrollView's.
const ELASTIC: f32 = 0.55;
/// How it springs back to its end: critically damped, as UIScrollView's bounce.
const BACK: Spring = Spring { stiffness: 228.0, damping: 30.2 };
/// The speed, in points a second, below which a fling stops, and the least a lift has to be one.
const STOPPED: f32 = 20.0;
const FLUNG: f32 = 200.0;

/// How long a mouse wheel's notch eases what it scrolls, in ms: its distance over that time, slow at both ends (a raised
/// cosine's speed), each notch on its own, so one that comes as another eases adds to where it's going without starting
/// it again, and a steady hand's notches, each a share of that time apart, add up to a steady speed, as a Mac's smooth
/// scrolling and Chrome's go. A spring that each notch sent on from where it was went fast then slow at every notch:
/// 13, 17, 18 pt a frame at 60 Hz, over and over.
const NOTCH_MS: f64 = 150.0;

/// How much of its way a notch has gone `u` of the way through its time: a raised cosine's speed, summed.
fn eased(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    u - (std::f64::consts::TAU * u).sin() / std::f64::consts::TAU
}

/// A scroll's motion of its own, along or down (`along`): held stretched past its end by a finger (`pulled`, how far
/// the finger's gone past it), springing back from `stretch` at `velocity`, flung at `velocity`, each a second, stepped
/// last at `stepped` (ms on the screen's clock), or easing to where a wheel's notches send it (`aim`).
pub(super) struct Coast {
    along: bool,
    held: bool,
    flung: bool,
    pulled: f32,
    stretch: f32,
    velocity: f32,
    stepped: f64,
    pub(super) aim: Option<Aim>,
}

/// Where a wheel's notches send a scroll (`to`), and each notch still easing there: when it turned (ms on the screen's
/// clock) and how far it sends it; and as of the frame before, where their easing had it, how far it went then, and
/// how far it was drawn going on whole points (`last`).
pub(super) struct Aim {
    to: f32,
    notches: Vec<(f64, f32)>,
    last: Option<(f64, f64, f32)>,
}

impl Screen {
    /// What a finger's moves at `at` scroll, from the innermost out: what it scrolled first (`latched`), for all its
    /// moves, as a browser latches a scroll gesture to the scroller it began on; else what's under it. A page flung from
    /// between two cards gave the rest of its moves to the list of the card that came under the finger, which ran to
    /// its end and stretched, the page stopped dead (23 Nov). (Mutant: never latched.)
    pub(super) fn reached(&self, at: Point<f32>, latched: Option<Id>) -> (Option<Id>, Vec<Id>) {
        let latched = latched.filter(|id| !crate::mutants::mutant("unlatched") && self.placed(*id).is_some_and(|placed| placed.scroll.is_some()));
        (latched, latched.map_or_else(|| self.under(at), |id| vec![id]))
    }

    /// The innermost thing in `chain` that scrolls the way `by` goes: its id, whether it scrolls along, how far it's
    /// scrolled that way, how far it can, and how long it is that way.
    fn scroller(&self, chain: &[Id], by: Point<f32>) -> Option<(Id, bool, f32, f32, f32)> {
        let along = by.x.abs() > by.y.abs();
        chain.iter().copied().find_map(|id| {
            let placed = self.placed(id)?;
            let (most_y, most_x, its_along) = placed.scroll?;
            (its_along == along).then_some(())?;
            let now = self.scrolled.get(&id).copied().unwrap_or(point(0.0, 0.0));
            Some(if along { (id, true, now.x, most_x, placed.shown.size.width) } else { (id, false, now.y, most_y, placed.shown.size.height) })
        })
    }

    /// A finger on what scrolls at `at` moved it `by` points (down and right positive, as `pan`): it scrolls, and past
    /// its end, stretches, less the further it's pulled; pulled back, it gives up its stretch before it scrolls. What
    /// it scrolled first (`latched`) it goes on scrolling (`reached`).
    pub fn drag_scroll(&mut self, at: Point<f32>, by: Point<f32>, latched: Option<Id>) -> Option<Id> {
        let (latched, chain) = self.reached(at, latched);
        let held = chain.iter().copied().find(|id| self.coasts.get(id).is_some_and(|coast| coast.held));
        let target = match held {
            Some(id) => Some(id),
            None => {
                if let Some(scrolled) = self.pan_latched(at, by, latched) {
                    return Some(scrolled);
                }
                let (id, along, _, _, _) = self.scroller(&chain, by)?;
                let now = self.js.clock().now();
                self.coasts.insert(id, Coast { along, held: true, flung: false, pulled: 0.0, stretch: 0.0, velocity: 0.0, stepped: now, aim: None });
                Some(id)
            }
        };
        let id = target?;
        let size = self.placed(id).map_or(0.0, |placed| if self.coasts[&id].along { placed.shown.size.width } else { placed.shown.size.height });
        let coast = self.coasts.get_mut(&id).expect("it's held");
        let pulled = coast.pulled + if coast.along { by.x } else { by.y };
        // Pulled back past its end, what's left scrolls.
        if pulled == 0.0 || pulled.signum() != coast.pulled.signum() && coast.pulled != 0.0 {
            let along = coast.along;
            self.coasts.remove(&id);
            if pulled != 0.0 {
                self.pan_latched(at, if along { point(pulled, 0.0) } else { point(0.0, pulled) }, Some(id));
            }
        } else {
            coast.pulled = pulled;
            coast.stretch = rubber_band(pulled, size, ELASTIC);
        }
        Some(id)
    }

    /// The finger that scrolled `id` lifted going `velocity` points a second (as a scroll goes): stretched, it springs
    /// back from the speed its stretch was going, which gives less the further it's pulled, as UIScrollView's does (at
    /// the finger's, it sped up as it was let go: 2.8 pt a refresh, then 5.1); otherwise, fast enough, it's flung. What
    /// goes on is what the finger scrolled, as a browser's fling and UIScrollView's deceleration do, not what's innermost
    /// under it: a page's own scroll as tall as its content, under a finger that scrolled the window, took the fling
    /// and stopped it dead.
    pub fn release_scroll(&mut self, id: Option<Id>, velocity: Point<f32>) {
        let Some((id, (_, _, along))) = id.and_then(|id| Some((id, self.placed(id)?.scroll?))) else { return };
        let now = self.js.clock().now();
        if self.coasts.get(&id).is_some_and(|coast| coast.held) {
            let size = self.placed(id).map_or(0.0, |placed| if self.coasts[&id].along { placed.shown.size.width } else { placed.shown.size.height });
            let coast = self.coasts.get_mut(&id).expect("it's held");
            coast.velocity = rubber_band_slope(coast.pulled, size, ELASTIC) * if coast.along { velocity.x } else { velocity.y };
            (coast.held, coast.stepped) = (false, now);
            return self.changed();
        }
        let speed = if along { velocity.x } else { velocity.y };
        if speed.abs() > FLUNG {
            self.coasts.insert(id, Coast { along, held: false, flung: true, pulled: 0.0, stretch: 0.0, velocity: speed, stepped: now, aim: None });
            self.changed();
        }
    }

    /// A finger landed at `at`: what's flung or springing back under it stops where it is, held there. → whether
    /// something was moving, which the finger only stops.
    pub fn catch_scroll(&mut self, at: Point<f32>) -> bool {
        let caught: Vec<Id> = self.under(at).into_iter().filter(|id| self.coasts.get(id).is_some_and(|coast| !coast.held)).collect();
        for id in &caught {
            let size = self.placed(*id).map_or(0.0, |placed| if self.coasts[id].along { placed.shown.size.width } else { placed.shown.size.height });
            let coast = self.coasts.get_mut(id).expect("it's coasting");
            if coast.stretch == 0.0 {
                self.coasts.remove(id);
                continue;
            }
            // Held where it's stretched to, as far past its end as a finger would have pulled it to stretch it so.
            let shown = (coast.stretch.abs() / size.max(1.0)).min(0.99);
            coast.pulled = coast.stretch.signum() * size * (1.0 / (1.0 - shown) - 1.0) / ELASTIC;
            (coast.held, coast.flung, coast.velocity) = (true, false, 0.0);
        }
        !caught.is_empty()
    }

    /// Steps what's flung, springing back or easing to `now`, the time of the frame it's drawn in, on the screen's
    /// clock: a fling scrolls on, slowing, and bounces off an end it reaches at the speed it has; a stretch springs
    /// back; a wheel's notch eases on to where it's going.
    pub(super) fn coast(&mut self, now: f64) {
        let ids: Vec<Id> = self.coasts.keys().copied().collect();
        for id in ids {
            let coast = self.coasts.get_mut(&id).expect("it's there");
            if coast.held {
                continue;
            }
            let seconds = ((now - coast.stepped) / 1000.0).max(0.0);
            coast.stepped = now;
            if let Some(aim) = &mut coast.aim {
                // Short of where it's going by what its notches have still to go, on whole points, as a browser's
                // compositor puts a scroll on whole pixels, so its words are drawn as they were, not rasterized again
                // at each new fraction of a point.
                // Each step on whole points speeds up and slows down as the easing does, where that keeps it within a
                // point of it: rounded alone, a slowing easing's last steps went 2, 1, 2, 0, 1 pt a refresh. Its last
                // step puts it where its notches send it.
                let left: f64 = aim.notches.iter().map(|(turned, by)| f64::from(*by) * (1.0 - eased((now - turned) / NOTCH_MS))).sum();
                aim.notches.retain(|(turned, _)| now < turned + NOTCH_MS);
                let along = coast.along;
                let easing = f64::from(aim.to) - left;
                let shown = self.scrolled.get(&id).map_or(0.0, |at| if along { at.x } else { at.y });
                let mut step = easing.round() as f32 - shown;
                if seconds > 0.0 {
                    let (was, went, stepped) = aim.last.unwrap_or((f64::from(shown), 0.0, step));
                    let going = easing - was;
                    let near = (easing - f64::from(shown + stepped)).abs() < 1.0;
                    let against = (going.abs() < went.abs() && step.abs() > stepped.abs()) || (going.abs() > went.abs() && step.abs() < stepped.abs());
                    if near && against && !aim.notches.is_empty() {
                        step = stepped;
                    }
                    aim.last = Some((easing, going, step));
                }
                let to = shown + step;
                if aim.notches.is_empty() {
                    self.coasts.remove(&id);
                }
                let Some(most) = self.placed(id).and_then(|placed| placed.scroll).map(|(most_y, most_x, _)| if along { most_x } else { most_y }) else {
                    self.coasts.remove(&id);
                    continue;
                };
                self.scroll_to(id, along, to.clamp(0.0, most));
                continue;
            }
            if coast.flung {
                let (by, velocity) = decay(f64::from(coast.velocity), seconds);
                let (along, velocity) = (coast.along, velocity as f32);
                let Some((most, was)) = self.placed(id).and_then(|placed| placed.scroll).map(|(most_y, most_x, _)| {
                    let now = self.scrolled.get(&id).copied().unwrap_or(point(0.0, 0.0));
                    if along { (most_x, now.x) } else { (most_y, now.y) }
                }) else {
                    self.coasts.remove(&id);
                    continue;
                };
                let to = (was + by as f32).clamp(0.0, most);
                self.scroll_to(id, along, to);
                let coast = self.coasts.get_mut(&id).expect("it's there");
                let flung = f64::from(coast.velocity);
                coast.velocity = velocity;
                // Reaching an end going on, it bounces off it from when it got there, as UIScrollView's does, the rest of
                // the refresh its spring's: stopped at the end for that refresh, a page flung to its end went 23.5, 10.6,
                // 20.2 pt a refresh (23 Nov). Slow enough, it stops.
                if (to == 0.0 && velocity < 0.0) || (to == most && velocity > 0.0) {
                    let reached = if crate::mutants::mutant("end-held") { seconds } else { decay_for(flung, f64::from(to - was)).min(seconds) };
                    let (stretch, velocity) = BACK.at(0.0, decay(flung, reached).1, seconds - reached);
                    (coast.flung, coast.stretch, coast.velocity) = (false, stretch as f32, velocity as f32);
                } else if velocity.abs() < STOPPED {
                    self.coasts.remove(&id);
                }
                continue;
            }
            let (stretch, velocity) = BACK.at(f64::from(coast.stretch), f64::from(coast.velocity), seconds);
            if Spring::arrived(stretch, velocity, crate::motion::NEAR) {
                self.coasts.remove(&id);
            } else {
                (coast.stretch, coast.velocity) = (stretch as f32, velocity as f32);
            }
        }
    }

    /// The innermost thing in `chain` that scrolls `along` or down and can still go the way `delta` does, from where it's
    /// going: where a wheel's notch eases it to, or where it is. A finger or a wheel moves one way at a time, the way it
    /// moves most (`pan_latched`), as a browser's `touch-action` and UIScrollView's do, so a row that scrolls along doesn't
    /// take a finger that's going down. → its id, where that is, how far `delta` takes it, how far it can go, and whether
    /// it scrolls along.
    pub(super) fn scrolls(&self, chain: &[Id], delta: Point<f32>, along: bool) -> Option<(Id, f32, f32, f32, bool)> {
        chain.iter().copied().find_map(|id| {
            let (most_y, most_x, its_along) = self.placed(id)?.scroll?;
            (its_along == along).then_some(())?;
            let now = self.scrolled.get(&id).copied().unwrap_or(point(0.0, 0.0));
            let from = self.coasts.get(&id).and_then(|coast| coast.aim.as_ref()).map_or(if along { now.x } else { now.y }, |aim| aim.to);
            let (by, most) = if along { (delta.x, most_x) } else { (delta.y, most_y) };
            ((by > 0.0 && from < most) || (by < 0.0 && from > 0.0)).then_some((id, from, by, most, along))
        })
    }

    /// A mouse wheel's notch turned at `at`, by `delta` points: what scrolls there eases to where it sends it
    /// (`NOTCH_MS`), from where the notches before were sending it. → what scrolls.
    pub(super) fn wheel_scroll(&mut self, at: Point<f32>, delta: Point<f32>) -> Option<Id> {
        let (id, from, by, most, along) = self.scrolls(&self.under(at), delta, delta.x.abs() > delta.y.abs())?;
        let (to, now) = ((from + by).clamp(0.0, most), self.js.clock().now());
        match self.coasts.get_mut(&id) {
            Some(Coast { aim: Some(aim), .. }) => {
                aim.notches.push((now, to - aim.to));
                aim.to = to;
            }
            _ => drop(self.coasts.insert(id, Coast { along, held: false, flung: false, pulled: 0.0, stretch: 0.0, velocity: 0.0, stepped: now, aim: Some(Aim { to, notches: vec![(now, to - from)], last: None }) })),
        }
        self.changed();
        Some(id)
    }

    /// Scrolls `id` to `to`, along or down, telling its page where it listens.
    pub(super) fn scroll_to(&mut self, id: Id, along: bool, to: f32) {
        let now = self.scrolled.entry(id).or_insert(point(0.0, 0.0));
        if along {
            now.x = to;
        } else {
            now.y = to;
        }
        let scrolled = *now;
        if self.tree.nodes.get(&id).is_some_and(|node| node.listens("scroll")) {
            self.tell(id, "scroll", json!({"scrollTop": scrolled.y, "scrollLeft": scrolled.x}));
        }
    }

    /// How far past its end each scroll is stretched, which its content is drawn moved by.
    pub(super) fn stretched(&self) -> std::collections::HashMap<Id, Point<f32>> {
        self.coasts.iter().filter(|(_, coast)| coast.stretch != 0.0).map(|(id, coast)| (*id, if coast.along { point(coast.stretch, 0.0) } else { point(0.0, coast.stretch) })).collect()
    }

    /// Whether anything scrolls by itself, which a frame steps.
    pub(super) fn coasting(&self) -> bool {
        self.coasts.values().any(|coast| !coast.held)
    }
}
