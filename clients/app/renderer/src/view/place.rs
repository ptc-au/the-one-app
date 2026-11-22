//! Where what's drawn is, for the pointer, Tab, the window and the inspector (`Placing`): found from the retained layout
//! and each node's transform, opacity and clip, in the order paint draws, so what's on top takes the pointer, as a
//! browser hit-tests its layout and a compositor's layers by their transforms, never from what paint recorded. And
//! where a node's box is drawn (`Placement`), which paint and placing both work out the same way.

use super::*;

/// Where what's drawn is, as a frame placed it (`Placer`): what takes the pointer, in the order it's drawn; where each
/// node is; Tab's order as drawn; each node listening for `intersection` and whether it's near the window; where a
/// press moves the window and where in that it doesn't (`appRegion`); a panel's panes of the system's glass; the topmost
/// `aria-modal` dialog, which holds the keyboard; and where each frame's page is.
#[derive(Default)]
pub(super) struct Placing {
    pub(super) placed: Vec<(Id, Placed)>,
    pub(super) rects: Rects,
    pub(super) tab_order: Vec<Id>,
    pub(super) intersections: Vec<(Id, bool)>,
    pub(super) drag_regions: Vec<(Id, Bounds<f32>)>,
    pub(super) kept_regions: Vec<Bounds<f32>>,
    pub(super) glass: Vec<crate::platform::Glass>,
    pub(super) modal: Option<Id>,
    pub(super) framed: Vec<(Id, Bounds<f32>)>,
}

/// Places a laid out tree (`Placer::place`): what it reads, and where it is in the tree as it goes.
pub(super) struct Placer<'a> {
    pub(super) tree: &'a Tree,
    pub(super) layout: &'a Retained,
    pub(super) text: &'a mut TextSystem,
    pub(super) transitions: &'a transition::Transitions,
    pub(super) time: f64,
    pub(super) scrolled: &'a HashMap<Id, Point<f32>>,
    pub(super) stretched: &'a HashMap<Id, Point<f32>>,
    pub(super) drawn: &'a HashMap<Id, Drawn>,
    /// What's drawn as a layer of its own, which makes a stacking context, as paint draws it.
    pub(super) layered: &'a HashSet<Id>,
    pub(super) window: Bounds<f32>,
    pub(super) scale: f32,
    /// A panel's: its page's panes of the system's own material are placed (`Glass`).
    pub(super) panel: Option<Panel>,
    pub(super) out: Placing,
    /// Where what's placed now is near the window, what clips it cut to it and what scrolls it grown as the window is: a
    /// node listening for `intersection` is near where it's within half the window's size of what shows of it, as an
    /// `IntersectionObserver` with a `rootMargin` and `scrollMargin` of 50% says. How what's placed now is turned; and
    /// what's positioned in the stacking context being placed, by its `zIndex` and where it is in the tree, as paint
    /// draws it (`Painter::stacked`).
    pub(super) near: Bounds<f32>,
    pub(super) turn: TransformationMatrix,
    pub(super) stacked: std::collections::BTreeMap<(i32, Vec<u32>), Deferred>,
    pub(super) path: Vec<u32>,
}

/// What's positioned, or says its `zIndex`, kept to be placed after its stacking context's flow, as paint draws it.
pub(super) struct Deferred {
    taffy_node: NodeId,
    offset: Point<f32>,
    transform: Transform,
    mask: ContentMask<f32>,
    opacity: f32,
    parent: Option<Id>,
    pointer: bool,
    near: Bounds<f32>,
    turn: TransformationMatrix,
}

/// Where a node's box is drawn in a frame: where it's laid out, moved by `offset` (its parent's top left), on its way
/// from where it was laid out (`Transitions::flip`); `transform`, through what it's in and its own move and growth
/// around its middle (`centre`); and its box, its padding box and its content box there.
pub(super) struct Placement {
    pub(super) laid_out: Bounds<f32>,
    pub(super) centre: Point<f32>,
    pub(super) transform: Transform,
    pub(super) bounds: Bounds<f32>,
    pub(super) padding: Bounds<f32>,
    pub(super) content: Bounds<f32>,
}

