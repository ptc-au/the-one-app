//! A page's `voice` natively (renderer.ts's `voice`): a call's audio over WebRTC, as the web's browser carries one
//! (clients/web/renderer/voice.js). WebRTC is str0m's and Opus's (libopus, which audiopus builds from its own source),
//! so the two ends are one stack on every kind of device, with no browser and no libwebrtc; the microphone and the
//! speakers are cpal's, as each system has them; and what the speakers play is taken out of what the microphone hears
//! by aec3, the echo canceller Chrome's audio processing has. Each connection is a thread of its own: it reaches the
//! screen only through a TURN server's relay, over TCP, as `video` does (`turn`), offers one Opus track to send and
//! receive, takes the screen's answer or an SFU's offer, and encodes the microphone into the one and mixes the tracks
//! it receives into the speakers. What it says the page hears as events (`offer`, `answer`, `state`, `speaking`).

use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use aec3::audio_processing::resampler::push_sinc_resampler::PushSincResampler;
use aec3::nodes::audio::AudioFormat;
use aec3::pipelines::linear::{self, LinearPipeline};
use anyhow::{Context, anyhow};
use audiopus::coder::{Decoder, Encoder};
use audiopus::packet::Packet;
use audiopus::{Application, Bitrate, Channels, MutSignals, SampleRate};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::{Value, json};
use str0m::change::{SdpAnswer, SdpOffer, SdpPendingOffer};
use str0m::format::Codec;
use str0m::media::{Direction, Frequency, MediaData, MediaKind, MediaTime, Mid, Pt};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event as RtcEvent, IceConnectionState, Input as RtcInput, Output, Rtc};

use crate::turn::{Ice, Turn, candidates};

/// The rate every codec here is at, and how many samples a frame of 10 ms takes: aec3's and Opus's both.
const RATE: usize = 48_000;
const FRAME: usize = RATE / 100;

/// How loud the cleaned microphone is when the person starts speaking, and when they've stopped, in RMS.
const SPEAKING: f32 = 0.02;
const QUIET: f32 = 0.008;

/// Whether this build has audio devices at all: the headless renderer has none (`--features fake`).
const DEVICES: bool = !cfg!(feature = "fake");

/// What reaches a connection's thread: what its page did, or what its microphone heard.
enum Command {
    /// The TURN server sent something, which the connection takes.
    Wake,
    Answer(String),
    Offer(String),
    /// The microphone's, mono at its device's rate.
    Mic(Vec<f32>),
    Close,
}

