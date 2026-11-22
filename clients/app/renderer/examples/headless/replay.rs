//! The inspector's `replay`: a press along moves, or a trace, on a display of its own rate, frame by frame.

use anyhow::Context as _;
use renderer::platform::Windows;
use serde_json::{Value, json};

use crate::between::between;
use crate::input::deliver;
use crate::select::{ask, point_of};

/// The inspector's `replay`, as the display's events: the press goes down, moves along `moves` (`{dx, dy, ms}`,
/// sampled `input_hz` times a second) and lifts unless `lift` is false, or a trace's `events` (as `trace` takes them), on a display of `hz`, each of its frames
/// reported as `replay` reports one (`renderer::inspect`'s), until `after` ms past its end or nothing moves.
pub(crate) fn replay(windows: &mut Windows, id: renderer::platform::WindowId, request: &renderer::inspect::Request) -> anyhow::Result<Value> {
    // A trace's own events (`events`, as `trace` takes them), or a press along `moves`.
    let traced = request.inputs.get("events").and_then(Value::as_array).cloned();
    let (x, y) = match &traced {
        Some(events) if !request.selects() && request.f32("x").is_none() => events.first().map_or((0.0, 0.0), |first| (first["x"].as_f64().unwrap_or(0.0) as f32, first["y"].as_f64().unwrap_or(0.0) as f32)),
        _ => point_of(windows, id, request)?,
    };
    let moves: Vec<(f32, f32, f64)> = request.inputs.get("moves").and_then(Value::as_array).or(traced.as_ref().map(|_| &EMPTY)).ok_or_else(|| anyhow::anyhow!("say how it moves: `moves`, each {{dx, dy, ms}}, or its `events`"))?
        .iter()
        .map(|one| (one["dx"].as_f64().unwrap_or(0.0) as f32, one["dy"].as_f64().unwrap_or(0.0) as f32, one["ms"].as_f64().unwrap_or(0.0).max(0.0)))
        .collect();
    let lift = request.inputs.get("lift").and_then(Value::as_bool) != Some(false);
    let hz = request.f64("hz").unwrap_or(60.0).clamp(1.0, 480.0);
    let every = 1000.0 / request.f64("input_hz").unwrap_or(hz).clamp(1.0, 1000.0);
    let after = request.f64("after").unwrap_or(2000.0).max(0.0);
    let snaps = renderer::inspect::snaps(request);
    // Each frame against the same drawn whole (`Windows::whole`), as one drawn only where it changed must be, and
    // against itself drawn moved by whole device pixels (`unlike_moved`), each of MOVED's in turn.
    let checks_whole = request.inputs.get("whole").and_then(Value::as_bool) == Some(true);
    // Every node of each frame, where `nodes` asks, as core/ui's rules read each frame (what's drawn over what).
    let every_node = request.inputs.get("nodes").and_then(Value::as_bool) == Some(true);
    let checks_moved = request.inputs.get("moved").and_then(Value::as_bool) == Some(true);
    let query = |input: &str| match request.inputs.get(input) {
        Some(Value::Object(selector)) => {
            let mut query = json!({"op": "query"});
            for (name, value) in selector {
                query[name] = value.clone();
            }
            Some(query)
        }
        _ => None,
    };
    let (mut track, count, shows, holds, named, apart) = (query("track"), query("count"), query("shows"), query("holds"), query("named"), query("apart"));
    let tracking = match request.inputs.get("track") {
        Some(Value::Object(selector)) => Some(renderer::inspect::Request { id: Value::Null, op: "query".into(), inputs: selector.clone() }),
        _ => None,
    };
    // The nodes of what a selector matches that a person sees: drawn at all opaque, some of it in the window.
    let seen = |windows: &mut Windows, query: &Value| -> Vec<Value> {
        let found = ask(windows, id, query.clone()).and_then(|found| found["result"]["nodes"].as_array().cloned()).unwrap_or_default();
        found.into_iter().filter(|node| node["opacity"].as_f64().is_some_and(|opacity| opacity > 0.0) && node["seen"].as_f64().is_some_and(|seen| seen > 0.0)).collect()
    };
    let length: f64 = moves.iter().map(|(_, _, ms)| ms).sum();
    // Where it is `t` ms in.
    let at = |t: f64| {
        let (mut at, mut since) = ((x, y), 0.0);
        for (dx, dy, ms) in &moves {
            let part = if *ms <= 0.0 { 1.0 } else { ((t - since) / ms).clamp(0.0, 1.0) as f32 };
            at = (at.0 + dx * part, at.1 + dy * part);
            if t < since + ms {
                break;
            }
            since += ms;
        }
        at
    };
    let samples: Vec<(f64, Value)> = match &traced {
        Some(events) => events.iter().map(|event| (event["ms"].as_f64().unwrap_or(0.0), event.clone())).collect(),
        None => {
            let mut events = vec![(0.0, json!({"kind": "move", "x": x, "y": y})), (0.0, json!({"kind": "down", "x": x, "y": y}))];
            events.extend((1..=(length / every).ceil() as usize).map(|n| (n as f64 * every).min(length)).map(|t| (t, at(t))).map(|(t, (mx, my))| (t, json!({"kind": "move", "x": mx, "y": my}))));
            if lift {
                let (ux, uy) = at(length);
                events.push((length, json!({"kind": "up", "x": ux, "y": uy})));
            }
            events
        }
    };
    let length = samples.last().map_or(0.0, |(t, _)| *t);
    let own = windows.refresh();
    if (own.as_secs_f64() * hz - 1.0).abs() > 1e-6 {
        windows.set_refresh(hz);
    }
    // With `frame_ms`, each frame takes that long to draw, as on a device others load, which presses it as a window's
    // late frames do.
    windows.set_frame_ms(request.f64("frame_ms").unwrap_or(0.0));
    // With `link`, `{starts, pauses: [ticks, refreshes], late_ms}`, the display's link ticks as a real one does: a
    // Mac's starts two or three refreshes after it's asked for frames, a ProMotion display's stops a while as if idle,
    // and Windows' compositor clock says each refresh a few tenths of a ms late, more or less each time.
    let link = request.inputs.get("link");
    let pauses = link.and_then(|link| link["pauses"].as_array()).map(|pauses| (pauses[0].as_u64().unwrap_or(0) as u32, pauses[1].as_u64().unwrap_or(0) as u32));
    windows.set_link(link.and_then(|link| link["starts"].as_u64()).unwrap_or(0) as u32, pauses, link.and_then(|link| link["late_ms"].as_f64()).unwrap_or(0.0));
    let refresh = 1000.0 / hz;
    let begun = renderer::platform::fake_time();
    let (mut next, mut frames, mut drawn, mut presents) = (0, Vec::new(), windows.frames(id), windows.presents(id));
    // Its first frame's cost is what's done from here.
    windows.cost(id);
    let elapsed = || renderer::platform::fake_time() - begun;
    loop {
        // The display's next refresh, and each move before it at its own time, as a device delivers them.
        // At least a microsecond on, so a clock a hair short of a refresh isn't moved by nothing.
        let now = renderer::platform::fake_time();
        let boundary = ((now / refresh).floor() + 1.0) * refresh;
        let tick = if boundary - now < 0.001 { boundary + refresh } else { boundary } - begun;
        between(windows);
        // What the display shows at a refresh is the frame drawn last before it (on the refresh before, or at once as
        // input came since), so each is read just before its refresh, and the refresh then taken. Input that comes
        // between the two (a trace's at the refresh itself, as every move of a press along `moves` is, and a mouse's
        // notch each 50 ms is every third refresh at 60 Hz) is delivered after the read, just before the refresh's frame,
        // never by running the clock past the read, which read that frame a refresh early and the next one again.
        let read = tick - JUST_BEFORE;
        while let Some((t, event)) = samples.get(next).filter(|(t, _)| *t <= read) {
            windows.run((t - elapsed()).max(0.0));
            deliver(windows, id, event)?;
            next += 1;
        }
        windows.run((read - elapsed()).max(0.0));
        // How many frames it drew for this refresh, which shows one of them.
        let frames_drawn = windows.frames(id) - drawn;
        let drew = frames_drawn > 0;
        drawn = windows.frames(id);
        // Drawn, and presented: one drawn the same as the frame on the screen presented none, and cost no GPU.
        let presented = windows.presents(id) > presents;
        presents = windows.presents(id);
        // What it cost since the frame before, every frame drawn meanwhile and its JS, which a frame that drew nothing
        // costs too.
        let mut frame = windows.cost(id).unwrap_or_default();
        if !presented && let Some(frame) = frame.as_object_mut() {
            frame.remove("gpu_ms");
            frame.remove("blur_ms");
        }
        if !presented {
            frame["draws"] = json!(0);
            frame["work"] = json!({"quads": 0, "shadows": 0, "sprites": 0, "backdrops": 0, "rasters": 0, "copied": 0, "uploaded": 0, "blurred": 0, "blurs": 0, "blurs_kept": 0, "damage": 0});
        }
        frame["at"] = json!((tick * 100.0).round() / 100.0);
        frame["pressure"] = json!(windows.pressure());
        frame["drawn"] = json!(presented);
        frame["frames_drawn"] = json!(frames_drawn);
        // A refresh that drew nothing while something on it is on its way somewhere shows the frame before again: a
        // frame the loop held, which a person sees as a stop and then a jump.
        let arriving = windows.arriving(id);
        if !drew && arriving {
            frame["held"] = json!(true);
        }
        frame["arriving"] = json!(arriving);
        // What's tracked, where it's drawn, or that it's gone, as a page that's left takes it with it: the node the
        // selector first found, not another it finds once that's gone (an App Library's Notes, as Home's goes).
        if let Some(query) = &mut track {
            if query.get("node").is_none()
                && let Some(selector) = &tracking
                && let Some(found) = windows.with(id, |screen| screen.matched(selector)).flatten()
            {
                *query = json!({"op": "query", "node": found.context("what it follows (`track`)")?});
            }
            // Where the frame on the screen drew it, not where input since has it laid out for the next.
            match query["node"].as_u64().and_then(|node| windows.with(id, |screen| screen.shown_rect(node)).flatten()) {
                Some(rect) => {
                    let rect = rect.json();
                    frame["x"] = rect["x"].clone();
                    frame["y"] = rect["y"].clone();
                    frame["rect"] = rect;
                }
                None => frame["gone"] = json!(true),
            }
            // How the frame drew it, where it's a surface of its own: what's in it painted, or drawn from what it was.
            if let Some(surfaced) = query["node"].as_u64().and_then(|node| windows.with(id, |screen| screen.surfaced(node)).flatten()) {
                frame["surface"] = json!(surfaced);
            }
        }
        // How many of what `count` matches a person sees, and the same for `shows`, `holds` and `named`.
        if let Some(query) = &count {
            frame["count"] = json!(seen(windows, query).len());
        }
        for (name, query) in [("shows", &shows), ("holds", &holds), ("named", &named)] {
            if let Some(query) = query {
                frame[name] = json!(seen(windows, query).len());
            }
        }
        // Where each of what `apart` matches that a person sees is drawn, as the frame on the screen drew it, as `track` has it.
        if let Some(query) = &apart {
            let nodes = seen(windows, query);
            frame["apart"] = json!(nodes.iter().filter_map(|node| windows.with(id, |screen| screen.shown_rect(node["node"].as_u64()?)).flatten()).map(|rect| rect.json()).collect::<Vec<_>>());
        }
        // Every node, as `query` has it, at the rect the frame on the screen drew it at, however it's moved, grown or
        // turned; one not drawn has none.
        if every_node {
            let mut nodes = ask(windows, id, json!({"op": "query"})).and_then(|found| found["result"]["nodes"].as_array().cloned()).unwrap_or_default();
            for node in &mut nodes {
                match node["node"].as_u64().and_then(|at| windows.with(id, |screen| screen.shown_rect(at)).flatten()) {
                    Some(rect) => node["rect"] = rect.json(),
                    None => _ = node.as_object_mut().map(|node| node.remove("rect")),
                }
            }
            frame["nodes"] = json!(nodes);
        }
        if let Some(scrolled) = windows.with(id, |screen| screen.scrolled_under(renderer::geometry::point(x, y))).flatten() {
            frame["scroll"] = json!({"x": scrolled.x, "y": scrolled.y});
        }
        // On a phone, the screen as its compositor shows it, each window over the one under it as it's moved, and each
        // window's own picture (`own`), as it presented it.
        let stacked = windows.composed();
        let phone = stacked.as_array().is_some_and(|stacked| stacked.len() > 1);
        if phone {
            frame["windows"] = stacked.clone();
        }
        if snaps && let Some((w, h, rgba)) = if phone { windows.screen() } else { windows.presented(id) } {
            for (name, value) in renderer::inspect::png(w, h, rgba)?.as_object().into_iter().flatten() {
                frame[name] = value.clone();
            }
        }
        if snaps && phone {
            let top = stacked.as_array().and_then(|stacked| stacked.last()).and_then(|top| top["window"].as_u64());
            if let Some((w, h, rgba)) = top.and_then(|top| windows.presented(top as renderer::platform::WindowId)) {
                frame["own"] = renderer::inspect::png(w, h, rgba)?["png"].clone();
            }
        }
        if checks_whole && drew {
            let ids = std::iter::once(u64::from(id)).chain(stacked.as_array().into_iter().flatten().filter_map(|window| window["window"].as_u64()));
            let unlike: Vec<Value> = ids.collect::<std::collections::BTreeSet<_>>().into_iter().filter_map(|window| unlike_whole(windows, window as renderer::platform::WindowId).transpose()).collect::<anyhow::Result<_>>()?;
            if !unlike.is_empty() {
                frame["unlike_whole"] = json!(unlike);
            }
        }
        if checks_moved && drew {
            // One way a frame, in turn, as each is a frame's whole drawing twice more.
            let unlike = unlike_moved(windows, id, &[MOVED[frames.len() % MOVED.len()]])?;
            if !unlike.is_empty() {
                frame["unlike_moved"] = json!(unlike);
            }
        }
        frames.push(frame);
        // Halfway to the refresh, so what it draws is after the read, as what the loop's own clock draws a refresh on
        // from it is after the next: drawn at the read itself, it was read in that refresh's frame. Its time is the
        // refresh's within a microsecond, as sums of ms land a hair either side of it: a press's move at
        // 250.00000000000003 ms waited for the next, which drew two moves at once.
        let due = |(t, _): &&(f64, Value)| *t <= tick + 0.001;
        if samples.get(next).is_some_and(|sample| due(&sample)) {
            windows.run((read + JUST_BEFORE / 2.0 - elapsed()).max(0.0));
        }
        while let Some((_, event)) = samples.get(next).filter(due) {
            deliver(windows, id, event)?;
            next += 1;
        }
        windows.run((tick - elapsed()).max(0.0));
        // What its page asked for as it ended (an app opened) is done before it's taken as still.
        between(windows);
        windows.run(0.0);
        // Still once nothing's wanted and the frame drawn last has been read: one drawn as it went still (a change a
        // delay held till this refresh) is the last the display shows.
        let still = !windows.wanted() && windows.frames(id) == drawn;
        if next == samples.len() && (still || tick >= length + after) {
            break;
        }
    }
    if windows.refresh() != own {
        windows.set_refresh(1.0 / own.as_secs_f64());
    }
    windows.set_frame_ms(0.0);
    windows.set_link(0, None, 0.0);
    // What's tracked was there in some frame, or its selector matches nothing, which isn't a node that's gone.
    if let (Some(selector), Some(query)) = (&tracking, &track)
        && query.get("node").is_none()
    {
        anyhow::bail!("what it follows (`track`): {}", windows.with(id, |screen| screen.unmatched(selector)).unwrap_or_default());
    }
    // What's been taken out but is still drawn going, which `after` should have seen go.
    let leaving = ask(windows, id, json!({"op": "window"})).and_then(|answer| answer["result"]["leaving"].as_u64()).unwrap_or(0);
    let budget = refresh;
    let over = renderer::inspect::over(&frames, budget);
    Ok(json!({"hz": hz, "budget_ms": (budget * 100.0).round() / 100.0, "over": over, "leaving": leaving, "frames": frames, "time": renderer::platform::fake_time(), "paused": true}))
}

