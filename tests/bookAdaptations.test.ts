import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  matchBookAdaptations,
  type BookAdaptationMatchResult
} from "../src/lib/bookAdaptations";
import {
  searchGoogleBooksBySourceWork,
  searchGoogleBooksByTitle
} from "../src/lib/googleBooks";
import type { Movie } from "../src/lib/letterboxd";
import { clearLookupCaches } from "../src/lib/lookupCache";
import {
  findWikidataSourceWorksForMovie,
  type WikidataSourceWork
} from "../src/lib/wikidata";

beforeEach(() => {
  clearLookupCaches();
});

function buildMovie(overrides: Partial<Movie>): Movie {
  return {
    title: "Arrival",
    source: "letterboxd",
    ...overrides
  };
}

function buildSourceWork(overrides: Partial<WikidataSourceWork>): WikidataSourceWork {
  return {
    id: "Q7620415",
    title: "Story of Your Life",
    authors: ["Ted Chiang"],
    publishedDate: "1998-11-01",
    description: "1998 novella by Ted Chiang",
    wikidataUrl: "https://www.wikidata.org/wiki/Q7620415",
    filmId: "Q20382729",
    filmTitle: "Arrival",
    filmYear: 2016,
    ...overrides
  };
}

function firstMatch(result: BookAdaptationMatchResult) {
  const match = result.matches[0];
  assert.ok(match);
  return match;
}

