use super::*;

impl Windows {
    /// Every window's renderer, each that has one.
    pub(super) fn renderers(&self) -> impl Iterator<Item = &Renderer> {
        self.windows.values().filter_map(|window| window.renderer.as_ref())
    }

    /// How long until any window's screen has something to do by itself, a window waiting to show has waited long
    /// enough, or a renderer has drawn nothing for a while (`Renderer::idle`).
    pub fn due(&self) -> Option<std::time::Duration> {
        let screens = self.windows.values().filter_map(|window| window.screen.as_ref().ok()?.due());
        let showing = self.windows.values().filter(|window| !window.shown || matches!(window.cover, Cover::Over(_)) || window.reloading).map(|window| (if window.picture.is_some() { SHOWN_WITHIN } else { QUIET }).saturating_sub(since(window.opened)));
        let blank = self.windows.values().filter(|window| !window.looked && (!window.panel || window.visible)).map(|window| BLANK.saturating_sub(since(window.looking)));
        let unseen = (!self.seen() && !self.unseen_told).then(|| BLANK.saturating_sub(since(self.unseen)));
        // The next frame begun, while something moves or a window has a change to draw (`FrameClock`).
        let frame = self.drawing().then(|| self.clock.due(now(), self.refresh()));
        let check = self.check.as_ref().map(conformance::Check::due).into_iter().chain(self.recording.as_ref().map(|recording| recording.until.saturating_duration_since(now()))).min();
        let idle = self.renderers().filter_map(Renderer::idle_in);
        let hang = self.renderers().filter_map(Renderer::hang_in);
        screens.chain(showing).chain(blank).chain(unseen).chain(frame).chain(check).chain(idle).chain(hang).min()
    }

    /// Whether nothing's wanted of a window on screen, or one is on screen and has drawn a frame (`expect`).
    fn seen(&self) -> bool {
        self.background || !self.expecting || self.windows.values().any(|window| window.on_screen() && window.drawn)
    }

    /// Whether its windows are a phone's: each the whole screen, an app's over the Home Screen, which it opens out of.
    pub(super) fn on_phone(&self) -> bool {
        #[cfg(feature = "fake")]
        return self.display.is_phone();
        #[cfg(not(feature = "fake"))]
        cfg!(any(target_os = "android", target_os = "ios"))
    }

    /// Whether a window, the root window or not, has the rail's home line: a phone's app's, over its Home Screen. The
    /// headless renderer draws a phone's page alone too, with no Home Screen under it to go home to, which has none.
    pub(super) fn rail(&self, root: bool) -> bool {
        self.on_phone() && !root && (cfg!(not(feature = "fake")) || self.windows.values().any(|window| window.root))
    }

    /// Whether the loop asked for frames and the display has begun a refresh no frame has yet: what the person does now
    /// waits (`waits`) for the frame begun for it, and is drawn in the next, as a browser's input is in the frame begun
    /// after it came. Done at once, the frame begun drew it a refresh early and the next drew nothing new: a trackpad's
    /// swipe at 120 Hz, as a ProMotion display's link stopped, moved 5.5 pt and then held.
    pub(super) fn overdue(&self) -> bool {
        self.clock.overdue(now(), self.refresh())
    }

    /// The display's refresh interval, as it says: every platform's knows it before its first frame, so the frame clock
    /// keeps the display's pace from the first motion after it starts, never a 60 Hz display's on a 120.
    pub fn refresh(&self) -> std::time::Duration {
        self.display.refresh()
    }

    /// Whether a window on screen wants the display's next frame: something on it moves by itself, or its page asked
    /// for one (`requestAnimationFrame`), or a finger pulls it home, as a page dragged asks for a frame with each move,
    /// so the display's link is going as it's let go and its spring steps on its ticks. With the link stopped (a window
    /// moved draws nothing), a pull let go just before a refresh drew its first step for that refresh, and the loop's
    /// own clock its next for the refresh after: a frame held, at 120 Hz.
    pub(super) fn framing(&self) -> bool {
        self.check.as_ref().is_some_and(conformance::Check::moving)
            || self.windows.values().any(|window| window.on_screen() && (window.moving || (window.dirty && window.working()) || window.slide.is_some() || window.pull.as_ref().is_some_and(|pull| pull.pulling() || pull.springing()) || matches!(window.cover, Cover::Fading(..)) || window.screen.as_ref().is_ok_and(Screen::framing)))
    }

