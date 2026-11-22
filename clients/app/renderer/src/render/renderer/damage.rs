//! What of a frame changed since the one before (its damage), as Chromium's compositor, Core Animation, Android's
//! HWUI and Flutter's partial repaint find it: thing by thing, so a frame draws again only there, on the one before.

use super::blur::Prints;

/// The most rectangles a frame's damage is drawn in: each draw call is made once for each, so a few far apart (a
/// caret blinking and a spinner) cost no more than the pixels they cover, and many are one box round them.
const MOST: usize = 4;

/// Left, top, right and bottom, in device pixels.
pub(super) type Rect = [u32; 4];

/// Where what's drawn changed between the frame before (`last`) and this one (`now`), each the things drawn in order,
/// what each is (a hash of its instance, and of the blur behind it where it's a backdrop) and where: the things only
/// one of them draws, and where the order of those both draw differs, every thing between the first and the last of
/// them that moved. A pixel none of them covers is drawn by the same things in the same order in both, so is the same.
pub(super) fn damage(last: &Prints, now: &Prints) -> Vec<Rect> {
    let mut count: std::collections::HashMap<(u64, Rect), (u32, u32)> = Default::default();
    for thing in last {
        count.entry(*thing).or_default().0 += 1;
    }
    for thing in now {
        count.entry(*thing).or_default().1 += 1;
    }
    let mut changed = Vec::new();
    // Each list's things in order, those the other draws too (its first as many of each as both draw).
    let both = |things: &Prints, changed: &mut Vec<Rect>| {
        let mut seen: std::collections::HashMap<(u64, Rect), u32> = Default::default();
        let mut kept = Vec::with_capacity(things.len());
        for thing in things {
            let (last, now) = count[thing];
            let seen = seen.entry(*thing).or_default();
            *seen += 1;
            if *seen <= last.min(now) {
                kept.push(*thing);
            } else {
                changed.push(thing.1);
            }
        }
        kept
    };
    let (was, is) = (both(last, &mut changed), both(now, &mut changed));
    let same = was.iter().zip(&is).take_while(|(was, is)| was == is).count();
    let tail = was[same..].iter().rev().zip(is[same..].iter().rev()).take_while(|(was, is)| was == is).count();
    changed.extend(was[same..was.len() - tail].iter().chain(&is[same..is.len() - tail]).map(|thing| thing.1));
    // Mutant: each third frame drawn again everywhere, as a card held still was, its layer dropped and drawn afresh
    // (L86, 42860aa55).
    static FRAMES: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    if crate::mutants::mutant("held-redraw") && FRAMES.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % 3 == 2 {
        changed.extend(now.iter().map(|thing| thing.1));
    }
    // Mutant: each change's box a pixel short at its right and bottom, as an inset shadow's edge pixel fell outside the
    // extent it was taken at (9f93567ec).
    if crate::mutants::mutant("damage-short") {
        for [left, top, right, bottom] in &mut changed {
            (*right, *bottom) = ((*right).saturating_sub(1).max(*left), (*bottom).saturating_sub(1).max(*top));
        }
    }
    changed
}

/// `rects` cut to a frame of `size` and made apart, at most `MOST`: whichever of two ways covers less. Apart, as a
/// translucent thing drawn once in each would be drawn twice where two overlap.
pub(super) fn apart(rects: impl IntoIterator<Item = Rect>, (width, height): (u32, u32)) -> Vec<Rect> {
    let rects: Vec<Rect> = rects.into_iter().map(|[left, top, right, bottom]| [left.min(width), top.min(height), right.min(width), bottom.min(height)]).filter(|rect| !empty(rect)).collect();
    let (joined, cut) = (fewest(rects.iter().copied(), |_, _| true), fewest(rects, joins));
    if area(&cut) < area(&joined) { cut } else { joined }
}

/// Two that overlap joined into the box round them where that adds little to what they cover (a thing where it was
/// and where it is), a quarter of the box; else kept apart, so an L or a U of them (a box that grew along two sides, a
/// frame round a column) is drawn as itself, not as the box round it.
fn joins(a: Rect, b: Rect) -> bool {
    let both = area(&[a]) + area(&[b]) - area(&[overlap(a, b)]);
    4 * (area(&[union(a, b)]) - both) <= area(&[union(a, b)])
}

fn union(a: Rect, b: Rect) -> Rect {
    [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])]
}

/// `rects` apart: two that overlap joined into the box round them where `join` says, else the later cut where it
/// overlaps the earlier; then at most `MOST`, the two whose box adds least joined first, with what else that box
/// overlaps.
fn fewest(rects: impl IntoIterator<Item = Rect>, join: impl Fn(Rect, Rect) -> bool) -> Vec<Rect> {
    let mut out: Vec<Rect> = Vec::new();
    for rect in rects {
        let mut pieces = vec![rect];
        while let Some(rect) = pieces.pop() {
            match out.iter().position(|other| !empty(&overlap(*other, rect))) {
                None => out.push(rect),
                Some(at) if join(out[at], rect) => pieces.push(union(out.swap_remove(at), rect)),
                Some(at) => pieces.extend(minus(rect, out[at])),
            }
        }
    }
    // Many apart (a list scrolled, each row moved) are one box round them all.
    if out.len() > 16 * MOST {
        out = vec![out.iter().copied().reduce(union).expect("more than one")];
    }
    while out.len() > MOST {
        let (mut best, mut least) = ((0, 1), u64::MAX);
        for one in 0..out.len() {
            for other in one + 1..out.len() {
                let added = area(&[union(out[one], out[other])]).saturating_sub(area(&[out[one], out[other]]));
                if added < least {
                    (best, least) = ((one, other), added);
                }
            }
        }
        let mut joined = union(out[best.0], out.swap_remove(best.1));
        out.swap_remove(best.0);
        while let Some(at) = out.iter().position(|other| !empty(&overlap(*other, joined))) {
            joined = union(out.swap_remove(at), joined);
        }
        out.push(joined);
    }
    out
}

/// What of `rect` isn't in `cut`: up to four rectangles, above, below and either side of it; none of an empty one.
fn minus(rect: Rect, cut: Rect) -> Vec<Rect> {
    if empty(&rect) {
        return Vec::new();
    }
    if rect[0] >= cut[2] || cut[0] >= rect[2] || rect[1] >= cut[3] || cut[1] >= rect[3] {
        return vec![rect];
    }
    let (top, bottom) = (rect[1].max(cut[1]), rect[3].min(cut[3]));
    [[rect[0], rect[1], rect[2], cut[1]], [rect[0], cut[3], rect[2], rect[3]], [rect[0], top, cut[0], bottom], [cut[2], top, rect[2], bottom]]
        .into_iter()
        .filter(|piece| !empty(piece))
        .collect()
}

/// The pixels `rects` cover, each counted once where they're apart.
pub(super) fn area(rects: &[Rect]) -> u64 {
    rects.iter().map(|[left, top, right, bottom]| u64::from(right.saturating_sub(*left)) * u64::from(bottom.saturating_sub(*top))).sum()
}

/// Where `a` and `b` overlap, or an empty rectangle.
fn overlap(a: Rect, b: Rect) -> Rect {
    [a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]).max(a[0].max(b[0])), a[3].min(b[3]).max(a[1].max(b[1]))]
}

fn empty(rect: &Rect) -> bool {
    rect[0] >= rect[2] || rect[1] >= rect[3]
}
