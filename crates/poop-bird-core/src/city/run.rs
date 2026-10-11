use super::*;
use crate::collision::circle_rect;
use std::f64::consts::TAU;

impl World {
    pub(super) fn step_run(&mut self, dt: f64, held: bool, p: &Params) {
        if self.blocked {
            return;
        }
        let alive = self.life == bird::Life::Playing;
        let speed = if alive {
            super::obstacles::ramp(p.scroll_speed, p.scroll_max, self.difficulty(p))
        } else {
            0.0
        };
        // Pause before an unsupported waterfront tick, without a partial tick.
        if alive
            && !self.calm_city
            && self.stage_obstacles as f64 >= (p.before_gate + 0.5).floor()
            && self.distance + speed * dt >= self.next_obstacle_at.unwrap()
        {
            self.blocked = true;
            return;
        }
        self.time += dt;
        self.run_time += dt;
        self.speed = 0.0;
        if self.life == bird::Life::Over {
            self.effects(dt, 0.0);
            return;
        }
        self.speed = speed;
        if alive {
            self.distance += speed * dt;
            self.stage_time += dt;
        }
        if let Some(px) = &mut self.perch_x {
            *px -= speed * dt;
            if *px < -100.0 {
                self.perch_x = None;
            }
        }
        if alive {
            self.update_charge(held, dt, p);
        }
        self.bird.advance(
            bird::Input {
                charge: self.charge.charge,
                stunned: self.charge.stun > 0.0,
                life: self.life,
                stage_time: self.stage_time,
            },
            dt,
            &p.motion,
        );
        if self.bird.y + RADIUS >= GROUND {
            self.bird.y = GROUND - RADIUS;
            self.bird.velocity = self.bird.velocity.min(0.0);
            if alive && self.calm_city {
                self.bird.velocity = -320.0;
            } else if alive {
                self.crash();
            }
        }
        if self.life == bird::Life::Playing
            && self.obstacles.iter().any(|o| {
                o.x <= self.bird_x + 80.0
                    && o.x + o.w >= self.bird_x - 80.0
                    && circle_rect(self.bird_x, self.bird.y, 16.0, o.rect())
            })
        {
            self.crash();
        }
        // Contacts above deliberately use pre-scroll obstacle positions.
        self.update_obstacles(dt, p);
        self.update_targets(dt, p);
        self.update_poops(dt, speed, p);
        self.effects(dt, speed);
        if self.life == bird::Life::Dying {
            self.dying_time += dt;
            if self.dying_time > 1.3 && self.bird.y >= GROUND - RADIUS - 1.0 {
                self.life = bird::Life::Over;
                self.events.push(Event::GameOver);
            }
        }
    }
    fn crash(&mut self) {
        self.life = bird::Life::Dying;
        self.dying_time = 0.0;
        self.shake = 12.0;
        self.charge = charge::State::default();
        self.bird.velocity = self.bird.velocity.max(120.0);
        self.message = None;
        for _ in 0..24 {
            let a = self.random() * TAU;
            let size = 4.0 + self.random() * 3.0;
            let color = if self.random() < 0.5 {
                ParticleColor::FeatherGold
            } else {
                ParticleColor::FeatherWhite
            };
            self.particles.push(Particle {
                x: self.bird_x,
                y: self.bird.y,
                vx: a.cos() * 200.0,
                vy: a.sin() * 200.0 - 80.0,
                life: 0.8,
                max_life: 0.8,
                size,
                color,
                gravity: 600.0,
                world: false,
            });
        }
        self.events.push(Event::Crash);
    }
}
