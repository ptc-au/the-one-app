// Adapted from Zed's GPUI (github.com/zed-industries/zed, crates/gpui_wgpu/src/wgpu_renderer.rs) at commit
// 1043f4a86ab911a381d9bfe45cf6b36d3cdcc89a, and cut down for the native host as its Blade renderer was: it draws a
// scene's quads, shadows, underlines and sprites into a window's surface, or into an offscreen texture it reads back
// for a picture; no paths, video surfaces, subpixel text or MSAA. Backdrops, what's behind a node blurred, are ours.
// Copyright 2022 - 2025 Zed Industries, Inc. Licensed under the Apache License, Version 2.0
// (clients/app/renderer/LICENSE-APACHE); this file is changed from the original.

use super::scene::{PrimitiveBatch, Scene, TILE};
use super::atlas::Atlas;
use super::context::Context;
use crate::geometry::{Bounds, ContentMask, DevicePixels, ScaledPixels, Size};
use std::sync::Arc;

mod blur;
mod damage;
mod frame;
mod params;
mod pipelines;
mod shadows;
mod stamps;
mod target;

use blur::Blur;
use params::{GammaParams, GlobalParams, gamma_ratios};
pub(crate) use pipelines::Pipelines;
use shadows::{TileKey, tiled};
use stamps::Stamps;
use target::{Image, Target};

/// The format an offscreen frame is drawn in: 8-bit RGBA, as a PNG's pixels are.
pub(crate) const OFFSCREEN_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;



/// How long after its last frame a renderer lets go of what only makes frames drawn one after another quicker
/// (`Renderer::idle`).
const IDLE: web_time::Duration = web_time::Duration::from_secs(2);

/// How long the GPU may take over a frame, or a wait for what it was given, before it's taken as hung, as Windows takes
/// a GPU (its TDR's 2 s) where it says so. On 22 Nov a Surface's Intel driver timed out (0x141) and failed its reset, and
/// every wait for its GPU, wgpu's own with no limit too, never ended.
pub const HANG: web_time::Duration = web_time::Duration::from_secs(2);

/// What came of drawing a frame (`Renderer::draw`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Draw {
    /// Drawn into every target and presented.
    Presented,
    /// Nothing any target draws changed since the frame it shows, so none was drawn or presented.
    Unchanged,
    /// A target had no image to draw on (a window hidden or asleep, a surface lost): it's drawn on the next.
    Missed,
}

pub struct Renderer {
    /// When it last drew a frame, as the windows' loop tells the time (`platform::now`: on the fake platform its clock,
    /// so its test lets go idle as a device would), by which it lets go of what it holds once idle (`idle`).
    drew: web_time::Instant,
    device: wgpu::Device,
    queue: wgpu::Queue,
    /// What it draws into, each frame in the same commands, submitted once: its window's surface, or each of a
    /// panel's parts' (`platform::Window::arrange`), whose frames share what they draw from (the frame's data, its
    /// rasters and shadows' tiles). wgpu-core keeps each command encoder the GPU is still on, so a renderer for each
    /// part had a launcher's two parts, a few frames in flight, keep about ten, each a Direct3D 12 command allocator
    /// that a Surface's Intel driver takes hundreds of ms to free.
    targets: Vec<Target>,
    pipelines: Arc<Pipelines>,
    /// The format of its targets, which the pipelines and a backdrop's textures are for.
    format: wgpu::TextureFormat,
    /// What a frame binds, each part at a multiple of this.
    alignment: u64,
    /// The frame's globals, its batches' instances and its blurs' parameters, written once a frame.
    data: Vec<u8>,
    buffer: Option<wgpu::Buffer>,
    /// What the frame's data and the atlas's uploads are copied from, in the frame's own commands (`write_data`).
    belt: wgpu::util::StagingBelt,
    atlas: Arc<Atlas>,
    sampler: wgpu::Sampler,
    gamma: GammaParams,
    /// Each shadow's tile, drawn the first frame it's in, with what binds it (`tiled`).
    shadow_tiles: std::collections::HashMap<TileKey, (wgpu::Texture, wgpu::BindGroup)>,
    /// The bind group of the frame's data for its batches' instances, each at its offset, and how much of the data
    /// from there it binds; made again only as the data's buffer is, or a batch needs more.
    instances: Option<(wgpu::Buffer, u64, wgpu::BindGroup)>,
    /// The tiles of pictures (`scene::Tile`), each drawn the first frame it's in (`Tiles`).
    tiles: Tiles,
    /// Each picture of a frame drawn before (`picture`), by its raster's id, kept while frames draw it.
    pictures: std::collections::HashMap<u64, Arc<Sheet>>,
    /// Each atlas texture's bind group, as of the atlas's having made so many textures.
    atlas_groups: std::cell::RefCell<(u64, std::collections::HashMap<super::atlas::AtlasTextureId, wgpu::BindGroup>)>,
    /// How many draw calls and render passes the last frame made (`draws`, `passes`).
    draws: std::cell::Cell<u32>,
    passes: std::cell::Cell<u32>,
    /// What the last frame's GPU did (`Work`).
    work: std::cell::Cell<Work>,
    /// Its thread's time on a CPU drawing since it was last asked (`drawing`).
    on_cpu: std::cell::Cell<web_time::Duration>,
    /// Its thread's time drawing since it was last asked that wasn't on a CPU (`waited`).
    waiting: std::cell::Cell<web_time::Duration>,
    /// Its passes' time on the GPU, where the GPU can say (`Stamps`), and how long it last waited for images of its
    /// surfaces to draw on.
    stamps: Option<Stamps>,
    acquired: web_time::Duration,
    /// How long the last frame took to finish its commands and hand them to the GPU (`CommandEncoder::finish`,
    /// `Queue::submit`), and to hand its image to the system to show (`Queue::present`).
    submitted: web_time::Duration,
    presented: web_time::Duration,
    /// How many frames it's submitted, and how many of them the GPU has finished (`Queue::on_submitted_work_done`).
    frames: u64,
    finished: std::sync::Arc<std::sync::atomic::AtomicU64>,
    /// Its context's GPU hung (`Context::hung`), which a wait of its own that ran out says.
    hung: Arc<std::sync::atomic::AtomicBool>,
    /// Each frame it gave the GPU that it hasn't said it's done, oldest first (`hung`).
    given: std::collections::VecDeque<Given>,
    /// The scene it last drew, which the fake platform draws whole to check its frame by (`Windows::whole`), and how
    /// many times its atlas had let tiles go then (`Atlas::evictions`).
    #[cfg(feature = "fake")]
    scene: Option<(Scene, u64)>,
}


