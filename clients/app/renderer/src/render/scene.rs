// Copied from Zed's GPUI (github.com/zed-industries/zed, crates/gpui/src/scene.rs) at commit
// 69e2130295c2649963eb639fc70b4f2ee8ea1624 (gpui 0.2.2 on crates.io), and cut down for the native host: the scene a
// frame draws, of quads, shadows, underlines and sprites, without paths, surfaces or layers, and with backdrops, what's
// behind a node blurred, inset shadows, and a transformation on quads, shadows and images as on text, which are ours.
// Copyright 2022 - 2025 Zed Industries, Inc. Licensed under the Apache License, Version 2.0
// (clients/app/renderer/LICENSE-APACHE); this file is changed from the original.

use std::{iter::Peekable, slice};

use super::atlas::{AtlasTextureId, AtlasTile};
use super::bounds_tree::BoundsTree;
use crate::geometry::{Bounds, ContentMask, Corners, Edges, Hsla, ScaledPixels};

pub(crate) type DrawOrder = u32;

#[derive(Default, Clone)]
pub struct Scene {
    primitive_bounds: BoundsTree<ScaledPixels>,
    pub(crate) shadows: Vec<Shadow>,
    pub(crate) quads: Vec<Quad>,
    pub(crate) underlines: Vec<Underline>,
    pub(crate) monochrome_sprites: Vec<MonochromeSprite>,
    pub(crate) polychrome_sprites: Vec<PolychromeSprite>,
    pub(crate) backdrops: Vec<Backdrop>,
    pub(crate) rasters: Vec<Raster>,
    /// What each of its rasters is of, by its id: a tile of a picture (`Tile`), drawn once by the renderer.
    pub(crate) tiles: Vec<Tile>,
}

/// The side of a tile, in device pixels: a picture (a layer's, a scroll box's content) is a grid of them, in its own
/// pixels, each drawn whole into the renderer's tiles as what touches it changes, as WebRender's picture cache and
/// Chromium's tiles are.
pub(crate) const TILE: u32 = 254;

/// A tile of a picture (`tiled`): the square `TILE` device pixels from `origin` in `scene`, with a device pixel round
/// it so what's drawn from it grown blends into the next as one image would, by its id, a hash of where it is and of
/// what in `scene` touches it; where it is (`key`: which picture's, and where in it), by which one that changed is drawn
/// again only where it did; and the part of it a raster shows, left, top, right and bottom in the tile, what of the
/// picture it's in.
#[derive(Clone)]
pub(crate) struct Tile {
    pub id: u64,
    pub key: u64,
    pub scene: std::sync::Arc<Scene>,
    pub origin: [f32; 2],
    pub shown: [u32; 4],
}

/// The tiles of `scene` that `area` reaches (whole device pixels, in the scene's), on a grid from `origin` (whole
/// device pixels), each with something in it: each its id, a hash of where it is and what touches it in the order it's
/// drawn, by which a tile is drawn again only where that changed and a picture drawn again as it was is drawn nothing.
pub(crate) fn tiled(scene: &std::sync::Arc<Scene>, origin: [f32; 2], area: [f32; 4], key: u64) -> Vec<Tile> {
    use std::hash::{Hash, Hasher};
    let side = TILE as f32;
    let index = |at: f32, from: f32| ((at - from) / side).floor() as i32;
    let (first, last) = ([index(area[0], origin[0]), index(area[1], origin[1])], [index(area[2] - 1.0, origin[0]), index(area[3] - 1.0, origin[1])]);
    let mut touched: std::collections::BTreeMap<(i32, i32), std::collections::hash_map::DefaultHasher> = Default::default();
    for batch in scene.batches() {
        for (at, extent) in batch.extents().into_iter().enumerate() {
            if extent.is_empty() {
                continue;
            }
            // With the pixel round each tile.
            let (left, top) = (index(extent.origin.x.0 - 1.0, origin[0]).max(first[0]), index(extent.origin.y.0 - 1.0, origin[1]).max(first[1]));
            let (right, bottom) = (index(extent.origin.x.0 + extent.size.width.0 + 1.0, origin[0]).min(last[0]), index(extent.origin.y.0 + extent.size.height.0 + 1.0, origin[1]).min(last[1]));
            let print = batch.print(at);
            for y in top..=bottom {
                for x in left..=right {
                    let hasher = touched.entry((x, y)).or_insert_with(|| {
                        let mut hasher = std::collections::hash_map::DefaultHasher::new();
                        (x, y, origin.map(f32::to_bits)).hash(&mut hasher);
                        hasher
                    });
                    print.hash(hasher);
                }
            }
        }
    }
    touched
        .into_iter()
        .map(|((x, y), hasher)| {
            let at = [origin[0] + x as f32 * side, origin[1] + y as f32 * side];
            let edge = |edge: f32, from: f32| (edge - from).clamp(0.0, side) as u32;
            let mut place = std::collections::hash_map::DefaultHasher::new();
            (key, x, y).hash(&mut place);
            Tile { id: hasher.finish(), key: place.finish(), scene: scene.clone(), origin: at, shown: [edge(area[0], at[0]), edge(area[1], at[1]), edge(area[2], at[0]), edge(area[3], at[1])] }
        })
        .collect()
}

impl Scene {
    pub fn clear(&mut self) {
        self.primitive_bounds.clear();
        self.shadows.clear();
        self.quads.clear();
        self.underlines.clear();
        self.monochrome_sprites.clear();
        self.polychrome_sprites.clear();
        self.backdrops.clear();
        self.rasters.clear();
        self.tiles.clear();
    }

    pub(crate) fn insert_primitive(&mut self, primitive: impl Into<Primitive>) {
        self.place(primitive.into(), None);
    }

    /// Draws `primitive` over what it holds: at `order` where it's said (what it's moved from was in order already),
    /// else after what it overlaps.
    fn place(&mut self, mut primitive: Primitive, order: Option<DrawOrder>) {
        // What it's cut to has its edges on whole device pixels, half up, as browsers snap a clip: a pixel is in it where
        // its middle is, and an edge through a row of middles (a list's at 674.5) kept or cut that row by how the GPU's
        // arithmetic rounded, otherwise wherever it's moved (a generated scene, `animation.js --generated 1 --from 1`).
        let mask = primitive.content_mask_mut();
        let edge = |at: f32| ScaledPixels((at + 0.5).floor());
        let bounds = mask.bounds;
        let (left, top) = (edge(bounds.origin.x.0), edge(bounds.origin.y.0));
        let (right, bottom) = (edge(bounds.origin.x.0 + bounds.size.width.0), edge(bounds.origin.y.0 + bounds.size.height.0));
        mask.bounds = Bounds { origin: crate::geometry::Point { x: left, y: top }, size: crate::geometry::Size { width: ScaledPixels(right.0 - left.0), height: ScaledPixels(bottom.0 - top.0) } };
        let clipped_bounds = primitive.bounds().intersect(&primitive.content_mask().bounds);
        if clipped_bounds.is_empty() || primitive.shows_nothing() {
            return;
        }
        let order = order.unwrap_or_else(|| self.primitive_bounds.insert(clipped_bounds));
        match &mut primitive {
            Primitive::Shadow(shadow) => {
                shadow.order = order;
                self.shadows.push(shadow.clone());
            }
            Primitive::Quad(quad) => {
                quad.order = order;
                self.quads.push(quad.clone());
            }
            Primitive::Underline(underline) => {
                underline.order = order;
                self.underlines.push(underline.clone());
            }
            Primitive::MonochromeSprite(sprite) => {
                sprite.order = order;
                self.monochrome_sprites.push(sprite.clone());
            }
            Primitive::PolychromeSprite(sprite) => {
                sprite.order = order;
                self.polychrome_sprites.push(sprite.clone());
            }
            Primitive::Backdrop(backdrop) => {
                backdrop.order = order;
                self.backdrops.push(backdrop.clone());
            }
            Primitive::Raster(raster) => {
                raster.order = order;
                self.rasters.push(raster.clone());
            }
        }
    }

