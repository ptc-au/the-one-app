//! What each pipeline binds and which shaders it runs, as plain data, which the renderer makes its bind group layouts
//! and pipelines from, and `build.rs` its Direct3D 12 shaders from, ahead of time: a binding's place in its group is
//! its `@binding`. A batch's instances aren't bound: they're its vertex data (`scene::Instance`).

/// A binding of a group, seen from every stage.
#[derive(Clone, Copy)]
pub enum Binding {
    Uniform,
    Texture { filterable: bool },
    Sampler,
}

/// Group 0: the frame's globals, its gamma and the blue noise it dithers with.
pub const GLOBALS: &[Binding] = &[Binding::Uniform, Binding::Uniform, Binding::Texture { filterable: false }];
/// Group 2, where a pipeline samples a texture: the texture and its sampler.
pub const TEXTURE: &[Binding] = &[Binding::Texture { filterable: true }, Binding::Sampler];

/// Group 1, a blur pass's: its parameters.
pub const BLUR_PARAMS: &[Binding] = &[Binding::Uniform];

/// A pipeline's shaders, whether it's a blur pass's, which binds its parameters, and whether it samples a texture.
pub struct Pipeline {
    pub vertex: &'static str,
    pub fragment: &'static str,
    pub blurs: bool,
    pub samples: bool,
}

impl Pipeline {
    /// Its bind groups, in order, which `build.rs` binds its shaders by: none where it binds nothing.
    #[allow(dead_code)]
    pub fn groups(&self) -> [&'static [Binding]; 3] {
        [GLOBALS, if self.blurs { BLUR_PARAMS } else { &[] }, if self.samples { TEXTURE } else { &[] }]
    }
}

const fn drawing(vertex: &'static str, fragment: &'static str, samples: bool) -> Pipeline {
    Pipeline { vertex, fragment, blurs: false, samples }
}

pub const QUADS: Pipeline = drawing("vs_quad", "fs_quad", false);
pub const SHADOWS: Pipeline = drawing("vs_shadow", "fs_shadow", false);
pub const UNDERLINES: Pipeline = drawing("vs_underline", "fs_underline", false);
pub const MONO_SPRITES: Pipeline = drawing("vs_mono_sprite", "fs_mono_sprite", true);
pub const POLY_SPRITES: Pipeline = drawing("vs_poly_sprite", "fs_poly_sprite", true);
pub const RASTERS: Pipeline = drawing("vs_raster", "fs_raster", true);
pub const SHADOW_COVERAGE: Pipeline = drawing("vs_shadow_whole", "fs_shadow_coverage", false);
pub const SHADOW_TILES: Pipeline = drawing("vs_shadow", "fs_shadow_tile", true);
pub const BACKDROPS: Pipeline = drawing("vs_backdrop", "fs_backdrop", true);
/// What clears a frame where it's drawn again (`fs_clear`), over the whole target as a blur's passes are.
pub const CLEAR: Pipeline = drawing("vs_blur", "fs_clear", false);
pub const BLUR: Pipeline = Pipeline { vertex: "vs_blur", fragment: "fs_blur", blurs: true, samples: true };

/// Every pipeline the renderer draws with, which `build.rs` compiles Windows' shaders for.
#[allow(dead_code)]
pub const PIPELINES: &[Pipeline] = &[QUADS, SHADOWS, UNDERLINES, MONO_SPRITES, POLY_SPRITES, RASTERS, SHADOW_COVERAGE, SHADOW_TILES, BACKDROPS, BLUR, CLEAR];
