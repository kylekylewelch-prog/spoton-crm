import { daysBetween, type IsoDate } from './dates';
import { allocate, BPS, ratioBps } from './money';

/**
 * Marketing, BDR and partner attribution.
 *
 * A single `leadSource` field cannot answer where pipeline comes from, because a
 * real journey has many touches across months and several teams claim the same
 * deal. This module distributes credit explicitly across interactions, keeps
 * "sourced" and "influenced" as different questions, and always allocates in
 * basis points that sum to exactly 10000 so no report double-counts.
 */

export type AttributionModel =
  | 'first_touch'
  | 'last_touch'
  | 'linear'
  | 'time_decay'
  | 'opportunity_creation'
  | 'w_shaped';

export type Touch = {
  id: string;
  campaignId: string | null;
  /** marketing | bdr | partner | sales | product */
  sourceCategory: string;
  occurredAt: IsoDate;
  contactId?: string | null;
  responseType?: string | null;
};

export type AttributionTarget = {
  /** Anchor dates used by the W-shaped and creation models. */
  contactCreatedAt?: IsoDate | null;
  opportunityCreatedAt?: IsoDate | null;
  closedAt?: IsoDate | null;
  /** Touches older than the window get no credit. */
  attributionWindowDays?: number;
};

/**
 * Assigns basis-point weights to touches under a model.
 *
 * Weights always total 10000 exactly — the largest-remainder allocator handles
 * the rounding so a 3-touch linear split is 3334/3333/3333 rather than three
 * 33.33% figures that quietly lose a cent.
 */
export function weightTouches(
  touches: Touch[],
  model: AttributionModel,
  target: AttributionTarget = {},
): { touchId: string; weightBps: number }[] {
  const windowDays = target.attributionWindowDays ?? 365;
  const anchor = target.closedAt ?? target.opportunityCreatedAt ?? null;

  const eligible = [...touches]
    .filter((t) => {
      if (!anchor) return true;
      return daysBetween(t.occurredAt, anchor) <= windowDays;
    })
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  if (eligible.length === 0) return [];
  if (eligible.length === 1) return [{ touchId: eligible[0].id, weightBps: BPS }];

  switch (model) {
    case 'first_touch':
      return [{ touchId: eligible[0].id, weightBps: BPS }];

    case 'last_touch':
      return [{ touchId: eligible[eligible.length - 1].id, weightBps: BPS }];

    case 'opportunity_creation': {
      // Credit the touch closest to (and not after) opportunity creation.
      const created = target.opportunityCreatedAt;
      if (!created) return [{ touchId: eligible[eligible.length - 1].id, weightBps: BPS }];
      const before = eligible.filter((t) => t.occurredAt <= created);
      const chosen = before.length > 0 ? before[before.length - 1] : eligible[0];
      return [{ touchId: chosen.id, weightBps: BPS }];
    }

    case 'linear': {
      const weights = allocate(BPS, eligible.map(() => 1));
      return eligible.map((t, i) => ({ touchId: t.id, weightBps: weights[i] }));
    }

    case 'time_decay': {
      // Seven-day half-life relative to the anchor: recency is weighted heavily
      // because the touches near a decision usually did the persuading.
      const ref = anchor ?? eligible[eligible.length - 1].occurredAt;
      const raw = eligible.map((t) => {
        const age = Math.max(0, daysBetween(t.occurredAt, ref));
        return Math.max(0.0001, Math.pow(0.5, age / 7));
      });
      const scaled = raw.map((r) => Math.round(r * 1_000_000));
      const weights = allocate(BPS, scaled);
      return eligible.map((t, i) => ({ touchId: t.id, weightBps: weights[i] }));
    }

    case 'w_shaped': {
      // 30% first touch, 30% lead creation, 30% opportunity creation, 10% spread
      // across everything else — the standard shape for a committee purchase.
      const first = eligible[0];
      const creation = nearestTouch(eligible, target.contactCreatedAt) ?? first;
      const oppTouch =
        nearestTouch(eligible, target.opportunityCreatedAt) ?? eligible[eligible.length - 1];

      const anchors = new Map<string, number>();
      const bump = (id: string, v: number) => anchors.set(id, (anchors.get(id) ?? 0) + v);
      bump(first.id, 3000);
      bump(creation.id, 3000);
      bump(oppTouch.id, 3000);

      const others = eligible.filter((t) => !anchors.has(t.id));
      if (others.length > 0) {
        const spread = allocate(1000, others.map(() => 1));
        others.forEach((t, i) => bump(t.id, spread[i]));
      } else {
        // No non-anchor touches: give the remainder to the opportunity touch.
        bump(oppTouch.id, 1000);
      }

      // Renormalise in case anchors collapsed onto the same touch.
      const ids = [...anchors.keys()];
      const normalised = allocate(BPS, ids.map((id) => anchors.get(id)!));
      return ids.map((id, i) => ({ touchId: id, weightBps: normalised[i] }));
    }

    default:
      return eligible.map((t) => ({ touchId: t.id, weightBps: Math.round(BPS / eligible.length) }));
  }
}

