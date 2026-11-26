//! A page's `play` natively: a short sound its app ships, WAV or MP3, on the system's default speakers as rodio plays
//! one, over cpal as a `voice`'s are. Each is its own stream, opened as it plays and closed when it ends, so it's
//! heard beside a call, whose audio it doesn't touch, and while the page's window is put away, and a device with its
//! speakers muted or turned down plays it as quietly as it plays anything.

use std::io::Cursor;

use rodio::{Decoder, DeviceSinkBuilder, Player};

/// Whether this build has speakers at all: the headless renderer has none (`--features fake`).
const DEVICES: bool = !cfg!(feature = "fake");

/// Plays the sound in `file` once. → why it isn't one the renderer plays. A device that has no speakers, or won't open
/// them, plays nothing.
pub fn play(file: Vec<u8>) -> anyhow::Result<()> {
    let sound = Decoder::new(Cursor::new(file))?;
    if !DEVICES {
        return Ok(());
    }
    std::thread::Builder::new().name("sound".into()).spawn(move || match DeviceSinkBuilder::open_default_sink() {
        Ok(mut speakers) => {
            // It's dropped as its sound ends, which is when a stream is meant to be.
            speakers.log_on_drop(false);
            let player = Player::connect_new(speakers.mixer());
            player.append(sound);
            player.sleep_until_end();
        }
        Err(error) => eprintln!("a sound wasn't played: {error}"),
    })?;
    Ok(())
}
