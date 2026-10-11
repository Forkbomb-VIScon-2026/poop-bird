//! Bird motion, independent of encounters, effects and rendering.
//! The world resolves floor/obstacle contacts after advancing this state.
use std::f64::consts::TAU;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct State {
    pub y: f64,
    pub velocity: f64,
    pub rotation: f64,
    pub stretch: f64,
    pub stretch_velocity: f64,
    pub relief: f64,
    pub flap: f64,
}

impl Default for State {
    fn default() -> Self {
        Self {
            y: 240.0,
            velocity: 0.0,
            rotation: 0.0,
            stretch: 1.0,
            stretch_velocity: 0.0,
            relief: 0.0,
            flap: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Life {
    Playing,
    Dying,
    Over,
}

#[derive(Clone, Copy, Debug)]
pub struct Params {
    pub gravity: f64,
    pub start_grace: f64,
    pub charge_gravity_scale: f64,
    pub max_fall_speed: f64,
    pub charge_max_fall_speed: f64,
    pub radius: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Input {
    pub charge: f64,
    pub stunned: bool,
    pub life: Life,
    pub stage_time: f64,
}

impl State {
    pub fn animate(&mut self, dt: f64) {
        self.stretch_velocity +=
            (-(self.stretch - 1.0) * 220.0 - self.stretch_velocity * 14.0) * dt;
        self.stretch = (self.stretch + self.stretch_velocity * dt).clamp(0.6, 1.5);
        self.relief = (self.relief - dt).max(0.0);
        self.flap = (self.flap - dt).max(0.0);
    }

    /// Semi-implicit integration in the existing 120 Hz update order.
    pub fn advance(&mut self, input: Input, dt: f64, p: &Params) {
        let charging = input.charge > 0.0 && !input.stunned;
        let grace = if p.start_grace > 0.0 {
            (input.stage_time / p.start_grace).min(1.0)
        } else {
            1.0
        };
        let dying = input.life != Life::Playing;
        let gravity = p.gravity
            * if dying {
                2.5
            } else {
                grace
                    * if charging {
                        p.charge_gravity_scale
                    } else {
                        1.0
                    }
            };
        let max_fall = if dying {
            900.0
        } else if charging {
            p.max_fall_speed.min(p.charge_max_fall_speed)
        } else {
            p.max_fall_speed
        };
        self.velocity = if self.velocity > max_fall {
            max_fall.max(self.velocity - gravity * 3.0 * dt)
        } else {
            (self.velocity + gravity * dt).min(max_fall)
        };
        self.y += self.velocity * dt;
        if self.y < p.radius {
            self.y = p.radius;
            if self.velocity < 0.0 {
                self.velocity = 0.0;
            }
        }
        self.animate(dt);
        if input.stunned {
            self.rotation += dt * 14.0;
        } else if input.life == Life::Dying {
            self.rotation += (1.4 - self.rotation) * (dt * 6.0).min(1.0);
        } else {
            let target = (self.velocity / 700.0).clamp(-0.5, 0.7);
            // JavaScript rounds half ties toward +infinity, including negative turns.
            let turns = (self.rotation / TAU + 0.5).floor();
            let wound = self.rotation - turns * TAU;
            self.rotation = wound + (target - wound) * (dt * 10.0).min(1.0);
        }
    }
}
