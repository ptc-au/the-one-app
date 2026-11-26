// Adapted from Zed's GPUI (github.com/zed-industries/zed, crates/gpui_wgpu/src/wgpu_atlas.rs at commit
// 1043f4a86ab911a381d9bfe45cf6b36d3cdcc89a, and the keys and tiles of crates/gpui/src/platform.rs at commit
// 69e2130295c2649963eb639fc70b4f2ee8ea1624), and cut down for the native host: the glyph and image atlas, its tiles
// uploaded in the commands of the next frame that draws.
// Copyright 2022 - 2025 Zed Industries, Inc. Licensed under the Apache License, Version 2.0
// (clients/app/renderer/LICENSE-APACHE); this file is changed from the original.

use super::context::Context;
use super::scene::Scene;
use crate::geometry::{Bounds, DevicePixels, Point, Size};
use crate::text::RenderGlyphParams;
use anyhow::Result;
use etagere::AtlasAllocator;
use parking_lot::Mutex;
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    ops,
};

pub struct Atlas(Mutex<AtlasState>);

/// A picture's straight BGRA or RGBA pixels (a decoder's, a browser canvas's) premultiplied by their alpha, as the atlas
/// holds every colour tile (`premultiplied`), so a texel filtered with its clear neighbours, as a picture drawn smaller
/// or between pixels is, takes none of their colour.
pub(crate) fn premultiply(pixels: &mut [u8]) {
    for pixel in pixels.chunks_exact_mut(4) {
        let alpha = u16::from(pixel[3]);
        for channel in &mut pixel[..3] {
            *channel = ((u16::from(*channel) * alpha + 127) / 255) as u8;
        }
    }
}

/// Whether every pixel of a colour tile is premultiplied by its alpha, none of its colour above it: the one way every
/// colour in the renderer is held (`Layouts::new`), checked as each tile is put in, where a debug build runs (the
/// headless renderer), so a picture put in straight, whose clear edge would darken or bleed as it's filtered, is caught there.
fn premultiplied(pixels: &[u8]) -> bool {
    pixels.chunks_exact(4).all(|pixel| pixel[..3].iter().all(|channel| *channel <= pixel[3]))
}

struct PendingUpload {
    id: AtlasTextureId,
    bounds: Bounds<DevicePixels>,
    data: Vec<u8>,
}

struct AtlasState {
    device: wgpu::Device,
    max_texture_size: i32,
    storage: AtlasStorage,
    tiles_by_key: HashMap<AtlasKey, Kept>,
    uploads: Vec<PendingUpload>,
    /// How many times what's in a tile has been drawn over (a video's next frame), or its room given to another (a
    /// glyph or a picture let go of, `trim`): a frame whose sprites are the same bytes as another's, with this the same
    /// too, looks the same. A tile added changes none a frame drew before.
    generation: u64,
    /// How many times its textures have changed, one made or let go of, whose bind groups a renderer keeps
    /// (`Renderer::atlas_group`).
    made: u64,
    /// The loop's turns it's been through (`trim`), by which it's told when each tile was last drawn.
    turn: u64,
    /// The most its textures may take, in bytes (`budget`).
    budget: u64,
    /// A texture was made past its budget since its last turn, so the tiles not drawn lately go at its next.
    over: bool,
    /// How many times it's let tiles go (`trim`).
    evictions: u64,
}

/// A tile, and the turn it was last drawn in.
struct Kept {
    tile: AtlasTile,
    used: u64,
}

/// How many of the loop's turns a glyph or a picture isn't drawn in before it may go: a few seconds of what moves,
/// longer while nothing does, as WebRender keeps what's cached for a number of frames.
const STALE: u64 = 600;

/// The most an atlas's textures may take before the glyphs and pictures not drawn lately go to make room, as
/// WebRender's texture cache and glyphon's atlas let theirs go: a 16th of what its device's pages' JS may have
/// (`js::memory_limit`, itself a 16th of the device's memory), 16 MB on a phone of 4 GB and 64 on a computer of 16. A
/// session that opens every app's every screen and plays every motion, light and dark, draws 38,000 glyphs (7 MB) and
/// 680 pictures (17 MB) (21 Nov), so on a phone those it no longer shows go, never what's on screen; what's drawn
/// lately is kept past it.
fn budget() -> u64 {
    #[cfg(not(target_arch = "wasm32"))]
    return crate::js::memory_limit() as u64 / 16;
    // The browser counts a page's textures, its own budget.
    #[cfg(target_arch = "wasm32")]
    return 16 << 20;
}

