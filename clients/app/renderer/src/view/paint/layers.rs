//! Painting a node, and the layers what only moves is drawn from (`Layer`).

use super::*;

impl Painter<'_> {
    /// Draws node `id`, which is only moving, growing or fading, from its layer: what's in it drawn once as it rests,
    /// then each frame moved, grown and faded as a whole, as Core Animation moves a layer and Flutter a
    /// RepaintBoundary's picture. Nothing in it is laid out, shaped or painted again, and its words move exactly with
    /// their boxes.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::view) fn paint_layer(&mut self, taffy_node: NodeId, id: Id, offset: Point<f32>, transform: Transform, look: &Look, mask: ContentMask<f32>, opacity: f32) {
        let Ok(laid) = self.layout.taffy.layout(taffy_node).copied() else { return };
        let laid_out = Bounds { origin: point(offset.x + laid.location.x, offset.y + laid.location.y), size: Size { width: laid.size.width, height: laid.size.height } };
        let key = LayerKey { size: laid_out.size, device: self.scale };
        // What's in it is painted only as it's first drawn, as it changes size, or each frame as it moves by itself;
        // otherwise it's drawn from what it painted. While something it's in is on its way somewhere, what that does to
        // it (grows it, or moves it by a fraction of a device pixel) is done to its picture, as a compositor does a
        // layer's; under any other than it was painted under, it's painted again, as a picture grown, or moved by a
        // fraction of a pixel, is softer than what it's of. Laid out elsewhere by whole device pixels (a scroll), only
        // its picture moves.
        let scale = self.scale;
        let whole = move |by: f32| (by * scale - (by * scale).round()).abs() < 1e-3;
        let carried = std::iter::successors(self.tree.parent(id), |at| self.tree.parent(*at)).any(|at| self.moving.contains(&at));
        let surfaced = match self.layers.get(&id) {
            Some(layer) if layer.key != key => Surfaced::Relaid,
            Some(layer) if !carried && (layer.scale != transform.scale || ![transform.offset.x - layer.at.x, transform.offset.y - layer.at.y, laid_out.origin.x - layer.laid_out.x, laid_out.origin.y - layer.laid_out.y].into_iter().all(whole)) => Surfaced::Relaid,
            Some(layer) if layer.kept => Surfaced::Kept,
            Some(_) => Surfaced::Animating,
            None => Surfaced::Painted,
        };
        if surfaced != Surfaced::Kept {
            let grouping = std::mem::replace(&mut self.grouping, look.opacity < 1.0);
            let layer = self.record(taffy_node, id, offset, transform, key, laid_out.origin);
            self.grouping = grouping;
            self.layers.insert(id, layer);
        }
        let bytes = self.layers[&id].bytes();
        self.surfaces.bytes += bytes;
        self.surfaces.drawn.insert(id, surfaced);
        // Its own move and growth around its middle, as `paint_node` draws it, in the window, from where it was drawn
        // (`Layer::at`, grown by `Layer::scale`): p ↦ p·grown + by.
        let centre = point(laid_out.origin.x + laid_out.size.width / 2.0, laid_out.origin.y + laid_out.size.height / 2.0);
        let translate = point(look.translate.0.of(laid_out.size.width), look.translate.1.of(laid_out.size.height));
        let (at, k, own) = (transform.offset, transform.scale, look.scale);
        let layer = &self.layers[&id];
        let (was, grown) = (layer.at, k * own / layer.scale);
        // Laid out elsewhere since it was drawn, by `moved`, what's in it is moved as far, grown as it's grown.
        let moved = point(laid_out.origin.x - layer.laid_out.x, laid_out.origin.y - layer.laid_out.y);
        let by = point(
            at.x + k * (centre.x + translate.x - own * centre.x + own * moved.x) - grown * was.x,
            at.y + k * (centre.y + translate.y - own * centre.y + own * moved.y) - grown * was.y,
        );
        self.softened |= carried && (grown != 1.0 || !whole(by.x) || !whole(by.y));
        let opacity = opacity * look.opacity;
        // Cross-dissolving to where it rests, with less motion, it's drawn where it was too, fading out as it fades in
        // here, as UIKit's cross-dissolve draws a snapshot of a view where it was, rather than taken out and brought
        // back, which left the window empty between. What's drawn there takes no pointer, keyboard or place (`Placer`).
        let opacity = match self.transitions.dissolving(id, self.time) {
            Some((from, part)) => {
                self.draw_layer(id, point(by.x + from.x * k, by.y + from.y * k), grown, opacity * (1.0 - part), mask);
                opacity * part
            }
            None => opacity,
        };
        self.draw_layer(id, by, grown, opacity, mask);
    }

    /// Whether another surface fits in the window's: fewer than `SURFACES` so far this frame, whose pictures take less
    /// than `SURFACE_WINDOWS` windows' worth of the GPU's memory; none painted afresh.
    fn room(&self) -> bool {
        let window = 4.0 * self.window.size.width * self.window.size.height * self.scale * self.scale;
        !self.afresh && self.surfaces.drawn.len() < SURFACES && (self.surfaces.bytes as f32) < SURFACE_WINDOWS * window
    }

    /// Draws node `id`'s layer moved by `by` and grown by `grown` (p ↦ p·grown + by), `opacity` as opaque, cut to `mask`.
    fn draw_layer(&mut self, id: Id, by: Point<f32>, grown: f32, opacity: f32, mask: ContentMask<f32>) {
        let scale = self.scale;
        let whole = |at: f32| (at * scale - (at * scale).round()).abs() < 1e-3;
        let moved = |bounds: Bounds<f32>| Bounds { origin: point(bounds.origin.x * grown + by.x, bounds.origin.y * grown + by.y), size: Size { width: bounds.size.width * grown, height: bounds.size.height * grown } };
        for part in self.layers[&id].parts.clone() {
            match part {
                // Where it was drawn, or moved from there by whole device pixels, as it was, it's drawn as what it
                // drew, moved, the same to the pixel as drawn without a layer, so coming to rest there draws nothing
                // again.
                Part::Scene(scene, Some(_)) if grown == 1.0 && opacity == 1.0 && whole(by.x) && whole(by.y) => self.scene.splice(&scene, 1.0, [(by.x * self.scale).round(), (by.y * self.scale).round()], opacity, mask.scale_to(self.scale)),
                Part::Scene(_, Some(tiles)) => self.scene.raster(&tiles, grown, [by.x * self.scale, by.y * self.scale], opacity, mask.scale_to(self.scale)),
                Part::Scene(scene, None) => self.scene.splice(&scene, grown, [by.x * self.scale, by.y * self.scale], opacity, mask.scale_to(self.scale)),
                Part::Sublayer(sublayer) => {
                    let transform = Transform { offset: point(sublayer.transform.offset.x * grown + by.x, sublayer.transform.offset.y * grown + by.y), scale: sublayer.transform.scale * grown, rest: sublayer.transform.rest };
                    // Turned about a point in the layer, it's turned about where that point is now, as
                    // `Scene::splice` turns what it moves: p ↦ A·p + (grown·t + by − A·by).
                    let ([[a, b], [c, d]], [x, y]) = (sublayer.turn.rotation_scale, sublayer.turn.translation);
                    let turn = std::mem::replace(&mut self.turn, TransformationMatrix { rotation_scale: sublayer.turn.rotation_scale, translation: [x * grown + by.x - (a * by.x + b * by.y), y * grown + by.y - (c * by.x + d * by.y)] });
                    self.paint(sublayer.taffy_node, sublayer.offset, transform, ContentMask { bounds: moved(sublayer.mask.bounds), corner_radii: sublayer.mask.map(|length| length * grown).corner_radii }.intersect(&mask), sublayer.opacity * opacity);
                    self.turn = turn;
                }
            }
        }
    }

    /// What node `id` draws as it rests, everywhere, not cut to what it's in: its own scene, and what's in it that's a
    /// layer of its own.
    pub(in crate::view) fn record(&mut self, taffy_node: NodeId, id: Id, offset: Point<f32>, transform: Transform, key: LayerKey, laid_out: Point<f32>) -> Layer {
        let mut scene = Scene::default();
        std::mem::swap(&mut *self.scene, &mut scene);
        let (animating, parts) = (std::mem::take(&mut self.animating), std::mem::take(&mut self.parts));
        self.recording = Some(id);
        let everywhere = Bounds { origin: point(-1.0e6, -1.0e6), size: Size { width: 2.0e6, height: 2.0e6 } };
        self.paint(taffy_node, offset, transform, ContentMask::from(everywhere), 1.0);
        self.recording = None;
        std::mem::swap(&mut *self.scene, &mut scene);
        // What moves by itself or shows another frame's page changes as it's drawn: it's drawn afresh each frame, so
        // it's no image, which would be drawn afresh too.
        let tree = self.tree;
        let kept = !self.animating && !tree.preorder(id).any(|inside| tree.nodes.get(&inside).is_some_and(|node| node.kind == Kind::Frame));
        let mut drawn = std::mem::replace(&mut self.parts, parts);
        scene.sort();
        drawn.push(Part::Scene(std::sync::Arc::new(scene), None));
        // A group faded as one is a picture even while what's in it moves, drawn again each frame it does, since what
        // it draws is faded as a whole.
        let pictures = kept || self.grouping;
        for (at, part) in drawn.iter_mut().enumerate() {
            if let Part::Scene(scene, image) = part {
                *image = pictures.then(|| pictured(scene, picture(id, at))).flatten();
            }
        }
        self.animating |= animating;
        Layer { key, laid_out, at: transform.offset, scale: transform.scale, kept, grouped: self.grouping, parts: drawn }
    }

    /// Paints `node` with its parent's top left at `offset` in its layout, drawn through `transform` and turned as
    /// what it's in is, clipped to `mask` (in the window), `opacity` as opaque as it shows.
    pub(in crate::view) fn paint(&mut self, taffy_node: NodeId, offset: Point<f32>, transform: Transform, mask: ContentMask<f32>, opacity: f32) {
        let turn = self.turn;
        self.paint_node(taffy_node, offset, transform, mask, opacity);
        self.turn = turn;
    }

    /// Paints what's in a stacking context where it'd have been drawn, turned as it was.
    fn paint_stacked(&mut self, stacked: Stacked) {
        let turn = std::mem::replace(&mut self.turn, stacked.turn);
        self.paint(stacked.taffy_node, stacked.offset, stacked.transform, stacked.mask, stacked.opacity);
        self.turn = turn;
    }

    pub(in crate::view) fn paint_node(&mut self, taffy_node: NodeId, offset: Point<f32>, transform: Transform, mask: ContentMask<f32>, opacity: f32) {
        let Ok(laid) = self.layout.taffy.layout(taffy_node).copied() else { return };
        // What isn't displayed isn't drawn, and nothing in it is.
        if self.layout.taffy.style(taffy_node).is_ok_and(|style| style.display == taffy::style::Display::None) {
            return;
        }
        let Some(leaf) = self.layout.taffy.get_node_context(taffy_node) else { return };
        let (id, text, mut look) = (leaf.id, leaf.text, leaf.look.clone());
        let words = matches!(self.tree.nodes[&id].kind, Kind::Text | Kind::RawText);
        // Faded with something in it, it's a group drawn as one and then faded, as CSS's `opacity` is, so what's over
        // something else in it hides it: never each thing in it faded on its own, which showed a window's words through
        // the window over them as a picture faded in (Andre's iPhone, 23 Nov). A word alone draws the same either way.
        // It's how it looks, not a saving, so it's one in a frame drawn afresh too, and whatever room surfaces have.
        let grouped = self.recording.is_none() && look.opacity > 0.0 && look.opacity < 1.0 && !words && self.tree.preorder(id).nth(1).is_some();
        // Starting to cross-dissolve, where it rests changed in this frame: it's drawn where it was, as it is, and from
        // the next, from its layer there and where it rests (`paint_layer`).
        let dissolving = self.transitions.dissolving(id, self.time).filter(|_| self.recording.is_none());
        let starting = dissolving.is_some_and(|(_, part)| part == 0.0);
        let transform = match dissolving {
            Some((from, _)) if starting => Transform { offset: point(transform.offset.x + from.x * transform.scale, transform.offset.y + from.y * transform.scale), ..transform },
            _ => transform,
        };
        if self.recording == Some(id) {
            // Its layer is drawn as it rests, and moved, grown and faded as it's drawn from it.
            (look.translate, look.scale, look.rest_scale, look.opacity) = ((Offset::Px(0.0), Offset::Px(0.0)), 1.0, 1.0, 1.0);
        } else if self.recording.is_some() && self.layered.contains(&id) && self.turn != TransformationMatrix::unit() {
            // Turned in the layer being drawn, it's drawn in it as usual, which is drawn again each frame.
            self.animating = true;
        } else if self.recording.is_some() && !self.grouping && (self.layered.contains(&id) || (words && !crate::mutants::mutant("text-stretched"))) {
            // (Mutant: a text in a layer drawn from the layer's picture, grown and moved with it, as before fb657c5ce.)
            // A layer of its own in the one being drawn: drawn into it each frame, where that's moved it. So is a text,
            // turned with what it's in or not, its glyphs drawn where they are, at the size they are, as sharp moving as
            // at rest, as SwiftUI draws a text moved and grown: a picture of them grown or moved by a fraction of a
            // pixel is softer, and snapped sharp as it landed. In the order it was drawn, as its image draws its
            // batches (`recording`).
            let mut scene = std::mem::take(&mut *self.scene);
            scene.sort();
            self.parts.push(Part::Scene(std::sync::Arc::new(scene), None));
            self.parts.push(Part::Sublayer(Sublayer { taffy_node, offset, transform, mask, opacity, turn: self.turn }));
            return;
        } else if (self.layered.contains(&id) && self.room() || grouped || dissolving.is_some()) && !starting && self.turn == TransformationMatrix::unit() && (look.animation.is_none() || grouped) && !crate::mutants::mutant("faded-apart") {
            // Cross-dissolving, it's drawn from its picture in two places, which drawn in what it's in it couldn't be:
            // it's a surface whatever the window's others take.
            return self.paint_layer(taffy_node, id, offset, transform, &look, mask, opacity);
        }
        let tree = self.tree;
        let node = &tree.nodes[&id];
        // On its way from where it was laid out, its box is drawn between, and what's in it moves with it; and it's
        // moved and grown around its middle, which moves nothing around it, and turned around it, with what's in it.
        let placement = Placement::of(&laid, offset, transform, &look, self.transitions.flip(id, self.time));
        let (bounds, content, transform) = (placement.bounds, placement.content, placement.transform);
        let opacity = opacity * look.opacity;
        self.turn = placement.turn(&look, self.turn);
        let radii = placement.radii(&look);
        let scaled = |edges: Edges<f32>| Edges { top: edges.top * transform.scale, right: edges.right * transform.scale, bottom: edges.bottom * transform.scale, left: edges.left * transform.scale };
        // Shadows under it, the first nearest, then what shows through it, its fill and border, then shadows inside.
        if id != 0 {
            // The system's own glass is a pane of its own under the page, which can't fade: what's fading is drawn
            // with the renderer's own, which does, as it goes (an owner pill fading off with its pages). Its pane is a
            // window, which the system shadows, so the page draws no shadow of its own under it, which its window
            // would clip to a square box.
            let system = matches!(look.material, Some((_, _, true))) && self.glass && opacity >= 1.0;
            for shadow in look.shadows.iter().rev().filter(|shadow| !shadow.inset && !system) {
                self.shadow(shadow, bounds, radii, transform.scale, mask, opacity);
            }
            if system {
                if let Some(fill) = self.fill {
                    self.quad(bounds, mask, fill, Edges::default(), Hsla::default(), radii, false, opacity);
                }
            } else if let Some((blur, saturate, _)) = look.material.filter(|(blur, ..)| opacity > 0.0 && *blur > 0.0) {
                // Faded all the way out, nothing of it shows, so nothing behind it is blurred.
                self.scene.insert_primitive(Backdrop {
                    order: 0,
                    opacity,
                    blur: ScaledPixels(blur * transform.scale * self.scale),
                    saturation: saturate,
                    bounds: bounds.scale_to(self.scale),
                    content_mask: mask.scale_to(self.scale),
                    corner_radii: Corners {
                        top_left: ScaledPixels(radii.top_left * self.scale),
                        top_right: ScaledPixels(radii.top_right * self.scale),
                        bottom_right: ScaledPixels(radii.bottom_right * self.scale),
                        bottom_left: ScaledPixels(radii.bottom_left * self.scale),
                    },
                });
            }
            self.fill(bounds, mask, look.background.unwrap_or_default(), scaled(look.borders), look.border_color, radii, look.dashed, opacity);
            if let Some(gradient) = &look.background_image {
                self.paint_gradient(gradient, bounds, radii, text.color, opacity, mask);
            }
            for shadow in look.shadows.iter().rev().filter(|shadow| shadow.inset) {
                self.shadow(shadow, bounds, radii, transform.scale, mask, opacity);
            }
        }
        match node.kind {
            Kind::Text | Kind::RawText => {
                let width = laid.content_box_width().max(1.0);
                let wrapped = self.layout.paragraph(taffy_node, self.text);
                let paragraph = wrapped.1.clone();
                let leaf = self.layout.taffy.get_node_context_mut(taffy_node).expect("every node has its leaf");
                leaf.paragraph = Some(wrapped);
                let (words, runs) = match &leaf.measure {
                    Some(Measure::Text { words, runs, .. }) => (words.clone(), runs.clone()),
                    _ => (String::new(), Vec::new()),
                };
                // Selectable, it's kept as it's drawn, and what's selected of it is tinted behind its words.
                if text.selectable {
                    let shown = super::super::selection::Shown { paragraph: paragraph.clone(), words, content, width, grown: transform.scale, align: text.align };
                    if let Some((_, (start, end))) = self.selected.filter(|(on, (start, end))| *on == id && start < end) {
                        let (tint, line_height) = (colour_token("blue", self.conditions).opacity(0.3), paragraph.line_height * transform.scale);
                        for (line, x0, x1) in paragraph.spans(start, end) {
                            let bounds = Bounds { origin: point(shown.left(line) + x0 * transform.scale, content.origin.y + line as f32 * line_height), size: Size { width: (x1 - x0) * transform.scale, height: line_height } };
                            self.quad(bounds, mask, tint, Edges::default(), Hsla::default(), Corners::default(), false, opacity);
                        }
                    }
                    self.texts.insert(id, shown);
                } else {
                    self.texts.remove(&id);
                }
                // Words that don't show aren't drawn: their lines start at its content's left and run on to the right.
                let size = paragraph.size();
                let covers = Bounds { origin: content.origin, size: Size { width: size.width.max(width) * transform.scale, height: size.height * transform.scale } };
                if self.turned(covers).intersects(&mask.bounds) && self.turned(covers).intersects(&self.shows) {
                    self.paint_text(&paragraph, &runs, content, width, transform.scale, text, opacity, mask);
                }
            }
            Kind::Input => self.paint_input(id, node, content, placement.padding, laid.content_box_width(), transform.scale, text, opacity, mask),
            Kind::Image => self.paint_image(node, content, transform, radii, opacity, mask),
            Kind::Path => self.paint_path(node, content, &look, text.color, opacity, mask),
            // Its latest frame, as the web's browser plays it, or as its connection decoded it natively.
            Kind::Video => self.paint_video(id, content, radii, opacity, mask),
            Kind::Picker => {}
            // A frame's page, drawn as it last drew itself, in its box, where the frame comes in this scene's order.
            Kind::Frame => {
                if let Some(child) = self.frames.get(&id) {
                    let shown = self.turned(bounds).intersect(&mask.bounds).intersect(&content);
                    self.scene.splice(&child.scene, 1.0, [content.origin.x * self.scale, content.origin.y * self.scale], 1.0, mask.intersect(&ContentMask::from(shown)).scale_to(self.scale));
                }
            }
            Kind::Box | Kind::Scroll | Kind::List => {
                let mut child_mask = mask;
                let mut child_offset = placement.laid_out.origin;
                // What scrolls in it, where it's longer than it, is a surface of its own, drawn from tiles (`surface`),
                // where it's drawn ungrown and unturned and not in a layer being drawn (whose texts, drawn each frame
                // where they are outside the surface, would go uncut by its box: a card's list showed its rows past it):
                // painted, not cut to what shows, into a scene of its own, which is put back once it's painted, its
                // texts only those in the tiles that show. (Mutant: one in a layer being drawn a surface too.)
                let mut surface = None;
                if look.clips || look.scrolls {
                    child_mask = placement.clip(&look, mask, self.turn);
                    if look.scrolls {
                        let at = |of: &HashMap<Id, Point<f32>>| of.get(&id).copied().unwrap_or(point(0.0, 0.0));
                        let (most, now, by) = scroll(&laid, at(self.scrolled), at(&self.stretched), self.scale);
                        self.scrolled.insert(id, now);
                        child_offset = point(child_offset.x - by.x, child_offset.y - by.y);
                        if (most.x > 0.0 || most.y > 0.0) && transform.scale == 1.0 && self.turn == TransformationMatrix::unit() && (self.recording.is_none() || crate::mutants::mutant("surface-in-layer")) && self.room() {
                            let (at, area, tiles) = self.tiles_shown(child_mask, child_offset);
                            surface = Some((std::mem::take(&mut *self.scene), child_mask, at, area, std::mem::replace(&mut self.shows, tiles)));
                            child_mask = ContentMask::from(Bounds { origin: point(-1.0e6, -1.0e6), size: Size { width: 2.0e6, height: 2.0e6 } });
                        }
                    }
                }
                // Its children in CSS's painting order (`painted_children`). What's positioned or says its `zIndex` is
                // drawn after its stacking context's flow, by `zIndex` and then the tree's order, as its stacking
                // context's: this one's, where it makes one, or what it's in's (`Painter::stacked`).
                // What a layer is drawn of is a stacking context however it rests (its look's fade and move are its
                // layer's, not drawn here), so what's positioned in it is in its picture, never drawn outside it,
                // unfaded, as a faded group's absolute parts were.
                let context = stacks(id, &look, self.layout.leaf(taffy_node).fixed, self.layered) || self.recording == Some(id);
                let outer = context.then(|| std::mem::take(&mut self.stacked));
                for (at, child, z) in painted_children(self.layout, taffy_node) {
                    let leaf = self.layout.leaf(child);
                    let stacked = Stacked {
                        taffy_node: child,
                        offset: if leaf.fixed { point(0.0, 0.0) } else { child_offset },
                        transform: if leaf.fixed { Transform::NONE } else { transform },
                        mask: if leaf.fixed { ContentMask::from(self.window) } else { child_mask },
                        opacity: if leaf.fixed { 1.0 } else { opacity },
                        turn: self.turn,
                    };
                    self.path.push(at);
                    if later(leaf, z) {
                        self.stacked.insert((z, self.path.clone()), stacked);
                    } else {
                        self.paint_stacked(stacked);
                    }
                    self.path.pop();
                }
                if let Some(outer) = outer {
                    while let Some(((_, path), stacked)) = self.stacked.pop_first() {
                        let path = std::mem::replace(&mut self.path, path);
                        self.paint_stacked(stacked);
                        self.path = path;
                    }
                    self.stacked = outer;
                }
                if let Some((outer, clip, at, area, shows)) = surface {
                    // What's in it that's drawn after its stacking context's flow, outside it, isn't in the surface: it's
                    // drawn where it is, cut to what it's in.
                    for ((_, path), stacked) in &mut self.stacked {
                        if path.starts_with(&self.path) {
                            stacked.mask = stacked.mask.intersect(&clip);
                        }
                    }
                    let content = std::mem::replace(&mut *self.scene, outer);
                    self.shows = shows;
                    self.surface(id, content, clip, at, area);
                }
            }
        }
    }

    /// Of a surface whose content's top left is at `origin` in the window, cut to `clip`: the whole device pixel its
    /// tiles are laid from, where nothing it draws changes as it scrolls (whole device pixels, `scroll`); what of it
    /// shows, in its device pixels from there; and the tiles that reaches, in the window.
    fn tiles_shown(&self, clip: ContentMask<f32>, origin: Point<f32>) -> ([f32; 2], [f32; 4], Bounds<f32>) {
        let scale = self.scale;
        let at = [(origin.x * scale).round(), (origin.y * scale).round()];
        let shown = clip.bounds.intersect(&self.shows);
        let area = [(shown.origin.x * scale - at[0]).floor(), (shown.origin.y * scale - at[1]).floor(), ((shown.origin.x + shown.size.width) * scale - at[0]).ceil(), ((shown.origin.y + shown.size.height) * scale - at[1]).ceil()];
        let side = TILE as f32;
        let [left, top] = [(area[0] / side).floor() * side - 1.0, (area[1] / side).floor() * side - 1.0];
        let [right, bottom] = [(area[2] / side).ceil() * side + 1.0, (area[3] / side).ceil() * side + 1.0];
        (at, area, Bounds { origin: point((left + at[0]) / scale, (top + at[1]) / scale), size: Size { width: (right - left) / scale, height: (bottom - top) / scale } })
    }

    /// Draws `content`, what scrolls in node `id`, painted where it is now, as a surface of its own (`Surfaced::Painted`)
    /// cut to `clip`: its tiles in its own device pixels, from `at` in the window's (`tiles_shown`), those that show
    /// (`area`) drawn where it's scrolled to, so a frame that scrolls it draws again only the tiles that came in. What's
    /// a surface in it (a layer, a box that scrolls) is drawn over them where it comes (`Scene::runs`), not into them,
    /// so one moving, fading or scrolling draws none of them again. One that blurs what's behind it is drawn in what
    /// it's in.
    fn surface(&mut self, id: Id, content: Scene, clip: ContentMask<f32>, at: [f32; 2], area: [f32; 4]) {
        let mask = clip.scale_to(self.scale);
        if !content.backdrops.is_empty() {
            return self.scene.splice(&content, 1.0, [0.0, 0.0], 1.0, mask);
        }
        // Cut to a box of its own pixels, inside everywhere it was painted (cut to nothing), so what that cuts it to is
        // the same wherever it's scrolled.
        let own = Bounds { origin: point(ScaledPixels(-5.0e5), ScaledPixels(-5.0e5)), size: Size { width: ScaledPixels(1.0e6), height: ScaledPixels(1.0e6) } };
        let mut unscrolled = Scene::default();
        unscrolled.splice(&content, 1.0, [-at[0], -at[1]], 1.0, own.into());
        unscrolled.sort();
        self.surfaces.drawn.insert(id, Surfaced::Painted);
        for (at_run, (run, over)) in unscrolled.runs().into_iter().enumerate() {
            let tiles = tiled(&std::sync::Arc::new(run), [0.0, 0.0], area, picture(id, at_run));
            self.surfaces.bytes += tile_bytes(&tiles);
            self.scene.raster(&tiles, 1.0, at, 1.0, mask);
            for mut raster in over {
                raster.bounds.origin.x.0 += at[0];
                raster.bounds.origin.y.0 += at[1];
                raster.content_mask.bounds.origin.x.0 += at[0];
                raster.content_mask.bounds.origin.y.0 += at[1];
                raster.content_mask = raster.content_mask.intersect(&mask);
                self.scene.insert_primitive(raster);
            }
        }
        for tile in &content.tiles {
            if !self.scene.tiles.iter().any(|kept| kept.id == tile.id) {
                self.scene.tiles.push(tile.clone());
            }
        }
    }
}
