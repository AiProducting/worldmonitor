/**
 * RPC: listArxivPapers
 *
 * Fetches papers from the arXiv Atom XML API, parsed via fast-xml-parser.
 * Returns empty array on any failure (graceful degradation).
 */

import { XMLParser } from 'fast-xml-parser';
import { CHROME_UA, clampInt } from '../../../_shared/constants';
import { cachedFetchJson } from '../../../_shared/redis';

const REDIS_CACHE_KEY = 'research:arxiv:v1';
const REDIS_CACHE_TTL = 3600; // 1 hr — daily arXiv updates
import type {
  ServerContext,
  ListArxivPapersRequest,
  ListArxivPapersResponse,
  ArxivPaper,
} from '../../../../src/generated/server/worldmonitor/research/v1/service_server';

import { ValidationError } from '../../../../src/generated/server/worldmonitor/research/v1/service_server';
import trackedCategories from '../../../../scripts/shared/research-arxiv-categories.json';
import { resolvePageSize } from '../../../_shared/constants';
import { getCachedJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';

const xmlParser = new XMLParser({
  ignoreAttributes: false, // CRITICAL: arXiv uses attributes for category term, link href/rel
  attributeNamePrefix: '@_',
  isArray: (_name: string, jpath: string) =>
    /\.(entry|author|category|link)$/.test(jpath),
});

// ---------- Fetch ----------

async function fetchArxivPapers(req: ListArxivPapersRequest): Promise<ArxivPaper[]> {
  const category = req.category || 'cs.AI';
  const pageSize = clampInt(req.pageSize, 50, 1, 100);

  let searchQuery: string;
  if (req.query) {
    searchQuery = `all:${req.query}+AND+cat:${category}`;
  } else {
    searchQuery = `cat:${category}`;
  }

  const url = `https://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=${pageSize}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/xml', 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) return [];

  const xml = await response.text();
  const parsed = xmlParser.parse(xml);
  const feed = parsed?.feed;
  if (!feed) return [];

  const entries: any[] = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];

  return entries.map((entry: any): ArxivPaper => {
    // Extract ID: last segment after last '/'
    const rawId = String(entry.id || '');
    const id = rawId.split('/').pop() || rawId;

    // Clean title (arXiv titles can have internal newlines)
    const title = (entry.title || '').trim().replace(/\s+/g, ' ');

    // Clean summary
    const summary = (entry.summary || '').trim().replace(/\s+/g, ' ');

    // Authors
    const authors = (entry.author ?? []).map((a: any) => a.name || '');

    // Categories (from attributes)
    const categories = (entry.category ?? []).map((c: any) => c['@_term'] || '');

    // Published time (Unix epoch ms)
    const publishedAt = entry.published ? new Date(entry.published).getTime() : 0;

    // URL: find link with rel="alternate", fallback to entry.id
    const links: any[] = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
    const alternateLink = links.find((l: any) => l['@_rel'] === 'alternate');
    const url = alternateLink?.['@_href'] || rawId;

    return { id, title, summary, authors, categories, publishedAt, url };
  });
}

// ---------- Handler ----------

export async function listArxivPapers(
  ctx: ServerContext,
  req: ListArxivPapersRequest,
): Promise<ListArxivPapersResponse> {
  const category = req.category || '';
  if (category && !trackedCategories.includes(category)) {
    throw new ValidationError([{ field: 'category', description: 'Unsupported arXiv category' }]);
  }
  const categories = category ? [category] : trackedCategories;
  const pageSize = resolvePageSize(req.pageSize, 50, 100);
  const snapshots = await Promise.all(categories.map(async (selected) => {
    try {
      return await getCachedJson(`${SEED_KEY_PREFIX}:${selected}::50`, true) as ListArxivPapersResponse | null;
    } catch {
      return null;
    }
  }));
  const papers = new Map<string, ListArxivPapersResponse['papers'][number]>();
  let incomplete = false;
  for (const snapshot of snapshots) {
    if (!Array.isArray(snapshot?.papers)) {
      incomplete = true;
      continue;
    }
    for (const paper of snapshot.papers) {
      if (!paper || typeof paper.id !== 'string' || !Number.isFinite(paper.publishedAt)) {
        incomplete = true;
        continue;
      }
      if (!papers.has(paper.id)) papers.set(paper.id, paper);
    }
  }
  const result = {
    papers: [...papers.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, pageSize),
    pagination: undefined,
  };
  return incomplete ? markNoStoreFallbackResponse(ctx.request, result) : result;
}