/// Whether the atlas is as a device short of memory has it (`ONE_ATLAS=starved`, which only a test sets): every turn lets
/// go of every tile the turn before didn't draw, so what's drawn again is packed anew, beside other tiles.
fn starved() -> bool {
    std::env::var("ONE_ATLAS").as_deref() == Ok("starved")
}

impl Atlas {
    pub fn new(context: &Context) -> Self {
        Atlas(Mutex::new(AtlasState {
            device: context.device.clone(),
            max_texture_size: context.device.limits().max_texture_dimension_2d as i32,
            storage: AtlasStorage::default(),
            tiles_by_key: Default::default(),
            uploads: Vec::new(),
            generation: 0,
            made: 0,
            turn: 0,
            budget: budget(),
            over: false,
            evictions: 0,
        }))
    }

    /// Writes what's been added since the last frame into its textures, in `encoder`'s commands, from `belt`, before
    /// the frame that draws it: `Queue::write_texture` would copy it in commands of the queue's own, a command encoder
    /// more each frame it's used (`Renderer::write_data`). → how many bytes: the glyphs and pictures the frame uploads;
    /// none where a staging buffer didn't map again, its device lost.
    pub(crate) fn upload(&self, encoder: &mut wgpu::CommandEncoder, belt: &mut wgpu::util::StagingBelt) -> Option<u64> {
        let mut state = self.0.lock();
        let mut uploaded = 0;
        for upload in std::mem::take(&mut state.uploads) {
            // One for a texture let go of since (`trim`) is for a glyph gone with it.
            let Some(texture) = state.storage.get(upload.id) else { continue };
            let (width, height) = (upload.bounds.size.width.0 as u32, upload.bounds.size.height.0 as u32);
            let row = width * texture.bytes_per_pixel;
            // A copy's rows are a multiple of 256 bytes apart, and it starts at a multiple of 512 (Direct3D 12's
            // placement alignment).
            let padded = row.next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
            let (Some(size), Some(alignment)) = (wgpu::BufferSize::new(u64::from(padded) * u64::from(height)), wgpu::BufferSize::new(512)) else { continue };
            let slice = belt.allocate(size, alignment);
            {
                let mut staged = slice.get_mapped_range_mut().ok()?;
                for (at, from) in upload.data.chunks(row as usize).enumerate() {
                    let start = at * padded as usize;
                    staged.slice(start..start + from.len()).copy_from_slice(from);
                }
            }
            encoder.copy_buffer_to_texture(
                wgpu::TexelCopyBufferInfo { buffer: slice.buffer(), layout: wgpu::TexelCopyBufferLayout { offset: slice.offset(), bytes_per_row: Some(padded), rows_per_image: None } },
                wgpu::TexelCopyTextureInfo {
                    texture: &texture.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x: upload.bounds.origin.x.0 as u32, y: upload.bounds.origin.y.0 as u32, z: 0 },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            );
            uploaded += upload.data.len() as u64;
        }
        Some(uploaded)
    }

    /// How many times its textures have changed (`AtlasState::made`).
    pub(crate) fn made(&self) -> u64 {
        self.0.lock().made
    }

    /// The widest and tallest a tile can be: its GPU's largest texture.
    pub(crate) fn largest(&self) -> i32 {
        self.0.lock().max_texture_size
    }

    /// How many times what's in it has changed (`AtlasState::generation`).
    pub(crate) fn generation(&self) -> u64 {
        self.0.lock().generation
    }

    /// How many times it's let tiles go (`trim`), which what keeps a picture's size in it forgets then
    /// (`Pictures::evicted`).
    pub(crate) fn evictions(&self) -> u64 {
        self.0.lock().evictions
    }

