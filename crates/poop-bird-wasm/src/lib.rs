use poop_bird_core::protocol;
use wasm_bindgen::prelude::*;

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