function nearestTouch(touches: Touch[], date?: IsoDate | null): Touch | null {
  if (!date) return null;
  const before = touches.filter((t) => t.occurredAt <= date);
  if (before.length > 0) return before[before.length - 1];
  return touches[0] ?? null;
}

export type CreditedTouch = {
  touchId: string;
  campaignId: string | null;
  sourceCategory: string;
  weightBps: number;
  creditedPipelineCents: number;
  creditedArrCents: number;
  creditedRevenueCents: number;
};

/** Distributes an opportunity's value across weighted touches. */
export function creditTouches(
  touches: Touch[],
  model: AttributionModel,
  amounts: { pipelineCents: number; arrCents: number; revenueCents: number },
  target: AttributionTarget = {},
): CreditedTouch[] {
  const weights = weightTouches(touches, model, target);
  if (weights.length === 0) return [];

  const byId = new Map(touches.map((t) => [t.id, t]));
  const w = weights.map((x) => x.weightBps);

  const pipeline = allocate(amounts.pipelineCents, w);
  const arr = allocate(amounts.arrCents, w);
  const revenue = allocate(amounts.revenueCents, w);

  return weights.map((x, i) => {
    const t = byId.get(x.touchId)!;
    return {
      touchId: x.touchId,
      campaignId: t.campaignId,
      sourceCategory: t.sourceCategory,
      weightBps: x.weightBps,
      creditedPipelineCents: pipeline[i],
      creditedArrCents: arr[i],
      creditedRevenueCents: revenue[i],
    };
  });
}

/**
 * Sourced versus influenced.
 *
 * Sourced credit is exclusive — exactly one team gets it, decided by the touch
 * that created the opportunity. Influenced credit is inclusive: every team with a
 * qualifying touch inside the window counts, which is why influenced pipeline
 * legitimately sums to more than total pipeline and must never be added to
 * sourced numbers in the same column.
 */
export function sourcedVsInfluenced(
  touches: Touch[],
  target: AttributionTarget,
  amounts: { pipelineCents: number; arrCents: number },
): {
  sourcedBy: string | null;
  sourcedCampaignId: string | null;
  influencedBy: string[];
  sourced: Record<string, { pipelineCents: number; arrCents: number }>;
  influenced: Record<string, { pipelineCents: number; arrCents: number }>;
} {
  const windowDays = target.attributionWindowDays ?? 365;
  const anchor = target.opportunityCreatedAt ?? target.closedAt ?? null;

  const eligible = [...touches]
    .filter((t) => !anchor || daysBetween(t.occurredAt, anchor) <= windowDays)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const creationTouch =
    nearestTouch(eligible, target.opportunityCreatedAt) ?? eligible[0] ?? null;

  const sourced: Record<string, { pipelineCents: number; arrCents: number }> = {};
  if (creationTouch) {
    sourced[creationTouch.sourceCategory] = {
      pipelineCents: amounts.pipelineCents,
      arrCents: amounts.arrCents,
    };
  }

  const categories = [...new Set(eligible.map((t) => t.sourceCategory))];
  const influenced: Record<string, { pipelineCents: number; arrCents: number }> = {};
  for (const c of categories) {
    influenced[c] = { pipelineCents: amounts.pipelineCents, arrCents: amounts.arrCents };
  }

  return {
    sourcedBy: creationTouch?.sourceCategory ?? null,
    sourcedCampaignId: creationTouch?.campaignId ?? null,
    influencedBy: categories,
    sourced,
    influenced,
  };
}

export type CampaignPerformance = {
  campaignId: string;
  costCents: number;
  responses: number;
  /** Exclusive: opportunities this campaign created. */
  sourcedPipelineCents: number;
  sourcedArrCents: number;
  /** Inclusive: opportunities this campaign touched. */
  influencedPipelineCents: number;
  influencedArrCents: number;
  /** Sourced ARR divided by cost, in basis points. */
  roiBps: number;
  costPerResponseCents: number;
  costPerOpportunityCents: number;
  opportunities: number;
};

export function campaignPerformance(input: {
  campaignId: string;
  costCents: number;
  responses: number;
  opportunities: number;
  sourcedPipelineCents: number;
  sourcedArrCents: number;
  influencedPipelineCents: number;
  influencedArrCents: number;
}): CampaignPerformance {
  return {
    ...input,
    roiBps: input.costCents > 0 ? ratioBps(input.sourcedArrCents, input.costCents) : 0,
    costPerResponseCents:
      input.responses > 0 ? Math.round(input.costCents / input.responses) : 0,
    costPerOpportunityCents:
      input.opportunities > 0 ? Math.round(input.costCents / input.opportunities) : 0,
  };
}

/** First- and most-recent-source stamps, maintained as touches arrive. */
export function sourceStamps(touches: Touch[]): {
  originalSource: string | null;
  originalCampaignId: string | null;
  latestSource: string | null;
  latestCampaignId: string | null;
} {
  if (touches.length === 0) {
    return {
      originalSource: null,
      originalCampaignId: null,
      latestSource: null,
      latestCampaignId: null,
    };
  }
  const sorted = [...touches].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    originalSource: first.responseType ?? first.sourceCategory,
    originalCampaignId: first.campaignId,
    latestSource: last.responseType ?? last.sourceCategory,
    latestCampaignId: last.campaignId,
  };
}
