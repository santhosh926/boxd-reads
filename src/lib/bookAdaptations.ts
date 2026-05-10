import type { Movie } from "./letterboxd";
import {
  GoogleBooksSearchException,
  searchGoogleBooksBySourceWork,
  searchGoogleBooksByTitle,
  type GoogleBook
} from "./googleBooks";
import {
  findWikidataSourceWorksForMovie,
  WikidataSourceLookupException,
  type WikidataSourceWork
} from "./wikidata";

export type MatchConfidence = "high" | "medium";

export type BookAdaptation = {
  id: string;
  movieTitle: string;
  sourceTitle: string;
  sourceAuthor: string;
  sourceYear?: number;
  bookTitle: string;
  bookAuthor: string;
  bookYear?: number;
  detail: string;
  wikidataUrl?: string;
  googleBooksUrl?: string;
};

export type BookAdaptationMatch = {
  id: string;
  movie: Movie;
  sourceWork: WikidataSourceWork;
  adaptation: BookAdaptation;
  confidence: MatchConfidence;
  matchedOn:
    | "wikidata-source-title-author"
    | "wikidata-source-title"
    | "wikidata-source-containing-volume";
  reason: string;
};

export type BookAdaptationMatchResult = {
  matches: BookAdaptationMatch[];
  unmatchedMovies: Movie[];
  unmatchedCount: number;
  sourceLookupCount: number;
  googleBooksSearchCount: number;
  adaptedMovieCount: number;
  searchedCount: number;
  totalMovies: number;
  lookupError?: string;
};

type FindSourceWorksForMovie = (movie: Movie) => Promise<WikidataSourceWork[]>;
type SearchBooksForSourceWork = (sourceWork: WikidataSourceWork) => Promise<GoogleBook[]>;

type BookAdaptationMatcherOptions = {
  findSourceWorks?: FindSourceWorksForMovie;
  searchBooks?: SearchBooksForSourceWork;
};

type GoogleBookScore = {
  book: GoogleBook;
  sourceWork: WikidataSourceWork;
  confidence: MatchConfidence;
  matchedOn: BookAdaptationMatch["matchedOn"];
  score: number;
};

type ScoredBookAdaptationMatch = BookAdaptationMatch & {
  score: number;
};

export async function matchBookAdaptations(
  movies: Movie[],
  options: BookAdaptationMatcherOptions = {}
): Promise<BookAdaptationMatchResult> {
  const matches: BookAdaptationMatch[] = [];
  const unmatchedMovies: Movie[] = [];
  const findSourceWorks = options.findSourceWorks ?? findWikidataSourceWorksForMovie;
  const searchBooks = options.searchBooks ?? searchGoogleBooksForSourceWork;
  let sourceLookupCount = 0;
  let googleBooksSearchCount = 0;
  let adaptedMovieCount = 0;
  let lookupError: string | undefined;

  for (let index = 0; index < movies.length; index += 1) {
    const movie = movies[index];
    let sourceWorks: WikidataSourceWork[];

    try {
      sourceWorks = await findSourceWorks(movie);
      sourceLookupCount += 1;
    } catch (error) {
      lookupError = toLookupErrorMessage(error);
      unmatchedMovies.push(...movies.slice(index));
      break;
    }

    if (sourceWorks.length === 0) {
      unmatchedMovies.push(movie);
      continue;
    }

    adaptedMovieCount += 1;
    const movieMatches: ScoredBookAdaptationMatch[] = [];
    let shouldStop = false;

    for (const sourceWork of sourceWorks) {
      let books: GoogleBook[];

      try {
        books = await searchBooks(sourceWork);
        googleBooksSearchCount += 1;
      } catch (error) {
        lookupError = toLookupErrorMessage(error);
        unmatchedMovies.push(...movies.slice(index));
        shouldStop = true;
        break;
      }

      const match = matchSourceWorkToGoogleBooks(movie, sourceWork, books);

      if (match) {
        movieMatches.push(match);
      }
    }

    if (shouldStop) {
      break;
    }

    if (movieMatches.length === 0) {
      unmatchedMovies.push(movie);
      continue;
    }

    matches.push(stripScore(movieMatches.sort((first, second) => second.score - first.score)[0]));
  }

  return {
    matches,
    unmatchedMovies,
    unmatchedCount: unmatchedMovies.length,
    sourceLookupCount,
    googleBooksSearchCount,
    adaptedMovieCount,
    searchedCount: googleBooksSearchCount,
    totalMovies: movies.length,
    ...(lookupError ? { lookupError } : {})
  };
}