    /// What it holds, for the inspector's `profile`: its `tiles` (`glyphs` and pictures), its `textures`, the `bytes`
    /// they take on the GPU and its `budget`, how much of them its tiles fill (`filled`, 0 to 1), and how many
    /// times it's let tiles go (`evictions`).
    pub fn usage(&self) -> serde_json::Value {
        let lock = self.0.lock();
        let textures: Vec<&AtlasTexture> = lock.storage.textures().collect();
        let area: u64 = textures.iter().map(|texture| texture.allocator.size().area() as u64).sum();
        let filled: u64 = textures.iter().map(|texture| texture.allocator.allocated_space() as u64).sum();
        let filled = if area == 0 { 0.0 } else { (filled as f64 / area as f64 * 1000.0).round() / 1000.0 };
        let glyphs = lock.tiles_by_key.keys().filter(|key| matches!(key, AtlasKey::Glyph(_))).count();
        serde_json::json!({"tiles": lock.tiles_by_key.len(), "glyphs": glyphs, "textures": textures.len(), "bytes": lock.storage.bytes(), "budget": lock.budget, "filled": filled, "evictions": lock.evictions})
    }

    /// A turn of the loop, before anything's painted in it: where a texture was made past its budget since the last,
    /// every glyph and picture not drawn in the last `STALE` turns goes, and each texture left empty with them, as
    /// glyphon's atlas and WebRender's texture cache let theirs go; what's drawn after puts any of them it draws in
    /// again, a glyph rasterized as it's drawn and a picture decoded in the background (`view::pictures`). Never what
    /// `keeps` gives, asked only then: the scenes its windows show or keep (a scene a frame that changes nothing keeps,
    /// a layer's), which a frame may draw again without looking any of it up, so what's kept is never painted afresh
    /// for it and nothing on screen goes blank while it's decoded again; and the pictures by their keys that each
    /// window last painted, shown or not, however long ago, which a frame that shows them has at once. Never in the
    /// middle of a frame, so no scene being made loses a tile it has. → whether any went.
    pub(crate) fn trim<'a>(&self, keeps: impl FnOnce(&mut Vec<&'a Scene>, &mut Vec<u64>)) -> bool {
        let mut lock = self.0.lock();
        let state = &mut *lock;
        state.turn += 1;
        let starved = starved();
        if !std::mem::take(&mut state.over) && !starved {
            return false;
        }
        let (mut scenes, mut pictures) = (Vec::new(), Vec::new());
        keeps(&mut scenes, &mut pictures);
        let mut drawn = HashSet::new();
        for scene in scenes {
            tiles(scene, &mut drawn);
        }
        let pictures: HashSet<u64> = pictures.into_iter().collect();
        let stale = if starved { state.turn.saturating_sub(1) } else { state.turn.saturating_sub(STALE) };
        let storage = &mut state.storage;
        let before = state.tiles_by_key.len();
        state.tiles_by_key.retain(|key, kept| {
            let keep = kept.used >= stale || drawn.contains(&(kept.tile.texture_id, kept.tile.tile_id)) || matches!(key, AtlasKey::Image(id) if pictures.contains(id));
            if !keep && let Some(texture) = storage.get_mut(kept.tile.texture_id) {
                texture.allocator.deallocate(etagere::AllocId::deserialize(kept.tile.tile_id.0));
            }
            keep
        });
        if state.tiles_by_key.len() == before {
            return false;
        }
        for slot in storage.monochrome_textures.iter_mut().chain(&mut storage.polychrome_textures) {
            if slot.as_ref().is_some_and(|texture| texture.allocator.is_empty()) {
                *slot = None;
                state.made += 1;
            }
        }
        state.generation += 1;
        state.evictions += 1;
        true
    }

    /// Whether it has `key`, which nothing's let go of since it was put in (`trim`).
    pub(crate) fn contains(&self, key: &AtlasKey) -> bool {
        self.0.lock().tiles_by_key.contains_key(key)
    }

    /// The view of texture `id`, which a batch of sprites samples.
    pub(crate) fn view(&self, id: AtlasTextureId) -> wgpu::TextureView {
        self.0.lock().storage.get(id).expect("a frame draws only the tiles it has, none of which goes while it's made (`trim`)").view.clone()
    }

    /// Writes `data`, `size` pixels in its format (a video's frame, BGRA), into `tile`, inside its clear pixel all round,
    /// before the next frame that draws it.
    pub(crate) fn write(&self, tile: &AtlasTile, size: Size<DevicePixels>, data: Vec<u8>) {
        let bounds = crate::geometry::Bounds { origin: crate::geometry::point(tile.bounds.origin.x + DevicePixels(1), tile.bounds.origin.y + DevicePixels(1)), size };
        debug_assert!(premultiplied(&data), "a video's frame is put in the atlas premultiplied");
        let mut lock = self.0.lock();
        lock.generation += 1;
        lock.uploads.push(PendingUpload { id: tile.texture_id, bounds, data });
    }

    pub(crate) fn get_or_insert_with<'a>(
        &self,
        key: &AtlasKey,
        build: &mut dyn FnMut() -> Result<Option<(Size<DevicePixels>, Cow<'a, [u8]>)>>,
    ) -> Result<Option<AtlasTile>> {
        let mut lock = self.0.lock();
        let turn = lock.turn;
        if let Some(kept) = lock.tiles_by_key.get_mut(key) {
            kept.used = turn;
            return Ok(Some(kept.tile.clone()));
        }
        let Some((size, bytes)) = build()? else {
            return Ok(None);
        };
        // What's larger than any texture its GPU makes isn't drawn: its maker draws it smaller (`view::pictures`).
        let largest = lock.max_texture_size;
        if size.width.0 > largest || size.height.0 > largest {
            anyhow::bail!("a tile of {} × {} pixels is larger than this GPU's largest texture, {largest}", size.width.0, size.height.0);
        }
        debug_assert!(key.texture_kind() == AtlasTextureKind::Monochrome || premultiplied(&bytes), "a colour tile is put in the atlas premultiplied by its alpha: {key:?}");
        let tile = lock.allocate(size, key.texture_kind());
        lock.uploads.push(PendingUpload { id: tile.texture_id, bounds: tile.bounds, data: bytes.into_owned() });
        lock.tiles_by_key.insert(key.clone(), Kept { tile: tile.clone(), used: turn });
        Ok(Some(tile))
    }
}