/// No moves: a trace's replay has its events instead.
pub(crate) static EMPTY: Vec<Value> = Vec::new();

/// How long before a refresh what the display shows at it is read: what's drawn after is shown at the next.
pub(crate) const JUST_BEFORE: f64 = 0.01;

/// How window `id`'s frame as presented differs from the same scene drawn whole (`Windows::whole`), where it does by
/// more than a level in a channel: how many pixels, by how much at most, where, and the pictures drawn whole and presented.
fn unlike_whole(windows: &mut Windows, id: renderer::platform::WindowId) -> anyhow::Result<Option<Value>> {
    let (Some((width, height, presented)), Some((_, _, whole))) = (windows.presented(id), windows.whole(id)) else { return Ok(None) };
    if presented.len() != whole.len() {
        return Ok(Some(json!({"window": id, "sizes": [presented.len() / 4, whole.len() / 4]})));
    }
    let (mut differ, mut most, mut left, mut top, mut right, mut bottom) = (0u32, 0u8, width, height, 0, 0);
    for (at, (was, now)) in presented.chunks(4).zip(whole.chunks(4)).enumerate() {
        let apart = was.iter().zip(now).map(|(was, now)| was.abs_diff(*now)).max().unwrap_or(0);
        if apart > 1 {
            let (x, y) = (at as u32 % width, at as u32 / width);
            (differ, most, left, top, right, bottom) = (differ + 1, most.max(apart), left.min(x), top.min(y), right.max(x + 1), bottom.max(y + 1));
        }
    }
    if differ == 0 {
        return Ok(None);
    }
    Ok(Some(json!({"window": id, "differ": differ, "most": most, "box": {"x": left, "y": top, "width": right - left, "height": bottom - top}, "whole": renderer::inspect::png(width, height, whole)?["png"], "presented": renderer::inspect::png(width, height, presented)?["png"]})))
}

