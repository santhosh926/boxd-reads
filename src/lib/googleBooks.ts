import { getCachedValue, setCachedValue } from "./lookupCache";

export type GoogleBook = {
  id: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publishedDate?: string;
  description?: string;
  infoLink?: string;
  previewLink?: string;
};

export type GoogleBooksSearchErrorCode = "FETCH_FAILED" | "RATE_LIMITED";

export class GoogleBooksSearchException extends Error {
  code: GoogleBooksSearchErrorCode;

  constructor(code: GoogleBooksSearchErrorCode, message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, GoogleBooksSearchException.prototype);
  }
}

type GoogleBooksVolume = {
  id?: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publishedDate?: string;
    description?: string;
    infoLink?: string;
    previewLink?: string;
  };
};

type GoogleBooksVolumesResponse = {
  items?: GoogleBooksVolume[];
};

type GoogleBooksSearchOptions = {
  apiKey?: string;
  cache?: boolean;
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  maxResults?: number;
};

const GOOGLE_BOOKS_VOLUMES_URL = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_BOOKS_CACHE_NAMESPACE = "google-books-search";

export async function searchGoogleBooksByTitle(
  title: string,
  options: GoogleBooksSearchOptions = {}
): Promise<GoogleBook[]> {
  const cleanTitle = title.trim();

  if (!cleanTitle) {
    return [];
  }

  return searchGoogleBooks(`intitle:"${stripQueryQuotes(cleanTitle)}"`, options);
}

export async function searchGoogleBooksBySourceWork(
  title: string,
  authors: string[] = [],
  options: GoogleBooksSearchOptions = {}
): Promise<GoogleBook[]> {
  const cleanTitle = title.trim();

  if (!cleanTitle) {
    return [];
  }

  const primaryAuthor = authors.find((author) => author.trim());
  const query = [
    `intitle:"${stripQueryQuotes(cleanTitle)}"`,
    primaryAuthor ? `inauthor:"${stripQueryQuotes(primaryAuthor)}"` : ""
  ]
    .filter(Boolean)
    .join(" ");

  return searchGoogleBooks(query, options);
}

async function searchGoogleBooks(
  query: string,
  options: GoogleBooksSearchOptions = {}
): Promise<GoogleBook[]> {
  const cleanQuery = query.trim();

  if (!cleanQuery) {
    return [];
  }

  const cacheKey = getGoogleBooksCacheKey(cleanQuery, options);
  const shouldUseCache = options.cache !== false;
  const cachedBooks = shouldUseCache
    ? getCachedValue<GoogleBook[]>(GOOGLE_BOOKS_CACHE_NAMESPACE, cacheKey)
    : undefined;

  if (cachedBooks) {
    return cachedBooks;
  }

  const url = new URL(GOOGLE_BOOKS_VOLUMES_URL);
  url.searchParams.set("q", cleanQuery);
  url.searchParams.set("printType", "books");
  url.searchParams.set("projection", "lite");
  url.searchParams.set("orderBy", "relevance");
  url.searchParams.set("maxResults", String(options.maxResults ?? 10));
  url.searchParams.set(
    "fields",
    [
      "items(id,volumeInfo(title,subtitle,authors,publishedDate,description,infoLink,previewLink))"
    ].join(",")
  );

  const apiKey = options.apiKey ?? process.env.GOOGLE_BOOKS_API_KEY;

  if (apiKey) {
    url.searchParams.set("key", apiKey);
  }

  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(url.toString(), {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (response.status === 429) {
    throw new GoogleBooksSearchException(
      "RATE_LIMITED",
      "Google Books quota was reached. Add GOOGLE_BOOKS_API_KEY to use your own quota."
    );
  }

  if (!response.ok) {
    throw new GoogleBooksSearchException(
      "FETCH_FAILED",
      "Google Books is unavailable right now. Try again in a moment."
    );
  }

  const payload = (await response.json()) as GoogleBooksVolumesResponse;

  const books = (payload.items ?? [])
    .map(toGoogleBook)
    .filter((book): book is GoogleBook => Boolean(book));

  if (shouldUseCache) {
    setCachedValue(GOOGLE_BOOKS_CACHE_NAMESPACE, cacheKey, books);
  }

  return books;
}

function stripQueryQuotes(value: string): string {
  return value.replaceAll("\"", "");
}

function getGoogleBooksCacheKey(
  query: string,
  options: GoogleBooksSearchOptions
): string {
  return [
    normalizeCacheValue(query),
    `max:${options.maxResults ?? 10}`,
    `key:${(options.apiKey ?? process.env.GOOGLE_BOOKS_API_KEY) ? "present" : "absent"}`
  ].join("|");
}

function normalizeCacheValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toGoogleBook(volume: GoogleBooksVolume): GoogleBook | null {
  const volumeInfo = volume.volumeInfo;

  if (!volume.id || !volumeInfo?.title) {
    return null;
  }

  return {
    id: volume.id,
    title: volumeInfo.title,
    authors: volumeInfo.authors ?? [],
    ...(volumeInfo.subtitle ? { subtitle: volumeInfo.subtitle } : {}),
    ...(volumeInfo.publishedDate ? { publishedDate: volumeInfo.publishedDate } : {}),
    ...(volumeInfo.description ? { description: volumeInfo.description } : {}),
    ...(volumeInfo.infoLink ? { infoLink: volumeInfo.infoLink } : {}),
    ...(volumeInfo.previewLink ? { previewLink: volumeInfo.previewLink } : {})
  };
}
