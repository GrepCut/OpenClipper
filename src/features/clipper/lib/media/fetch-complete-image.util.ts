/** Custom media protocols may return one capped range even for a plain GET. */
export async function fetchCompleteImage(url: string): Promise<Blob> {
  const chunks: Blob[] = [];
  let offset = 0;
  let total: number | undefined;
  let type = "";
  do {
    const response = await fetch(url, offset ? { headers: { Range: `bytes=${offset}-` } } : undefined);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Could not read logo (${response.status}).`);
    }
    if (!offset) type = response.headers.get("Content-Type") ?? "";
    if (response.status === 200 && !offset) return response.blob();

    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "");
    const start = Number(range?.[1]);
    const end = Number(range?.[2]);
    const size = Number(range?.[3]);
    if (response.status !== 206 || !range || ![start, end, size].every(Number.isSafeInteger)
      || start !== offset || end < start || end >= size || (total !== undefined && total !== size)) {
      await response.body?.cancel();
      throw new Error("Logo response contains an inconsistent byte range.");
    }
    const chunk = await response.blob();
    if (chunk.size !== end - start + 1) throw new Error("Logo response is incomplete.");
    chunks.push(chunk);
    total = size;
    offset = end + 1;
  } while (offset < total);
  return new Blob(chunks, { type });
}
