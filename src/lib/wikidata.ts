import type { Movie } from "./letterboxd";
import { getCachedValue, setCachedValue } from "./lookupCache";

export type WikidataSourceWork = {
  id: string;
  title: string;
  authors: string[];
  publishedDate?: string;
  description?: string;
  wikidataUrl: string;
  filmId: string;
  filmTitle?: string;
  filmYear?: number;
};

export type WikidataSourceLookupErrorCode = "FETCH_FAILED" | "RATE_LIMITED";

export class WikidataSourceLookupException extends Error {
  code: WikidataSourceLookupErrorCode;

  constructor(code: WikidataSourceLookupErrorCode, message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, WikidataSourceLookupException.prototype);
  }
}

type WikidataSearchResult = {
  id?: string;
  label?: string;
  description?: string;
};

type WikidataSearchResponse = {
  search?: WikidataSearchResult[];
};

type WikidataSnak = {
  datavalue?: {
    value?:
      | {
          id?: string;
          time?: string;
        }
      | string;
  };
};

type WikidataClaim = {
  mainsnak?: WikidataSnak;
  qualifiers?: Record<string, WikidataSnak[]>;
};

type WikidataClaimsResponse = {
  claims?: Record<string, WikidataClaim[]>;
};

type WikidataEntityResponse = {
  entities?: Record<
    string,
    {
      labels?: Record<string, { value?: string }>;
      descriptions?: Record<string, { value?: string }>;
    }
  >;
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type WikidataSourceLookupOptions = {
  cache?: boolean;
  fetcher?: Fetcher;
  searchLimit?: number;
};

type MovieCandidate = {
  id: string;
  label: string;
  description: string;
  score: number;
};

type EntitySummary = {
  label?: string;
  description?: string;
};

type SourceCandidate = {
  sourceId: string;
  film: MovieCandidate;
  qualifierAuthorIds: string[];
};

type SourceDetail = {
  sourceId: string;
  sourceAuthorNames: string[];
  publishedDate?: string;
  isBookish: boolean;
};

const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
const WIKIDATA_ENTITY_URL = "https://www.wikidata.org/wiki/";
const WIKIDATA_SOURCE_WORK_CACHE_NAMESPACE = "wikidata-source-works";

export async function findWikidataSourceWorksForMovie(
  movie: Movie,
  options: WikidataSourceLookupOptions = {}
): Promise<WikidataSourceWork[]> {
  const cacheKey = getMovieSourceWorkCacheKey(movie);
  const shouldUseCache = options.cache !== false;
  const cachedSourceWorks = shouldUseCache
    ? getCachedValue<WikidataSourceWork[]>(
        WIKIDATA_SOURCE_WORK_CACHE_NAMESPACE,
        cacheKey
      )
    : undefined;

  if (cachedSourceWorks) {
    return cachedSourceWorks;
  }

  const fetcher = options.fetcher ?? fetch;
  const candidates = await searchMovieCandidates(movie, fetcher, options.searchLimit ?? 8);

  if (candidates.length === 0) {
    if (shouldUseCache) {
      setCachedValue(WIKIDATA_SOURCE_WORK_CACHE_NAMESPACE, cacheKey, []);
    }

    return [];
  }

  const sourceCandidates = await findSourceCandidates(candidates, fetcher);

  if (sourceCandidates.length === 0) {
    if (shouldUseCache) {
      setCachedValue(WIKIDATA_SOURCE_WORK_CACHE_NAMESPACE, cacheKey, []);
    }

    return [];
  }

  const sourceIds = unique(sourceCandidates.map((candidate) => candidate.sourceId));
  const sourceSummaries = await fetchEntitySummaries(sourceIds, fetcher);
  const sourceDetails = buildSourceDetails(sourceIds, sourceSummaries);
  const authorIds = unique(sourceCandidates.flatMap((candidate) => candidate.qualifierAuthorIds));
  const authorLabels = await fetchEntityLabels(authorIds, fetcher);

  const sourceWorks = buildSourceWorks(
    sourceCandidates,
    sourceSummaries,
    sourceDetails,
    authorLabels
  );

  if (shouldUseCache) {
    setCachedValue(WIKIDATA_SOURCE_WORK_CACHE_NAMESPACE, cacheKey, sourceWorks);
  }

  return sourceWorks;
}

async function searchMovieCandidates(
  movie: Movie,
  fetcher: Fetcher,
  searchLimit: number
): Promise<MovieCandidate[]> {
  const candidates = new Map<string, MovieCandidate>();

  for (const title of getSearchTitleVariants(movie.title)) {
    const url = new URL(WIKIDATA_API_URL);
    url.searchParams.set("action", "wbsearchentities");
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "en");
    url.searchParams.set("uselang", "en");
    url.searchParams.set("type", "item");
    url.searchParams.set("limit", String(searchLimit));
    url.searchParams.set("search", title);

    const response = await fetchWikidata(url.toString(), fetcher);
    const payload = (await response.json()) as WikidataSearchResponse;

    for (const result of payload.search ?? []) {
      const candidate = toMovieCandidate(movie, result);

      if (!candidate) {
        continue;
      }

      const existing = candidates.get(candidate.id);

      if (!existing || candidate.score > existing.score) {
        candidates.set(candidate.id, candidate);
      }
    }
  }

  return Array.from(candidates.values()).sort((first, second) => second.score - first.score);
}

