import type { IsoDate } from './dates';
import type { StageKey } from './stages';

export type OpportunityType =
  | 'new_logo'
  | 'upsell'
  | 'cross_sell'
  | 'renewal'
  | 'contraction'
  | 'churn';

export type ForecastCategory = 'commit' | 'best_case' | 'pipeline' | 'omitted' | 'closed';

export type ArrMovementType =
  | 'new'
  | 'expansion'
  | 'uplift'
  | 'contraction'
  | 'churn'
  | 'renewal';

export type AmendmentType =
  | 'upsell'
  | 'cross_sell'
  | 'contraction'
  | 'renewal'
  | 'cancellation'
  | 'price_change'
  | 'co_term_add'
  | 'true_up';

export type LineAction =
  | 'add'
  | 'remove'
  | 'increase'
  | 'decrease'
  | 'renew'
  | 'price_change'
  | 'no_change';

export type BillingFrequency = 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'upfront';

export type HealthBand = 'critical' | 'poor' | 'fair' | 'good' | 'excellent';

/** A priced line, independent of whether it lives on a quote or a subscription. */
export type PricedLine = {
  productId: string;
  action: LineAction;
  quantity: number;
  priorQuantity?: number;
  listUnitCents: number;
  netUnitCents: number;
  discountBps: number;
  programDiscountBps?: number;
  termMonths: number;
  startDate: IsoDate;
  endDate: IsoDate;
  prorationFactorBps: number;
  /** Annual run rate contributed once fully in effect. */
  arrCents: number;
  annualizedArrCents: number;
  /** Cash for the (possibly short) first period. */
  proratedAmountCents: number;
  tcvCents: number;
  rampSchedule?: RampYear[] | null;
  minCommitVolume?: number | null;
  overageUnitCents?: number | null;
  replacesSubscriptionItemId?: string | null;
  isRecurring: boolean;
};

export type RampYear = {
  year: number;
  quantity: number;
  netUnitCents: number;
};

export type StageInfo = { stage: StageKey; type: OpportunityType };

export type Money = number;
export type Bps = number;
