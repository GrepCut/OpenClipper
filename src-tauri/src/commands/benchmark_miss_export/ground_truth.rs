use crate::repository::test_repository::{TestKeyframeDto, TestTargetDto};

fn clone_target(target: &TestTargetDto) -> TestTargetDto {
    TestTargetDto {
        id: target.id.clone(),
        slot: target.slot,
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
    }
}

fn layout_intent_at(frame: &TestKeyframeDto) -> &str {
    if frame.layout_intent.is_empty() || frame.layout_intent == "crop" {
        "crop"
    } else {
        frame.layout_intent.as_str()
    }
}

enum KeyframeBracket<'a> {
    BeforeFirst(&'a TestKeyframeDto),
    AfterLast(&'a TestKeyframeDto),
    Exact(&'a TestKeyframeDto),
    Between {
        previous: &'a TestKeyframeDto,
        next: &'a TestKeyframeDto,
        factor: f64,
    },
}

fn keyframe_bracket(keyframes: &[TestKeyframeDto], timestamp_us: i64) -> Option<KeyframeBracket<'_>> {
    if keyframes.is_empty() {
        return None;
    }
    if timestamp_us <= keyframes[0].timestamp_us {
        return Some(KeyframeBracket::BeforeFirst(&keyframes[0]));
    }
    let last = keyframes.last().expect("keyframes checked");
    if timestamp_us >= last.timestamp_us {
        return Some(KeyframeBracket::AfterLast(last));
    }
    let mut next_index = 1usize;
    while next_index < keyframes.len() && keyframes[next_index].timestamp_us < timestamp_us {
        next_index += 1;
    }
    let next = &keyframes[next_index];
    if next.timestamp_us == timestamp_us {
        return Some(KeyframeBracket::Exact(next));
    }
    let previous = &keyframes[next_index - 1];
    let factor = (timestamp_us - previous.timestamp_us) as f64
        / (next.timestamp_us - previous.timestamp_us).max(1) as f64;
    Some(KeyframeBracket::Between {
        previous,
        next,
        factor,
    })
}

fn evaluate_layout_intent(keyframes: &[TestKeyframeDto], timestamp_us: i64) -> &str {
    match keyframe_bracket(keyframes, timestamp_us) {
        None => "crop",
        Some(KeyframeBracket::BeforeFirst(frame))
        | Some(KeyframeBracket::AfterLast(frame))
        | Some(KeyframeBracket::Exact(frame)) => layout_intent_at(frame),
        Some(KeyframeBracket::Between { previous, .. }) => layout_intent_at(previous),
    }
}

fn clamp_target_rect(target: &TestTargetDto) -> TestTargetDto {
    let width = target.width.clamp(0.001, 1.0);
    let height = target.height.clamp(0.001, 1.0);
    TestTargetDto {
        id: target.id.clone(),
        slot: target.slot,
        x: target.x.clamp(0.0, 1.0 - width),
        y: target.y.clamp(0.0, 1.0 - height),
        width,
        height,
    }
}

fn interpolate_contain_targets(
    previous: &TestKeyframeDto,
    next: &TestKeyframeDto,
    factor: f64,
) -> Vec<TestTargetDto> {
    let Some(target) = previous.targets.first() else {
        return Vec::new();
    };
    let target_next = if layout_intent_at(next) == "contain" {
        next.targets.first()
    } else {
        None
    };
    let Some(target_next) = target_next else {
        return vec![clone_target(target)];
    };
    vec![clamp_target_rect(&TestTargetDto {
        id: target.id.clone(),
        slot: 0,
        x: target.x + (target_next.x - target.x) * factor,
        y: target.y + (target_next.y - target.y) * factor,
        width: target.width + (target_next.width - target.width) * factor,
        height: target.height + (target_next.height - target.height) * factor,
    })]
}

fn interpolate_crop_targets(
    previous: &TestKeyframeDto,
    next: &TestKeyframeDto,
    factor: f64,
) -> Vec<TestTargetDto> {
    if layout_intent_at(next) != "crop" {
        return previous.targets.iter().map(clone_target).collect();
    }
    previous
        .targets
        .iter()
        .map(|target| {
            let target_next = next.targets.iter().find(|candidate| candidate.slot == target.slot);
            match target_next {
                Some(next_target) => TestTargetDto {
                    id: target.id.clone(),
                    slot: target.slot,
                    x: target.x + (next_target.x - target.x) * factor,
                    y: target.y + (next_target.y - target.y) * factor,
                    width: target.width + (next_target.width - target.width) * factor,
                    height: target.height + (next_target.height - target.height) * factor,
                },
                None => clone_target(target),
            }
        })
        .collect()
}

pub(crate) fn evaluate_ground_truth(
    keyframes: &[TestKeyframeDto],
    timestamp_us: i64,
) -> Vec<TestTargetDto> {
    match keyframe_bracket(keyframes, timestamp_us) {
        None => Vec::new(),
        Some(KeyframeBracket::BeforeFirst(frame) | KeyframeBracket::Exact(frame)) => {
            frame.targets.iter().map(clone_target).collect()
        }
        Some(KeyframeBracket::AfterLast(frame)) => frame.targets.iter().map(clone_target).collect(),
        Some(KeyframeBracket::Between {
            previous,
            next,
            factor,
        }) => {
            if evaluate_layout_intent(keyframes, timestamp_us) == "contain" {
                interpolate_contain_targets(previous, next, factor)
            } else {
                interpolate_crop_targets(previous, next, factor)
            }
        }
    }
}
