import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  matchBookAdaptations,
  type BookAdaptationMatchResult
} from "../src/lib/bookAdaptations";
import type { Movie } from "../src/lib/letterboxd";
import { clearLookupCaches } from "../src/lib/lookupCache";
import {
  searchOpenLibraryBySourceWork,
  searchOpenLibraryByTitle,
  type OpenLibraryBook
} from "../src/lib/openLibrary";
import type { SourceWork } from "../src/lib/sourceWorkTypes";
import {
  findWikipediaSourceWorksForMovie,
  parseWikipediaBasedOnValue
} from "../src/lib/wikipedia";
import {
  findWikidataSourceWorksForMovie
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

function buildSourceWork(overrides: Partial<SourceWork>): SourceWork {
  return {
    id: "wikipedia-43991244-story-of-your-life",
    title: "Story of Your Life",
    authors: ["Ted Chiang"],
    publishedDate: "1998-11-01",
    description: "1998 novella by Ted Chiang",
    sourceDataUrl: "https://en.wikipedia.org/wiki/Arrival_(film)",
    sourceProvider: "wikipedia",
    filmId: "43991244",
    filmTitle: "Arrival",
    filmYear: 2016,
    ...overrides
  };
}

function buildOpenLibraryBook(
  overrides: Partial<OpenLibraryBook>
): OpenLibraryBook {
  return {
    id: "OL6216050W",
    title: "Stories of Your Life and Others",
    authors: ["Ted Chiang"],
    publishedDate: "2002",
    goodreadsId: "223380",
    goodreadsUrl: "https://www.goodreads.com/book/show/223380",
    isGoodreadsSearchFallback: false,
    ...overrides
  };
}

function firstMatch(result: BookAdaptationMatchResult) {
  const match = result.matches[0];
  assert.ok(match);
  return match;
}

describe("matchBookAdaptations", () => {
  it("checks source metadata before searching Open Library", async () => {
    const result = await matchBookAdaptations([buildMovie({ title: "Blade Runner" })], {
      findSourceWorks: async () => [
        buildSourceWork({
          id: "wikipedia-123-androids",
          title: "Do Androids Dream of Electric Sheep?",
          authors: ["Philip K. Dick"],
          publishedDate: "1968"
        })
      ],
      searchBooks: async () => [
        buildOpenLibraryBook({
          id: "OL203237W",
          title: "Do Androids Dream of Electric Sheep?",
          authors: ["Philip K. Dick"],
          publishedDate: "1996",
          goodreadsUrl: "https://www.goodreads.com/book/show/7082"
        })
      ]
    });
    const match = firstMatch(result);

    assert.equal(result.unmatchedCount, 0);
    assert.equal(result.sourceLookupCount, 1);
    assert.equal(result.bookLookupCount, 1);
    assert.equal(result.adaptedMovieCount, 1);
    assert.equal(match.adaptation.sourceTitle, "Do Androids Dream of Electric Sheep?");
    assert.equal(match.adaptation.bookTitle, "Do Androids Dream of Electric Sheep?");
    assert.equal(match.adaptation.bookAuthor, "Philip K. Dick");
    assert.equal(match.adaptation.bookYear, 1968);
    assert.equal(match.adaptation.goodreadsUrl, "https://www.goodreads.com/book/show/7082");
    assert.equal(match.adaptation.sourceDataUrl, "https://en.wikipedia.org/wiki/Arrival_(film)");
    assert.equal(match.confidence, "high");
    assert.equal(match.matchedOn, "source-title-author");
  });

  it("does not search books when a movie has no book-adaptation source", async () => {
    let bookLookupCalls = 0;
    const result = await matchBookAdaptations([buildMovie({ title: "Original Movie" })], {
      findSourceWorks: async () => [],
      searchBooks: async () => {
        bookLookupCalls += 1;
        return [];
      }
    });

    assert.equal(result.matches.length, 0);
    assert.equal(result.unmatchedCount, 1);
    assert.equal(result.sourceLookupCount, 1);
    assert.equal(result.bookLookupCount, 0);
    assert.equal(result.adaptedMovieCount, 0);
    assert.equal(bookLookupCalls, 0);
  });

  it("matches source stories inside containing Open Library volumes", async () => {
    const result = await matchBookAdaptations([buildMovie({ title: "Arrival" })], {
      findSourceWorks: async () => [buildSourceWork({ title: "Story of Your Life" })],
      searchBooks: async () => [
        buildOpenLibraryBook({
          title: "Stories of Your Life and Others",
          authors: ["Ted Chiang"],
          description:
            "A collection including Story of Your Life, the novella adapted into Arrival."
        })
      ]
    });
    const match = firstMatch(result);

    assert.equal(match.adaptation.sourceTitle, "Story of Your Life");
    assert.equal(match.adaptation.bookTitle, "Stories of Your Life and Others");
    assert.equal(match.confidence, "medium");
    assert.equal(match.matchedOn, "source-containing-volume");
  });

  it("rejects Open Library title mismatches", async () => {
    const result = await matchBookAdaptations([buildMovie({ title: "Dune" })], {
      findSourceWorks: async () => [
        buildSourceWork({
          title: "Dune",
          authors: ["Frank Herbert"]
        })
      ],
      searchBooks: async () => [
        buildOpenLibraryBook({
          title: "Foundation",
          authors: ["Isaac Asimov"]
        })
      ]
    });

    assert.equal(result.matches.length, 0);
    assert.equal(result.unmatchedCount, 1);
  });

  it("keeps a source-title match when the Open Library author differs", async () => {
    const result = await matchBookAdaptations([buildMovie({ title: "Dune" })], {
      findSourceWorks: async () => [
        buildSourceWork({
          title: "Dune",
          authors: ["Frank Herbert"]
        })
      ],
      searchBooks: async () => [
        buildOpenLibraryBook({
          title: "Dune",
          authors: ["Brian Herbert"]
        })
      ]
    });
    const match = firstMatch(result);

    assert.equal(match.confidence, "high");
    assert.equal(match.matchedOn, "source-title");
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
                  id: "wikipedia-100-dune",
                  title: "Dune",
                  authors: ["Frank Herbert"],
                  publishedDate: "1965"
                })
              ]
            : [],
        searchBooks: async () => [
          buildOpenLibraryBook({
            id: "OL893415W",
            title: "Dune",
            authors: ["Frank Herbert"]
          })
        ]
      }
    );

    assert.equal(result.totalMovies, 2);
    assert.equal(result.sourceLookupCount, 2);
    assert.equal(result.bookLookupCount, 1);
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
      bookLookupCount: 0,
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
    assert.equal(result.bookLookupCount, 0);
    assert.equal(
      result.lookupError,
      "Adaptation lookup failed before every imported movie could be searched."
    );
  });

  it("stops searching and returns a lookup error when Open Library fails", async () => {
    const result = await matchBookAdaptations([buildMovie({ title: "Arrival" })], {
      findSourceWorks: async () => [buildSourceWork({ title: "Story of Your Life" })],
      searchBooks: async () => {
        throw new Error("Open Library went sideways");
      }
    });

    assert.equal(result.matches.length, 0);
    assert.equal(result.unmatchedCount, 1);
    assert.equal(result.sourceLookupCount, 1);
    assert.equal(result.bookLookupCount, 0);
    assert.equal(
      result.lookupError,
      "Showing partial results after 1 source checks. Adaptation lookup failed before every imported movie could be searched."
    );
  });
});

