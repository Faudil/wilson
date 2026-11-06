import { BeneficiariesServiceImpl } from "./beneficiaries/serviceImpl.js";
import type { Deps } from "./deps.js";
import { DocumentsServiceImpl } from "./documents/serviceImpl.js";

export interface Services {
  beneficiaries: BeneficiariesServiceImpl;
  documents: DocumentsServiceImpl;
}

/** What the services need: Deps without the transport (the transport itself needs the beneficiaries service). */
export type ServiceDeps = Pick<Deps, "db" | "crypto" | "blobs" | "jobs" | "config" | "now">;

const cache = new WeakMap<object, Services>();

/** Service instances for a deps object (one set per object, so the DEK cache is shared by everyone using the same deps). */
export function getServices(deps: ServiceDeps): Services {
  let s = cache.get(deps);
  if (!s) {
    const beneficiaries = new BeneficiariesServiceImpl(deps);
    s = { beneficiaries, documents: new DocumentsServiceImpl(deps, beneficiaries) };
    cache.set(deps, s);
  }
  return s;
}

/** Make `getServices(other)` return the same instances (main.ts: base deps → full deps → WaDeps). */
export function adoptServices(from: ServiceDeps, ...others: object[]): Services {
  const s = getServices(from);
  for (const o of others) cache.set(o, s);
  return s;
}
