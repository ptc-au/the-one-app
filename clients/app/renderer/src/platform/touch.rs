use super::*;

impl Windows {
    /// A finger on window `id`, as its platform says, which the rail's line takes where it lands on it (`rail`): it
    /// drives the window's move home from then on, and the first to land keeps it, another on the line meanwhile
    /// ignored. → whether it's the line's, which the window's page doesn't hear.
    #[cfg(any(target_os = "android", target_os = "ios", feature = "fake"))]
    pub(crate) fn line(&mut self, id: WindowId, finger: u64, at: crate::geometry::Point<f32>, phase: crate::view::touch::Phase) -> bool {
        let Some(window) = self.windows.get_mut(&id) else { return false };
        let (room, icon) = (window.room(), window.icon);
        let Ok(screen) = &mut window.screen else { return false };
        // A finger on the line takes an app opening out of its icon from where it's got to.
        if let Some(pull) = window.pull.as_mut().filter(|pull| pull.opens())
            && phase == crate::view::touch::Phase::Down
            && screen.on_line(at)
        {
            pull.take(finger, at);
            return true;
        }
        let Some(pull) = window.pull.as_mut().filter(|pull| !pull.opens()) else {
            if phase != crate::view::touch::Phase::Down || window.root || !screen.on_line(at) {
                return false;
            }
            window.pull = Some(rail::Pull::new(finger, at));
            return true;
        };
        if pull.finger() != finger {
            return phase == crate::view::touch::Phase::Down && screen.on_line(at);
        }
        match phase {
            crate::view::touch::Phase::Down => {}
            crate::view::touch::Phase::Moved => {
                let was = pull.pulling();
                match pull.moved(at, Size { width: room.width.0, height: room.height.0 }, icon, screen.reduced_motion) {
                    rail::Pulled::Kept(Some(moved)) => {
                        self.display.set_moved(&window.parts[0].native, moved);
                        if !was {
                            // Its line goes as it moves, and its page is the card's, which no other window shows behind.
                            screen.moving = true;
                            window.dirty = true;
                            for (_, other) in self.windows.iter().filter(|(other, under)| **other != id && !under.root) {
                                self.display.set_moved(&other.parts[0].native, rail::Moved::HIDDEN);
                            }
                        }
                    }
                    rail::Pulled::Kept(None) => {}
                    rail::Pulled::Dropped => window.pull = None,
                }
            }
            crate::view::touch::Phase::Up | crate::view::touch::Phase::Cancelled => {
                if !pull.let_go(phase == crate::view::touch::Phase::Cancelled) {
                    window.pull = None;
                }
            }
        }
        true
    }

    /// Finger `finger` on window `id` at `at`, in its points, as its system says, `ago` ms before now where the system
    /// says when: the rail's line's where it lands on it, and otherwise its page's (`view::touch`), the window swiped
    /// back from its left edge where the host leaves that to its app, as an iPhone's apps draw it. `fingers` is how the
    /// system differs. → whether it pans, which a host that flings flings as it lifts.
    /// A finger that lands, or lifts to press, waits for its page, and its moves behind it (`waits`).
    pub(crate) fn touch(&mut self, id: WindowId, finger: u64, at: Point<f32>, phase: crate::view::touch::Phase, ago: Option<f64>, fingers: crate::view::touch::Fingers) -> bool {
        let happened = ago.and_then(|ago| now().checked_sub(std::time::Duration::from_secs_f64(ago / 1000.0)));
        if self.check.is_some() {
            self.record.input("touch", happened);
        }
        if let Some(recording) = &mut self.recording {
            recording.input(id, serde_json::json!({"kind": "touch", "phase": format!("{phase:?}").to_lowercase(), "finger": finger, "x": at.x, "y": at.y}), happened);
        }
        #[cfg(any(target_os = "android", target_os = "ios", feature = "fake"))]
        {
            // A finger lets the tip's hint go: the window it held springs back, and its finger shows again later.
            if phase == crate::view::touch::Phase::Down
                && let Some(window) = self.windows.get_mut(&id)
                && let Some(hint) = window.hint.take()
                && let Some(p) = hint.held
            {
                window.pull = Some(rail::Pull::settling(p));
            }
            if self.line(id, finger, at, phase) {
                return false;
            }
        }
        let discrete = self.windows.get(&id).and_then(|window| window.screen.as_ref().ok()).is_some_and(|screen| phase.discrete(screen, finger));
        if self.waits(id, discrete) {
            let happened = ago.and_then(|ago| now().checked_sub(std::time::Duration::from_secs_f64(ago / 1000.0)));
            if let Some(window) = self.windows.get_mut(&id) {
                window.waiting.push_back(Waiting::Touch { finger, at, phase, happened, fingers });
            }
            return false;
        }
        self.touched(id, finger, at, phase, ago, fingers)
    }

