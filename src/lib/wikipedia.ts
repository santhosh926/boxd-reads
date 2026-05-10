import type { Movie } from "./letterboxd";
import { getCachedValue, setCachedValue } from "./lookupCache";
import { SourceLookupException, type SourceWork } from "./sourceWorkTypes";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type WikipediaSourceLookupOptions = {
  cache?: boolean;
  fetcher?: Fetcher;
  searchLimit?: number;
};

type WikipediaSearchResult = {
  id?: number;
  key?: string;
  pageid?: number;
  excerpt?: string;
  description?: string;
  title?: string;
  snippet?: string;
};

type WikipediaSearchResponse = {
  pages?: WikipediaSearchResult[];
  query?: {
    search?: WikipediaSearchResult[];
  };
};

type WikipediaPageResponse = {
  id?: number;
  key?: string;
  title?: string;
  source?: string;
  parse?: {
    pageid?: number;
    title?: string;
    wikitext?: {
      "*": string;
    };
  };
  error?: {
    code?: string;
    info?: string;
  };
};

type MoviePageCandidate = {
  key: string;
  pageId: string;
  title: string;
  score: number;
};

type ParsedSourceWork = {
  title: string;
  authors: string[];
  sourcePageKey?: string;
  rawValue: string;
  hasExplicitBookishSignal: boolean;
};

type SourcePageClassification = "bookish" | "non-bookish" | "unknown";

const WIKIMEDIA_SEARCH_URL = "https://api.wikimedia.org/core/v1/wikipedia/en/search/page";
const WIKIMEDIA_PAGE_URL = "https://api.wikimedia.org/core/v1/wikipedia/en/page/";
const WIKIPEDIA_PAGE_URL = "https://en.wikipedia.org/wiki/";
const WIKIPEDIA_SOURCE_WORK_CACHE_NAMESPACE = "wikipedia-source-works";
const WIKIPEDIA_SOURCE_PAGE_CACHE_NAMESPACE = "wikipedia-source-page-classification";
const WIKIPEDIA_REQUEST_SPACING_MS = 450;
const WIKIPEDIA_RATE_LIMIT_RETRY_MS = 2500;
const BOOKISH_SOURCE_PATTERN =
  /\b(?:book|novel|novella|short stor(?:y|ies)|memoir|biograph(?:y|ies)|autobiograph(?:y|ies)|manga|comic(?: book| strip|s)?|graphic novel|webcomic|webtoon|manhwa|manhua|light novel|magazine)\b/i;
const NON_BOOKISH_SOURCE_PAGE_PATTERN =
  /\b(?:film|movie|motion picture|video game|game series|media franchise|television series|tv series|character|characters|album|song)\b/i;

let nextWikipediaRequestAt = 0;

export async function findWikipediaSourceWorksForMovie(
  movie: Movie,
  options: WikipediaSourceLookupOptions = {}
): Promise<SourceWork[]> {
  const cacheKey = getMovieSourceWorkCacheKey(movie);
  const shouldUseCache = options.cache !== false;
  const cachedSourceWorks = shouldUseCache
    ? getCachedValue<SourceWork[]>(WIKIPEDIA_SOURCE_WORK_CACHE_NAMESPACE, cacheKey)
    : undefined;

  if (cachedSourceWorks) {
    return cachedSourceWorks;
  }

  const fetcher = options.fetcher ?? fetch;
  const directCandidates = getDirectPageCandidates(movie);

  for (const candidate of directCandidates) {
    const sourceWorks = await fetchSourceWorksFromRawPage(movie, candidate, fetcher);

    if (sourceWorks.length > 0) {
      if (shouldUseCache) {
        setCachedValue(WIKIPEDIA_SOURCE_WORK_CACHE_NAMESPACE, cacheKey, sourceWorks);
      }

      return sourceWorks;
    }
  }

  if (isWikipediaSearchFallbackEnabled()) {
    const candidates = await searchMoviePageCandidates(
      movie,
      fetcher,
      options.searchLimit ?? 3
    );

    for (const candidate of candidates.slice(0, 1)) {
      const sourceWorks = await fetchSourceWorksFromPage(movie, candidate, fetcher);

      if (sourceWorks.length > 0) {
        if (shouldUseCache) {
          setCachedValue(WIKIPEDIA_SOURCE_WORK_CACHE_NAMESPACE, cacheKey, sourceWorks);
        }

        return sourceWorks;
      }
    }
  }

  if (shouldUseCache) {
    setCachedValue(WIKIPEDIA_SOURCE_WORK_CACHE_NAMESPACE, cacheKey, []);
  }

  return [];
}

