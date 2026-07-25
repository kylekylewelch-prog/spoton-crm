import { daysBetween, type IsoDate } from './dates';

/**
 * Lead and contact scoring.
 *
 * Four dimensions are kept apart on purpose. Fit says whether we want them;
 * intent says whether they are shopping; engagement says whether they talk to us;
 * behaviour says what they actually did. Collapsing them into one number is what
 * produces the familiar situation where nobody can say why a lead is an MQL.
 *
 * Scores decay and can go negative. A lead that downloaded a whitepaper eight
 * months ago is not the same asset as one that did so yesterday, and an unsubscribe
 * is information, not a neutral event.
 */

export type FitInputs = {
  employeeCount?: number | null;
  industry?: string | null;
  country?: string | null;
  title?: string | null;
  hasBusinessEmail?: boolean;
  /** Existing customer accounts score higher — land-and-expand is cheaper. */
  isExistingCustomer?: boolean;
};

export const IDEAL_INDUSTRIES = [
  'Software',
  'Financial Services',
  'Healthcare',
  'Manufacturing',
  'Retail',
  'Telecommunications',
];

export const TARGET_COUNTRIES = ['US', 'CA', 'GB', 'DE', 'FR', 'NL', 'AU', 'SE', 'IE'];

const SENIOR_TITLE_PATTERNS = [
  /chief/i,
  /\bc[teofi]o\b/i,
  /president/i,
  /\bvp\b/i,
  /vice president/i,
  /head of/i,
  /director/i,
];

/** 0-100. Firmographic and role fit against the ideal customer profile. */
export function scoreFit(i: FitInputs): { score: number; detail: string[] } {
  let score = 0;
  const detail: string[] = [];

  const employees = i.employeeCount ?? 0;
  if (employees >= 5000) {
    score += 30;
    detail.push('enterprise headcount (5000+)');
  } else if (employees >= 1000) {
    score += 28;
    detail.push('upper mid-market headcount (1000-4999)');
  } else if (employees >= 250) {
    score += 22;
    detail.push('mid-market headcount (250-999)');
  } else if (employees >= 50) {
    score += 12;
    detail.push('small business headcount (50-249)');
  } else if (employees > 0) {
    score += 4;
    detail.push('below target headcount');
  }

  if (i.industry && IDEAL_INDUSTRIES.includes(i.industry)) {
    score += 20;
    detail.push(`target industry: ${i.industry}`);
  } else if (i.industry) {
    score += 6;
    detail.push(`non-core industry: ${i.industry}`);
  }

  if (i.country && TARGET_COUNTRIES.includes(i.country)) {
    score += 15;
    detail.push(`serviced geography: ${i.country}`);
  } else if (i.country) {
    detail.push(`outside primary coverage: ${i.country}`);
  }

  if (i.title && SENIOR_TITLE_PATTERNS.some((r) => r.test(i.title!))) {
    score += 20;
    detail.push('senior decision-making title');
  } else if (i.title) {
    score += 8;
    detail.push('practitioner-level title');
  }

  if (i.hasBusinessEmail) {
    score += 5;
    detail.push('business email domain');
  } else {
    score -= 5;
    detail.push('free email domain');
  }

  if (i.isExistingCustomer) {
    score += 10;
    detail.push('existing customer account');
  }

  return { score: Math.max(0, Math.min(100, score)), detail };
}

/** Weight each response type contributes to intent or behaviour. */
export const RESPONSE_WEIGHTS: Record<string, number> = {
  demo_request: 30,
  trial_signup: 28,
  intent_surge: 22,
  inbound_call: 20,
  webinar_attendance: 14,
  event_attendance: 14,
  chat: 12,
  outbound_reply: 12,
  partner_referral: 18,
  event_registration: 8,
  content_download: 6,
  form_fill: 5,
};

export type ResponseEvent = {
  type: string;
  occurredAt: IsoDate;
  /** Overrides the default weight for the type. */
  scoreValue?: number;
};

/**
 * Exponential decay with a 30-day half-life. An event's contribution halves each
 * month, so a score reflects current interest rather than accumulated history.
 */
