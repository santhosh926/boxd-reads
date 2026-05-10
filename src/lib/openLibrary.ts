import { getCachedValue, setCachedValue } from "./lookupCache";

export type OpenLibraryBook = {
  id: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publishedDate?: string;
  description?: string;
  openLibraryUrl?: string;
  goodreadsId?: string;
  goodreadsUrl?: string;
};

export type OpenLibrarySearchErrorCode = "FETCH_FAILED" | "RATE_LIMITED";

export class OpenLibrarySearchException extends Error {
  code: OpenLibrarySearchErrorCode;

  constructor(code: OpenLibrarySearchErrorCode, message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, OpenLibrarySearchException.prototype);
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type OpenLibrarySearchOptions = {
  cache?: boolean;
  editionsLimit?: number;
  fetcher?: Fetcher;
  maxResults?: number;
};

type OpenLibrarySearchDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  editions?: {
    docs?: OpenLibraryEdition[];
  };
};

type OpenLibrarySearchResponse = {
  docs?: OpenLibrarySearchDoc[];
};

type OpenLibraryEditionsResponse = {
  entries?: OpenLibraryEdition[];
};

type OpenLibraryEdition = {
  key?: string;
  title?: string;
  subtitle?: string;
  full_title?: string;
  publish_date?: string | string[];
  description?: string | {
    value?: string;
  };
  identifiers?: Record<string, string[]>;
  isbn?: string[];
  isbn_10?: string[];
  isbn_13?: string[];
  languages?: Array<{
    key?: string;
  }>;
  translated_from?: Array<{
    key?: string;
  }>;
  translation_of?: string;
  contributors?: Array<{
    role?: string;
    name?: string;
  }>;
};

type ScoredOpenLibraryEdition = {
  edition: OpenLibraryEdition;
  index: number;
  score: number;
};

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_BASE_URL = "https://openlibrary.org";
const OPEN_LIBRARY_CACHE_NAMESPACE = "open-library-search";
const OPEN_LIBRARY_CACHE_VERSION = "canonical-goodreads-editions-v1";
const GOODREADS_BOOK_URL = "https://www.goodreads.com/book/show/";
const GOODREADS_ISBN_URL = "https://www.goodreads.com/book/isbn/";
const ENGLISH_LANGUAGE_KEY = "/languages/eng";
const MIN_CANONICAL_EDITION_SCORE = 50;

export async function searchOpenLibraryByTitle(
  title: string,
  options: OpenLibrarySearchOptions = {}
): Promise<OpenLibraryBook[]> {
  return searchOpenLibrary(title, [], options);
}

export async function searchOpenLibraryBySourceWork(
  title: string,
  authors: string[] = [],
  options: OpenLibrarySearchOptions = {}
): Promise<OpenLibraryBook[]> {
  return searchOpenLibrary(title, authors, options);
}

async function searchOpenLibrary(
  title: string,
  authors: string[],
  options: OpenLibrarySearchOptions
): Promise<OpenLibraryBook[]> {
  const cleanTitle = title.trim();

  if (!cleanTitle) {
    return [];
  }

  const primaryAuthor = authors.find((author) => author.trim())?.trim();
  const cacheKey = getOpenLibraryCacheKey(cleanTitle, primaryAuthor, options);
  const shouldUseCache = options.cache !== false;
  const cachedBooks = shouldUseCache
    ? getCachedValue<OpenLibraryBook[]>(OPEN_LIBRARY_CACHE_NAMESPACE, cacheKey)
    : undefined;

  if (cachedBooks) {
    return cachedBooks;
  }

  const fetcher = options.fetcher ?? fetch;
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);
  url.searchParams.set("title", cleanTitle);

  if (primaryAuthor) {
    url.searchParams.set("author", primaryAuthor);
  }

  url.searchParams.set("limit", String(options.maxResults ?? 5));
  url.searchParams.set(
    "fields",
    [
      "key",
      "title",
      "author_name",
      "first_publish_year",
      "editions",
      "editions.key",
      "editions.title",
      "editions.subtitle",
      "editions.full_title",
      "editions.publish_date",
      "editions.identifiers",
      "editions.isbn",
      "editions.isbn_10",
      "editions.isbn_13",
      "editions.languages",
      "editions.translation_of",
      "editions.translated_from",
      "editions.contributors",
      "editions.description"
    ].join(",")
  );

  const response = await fetchOpenLibrary(url.toString(), fetcher);
  const payload = (await response.json()) as OpenLibrarySearchResponse;
  const books: OpenLibraryBook[] = [];

  for (const doc of payload.docs ?? []) {
    const book = await toOpenLibraryBook(doc, fetcher, options);

    if (book) {
      books.push(book);
    }
  }

  if (shouldUseCache) {
    setCachedValue(OPEN_LIBRARY_CACHE_NAMESPACE, cacheKey, books);
  }

  return books;
}