/// A frame given the GPU: its number, when, as the windows' loop tells the time, and what it was (`Renderer::hung`).
struct Given {
    frame: u64,
    at: web_time::Instant,
    work: Work,
    passes: u32,
    draws: u32,
}

/// The frame's batches' instances: the bind group of its data, and each batch's offset in it.
struct Instances {
    group: wgpu::BindGroup,
    offsets: Vec<u32>,
}

/// What a frame drew: each batch, as a hash of what it is (its kind, texture and instances), and what they were drawn
/// over (the frame's size and origin, and the atlas's generation).
#[derive(Default, PartialEq)]
struct Drawn {
    over: u64,
    batches: Vec<u64>,
}

/// What a frame's GPU did, the same on any GPU: the device pixels of quads (and underlines), shadows, glyphs and
/// pictures (sprites), backdrops and pictures' tiles (rasters) it drew, each counted as often as it's drawn over, the
/// pixels it copied of the frames before, the bytes it uploaded to the atlas, and the device pixels of what it blurred
/// afresh behind backdrops (`blurred`), where a blur kept from the frames before costs none; and how many blurs it took
/// afresh, whole or in part (`blurs`) and drew as they were kept from the frames before (`blurs_kept`); and the device
/// pixels of its targets it drew again, all of each but where only what changed was (`damage`).
#[derive(Clone, Copy, Default)]
struct Work {
    damage: f64,
    quads: f64,
    shadows: f64,
    sprites: f64,
    backdrops: f64,
    rasters: f64,
    copied: f64,
    uploaded: u64,
    blurred: f64,
    blurs: u32,
    blurs_kept: u32,
}

/// What a texture of its own is for, a page of tiles or a target's canvas (`Target::canvas`): drawn into, sampled,
/// copied out of, and into.
const LAYER: wgpu::TextureUsages = wgpu::TextureUsages::RENDER_ATTACHMENT.union(wgpu::TextureUsages::TEXTURE_BINDING).union(wgpu::TextureUsages::COPY_SRC).union(wgpu::TextureUsages::COPY_DST);

/// A texture rasters' images are in (`Raster::slot`): a page of tiles, or a picture of a frame drawn before; with its
/// bind group.
struct Sheet {
    texture: wgpu::Texture,
    group: wgpu::BindGroup,
}

/// A side of a page of tiles, in cells, each a tile with the pixel round it (`scene::TILE`): 2048 device pixels.
const CELLS: u32 = 8;
const CELL: u32 = TILE + 2;

/// The tiles pictures are drawn in (`scene::Tile`), by their ids, each in a cell of a page, as the atlas keeps glyphs:
/// one drawn the first frame it's in, kept while there's room under the budget (`TILE_WINDOWS` windows' worth), the one
/// longest undrawn taken for a new one past it, all let go as the atlas's pixels change (its generation) and once
/// idle. A frame that draws more than the budget has more pages, which go as it idles. A tile where one was drawn
/// (`Tile::key`) is drawn in its cell, again only where what it draws changed (`changed`), as WebRender's picture
/// cache draws a tile's dirty rectangle.
#[derive(Clone, Default)]
struct Tiles {
    pages: Vec<Arc<Sheet>>,
    /// Each tile's cell, by its id.
    cells: std::collections::HashMap<u64, Cell>,
    /// The tile last drawn where each is (`Tile::key`), by its id.
    keys: std::collections::HashMap<u64, u64>,
    free: Vec<u32>,
    generation: u64,
}

