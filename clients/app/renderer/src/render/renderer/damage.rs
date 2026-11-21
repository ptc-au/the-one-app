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
    changed
}

/// `rects` cut to a frame of `size` and made apart: where two meet, one box round both, and at most `MOST`, the two
/// whose box adds least joined first. Apart, as a translucent thing drawn once in each would be drawn twice where two
/// meet.
pub(super) fn apart(rects: impl IntoIterator<Item = Rect>, (width, height): (u32, u32)) -> Vec<Rect> {
    let meets = |a: &Rect, b: &Rect| a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    let union = |a: Rect, b: Rect| [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])];
    let mut out: Vec<Rect> = Vec::new();
    let add = |out: &mut Vec<Rect>, mut rect: Rect| {
        while let Some(at) = out.iter().position(|other| meets(other, &rect)) {
            rect = union(out.swap_remove(at), rect);
        }
        out.push(rect);
    };
    for [left, top, right, bottom] in rects {
        let rect = [left.min(width), top.min(height), right.min(width), bottom.min(height)];
        if rect[0] < rect[2] && rect[1] < rect[3] {
            add(&mut out, rect);
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
        let joined = union(out[best.0], out.swap_remove(best.1));
        out.swap_remove(best.0);
        add(&mut out, joined);
    }
    out
}

/// The pixels `rects` cover, each counted once where they're apart.
pub(super) fn area(rects: &[Rect]) -> u64 {
    rects.iter().map(|[left, top, right, bottom]| u64::from(right.saturating_sub(*left)) * u64::from(bottom.saturating_sub(*top))).sum()
}