async function fetchSourceWorksFromRawPage(
  movie: Movie,
  candidate: MoviePageCandidate,
  fetcher: Fetcher,
  redirectDepth = 0
): Promise<SourceWork[]> {
  const wikitext = await fetchWikipediaRawWikitext(candidate.key, fetcher);

  if (!wikitext) {
    return [];
  }

  const redirectTarget = getRedirectTarget(wikitext);

  if (redirectTarget && redirectDepth < 2) {
    return fetchSourceWorksFromRawPage(
      movie,
      {
        key: toWikipediaPageKey(redirectTarget),
        pageId: toWikipediaPageKey(redirectTarget),
        title: redirectTarget,
        score: candidate.score
      },
      fetcher,
      redirectDepth + 1
    );
  }

  return buildSourceWorksFromWikitext(movie, candidate, wikitext, fetcher);
}

async function searchMoviePageCandidates(
  movie: Movie,
  fetcher: Fetcher,
  searchLimit: number
): Promise<MoviePageCandidate[]> {
  const results = new Map<string, MoviePageCandidate>();

  for (const query of getSearchQueries(movie)) {
    const url = new URL(WIKIMEDIA_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(searchLimit));

    const response = await fetchWikipedia(url.toString(), fetcher);
    const payload = (await response.json()) as WikipediaSearchResponse;
    const searchResults = payload.pages ?? payload.query?.search ?? [];

    for (const result of searchResults) {
      const candidate = toMoviePageCandidate(movie, result);

      if (!candidate) {
        continue;
      }

      const existing = results.get(candidate.pageId);

      if (!existing || candidate.score > existing.score) {
        results.set(candidate.pageId, candidate);
      }
    }
  }

  return Array.from(results.values()).sort((first, second) => second.score - first.score);
}

async function fetchSourceWorksFromPage(
  movie: Movie,
  candidate: MoviePageCandidate,
  fetcher: Fetcher
): Promise<SourceWork[]> {
  const url = new URL(`${WIKIMEDIA_PAGE_URL}${encodeURIComponent(candidate.key)}`);

  const response = await fetchWikipedia(url.toString(), fetcher);
  const payload = (await response.json()) as WikipediaPageResponse;

  if (payload.error) {
    throw new SourceLookupException(
      "FETCH_FAILED",
      "Wikipedia adaptation lookup is unavailable right now. Try again in a moment."
    );
  }

  const pageTitle = payload.title ?? payload.parse?.title ?? candidate.title;
  const pageId = String(payload.id ?? payload.parse?.pageid ?? candidate.pageId);
  const pageKey = payload.key ?? candidate.key;
  const wikitext = payload.source ?? payload.parse?.wikitext?.["*"] ?? "";

  return buildSourceWorksFromWikitext(
    movie,
    {
      ...candidate,
      key: pageKey,
      pageId,
      title: pageTitle
    },
    wikitext,
    fetcher
  );
}

async function buildSourceWorksFromWikitext(
  movie: Movie,
  candidate: MoviePageCandidate,
  wikitext: string,
  fetcher: Fetcher
): Promise<SourceWork[]> {
  const infobox = extractTemplate(wikitext, "Infobox film");

  if (!infobox) {
    return [];
  }

  const basedOn = getTemplateParam(infobox, "based_on");

  if (!basedOn) {
    return [];
  }

  const sourceWorks: SourceWork[] = [];

  for (const sourceWork of parseBasedOnValue(basedOn)) {
    if (!(await isBookishWikipediaSourceWork(sourceWork, fetcher))) {
      continue;
    }

    sourceWorks.push({
      id: `wikipedia-${candidate.pageId}-${normalizeTitle(sourceWork.title)}`,
      title: sourceWork.title,
      authors: sourceWork.authors,
      sourceDataUrl: `${WIKIPEDIA_PAGE_URL}${encodeURIComponent(candidate.key)}`,
      sourceProvider: "wikipedia" as const,
      filmId: candidate.pageId,
      filmTitle: stripPageQualifier(candidate.title),
      ...(movie.year ? { filmYear: movie.year } : {})
    });
  }

  return sourceWorks;
}

