export interface XYWHBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface XYXYBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export function boxIouXYWH(a: XYWHBox, b: XYWHBox): number {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlap = overlapX * overlapY;
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

export function boxIouXYXY(a: XYXYBox, b: XYXYBox): number {
  const width = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin));
  const height = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin));
  const intersection = width * height;
  const union =
    (a.xmax - a.xmin) * (a.ymax - a.ymin) +
    (b.xmax - b.xmin) * (b.ymax - b.ymin) -
    intersection;
  return union > 0 ? intersection / union : 0;
}