/// Where window `id`'s last frame is drawn otherwise moved by whole device pixels (`Windows::moved`), by each of
/// `offsets` (`by`, each `[dx, dy]`): how many pixels differ, by how much at most, where, and the two pictures. At an
/// edge (a curve's, a glyph's, a hairline's, where the picture changes by more than EDGE across a pixel's neighbours)
/// what isn't on whole pixels rounds otherwise moved, up to EDGE_APART levels on a software GPU's corners; elsewhere a
/// pixel may be FLAT_APART levels apart in FLAT pixels at most, where a dither or a grid of the window's moves every one
/// of a gradient or a shadow's. Under glass, its blur's samples are on its frame's grid, which moves under it, so there
/// it may be GLASS levels apart (step 6 of the renderer's plan, a blur reading the surfaces beneath it, ends that).
/// screenshot.js judges the web's the same (`unmoved`).
pub(crate) fn unlike_moved(windows: &mut Windows, id: renderer::platform::WindowId, offsets: &[[i32; 2]]) -> anyhow::Result<Vec<Value>> {
    let mut unlike = Vec::new();
    for by in offsets {
        let Some((width, height, here, there, glass)) = windows.moved(id, *by) else { continue };
        // How much the picture changes across the pixel at `x`, `y` and its neighbours, in its most changing channel.
        let span = |x: u32, y: u32| {
            let near = |dx: i32, dy: i32| {
                let (x, y) = (x.saturating_add_signed(dx).min(width - 1), y.saturating_add_signed(dy).min(height - 1));
                &here[(y * width + x) as usize * 4..][..3]
            };
            (0..3).map(|channel| {
                let values = (-1..=1).flat_map(|dy| (-1..=1).map(move |dx| (dx, dy))).map(|(dx, dy)| near(dx, dy)[channel]);
                let (least, most) = values.fold((u8::MAX, 0), |(least, most), value| (least.min(value), most.max(value)));
                most - least
            }).max().unwrap_or(0)
        };
        let (mut over, mut flat, mut most, mut left, mut top, mut right, mut bottom) = (0u32, 0u32, 0u8, width, height, 0, 0);
        for (at, (was, now)) in here.chunks(4).zip(there.chunks(4)).enumerate() {
            let apart = was.iter().zip(now).map(|(was, now)| was.abs_diff(*now)).max().unwrap_or(0);
            if apart == 0 {
                continue;
            }
            let (x, y) = (at as u32 % width, at as u32 / width);
            if glass.iter().any(|[l, t, r, b]| (*l..*r).contains(&x) && (*t..*b).contains(&y)) {
                if apart <= GLASS {
                    continue;
                }
                over += 1;
            } else if span(x, y) > EDGE {
                if apart <= EDGE_APART {
                    continue;
                }
                over += 1;
            } else if apart <= FLAT_APART {
                flat += 1;
            } else {
                over += 1;
            }
            (most, left, top, right, bottom) = (most.max(apart), left.min(x), top.min(y), right.max(x + 1), bottom.max(y + 1));
        }
        let differ = over + if flat > FLAT { flat } else { 0 };
        if differ > 0 {
            unlike.push(json!({"window": id, "by": by, "differ": differ, "of": width * height, "most": most, "box": {"x": left, "y": top, "width": right - left, "height": bottom - top}, "here": renderer::inspect::png(width, height, here)?["png"], "moved": renderer::inspect::png(width, height, there)?["png"]}));
        }
    }
    Ok(unlike)
}

