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
        goodreadsUrl: "https://www.goodreads.com/book/show/234225"
      }
    ]);
  });

  it("uses a Goodreads ISBN URL when Open Library has no Goodreads id", async () => {
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
          return Response.json({
            entries: [
              {
                key: "/books/OL123M",
                isbn_13: ["9780441172719"]
              }
            ]
          });
        }

        throw new Error(`Unhandled Open Library test URL: ${input}`);
      }
    });

    assert.equal(books[0]?.goodreadsId, undefined);
    assert.equal(books[0]?.goodreadsUrl, "https://www.goodreads.com/book/isbn/9780441172719");
  });

  it("ignores translated Goodreads identifiers when an original-looking edition exists", async () => {
    const books = await searchOpenLibraryBySourceWork("The Housemaid", ["Freida McFadden"], {
      fetcher: async (input) => {
        const url = new URL(input);

        if (url.pathname === "/search.json") {
          return Response.json({
            docs: [
              {
                key: "/works/OL27729743W",
                title: "The Housemaid",
                author_name: ["Freida McFadden"],
                first_publish_year: 2022
              }
            ]
          });
        }

        if (url.pathname === "/works/OL27729743W/editions.json") {
          return Response.json({
            entries: [
              {
                key: "/books/OL50515918M",
                title: "Pomoc domowa",
                publish_date: "2023",
                identifiers: {
                  goodreads: ["198541402"]
                },
                isbn_13: ["9788367815888"],
                languages: [{ key: "/languages/pol" }],
                translation_of: "The Housemaid",
                translated_from: [{ key: "/languages/eng" }],
                contributors: [{ role: "Translator", name: "Elzbieta Pawlik" }],
                description: "Polish description"
              },
              {
                key: "/books/OL37842696M",
                title: "The Housemaid",
                publish_date: "Apr 21, 2022",
                isbn_13: ["9781803144382"],
                description: "English description"
              }
            ]
          });
        }

        throw new Error(`Unhandled Open Library test URL: ${input}`);
      }
    });

    assert.equal(books[0]?.goodreadsId, undefined);
    assert.equal(books[0]?.goodreadsUrl, "https://www.goodreads.com/book/isbn/9781803144382");
    assert.equal(books[0]?.description, "English description");
  });

  it("ignores translated descriptions when selecting book metadata", async () => {
    const books = await searchOpenLibraryBySourceWork("Chainsaw Man, Vol. 1", ["Tatsuki Fujimoto"], {
      fetcher: async (input) => {
        const url = new URL(input);

        if (url.pathname === "/search.json") {
          return Response.json({
            docs: [
              {
                key: "/works/OL22142129W",
                title: "Chainsaw Man, Vol. 1",
                author_name: ["Tatsuki Fujimoto"],
                first_publish_year: 2019,
                editions: {
                  docs: [
                    {
                      key: "/books/OL30165195M",
                      title: "Chainsaw Man, Vol. 1",
                      publish_date: ["2020"],
                      isbn: ["9781974709939", "1974709930"]
                    }
                  ]
                }
              }
            ]
          });
        }

        if (url.pathname === "/works/OL22142129W/editions.json") {
          return Response.json({
            entries: [
              {
                key: "/books/OL49640203M",
                title: "Chainsaw Man, Vol. 1",
                publish_date: "2022-06-06",
                isbn_13: ["9788828717508"],
                languages: [{ key: "/languages/ita" }],
                description: "Italian description"
              },
              {
                key: "/books/OL30165195M",
                title: "Chainsaw Man, Vol. 1",
                publish_date: "2020",
                isbn_13: ["9781974709939"],
                languages: [{ key: "/languages/eng" }],
                translation_of: "Inu to Chenso"
              }
            ]
          });
        }

        throw new Error(`Unhandled Open Library test URL: ${input}`);
      }
    });

    assert.equal(books[0]?.description, undefined);
    assert.equal(books[0]?.goodreadsUrl, "https://www.goodreads.com/book/isbn/9781974709939");
  });

  it("omits the Goodreads URL when Open Library has no Goodreads id or ISBN", async () => {
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

    assert.equal(books[0]?.goodreadsId, undefined);
    assert.equal(books[0]?.goodreadsUrl, undefined);
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
}}`,
          {
            "Story of Your Life": `{{Short description|1998 science fiction novella by Ted Chiang}}
{{Infobox short story
| name = Story of Your Life
}}`
          }
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
}}`,
          {
            "Dune (novel)": `{{Short description|1965 science fiction novel by Frank Herbert}}
{{Infobox book
| name = Dune
}}`
          }
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

  it("ignores based_on entries that point to characters, games, franchises, or films", async () => {
    const cases: Array<{
      title: string;
      pageTitle: string;
      basedOn: string;
      sourcePages: Record<string, string>;
    }> = [
      {
        title: "The Super Mario Galaxy Movie",
        pageTitle: "The Super Mario Galaxy Movie",
        basedOn: `{{Based on|''[[Mario (franchise)|Mario]]''|[[Nintendo]]}}`,
        sourcePages: {
          "Mario (franchise)": `{{Short description|Multimedia franchise by Nintendo}}
{{Infobox media franchise
| title = Mario
}}`
        }
      },
      {
        title: "The Devil Wears Prada 2",
        pageTitle: "The Devil Wears Prada 2",
        basedOn: `{{Based on|Characters|[[Lauren Weisberger]]}}`,
        sourcePages: {}
      },
      {
        title: "Faces of Death",
        pageTitle: "Faces of Death (2026 film)",
        basedOn: `{{Based on|''[[Faces of Death]]''|[[Gorgon Video]]}}`,
        sourcePages: {
          "Faces of Death": `{{Short description|1978 film by John Alan Schwartz}}
{{Infobox film
| name = Faces of Death
}}`
        }
      },
      {
        title: "Over Your Dead Body",
        pageTitle: "Over Your Dead Body (2026 film)",
        basedOn: `{{Based on|''[[The Trip (2021 film)|I onde dager]]''|[[Tommy Wirkola]]}}`,
        sourcePages: {
          "The Trip (2021 film)": `{{Short description|2021 Norwegian film}}
{{Infobox film
| name = The Trip
}}`
        }
      }
    ];

    for (const testCase of cases) {
      const sourceWorks = await findWikipediaSourceWorksForMovie(
        buildMovie({ title: testCase.title, year: 2026 }),
        {
          cache: false,
          fetcher: buildWikipediaFetcher(
            testCase.pageTitle,
            `{{Infobox film
| name = ${testCase.title}
| based_on = ${testCase.basedOn}
}}`,
            testCase.sourcePages
          )
        }
      );

      assert.deepEqual(sourceWorks, []);
    }
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

function buildWikipediaFetcher(
  pageTitle: string,
  wikitext: string,
  sourcePages: Record<string, string> = {}
) {
  return async (input: string) => {
    const url = new URL(input);
    const pageKey = pageTitle.replace(/\s+/g, "_");
    const rawPages = new Map<string, string>([[pageKey, wikitext]]);

    for (const [sourceTitle, sourceWikitext] of Object.entries(sourcePages)) {
      rawPages.set(sourceTitle.replace(/\s+/g, "_"), sourceWikitext);
    }

    if (url.hostname === "en.wikipedia.org" && url.searchParams.get("action") === "raw") {
      const requestedKey = decodeURIComponent(url.pathname.replace(/^\/wiki\//, ""));
      const requestedWikitext = rawPages.get(requestedKey);

      if (requestedWikitext) {
        return new Response(requestedWikitext);
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
