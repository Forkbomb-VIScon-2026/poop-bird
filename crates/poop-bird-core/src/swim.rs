#[derive(Clone, Copy, Debug)]
pub struct BuoyancyParams {
    pub max_sink: f64,
    pub max_rise: f64,
    pub hover_puff: f64,
}

pub fn target_velocity(puff: f64, p: &BuoyancyParams) -> f64 {
    let x = puff.clamp(0.0, 1.0);
    let hover = p.hover_puff.clamp(0.01, 0.99);
    if x <= hover {
        p.max_sink * (1.0 - x / hover)
    } else {
        -p.max_rise * ((x - hover) / (1.0 - hover))
    }
}

pub fn puff_for_velocity(vy: f64, p: &BuoyancyParams) -> f64 {
    let hover = p.hover_puff.clamp(0.01, 0.99);
    if vy >= 0.0 {
        hover * (1.0 - (vy / p.max_sink.max(1e-6)).clamp(0.0, 1.0))
    } else {
        hover + (1.0 - hover) * (-vy / p.max_rise.max(1e-6)).clamp(0.0, 1.0)
    }
}

pub fn guide_puff(y: f64, target_y: f64, time: f64, p: &BuoyancyParams) -> f64 {
    puff_for_velocity((target_y - y) / time.max(0.05), p)
}

pub fn apply_drag(vy: f64, target: f64, dt: f64, drag_time: f64) -> f64 {
    if drag_time <= 0.0 {
        return target;
    }
    target + (vy - target) * (-dt.max(0.0) / drag_time).exp()
}

pub fn puff_scale(puff: f64, min: f64, max: f64) -> f64 {
    min + (max - min) * puff.clamp(0.0, 1.0)
}

#[derive(Clone, Copy, Debug)]
pub struct SpikeParams {
    pub threshold: f64,
    pub release: f64,
    pub max_hold: f64,
    pub warn_time: f64,
    pub stun_time: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SpikeState {
    pub spiked: bool,
    pub hold: f64,
    pub stun: f64,
    pub needs_deflate: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpikeEvent {
    Spike,
    Unspike,
    Pop,
}

pub fn pop_progress(s: &SpikeState, p: &SpikeParams) -> f64 {
    if !s.spiked {
        return 0.0;
    }
    (s.hold / p.max_hold.max(1e-3)).clamp(0.0, 1.0)
}

pub fn pop_warning(s: &SpikeState, p: &SpikeParams) -> bool {
    s.spiked && p.warn_time > 0.0 && s.hold >= p.max_hold - p.warn_time
}

pub fn step_spike(s: &mut SpikeState, puff: f64, dt: f64, p: &SpikeParams) -> Option<SpikeEvent> {
    let off = p.threshold - p.release.max(0.0);
    if s.stun > 0.0 {
        s.stun = (s.stun - dt).max(0.0);
        s.needs_deflate |= puff >= off;
        return None;
    }
    if s.needs_deflate {
        s.needs_deflate = puff >= off;
        return None;
    }
    if s.spiked {
        if puff < off {
            s.spiked = false;
            s.hold = 0.0;
            return Some(SpikeEvent::Unspike);
        }
        s.hold += dt;
        if s.hold > p.max_hold {
            *s = SpikeState {
                stun: p.stun_time,
                needs_deflate: true,
                ..SpikeState::default()
            };
            return Some(SpikeEvent::Pop);
        }
        return None;
    }
    if puff >= p.threshold {
        s.spiked = true;
        s.hold = 0.0;
        return Some(SpikeEvent::Spike);
    }
    None
}
