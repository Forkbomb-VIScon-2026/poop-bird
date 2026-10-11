//! City simulation. Advanced encounters and waterfront transitions are not yet
//! migrated; scoped runs stop explicitly before the waterfront.
use crate::{bird, charge, rng::Rng};

pub const FRAME_VERSION: u32 = 2;
const GROUND: f64 = 520.0;
const RADIUS: f64 = 22.0;
const PERCH: f64 = 270.0;
const DRAG: f64 = 0.6;

#[derive(Clone, Copy, Debug)]
pub struct Params {
    pub charge: charge::Params,
    pub motion: bird::Params,
    pub scroll_speed: f64,
    pub poop_gravity: f64,
    pub fall_cancel: f64,
    pub spawn_rate: f64,
    pub statue_chance: f64,
    pub angry_chance: f64,
    pub angry_duration: f64,
    pub target_points: f64,
    pub combo_max: f64,
    pub combo_step: f64,
    pub scroll_max: f64,
    pub difficulty_ramp: f64,
    pub first_delay: f64,
    pub spacing: f64,
    pub spacing_min: f64,
    pub gap: f64,
    pub gap_min: f64,
    pub tall_chance: f64,
    pub tall_max: f64,
    pub hardest_city: f64,
    pub before_gate: f64,
    pub distance_per_point: f64,
    pub paparazzi_chance: f64,
    pub kid_chance: f64,
    pub wedding_chance: f64,
    pub power_line_chance: f64,
    pub balloon_chance: f64,
    pub paparazzi_min_distance: f64,
    pub kid_first_city: f64,
    pub kid_min_distance: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Idle,
    Demo,
    Practice,
    Run,
}

#[derive(Clone, Copy, Debug)]
pub enum Command {
    Reset,
    Resize(f64),
    Demo,
    Perch,
    SpawnCar,
    TakeOff(f64),
    Lesson(bool),
}

mod effects;
mod entities;
mod obstacles;
mod projectiles;
mod run;
mod targets;
pub use entities::*;

/// Owns simulation and reuses vector storage. Presentation never borrows mutable
/// entities; stable IDs survive compaction and returned frames are safe copies.
pub struct World {
    pub width: f64,
    pub mode: Mode,
    pub time: f64,
    pub run_time: f64,
    pub bird_x: f64,
    pub bird: bird::State,
    pub charge: charge::State,
    pub perch_x: Option<f64>,
    pub speed: f64,
    pub stage_time: f64,
    pub distance: f64,
    pub bonus: f64,
    pub combo: u32,
    pub best_combo: u32,
    pub targets_hit: u32,
    pub dropped: u32,
    pub accidents: u32,
    pub shake: f64,
    pub message: Option<(u8, f64)>,
    pub targets: Vec<Target>,
    pub poops: Vec<Poop>,
    pub particles: Vec<Particle>,
    pub decals: Vec<Decal>,
    pub floaters: Vec<Floater>,
    pub screen_splats: Vec<ScreenSplat>,
    pub events: Vec<Event>,
    pub life: bird::Life,
    pub calm_city: bool,
    pub dying_time: f64,
    pub blocked: bool,
    pub obstacles: Vec<Obstacle>,
    pub stage_obstacles: u32,
    next_obstacle_at: Option<f64>,
    last_gap_center: f64,
    next_obstacle: u32,
    rng: Rng,
    spawn_acc: f64,
    next_target: u32,
    next_poop: u32,
}

impl World {
    pub fn new(width: f64, seed: u32) -> Self {
        let mut world = Self {
            width,
            mode: Mode::Idle,
            time: 0.0,
            run_time: 0.0,
            bird_x: 0.0,
            bird: bird::State::default(),
            charge: charge::State::default(),
            perch_x: None,
            speed: 0.0,
            stage_time: 0.0,
            distance: 0.0,
            bonus: 0.0,
            combo: 0,
            best_combo: 0,
            targets_hit: 0,
            dropped: 0,
            accidents: 0,
            shake: 0.0,
            message: None,
            targets: Vec::new(),
            poops: Vec::new(),
            particles: Vec::with_capacity(600),
            decals: Vec::with_capacity(60),
            floaters: Vec::new(),
            screen_splats: Vec::new(),
            events: Vec::new(),
            life: bird::Life::Playing,
            calm_city: false,
            dying_time: 0.0,
            blocked: false,
            obstacles: Vec::new(),
            stage_obstacles: 0,
            next_obstacle_at: None,
            last_gap_center: 260.0,
            next_obstacle: 1,
            rng: Rng::new(seed),
            spawn_acc: 0.6,
            next_target: 1,
            next_poop: 1,
        };
        world.resize(width);
        world.reset();
        world
    }

    pub fn resize(&mut self, width: f64) {
        self.width = width;
        let x = self.bird_x;
        self.bird_x = (320.0_f64.min(width * 0.28) + 0.5).floor();
        if self.mode == Mode::Practice
            && let Some(px) = &mut self.perch_x
        {
            *px += self.bird_x - x;
        }
    }

