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

/// A box whose content scrolls, in a target's device pixels: its node, the whole pixels inside what it clips its content
/// to, how far it's scrolled (whole pixels, `view::paint`'s), and how far its corners' rounding reaches in.
#[derive(Clone, Copy, PartialEq)]
pub(super) struct Scroll {
    pub(super) id: u64,
    pub(super) rect: Rect,
    pub(super) by: [i64; 2],
    pub(super) corners: u32,
}

/// What a frame drew, by which the next is drawn again only where that changed: each thing, in order, and where
/// (`Prints`); for each, what it is moved back by the scroll it's in (that scroll's node and a hash) where it's in one,
/// and the rows and columns of it that are each the same all along (`Even`), where it's a box of one colour; and what
/// scrolls in it.
#[derive(Default, Clone)]
pub(super) struct Shown {
    pub(super) prints: Prints,
    pub(super) moved: Vec<Option<(u64, u64)>>,
    pub(super) even: Vec<Option<Even>>,
    pub(super) scrolls: Vec<Scroll>,
}

/// Of a box of one colour, the rows from the first to the last that are each the same as the next, and the columns,
/// in device pixels: what's moved along them is drawn the same.
#[derive(Clone, Copy)]
pub(super) struct Even {
    pub(super) rows: [u32; 2],
    pub(super) columns: [u32; 2],
}

/// Pixels a frame moves where it kept them: `from`, moved `by`.
#[derive(Clone, Copy)]
pub(super) struct Blit {
    pub(super) from: Rect,
    pub(super) by: [i64; 2],
}

/// `rect` moved `by`.
fn moved([left, top, right, bottom]: Rect, [x, y]: [i64; 2]) -> Rect {
    let at = |edge: u32, by: i64| (i64::from(edge) + by).max(0) as u32;
    [at(left, x), at(top, y), at(right, x), at(bottom, y)]
}

/// Where `a` and `b` overlap, or an empty rectangle.
fn overlap(a: Rect, b: Rect) -> Rect {
    [a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]).max(a[0].max(b[0])), a[3].min(b[3]).max(a[1].max(b[1]))]
}

fn empty(rect: &Rect) -> bool {
    rect[0] >= rect[2] || rect[1] >= rect[3]
}

fn inside(inner: &Rect, outer: &Rect) -> bool {
    inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
}

/// Where a box that scrolled between the frame before (`last`) and this one (`now`) can move the pixels it kept, as
/// Chromium, Core Animation and Android move a scrolled layer's: the one that's most pixels, scrolled less far than
/// it's long, where it clips the same. → those pixels moved (`Blit`); both frames' things as they're compared once
/// it's moved, each in it in the frame before where it's moved to, by what it is moved back by its scroll, and
/// only where it's moved to, as what came in is drawn whole; and where else the frame is drawn again: what came in,
/// its corners where they're rounded and where they're moved to, and each thing it moved that didn't scroll with it
/// (what's over or under it, unless it's the same all along the way it moved), where it was and where it's moved to.
pub(super) fn scrolled(last: &Shown, now: &Shown) -> Option<(Blit, Prints, Prints, Vec<Rect>)> {
    let (scroll, by) = now
        .scrolls
        .iter()
        .filter_map(|scroll| {
            let was = last.scrolls.iter().find(|was| was.id == scroll.id && was.rect == scroll.rect && was.corners == scroll.corners)?;
            let by = [was.by[0] - scroll.by[0], was.by[1] - scroll.by[1]];
            let [left, top, right, bottom] = scroll.rect;
            (by != [0, 0] && by[0].unsigned_abs() < u64::from(right - left) && by[1].unsigned_abs() < u64::from(bottom - top)).then_some((scroll, by))
        })
        .max_by_key(|(scroll, _)| area(&[scroll.rect]))?;
    let rect = scroll.rect;
    let to = overlap(moved(rect, by), rect);
    let from = moved(to, [-by[0], -by[1]]);
    // What came in.
    let mut changed = vec![[rect[0], rect[1], rect[2], to[1]], [rect[0], to[3], rect[2], rect[3]], [rect[0], to[1], to[0], to[3]], [to[2], to[1], rect[2], to[3]]];
    // Its rounded corners, which clip what's in it, and where they're moved to.
    if scroll.corners > 0 {
        let reach = scroll.corners;
        for corner in [
            [rect[0], rect[1], rect[0] + reach, rect[1] + reach],
            [rect[2].saturating_sub(reach), rect[1], rect[2], rect[1] + reach],
            [rect[0], rect[3].saturating_sub(reach), rect[0] + reach, rect[3]],
            [rect[2].saturating_sub(reach), rect[3].saturating_sub(reach), rect[2], rect[3]],
        ] {
            changed.push(corner);
            changed.push(overlap(moved(overlap(corner, from), by), to));
        }
    }
    // Of a thing that didn't scroll with it, what of it moving changed: none of a box of one colour where it's the same
    // all along the way it moved, else its rows and columns that aren't, where they were and where they're moved to (its
    // edges across the way it moved too, as what scrolled under them shows through their antialiasing); all of anything
    // else.
    let uneven = |place: &Rect, even: &Option<Even>| -> Vec<Rect> {
        let all = vec![overlap(*place, to), moved(overlap(*place, from), by)];
        let Some(even) = even else { return all };
        let strips = |[first, last]: [u32; 2], start: u32, end: u32, down: bool| {
            let cut = |a: u32, b: u32| if down { [place[0], a, place[2], b] } else { [a, place[1], b, place[3]] };
            [cut(start, first.min(end).max(start)), cut(last.max(start).min(end), end)]
        };
        if by[0] != 0 && by[1] != 0 {
            return all;
        }
        let around = [strips(even.rows, place[1], place[3], true), strips(even.columns, place[0], place[2], false)];
        around.into_iter().flatten().flat_map(|strip| [overlap(strip, to), moved(overlap(strip, from), by)]).collect()
    };
    // What's in it by where it is, but drawn the same in the same place in both frames (its own background), stayed put.
    let (before, after): (std::collections::HashSet<_>, std::collections::HashSet<_>) = (last.prints.iter().collect(), now.prints.iter().collect());
    let mut was = Vec::with_capacity(last.prints.len());
    for (at, (print, place)) in last.prints.iter().enumerate() {
        match last.moved[at] {
            Some((id, unscrolled)) if id == scroll.id && inside(place, &rect) && !after.contains(&(*print, *place)) => {
                let place = overlap(moved(*place, by), to);
                if !empty(&place) {
                    was.push((unscrolled, place));
                }
            }
            _ => {
                was.push((*print, *place));
                if !empty(&overlap(*place, rect)) {
                    changed.extend(uneven(place, &last.even[at]));
                }
            }
        }
    }
    let is: Prints = now
        .prints
        .iter()
        .zip(&now.moved)
        .filter_map(|((print, place), moved)| match moved {
            Some((id, unscrolled)) if *id == scroll.id && inside(place, &rect) && !before.contains(&(*print, *place)) => Some((*unscrolled, overlap(*place, to))).filter(|(_, place)| !empty(place)),
            _ => Some((*print, *place)),
        })
        .collect();
    Some((Blit { from, by }, was, is, changed))
}
