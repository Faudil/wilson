import { os } from "./base.js";
import { authRouter } from "./auth.js";
import { beneficiariesRouter } from "./beneficiaries.js";
import { documentsRouter } from "./documents.js";
import { lettersRouter } from "./letters.js";
import { sandboxRouter } from "./sandbox.js";
import { systemRouter } from "./system.js";

export const router = os.router({
  auth: authRouter,
  beneficiaries: beneficiariesRouter,
  documents: documentsRouter,
  system: systemRouter,
  letters: lettersRouter,
  sandbox: sandboxRouter,
});
export type AppRouter = typeof router;
