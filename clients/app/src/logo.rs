//! The network's own logo, kept in the app's home as the network's page is (`page`), for everywhere the app shows a
//! logo: its sign-in screen, its menu bar or tray icon, and a phone's first paint. The network serves it to anyone, on
//! a light page and a dark one (`/Logo.png`, `/Logo-dark.png`, from `apps/sign-in/edge/worker.ts`), so it's asked for
//! as the app starts, before its device is signed in, and what was kept shows with no network. A network with no logo
//! of its own has none kept, and the app shows the One App's ring.

use std::path::Path;

/// A network's logo, as PNGs.
pub(crate) struct Logo {
    pub(crate) light: Vec<u8>,
    pub(crate) dark: Vec<u8>,
}

const LIGHT: &str = "Logo.png";
const DARK: &str = "Logo-dark.png";

/// The logo kept in `home`, if there is one.
pub(crate) fn kept(home: &Path) -> Option<Logo> {
    Some(Logo { light: std::fs::read(home.join(LIGHT)).ok()?, dark: std::fs::read(home.join(DARK)).ok()? })
}

/// Asks the network for its logo and keeps it in `home`: a network with none has any kept go. → whether what's kept
/// changed.
pub(crate) async fn keep(client: &::client::Client, home: &Path) -> anyhow::Result<bool> {
    let Some(address) = client.address() else { return Ok(false) };
    let web = ::client::web()?;
    let get = async |name: &str| -> anyhow::Result<(bool, Vec<u8>)> {
        let response = web.get(format!("{}/{name}", address.trim_end_matches('/'))).send().await?.error_for_status()?;
        let own = response.headers().get("x-network-logo").is_none_or(|none| none != "none");
        Ok((own, response.bytes().await?.to_vec()))
    };
    let before = kept(home).map(|logo| (logo.light, logo.dark));
    let (own, light) = get(LIGHT).await?;
    if !own {
        let _ = std::fs::remove_file(home.join(LIGHT));
        let _ = std::fs::remove_file(home.join(DARK));
        return Ok(before.is_some());
    }
    let (_, dark) = get(DARK).await?;
    let changed = before != Some((light.clone(), dark.clone()));
    if changed {
        std::fs::create_dir_all(home)?;
        std::fs::write(home.join(LIGHT), light)?;
        std::fs::write(home.join(DARK), dark)?;
    }
    Ok(changed)
}

/// The logo as a `data:` address, as the sign-in page draws it.
pub(crate) fn data(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", data_encoding::BASE64.encode(png))
}

/// An icon for a computer's menu bar or notification area, `size` pixels square, from the logo's PNG: a Mac's is a
/// template, the logo's shape alone in black, which the menu bar colours as it does the other icons there.
#[cfg(not(mobile))]
pub(crate) fn icon(png: &[u8], size: u32, template: bool) -> Option<tray_icon::Icon> {
    tray_icon::Icon::from_rgba(rgba(png, size, template)?, size, size).ok()
}

#[cfg(not(mobile))]
fn rgba(png: &[u8], size: u32, template: bool) -> Option<Vec<u8>> {
    use resvg::tiny_skia::{FilterQuality, Pixmap, PixmapPaint, Transform};
    let mut logo = Pixmap::decode_png(png).ok()?;
    // Halved while it's more than twice what's wanted, as each pixel then averages its four, rather than skipping some.
    while logo.width() > size * 2 {
        let mut half = Pixmap::new(logo.width() / 2, logo.height() / 2)?;
        half.draw_pixmap(0, 0, logo.as_ref(), &PixmapPaint { quality: FilterQuality::Bilinear, ..PixmapPaint::default() }, Transform::from_scale(0.5, 0.5), None);
        logo = half;
    }
    let mut icon = Pixmap::new(size, size)?;
    let scale = size as f32 / logo.width().max(logo.height()) as f32;
    let (x, y) = ((size as f32 - logo.width() as f32 * scale) / 2.0, (size as f32 - logo.height() as f32 * scale) / 2.0);
    icon.draw_pixmap(0, 0, logo.as_ref(), &PixmapPaint { quality: FilterQuality::Bicubic, ..PixmapPaint::default() }, Transform::from_row(scale, 0.0, 0.0, scale, x, y), None);
    let mut rgba = Vec::with_capacity(icon.data().len());
    for pixel in icon.pixels() {
        let pixel = pixel.demultiply();
        let [r, g, b] = if template { [0, 0, 0] } else { [pixel.red(), pixel.green(), pixel.blue()] };
        rgba.extend([r, g, b, pixel.alpha()]);
    }
    Some(rgba)
}
