//! A page's `video` natively (renderer.ts's `video`): a screen's live video over WebRTC, as the web's browser
//! connects and plays one (clients/web/renderer/video.js). WebRTC is str0m's and H.264 OpenH264's, as WebRTC's sender
//! has them (apps/webrtc/server/bin/stream), so the two ends are one stack, built from source for every kind of
//! device, with no browser and no libwebrtc. Each connection is a thread of its own: it reaches the screen only
//! through a TURN server's relay, over TCP, as the sender does (`turn`), offers to receive video and the data channel
//! both ends make (`input`, negotiated, id 0), takes the screen's answer, and decodes each frame that comes into the
//! latest, which the window draws (`Video::tile`). What it says the page hears as events (`offer`, `state`, `size`).

use std::net::SocketAddr;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, anyhow};
use serde_json::{Value, json};
use str0m::change::{SdpAnswer, SdpPendingOffer};
use str0m::channel::{ChannelConfig, ChannelId};
use str0m::media::{Direction, KeyframeRequestKind, MediaKind, Mid};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event as RtcEvent, IceConnectionState, Input as RtcInput, Output, Rtc};

use crate::geometry::{Bounds, DevicePixels, Size};
use crate::render::atlas::{Atlas, AtlasKey, AtlasTile};
use crate::turn::{Ice, Turn, candidates};

/// What reaches a connection's thread: bytes from the TURN server, or what its page did.
enum Command {
    /// The TURN server sent something, which the connection takes.
    Wake,
    Answer(String),
    Send(String),
    Close,
}

/// What a connection has for its window: the latest frame, BGRA, as the atlas takes it, how many have come, and the
/// events its page is to hear.
#[derive(Default)]
struct Shared {
    frame: Option<(Size<u32>, Vec<u8>)>,
    came: u64,
    told: Vec<(&'static str, Value)>,
}

/// A `video` node: its connection, the last made, and what's drawn of it.
#[derive(Default)]
pub(crate) struct Video {
    commands: Option<Sender<Command>>,
    shared: Arc<Mutex<Shared>>,
    /// Looked at only: nothing done on it is sent.
    pub watch: bool,
    /// Its data channel is open, so what's done on it goes down it.
    pub connected: bool,
    /// Its video's own size, and where it was last drawn, in the window.
    pub size: Option<Size<u32>>,
    pub drawn: Option<Bounds<f32>>,
    /// It's been in its page, so it's closed once it's out of it (`Screen::sync_videos`).
    pub shown: bool,
    copied: u64,
}

impl Drop for Video {
    fn drop(&mut self) {
        self.close();
    }
}

impl Video {
    /// A new connection with `ice`, the last one closed; `wake` wakes its window as it has something for it. No `ice`
    /// is none.
    pub fn connect(&mut self, ice: &Value, wake: Option<Arc<dyn Fn() + Send + Sync>>) {
        self.close();
        self.connected = false;
        if ice.is_null() {
            return;
        }
        let (commands, received) = mpsc::channel();
        let shared = Arc::new(Mutex::new(Shared::default()));
        self.shared = shared.clone();
        self.commands = Some(commands.clone());
        let ice = ice.clone();
        let _ = std::thread::Builder::new().name("video".into()).spawn(move || {
            let out = Out { shared, wake };
            match connection(ice, commands, &received, &out) {
                Ok(why) => eprintln!("A video's connection ended: {why}"),
                Err(why) => eprintln!("A video's connection failed: {why:#}"),
            }
            out.tell("state", json!({"state": "lost"}));
        });
    }

    fn close(&mut self) {
        if let Some(commands) = self.commands.take() {
            let _ = commands.send(Command::Close);
        }
    }

    /// The screen's answer to its offer.
    pub fn answer(&self, sdp: &str) {
        if let Some(commands) = &self.commands {
            let _ = commands.send(Command::Answer(sdp.to_owned()));
        }
    }

    /// Sends what's done on it down its data channel, as JSON (core/ui/src/drawing-primitives/input.ts's `Input`),
    /// unless it's only looked at.
    pub fn send(&self, input: Value) {
        if let (false, true, Some(commands)) = (self.watch, self.connected, &self.commands) {
            let _ = commands.send(Command::Send(input.to_string()));
        }
    }

