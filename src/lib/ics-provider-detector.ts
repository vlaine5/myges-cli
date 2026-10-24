/**
 * Heuristic detection of academic provider from raw ICS content.
 *
 * Strategy:
 * 1. Parse top-level VCALENDAR properties (PRODID, X-WR-CALNAME, X-WR-CALDESC)
 * 2. Scan first VEVENT for provider-specific patterns in CATEGORIES, DESCRIPTION, LOCATION
 * 3. Accumulate a confidence score per candidate provider
 * 4. Return the best match if confidence threshold is met, else 'none'
 *
 * Confidence levels:
 * - 'high': a definitive signal (PRODID contains exact product name, or X-WR-CALNAME exact match)
 * - 'medium': several corroborating signals
 * - 'low': a single weak signal
 * - 'none': no recognizable signal
 */

import type { AcademicProviderId } from '../modules/events/types';

export type DetectionConfidence = 'high' | 'medium' | 'low' | 'none';

export interface ProviderDetectionResult {
  provider: AcademicProviderId | 'generic';
  confidence: DetectionConfidence;
  reason: string;
}

type CandidateId = Exclude<AcademicProviderId, 'generic'>;

interface Candidate {
  id: CandidateId;
  score: number;
  reasons: string[];
}

/** Extract value of a VCALENDAR-level property from raw ICS text */
function extractCalProperty(content: string, prop: string): string | null {
  // Match the property before the first VEVENT (only calendar-level props)
  const veventIdx = content.indexOf('BEGIN:VEVENT');
  const header = veventIdx >= 0 ? content.slice(0, veventIdx) : content;
  // Unfold lines (CRLF + whitespace = continuation)
  const unfolded = header.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '\n');
  const regex = new RegExp(`^${prop}[;:]([^\n]+)`, 'im');
  const match = unfolded.match(regex);
  return match?.[1]?.trim() ?? null;
}

/** Extract text content of first N VEVENT fields */
function extractFirstVEventFields(content: string, fields: string[]): Record<string, string> {
  const startIdx = content.indexOf('BEGIN:VEVENT');
  const endIdx = content.indexOf('END:VEVENT');
  if (startIdx === -1 || endIdx === -1) return {};

  const vevent = content.slice(startIdx, endIdx);
  const unfolded = vevent.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '\n');
  const result: Record<string, string> = {};

  for (const field of fields) {
    const regex = new RegExp(`^${field}[;:]([^\n]+)`, 'im');
    const match = unfolded.match(regex);
    const val = match?.[1]?.trim().toLowerCase();
    if (val !== undefined) {
      result[field] = val;
    }
  }

  return result;
}

function lower(value: string | null): string {
  return value?.toLowerCase() ?? '';
}

/**
 * Detect the likely academic provider from raw ICS content.
 * Returns provider + confidence + human-readable reason.
 */
