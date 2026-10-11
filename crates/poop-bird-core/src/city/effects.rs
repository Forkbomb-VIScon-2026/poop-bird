use super::*;

impl World {
    pub(super) fn effects(&mut self, dt: f64, speed: f64) {
        for particle in &mut self.particles {
            particle.vy += particle.gravity * dt;
            particle.x += (particle.vx - if particle.world { speed } else { 0.0 }) * dt;
            particle.y += particle.vy * dt;
            particle.life -= dt;
        }
        self.particles.retain(|v| v.life > 0.0);
        if self.particles.len() > 600 {
            self.particles.drain(..self.particles.len() - 600);
        }
        for decal in &mut self.decals {
            decal.x -= speed * dt;
        }
        self.decals.retain(|v| v.x > -80.0);
        for floater in &mut self.floaters {
            floater.y -= 40.0 * dt;
            floater.life -= dt;
        }
        self.floaters.retain(|v| v.life > 0.0);
        for splat in &mut self.screen_splats {
            splat.life -= dt;
        }
        self.screen_splats.retain(|v| v.life > 0.0);
        self.shake = (self.shake - dt * 40.0).max(0.0);
        if let Some((_, life)) = &mut self.message {
            *life -= dt;
            if *life <= 0.0 {
                self.message = None;
            }
        }
    }
}
