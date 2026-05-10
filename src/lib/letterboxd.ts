export type Movie = {
  title: string;
  year?: number;
  rating?: number;
  letterboxdUrl?: string;
  posterUrl?: string;
  source: "letterboxd";
};

export type LetterboxdImportResult = {
  username: string;
  movies: Movie[];
  totalImported: number;
  importedAt: string;
  isFallbackData?: boolean;
};

export type LetterboxdImportError = {
  message: string;
  code:
    | "EMPTY_USERNAME"
    | "USER_NOT_FOUND"
    | "PRIVATE_PROFILE"
    | "FETCH_FAILED"
    | "PARSE_FAILED"
    | "NO_MOVIES_FOUND"
    | "UNKNOWN_ERROR";
};

export class LetterboxdImportException extends Error {
  readonly code: LetterboxdImportError["code"];

  constructor(code: LetterboxdImportError["code"], message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, LetterboxdImportException.prototype);
  }
}

const LETTERBOXD_BASE_URL = "https://letterboxd.com";

const fallbackMovies: Movie[] = [
  {
    title: "Arrival",
    year: 2016,
    rating: 4.5,
    letterboxdUrl: "https://letterboxd.com/film/arrival-2016/",
    posterUrl:
      "https://a.ltrbxd.com/resized/film-poster/2/4/0/2/4/0/240240-arrival-0-600-0-900-crop.jpg",
    source: "letterboxd"
  },
  {
    title: "No Country for Old Men",
    year: 2007,
    rating: 4.5,
    letterboxdUrl: "https://letterboxd.com/film/no-country-for-old-men/",
    posterUrl:
      "https://a.ltrbxd.com/resized/film-poster/4/7/8/4/4784-no-country-for-old-men-0-600-0-900-crop.jpg",
    source: "letterboxd"
  },
  {
    title: "Howl's Moving Castle",
    year: 2004,
    rating: 5,
    letterboxdUrl: "https://letterboxd.com/film/howls-moving-castle/",
    posterUrl:
      "https://a.ltrbxd.com/resized/sm/upload/ut/1d/6k/1w/howls-moving-castle-0-600-0-900-crop.jpg",
    source: "letterboxd"
  },
  {
    title: "Dune: Part One",
    year: 2021,
    rating: 4,
    letterboxdUrl: "https://letterboxd.com/film/dune-2021/",
    source: "letterboxd"
  }
];

export async function importLetterboxdMovies(
  username: string
): Promise<LetterboxdImportResult> {
  const cleanUsername = normalizeUsername(username);

  if (!cleanUsername) {
    throw new LetterboxdImportException(
      "EMPTY_USERNAME",
      "Enter a Letterboxd username to import movies."
    );
  }

  if (process.env.LETTERBOXD_IMPORT_USE_MOCK === "true") {
    return buildImportResult(cleanUsername, fallbackMovies, true);
  }

  try {
    const response = await fetchLetterboxdRss(cleanUsername);
    const rss = await response.text();
    const movies = parseLetterboxdRss(rss);

    if (movies.length === 0) {
      throw new LetterboxdImportException(
        "NO_MOVIES_FOUND",
        "We couldn't find any public movies for this profile."
      );
    }

    return buildImportResult(cleanUsername, movies);
  } catch (error) {
    const importError = toImportException(error);

    if (shouldUseDevelopmentFallback(importError)) {
      console.warn(
        "Letterboxd import failed in development; using fallback data.",
        importError
      );
      return buildImportResult(cleanUsername, fallbackMovies, true);
    }

    throw importError;
  }
}

export function parseLetterboxdRss(rss: string): Movie[] {
  if (!/<rss[\s>]/i.test(rss)) {
    throw new LetterboxdImportException(
      "PARSE_FAILED",
      "Letterboxd returned a response we could not parse."
    );
  }

  const itemMatches = rss.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const movies = itemMatches
    .map(parseLetterboxdItem)
    .filter((movie): movie is Movie => Boolean(movie));

  return prioritizeMovies(dedupeMovies(movies));
}