/// What a connection has for its page: what it's to hear, and whether its microphone is off.
#[derive(Default)]
struct Shared {
    told: Vec<(&'static str, Value)>,
    muted: bool,
}

/// A `voice` node: its connection, the last made, and whether its page has had it.
#[derive(Default)]
pub(crate) struct Voice {
    commands: Option<Sender<Command>>,
    shared: Arc<Mutex<Shared>>,
    /// Its microphone is off, as its page last said.
    muted: bool,
    /// An SFU's offer its page set, which its connection may not have been made for yet.
    offer: Option<String>,
    /// It's been in its page, so it's closed once it's out of it (`Screen::sync_voices`).
    pub shown: bool,
}

impl Drop for Voice {
    fn drop(&mut self) {
        self.close();
    }
}

impl Voice {
    /// A new connection with `ice`, the last one closed; `wake` wakes its window as it has something for it. No `ice`
    /// is none.
    pub fn connect(&mut self, ice: &Value, wake: Option<Arc<dyn Fn() + Send + Sync>>) {
        self.close();
        if ice.is_null() {
            return;
        }
        let (commands, received) = mpsc::channel();
        let shared = Arc::new(Mutex::new(Shared::default()));
        self.shared = shared.clone();
        self.commands = Some(commands.clone());
        let muted = self.muted;
        let offer = self.offer.clone();
        let ice = ice.clone();
        let _ = std::thread::Builder::new().name("voice".into()).spawn(move || {
            let out = Out { shared, wake };
            // What its page said before it was connected, which it hadn't a connection to say to.
            if let Some(sdp) = offer {
                let _ = commands.send(Command::Offer(sdp));
            }
            match connection(ice, muted, &commands, &received, &out) {
                Ok(why) => eprintln!("A voice's connection ended: {why}"),
                Err(why) => eprintln!("A voice's connection failed: {why:#}"),
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
        self.send(Command::Answer(sdp.to_owned()));
    }

    /// An SFU's offer, which it answers, telling its page as `answer`. One it's already been given isn't answered
    /// twice.
    pub fn offer(&mut self, sdp: &str) {
        if self.offer.as_deref() == Some(sdp) {
            return;
        }
        self.offer = Some(sdp.to_owned());
        self.send(Command::Offer(sdp.to_owned()));
    }

    /// Its microphone, on or off.
    pub fn mute(&mut self, muted: bool) {
        self.muted = muted;
        lock(&self.shared).muted = muted;
    }

    fn send(&self, command: Command) {
        if let Some(commands) = &self.commands {
            let _ = commands.send(command);
        }
    }

    /// What its page is to hear since it was last asked.
    pub fn take(&mut self) -> Vec<(&'static str, Value)> {
        std::mem::take(&mut lock(&self.shared).told)
    }
}

fn lock<T>(shared: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    shared.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// What a connection's thread gives its page, which is woken to take it.
struct Out {
    shared: Arc<Mutex<Shared>>,
    wake: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl Out {
    /// An event its page is to hear.
    fn tell(&self, name: &'static str, told: Value) {
        lock(&self.shared).told.push((name, told));
        if let Some(wake) = &self.wake {
            wake();
        }
    }
}

/// One connection, from its offer until it's closed or lost: gives why it ended.
fn connection(
    ice: Value,
    muted: bool,
    commands: &Sender<Command>,
    received: &Receiver<Command>,
    out: &Out,
) -> anyhow::Result<String> {
    lock(&out.shared).muted = muted;
    let ice: Ice = serde_json::from_value(ice).context("its ICE servers")?;
    let wake = {
        let commands = commands.clone();
        Arc::new(move || {
            let _ = commands.send(Command::Wake);
        })
    };
    let mut turn = Turn::connect(&ice, wake)?;
    let relay = turn.allocate()?;

    let mut rtc = Rtc::builder().clear_codecs().enable_opus(true, false).build(Instant::now());
    rtc.add_local_candidate(Candidate::relayed(relay, turn.local(), "udp")?);
    let mut change = rtc.sdp_api();
    let mid = change.add_media(MediaKind::Audio, Direction::SendRecv, None, None, None);
    let (offer, pending) = change.apply().ok_or_else(|| anyhow!("there was nothing to offer"))?;
    out.tell("offer", json!({"sdp": offer.to_sdp_string()}));
    out.tell("state", json!({"state": "connecting"}));

    let mut session = Session {
        rtc,
        turn,
        relay,
        mid,
        pending: Some(pending),
        ended: None,
        pt: None,
        sent: 0,
        speaking: false,
        audio: Audio::open(commands)?,
    };
    session.run(received, out)
}

struct Session {
    rtc: Rtc,
    turn: Turn,
    relay: SocketAddr,
    /// Where it sends its microphone's track, as the last answer or offer said.
    mid: Mid,
    pending: Option<SdpPendingOffer>,
    ended: Option<String>,
    /// The payload type its Opus is sent as, once negotiated.
    pt: Option<Pt>,
    /// How many samples it has sent, which is their RTP time.
    sent: u64,
    /// Whether its person is speaking, as their microphone says.
    speaking: bool,
    audio: Audio,
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
                    // What the screen reaches the relay from, which the relay takes from only once permitted.
                    for ip in candidates(&sdp) {
                        self.turn.permit(ip);
                    }
                    self.rtc
                        .sdp_api()
                        .accept_answer(pending, SdpAnswer::from_sdp_string(&sdp).context("the screen's answer")?)?;
                    self.pt = self.opus();
                    self.turn.flush()?;
                }
                Ok(Command::Offer(sdp)) => {
                    let answer =
                        self.rtc.sdp_api().accept_offer(SdpOffer::from_sdp_string(&sdp).context("the SFU's offer")?)?;
                    let answer = answer.to_sdp_string();
                    // What it sends now, on the audio m-line it answered as sending.
                    if let Some(mid) = sending_audio(&answer) {
                        self.mid = mid;
                    }
                    self.pending = None;
                    self.pt = self.opus();
                    self.turn.flush()?;
                    out.tell("answer", json!({"sdp": answer}));
                }
                Ok(Command::Mic(samples)) => self.heard(&samples, out)?,
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
                    RtcEvent::IceConnectionStateChange(IceConnectionState::Connected) => {
                        out.tell("state", json!({"state": "connected"}))
                    }
                    RtcEvent::IceConnectionStateChange(IceConnectionState::Disconnected) => {
                        self.ended = Some("the screen went".into())
                    }
                    RtcEvent::MediaData(data) => self.played(&data)?,
                    _ => {}
                },
            }
        }
    }

