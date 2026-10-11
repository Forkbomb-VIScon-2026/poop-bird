use super::*;

impl World {
    fn statue_fits(&self) -> bool {
        let left = self.width + 80.0 - 23.0 - 24.0;
        let right = self.width + 80.0 + 23.0 + 24.0;
        let clear = |l: f64, r: f64| r < left || l > right;
        self.obstacles.iter().all(|o| clear(o.x, o.x + o.w))
            && self
                .targets
                .iter()
                .all(|t| t.kind != Kind::Statue || clear(t.x - t.w / 2.0, t.x + t.w / 2.0))
            && (self.mode == Mode::Demo
                || right
                    <= self.width + 40.0 + (self.next_obstacle_at.unwrap_or(0.0) - self.distance))
    }

    pub(super) fn aim(
        &self,
        x: f64,
        y: f64,
        vy: f64,
        vx: f64,
        max_change: f64,
        p: &Params,
    ) -> Option<f64> {
        let mut best: Option<f64> = None;
        for t in &self.targets {
            let dy = t.y - t.h * 0.5 - y;
            if dy <= 0.0 {
                continue;
            }
            let time = (-vy + (vy * vy + 2.0 * p.poop_gravity * dy).sqrt()) / p.poop_gravity;
            let glide = (1.0 - (-DRAG * time).exp()) / DRAG;
            let need = (t.x + t.speed * time - x) / glide - self.speed;
            if (need - vx).abs() > max_change {
                continue;
            }
            if best.is_none_or(|previous| (need - vx).abs() < (previous - vx).abs()) {
                best = Some(need);
            }
        }
        best
    }

    pub(super) fn autopilot(&self, p: &Params) -> bool {
        let c = self.charge.charge;
        if c > 0.0 {
            let vy = 140.0 + c * 260.0 + (self.bird.velocity * 0.2).max(0.0);
            let on_target = c >= 0.15
                && self
                    .aim(
                        self.bird_x - 4.0,
                        self.bird.y + RADIUS * 0.8,
                        vy,
                        0.0,
                        25.0,
                        p,
                    )
                    .is_some();
            !on_target && self.charge.full_hold < 0.85 && self.bird.y < 390.0
        } else {
            self.bird.y > 210.0 && self.bird.velocity > 0.0
        }
    }

    pub(super) fn spawn_target(&mut self, only_car: bool, statue_chance: f64) {
        let roll = self.random();
        let mut kind = if only_car || roll < 0.5 {
            Kind::Car
        } else if roll < 1.0 - statue_chance {
            Kind::Pedestrian
        } else {
            Kind::Statue
        };
        if kind == Kind::Statue && !self.statue_fits() {
            kind = Kind::Pedestrian;
        }
        let seed = self.random() * 1000.0;
        let (x, y, w, h, speed, color, facing) = match kind {
            Kind::Car => {
                let dir = if self.random() < 0.6 { 1.0 } else { -1.0 };
                let speed = dir * (40.0 + self.random() * 90.0);
                (
                    self.width + 120.0,
                    GROUND + 68.0,
                    92.0,
                    40.0,
                    speed,
                    self.pick(6),
                    dir,
                )
            }
            Kind::Pedestrian => {
                let dir = if self.random() < 0.5 { 1.0 } else { -1.0 };
                let speed = dir * (18.0 + self.random() * 30.0);
                (
                    self.width + 60.0,
                    GROUND + 20.0,
                    24.0,
                    52.0,
                    speed,
                    self.pick(6),
                    dir,
                )
            }
            Kind::Statue => (self.width + 80.0, GROUND + 20.0, 46.0, 96.0, 0.0, 0, -1.0),
        };
        self.targets.push(Target {
            id: self.next_target,
            kind,
            x,
            y,
            w,
            h,
            speed,
            color,
            seed,
            flash: 0.0,
            facing,
            rage: None,
            splats: Vec::new(),
        });
        self.next_target += 1;
    }

    pub(super) fn update_targets(&mut self, dt: f64, p: &Params) {
        for t in &mut self.targets {
            t.x += (t.speed - self.speed) * dt;
            t.flash = (t.flash - dt).max(0.0);
            if let Some(rage) = &mut t.rage {
                rage.time += dt;
                if rage.time < p.angry_duration {
                    t.facing = if self.bird_x < t.x { -1.0 } else { 1.0 };
                } else {
                    t.speed = rage.walk;
                    if rage.walk != 0.0 {
                        t.facing = if rage.walk < 0.0 { -1.0 } else { 1.0 };
                    }
                    t.rage = None;
                }
            }
        }
        self.targets
            .retain(|t| t.x > -200.0 && t.x < self.width + 600.0);
        if self.life != bird::Life::Playing {
            return;
        }
        self.spawn_acc += dt * p.spawn_rate * if self.mode == Mode::Demo { 3.0 } else { 1.0 };
        if self.spawn_acc >= 1.0 {
            self.spawn_acc -= 1.0 + (self.random() - 0.5) * 0.6;
            // Disabled encounters still consume their eligibility rolls in the
            // reference. Preserve that stream for ordinary city parity.
            if self.mode == Mode::Run && !self.calm_city {
                if self.distance >= p.paparazzi_min_distance {
                    self.random();
                }
                if 1.0 >= (p.kid_first_city + 0.5).floor() && self.distance >= p.kid_min_distance {
                    self.random();
                }
            }
            self.spawn_target(false, p.statue_chance);
        }
    }
}
