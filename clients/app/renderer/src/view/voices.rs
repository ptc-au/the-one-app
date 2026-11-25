//! A page's voices natively (`crate::voice`): each connected as its `ice` is set, given the screen's `answer` or an
//! SFU's `offer`, its microphone muted as it says, and its events told its page.

use super::Screen;
use crate::tree::{Id, Kind, Mutation};

impl Screen {
    /// What a mutation does to a voice: a new `ice` is a new connection, an `answer` is the screen's, an `offer` is an
    /// SFU's to answer, `muted` is its microphone, and one dropped is closed.
    pub(super) fn voice_mutation(&mut self, mutation: &Mutation) {
        match mutation {
            Mutation::Set { id, name, value }
                if self.tree.nodes.get(id).is_some_and(|node| node.kind == Kind::Voice) =>
            {
                let voice = self.voices.entry(*id).or_default();
                match name.as_str() {
                    "ice" => voice.connect(value, self.wake.clone()),
                    "answer" => {
                        if let Some(sdp) = value.as_str() {
                            voice.answer(sdp);
                        }
                    }
                    "offer" => {
                        if let Some(sdp) = value.as_str() {
                            voice.offer(sdp);
                        }
                    }
                    "muted" => voice.mute(value.as_bool().unwrap_or(false)),
                    "input" => voice.input(value.as_str().filter(|name| !name.is_empty())),
                    "output" => voice.output(value.as_str().filter(|name| !name.is_empty())),
                    _ => {}
                }
            }
            Mutation::Drop { id } => {
                self.voices.remove(id);
            }
            _ => {}
        }
    }

    /// Closes each voice taken out of the page, as soon as it's out, not once its JS lets go of it (`drop`): one
    /// connected before it's put in the page stays until it's been in it.
    pub(super) fn sync_voices(&mut self) {
        let ids: Vec<Id> = self.voices.keys().copied().collect();
        for id in ids {
            let attached = self.attached(id);
            let Some(voice) = self.voices.get_mut(&id) else { continue };
            if attached {
                voice.shown = true;
            } else if voice.shown {
                self.voices.remove(&id);
            }
        }
    }

    /// Tells each voice's page what it said since it was last asked. → whether it told anything.
    pub(super) fn voice_pump(&mut self) -> bool {
        let mut told = Vec::new();
        for (id, voice) in &mut self.voices {
            told.extend(voice.take().into_iter().map(|(name, told)| (*id, name, told)));
        }
        let came = !told.is_empty();
        for (id, name, told) in told {
            self.tell(id, name, told);
        }
        came
    }
}
