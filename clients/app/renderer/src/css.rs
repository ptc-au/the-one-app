//! CSS's own values, as a style gives them as text, the way React Native takes them: a colour (`#f80`, `rgba(0,0,0,.2)`,
//! `transparent`), a `boxShadow` (`0 10px 30px rgba(0,0,0,.14), inset 0 0 0 1px #3a3a3c`) and a
//! `backgroundImage` (`linear-gradient(145deg, #ffb340, #ff6a2b 55%, #f2384b)`, `radial-gradient(120% 90% at 50% 100%,
//! …)`, `radial-gradient(closest-side, …)`, or several of them, the first on top), with gradients drawn here, the same
//! on every host.

use crate::geometry::Rgba;
use crate::tokens::Shadow;

/// What's between top-level commas in `text`, as CSS lists split, never inside a function's parentheses.
fn split(text: &str) -> Vec<&str> {
    let (mut parts, mut depth, mut start) = (Vec::new(), 0, 0);
    for (at, character) in text.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(text[start..at].trim());
                start = at + 1;
            }
            _ => {}
        }
    }
    parts.push(text[start..].trim());
    parts
}

/// Its words, as CSS's are split by spaces, never inside a function's parentheses.
fn words(text: &str) -> Vec<&str> {
    let (mut parts, mut depth, mut start) = (Vec::new(), 0, None);
    for (at, character) in text.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth -= 1,
            ' ' | '\t' | '\n' if depth == 0 => {
                if let Some(from) = start.take() {
                    parts.push(&text[from..at]);
                }
                continue;
            }
            _ => {}
        }
        start.get_or_insert(at);
    }
    if let Some(from) = start {
        parts.push(&text[from..]);
    }
    parts
}

/// A colour CSS writes: hex, `rgb()`/`rgba()` or `transparent`.
pub fn colour(text: &str) -> Option<Rgba> {
    let text = text.trim();
    if text == "transparent" {
        return Some(Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.0 });
    }
    if let Some(digits) = text.strip_prefix('#') {
        let channel = |at: usize, width: usize| {
            let value = u8::from_str_radix(digits.get(at..at + width)?, 16).ok()?;
            Some(if width == 1 { f32::from(value * 17) } else { f32::from(value) } / 255.0)
        };
        return match digits.len() {
            3 | 4 => Some(Rgba { r: channel(0, 1)?, g: channel(1, 1)?, b: channel(2, 1)?, a: if digits.len() == 4 { channel(3, 1)? } else { 1.0 } }),
            6 | 8 => Some(Rgba { r: channel(0, 2)?, g: channel(2, 2)?, b: channel(4, 2)?, a: if digits.len() == 8 { channel(6, 2)? } else { 1.0 } }),
            _ => None,
        };
    }
    let inner = text.strip_prefix("rgba(").or_else(|| text.strip_prefix("rgb("))?.strip_suffix(')')?;
    let parts: Vec<f32> = inner.split([',', ' ', '/']).filter(|part| !part.is_empty()).map(|part| part.strip_suffix('%').map_or_else(|| part.parse().ok(), |percent| percent.parse::<f32>().ok().map(|p| p / 100.0))).collect::<Option<_>>()?;
    let [r, g, b] = [parts.first()?, parts.get(1)?, parts.get(2)?].map(|channel| channel / 255.0);
    Some(Rgba { r, g, b, a: parts.get(3).copied().unwrap_or(1.0) })
}

/// A length CSS writes in pixels: `12px`, `.5px` or `0`.
fn px(text: &str) -> Option<f32> {
    text.strip_suffix("px").unwrap_or(text).parse().ok()
}

/// A `box-shadow`'s shadows, as CSS writes them: `[inset] x y [blur [spread]] colour`, each after a comma.
pub fn shadows(text: &str) -> Vec<Shadow> {
    split(text)
        .into_iter()
        .filter_map(|one| {
            let mut inset = false;
            let (mut lengths, mut tint) = (Vec::new(), None);
            for word in words(one) {
                if word == "inset" {
                    inset = true;
                } else if let Some(length) = px(word) {
                    lengths.push(length);
                } else {
                    tint = colour(word);
                }
            }
            let at = |index: usize| lengths.get(index).copied().unwrap_or(0.0);
            (lengths.len() >= 2).then(|| Shadow { x: at(0), y: at(1), blur: at(2), spread: at(3), colour: tint.unwrap_or(Rgba { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }), inset })
        })
        .collect()
}

/// A gradient, as CSS's `linear-gradient()` and `radial-gradient()` draw one: its colours along it, each at where it
/// is (0 to 1, where CSS's say), the rest spread between, as CSS spreads them.
#[derive(Clone, Debug, PartialEq)]
pub struct Gradient {
    pub shape: Shape,
    pub stops: Vec<(Tint, Option<f32>)>,
}

