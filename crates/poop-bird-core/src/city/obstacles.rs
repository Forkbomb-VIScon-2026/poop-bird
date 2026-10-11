use super::*;

pub(super) fn ramp(start: f64, end: f64, difficulty: f64) -> f64 {
    start + (end - start) * difficulty
}
impl World {
    pub(crate) fn initialize(&mut self, p: &Params) {
        self.next_obstacle_at.get_or_insert(p.first_delay);
    }
    pub(super) fn difficulty(&self, p: &Params) -> f64 {
        (self.distance / p.difficulty_ramp.max(1.0)).min(1.0)
    }
    pub(super) fn update_obstacles(&mut self, dt: f64, p: &Params) {
        for o in &mut self.obstacles {
            o.x -= self.speed * dt;
            if !o.passed && o.x + o.w < self.bird_x - RADIUS {
                o.passed = true;
            }
        }
        self.obstacles.retain(|o| o.x + o.w > -60.0);
        if self.life != bird::Life::Playing {
            return;
        }
        if self.calm_city {
            self.next_obstacle_at = Some(
                self.next_obstacle_at
                    .unwrap()
                    .max(self.distance + p.first_delay),
            );
            return;
        }
        if self.distance >= self.next_obstacle_at.unwrap() {
            self.random(); // power-line/balloon selection draw, even with chances zero
            let d = self.difficulty(p);
            let gap = ramp(p.gap, p.gap_min, d);
            let min = 50.0 + gap / 2.0;
            let max = GROUND - 50.0 - gap / 2.0;
            let mut u = self.random();
            let tall = if (p.hardest_city + 0.5).floor() <= 1.0 {
                p.tall_max
            } else {
                p.tall_chance
            };
            u = if self.random() < tall {
                u * 0.4
            } else {
                0.4 + u * 0.6
            };
            let center = min + u * (max - min).max(0.0);
            let jump = 140.0 + 140.0 * d;
            // max/min, rather than clamp: debug gaps may invert the range.
            let center =
                (self.last_gap_center - jump).max((self.last_gap_center + jump).min(center));
            let center = min.max(max.min(center));
            self.last_gap_center = center;
            let bottom = if self.pick(4) == 3 {
                Bottom::Tower
            } else {
                Bottom::Building
            };
            let w = if matches!(bottom, Bottom::Tower) {
                78.0
            } else {
                96.0 + self.random() * 30.0
            };
            let color = self.pick(6);
            let seed = self.random() * 1000.0;
            self.obstacles.push(Obstacle {
                id: self.next_obstacle,
                x: self.width + 40.0,
                w,
                gap_top: center - gap / 2.0,
                gap_bottom: center + gap / 2.0,
                bottom,
                color,
                seed,
                passed: false,
                splats: Vec::new(),
            });
            self.next_obstacle += 1;
            self.stage_obstacles += 1;
            self.next_obstacle_at = Some(self.distance + ramp(p.spacing, p.spacing_min, d));
        }
    }
}