impl Placement {
    pub(super) fn of(laid: &taffy::Layout, offset: Point<f32>, transform: Transform, look: &Look, flip: Option<[f32; 4]>) -> Placement {
        let laid_out = Bounds { origin: point(offset.x + laid.location.x, offset.y + laid.location.y), size: Size { width: laid.size.width, height: laid.size.height } };
        let laid_out = match flip {
            Some([x, y, wider, taller]) => Bounds { origin: point(laid_out.origin.x + x, laid_out.origin.y + y), size: Size { width: (laid_out.size.width + wider).max(0.0), height: (laid_out.size.height + taller).max(0.0) } },
            None => laid_out,
        };
        // Its own move and growth, around its middle, which moves nothing around it.
        let centre = point(laid_out.origin.x + laid_out.size.width / 2.0, laid_out.origin.y + laid_out.size.height / 2.0);
        let translate = point(look.translate.0.of(laid_out.size.width), look.translate.1.of(laid_out.size.height));
        let transform = if translate == point(0.0, 0.0) && look.scale == 1.0 && look.rest_scale == 1.0 { transform } else { transform.then(translate, look.scale, look.rest_scale, centre) };
        let padding = Bounds {
            origin: point(laid_out.origin.x + laid.border.left, laid_out.origin.y + laid.border.top),
            size: Size { width: laid.size.width - laid.border.left - laid.border.right, height: laid.size.height - laid.border.top - laid.border.bottom },
        };
        let content = Bounds {
            origin: point(laid_out.origin.x + laid.border.left + laid.padding.left, laid_out.origin.y + laid.border.top + laid.padding.top),
            size: Size { width: laid.content_box_width(), height: laid.content_box_height() },
        };
        Placement { laid_out, centre, transform, bounds: transform.bounds(laid_out), padding: transform.bounds(padding), content: transform.bounds(content) }
    }

    /// How what it is and what's in it is turned: `turn`, then around its middle as its `rotate` says.
    pub(super) fn turn(&self, look: &Look, turn: TransformationMatrix) -> TransformationMatrix {
        if look.rotate.rem_euclid(360.0) == 0.0 {
            return turn;
        }
        let middle = self.transform.point(self.centre);
        TransformationMatrix::rotation(look.rotate, [middle.x, middle.y]).then(&turn)
    }

    /// Its corners' radii, in pixels, as drawn.
    pub(super) fn radii(&self, look: &Look) -> Corners<f32> {
        let scale = self.transform.scale;
        Corners {
            top_left: corner(look.radii.top_left, self.bounds.size, scale),
            top_right: corner(look.radii.top_right, self.bounds.size, scale),
            bottom_right: corner(look.radii.bottom_right, self.bounds.size, scale),
            bottom_left: corner(look.radii.bottom_left, self.bounds.size, scale),
        }
    }

    /// What it clips what's in it to, cut to `mask`: its padding box, turned as `turn` says, its corners rounded inside
    /// its border, as CSS clips; turned, to the box around it.
    pub(super) fn clip(&self, look: &Look, mask: ContentMask<f32>, turn: TransformationMatrix) -> ContentMask<f32> {
        let (radii, scale) = (self.radii(look), self.transform.scale);
        // Mutant: cut to the square box, as before 26a619d61.
        let inside = |radius: f32, across: f32, down: f32| if turn == TransformationMatrix::unit() && !crate::mutants::mutant("rounded-clip") { (radius - (across * scale).max(down * scale)).max(0.0) } else { 0.0 };
        let borders = look.borders;
        let corner_radii = Corners {
            top_left: inside(radii.top_left, borders.left, borders.top),
            top_right: inside(radii.top_right, borders.right, borders.top),
            bottom_right: inside(radii.bottom_right, borders.right, borders.bottom),
            bottom_left: inside(radii.bottom_left, borders.left, borders.bottom),
        };
        mask.intersect(&ContentMask { bounds: turned(turn, self.padding), corner_radii })
    }
}

