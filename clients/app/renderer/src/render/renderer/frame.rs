use super::super::scene::{Raster, Tile, TransformationMatrix};
use super::blur::Prints;
use super::damage::{self, Rect};
use super::*;

/// What a target draws of a frame: the batches that reach its box of the scene, by where they are among the scene's,
/// what it drew (`Drawn`), the blurs behind its backdrops, each thing it draws, in order, and where (`damage`), and its
/// box's top left in the scene.
struct Planned {
    globals: (u64, u64),
    batches: Vec<usize>,
    drawn: Drawn,
    blurs: Vec<Vec<Blur>>,
    shown: Prints,
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

/// A tile drawn into its cell of a page: its picture's scene, the globals that make its cell the viewport onto it
/// (`origin`, its cell's top left in its scene), its batches' instances, its cell's top left in the page, and where in
/// its cell it's drawn (all of it, or where it changed).
struct Drawing {
    scene: Arc<Scene>,
    globals: (u64, u64),
    origin: [f32; 2],
    offsets: Vec<(u64, u64)>,
    cell: [u32; 2],
    rects: Vec<Rect>,
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
    pub(super) fn draw_frame(&mut self, scene: &Scene, origins: &[[f32; 2]]) -> Draw {
        self.drew = crate::platform::now();
        self.draws.set(0);
        self.passes.set(0);
        self.work.set(Work::default());

        // The frame's data: the gamma, each batch's instances, then each target's globals and its backdrops' blurs'
        // parameters, each shadow tile's and each raster's.
        self.data.clear();
        let gamma = self.gamma;
        let gamma = self.push(bytemuck::bytes_of(&gamma));
        // The frame's tiles that haven't been drawn, each whole into a cell of the renderer's (`Tiles`), the pixel
        // round it too, those of a page at each depth they're drawn at (what's a tile in one is drawn before it)
        // together, in one pass, their batches together: where each took a pass and its own draws, a launcher's
        // category opening, each of its apps' icon and name a layer, made 7 passes and 14 draws more. Those it draws
        // are kept from those it lets go of; what the atlas holds changed, none is what it was.
        let (frame, generation) = (self.frames + 1, self.atlas.generation());
        if self.tiles.generation != generation {
            self.tiles.clear(generation);
        }
        let mut new: Vec<&Tile> = Vec::new();
        for tile in &scene.tiles {
            match self.tiles.cells.get_mut(&tile.id) {
                Some(cell) => cell.drawn = frame,
                None => new.push(tile),
            }
        }
        let mut depths: std::collections::HashMap<u64, usize> = Default::default();
        for tile in &new {
            let depth = tile.scene.rasters.iter().filter_map(|raster| depths.get(&raster.raster)).map(|depth| depth + 1).max().unwrap_or(0);
            depths.insert(tile.id, depth);
        }
        let budget = TILE_WINDOWS * self.targets.iter().map(|target| (target.size.0 / TILE + 2) * (target.size.1 / TILE + 2)).max().unwrap_or(0);
        // Each tile is drawn from its picture's scene as it is, its cell the viewport, so it's the same to the pixel
        // whichever cell it's in, where moved into one its arithmetic rounded otherwise (the web's frames, coming at other
        // times, put a tile in another cell: words a few levels apart). Each scene's instances are in the frame's data once.
        let mut rastering: Vec<(Arc<Sheet>, Vec<Drawing>)> = Vec::new();
        let mut pushed: std::collections::HashMap<*const Scene, Vec<(u64, u64)>> = Default::default();
        for depth in 0..depths.values().max().map_or(0, |most| most + 1) {
            let mut pages: std::collections::BTreeMap<u32, Vec<Drawing>> = Default::default();
            for tile in new.iter().filter(|tile| depths[&tile.id] == depth) {
                let reads: Vec<usize> = tile.scene.rasters.iter().filter_map(|raster| self.tiles.cells.get(&raster.raster)).map(|cell| (cell.at / (CELLS * CELLS)) as usize).collect();
                let px = crate::geometry::ScaledPixels;
                let area = Bounds { origin: crate::geometry::Point { x: px(tile.origin[0] - 1.0), y: px(tile.origin[1] - 1.0) }, size: crate::geometry::Size { width: px(CELL as f32), height: px(CELL as f32) } };
                let prints = Arc::new(tile.scene.prints(area));
                let (cell, rects) = match self.tiles.changed(tile, frame, &reads, prints.clone()) {
                    Some(changed) => changed,
                    None => {
                        let cell = match self.tiles.place(tile, frame, budget, &reads, prints.clone()) {
                            Some(cell) => cell,
                            None => {
                                let texture = self.made((CELLS * CELL, CELLS * CELL), LAYER);
                                let group = self.texture(&texture.create_view(&wgpu::TextureViewDescriptor::default()));
                                self.tiles.grow(Arc::new(Sheet { texture, group }));
                                self.tiles.place(tile, frame, budget, &reads, prints).expect("a page was made")
                            }
                        };
                        (cell, vec![[0, 0, CELL, CELL]])
                    }
                };
                let origin = [tile.origin[0] - 1.0, tile.origin[1] - 1.0];
                let globals = GlobalParams { viewport_size: [CELL as f32; 2], origin };
                let globals = self.push(bytemuck::bytes_of(&globals));
                let offsets = match pushed.get(&Arc::as_ptr(&tile.scene)) {
                    Some(offsets) => offsets.clone(),
                    None => {
                        let offsets: Vec<(u64, u64)> = tile.scene.batches().map(|batch| self.push_batch(&batch)).collect();
                        pushed.insert(Arc::as_ptr(&tile.scene), offsets.clone());
                        offsets
                    }
                };
                pages.entry(cell / (CELLS * CELLS)).or_default().push(Drawing { scene: tile.scene.clone(), globals, origin, offsets, cell: cell_at(cell), rects });
            }
            rastering.extend(pages.into_iter().map(|(page, tiles)| (self.tiles.pages[page as usize].clone(), tiles)));
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
        // changed only in part is taken again there (`Blur::damaged`).
        let things: Vec<Vec<(u64, Bounds<ScaledPixels>)>> = batches
            .iter()
            .zip(&instances)
            .map(|(batch, (offset, _))| {
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
                        (hash(&|hasher| (std::mem::discriminant(batch), texture, &self.data[start + at * stride + order..start + (at + 1) * stride]).hash(hasher)), extent)
                    })
                    .collect()
            })
            .collect();
        let generation = self.atlas.generation();
        let sizes: Vec<(u32, u32)> = self.targets.iter().map(|target| target.size).collect();
        let planned: Vec<Planned> = sizes
            .into_iter()
            .zip(origins)
            .map(|(size, origin)| {
                let globals = GlobalParams { viewport_size: [size.0 as f32, size.1 as f32], origin: *origin };
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
                // Each thing it draws, in order, a backdrop with the blur behind it, in its device pixels.
                let mut shown = Prints::new();
                for (at, one, (thing, extent)) in reaching.iter().enumerate().flat_map(|(at, batch)| things[*batch].iter().enumerate().map(move |(one, thing)| (at, one, thing))) {
                    if extent.intersects(&area) {
                        shown.push((blurs[at].get(one).and_then(|blur| blur.behind).map_or(*thing, |behind| hash(&|hasher| std::hash::Hash::hash(&(thing, behind), hasher))), device(extent)));
                    }
                }
                Planned { globals, batches: reaching, drawn, blurs, shown, origin: *origin }
            })
            .collect();
        // Each target's damage since the frame it drew last, which it's drawn again by where its canvas holds that.
        let since: Vec<Option<Vec<damage::Rect>>> = self.targets.iter().zip(&planned).map(|(target, planned)| target.previous.as_ref().filter(|(over, _)| *over == planned.drawn.over).map(|(_, shown)| damage::damage(shown, &planned.shown))).collect();
        if new.is_empty() && since.iter().zip(&self.targets).all(|(since, target)| since.as_ref().is_some_and(|rects| damage::apart(rects.iter().copied(), target.size).is_empty())) {
            return Draw::Unchanged;
        }
        if let Some(stamps) = &mut self.stamps {
            stamps.begin();
        }
        let acquiring = web_time::Instant::now();
        let calling = super::super::watchdog::calling("taking an image to draw on");
        let images: Vec<Option<Image>> = self.targets.iter_mut().map(|target| target.acquire(&self.device)).collect();
        drop(calling);
        self.acquired = acquiring.elapsed();
        // None to draw on now (a window hidden or asleep, a surface lost): it's drawn on the next, its new tiles too.
        if images.iter().all(Option::is_none) {
            for tile in &new {
                if self.tiles.cells.contains_key(&tile.id) {
                    let cell = self.tiles.let_go(tile.id);
                    self.tiles.free.push(cell.at);
                }
            }
            return Draw::Missed;
        }
        // The tiles of the frame's shadows that haven't one yet, each its box alone, blurred, in a frame of its own.
        let mut tiles: Vec<(TileKey, (u32, u32), (u64, u64), (u64, u64))> = Vec::new();
        // Those the targets draw and those the tiles drawn this frame draw, so a shadow in a tile is drawn the same whatever
        // else the frame draws, and a tile drawn again in part matches what's left of it.
        let drawn: std::collections::BTreeSet<usize> = planned.iter().flat_map(|planned| planned.batches.iter().copied()).collect();
        let shadows = drawn.into_iter().filter_map(|at| if let PrimitiveBatch::Shadows(shadows) = &batches[at] { Some(*shadows) } else { None });
        let in_tiles: Vec<&Scene> = rastering.iter().flat_map(|(_, tiles)| tiles.iter().map(|tile| &*tile.scene)).collect();
        for shadows in shadows.chain(in_tiles.iter().map(|scene| &scene.shadows[..])) {
            for shadow in shadows.iter() {
                let Some((key, blur, radii, tile)) = tiled(shadow) else { continue };
                if self.shadow_tiles.contains_key(&key) || tiles.iter().any(|(planned, ..)| *planned == key) {
                    continue;
                }
                let side = [(tile[0] + 6.0 * blur).ceil() as u32, (tile[1] + 6.0 * blur).ceil() as u32];
                let globals = GlobalParams { viewport_size: [side[0] as f32, side[1] as f32], origin: [0.0; 2] };
                let globals = self.push(bytemuck::bytes_of(&globals));
                let mut alone = shadow.clone();
                alone.blur_radius = crate::geometry::ScaledPixels(blur);
                alone.corner_radii = crate::geometry::Corners { top_left: crate::geometry::ScaledPixels(radii[0]), top_right: crate::geometry::ScaledPixels(radii[1]), bottom_right: crate::geometry::ScaledPixels(radii[2]), bottom_left: crate::geometry::ScaledPixels(radii[3]) };
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
            .chain(rastering.iter().flat_map(|(_, tiles)| tiles.iter().flat_map(|tile| &tile.offsets)))
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

        // Shadows' tiles and pictures' tiles first, once for every target that draws them.
        for (key, (width, height), globals, instance) in tiles {
            self.draw_tile(&mut encoder, &buffer, &group, key, (width, height), globals, gamma, instance);
        }
        for (page, tiles) in rastering {
            self.draw_sheet(&mut encoder, &buffer, &group, &page.texture.create_view(&wgpu::TextureViewDescriptor::default()), gamma, &tiles);
        }
        self.pictures.retain(|id, _| scene.rasters.iter().any(|raster| raster.raster == *id));
        // Then each target, in runs of batches, one pass each, broken at each backdrop that blurs what's drawn before
        // it afresh.
        let mut targets = std::mem::take(&mut self.targets);
        for (((target, image), planned), since) in targets.iter_mut().zip(&images).zip(planned).zip(since) {
            let Some(image) = image else { continue };
            let globals = self.pipelines.layouts.globals(&buffer, planned.globals, gamma);
            let batches: Vec<PrimitiveBatch<'_>> = planned.batches.iter().map(|at| batches[*at]).collect();
            let instances = Instances { group: group.clone(), offsets: planned.batches.iter().map(|at| instances[*at].0 as u32).collect() };
            self.draw_target(&mut encoder, target, image, &globals, &buffer, &batches, &instances, &planned.blurs, planned.drawn, planned.shown, since, planned.origin);
        }
        self.targets = targets;

        if let Some(stamps) = &self.stamps {
            stamps.resolve(&mut encoder);
        }
        self.belt.finish_and_recall_on_submit(&encoder);
        let submitting = web_time::Instant::now();
        let calling = super::super::watchdog::calling("submitting a frame");
        self.queue.submit([encoder.finish()]);
        drop(calling);
        // The browser says when (a promise), and its windows' loop is woken; natively wgpu says as it's polled, as each
        // submit does, and a frame it hasn't said is done a while after is a GPU that hung (`hung`).
        self.frames += 1;
        let (finished, frame) = (self.finished.clone(), self.frames);
        // Mutant: a fence that never signals, the GPU hung.
        if !(crate::mutants::mutant("gpu-hang") && crate::mutants::planted(&self.hung)) {
            self.queue.on_submitted_work_done(move || {
                finished.fetch_max(frame, std::sync::atomic::Ordering::Release);
                #[cfg(target_arch = "wasm32")]
                crate::platform::web::soon();
            });
        }
        #[cfg(not(target_arch = "wasm32"))]
        self.given.push_back(super::Given { frame, at: crate::platform::now(), work: self.work.get(), passes: self.passes.get(), draws: self.draws.get() });
        self.submitted = submitting.elapsed();
        if let Some(stamps) = &mut self.stamps {
            stamps.submitted();
        }
        let presenting = web_time::Instant::now();
        let _calling = super::super::watchdog::calling("presenting a frame");
        // Mutant: a present that never returns, the GPU's driver hung.
        if crate::mutants::mutant("present-hang") {
            loop {
                std::thread::park();
            }
        }
        let mut drawn = Draw::Presented;
        for image in images {
            match image {
                Some(Image { frame: Some(frame), .. }) => self.queue.present(frame),
                Some(_) => {}
                None => drawn = Draw::Missed,
            }
        }
        self.presented = presenting.elapsed();
        drawn
    }

    /// Draws `target`'s batches into its `image`. Where little changed since its last frame (`damage`), only that is drawn again,
    /// on its last frame as it kept it (its canvas), which is then copied into its image, as a surface's images come
    /// back in no known order with what was drawn on them frames before; where most did, it's drawn whole in its
    /// image, and the next frame that changes little draws whole into its canvas, as its first frame does.
    #[allow(clippy::too_many_arguments)]
    fn draw_target(&mut self, encoder: &mut wgpu::CommandEncoder, target: &mut Target, image: &Image, globals: &wgpu::BindGroup, buffer: &wgpu::Buffer, batches: &[PrimitiveBatch<'_>], instances: &Instances, blurs: &[Vec<Blur>], drawn: Drawn, shown: Prints, since: Option<Vec<Rect>>, origin: [f32; 2]) {
        let (texture, view) = (&image.texture, &image.view);
        let size = (texture.width(), texture.height());
        let whole = u64::from(size.0) * u64::from(size.1);
        let copies = texture.usage().contains(wgpu::TextureUsages::COPY_DST);
        // Its blurs, before where it's drawn again is known: what a blur taken reads is drawn again first.
        let blurrable = copies || texture.usage().intersects(wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC);
        let decided = self.decide(target, blurs, blurrable);
        // Drawn again only where it changed since the frame its canvas holds (which frames drawn whole since leave as it
        // was, as a buffer's age has it), where that's under three quarters of it; else whole into its image. Where its
        // canvas holds no frame of this one's (let go idle, made again) or one too far behind, it's drawn whole on it
        // where little changed since the frame before.
        let canvas = target.canvas.take().filter(|canvas| (canvas.width(), canvas.height()) == size);
        fn on(shown: &Option<(u64, Prints)>, now: u64) -> Option<&Prints> {
            shown.as_ref().filter(|(over, _)| *over == now).map(|(_, shown)| shown)
        }
        let held = canvas.is_some() && on(&target.shown, drawn.over).is_some();
        let reads: Vec<Rect> = decided.reads(blurs).collect();
        let changed = |last: &Prints| {
            // Its damage since its last frame, found already where that's the frame it's drawn on.
            let found = since.as_ref().filter(|_| target.previous.as_ref().is_some_and(|(_, previous)| previous == last));
            damage::apart(found.cloned().unwrap_or_else(|| damage::damage(last, &shown)).into_iter().chain(reads.iter().copied()), size)
        };
        let little = |rects: &[Rect]| damage::area(rects) * 4 < whole * 3;
        let plan = on(&target.shown, drawn.over)
            .filter(|_| held && copies)
            .map(changed)
            .filter(|rects| little(rects))
            .map(|rects| Some(Clip::new(rects, origin)))
            .or_else(|| on(&target.previous, drawn.over).filter(|_| copies).map(changed).filter(|rects| little(rects)).map(|_| None))
            // Its first frame, with none before it to tell what changes, is drawn whole on its canvas too, so the next,
            // which most often changes little (a press, a hover), draws only that, where it drew all again.
            .or_else(|| (copies && target.previous.is_none()).then_some(None));
        let mut work = self.work.get();
        match plan {
            Some(clip) => {
                let canvas = canvas.unwrap_or_else(|| self.made(size, LAYER));
                let canvas_view = canvas.create_view(&wgpu::TextureViewDescriptor::default());
                work.damage += clip.as_ref().map_or(whole as f64, |clip| damage::area(&clip.rects) as f64);
                work.copied += whole as f64;
                self.work.set(work);
                if clip.as_ref().is_none_or(|clip| !clip.rects.is_empty()) {
                    self.draw_batches(encoder, target, &canvas, &canvas_view, globals, buffer, batches, instances, blurs, decided, clip.as_ref());
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
                self.draw_batches(encoder, target, texture, view, globals, buffer, batches, instances, blurs, decided, None);
            }
        }
        target.last = drawn;
        // What's behind no backdrop this frame isn't kept; what's still drawn starts the next frame unused.
        target.blurred.retain(|_, kept| std::mem::take(&mut kept.used));
    }

    /// How the blurs of a frame's batches are had (`Decided`): kept from the frames before, else taken afresh, or again
    /// in part, where its target can be read (`blurrable`).
    fn decide(&self, target: &mut Target, blurs: &[Vec<Blur>], blurrable: bool) -> Decided {
        let mut decided = Decided::default();
        if !blurrable {
            return decided;
        }
        for at in 0..blurs.len() {
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
        self.draw_in(&mut pass, batches, instances, run, clip);
    }

    /// Draws the batches `run` names into `pass`, only where `clip` says where it does; a backdrop as one of its batch's,
    /// with what's behind it blurred.
    fn draw_in(&self, pass: &mut wgpu::RenderPass<'_>, batches: &[PrimitiveBatch<'_>], instances: &Instances, run: &[(usize, Option<(wgpu::TextureView, usize)>)], clip: Option<&Clip>) {
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
                self.draw_shadows(pass, shadows, &instances.group, instances.offsets[at], rects);
                continue;
            }
            if let PrimitiveBatch::Rasters(rasters) = &batches[at] {
                pass.set_pipeline(&self.pipelines.rasters);
                pass.set_bind_group(1, &instances.group, &[instances.offsets[at]]);
                // A draw for each texture in a row of them, of the images in it.
                let sheet = |raster: &Raster| self.slot(raster).map(|(sheet, _)| sheet);
                let mut start = 0;
                while start < rasters.len() {
                    let first = sheet(&rasters[start]);
                    let end = start + 1 + rasters[start + 1..].iter().take_while(|raster| sheet(raster).zip(first).is_some_and(|(one, other)| Arc::ptr_eq(one, other))).count();
                    if let Some(first) = first {
                        pass.set_bind_group(2, &first.group, &[]);
                        self.clipped(pass, rects, &|pass| pass.draw(0..4, start as u32..end as u32));
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
                    self.clipped(pass, rects, &|pass| pass.draw(0..4, *one as u32..*one as u32 + 1));
                    continue;
                }
            };
            pass.set_pipeline(pipeline);
            pass.set_bind_group(1, &instances.group, &[instances.offsets[at]]);
            if let Some(id) = texture {
                pass.set_bind_group(2, &self.atlas_group(id), &[]);
            }
            self.clipped(pass, rects, &|pass| pass.draw(0..4, 0..count as u32));
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

    /// Draws the frame's batches into `texture` (`view` of it), cleared first, only where `clip` says where it does, with
    /// their blurs as `decided`, in runs, one pass each, broken only where a
    /// backdrop blurs what's drawn before it afresh, as a pass must end for what it drew to be read: a backdrop whose
    /// blur is kept from the frames before, and the batches either side, are one pass. Each pass costs its driver a
    /// command list (two, as wgpu-core puts each pass's barriers in one of their own), which Intel's Direct3D 12
    /// driver took 1 to 2 ms each to make ready on a Surface's frames that drew something new.
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
        clip: Option<&Clip>,
    ) {
        let blurrable = texture.usage().intersects(wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC);
        let mut load = wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT);
        let mut run: Vec<(usize, Option<(wgpu::TextureView, usize)>)> = Vec::new();
        // Each backdrop's blur kept from the frames before, else taken as the first that needs it is drawn, in one go
        // with each after it that's ready (`Blur::ready`, `Blur::together`): one break in the frame and one blur's three
        // passes for all of them, where each broke it and took three of its own (a launcher's backdrops over its turning
        // pages made 13 passes a frame).
        let Decided { mut blurred, fresh, partly } = decided;
        let blur_of = |(at, one): (usize, usize)| partly.get(&(at, one)).unwrap_or(&blurs[at][one]);
        for at in 0..batches.len() {
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
                let placed: Vec<Raster> = rasters.iter().map(|raster| Raster { slot: self.slot(raster).map_or_else(Default::default, |(_, slot)| slot), ..raster.clone() }).collect();
                self.push_instances(&placed)
            }
        }
    }

    /// Draws `tiles` into their cells of a page (`view`), with the frame's `gamma`: in one pass, each with its cell
    /// the viewport, cleared first and drawn only where it says, as a tile's backdrops draw nothing.
    #[allow(clippy::too_many_arguments)]
    fn draw_sheet(&mut self, encoder: &mut wgpu::CommandEncoder, buffer: &wgpu::Buffer, group: &wgpu::BindGroup, view: &wgpu::TextureView, gamma: (u64, u64), tiles: &[Drawing]) {
        let mut pass = self.pass(encoder, view, wgpu::LoadOp::Load, self.stamps.as_ref().and_then(|stamps| stamps.pass(false)));
        for tile in tiles {
            let [x, y] = tile.cell;
            pass.set_bind_group(0, &self.pipelines.layouts.globals(buffer, tile.globals, gamma), &[]);
            pass.set_viewport(x as f32, y as f32, CELL as f32, CELL as f32, 0.0, 1.0);
            let rects: Vec<Rect> = tile.rects.iter().map(|[left, top, right, bottom]| [x + left, y + top, x + right, y + bottom]).collect();
            pass.set_pipeline(&self.pipelines.clear);
            pass.set_bind_group(1, group, &[0]);
            self.clipped(&mut pass, Some(&rects), &|pass| pass.draw(0..4, 0..1));
            let batches: Vec<PrimitiveBatch<'_>> = tile.scene.batches().collect();
            let instances = Instances { group: group.clone(), offsets: tile.offsets.iter().map(|(offset, _)| *offset as u32).collect() };
            let run: Vec<(usize, Option<(wgpu::TextureView, usize)>)> = (0..batches.len()).map(|at| (at, None)).collect();
            let [left, top] = [tile.origin[0] - x as f32, tile.origin[1] - y as f32];
            self.draw_in(&mut pass, &batches, &instances, &run, Some(&Clip::new(rects, [left, top])));
        }
    }

    /// `raster`'s texture and its slot in it: its tile's part (`Raster::slot`), or a picture's, all of it.
    fn slot(&self, raster: &Raster) -> Option<(&Arc<Sheet>, Bounds<ScaledPixels>)> {
        self.tiles.slot(raster.raster, raster.slot).or_else(|| {
            let sheet = self.pictures.get(&raster.raster)?;
            let px = crate::geometry::ScaledPixels;
            Some((sheet, Bounds { origin: crate::geometry::Point { x: px(0.0), y: px(0.0) }, size: crate::geometry::Size { width: px(sheet.texture.width() as f32), height: px(sheet.texture.height() as f32) } }))
        })
    }
}
