import { os } from "./base.js";
import { appointmentsRouter } from "./appointments.js";
import { authRouter } from "./auth.js";
import { buddiesRouter } from "./buddies.js";
import { beneficiariesRouter } from "./beneficiaries.js";
import { conversationsRouter } from "./conversations.js";
import { documentsRouter } from "./documents.js";
import { knowledgeRouter } from "./knowledge.js";
import { lettersRouter } from "./letters.js";
import { numbersRouter } from "./numbers.js";
import { notesRouter, tasksRouter } from "./notes.js";
import { sandboxRouter } from "./sandbox.js";
import { skillsRouter } from "./skills.js";
import { systemRouter } from "./system.js";
import { usageRouter } from "./usage.js";
import { volunteersRouter } from "./volunteers.js";
import { associationsRouter, invitationsRouter } from "./associations.js";
import { placesRouter } from "./places.js";
import { broadcastsRouter } from "./broadcasts.js";

export const router = os.router({
  auth: authRouter,
  beneficiaries: beneficiariesRouter,
  documents: documentsRouter,
  system: systemRouter,
  letters: lettersRouter,
  sandbox: sandboxRouter,
  knowledge: knowledgeRouter,
  conversations: conversationsRouter,
  volunteers: volunteersRouter,
  associations: associationsRouter,
  invitations: invitationsRouter,
  usage: usageRouter,
  notes: notesRouter,
  tasks: tasksRouter,
  skills: skillsRouter,
  places: placesRouter,
  broadcasts: broadcastsRouter,
  buddies: buddiesRouter,
  appointments: appointmentsRouter,
  numbers: numbersRouter,
});
export type AppRouter = typeof router;
