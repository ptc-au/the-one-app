//! Each app's menu bar extra (`menu_bar_extra/0`, `OneCore.App`): its icon in a Mac's menu bar, in Windows'
//! notification area and in a Linux panel, beside the ring (`ring`), and its page in a panel under it, as Slack's, Roam's
//! and Raycast's are. A click shows the panel, and a click anywhere else, or on the icon again, puts it away; on Windows
//! and Linux a right click has a menu of Open <App> and Quit, as the ring's does. Its page opens, put away, as soon as its
//! app is listed, and runs for as long as the One App does, the same page whether the panel shows or not, so it keeps
//! what it holds open (a call, a person's presence) and hears what comes while nobody's looking. It changes the icon's
//! title and icon, and shows its panel itself (`changed`). Every app's page and icon are listed with its others
//! (`listed`), and what's kept here, its icons, is the main thread's, as the system has them made there.

use std::collections::HashMap;

use renderer::geometry::{Bounds, Point, Size};
use renderer::platform::WindowId;
use serde_json::Value;
use tray_icon::{TrayIcon, TrayIconBuilder};

use super::{Told as Main, on_native, tell};

/// How large a menu bar extra's panel is, in points, until its page says (`sizeChanged`): a menu bar app's, as Slack's
/// and Raycast's are.
pub(crate) const SIZE: Size<f64> = Size { width: 380.0, height: 520.0 };

/// What the main thread is told of menu bar extras.
pub(crate) enum Told {
    /// The menu bar extras the person's apps have, as their apps are listed now.
    Listed(Vec<Declared>),
    /// The page `page` opened in its panel, this window, or didn't.
    Opened(String, Option<WindowId>),
    /// A panel closed, as its page stopped, or the device's session started again.
    Closed(WindowId),
    /// An app's icon was clicked, by its app.
    Clicked(String),
    /// An app's page changed its icon: its `title`, its `icon`, or whether its panel is `open`.
    Changed(String, Value),
}

/// A menu bar extra as its app has it: its page, `<app>/<path>`, its app's name, and its icon, as a `data:` address.
#[derive(Clone, PartialEq)]
pub(crate) struct Declared {
    page: String,
    name: String,
    icon: String,
}

impl Declared {
    fn app(&self) -> &str {
        self.page.split('/').next().unwrap_or_default()
    }
}

/// The menu bar extras listed, as the apps of the person signed in on this device have them: each app's once, though
/// it's listed for each of its copies (a group's too).
pub(crate) fn listed(listed: &Value) {
    let mut apps = std::collections::HashSet::new();
    let declared = listed["resources"].as_array().into_iter().flatten().filter_map(|resource| {
        let icon = resource["_meta"]["menuBarExtra"]["icon"].as_str()?.to_owned();
        let mut parts = resource["uri"].as_str()?.strip_prefix("ui://")?.split('/');
        let (app, _version) = (parts.next()?, parts.next()?);
        let page = format!("{app}/{}", parts.collect::<Vec<_>>().join("/"));
        let name = resource["name"].as_str().filter(|name| !name.is_empty()).unwrap_or(app).to_owned();
        apps.insert(app.to_owned()).then_some(Declared { page, name, icon })
    });
    tell(Main::MenuBar(Told::Listed(declared.collect())));
}

/// What an app's page changed of its menu bar extra (`one/menu-bar-extra`): its `title`, its `icon`, or whether its
/// panel is `open`.
pub(crate) fn changed(app: &str, change: Value) {
    tell(Main::MenuBar(Told::Changed(app.to_owned(), change)));
}

/// A panel closed.
pub(crate) fn closed(id: WindowId) {
    tell(Main::MenuBar(Told::Closed(id)));
}

/// What's chosen in an app's menu (Open <App>), as muda says it, if it's one: its app opens in its own window.
pub(crate) fn chosen(id: &str) -> bool {
    let Some(app) = id.strip_prefix("menu-bar-extra:") else { return false };
    tell(Main::Open(app.to_owned()));
    true
}

/// A click on an icon, as tray-icon says it, by its id, if it's an app's (`menu-bar-extra:<app>`).
pub(crate) fn clicked(id: &str) {
    if let Some(app) = id.strip_prefix("menu-bar-extra:") {
        tell(Main::MenuBar(Told::Clicked(app.to_owned())));
    }
}

/// Each app's menu bar extra, by its app, as the main thread keeps it.
#[derive(Default)]
pub(crate) struct Extras(HashMap<String, Extra>);