export function detectProviderFromIcs(content: string): ProviderDetectionResult {
  const candidates: Record<CandidateId, Candidate> = {
    myges: { id: 'myges', score: 0, reasons: [] },
    myefrei: { id: 'myefrei', score: 0, reasons: [] },
    ensup: { id: 'ensup', score: 0, reasons: [] },
  };

  function add(id: CandidateId, points: number, reason: string) {
    candidates[id].score += points;
    candidates[id].reasons.push(reason);
  }

  // ── PRODID ─────────────────────────────────────────────────────────────
  const prodid = lower(extractCalProperty(content, 'PRODID'));
  if (prodid) {
    if (prodid.includes('hyperplanning') || prodid.includes('hyper planning')) {
      add('ensup', 10, `PRODID contains "hyperplanning": ${prodid}`);
    }
    if (prodid.includes('efrei')) {
      add('myefrei', 10, `PRODID contains "efrei": ${prodid}`);
    }
    if (prodid.includes('myges') || prodid.includes('ges-informatique') || prodid.includes('ges.fr')) {
      add('myges', 10, `PRODID contains GES marker: ${prodid}`);
    }
  }

  // ── X-WR-CALNAME ───────────────────────────────────────────────────────
  const calname = lower(extractCalProperty(content, 'X-WR-CALNAME'));
  if (calname) {
    if (calname.includes('hyperplanning') || calname.includes('ensup') || calname.includes('sup') || calname.includes('hyper')) {
      add('ensup', 5, `X-WR-CALNAME contains school marker: ${calname}`);
    }
    if (calname.includes('efrei') || calname.includes('myefrei')) {
      add('myefrei', 8, `X-WR-CALNAME contains "efrei": ${calname}`);
    }
    if (calname.includes('myges') || calname.includes('ges')) {
      add('myges', 8, `X-WR-CALNAME contains "ges": ${calname}`);
    }
  }

  // ── X-WR-CALDESC ───────────────────────────────────────────────────────
  const caldesc = lower(extractCalProperty(content, 'X-WR-CALDESC'));
  if (caldesc) {
    if (caldesc.includes('efrei')) add('myefrei', 3, `X-WR-CALDESC mentions efrei`);
    if (caldesc.includes('ges')) add('myges', 3, `X-WR-CALDESC mentions ges`);
    if (caldesc.includes('hyperplanning') || caldesc.includes('ensup')) {
      add('ensup', 3, `X-WR-CALDESC mentions ensup/hyperplanning`);
    }
  }

  // ── First VEVENT fields ─────────────────────────────────────────────────
  const veventFields = extractFirstVEventFields(content, [
    'CATEGORIES', 'DESCRIPTION', 'LOCATION', 'ORGANIZER', 'URL', 'COMMENT',
  ]);

  const categories = veventFields['CATEGORIES'] ?? '';
  if (categories.includes('hyperplanning')) {
    add('ensup', 8, `CATEGORIES contains "hyperplanning"`);
  }
  if (categories.includes('efrei')) {
    add('myefrei', 5, `CATEGORIES contains "efrei"`);
  }
  if (categories.includes('myges') || categories.includes('ges')) {
    add('myges', 5, `CATEGORIES contains "ges"`);
  }

  const organizer = veventFields['ORGANIZER'] ?? '';
  if (organizer.includes('efrei.fr')) add('myefrei', 8, `ORGANIZER domain is efrei.fr`);
  if (organizer.includes('myges.fr') || organizer.includes('ges.fr')) add('myges', 8, `ORGANIZER domain is ges/myges`);

  const url = veventFields['URL'] ?? '';
  if (url.includes('efrei.fr') || url.includes('myefrei')) add('myefrei', 6, `URL contains efrei domain`);
  if (url.includes('myges.fr') || url.includes('ges.fr')) add('myges', 6, `URL contains myges domain`);

  const description = veventFields['DESCRIPTION'] ?? '';
  // MyEfrei structured descriptions have specific patterns
  if (description.includes('code module') || description.includes('enseignant(s)')) {
    add('myefrei', 4, `DESCRIPTION has myEfrei structured format`);
  }
  // HyperPlanning has specific room/resource format
  if (description.includes('hyperplanning') || description.includes('ressource')) {
    add('ensup', 3, `DESCRIPTION has HyperPlanning markers`);
  }

  // ── Find best candidate ─────────────────────────────────────────────────
  const sorted = Object.values(candidates).sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const secondBest = sorted[1];

  // Require a minimum score to claim a provider
  if (!best || best.score === 0) {
    return {
      provider: 'generic' as const,
      confidence: 'none' as const,
      reason: 'No provider-specific signals found in ICS metadata',
    };
  }

  // Confidence based on score and margin over second-best
  let confidence: DetectionConfidence;
  const margin = best.score - (secondBest?.score ?? 0);

  if (best.score >= 10 && margin >= 5) {
    confidence = 'high';
  } else if (best.score >= 5 && margin >= 3) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    provider: best.id,
    confidence,
    reason: best.reasons.join('; '),
  };
}
