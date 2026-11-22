use super::*;

impl Native {
    /// The windows' thread, started the first time it's asked for.
    pub fn get() -> anyhow::Result<Native> {
        STARTED.get_or_init(|| start().map_err(|error| format!("{error:#}"))).clone().map_err(|error| anyhow::anyhow!(error))
    }

    /// The windows' thread, if it's been started.
    pub fn started() -> Option<Native> {
        STARTED.get()?.clone().ok()
    }

    /// Runs `job` on the windows' thread, where every window and its screen are.
    pub fn run(&self, job: impl FnOnce(&mut Windows) + Send + 'static) {
        let _ = self.0.send(Box::new(job));
    }

    /// Whether this device's windows are a phone's: each the whole screen, the Home Screen the root window under every
    /// app's, closed only as its system closes it.
    pub fn phone() -> bool {
        cfg!(any(target_os = "android", target_os = "ios"))
    }
}

#[cfg(target_os = "windows")]
use super::windows::start;

#[cfg(target_os = "android")]
use super::android::start;
#[cfg(target_os = "ios")]
use super::ios::start;
#[cfg(target_arch = "wasm32")]
use super::web::start;

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn start() -> anyhow::Result<Native> {
    let (sender, channel) = calloop::channel::channel::<Job>();
    let (ready_to, ready) = std::sync::mpsc::channel();
    std::thread::Builder::new().name("native".into()).spawn(move || {
        // It takes the person's input and draws what they see, so it runs ahead of work nobody's waiting on, as an
        // app's main thread does: as far as the system lets it.
        let _ = thread_priority::set_current_thread_priority(thread_priority::ThreadPriority::Max);
        let mut event_loop = match calloop::EventLoop::<Windows>::try_new() {
            Ok(event_loop) => event_loop,
            Err(error) => return drop(ready_to.send(Err(anyhow::anyhow!("{error}")))),
        };
        let windows = Display::connect(&event_loop.handle()).and_then(Windows::new);
        let mut windows = match windows {
            Ok(windows) => windows,
            Err(error) => return drop(ready_to.send(Err(error))),
        };
        let inserted = event_loop.handle().insert_source(channel, |event, _, windows: &mut Windows| {
            if let calloop::channel::Event::Msg(job) = event {
                job(windows);
            }
        });
        if let Err(error) = inserted {
            return drop(ready_to.send(Err(anyhow::anyhow!("{error}"))));
        }
        let _ = ready_to.send(Ok(()));
        loop {
            let timeout = windows.due();
            if let Err(error) = event_loop.dispatch(timeout, &mut windows) {
                log::error!("native windows: {error}");
            }
            windows.turn();
        }
    })?;
    ready.recv()??;
    Ok(Native(sender))
}