    /// Finger `finger` on window `id`, its page caught up (`touch`).
    pub(super) fn touched(&mut self, id: WindowId, finger: u64, at: Point<f32>, phase: crate::view::touch::Phase, ago: Option<f64>, fingers: crate::view::touch::Fingers) -> bool {
        use crate::view::touch::Touched;
        #[cfg_attr(not(any(target_os = "ios", feature = "fake")), allow(unused_mut))]
        let mut fingers = fingers;
        let Some(window) = self.windows.get_mut(&id) else { return false };
        window.dirty = true;
        let native = &window.parts[0].native;
        #[cfg(any(target_os = "ios", feature = "fake"))]
        if !window.root {
            fingers.edge = Some(crate::view::touch::Edge { width: native.size().width.0, slid: window.slide.is_some().then(|| native.slid()) });
        }
        let Ok(screen) = &mut window.screen else { return false };
        screen.happened(ago);
        let time = screen.input_time();
        let touched = screen.touch(&fingers, finger, at, phase, time);
        screen.happened(None);
        match touched {
            // Lifted from a pan, on a host that flings it itself (Android's `OverScroller`), as the lift is taken here:
            // at once, or once its page caught up, where it waited (`waits`).
            #[cfg(target_os = "android")]
            Touched::Panning if phase == crate::view::touch::Phase::Up => native.fling(),
            Touched::Panning => return true,
            Touched::Keyboard => self.display.text_input(native, &[crate::editing::TextInput::Show]),
            #[cfg(any(target_os = "ios", feature = "fake"))]
            Touched::Slide(across) => {
                window.slide = None;
                native.slide(across);
            }
            #[cfg(any(target_os = "ios", feature = "fake"))]
            Touched::Slid { velocity, out } => {
                let target = if out { native.size().width.0 } else { 0.0 };
                window.slide = Some(Slide { across: native.slid(), velocity, target, stepped: now() });
            }
            _ => {}
        }
        false
    }

    /// Steps each window springing from a swipe back let go, with the rail's spring, to `at`, the time of the frame it's
    /// shown in: one slid off closes.
    #[cfg(any(target_os = "ios", feature = "fake"))]
    pub(super) fn slide(&mut self, at: web_time::Instant) {
        let mut off = Vec::new();
        for (id, window) in &mut self.windows {
            let Some(slide) = window.slide.as_mut() else { continue };
            let native = &window.parts[0].native;
            let width = native.size().width.0.max(1.0);
            let dt = at.saturating_duration_since(slide.stepped).as_secs_f32();
            slide.stepped = at;
            let (across, velocity, still) = rail::spring(slide.across / width, slide.velocity / width, slide.target / width, dt, width);
            (slide.across, slide.velocity) = (across * width, velocity * width);
            native.slide(slide.across);
            window.dirty = true;
            if still {
                if slide.target > 0.0 {
                    off.push(*id);
                }
                window.slide = None;
            }
        }
        for id in off {
            self.close(id);
        }
    }

