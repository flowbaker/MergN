import type {
  BillingRecord,
  BillingService,
  SubscriptionView,
} from "./billing-types";

const SELF_HOST_PLAN = {
  slug: "self-host",
  name: "Self-hosted",
  description: "Unlimited usage on your own instance.",
  priceMonthly: 0 as number | null,
  currency: "usd",
  limits: { chats: -1, aiTokens: -1 },
  features: [] as string[],
  stripePriceEnv: "",
};

export function createBillingStub(): BillingService {
  return {
    enabled() {
      return false;
    },

    async getOrInit(spaceId) {
      const rec: BillingRecord = {
        spaceId,
        planSlug: SELF_HOST_PLAN.slug,
        subscriptionStatus: "free",
        updatedAt: new Date().toISOString(),
      };
      return rec;
    },

    async getSubscription() {
      const plan = SELF_HOST_PLAN;
      const view: SubscriptionView = {
        plan_slug: plan.slug,
        plan_name: plan.name,
        plan_description: plan.description,
        price_monthly: plan.priceMonthly,
        currency: plan.currency,
        status: "free",
        current_period_end: null,
        cancel_at_period_end: false,
        limits: {
          chats_limit: plan.limits.chats,
          ai_tokens_limit: plan.limits.aiTokens,
        },
      };
      return view;
    },

    async createPortalSession() {
      throw new Error("billing not configured");
    },

    async getInvoices() {
      return [];
    },

    async handleWebhook() {},

    async planOf() {
      return SELF_HOST_PLAN;
    },
  };
}
