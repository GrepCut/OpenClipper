import type { ClipperLayoutSample, NormalizedBox } from "../../../shared/smart-crop.util";

const EPSILON = 1e-9;

function centerInside(box: NormalizedBox, viewport: NormalizedBox): boolean {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return x >= viewport.x - EPSILON && x <= viewport.x + viewport.width + EPSILON
    && y >= viewport.y - EPSILON && y <= viewport.y + viewport.height + EPSILON;
}

/**
 * Whether two consecutive split samples show the same people in the same
 * panels. Tracker ids churn during camera moves (a person re-acquired under
 * a new id), so besides equal ids a panel also keeps its person when that
 * person's face is still inside the same panel on both sides: they moved,
 * they were not replaced. A real swap (new lead on top, a cut) fails both.
 * Non-split samples have no panel owners and always match.
 */
export function samePanelPeople(previous: ClipperLayoutSample, next: ClipperLayoutSample): boolean {
  if (previous.mode !== "split" || next.mode !== "split") return true;
  const before = previous.panelSubjects;
  const after = next.panelSubjects;
  if (!before || !after) return !before && !after;
  if (before.length !== after.length
    || previous.viewports.length !== next.viewports.length
    || before.length !== previous.viewports.length) return false;
  if (before.every((owner, index) => owner.id === after[index]?.id)) return true;
  return after.every((owner, index) => centerInside(owner.focusBox, previous.viewports[index]!))
    && before.every((owner, index) => centerInside(owner.focusBox, next.viewports[index]!));
}
