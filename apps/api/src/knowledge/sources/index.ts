import type { SourceAdapter } from "../types.js";
import { annuaireAdapter } from "./annuaire.js";
import { associationAdapter } from "./association.js";
import { servicePublicAdapter } from "./servicePublic.js";
import { watizatAdapter } from "./watizat.js";

export const ADAPTERS: SourceAdapter[] = [servicePublicAdapter, annuaireAdapter, associationAdapter, watizatAdapter];
