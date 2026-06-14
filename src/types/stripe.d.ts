declare module "stripe" {
  export default class Stripe {
    constructor(key: string);
    customers: {
      create(input: Record<string, unknown>): Promise<{ id: string }>;
    };
    subscriptions: {
      create(input: Record<string, unknown>): Promise<StripeSubscription>;
    };
    billingPortal: {
      sessions: {
        create(input: Record<string, unknown>): Promise<{ url: string }>;
      };
    };
    invoices: {
      list(input: Record<string, unknown>): Promise<{ data: StripeInvoice[] }>;
    };
    webhooks: {
      constructEvent(
        payload: string | Buffer,
        signature: string,
        secret: string,
      ): StripeEvent;
    };
  }

  export namespace Stripe {
    type Subscription = StripeSubscription;
    type Invoice = StripeInvoice;
  }

  interface StripeSubscription {
    id: string;
    status: string;
    cancel_at_period_end: boolean;
    customer: string | { id: string };
    items: { data: { price?: { id?: string } }[] };
    current_period_end?: number;
  }

  interface StripeInvoice {
    id?: string;
    number?: string | null;
    status?: string | null;
    total?: number;
    amount_due?: number;
    currency?: string;
    period_start?: number;
    period_end?: number;
    customer?: string | { id?: string } | null;
    billing_reason?: string;
    status_transitions?: { paid_at?: number | null };
    invoice_pdf?: string | null;
    hosted_invoice_url?: string | null;
  }

  interface StripeEvent {
    type: string;
    data: { object: StripeSubscription | StripeInvoice };
  }
}