function toMoviePageCandidate(
  movie: Movie,
  result: WikipediaSearchResult
): MoviePageCandidate | null {
  const pageId = result.id ?? result.pageid;
  const pageKey = result.key ?? result.title?.replace(/\s+/g, "_");

  if (!pageId || !pageKey || !result.title) {
    return null;
  }

  const normalizedPageTitle = normalizeTitle(stripPageQualifier(result.title));
  const movieTitleVariants = getSearchTitleVariants(movie.title).map(normalizeTitle);
  const hasTitleMatch = movieTitleVariants.some(
    (title) => normalizedPageTitle === title || normalizedPageTitle === stripLeadingArticle(title)
  );

  if (!hasTitleMatch) {
    return null;
  }

  const snippet = stripHtml(result.excerpt ?? result.snippet ?? result.description ?? "");
  const titleAndSnippet = `${result.title} ${snippet}`;
  const looksLikeFilm = /\bfilm\b|\bmovie\b/i.test(titleAndSnippet);
  const yearMatch = movie.year !== undefined && titleAndSnippet.includes(String(movie.year));

  if (!looksLikeFilm) {
    return null;
  }

  return {
    key: pageKey,
    pageId: String(pageId),
    title: result.title,
    score:
      50 +
      (yearMatch ? 30 : 0) +
      (/\(\d{4} film\)|\(film\)/i.test(result.title) ? 15 : 0) +
      (normalizedPageTitle === normalizeTitle(movie.title) ? 10 : 0)
  };
}

function getDirectPageCandidates(movie: Movie): MoviePageCandidate[] {
  const candidates: MoviePageCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const title of getSearchTitleVariants(movie.title)) {
    const pageTitles = [
      title,
      `${title} (film)`,
      movie.year ? `${title} (${movie.year} film)` : ""
    ].filter(Boolean);

    for (const pageTitle of pageTitles) {
      const key = toWikipediaPageKey(pageTitle);

      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      candidates.push({
        key,
        pageId: key,
        title: pageTitle,
        score: 40
      });
    }
  }

  return candidates;
}

export function parseWikipediaBasedOnValue(value: string): ParsedSourceWork[] {
  return parseBasedOnValue(value);
}

function parseBasedOnValue(value: string): ParsedSourceWork[] {
  const basedOnTemplates = extractTemplatesByName(value, "Based on");

  if (basedOnTemplates.length > 0) {
    return basedOnTemplates
      .map(parseBasedOnTemplate)
      .filter((sourceWork): sourceWork is ParsedSourceWork => Boolean(sourceWork));
  }

  return parsePlainBasedOnValue(value);
}

function parseBasedOnTemplate(template: string): ParsedSourceWork | null {
  const parts = splitTopLevel(template.slice(2, -2), "|")
    .slice(1)
    .map((part) => part.trim())
    .filter((part) => part && !part.includes("="));
  const rawTitle = parts[0] ?? "";
  const titleLink = getFirstWikiLink(rawTitle);
  const title = cleanSourceTitle(cleanWikiText(rawTitle));

  if (!title) {
    return null;
  }

  return {
    title,
    authors: splitAuthorNames(cleanWikiText(parts.slice(1).join(", "))),
    ...(titleLink ? { sourcePageKey: titleLink.pageKey } : {}),
    rawValue: template,
    hasExplicitBookishSignal: hasBookishSourceSignal(template)
  };
}

function parsePlainBasedOnValue(value: string): ParsedSourceWork[] {
  const normalizedValue = value.replace(/<br\s*\/?>/gi, ";");
  const parts = splitTopLevel(normalizedValue, ";")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts
    .map(parsePlainBasedOnPart)
    .filter((sourceWork): sourceWork is ParsedSourceWork => Boolean(sourceWork));
}