/// Where a tile is drawn: its cell, a page's at `at / CELLS²`; the frame that last drew it; where it is (`Tile::key`);
/// and each thing it drew, and where in its cell (`Scene::prints`).
#[derive(Clone)]
struct Cell {
    at: u32,
    drawn: u64,
    key: u64,
    prints: Arc<Vec<(u64, damage::Rect)>>,
}

/// How many windows' worth of tiles a renderer keeps, those it no longer draws (a list scrolled away) among them.
const TILE_WINDOWS: u32 = 4;

impl Tiles {
    /// A page of tiles' texture and where `part` of tile `id` (in its pixels) is in it, past the pixel round it.
    fn slot(&self, id: u64, part: Bounds<ScaledPixels>) -> Option<(&Arc<Sheet>, Bounds<ScaledPixels>)> {
        let cell = self.cells.get(&id)?.at;
        let [x, y] = cell_at(cell);
        // Mutant: a tile shown in part drawn from all of it, squeezed, as before this change's own fix.
        let part = if crate::mutants::mutant("tile-squeezed") { Bounds { origin: Default::default(), size: crate::geometry::Size { width: ScaledPixels(TILE as f32), height: ScaledPixels(TILE as f32) } } } else { part };
        let origin = crate::geometry::Point { x: ScaledPixels((x + 1) as f32 + part.origin.x.0), y: ScaledPixels((y + 1) as f32 + part.origin.y.0) };
        Some((&self.pages[(cell / (CELLS * CELLS)) as usize], Bounds { origin, size: part.size }))
    }

    /// A cell for `tile`, drawn in `frame`, which draws `prints`, on none of the pages `reads` (what it draws from them
    /// can't be drawn into them in the same pass): a free one, else the one longest undrawn, where there are `budget` or
    /// more and some went undrawn this frame. None where a page must be made first (`grow`).
    fn place(&mut self, tile: &super::scene::Tile, frame: u64, budget: u32, reads: &[usize], prints: Arc<Vec<(u64, damage::Rect)>>) -> Option<u32> {
        let full = self.pages.len() as u32 * CELLS * CELLS >= budget;
        let apart = |cell: u32| !reads.contains(&((cell / (CELLS * CELLS)) as usize));
        let at = match self.free.iter().rposition(|cell| apart(*cell)) {
            Some(at) => self.free.swap_remove(at),
            None => {
                let evicted = *self.cells.iter().filter(|(_, cell)| cell.drawn < frame && full && apart(cell.at)).min_by_key(|(_, cell)| (cell.drawn, cell.at))?.0;
                self.let_go(evicted).at
            }
        };
        self.keys.insert(tile.key, tile.id);
        self.cells.insert(tile.id, Cell { at, drawn: frame, key: tile.key, prints });
        Some(at)
    }

    /// The cell of the tile last drawn where `tile` is, given to it to draw only where what it draws (`prints`) changed
    /// (`damage`), or all of it where most did, where that one wasn't drawn this frame and is on none of the pages `reads`;
    /// and where in it to draw.
    fn changed(&mut self, tile: &super::scene::Tile, frame: u64, reads: &[usize], prints: Arc<Vec<(u64, damage::Rect)>>) -> Option<(u32, Vec<damage::Rect>)> {
        let was = *self.keys.get(&tile.key)?;
        let cell = self.cells.get(&was).filter(|cell| cell.drawn < frame && !reads.contains(&((cell.at / (CELLS * CELLS)) as usize)))?;
        let rects = damage::apart(damage::damage(&cell.prints, &prints), (CELL, CELL));
        let rects = if damage::area(&rects) * 4 < u64::from(CELL * CELL) * 3 { rects } else { vec![[0, 0, CELL, CELL]] };
        let at = self.let_go(was).at;
        self.keys.insert(tile.key, tile.id);
        self.cells.insert(tile.id, Cell { at, drawn: frame, key: tile.key, prints });
        Some((at, rects))
    }

    /// Lets go of tile `id`, and of where it is drawn, its cell no longer its. → its cell.
    fn let_go(&mut self, id: u64) -> Cell {
        let cell = self.cells.remove(&id).expect("it's drawn");
        if self.keys.get(&cell.key) == Some(&id) {
            self.keys.remove(&cell.key);
        }
        cell
    }