    /// Draws raster `id`'s image (`Renderer::picture`) over `bounds`, `opacity` as opaque, over what's drawn there.
    pub fn picture(&mut self, id: u64, bounds: Bounds<ScaledPixels>, opacity: f32) {
        let transformation = TransformationMatrix::unit();
        self.insert_primitive(Raster { order: 0, opacity, raster: id, bounds, content_mask: ContentMask::from(bounds), transformation, slot: Bounds::default() });
    }

    /// Draws a picture's `tiles` (`tiled`) in this scene as images of them, each drawn once, grown `scale` times and
    /// moved `by` (`p ↦ p·scale + by`), `opacity` as opaque, and cut to `mask`, as a compositor draws a layer: as
    /// `splice` draws what they're of, and as cheaply as a picture of what each shows however much is in it.
    pub(crate) fn raster(&mut self, tiles: &[Tile], scale: f32, by: [f32; 2], opacity: f32, mask: ContentMask<ScaledPixels>) {
        for tile in tiles {
            let [left, top, right, bottom] = tile.shown.map(|edge| edge as f32);
            let origin = crate::geometry::Point { x: ScaledPixels((tile.origin[0] + left) * scale + by[0]), y: ScaledPixels((tile.origin[1] + top) * scale + by[1]) };
            let bounds = Bounds::new(origin, crate::geometry::Size { width: ScaledPixels((right - left) * scale), height: ScaledPixels((bottom - top) * scale) });
            let shown = Bounds::new(crate::geometry::Point { x: ScaledPixels(left), y: ScaledPixels(top) }, crate::geometry::Size { width: ScaledPixels(right - left), height: ScaledPixels(bottom - top) });
            // Unseen, it isn't drawn, but its image is still made, ahead of its showing.
            if opacity > 0.0 {
                self.insert_primitive(Raster { order: 0, opacity, raster: tile.id, bounds, content_mask: mask, transformation: TransformationMatrix::unit(), slot: shown });
            }
            // What's drawn in it as images is drawn into their tiles before it.
            for inner in tile.scene.tiles.iter().chain([tile]) {
                if !self.tiles.iter().any(|kept| kept.id == inner.id) {
                    self.tiles.push(inner.clone());
                }
            }
        }
    }

    /// Each thing it draws in `area`, in order: what it is (`PrimitiveBatch::print`) and where, in whole device pixels
    /// from `area`'s top left, within it; as a tile drawn from it is told what changed in it (`damage`).
    pub(crate) fn prints(&self, area: Bounds<ScaledPixels>) -> Vec<(u64, [u32; 4])> {
        let edge = |at: f32, from: f32, most: f32, up: bool| (if up { (at - from).ceil() } else { (at - from).floor() }).clamp(0.0, most) as u32;
        let (width, height) = (area.size.width.0, area.size.height.0);
        self.batches()
            .flat_map(|batch| batch.extents().into_iter().enumerate().filter(|(_, extent)| extent.intersects(&area)).map(move |(at, extent)| (batch.print(at), extent)))
            .map(|(print, extent)| {
                let (x, y) = (area.origin.x.0, area.origin.y.0);
                (print, [edge(extent.origin.x.0, x, width, false), edge(extent.origin.y.0, y, height, false), edge(extent.origin.x.0 + extent.size.width.0, x, width, true), edge(extent.origin.y.0 + extent.size.height.0, y, height, true)])
            })
            .collect()
    }

    /// What it draws, in order, as runs of what isn't an image, each a scene of its own, with the images drawn after each
    /// (its rasters): a surface's content, whose surfaces in it are drawn over its tiles, each where it comes, not into
    /// them, as WebRender cuts its picture cache into slices at what's composited on its own.
    pub(crate) fn runs(&self) -> Vec<(Scene, Vec<Raster>)> {
        let cuts: Vec<DrawOrder> = self.rasters.iter().map(|raster| raster.order).collect();
        let run = |order: DrawOrder| cuts.partition_point(|cut| *cut < order);
        let mut runs: Vec<(Scene, Vec<Raster>)> = (0..=cuts.len()).map(|_| Default::default()).collect();
        self.shadows.iter().for_each(|one| runs[run(one.order)].0.shadows.push(one.clone()));
        self.quads.iter().for_each(|one| runs[run(one.order)].0.quads.push(one.clone()));
        self.underlines.iter().for_each(|one| runs[run(one.order)].0.underlines.push(one.clone()));
        self.monochrome_sprites.iter().for_each(|one| runs[run(one.order)].0.monochrome_sprites.push(one.clone()));
        self.polychrome_sprites.iter().for_each(|one| runs[run(one.order)].0.polychrome_sprites.push(one.clone()));
        self.backdrops.iter().for_each(|one| runs[run(one.order)].0.backdrops.push(one.clone()));
        for (at, raster) in self.rasters.iter().enumerate() {
            runs[at].1.push(raster.clone());
        }
        runs
    }

    /// Where everything it draws is, in device pixels, a shadow's blur and all: what a raster of it covers.
    pub(crate) fn extent(&self) -> Option<Bounds<ScaledPixels>> {
        let grown = |shadow: &Shadow| {
            let (margin, bounds) = (3.0 * shadow.blur_radius.0, shadow.bounds);
            Bounds::new(
                crate::geometry::Point { x: ScaledPixels(bounds.origin.x.0 - margin), y: ScaledPixels(bounds.origin.y.0 - margin) },
                crate::geometry::Size { width: ScaledPixels(bounds.size.width.0 + 2.0 * margin), height: ScaledPixels(bounds.size.height.0 + 2.0 * margin) },
            )
        };
        let all = self
            .shadows
            .iter()
            .map(grown)
            .chain(self.quads.iter().map(|one| one.bounds))
            .chain(self.underlines.iter().map(|one| one.bounds))
            .chain(self.monochrome_sprites.iter().map(|one| one.bounds))
            .chain(self.polychrome_sprites.iter().map(|one| one.bounds))
            .chain(self.rasters.iter().map(|one| one.bounds));
        all.reduce(|a, b| a.union(&b))
    }