function parsePlainBasedOnPart(value: string): ParsedSourceWork | null {
  const cleanValue = cleanWikiText(value).replace(/\s+/g, " ").trim();
  const cleanMatch = cleanValue.match(/^(.+?)\s+by\s+(.+)$/i);
  const rawMatch = value.match(/^([\s\S]+?)\s+by\s+([\s\S]+)$/i);
  const rawTitle = rawMatch?.[1] ?? value;
  const titleLink = getFirstWikiLink(rawTitle);

  if (!cleanMatch?.[1]) {
    const title = cleanSourceTitle(cleanValue);
    return title
      ? {
          title,
          authors: [],
          ...(titleLink ? { sourcePageKey: titleLink.pageKey } : {}),
          rawValue: value,
          hasExplicitBookishSignal: hasBookishSourceSignal(value)
        }
      : null;
  }

  const title = cleanSourceTitle(cleanMatch[1]);

  if (!title) {
    return null;
  }

  return {
    title,
    authors: splitAuthorNames(cleanMatch[2] ?? ""),
    ...(titleLink ? { sourcePageKey: titleLink.pageKey } : {}),
    rawValue: value,
    hasExplicitBookishSignal: hasBookishSourceSignal(value)
  };
}

async function isBookishWikipediaSourceWork(
  sourceWork: ParsedSourceWork,
  fetcher: Fetcher
): Promise<boolean> {
  if (hasDisqualifyingBasedOnText(sourceWork)) {
    return false;
  }

  const pageKey = sourceWork.sourcePageKey ?? toWikipediaPageKey(sourceWork.title);
  const classification = await classifyWikipediaSourcePage(pageKey, fetcher);

  if (classification === "bookish") {
    return true;
  }

  if (classification === "non-bookish") {
    return false;
  }

  return sourceWork.hasExplicitBookishSignal;
}

async function classifyWikipediaSourcePage(
  pageKey: string,
  fetcher: Fetcher
): Promise<SourcePageClassification> {
  const cacheKey = normalizeTitle(pageKey);
  const cachedClassification = getCachedValue<SourcePageClassification>(
    WIKIPEDIA_SOURCE_PAGE_CACHE_NAMESPACE,
    cacheKey
  );

  if (cachedClassification) {
    return cachedClassification;
  }

  const wikitext = await fetchWikipediaRawWikitext(pageKey, fetcher);
  const classification = wikitext
    ? classifyWikipediaSourcePageWikitext(wikitext)
    : "unknown";

  setCachedValue(WIKIPEDIA_SOURCE_PAGE_CACHE_NAMESPACE, cacheKey, classification);
  return classification;
}

function classifyWikipediaSourcePageWikitext(value: string): SourcePageClassification {
  const lead = value.slice(0, 7000);

  if (hasNonBookishInfobox(lead)) {
    return "non-bookish";
  }

  if (hasBookishInfobox(lead) || hasBookishSourceSignal(getShortDescription(lead))) {
    return "bookish";
  }

  if (NON_BOOKISH_SOURCE_PAGE_PATTERN.test(getShortDescription(lead))) {
    return "non-bookish";
  }

  if (hasBookishCategory(value)) {
    return "bookish";
  }

  if (hasNonBookishCategory(value)) {
    return "non-bookish";
  }

  return "unknown";
}

function hasDisqualifyingBasedOnText(sourceWork: ParsedSourceWork): boolean {
  const title = normalizeTitle(sourceWork.title);
  const rawValue = cleanWikiText(sourceWork.rawValue) || sourceWork.rawValue;

  if (title === "character" || title === "characters") {
    return true;
  }

  if (!sourceWork.hasExplicitBookishSignal && /\bcharacters?\b/i.test(rawValue)) {
    return true;
  }

  if (!sourceWork.hasExplicitBookishSignal && NON_BOOKISH_SOURCE_PAGE_PATTERN.test(rawValue)) {
    return true;
  }

  return false;
}

function hasBookishInfobox(value: string): boolean {
  return /{{\s*Infobox\s+(?:book|novel|short story|manga|animanga|comic book title|graphic novel|comic strip|magazine|newspaper)\b/i.test(
    value
  );
}

function hasNonBookishInfobox(value: string): boolean {
  return /{{\s*Infobox\s+(?:film|television|video game|media franchise|character|fictional character|album|song|play|musical|television episode)\b/i.test(
    value
  );
}

function hasBookishCategory(value: string): boolean {
  return /\[\[Category:[^\]]*\b(?:books|novels|novellas|short stories|manga|comics|comic books|graphic novels|webcomics|webtoons|magazines)\b[^\]]*\]\]/i.test(
    value
  );
}

function hasNonBookishCategory(value: string): boolean {
  return /\[\[Category:[^\]]*\b(?:films|movies|video games|media franchises|film series|television series|fictional characters|songs|albums)\b[^\]]*\]\]/i.test(
    value
  );
}

