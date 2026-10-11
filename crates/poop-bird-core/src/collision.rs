#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Exact tangency is not a hit, matching the existing game's strict comparison.
pub fn circle_rect(cx: f64, cy: f64, radius: f64, rect: Rect) -> bool {
    if rect.w <= 0.0 || rect.h <= 0.0 {
        return false;
    }
    let nx = rect.x.max(cx.min(rect.x + rect.w));
    let ny = rect.y.max(cy.min(rect.y + rect.h));
    let dx = cx - nx;
    let dy = cy - ny;
    dx * dx + dy * dy < radius * radius
}