    /// Steps each window's pull let go, and each opening, to `at`, the time of the frame it's shown in: home, every app's
    /// window closes; back, it's as it was.
    #[cfg(any(target_os = "android", target_os = "ios", feature = "fake"))]
    pub(super) fn spring(&mut self, at: web_time::Instant) {
        let mut home = false;
        let mut back = false;
        for window in self.windows.values_mut() {
            let (room, icon) = (window.room(), window.icon);
            let reduced = window.screen.as_ref().is_ok_and(|screen| screen.reduced_motion);
            // An opening waits on its icon for its window's first frame, which a slow GPU takes a while to show.
            let Some(pull) = window.pull.as_mut().filter(|pull| pull.springing() && !(pull.opens() && window.frames == 0)) else { continue };
            let (moved, still) = pull.step(Size { width: room.width.0, height: room.height.0 }, icon, reduced, at);
            match still {
                Some(1.0) => home = true,
                Some(_) => {
                    window.pull = None;
                    if let Ok(screen) = &mut window.screen {
                        screen.moving = false;
                    }
                    window.dirty = true;
                    back = true;
                    self.display.set_moved(&window.parts[0].native, rail::Moved::STILL);
                }
                None => self.display.set_moved(&window.parts[0].native, moved),
            }
        }
        if home {
            // Pulled home, its person knows the way: the rail's tip goes.
            if self.tip {
                self.tip = false;
                if let Some(window) = self.windows.values_mut().find(|window| !window.root && window.pull.is_some()) {
                    (window.on_event)(Event::Tipped);
                }
            }
            let apps: Vec<WindowId> = self.windows.iter().filter(|(_, window)| !window.root).map(|(id, _)| *id).collect();
            for id in apps {
                self.close(id);
            }
        } else if back {
            for window in self.windows.values().filter(|window| !window.root && window.pull.is_none()) {
                self.display.set_moved(&window.parts[0].native, rail::Moved::STILL);
            }
        }
    }

    /// Shows the rail's tip over every app's window, or not, as whoever opens them says (DESIGN.md, The rail): until its
    /// person pulls one home or taps its Got it, which that window tells (`Event::Tipped`).
    pub fn set_tip(&mut self, shown: bool) {
        self.tip = shown;
        for window in self.windows.values_mut() {
            window.dirty = true;
        }
    }

    /// The rail's tip over each app's window, to `at`, the time of the frame it's shown in, while it shows: its hint
    /// going on the one no finger holds, its window pulled in as far as the hint has it and let go to spring back
    /// (`rail::Hint`), unless its person asked for less motion. A Got it tapped on any one ends it on all of them.
    #[cfg(any(target_os = "android", target_os = "ios", feature = "fake"))]
    pub(super) fn tip(&mut self, at: web_time::Instant) {
        for window in self.windows.values_mut().filter(|window| !window.root) {
            let Ok(screen) = &mut window.screen else { continue };
            if std::mem::take(&mut screen.tipped) && self.tip {
                self.tip = false;
                (window.on_event)(Event::Tipped);
            }
        }
        let mut hiding = None;
        for (id, window) in self.windows.iter_mut().filter(|(_, window)| !window.root) {
            let room = window.room();
            let Ok(screen) = &mut window.screen else { continue };
            if !self.tip {
                if screen.tip.take().is_some() {
                    window.dirty = true;
                }
                if let Some(p) = window.hint.take().and_then(|hint| hint.held) {
                    window.pull = Some(rail::Pull::settling(p));
                }
                continue;
            }
            // While a finger holds it, the tip's away, as it is under the window page's line.
            if window.pull.as_ref().is_some_and(|pull| !pull.opens()) {
                window.hint = None;
                window.dirty |= screen.tip.take().is_some();
                continue;
            }
            if screen.reduced_motion {
                window.dirty |= screen.tip.replace(crate::view::Tip::default()) != Some(crate::view::Tip::default());
                continue;
            }
            // It starts once the window's still: opened, and sprung back from a pull.
            if window.hint.is_none() && window.pull.is_none() {
                window.hint = Some(rail::Hint::new(at));
            }
            let Some(hint) = window.hint.as_mut() else {
                window.dirty |= screen.tip.replace(crate::view::Tip::default()) != Some(crate::view::Tip::default());
                continue;
            };
            let hinted = hint.at(at);
            match (hinted.p, hint.held) {
                (Some(p), _) if window.pull.is_none() => {
                    self.display.set_moved(&window.parts[0].native, rail::at(p, Size { width: room.width.0, height: room.height.0 }, window.icon, false));
                    if hint.held.is_none() {
                        // Its line goes as it moves, and its page is the card's, which no other window shows behind.
                        screen.moving = true;
                        hiding = Some(*id);
                    }
                    hint.held = Some(p);
                }
                (None, Some(p)) => {
                    hint.held = None;
                    window.pull = Some(rail::Pull::settling(p));
                }
                _ => {}
            }
            screen.tip = Some(crate::view::Tip { finger: hinted.finger, ring: Some(hinted.ring) });
            window.dirty = true;
        }
        if let Some(id) = hiding {
            for (_, other) in self.windows.iter().filter(|(other, under)| **other != id && !under.root) {
                self.display.set_moved(&other.parts[0].native, rail::Moved::HIDDEN);
            }
        }
    }
}
