use super::super::scene::{Raster, Recording, TransformationMatrix};
use super::damage::{self, Rect};
use super::*;

/// What a pixel copied costs a GPU beside one drawn again: a third, as a copy moves it once where drawing shades and
/// blends it (the Surface's fit: 0.45 ms a million copied, 1.6 drawn in boxes, 6.8 in glyphs).
const COPIED: f64 = 0.3;

/// What a target draws of a frame: the batches that reach its box of the scene, by where they are among the scene's,
/// what it drew (`Drawn`), the blurs behind its backdrops, each thing it draws, in order, and where (`damage`), and its
/// box's top left in the scene.
struct Planned {
    globals: (u64, u64),
    batches: Vec<usize>,
    drawn: Drawn,
    blurs: Vec<Vec<Blur>>,
    shown: damage::Shown,
    origin: [f32; 2],
}

/// Where a frame is drawn again (`damage`), on the one before: its rectangles, apart, in its device pixels and in the
/// scene's.
struct Clip {
    rects: Vec<Rect>,
    scene: Vec<Bounds<ScaledPixels>>,
}

impl Clip {
    fn new(rects: Vec<Rect>, origin: [f32; 2]) -> Self {
        let px = crate::geometry::ScaledPixels;
        let scene = rects
            .iter()
            .map(|[left, top, right, bottom]| Bounds {
                origin: crate::geometry::Point { x: px(*left as f32 + origin[0]), y: px(*top as f32 + origin[1]) },
                size: crate::geometry::Size { width: px((right - left) as f32), height: px((bottom - top) as f32) },
            })
            .collect();
        Self { rects, scene }
    }
}

/// How a frame's backdrops' blurs are had: kept from the frames before (`blurred`, by batch and backdrop), else taken
/// (`fresh`), some of them again only where what's behind them changed (`partly`, as `Target::kept_blur` has them).
#[derive(Default)]
struct Decided {
    blurred: std::collections::HashMap<(usize, usize), wgpu::TextureView>,
    fresh: Vec<(usize, usize)>,
    partly: std::collections::HashMap<(usize, usize), Blur>,
}

impl Decided {
    /// What of the frame its blurs taken read, in device pixels, which is drawn again before they're taken.
    fn reads<'a>(&'a self, blurs: &'a [Vec<Blur>]) -> impl Iterator<Item = Rect> + 'a {
        self.fresh.iter().map(|place| self.partly.get(place).unwrap_or(&blurs[place.0][place.1]).region)
    }
}