/// How far a scroll laid out as `laid` can scroll (`most`), how far it's scrolled now, `scrolled` held to that, and
/// how far that and `stretched` past its end move what's in it, by whole device pixels at `scale`, as Chromium snaps a
/// scroll's offset: what it drew is the same a few pixels on.
pub(super) fn scroll(laid: &taffy::Layout, scrolled: Point<f32>, stretched: Point<f32>, scale: f32) -> (Point<f32>, Point<f32>, Point<f32>) {
    let inner = Size { width: laid.size.width - laid.border.left - laid.border.right, height: laid.size.height - laid.border.top - laid.border.bottom };
    let most = point((laid.scrollable_overflow_rect.right - inner.width).max(0.0), (laid.scrollable_overflow_rect.bottom - inner.height).max(0.0));
    let now = point(scrolled.x.clamp(0.0, most.x), scrolled.y.clamp(0.0, most.y));
    let snapped = |length: f32| (length * scale).round() / scale;
    (most, now, point(snapped(now.x + stretched.x), snapped(now.y + stretched.y)))
}

/// A node's children in CSS's painting order (CSS 2.1, Appendix E): those whose `zIndex` is below 0 first, then the
/// rest of its flow in order, each with where it is among them and its `zIndex`.
pub(super) fn painted_children(layout: &Retained, taffy_node: NodeId) -> Vec<(u32, NodeId, i32)> {
    let mut children: Vec<(u32, NodeId, i32)> =
        layout.taffy.children(taffy_node).unwrap_or_default().into_iter().enumerate().map(|(at, child)| (at as u32, child, layout.leaf(child).look.z_index.unwrap_or(0))).collect();
    children.sort_by_key(|(at, _, z)| ((*z).min(0), *at));
    children
}

/// Whether a child whose `zIndex` is `z` is drawn after its stacking context's flow, as CSS draws what's positioned or
/// says its `zIndex`, rather than in its flow.
pub(super) fn later(leaf: &Leaf, z: i32) -> bool {
    // Mutant: what's positioned with no `zIndex` drawn in its flow, as before 41c47f044.
    z >= 0 && ((leaf.positioned && !crate::mutants::mutant("paint-order")) || leaf.look.z_index.is_some())
}

/// Whether node `id` makes a stacking context, as CSS's does: the window; what's fixed; what says its `zIndex` (each
/// node here is positioned or a flex or grid item, where any `zIndex` makes one); and what's less than opaque, moved,
/// grown, turned, blurs what's behind it, moves by itself or is about to (`willChange`), or is drawn from a layer of its
/// own (`layered`), which is moved and faded as a whole.
pub(super) fn stacks(id: Id, look: &Look, fixed: bool, layered: &HashSet<Id>) -> bool {
    id == 0
        || fixed
        || look.z_index.is_some()
        || look.opacity < 1.0
        || look.translate != (Offset::Px(0.0), Offset::Px(0.0))
        || look.scale != 1.0
        || look.rest_scale != 1.0
        || look.rotate.rem_euclid(360.0) != 0.0
        || look.material.is_some()
        || look.animation.is_some()
        || look.will_change
        || layered.contains(&id)
}

/// The box `bounds` covers in the window once it's turned as `turn` says: itself, where nothing's turned.
pub(super) fn turned(turn: TransformationMatrix, bounds: Bounds<f32>) -> Bounds<f32> {
    if turn == TransformationMatrix::unit() {
        return bounds;
    }
    let (left, top, right, bottom) = (bounds.origin.x, bounds.origin.y, bounds.origin.x + bounds.size.width, bounds.origin.y + bounds.size.height);
    let corners = [[left, top], [right, top], [left, bottom], [right, bottom]].map(|corner| turn.apply(corner));
    let (mut low, mut high) = (corners[0], corners[0]);
    for [x, y] in corners {
        low = [low[0].min(x), low[1].min(y)];
        high = [high[0].max(x), high[1].max(y)];
    }
    Bounds { origin: point(low[0], low[1]), size: Size { width: high[0] - low[0], height: high[1] - low[1] } }
}