struct Extra {
    declared: Declared,
    icon: TrayIcon,
    /// Its panel, once its page has opened in it.
    window: Option<WindowId>,
    opening: bool,
    /// Its panel shows once its page has opened: it was clicked, or asked to, before.
    wanted: bool,
    /// What its page changed: the title beside its icon, and the Phosphor icon in its app's icon's place.
    title: Option<String>,
    symbol: Option<String>,
}

impl Extras {
    pub(crate) fn told(&mut self, told: Told) {
        match told {
            Told::Listed(listed) => self.listed(listed),
            Told::Opened(page, id) => match self.0.values_mut().find(|extra| extra.opening && extra.declared.page == page) {
                Some(extra) => {
                    extra.opening = false;
                    extra.window = id;
                    if std::mem::take(&mut extra.wanted) {
                        extra.show(true);
                    }
                }
                // Its app was taken out of the menu bar as it opened.
                None => {
                    if let Some(id) = id {
                        on_native(move |windows| crate::native::close_window(windows, id));
                    }
                }
            },
            Told::Closed(id) => {
                for extra in self.0.values_mut().filter(|extra| extra.window == Some(id)) {
                    extra.window = None;
                }
            }
            Told::Clicked(app) => {
                if let Some(extra) = self.0.get_mut(&app) {
                    extra.toggle();
                }
            }
            Told::Changed(app, change) => {
                if let Some(extra) = self.0.get_mut(&app) {
                    extra.changed(&change);
                }
            }
        }
    }

    /// The menu bar has the extras `listed`, and every one's page is open: one gone goes, its panel with it, and one
    /// whose panel closed opens again, as the device's session started again.
    fn listed(&mut self, listed: Vec<Declared>) {
        self.0.retain(|app, extra| {
            let kept = listed.iter().any(|declared| declared.app() == app);
            if !kept && let Some(id) = extra.window {
                on_native(move |windows| crate::native::close_window(windows, id));
            }
            kept
        });
        for declared in listed {
            let app = declared.app().to_owned();
            match self.0.get_mut(&app) {
                Some(extra) => {
                    if extra.declared.page != declared.page && let Some(id) = extra.window.take() {
                        on_native(move |windows| crate::native::close_window(windows, id));
                    }
                    let drawn = extra.declared.icon != declared.icon;
                    extra.declared = declared;
                    if drawn {
                        extra.draw();
                    }
                }
                None => {
                    let Some(extra) = Extra::new(declared) else { continue };
                    self.0.insert(app.clone(), extra);
                }
            }
            let extra = self.0.get_mut(&app).expect("it's there");
            if extra.window.is_none() && !extra.opening {
                extra.open();
            }
        }
    }
}

impl Extra {
    /// Its icon in the menu bar, from its app's, with a menu of Open <App> and Quit, which a Mac's left click doesn't
    /// open.
    fn new(declared: Declared) -> Option<Extra> {
        use tray_icon::menu::{Menu, MenuItem, PredefinedMenuItem};
        let app = declared.app().to_owned();
        let open = MenuItem::with_id(format!("menu-bar-extra:{app}"), format!("Open {}", declared.name), true, None);
        let quit = MenuItem::with_id("quit", format!("Quit {}", ::client::app_name()), true, None);
        let menu = Menu::with_items(&[&open, &PredefinedMenuItem::separator(), &quit]).ok()?;
        let built = TrayIconBuilder::new()
            .with_id(format!("menu-bar-extra:{app}"))
            .with_icon(image(&declared.icon, None)?)
            .with_icon_as_template(cfg!(target_os = "macos"))
            .with_menu(Box::new(menu))
            .with_menu_on_left_click(false)
            .with_tooltip(&declared.name)
            .build();
        let icon = built.map_err(|error| eprintln!("{app} has no menu bar extra: {error}")).ok()?;
        Some(Extra { declared, icon, window: None, opening: false, wanted: false, title: None, symbol: None })
    }

    /// Opens its page in its panel, put away.
    fn open(&mut self) {
        self.opening = true;
        let page = self.declared.page.clone();
        crate::spawn(async move {
            let id = crate::native::menu_bar_extra(&page).await;
            tell(Main::MenuBar(Told::Opened(page, id)));
        });
    }

    /// Shows its panel under its icon, or puts it away, as a click on its icon does.
    fn toggle(&mut self) {
        let Some(id) = self.window else {
            self.wanted = true;
            if !self.opening {
                self.open();
            }
            return;
        };
        let under = self.under();
        on_native(move |windows| {
            if windows.showing(id) {
                windows.put_away(id, true)
            } else {
                windows.summon_under(id, std::time::Instant::now(), under)
            }
        });
    }