    /// The events its page is to hear since it was last asked, and whether a frame came.
    pub fn take(&mut self) -> (Vec<(&'static str, Value)>, bool) {
        let mut shared = lock(&self.shared);
        let told = std::mem::take(&mut shared.told);
        for (name, told) in &told {
            match *name {
                "state" => self.connected = told["state"] == "connected",
                "size" => {
                    self.size = Some(Size {
                        width: told["width"].as_u64().unwrap_or(0) as u32,
                        height: told["height"].as_u64().unwrap_or(0) as u32,
                    })
                }
                _ => {}
            }
        }
        (told, shared.came != self.copied)
    }

    /// Its latest frame, in its tile of the atlas, written there as it came, and its size, drawn in `content`.
    pub fn tile(&mut self, id: crate::tree::Id, content: Bounds<f32>, atlas: &Atlas) -> Option<(AtlasTile, Size<u32>)> {
        self.drawn = Some(content);
        let shared = lock(&self.shared);
        let (size, bgra) = shared.frame.as_ref()?;
        let size = *size;
        if size.width == 0 || size.height == 0 {
            return None;
        }
        use std::hash::{Hash as _, Hasher as _};
        let mut key = std::collections::hash_map::DefaultHasher::new();
        ("video", id, size.width, size.height).hash(&mut key);
        let padded = Size { width: DevicePixels(size.width as i32 + 2), height: DevicePixels(size.height as i32 + 2) };
        // A tile new to it, or put in again since its atlas let it go (`Atlas::trim`) while it wasn't drawn, has its
        // latest frame written in.
        let mut new = false;
        let tile = atlas
            .get_or_insert_with(&AtlasKey::Image(key.finish()), &mut || {
                new = true;
                Ok(Some((padded, std::borrow::Cow::Owned(vec![0; (size.width as usize + 2) * (size.height as usize + 2) * 4]))))
            })
            .ok()??;
        if new || self.copied != shared.came {
            self.copied = shared.came;
            atlas.write(
                &tile,
                Size { width: DevicePixels(size.width as i32), height: DevicePixels(size.height as i32) },
                bgra.clone(),
            );
        }
        Some((tile, size))
    }

    /// Where `at`, in the window, is on its screen, in its video's pixels, where it's drawn there as big as fits, in
    /// the middle of its box.
    pub fn at(&self, at: crate::geometry::Point<f32>) -> Option<(u32, u32)> {
        self.drawn?.contains(&at).then(|| self.at_clamped(at))?
    }

    /// Where `at` is on its screen, or its nearest edge, where it's outside it, as a press held there is.
    pub fn at_clamped(&self, at: crate::geometry::Point<f32>) -> Option<(u32, u32)> {
        let (drawn, size) = (self.drawn?, self.size?);
        if size.width == 0 || size.height == 0 {
            return None;
        }
        let scale = (drawn.size.width / size.width as f32).min(drawn.size.height / size.height as f32);
        let x = (at.x - drawn.origin.x - (drawn.size.width - size.width as f32 * scale) / 2.0) / scale;
        let y = (at.y - drawn.origin.y - (drawn.size.height - size.height as f32 * scale) / 2.0) / scale;
        Some((
            x.clamp(0.0, size.width as f32 - 1.0).round() as u32,
            y.clamp(0.0, size.height as f32 - 1.0).round() as u32,
        ))
    }
}

fn lock(shared: &Mutex<Shared>) -> std::sync::MutexGuard<'_, Shared> {
    shared.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// What a connection's thread gives its window, which is woken to take it.
struct Out {
    shared: Arc<Mutex<Shared>>,
    wake: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl Out {
    /// An event its page is to hear.
    fn tell(&self, name: &'static str, told: Value) {
        lock(&self.shared).told.push((name, told));
        self.woken();
    }

    /// A frame, the latest.
    fn frame(&self, size: Size<u32>, bgra: Vec<u8>) {
        let mut shared = lock(&self.shared);
        shared.frame = Some((size, bgra));
        shared.came += 1;
        drop(shared);
        self.woken();
    }

    fn woken(&self) {
        if let Some(wake) = &self.wake {
            wake();
        }
    }
}

/// One connection, from its offer until it's closed or lost: gives why it ended.
fn connection(
    ice: Value,
    commands: Sender<Command>,
    received: &Receiver<Command>,
    out: &Out,
) -> anyhow::Result<String> {
    let started = Instant::now();
    let ice: Ice = serde_json::from_value(ice).context("its ICE servers")?;
    let wake = {
        let commands = commands.clone();
        Arc::new(move || {
            let _ = commands.send(Command::Wake);
        })
    };
    let mut turn = Turn::connect(&ice, wake)?;
    let relay = turn.allocate()?;

    let mut rtc = Rtc::builder().clear_codecs().enable_h264(true).build(Instant::now());
    rtc.add_local_candidate(Candidate::relayed(relay, turn.local(), "udp")?);
    let mut change = rtc.sdp_api();
    let mid = change.add_media(MediaKind::Video, Direction::RecvOnly, None, None, None);
    // Both ends make the data channel (id 0), so it opens with the connection, with nothing more to say.
    let channel = change.add_channel_with_config(ChannelConfig {
        label: "input".into(),
        negotiated: Some(0),
        ..Default::default()
    });
    let (offer, pending) = change.apply().ok_or_else(|| anyhow!("there was nothing to offer"))?;
    out.tell("offer", json!({"sdp": offer.to_sdp_string()}));
    let offered = started.elapsed();

    let timings = Timings { started, offered, answered: None };
    let mut session = Session {
        rtc,
        turn,
        relay,
        mid,
        channel,
        decoder: openh264::decoder::Decoder::new()?,
        size: None,
        pending: Some(pending),
        ended: None,
        timings,
    };
    session.run(received, out)
}

struct Session {
    rtc: Rtc,
    turn: Turn,
    relay: SocketAddr,
    mid: Mid,
    channel: ChannelId,
    decoder: openh264::decoder::Decoder,
    size: Option<(usize, usize)>,
    pending: Option<SdpPendingOffer>,
    ended: Option<String>,
    timings: Timings,
}

/// When its connection began, and how long after its offer was made and the screen's answer came, which the log says
/// once it's connected.
struct Timings {
    started: Instant,
    offered: Duration,
    answered: Option<Duration>,
}

impl Session {
    fn run(&mut self, received: &Receiver<Command>, out: &Out) -> anyhow::Result<String> {
        loop {
            if let Some(why) = self.ended.take() {
                return Ok(why);
            }
            self.pump_turn(out)?;
            let at = self.drain(out)?;
            self.turn.events();
            let wait = at.saturating_duration_since(Instant::now()).min(self.turn.wait());
            let command = if wait.is_zero() {
                received.try_recv().map_err(|_| RecvTimeoutError::Timeout)
            } else {
                received.recv_timeout(wait)
            };
            match command {
                Ok(Command::Answer(sdp)) => {
                    let Some(pending) = self.pending.take() else { continue };
                    self.timings.answered = Some(self.timings.started.elapsed());
                    // What the screen reaches the relay from, which the relay takes from only once permitted.
                    for ip in candidates(&sdp) {
                        self.turn.permit(ip);
                    }
                    self.rtc
                        .sdp_api()
                        .accept_answer(pending, SdpAnswer::from_sdp_string(&sdp).context("the screen's answer")?)?;
                    self.turn.flush()?;
                }
                Ok(Command::Send(input)) => {
                    if let Some(mut channel) = self.rtc.channel(self.channel) {
                        channel.write(false, input.as_bytes())?;
                    }
                }
                // What the TURN server sent, which the next turn takes.
                Ok(Command::Wake) => {}
                Ok(Command::Close) | Err(RecvTimeoutError::Disconnected) => return Ok("it was closed".into()),
                Err(RecvTimeoutError::Timeout) => {
                    self.rtc.handle_input(RtcInput::Timeout(Instant::now()))?;
                    self.turn.flush()?;
                }
            }
        }
    }

