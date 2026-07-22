#[derive(Default, Debug)]
pub struct RecoveryPolicy {
    consecutive_track_misses: u8,
    consecutive_person_without_face: u8,
    last_recovery_time: Option<f64>,
    first_bucket_in_scene: bool,
}

impl RecoveryPolicy {
    pub fn new_scene(&mut self) {
        self.consecutive_track_misses = 0;
        self.consecutive_person_without_face = 0;
        self.last_recovery_time = None;
        self.first_bucket_in_scene = true;
    }

    pub fn observe(
        &mut self,
        time: f64,
        is_face_bucket: bool,
        has_face: bool,
        has_person: bool,
        had_track: bool,
    ) -> bool {
        if has_face {
            self.consecutive_track_misses = 0;
            self.consecutive_person_without_face = 0;
            if is_face_bucket {
                self.first_bucket_in_scene = false;
            }
            return false;
        }
        if had_track {
            self.consecutive_track_misses = self.consecutive_track_misses.saturating_add(1);
        }
        if has_person {
            self.consecutive_person_without_face =
                self.consecutive_person_without_face.saturating_add(1);
        }
        let trigger = (is_face_bucket && self.first_bucket_in_scene)
            || self.consecutive_track_misses >= 2
            || self.consecutive_person_without_face >= 2;
        if is_face_bucket {
            self.first_bucket_in_scene = false;
        }
        let cooldown_ready = self
            .last_recovery_time
            .map_or(true, |last| time - last >= 1.0);
        if trigger && cooldown_ready {
            self.last_recovery_time = Some(time);
            self.consecutive_track_misses = 0;
            self.consecutive_person_without_face = 0;
            true
        } else {
            false
        }
    }
}