    /// Draws what `other` holds in this scene, in the order it was drawn there, grown `scale` times and moved `by`
    /// (`p ↦ p·scale + by`), `opacity` as opaque, and cut to `mask`: as a frame's page is drawn in its box, and as a
    /// layer kept from an earlier frame (`view::Layer`) is drawn where it's moved, grown or faded to now.
    pub fn splice(&mut self, other: &Scene, scale: f32, by: [f32; 2], opacity: f32, mask: ContentMask<ScaledPixels>) {
        let px = |length: ScaledPixels| ScaledPixels(length.0 * scale);
        let moved = |bounds: &Bounds<ScaledPixels>| {
            let origin = crate::geometry::Point { x: ScaledPixels(bounds.origin.x.0 * scale + by[0]), y: ScaledPixels(bounds.origin.y.0 * scale + by[1]) };
            Bounds::new(origin, crate::geometry::Size { width: px(bounds.size.width), height: px(bounds.size.height) })
        };
        let corners = |radii: &Corners<ScaledPixels>| Corners { top_left: px(radii.top_left), top_right: px(radii.top_right), bottom_right: px(radii.bottom_right), bottom_left: px(radii.bottom_left) };
        let masked = |content: &ContentMask<ScaledPixels>| ContentMask { bounds: moved(&content.bounds), corner_radii: corners(&content.corner_radii) }.intersect(&mask);
        let faded = |colour: Hsla| Hsla { a: colour.a * opacity, ..colour };
        // What was turned about a point there is turned about where that point is here: p ↦ A·p + (scale·t + by − A·by).
        let turned = |matrix: &TransformationMatrix| {
            let [[a, b], [c, d]] = matrix.rotation_scale;
            let [x, y] = matrix.translation;
            TransformationMatrix { rotation_scale: matrix.rotation_scale, translation: [x * scale + by[0] - (a * by[0] + b * by[1]), y * scale + by[1] - (c * by[0] + d * by[1])] }
        };
        let mut all: Vec<(DrawOrder, Primitive)> = Vec::new();
        all.extend(other.shadows.iter().map(|shadow| {
            let mut shadow = shadow.clone();
            (shadow.bounds, shadow.outer, shadow.content_mask, shadow.transformation) = (moved(&shadow.bounds), moved(&shadow.outer), masked(&shadow.content_mask), turned(&shadow.transformation));
            (shadow.corner_radii, shadow.outer_radii, shadow.blur_radius, shadow.color) = (corners(&shadow.corner_radii), corners(&shadow.outer_radii), px(shadow.blur_radius), faded(shadow.color));
            (shadow.order, shadow.into())
        }));
        all.extend(other.quads.iter().map(|quad| {
            let mut quad = quad.clone();
            (quad.bounds, quad.content_mask, quad.transformation) = (moved(&quad.bounds), masked(&quad.content_mask), turned(&quad.transformation));
            (quad.corner_radii, quad.border_color) = (corners(&quad.corner_radii), faded(quad.border_color));
            let widths = quad.border_widths;
            quad.border_widths = crate::geometry::Edges { top: px(widths.top), right: px(widths.right), bottom: px(widths.bottom), left: px(widths.left) };
            quad.background = faded(quad.background);
            (quad.order, quad.into())
        }));
        all.extend(other.underlines.iter().map(|underline| {
            let mut underline = underline.clone();
            (underline.bounds, underline.content_mask, underline.thickness, underline.color) = (moved(&underline.bounds), masked(&underline.content_mask), px(underline.thickness), faded(underline.color));
            (underline.order, underline.into())
        }));
        all.extend(other.monochrome_sprites.iter().map(|sprite| {
            let mut sprite = sprite.clone();
            (sprite.bounds, sprite.content_mask, sprite.transformation, sprite.color) = (moved(&sprite.bounds), masked(&sprite.content_mask), turned(&sprite.transformation), faded(sprite.color));
            (sprite.order, sprite.into())
        }));
        all.extend(other.polychrome_sprites.iter().map(|sprite| {
            let mut sprite = sprite.clone();
            (sprite.bounds, sprite.content_mask, sprite.transformation) = (moved(&sprite.bounds), masked(&sprite.content_mask), turned(&sprite.transformation));
            (sprite.corner_radii, sprite.opacity) = (corners(&sprite.corner_radii), sprite.opacity * opacity);
            (sprite.order, sprite.into())
        }));
        all.extend(other.rasters.iter().map(|raster| {
            let mut raster = raster.clone();
            (raster.bounds, raster.content_mask, raster.opacity) = (moved(&raster.bounds), masked(&raster.content_mask), raster.opacity * opacity);
            (raster.order, raster.into())
        }));
        for tile in &other.tiles {
            if !self.tiles.iter().any(|kept| kept.id == tile.id) {
                self.tiles.push(tile.clone());
            }
        }
        all.extend(other.backdrops.iter().map(|backdrop| {
            let mut backdrop = backdrop.clone();
            (backdrop.bounds, backdrop.content_mask, backdrop.corner_radii, backdrop.blur, backdrop.opacity) = (moved(&backdrop.bounds), masked(&backdrop.content_mask), corners(&backdrop.corner_radii), px(backdrop.blur), backdrop.opacity * opacity);
            (backdrop.order, backdrop.into())
        }));
        all.sort_by_key(|(order, _)| *order);
        // Into a scene that holds nothing, what's moved keeps its order, which it was in already, and what's drawn in it
        // after comes after all of it; else each comes after what it overlaps.
        let empty = [self.shadows.len(), self.quads.len(), self.underlines.len(), self.monochrome_sprites.len(), self.polychrome_sprites.len(), self.backdrops.len(), self.rasters.len()].iter().all(|len| *len == 0);
        let last = all.last().map(|(order, _)| *order);
        for (order, primitive) in all {
            self.place(primitive, empty.then_some(order));
        }
        if let Some(last) = last.filter(|_| empty) {
            let everywhere = Bounds { origin: crate::geometry::Point { x: ScaledPixels(-1.0e9), y: ScaledPixels(-1.0e9) }, size: crate::geometry::Size { width: ScaledPixels(2.0e9), height: ScaledPixels(2.0e9) } };
            self.primitive_bounds.insert_at(everywhere, last);
        }
    }

    /// It moved `by` device pixels, cut to its `width` by `height` there, as a window's frame is moved to be checked
    /// against itself where it was (the headless renderer's `Windows::moved`, the web's `moved`).
    pub fn moved(&self, by: [f32; 2], width: u32, height: u32) -> Scene {
        let at = Bounds { origin: crate::geometry::Point { x: ScaledPixels(by[0]), y: ScaledPixels(by[1]) }, size: crate::geometry::Size { width: ScaledPixels(width as f32), height: ScaledPixels(height as f32) } };
        let mut moved = Scene::default();
        moved.splice(self, 1.0, by, 1.0, at.into());
        moved.finish();
        moved
    }

    /// Where it draws glass, what's behind a backdrop blurred, in whole device pixels, left, top, right and bottom:
    /// whose blur is taken on a grid of its frame's, every fourth pixel or so (`Renderer::plan_blur`), not its own, so
    /// it's sampled otherwise where it's moved.
    pub fn glass(&self) -> Vec<[u32; 4]> {
        let whole = |length: f32, up: bool| (if up { length.ceil() } else { length.floor() }).max(0.0) as u32;
        self.backdrops
            .iter()
            .map(|backdrop| backdrop.bounds.intersect(&backdrop.content_mask.bounds))
            .map(|seen| [whole(seen.origin.x.0, false), whole(seen.origin.y.0, false), whole(seen.origin.x.0 + seen.size.width.0, true), whole(seen.origin.y.0 + seen.size.height.0, true)])
            .collect()
    }