describe("searchOpenLibraryBySourceWork", () => {
  it("requests Open Library by title and author and builds a direct Goodreads URL", async () => {
    const requestedUrls: string[] = [];
    const books = await searchOpenLibraryBySourceWork("Dune", ["Frank Herbert"], {
      fetcher: async (input) => {
        requestedUrls.push(input);
        const url = new URL(input);

        if (url.pathname === "/search.json") {
          return Response.json({
            docs: [
              {
                key: "/works/OL893415W",
                title: "Dune",
                author_name: ["Frank Herbert"],
                first_publish_year: 1965,
                editions: {
                  docs: []
                }
              }
            ]
          });
        }

        if (url.pathname === "/works/OL893415W/editions.json") {
          return Response.json({
            entries: [
              {
                key: "/books/OL123M",
                identifiers: {
                  goodreads: ["234225"]
                },
                description: "Frank Herbert's classic science fiction novel."
              }
            ]
          });
        }

        throw new Error(`Unhandled Open Library test URL: ${input}`);
      }
    });

    const searchUrl = new URL(requestedUrls[0]);

    assert.equal(searchUrl.origin, "https://openlibrary.org");
    assert.equal(searchUrl.pathname, "/search.json");
    assert.equal(searchUrl.searchParams.get("title"), "Dune");
    assert.equal(searchUrl.searchParams.get("author"), "Frank Herbert");
    assert.deepEqual(books, [
      {
        id: "OL893415W",
        title: "Dune",
        authors: ["Frank Herbert"],
        publishedDate: "1965",
        description: "Frank Herbert's classic science fiction novel.",
        openLibraryUrl: "https://openlibrary.org/works/OL893415W",
        goodreadsId: "234225",
        goodreadsUrl: "https://www.goodreads.com/book/show/234225",
        isGoodreadsSearchFallback: false
      }
    ]);
  });

  it("falls back to a Goodreads search URL when Open Library has no Goodreads id", async () => {
    const books = await searchOpenLibraryBySourceWork("Dune", ["Frank Herbert"], {
      fetcher: async (input) => {
        const url = new URL(input);

        if (url.pathname === "/search.json") {
          return Response.json({
            docs: [
              {
                key: "/works/OL893415W",
                title: "Dune",
                author_name: ["Frank Herbert"]
              }
            ]
          });
        }

        if (url.pathname === "/works/OL893415W/editions.json") {
          return Response.json({ entries: [{ key: "/books/OL123M" }] });
        }

        throw new Error(`Unhandled Open Library test URL: ${input}`);
      }
    });

    assert.equal(books[0]?.isGoodreadsSearchFallback, true);
    assert.equal(
      books[0]?.goodreadsUrl,
      "https://www.goodreads.com/search?q=Dune+Frank+Herbert"
    );
  });

  it("caches repeated Open Library source-work searches", async () => {
    let fetchCount = 0;
    const fetcher = async (input: string) => {
      fetchCount += 1;
      const url = new URL(input);

      if (url.pathname === "/search.json") {
        return Response.json({
          docs: [
            {
              key: "/works/OL6216050W",
              title: "Stories of Your Life and Others",
              author_name: ["Ted Chiang"]
            }
          ]
        });
      }

      if (url.pathname === "/works/OL6216050W/editions.json") {
        return Response.json({ entries: [] });
      }

      throw new Error(`Unhandled Open Library test URL: ${input}`);
    };

    const firstResult = await searchOpenLibraryBySourceWork(
      "Story of Your Life",
      ["Ted Chiang"],
      { fetcher }
    );
    const secondResult = await searchOpenLibraryBySourceWork(
      "Story of Your Life",
      ["Ted Chiang"],
      { fetcher }
    );

    assert.equal(fetchCount, 2);
    assert.deepEqual(secondResult, firstResult);
  });
});