    /// Where its Opus is sent, as the last negotiation had it.
    fn opus(&mut self) -> Option<Pt> {
        let writer = self.rtc.writer(self.mid)?;
        writer.payload_params().find(|params| params.spec().codec == Codec::Opus).map(|params| params.pt())
    }

    /// The microphone's samples, mono at its device's rate: each frame of 10 ms at 48 kHz of them, once the speakers
    /// are taken out of it, is sent, and its level says whether the person is speaking.
    fn heard(&mut self, samples: &[f32], out: &Out) -> anyhow::Result<()> {
        self.audio.capture.extend_from_slice(samples);
        while self.audio.capture.len() >= self.audio.frame {
            let block: Vec<f32> = self.audio.capture.drain(..self.audio.frame).collect();
            let clean = self.audio.clean(block)?;
            self.speak(&clean, out)?;
        }
        Ok(())
    }

    /// Sends a frame of the microphone's, or silence where it's muted, and tells its page whether the person is
    /// speaking.
    fn speak(&mut self, clean: &[f32; FRAME], out: &Out) -> anyhow::Result<()> {
        let muted = lock(&out.shared).muted;
        let level = level(clean);
        let speaking = if self.speaking { level > QUIET } else { level > SPEAKING } && !muted;
        if speaking != self.speaking {
            self.speaking = speaking;
            out.tell("speaking", json!({"speaking": speaking}));
        }
        let Some(pt) = self.pt else { return Ok(()) };
        let Some(writer) = self.rtc.writer(self.mid) else { return Ok(()) };
        let frame: &[f32; FRAME] = if muted { &[0.0; FRAME] } else { clean };
        let len = self.audio.encoder.encode_float(frame, &mut self.audio.packet).context("the Opus encoder")?;
        writer.write(
            pt,
            Instant::now(),
            MediaTime::new(self.sent, Frequency::FORTY_EIGHT_KHZ),
            self.audio.packet[..len].to_vec(),
        )?;
        self.sent += FRAME as u64;
        Ok(())
    }

    /// One audio packet the screen sent, decoded into its track and mixed into what the speakers play.
    fn played(&mut self, data: &MediaData) -> anyhow::Result<()> {
        if data.params.spec().codec != Codec::Opus {
            return Ok(());
        }
        let mid = data.mid;
        let decoder = match self.audio.decoders.entry(mid) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(Decoder::new(SampleRate::Hz48000, Channels::Mono).context("an Opus decoder")?)
            }
        };
        let Ok(packet) = Packet::try_from(&data.data[..]) else { return Ok(()) };
        let decoded = decoder.decode_float(
            Some(packet),
            MutSignals::try_from(&mut self.audio.decoded[..]).context("an Opus frame")?,
            false,
        );
        // A packet that doesn't decode is what a lost one is: the call goes on, and the next one plays.
        let Ok(samples) = decoded else { return Ok(()) };
        let track = self.audio.tracks.entry(mid).or_default();
        track.extend(&self.audio.decoded[..samples]);
        // A track that comes faster than the speakers play it, or with nothing playing them, keeps a second of it.
        while track.len() > RATE {
            track.pop_front();
        }
        self.mix();
        Ok(())
    }

    /// Mixes each remote track's decoded frames into what the speakers play and the echo canceller hears, a frame from
    /// each that has one: one that's paused adds nothing, and what's playing goes on.
    fn mix(&mut self) {
        loop {
            if !self.audio.tracks.values().any(|track| track.len() >= FRAME) {
                return;
            }
            let mut mixed = [0.0f32; FRAME];
            for track in self.audio.tracks.values_mut() {
                if track.len() < FRAME {
                    continue;
                }
                for (at, sample) in mixed.iter_mut().zip(track.drain(..FRAME)) {
                    *at += sample;
                }
            }
            for sample in &mut mixed {
                *sample = sample.clamp(-1.0, 1.0);
            }
            lock(&self.audio.playing).extend(mixed);
            let mut played = lock(&self.audio.played);
            played.extend(mixed);
            while played.len() > RATE {
                played.pop_front();
            }
        }
    }
}