    pub fn finish(&mut self) {
        self.sort();
        self.occlude();
        self.gather();
    }

    /// Orders what's drawn again, where something blurs what's behind it (a backdrop), so backdrops are drawn together:
    /// what overlaps something drawn before it, or what a backdrop's blur reads, still comes after it, and the rest as
    /// early as it can, each backdrop after all else it can be drawn after, so the frame is the same to the pixel. The
    /// renderer blurs every backdrop that's ready at once, in one blur's passes and one break in the frame
    /// (`Renderer::draw_batches`); the order by what overlaps (`insert_primitive`) doesn't know what a blur reads round
    /// its backdrop, so a launcher's left chevron and the page under it came after its right chevron's backdrop, in the
    /// same batches as the right chevron's own fill, and its blur was taken alone: 9 render passes a frame where 5 draw it.
    /// Each is first given its wave, how many blurs must be taken before it's drawn: past each blur that reads it or
    /// whose backdrop it's over, and at least that of what it's over or, for a backdrop, what its blur reads; then
    /// they're ordered by wave, each wave's backdrops last, and in each by the order they had.
    fn gather(&mut self) {
        if self.backdrops.is_empty() {
            return;
        }
        let cut = |bounds: Bounds<ScaledPixels>, mask: &ContentMask<ScaledPixels>| bounds.intersect(&mask.bounds);
        // Each primitive, as it was ordered, with what it's drawn over: its order, its kind and where it is in its list.
        let mut all: Vec<(DrawOrder, PrimitiveKind, usize, Bounds<ScaledPixels>)> = Vec::new();
        all.extend(self.shadows.iter().enumerate().map(|(at, one)| (one.order, PrimitiveKind::Shadow, at, cut(one.reach(), &one.content_mask))));
        all.extend(self.quads.iter().enumerate().map(|(at, one)| (one.order, PrimitiveKind::Quad, at, cut(one.bounds, &one.content_mask))));
        all.extend(self.underlines.iter().enumerate().map(|(at, one)| (one.order, PrimitiveKind::Underline, at, cut(one.bounds, &one.content_mask))));
        all.extend(self.monochrome_sprites.iter().enumerate().map(|(at, one)| (one.order, PrimitiveKind::MonochromeSprite, at, cut(one.bounds, &one.content_mask))));
        all.extend(self.polychrome_sprites.iter().enumerate().map(|(at, one)| (one.order, PrimitiveKind::PolychromeSprite, at, cut(one.bounds, &one.content_mask))));
        all.extend(self.backdrops.iter().enumerate().map(|(at, one)| (one.order, PrimitiveKind::Backdrop, at, cut(one.bounds, &one.content_mask))));
        all.extend(self.rasters.iter().enumerate().map(|(at, one)| (one.order, PrimitiveKind::Raster, at, cut(one.bounds, &one.content_mask))));
        all.sort_unstable_by_key(|(order, kind, at, _)| (*order, *kind, *at));
        // What's drawn, by its wave (a backdrop's one past its own), and what backdrops' blurs read, by one past theirs.
        let (mut drawn, mut read) = (BoundsTree::<ScaledPixels>::default(), BoundsTree::<ScaledPixels>::default());
        let mut waves: Vec<(u32, bool, DrawOrder, PrimitiveKind, usize)> = Vec::with_capacity(all.len());
        for (order, kind, at, area) in all {
            let wave = drawn.max_intersecting(&area).max(read.max_intersecting(&area));
            if kind == PrimitiveKind::Backdrop {
                let reads = self.backdrops[at].reads();
                let wave = wave.max(drawn.max_intersecting(&reads));
                drawn.insert_at(area, wave + 1);
                read.insert_at(reads, wave + 1);
                waves.push((wave, true, order, kind, at));
            } else {
                // What's drawn in the first wave moves nothing after it: only what's later is kept.
                if wave > 0 {
                    drawn.insert_at(area, wave);
                }
                waves.push((wave, false, order, kind, at));
            }
        }
        waves.sort_unstable();
        let mut order = 0;
        let mut last = None;
        for (wave, backdrop, was, kind, at) in waves {
            if last != Some((wave, backdrop, was)) {
                (order, last) = (order + 1, Some((wave, backdrop, was)));
            }
            match kind {
                PrimitiveKind::Shadow => self.shadows[at].order = order,
                PrimitiveKind::Quad => self.quads[at].order = order,
                PrimitiveKind::Underline => self.underlines[at].order = order,
                PrimitiveKind::MonochromeSprite => self.monochrome_sprites[at].order = order,
                PrimitiveKind::PolychromeSprite => self.polychrome_sprites[at].order = order,
                PrimitiveKind::Backdrop => self.backdrops[at].order = order,
                PrimitiveKind::Raster => self.rasters[at].order = order,
            }
        }
        self.sort();
    }

    /// Each kind of primitive in the order it was drawn, which its batches are drawn in (`batches`).
    pub(crate) fn sort(&mut self) {
        self.shadows.sort_by_key(|shadow| shadow.order);
        self.quads.sort_by_key(|quad| quad.order);
        self.underlines.sort_by_key(|underline| underline.order);
        self.monochrome_sprites.sort_by_key(|sprite| (sprite.order, sprite.tile.tile_id));
        self.polychrome_sprites.sort_by_key(|sprite| (sprite.order, sprite.tile.tile_id));
        self.backdrops.sort_by_key(|backdrop| backdrop.order);
        self.rasters.sort_by_key(|raster| raster.order);
    }

    /// A quad wholly under an opaque one drawn later isn't drawn, as a compositor's occlusion culling leaves it out: a
    /// GPU's fill rate is what a scrolled page spends. Nothing goes where something blurs what's behind it (a
    /// backdrop), which reads what's under.
    fn occlude(&mut self) {
        if !self.backdrops.is_empty() {
            return;
        }
        let px = ScaledPixels;
        // What each opaque quad covers for certain: inside its corners and any border that isn't opaque, cut to its mask.
        let opaque: Vec<(DrawOrder, Bounds<ScaledPixels>)> = self
            .quads
            .iter()
            .filter(|quad| quad.transformation == TransformationMatrix::unit() && quad.background.a >= 1.0)
            .map(|quad| {
                let radii = &quad.corner_radii;
                let corner = radii.top_left.0.max(radii.top_right.0).max(radii.bottom_left.0).max(radii.bottom_right.0);
                let widths = &quad.border_widths;
                let border = if quad.border_color.a >= 1.0 && quad.border_style == BorderStyle::Solid { 0.0 } else { widths.top.0.max(widths.right.0).max(widths.bottom.0).max(widths.left.0) };
                let inset = corner.max(border);
                let Bounds { origin, size } = quad.bounds;
                let inside = Bounds { origin: crate::geometry::Point { x: px(origin.x.0 + inset), y: px(origin.y.0 + inset) }, size: crate::geometry::Size { width: px(size.width.0 - 2.0 * inset), height: px(size.height.0 - 2.0 * inset) } };
                (quad.order, inside.intersect(&quad.content_mask.inner()))
            })
            .filter(|(_, covered)| !covered.is_empty())
            .collect();
        if opaque.is_empty() {
            return;
        }
        self.quads.retain(|quad| {
            let shown = quad.content_mask.bounds.intersect(&quad.bounds);
            let under = |covered: &Bounds<ScaledPixels>| {
                let (shown_end, covered_end) = (shown.bottom_right(), covered.bottom_right());
                covered.origin.x.0 <= shown.origin.x.0 && covered.origin.y.0 <= shown.origin.y.0 && shown_end.x.0 <= covered_end.x.0 && shown_end.y.0 <= covered_end.y.0
            };
            quad.transformation != TransformationMatrix::unit() || !opaque.iter().any(|(order, covered)| *order > quad.order && under(covered))
        });
    }

