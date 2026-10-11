//! Reproducible unsigned 32-bit LCG shared with the TypeScript reference engine.
//! Cosmetic and audio systems must use separate streams.
#[derive(Clone, Copy, Debug)]
pub struct Rng {
    state: u32,
}

impl Rng {
    pub const fn new(seed: u32) -> Self {
        Self { state: seed }
    }
    pub fn next_u32(&mut self) -> u32 {
        self.state = self
            .state
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        self.state
    }
    pub fn next_f64(&mut self) -> f64 {
        f64::from(self.next_u32()) / 4_294_967_296.0
    }
}

#[cfg(test)]
mod tests {
    use super::Rng;
    #[test]
    fn matches_javascript_imul_unsigned_wrap() {
        let mut rng = Rng::new(1234);
        assert_eq!(
            (0..5).map(|_| rng.next_u32()).collect::<Vec<_>>(),
            [
                3_067_928_073,
                889_114_580,
                3_219_257_635,
                1_486_326_822,
                3_450_746_189
            ]
        );
        let mut rng = Rng::new(u32::MAX);
        for _ in 0..100_000 {
            assert!((0.0..1.0).contains(&rng.next_f64()));
        }
    }
}
