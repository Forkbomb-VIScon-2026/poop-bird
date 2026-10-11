use crate::collision::Rect;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    Release { charge: f64, sweet: bool },
    Accident(u8),
    Hit { points: f64, combo: u32, kind: Kind },
    Splat(bool),
    Curse,
    Crash,
    GameOver,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Car,
    Pedestrian,
    Statue,
}

#[derive(Clone, Copy, Debug)]
pub struct Splat {
    pub dx: f64,
    pub dy: f64,
    pub radius: f64,
    pub seed: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Rage {
    pub time: f64,
    pub walk: f64,
    pub curse: u8,
}
#[derive(Debug)]
pub struct Target {
    pub id: u32,
    pub kind: Kind,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub speed: f64,
    pub color: u8,
    pub seed: f64,
    pub flash: f64,
    pub facing: f64,
    pub rage: Option<Rage>,
    pub splats: Vec<Splat>,
}
impl Target {
    pub(super) fn rect(&self) -> Rect {
        Rect {
            x: self.x - self.w / 2.0,
            y: self.y - self.h,
            w: self.w,
            h: self.h,
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Poop {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub radius: f64,
    pub big: bool,
    pub trail: f64,
    pub rotation: f64,
}
#[derive(Clone, Copy, Debug)]
#[repr(u8)]
pub enum ParticleColor {
    FeatherGold = 0,
    FeatherWhite = 1,
    FartGreen = 2,
    SweetFartGold = 3,
    MessBrown = 4,
    MessDarkBrown = 5,
    TrailBrown = 6,
    SplatBrown = 7,
    SplatGold = 8,
}

#[derive(Clone, Copy, Debug)]
#[repr(u8)]
pub enum FloaterColor {
    PerfectGold = 0,
    White = 1,
    WeakGreen = 2,
    PointsGold = 3,
    LostPink = 4,
}

#[derive(Clone, Copy, Debug)]
pub struct Particle {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub life: f64,
    pub max_life: f64,
    pub size: f64,
    pub color: ParticleColor,
    pub gravity: f64,
    pub world: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct Decal {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub seed: f64,
}
#[derive(Clone, Copy, Debug)]
pub enum Text {
    Perfect,
    Big,
    Weak,
    Points {
        points: f64,
        multiplier: Option<f64>,
    },
    ComboLost,
}
#[derive(Clone, Copy, Debug)]
pub struct Floater {
    pub x: f64,
    pub y: f64,
    pub text: Text,
    pub color: FloaterColor,
    pub size: f64,
    pub life: f64,
    pub max_life: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct ScreenSplat {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub seed: f64,
    pub life: f64,
}

#[derive(Clone, Copy, Debug)]
pub enum Bottom {
    Building,
    Tower,
}
#[derive(Debug)]
pub struct Obstacle {
    pub id: u32,
    pub x: f64,
    pub w: f64,
    pub gap_top: f64,
    pub gap_bottom: f64,
    pub bottom: Bottom,
    pub color: u8,
    pub seed: f64,
    pub passed: bool,
    pub splats: Vec<Splat>,
}
impl Obstacle {
    pub(super) fn rect(&self) -> Rect {
        Rect {
            x: self.x,
            y: self.gap_bottom,
            w: self.w,
            h: super::GROUND - self.gap_bottom,
        }
    }
}