/// How much a picture changes across a pixel and its neighbours where it's an edge (`unlike_moved`), in levels: a
/// hairline's on a card is 17, and a shadow's or a gradient's falls off by 1 to 3, where a dither shows.
const EDGE: u8 = 8;

/// How far apart a pixel at an edge may be moved: lavapipe's are a level or two, a GPU's rasterizer, interpolating on
/// its own grid of a 256th of a pixel, put a box's 3 apart, and the web's SwiftShader a pill's round end 20. What's
/// drawn wrong moved (a clip's row, a snap) is hundreds of levels apart.
const EDGE_APART: u8 = 32;

/// How many pixels away from edges and glass a frame moved may differ in, by FLAT_APART levels at most: main's most was
/// 6 natively; a shadow or a gradient dithered from the window's grid is thousands.
const FLAT: u32 = 64;
const FLAT_APART: u8 = 4;

/// How many levels apart a pixel under glass may be moved (`unlike_moved`): main's most was 3, the App Library's veil,
/// whose blur is taken on every sixteenth pixel.
const GLASS: u8 = 4;

/// How far a frame is moved to be compared with itself where it was (`unlike_moved`), in device pixels: a pixel each
/// way, as a surface's image moves by its own, and far enough the other way to cross a tile's and a blur's grid at odd
/// places.
pub(crate) const MOVED: [[i32; 2]; 3] = [[1, 0], [0, 1], [-37, -23]];
