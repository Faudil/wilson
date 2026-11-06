import { ORPCError } from "@orpc/server";
import type { DocumentType } from "@wilson/contracts";
import { localDate, daysBetween } from "../time.js";
import { os, requirePermission } from "./base.js";
import { logAccess } from "./logAccess.js";
import { getServices } from "../services.js";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export const documentsRouter = {
  deadlines: os.documents.deadlines.use(requirePermission("documents.view_metadata")).handler(async ({ input, context }) => {
    const { deps } = context;
    const { documents, beneficiaries } = getServices(deps);
    const today = localDate(deps.now(), deps.config.TIMEZONE);
    const rows = await documents.deadlines(input.withinDays);
    const labels = new Map<string, string>();
    for (const r of rows) if (!labels.has(r.beneficiaryId)) labels.set(r.beneficiaryId, await beneficiaries.label(r.beneficiaryId));
    return rows.map((r) => ({
      documentId: r.id,
      beneficiaryId: r.beneficiaryId,
      beneficiaryLabel: labels.get(r.beneficiaryId)!,
      type: r.type as DocumentType,
      expiresAt: r.expiresAt!,
      daysLeft: daysBetween(today, r.expiresAt!),
    }));
  }),

  file: os.documents.file.use(requirePermission("documents.view_file")).handler(async ({ input, context }) => {
    const { documents } = getServices(context.deps);
    if (!(await documents.get(input.id))) throw new ORPCError("NOT_FOUND");
    const { bytes, mimeType } = await documents.readFile(input.id);
    await logAccess(context, "documents.file", input.id);
    return new File([new Uint8Array(bytes)], `document-${input.id}.${EXT[mimeType] ?? "bin"}`, { type: mimeType });
  }),

  update: os.documents.update.use(requirePermission("documents.edit")).handler(async ({ input, context }) => {
    const { id, ...edit } = input;
    const dto = await getServices(context.deps).documents.update(id, edit, "entered_by_volunteer");
    if (!dto) throw new ORPCError("NOT_FOUND");
    await logAccess(context, "documents.update", id);
    return dto;
  }),

  archive: os.documents.archive.use(requirePermission("documents.edit")).handler(async ({ input, context }) => {
    const { documents } = getServices(context.deps);
    if (!(await documents.get(input.id))) throw new ORPCError("NOT_FOUND");
    const dto = await documents.archive(input.id);
    await logAccess(context, "documents.archive", input.id);
    return dto;
  }),
};