impl Placer<'_> {
    /// Places the tree from `root`, laid out in the window. → where it all is.
    pub(super) fn place(mut self, root: NodeId) -> Placing {
        // A whole panel is on the system's glass.
        if let Some(panel) = self.panel.filter(|panel| panel.whole) {
            self.out.glass.push(crate::platform::Glass { bounds: self.window, radius: panel.corner, opacity: 1.0 });
        }
        self.place_node(root, point(0.0, 0.0), Transform::NONE, ContentMask::from(self.window), 1.0, None, true);
        self.out
    }

    /// `bounds` grown by half the window's size on each side, as near it as an `IntersectionObserver`'s margin of 50%.
    fn grown(&self, bounds: Bounds<f32>) -> Bounds<f32> {
        let (x, y) = (self.window.size.width / 2.0, self.window.size.height / 2.0);
        Bounds { origin: point(bounds.origin.x - x, bounds.origin.y - y), size: Size { width: bounds.size.width + 2.0 * x, height: bounds.size.height + 2.0 * y } }
    }

    fn place_deferred(&mut self, deferred: Deferred) {
        let (near, turn) = (self.near, self.turn);
        (self.near, self.turn) = (deferred.near, deferred.turn);
        self.place_node(deferred.taffy_node, deferred.offset, deferred.transform, deferred.mask, deferred.opacity, deferred.parent, deferred.pointer);
        (self.near, self.turn) = (near, turn);
    }

    /// Places `node`, with its parent's top left at `offset` in its layout, drawn through `transform` and turned as what
    /// it's in is, clipped to `mask` (in the window), `opacity` as opaque as it shows, in `parent`, taking the pointer if
    /// `pointer`, as `Painter::paint_node` draws it.
    #[allow(clippy::too_many_arguments)]
    fn place_node(&mut self, taffy_node: NodeId, offset: Point<f32>, transform: Transform, mask: ContentMask<f32>, opacity: f32, parent: Option<Id>, pointer: bool) {
        let (tree, layout) = (self.tree, self.layout);
        let Ok(laid) = layout.taffy.layout(taffy_node) else { return };
        // What isn't displayed isn't drawn, and nothing in it is.
        if layout.taffy.style(taffy_node).is_ok_and(|style| style.display == taffy::style::Display::None) {
            return;
        }
        let Some(leaf) = layout.taffy.get_node_context(taffy_node) else { return };
        let (id, look) = (leaf.id, &leaf.look);
        let node = &tree.nodes[&id];
        // Starting to cross-dissolve, it's drawn where it was in this frame (`Painter::paint_node`).
        let transform = match self.transitions.dissolving(id, self.time) {
            Some((from, 0.0)) => Transform { offset: point(transform.offset.x + from.x * transform.scale, transform.offset.y + from.y * transform.scale), ..transform },
            _ => transform,
        };
        // Mutant: what's drawn from a moving layer placed where it rests, as a layer's recorded places were before
        // they were moved with it.
        let resting = crate::mutants::mutant("hit-layer").then(|| Look { translate: (Offset::Px(0.0), Offset::Px(0.0)), scale: 1.0, ..look.clone() });
        let look = resting.as_ref().filter(|_| self.layered.contains(&id)).unwrap_or(look);
        let placement = Placement::of(laid, offset, transform, look, self.transitions.flip(id, self.time));
        let (bounds, content, transform) = (placement.bounds, placement.content, placement.transform);
        let opacity = opacity * look.opacity;
        let turn = placement.turn(look, self.turn);
        self.turn = turn;
        let drawn = turned(turn, bounds);
        let shown = drawn.intersect(&mask.bounds);
        let root = id == 0;
        // What's inert takes no pointer, nor does what's in it.
        let pointer = !node.is("inert") && !tree.leaving(id) && look.pointer_events.unwrap_or(pointer);
        if node.str("aria-modal") == Some("true") && !tree.leaving_in(id) {
            self.out.modal = Some(id);
        }
        self.out.rects.insert(id, Rect { x: drawn.origin.x, y: drawn.origin.y, width: drawn.size.width, height: drawn.size.height });
        if node.listens("intersection") {
            self.out.intersections.push((id, drawn.intersects(&self.near)));
        }
        if !root {
            match look.app_region {
                Some(true) => self.out.drag_regions.push((id, bounds.intersect(&mask.bounds))),
                Some(false) => self.out.kept_regions.push(bounds.intersect(&mask.bounds)),
                None => {}
            }
            // The system's own glass is a pane of its own under the page, which can't fade (`Painter::paint_node`).
            if matches!(look.material, Some((_, _, true))) && self.panel.is_some() && opacity >= 1.0 {
                self.out.glass.push(crate::platform::Glass { bounds: bounds.intersect(&mask.bounds), radius: placement.radii(look).top_left, opacity });
            }
        }
        // A picker is pressed to open the device's (`Screen::click`).
        let pressable = (node.listens("click") || matches!(node.kind, Kind::Input | Kind::Picker)) && !node.is("disabled") && !node.is("aria-disabled");
        // Tab reaches what the DOM's does: an input, what's pressed as a button is (a role the DOM draws as a
        // `<button>`, core/ui's drawing-primitives/primitives.tsx `pressed`), and what says its `tabindex`.
        let tabindex = node.prop("tabindex").and_then(|index| index.as_i64().or_else(|| index.as_str()?.parse().ok()));
        // A text is never a `<button>` on the DOM, whatever its role: it's reached only by its `tabindex`.
        let button = node.kind != Kind::Text && node.listens("click") && node.str("role").is_some_and(|role| BUTTON_ROLES.contains(&role));
        // And a frame, where it goes into the frame's page.
        if (pressable && tabindex.is_none_or(|index| index >= 0) && (node.kind == Kind::Input || button || tabindex.is_some())) || node.kind == Kind::Frame {
            self.out.tab_order.push(id);
        }
        let focus = match node.str("role") {
            Some("option") => Clicked::Keeps,
            _ if (node.kind == Kind::Input && !node.is("disabled")) || button || tabindex.is_some() || node.kind == Kind::Frame => Clicked::Takes,
            _ => Clicked::Passes,
        };
        let mut placed = Placed { parent, shown, opacity, pointer, cursor: look.cursor, pressable, input: node.kind == Kind::Input, focus, scroll: None, touch_action: look.touch_action };
        match node.kind {
            Kind::Text | Kind::RawText if !leaf.spans.is_empty() => {
                self.out.placed.push((id, placed));
                let (_, paragraph) = layout.paragraph(taffy_node, self.text);
                return self.place_spans(id, &leaf.spans, &paragraph, content, laid.content_box_width().max(1.0), transform.scale, leaf.text.align, mask, pointer, opacity);
            }
            // Several lines scroll by the wheel and a trackpad too, as a `<textarea>` does, as far as its words run
            // past its box.
            Kind::Input if node.is("multiline") => {
                placed.scroll = self.drawn.get(&id).map(|drawn| ((drawn.paragraph.size().height - laid.content_box_height()).max(0.0), 0.0, false));
            }
            Kind::Frame => self.out.framed.push((id, content)),
            Kind::Box | Kind::Scroll | Kind::List => {
                let mut child_mask = mask;
                let mut child_offset = placement.laid_out.origin;
                let around = self.near;
                let mut near = self.window;
                if look.clips || look.scrolls {
                    child_mask = placement.clip(look, mask, turn);
                    near = turned(turn, placement.padding);
                    if look.scrolls {
                        near = self.grown(near);
                        let at = |of: &HashMap<Id, Point<f32>>| of.get(&id).copied().unwrap_or(point(0.0, 0.0));
                        let (most, _, by) = scroll(laid, at(self.scrolled), at(self.stretched), self.scale);
                        // Mutant: what's in a scroll placed as if it weren't scrolled.
                        if !crate::mutants::mutant("hit-scroll") {
                            child_offset = point(child_offset.x - by.x, child_offset.y - by.y);
                        }
                        let along = node.kind == Kind::Scroll && most.x > 0.0 && most.y == 0.0;
                        placed.scroll = Some((most.y, most.x, along));
                        placed.shown = child_mask.bounds;
                    }
                }
                self.out.placed.push((id, placed));
                let context = stacks(id, look, leaf.fixed, self.layered);
                let outer = context.then(|| std::mem::take(&mut self.stacked));
                // What scrolls is near as far as it'd be scrolled into view, however tight what it's in clips: its box
                // and what it's in, each grown by the margin. What only clips cuts what's near to it.
                let inside = match (look.scrolls, look.clips) {
                    (true, _) => self.grown(around).intersect(&near),
                    (false, true) => around.intersect(&near),
                    (false, false) => around,
                };
                for (at, child, z) in painted_children(layout, taffy_node) {
                    let leaf = layout.leaf(child);
                    let deferred = Deferred {
                        taffy_node: child,
                        offset: if leaf.fixed { point(0.0, 0.0) } else { child_offset },
                        transform: if leaf.fixed { Transform::NONE } else { transform },
                        mask: if leaf.fixed { ContentMask::from(self.window) } else { child_mask },
                        opacity: if leaf.fixed { 1.0 } else { opacity },
                        parent: Some(id),
                        pointer,
                        near: if leaf.fixed { self.grown(self.window) } else { inside },
                        turn,
                    };
                    self.path.push(at);
                    if later(leaf, z) {
                        self.stacked.insert((z, self.path.clone()), deferred);
                    } else {
                        self.place_deferred(deferred);
                    }
                    self.path.pop();
                }
                if let Some(outer) = outer {
                    while let Some(((_, path), deferred)) = self.stacked.pop_first() {
                        let path = std::mem::replace(&mut self.path, path);
                        self.place_deferred(deferred);
                        self.path = path;
                    }
                    self.stacked = outer;
                }
                self.near = around;
                return;
            }
            _ => {}
        }
        self.out.placed.push((id, placed));
    }

    /// The texts and raw texts inside text `id` where their words are drawn: each text placed for the pointer over each
    /// stretch of its words, after what it's in, so a press, hover and cursor find the innermost; each reached by Tab
    /// where the DOM's would be, a span with its `tabindex`; and each where an agent or a screen reader finds it.
    #[allow(clippy::too_many_arguments)]
    fn place_spans(&mut self, id: Id, spans: &[Span], paragraph: &Paragraph, content: Bounds<f32>, width: f32, grown: f32, align: f32, mask: ContentMask<f32>, pointer: bool, opacity: f32) {
        let tree = self.tree;
        let line_height = paragraph.line_height;
        let mut pointers: HashMap<Id, bool> = HashMap::from([(id, pointer)]);
        for span in spans {
            let Some(node) = tree.nodes.get(&span.id) else { continue };
            let parent = tree.parent(span.id).unwrap_or(id);
            let pointer = pointers.get(&parent).copied().unwrap_or(pointer) && span.pointer.unwrap_or(true) && !node.is("inert");
            pointers.insert(span.id, pointer);
            let rects: Vec<Bounds<f32>> = paragraph
                .inked(span.start, span.end)
                .into_iter()
                .map(|(line, x0, x1)| {
                    let left = content.origin.x + paragraph.lines.get(line).map_or(0.0, |drawn| (width - drawn.width).max(0.0) * align) * grown;
                    turned(self.turn, Bounds { origin: point(left + x0 * grown, content.origin.y + line as f32 * line_height * grown), size: Size { width: (x1 - x0) * grown, height: line_height * grown } })
                })
                .collect();
            if let Some(all) = rects.iter().copied().reduce(|all, rect| all.union(&rect)) {
                self.out.rects.insert(span.id, Rect { x: all.origin.x, y: all.origin.y, width: all.size.width, height: all.size.height });
            }
            if node.kind != Kind::Text {
                continue;
            }
            let pressable = node.listens("click") && !node.is("disabled") && !node.is("aria-disabled");
            let tabindex = node.prop("tabindex").and_then(|index| index.as_i64().or_else(|| index.as_str()?.parse().ok()));
            if pressable && tabindex.is_some_and(|index| index >= 0) {
                self.out.tab_order.push(span.id);
            }
            for rect in rects {
                let focus = if tabindex.is_some() { Clicked::Takes } else { Clicked::Passes };
                let placed = Placed { parent: Some(parent), shown: rect.intersect(&mask.bounds), opacity, pointer, cursor: span.cursor, pressable, input: false, focus, scroll: None, touch_action: None };
                self.out.placed.push((span.id, placed));
            }
        }
    }
}
