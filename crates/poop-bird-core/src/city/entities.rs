use crate::collision::Rect;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    Release { charge: f64, sweet: bool },
    Accident(u8),
    Hit { points: f64, combo: u32, kind: Kind },
    Splat(bool),
    Curse,
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
pub struct Particle {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub life: f64,
    pub max_life: f64,
    pub size: f64,
    pub color: u8,
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
    pub color: u8,
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