export function prioritizeMovies(movies: Movie[]): Movie[] {
  return [...movies].sort((first, second) => {
    const firstRating = first.rating ?? -1;
    const secondRating = second.rating ?? -1;
    const firstIsHighRated = firstRating >= 4 ? 1 : 0;
    const secondIsHighRated = secondRating >= 4 ? 1 : 0;

    if (firstIsHighRated !== secondIsHighRated) {
      return secondIsHighRated - firstIsHighRated;
    }

    if (firstRating !== secondRating) {
      return secondRating - firstRating;
    }

    return first.title.localeCompare(second.title);
  });
}

function buildImportResult(
  username: string,
  movies: Movie[],
  isFallbackData = false
): LetterboxdImportResult {
  return {
    username,
    movies: prioritizeMovies(movies),
    totalImported: movies.length,
    importedAt: new Date().toISOString(),
    ...(isFallbackData ? { isFallbackData: true } : {})
  };
}

async function fetchLetterboxdRss(username: string): Promise<Response> {
  const url = `${LETTERBOXD_BASE_URL}/${encodeURIComponent(username)}/rss/`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml,text/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "BoxdReads/0.1"
    }
  });

  if (response.status === 404) {
    throw new LetterboxdImportException(
      "USER_NOT_FOUND",
      "We couldn't find that Letterboxd username."
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new LetterboxdImportException(
      "PRIVATE_PROFILE",
      "That Letterboxd profile is private or unavailable."
    );
  }

  if (!response.ok) {
    throw new LetterboxdImportException(
      "FETCH_FAILED",
      "Letterboxd is unavailable right now. Try again in a moment."
    );
  }

  return response;
}

function parseLetterboxdItem(itemXml: string): Movie | null {
  const title = getTagValue(itemXml, "letterboxd:filmTitle");

  if (!title) {
    return null;
  }

  const year = parseOptionalNumber(getTagValue(itemXml, "letterboxd:filmYear"));
  const rating = parseOptionalNumber(
    getTagValue(itemXml, "letterboxd:memberRating")
  );
  const letterboxdUrl = getTagValue(itemXml, "link");
  const posterUrl = getPosterUrl(getTagValue(itemXml, "description") ?? "");

  return {
    title,
    ...(year !== undefined ? { year } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(letterboxdUrl ? { letterboxdUrl } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    source: "letterboxd"
  };
}

function dedupeMovies(movies: Movie[]): Movie[] {
  const seen = new Set<string>();
  const uniqueMovies: Movie[] = [];

  for (const movie of movies) {
    const key = movie.letterboxdUrl
      ? normalizeDedupeValue(movie.letterboxdUrl)
      : `${normalizeDedupeValue(movie.title)}-${movie.year ?? "unknown"}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueMovies.push(movie);
  }

  return uniqueMovies;
}

function getTagValue(xml: string, tagName: string): string | undefined {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<${escapedTagName}[^>]*>([\\s\\S]*?)<\\/${escapedTagName}>`, "i")
  );

  if (!match?.[1]) {
    return undefined;
  }

  return decodeXmlValue(match[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, ""));
}

function getPosterUrl(description: string): string | undefined {
  const match = description.match(/<img[^>]+src=["']([^"']+)["']/i);

  return match?.[1] ? decodeXmlValue(match[1]) : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, "");
}

function normalizeDedupeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

function decodeXmlValue(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: "\""
  };

  return value.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, key) => {
    if (key.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    }

    if (key.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    }

    return entities[key.toLowerCase()] ?? entity;
  });
}

function shouldUseDevelopmentFallback(
  error: LetterboxdImportException
): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    error.code === "FETCH_FAILED"
  );
}

function toImportException(error: unknown): LetterboxdImportException {
  if (error instanceof LetterboxdImportException) {
    return error;
  }

  return new LetterboxdImportException(
    "FETCH_FAILED",
    "Letterboxd is unavailable right now. Try again in a moment."
  );
}