function toMovieCandidate(movie: Movie, result: WikidataSearchResult): MovieCandidate | null {
  if (!result.id || !result.label) {
    return null;
  }

  const description = result.description ?? "";
  const normalizedLabel = normalizeTitle(result.label);
  const movieTitleVariants = getSearchTitleVariants(movie.title).map(normalizeTitle);
  const hasTitleMatch = movieTitleVariants.some(
    (title) => normalizedLabel === title || normalizedLabel === stripLeadingArticle(title)
  );
  const looksLikeFilm = /\bfilm\b|\bmovie\b/i.test(description);

  if (!hasTitleMatch || !looksLikeFilm) {
    return null;
  }

  const descriptionYear = getYearFromText(description);
  const hasYearMatch = movie.year !== undefined && descriptionYear === movie.year;

  if (movie.year !== undefined && descriptionYear && !hasYearMatch) {
    return null;
  }

  return {
    id: result.id,
    label: result.label,
    description,
    score: 50 + (hasYearMatch ? 30 : 0) + (normalizedLabel === normalizeTitle(movie.title) ? 10 : 0)
  };
}

async function findSourceCandidates(
  candidates: MovieCandidate[],
  fetcher: Fetcher
): Promise<SourceCandidate[]> {
  const sourceCandidates: SourceCandidate[] = [];

  for (const candidate of candidates) {
    const basedOnClaims = await fetchClaims(candidate.id, "P144", fetcher);

    for (const claim of basedOnClaims) {
      const sourceId = getEntityIdFromSnak(claim.mainsnak);

      if (!sourceId) {
        continue;
      }

      sourceCandidates.push({
        sourceId,
        film: candidate,
        qualifierAuthorIds: getEntityIdsFromSnaks(claim.qualifiers?.P50 ?? [])
      });
    }
  }

  return sourceCandidates;
}

function buildSourceDetails(
  sourceIds: string[],
  sourceSummaries: Map<string, EntitySummary>
): SourceDetail[] {
  return sourceIds.map((sourceId) => {
    const description = sourceSummaries.get(sourceId)?.description;
    const publishedYear = description ? getYearFromText(description) : undefined;

    return {
      sourceId,
      sourceAuthorNames: description ? getAuthorNamesFromDescription(description) : [],
      ...(publishedYear ? { publishedDate: String(publishedYear) } : {}),
      isBookish: isBookishSourceWork(description)
    };
  });
}

async function fetchClaims(
  entityId: string,
  propertyId: string,
  fetcher: Fetcher
): Promise<WikidataClaim[]> {
  const url = new URL(WIKIDATA_API_URL);
  url.searchParams.set("action", "wbgetclaims");
  url.searchParams.set("format", "json");
  url.searchParams.set("entity", entityId);
  url.searchParams.set("property", propertyId);

  const response = await fetchWikidata(url.toString(), fetcher);
  const payload = (await response.json()) as WikidataClaimsResponse;

  return payload.claims?.[propertyId] ?? [];
}

async function fetchEntitySummaries(
  entityIds: string[],
  fetcher: Fetcher
): Promise<Map<string, EntitySummary>> {
  if (entityIds.length === 0) {
    return new Map();
  }

  const url = new URL(WIKIDATA_API_URL);
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("languages", "en|mul");
  url.searchParams.set("props", "labels|descriptions");
  url.searchParams.set("ids", entityIds.join("|"));

  const response = await fetchWikidata(url.toString(), fetcher);
  const payload = (await response.json()) as WikidataEntityResponse;
  const summaries = new Map<string, EntitySummary>();

  for (const [entityId, entity] of Object.entries(payload.entities ?? {})) {
    summaries.set(entityId, {
      label: entity.labels?.en?.value ?? entity.labels?.mul?.value,
      description: entity.descriptions?.en?.value
    });
  }

  return summaries;
}

