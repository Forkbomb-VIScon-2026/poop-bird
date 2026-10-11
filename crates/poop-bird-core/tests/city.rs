use poop_bird_core::{
    city::{Command, Mode, World},
    city_bridge::{self, Error},
};

fn parameters() -> Vec<f64> {
    vec![
        1.2, 1.0, 0.3, 1.25, 0.8, 100.0, 480.0, 1.0, 800.0, 1.0, 0.4, 550.0, 220.0, 180.0, 1000.0,
        0.7, 0.55, 0.1, 0.4, 2.0, 50.0, 5.0, 0.5, 260.0, 6000.0, 700.0, 460.0, 320.0, 250.0, 175.0,
        0.08, 0.5, 4.0, 6.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 500.0, 2.0, 500.0,
    ]
}

#[test]
fn commands_and_invalid_requests_are_atomic() {
    let p = city_bridge::params(&parameters()).unwrap();
    let mut world = World::new(1000.0, 1234);
    let mut output = vec![123.0];
    // An earlier valid resize must not execute if a later command is invalid.
    assert_eq!(
        city_bridge::advance(
            &mut world,
            &p,
            &[0.01, 1.0, 0.0, 2.0, 1.0, 500.0, 99.0, 0.0],
            &mut output
        ),
        Err(Error::Command)
    );
    assert_eq!(world.width, 1000.0);
    assert_eq!(world.time, 0.0);
    assert_eq!(output, [123.0]);
    for bad in [
        vec![0.1, 13.0, 0.0, 0.0],
        vec![0.01, 1.5, 0.0, 0.0],
        vec![0.01, 1.0, 0.5, 0.0],
        vec![f64::NAN, 0.0, 0.0, 0.0],
    ] {
        assert_eq!(
            city_bridge::advance(&mut world, &p, &bad, &mut output),
            Err(Error::Request)
        );
        assert_eq!(world.time, 0.0);
    }
    city_bridge::advance(
        &mut world,
        &p,
        &[0.0, 0.0, 0.0, 2.0, 3.0, 0.0, 1.0, 500.0],
        &mut output,
    )
    .unwrap();
    assert_eq!(world.mode, Mode::Practice);
    assert_eq!(world.bird_x, 140.0);
    assert_eq!(world.perch_x, Some(140.0));
    let mut bad = parameters();
    bad[14] = 0.0;
    assert!(matches!(city_bridge::params(&bad), Err(Error::Params)));
}

#[test]
fn batching_preserves_world_state_and_entity_identity() {
    let p = city_bridge::params(&parameters()).unwrap();
    let mut a = World::new(1000.0, 42);
    let mut b = World::new(1000.0, 42);
    a.command(Command::Demo);
    b.command(Command::Demo);
    let mut frame_a = Vec::new();
    let mut frame_b = Vec::new();
    for _ in 0..300 {
        for _ in 0..12 {
            city_bridge::advance(&mut a, &p, &[1.0 / 120.0, 1.0, 0.0, 0.0], &mut frame_a).unwrap();
        }
        city_bridge::advance(&mut b, &p, &[1.0 / 120.0, 12.0, 0.0, 0.0], &mut frame_b).unwrap();
        assert_eq!(frame_a, frame_b);
        for pair in b.targets.windows(2) {
            assert!(pair[0].id < pair[1].id);
        }
    }
    assert!(b.targets_hit > 0);
    assert!(b.dropped > 0);
    assert!(b.bonus > 0.0);
    assert!(b.particles.len() <= 600);
    assert!(b.decals.len() <= 60);
}

#[test]
fn reset_reuses_storage_and_practice_keeps_the_run_clock_still() {
    let p = city_bridge::params(&parameters()).unwrap();
    let mut world = World::new(1000.0, 1234);
    world.command(Command::Perch);
    for _ in 0..400 {
        world.step(1.0 / 120.0, true, &p);
    }
    assert!(world.accidents > 0);
    assert_eq!(world.run_time, 0.0);
    assert_eq!(world.distance, 0.0);
    assert!(world.charge.needs_release);
    let capacity = world.particles.capacity();
    world.reset();
    assert_eq!(world.particles.capacity(), capacity);
    assert!(world.particles.is_empty());
    assert!(world.events.is_empty());
    assert_eq!(world.bird.y, 240.0);
}

