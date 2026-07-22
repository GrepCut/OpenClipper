import { targetCenter } from "../benchmark/target-geometry.util";
import type { TestClip, TestLayoutIntent, TestTarget } from "../test.types";
import { freshContainTarget, freshTarget } from "./test-clip-editor.util";

export function createLayoutTargetActions(input: {
  clip: TestClip | null;
  draftTargets: TestTarget[];
  currentTime: number;
  setDraftLayoutIntent: (intent: TestLayoutIntent) => void;
  draftLayoutIntentRef: React.MutableRefObject<TestLayoutIntent>;
  setDraftTargets: React.Dispatch<React.SetStateAction<TestTarget[]>>;
  draftTargetsRef: React.MutableRefObject<TestTarget[]>;
  commitKeyframeAtTime: (time: number, targets: TestTarget[], layoutIntent: TestLayoutIntent) => void;
}) {
  const switchToCrop = () => {
    if (!input.clip) return;
    const nextTargets = [freshTarget(0, input.clip)];
    input.setDraftLayoutIntent("crop");
    input.draftLayoutIntentRef.current = "crop";
    input.setDraftTargets(nextTargets);
    input.draftTargetsRef.current = nextTargets;
    input.commitKeyframeAtTime(input.currentTime, nextTargets, "crop");
  };

  const addSecondTarget = () => {
    if (!input.clip || !input.draftTargets[0]) return;
    const center = targetCenter(input.draftTargets[0]);
    const next = [...input.draftTargets, freshTarget(1, input.clip, Math.min(0.85, center.x + input.draftTargets[0].width * 0.6), center.y)];
    input.setDraftTargets(next);
    input.commitKeyframeAtTime(input.currentTime, next, "crop");
  };

  const switchToContain = () => {
    if (!input.clip) return;
    const nextTargets = [freshContainTarget(input.clip)];
    input.setDraftLayoutIntent("contain");
    input.draftLayoutIntentRef.current = "contain";
    input.setDraftTargets(nextTargets);
    input.draftTargetsRef.current = nextTargets;
    input.commitKeyframeAtTime(input.currentTime, nextTargets, "contain");
  };

  const removeSecondTarget = () => {
    const next = input.draftTargets.slice(0, 1);
    input.setDraftTargets(next);
    input.commitKeyframeAtTime(input.currentTime, next, "crop");
  };

  return { switchToCrop, addSecondTarget, switchToContain, removeSecondTarget };
}
