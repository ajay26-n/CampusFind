import { LostFoundItem } from '@/types/item';

export interface MatchSuggestion {
  item: LostFoundItem;
  score: number;
  confidence: 'High Match' | 'Moderate Match' | 'Potential Match';
  reasons: string[];
}

export interface MatchOptions {
  minScore?: number;
  maxResults?: number;
}

// Common generic words to filter out during tokenization
const STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'this', 'that', 'from', 'have', 'has', 'had',
  'item', 'lost', 'found', 'please', 'call', 'left', 'desk', 'near', 'about',
  'some', 'very', 'been', 'were', 'will', 'would', 'could', 'should', 'there',
  'here', 'when', 'where', 'which', 'who', 'whom', 'whose', 'what', 'why',
  'into', 'onto', 'over', 'under', 'between', 'during', 'before', 'after',
  'campus', 'college', 'student', 'anyone', 'contact', 'report', 'reported',
  'color', 'type', 'good', 'condition', 'room', 'floor', 'hall', 'area',
]);

/**
 * Normalizes and extracts meaningful word tokens from text.
 */
function tokenize(text?: string | null): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Calculates location similarity points (up to 25 points).
 */
function scoreLocation(targetLoc: string, candidateLoc: string): { points: number; reason?: string } {
  const t = (targetLoc || '').trim().toLowerCase();
  const c = (candidateLoc || '').trim().toLowerCase();

  if (!t || !c) return { points: 0 };

  // Exact match
  if (t === c) {
    return { points: 25, reason: `Matching Location (${candidateLoc.trim()})` };
  }

  // Substring containment (e.g. "Library 2nd Fl" vs "Library")
  if (t.includes(c) || c.includes(t)) {
    return { points: 20, reason: `Nearby Location (${candidateLoc.trim()})` };
  }

  // Token overlap (e.g., both mention "library" or "auditorium" or "cafeteria")
  const tTokens = tokenize(t);
  const cTokens = tokenize(c);
  const sharedTokens = tTokens.filter((token) => cTokens.includes(token));

  if (sharedTokens.length > 0) {
    return {
      points: Math.min(20, 12 + sharedTokens.length * 4),
      reason: `Shared Location (${sharedTokens.join(', ')})`,
    };
  }

  return { points: 0 };
}

/**
 * Calculates title and description keyword overlap (up to 25 points).
 */
function scoreKeywords(
  target: LostFoundItem,
  candidate: LostFoundItem
): { points: number; keywords: string[] } {
  const targetTitleTokens = tokenize(target.title);
  const targetDescTokens = tokenize(target.description);
  const candTitleTokens = tokenize(candidate.title);
  const candDescTokens = tokenize(candidate.description);

  // Title-to-title overlap is a very strong signal
  const titleOverlap = targetTitleTokens.filter((tok) => candTitleTokens.includes(tok));
  // Title-to-description overlap
  const titleDescOverlap = targetTitleTokens.filter((tok) => candDescTokens.includes(tok));
  // Description-to-description overlap
  const descOverlap = targetDescTokens.filter((tok) => candDescTokens.includes(tok));

  const allShared = Array.from(new Set([...titleOverlap, ...titleDescOverlap, ...descOverlap]));

  if (allShared.length === 0) {
    return { points: 0, keywords: [] };
  }

  let points = 0;
  // Strong boost for title keyword matches
  if (titleOverlap.length > 0) {
    points += Math.min(18, 10 + titleOverlap.length * 4);
  } else if (titleDescOverlap.length > 0) {
    points += Math.min(14, 8 + titleDescOverlap.length * 3);
  }

  // Additional points for general description token matches
  points += Math.min(10, descOverlap.length * 2.5);

  return {
    points: Math.min(25, Math.round(points)),
    keywords: allShared.slice(0, 3),
  };
}

/**
 * Calculates date proximity points (up to 10 points).
 * Handles string formats ("Today", "Yesterday", ISO dates, custom strings).
 */
