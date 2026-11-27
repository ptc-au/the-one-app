//! What the window draws of its own over its page: its title, its buttons, its notice and the rail's tip.

use super::*;

impl Painter<'_> {
    /// A window's title over the top of its page (`Title`), in a computer's own size: the app's icon and its name in
    /// semibold, in the middle of the `bar`, which nothing presses. → where it ends.
    pub(in crate::view) fn title(&mut self, title: &Title, start: f32, bar: f32) -> f32 {
        let conditions = self.conditions;
        let window = self.window;
        let (_, style) = chrome_type(conditions);
        let middle = bar / 2.0;
        let (icon, gap) = (16.0, 6.0);
        let mut x = start;
        if let Some(src) = &title.icon {
            self.picture(src, Bounds { origin: point(x, middle - icon / 2.0), size: Size { width: icon, height: icon } }, icon * 0.225);
            x += icon + gap;
        }
        let name = self.text.paragraph(&title.name, &style, &[], None, Some(1));
        let at = Bounds { origin: point(x, middle - name.size().height / 2.0), size: name.size() };
        let text = Text { style, color: colour_token("label", conditions), align: 0.0, wrap: false, underline: false, selectable: false };
        self.paint_text(&name, &[], at, name.size().width.ceil(), 1.0, text, 1.0, ContentMask::from(window));
        x + name.size().width.ceil()
    }

    /// One of the window's own buttons (`WindowButton`): on Windows as its caption buttons are, as wide as they are
    /// and as tall as the row, lit under the pointer (the close one in red) with a thin symbol; elsewhere as a GNOME
    /// header bar's, a round button with its symbol in the label's colour.
    pub(in crate::view) fn window_button(&mut self, kind: super::super::WindowButton, bounds: Bounds<f32>, hovered: bool) {
        let conditions = self.conditions;
        let window = self.window;
        let colour = |id: &str| colour_token(id, conditions);
        let windows = cfg!(windows);
        let closing = windows && hovered && kind == super::super::WindowButton::Close;
        let fill = if closing { colour("destructive") } else if hovered { colour("quaternary-label") } else if windows { Hsla::default() } else { colour("quinary-label") };
        if windows {
            self.quad(bounds, ContentMask::from(window), fill, Edges::default(), Hsla::default(), Corners::default(), false, 1.0);
        } else {
            self.quad(bounds, ContentMask::from(window), fill, Edges::default(), Hsla::default(), Corners::all(bounds.size.width / 2.0), false, 1.0);
        }
        let (middle, ink) = (point(bounds.origin.x + bounds.size.width / 2.0, bounds.origin.y + bounds.size.height / 2.0), if closing { colour("on-accent") } else { colour("label") });
        let (size, thick, rise) = if windows { (10.0, 1.0, 0.0) } else { (8.0, 1.5, 3.0) };
        let line = |width: f32, height: f32, y: f32| Bounds { origin: point(middle.x - width / 2.0, middle.y + y - height / 2.0), size: Size { width, height } };
        match kind {
            super::super::WindowButton::Minimize => self.quad(line(size, thick, rise), ContentMask::from(window), ink, Edges::default(), Hsla::default(), Corners::default(), false, 1.0),
            super::super::WindowButton::Maximize => self.quad(line(size, size, 0.0), ContentMask::from(window), Hsla::default(), Edges { top: thick, right: thick, bottom: thick, left: thick }, ink, Corners::all(if windows { 0.0 } else { 1.0 }), false, 1.0),
            // A cross of two diagonals, a row of small squares each: a line turned by `turn` that thin isn't drawn whole.
            super::super::WindowButton::Close => {
                let half = if windows { 5.0 } else { 4.0 };
                let (steps, dot) = (((2.0 * half) / 0.5) as i32, thick.max(1.0));
                for step in 0..=steps {
                    let along = -half + step as f32 * 0.5;
                    for across in [along, -along] {
                        let square = Bounds { origin: point(middle.x + along - dot / 2.0, middle.y + across - dot / 2.0), size: Size { width: dot, height: dot } };
                        self.quad(square, ContentMask::from(window), ink, Edges::default(), Hsla::default(), Corners::default(), false, 1.0);
                    }
                }
            }
        }
    }

    /// The window's notice (`Notice`) where it says it (`NoticeAt`), clear of what the window keeps for itself
    /// (`insets`): a banner, `NOTICE_HEIGHT` tall, in the muted fill with its words in the muted foreground, as the
    /// window page's banner is (client.css's `#banner`), centred, and its action after them, highlighted under the
    /// pointer; or in a title row, a pill of the same in its middle, and in a panel, at the start of its foot. → where its
    /// action is.
    pub(in crate::view) fn notice(&mut self, notice: &Notice, at: NoticeAt, insets: Edges<f32>, hovered: bool) -> Option<Bounds<f32>> {
        let conditions = self.conditions;
        let window = self.window;
        let colour = |id: &str| colour_token(id, conditions);
        let (words_style, action_style) = chrome_type(conditions);
        let words = self.text.paragraph(&notice.text, &words_style, &[], None, Some(1));
        let action = notice.action.as_ref().map(|(name, _)| self.text.paragraph(name, &action_style, &[], None, Some(1)));
        let (pad, gap, height) = (8.0, 8.0, crate::view::NOTICE_HEIGHT);
        let action_width = action.as_ref().map_or(0.0, |action| gap + pad + action.size().width.ceil() + pad);
        let width = words.size().width.ceil() + action_width;
        let (banner, round) = match at {
            NoticeAt::Row => {
                let height = 24.0;
                let pill = Bounds { origin: point((window.size.width - width) / 2.0 - 12.0, (insets.top - height) / 2.0), size: Size { width: width + 24.0, height } };
                (pill, Corners::all(height / 2.0))
            }
            NoticeAt::Top => (Bounds { origin: point(0.0, insets.top), size: Size { width: window.size.width, height } }, Corners::default()),
            NoticeAt::Foot => {
                let height = 28.0;
                let pill = Bounds { origin: point(insets.left + 16.0, window.size.height - insets.bottom - 16.0 - height), size: Size { width: width + 24.0, height } };
                (pill, Corners::all(height / 2.0))
            }
        };
        let height = banner.size.height;
        self.quad(banner, ContentMask::from(window), colour("muted"), Edges::default(), Hsla::default(), round, false, 1.0);
        let middle = banner.origin.y + height / 2.0;
        let words_at = |paragraph: &Paragraph, x: f32| Bounds { origin: point(x, middle - paragraph.size().height / 2.0), size: paragraph.size() };
        let text = Text { style: words_style, color: colour("muted-foreground"), align: 0.0, wrap: false, underline: false, selectable: false };
        let start = if at == NoticeAt::Foot { banner.origin.x + 12.0 } else { (window.size.width - width) / 2.0 };
        self.paint_text(&words, &[], words_at(&words, start), words.size().width.ceil(), 1.0, text, 1.0, ContentMask::from(window));
        let action = action?;
        let x = start + words.size().width.ceil() + gap;
        let bounds = Bounds { origin: point(x, banner.origin.y + 4.0), size: Size { width: pad + action.size().width.ceil() + pad, height: height - 8.0 } };
        if hovered {
            let mut highlight = colour("label");
            highlight.a *= 0.08;
            self.quad(bounds, ContentMask::from(window), highlight, Edges::default(), Hsla::default(), Corners::all(bounds.size.height / 2.0), false, 1.0);
        }
        self.paint_text(&action, &[], words_at(&action, x + pad), action.size().width.ceil(), 1.0, Text { style: action_style, ..text }, 1.0, ContentMask::from(window));
        Some(bounds)
    }

    /// The rail's tip (`Tip`), as the window page's is (client.css's `#tip`), on a window whose right edge keeps `right`
    /// for itself: a dark callout whatever the page's mode, its point on the line, with its symbol, its words and Got
    /// it, pressed or not; the ring pulsing on the `line` while it shows; and the hint's see-through finger on it. →
    /// where the callout is, and its Got it.
    pub(in crate::view) fn tip(&mut self, tip: Tip, right: f32, line: Option<Bounds<f32>>, pressed: bool) -> (Bounds<f32>, Bounds<f32>) {
        let window = self.window;
        let mask = ContentMask::from(window);
        let dark = Conditions { dark: true, ..self.conditions };
        let colour = |id: &str| colour_token(id, dark);
        let blue = colour("blue");
        let white = Hsla { h: 0.0, s: 0.0, l: 1.0, a: 1.0 };
        let (middle, edge) = (window.size.height / 2.0, window.size.width - right);
        let none = (Edges::default(), Hsla::default());
        // The ring, round the line, growing and fading as it pulses: the first 70 % of each, eased out, as CSS eases
        // each keyframe's stretch.
        if let (Some(ring), Some(line)) = (tip.ring, line)
            && ring < 0.7
        {
            let grown = crate::view::transition::ease([0.0, 0.0, 0.58, 1.0], ring / 0.7);
            let scale = 0.8 + 0.55 * grown;
            let (width, height) = ((line.size.width + 10.0) * scale, (line.size.height + 12.0) * scale);
            let at = Bounds { origin: point(line.origin.x + line.size.width / 2.0 - width / 2.0, line.origin.y + line.size.height / 2.0 - height / 2.0), size: Size { width, height } };
            let thick = 2.0 * scale;
            self.quad(at, mask, Hsla::default(), Edges { top: thick, right: thick, bottom: thick, left: thick }, blue, Corners::all(7.0 * scale), false, 0.9 * (1.0 - grown));
        }
        // The hint's finger, a fingertip's size, just inside the line a little below the callout's point: it's drawn on
        // the window, whose edge it pulls in, so it's all inside it.
        if let Some((opacity, scale)) = tip.finger {
            let size = 40.0 * scale;
            let at = Bounds { origin: point(edge - 24.0 - size / 2.0, middle + 16.0 - size / 2.0), size: Size { width: size, height: size } };
            let shadow = crate::tokens::Shadow { x: 0.0, y: 6.0, blur: 16.0, spread: 0.0, colour: crate::geometry::Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.28 }, inset: false };
            self.shadow(&shadow, at, Corners::all(size / 2.0), 1.0, mask, opacity);
            self.quad(at, mask, white.opacity(0.6), Edges { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 }, Hsla { a: 0.2, ..Hsla::default() }, Corners::all(size / 2.0), false, opacity);
        }
        // The callout: its symbol beside its words, and Got it under a hairline.
        let table = crate::tokens::table();
        let weight = |id: &str, or: f32| table.weight(id, dark).unwrap_or(or).round() as u16;
        let style = |size: f32, line_height: f32, weight: u16| crate::text::TextStyle { size, weight, tracking: 0.0, line_height, tabular: false, mono: false };
        let (heading, about) = (style(16.0, 20.0, weight("title-weight", 600.0)), style(14.0, 18.0, weight("body-weight", 400.0)));
        let (width, pad, symbol, gap) = (232.0, 12.0, 28.0, 10.0);
        let column = width - 2.0 * pad - symbol - gap;
        let title = self.text.paragraph("Pull to go home", &heading, &[], Some(column), None);
        let words = self.text.paragraph("Drag the line on the right edge in, from any app.", &about, &[], Some(column), None);
        let done = self.text.paragraph("Got it", &heading, &[], None, Some(1));
        let top_part = symbol.max(title.size().height + 2.0 + words.size().height);
        let height = pad + top_part + 10.0 + 0.5 + 10.0 + done.size().height + 12.0;
        let callout = Bounds { origin: point(edge - 22.0 - width, middle - 6.0 - height), size: Size { width, height } };
        let fill = Hsla { h: 0.0, s: 0.0, l: 0.135, a: 1.0 };
        let lifted = crate::tokens::Shadow { x: 0.0, y: 12.0, blur: 28.0, spread: -6.0, colour: crate::geometry::Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.3 }, inset: false };
        self.shadow(&lifted, callout, Corners::all(14.0), 1.0, mask, 1.0);
        // A rim of light, as what's raised has in dark, since black hides its shadow.
        self.quad(callout, mask, fill, Edges { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 }, colour("border"), Corners::all(14.0), false, 1.0);
        // Its point, a square turned a quarter, half out of its right edge.
        let point_at = point(callout.origin.x + width, callout.origin.y + height - 8.0 - 7.0);
        self.turned_quad(point_at, std::f32::consts::FRAC_PI_4, Size { width: 14.0, height: 14.0 }, fill, Corners { top_left: 0.0, top_right: 3.0, bottom_right: 0.0, bottom_left: 0.0 });
        // Its symbol: the line, and an arrow pulling in from it, white on blue.
        let tile = Bounds { origin: point(callout.origin.x + pad, callout.origin.y + pad), size: Size { width: symbol, height: symbol } };
        self.quad(tile, mask, blue, none.0, none.1, Corners::all(6.0), false, 1.0);
        let glyph = |x: f32, y: f32| point(tile.origin.x + 6.0 + x, tile.origin.y + 6.0 + y);
        let bar = |from: Point<f32>, width: f32, height: f32| Bounds { origin: point(from.x - width / 2.0, from.y - height / 2.0), size: Size { width, height } };
        self.quad(bar(glyph(13.5, 8.0), 2.0, 10.0 + 2.0), mask, white, none.0, none.1, Corners::all(1.0), false, 1.0);
        self.quad(bar(glyph(6.25, 8.0), 7.5 + 1.8, 1.8), mask, white, none.0, none.1, Corners::all(0.9), false, 1.0);
        for (turn, y) in [(-std::f32::consts::FRAC_PI_4, 6.5), (std::f32::consts::FRAC_PI_4, 9.5)] {
            self.turned_quad(glyph(4.0, y), turn, Size { width: 4.24 + 1.8, height: 1.8 }, white, Corners::all(0.9));
        }
        let x = tile.origin.x + symbol + gap;
        let mut y = callout.origin.y + pad;
        let ink = |style, color| Text { style, color, align: 0.0, wrap: true, underline: false, selectable: false };
        self.paint_text(&title, &[], Bounds { origin: point(x, y), size: title.size() }, column, 1.0, ink(heading, colour("label")), 1.0, mask);
        y += title.size().height + 2.0;
        self.paint_text(&words, &[], Bounds { origin: point(x, y), size: words.size() }, column, 1.0, ink(about, colour("secondary-label")), 1.0, mask);
        y = callout.origin.y + pad + top_part + 10.0;
        let hairline = Bounds { origin: point(callout.origin.x + pad, y), size: Size { width: width - 2.0 * pad, height: 0.5 } };
        self.quad(hairline, mask, colour("border"), none.0, none.1, Corners::default(), false, 1.0);
        let button = Bounds { origin: point(callout.origin.x, y), size: Size { width, height: callout.origin.y + height - y } };
        let at = Bounds { origin: point(callout.origin.x + pad, y + 10.5), size: done.size() };
        self.paint_text(&done, &[], at, done.size().width.ceil(), 1.0, ink(heading, blue), if pressed { 0.7 } else { 1.0 }, mask);
        (callout, button)
    }

    /// A quad `size` big, its middle at `middle`, turned by `angle` radians about it.
    fn turned_quad(&mut self, middle: Point<f32>, angle: f32, size: Size<f32>, fill: Hsla, corners: Corners<f32>) {
        let (sin, cos) = angle.sin_cos();
        let was = self.turn;
        // Turned about its middle: x' = R x + (c - R c).
        self.turn = TransformationMatrix { rotation_scale: [[cos, -sin], [sin, cos]], translation: [middle.x - (cos * middle.x - sin * middle.y), middle.y - (sin * middle.x + cos * middle.y)] };
        let at = Bounds { origin: point(middle.x - size.width / 2.0, middle.y - size.height / 2.0), size };
        self.quad(at, ContentMask::from(self.window), fill, Edges::default(), Hsla::default(), corners, false, 1.0);
        self.turn = was;
    }
}
