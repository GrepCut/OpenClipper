import { deleteClipperExport } from "./clipper-export-db-api.util";
import { emitClipperExportsChanged } from "./clipper-export-events.util";

export async function removeClipperExport(input: {
  projectId: string;
  exportId: string;
}): Promise<void> {
  await deleteClipperExport(input.exportId);
  emitClipperExportsChanged(input.projectId);
}