    /// Takes what the TURN server sent since it was last asked: each peer's data into the connection.
    fn pump_turn(&mut self, out: &Out) -> anyhow::Result<()> {
        let mut heard = Vec::new();
        while let Ok(one) = self.turn.heard().try_recv() {
            heard.push(one);
        }
        for one in heard {
            let Some(bytes) = one else {
                self.ended = Some("the TURN server closed its connection".into());
                return Ok(());
            };
            for (peer, data) in self.turn.receive(&bytes) {
                let Ok(contents) = data.as_slice().try_into() else { continue };
                let receive = Receive { proto: Protocol::Udp, source: peer, destination: self.relay, contents };
                self.rtc.handle_input(RtcInput::Receive(Instant::now(), receive))?;
                self.drain(out)?;
            }
            self.turn.flush()?;
        }
        Ok(())
    }

    /// Takes everything str0m has to do now, until the time it next has something: gives that time.
    fn drain(&mut self, out: &Out) -> anyhow::Result<Instant> {
        loop {
            match self.rtc.poll_output()? {
                Output::Timeout(at) => return Ok(at),
                Output::Transmit(transmit) => self.turn.send(transmit.destination, &transmit.contents)?,
                Output::Event(event) => match event {
                    RtcEvent::ChannelOpen(id, _) if id == self.channel => {
                        let Timings { started, offered, answered } = self.timings;
                        let ms = |at: Duration| at.as_millis();
                        eprintln!(
                            "a video connected in {} ms: offered at {} ms, through TURN, and answered at {} ms",
                            ms(started.elapsed()),
                            ms(offered),
                            answered.map_or(0, ms)
                        );
                        out.tell("state", json!({"state": "connected"}));
                    }
                    RtcEvent::ChannelClose(id) if id == self.channel => {
                        self.ended = Some("the screen closed its data channel".into())
                    }
                    RtcEvent::IceConnectionStateChange(IceConnectionState::Disconnected) => {
                        self.ended = Some("the screen went".into())
                    }
                    RtcEvent::MediaData(data) => self.decode(&data.data, out),
                    _ => {}
                },
            }
        }
    }

    /// Decodes a frame into the latest, or asks for a whole one where it can't be.
    fn decode(&mut self, frame: &[u8], out: &Out) {
        use openh264::formats::YUVSource as _;
        let decoded = match self.decoder.decode(frame) {
            Ok(Some(yuv)) => yuv,
            Ok(None) => return,
            Err(_) => {
                if let Some(stream) = self.rtc.direct_api().stream_rx_by_mid(self.mid, None) {
                    stream.request_keyframe(KeyframeRequestKind::Pli);
                }
                return;
            }
        };
        let (width, height) = decoded.dimensions();
        let mut pixels = vec![0u8; width * height * 4];
        decoded.write_rgba8(&mut pixels);
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
        if self.size != Some((width, height)) {
            self.size = Some((width, height));
            out.tell("size", json!({"width": width, "height": height}));
        }
        out.frame(Size { width: width as u32, height: height as u32 }, pixels);
    }
}
