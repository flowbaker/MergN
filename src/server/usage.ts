import type { DocStore } from "../store/docstore";

// Per-space usage counters used to enforce plan limits:
//   chats    — AI conversations started this period (Free cap)
//   aiTokens — AI tokens consumed this period (Pro cap)
// The period is anchored at `resetAt` and zeroed explicitly when the Stripe
// billing cycle renews (invoice.paid → reset). A 32-day fallback covers
// self-host (no Stripe) and any missed webhook, so usage never grows forever.

const SYS = "__sys";
const COLLECTION = "space_usage";
const FALLBACK_MS = 32 * 24 * 60 * 60 * 1000;

export interface SpaceUsage {
  spaceId: string;
  resetAt: string; // ISO — start of the current period
  chats: number;
  aiTokens: number;
  updatedAt: string;
}

export interface UsageStore {
  get(spaceId: string): Promise<SpaceUsage>;
  recordChat(spaceId: string): Promise<void>;
  addTokens(spaceId: string, tokens: number): Promise<void>;
  reset(spaceId: string): Promise<void>;
}

export function createUsageStore(store: DocStore): UsageStore {
  function fresh(spaceId: string): SpaceUsage {
    return {
      spaceId,
      resetAt: new Date().toISOString(),
      chats: 0,
      aiTokens: 0,
      updatedAt: "",
    };
  }

  async function read(spaceId: string): Promise<SpaceUsage> {
    const raw = (await store.get(SYS, COLLECTION, spaceId)) as unknown as
      | SpaceUsage
      | null;
    if (!raw) return fresh(spaceId);
    // safety fallback — if a billing cycle reset was missed (or no billing),
    // start a new period after ~a month.
    if (Date.now() - Date.parse(raw.resetAt) > FALLBACK_MS)
      return fresh(spaceId);
    return raw;
  }

  async function write(u: SpaceUsage): Promise<void> {
    u.updatedAt = new Date().toISOString();
    await store.put(
      SYS,
      COLLECTION,
      u.spaceId,
      u as unknown as Record<string, unknown>,
    );
  }

  return {
    get: read,
    async recordChat(spaceId) {
      const u = await read(spaceId);
      u.chats += 1;
      await write(u);
    },
    async addTokens(spaceId, tokens) {
      if (!tokens || tokens < 0) return;
      const u = await read(spaceId);
      u.aiTokens += tokens;
      await write(u);
    },
    async reset(spaceId) {
      await write(fresh(spaceId));
    },
  };
}