async function searchGoogleBooksForSourceWork(
  sourceWork: WikidataSourceWork
): Promise<GoogleBook[]> {
  const seenBookIds = new Set<string>();
  const books: GoogleBook[] = [];
  const searches = [
    () => searchGoogleBooksBySourceWork(sourceWork.title, sourceWork.authors),
    ...(sourceWork.authors.length > 0
      ? [() => searchGoogleBooksByTitle(sourceWork.title)]
      : [])
  ];

  for (const search of searches) {
    const titleBooks = await search();

    for (const book of titleBooks) {
      if (seenBookIds.has(book.id)) {
        continue;
      }

      seenBookIds.add(book.id);
      books.push(book);
    }

    if (books.length > 0) {
      break;
    }
  }

  return books;
}

function matchSourceWorkToGoogleBooks(
  movie: Movie,
  sourceWork: WikidataSourceWork,
  books: GoogleBook[]
): ScoredBookAdaptationMatch | null {
  const scoredBooks = books
    .map((book) => scoreGoogleBook(sourceWork, book))
    .filter((score): score is GoogleBookScore => Boolean(score))
    .sort((first, second) => second.score - first.score);

  if (scoredBooks.length === 0) {
    return null;
  }

  return buildMatch(movie, scoredBooks[0]);
}

function scoreGoogleBook(
  sourceWork: WikidataSourceWork,
  book: GoogleBook
): GoogleBookScore | null {
  const sourceTitle = normalizeTitle(sourceWork.title);
  const bookTitle = normalizeTitle(book.title);
  const fullBookTitle = normalizeTitle([book.title, book.subtitle].filter(Boolean).join(" "));
  const searchableBookText = normalizeTitle(
    [book.title, book.subtitle, book.description].filter(Boolean).join(" ")
  );
  const authorMatches = hasAuthorMatch(sourceWork.authors, book.authors);
  const exactTitle = bookTitle === sourceTitle || fullBookTitle === sourceTitle;

  if (exactTitle && authorMatches) {
    return {
      book,
      sourceWork,
      confidence: "high",
      matchedOn: "wikidata-source-title-author",
      score: 120
    };
  }

  if (exactTitle) {
    return {
      book,
      sourceWork,
      confidence: "high",
      matchedOn: "wikidata-source-title",
      score: 110
    };
  }

  if (startsWithTitle(fullBookTitle, sourceTitle)) {
    return {
      book,
      sourceWork,
      confidence: authorMatches ? "high" : "medium",
      matchedOn: authorMatches
        ? "wikidata-source-title-author"
        : "wikidata-source-title",
      score: authorMatches ? 100 : 90
    };
  }

  if (containsSourceTitle(searchableBookText, sourceTitle)) {
    return {
      book,
      sourceWork,
      confidence: "medium",
      matchedOn: "wikidata-source-containing-volume",
      score: authorMatches ? 85 : 75
    };
  }

  return null;
}