    /// Whether a frame is wanted: the loop asked for the display's next as it last turned, something moves, or a window
    /// on screen has a change to draw, which it draws at once or, where it has a frame for the coming refresh, at the
    /// next (`turned`). Asked for and never begun, what the person did waited for it (`overdue`) for good: a tap on a
    /// Settings row whose key took a while never opened it.
    fn drawing(&self) -> bool {
        self.clock.asked() || self.framing() || self.windows.values().any(|window| window.dirty && window.on_screen())
    }

    /// Makes what draws again, on a new GPU device, where the one it drew with was lost, as a browser makes a lost
    /// WebGPU device's: the atlas and every window's renderer, each window drawn afresh (`Screen::gpu_lost`).
    pub(super) fn recover(&mut self) {
        #[cfg(not(target_arch = "wasm32"))]
        self.recovered(Context::new());
        // The web's is asked for with a promise, and drawn on once it's come.
        #[cfg(target_arch = "wasm32")]
        if let Some(made) = web::recover() {
            self.recovered(made);
        }
    }

    pub(super) fn recovered(&mut self, made: anyhow::Result<Context>) {
        let made = made.map(|context| {
            let atlas = Arc::new(Atlas::new(&context));
            (context, atlas)
        });
        let (context, atlas) = match made {
            Ok(made) => made,
            Err(error) => return log::error!("no GPU to draw with again yet: {error:#}"),
        };
        // What a GPU that hung holds is never let go: wgpu waits for it with no limit as a surface goes (wgpu-hal's
        // Direct3D 12 `unconfigure`), and as its queue does (wgpu-core's `Queue::drop`).
        let hung = self.context.hung();
        for window in self.windows.values_mut() {
            if let Some(renderer) = window.renderer.take()
                && hung
            {
                std::mem::forget(renderer);
            }
            if !self.background && window.parts.iter().all(|part| part.native.has_surface()) {
                match draws_on(&context, atlas.clone(), &window.parts) {
                    Ok(renderer) => window.renderer = Some(renderer),
                    Err(error) => log::error!("a native window can't draw: {error:#}"),
                }
            }
            if let Ok(screen) = &mut window.screen {
                screen.gpu_lost();
            }
            // Its new surface shows nothing yet, though nothing it paints changed.
            (window.dirty, window.unshown) = (true, true);
        }
        let old = std::mem::replace(&mut self.context, context);
        if hung {
            std::mem::forget(old);
        }
        self.atlas = atlas;
        log::info!("drawing again on a new GPU device");
    }

    /// After each wait for what's due, a turn of the loop (`turned`), whose time each window's frame timing hears.
    pub fn turn(&mut self) {
        let started = web_time::Instant::now();
        self.turned();
        for window in self.windows.values_mut() {
            window.timing.turned(started.elapsed());
        }
    }