describe("matchBookAdaptations", () => {
  it("checks source metadata before searching Google Books", async () => {
    const result = await matchBookAdaptations([buildMovie({ title: "Blade Runner" })], {
      findSourceWorks: async () => [
        buildSourceWork({
          id: "Q203237",
          title: "Do Androids Dream of Electric Sheep?",
          authors: ["Philip K. Dick"],
          publishedDate: "1968"
        })
      ],
      searchBooks: async () => [
        {
          id: "androids",
          title: "Do Androids Dream of Electric Sheep?",
          authors: ["Philip K. Dick"],
          publishedDate: "1996"
        }
      ]
    });
    const match = firstMatch(result);

    assert.equal(result.unmatchedCount, 0);
    assert.equal(result.sourceLookupCount, 1);
    assert.equal(result.googleBooksSearchCount, 1);
    assert.equal(result.adaptedMovieCount, 1);
    assert.equal(match.adaptation.sourceTitle, "Do Androids Dream of Electric Sheep?");
    assert.equal(match.adaptation.bookTitle, "Do Androids Dream of Electric Sheep?");
    assert.equal(match.adaptation.bookAuthor, "Philip K. Dick");
    assert.equal(match.adaptation.bookYear, 1968);
    assert.equal(match.confidence, "high");
    assert.equal(match.matchedOn, "wikidata-source-title-author");
  });

  it("does not search Google Books when a movie has no book-adaptation source", async () => {
    let googleBooksCalls = 0;
    const result = await matchBookAdaptations([buildMovie({ title: "Original Movie" })], {
      findSourceWorks: async () => [],
      searchBooks: async () => {
        googleBooksCalls += 1;
        return [];
      }
    });

    assert.equal(result.matches.length, 0);
    assert.equal(result.unmatchedCount, 1);
    assert.equal(result.sourceLookupCount, 1);
    assert.equal(result.googleBooksSearchCount, 0);
    assert.equal(result.adaptedMovieCount, 0);
    assert.equal(googleBooksCalls, 0);
  });

  it("matches source stories inside containing Google Books volumes", async () => {
    const result = await matchBookAdaptations([buildMovie({ title: "Arrival" })], {
      findSourceWorks: async () => [buildSourceWork({ title: "Story of Your Life" })],
      searchBooks: async () => [
        {
          id: "stories",
          title: "Stories of Your Life and Others",
          authors: ["Ted Chiang"],
          description:
            "A collection including Story of Your Life, the novella adapted into Arrival."
        }
      ]
    });
    const match = firstMatch(result);

    assert.equal(match.adaptation.sourceTitle, "Story of Your Life");
    assert.equal(match.adaptation.bookTitle, "Stories of Your Life and Others");
    assert.equal(match.confidence, "medium");
    assert.equal(match.matchedOn, "wikidata-source-containing-volume");
  });

  it("returns unmatched movie counts for mixed source results", async () => {
    const result = await matchBookAdaptations(
      [
        buildMovie({ title: "Dune" }),
        buildMovie({ title: "A Movie Not In The Dataset", year: 2024 })
      ],
      {
        findSourceWorks: async (movie) =>
          movie.title === "Dune"
            ? [
                buildSourceWork({
                  id: "Q190192",
                  title: "Dune",
                  authors: ["Frank Herbert"],
                  publishedDate: "1965"
                })
              ]
            : [],
        searchBooks: async () => [
          {
            id: "dune",
            title: "Dune",
            authors: ["Frank Herbert"]
          }
        ]
      }
    );

    assert.equal(result.totalMovies, 2);
    assert.equal(result.sourceLookupCount, 2);
    assert.equal(result.googleBooksSearchCount, 1);
    assert.equal(result.adaptedMovieCount, 1);
    assert.equal(result.matches.length, 1);
    assert.equal(result.unmatchedCount, 1);
    assert.deepEqual(
      result.unmatchedMovies.map((movie) => movie.title),
      ["A Movie Not In The Dataset"]
    );
  });

  it("returns empty results for empty input", async () => {
    const result = await matchBookAdaptations([]);

    assert.deepEqual(result, {
      matches: [],
      unmatchedMovies: [],
      unmatchedCount: 0,
      sourceLookupCount: 0,
      googleBooksSearchCount: 0,
      adaptedMovieCount: 0,
      searchedCount: 0,
      totalMovies: 0
    });
  });

  it("stops searching and returns a lookup error when source lookup fails", async () => {
    const result = await matchBookAdaptations([buildMovie({ title: "Arrival" })], {
      findSourceWorks: async () => {
        throw new Error("network went sideways");
      }
    });

    assert.equal(result.matches.length, 0);
    assert.equal(result.unmatchedCount, 1);
    assert.equal(result.sourceLookupCount, 0);
    assert.equal(result.googleBooksSearchCount, 0);
    assert.equal(
      result.lookupError,
      "Adaptation lookup failed before every imported movie could be searched."
    );
  });

  it("stops searching and returns a lookup error when Google Books fails", async () => {
    const result = await matchBookAdaptations([buildMovie({ title: "Arrival" })], {
      findSourceWorks: async () => [buildSourceWork({ title: "Story of Your Life" })],
      searchBooks: async () => {
        throw new Error("Google Books went sideways");
      }
    });

    assert.equal(result.matches.length, 0);
    assert.equal(result.unmatchedCount, 1);
    assert.equal(result.sourceLookupCount, 1);
    assert.equal(result.googleBooksSearchCount, 0);
    assert.equal(
      result.lookupError,
      "Adaptation lookup failed before every imported movie could be searched."
    );
  });
});

describe("searchGoogleBooksByTitle", () => {
  it("requests Google Books volumes by intitle query and normalizes results", async () => {
    let requestedUrl = "";
    const books = await searchGoogleBooksByTitle("Dune", {
      apiKey: "test-key",
      fetcher: async (input) => {
        requestedUrl = input;
        return Response.json({
          items: [
            {
              id: "dune",
              volumeInfo: {
                title: "Dune",
                authors: ["Frank Herbert"],
                publishedDate: "1965-08-01",
                infoLink: "https://books.google.com/books?id=dune"
              }
            }
          ]
        });
      }
    });

    const url = new URL(requestedUrl);

    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(url.pathname, "/books/v1/volumes");
    assert.equal(url.searchParams.get("q"), 'intitle:"Dune"');
    assert.equal(url.searchParams.get("printType"), "books");
    assert.equal(url.searchParams.get("projection"), "lite");
    assert.equal(url.searchParams.get("key"), "test-key");
    assert.deepEqual(books, [
      {
        id: "dune",
        title: "Dune",
        authors: ["Frank Herbert"],
        publishedDate: "1965-08-01",
        infoLink: "https://books.google.com/books?id=dune"
      }
    ]);
  });
});