/// How loud a frame is, as RMS, which says whether someone's speaking.
fn level(frame: &[f32]) -> f32 {
    (frame.iter().map(|sample| sample * sample).sum::<f32>() / frame.len() as f32).sqrt()
}

/// The m-line an SDP's audio is sent on, as it says (`a=sendrecv` or `a=sendonly`), where it sends any.
fn sending_audio(sdp: &str) -> Option<Mid> {
    let (mut mid, mut audio, mut sending) = (None, false, false);
    for line in sdp.lines() {
        if let Some(rest) = line.strip_prefix("m=") {
            if audio && sending {
                return mid;
            }
            audio = rest.starts_with("audio");
            sending = false;
            mid = None;
        } else if let Some(rest) = line.strip_prefix("a=mid:") {
            mid = Some(Mid::from(rest.trim()));
        } else if audio {
            match line {
                "a=sendrecv" | "a=sendonly" => sending = true,
                "a=recvonly" | "a=inactive" => sending = false,
                _ => {}
            }
        }
    }
    (audio && sending).then_some(mid).flatten()
}

/// What the speakers play, and what the microphone hears once it's taken out, at 48 kHz mono: aec3's echo canceller
/// and Opus, from the microphone's device rate to the call's.
struct Audio {
    /// Kept for as long as the connection: a stream that's dropped stops.
    _mic: Option<cpal::Stream>,
    _speaker: Option<cpal::Stream>,
    /// What the speakers are to play, and what they've played, which the echo canceller listens to for what it takes
    /// out of the microphone.
    playing: Arc<Mutex<VecDeque<f32>>>,
    played: Arc<Mutex<VecDeque<f32>>>,
    /// The microphone's samples, mono at its device's rate, until there are a frame of them, and how many a frame is.
    capture: Vec<f32>,
    frame: usize,
    /// The device's frames brought to 48 kHz, where it doesn't give that.
    resampler: Option<PushSincResampler>,
    /// aec3's: echo cancellation, noise suppression and gain, as Chrome's audio processing has them.
    echo: LinearPipeline,
    /// Opus, of the one track it sends and of each it receives, by its m-line.
    encoder: Encoder,
    decoders: HashMap<Mid, Decoder>,
    /// What each remote track has decoded that hasn't been played, 48 kHz mono.
    tracks: HashMap<Mid, VecDeque<f32>>,
    /// The packet encoded into, and the frame decoded out.
    packet: Vec<u8>,
    decoded: Vec<f32>,
}

/// The frame format every codec here takes: 10 ms of 48 kHz mono.
const FORMAT: AudioFormat = AudioFormat::ten_ms(RATE as u32, 1);

impl Audio {
    /// The microphone and the speakers, with aec3 and Opus: the devices where this build and this machine have them,
    /// and none where they don't, as a headless machine's or a server's, so a call still connects and is heard.
    fn open(commands: &Sender<Command>) -> anyhow::Result<Self> {
        let mut audio = Self {
            _mic: None,
            _speaker: None,
            playing: Arc::new(Mutex::new(VecDeque::new())),
            played: Arc::new(Mutex::new(VecDeque::new())),
            capture: Vec::new(),
            frame: FRAME,
            resampler: None,
            echo: linear::builder(FORMAT, FORMAT).build().context("the echo canceller")?,
            encoder: Encoder::new(SampleRate::Hz48000, Channels::Mono, Application::Voip)
                .context("the Opus encoder")?,
            decoders: HashMap::new(),
            tracks: HashMap::new(),
            packet: vec![0; 4000],
            decoded: vec![0.0; RATE / 5],
        };
        audio.encoder.set_bitrate(Bitrate::BitsPerSecond(32_000)).context("the Opus encoder's bitrate")?;
        if DEVICES {
            audio.speaker();
            audio.microphone(commands);
        }
        Ok(audio)
    }

