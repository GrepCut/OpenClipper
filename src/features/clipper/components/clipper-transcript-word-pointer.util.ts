/**
 * Index of the word element closest to the pointer inside `container`, so clicks on
 * whitespace between wrapped lines still land on a word. A direct hit on a word
 * element resolves without measuring layout.
 */
export function nearestWordIndexFromPointer(
  container: HTMLElement | null,
  event: { target: EventTarget | null; clientX: number; clientY: number },
  indexAttribute: string,
  isValidIndex: (index: number) => boolean = () => true,
): number | null {
  if (!container) return null;

  const parseIndex = (element: Element): number | null => {
    const index = Number(element.getAttribute(indexAttribute));
    return Number.isInteger(index) && isValidIndex(index) ? index : null;
  };

  const directHit =
    event.target instanceof Element ? event.target.closest(`[${indexAttribute}]`) : null;
  if (directHit && container.contains(directHit)) {
    const index = parseIndex(directHit);
    if (index != null) return index;
  }

  const wordElements = container.querySelectorAll<HTMLElement>(`[${indexAttribute}]`);
  let nearestIndex: number | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const element of wordElements) {
    const index = parseIndex(element);
    if (index == null) continue;

    const rect = element.getBoundingClientRect();
    const deltaX = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
    const deltaY = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearestIndex = index;
      if (distanceSquared === 0) break;
    }
  }
  return nearestIndex;
}
