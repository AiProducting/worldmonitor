import type {
    ServerContext,
    DeductSituationRequest,
    DeductSituationResponse,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { cachedFetchJson, getCachedJson } from '../../../_shared/redis';
import { sha256Hex } from './_shared';
import { callLlmReasoning } from '../../../_shared/llm';
import { sanitizeHeadline } from '../../../_shared/llm-sanitize.js';
import { buildDeductionPrompt, postProcessDeductionOutput } from './deduction-prompt';
import { isCallerPremium } from '../../../_shared/premium-check';

const PREDICTION_BOOTSTRAP_KEY = 'prediction:markets-bootstrap:v1';
const MAX_PREDICTION_MARKETS = 7;

interface PredictionMarketRaw {
  title: string;
  yesPrice: number;
  volume: number;
  source?: string;
}

interface PredictionBootstrap {
  geopolitical?: PredictionMarketRaw[];
  tech?: PredictionMarketRaw[];
  finance?: PredictionMarketRaw[];
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

function buildPredictionContext(query: string, bootstrap: PredictionBootstrap): string {
  const allMarkets = [
    ...(bootstrap.geopolitical ?? []),
    ...(bootstrap.tech ?? []),
    ...(bootstrap.finance ?? []),
  ];
  if (!allMarkets.length) return '';

  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 1);

  const scored = allMarkets.map((m) => ({
    market: m,
    score: words.length
      ? words.filter((w) => typeof m.title === 'string' && m.title.toLowerCase().includes(w)).length
      : 0,
  }));

  const matched = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.market.volume - a.market.volume)
    .slice(0, MAX_PREDICTION_MARKETS)
    .map(({ market }) => market);

  if (!matched.length) return '';

  const lines = matched.map((m) => {
    const title = sanitizeHeadline(m.title);
    if (!title) return null;
    const pct = Math.round(m.yesPrice / 5) * 5;
    const vol = formatVolume(m.volume);
    return `- "${title}" — Yes ${pct}% (${vol} volume)`;
  }).filter((l): l is string => l !== null);

  if (!lines.length) return '';
  return `## Prediction Market Odds (crowd-calibrated)\n${lines.join('\n')}`;
}

const DEDUCT_TIMEOUT_MS = 120_000;
const DEDUCT_CACHE_TTL = 3600;
const DEFAULT_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

export async function deductSituation(
    ctx: ServerContext,
    req: DeductSituationRequest,
): Promise<DeductSituationResponse> {
    const apiKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
    const apiUrl = process.env.LLM_API_URL || DEFAULT_API_URL;
    const model = process.env.LLM_MODEL || DEFAULT_MODEL;

    if (!apiKey) {
        return { analysis: '', model: '', provider: 'skipped' };
    }

    const MAX_QUERY_LEN = 500;
    const MAX_GEO_LEN = 2000;
    const MAX_FRAMEWORK_LEN = 2000;

    const query = typeof req.query === 'string' ? req.query.slice(0, MAX_QUERY_LEN).trim() : '';
    const geoContext = typeof req.geoContext === 'string' ? req.geoContext.slice(0, MAX_GEO_LEN).trim() : '';
    const isPremium = await isCallerPremium(ctx.request);
    const framework = isPremium && typeof req.framework === 'string' ? req.framework.slice(0, MAX_FRAMEWORK_LEN) : '';

    if (!query) return { analysis: '', model: '', provider: 'skipped' };

    const [queryHash, frameworkHashFull, predictionBootstrap] = await Promise.all([
        sha256Hex(query.toLowerCase() + '|' + geoContext.toLowerCase()),
        framework ? sha256Hex(framework) : Promise.resolve(''),
        getCachedJson(PREDICTION_BOOTSTRAP_KEY, true).catch(() => null),
    ]);
    const frameworkHash = framework ? frameworkHashFull.slice(0, 8) : '';

    const predictionContext = predictionBootstrap
        ? buildPredictionContext(query, predictionBootstrap as PredictionBootstrap)
        : '';

    const predictionHash = predictionContext ? (await sha256Hex(predictionContext)).slice(0, 8) : '';
    const cacheKey = `deduct:situation:v2:${queryHash.slice(0, 16)}${frameworkHash ? ':fw' + frameworkHash : ''}${predictionHash ? ':pm' + predictionHash : ''}`;

    const { mode, systemPrompt, userPrompt } = buildDeductionPrompt({ query, geoContext, predictionContext });

    const cached = await cachedFetchJson<{ analysis: string; model: string; provider: string }>(
        cacheKey,
        DEDUCT_CACHE_TTL,
        async () => {
            const result = await callLlmReasoning({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.3,
                maxTokens: 1500,
                timeoutMs: DEDUCT_TIMEOUT_MS,
                systemAppend: framework || undefined,
            });

                let userPrompt = query;
                if (geoContext) {
                    userPrompt += `\n\n### Current Intelligence Context\n${geoContext}`;
                }

                const resp = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'User-Agent': CHROME_UA
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt },
                        ],
                        temperature: 0.3,
                        max_tokens: 1500,
                    }),
                    signal: AbortSignal.timeout(DEDUCT_TIMEOUT_MS),
                });

                if (!resp.ok) return null;
                const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
                const firstChoice = data.choices?.[0];

                const content = firstChoice?.message?.content?.trim();
                const reasoning = (firstChoice?.message as any)?.reasoning?.trim();

                let raw = content || reasoning;
                if (!raw) return null;

                raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

                return { analysis: raw, model, provider: 'groq' };
            } catch (err) {
                console.error('[DeductSituation] Error calling LLM:', err);
                return null;
            }
        }
    );

    if (!cached?.analysis) {
        return { analysis: '', model: '', provider: 'error' };
    }

    return {
        analysis: cached.analysis,
        model: cached.model,
        provider: cached.provider,
    };
}