    /// The speakers, which play what's mixed for them: each frame as it comes, and silence where there's nothing.
    fn speaker(&mut self) {
        let Some(device) = cpal::default_host().default_output_device() else {
            eprintln!("A voice has no speakers: it plays nothing");
            return;
        };
        let Some(config) = device.supported_output_configs().ok().and_then(float_config) else {
            eprintln!("A voice's speakers take no float audio: it plays nothing");
            return;
        };
        let channels = config.channels() as usize;
        let playing = self.playing.clone();
        let stream = device.build_output_stream::<f32, _, _>(
            config.config(),
            move |data: &mut [f32], _| {
                let mut playing = lock(&playing);
                for frame in data.chunks_exact_mut(channels) {
                    let sample = playing.pop_front().unwrap_or(0.0);
                    for out in frame {
                        *out = sample;
                    }
                }
            },
            |why| eprintln!("A voice's speakers stopped: {why}"),
            None,
        );
        match stream {
            Ok(stream) => match stream.play() {
                Ok(()) => self._speaker = Some(stream),
                Err(why) => eprintln!("A voice's speakers didn't start: {why}"),
            },
            Err(why) => eprintln!("A voice's speakers didn't open: {why}"),
        }
    }

    /// The microphone, whose samples it hands its connection as they come, mono.
    fn microphone(&mut self, commands: &Sender<Command>) {
        let Some(device) = cpal::default_host().default_input_device() else {
            eprintln!("A voice has no microphone: it sends nothing");
            return;
        };
        let Some(config) = device.supported_input_configs().ok().and_then(float_config) else {
            eprintln!("A voice's microphone gives no float audio: it sends nothing");
            return;
        };
        let rate = config.sample_rate();
        let channels = config.channels() as usize;
        self.frame = (rate as usize / 100).max(1);
        self.resampler = (rate as usize != RATE).then(|| PushSincResampler::new(self.frame, FRAME));
        let samples = commands.clone();
        let stream = device.build_input_stream::<f32, _, _>(
            config.config(),
            move |data: &[f32], _| {
                let mut mono = Vec::with_capacity(data.len() / channels);
                for frame in data.chunks_exact(channels) {
                    mono.push(frame.iter().sum::<f32>() / channels as f32);
                }
                let _ = samples.send(Command::Mic(mono));
            },
            |why| eprintln!("A voice's microphone stopped: {why}"),
            None,
        );
        match stream {
            Ok(stream) => match stream.play() {
                Ok(()) => self._mic = Some(stream),
                Err(why) => eprintln!("A voice's microphone didn't start: {why}"),
            },
            Err(why) => eprintln!("A voice's microphone didn't open: {why}"),
        }
    }

    /// A frame of the call's from the microphone's, at its device's rate: with what the speakers played taken out of
    /// it, and the level of what's left.
    fn clean(&mut self, block: Vec<f32>) -> anyhow::Result<[f32; FRAME]> {
        let capture: [f32; FRAME] = match &mut self.resampler {
            Some(resampler) => {
                let mut at = [0.0; FRAME];
                resampler.resample_f32(&block, &mut at);
                at
            }
            None => block.as_slice().try_into().unwrap_or([0.0; FRAME]),
        };
        let mut render = [0.0; FRAME];
        {
            let mut played = lock(&self.played);
            for sample in &mut render {
                *sample = played.pop_front().unwrap_or(0.0);
            }
        }
        self.echo.handle_render_frame(&render).context("the echo canceller")?;
        let mut clean = [0.0; FRAME];
        self.echo.process_capture_frame(&capture, &mut clean).context("the echo canceller")?;
        Ok(clean)
    }
}

/// The device's float audio at 48 kHz where it has it, else at the rate it has, and mono where it can: what aec3 and
/// Opus take, which every system's devices can give.
fn float_config(ranges: impl Iterator<Item = cpal::SupportedStreamConfigRange>) -> Option<cpal::SupportedStreamConfig> {
    let mut best: Option<(bool, u16, cpal::SupportedStreamConfig)> = None;
    for range in ranges.filter(|range| range.sample_format() == cpal::SampleFormat::F32) {
        let at = if range.min_sample_rate() <= RATE as u32 { RATE as u32 } else { range.min_sample_rate() };
        let Some(config) = range.try_with_sample_rate(at) else { continue };
        let choice = (config.sample_rate() != RATE as u32, config.channels(), config);
        if best.as_ref().is_none_or(|best| (choice.0, choice.1) < (best.0, best.1)) {
            best = Some(choice);
        }
    }
    best.map(|(_, _, config)| config)
}