export function decayFactor(occurredAt: IsoDate, asOf: IsoDate, halfLifeDays = 30): number {
  const age = Math.max(0, daysBetween(occurredAt, asOf));
  return Math.pow(0.5, age / halfLifeDays);
}

export function scoreIntent(
  events: ResponseEvent[],
  asOf: IsoDate,
): { score: number; detail: string[] } {
  const intentTypes = new Set([
    'demo_request',
    'trial_signup',
    'intent_surge',
    'inbound_call',
    'chat',
    'partner_referral',
  ]);

  let raw = 0;
  const detail: string[] = [];
  for (const e of events.filter((e) => intentTypes.has(e.type))) {
    const weight = e.scoreValue ?? RESPONSE_WEIGHTS[e.type] ?? 5;
    const decayed = weight * decayFactor(e.occurredAt, asOf);
    raw += decayed;
    if (decayed >= 3) {
      detail.push(`${e.type.replace(/_/g, ' ')} on ${e.occurredAt} (+${decayed.toFixed(0)})`);
    }
  }
  /**
   * Calibration: the raw weights are relative to each other, but a dimension
   * feeding a 0-100 blend has to be able to reach the top of its own range. A
   * fresh demo request plus a trial signup is about the strongest intent signal
   * that exists and should score in the high eighties, not the low fifties —
   * otherwise the dimension can only ever drag the blended score down.
   */
  return { score: Math.min(100, Math.round(raw * INTENT_CALIBRATION)), detail: detail.slice(0, 5) };
}

const INTENT_CALIBRATION = 1.6;
const BEHAVIOURAL_CALIBRATION = 3;

export function scoreBehavioral(
  events: ResponseEvent[],
  asOf: IsoDate,
): { score: number; detail: string[] } {
  const behaviouralTypes = new Set([
    'content_download',
    'form_fill',
    'event_registration',
    'event_attendance',
    'webinar_attendance',
    'outbound_reply',
  ]);

  let raw = 0;
  const detail: string[] = [];
  for (const e of events.filter((e) => behaviouralTypes.has(e.type))) {
    const weight = e.scoreValue ?? RESPONSE_WEIGHTS[e.type] ?? 3;
    raw += weight * decayFactor(e.occurredAt, asOf, 45);
  }
  if (events.length > 0) detail.push(`${events.length} tracked interactions`);
  return { score: Math.min(100, Math.round(raw * BEHAVIOURAL_CALIBRATION)), detail };
}

export type EngagementInputs = {
  emailsOpened?: number;
  emailsClicked?: number;
  meetingsHeld?: number;
  callsConnected?: number;
  lastResponseAt?: IsoDate | null;
  asOf: IsoDate;
};

export function scoreEngagement(i: EngagementInputs): { score: number; detail: string[] } {
  let score = 0;
  const detail: string[] = [];

  score += Math.min(15, (i.emailsOpened ?? 0) * 1.5);
  score += Math.min(25, (i.emailsClicked ?? 0) * 5);
  score += Math.min(35, (i.meetingsHeld ?? 0) * 15);
  score += Math.min(20, (i.callsConnected ?? 0) * 8);

  if (i.meetingsHeld) detail.push(`${i.meetingsHeld} meeting(s) held`);
  if (i.emailsClicked) detail.push(`${i.emailsClicked} email click(s)`);

  if (i.lastResponseAt) {
    const days = daysBetween(i.lastResponseAt, i.asOf);
    if (days <= 7) {
      score += 10;
      detail.push('responded within the last week');
    } else if (days > 60) {
      score -= 15;
      detail.push(`no response for ${days} days`);
    }
  } else {
    score -= 10;
    detail.push('never responded');
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), detail };
}

export type NegativeInputs = {
  unsubscribed?: boolean;
  bouncedEmail?: boolean;
  competitor?: boolean;
  student?: boolean;
  jobSeeker?: boolean;
  disqualifiedPreviously?: boolean;
  doNotCall?: boolean;
  /** Explicit "not now" from the prospect. */
  askedToBeContactedLater?: boolean;
};