async function fetchEntityLabels(
  entityIds: string[],
  fetcher: Fetcher
): Promise<Map<string, string>> {
  const summaries = await fetchEntitySummaries(entityIds, fetcher);
  const labels = new Map<string, string>();

  for (const [entityId, summary] of Array.from(summaries.entries())) {
    if (summary.label) {
      labels.set(entityId, summary.label);
    }
  }

  return labels;
}

function buildSourceWorks(
  sourceCandidates: SourceCandidate[],
  sourceSummaries: Map<string, EntitySummary>,
  sourceDetails: SourceDetail[],
  authorLabels: Map<string, string>
): WikidataSourceWork[] {
  const detailsBySourceId = new Map(
    sourceDetails.map((detail) => [detail.sourceId, detail])
  );
  const sourceWorks = new Map<string, WikidataSourceWork & { score: number }>();

  for (const candidate of sourceCandidates) {
    const sourceDetail = detailsBySourceId.get(candidate.sourceId);
    const sourceSummary = sourceSummaries.get(candidate.sourceId);

    if (!sourceDetail?.isBookish || !sourceSummary?.label) {
      continue;
    }

    const existing = sourceWorks.get(candidate.sourceId);
    const authorIds = unique(candidate.qualifierAuthorIds);
    const authors = unique(
      (existing?.authors ?? []).concat(
        authorIds
          .map((authorId) => authorLabels.get(authorId))
          .filter((author): author is string => Boolean(author))
      ).concat(sourceDetail.sourceAuthorNames)
    );
    const score = candidate.film.score + (candidate.qualifierAuthorIds.length > 0 ? 5 : 0);

    sourceWorks.set(candidate.sourceId, {
      id: candidate.sourceId,
      title: sourceSummary.label,
      authors,
      ...(sourceDetail.publishedDate ? { publishedDate: sourceDetail.publishedDate } : {}),
      ...(sourceSummary.description ? { description: sourceSummary.description } : {}),
      wikidataUrl: `${WIKIDATA_ENTITY_URL}${candidate.sourceId}`,
      filmId: candidate.film.id,
      filmTitle: candidate.film.label,
      ...(getYearFromText(candidate.film.description)
        ? { filmYear: getYearFromText(candidate.film.description) }
        : {}),
      score: Math.max(score, existing?.score ?? 0)
    });
  }

  return Array.from(sourceWorks.values())
    .sort((first, second) => second.score - first.score)
    .map(({ score: _score, ...sourceWork }) => sourceWork);
}

async function fetchWikidata(
  input: string,
  fetcher: Fetcher,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (!headers.has("Api-User-Agent")) {
    headers.set("Api-User-Agent", "BoxdReads/0.1");
  }

  const response = await fetcher(input, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (response.status === 429) {
    throw new WikidataSourceLookupException(
      "RATE_LIMITED",
      "Wikidata adaptation lookup was rate limited. Try again in a moment."
    );
  }

  if (!response.ok) {
    throw new WikidataSourceLookupException(
      "FETCH_FAILED",
      "Wikidata adaptation lookup is unavailable right now. Try again in a moment."
    );
  }

  return response;
}

function isBookishSourceWork(description?: string): boolean {
  return /\b(book|novel|novella|short story|memoir|manga|comic book|graphic novel|magazine)\b/i.test(
    description ?? ""
  );
}

function getAuthorNamesFromDescription(description: string): string[] {
  const match = description.match(/\bby ([A-Z][A-Za-z'. -]+?)(?:$|[,(])/);

  if (!match?.[1]) {
    return [];
  }

  return [match[1].trim()];
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

function stripLeadingArticle(title: string): string {
  return title.replace(/^(a|an|the)\s+/, "");
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function getEntityIdsFromSnaks(snaks: WikidataSnak[]): string[] {
  return unique(
    snaks
      .map((snak) => getEntityIdFromSnak(snak))
      .filter((entityId): entityId is string => Boolean(entityId))
  );
}

function getEntityIdFromSnak(snak?: WikidataSnak): string | undefined {
  const value = snak?.datavalue?.value;

  if (!value || typeof value === "string") {
    return undefined;
  }

  return value.id;
}

function getYearFromText(value: string): number | undefined {
  const year = value.match(/\b(?:19|20)\d{2}\b/)?.[0];

  if (!year) {
    return undefined;
  }

  const parsedYear = Number(year);
  return Number.isFinite(parsedYear) ? parsedYear : undefined;
}
