import type { Config } from "./config.js";
import type { Crypto } from "./crypto/keys.js";
import type { Db } from "./db/client.js";
import type { GeoProvider } from "./geo/provider.js";
import type { JobQueue } from "./jobs/names.js";
import type { LlmProvider } from "./llm/provider.js";
import type { BlobStore } from "./storage/blobStore.js";
import type { WhatsAppTransport } from "./whatsapp/transport.js";

/** Everything a service needs, built once in main.ts and injected (tests build it with fakes). */
export interface Deps {
  config: Config;
  db: Db;
  crypto: Crypto;
  blobs: BlobStore;
  llm: LlmProvider;
  /** Addresses → points and places around a point (OpenStreetMap, Soliguide). */
  geo: GeoProvider;
  wa: WhatsAppTransport;
  jobs: JobQueue;
  /** Injectable clock for reminders and the 24 h window. */
  now: () => Date;
  /** Outbound HTTP for public open-data lookups (association register). Tests inject a fake. */
  fetch?: typeof fetch;
}