    /// Shows its panel, or puts it away, as its page asks.
    fn show(&mut self, shown: bool) {
        let Some(id) = self.window else {
            self.wanted = shown;
            return;
        };
        let under = self.under();
        on_native(move |windows| match shown {
            true => windows.summon_under(id, std::time::Instant::now(), under),
            false => windows.put_away(id, true),
        });
    }

    /// Where its icon is on the screen, as the system says, where it does: a Linux panel's doesn't.
    fn under(&self) -> Option<Bounds<f32>> {
        let rect = self.icon.rect()?;
        Some(Bounds { origin: Point { x: rect.position.x as f32, y: rect.position.y as f32 }, size: Size { width: rect.size.width as f32, height: rect.size.height as f32 } })
    }

    /// What its page changed: the title beside its icon (`null` for none), its icon, one of Phosphor's by its name or
    /// `null` for its app's own, and whether its panel shows.
    fn changed(&mut self, change: &Value) {
        if let Some(title) = change.get("title") {
            self.title = title.as_str().filter(|title| !title.is_empty()).map(str::to_owned);
            // Windows' notification area has no title: its tooltip says it.
            #[cfg(windows)]
            let _ = self.icon.set_tooltip(Some(self.title.as_ref().map_or_else(|| self.declared.name.clone(), |title| format!("{}: {title}", self.declared.name))));
            #[cfg(not(windows))]
            self.icon.set_title(self.title.as_deref());
        }
        if let Some(symbol) = change.get("icon") {
            self.symbol = symbol.as_str().map(str::to_owned);
            self.draw();
        }
        if let Some(open) = change.get("open").and_then(Value::as_bool) {
            self.show(open);
        }
    }

    /// Draws its icon again: its page's Phosphor icon, or its app's.
    fn draw(&self) {
        let Some(image) = image(&self.declared.icon, self.symbol.as_deref()) else {
            return eprintln!("{} has no icon named {:?}", self.declared.app(), self.symbol);
        };
        // A Mac's is a template again, which `set_icon` would end.
        #[cfg(target_os = "macos")]
        let _ = self.icon.set_icon_with_as_template(Some(image), true);
        #[cfg(not(target_os = "macos"))]
        let _ = self.icon.set_icon(Some(image));
    }
}

/// An icon for the menu bar, from its app's (a `data:` address of an SVG or a PNG) or Phosphor's `symbol`, by its name,
/// in one colour: a Mac's is a template, its shape alone, which the menu bar colours as it does its other icons; Windows'
/// is white on a dark taskbar and black on a light one, and a Linux panel's white, as its panels are dark.
fn image(icon: &str, symbol: Option<&str>) -> Option<tray_icon::Icon> {
    // A Mac's menu bar icon is 18 points, here at 2x; a notification area's is 16 at 100%, here at 200%.
    let side = if cfg!(target_os = "macos") { 36 } else { 32 };
    let drawn = match symbol {
        Some(symbol) => {
            let at = PHOSPHOR.binary_search_by(|(name, _)| name.cmp(&symbol)).ok()?;
            crate::shortcuts::drawn("image/svg+xml", PHOSPHOR[at].1.as_bytes(), side).ok()?
        }
        None => {
            let (kind, data) = icon.strip_prefix("data:")?.split_once(";base64,")?;
            crate::shortcuts::drawn(kind, &data_encoding::BASE64.decode(data.as_bytes()).ok()?, side).ok()?
        }
    };
    let [r, g, b] = if cfg!(target_os = "macos") || light_taskbar() { [0, 0, 0] } else { [255, 255, 255] };
    let rgba = drawn.pixels().iter().flat_map(|pixel| [r, g, b, pixel.demultiply().alpha()]).collect();
    tray_icon::Icon::from_rgba(rgba, side, side).ok()
}

/// Whether Windows' taskbar is light, as Personalization › Colours says for Windows (`SystemUsesLightTheme`).
#[cfg(windows)]
fn light_taskbar() -> bool {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
    use windows::core::w;
    let (mut light, mut size) = (0u32, 4u32);
    let read = unsafe { RegGetValueW(HKEY_CURRENT_USER, w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"), w!("SystemUsesLightTheme"), RRF_RT_REG_DWORD, None, Some((&raw mut light).cast()), Some(&mut size)) };
    read.is_ok() && light == 1
}

#[cfg(not(windows))]
fn light_taskbar() -> bool {
    false
}

// Phosphor's icons, regular and fill, as `@phosphor-icons/core` has them, by their names there (`microphone`,
// `moon-fill`), sorted: what an app's page names in its icon's place.
include!(concat!(env!("OUT_DIR"), "/phosphor.rs"));
