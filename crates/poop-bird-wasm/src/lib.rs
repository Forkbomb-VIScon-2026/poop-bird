use poop_bird_core::protocol;
use poop_bird_core::{city, city_bridge};
use wasm_bindgen::prelude::*;

/// Scoped city world, not an authoritative full-run engine yet.
#[wasm_bindgen]
pub struct CityWorld {
    world: city::World,
    output: Vec<f64>,
}

#[wasm_bindgen]
impl CityWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(width: f64, seed: u32) -> Result<CityWorld, JsError> {
        if !width.is_finite() || width <= 0.0 {
            return Err(JsError::new("invalid city width"));
        }
        Ok(Self {
            world: city::World::new(width, seed),
            output: Vec::new(),
        })
    }
    pub fn advance(&mut self, parameters: &[f64], request: &[f64]) -> Result<Vec<f64>, JsError> {
        let params = city_bridge::params(parameters)
            .map_err(|e| JsError::new(&format!("invalid city parameters: {e:?}")))?;
        city_bridge::advance(&mut self.world, &params, request, &mut self.output)
            .map_err(|e| JsError::new(&format!("invalid city request: {e:?}")))?;
        Ok(self.output.clone())
    }
}

#[wasm_bindgen]
pub fn protocol_version() -> u32 {
    protocol::VERSION
}

/// One boundary crossing for any number of independent kernel comparisons.
#[wasm_bindgen]
pub fn evaluate_batch(input: &[f64]) -> Result<Vec<f64>, JsError> {
    let mut output = Vec::new();
    protocol::evaluate(input, &mut output)
        .map_err(|e| JsError::new(&format!("invalid kernel batch: {e:?}")))?;
    Ok(output)
}
