/**
 * Per-event provider detection from ICS VEVENT fields.
 *
 * Unlike the file-level detector (ics-provider-detector.ts) which reads PRODID and
 * calendar-level metadata, this module examines each individual event's fields:
 * LOCATION, DESCRIPTION, CATEGORIES, ORGANIZER, SUMMARY.
 *
 * Signals are weaker than file-level; use in combination with the global detection.
 * Returns a confidence level so the caller can decide whether to trust the result.
 */

import type { IcsEvent } from './ics-parser';
import type { DetectionConfidence, ProviderDetectionResult } from './ics-provider-detector';

type CandidateId = 'myges' | 'myefrei' | 'ensup';

interface ScoredSignal {
  pattern: RegExp;
  provider: CandidateId;
  points: number;
  reason: string;
}

// Room/location patterns indicating a provider.
const LOCATION_SIGNALS: ScoredSignal[] = [
  // EFREI campus
  { pattern: /\befrei\b/i, provider: 'myefrei', points: 8, reason: 'Location contains "efrei"' },
  { pattern: /\bvillejuif\b/i, provider: 'myefrei', points: 4, reason: 'Location contains "Villejuif" (EFREI campus)' },
  // GES school network
  { pattern: /\bges\b/i, provider: 'myges', points: 8, reason: 'Location contains "ges"' },
  // HyperPlanning (ENSUP): tends to use amphi names and short room codes
  { pattern: /\bamphi\b/i, provider: 'ensup', points: 3, reason: 'Location contains "amphi" (HyperPlanning style)' },
  { pattern: /\bhyperplanning\b/i, provider: 'ensup', points: 8, reason: 'Location mentions HyperPlanning' },
];

// DESCRIPTION content patterns.
const DESCRIPTION_SIGNALS: ScoredSignal[] = [
  // MyEfrei structured description format
  { pattern: /code\s*module\s*:/i, provider: 'myefrei', points: 8, reason: 'Description has MyEfrei "Code module:"' },
  { pattern: /enseignant\(s\)\s*:/i, provider: 'myefrei', points: 8, reason: 'Description has MyEfrei "Enseignant(s):"' },
  { pattern: /\bcontenus\s*:/i, provider: 'myefrei', points: 5, reason: 'Description has MyEfrei "Contenus:"' },
  // HyperPlanning (ENSUP) structured description
  { pattern: /ressource\s*:/i, provider: 'ensup', points: 6, reason: 'Description has HyperPlanning "Ressource:"' },
  { pattern: /hyperplanning/i, provider: 'ensup', points: 10, reason: 'Description mentions HyperPlanning' },
  { pattern: /\bensup\b/i, provider: 'ensup', points: 6, reason: 'Description mentions ENSUP' },
  // MyGES structured description (from parseStructuredDescription)
  { pattern: /\b(tp|td|cm)\s*:\s*[\d.,]+h/i, provider: 'myges', points: 6, reason: 'Description has MyGES TP/TD/CM hour format' },
  { pattern: /\bges\.fr\b/i, provider: 'myges', points: 8, reason: 'Description mentions ges.fr' },
  { pattern: /\bmyges\b/i, provider: 'myges', points: 8, reason: 'Description mentions myGES' },
];

// CATEGORIES field patterns.
const CATEGORIES_SIGNALS: ScoredSignal[] = [
  { pattern: /\bhyperplanning\b/i, provider: 'ensup', points: 8, reason: 'CATEGORIES contains "hyperplanning"' },
  { pattern: /\bensup\b/i, provider: 'ensup', points: 6, reason: 'CATEGORIES contains "ensup"' },
  { pattern: /\befrei\b/i, provider: 'myefrei', points: 6, reason: 'CATEGORIES contains "efrei"' },
  { pattern: /\bmyefrei\b/i, provider: 'myefrei', points: 8, reason: 'CATEGORIES contains "myefrei"' },
  { pattern: /\bges\b/i, provider: 'myges', points: 6, reason: 'CATEGORIES contains "ges"' },
  { pattern: /\bmyges\b/i, provider: 'myges', points: 8, reason: 'CATEGORIES contains "myges"' },
];

// SUMMARY/TITLE patterns (weaker signal — titles are provider-agnostic in most cases).
const SUMMARY_SIGNALS: ScoredSignal[] = [
  { pattern: /\bhyperplanning\b/i, provider: 'ensup', points: 5, reason: 'Summary mentions HyperPlanning' },
  { pattern: /\bges\b/i, provider: 'myges', points: 3, reason: 'Summary contains "ges"' },
  { pattern: /\befrei\b/i, provider: 'myefrei', points: 3, reason: 'Summary contains "efrei"' },
];

