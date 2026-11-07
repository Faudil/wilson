import { z } from "zod";
import { CalendarDateSchema, IdSchema, TimestampSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";

/**
 * Case notes and follow-up tasks on a person (beneficiary). Texts are encrypted under the person's DEK, so deleting
 * the person's data makes them unreadable too. Every read and write is written to access_log.
 * Permissions: notes.view (read), notes.write (add, edit own, tick done), notes.moderate (edit/delete anyone's),
 * tasks.assign (give a task to someone else).
 */

const PersonRefSchema = z.object({ id: IdSchema, name: z.string() });

export const CaseNoteSchema = z.object({
  id: IdSchema,
  beneficiaryId: IdSchema,
  text: z.string(),
  /** null = the author's account was deleted. */
  author: PersonRefSchema.nullable(),
  createdAt: TimestampSchema,
  /** Set when the text was changed after writing. */
  editedAt: TimestampSchema.nullable(),
  /** The caller may edit/delete it (own note, or notes.moderate). */
  canEdit: z.boolean(),
});
export type CaseNote = z.infer<typeof CaseNoteSchema>;

export const TaskStatusSchema = z.enum(["open", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const CaseTaskSchema = z.object({
  id: IdSchema,
  beneficiaryId: IdSchema,
  /** Masked phone label, as everywhere else. */
  beneficiaryLabel: z.string(),
  language: LanguageSchema,
  text: z.string(),
  /** Reminder day (Europe/Paris). The task shows as due from that morning. */
  dueOn: CalendarDateSchema.nullable(),
  status: TaskStatusSchema,
  /** null = anyone with notes.write can pick it up. */
  assignee: PersonRefSchema.nullable(),
  createdBy: PersonRefSchema.nullable(),
  createdAt: TimestampSchema,
  doneAt: TimestampSchema.nullable(),
  doneBy: PersonRefSchema.nullable(),
  /** Open and dueOn is today or earlier. */
  due: z.boolean(),
  /** The caller may change the text (creator, or notes.moderate). */
  canEdit: z.boolean(),
});
export type CaseTask = z.infer<typeof CaseTaskSchema>;

export const NoteTextSchema = z.string().trim().min(1).max(4000);
export const TaskTextSchema = z.string().trim().min(1).max(500);

export const CaseFileSchema = z.object({
  notes: z.array(CaseNoteSchema),
  /** Open tasks first (soonest due first), then the 20 most recently closed. */
  tasks: z.array(CaseTaskSchema),
});
export type CaseFile = z.infer<typeof CaseFileSchema>;

export const TaskAddSchema = z.object({
  beneficiaryId: IdSchema,
  text: TaskTextSchema,
  dueOn: CalendarDateSchema.nullable().default(null),
  /** Someone else than the caller needs tasks.assign; the assignee must be able to read notes (notes.view). */
  assigneeId: IdSchema.nullable().default(null),
});

export const TaskUpdateSchema = z.object({
  id: IdSchema,
  text: TaskTextSchema.optional(),
  dueOn: CalendarDateSchema.nullable().optional(),
  assigneeId: IdSchema.nullable().optional(),
  status: TaskStatusSchema.optional(),
});

export const TaskListInputSchema = z.object({
  /** mine = assigned to me; unassigned = open tasks nobody took; created = tasks I gave to others. */
  filter: z.enum(["mine", "unassigned", "created"]).default("mine"),
  includeClosed: z.boolean().default(false),
});
