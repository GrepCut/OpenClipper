import {
  clampTargetRect,
  finalizeTargetRect,
  resizeTargetFree,
  resizeTargetFromCorner,
  stageNormToSourceNorm,
  videoContentInset,
} from "../benchmark/target-geometry.util";
import type { TestClip, TestLayoutIntent, TestTarget } from "../test.types";

export function createTargetPointerHandlers(input: {
  clipRef: React.MutableRefObject<TestClip | null>;
  stageRef: React.MutableRefObject<HTMLDivElement | null>;
  sourceSize: { width: number; height: number };
  draftTargetsRef: React.MutableRefObject<TestTarget[]>;
  draftLayoutIntentRef: React.MutableRefObject<TestLayoutIntent>;
  currentTimeRef: React.MutableRefObject<number>;
  setDraftTargets: React.Dispatch<React.SetStateAction<TestTarget[]>>;
  setGeometryChanged: React.Dispatch<React.SetStateAction<boolean>>;
  commitKeyframeAtTime: (time: number, targets: TestTarget[], layoutIntent: TestLayoutIntent) => void;
}) {
  return (event: React.PointerEvent, slot: 0 | 1, mode: "move" | "resize") => {
    event.preventDefault();
    event.stopPropagation();
    const currentClip = input.clipRef.current;
    if (!currentClip || !input.stageRef.current) return;
    const pointerId = event.pointerId;
    const isContain = input.draftLayoutIntentRef.current === "contain";
    const stageRect = input.stageRef.current.getBoundingClientRect();
    const inset = videoContentInset(
      stageRect.width,
      stageRect.height,
      input.sourceSize.width || currentClip.width,
      input.sourceSize.height || currentClip.height,
    );
    const toSource = (clientX: number, clientY: number) => stageNormToSourceNorm(
      (clientX - stageRect.left) / stageRect.width,
      (clientY - stageRect.top) / stageRect.height,
      inset,
    );
    const startSource = toSource(event.clientX, event.clientY);
    const startTarget = input.draftTargetsRef.current.find((target) => target.slot === slot);
    if (!startTarget) return;
    const grabOffset = mode === "move"
      ? { x: startSource.x - startTarget.x, y: startSource.y - startTarget.y }
      : null;
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId || !input.stageRef.current) return;
      const rect = input.stageRef.current.getBoundingClientRect();
      const moveInset = videoContentInset(
        rect.width,
        rect.height,
        input.sourceSize.width || currentClip.width,
        input.sourceSize.height || currentClip.height,
      );
      const pointer = stageNormToSourceNorm(
        (pointerEvent.clientX - rect.left) / rect.width,
        (pointerEvent.clientY - rect.top) / rect.height,
        moveInset,
      );
      const sw = input.sourceSize.width || currentClip.width;
      const sh = input.sourceSize.height || currentClip.height;
      input.setDraftTargets((current) => {
        const next = current.map((target) => {
          if (target.slot !== slot) return target;
          if (isContain) {
            if (mode === "move" && grabOffset) {
              return {
                ...target,
                ...clampTargetRect({
                  ...target,
                  x: pointer.x - grabOffset.x,
                  y: pointer.y - grabOffset.y,
                }),
              } as TestTarget;
            }
            return { ...target, ...resizeTargetFree(target, pointer) } as TestTarget;
          }
          if (mode === "move" && grabOffset) {
            return finalizeTargetRect({
              ...target,
              x: pointer.x - grabOffset.x,
              y: pointer.y - grabOffset.y,
            }, sw, sh) as TestTarget;
          }
          return {
            ...target,
            ...resizeTargetFromCorner(target, pointer, sw, sh),
          } as TestTarget;
        });
        input.draftTargetsRef.current = next;
        return next;
      });
      input.setGeometryChanged(true);
    };
    const up = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      input.commitKeyframeAtTime(
        input.currentTimeRef.current,
        input.draftTargetsRef.current,
        input.draftLayoutIntentRef.current,
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}