async function toOpenLibraryBook(
  doc: OpenLibrarySearchDoc,
  fetcher: Fetcher,
  options: OpenLibrarySearchOptions
): Promise<OpenLibraryBook | null> {
  if (!doc.key || !doc.title) {
    return null;
  }

  const searchEditions = doc.editions?.docs ?? [];
  const fetchedEditions = await fetchEditions(doc.key, fetcher, options.editionsLimit ?? 10);
  const editions = dedupeEditions(fetchedEditions.concat(searchEditions));
  const canonicalEditions = rankOpenLibraryEditions(
    editions,
    doc.title,
    doc.first_publish_year
  )
    .filter(({ score }) => score >= MIN_CANONICAL_EDITION_SCORE)
    .map(({ edition }) => edition);
  const goodreadsId = findGoodreadsId(canonicalEditions);
  const goodreadsIsbn = goodreadsId ? undefined : findIsbn(canonicalEditions);
  const authors = doc.author_name ?? [];
  const description = canonicalEditions.map(getEditionDescription).find(Boolean);

  return {
    id: doc.key.replace(/^\/works\//, ""),
    title: doc.title,
    authors,
    ...(doc.first_publish_year ? { publishedDate: String(doc.first_publish_year) } : {}),
    ...(description ? { description } : {}),
    openLibraryUrl: `${OPEN_LIBRARY_BASE_URL}${doc.key}`,
    ...(goodreadsId ? { goodreadsId } : {}),
    ...getGoodreadsUrl(goodreadsId, goodreadsIsbn)
  };
}

async function fetchEditions(
  workKey: string,
  fetcher: Fetcher,
  editionsLimit: number
): Promise<OpenLibraryEdition[]> {
  const url = new URL(`${OPEN_LIBRARY_BASE_URL}${workKey}/editions.json`);
  url.searchParams.set("limit", String(editionsLimit));

  const response = await fetchOpenLibrary(url.toString(), fetcher);
  const payload = (await response.json()) as OpenLibraryEditionsResponse;

  return payload.entries ?? [];
}

async function fetchOpenLibrary(
  input: string,
  fetcher: Fetcher,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", "BoxdReads/0.1");
  }

  const response = await fetcher(input, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (response.status === 429) {
    throw new OpenLibrarySearchException(
      "RATE_LIMITED",
      "Open Library book lookup was rate limited. Try again in a moment."
    );
  }

  if (!response.ok) {
    throw new OpenLibrarySearchException(
      "FETCH_FAILED",
      "Open Library is unavailable right now. Try again in a moment."
    );
  }

  return response;
}

function getOpenLibraryCacheKey(
  title: string,
  primaryAuthor: string | undefined,
  options: OpenLibrarySearchOptions
): string {
  return [
    OPEN_LIBRARY_CACHE_VERSION,
    normalizeCacheValue(title),
    `author:${normalizeCacheValue(primaryAuthor ?? "unknown")}`,
    `max:${options.maxResults ?? 5}`,
    `editions:${options.editionsLimit ?? 10}`
  ].join("|");
}

function rankOpenLibraryEditions(
  editions: OpenLibraryEdition[],
  workTitle: string,
  firstPublishYear: number | undefined
): ScoredOpenLibraryEdition[] {
  return editions
    .map((edition, index) => ({
      edition,
      index,
      score: scoreOpenLibraryEdition(edition, workTitle, firstPublishYear)
    }))
    .sort((first, second) => {
      if (second.score !== first.score) {
        return second.score - first.score;
      }

      return first.index - second.index;
    });
}

function scoreOpenLibraryEdition(
  edition: OpenLibraryEdition,
  workTitle: string,
  firstPublishYear: number | undefined
): number {
  const editionTitle = edition.title ?? edition.full_title;
  const normalizedWorkTitle = normalizeEditionTitle(workTitle);
  const normalizedEditionTitle = editionTitle ? normalizeEditionTitle(editionTitle) : "";
  let score = 0;

  if (!normalizedEditionTitle) {
    score += 50;
  } else if (normalizedEditionTitle === normalizedWorkTitle) {
    score += 80;
  } else if (
    normalizedEditionTitle.startsWith(normalizedWorkTitle) ||
    normalizedWorkTitle.startsWith(normalizedEditionTitle)
  ) {
    score += 45;
  } else {
    score -= 80;
  }

  const languageKeys = getEditionLanguageKeys(edition);

  if (languageKeys.includes(ENGLISH_LANGUAGE_KEY)) {
    score += 60;
  } else if (languageKeys.length > 0) {
    score -= 40;
  }

  if (hasTranslationSignal(edition)) {
    score -= 15;
  }

  if (hasTranslatorContributor(edition)) {
    score -= 35;
  }

  const publishYear = getEditionPublishYear(edition);

  if (firstPublishYear && publishYear) {
    const yearDistance = Math.abs(firstPublishYear - publishYear);
    score += yearDistance === 0 ? 30 : -Math.min(yearDistance * 5, 35);
  }

  return score;
}

function findGoodreadsId(editions: OpenLibraryEdition[]): string | undefined {
  for (const edition of editions) {
    const identifiers = edition.identifiers ?? {};

    for (const [key, values] of Object.entries(identifiers)) {
      if (!/goodreads/i.test(key)) {
        continue;
      }

      const id = values.find((value) => value.trim());

      if (id) {
        return id.trim();
      }
    }
  }

  return undefined;
}

function findIsbn(editions: OpenLibraryEdition[]): string | undefined {
  for (const edition of editions) {
    const identifiers = edition.identifiers ?? {};
    const isbn = [
      ...(edition.isbn_13 ?? []),
      ...(edition.isbn_10 ?? []),
      ...(edition.isbn ?? []),
      ...(identifiers.isbn_13 ?? []),
      ...(identifiers.isbn_10 ?? []),
      ...(identifiers.isbn ?? [])
    ]
      .map(normalizeIsbn)
      .find(Boolean);

    if (isbn) {
      return isbn;
    }
  }

  return undefined;
}

function getGoodreadsUrl(
  goodreadsId: string | undefined,
  isbn: string | undefined
): Pick<OpenLibraryBook, "goodreadsUrl"> | Record<string, never> {
  if (goodreadsId) {
    return { goodreadsUrl: `${GOODREADS_BOOK_URL}${encodeURIComponent(goodreadsId)}` };
  }

  if (isbn) {
    return { goodreadsUrl: `${GOODREADS_ISBN_URL}${encodeURIComponent(isbn)}` };
  }

  return {};
}

function normalizeIsbn(value: string): string | undefined {
  const normalized = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  return normalized.length === 10 || normalized.length === 13 ? normalized : undefined;
}

function getEditionLanguageKeys(edition: OpenLibraryEdition): string[] {
  return (edition.languages ?? [])
    .map((language) => language.key)
    .filter((key): key is string => Boolean(key));
}

function hasTranslationSignal(edition: OpenLibraryEdition): boolean {
  return Boolean(edition.translation_of || edition.translated_from?.length);
}

function hasTranslatorContributor(edition: OpenLibraryEdition): boolean {
  return (edition.contributors ?? []).some((contributor) =>
    /translator/i.test(contributor.role ?? "")
  );
}

function getEditionPublishYear(edition: OpenLibraryEdition): number | undefined {
  const publishDate = Array.isArray(edition.publish_date)
    ? edition.publish_date.find(Boolean)
    : edition.publish_date;

  if (!publishDate) {
    return undefined;
  }

  const year = publishDate.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/)?.[0];
  return year ? Number(year) : undefined;
}

function getEditionDescription(edition: OpenLibraryEdition): string | undefined {
  if (typeof edition.description === "string") {
    return edition.description;
  }

  return edition.description?.value;
}

function dedupeEditions(editions: OpenLibraryEdition[]): OpenLibraryEdition[] {
  const seenKeys = new Set<string>();
  const deduped: OpenLibraryEdition[] = [];

  for (const edition of editions) {
    const key = edition.key ?? JSON.stringify(edition);

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    deduped.push(edition);
  }

  return deduped;
}

function normalizeCacheValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeEditionTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
