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
  goodreadsUrl: string;
  isGoodreadsSearchFallback: boolean;
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
  publish_date?: string;
  description?: string | {
    value?: string;
  };
  identifiers?: Record<string, string[]>;
};

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_BASE_URL = "https://openlibrary.org";
const OPEN_LIBRARY_CACHE_NAMESPACE = "open-library-search";
const GOODREADS_BOOK_URL = "https://www.goodreads.com/book/show/";
const GOODREADS_SEARCH_URL = "https://www.goodreads.com/search";

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
      "editions.publish_date",
      "editions.identifiers",
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
  const editions = dedupeEditions(searchEditions.concat(fetchedEditions));
  const goodreadsId = findGoodreadsId(editions);
  const authors = doc.author_name ?? [];
  const description = editions.map(getEditionDescription).find(Boolean);

  return {
    id: doc.key.replace(/^\/works\//, ""),
    title: doc.title,
    authors,
    ...(doc.first_publish_year ? { publishedDate: String(doc.first_publish_year) } : {}),
    ...(description ? { description } : {}),
    openLibraryUrl: `${OPEN_LIBRARY_BASE_URL}${doc.key}`,
    ...(goodreadsId ? { goodreadsId } : {}),
    goodreadsUrl: goodreadsId
      ? `${GOODREADS_BOOK_URL}${encodeURIComponent(goodreadsId)}`
      : getGoodreadsSearchUrl(doc.title, authors),
    isGoodreadsSearchFallback: !goodreadsId
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
    normalizeCacheValue(title),
    `author:${normalizeCacheValue(primaryAuthor ?? "unknown")}`,
    `max:${options.maxResults ?? 5}`,
    `editions:${options.editionsLimit ?? 10}`
  ].join("|");
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

function getGoodreadsSearchUrl(title: string, authors: string[]): string {
  const url = new URL(GOODREADS_SEARCH_URL);
  url.searchParams.set("q", [title, authors[0]].filter(Boolean).join(" "));
  return url.toString();
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
