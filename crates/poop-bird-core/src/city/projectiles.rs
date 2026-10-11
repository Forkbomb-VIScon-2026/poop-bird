use super::*;
use crate::collision::circle_rect;
use std::f64::consts::PI;

impl World {
    pub(super) fn spawn_poop(&mut self, x: f64, y: f64, radius: f64, vy: f64, big: bool) {
        let rotation = self.random() * 6.0;
        self.poops.push(Poop {
            id: self.next_poop,
            x,
            y,
            vx: 0.0,
            vy: vy + (self.bird.velocity * 0.2).max(0.0),
            radius,
            big,
            trail: 0.0,
            rotation,
        });
        self.next_poop += 1;
    }

    pub(super) fn update_charge(&mut self, held: bool, dt: f64, p: &Params) {
        match charge::step(&mut self.charge, held, dt, &p.charge) {
            Some(charge::Event::Release {
                charge,
                push,
                sweet_spot,
            }) => {
                if self.bird.velocity > 0.0 {
                    self.bird.velocity *= 1.0 - p.fall_cancel;
                }
                self.bird.velocity -= push;
                self.bird.stretch_velocity += 6.0 + charge * 10.0;
                self.bird.relief = 0.45;
                self.bird.flap = 0.35;
                self.dropped += 1;
                self.spawn_poop(
                    self.bird_x - 4.0,
                    self.bird.y + RADIUS * 0.8,
                    5.0 + charge * 7.0,
                    140.0 + charge * 260.0,
                    false,
                );
                for _ in 0..4 + (charge * 14.0 + 0.5).floor() as usize {
                    let vx = -40.0 - self.random() * 90.0 * (0.5 + charge);
                    let vy = 20.0 + self.random() * 80.0 - 40.0;
                    let life = 0.4 + self.random() * 0.5 * (0.5 + charge);
                    let size = 4.0 + self.random() * 8.0 * (0.4 + charge);
                    self.particles.push(Particle {
                        x: self.bird_x - 10.0,
                        y: self.bird.y + 14.0,
                        vx,
                        vy,
                        life,
                        max_life: 0.9,
                        size,
                        color: if sweet_spot {
                            ParticleColor::SweetFartGold
                        } else {
                            ParticleColor::FartGreen
                        },
                        gravity: -30.0,
                        world: true,
                    });
                }
                let caption = if sweet_spot {
                    Some((
                        Text::Perfect,
                        self.bird_x,
                        self.bird.y - 40.0,
                        FloaterColor::PerfectGold,
                        30.0,
                        1.1,
                    ))
                } else if charge >= 0.95 {
                    Some((
                        Text::Big,
                        self.bird_x,
                        self.bird.y - 40.0,
                        FloaterColor::White,
                        24.0,
                        0.8,
                    ))
                } else if charge < 0.12 {
                    Some((
                        Text::Weak,
                        self.bird_x - 20.0,
                        self.bird.y + 10.0,
                        FloaterColor::WeakGreen,
                        16.0,
                        0.6,
                    ))
                } else {
                    None
                };
                if let Some((text, x, y, color, size, life)) = caption {
                    self.floaters.push(Floater {
                        x,
                        y,
                        text,
                        color,
                        size,
                        life,
                        max_life: life,
                    });
                }
                self.events.push(Event::Release {
                    charge,
                    sweet: sweet_spot,
                });
            }
            Some(charge::Event::Accident { .. }) => {
                self.accidents += 1;
                let message = self.pick(8);
                self.message = Some((message, 2.2));
                self.shake = 18.0;
                self.bird.stretch_velocity -= 12.0;
                self.spawn_poop(self.bird_x, self.bird.y + RADIUS, 16.0, 60.0, true);
                for _ in 0..50 {
                    let a = self.random() * PI * 2.0;
                    let speed = 80.0 + self.random() * 380.0;
                    let life = 0.6 + self.random() * 0.8;
                    let size = 3.0 + self.random() * 7.0;
                    let color = if self.random() < 0.7 {
                        ParticleColor::MessBrown
                    } else {
                        ParticleColor::MessDarkBrown
                    };
                    self.particles.push(Particle {
                        x: self.bird_x,
                        y: self.bird.y,
                        vx: a.cos() * speed,
                        vy: a.sin() * speed - 100.0,
                        life,
                        max_life: 1.4,
                        size,
                        color,
                        gravity: 900.0,
                        world: true,
                    });
                }
                for _ in 0..6 {
                    let x = self.random() * self.width;
                    let y = self.random() * 600.0;
                    let radius = 30.0 + self.random() * 70.0;
                    let seed = self.random() * 1000.0;
                    let life = 2.5 + self.random();
                    self.screen_splats.push(ScreenSplat {
                        x,
                        y,
                        radius,
                        seed,
                        life,
                    });
                }
                self.events.push(Event::Accident(message));
            }
            None => {}
        }
    }

