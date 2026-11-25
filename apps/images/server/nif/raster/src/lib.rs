//! Photos and PDF pages for a server's apps: the images app's NIF, which its Elixir loads as `Raster`. A photo (JPEG,
//! PNG or WebP, turned upright as its camera recorded) or a page of a PDF is opened, drawn on, cropped, made smaller and
//! given back as a JPEG, so what reads it or shows it is small.

use std::io::Cursor;

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{PixmapSettings, RenderCache, RenderSettings};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageReader, Rgb, RgbImage};
use rustler::{Binary, Env, NewBinary, NifMap};

/// What to make of a file. Fractions are of the picture from its top left, 0 to 1.
#[derive(NifMap)]
struct Options {
    /// A PDF's page, from 0.
    page: usize,
    /// A PDF's page is drawn with its long side this many pixels before it's cropped.
    render: u32,
    /// What to keep, `[left, top, right, bottom]`, or nothing for all of it.
    crop: Vec<f64>,
    /// The long side it's made smaller to, if it's bigger.
    max: u32,
    /// Made bigger to `max` too.
    enlarge: bool,
    /// JPEG quality, 1 to 100.
    quality: u8,
    /// Rectangles drawn over, each `[left, top, right, bottom]`, before it's cropped.
    cover: Vec<Vec<f64>>,
}

/// The picture as a JPEG, with its width and height: `{:ok, {jpeg, width, height}}`.
#[rustler::nif(schedule = "DirtyCpu")]
fn render<'a>(env: Env<'a>, file: Binary, options: Options) -> Result<(Binary<'a>, u32, u32), String> {
    let mut picture = open(file.as_slice(), &options)?.to_rgb8();
    for rectangle in &options.cover {
        cover(&mut picture, rectangle);
    }
    let mut picture = DynamicImage::ImageRgb8(picture);
    if let [left, top, right, bottom] = options.crop[..] {
        let (width, height) = (picture.width() as f64, picture.height() as f64);
        let x = (left.clamp(0.0, 1.0) * width).round() as u32;
        let y = (top.clamp(0.0, 1.0) * height).round() as u32;
        let w = ((right.clamp(0.0, 1.0) * width).round() as u32).saturating_sub(x).max(1);
        let h = ((bottom.clamp(0.0, 1.0) * height).round() as u32).saturating_sub(y).max(1);
        picture = picture.crop_imm(x, y, w, h);
    }
    let long = picture.width().max(picture.height());
    if options.max > 0 && (long > options.max || options.enlarge && long != options.max) {
        let scale = options.max as f64 / long as f64;
        let width = ((picture.width() as f64 * scale).round() as u32).max(1);
        let height = ((picture.height() as f64 * scale).round() as u32).max(1);
        picture = picture.resize_exact(width, height, FilterType::Lanczos3);
    }
    let (width, height) = (picture.width(), picture.height());
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, options.quality.clamp(1, 100))
        .encode_image(&picture.to_rgb8())
        .map_err(|error| error.to_string())?;
    let mut out = NewBinary::new(env, jpeg.len());
    out.as_mut_slice().copy_from_slice(&jpeg);
    Ok((out.into(), width, height))
}

/// A PDF's pages, each whether it's typed: it shows text, not only a scan.
#[rustler::nif(schedule = "DirtyCpu")]
fn pdf(file: Binary) -> Result<Vec<bool>, String> {
    let pdf = Pdf::new(file.as_slice().to_vec()).map_err(|error| format!("{error:?}"))?;
    Ok(pdf.pages().iter().map(|page| typed(page.page_stream().unwrap_or_default())).collect())
}

fn open(file: &[u8], options: &Options) -> Result<DynamicImage, String> {
    if file.starts_with(b"%PDF") {
        return page(file, options);
    }
    let mut decoder = ImageReader::new(Cursor::new(file))
        .with_guessed_format()
        .map_err(|error| error.to_string())?
        .into_decoder()
        .map_err(|error| error.to_string())?;
    let orientation = decoder.orientation().map_err(|error| error.to_string())?;
    let mut picture = DynamicImage::from_decoder(decoder).map_err(|error| error.to_string())?;
    picture.apply_orientation(orientation);
    Ok(picture)
}

/// A PDF's page, drawn on white with its long side `options.render` pixels.
fn page(file: &[u8], options: &Options) -> Result<DynamicImage, String> {
    let pdf = Pdf::new(file.to_vec()).map_err(|error| format!("{error:?}"))?;
    let pages = pdf.pages();
    let page = pages.get(options.page).ok_or("the PDF has no such page")?;
    let (width, height) = page.render_dimensions();
    let scale = options.render.max(1) as f32 / width.max(height).max(1.0);
    let pixmap = hayro::render(
        page,
        &RenderCache::new(),
        &InterpreterSettings::default(),
        &RenderSettings::default(),
        &PixmapSettings { x_scale: scale, y_scale: scale, bg_color: WHITE },
    );
    let picture = image::RgbaImage::from_raw(pixmap.width() as u32, pixmap.height() as u32, pixmap.data_as_u8_slice().to_vec())
        .ok_or("the page didn't draw")?;
    Ok(DynamicImage::ImageRgba8(picture))
}

fn cover(picture: &mut RgbImage, rectangle: &[f64]) {
    let [left, top, right, bottom] = rectangle[..] else { return };
    let (width, height) = (picture.width() as f64, picture.height() as f64);
    let x0 = (left.clamp(0.0, 1.0) * width).floor() as u32;
    let x1 = ((right.clamp(0.0, 1.0) * width).ceil() as u32).min(picture.width());
    let y0 = (top.clamp(0.0, 1.0) * height).floor() as u32;
    let y1 = ((bottom.clamp(0.0, 1.0) * height).ceil() as u32).min(picture.height());
    for y in y0..y1 {
        for x in x0..x1 {
            picture.put_pixel(x, y, Rgb([55, 55, 55]));
        }
    }
}

/// Whether a page's drawing instructions show 20 characters of text or more: what its fonts print in `Tj` and `TJ`.
fn typed(stream: &[u8]) -> bool {
    let mut characters = 0usize;
    let mut i = 0;
    while i < stream.len() {
        match stream[i] {
            b'(' => {
                let mut depth = 1;
                i += 1;
                while i < stream.len() && depth > 0 {
                    match stream[i] {
                        b'\\' => i += 1,
                        b'(' => depth += 1,
                        b')' => depth -= 1,
                        byte if !byte.is_ascii_whitespace() => characters += 1,
                        _ => {}
                    }
                    i += 1;
                }
            }
            b'<' if stream.get(i + 1) != Some(&b'<') => {
                // A hex string: two bytes of glyph ids for each character.
                let end = stream[i..].iter().position(|&byte| byte == b'>').map_or(stream.len(), |at| i + at);
                characters += stream[i + 1..end].iter().filter(|byte| byte.is_ascii_hexdigit()).count() / 4;
                i = end + 1;
            }
            b'<' => i += 2,
            _ => i += 1,
        }
    }
    characters >= 20
}

include!(concat!(env!("OUT_DIR"), "/init.rs"));
