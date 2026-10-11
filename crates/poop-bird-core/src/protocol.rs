//! Batched kernel validation protocol. This is not the future world/frame ABI.
use crate::{charge, collision, swim};
pub const VERSION: u32 = 1;
pub const INPUT_STRIDE: usize = 24;
pub const OUTPUT_STRIDE: usize = 8;

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    IncompleteRecord,
    NonFinite,
    UnknownOperation,
    InvalidBoolean,
}

/// Validate the entire request before changing the caller's reusable output.
pub fn evaluate(input: &[f64], output: &mut Vec<f64>) -> Result<(), Error> {
    if !input.len().is_multiple_of(INPUT_STRIDE) {
        return Err(Error::IncompleteRecord);
    }
    for row in input.chunks_exact(INPUT_STRIDE) {
        if row.iter().any(|n| !n.is_finite()) {
            return Err(Error::NonFinite);
        }
        if ![0.0, 1.0, 2.0, 3.0, 4.0].contains(&row[0]) {
            return Err(Error::UnknownOperation);
        }
        let boolean_indices: &[usize] = if row[0] == 0.0 {
            &[4, 5]
        } else if row[0] == 1.0 {
            &[1, 4]
        } else {
            &[]
        };
        if boolean_indices
            .iter()
            .any(|&i| row[i] != 0.0 && row[i] != 1.0)
        {
            return Err(Error::InvalidBoolean);
        }
    }
    output.clear();
    output.reserve(input.len() / INPUT_STRIDE * OUTPUT_STRIDE);
    for r in input.chunks_exact(INPUT_STRIDE) {
        let mut out = [0.0; OUTPUT_STRIDE];
        match r[0] as u32 {
            0 => {
                let mut s = charge::State {
                    charge: r[1],
                    full_hold: r[2],
                    stun: r[3],
                    needs_release: r[4] != 0.0,
                };
                let p = charge::Params {
                    charge_time: r[7],
                    overstrain_time: r[8],
                    sweet_spot_window: r[9],
                    sweet_spot_multiplier: r[10],
                    stun_time: r[11],
                    push_min: r[12],
                    push_max: r[13],
                    push_curve: r[14],
                };
                let event = charge::step(&mut s, r[5] != 0.0, r[6], &p);
                out[..4].copy_from_slice(&[
                    s.charge,
                    s.full_hold,
                    s.stun,
                    f64::from(s.needs_release),
                ]);
                match event {
                    Some(charge::Event::Release {
                        charge,
                        push,
                        sweet_spot,
                    }) => out[4..].copy_from_slice(&[1.0, charge, push, f64::from(sweet_spot)]),
                    Some(charge::Event::Accident { charge }) => {
                        out[4] = 2.0;
                        out[5] = charge;
                    }
                    None => {}
                }
            }
            1 => {
                let mut s = swim::SpikeState {
                    spiked: r[1] != 0.0,
                    hold: r[2],
                    stun: r[3],
                    needs_deflate: r[4] != 0.0,
                };
                let p = swim::SpikeParams {
                    threshold: r[7],
                    release: r[8],
                    max_hold: r[9],
                    warn_time: r[10],
                    stun_time: r[11],
                };
                let event = swim::step_spike(&mut s, r[5], r[6], &p);
                out[..7].copy_from_slice(&[
                    f64::from(s.spiked),
                    s.hold,
                    s.stun,
                    f64::from(s.needs_deflate),
                    match event {
                        Some(swim::SpikeEvent::Spike) => 1.0,
                        Some(swim::SpikeEvent::Unspike) => 2.0,
                        Some(swim::SpikeEvent::Pop) => 3.0,
                        None => 0.0,
                    },
                    swim::pop_progress(&s, &p),
                    f64::from(swim::pop_warning(&s, &p)),
                ]);
            }
            2 => {
                let p = swim::BuoyancyParams {
                    max_sink: r[2],
                    max_rise: r[3],
                    hover_puff: r[4],
                };
                let velocity = swim::target_velocity(r[1], &p);
                out[..4].copy_from_slice(&[
                    velocity,
                    swim::puff_for_velocity(velocity, &p),
                    swim::guide_puff(r[5], r[6], r[7], &p),
                    swim::puff_scale(r[1], r[8], r[9]),
                ]);
            }
            3 => out[0] = swim::apply_drag(r[1], r[2], r[3], r[4]),
            4 => {
                out[0] = f64::from(collision::circle_rect(
                    r[1],
                    r[2],
                    r[3],
                    collision::Rect {
                        x: r[4],
                        y: r[5],
                        w: r[6],
                        h: r[7],
                    },
                ))
            }
            _ => unreachable!("operation validated before evaluation"),
        }
        output.extend_from_slice(&out);
    }
    Ok(())
}