    pub(super) fn splat_particles(&mut self, x: f64, y: f64, radius: f64, hit: bool) {
        for _ in 0..8 + (radius + 0.5).floor() as usize {
            let a = -PI * self.random();
            let speed = 60.0 + self.random() * 160.0;
            let life = 0.4 + self.random() * 0.3;
            let size = 2.0 + self.random() * 3.0;
            let color = if hit && self.random() < 0.3 {
                ParticleColor::SplatGold
            } else {
                ParticleColor::SplatBrown
            };
            self.particles.push(Particle {
                x,
                y,
                vx: a.cos() * speed,
                vy: a.sin() * speed,
                life,
                max_life: 0.7,
                size,
                color,
                gravity: 700.0,
                world: true,
            });
        }
    }

    pub(super) fn poop_hits(&mut self, poop: Poop, p: &Params) -> bool {
        if let Some(i) = self
            .targets
            .iter()
            .position(|t| circle_rect(poop.x, poop.y, poop.radius, t.rect()))
        {
            let seed = self.random() * 1000.0;
            let t = &mut self.targets[i];
            t.splats.push(Splat {
                dx: poop.x - t.x,
                dy: (-t.h).max(poop.y - t.y),
                radius: poop.radius * 1.3,
                seed,
            });
            t.flash = 0.3;
            let kind = t.kind;
            let y = t.y - t.h - 10.0;
            self.combo += 1;
            self.best_combo = self.best_combo.max(self.combo);
            self.targets_hit += 1;
            let kind_mult = match kind {
                Kind::Car => 1.0,
                Kind::Pedestrian => 1.5,
                Kind::Statue => 2.0,
            };
            let mult = self.multiplier(p);
            let points = (p.target_points * kind_mult * mult * if poop.big { 2.0 } else { 1.0 }
                + 0.5)
                .floor();
            self.bonus += points;
            self.floaters.push(Floater {
                x: poop.x,
                y,
                text: Text::Points {
                    points,
                    multiplier: (self.combo > 1).then_some(mult),
                },
                color: FloaterColor::PointsGold,
                size: 26.0,
                life: 1.1,
                max_life: 1.1,
            });
            self.splat_particles(poop.x, poop.y, poop.radius, true);
            self.events.push(Event::Hit {
                points,
                combo: self.combo,
                kind,
            });
            self.events.push(Event::Splat(poop.big));
            if kind == Kind::Pedestrian {
                let previous = self.targets[i].rage;
                if previous.is_some() || self.random() < p.angry_chance {
                    let mut curse = self.pick(if previous.is_some() { 4 } else { 5 });
                    if let Some(rage) = previous
                        && curse >= rage.curse
                    {
                        curse += 1;
                    }
                    let t = &mut self.targets[i];
                    t.rage = Some(Rage {
                        time: 0.0,
                        walk: previous.map_or(t.speed, |r| r.walk),
                        curse,
                    });
                    t.speed = 0.0;
                    self.events.push(Event::Curse);
                }
            }
            return true;
        }
        let ground = GROUND + 55.0;
        if poop.y + poop.radius >= ground {
            let y = ground - 4.0 + self.random() * 14.0;
            let seed = self.random() * 1000.0;
            self.decals.push(Decal {
                x: poop.x,
                y,
                radius: poop.radius * 1.6,
                seed,
            });
            if self.decals.len() > 60 {
                self.decals.remove(0);
            }
            self.splat_particles(poop.x, ground, poop.radius, false);
            if self.combo > 1 {
                self.floaters.push(Floater {
                    x: poop.x,
                    y: ground - 30.0,
                    text: Text::ComboLost,
                    color: FloaterColor::LostPink,
                    size: 16.0,
                    life: 0.8,
                    max_life: 0.8,
                });
            }
            self.combo = 0;
            self.events.push(Event::Splat(poop.big));
            return true;
        }
        false
    }

    pub(super) fn update_poops(&mut self, dt: f64, speed: f64, p: &Params) {
        let mut kept = 0;
        for i in 0..self.poops.len() {
            let mut poop = self.poops[i];
            poop.vx = (poop.vx + speed) * (-DRAG * dt).exp() - speed;
            poop.vy += p.poop_gravity * dt;
            poop.x += poop.vx * dt;
            poop.y += poop.vy * dt;
            poop.rotation += dt * 4.0;
            poop.trail -= dt;
            if poop.trail <= 0.0 {
                poop.trail = 0.025;
                let x = poop.x + (self.random() - 0.5) * poop.radius;
                let vx = (self.random() - 0.5) * 20.0;
                let size = 1.5 + self.random() * poop.radius * 0.35;
                self.particles.push(Particle {
                    x,
                    y: poop.y - poop.radius * 0.5,
                    vx,
                    vy: -10.0,
                    life: 0.35,
                    max_life: 0.35,
                    size,
                    color: ParticleColor::TrailBrown,
                    gravity: 0.0,
                    world: true,
                });
            }
            if !self.poop_hits(poop, p) {
                self.poops[kept] = poop;
                kept += 1;
            }
        }
        self.poops.truncate(kept);
    }
}