impl Renderer {
    pub(super) fn draw_frame(&mut self, scene: &Scene, origins: &[[f32; 2]]) -> bool {
        self.drew = crate::platform::now();
        self.draws.set(0);
        self.passes.set(0);
        self.work.set(Work::default());
        if let Some(stamps) = &mut self.stamps {
            stamps.begin();
        }
        let acquiring = web_time::Instant::now();
        let images: Vec<Option<Image>> = self.targets.iter_mut().map(|target| target.acquire(&self.device)).collect();
        self.acquired = acquiring.elapsed();
        // None to draw on now (a window hidden or asleep, a surface lost): it's drawn on the next.
        if images.iter().all(Option::is_none) {
            return false;
        }

        // The frame's data: the gamma, each batch's instances, then each target's globals and its backdrops' blurs'
        // parameters, each shadow tile's and each raster's.
        self.data.clear();
        let gamma = self.gamma;
        let gamma = self.push(bytemuck::bytes_of(&gamma));
        // The frame's rasters' scenes that haven't an image yet, packed into a texture for each depth they're drawn at
        // (what's an image in one is drawn into its own texture before it) and drawn there in one pass, their batches
        // together, from their slots: where each took a pass and its own draws, and a draw of its own to draw it, a
        // launcher's category opening, each of its apps' icon and name a layer, made 7 passes and 14 draws more.
        let new: Vec<&Recording> = scene.recordings.iter().filter(|recording| !self.rasters.contains_key(&recording.id)).collect();
        let mut depths: std::collections::HashMap<u32, usize> = Default::default();
        for recording in &new {
            let depth = recording.scene.rasters.iter().filter_map(|raster| depths.get(&raster.raster)).map(|depth| depth + 1).max().unwrap_or(0);
            depths.insert(recording.id, depth);
        }
        let largest = self.device.limits().max_texture_dimension_2d;
        let mut rastering: Vec<(Scene, wgpu::TextureView, (u64, u64), Vec<(u64, u64)>)> = Vec::new();
        for depth in 0..depths.values().max().map_or(0, |most| most + 1) {
            let these: Vec<&Recording> = new.iter().filter(|recording| depths[&recording.id] == depth).copied().collect();
            for (size, placed) in pack(&these.iter().map(|recording| recording.size).collect::<Vec<_>>(), largest) {
                let texture = self.made((size[0], size[1]), LAYER);
                let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
                let sheet = Arc::new(Sheet { group: self.texture(&view), texture });
                let mut drawn = Scene::default();
                for (at, [x, y]) in placed {
                    let recording = these[at];
                    let px = crate::geometry::ScaledPixels;
                    let slot = Bounds { origin: crate::geometry::Point { x: px(x as f32), y: px(y as f32) }, size: crate::geometry::Size { width: px(recording.size[0] as f32), height: px(recording.size[1] as f32) } };
                    drawn.splice(&recording.scene, 1.0, [x as f32 - recording.origin[0], y as f32 - recording.origin[1]], 1.0, slot.into());
                    self.rasters.insert(recording.id, (sheet.clone(), slot));
                }
                drawn.sort();
                let globals = GlobalParams { viewport_size: [size[0] as f32, size[1] as f32], origin: [0.0; 2], premultiplied_alpha: u32::from(self.premultiplied), pad: [0; 3] };
                let globals = self.push(bytemuck::bytes_of(&globals));
                let instances = drawn.batches().map(|batch| self.push_batch(&batch)).collect();
                rastering.push((drawn, view, globals, instances));
            }
        }
        let batches: Vec<PrimitiveBatch<'_>> = scene.batches().collect();
        let instances: Vec<(u64, u64)> = batches.iter().map(|batch| self.push_batch(batch)).collect();
        // What each batch is: its kind, texture and instances.
        let hash = |hashing: &dyn Fn(&mut std::collections::hash_map::DefaultHasher)| {
            use std::hash::Hasher;
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            hashing(&mut hasher);
            hasher.finish()
        };
        let hashes: Vec<u64> = batches
            .iter()
            .zip(&instances)
            .map(|(batch, (offset, length))| {
                use std::hash::Hash;
                let texture = match batch {
                    PrimitiveBatch::MonochromeSprites { texture_id, .. } | PrimitiveBatch::PolychromeSprites { texture_id, .. } => Some(*texture_id),
                    _ => None,
                };
                let bytes = &self.data[*offset as usize..(*offset + *length) as usize];
                hash(&|hasher| (std::mem::discriminant(batch), texture, bytes).hash(hasher))
            })
            .collect();
        // Each thing in each batch: what it is (its kind, texture and instance, wherever it comes in the order) and where
        // it's drawn, by which a frame is drawn again only where they changed (`damage`), and a blur that's behind them
        // changed only in part is taken again there (`Blur::damaged`); what it is scrolled back, where it's in a box that
        // scrolls (the innermost whose clip it's inside, the last painted of those as big), by which a frame moves what it kept of one (`damage::scrolled`);
        // the rows and columns of it that are each the same all along, where it's a box of one colour; and whether it's
        // compared: a quad occlusion drew only in bands (`Scene::bands`) is compared whole, once, as a card scrolling
        // over a still background changes it nowhere the card isn't drawn too.
        let scrolling = |extent: &Bounds<ScaledPixels>| {
            let inside = |clip: &Bounds<ScaledPixels>| extent.origin.x.0 >= clip.origin.x.0 && extent.origin.y.0 >= clip.origin.y.0 && extent.origin.x.0 + extent.size.width.0 <= clip.origin.x.0 + clip.size.width.0 && extent.origin.y.0 + extent.size.height.0 <= clip.origin.y.0 + clip.size.height.0;
            scene.scrolls.iter().rev().filter(|scroll| inside(&scroll.mask.bounds)).min_by(|a, b| (a.mask.bounds.size.width.0 * a.mask.bounds.size.height.0).total_cmp(&(b.mask.bounds.size.width.0 * b.mask.bounds.size.height.0)))
        };
        type Thing = (u64, Bounds<ScaledPixels>, Option<(u64, u64)>, Option<([f32; 2], [f32; 2])>, bool);
        // Where each batch's quads start among the scene's, by which a quad's bands are found.
        let mut quads = 0;
        let starts: Vec<usize> = batches
            .iter()
            .map(|batch| {
                let start = quads;
                if let PrimitiveBatch::Quads(all) = batch {
                    quads += all.len();
                }
                start
            })
            .collect();
        let things: Vec<Vec<Thing>> = batches
            .iter()
            .zip(&instances)
            .zip(&starts)
            .map(|((batch, (offset, _)), first_quad)| {
                use std::hash::Hash;
                let (texture, stride) = match batch {
                    PrimitiveBatch::Quads(_) => (None, std::mem::size_of::<super::super::scene::Quad>()),
                    PrimitiveBatch::Shadows(_) => (None, std::mem::size_of::<super::super::scene::Shadow>()),
                    PrimitiveBatch::Underlines(_) => (None, std::mem::size_of::<super::super::scene::Underline>()),
                    PrimitiveBatch::MonochromeSprites { texture_id, .. } => (Some(*texture_id), std::mem::size_of::<super::super::scene::MonochromeSprite>()),
                    PrimitiveBatch::PolychromeSprites { texture_id, .. } => (Some(*texture_id), std::mem::size_of::<super::super::scene::PolychromeSprite>()),
                    PrimitiveBatch::Backdrops(_) => (None, std::mem::size_of::<super::super::scene::Backdrop>()),
                    PrimitiveBatch::Rasters(_) => (None, std::mem::size_of::<Raster>()),
                };
                let start = *offset as usize;
                let order = std::mem::size_of::<super::super::scene::DrawOrder>();
                batch
                    .extents()
                    .into_iter()
                    .enumerate()
                    .map(|(at, extent)| {
                        let banded = match batch {
                            PrimitiveBatch::Quads(all) => scene.bands.get(first_quad + at).copied().flatten().map(|(mask, first)| (super::super::scene::Quad { content_mask: mask, ..all[at].clone() }, first)),
                            _ => None,
                        };
                        if let Some((whole, first)) = banded {
                            let one = PrimitiveBatch::Quads(std::slice::from_ref(&whole));
                            let extent = one.extents()[0];
                            let print = hash(&|hasher| (std::mem::discriminant(batch), texture, super::super::scene::drawn(&whole)).hash(hasher));
                            let moved = scrolling(&extent).and_then(|scroll| one.unscrolled(0, scroll.by, &scroll.mask).map(|bytes| (scroll.id, hash(&|hasher| (std::mem::discriminant(batch), texture, &bytes).hash(hasher)))));
                            return (print, extent, moved, one.even(0), first);
                        }
                        let print = hash(&|hasher| (std::mem::discriminant(batch), texture, &self.data[start + at * stride + order..start + (at + 1) * stride]).hash(hasher));
                        let moved = scrolling(&extent).and_then(|scroll| batch.unscrolled(at, scroll.by, &scroll.mask).map(|bytes| (scroll.id, hash(&|hasher| (std::mem::discriminant(batch), texture, &bytes).hash(hasher)))));
                        (print, extent, moved, batch.even(at), true)
                    })
                    .collect()
            })
            .collect();
        let generation = self.atlas.generation();
        let planned: Vec<Option<Planned>> = images
            .iter()
            .zip(origins)
            .map(|(image, origin)| {
                let image = image.as_ref()?;
                let size = (image.texture.width(), image.texture.height());
                let globals = GlobalParams { viewport_size: [size.0 as f32, size.1 as f32], origin: *origin, premultiplied_alpha: u32::from(self.premultiplied), pad: [0; 3] };
                let globals = self.push(bytemuck::bytes_of(&globals));
                // Only what reaches its box of the scene: a panel's pane of glass (`platform::Window::arrange`) draws a
                // strip of its page, not all of it again.
                let px = crate::geometry::ScaledPixels;
                let area = Bounds { origin: crate::geometry::Point { x: px(origin[0]), y: px(origin[1]) }, size: crate::geometry::Size { width: px(size.0 as f32), height: px(size.1 as f32) } };
                let reaching: Vec<usize> = (0..batches.len()).filter(|at| batches[*at].reaches(&area)).collect();
                let drawn = Drawn {
                    over: hash(&|hasher| std::hash::Hash::hash(&(size, origin.map(f32::to_bits), generation), hasher)),
                    batches: reaching.iter().map(|at| hashes[*at]).collect(),
                };
                // A backdrop's blur is of what's drawn before it in what it blurs (`Blur::area`): the same while that
                // is, wherever it is and whatever else moves, as the first of its batch moves (a sheet carried up) or
                // a switch turns beside a bar of glass, it's kept. What's drawn there is each thing before it that's
                // drawn there, a backdrop among them with what's behind it, and the backdrops of its own batch before it,
                // not it, so a backdrop fading (a veil coming in) blurs what's behind it once, not each frame; and where
                // only some of that changed (a glass button fading behind a veil), it's blurred again only round them
                // (`Blur::damaged`).
                let drawing: Vec<PrimitiveBatch<'_>> = reaching.iter().map(|at| batches[*at]).collect();
                let device = |extent: &Bounds<ScaledPixels>| {
                    let edge = |at: f32, from: f32, up: bool| (if up { (at - from).ceil() } else { (at - from).floor() }).max(0.0) as u32;
                    [edge(extent.origin.x.0, origin[0], false), edge(extent.origin.y.0, origin[1], false), edge(extent.origin.x.0 + extent.size.width.0, origin[0], true), edge(extent.origin.y.0 + extent.size.height.0, origin[1], true)]
                };
                let mut blurs: Vec<Vec<Blur>> = Vec::with_capacity(drawing.len());
                for (at, batch) in drawing.iter().enumerate() {
                    let PrimitiveBatch::Backdrops(backdrops) = batch else {
                        blurs.push(Vec::new());
                        continue;
                    };
                    let mut these: Vec<Blur> = Vec::with_capacity(backdrops.len());
                    for (one, backdrop) in backdrops.iter().enumerate() {
                        let shown = backdrop.bounds.intersect(&backdrop.content_mask.bounds);
                        let (x, y) = (shown.origin.x.0 - origin[0], shown.origin.y.0 - origin[1]);
                        let region = [x, y, x + shown.size.width.0, y + shown.size.height.0];
                        let mut blur = self.plan_blur(size, backdrop.blur.0, region);
                        let area = blur.area(*origin);
                        // Each thing drawn there, where it's drawn in its device pixels.
                        let print = |before: usize, at: usize, blurred: &[Blur]| {
                            let (thing, extent, ..) = &things[reaching[before]][at];
                            let thing = blurred.get(at).and_then(|blur| blur.behind).map_or(*thing, |behind| hash(&|hasher| std::hash::Hash::hash(&(thing, behind), hasher)));
                            extent.intersects(&area).then(|| (thing, device(extent)))
                        };
                        blur.prints = (0..at)
                            .filter(|before| drawing[*before].reaches(&area))
                            .flat_map(|before| (0..things[reaching[before]].len()).map(move |one| (before, one)))
                            .filter_map(|(before, one)| print(before, one, &blurs[before]))
                            .chain((0..one).filter_map(|earlier| print(at, earlier, &these)))
                            .collect();
                        blur.over = drawn.over;
                        blur.behind = Some(hash(&|hasher| std::hash::Hash::hash(&(drawn.over, &blur.prints, backdrop.blur.0.to_bits(), region.map(f32::to_bits)), hasher)));
                        blur.ready = blur.ready(&drawing, at, one, *origin);
                        these.push(blur);
                    }
                    blurs.push(these);
                }
                // Each thing it draws, in order, a backdrop with the blur behind it, what it is scrolled back and where
                // it's the same all along; and what scrolls in it, in its device pixels.
                let mut shown = damage::Shown::default();
                for (at, one, (thing, extent, moved, even, compared)) in reaching.iter().enumerate().flat_map(|(at, batch)| things[*batch].iter().enumerate().map(move |(one, thing)| (at, one, thing))) {
                    if !compared || !extent.intersects(&area) {
                        continue;
                    }
                    shown.prints.push((blurs[at].get(one).and_then(|blur| blur.behind).map_or(*thing, |behind| hash(&|hasher| std::hash::Hash::hash(&(thing, behind), hasher))), device(extent)));
                    shown.moved.push(*moved);
                    let inner = |[first, last]: [f32; 2], from: f32| [(first - from).ceil().max(0.0) as u32, (last - from).floor().max(0.0) as u32];
                    shown.even.push(even.map(|(rows, columns)| damage::Even { rows: inner(rows, origin[1]), columns: inner(columns, origin[0]) }));
                }
                shown.scrolls = scene
                    .scrolls
                    .iter()
                    .map(|scroll| {
                        let clip = &scroll.mask.bounds;
                        let rect = [
                            (clip.origin.x.0 - origin[0]).ceil().clamp(0.0, size.0 as f32) as u32,
                            (clip.origin.y.0 - origin[1]).ceil().clamp(0.0, size.1 as f32) as u32,
                            (clip.origin.x.0 + clip.size.width.0 - origin[0]).floor().clamp(0.0, size.0 as f32) as u32,
                            (clip.origin.y.0 + clip.size.height.0 - origin[1]).floor().clamp(0.0, size.1 as f32) as u32,
                        ];
                        let radii = &scroll.mask.corner_radii;
                        let reach = radii.top_left.0.max(radii.top_right.0).max(radii.bottom_right.0).max(radii.bottom_left.0);
                        damage::Scroll { id: scroll.id, rect, by: scroll.by.map(|by| by.round() as i64), corners: if reach > 0.0 { reach.ceil() as u32 + 1 } else { 0 } }
                    })
                    .filter(|scroll| scroll.rect[0] < scroll.rect[2] && scroll.rect[1] < scroll.rect[3])
                    .collect();
                Some(Planned { globals, batches: reaching, drawn, blurs, shown, origin: *origin })
            })
            .collect();
        // The tiles of the frame's shadows that haven't one yet, each its box alone, blurred, in a frame of its own.
        let mut tiles: Vec<(TileKey, (u32, u32), (u64, u64), (u64, u64))> = Vec::new();
        let drawn: std::collections::BTreeSet<usize> = planned.iter().flatten().flat_map(|planned| planned.batches.iter().copied()).collect();
        for at in drawn {
            let PrimitiveBatch::Shadows(shadows) = &batches[at] else { continue };
            for shadow in shadows.iter() {
                let Some((key, tile)) = tiled(shadow) else { continue };
                if self.tiles.contains_key(&key) || tiles.iter().any(|(planned, ..)| *planned == key) {
                    continue;
                }
                let blur = shadow.blur_radius.0;
                let side = [(tile[0] + 6.0 * blur).ceil() as u32, (tile[1] + 6.0 * blur).ceil() as u32];
                let globals = GlobalParams { viewport_size: [side[0] as f32, side[1] as f32], origin: [0.0; 2], premultiplied_alpha: 0, pad: [0; 3] };
                let globals = self.push(bytemuck::bytes_of(&globals));
                let mut alone = shadow.clone();
                alone.bounds = crate::geometry::Bounds {
                    origin: crate::geometry::Point { x: crate::geometry::ScaledPixels(3.0 * blur), y: crate::geometry::ScaledPixels(3.0 * blur) },
                    size: crate::geometry::Size { width: crate::geometry::ScaledPixels(tile[0]), height: crate::geometry::ScaledPixels(tile[1]) },
                };
                alone.content_mask.bounds = crate::geometry::Bounds {
                    origin: crate::geometry::Point { x: crate::geometry::ScaledPixels(0.0), y: crate::geometry::ScaledPixels(0.0) },
                    size: crate::geometry::Size { width: crate::geometry::ScaledPixels(side[0] as f32), height: crate::geometry::ScaledPixels(side[1] as f32) },
                };
                alone.transformation = TransformationMatrix::unit();
                let instance = self.push_instances(std::slice::from_ref(&alone));
                tiles.push((key, (side[0], side[1]), globals, instance));
            }
        }
        // What a batch's instances bind is as much as the largest needs, from its offset, so one bind group serves all.
        let largest = instances
            .iter()
            .chain(tiles.iter().map(|(.., instance)| instance))
            .chain(rastering.iter().flat_map(|(.., instances)| instances))
            .map(|(_, length)| *length)
            .max()
            .unwrap_or(4);
        let window = self.instances.as_ref().map_or(0, |(_, window, _)| *window).max(largest.next_power_of_two().max(256));
        self.data.resize(self.data.len() + window as usize, 0);
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        self.write_data(&mut encoder);
        let buffer = self.buffer.clone().expect("written above");
        let binding = |(offset, size): (u64, u64)| wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: &buffer, offset, size: wgpu::BufferSize::new(size) });
        if self.instances.as_ref().is_none_or(|(bound, bound_window, _)| *bound != buffer || *bound_window != window) {
            let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &self.pipelines.layouts.instances,
                entries: &[wgpu::BindGroupEntry { binding: 0, resource: binding((0, window)) }],
            });
            self.instances = Some((buffer.clone(), window, group));
        }
        let group = self.instances.as_ref().expect("made above").2.clone();

        // Shadows' tiles and rasters first, once for every target that draws them.
        for (key, (width, height), globals, instance) in tiles {
            self.draw_tile(&mut encoder, &buffer, &group, key, (width, height), globals, gamma, instance);
        }
        for (drawn, view, globals, offsets) in rastering {
            self.draw_sheet(&mut encoder, &buffer, &group, &drawn, &view, globals, gamma, &offsets);
        }
        let gone: Vec<Arc<Sheet>> = self.rasters.extract_if(|id, _| !scene.recordings.iter().any(|recording| recording.id == *id) && !scene.rasters.iter().any(|raster| raster.raster == *id)).map(|(_, (sheet, _))| sheet).collect();
        for sheet in gone {
            if let Some(sheet) = Arc::into_inner(sheet) {
                self.let_go(sheet.texture);
            }
        }
        // Then each target, in runs of batches, one pass each, broken at each backdrop that blurs what's drawn before
        // it afresh.
        let mut targets = std::mem::take(&mut self.targets);
        for ((target, image), planned) in targets.iter_mut().zip(&images).zip(planned) {
            let (Some(image), Some(planned)) = (image, planned) else { continue };
            let globals = self.pipelines.layouts.globals(&buffer, planned.globals, gamma);
            let batches: Vec<PrimitiveBatch<'_>> = planned.batches.iter().map(|at| batches[*at]).collect();
            let instances = Instances { group: group.clone(), offsets: planned.batches.iter().map(|at| instances[*at].0 as u32).collect() };
            self.draw_target(&mut encoder, target, image, &globals, &buffer, &batches, &instances, &planned.blurs, planned.drawn, planned.shown, planned.origin);
        }
        self.targets = targets;

        if let Some(stamps) = &self.stamps {
            stamps.resolve(&mut encoder);
        }
        self.belt.finish_and_recall_on_submit(&encoder);
        let submitting = web_time::Instant::now();
        self.queue.submit([encoder.finish()]);
        // The browser says when (a promise), and its windows' loop is woken; natively the surface's next image waits for
        // it, and wgpu would say only as it's polled.
        #[cfg(target_arch = "wasm32")]
        {
            self.frames += 1;
            let (finished, frame) = (self.finished.clone(), self.frames);
            self.queue.on_submitted_work_done(move || {
                finished.fetch_max(frame, std::sync::atomic::Ordering::Release);
                crate::platform::web::soon();
            });
        }
        self.submitted = submitting.elapsed();
        if let Some(stamps) = &mut self.stamps {
            stamps.submitted();
        }
        let presenting = web_time::Instant::now();
        let mut drawn = true;
        for image in images {
            match image {
                Some(Image { frame: Some(frame), .. }) => self.queue.present(frame),
                Some(_) => {}
                None => drawn = false,
            }
        }
        self.presented = presenting.elapsed();
        drawn
    }

    /// Draws `target`'s batches into its `image`: from what it kept of its frames before, where its frame starts as
    /// that did, or what's the same as its last frame's start, two frames running, kept now, where it's worth more
    /// than its copy; then the rest. Where little changed since its last frame (`damage`), only that is drawn again,
    /// on its last frame as it kept it (its canvas), which is then copied into its image, as a surface's images come
    /// back in no known order with what was drawn on them frames before; where most did, it's drawn whole in its
    /// image, and the next frame that changes little draws whole into its canvas.
    #[allow(clippy::too_many_arguments)]
    fn draw_target(&mut self, encoder: &mut wgpu::CommandEncoder, target: &mut Target, image: &Image, globals: &wgpu::BindGroup, buffer: &wgpu::Buffer, batches: &[PrimitiveBatch<'_>], instances: &Instances, blurs: &[Vec<Blur>], drawn: Drawn, shown: damage::Shown, origin: [f32; 2]) {
        let (texture, view) = (&image.texture, &image.view);
        let size = (texture.width(), texture.height());
        let whole = u64::from(size.0) * u64::from(size.1);
        let copies = texture.usage().contains(wgpu::TextureUsages::COPY_DST);
        let same = |kept: &Drawn| kept.over == drawn.over && drawn.batches.starts_with(&kept.batches);
        if (!copies || target.kept.as_ref().is_some_and(|kept| !same(&kept.drawn)))
            && let Some(kept) = target.kept.take()
        {
            self.let_go(kept.texture);
        }
        if copies && target.kept.is_none() && target.last.over == drawn.over {
            let start = drawn.batches.iter().zip(&target.last.batches).take_while(|(now, last)| now == last).count();
            // A shadow's or a blur's pixels cost more than copying the frame; anything else is drawn again.
            let worth = batches[..start].iter().any(|batch| matches!(batch, PrimitiveBatch::Shadows(_) | PrimitiveBatch::Backdrops(_)));
            if worth {
                let made = self.made(size, LAYER);
                let made_view = made.create_view(&wgpu::TextureViewDescriptor::default());
                let decided = self.decide(target, blurs, 0..start, true);
                self.draw_batches(encoder, target, &made, &made_view, globals, buffer, batches, instances, blurs, decided, 0..start, None);
                target.kept = Some(Kept { texture: made, drawn: Drawn { over: drawn.over, batches: drawn.batches[..start].to_vec() } });
            }
        }
        let from = target.kept.as_ref().map_or(0, |kept| kept.drawn.batches.len());
        // Its blurs, before where it's drawn again is known: what a blur taken reads is drawn again first.
        let blurrable = copies || texture.usage().intersects(wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC);
        let decided = self.decide(target, blurs, from..batches.len(), blurrable);
        // Drawn again only where it changed since the frame its canvas holds (which frames drawn whole since leave as it
        // was, as a buffer's age has it), a box that scrolled moved there first where that leaves less to draw and copy
        // (`damage::scrolled`), where that's under three quarters of it; else whole into its image. Where its canvas holds
        // no frame of this one's (let go idle, made again) or one too far behind, it's drawn whole on it where little
        // changed since the frame before.
        let canvas = target.canvas.take().filter(|canvas| (canvas.width(), canvas.height()) == size);
        fn on(shown: &Option<(u64, damage::Shown)>, now: u64) -> Option<&damage::Shown> {
            shown.as_ref().filter(|(over, _)| *over == now).map(|(_, shown)| shown)
        }
        let held = canvas.is_some() && on(&target.shown, drawn.over).is_some();
        let reads: Vec<Rect> = decided.reads(blurs).collect();
        let changed = |last: &damage::Shown| {
            let apart = |changed: Vec<Rect>| damage::apart(changed.into_iter().chain(reads.iter().copied()), size);
            let still = apart(damage::damage(&last.prints, &shown.prints));
            let scrolled = damage::scrolled(last, &shown).map(|(blit, was, is, more)| (apart(damage::damage(&was, &is).into_iter().chain(more).collect()), blit));
            match scrolled {
                Some((rects, blit)) if damage::area(&rects) as f64 + COPIED * 2.0 * (damage::area(&[blit.from]) as f64) < damage::area(&still) as f64 => (rects, Some(blit)),
                _ => (still, None),
            }
        };
        let little = |rects: &[Rect]| damage::area(rects) * 4 < whole * 3;
        let plan = on(&target.shown, drawn.over)
            .filter(|_| held && copies)
            .map(changed)
            .filter(|(rects, _)| little(rects))
            .map(|(rects, blit)| (Some(Clip::new(rects, origin)), blit))
            .or_else(|| on(&target.previous, drawn.over).filter(|_| copies).map(changed).filter(|(rects, _)| little(rects)).map(|_| (None, None)));
        let mut work = self.work.get();
        match plan {
            Some((clip, blit)) => {
                let canvas = canvas.unwrap_or_else(|| self.made(size, LAYER));
                let canvas_view = canvas.create_view(&wgpu::TextureViewDescriptor::default());
                work.damage += clip.as_ref().map_or(whole as f64, |clip| damage::area(&clip.rects) as f64);
                work.copied += whole as f64;
                self.work.set(work);
                if let Some(blit) = blit {
                    self.blit(encoder, &canvas, blit);
                }
                self.start(encoder, target, &canvas, clip.as_ref());
                if clip.as_ref().is_none_or(|clip| !clip.rects.is_empty()) {
                    self.draw_batches(encoder, target, &canvas, &canvas_view, globals, buffer, batches, instances, blurs, decided, from..batches.len(), clip.as_ref());
                }
                self.copy(encoder, false, |encoder| encoder.copy_texture_to_texture(canvas.as_image_copy(), texture.as_image_copy(), wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 }));
                target.canvas = Some(canvas);
                target.previous = Some((drawn.over, shown.clone()));
                target.shown = Some((drawn.over, shown));
            }
            None => {
                target.previous = Some((drawn.over, shown));
                target.canvas = canvas;
                work.damage += whole as f64;
                self.work.set(work);
                self.start(encoder, target, texture, None);
                self.draw_batches(encoder, target, texture, view, globals, buffer, batches, instances, blurs, decided, from..batches.len(), None);
            }
        }
        target.last = drawn;
        // What's behind no backdrop this frame isn't kept; what's still drawn starts the next frame unused.
        target.blurred.retain(|_, kept| std::mem::take(&mut kept.used));
    }

    /// Starts `into` as what `target` kept of its frames before (`Kept`), where it did: copied whole, or where `clip`
    /// draws again.
    fn start(&self, encoder: &mut wgpu::CommandEncoder, target: &Target, into: &wgpu::Texture, clip: Option<&Clip>) {
        let Some(kept) = &target.kept else { return };
        let whole = [[0, 0, into.width(), into.height()]];
        let rects = clip.map_or(&whole[..], |clip| &clip.rects);
        let mut work = self.work.get();
        self.copy(encoder, false, |encoder| {
            for [left, top, right, bottom] in rects {
                let at = wgpu::Origin3d { x: *left, y: *top, z: 0 };
                let texel = |texture| wgpu::TexelCopyTextureInfo { texture, mip_level: 0, origin: at, aspect: wgpu::TextureAspect::All };
                encoder.copy_texture_to_texture(texel(&kept.texture), texel(into), wgpu::Extent3d { width: right - left, height: bottom - top, depth_or_array_layers: 1 });
                work.copied += f64::from(right - left) * f64::from(bottom - top);
            }
        });
        self.work.set(work);
    }

    /// Moves `blit`'s pixels of `canvas` where they're moved to, through a texture of their size, as a texture's copy
    /// into itself mustn't overlap.
    fn blit(&mut self, encoder: &mut wgpu::CommandEncoder, canvas: &wgpu::Texture, blit: damage::Blit) {
        let [left, top, right, bottom] = blit.from;
        let (width, height) = (right - left, bottom - top);
        if width == 0 || height == 0 {
            return;
        }
        let through = self.made((width, height), LAYER);
        let texel = |texture, x: u32, y: u32| wgpu::TexelCopyTextureInfo { texture, mip_level: 0, origin: wgpu::Origin3d { x, y, z: 0 }, aspect: wgpu::TextureAspect::All };
        let extent = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
        let to = |edge: u32, by: i64| (i64::from(edge) + by) as u32;
        self.copy(encoder, false, |encoder| {
            encoder.copy_texture_to_texture(texel(canvas, left, top), texel(&through, 0, 0), extent);
            encoder.copy_texture_to_texture(texel(&through, 0, 0), texel(canvas, to(left, blit.by[0]), to(top, blit.by[1])), extent);
        });
        let mut work = self.work.get();
        work.copied += 2.0 * f64::from(width) * f64::from(height);
        self.work.set(work);
        self.let_go(through);
    }

    /// How the blurs of `range` of a frame's batches are had (`Decided`): kept from the frames before, else taken
    /// afresh, or again in part, where its target can be read (`blurrable`).
    fn decide(&self, target: &mut Target, blurs: &[Vec<Blur>], range: std::ops::Range<usize>, blurrable: bool) -> Decided {
        let mut decided = Decided::default();
        if !blurrable {
            return decided;
        }
        for at in range {
            for (one, blur) in blurs[at].iter().enumerate() {
                match target.kept_blur(blur) {
                    Some(Ok(kept)) => {
                        let mut work = self.work.get();
                        work.blurs_kept += 1;
                        self.work.set(work);
                        decided.blurred.insert((at, one), kept);
                    }
                    Some(Err(part)) => {
                        decided.partly.insert((at, one), part);
                        decided.fresh.push((at, one));
                    }
                    None => decided.fresh.push((at, one)),
                }
            }
        }
        decided
    }

    /// Writes the frame's data into its buffer, grown to hold it, and what's been added to the atlas into its
    /// textures, in the frame's own commands: `Queue::write_buffer` and `Queue::write_texture` copy in commands of the
    /// queue's own, a command encoder more each frame they're used, which a Surface's Intel Direct3D 12 driver makes
    /// and frees as they go: twice the CPU to draw a frame (p95 10 ms, 6.7 with one).
    fn write_data(&mut self, encoder: &mut wgpu::CommandEncoder) {
        let needed = (self.data.len() as u64).next_multiple_of(wgpu::COPY_BUFFER_ALIGNMENT);
        self.data.resize(needed as usize, 0);
        if self.buffer.as_ref().is_none_or(|buffer| buffer.size() < needed) {
            self.buffer = Some(self.device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: needed.next_power_of_two().max(0x10000),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
        }
        let size = wgpu::BufferSize::new(needed).expect("a frame has its gamma");
        self.belt.write_buffer(encoder, self.buffer.as_ref().expect("made above"), 0, size).copy_from_slice(&self.data);
        let mut work = self.work.get();
        work.uploaded = self.atlas.upload(encoder, &mut self.belt);
        self.work.set(work);
    }

    /// Draws the batches `run` names into `view` in one pass, only where `clip` says where it does; a backdrop as one
    /// of its batch's, with what's behind it blurred. Cleared first where `load` says, only there where it's clipped.
    #[allow(clippy::too_many_arguments)]
    fn draw_run(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        load: wgpu::LoadOp<wgpu::Color>,
        globals: &wgpu::BindGroup,
        batches: &[PrimitiveBatch<'_>],
        instances: &Instances,
        run: &[(usize, Option<(wgpu::TextureView, usize)>)],
        clip: Option<&Clip>,
    ) {
        if run.is_empty() && !matches!(load, wgpu::LoadOp::Clear(_)) {
            return;
        }
        let clears = clip.is_some() && matches!(load, wgpu::LoadOp::Clear(_));
        let load = if clears { wgpu::LoadOp::Load } else { load };
        let mut pass = self.pass(encoder, view, load, self.stamps.as_ref().filter(|_| !run.is_empty()).and_then(|stamps| stamps.pass(false)));
        pass.set_bind_group(0, globals, &[]);
        if clears {
            pass.set_pipeline(&self.pipelines.clear);
            pass.set_bind_group(1, &instances.group, &[0]);
            self.clipped(&mut pass, clip.map(|clip| &clip.rects[..]), &|pass| pass.draw(0..4, 0..1));
        }
        for (at, blurred) in run {
            let at = *at;
            // A backdrop is drawn alone, one of its batch's; where it's clipped, only in the rectangles it reaches.
            let batch = match (&batches[at], blurred) {
                (PrimitiveBatch::Backdrops(backdrops), Some((_, one))) => PrimitiveBatch::Backdrops(&backdrops[*one..*one + 1]),
                (batch, _) => *batch,
            };
            let reached: Option<(Vec<Rect>, Vec<Bounds<ScaledPixels>>)> = clip.map(|clip| clip.rects.iter().zip(&clip.scene).filter(|(_, scene)| batch.reaches(scene)).map(|(rect, scene)| (*rect, *scene)).unzip());
            if reached.as_ref().is_some_and(|(rects, _)| rects.is_empty()) {
                continue;
            }
            let (rects, scene) = (reached.as_ref().map(|(rects, _)| &rects[..]), reached.as_ref().map(|(_, scene)| &scene[..]));
            self.covered(&batch, scene);
            if let PrimitiveBatch::Shadows(shadows) = &batches[at] {
                self.draw_shadows(&mut pass, shadows, &instances.group, instances.offsets[at], rects);
                continue;
            }
            if let PrimitiveBatch::Rasters(rasters) = &batches[at] {
                pass.set_pipeline(&self.pipelines.rasters);
                pass.set_bind_group(1, &instances.group, &[instances.offsets[at]]);
                // A draw for each texture in a row of them, of the images in it.
                let sheet = |raster: &Raster| self.rasters.get(&raster.raster).map(|(sheet, _)| sheet);
                let mut start = 0;
                while start < rasters.len() {
                    let first = sheet(&rasters[start]);
                    let end = start + 1 + rasters[start + 1..].iter().take_while(|raster| sheet(raster).zip(first).is_some_and(|(one, other)| Arc::ptr_eq(one, other))).count();
                    if let Some(first) = first {
                        pass.set_bind_group(2, &first.group, &[]);
                        self.clipped(&mut pass, rects, &|pass| pass.draw(0..4, start as u32..end as u32));
                    }
                    start = end;
                }
                continue;
            }
            let (pipeline, texture, count) = match &batches[at] {
                PrimitiveBatch::Quads(quads) => (&self.pipelines.quads, None, quads.len()),
                PrimitiveBatch::Shadows(_) | PrimitiveBatch::Rasters(_) => unreachable!("drawn above"),
                PrimitiveBatch::Underlines(underlines) => (&self.pipelines.underlines, None, underlines.len()),
                PrimitiveBatch::MonochromeSprites { texture_id, sprites } => (&self.pipelines.mono_sprites, Some(*texture_id), sprites.len()),
                PrimitiveBatch::PolychromeSprites { texture_id, sprites } => (&self.pipelines.poly_sprites, Some(*texture_id), sprites.len()),
                PrimitiveBatch::Backdrops(_) => {
                    let Some((blurred, one)) = blurred else { continue };
                    pass.set_pipeline(&self.pipelines.backdrops);
                    pass.set_bind_group(1, &instances.group, &[instances.offsets[at]]);
                    pass.set_bind_group(2, &self.texture(blurred), &[]);
                    self.clipped(&mut pass, rects, &|pass| pass.draw(0..4, *one as u32..*one as u32 + 1));
                    continue;
                }
            };
            pass.set_pipeline(pipeline);
            pass.set_bind_group(1, &instances.group, &[instances.offsets[at]]);
            if let Some(id) = texture {
                pass.set_bind_group(2, &self.atlas_group(id), &[]);
            }
            self.clipped(&mut pass, rects, &|pass| pass.draw(0..4, 0..count as u32));
        }
    }

    /// Makes `draw`, a draw call, counted (`draws`): once, or once in each of `rects` where it's drawn only there.
    pub(super) fn clipped(&self, pass: &mut wgpu::RenderPass<'_>, rects: Option<&[Rect]>, draw: &dyn Fn(&mut wgpu::RenderPass<'_>)) {
        let Some(rects) = rects else {
            draw(pass);
            self.drew();
            return;
        };
        for [left, top, right, bottom] in rects {
            pass.set_scissor_rect(*left, *top, right - left, bottom - top);
            draw(pass);
            self.drew();
        }
    }

    /// Draws `range` of the frame's batches into `texture` (`view` of it), only where `clip` says where it does, with
    /// their blurs as `decided`, in runs, one pass each, broken only where a
    /// backdrop blurs what's drawn before it afresh, as a pass must end for what it drew to be read: a backdrop whose
    /// blur is kept from the frames before, and the batches either side, are one pass. Each pass costs its driver a
    /// command list (two, as wgpu-core puts each pass's barriers in one of their own), which Intel's Direct3D 12
    /// driver took 1 to 2 ms each to make ready on a Surface's frames that drew something new. From the first batch,
    /// it's cleared first; from a later one, it already has what's drawn before.
    #[allow(clippy::too_many_arguments)]
    fn draw_batches(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        target: &mut Target,
        texture: &wgpu::Texture,
        view: &wgpu::TextureView,
        globals: &wgpu::BindGroup,
        buffer: &wgpu::Buffer,
        batches: &[PrimitiveBatch<'_>],
        instances: &Instances,
        blurs: &[Vec<Blur>],
        decided: Decided,
        range: std::ops::Range<usize>,
        clip: Option<&Clip>,
    ) {
        let blurrable = texture.usage().intersects(wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC);
        let mut load = if range.start == 0 { wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT) } else { wgpu::LoadOp::Load };
        let mut run: Vec<(usize, Option<(wgpu::TextureView, usize)>)> = Vec::new();
        // Each backdrop's blur kept from the frames before, else taken as the first that needs it is drawn, in one go
        // with each after it that's ready (`Blur::ready`, `Blur::together`): one break in the frame and one blur's three
        // passes for all of them, where each broke it and took three of its own (a launcher's backdrops over its turning
        // pages made 13 passes a frame).
        let Decided { mut blurred, fresh, partly } = decided;
        let blur_of = |(at, one): (usize, usize)| partly.get(&(at, one)).unwrap_or(&blurs[at][one]);
        for at in range {
            let PrimitiveBatch::Backdrops(backdrops) = &batches[at] else {
                run.push((at, None));
                continue;
            };
            // Where it can't be read, a backdrop draws nothing.
            if !blurrable {
                continue;
            }
            for one in 0..backdrops.len().min(blurs[at].len()) {
                if !blurred.contains_key(&(at, one)) {
                    let mut group: Vec<(usize, usize)> = Vec::new();
                    for &(later, of) in fresh.iter().filter(|place| **place >= (at, one)) {
                        let blur = blur_of((later, of));
                        let together: Vec<&Blur> = group.iter().map(|place| blur_of(*place)).collect();
                        if (group.is_empty() || blur.ready <= (at, one)) && !blurred.contains_key(&(later, of)) && Blur::together(&together, blur) {
                            group.push((later, of));
                        }
                    }
                    self.draw_run(encoder, view, load, globals, batches, instances, &run, clip);
                    run.clear();
                    load = wgpu::LoadOp::Load;
                    let taking: Vec<&Blur> = group.iter().map(|place| blur_of(*place)).collect();
                    let views = self.blur_behind(encoder, target, texture, view, globals, buffer, &taking);
                    blurred.extend(group.into_iter().zip(views));
                }
                run.push((at, Some((blurred[&(at, one)].clone(), one))));
            }
        }
        self.draw_run(encoder, view, load, globals, batches, instances, &run, clip);
    }

    /// Adds a batch's instances to the frame's data, and says where.
    fn push_batch(&mut self, batch: &PrimitiveBatch<'_>) -> (u64, u64) {
        match batch {
            PrimitiveBatch::Quads(quads) => self.push_instances(quads),
            PrimitiveBatch::Shadows(shadows) => self.push_instances(shadows),
            PrimitiveBatch::Underlines(underlines) => self.push_instances(underlines),
            PrimitiveBatch::MonochromeSprites { sprites, .. } => self.push_instances(sprites),
            PrimitiveBatch::PolychromeSprites { sprites, .. } => self.push_instances(sprites),
            PrimitiveBatch::Backdrops(backdrops) => self.push_instances(backdrops),
            PrimitiveBatch::Rasters(rasters) => {
                let placed: Vec<Raster> = rasters.iter().map(|raster| Raster { slot: self.rasters.get(&raster.raster).map_or_else(Default::default, |(_, slot)| *slot), ..raster.clone() }).collect();
                self.push_instances(&placed)
            }
        }
    }

    /// Draws the images packed in a texture (`drawn`, their scenes in their slots) into it (`view`), over nothing, with
    /// its own `globals`, the frame's `gamma`, and its batches' instances at `offsets`: in one pass, as a raster's
    /// backdrops draw nothing.
    #[allow(clippy::too_many_arguments)]
    fn draw_sheet(&mut self, encoder: &mut wgpu::CommandEncoder, buffer: &wgpu::Buffer, group: &wgpu::BindGroup, drawn: &Scene, view: &wgpu::TextureView, globals: (u64, u64), gamma: (u64, u64), offsets: &[(u64, u64)]) {
        let globals = self.pipelines.layouts.globals(buffer, globals, gamma);
        let batches: Vec<PrimitiveBatch<'_>> = drawn.batches().collect();
        let instances = Instances { group: group.clone(), offsets: offsets.iter().map(|(offset, _)| *offset as u32).collect() };
        let run: Vec<(usize, Option<(wgpu::TextureView, usize)>)> = (0..batches.len()).map(|at| (at, None)).collect();
        self.draw_run(encoder, view, wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), &globals, &batches, &instances, &run, None);
    }
}