    pub fn reset(&mut self) {
        self.life = bird::Life::Playing;
        self.calm_city = false;
        self.dying_time = 0.0;
        self.blocked = false;
        self.obstacles.clear();
        self.stage_obstacles = 0;
        self.next_obstacle_at = None;
        self.last_gap_center = 260.0;
        self.next_obstacle = 1;
        self.mode = Mode::Idle;
        self.time = 0.0;
        self.run_time = 0.0;
        self.bird = bird::State::default();
        self.charge = charge::State::default();
        self.perch_x = None;
        self.speed = 0.0;
        self.stage_time = 0.0;
        self.distance = 0.0;
        self.bonus = 0.0;
        self.combo = 0;
        self.best_combo = 0;
        self.targets_hit = 0;
        self.dropped = 0;
        self.accidents = 0;
        self.shake = 0.0;
        self.message = None;
        self.spawn_acc = 0.6;
        self.next_target = 1;
        self.next_poop = 1;
        self.targets.clear();
        self.poops.clear();
        self.particles.clear();
        self.decals.clear();
        self.floaters.clear();
        self.screen_splats.clear();
        self.events.clear();
        // Legacy reset plans a wedding even in attract/practice modes. Preserve
        // this draw so the entire seeded reference stream stays aligned.
        self.rng.next_f64();
    }

    pub fn command(&mut self, command: Command) {
        match command {
            Command::Reset => self.reset(),
            Command::Resize(w) => self.resize(w),
            Command::Demo => {
                self.reset();
                self.mode = Mode::Demo;
            }
            Command::Perch => {
                self.mode = Mode::Practice;
                self.perch_x = Some(self.bird_x);
                self.bird.y = PERCH;
                self.bird.velocity = 0.0;
                self.bird.rotation = 0.0;
            }
            Command::SpawnCar => self.spawn_target(true, 0.0),
            Command::TakeOff(push) => {
                self.bird.velocity = self.bird.velocity.min(-push);
                self.mode = Mode::Run;
                self.bonus = 0.0;
                self.combo = 0;
                self.best_combo = 0;
                self.targets_hit = 0;
                self.dropped = 0;
                self.accidents = 0;
                self.floaters.clear();
            }
            Command::Lesson(enabled) => self.calm_city = enabled,
        }
    }

    fn random(&mut self) -> f64 {
        self.rng.next_f64()
    }

    fn pick(&mut self, len: usize) -> u8 {
        (self.random() * len as f64).floor() as u8
    }

    fn multiplier(&self, p: &Params) -> f64 {
        if self.combo == 0 {
            1.0
        } else {
            p.combo_max
                .min(1.0 + p.combo_step * f64::from(self.combo - 1))
        }
    }

    pub fn step(&mut self, dt: f64, held: bool, p: &Params) {
        self.initialize(p);
        match self.mode {
            Mode::Run => self.step_run(dt, held, p),
            Mode::Idle => {
                self.time += dt;
                self.speed = 0.0;
                self.bird.y = 240.0 + (self.time * 2.5).sin() * 12.0;
                self.bird.rotation = (self.time * 2.5 + 1.0).sin() * 0.08;
                self.effects(dt, 0.0);
            }
            Mode::Practice => {
                self.time += dt;
                self.speed = 0.0;
                self.update_charge(held, dt, p);
                let charging = self.charge.charge > 0.0 && self.charge.stun <= 0.0;
                self.bird.velocity = self.bird.velocity.max(-280.0);
                self.bird.velocity = (self.bird.velocity
                    + p.motion.gravity
                        * if charging {
                            p.motion.charge_gravity_scale
                        } else {
                            1.0
                        }
                        * dt)
                    .min(p.motion.max_fall_speed);
                self.bird.y += self.bird.velocity * dt;
                if self.bird.y >= PERCH {
                    self.bird.y = PERCH;
                    self.bird.velocity = self.bird.velocity.min(0.0);
                }
                self.bird.animate(dt);
                let target = if self.charge.stun > 0.0 {
                    0.0
                } else {
                    (self.bird.velocity / 700.0).clamp(-0.5, 0.7)
                };
                self.bird.rotation += (target - self.bird.rotation) * (dt * 10.0).min(1.0);
                for t in &mut self.targets {
                    t.flash = (t.flash - dt).max(0.0);
                }
                self.update_poops(dt, 0.0, p);
                self.effects(dt, 0.0);
            }
            Mode::Demo => {
                let held = self.autopilot(p);
                self.time += dt;
                self.run_time += dt;
                self.stage_time += dt;
                self.speed = p.scroll_speed;
                self.distance += self.speed * dt;
                self.update_charge(held, dt, p);
                self.bird.advance(
                    bird::Input {
                        charge: self.charge.charge,
                        stunned: self.charge.stun > 0.0,
                        life: bird::Life::Playing,
                        stage_time: self.stage_time,
                    },
                    dt,
                    &p.motion,
                );
                if self.bird.y + RADIUS >= GROUND {
                    self.bird.y = GROUND - RADIUS;
                    self.bird.velocity = self.bird.velocity.min(0.0);
                }
                self.update_targets(dt, p);
                self.update_poops(dt, self.speed, p);
                self.effects(dt, self.speed);
                self.bird.velocity = self.bird.velocity.max(-300.0);
                for i in 0..self.poops.len() {
                    let poop = self.poops[i];
                    if let Some(aim) = self.aim(poop.x, poop.y, poop.vy, poop.vx, 40.0, p) {
                        self.poops[i].vx += (aim - poop.vx) * (dt * 3.0).min(1.0);
                    }
                }
                self.events.clear();
            }
        }
    }
}
