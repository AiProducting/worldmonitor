import type {
  ServerContext,
  ClassifyEventRequest,
  ClassifyEventResponse,
  SeverityLevel,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { cachedFetchJson } from '../../../_shared/redis';
import { markNoCacheResponse } from '../../../_shared/response-headers';
import { UPSTREAM_TIMEOUT_MS, GROQ_API_URL, GROQ_MODEL, buildClassifyCacheKey } from './_shared';
import { CHROME_UA } from '../../../_shared/constants';
import { isProviderAvailable } from '../../../_shared/llm-health';

// ========================================================================
// Constants
// ========================================================================

const CLASSIFY_CACHE_TTL = 86400;
const VALID_LEVELS = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_CATEGORIES = [
  'conflict', 'protest', 'disaster', 'diplomatic', 'economic',
  'terrorism', 'cyber', 'health', 'environmental', 'military',
  'crime', 'infrastructure', 'tech', 'general',
];

// ========================================================================
// Helpers
// ========================================================================

function mapLevelToSeverity(level: string): SeverityLevel {
  if (level === 'critical' || level === 'high') return 'SEVERITY_LEVEL_HIGH';
  if (level === 'medium') return 'SEVERITY_LEVEL_MEDIUM';
  return 'SEVERITY_LEVEL_LOW';
}

// ========================================================================
// RPC handler
// ========================================================================

export async function classifyEvent(
  ctx: ServerContext,
  req: ClassifyEventRequest,
): Promise<ClassifyEventResponse> {
  const apiKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
  if (!apiKey) { markNoCacheResponse(ctx.request); return { classification: undefined }; }

  // Input sanitization (M-14 fix): limit title length
  const MAX_TITLE_LEN = 500;
  const title = typeof req.title === 'string' ? req.title.slice(0, MAX_TITLE_LEN) : '';
  if (!title) { markNoCacheResponse(ctx.request); return { classification: undefined }; }

  const apiUrl = process.env.LLM_API_URL || GROQ_API_URL;
  const model = process.env.LLM_MODEL || GROQ_MODEL;

  const cacheKey = await buildClassifyCacheKey(title);

  let cached: { level: string; category: string; timestamp: number } | null = null;
  try {
    cached = await cachedFetchJson<{ level: string; category: string; timestamp: number }>(
      cacheKey,
      CLASSIFY_CACHE_TTL,
      async () => {
        // Health gate inside fetcher — only runs on cache miss
        if (!(await isProviderAvailable(apiUrl))) return null;
        try {
          const systemPrompt = `You classify news headlines into threat level and category. Return ONLY valid JSON, no other text.

Levels: critical, high, medium, low, info
Categories: conflict, protest, disaster, diplomatic, economic, terrorism, cyber, health, environmental, military, crime, infrastructure, tech, general

Guidelines for LEVEL assignment (geopolitical scope required for critical):
- critical: Active military strikes with international implications, geopolitical mass-casualty events (10+ killed in conflict/terrorism/state action), ceasefire agreements/collapses, nuclear incidents, pandemic declarations, coups, strait/waterway closures
- high: Armed conflict updates, major diplomatic actions, sanctions packages, significant natural disasters, blockades, terrorist attacks, domestic mass-casualty events (mass shootings, industrial disasters)
- medium: Ongoing conflict analysis, economic impact reports, protest movements, regional policy changes, military exercises
- low: Diplomatic meetings, trade discussions, humanitarian aid, election updates, peacekeeping deployments
- info: Opinion/editorial pieces, analysis/explainer articles, historical retrospectives, lifestyle, entertainment, routine local news, tutorials

Key distinction: "critical" requires GEOPOLITICAL scope — events that destabilize international order, threaten cross-border security, or disrupt global systems. Domestic tragedies are "high" unless they trigger international diplomatic responses.
- "8 children killed in mass shooting in Louisiana" → domestic mass-casualty → high
- "23 killed in fireworks factory explosion" → industrial accident → high
- "700 killed in Sudan drone strikes" → geopolitical mass-casualty → critical
- "Iran closes Strait of Hormuz" → global trade disruption → critical
- "Man killed his estranged wife" → domestic crime → info
- "How to Crack the SAM Database" → tutorial → info

Focus: geopolitical events, conflicts, disasters, diplomacy.
Classify by real-world event severity, not headline sentiment.

Return: {"level":"...","category":"..."}`;

          const resp = await fetch(apiUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': CHROME_UA },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: title },
              ],
              temperature: 0,
              max_tokens: 50,
            }),
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          });

        const result = await callLlm({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: title },
          ],
          temperature: 0,
          maxTokens: 50,
          timeoutMs: UPSTREAM_TIMEOUT_MS,
          stage: 'classify-event',
          validate: (content) => {
            try {
              parsed = JSON.parse(jsonMatch[0]);
            } catch {
              return null;
            }
          }

          const level = VALID_LEVELS.includes(parsed.level ?? '') ? parsed.level! : null;
          const category = VALID_CATEGORIES.includes(parsed.category ?? '') ? parsed.category! : null;
          if (!level || !category) return null;

          return { level, category, timestamp: Date.now() };
        } catch {
          return null;
        }
      },
    );
  } catch {
    markNoCacheResponse(ctx.request);
    return { classification: undefined };
  }

  if (!cached?.level || !cached?.category) { markNoCacheResponse(ctx.request); return { classification: undefined }; }

  return {
    classification: {
      category: cached.category,
      subcategory: cached.level,
      severity: mapLevelToSeverity(cached.level),
      confidence: 0.9,
      analysis: '',
      entities: [],
    },
  };
}