    pub(crate) fn batches(&self) -> impl Iterator<Item = PrimitiveBatch<'_>> {
        // Batches are drawn by order across kinds, so a kind out of order draws over what was drawn after it: a
        // layer's image drew a badge's digits under its own fill.
        debug_assert!(
            self.shadows.is_sorted_by_key(|one| one.order)
                && self.quads.is_sorted_by_key(|one| one.order)
                && self.underlines.is_sorted_by_key(|one| one.order)
                && self.monochrome_sprites.is_sorted_by_key(|one| one.order)
                && self.polychrome_sprites.is_sorted_by_key(|one| one.order)
                && self.backdrops.is_sorted_by_key(|one| one.order)
                && self.rasters.is_sorted_by_key(|one| one.order),
            "a scene's primitives are drawn in batches by their order, so each kind is sorted first (`Scene::sort`)"
        );
        BatchIterator {
            shadows: &self.shadows,
            shadows_start: 0,
            shadows_iter: self.shadows.iter().peekable(),
            quads: &self.quads,
            quads_start: 0,
            quads_iter: self.quads.iter().peekable(),
            underlines: &self.underlines,
            underlines_start: 0,
            underlines_iter: self.underlines.iter().peekable(),
            monochrome_sprites: &self.monochrome_sprites,
            monochrome_sprites_start: 0,
            monochrome_sprites_iter: self.monochrome_sprites.iter().peekable(),
            polychrome_sprites: &self.polychrome_sprites,
            polychrome_sprites_start: 0,
            polychrome_sprites_iter: self.polychrome_sprites.iter().peekable(),
            backdrops: &self.backdrops,
            backdrops_start: 0,
            backdrops_iter: self.backdrops.iter().peekable(),
            rasters: &self.rasters,
            rasters_start: 0,
            rasters_iter: self.rasters.iter().peekable(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Default)]
pub(crate) enum PrimitiveKind {
    Shadow,
    #[default]
    Quad,
    Underline,
    MonochromeSprite,
    PolychromeSprite,
    Backdrop,
    Raster,
}

#[derive(Clone)]
pub(crate) enum Primitive {
    Shadow(Shadow),
    Quad(Quad),
    Underline(Underline),
    MonochromeSprite(MonochromeSprite),
    PolychromeSprite(PolychromeSprite),
    Backdrop(Backdrop),
    Raster(Raster),
}

impl Primitive {
    /// What it draws over: a shadow's box grown by its blur's reach, three deviations, as its shader draws it, so one
    /// whose box is out of its mask but whose blur isn't is still drawn, and ordered with what's over its blur.
    pub fn bounds(&self) -> Bounds<ScaledPixels> {
        match self {
            Primitive::Shadow(shadow) => shadow.reach(),
            Primitive::Quad(quad) => quad.bounds,
            Primitive::Underline(underline) => underline.bounds,
            Primitive::MonochromeSprite(sprite) => sprite.bounds,
            Primitive::PolychromeSprite(sprite) => sprite.bounds,
            Primitive::Backdrop(backdrop) => backdrop.bounds,
            Primitive::Raster(raster) => raster.bounds,
        }
    }

    /// Whether it draws nothing, wholly see-through: a box faded all the way out (a page's cover gone, a layer at 0)
    /// still cost a GPU every pixel of it.
    fn shows_nothing(&self) -> bool {
        match self {
            Primitive::Shadow(shadow) => shadow.color.a <= 0.0,
            Primitive::Quad(quad) => {
                let widths = &quad.border_widths;
                let bordered = quad.border_color.a > 0.0 && [widths.top, widths.right, widths.bottom, widths.left].iter().any(|width| width.0 > 0.0);
                quad.background.a <= 0.0 && !bordered
            }
            Primitive::Underline(underline) => underline.color.a <= 0.0,
            Primitive::MonochromeSprite(sprite) => sprite.color.a <= 0.0,
            Primitive::PolychromeSprite(sprite) => sprite.opacity <= 0.0,
            Primitive::Raster(raster) => raster.opacity <= 0.0,
            Primitive::Backdrop(_) => false,
        }
    }

    fn content_mask_mut(&mut self) -> &mut ContentMask<ScaledPixels> {
        match self {
            Primitive::Shadow(shadow) => &mut shadow.content_mask,
            Primitive::Quad(quad) => &mut quad.content_mask,
            Primitive::Underline(underline) => &mut underline.content_mask,
            Primitive::MonochromeSprite(sprite) => &mut sprite.content_mask,
            Primitive::PolychromeSprite(sprite) => &mut sprite.content_mask,
            Primitive::Backdrop(backdrop) => &mut backdrop.content_mask,
            Primitive::Raster(raster) => &mut raster.content_mask,
        }
    }

    pub fn content_mask(&self) -> &ContentMask<ScaledPixels> {
        match self {
            Primitive::Shadow(shadow) => &shadow.content_mask,
            Primitive::Quad(quad) => &quad.content_mask,
            Primitive::Underline(underline) => &underline.content_mask,
            Primitive::MonochromeSprite(sprite) => &sprite.content_mask,
            Primitive::PolychromeSprite(sprite) => &sprite.content_mask,
            Primitive::Backdrop(backdrop) => &backdrop.content_mask,
            Primitive::Raster(raster) => &raster.content_mask,
        }
    }
}

struct BatchIterator<'a> {
    shadows: &'a [Shadow],
    shadows_start: usize,
    shadows_iter: Peekable<slice::Iter<'a, Shadow>>,
    quads: &'a [Quad],
    quads_start: usize,
    quads_iter: Peekable<slice::Iter<'a, Quad>>,
    underlines: &'a [Underline],
    underlines_start: usize,
    underlines_iter: Peekable<slice::Iter<'a, Underline>>,
    monochrome_sprites: &'a [MonochromeSprite],
    monochrome_sprites_start: usize,
    monochrome_sprites_iter: Peekable<slice::Iter<'a, MonochromeSprite>>,
    polychrome_sprites: &'a [PolychromeSprite],
    polychrome_sprites_start: usize,
    polychrome_sprites_iter: Peekable<slice::Iter<'a, PolychromeSprite>>,
    backdrops: &'a [Backdrop],
    backdrops_start: usize,
    backdrops_iter: Peekable<slice::Iter<'a, Backdrop>>,
    rasters: &'a [Raster],
    rasters_start: usize,
    rasters_iter: Peekable<slice::Iter<'a, Raster>>,
}