#[test]
fn takeoff_preserves_world_objects_but_clears_practice_statistics() {
    let p = city_bridge::params(&parameters()).unwrap();
    let mut world = World::new(1000.0, 42);
    world.command(Command::Perch);
    world.command(Command::SpawnCar);
    world.bonus = 200.0;
    world.combo = 3;
    world.best_combo = 3;
    world.targets_hit = 4;
    world.dropped = 7;
    world.accidents = 2;
    let mut output = Vec::new();
    city_bridge::advance(&mut world, &p, &[0.0, 0.0, 0.0, 1.0, 5.0, 0.0], &mut output).unwrap();
    assert_eq!(world.mode, Mode::Run);
    assert_eq!(world.targets.len(), 1);
    assert_eq!(world.perch_x, Some(280.0));
    assert_eq!(world.bird.velocity, -p.charge.push_max);
    assert_eq!(
        (
            world.bonus,
            world.combo,
            world.best_combo,
            world.targets_hit,
            world.dropped,
            world.accidents
        ),
        (0.0, 0, 0, 0, 0, 0)
    );
}

#[test]
fn unsupported_encounters_reject_atomically_and_waterfront_stops_before_tick() {
    let mut p = city_bridge::params(&parameters()).unwrap();
    p.balloon_chance = 0.2;
    let mut world = World::new(1000.0, 42);
    let mut output = vec![123.0];
    assert_eq!(
        city_bridge::advance(
            &mut world,
            &p,
            &[0.01, 12.0, 0.0, 2.0, 1.0, 500.0, 5.0, 0.0],
            &mut output
        ),
        Err(Error::UnsupportedRun)
    );
    assert_eq!(world.width, 1000.0);
    assert_eq!(world.mode, Mode::Idle);
    assert_eq!(output, [123.0]);
    p.balloon_chance = 0.0;
    p.before_gate = 0.0;
    p.first_delay = 0.0;
    city_bridge::advance(
        &mut world,
        &p,
        &[0.01, 12.0, 0.0, 1.0, 5.0, 0.0],
        &mut output,
    )
    .unwrap();
    assert!(world.blocked);
    assert_eq!(world.time, 0.0);
    assert_eq!(world.distance, 0.0);
    assert!(world.obstacles.is_empty());
}

#[test]
fn floor_crash_emits_once_then_gameover_and_stops_simulation() {
    use poop_bird_core::{bird::Life, city::Event};
    let p = city_bridge::params(&parameters()).unwrap();
    let mut world = World::new(1000.0, 42);
    world.command(Command::TakeOff(p.charge.push_max));
    for _ in 0..2000 {
        world.step(1.0 / 120.0, false, &p);
    }
    assert_eq!(world.life, Life::Over);
    assert_eq!(
        world.events.iter().filter(|e| **e == Event::Crash).count(),
        1
    );
    assert_eq!(
        world
            .events
            .iter()
            .filter(|e| **e == Event::GameOver)
            .count(),
        1
    );
    let distance = world.distance;
    let bird = world.bird;
    world.step(1.0 / 120.0, true, &p);
    assert_eq!(world.distance, distance);
    assert_eq!(world.bird, bird);
    world.reset();
    assert_eq!(world.life, Life::Playing);
    assert!(!world.blocked);
}

#[test]
fn building_contact_is_strict_and_resolved_before_scroll() {
    use poop_bird_core::{
        bird::Life,
        city::{Bottom, Obstacle},
    };
    let mut p = city_bridge::params(&parameters()).unwrap();
    p.motion.gravity = 0.0;
    p.scroll_max = p.scroll_speed;
    let mut world = World::new(1000.0, 42);
    world.command(Command::TakeOff(0.0));
    world.obstacles.push(Obstacle {
        id: 1,
        x: world.bird_x + 16.0,
        w: 100.0,
        gap_top: 0.0,
        gap_bottom: 200.0,
        bottom: Bottom::Building,
        color: 0,
        seed: 0.0,
        passed: false,
        splats: Vec::new(),
    });
    world.step(0.0, false, &p); // Exact tangency is safe.
    assert_eq!(world.life, Life::Playing);
    world.obstacles[0].x += 1.0;
    world.step(1.0 / 120.0, false, &p); // Contact checked before 1.5px scroll.
    assert_eq!(world.life, Life::Playing);
    world.step(1.0 / 120.0, false, &p);
    assert_eq!(world.life, Life::Dying);
}
