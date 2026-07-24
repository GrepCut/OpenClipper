#[derive(Default, Debug)]
pub struct RecoveryPolicy {
    consecutive_target_misses: u8,
    consecutive_context_without_target: u8,
    last_recovery_time: Option<f64>,
    first_bucket_in_scene: bool,
}

impl RecoveryPolicy {
    pub fn new_scene(&mut self) {
        self.consecutive_target_misses = 0;
        self.consecutive_context_without_target = 0;
        self.last_recovery_time = None;
        self.first_bucket_in_scene = true;
    }

    pub fn observe(
        &mut self,
        time: f64,
        is_recovery_bucket: bool,
        has_primary_target: bool,
        has_context_target: bool,
        had_track: bool,
    ) -> bool {
        if has_primary_target {
            self.consecutive_target_misses = 0;
            self.consecutive_context_without_target = 0;
            if is_recovery_bucket {
                self.first_bucket_in_scene = false;
            }
            return false;
        }
        if had_track {
            self.consecutive_target_misses = self.consecutive_target_misses.saturating_add(1);
        }
        if has_context_target {
            self.consecutive_context_without_target =
                self.consecutive_context_without_target.saturating_add(1);
        }
        let trigger = (is_recovery_bucket && self.first_bucket_in_scene)
            // At 5 FPS, waiting for a second broken observation means a
            // fast athlete is already well outside a portrait crop.
            || self.consecutive_target_misses >= 1
            || self.consecutive_context_without_target >= 2;
        if is_recovery_bucket {
            self.first_bucket_in_scene = false;
        }
        let cooldown_ready = self
            .last_recovery_time
            .map_or(true, |last| time - last >= 0.6);
        if trigger && cooldown_ready {
            self.last_recovery_time = Some(time);
            self.consecutive_target_misses = 0;
            self.consecutive_context_without_target = 0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RecoveryPolicy;

    #[test]
    fn recovers_once_on_a_new_scene_when_the_target_is_missing() {
        let mut policy = RecoveryPolicy::default();
        policy.new_scene();
        assert!(policy.observe(0.0, true, false, false, false));
        assert!(!policy.observe(0.5, true, false, false, false));
    }

    #[test]
    fn recovers_on_the_first_track_miss_then_respects_short_cooldown() {
        let mut policy = RecoveryPolicy::default();
        policy.new_scene();
        assert!(!policy.observe(0.0, false, true, false, false));
        assert!(policy.observe(0.2, false, false, false, true));
        assert!(!policy.observe(0.6, false, false, false, true));
        assert!(policy.observe(0.8, false, false, false, true));
    }
}