function getShortDescription(value: string): string {
  const template = extractTemplate(value, "Short description");

  if (!template) {
    return "";
  }

  return cleanWikiText(splitTopLevel(template.slice(2, -2), "|")[1] ?? "");
}

function hasBookishSourceSignal(value: string): boolean {
  return BOOKISH_SOURCE_PATTERN.test(value) || BOOKISH_SOURCE_PATTERN.test(cleanWikiText(value));
}

function getFirstWikiLink(value: string): { pageKey: string } | undefined {
  const match = value.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/);
  const target = match?.[1]?.trim();

  return target ? { pageKey: toWikipediaPageKey(target) } : undefined;
}

function extractTemplate(value: string, templateName: string): string | null {
  const match = new RegExp(`{{\\s*${escapeRegExp(templateName)}\\b`, "i").exec(value);

  if (!match) {
    return null;
  }

  return readBalancedTemplate(value, match.index);
}

function extractTemplatesByName(value: string, templateName: string): string[] {
  const templates: string[] = [];
  const pattern = new RegExp(`{{\\s*${escapeRegExp(templateName)}\\b`, "gi");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    const template = readBalancedTemplate(value, match.index);

    if (template) {
      templates.push(template);
      pattern.lastIndex = match.index + template.length;
    }
  }

  return templates;
}