function scoreDateProximity(targetDate: string, candidateDate: string): { points: number; reason?: string } {
  const t = (targetDate || '').trim().toLowerCase();
  const c = (candidateDate || '').trim().toLowerCase();

  if (!t || !c) return { points: 0 };

  // Quick text matching for relative day stamps
  if (t.includes('today') && c.includes('today')) {
    return { points: 10, reason: 'Both reported today' };
  }
  if (
    (t.includes('today') && c.includes('yesterday')) ||
    (t.includes('yesterday') && c.includes('today'))
  ) {
    return { points: 8, reason: 'Reported within 24–48 hours' };
  }

  // Attempt timestamp parsing
  const tTime = Date.parse(targetDate);
  const cTime = Date.parse(candidateDate);

  if (!isNaN(tTime) && !isNaN(cTime)) {
    const diffHours = Math.abs(tTime - cTime) / (1000 * 60 * 60);
    if (diffHours <= 24) {
      return { points: 10, reason: 'Reported within 24 hours' };
    }
    if (diffHours <= 72) {
      return { points: 7, reason: 'Reported within 3 days' };
    }
    if (diffHours <= 168) {
      return { points: 4, reason: 'Reported within 1 week' };
    }
  }

  return { points: 0 };
}

/**
 * Discovers potential Lost ↔ Found matching suggestions using transparent heuristic scoring.
 *
 * Scoring breakdown (Max 100 points):
 * - Exact category match: 40 points
 * - Location similarity: up to 25 points
 * - Title & description keyword overlap: up to 25 points
 * - Date proximity: up to 10 points
 *
 * Safety rules:
 * - Excludes the current item itself.
 * - Only compares Lost ↔ Found (never Lost ↔ Lost or Found ↔ Found).
 * - Excludes 'resolved' and 'archived' items.
 * - Results are labeled as unverified suggestions.
 */
export function findMatchSuggestions(
  targetItem: LostFoundItem,
  candidatePool: LostFoundItem[],
  options?: MatchOptions
): MatchSuggestion[] {
  if (!targetItem || !Array.isArray(candidatePool)) {
    return [];
  }

  const minScore = options?.minScore ?? 30;
  const maxResults = options?.maxResults ?? 4;
  const targetType = targetItem.type;

  const suggestions: MatchSuggestion[] = [];

  for (const candidate of candidatePool) {
    // 1. Exclude the target item itself
    if (candidate.id === targetItem.id) {
      continue;
    }

    // 2. Strict Lost ↔ Found exclusivity
    if (candidate.type === targetType) {
      continue;
    }

    // 3. Exclude resolved or archived candidates
    if (candidate.status === 'resolved' || (candidate.status as string) === 'archived') {
      continue;
    }

    let score = 0;
    const reasons: string[] = [];

    // Factor 1: Exact category match (40 points)
    if (targetItem.category && candidate.category && targetItem.category === candidate.category) {
      score += 40;
      reasons.push(`Same Category (${targetItem.category})`);
    }

    // Factor 2: Location similarity (up to 25 points)
    const locResult = scoreLocation(targetItem.location, candidate.location);
    if (locResult.points > 0) {
      score += locResult.points;
      if (locResult.reason) reasons.push(locResult.reason);
    }

    // Factor 3: Title and description keyword overlap (up to 25 points)
    const kwResult = scoreKeywords(targetItem, candidate);
    if (kwResult.points > 0) {
      score += kwResult.points;
      if (kwResult.keywords.length > 0) {
        reasons.push(`Keywords: ${kwResult.keywords.join(', ')}`);
      }
    }

    // Factor 4: Date proximity (up to 10 points)
    const dateResult = scoreDateProximity(targetItem.date, candidate.date);
    if (dateResult.points > 0) {
      score += dateResult.points;
      if (dateResult.reason) reasons.push(dateResult.reason);
    }

    // Ensure score does not exceed 100
    const finalScore = Math.min(100, Math.round(score));

    // Threshold check
    if (finalScore >= minScore) {
      let confidence: 'High Match' | 'Moderate Match' | 'Potential Match' = 'Potential Match';
      if (finalScore >= 70) {
        confidence = 'High Match';
      } else if (finalScore >= 45) {
        confidence = 'Moderate Match';
      }

      suggestions.push({
        item: candidate,
        score: finalScore,
        confidence,
        reasons,
      });
    }
  }

  // Sort candidates by score descending
  suggestions.sort((a, b) => b.score - a.score);

  return suggestions.slice(0, maxResults);
}
