//! The state of one `herdr.subscribe` stream that carries herdr 1 and herdr-core events. Pure.
//!
//! Each backend is a leg that is up or down. The stream lives while one leg is up. When a leg
//! ends while the other is up, the app gets a refetch hint and the leg connects again later.
//! When the last leg ends, the stream sends `{"closed": true}` as before: with no core, the
//! stream acts exactly as a herdr 1 stream.

/// One backend of the stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Herdr,
    Core,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Leg {
    Up,
    /// Not connected; the I/O tries again at each retry tick.
    Down,
    /// This process has no such backend (no core socket): never tried.
    Off,
}

/// What the I/O does after a step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Send the refetch hint and go on.
    Hint,
    /// Send `{"closed": true}` and end the stream.
    Close,
    /// Nothing to send.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Merge {
    pub herdr: Leg,
    pub core: Leg,
}

impl Merge {
    /// The state after the first connects. None when no leg is up: the call fails.
    pub fn start(herdr: Leg, core: Leg) -> Option<Merge> {
        (herdr == Leg::Up || core == Leg::Up).then_some(Merge { herdr, core })
    }

    fn leg(&mut self, side: Side) -> &mut Leg {
        match side {
            Side::Herdr => &mut self.herdr,
            Side::Core => &mut self.core,
        }
    }

    /// The legs that the I/O tries to connect again.
    pub fn to_retry(&self) -> Vec<Side> {
        [(Side::Herdr, self.herdr), (Side::Core, self.core)].into_iter().filter(|(_, l)| *l == Leg::Down).map(|(s, _)| s).collect()
    }

    /// The stream of `side` ended.
    pub fn ended(&mut self, side: Side) -> Action {
        if *self.leg(side) != Leg::Up {
            return Action::None;
        }
        *self.leg(side) = Leg::Down;
        if self.herdr == Leg::Up || self.core == Leg::Up {
            Action::Hint
        } else {
            Action::Close
        }
    }

    /// A retry of `side` connected.
    pub fn connected(&mut self, side: Side) -> Action {
        if *self.leg(side) != Leg::Down {
            return Action::None;
        }
        *self.leg(side) = Leg::Up;
        Action::Hint
    }
}