    /// Another page, its cells free.
    fn grow(&mut self, page: Arc<Sheet>) {
        let first = self.pages.len() as u32 * CELLS * CELLS;
        self.pages.push(page);
        self.free.extend((first..first + CELLS * CELLS).rev());
    }

    /// Lets go of every tile, keeping its pages, as what they drew from changed (the atlas's generation).
    fn clear(&mut self, generation: u64) {
        self.cells.clear();
        self.keys.clear();
        self.free = (0..self.pages.len() as u32 * CELLS * CELLS).rev().collect();
        self.generation = generation;
    }
}

/// Where cell `cell` is in its page, in device pixels.
fn cell_at(cell: u32) -> [u32; 2] {
    let at = cell % (CELLS * CELLS);
    [(at % CELLS) * CELL, (at / CELLS) * CELL]
}

impl Renderer {
    /// A renderer for a window, drawing into `target`, its surface as its platform gives it.
    pub fn new(
        context: &Context,
        atlas: Arc<Atlas>,
        target: super::SurfaceTarget,
        size: Size<DevicePixels>,
        transparent: bool,
    ) -> anyhow::Result<Self> {
        let (target, format) = Target::surface(context, target, extent(size), transparent)?;
        Ok(Self::with_target(context, atlas, target, format))
    }

    /// Draws into `target` too, after those it draws into: a surface as its platform gives it, a panel's part's.
    pub fn add(&mut self, context: &Context, target: super::SurfaceTarget, size: Size<DevicePixels>, transparent: bool) -> anyhow::Result<()> {
        let (target, format) = Target::surface(context, target, extent(size), transparent)?;
        anyhow::ensure!(format == self.format, "a window's parts' surfaces draw in one format");
        self.targets.push(target);
        Ok(())
    }

    /// Draws into an image `size` device pixels offscreen too, after those it draws into, as a panel's part's on the
    /// fake platform.
    pub fn add_offscreen(&mut self, context: &Context, size: Size<DevicePixels>) {
        self.targets.push(Target::offscreen(&context.device, extent(size)));
    }

    /// Lets go of its last target, a panel's part's, once the GPU's done what it was given, before its window goes.
    pub fn remove(&mut self) {
        let target = self.targets.pop();
        if !self.wait(HANG) {
            // A surface waits for its GPU with no limit as it goes (wgpu-hal's Direct3D 12 `unconfigure`).
            return std::mem::forget(target);
        }
        let _calling = super::watchdog::calling("letting go of a surface");
        drop(target);
    }