/// The run of one kind from `start` while each is drawn before `max`, as GPUI batches them.
macro_rules! batch {
    ($self:ident, $iter:ident, $start:ident, $all:ident, $kind:expr, $max:expr) => {{
        let start = $self.$start;
        let mut end = start + 1;
        $self.$iter.next();
        while $self.$iter.next_if(|primitive| (primitive.order, $kind) < $max).is_some() {
            end += 1;
        }
        $self.$start = end;
        &$self.$all[start..end]
    }};
}

impl<'a> Iterator for BatchIterator<'a> {
    type Item = PrimitiveBatch<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut orders_and_kinds = [
            (self.shadows_iter.peek().map(|s| s.order), PrimitiveKind::Shadow),
            (self.quads_iter.peek().map(|q| q.order), PrimitiveKind::Quad),
            (self.underlines_iter.peek().map(|u| u.order), PrimitiveKind::Underline),
            (self.monochrome_sprites_iter.peek().map(|s| s.order), PrimitiveKind::MonochromeSprite),
            (self.polychrome_sprites_iter.peek().map(|s| s.order), PrimitiveKind::PolychromeSprite),
            (self.backdrops_iter.peek().map(|b| b.order), PrimitiveKind::Backdrop),
            (self.rasters_iter.peek().map(|r| r.order), PrimitiveKind::Raster),
        ];
        orders_and_kinds.sort_by_key(|(order, kind)| (order.unwrap_or(u32::MAX), *kind));

        let first = orders_and_kinds[0];
        let second = orders_and_kinds[1];
        let (batch_kind, max) = if first.0.is_some() { (first.1, (second.0.unwrap_or(u32::MAX), second.1)) } else { return None };

        match batch_kind {
            PrimitiveKind::Shadow => Some(PrimitiveBatch::Shadows(batch!(self, shadows_iter, shadows_start, shadows, batch_kind, max))),
            PrimitiveKind::Quad => Some(PrimitiveBatch::Quads(batch!(self, quads_iter, quads_start, quads, batch_kind, max))),
            PrimitiveKind::Backdrop => Some(PrimitiveBatch::Backdrops(batch!(self, backdrops_iter, backdrops_start, backdrops, batch_kind, max))),
            // Drawn a draw for each texture in a row of its batch (`Renderer::draw_run`).
            PrimitiveKind::Raster => Some(PrimitiveBatch::Rasters(batch!(self, rasters_iter, rasters_start, rasters, batch_kind, max))),
            PrimitiveKind::Underline => {
                Some(PrimitiveBatch::Underlines(batch!(self, underlines_iter, underlines_start, underlines, batch_kind, max)))
            }
            PrimitiveKind::MonochromeSprite => {
                let texture_id = self.monochrome_sprites_iter.peek().unwrap().tile.texture_id;
                let start = self.monochrome_sprites_start;
                let mut end = start + 1;
                self.monochrome_sprites_iter.next();
                while self
                    .monochrome_sprites_iter
                    .next_if(|sprite| (sprite.order, batch_kind) < max && sprite.tile.texture_id == texture_id)
                    .is_some()
                {
                    end += 1;
                }
                self.monochrome_sprites_start = end;
                Some(PrimitiveBatch::MonochromeSprites { texture_id, sprites: &self.monochrome_sprites[start..end] })
            }
            PrimitiveKind::PolychromeSprite => {
                let texture_id = self.polychrome_sprites_iter.peek().unwrap().tile.texture_id;
                let start = self.polychrome_sprites_start;
                let mut end = start + 1;
                self.polychrome_sprites_iter.next();
                while self
                    .polychrome_sprites_iter
                    .next_if(|sprite| (sprite.order, batch_kind) < max && sprite.tile.texture_id == texture_id)
                    .is_some()
                {
                    end += 1;
                }
                self.polychrome_sprites_start = end;
                Some(PrimitiveBatch::PolychromeSprites { texture_id, sprites: &self.polychrome_sprites[start..end] })
            }
        }
    }
}

/// An instance's bytes past its place in the scene's order (`DrawOrder`, each's first field): what's drawn, wherever it
/// comes, as the order a frame's things come in is compared on its own (`damage`).
pub(crate) fn drawn<T>(item: &T) -> &[u8] {
    // Safety: the scene's primitives are `#[repr(C)]` structs of numbers, in the layout the shader reads.
    let bytes = unsafe { std::slice::from_raw_parts((item as *const T).cast::<u8>(), std::mem::size_of::<T>()) };
    &bytes[std::mem::size_of::<DrawOrder>()..]
}

