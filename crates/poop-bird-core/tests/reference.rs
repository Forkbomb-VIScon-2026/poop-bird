use poop_bird_core::protocol::{self, Error, INPUT_STRIDE, OUTPUT_STRIDE};

#[test]
fn matches_frozen_typescript_reference() {
    compare_fixture(include_str!("../../../tests/fixtures/kernels-v1.csv"));
}

#[test]
fn matches_frozen_bird_motion_reference() {
    compare_fixture(include_str!("../../../tests/fixtures/bird-v2.csv"));
}

fn compare_fixture(csv: &str) {
    let mut input = Vec::new();
    let mut expected = Vec::new();
    for line in csv.lines().filter(|l| !l.starts_with('#')) {
        let row: Vec<f64> = line.split(',').map(|n| n.parse().unwrap()).collect();
        assert_eq!(row.len(), INPUT_STRIDE + OUTPUT_STRIDE);
        input.extend_from_slice(&row[..INPUT_STRIDE]);
        expected.extend_from_slice(&row[INPUT_STRIDE..]);
    }
    let mut output = Vec::new();
    protocol::evaluate(&input, &mut output).unwrap();
    assert_eq!(output.len(), expected.len());
    for (i, (&got, &want)) in output.iter().zip(&expected).enumerate() {
        let tolerance = 1e-12 * want.abs().max(1.0);
        assert!(
            (got - want).abs() <= tolerance,
            "case {}, field {}: {got} != {want}",
            i / OUTPUT_STRIDE,
            i % OUTPUT_STRIDE
        );
    }
}

#[test]
fn rejects_malformed_batches_without_partial_output() {
    let mut output = vec![123.0];
    assert_eq!(
        protocol::evaluate(&[0.0], &mut output),
        Err(Error::IncompleteRecord)
    );
    let mut row = [0.0; INPUT_STRIDE];
    row[0] = 99.0;
    assert_eq!(
        protocol::evaluate(&row, &mut output),
        Err(Error::UnknownOperation)
    );
    row[0] = 0.0;
    row[5] = 0.5;
    assert_eq!(
        protocol::evaluate(&row, &mut output),
        Err(Error::InvalidBoolean)
    );
    row[5] = 0.0;
    row[0] = 5.0;
    row[10] = 0.5;
    assert_eq!(
        protocol::evaluate(&row, &mut output),
        Err(Error::InvalidLife)
    );
    row[10] = 0.0;
    row[9] = 0.5;
    assert_eq!(
        protocol::evaluate(&row, &mut output),
        Err(Error::InvalidBoolean)
    );
    row[9] = 0.0;
    row[0] = 0.0;
    row[7] = f64::NAN;
    assert_eq!(protocol::evaluate(&row, &mut output), Err(Error::NonFinite));
    assert_eq!(output, [123.0]);
}

#[test]
fn empty_batch_clears_reused_output() {
    let mut output = vec![123.0];
    protocol::evaluate(&[], &mut output).unwrap();
    assert!(output.is_empty());
}
