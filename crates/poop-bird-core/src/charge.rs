#[derive(Clone, Copy, Debug)]
pub struct Params {
    pub charge_time: f64,
    pub overstrain_time: f64,
    pub sweet_spot_window: f64,
    pub sweet_spot_multiplier: f64,
    pub stun_time: f64,
    pub push_min: f64,
    pub push_max: f64,
    pub push_curve: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct State {
    pub charge: f64,
    pub full_hold: f64,
    pub stun: f64,
    pub needs_release: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    Release {
        charge: f64,
        push: f64,
        sweet_spot: bool,
    },
    Accident {
        charge: f64,
    },
}

pub fn push_for_charge(charge: f64, p: &Params) -> f64 {
    p.push_min + (p.push_max - p.push_min) * charge.clamp(0.0, 1.0).powf(p.push_curve)
}

pub fn in_sweet_spot(s: &State, p: &Params) -> bool {
    s.charge >= 1.0
        && p.sweet_spot_window > 0.0
        && s.full_hold >= p.overstrain_time - p.sweet_spot_window
        && s.full_hold <= p.overstrain_time
}

/// Advances existing state in place. At most one event is emitted per tick.
pub fn step(s: &mut State, straining: bool, dt: f64, p: &Params) -> Option<Event> {
    if s.stun > 0.0 {
        s.stun = (s.stun - dt).max(0.0);
        s.needs_release |= straining;
        return None;
    }
    if s.needs_release {
        s.needs_release = straining;
        return None;
    }
    if straining {
        let charge = (s.charge + dt / p.charge_time.max(1e-3)).min(1.0);
        if charge >= 1.0 {
            let overflow = if s.charge >= 1.0 {
                dt
            } else {
                (dt - (1.0 - s.charge) * p.charge_time).max(0.0)
            };
            s.full_hold += overflow;
        }
        if s.full_hold > p.overstrain_time {
            *s = State {
                stun: p.stun_time,
                needs_release: true,
                ..State::default()
            };
            return Some(Event::Accident { charge });
        }
        s.charge = charge;
        return None;
    }
    if s.charge > 0.0 {
        let sweet_spot = in_sweet_spot(s, p);
        let event = Event::Release {
            charge: s.charge,
            push: push_for_charge(s.charge, p)
                * if sweet_spot {
                    p.sweet_spot_multiplier
                } else {
                    1.0
                },
            sweet_spot,
        };
        s.charge = 0.0;
        s.full_hold = 0.0;
        return Some(event);
    }
    None
}