/// Packs images of `sizes` into textures no wider or taller than `largest`, on shelves, tallest first, each as wide
/// as the widest or a square of their area. → each texture's size, and where each image (by where it is in `sizes`)
/// is in it.
fn pack(sizes: &[[u32; 2]], largest: u32) -> Vec<([u32; 2], Vec<(usize, [u32; 2])>)> {
    let area: f64 = sizes.iter().map(|[width, height]| f64::from(*width) * f64::from(*height)).sum();
    let wide = sizes.iter().map(|[width, _]| *width).max().unwrap_or(0).max(area.sqrt().ceil() as u32).min(largest);
    let mut order: Vec<usize> = (0..sizes.len()).collect();
    order.sort_by_key(|at| std::cmp::Reverse(sizes[*at][1]));
    let mut sheets: Vec<([u32; 2], Vec<(usize, [u32; 2])>)> = Vec::new();
    let (mut x, mut y, mut shelf) = (0, 0, 0);
    for at in order {
        let [width, height] = sizes[at];
        if x > 0 && x + width > wide {
            (x, y, shelf) = (0, y + shelf, 0);
        }
        if sheets.is_empty() || y + height > largest {
            sheets.push(([0, 0], Vec::new()));
            (x, y, shelf) = (0, 0, 0);
        }
        let (size, placed) = sheets.last_mut().expect("pushed above");
        placed.push((at, [x, y]));
        *size = [size[0].max(x + width), size[1].max(y + height)];
        (x, shelf) = ((x + width).min(largest), shelf.max(height));
    }
    sheets
}