/// The tiles `scene` draws, and those of the pictures it draws from their tiles (`Scene::tiles`), each scene once.
fn tiles(scene: &Scene, into: &mut HashSet<(AtlasTextureId, TileId)>) {
    into.extend(scene.monochrome_sprites.iter().map(|sprite| (sprite.tile.texture_id, sprite.tile.tile_id)));
    into.extend(scene.polychrome_sprites.iter().map(|sprite| (sprite.tile.texture_id, sprite.tile.tile_id)));
    let mut seen = HashSet::new();
    for tile in scene.tiles.iter().filter(|tile| seen.insert(std::sync::Arc::as_ptr(&tile.scene))) {
        tiles(&tile.scene, into);
    }
}

impl AtlasState {
    fn allocate(&mut self, size: Size<DevicePixels>, kind: AtlasTextureKind) -> AtlasTile {
        if let Some(tile) = self.storage[kind].iter_mut().rev().flatten().find_map(|texture| texture.allocate(size)) {
            return tile;
        }
        let texture = self.push_texture(size, kind);
        let tile = texture.allocate(size).expect("a new texture is at least as large as the tile");
        self.over |= self.storage.bytes() > self.budget;
        tile
    }

    fn push_texture(&mut self, min_size: Size<DevicePixels>, kind: AtlasTextureKind) -> &mut AtlasTexture {
        const DEFAULT_ATLAS_SIZE: Size<DevicePixels> = Size { width: DevicePixels(1024), height: DevicePixels(1024) };
        let side = |at_least: DevicePixels, default: DevicePixels| DevicePixels(at_least.0.min(self.max_texture_size).max(default.0));
        let size = Size { width: side(min_size.width, DEFAULT_ATLAS_SIZE.width), height: side(min_size.height, DEFAULT_ATLAS_SIZE.height) };
        // A glyph's coverage, or an image's or an emoji's colours, as the text systems and the image decoder give
        // them: blue, green, red, alpha, in a texture of four channels that the shader reads in that order
        // (`fs_poly_sprite`), as WebGL2 can't upload BGRA.
        let format = match kind {
            AtlasTextureKind::Monochrome => wgpu::TextureFormat::R8Unorm,
            AtlasTextureKind::Polychrome => wgpu::TextureFormat::Rgba8Unorm,
        };
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width: size.width.0 as u32, height: size.height.0 as u32, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.made += 1;
        // In the place of one let go of (`trim`), where there's one.
        let list = &mut self.storage[kind];
        let index = list.iter().position(Option::is_none).unwrap_or(list.len());
        if index == list.len() {
            list.push(None);
        }
        list[index].insert(AtlasTexture {
            id: AtlasTextureId { index: index as u32, kind },
            allocator: AtlasAllocator::new(size.into()),
            texture,
            view,
            bytes_per_pixel: format.block_copy_size(None).unwrap_or(4),
        })
    }
}

