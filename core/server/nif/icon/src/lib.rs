//! An app's icon as a deploy checks it (`OneCore.Apps.Deploy`): a square, opaque to its corners, which every client
//! clips to the same squircle, as iOS does with an app's icon. A picture is drawn as a client draws it, an SVG by
//! resvg, the renderer's, and anything else by the image crate, and its four corner pixels are read.

use resvg::{tiny_skia, usvg};

/// How many pixels across an SVG is drawn to read its corners.
const SIDE: u32 = 64;

/// Whether `data`, a picture of the MIME type `kind`, is a square opaque to its corners: `Ok(())`, or why not.
#[rustler::nif(schedule = "DirtyCpu")]
fn check(data: rustler::Binary, kind: String) -> Result<(), String> {
    let (width, height, corners) = if kind.starts_with("image/svg") {
        let tree = usvg::Tree::from_data(data.as_slice(), &usvg::Options::default()).map_err(|error| format!("it isn't an SVG that can be drawn: {error}"))?;
        let size = tree.size();
        let mut pixmap = tiny_skia::Pixmap::new(SIDE, SIDE).ok_or("it can't be drawn")?;
        resvg::render(&tree, tiny_skia::Transform::from_scale(SIDE as f32 / size.width(), SIDE as f32 / size.height()), &mut pixmap.as_mut());
        let alpha = |x: u32, y: u32| pixmap.pixel(x, y).map_or(0, |pixel| pixel.alpha());
        (size.width(), size.height(), [alpha(0, 0), alpha(SIDE - 1, 0), alpha(0, SIDE - 1), alpha(SIDE - 1, SIDE - 1)])
    } else {
        let picture = image::load_from_memory(data.as_slice()).map_err(|error| format!("it isn't a picture that can be read: {error}"))?.to_rgba8();
        let (w, h) = picture.dimensions();
        let alpha = |x: u32, y: u32| picture.get_pixel(x, y)[3];
        (w as f32, h as f32, [alpha(0, 0), alpha(w - 1, 0), alpha(0, h - 1), alpha(w - 1, h - 1)])
    };
    if (width - height).abs() > width.max(height) / 100.0 {
        return Err(format!("it's {width}×{height}, not a square"));
    }
    if corners.iter().any(|&alpha| alpha < 255) {
        return Err("its corners can be seen through: it has a shape of its own, or no background".into());
    }
    Ok(())
}

include!(concat!(env!("OUT_DIR"), "/init.rs"));