/** Returns a positive magnitude that is subtracted from the total. */
export function scoreNegative(i: NegativeInputs): { score: number; detail: string[] } {
  let penalty = 0;
  const detail: string[] = [];
  const add = (n: number, why: string) => {
    penalty += n;
    detail.push(why);
  };

  if (i.unsubscribed) add(40, 'unsubscribed from email');
  if (i.bouncedEmail) add(25, 'email address bounced');
  if (i.competitor) add(60, 'identified as a competitor');
  if (i.student) add(35, 'student or academic enquiry');
  if (i.jobSeeker) add(50, 'job seeker, not a buyer');
  if (i.disqualifiedPreviously) add(20, 'previously disqualified');
  if (i.doNotCall) add(15, 'do-not-call flag set');
  if (i.askedToBeContactedLater) add(10, 'asked to be contacted later');

  return { score: Math.min(100, penalty), detail };
}

export type ScoreResult = {
  fitScore: number;
  intentScore: number;
  engagementScore: number;
  behavioralScore: number;
  negativeScore: number;
  totalScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  isMql: boolean;
  detail: Record<string, string[]>;
};

/**
 * The MQL bar.
 *
 * A calibration constant, not a truth, and it has to match the scale the blended
 * dimensions actually produce. A strong ICP lead with a fresh demo request and a
 * handful of interactions lands in the low fifties under the current weights, so a
 * bar of 50 admits genuinely qualified inbound while still excluding poor-fit or
 * stale records. Marketing and sales should expect to retune this against observed
 * accept rates — that is the point of keeping it in one place.
 */
export const MQL_THRESHOLD = 50;

/**
 * Blends the dimensions into a single 0-100 total and a grade.
 *
 * Fit and intent dominate, because a well-fitting buyer who is actively shopping
 * is worth more than a poorly fitting one who reads everything we publish. The
 * negative score is subtracted last so a disqualifying signal can pull an
 * otherwise strong lead below the MQL line rather than being averaged away.
 */
export function scoreLead(input: {
  fit: FitInputs;
  events: ResponseEvent[];
  engagement: EngagementInputs;
  negative: NegativeInputs;
  asOf: IsoDate;
}): ScoreResult {
  const fit = scoreFit(input.fit);
  const intent = scoreIntent(input.events, input.asOf);
  const engagement = scoreEngagement(input.engagement);
  const behavioral = scoreBehavioral(input.events, input.asOf);
  const negative = scoreNegative(input.negative);

  const weighted =
    fit.score * 0.35 + intent.score * 0.3 + engagement.score * 0.2 + behavioral.score * 0.15;

  const totalScore = Math.max(0, Math.min(100, Math.round(weighted - negative.score)));

  const grade: ScoreResult['grade'] =
    totalScore >= 80 ? 'A' : totalScore >= 60 ? 'B' : totalScore >= 40 ? 'C' : totalScore >= 20 ? 'D' : 'F';

  return {
    fitScore: fit.score,
    intentScore: intent.score,
    engagementScore: engagement.score,
    behavioralScore: behavioral.score,
    negativeScore: negative.score,
    totalScore,
    grade,
    isMql: totalScore >= MQL_THRESHOLD && negative.score < 30,
    detail: {
      fit: fit.detail,
      intent: intent.detail,
      engagement: engagement.detail,
      behavioral: behavioral.detail,
      negative: negative.detail,
    },
  };
}

/**
 * Applies decay to a stored score without recomputing from raw events. Used by
 * the nightly job so scores fall on their own if nothing new arrives.
 */
export function decayStoredScore(
  score: number,
  lastActivityAt: IsoDate,
  asOf: IsoDate,
  halfLifeDays = 45,
): number {
  return Math.round(score * decayFactor(lastActivityAt, asOf, halfLifeDays));
}

/**
 * Contact scoring. Deliberately shares the lead engine: a known contact should be
 * able to enter a sales workflow on its own merits without a duplicate lead
 * record being manufactured for it.
 */
export function scoreContact(input: {
  fit: FitInputs;
  events: ResponseEvent[];
  engagement: EngagementInputs;
  negative: NegativeInputs;
  asOf: IsoDate;
}): ScoreResult {
  return scoreLead(input);
}