/// Its textures of each kind: a texture's id is where it is in its list, a place left empty where one was let go of
/// (`Atlas::trim`).
#[derive(Default)]
struct AtlasStorage {
    monochrome_textures: Vec<Option<AtlasTexture>>,
    polychrome_textures: Vec<Option<AtlasTexture>>,
}

impl AtlasStorage {
    fn textures(&self) -> impl Iterator<Item = &AtlasTexture> {
        self.monochrome_textures.iter().chain(&self.polychrome_textures).flatten()
    }

    /// The bytes its textures take on the GPU.
    fn bytes(&self) -> u64 {
        self.textures().map(|texture| texture.allocator.size().area() as u64 * u64::from(texture.bytes_per_pixel)).sum()
    }

    fn get(&self, id: AtlasTextureId) -> Option<&AtlasTexture> {
        self[id.kind].get(id.index as usize)?.as_ref()
    }

    fn get_mut(&mut self, id: AtlasTextureId) -> Option<&mut AtlasTexture> {
        self[id.kind].get_mut(id.index as usize)?.as_mut()
    }
}

impl ops::Index<AtlasTextureKind> for AtlasStorage {
    type Output = Vec<Option<AtlasTexture>>;
    fn index(&self, kind: AtlasTextureKind) -> &Self::Output {
        match kind {
            AtlasTextureKind::Monochrome => &self.monochrome_textures,
            AtlasTextureKind::Polychrome => &self.polychrome_textures,
        }
    }
}

impl ops::IndexMut<AtlasTextureKind> for AtlasStorage {
    fn index_mut(&mut self, kind: AtlasTextureKind) -> &mut Self::Output {
        match kind {
            AtlasTextureKind::Monochrome => &mut self.monochrome_textures,
            AtlasTextureKind::Polychrome => &mut self.polychrome_textures,
        }
    }
}

struct AtlasTexture {
    id: AtlasTextureId,
    allocator: AtlasAllocator,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    bytes_per_pixel: u32,
}

impl AtlasTexture {
    fn allocate(&mut self, size: Size<DevicePixels>) -> Option<AtlasTile> {
        let allocation = self.allocator.allocate(size.into())?;
        Some(AtlasTile {
            texture_id: self.id,
            tile_id: allocation.id.into(),
            padding: 0,
            bounds: Bounds { origin: allocation.rectangle.min.into(), size },
        })
    }
}

/// What a tile in the atlas is of: a glyph, or an image by its bytes' hash.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum AtlasKey {
    Glyph(RenderGlyphParams),
    Image(u64),
}

impl AtlasKey {
    fn texture_kind(&self) -> AtlasTextureKind {
        match self {
            AtlasKey::Glyph(params) if params.is_emoji => AtlasTextureKind::Polychrome,
            AtlasKey::Glyph(_) => AtlasTextureKind::Monochrome,
            AtlasKey::Image(_) => AtlasTextureKind::Polychrome,
        }
    }
}

/// Where a tile is in the atlas, as the shaders read it (`AtlasTile` in shaders.wgsl).
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(C)]
pub(crate) struct AtlasTile {
    pub(crate) texture_id: AtlasTextureId,
    pub(crate) tile_id: TileId,
    pub(crate) padding: u32,
    pub(crate) bounds: Bounds<DevicePixels>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(C)]
pub(crate) struct AtlasTextureId {
    // We use u32 instead of usize for Metal Shader Language compatibility
    pub(crate) index: u32,
    pub(crate) kind: AtlasTextureKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(C)]
pub(crate) enum AtlasTextureKind {
    Monochrome = 0,
    Polychrome = 1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(C)]
pub(crate) struct TileId(pub(crate) u32);

impl From<etagere::AllocId> for TileId {
    fn from(id: etagere::AllocId) -> Self {
        Self(id.serialize())
    }
}

impl From<Size<DevicePixels>> for etagere::Size {
    fn from(size: Size<DevicePixels>) -> Self {
        etagere::Size::new(size.width.into(), size.height.into())
    }
}

impl From<etagere::Point> for Point<DevicePixels> {
    fn from(value: etagere::Point) -> Self {
        Point { x: DevicePixels::from(value.x), y: DevicePixels::from(value.y) }
    }
}
