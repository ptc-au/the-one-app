//! What the painter draws a box from: its quad, fill and shadow.

use super::*;

impl Painter<'_> {
    /// A quad, its bounds and mask in the window.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::view) fn quad(&mut self, bounds: Bounds<f32>, mask: ContentMask<f32>, background: Hsla, borders: Edges<f32>, border_color: Hsla, radii: Corners<f32>, dashed: bool, opacity: f32) {
        let scale = self.scale;
        self.scene.insert_primitive(Quad {
            order: 0,
            border_style: if dashed { BorderStyle::Dashed } else { BorderStyle::Solid },
            bounds: bounds.snap_to(scale),
            content_mask: mask.snap_to(scale),
            background: Background::from(background.opacity(opacity)),
            border_color: border_color.opacity(opacity),
            corner_radii: Corners {
                top_left: ScaledPixels(radii.top_left * scale),
                top_right: ScaledPixels(radii.top_right * scale),
                bottom_right: ScaledPixels(radii.bottom_right * scale),
                bottom_left: ScaledPixels(radii.bottom_left * scale),
            },
            border_widths: Edges {
                top: ScaledPixels(borders.top * scale),
                right: ScaledPixels(borders.right * scale),
                bottom: ScaledPixels(borders.bottom * scale),
                left: ScaledPixels(borders.left * scale),
            },
            transformation: self.turn.scaled(scale),
        });
    }

    /// A box's fill and border, drawn only where they show, as a GPU's fill rate is what a long list spends while it
    /// scrolls: nothing for a box that's see-through with no border, and a square one's border alone as its edges, not
    /// its whole box.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::view) fn fill(&mut self, bounds: Bounds<f32>, mask: ContentMask<f32>, background: Hsla, borders: Edges<f32>, border_color: Hsla, radii: Corners<f32>, dashed: bool, opacity: f32) {
        let bordered = borders != Edges::default() && border_color.a > 0.0;
        if background.a > 0.0 || (bordered && (dashed || radii != Corners::default())) {
            return self.quad(bounds, mask, background, borders, border_color, radii, dashed, opacity);
        }
        if !bordered {
            return;
        }
        let Bounds { origin, size } = bounds;
        let edges = [
            (borders.top, Bounds { origin, size: Size { width: size.width, height: borders.top } }),
            (borders.bottom, Bounds { origin: point(origin.x, origin.y + size.height - borders.bottom), size: Size { width: size.width, height: borders.bottom } }),
            (borders.left, Bounds { origin: point(origin.x, origin.y + borders.top), size: Size { width: borders.left, height: size.height - borders.top - borders.bottom } }),
            (borders.right, Bounds { origin: point(origin.x + size.width - borders.right, origin.y + borders.top), size: Size { width: borders.right, height: size.height - borders.top - borders.bottom } }),
        ];
        for (width, edge) in edges {
            if width > 0.0 {
                self.quad(edge, mask, border_color, Edges::default(), Hsla::default(), Corners::default(), false, opacity);
            }
        }
    }

    /// A box's shadow, as CSS's `box-shadow` draws it: its box moved by its offset and grown by its spread, blurred,
    /// under the box; or an inset one inside it, where the box moved and shrunk by its spread doesn't cover it. Either
    /// shows only near the box's edge, so it's drawn only outside the box's middle, in up to four bands, as a
    /// nine-slice shadow is: a long list's card's edge costs its edges, not its whole box.
    pub(in crate::view) fn shadow(&mut self, shadow: &crate::tokens::Shadow, bounds: Bounds<f32>, radii: Corners<f32>, grown: f32, mask: ContentMask<f32>, opacity: f32) {
        let spread = if shadow.inset { -shadow.spread } else { shadow.spread } * grown;
        let shadow_bounds = Bounds {
            origin: point(bounds.origin.x + shadow.x * grown - spread, bounds.origin.y + shadow.y * grown - spread),
            size: Size { width: (bounds.size.width + 2.0 * spread).max(0.0), height: (bounds.size.height + 2.0 * spread).max(0.0) },
        };
        let scale = self.scale;
        let corners = |radii: Corners<f32>, by: f32| Corners {
            top_left: ScaledPixels((radii.top_left + by).max(0.0) * scale),
            top_right: ScaledPixels((radii.top_right + by).max(0.0) * scale),
            bottom_right: ScaledPixels((radii.bottom_right + by).max(0.0) * scale),
            bottom_left: ScaledPixels((radii.bottom_left + by).max(0.0) * scale),
        };
        let drawn = Shadow {
            order: 0,
            blur_radius: ScaledPixels(shadow.blur * grown * scale / 2.0),
            bounds: shadow_bounds.scale_to(scale),
            corner_radii: corners(radii, spread),
            content_mask: mask.scale_to(scale),
            color: Hsla::from(shadow.colour).opacity(opacity),
            transformation: self.turn.scaled(scale),
            inset: u32::from(shadow.inset),
            pad: 0,
            outer: bounds.scale_to(scale),
            outer_radii: corners(radii, 0.0),
        };
        // The box's middle, which its shadow never shows in: inside it by its largest corner, and an inset one's by as
        // far in as it reaches (its blur's three deviations, its spread and its offset) too, with a pixel to spare.
        let corner = radii.top_left.max(radii.top_right).max(radii.bottom_left).max(radii.bottom_right);
        let reach = if shadow.inset { 0.75 * shadow.blur * grown + spread.abs() + shadow.x.abs().max(shadow.y.abs()) * grown + 1.0 } else { 0.0 };
        // On whole device pixels, as a pixel whose centre is on where two bands meet is drawn by both: an inset edge's
        // 1.5 in from a whole pixel darkened a dot on each side, where a scroll moved it there.
        let inside = corner + reach;
        let pixel = |at: f32, up: bool| if up { (at * scale).ceil() / scale } else { (at * scale).floor() / scale };
        let (left, top, right, bottom) = (pixel(bounds.origin.x + inside, true), pixel(bounds.origin.y + inside, true), pixel(bounds.origin.x + bounds.size.width - inside, false), pixel(bounds.origin.y + bounds.size.height - inside, false));
        if self.turn != TransformationMatrix::unit() || right <= left || bottom <= top {
            return self.scene.insert_primitive(drawn);
        }
        let far = 1.0e6;
        let band = |x0: f32, y0: f32, x1: f32, y1: f32| Bounds { origin: point(x0, y0), size: Size { width: x1 - x0, height: y1 - y0 } };
        for around in [band(-far, -far, far, top), band(-far, bottom, far, far), band(-far, top, left, bottom), band(right, top, far, bottom)] {
            let cut = mask.intersect(&ContentMask::from(around));
            if cut.bounds.size.width > 0.0 && cut.bounds.size.height > 0.0 {
                self.scene.insert_primitive(Shadow { content_mask: cut.scale_to(scale), ..drawn.clone() });
            }
        }
    }

    /// The box `bounds` covers in the window once it's turned as what's painted now is (`turned`).
    pub(in crate::view) fn turned(&self, bounds: Bounds<f32>) -> Bounds<f32> {
        turned(self.turn, bounds)
    }
}