    /// Waits for the GPU to finish what it was given, `HANG` at most: past that it hung, and its context is lost
    /// (`Context::hung`), made again on a new device as one the system said was lost. → whether it finished.
    fn wait(&self, timeout: web_time::Duration) -> bool {
        use std::sync::atomic::Ordering;
        if self.hung.load(Ordering::Relaxed) {
            return false;
        }
        // Mutant: a fence that never signals, the GPU hung.
        if crate::mutants::mutant("gpu-hang") && crate::mutants::planted(&self.hung) {
            self.hung.store(true, Ordering::Relaxed);
            return false;
        }
        match self.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: Some(timeout) }) {
            Err(wgpu::PollError::Timeout) => {
                log::error!("the GPU hung: what it was given wasn't done in {timeout:?}");
                self.hung.store(true, Ordering::Relaxed);
                false
            }
            _ => true,
        }
    }

    /// A renderer that draws offscreen, `size` device pixels, read back by `read`.
    pub fn offscreen(context: &Context, atlas: Arc<Atlas>, size: Size<DevicePixels>) -> Self {
        Self::with_target(context, atlas, Target::offscreen(&context.device, extent(size)), OFFSCREEN_FORMAT)
    }

    /// A renderer drawing into `target`, from `atlas`, which every renderer on the context shares.
    fn with_target(context: &Context, atlas: Arc<Atlas>, target: Target, format: wgpu::TextureFormat) -> Self {
        let limits = context.device.limits();
        let sampler = context.device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            drew: crate::platform::now(),
            device: context.device.clone(),
            queue: context.queue.clone(),
            targets: vec![target],
            pipelines: Pipelines::shared(&context.device, &context.queue, &context.pipelines, format),
            format,
            alignment: u64::from(limits.min_storage_buffer_offset_alignment.max(limits.min_uniform_buffer_offset_alignment)),
            data: Vec::new(),
            buffer: None,
            belt: wgpu::util::StagingBelt::new(context.device.clone(), 1 << 20),
            atlas,
            sampler,
            gamma: GammaParams { gamma_ratios: gamma_ratios(1.8), grayscale_enhanced_contrast: 1.0, pad: [0.0; 3] },
            shadow_tiles: Default::default(),
            tiles: Default::default(),
            pictures: Default::default(),
            instances: None,
            atlas_groups: Default::default(),
            draws: Default::default(),
            passes: Default::default(),
            work: Default::default(),
            on_cpu: Default::default(),
            waiting: Default::default(),
            stamps: Stamps::new(&context.device, &context.queue),
            acquired: Default::default(),
            submitted: Default::default(),
            presented: Default::default(),
            frames: 0,
            finished: Default::default(),
            hung: context.hung.clone(),
            given: Default::default(),
            #[cfg(feature = "fake")]
            scene: None,
        }
    }

    /// Its target `at`'s new size, in device pixels: its window's, or a panel's part's.
    pub fn update_drawable_size(&mut self, at: usize, size: Size<DevicePixels>) {
        // Configured again, a surface waits for its GPU with no limit (wgpu-core's `configure_surface`).
        if self.targets[at].resizes(extent(size)) && !self.wait(HANG) {
            return;
        }
        let _calling = super::watchdog::calling("configuring a surface");
        self.targets[at].resize(&self.device, extent(size));
    }

    /// Its window has come on the screen (summoned, shown, or its app active again): what the system shows of it isn't
    /// known to be the frame it last presented, which it may have presented while it wasn't there (a launcher's
    /// first frame, drawn as it was summoned as the app started and before it was ordered in; an iPhone app's first
    /// frames, before iOS shows it), and which a Mac's and an iPhone's window don't show then. So its next frame is drawn whole and presented, never judged unchanged (`Draw::Unchanged`).
    pub fn shown(&mut self) {
        for target in &mut self.targets {
            target.previous = None;
        }
    }

    /// Its window is going from the screen: it lets go of what it lets go of when idle (`idle`), and of its surface's
    /// images (three, each the window's size) on Windows and an iPhone, configured as small as a surface is until its
    /// next frame configures it at its window's size again, as a resize does: a DirectComposition swap chain and a
    /// CAMetalLayer's drawables are any size; an offscreen image (the fake platform's) as a surface's. On a Mac, it
    /// takes an image to draw on now, while its window's on the screen, and keeps it for its next frame, as a Mac's
    /// window going from the screen is drawn on first as it's back, where wgpu gives no image for a window macOS hasn't
    /// yet said is visible again (`occlusionState`), which it says a few frames after it's shown, and each summon of
    /// the launcher waited 30 to 45 ms for it. On X11, Vulkan's swap chain is its window's size (`currentExtent`), and
    /// it keeps its images; Android's view destroys its surface as it's hidden.
    pub fn put_away(&mut self) {
        self.idle();
        // Configured again, a surface waits for its GPU with no limit (wgpu-core's `configure_surface`).
        if self.targets.iter().any(Target::configures_away) && !self.wait(HANG) {
            return;
        }
        let _calling = super::watchdog::calling("putting a surface away");
        for target in &mut self.targets {
            target.put_away(&self.device);
        }
    }

    /// Keeps `rgba`, `width` by `height` pixels as raster `id`'s image, a frame drawn before (a window's snapshot,
    /// `platform::WindowOptions::snapshot`), which a scene draws by `Scene::picture` and which goes once a frame
    /// doesn't.
    pub fn picture(&mut self, id: u64, width: u32, height: u32, rgba: &[u8]) {
        let size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: OFFSCREEN_FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        self.queue.write_texture(
            texture.as_image_copy(),
            rgba,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * 4), rows_per_image: None },
            size,
        );
        let group = self.texture(&texture.create_view(&wgpu::TextureViewDescriptor::default()));
        self.pictures.insert(id, Arc::new(Sheet { texture, group }));
    }

    /// Waits until the GPU has done all it was given, and reads its timestamps of the frame it last drew, which `gpu`
    /// then says.
    pub fn finish(&mut self) {
        if !self.wait(HANG) {
            return;
        }
        if let Some(stamps) = &mut self.stamps {
            stamps.read();
        }
    }

    /// How many draw calls the last frame made: each batch, shadow tile, raster and blur pass drawn, but what was kept
    /// of the frames before (`Kept`), as a GPU profiler counts them.
    pub fn draws(&self) -> u32 {
        self.draws.get()
    }

    /// Its thread's time on a CPU (`platform::on_cpu`) drawing frames since this was last asked: making their commands
    /// and handing them to the GPU, not the GPU's own time, nor waiting for it.
    pub fn drawing(&self) -> web_time::Duration {
        self.on_cpu.take()
    }

    /// Its thread's time drawing frames since this was last asked that it wasn't on a CPU: waiting, for pipelines being
    /// compiled, an image to draw on, or the GPU.
    pub fn waited(&self) -> web_time::Duration {
        self.waiting.take()
    }

    fn drew(&self) {
        self.draws.set(self.draws.get() + 1);
    }

    /// How many render passes the last frame made: each costs a driver command lists of its own (wgpu-core records a
    /// pass and its barriers in two), which Intel's Direct3D 12 driver took 1 to 2 ms each to make ready on a Surface.
    pub fn passes(&self) -> u32 {
        self.passes.get()
    }

    /// Begins a render pass drawing into `view`, `load`ing it first, counted (`passes`).
    fn pass<'e>(&self, encoder: &'e mut wgpu::CommandEncoder, view: &wgpu::TextureView, load: wgpu::LoadOp<wgpu::Color>, timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>) -> wgpu::RenderPass<'e> {
        self.passes.set(self.passes.get() + 1);
        encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment { view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load, store: wgpu::StoreOp::Store } })],
            timestamp_writes,
            ..Default::default()
        })
    }

    /// Makes `copy`'s copies, of a blur (`blurs`) or not, timed where the GPU takes timestamps between commands
    /// (`Stamps::copy`).
    fn copy(&self, encoder: &mut wgpu::CommandEncoder, blurs: bool, copy: impl FnOnce(&mut wgpu::CommandEncoder)) {
        match &self.stamps {
            Some(stamps) => stamps.copy(encoder, blurs, copy),
            None => copy(encoder),
        }
    }

    /// What the last frame's GPU did, the same on any GPU, as the inspector's `profile` and `replay` say it: how many
    /// device pixels each kind of thing it drew covered, what it copied of the frames before, and the bytes it uploaded.
    pub fn work(&self) -> serde_json::Value {
        said(self.work.get())
    }

    /// How long until the frames it gave the GPU are waited for, once it's given none for a while (`hung`): by the
    /// windows' loop's clock alone, never by when the GPU says it's done, so a test's loop turns at the same times
    /// each run. The browser has its own watchdog, which loses the device.
    pub fn hang_in(&self) -> Option<web_time::Duration> {
        let last = self.given.back()?;
        Some((HANG / 2).saturating_sub(crate::platform::now().saturating_duration_since(last.at)))
    }

    /// Whether the GPU hung on a frame it was given: the oldest it hasn't said is done was given half of `HANG` ago, by
    /// the windows' loop's clock, or none was given since, and waited for as long again, it's still not done. The
    /// system may never say (a Surface's Intel driver that failed its reset, 22 Nov): its context is then lost
    /// (`Context::hung`). → the frame, as Telemetry hears it: how long ago it was given, what it drew (`work`), its
    /// passes and draw calls, and how many surfaces it drew on.
    pub fn hung(&mut self) -> Option<serde_json::Value> {
        let now = crate::platform::now();
        let quiet = now.saturating_duration_since(self.given.back()?.at) >= HANG / 2;
        // Those done go, but the last given, which says when it's next waited for (`hang_in`).
        let finished = self.finished();
        while self.given.len() > 1 && self.given.front().is_some_and(|given| given.frame <= finished) {
            self.given.pop_front();
        }
        let given = self.given.front().filter(|given| given.frame > finished);
        if (!quiet && given.is_none_or(|given| now.saturating_duration_since(given.at) < HANG / 2)) || self.wait(HANG / 2) {
            if quiet {
                self.given.clear();
            }
            return None;
        }
        let given = self.given.front()?;
        Some(serde_json::json!({
            "ms": (now.saturating_duration_since(given.at) + HANG / 2).as_millis() as u64,
            "work": said(given.work),
            "passes": given.passes,
            "draws": given.draws,
            "surfaces": self.targets.len(),
        }))
    }

    /// The device pixels batch `batch` covers, each thing in it cut to what it's drawn inside, and to `clip` where
    /// it's drawn only there (in the scene's pixels), added to its kind's.
    fn covered(&self, batch: &PrimitiveBatch<'_>, clip: Option<&[Bounds<ScaledPixels>]>) {
        let size = |cut: Bounds<ScaledPixels>| f64::from(cut.size.width.0.max(0.0)) * f64::from(cut.size.height.0.max(0.0));
        let area = |all: &mut dyn Iterator<Item = (&Bounds<ScaledPixels>, &ContentMask<ScaledPixels>)>| -> f64 {
            all.map(|(bounds, mask)| bounds.intersect(&mask.bounds))
                .map(|cut| match clip {
                    Some(rects) => rects.iter().map(|rect| size(cut.intersect(rect))).sum(),
                    None => size(cut),
                })
                .sum()
        };
        let mut work = self.work.get();
        match batch {
            PrimitiveBatch::Quads(quads) => work.quads += area(&mut quads.iter().map(|quad| (&quad.bounds, &quad.content_mask))),
            PrimitiveBatch::Underlines(lines) => work.quads += area(&mut lines.iter().map(|line| (&line.bounds, &line.content_mask))),
            PrimitiveBatch::Shadows(shadows) => work.shadows += area(&mut shadows.iter().map(|shadow| (&shadow.bounds, &shadow.content_mask))),
            PrimitiveBatch::MonochromeSprites { sprites, .. } => work.sprites += area(&mut sprites.iter().map(|sprite| (&sprite.bounds, &sprite.content_mask))),
            PrimitiveBatch::PolychromeSprites { sprites, .. } => work.sprites += area(&mut sprites.iter().map(|sprite| (&sprite.bounds, &sprite.content_mask))),
            PrimitiveBatch::Backdrops(backdrops) => work.backdrops += area(&mut backdrops.iter().map(|backdrop| (&backdrop.bounds, &backdrop.content_mask))),
            PrimitiveBatch::Rasters(rasters) => work.rasters += area(&mut rasters.iter().map(|raster| (&raster.bounds, &raster.content_mask))),
        }
        self.work.set(work);
    }

    pub fn sprite_atlas(&self) -> &Arc<Atlas> {
        &self.atlas
    }

    /// The bytes of GPU memory it holds: its targets' surfaces' images (three each, `desired_maximum_frame_latency`
    /// 2's), or its offscreen texture and readback, and each texture of its own (a canvas, a backdrop's, a raster,
    /// a shadow's tile), by kind.
    pub fn memory(&self) -> serde_json::Value {
        let backdrop = self.targets.iter().flat_map(|target| target.backdrop.iter()).flat_map(|backdrop| backdrop.source.iter().chain(backdrop.levels.iter().flatten().flatten())).map(|(texture, _)| bytes(texture));
        let blurred = self.targets.iter().flat_map(|target| target.blurred.values()).map(|kept| bytes(kept.view.texture()));
        serde_json::json!({
            "surface": self.targets.iter().map(Target::surface_bytes).sum::<u64>(),
            "canvas": self.targets.iter().flat_map(|target| target.canvas.as_ref()).map(bytes).sum::<u64>(),
            "backdrop": backdrop.chain(blurred).sum::<u64>(),
            "rasters": self.tiles.pages.iter().chain(self.pictures.values()).map(|sheet| bytes(&sheet.texture)).sum::<u64>(),
            "tiles": self.shadow_tiles.values().map(|(texture, _)| bytes(texture)).sum::<u64>(),
            "buffer": self.buffer.as_ref().map_or(0, wgpu::Buffer::size),
        })
    }

    /// How long until it's drawn nothing for a while (`IDLE`), where it holds what it lets go of then (`idle`).
    pub fn idle_in(&self) -> Option<web_time::Duration> {
        (!self.tiles.pages.is_empty() || self.targets.iter().any(Target::holds)).then(|| IDLE.saturating_sub(crate::platform::now().saturating_duration_since(self.drew)))
    }

    /// It's drawn nothing for a while (`IDLE`): it lets go of its tiles, the frame it kept and its backdrops' textures and blurs,
    /// each its window's size or a part of it (12 MB a kept frame of 1024 × 720 points at 2x), which make frames
    /// drawn one after another quicker and are made again by the next that need them, as browsers let go of an idle
    /// tab's tiles.
    pub fn idle(&mut self) {
        self.tiles = Tiles::default();
        for target in &mut self.targets {
            target.idle();
        }
    }

    /// Lets go of it, and its surfaces once the GPU's done what it was given, before its window goes.
    pub fn destroy(mut self) {
        for target in &mut self.targets {
            target.reserved = None;
        }
        if !self.wait(HANG) {
            // Its surfaces wait for their GPU with no limit as they go (wgpu-hal's Direct3D 12 `unconfigure`).
            return std::mem::forget(self);
        }
        let _calling = super::watchdog::calling("letting go of a surface");
        drop(self);
    }

    /// Adds `bytes` to the frame's data, at the next multiple of the alignment, and says where.
    fn push(&mut self, bytes: &[u8]) -> (u64, u64) {
        let offset = (self.data.len() as u64).next_multiple_of(self.alignment);
        self.data.resize(offset as usize, 0);
        self.data.extend_from_slice(bytes);
        (offset, bytes.len().max(4) as u64)
    }

    /// Adds `items`, the scene's `#[repr(C)]` primitives, for a shader to read as an array of its struct.
    fn push_instances<T>(&mut self, items: &[T]) -> (u64, u64) {
        // Safety: the scene's primitives are `#[repr(C)]` structs of numbers, in the layout the shader reads.
        let bytes = unsafe { std::slice::from_raw_parts(items.as_ptr().cast::<u8>(), std::mem::size_of_val(items)) };
        self.push(bytes)
    }

    /// Draws into each target the box of `scene` as big as it whose top left is its origin of `origins`, in device
    /// pixels, all in one submit. → what came of it (`Draw`).
    pub fn draw(&mut self, scene: &Scene, origins: &[[f32; 2]]) -> Draw {
        let (started, began) = (crate::platform::on_cpu(), web_time::Instant::now());
        let drawn = self.draw_frame(scene, origins);
        #[cfg(feature = "fake")]
        {
            self.scene = Some((scene.clone(), self.atlas.evictions()));
        }
        let on_cpu = crate::platform::on_cpu().saturating_sub(started);
        self.on_cpu.set(self.on_cpu.get() + on_cpu);
        self.waiting.set(self.waiting.get() + began.elapsed().saturating_sub(on_cpu));
        drawn
    }



    /// Draws its rasters from `other`'s tiles and pictures (`Windows::whole`).
    #[cfg(feature = "fake")]
    pub fn tiles_of(&mut self, other: &Renderer) {
        (self.tiles, self.pictures) = (other.tiles.clone(), other.pictures.clone());
    }

    /// The scene it last drew, while what it drew it with is all still in its atlas: none once tiles it may have drawn
    /// have gone since (`Atlas::trim`).
    #[cfg(feature = "fake")]
    pub fn scene(&self) -> Option<&Scene> {
        self.scene.as_ref().filter(|(_, evictions)| *evictions == self.atlas.evictions()).map(|(scene, _)| scene)
    }

    /// The GPU time of the last frame it has, summed over its passes and copies, and its blurs' (a backdrop's glass), where the
    /// GPU says (a frame or two behind).
    pub fn gpu(&self) -> Option<(web_time::Duration, web_time::Duration)> {
        self.stamps.as_ref()?.gpu
    }

    /// How long the last frame waited for images of its surfaces to draw on, which a display that hasn't shown the
    /// frames before keeps it waiting for.
    pub fn acquired(&self) -> web_time::Duration {
        self.acquired
    }

    /// How long the last frame took to finish its commands and submit them, and to present its image.
    pub fn submitted(&self) -> (web_time::Duration, web_time::Duration) {
        (self.submitted, self.presented)
    }

    /// Whether the GPU hasn't finished the frame it was given last, so another would only queue behind it: a window
    /// waits to draw its next till it has, as a browser's compositor does, else what's shown falls further behind with
    /// each frame a GPU slower than the display is given (the web's on a CPU, SwiftShader's, had a page that moves for
    /// good pile up frames till a screenshot waited forever). A native surface's next image already waits for it.
    pub fn working(&self) -> bool {
        cfg!(target_arch = "wasm32") && self.finished() < self.frames
    }

    /// How many frames it's submitted, and how many of them the GPU has finished, which the web's settle waits for
    /// (`platform::web`'s `settle`).
    pub fn frames(&self) -> u64 {
        self.frames
    }

    pub fn finished(&self) -> u64 {
        self.finished.load(std::sync::atomic::Ordering::Acquire)
    }

    /// A texture of `size` in its target's format, for `usage`.
    fn made(&self, (width, height): (u32, u32), usage: wgpu::TextureUsages) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage,
            view_formats: &[],
        })
    }

    /// An atlas texture's bind group, kept till the atlas makes another texture (which may be in its place).
    fn atlas_group(&self, id: super::atlas::AtlasTextureId) -> wgpu::BindGroup {
        let mut groups = self.atlas_groups.borrow_mut();
        let made = self.atlas.made();
        if groups.0 != made {
            *groups = (made, Default::default());
        }
        groups.1.entry(id).or_insert_with(|| self.texture(&self.atlas.view(id))).clone()
    }

    /// A bind group of `view` and the sampler, for a pass to sample.
    fn texture(&self, view: &wgpu::TextureView) -> wgpu::BindGroup {
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.pipelines.layouts.texture,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
            ],
        })
    }

    /// The last frame its target `at` drew offscreen, as RGBA rows, top first.
    pub fn read(&mut self, at: usize) -> Option<(u32, u32, Vec<u8>)> {
        self.targets[at].copy_out(&self.device, &self.queue)?;
        self.wait(HANG).then(|| self.targets[at].read())?
    }
}

/// What a frame's GPU did (`Work`), as the inspector and Telemetry hear it: how many device pixels each kind of thing it
/// drew covered, what it copied of the frames before, and the bytes it uploaded.
fn said(work: Work) -> serde_json::Value {
    let px = |area: f64| area.round() as u64;
    serde_json::json!({
        "quads": px(work.quads),
        "shadows": px(work.shadows),
        "sprites": px(work.sprites),
        "backdrops": px(work.backdrops),
        "rasters": px(work.rasters),
        "copied": px(work.copied),
        "uploaded": work.uploaded,
        "blurred": px(work.blurred),
        "blurs": work.blurs,
        "blurs_kept": work.blurs_kept,
        "damage": px(work.damage),
    })
}

/// The bytes of GPU memory `texture` holds.
fn bytes(texture: &wgpu::Texture) -> u64 {
    u64::from(texture.width()) * u64::from(texture.height()) * u64::from(texture.format().block_copy_size(None).unwrap_or(4))
}

fn extent(size: Size<DevicePixels>) -> (u32, u32) {
    (size.width.0.max(1) as u32, size.height.0.max(1) as u32)
}
