//! Coarse, versioned city frame protocol. All requests are validated before mutation.
use crate::{
    bird, charge,
    city::{self, Command, Event, Kind, Mode, Params, Text, World},
};

pub const PARAM_COUNT: usize = 23;
#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    Params,
    Request,
    Command,
}

pub fn params(v: &[f64]) -> Result<Params, Error> {
    if v.len() != PARAM_COUNT || v.iter().any(|n| !n.is_finite() || *n < 0.0) || v[14] <= 0.0 {
        return Err(Error::Params);
    }
    Ok(Params {
        charge: charge::Params {
            charge_time: v[0],
            overstrain_time: v[1],
            sweet_spot_window: v[2],
            sweet_spot_multiplier: v[3],
            stun_time: v[4],
            push_min: v[5],
            push_max: v[6],
            push_curve: v[7],
        },
        motion: bird::Params {
            gravity: v[8],
            start_grace: v[9],
            charge_gravity_scale: v[10],
            max_fall_speed: v[11],
            charge_max_fall_speed: v[12],
            radius: 22.0,
        },
        scroll_speed: v[13],
        poop_gravity: v[14],
        fall_cancel: v[15],
        spawn_rate: v[16],
        statue_chance: v[17],
        angry_chance: v[18],
        angry_duration: v[19],
        target_points: v[20],
        combo_max: v[21],
        combo_step: v[22],
    })
}

/// [dt, ticks, held, command count, (command, argument)...]. A single mode's
/// fixed-step batch is processed wholly inside Rust, then events are drained.
pub fn advance(
    world: &mut World,
    p: &Params,
    request: &[f64],
    output: &mut Vec<f64>,
) -> Result<(), Error> {
    if request.len() < 4 || request.iter().any(|n| !n.is_finite()) {
        return Err(Error::Request);
    }
    let integer = |n: f64| n >= 0.0 && n.fract() == 0.0;
    if !(0.0..=0.1).contains(&request[0])
        || !integer(request[1])
        || request[1] > 12.0
        || (request[2] != 0.0 && request[2] != 1.0)
        || !integer(request[3])
        || request[3] > 64.0
        || request.len() != 4 + request[3] as usize * 2
    {
        return Err(Error::Request);
    }
    for c in request[4..].chunks_exact(2) {
        if ![0.0, 1.0, 2.0, 3.0, 4.0].contains(&c[0]) || (c[0] == 1.0 && c[1] <= 0.0) {
            return Err(Error::Command);
        }
    }
    world.events.clear();
    for c in request[4..].chunks_exact(2) {
        world.command(match c[0] as u32 {
            0 => Command::Reset,
            1 => Command::Resize(c[1]),
            2 => Command::Demo,
            3 => Command::Perch,
            _ => Command::SpawnCar,
        });
    }
    for _ in 0..request[1] as usize {
        world.step(request[0], request[2] != 0.0, p);
    }
    encode(world, output);
    Ok(())
}

fn kind(kind: Kind) -> f64 {
    match kind {
        Kind::Car => 0.0,
        Kind::Pedestrian => 1.0,
        Kind::Statue => 2.0,
    }
}
pub fn encode(w: &World, output: &mut Vec<f64>) {
    output.clear();
    output.extend_from_slice(&[
        f64::from(city::FRAME_VERSION),
        w.width,
        match w.mode {
            Mode::Idle => 0.0,
            Mode::Demo => 1.0,
            Mode::Practice => 2.0,
        },
        w.time,
        w.run_time,
        w.bird_x,
        w.bird.y,
        w.bird.velocity,
        w.bird.rotation,
        w.bird.stretch,
        w.bird.stretch_velocity,
        w.bird.relief,
        w.bird.flap,
        w.charge.charge,
        w.charge.full_hold,
        w.charge.stun,
        f64::from(w.charge.needs_release),
        f64::from(w.perch_x.is_some()),
        w.perch_x.unwrap_or(0.0),
        w.speed,
        w.stage_time,
        w.distance,
        w.bonus,
        f64::from(w.combo),
        f64::from(w.best_combo),
        f64::from(w.targets_hit),
        f64::from(w.dropped),
        f64::from(w.accidents),
        w.shake,
        w.message.map_or(-1.0, |v| f64::from(v.0)),
        w.message.map_or(0.0, |v| v.1),
        w.targets.len() as f64,
        w.poops.len() as f64,
        w.particles.len() as f64,
        w.decals.len() as f64,
        w.floaters.len() as f64,
        w.screen_splats.len() as f64,
        w.events.len() as f64,
    ]);
    for t in &w.targets {
        output.extend_from_slice(&[
            f64::from(t.id),
            kind(t.kind),
            t.x,
            t.y,
            t.w,
            t.h,
            t.speed,
            f64::from(t.color),
            t.seed,
            t.flash,
            t.facing,
            f64::from(t.rage.is_some()),
            t.rage.map_or(0.0, |r| r.time),
            t.rage.map_or(0.0, |r| r.walk),
            t.rage.map_or(0.0, |r| f64::from(r.curse)),
            t.splats.len() as f64,
        ]);
        for s in &t.splats {
            output.extend_from_slice(&[s.dx, s.dy, s.radius, s.seed]);
        }
    }
    for p in &w.poops {
        output.extend_from_slice(&[
            f64::from(p.id),
            p.x,
            p.y,
            p.vx,
            p.vy,
            p.radius,
            f64::from(p.big),
            p.trail,
            p.rotation,
        ]);
    }
    for p in &w.particles {
        output.extend_from_slice(&[
            p.x,
            p.y,
            p.vx,
            p.vy,
            p.life,
            p.max_life,
            p.size,
            f64::from(p.color as u8),
            p.gravity,
            f64::from(p.world),
        ]);
    }
    for d in &w.decals {
        output.extend_from_slice(&[d.x, d.y, d.radius, d.seed]);
    }
    for f in &w.floaters {
        let (text, points, mult) = match f.text {
            Text::Perfect => (0.0, 0.0, -1.0),
            Text::Big => (1.0, 0.0, -1.0),
            Text::Weak => (2.0, 0.0, -1.0),
            Text::Points { points, multiplier } => (3.0, points, multiplier.unwrap_or(-1.0)),
            Text::ComboLost => (4.0, 0.0, -1.0),
        };
        output.extend_from_slice(&[
            f.x,
            f.y,
            text,
            points,
            mult,
            f64::from(f.color as u8),
            f.size,
            f.life,
            f.max_life,
        ]);
    }
    for s in &w.screen_splats {
        output.extend_from_slice(&[s.x, s.y, s.radius, s.seed, s.life]);
    }
    for e in &w.events {
        let row = match *e {
            Event::Release { charge, sweet } => [0.0, charge, f64::from(sweet), 0.0, 0.0],
            Event::Accident(m) => [1.0, f64::from(m), 0.0, 0.0, 0.0],
            Event::Hit {
                points,
                combo,
                kind: k,
            } => [2.0, points, f64::from(combo), kind(k), 0.0],
            Event::Splat(big) => [3.0, f64::from(big), 0.0, 0.0, 0.0],
            Event::Curse => [4.0, 0.0, 0.0, 0.0, 0.0],
        };
        output.extend_from_slice(&row);
    }
}
