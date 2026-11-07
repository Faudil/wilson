import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which conversation a Claude call belongs to, without passing ids through the LlmProvider interface
 * (which on purpose never sees who the person is). Only the opaque beneficiary id, used to group costs.
 */
const store = new AsyncLocalStorage<{ beneficiaryId: string | null }>();

export function withUsageContext<T>(beneficiaryId: string | null, fn: () => Promise<T>): Promise<T> {
  return store.run({ beneficiaryId }, fn);
}

export function currentBeneficiaryId(): string | null {
  return store.getStore()?.beneficiaryId ?? null;
}