function readBalancedTemplate(value: string, startIndex: number): string | null {
  let depth = 0;

  for (let index = startIndex; index < value.length - 1; index += 1) {
    const pair = value.slice(index, index + 2);

    if (pair === "{{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (pair === "}}") {
      depth -= 1;
      index += 1;

      if (depth === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function getTemplateParam(template: string, paramName: string): string | undefined {
  const parts = splitTopLevel(template.slice(2, -2), "|").slice(1);

  for (const part of parts) {
    const equalsIndex = indexOfTopLevelEquals(part);

    if (equalsIndex === -1) {
      continue;
    }

    const name = part.slice(0, equalsIndex).trim().toLowerCase();

    if (name === paramName.toLowerCase()) {
      return part.slice(equalsIndex + 1).trim();
    }
  }

  return undefined;
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let templateDepth = 0;
  let linkDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const pair = value.slice(index, index + 2);

    if (pair === "{{") {
      templateDepth += 1;
      current += pair;
      index += 1;
      continue;
    }

    if (pair === "}}" && templateDepth > 0) {
      templateDepth -= 1;
      current += pair;
      index += 1;
      continue;
    }

    if (pair === "[[") {
      linkDepth += 1;
      current += pair;
      index += 1;
      continue;
    }

    if (pair === "]]" && linkDepth > 0) {
      linkDepth -= 1;
      current += pair;
      index += 1;
      continue;
    }

    if (value[index] === separator && templateDepth === 0 && linkDepth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += value[index];
  }

  parts.push(current);
  return parts;
}

function indexOfTopLevelEquals(value: string): number {
  let templateDepth = 0;
  let linkDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const pair = value.slice(index, index + 2);

    if (pair === "{{") {
      templateDepth += 1;
      index += 1;
      continue;
    }

    if (pair === "}}" && templateDepth > 0) {
      templateDepth -= 1;
      index += 1;
      continue;
    }

    if (pair === "[[") {
      linkDepth += 1;
      index += 1;
      continue;
    }

    if (pair === "]]" && linkDepth > 0) {
      linkDepth -= 1;
      index += 1;
      continue;
    }

    if (value[index] === "=" && templateDepth === 0 && linkDepth === 0) {
      return index;
    }
  }

  return -1;
}

function cleanWikiText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ref\b[\s\S]*?<\/ref>/gi, " ")
    .replace(/<ref\b[^>]*\/>/gi, " ")
    .replace(/{{\s*plainlist\s*\|/gi, "")
    .replace(/{{\s*ubl\s*\|/gi, "")
    .replace(/{{[^{}]*}}/g, " ")
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
    .replace(/\[(?:https?:)?\/\/[^\]]+\]/g, " ")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSourceTitle(value: string): string {
  return value
    .replace(/^based on\s+/i, "")
    .replace(/^(?:the\s+|a\s+|an\s+)?(?:novel|book|novella|short story|memoir|play|comic book|graphic novel)\s+/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function splitAuthorNames(value: string): string[] {
  return value
    .replace(/^by\s+/i, "")
    .split(/\s*(?:,|;|&|\band\b)\s*/i)
    .map((author) => author.trim())
    .filter(Boolean);
}

async function fetchWikipedia(
  input: string,
  fetcher: Fetcher,
  init: RequestInit = {},
  retryOnRateLimit = true
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (!headers.has("Api-User-Agent")) {
    headers.set("Api-User-Agent", "BoxdReads/0.1");
  }

  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", "BoxdReads/0.1");
  }

  await waitForWikipediaSlot(fetcher);

  const response = await fetcher(input, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (response.status === 429) {
    if (retryOnRateLimit) {
      await sleep(WIKIPEDIA_RATE_LIMIT_RETRY_MS);
      return fetchWikipedia(input, fetcher, init, false);
    }

    throw new SourceLookupException(
      "RATE_LIMITED",
      "Wikipedia adaptation lookup was rate limited. Try again in a moment."
    );
  }

  if (!response.ok) {
    throw new SourceLookupException(
      "FETCH_FAILED",
      "Wikipedia adaptation lookup is unavailable right now. Try again in a moment."
    );
  }

  return response;
}

async function fetchWikipediaRawWikitext(
  pageKey: string,
  fetcher: Fetcher,
  retryOnRateLimit = true
): Promise<string | null> {
  const headers = new Headers();
  headers.set("Accept", "text/plain");
  headers.set("Api-User-Agent", "BoxdReads/0.1");
  headers.set("User-Agent", "BoxdReads/0.1");

  await waitForWikipediaSlot(fetcher);

  const response = await fetcher(
    `${WIKIPEDIA_PAGE_URL}${encodeURIComponent(pageKey)}?action=raw`,
    {
      headers,
      cache: "no-store"
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (response.status === 429) {
    if (retryOnRateLimit) {
      await sleep(WIKIPEDIA_RATE_LIMIT_RETRY_MS);
      return fetchWikipediaRawWikitext(pageKey, fetcher, false);
    }

    throw new SourceLookupException(
      "RATE_LIMITED",
      "Wikipedia adaptation lookup was rate limited. Try again in a moment."
    );
  }

  if (!response.ok) {
    throw new SourceLookupException(
      "FETCH_FAILED",
      "Wikipedia adaptation lookup is unavailable right now. Try again in a moment."
    );
  }

  return response.text();
}

async function waitForWikipediaSlot(fetcher: Fetcher): Promise<void> {
  if (fetcher !== fetch) {
    return;
  }

  const now = Date.now();
  const waitMs = Math.max(0, nextWikipediaRequestAt - now);
  nextWikipediaRequestAt = Math.max(now, nextWikipediaRequestAt) + WIKIPEDIA_REQUEST_SPACING_MS;

  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getSearchQueries(movie: Movie): string[] {
  return [[movie.title, movie.year, "film"].filter(Boolean).join(" ")];
}

function isWikipediaSearchFallbackEnabled(): boolean {
  return process.env.WIKIPEDIA_SEARCH_FALLBACK_ENABLED === "true";
}

function getSearchTitleVariants(title: string): string[] {
  const variants = [title];
  const colonTitle = title.split(":")[0]?.trim();
  const dashTitle = title.split(" - ")[0]?.trim();
  const parentheticalTitle = title.replace(/\s+\([^)]*\)\s*$/, "").trim();

  for (const variant of [colonTitle, dashTitle, parentheticalTitle]) {
    if (variant && variant.length > 1 && !variants.includes(variant)) {
      variants.push(variant);
    }
  }

  return variants;
}

function getMovieSourceWorkCacheKey(movie: Movie): string {
  return `${normalizeTitle(movie.title)}|${movie.year ?? "unknown"}`;
}

function stripPageQualifier(title: string): string {
  return title.replace(/\s+\((?:\d{4}\s+)?film\)$/i, "").trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function getRedirectTarget(value: string): string | undefined {
  return value.match(/^#REDIRECT\s+\[\[([^\]]+)\]\]/i)?.[1]?.trim();
}

function toWikipediaPageKey(title: string): string {
  return title.trim().replace(/\s+/g, "_");
}

function stripLeadingArticle(title: string): string {
  return title.replace(/^(a|an|the)\s+/, "");
}

function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