/// A gradient's colour: one of its own, or the text's (`currentColor`) at a share of its opacity, as
/// `color-mix(in oklab, currentColor 7%, transparent)` has it, so it's drawn in the text's colour, light or dark.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Tint {
    Own(Rgba),
    Current(f32),
}

impl Tint {
    fn of(text: &str) -> Option<Tint> {
        let text = text.trim();
        if text == "currentColor" {
            return Some(Tint::Current(1.0));
        }
        if let Some(inner) = text.strip_prefix("color-mix(").and_then(|inner| inner.strip_suffix(')')) {
            let parts = split(inner);
            let [_space, first, second] = parts.as_slice() else { return None };
            let first = words(first);
            let share = first.get(1).and_then(|share| part(share)).unwrap_or(0.5);
            return match (Tint::of(first.first()?)?, colour(second)?) {
                (Tint::Current(alpha), other) if other.a == 0.0 => Some(Tint::Current(alpha * share)),
                (Tint::Own(a), b) => Some(Tint::Own(Rgba { r: a.r * share + b.r * (1.0 - share), g: a.g * share + b.g * (1.0 - share), b: a.b * share + b.b * (1.0 - share), a: a.a * share + b.a * (1.0 - share) })),
                _ => None,
            };
        }
        colour(text).map(Tint::Own)
    }

    fn with(self, current: Rgba) -> Rgba {
        match self {
            Tint::Own(colour) => colour,
            Tint::Current(share) => Rgba { a: current.a * share, ..current },
        }
    }
}

/// Which way it goes: a line at an angle (degrees, `0deg` up, as CSS's), or an ellipse, its radii a part of the box's
/// width and height and its middle where it is in it, or reaching its nearest sides (`closest-side`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shape {
    Linear { angle: f32 },
    Radial { radii: Option<(f32, f32)>, middle: (f32, f32) },
}

/// A part of the box: `50%`, or a keyword (`left`, `center`, `bottom`).
fn part(word: &str) -> Option<f32> {
    match word {
        "left" | "top" => Some(0.0),
        "center" => Some(0.5),
        "right" | "bottom" => Some(1.0),
        _ => word.strip_suffix('%')?.parse::<f32>().ok().map(|percent| percent / 100.0),
    }
}

/// A `backgroundImage`'s gradients, the first drawn on top, as CSS layers them: each `linear-gradient(…)` or
/// `radial-gradient(…)` of its list. Read as one, three of them were a radial gradient with all their stops, which drew
/// rings across a desktop's picture and a dark corner (Andre's Mac, 23 Nov).
pub fn gradients(text: &str) -> Vec<Gradient> {
    split(text).into_iter().filter_map(Gradient::of).collect()
}

/// `layers` (the first on top, `gradients`) drawn on a box `width` × `height` CSS pixels, at `width_px` × `height_px`
/// device pixels, with the text's colour `current`: its pixels, premultiplied BGRA, as a picture's are, each layer's
/// colours mixed premultiplied as CSS mixes a gradient's, and each over those under it.
pub fn draw(layers: &[Gradient], width: f32, height: f32, width_px: u32, height_px: u32, current: Rgba) -> Vec<u8> {
    let placed: Vec<Vec<(Rgba, f32)>> = layers.iter().map(|layer| layer.placed(current)).collect();
    let (sx, sy) = (width / width_px.max(1) as f32, height / height_px.max(1) as f32);
    let mut pixels = Vec::with_capacity((width_px * height_px * 4) as usize);
    for row in 0..height_px {
        for column in 0..width_px {
            let (x, y) = ((column as f32 + 0.5) * sx, (row as f32 + 0.5) * sy);
            let [r, g, b, a] = layers.iter().zip(&placed).rev().fold([0.0; 4], |under, (layer, stops)| {
                let over = layer.at(stops, layer.along(x, y, width, height));
                std::array::from_fn(|channel| over[channel] + under[channel] * (1.0 - over[3]))
            });
            pixels.extend([b, g, r, a].map(|channel| (channel.clamp(0.0, 1.0) * 255.0).round() as u8));
        }
    }
    pixels
}