describe("searchOpenLibraryByTitle", () => {
  it("requests Open Library by title without an author", async () => {
    let requestedUrl = "";

    await searchOpenLibraryByTitle("Story of Your Life", {
      fetcher: async (input) => {
        requestedUrl = input;
        return Response.json({ docs: [] });
      }
    });

    const url = new URL(requestedUrl);

    assert.equal(url.searchParams.get("title"), "Story of Your Life");
    assert.equal(url.searchParams.get("author"), null);
  });
});

describe("findWikipediaSourceWorksForMovie", () => {
  it("extracts a Based on template from a Wikipedia film infobox", async () => {
    const sourceWorks = await findWikipediaSourceWorksForMovie(
      buildMovie({ title: "Arrival", year: 2016 }),
      {
        fetcher: buildWikipediaFetcher(
          "Arrival (film)",
          `{{Infobox film
| name = Arrival
| based_on = {{Based on|"[[Story of Your Life]]"|[[Ted Chiang]]}}
}}`
        )
      }
    );

    assert.equal(sourceWorks[0]?.title, "Story of Your Life");
    assert.deepEqual(sourceWorks[0]?.authors, ["Ted Chiang"]);
    assert.equal(sourceWorks[0]?.sourceProvider, "wikipedia");
    assert.equal(sourceWorks[0]?.sourceDataUrl, "https://en.wikipedia.org/wiki/Arrival_(film)");
  });

  it("extracts linked plain-text based_on values from a Wikipedia film infobox", async () => {
    const sourceWorks = await findWikipediaSourceWorksForMovie(
      buildMovie({ title: "Dune", year: 2021 }),
      {
        fetcher: buildWikipediaFetcher(
          "Dune (2021 film)",
          `{{Infobox film
| name = Dune
| based_on = ''[[Dune (novel)|Dune]]'' by [[Frank Herbert]]
}}`
        )
      }
    );

    assert.equal(sourceWorks[0]?.title, "Dune");
    assert.deepEqual(sourceWorks[0]?.authors, ["Frank Herbert"]);
  });

  it("extracts plain source-work text from a Wikipedia film infobox", async () => {
    const sourceWorks = await findWikipediaSourceWorksForMovie(
      buildMovie({ title: "No Country for Old Men", year: 2007 }),
      {
        fetcher: buildWikipediaFetcher(
          "No Country for Old Men (film)",
          `{{Infobox film
| name = No Country for Old Men
| based_on = The novel No Country for Old Men by Cormac McCarthy
}}`
        )
      }
    );

    assert.equal(sourceWorks[0]?.title, "No Country for Old Men");
    assert.deepEqual(sourceWorks[0]?.authors, ["Cormac McCarthy"]);
  });

  it("returns no source work when based_on is missing", async () => {
    const sourceWorks = await findWikipediaSourceWorksForMovie(
      buildMovie({ title: "Original Movie", year: 2024 }),
      {
        fetcher: buildWikipediaFetcher(
          "Original Movie (film)",
          `{{Infobox film
| name = Original Movie
| director = Somebody
}}`
        )
      }
    );

    assert.deepEqual(sourceWorks, []);
  });

  it("ignores malformed Based on templates", () => {
    assert.deepEqual(parseWikipediaBasedOnValue("{{Based on|}}"), []);
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

function buildWikipediaFetcher(pageTitle: string, wikitext: string) {
  return async (input: string) => {
    const url = new URL(input);
    const pageKey = pageTitle.replace(/\s+/g, "_");

    if (url.hostname === "en.wikipedia.org" && url.searchParams.get("action") === "raw") {
      const requestedKey = decodeURIComponent(url.pathname.replace(/^\/wiki\//, ""));

      if (requestedKey === pageKey) {
        return new Response(wikitext);
      }

      return new Response("not found", { status: 404 });
    }

    if (url.pathname.endsWith("/search/page")) {
      return Response.json({
        pages: [
          {
            id: 12345,
            key: pageKey,
            title: pageTitle,
            excerpt: `${pageTitle} is a film.`
          }
        ]
      });
    }

    if (url.pathname.includes("/page/")) {
      return Response.json({
        id: 12345,
        key: pageKey,
        title: pageTitle,
        source: wikitext
      });
    }

    throw new Error(`Unhandled Wikipedia test URL: ${input}`);
  };
}