impl PrimitiveBatch<'_> {
    /// What its thing `at` is, wherever it comes in the order: a hash of its kind, its texture and its bytes past its
    /// place in the scene's order (`drawn`).
    pub(crate) fn print(&self, at: usize) -> u64 {
        use std::hash::{Hash, Hasher};
        let texture = match self {
            PrimitiveBatch::MonochromeSprites { texture_id, .. } | PrimitiveBatch::PolychromeSprites { texture_id, .. } => Some(texture_id),
            _ => None,
        };
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        (std::mem::discriminant(self), texture, self.drawn(at)).hash(&mut hasher);
        hasher.finish()
    }

    /// Its thing `at`'s bytes past its place in the scene's order (`drawn`): what it is, wherever it comes.
    fn drawn(&self, at: usize) -> &[u8] {
        match self {
            PrimitiveBatch::Quads(all) => drawn(&all[at]),
            PrimitiveBatch::Shadows(all) => drawn(&all[at]),
            PrimitiveBatch::Underlines(all) => drawn(&all[at]),
            PrimitiveBatch::MonochromeSprites { sprites, .. } => drawn(&sprites[at]),
            PrimitiveBatch::PolychromeSprites { sprites, .. } => drawn(&sprites[at]),
            PrimitiveBatch::Backdrops(all) => drawn(&all[at]),
            PrimitiveBatch::Rasters(all) => drawn(&all[at]),
        }
    }

    /// Whether anything in it is drawn in `area`, cut to where it's drawn inside.
    pub(crate) fn reaches(&self, area: &Bounds<ScaledPixels>) -> bool {
        self.extents().iter().any(|extent| extent.intersects(area))
    }

    /// Where each thing in it is drawn, turned as it's drawn (`TransformationMatrix::around`) and cut to where it's
    /// drawn inside, in order.
    pub(crate) fn extents(&self) -> Vec<Bounds<ScaledPixels>> {
        fn cut<'a>(all: impl Iterator<Item = (Bounds<ScaledPixels>, &'a ContentMask<ScaledPixels>)>) -> Vec<Bounds<ScaledPixels>> {
            all.map(|(bounds, mask)| bounds.intersect(&mask.bounds)).collect()
        }
        match self {
            PrimitiveBatch::Shadows(all) => cut(all.iter().map(|one| (one.transformation.around(&one.reach()), &one.content_mask))),
            PrimitiveBatch::Quads(all) => cut(all.iter().map(|one| (one.transformation.around(&one.bounds), &one.content_mask))),
            PrimitiveBatch::Underlines(all) => cut(all.iter().map(|one| (one.bounds, &one.content_mask))),
            PrimitiveBatch::MonochromeSprites { sprites, .. } => cut(sprites.iter().map(|one| (one.transformation.around(&one.bounds), &one.content_mask))),
            PrimitiveBatch::PolychromeSprites { sprites, .. } => cut(sprites.iter().map(|one| (one.transformation.around(&one.bounds), &one.content_mask))),
            PrimitiveBatch::Backdrops(all) => cut(all.iter().map(|one| (one.bounds, &one.content_mask))),
            PrimitiveBatch::Rasters(all) => cut(all.iter().map(|one| (one.transformation.around(&one.bounds), &one.content_mask))),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum PrimitiveBatch<'a> {
    Shadows(&'a [Shadow]),
    Quads(&'a [Quad]),
    Underlines(&'a [Underline]),
    MonochromeSprites { texture_id: AtlasTextureId, sprites: &'a [MonochromeSprite] },
    PolychromeSprites { texture_id: AtlasTextureId, sprites: &'a [PolychromeSprite] },
    Backdrops(&'a [Backdrop]),
    Rasters(&'a [Raster]),
}

/// What a pipeline's vertex shader reads of each of a batch's instances, which the frame's data holds as the scene does
/// (`Renderer::push_instances`), one instance a step (`VertexStepMode::Instance`): each attribute a field, at its place
/// in the struct, read at its `@location` by the struct of the same name in `shaders.wgsl`. Fields it doesn't read, as
/// the order, are stepped over. Vertex data rather than a storage buffer, as WebGL2 has none.
pub(crate) trait Instance: Sized {
    const ATTRIBUTES: &'static [wgpu::VertexAttribute];
    const LAYOUT: wgpu::VertexBufferLayout<'static> =
        wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Self>() as u64, step_mode: wgpu::VertexStepMode::Instance, attributes: Self::ATTRIBUTES };
}

macro_rules! instance {
    ($type:ty { $($location:literal: $($field:ident).+ as $format:ident),+ $(,)? }) => {
        impl Instance for $type {
            const ATTRIBUTES: &'static [wgpu::VertexAttribute] = &[$(wgpu::VertexAttribute {
                format: wgpu::VertexFormat::$format,
                offset: std::mem::offset_of!($type, $($field).+) as u64,
                shader_location: $location,
            }),+];
        }
    };
}

instance!(Quad {
    0: border_style as Uint32,
    1: bounds as Float32x4,
    2: content_mask.bounds as Float32x4,
    3: content_mask.corner_radii as Float32x4,
    4: background as Float32x4,
    5: border_color as Float32x4,
    6: corner_radii as Float32x4,
    7: border_widths as Float32x4,
    8: transformation.rotation_scale as Float32x4,
    9: transformation.translation as Float32x2,
});

instance!(Shadow {
    0: blur_radius as Float32,
    1: bounds as Float32x4,
    2: corner_radii as Float32x4,
    3: content_mask.bounds as Float32x4,
    4: content_mask.corner_radii as Float32x4,
    5: color as Float32x4,
    6: transformation.rotation_scale as Float32x4,
    7: transformation.translation as Float32x2,
    8: inset as Uint32,
    9: outer as Float32x4,
    10: outer_radii as Float32x4,
});

instance!(Underline {
    0: bounds as Float32x4,
    1: content_mask.bounds as Float32x4,
    2: content_mask.corner_radii as Float32x4,
    3: color as Float32x4,
    4: thickness as Float32,
    5: wavy as Uint32,
});

instance!(MonochromeSprite {
    0: bounds as Float32x4,
    1: content_mask.bounds as Float32x4,
    2: content_mask.corner_radii as Float32x4,
    3: color as Float32x4,
    4: tile.bounds as Sint32x4,
    5: transformation.rotation_scale as Float32x4,
    6: transformation.translation as Float32x2,
});

instance!(PolychromeSprite {
    0: grayscale as Uint32,
    1: opacity as Float32,
    2: bounds as Float32x4,
    3: content_mask.bounds as Float32x4,
    4: content_mask.corner_radii as Float32x4,
    5: corner_radii as Float32x4,
    6: tile.bounds as Sint32x4,
    7: transformation.rotation_scale as Float32x4,
    8: transformation.translation as Float32x2,
});

instance!(Backdrop {
    0: opacity as Float32,
    1: saturation as Float32,
    2: bounds as Float32x4,
    3: content_mask.bounds as Float32x4,
    4: content_mask.corner_radii as Float32x4,
    5: corner_radii as Float32x4,
});

instance!(Raster {
    0: opacity as Float32,
    1: bounds as Float32x4,
    2: content_mask.bounds as Float32x4,
    3: content_mask.corner_radii as Float32x4,
    4: transformation.rotation_scale as Float32x4,
    5: transformation.translation as Float32x2,
    6: slot as Float32x4,
});

#[derive(Default, Debug, Clone)]
#[repr(C)]
pub(crate) struct Quad {
    pub order: DrawOrder,
    pub border_style: BorderStyle,
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub background: Hsla,
    pub border_color: Hsla,
    pub corner_radii: Corners<ScaledPixels>,
    pub border_widths: Edges<ScaledPixels>,
    pub transformation: TransformationMatrix,
}

impl From<Quad> for Primitive {
    fn from(quad: Quad) -> Self {
        Primitive::Quad(quad)
    }
}

#[derive(Debug, Clone)]
#[repr(C)]
pub(crate) struct Underline {
    pub order: DrawOrder,
    pub pad: u32, // align to 8 bytes
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub color: Hsla,
    pub thickness: ScaledPixels,
    pub wavy: u32,
}

impl From<Underline> for Primitive {
    fn from(underline: Underline) -> Self {
        Primitive::Underline(underline)
    }
}

#[derive(Debug, Clone)]
#[repr(C)]
pub(crate) struct Shadow {
    pub order: DrawOrder,
    pub blur_radius: ScaledPixels,
    pub bounds: Bounds<ScaledPixels>,
    pub corner_radii: Corners<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub color: Hsla,
    pub transformation: TransformationMatrix,
    /// Ours: 1 for a shadow inside the box it's of (`outer`, with `outer_radii`), where its own box doesn't cover.
    pub inset: u32,
    pub pad: u32,
    pub outer: Bounds<ScaledPixels>,
    pub outer_radii: Corners<ScaledPixels>,
}

impl Shadow {
    /// What its shader draws (`shadow_bounds`): inside the box it's of (`outer`) where it's inset, else its box grown by
    /// its blur's reach, three deviations. An inset one's box is the hole it casts round, which `outer` is drawn beyond.
    fn reach(&self) -> Bounds<ScaledPixels> {
        if self.inset != 0 {
            return self.outer;
        }
        let reach = 3.0 * self.blur_radius.0;
        let Bounds { origin, size } = self.bounds;
        Bounds {
            origin: crate::geometry::Point { x: ScaledPixels(origin.x.0 - reach), y: ScaledPixels(origin.y.0 - reach) },
            size: crate::geometry::Size { width: ScaledPixels(size.width.0 + 2.0 * reach), height: ScaledPixels(size.height.0 + 2.0 * reach) },
        }
    }
}

impl From<Shadow> for Primitive {
    fn from(shadow: Shadow) -> Self {
        Primitive::Shadow(shadow)
    }
}

/// The style of a border.
#[derive(Default, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(C)]
pub enum BorderStyle {
    #[default]
    Solid = 0,
    Dashed = 1,
}

/// A 2D transformation, in device pixels, which the shaders apply to what they draw: a node turned (`rotate`), and
/// what's in it.
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(C)]
pub struct TransformationMatrix {
    /// 2x2 matrix containing rotation and scale, stored row-major
    pub rotation_scale: [[f32; 2]; 2],
    pub translation: [f32; 2],
}

impl Default for TransformationMatrix {
    fn default() -> Self {
        Self::unit()
    }
}

impl TransformationMatrix {
    pub fn unit() -> Self {
        Self { rotation_scale: [[1.0, 0.0], [0.0, 1.0]], translation: [0.0, 0.0] }
    }

    /// Turned `degrees` clockwise, as CSS's `rotate`, around `centre`.
    pub fn rotation(degrees: f32, centre: [f32; 2]) -> Self {
        let (sin, cos) = degrees.to_radians().sin_cos();
        let [x, y] = centre;
        Self { rotation_scale: [[cos, -sin], [sin, cos]], translation: [x - (cos * x - sin * y), y - (sin * x + cos * y)] }
    }

    /// `then` after this one.
    pub fn then(&self, then: &Self) -> Self {
        let [[a, b], [c, d]] = then.rotation_scale;
        let [[e, f], [g, h]] = self.rotation_scale;
        let [x, y] = self.translation;
        Self {
            rotation_scale: [[a * e + b * g, a * f + b * h], [c * e + d * g, c * f + d * h]],
            translation: [a * x + b * y + then.translation[0], c * x + d * y + then.translation[1]],
        }
    }

    /// Where it takes `point`.
    pub fn apply(&self, [x, y]: [f32; 2]) -> [f32; 2] {
        let [[a, b], [c, d]] = self.rotation_scale;
        [a * x + b * y + self.translation[0], c * x + d * y + self.translation[1]]
    }

    /// The box round where it takes `bounds`, which a shader draws what's in `bounds` within.
    pub(crate) fn around(&self, bounds: &Bounds<ScaledPixels>) -> Bounds<ScaledPixels> {
        let (Bounds { origin, size }, px) = (bounds, ScaledPixels);
        let corners = [[origin.x.0, origin.y.0], [origin.x.0 + size.width.0, origin.y.0], [origin.x.0, origin.y.0 + size.height.0], [origin.x.0 + size.width.0, origin.y.0 + size.height.0]].map(|corner| self.apply(corner));
        let (left, top) = (corners.iter().map(|[x, _]| *x).fold(f32::MAX, f32::min), corners.iter().map(|[_, y]| *y).fold(f32::MAX, f32::min));
        let (right, bottom) = (corners.iter().map(|[x, _]| *x).fold(f32::MIN, f32::max), corners.iter().map(|[_, y]| *y).fold(f32::MIN, f32::max));
        Bounds { origin: crate::geometry::Point { x: px(left), y: px(top) }, size: crate::geometry::Size { width: px(right - left), height: px(bottom - top) } }
    }

    /// The same, for coordinates `factor` times as large: logical pixels to device pixels.
    pub fn scaled(&self, factor: f32) -> Self {
        Self { rotation_scale: self.rotation_scale, translation: [self.translation[0] * factor, self.translation[1] * factor] }
    }
}

#[derive(Clone, Debug)]
#[repr(C)]
pub(crate) struct MonochromeSprite {
    pub order: DrawOrder,
    pub pad: u32, // align to 8 bytes
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub color: Hsla,
    pub tile: AtlasTile,
    pub transformation: TransformationMatrix,
}

impl From<MonochromeSprite> for Primitive {
    fn from(sprite: MonochromeSprite) -> Self {
        Primitive::MonochromeSprite(sprite)
    }
}

#[derive(Clone, Debug)]
#[repr(C)]
pub(crate) struct PolychromeSprite {
    pub order: DrawOrder,
    pub pad: u32, // align to 8 bytes
    /// 1 to draw it grey: a whole `u32`, as a frame's batches are told apart by their bytes (`Drawn`), which a
    /// `bool`'s padding would make differ.
    pub grayscale: u32,
    pub opacity: f32,
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub corner_radii: Corners<ScaledPixels>,
    pub tile: AtlasTile,
    pub transformation: TransformationMatrix,
}

impl From<PolychromeSprite> for Primitive {
    fn from(sprite: PolychromeSprite) -> Self {
        Primitive::PolychromeSprite(sprite)
    }
}

/// What's behind a node, blurred `blur` device pixels (the Gaussian's sigma) and saturated so much, inside its
/// corners, drawn under its background (`backdropFilter`).
#[derive(Clone, Debug)]
#[repr(C)]
pub(crate) struct Backdrop {
    pub order: DrawOrder,
    /// How much of the blur shows over what's behind, as what it's on fades.
    pub opacity: f32,
    pub blur: ScaledPixels,
    pub saturation: f32,
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub corner_radii: Corners<ScaledPixels>,
}

/// How many times a backdrop's frame is halved at most, for its blur: a sixteenth of it, for the widest.
pub(crate) const BLUR_LEVELS: usize = 4;

/// How a blur of `sigma` device pixels is taken: the level its frame is halved to, and how far round what's behind
/// its backdrop it reads, twice the Gaussian's reach (`Renderer::plan_blur`).
pub(crate) fn blur_reach(sigma: f32) -> (usize, f32) {
    let level = (1..=BLUR_LEVELS).find(|level| sigma / (1 << level) as f32 <= 6.0).unwrap_or(BLUR_LEVELS);
    (level, 2.0 * (sigma * 3.0).ceil())
}

impl Backdrop {
    /// What of the scene its blur reads, at most: what's shown of it, with its reach round it out to its level's
    /// texels, as `Renderer::plan_blur`'s region is before it's cut to the frame.
    pub(crate) fn reads(&self) -> Bounds<ScaledPixels> {
        let (level, reach) = blur_reach(self.blur.0);
        let out = reach + (1 << level) as f32;
        let shown = self.bounds.intersect(&self.content_mask.bounds);
        let px = ScaledPixels;
        Bounds { origin: crate::geometry::Point { x: px(shown.origin.x.0 - out), y: px(shown.origin.y.0 - out) }, size: crate::geometry::Size { width: px(shown.size.width.0 + 2.0 * out), height: px(shown.size.height.0 + 2.0 * out) } }
    }
}

impl From<Backdrop> for Primitive {
    fn from(backdrop: Backdrop) -> Self {
        Primitive::Backdrop(backdrop)
    }
}

/// An image of a tile of a picture (`Tile`), drawn once into the renderer's tiles, drawn `opacity` as opaque in
/// `bounds`, cut to `content_mask`: what a compositor draws a layer as. What of it's shown (`slot`, in texels) is the
/// part of the tile it shows, which the renderer moves to where the tile is in its texture (`Renderer::draw_frame`).
#[derive(Clone, Debug)]
#[repr(C)]
pub(crate) struct Raster {
    pub order: DrawOrder,
    pub opacity: f32,
    pub raster: u64,
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub transformation: TransformationMatrix,
    pub slot: Bounds<ScaledPixels>,
}

impl From<Raster> for Primitive {
    fn from(raster: Raster) -> Self {
        Primitive::Raster(raster)
    }
}
