export function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

export function applyFilenameTemplate(
  template: string,
  name: string,
  formatId: string,
  clipIndex: number,
): string {
  const clipNum = String(clipIndex + 1).padStart(2, "0");
  return (
    template
      .replace("{name}", name)
      .replace("{platform}", formatId)
      .replace("{clip}", clipNum) || `${name}-clip-${clipNum}-${formatId}`
  );
}
