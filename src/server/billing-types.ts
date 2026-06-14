import type { Plan } from "./plans";

export interface BillingRecord {
  spaceId: string;
  planSlug: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  updatedAt: string;
}

export interface SubscriptionView {
  plan_slug: string;
  plan_name: string;
  plan_description: string;
  price_monthly: number | null;
  currency: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  limits: { chats_limit: number; ai_tokens_limit: number };
}

export interface InvoiceView {
  id: string;
  number: string | null;
  status: string | null;
  amount: number;
  currency: string;
  period_start: number;
  period_end: number;
  paid_at: number | null;
  invoice_pdf: string | null;
  hosted_url: string | null;
}

export interface BillingService {
  enabled(): boolean;
  getOrInit(
    spaceId: string,
    owner?: { email?: string; name?: string },
  ): Promise<BillingRecord>;
  getSubscription(
    spaceId: string,
    owner?: { email?: string; name?: string },
  ): Promise<SubscriptionView>;
  createPortalSession(spaceId: string, returnUrl: string): Promise<string>;
  getInvoices(spaceId: string): Promise<InvoiceView[]>;
  handleWebhook(payload: string | Buffer, signature: string): Promise<void>;
  planOf(spaceId: string): Promise<Plan>;
}

export interface BillingDeps {
  onRenewal?: (spaceId: string) => Promise<void>;
}