describe("searchGoogleBooksBySourceWork", () => {
  it("requests Google Books by source title and author", async () => {
    let requestedUrl = "";

    await searchGoogleBooksBySourceWork("Story of Your Life", ["Ted Chiang"], {
      fetcher: async (input) => {
        requestedUrl = input;
        return Response.json({ items: [] });
      }
    });

    const url = new URL(requestedUrl);

    assert.equal(
      url.searchParams.get("q"),
      'intitle:"Story of Your Life" inauthor:"Ted Chiang"'
    );
  });

  it("caches repeated Google Books source-work searches", async () => {
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount += 1;
      return Response.json({
        items: [
          {
            id: "story-of-your-life",
            volumeInfo: {
              title: "Stories of Your Life and Others",
              authors: ["Ted Chiang"]
            }
          }
        ]
      });
    };

    const firstResult = await searchGoogleBooksBySourceWork(
      "Story of Your Life",
      ["Ted Chiang"],
      { fetcher }
    );
    const secondResult = await searchGoogleBooksBySourceWork(
      "Story of Your Life",
      ["Ted Chiang"],
      { fetcher }
    );

    assert.equal(fetchCount, 1);
    assert.deepEqual(secondResult, firstResult);
  });
});

describe("findWikidataSourceWorksForMovie", () => {
  it("caches repeated movie source-work lookups", async () => {
    let fetchCount = 0;
    const fetcher = async (input: string) => {
      fetchCount += 1;
      const url = new URL(input);
      const action = url.searchParams.get("action");

      if (action === "wbsearchentities") {
        const search = url.searchParams.get("search");

        return Response.json({
          search:
            search === "Dune: Part One"
              ? [
                  {
                    id: "Q60834962",
                    label: "Dune",
                    description: "2021 film directed by Denis Villeneuve"
                  }
                ]
              : []
        });
      }

      if (action === "wbgetclaims") {
        return Response.json({
          claims: {
            P144: [
              {
                mainsnak: {
                  datavalue: {
                    value: {
                      id: "Q190192"
                    }
                  }
                },
                qualifiers: {
                  P50: [
                    {
                      datavalue: {
                        value: {
                          id: "Q7934"
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        });
      }

      if (action === "wbgetentities") {
        const ids = url.searchParams.get("ids");

        if (ids === "Q190192") {
          return Response.json({
            entities: {
              Q190192: {
                labels: {
                  en: {
                    value: "Dune"
                  }
                },
                descriptions: {
                  en: {
                    value: "1965 science fiction novel by Frank Herbert"
                  }
                }
              }
            }
          });
        }

        return Response.json({
          entities: {
            Q7934: {
              labels: {
                mul: {
                  value: "Frank Herbert"
                }
              }
            }
          }
        });
      }

      throw new Error(`Unhandled Wikidata test URL: ${input}`);
    };

    const movie = buildMovie({ title: "Dune: Part One", year: 2021 });
    const firstResult = await findWikidataSourceWorksForMovie(movie, { fetcher });
    const fetchCountAfterFirstLookup = fetchCount;
    const secondResult = await findWikidataSourceWorksForMovie(movie, { fetcher });

    assert.equal(fetchCountAfterFirstLookup, 5);
    assert.equal(fetchCount, fetchCountAfterFirstLookup);
    assert.deepEqual(secondResult, firstResult);
    assert.equal(secondResult[0]?.title, "Dune");
    assert.deepEqual(secondResult[0]?.authors, ["Frank Herbert"]);
  });
});