function buildMatch(
  movie: Movie,
  score: GoogleBookScore
): ScoredBookAdaptationMatch {
  const sourceYear = getPublishedYear(score.sourceWork.publishedDate);
  const bookYear = sourceYear ?? getPublishedYear(score.book.publishedDate);
  const sourceAuthor = score.sourceWork.authors.join(", ") || "Unknown author";

  return {
    id: `wikidata-${score.sourceWork.id}-google-books-${score.book.id}-${normalizeTitle(movie.title)}`,
    movie,
    sourceWork: score.sourceWork,
    adaptation: {
      id: score.book.id,
      movieTitle: movie.title,
      sourceTitle: score.sourceWork.title,
      sourceAuthor,
      ...(sourceYear ? { sourceYear } : {}),
      bookTitle: score.book.title,
      bookAuthor: score.book.authors.join(", ") || sourceAuthor,
      ...(bookYear ? { bookYear } : {}),
      detail: getBookDetail(movie, score.sourceWork, score.book),
      wikidataUrl: score.sourceWork.wikidataUrl,
      ...(score.book.infoLink || score.book.previewLink
        ? { googleBooksUrl: score.book.infoLink ?? score.book.previewLink }
        : {})
    },
    confidence: score.confidence,
    matchedOn: score.matchedOn,
    reason: getMatchReason(score),
    score: score.score
  };
}

function stripScore(match: ScoredBookAdaptationMatch): BookAdaptationMatch {
  const { score: _score, ...bookMatch } = match;
  return bookMatch;
}

function getMatchReason(score: GoogleBookScore): string {
  if (score.matchedOn === "wikidata-source-title-author") {
    return `Wikidata identifies "${score.sourceWork.title}" as the source work; Google Books matched the source title and author.`;
  }

  if (score.matchedOn === "wikidata-source-title") {
    return `Wikidata identifies "${score.sourceWork.title}" as the source work; Google Books matched that source title.`;
  }

  return `Wikidata identifies "${score.sourceWork.title}" as the source work; Google Books matched it inside a containing volume.`;
}

function getBookDetail(
  movie: Movie,
  sourceWork: WikidataSourceWork,
  book: GoogleBook
): string {
  if (!book.description) {
    const author = sourceWork.authors.length > 0 ? ` by ${sourceWork.authors.join(", ")}` : "";

    return `Wikidata identifies "${movie.title}" as based on "${sourceWork.title}"${author}. Google Books returned a matching book record.`;
  }

  const cleanedDescription = book.description
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanedDescription.length <= 220) {
    return cleanedDescription;
  }

  return `${cleanedDescription.slice(0, 217).trim()}...`;
}

function getPublishedYear(publishedDate?: string): number | undefined {
  const year = publishedDate?.match(/^[+-]?(\d{4})/)?.[1];

  if (!year) {
    return undefined;
  }

  const parsedYear = Number(year);
  return Number.isFinite(parsedYear) ? parsedYear : undefined;
}

function startsWithTitle(value: string, title: string): boolean {
  return value === title || value.startsWith(`${title} `);
}

function containsSourceTitle(value: string, sourceTitle: string): boolean {
  if (value.includes(sourceTitle)) {
    return true;
  }

  const sourceTokens = toTitleTokens(sourceTitle);

  if (sourceTokens.length < 2) {
    return false;
  }

  const valueTokens = new Set(toTitleTokens(value));
  return sourceTokens.every((token) => valueTokens.has(token));
}

function hasAuthorMatch(sourceAuthors: string[], bookAuthors: string[]): boolean {
  return sourceAuthors.some((sourceAuthor) =>
    bookAuthors.some((bookAuthor) => namesMatch(sourceAuthor, bookAuthor))
  );
}

function namesMatch(first: string, second: string): boolean {
  const firstTokens = toNameTokens(first);
  const secondTokens = toNameTokens(second);

  if (firstTokens.length === 0 || secondTokens.length === 0) {
    return false;
  }

  const firstTokenSet = new Set(firstTokens);
  const secondTokenSet = new Set(secondTokens);

  return (
    firstTokens.every((token) => secondTokenSet.has(token)) ||
    secondTokens.every((token) => firstTokenSet.has(token))
  );
}

function toTitleTokens(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .map(stemToken)
    .filter((token) => token.length > 2 && !["and", "the", "for", "with"].includes(token));
}

function toNameTokens(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function stemToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
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

function toLookupErrorMessage(error: unknown): string {
  if (error instanceof GoogleBooksSearchException) {
    return error.message;
  }

  if (error instanceof WikidataSourceLookupException) {
    return error.message;
  }

  return "Adaptation lookup failed before every imported movie could be searched.";
}