impl Gradient {
    /// One `linear-gradient(…)` or `radial-gradient(…)`.
    fn of(text: &str) -> Option<Gradient> {
        let text = text.trim();
        let (radial, inner) = match text.strip_prefix("linear-gradient(") {
            Some(inner) => (false, inner),
            None => (true, text.strip_prefix("radial-gradient(")?),
        };
        let parts = split(inner.strip_suffix(')')?);
        let first = words(parts.first()?);
        // Its shape first, where it's said: what isn't a colour.
        let said = Tint::of(parts.first()?).is_none() && Tint::of(first.first()?).is_none();
        let shape = if radial {
            let (mut radii, mut middle) = (None, (0.5, 0.5));
            if said {
                let at = first.iter().position(|word| *word == "at");
                let size = &first[..at.unwrap_or(first.len())];
                if let [x, y] = size {
                    radii = Some((part(x)?, part(y)?));
                }
                if let Some(at) = at {
                    let place = &first[at + 1..];
                    middle = (part(place.first()?)?, place.get(1).and_then(|y| part(y)).unwrap_or(0.5));
                }
            }
            Shape::Radial { radii, middle }
        } else {
            let angle = if said {
                match first.as_slice() {
                    [angle] if angle.ends_with("deg") => angle.strip_suffix("deg")?.parse().ok()?,
                    ["to", "top"] => 0.0,
                    ["to", "right"] => 90.0,
                    ["to", "left"] => 270.0,
                    _ => 180.0,
                }
            } else {
                180.0
            };
            Shape::Linear { angle }
        };
        let stops = parts[usize::from(said)..]
            .iter()
            .filter_map(|stop| {
                let stop = words(stop);
                let tint = Tint::of(stop.first()?).or_else(|| Tint::of(&stop.join(" ")))?;
                let at = if stop.first().is_some_and(|first| first.starts_with("color-mix(")) || stop.len() < 2 { None } else { stop.last().and_then(|at| part(at)) };
                Some((tint, at))
            })
            .collect::<Vec<_>>();
        (stops.len() >= 2).then_some(Gradient { shape, stops })
    }

    /// Its stops each at where it is, as CSS places those it doesn't say: the first at the start, the last at the end,
    /// and the rest evenly between the ones either side that are said, never before one before it.
    fn placed(&self, current: Rgba) -> Vec<(Rgba, f32)> {
        let count = self.stops.len();
        let mut at: Vec<Option<f32>> = self.stops.iter().map(|(_, at)| *at).collect();
        at[0] = Some(at[0].unwrap_or(0.0));
        at[count - 1] = Some(at[count - 1].unwrap_or(1.0));
        let mut index = 0;
        while index < count {
            if at[index].is_none() {
                let before = index - 1;
                let after = (index..count).find(|one| at[*one].is_some()).expect("the last is said");
                let (from, to) = (at[before].expect("said"), at[after].expect("said"));
                for (step, one) in (index..after).enumerate() {
                    at[one] = Some(from + (to - from) * (step + 1) as f32 / (after - before) as f32);
                }
                index = after;
            }
            index += 1;
        }
        let mut most = 0.0f32;
        self.stops.iter().zip(at).map(|((tint, _), at)| (tint.with(current), { most = most.max(at.expect("placed")); most })).collect()
    }

    /// Whether it's drawn in the text's colour anywhere, so a change of that draws it again.
    pub fn current(&self) -> bool {
        self.stops.iter().any(|(tint, _)| matches!(tint, Tint::Current(_)))
    }

    /// Its colour `t` of the way along it (`along`), with its stops `stops` (`placed`): premultiplied.
    fn at(&self, stops: &[(Rgba, f32)], t: f32) -> [f32; 4] {
        let premultiplied = |c: Rgba| [c.r * c.a, c.g * c.a, c.b * c.a, c.a];
        match stops.iter().position(|(_, at)| *at >= t) {
            None => premultiplied(stops[stops.len() - 1].0),
            Some(0) => premultiplied(stops[0].0),
            Some(after) => {
                let ((a, from), (b, to)) = (stops[after - 1], stops[after]);
                let mix = if to > from { (t - from) / (to - from) } else { 1.0 };
                let (a, b) = (premultiplied(a), premultiplied(b));
                std::array::from_fn(|channel| a[channel] + (b[channel] - a[channel]) * mix)
            }
        }
    }

    /// How far along it the point `x`, `y` of a box `width` × `height` is: 0 at its start, 1 at its end.
    fn along(&self, x: f32, y: f32, width: f32, height: f32) -> f32 {
        match self.shape {
            Shape::Linear { angle } => {
                let (sin, cos) = angle.to_radians().sin_cos();
                let length = (width * sin).abs() + (height * cos).abs();
                ((x - width / 2.0) * sin - (y - height / 2.0) * cos) / length.max(f32::EPSILON) + 0.5
            }
            Shape::Radial { radii, middle } => {
                let (cx, cy) = (middle.0 * width, middle.1 * height);
                let (rx, ry) = radii.map_or((cx.min(width - cx), cy.min(height - cy)), |(x, y)| (x * width, y * height));
                (((x - cx) / rx.max(f32::EPSILON)).powi(2) + ((y - cy) / ry.max(f32::EPSILON)).powi(2)).sqrt()
            }
        }
    }
}