    /// A turn of the loop: what the display said, timers that are due, then each window that changed drawn.
    pub(super) fn turned(&mut self) {
        let turned = now();
        // The fake platform's loop has turned for what woke it (`Windows::run`).
        #[cfg(feature = "fake")]
        self.display.turned();
        // A frame the GPU hasn't done a while after it was given, or a wait for it that ran out: it hung, which the
        // system may never say. It's told once, by the window whose frame it is, or any.
        let frame = self.windows.iter_mut().find_map(|(id, window)| {
            let mut frame = window.renderer.as_mut()?.hung()?;
            frame["moving"] = (window.moving || window.slide.is_some() || window.screen.as_ref().is_ok_and(Screen::framing)).into();
            Some((*id, frame))
        });
        if self.context.hung()
            && let Some((id, frame)) = frame.or_else(|| Some((*self.windows.keys().next()?, serde_json::json!({}))))
            && let Some(window) = self.windows.get_mut(&id)
        {
            log::error!("the GPU hung drawing {}: {frame}", window.title);
            #[cfg(feature = "fake")]
            self.display.wrong(format!("the GPU hung drawing {}", window.title));
            (window.on_event)(Event::Hung(frame));
        }
        if self.context.lost() {
            self.recover();
        }
        // Glyphs and pictures not drawn lately go, before anything's painted, but none a window shows, keeps to draw
        // again or last painted (`Atlas::trim`).
        if self.atlas.trim(|scenes, pictures| {
            for window in self.windows.values() {
                scenes.extend(std::iter::once(&window.scene).chain(window.cover.scene()));
                if let Ok(screen) = &window.screen {
                    screen.kept(scenes, pictures);
                }
            }
        }) {
            self.text.evicted(&self.atlas);
        }
        // Each window waiting for its pipelines has its renderer once they're compiled, on whatever turns the loop: a
        // the headless renderer's own turns too, as well as the windows' thread woken as they are (`Context::prepare`).
        #[cfg(not(target_arch = "wasm32"))]
        self.compiled();
        for (id, part, input) in self.display.events() {
            // The fake platform's pages are as quick as what comes, the same each time: each has run what came before it
            // (`wait`), unless a seed has it busy (`Thread::seed`).
            #[cfg(feature = "fake")]
            self.wait();
            self.input(id, part, input);
        }
        #[cfg(feature = "fake")]
        self.ran();
        for window in self.windows.values_mut() {
            if let Some(renderer) = window.renderer.as_mut()
                && renderer.idle_in().is_some_and(|due| due.is_zero())
            {
                renderer.idle();
            }
        }
        // The display's link says when the frame begun at its tick shows (`FrameClock`).
        if let Some(shows) = self.display.frame() {
            self.clock.tick(shows, self.refresh());
            if self.check.is_some() {
                self.record.tick(shows);
            }
        }
        // A frame begins once a refresh while one's wanted (`drawing`): what moves on a window on screen is drawn again,
        // and its page's `requestAnimationFrame` runs, told the frame's time, as a browser's does once a frame. What a
        // frame drawn now draws is where it is at that time, the same for every window.
        let (at, refresh) = (now(), self.refresh());
        let time = self.clock.time(at, refresh);
        if self.drawing() && self.clock.begin(at, refresh) {
            // A window a gesture let go, or an app's opening out of its icon, is moved where its spring is at that time too.
            #[cfg(any(target_os = "android", target_os = "ios", feature = "fake"))]
            {
                self.spring(time);
                #[cfg(any(target_os = "ios", feature = "fake"))]
                self.slide(time);
            }
            // The window a host check checks moves on each frame while it's kept moving.
            if let Some(check) = &self.check
                && check.moving()
                && let Some(window) = self.windows.get_mut(&check.window)
            {
                window.moving = true;
            }
            for window in self.windows.values_mut().filter(|window| window.on_screen()) {
                window.dirty |= std::mem::take(&mut window.moving);
                if let Ok(screen) = &mut window.screen {
                    screen.frame(time);
                }
            }
        }
        for window in self.windows.values_mut() {
            if let Ok(screen) = &mut window.screen
                && screen.due().is_some_and(|due| due.is_zero())
            {
                screen.fire();
                window.dirty = true;
            }
        }
        // A window whose page's module didn't run says only that its app didn't open.
        for window in self.windows.values_mut() {
            if let Some(why) = window.screen.as_ref().ok().and_then(Screen::didnt_start).map(str::to_owned) {
                window.screen = Err(format!("{} didn't open", window.title));
                window.dirty = true;
                (window.on_event)(Event::Failed(why));
            }
            // One whose page crashed shows nothing of it, never what it drew last as if it were alive.
            if let Some(why) = window.screen.as_ref().ok().and_then(Screen::crashed) {
                window.screen = Err(format!("{} stopped working", window.title));
                window.dirty = true;
                (window.on_event)(Event::Crashed(why));
            }
            // One that's still blank a while after it opened says so, where nothing else said why.
            if window.panel && !window.visible {
                window.looking = now();
            }
            if !window.looked && since(window.looking) >= BLANK {
                window.looked = true;
                let why = match &window.screen {
                    _ if window.pending => Some("its page hadn't started"),
                    Ok(_) if !window.live => Some("it hadn't drawn its page"),
                    Ok(screen) if screen.drew_nothing() => Some("its page had drawn nothing"),
                    _ => None,
                };
                if let Some(why) = why {
                    (window.on_event)(Event::Blank(format!("{why} {} s after it was on screen", BLANK.as_secs())));
                }
            }
        }
        // The page says a window shows and none on screen has drawn a frame a while after: there's none to be blank, or
        // none that drew, which no window's own check tells.
        if self.seen() {
            self.unseen = now();
            self.unseen_told = false;
        } else if !self.unseen_told && since(self.unseen) >= BLANK {
            self.unseen_told = true;
            let why = format!("the page said a window shows, and none of the {} windows had drawn a frame {} s after", self.windows.len(), BLANK.as_secs());
            if let Some(tell) = &mut self.on_blank {
                tell(why);
            }
        }
        // The system's own parts of a window (a Mac's glass and title bar, Windows' frame, a Linux window manager's)
        // are drawn light or dark as its Colour Mode says, or as the system is where it says nothing.
        for window in self.windows.values_mut() {
            let theme = window.screen.as_ref().ok().and_then(|screen| screen.theme);
            if window.chrome != Some(theme) {
                window.chrome = Some(theme);
                for part in &window.parts {
                    self.display.set_appearance(&part.native, theme);
                }
            }
        }
        // A window whose page uses what this host can't draw says so, and why.
        for window in self.windows.values_mut() {
            if let Some(why) = window.screen.as_ref().ok().and_then(|screen| screen.mismatched.clone()) {
                window.screen = Err(format!("{} didn't open: {why}", window.title));
                window.dirty = true;
                (window.on_event)(Event::Mismatched(why));
            }
        }
        // A window hands the display at most one frame a refresh: what changes after it has drawn is drawn once the
        // refresh its frame shows at has come (`FrameClock::shows`), as a browser draws on its frames. Drawn as each
        // input or change came, frames queued ahead of the display, each shown a refresh late, and the thread waited for
        // an image to draw on every frame (an iPhone's main thread, 120 times a second); and a finger lifting in the
        // refresh after its last move drew again, so where it last was never showed, and a fling jumped as it was let
        // go. A change in a window with no frame for the coming refresh is drawn at once, so what the page answers just
        // after a refresh began, or the first input, isn't held a refresh.
        let mut held = false;
        #[cfg(any(target_os = "android", target_os = "ios", feature = "fake"))]
        let phone = self.on_phone();
        for window in self.windows.values_mut() {
            // A new window shows at once, its page covered (`Cover`) by its snapshot until its page has heard back from
            // what it asked, or has waited long enough, or with no snapshot by its canvas, until its page is ready or a
            // moment has gone by; then what covers it fades into it.
            let starting = (window.pending || window.screen.as_ref().is_ok_and(Screen::starting)) && since(window.opened) < SHOWN_WITHIN;
            let device = window.parts[0].native.device_size();
            if window.picture.as_ref().is_some_and(|picture| picture.len() != (device.width.0 * device.height.0 * 4) as usize) {
                window.picture = None;
            }
            if matches!(window.cover, Cover::Over(_)) && (!starting || (window.picture.is_none() && since(window.opened) >= QUIET)) {
                window.loading = starting;
                window.cover = match std::mem::replace(&mut window.cover, Cover::Gone) {
                    Cover::Over(Some(cover)) => Cover::Fading(cover, now()),
                    _ => Cover::Gone,
                };
            }
            // A page shown as it started is ready: what was on the screen, as it was last drawn, fades into it.
            if window.loading && !starting {
                window.loading = false;
                let shown = covered(&window.scene, window.cover.scene(), window.cover.opacity(), device);
                window.cover = Cover::Fading(shown, now());
            }
            if let Cover::Fading(_, began) = window.cover {
                window.dirty = true;
                if since(began) >= FADES_IN {
                    (window.cover, window.picture, window.uncovered) = (Cover::Gone, None, true);
                }
            }
            if !window.shown {
                // Not before it can be drawn, so it never shows with nothing drawn on it: as its pipelines compile
                // (`compiled`); and a panel, which nothing covers and which is drawn once put away and then summoned
                // with that frame, not before its page has heard back, or has waited long enough.
                if (window.panel && starting) || (window.parts[0].native.has_surface() && window.renderer.is_none() && !self.background) {
                    continue;
                }
                window.shown = true;
                // On a phone, an app's window grows out of the icon it was opened from, from the frame it first shows
                // in, as the reverse of its move home (`rail::Pull::opening`).
                #[cfg(any(target_os = "android", target_os = "ios", feature = "fake"))]
                if phone && !window.root && !window.panel && window.icon.is_some() && window.pull.is_none() {
                    let mut opening = rail::Pull::opening();
                    let reduced = window.screen.as_ref().is_ok_and(|screen| screen.reduced_motion);
                    let room = window.room();
                    let (moved, _) = opening.step(Size { width: room.width.0, height: room.height.0 }, window.icon, reduced, time);
                    self.display.set_moved(&window.parts[0].native, moved);
                    window.pull = Some(opening);
                    if let Ok(screen) = &mut window.screen {
                        screen.moving = true;
                    }
                }
                // A panel shows as it's summoned.
                if !window.panel {
                    window.came_on_screen();
                    self.display.show(&window.parts[0].native);
                }
            }
            // Its page loading again in its place (`reload`) is drawn as a new window shows, the frame before staying
            // on screen until then.
            if window.reloading && starting {
                continue;
            }
            // A panel put away is painted as its page changes, never shown, so its text is shaped and its glyphs and
            // pictures are in the atlas, and drawn once, so its surfaces have had a frame, by the time it's summoned,
            // and the frame it shows with is as quick as any after (26 to 52 ms on Linux's first summon after the app started, where
            // later ones take 7). What moves asks for no more frames while it's away. A window with no surface yet
            // (Android's view, until it's laid out) is drawn once it has one.
            // Its first frame drawn so is when it's opened (`Drawn`), as it's ready to show: when it's first summoned is
            // its person's (`Shown`).
            if window.panel && !window.visible {
                if std::mem::take(&mut window.dirty)
                    && let Ok(screen) = &mut window.screen
                    && window.renderer.is_some()
                {
                    window.unshown |= screen.paint(None, window.room, window.parts[0].native.scale(), &mut self.text, &self.atlas, &mut window.scene);
                    // Drawn once, so its surfaces have had a frame; after that it's painted alone, and the image it
                    // took as it went (`put_away`) is kept for the frame it's summoned with.
                    if !window.drawn {
                        let glass = screen.glass().to_vec();
                        window.arrange(&self.display, &self.context, &glass);
                        (window.drawn, window.live) = (true, true);
                        (window.on_event)(Event::Drawn);
                        (window.on_event)(Event::Live);
                    }
                }
                continue;
            }
            // Hidden (`hide`), it's drawn again as it shows, where a frame would make again the images it let go of.
            if window.hidden {
                continue;
            }
            let (width, height) = (device.width.0 as u32, device.height.0 as u32);
            if let Some(shows) = window.shows
                && window.summoned.is_none()
                && self.clock.waits(now(), refresh, shows)
                // Mutant: a frame drawn as each change comes, several in a refresh, as before fbb4e1c9e.
                && !crate::mutants::mutant("double-frame")
            {
                held |= window.dirty;
                continue;
            }
            if !window.dirty || window.renderer.is_none() || window.working() {
                if window.timing.idle()
                    && let Some(frames) = window.timing.end(self.display.refresh())
                {
                    (window.on_event)(Event::Frames(frames));
                }
                continue;
            }
            // Mutant: one refresh in six that has something new draws nothing, as a frame missed while it moves.
            if crate::mutants::mutant("dropped-refresh") && DROPPED.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % 6 == 5 {
                held = true;
                continue;
            }
            window.dirty = false;
            let began = web_time::Instant::now();
            let (room, scale) = (window.room(), window.parts[0].native.scale());
            let mut changed = true;
            {
                match &mut window.screen {
                    Ok(screen) => {
                        // In its first second, its page is laid out in the room its window has, never in another it
                        // was told of first, which it's drawn at for a frame as it's told the real one.
                        #[cfg(feature = "fake")]
                        if since(window.opened) < std::time::Duration::from_secs(1)
                            && let Some(told) = screen.told_room()
                            && (told.width != room.width.0 || told.height != room.height.0)
                        {
                            self.display.wrong(format!("{} was laid out {}×{} in its first second, in a window {}×{}", window.title, told.width, told.height, room.width.0, room.height.0));
                        }
                        // Under what covers it, painted only where some of it shows: a computer's title row, above its
                        // canvas; under its snapshot, or a canvas over all of it, it's left until it's revealed, as
                        // it was before it showed, so what it asks for as it's laid out is for its real layout.
                        if !matches!(window.cover, Cover::Over(_)) || (window.picture.is_none() && screen.title.is_some()) {
                            changed = screen.paint(Some(time), room, scale, &mut self.text, &self.atlas, &mut window.scene);
                        }
                        window.moving = screen.take_again();
                        let calls = screen.text_input(&mut window.text_input);
                        if !calls.is_empty() {
                            self.display.text_input(&window.parts[0].native, &calls);
                        }
                        // The system's menu for what a finger selected, and its magnifier, where they are now.
                        let menu = screen.text_menu_shown();
                        if menu != window.text_menu {
                            window.text_menu = menu;
                            self.display.text_menu(&window.parts[0].native, menu);
                        }
                        let magnifier = screen.magnifier();
                        if magnifier != window.magnifier {
                            window.magnifier = magnifier;
                            self.display.magnifier(&window.parts[0].native, magnifier);
                        }
                        self.display.set_title_row(&window.parts[0].native, screen.title_row());
                    }
                    // One whose page isn't there yet (`opening`) shows its loading state, its spinner turning, never an
                    // empty window: a phone's first start showed black for 5 s and more as its page was read (21 Nov).
                    Err(_) => {
                        window.paint_missing(&mut self.text, &self.atlas);
                        window.moving = window.pending;
                    }
                }
                // What covers it as it opens, made as it's first drawn: its snapshot, or its canvas, which a window whose
                // page isn't there yet (`opening`) has drawn bare.
                if let Cover::Over(cover @ None) = &mut window.cover {
                    let mut made = crate::render::scene::Scene::default();
                    match (&window.picture, &window.screen) {
                        (Some(picture), _) => {
                            if !std::mem::replace(&mut window.pictured, true)
                                && let Some(renderer) = &mut window.renderer
                            {
                                renderer.picture(snapshot::RASTER, width, height, picture);
                            }
                            made.picture(snapshot::RASTER, whole(device), 1.0);
                        }
                        (None, Ok(screen)) => screen.paint_canvas(room, scale, 1.0, &mut made),
                        (None, Err(_)) => made.splice(&window.scene, 1.0, [0.0, 0.0], 1.0, whole(device).into()),
                    }
                    made.finish();
                    *cover = Some(made);
                }
            }
            // What it shows is its page with what covers it over it, as opaque as it's faded to, drawn in its page's
            // scene's place for this frame; and once more as it's gone.
            changed |= !matches!(window.cover, Cover::Gone) || std::mem::take(&mut window.uncovered);
            let page = window.cover.scene().map(|cover| covered(&window.scene, Some(cover), window.cover.opacity(), device)).map(|shown| std::mem::replace(&mut window.scene, shown));
            // Drawn moved by whole device pixels where a test on the web asked (`web::moving`), in its page's scene's
            // place for this frame, as what covers it is.
            #[cfg(target_arch = "wasm32")]
            let page = match super::web::moving() {
                Some([dx, dy]) => {
                    changed = true;
                    let shown = window.scene.moved([dx as f32, dy as f32], device.width.0 as u32, device.height.0 as u32);
                    let was = std::mem::replace(&mut window.scene, shown);
                    page.or(Some(was))
                }
                None => page,
            };
            // A character no font had draws as a font's missing glyph: a gap where a symbol or an emoji goes.
            for character in self.text.undrawn() {
                let what = format!("{} drew {character:?} (U+{:04X}) as a missing glyph: no font has it", window.title, u32::from(character));
                #[cfg(feature = "fake")]
                self.display.wrong(what);
                #[cfg(not(feature = "fake"))]
                log::warn!("{what}");
            }
            let painted = web_time::Instant::now();
            let glass = window.screen.as_ref().map(|screen| screen.glass().to_vec()).unwrap_or_default();
            // Placed for the room it's drawn in before that frame shows, so it shows where it stays; and summoned before
            // it had drawn, put on the screen as its first frame is drawn, never before (empty) nor after: a Mac gives
            // no image to draw on to a window it isn't showing (wgpu asks macOS's `occlusionState`), so one waiting to
            // be drawn first was never drawn, nor shown (The PTC App's launcher, opened again on its app's new version
            // while it was summoned, 23 Nov).
            // Mutant: one summoned before it had drawn waits for its first frame to be put on the screen, as before.
            if (window.drawn || !crate::mutants::mutant("summon-after-draw")) && std::mem::take(&mut window.placing) {
                self.display.summon(&window.parts[0].native, &places(window.places.as_deref()), window.room);
                window.came_on_screen();
            }
            // Nothing it shows changed (its page asked for a frame, or something moved that ended where it was): the
            // frame on the screen is it, so none is drawn or presented, as a compositor draws none without damage.
            // On the Surface, each was half a ms of this thread and 0.7 to 2 of its GPU, for every part of a panel.
            if !changed && !window.unshown && window.drawn && window.summoned.is_none() && window.missed == 0 {
                continue;
            }
            let arranged = window.arrange(&self.display, &self.context, &glass);
            if let Some(page) = page {
                window.scene = page;
            }
            if arranged == Draw::Missed {
                window.missed(&self.context, &self.atlas);
                continue;
            }
            window.unshown = false;
            window.missed = 0;
            window.shows = Some(self.clock.shows(now(), refresh));
            window.frames += 1;
            // One that drew the same as the frame on the screen (`Draw::Unchanged`) is a frame of its own for the loop,
            // presenting none.
            window.presents += u64::from(arranged == Draw::Presented);
            #[cfg(feature = "fake")]
            if let Ok(screen) = &mut window.screen {
                screen.presented();
            }
            // Its opening out of its icon starts from the frame it first shows something in.
            if window.frames == 1
                && let Some(opening) = window.pull.as_mut().filter(|pull| pull.opens())
            {
                opening.shown(time);
            }
            if self.check.is_some() {
                self.record.present();
            }
            let moving = window.moving || window.screen.as_ref().is_ok_and(Screen::framing);
            if window.screen.as_ref().is_ok_and(Screen::held) {
                window.timing.input("drag");
            }
            let refresh = self.display.refresh();
            let renderer = window.renderer.as_ref();
            let (submit, present) = renderer.map(Renderer::submitted).unwrap_or_default();
            let (acquire, gpu, passes) = (renderer.map(Renderer::acquired).unwrap_or_default(), renderer.and_then(Renderer::gpu), renderer.map_or(0, Renderer::passes));
            let frame = frame_timing::Frame { at: now(), paint: painted - began, draw: painted.elapsed(), acquire, submit, present, gpu: gpu.map(|(all, _)| all), blur: gpu.map(|(_, blur)| blur), passes, applied: Default::default(), turned: Default::default() };
            let (interval, frames) = window.timing.drawn(frame, moving, refresh);
            if let Some(interval) = interval {
                self.deadlines.frame(frame_timing::Timing::long(interval, refresh));
            }
            if let Some(frames) = frames {
                (window.on_event)(Event::Frames(frames));
            }
            if !window.drawn {
                window.drawn = true;
                window.reloading = false;
                (window.on_event)(Event::Drawn);
            }
            if !window.pending && !matches!(window.cover, Cover::Over(_)) && !std::mem::replace(&mut window.live, true) {
                (window.on_event)(Event::Live);
            }
            if let Some(asked) = window.summoned.take() {
                let ms = |time: std::time::Duration| time.as_secs_f64() * 1000.0;
                // Where its time went: to the turn it's drawn on, on that turn before it (input, timers, other windows
                // drawn first), painting it and drawing it.
                let (before, on) = (turned.saturating_duration_since(asked), began.saturating_duration_since(turned));
                eprintln!("the launcher's first frame as it was summoned: {:.1} ms before its turn, {:.1} ms on it before it was painted, {:.1} ms to paint and {:.1} ms to draw", ms(before), ms(on), ms(painted - began), ms(painted.elapsed()));
                (window.on_event)(Event::Shown(asked.elapsed()));
            }
        }
        // What waited for a page that's caught up now is done.
        let waiting: Vec<WindowId> = self.windows.iter().filter(|(_, window)| !window.waiting.is_empty()).map(|(id, _)| *id).collect();
        for id in waiting {
            self.catch_up(id);
        }
        self.pressed();
        #[cfg(feature = "fake")]
        self.ran();
        // The display's frames are wanted while something moves, and while a change waits for its next refresh.
        let wanted = self.framing() || held;
        self.clock.ask(wanted, now(), self.refresh());
        // With no frame wanted, what moved is still: its frames are said, so the next one, drawn whenever something
        // comes, isn't counted as a refresh the display missed, which pressed the device for 5 s.
        if !wanted {
            for window in self.windows.values_mut() {
                if let Some(frames) = window.timing.end(self.display.refresh()) {
                    (window.on_event)(Event::Frames(frames));
                }
            }
        }
        self.display.request_frame(wanted);
        self.display.flush();
        if let Some(recording) = self.recording.take_if(|recording| recording.until <= now()) {
            (recording.reply)(crate::inspect::answer(&recording.id, Ok(serde_json::json!({"events": recording.events}))));
        }
        if let Some(check) = self.check.take_if(|check| check.over()) {
            let said = check.said(&self.record, self.display.paced());
            (check.reply)(crate::inspect::answer(&check.id, Ok(said)));
        }
    }

    /// How pressed the device is, the worse of what its system and its frames say, given to each window's screen as
    /// it changes, which draws as it says (`Screen::pressure`).
    pub(super) fn pressed(&mut self) {
        if since(self.system.0) >= std::time::Duration::from_secs(1) {
            self.system = (now(), self.display.pressure());
        }
        let pressure = self.system.1.max(self.deadlines.pressure());
        if pressure == self.pressure {
            return;
        }
        log::info!("pressure is {} now, where it was {}", pressure.name(), self.pressure.name());
        self.pressure = pressure;
        for window in self.windows.values_mut() {
            if let Ok(screen) = &mut window.screen {
                screen.pressure = pressure;
                window.dirty = true;
            }
        }
    }
}

/// How many refreshes have had something new to draw, for the mutant `dropped-refresh`.
static DROPPED: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
