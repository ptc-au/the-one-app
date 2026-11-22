//! Painting an input, a paragraph and the spans in it.

use super::*;

impl Painter<'_> {
    /// An input: its text, or its placeholder while it's empty, clipped to its box; with the keyboard, what's selected
    /// behind it, what an input method composes underlined, and the caret, as it blinks; scrolled to keep the caret
    /// in view as it moves. Where it's drawn is kept for the pointer (`Drawn`).
    #[allow(clippy::too_many_arguments)]
    pub(in crate::view) fn paint_input(&mut self, id: Id, node: &Node, content: Bounds<f32>, padding: Bounds<f32>, width: f32, grown: f32, text: Text, opacity: f32, mask: ContentMask<f32>) {
        let field = self.fields.get(&id);
        let shown = field.map(Field::display).unwrap_or_default();
        let multiline = node.is("multiline");
        let focused = self.states.focused == Some(id) && field.is_some();
        let empty = shown.is_empty();
        let placeholder = colour_token("tertiary-label", self.conditions);
        let (words, color) = if empty { (node.str("placeholder").unwrap_or_default().to_owned(), placeholder) } else { (shown.clone(), text.color) };
        let paragraph = self.text.paragraph(&words, &text.style, &[], multiline.then_some(width), None);
        let line_height = text.style.line_height;
        // A one-line input's text in the middle of its box, as it's drawn in a row centred on its items.
        let top = if multiline { content.origin.y } else { content.origin.y + (content.size.height - paragraph.size().height * grown) / 2.0 };
        // Its text starts where its first strong character's direction says, as an input with `dir="auto"`: at the
        // right where it's Hebrew or Arabic.
        let rtl = !empty && paragraph.lines.first().is_some_and(|line| line.rtl);
        let text = if rtl { Text { align: 1.0 - text.align, ..text } } else { text };
        let aligned = |line: &crate::text::Line| (width - line.width).max(0.0) * text.align;
        let offsets: Vec<f32> = paragraph.lines.iter().map(aligned).collect();
        let offset = |line: usize| offsets.get(line).copied().unwrap_or(0.0);
        // Where the caret is drawn: where an arrow across text running both ways left it, or before its byte.
        let (caret_line, caret_x) = match field.and_then(Field::placed) {
            Some(placed) if !empty => placed,
            _ => {
                let (line, x) = paragraph.caret(field.map_or(0, Field::caret), field.is_some_and(Field::upstream));
                (line, x + offset(line))
            }
        };
        // One line scrolls along as the caret goes past its ends, as an `<input>` does, and back to its start once
        // it hasn't the keyboard; several scroll down and up to keep the caret's line in its box as it moves, as a
        // `<textarea>`, and by the wheel (`Screen::scroll`, which keeps how far in `scrolled`) without its moving.
        let mut scroll = self.drawn.get(&id).map_or(point(0.0, 0.0), |drawn| drawn.scroll);
        let seen = (focused, field.map_or(0, Field::caret), field.is_some_and(Field::upstream), shown.len());
        let moved = self.drawn.get(&id).is_none_or(|drawn| drawn.seen != seen);
        if !multiline {
            scroll.x = if focused && !empty { scroll.x.max(caret_x - width + 1.0).min(caret_x) } else { 0.0 };
            scroll.x = scroll.x.clamp(0.0, (paragraph.size().width + 1.0 - width).max(0.0));
        } else {
            let height = content.size.height / grown;
            let top = caret_line as f32 * line_height;
            scroll.y = self.scrolled.get(&id).map_or(0.0, |scrolled| scrolled.y);
            if focused && moved {
                scroll.y = scroll.y.max(top + line_height - height).min(top);
            }
            let can = (paragraph.size().height - height).max(0.0);
            scroll.y = scroll.y.clamp(0.0, can);
            self.scrolled.insert(id, point(0.0, scroll.y));
        }
        let origin = point(content.origin.x, top - scroll.y * grown);
        // Several lines scrolled run on into its padding, as a `<textarea>`'s do; one line stops at its content.
        let clip = mask.intersect(&ContentMask::from(if multiline { padding } else { content }));
        // A point along line `line`, `x` from where its paragraph starts, in the window.
        let at = |line: usize, x: f32| point(origin.x + (x - scroll.x) * grown, origin.y + line as f32 * line_height * grown);
        let drawn = Drawn { paragraph, empty, origin, offsets, grown, scroll, seen };
        let selection = field.filter(|_| focused && !empty).map(Field::selection).filter(|(start, end)| start < end);
        if let Some((start, end)) = selection {
            let tint = colour_token("blue", self.conditions).opacity(0.3);
            for bounds in drawn.spans(start, end) {
                self.quad(bounds, clip, tint, Edges::default(), Hsla::default(), Corners::default(), false, opacity);
            }
        }
        let area = Bounds { origin: point(origin.x - scroll.x * grown, origin.y), size: content.size };
        self.paint_text(&drawn.paragraph, &[], area, width, grown, Text { color, ..text }, opacity, clip);
        let paragraph = &drawn.paragraph;
        if let (true, Some(field)) = (focused, field) {
            // What an input method is composing is underlined, as every platform's own fields draw it.
            if let Some((start, end)) = field.composed() {
                for (line, x0, x1) in paragraph.spans(start, end) {
                    let below = at(line, x0 + drawn.offsets.get(line).copied().unwrap_or(0.0));
                    let bounds = Bounds { origin: point(below.x, below.y + (line_height - 2.0) * grown), size: Size { width: (x1 - x0) * grown, height: grown } };
                    self.quad(bounds, clip, text.color, Edges::default(), Hsla::default(), Corners::default(), false, opacity);
                }
            }
            if self.caret && !field.readonly {
                let place = if empty { point(origin.x + width * text.align * grown, origin.y) } else { at(caret_line, caret_x) };
                let bounds = Bounds { origin: place, size: Size { width: grown, height: line_height * grown } };
                self.quad(bounds, clip, text.color, Edges::default(), Hsla::default(), Corners::default(), false, opacity);
            }
        }
        // What a finger selected has its handles at its ends, over what's around the field, as a phone's own do.
        if let (Some((start, end)), true) = (selection, self.handles == Some(id)) {
            let tint = colour_token("blue", self.conditions);
            for handle in super::super::text_selection::handles(drawn.caret_at(start, false), drawn.caret_at(end, true)) {
                for (bounds, corners) in handle.shapes() {
                    self.quad(bounds, mask, tint, Edges::default(), Hsla::default(), corners, false, opacity);
                }
            }
        }
        self.drawn.insert(id, drawn);
    }

    /// A paragraph's words, set in `text`, or as `runs` say where it's given them: what's behind each run first, then
    /// its glyphs, then each underline, along each line at its baseline's foot.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::view) fn paint_text(&mut self, paragraph: &Paragraph, runs: &[TextRun], content: Bounds<f32>, width: f32, grown: f32, text: Text, opacity: f32, mask: ContentMask<f32>) {
        let own = [TextRun { len: usize::MAX, style: text.style, color: text.color, background_color: None, underline: text.underline }];
        let runs = if runs.is_empty() { &own[..] } else { runs };
        let mut at = 0usize;
        let ranges: Vec<(usize, usize, &TextRun)> = runs
            .iter()
            .map(|run| {
                let start = at;
                at = at.saturating_add(run.len);
                (start, at, run)
            })
            .collect();
        let line_height = paragraph.line_height;
        let left = |line: usize| content.origin.x + paragraph.lines.get(line).map_or(0.0, |drawn| (width - drawn.width).max(0.0) * text.align) * grown;
        for (start, end, run) in &ranges {
            let Some(behind) = run.background_color else { continue };
            for (line, x0, x1) in paragraph.inked(*start, *end) {
                // As CSS draws an inline's background: over its content area, its font's ascent and descent.
                let (ascent, descent) = paragraph.lines.get(line).map_or((line_height, 0.0), |drawn| (drawn.ascent, drawn.descent));
                let top = content.origin.y + (line as f32 * line_height + (line_height - ascent - descent) / 2.0) * grown;
                let bounds = Bounds { origin: point(left(line) + x0 * grown, top), size: Size { width: (x1 - x0) * grown, height: (ascent + descent) * grown } };
                self.quad(bounds, mask, behind, Edges::default(), Hsla::default(), Corners::default(), false, opacity);
            }
        }
        let scaled_mask = mask.scale_to(self.scale);
        // Glyphs grown with their box are rasterized at that size (`TextSystem::paint`), so they stay sharp.
        let origin = point(px(content.origin.x / grown), px(content.origin.y / grown));
        let color = |index: usize| ranges.iter().find(|(start, end, _)| (*start..*end).contains(&index)).map_or(text.color, |(_, _, run)| run.color).opacity(opacity);
        if let Err(error) = self.text.paint(paragraph, origin, width, text.align, &color, self.scale, grown, scaled_mask, self.turn.scaled(self.scale), self.atlas, self.scene) {
            log::warn!("text didn't draw: {error:#}");
        }
        for (start, end, run) in &ranges {
            if !run.underline {
                continue;
            }
            for (line, x0, x1) in paragraph.inked(*start, *end) {
                let y = content.origin.y + (line as f32 + 1.0) * line_height * grown - line_height * grown * 0.18;
                let bounds = Bounds { origin: point(left(line) + x0 * grown, y), size: Size { width: (x1 - x0) * grown, height: grown.max(1.0) } };
                self.quad(bounds, mask, run.color, Edges::default(), Hsla::default(), Corners::default(), false, opacity);
            }
        }
    }
}