function applySignals(text: string, signals: ScoredSignal[], candidates: Record<CandidateId, { score: number; reasons: string[] }>) {
  for (const signal of signals) {
    if (signal.pattern.test(text)) {
      candidates[signal.provider].score += signal.points;
      candidates[signal.provider].reasons.push(signal.reason);
    }
  }
}

/**
 * Detect the likely academic provider from a single parsed ICS event.
 *
 * Returns `provider: 'generic'` with `confidence: 'none'` when no signal is found.
 * Never returns a provider with low confidence if the margin over the second candidate is < 2.
 */
export function detectProviderFromEvent(event: IcsEvent): ProviderDetectionResult {
  const candidates: Record<CandidateId, { score: number; reasons: string[] }> = {
    myges: { score: 0, reasons: [] },
    myefrei: { score: 0, reasons: [] },
    ensup: { score: 0, reasons: [] },
  };

  // LOCATION
  if (event.location) {
    applySignals(event.location, LOCATION_SIGNALS, candidates);
  }

  // DESCRIPTION
  if (event.description) {
    applySignals(event.description, DESCRIPTION_SIGNALS, candidates);
  }

  // CATEGORIES (join into a single string for regex matching)
  if (event.categories.length > 0) {
    applySignals(event.categories.join(','), CATEGORIES_SIGNALS, candidates);
  }

  // SUMMARY / title (weak signals only)
  if (event.summary) {
    applySignals(event.summary, SUMMARY_SIGNALS, candidates);
  }

  // ORGANIZER domain
  if (event.organizer) {
    const org = event.organizer.toLowerCase();
    if (org.includes('efrei.fr')) {
      candidates.myefrei.score += 8;
      candidates.myefrei.reasons.push('ORGANIZER domain is efrei.fr');
    }
    if (org.includes('myges.fr') || org.includes('ges.fr')) {
      candidates.myges.score += 8;
      candidates.myges.reasons.push('ORGANIZER domain is myges.fr / ges.fr');
    }
  }

  // X-* custom fields stored in raw
  const rawEntries = Object.entries(event.raw);
  for (const [key, value] of rawEntries) {
    const k = key.toLowerCase();
    const v = value.toLowerCase();
    if (k.startsWith('x-wr') || k.startsWith('x-hp') || k.startsWith('x-hyperplanning')) {
      candidates.ensup.score += 4;
      candidates.ensup.reasons.push(`Custom field ${key} suggests HyperPlanning`);
      break;
    }
    if (k.startsWith('x-ges') || v.includes('myges') || v.includes('ges.fr')) {
      candidates.myges.score += 4;
      candidates.myges.reasons.push(`Custom field ${key} suggests MyGES`);
      break;
    }
    if (k.startsWith('x-efrei') || v.includes('efrei.fr')) {
      candidates.myefrei.score += 4;
      candidates.myefrei.reasons.push(`Custom field ${key} suggests MyEfrei`);
      break;
    }
  }

  // Rank candidates
  const sorted = (
    Object.entries(candidates) as [CandidateId, { score: number; reasons: string[] }][]
  ).sort(([, a], [, b]) => b.score - a.score);

  const best = sorted[0];
  const secondBest = sorted[1];

  if (!best) {
    return { provider: 'generic', confidence: 'none', reason: 'No candidates' };
  }

  const [bestId, bestData] = best;

  if (bestData.score === 0) {
    return {
      provider: 'generic',
      confidence: 'none',
      reason: 'No per-event provider signals found',
    };
  }

  const secondScore = secondBest ? secondBest[1].score : 0;
  const margin = bestData.score - secondScore;
  let confidence: DetectionConfidence;

  if (bestData.score >= 8 && margin >= 5) {
    confidence = 'high';
  } else if (bestData.score >= 5 && margin >= 3) {
    confidence = 'medium';
  } else if (margin >= 2) {
    confidence = 'low';
  } else {
    // Ambiguous — don't claim a provider
    return {
      provider: 'generic',
      confidence: 'none',
      reason: `Ambiguous: ${bestId} (${bestData.score}) vs ${secondBest?.[0] ?? '?'} (${secondScore})`,
    };
  }

  return {
    provider: bestId,
    confidence,
    reason: bestData.reasons.join('; '),
  };
}
