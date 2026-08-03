import { deleteClipperExport } from "./clipper-export-db-api.util";

export async function removeClipperExport(input: {
  projectId: string;
  exportId: string;
}): Promise<void> {
  await deleteClipperExport(input.exportId);
}
