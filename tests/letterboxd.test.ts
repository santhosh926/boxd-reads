import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LetterboxdImportException,
  parseLetterboxdRss,
  prioritizeMovies
} from "../src/lib/letterboxd";

const rssPrefix = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:letterboxd="https://letterboxd.com">
  <channel>`;
const rssSuffix = `  </channel>
</rss>`;

function buildRss(items: string): string {
  return `${rssPrefix}
${items}
${rssSuffix}`;
}

function buildItem({
  link = "https://letterboxd.com/test/film/arrival-2016/",
  rating,
  title,
  year
}: {
  link?: string;
  rating?: number;
  title?: string;
  year?: number;
}): string {
  return `<item>
    <title>${title ?? "Arrival"}, ${year ?? 2016}</title>
    <link>${link}</link>
    ${title ? `<letterboxd:filmTitle>${title}</letterboxd:filmTitle>` : ""}
    ${year ? `<letterboxd:filmYear>${year}</letterboxd:filmYear>` : ""}
    ${rating ? `<letterboxd:memberRating>${rating}</letterboxd:memberRating>` : ""}
    <description><![CDATA[
      <p><img src="https://example.com/poster.jpg"/></p>
    ]]></description>
  </item>`;
}

describe("parseLetterboxdRss", () => {
  it("normalizes title, year, rating, Letterboxd URL, poster URL, and source", () => {
    const movies = parseLetterboxdRss(
      buildRss(buildItem({ rating: 4.5, title: "Arrival", year: 2016 }))
    );

    assert.deepEqual(movies, [
      {
        title: "Arrival",
        year: 2016,
        rating: 4.5,
        letterboxdUrl: "https://letterboxd.com/test/film/arrival-2016/",
        posterUrl: "https://example.com/poster.jpg",
        source: "letterboxd"
      }
    ]);
  });

  it("tolerates missing optional fields", () => {
    const movies = parseLetterboxdRss(
      buildRss(
        `<item>
          <letterboxd:filmTitle>Black Mirror: San Junipero</letterboxd:filmTitle>
        </item>`
      )
    );

    assert.deepEqual(movies, [
      {
        title: "Black Mirror: San Junipero",
        source: "letterboxd"
      }
    ]);
  });

  it("skips non-film feed entries without a film title", () => {
    const movies = parseLetterboxdRss(
      buildRss(`
        <item>
          <title>A list, not a film</title>
          <link>https://letterboxd.com/test/list/not-a-film/</link>
        </item>
        ${buildItem({ rating: 4, title: "Cléo from 5 to 7", year: 1962 })}
      `)
    );

    assert.equal(movies.length, 1);
    assert.equal(movies[0]?.title, "Cléo from 5 to 7");
  });

  it("deduplicates movies by Letterboxd URL", () => {
    const movies = parseLetterboxdRss(
      buildRss(`
        ${buildItem({
          link: "https://letterboxd.com/test/film/arrival-2016/",
          rating: 4,
          title: "Arrival",
          year: 2016
        })}
        ${buildItem({
          link: "https://letterboxd.com/test/film/arrival-2016/",
          rating: 5,
          title: "Arrival",
          year: 2016
        })}
      `)
    );

    assert.equal(movies.length, 1);
    assert.equal(movies[0]?.rating, 4);
  });

  it("sorts high-rated movies first and then by rating descending", () => {
    const movies = parseLetterboxdRss(
      buildRss(`
        ${buildItem({ rating: 3.5, title: "Good Movie", year: 2020 })}
        ${buildItem({
          link: "https://letterboxd.com/test/film/great-movie/",
          rating: 4,
          title: "Great Movie",
          year: 2021
        })}
        ${buildItem({
          link: "https://letterboxd.com/test/film/best-movie/",
          rating: 5,
          title: "Best Movie",
          year: 2022
        })}
      `)
    );

    assert.deepEqual(
      movies.map((movie) => movie.title),
      ["Best Movie", "Great Movie", "Good Movie"]
    );
  });

  it("returns all movies when ratings are unavailable", () => {
    const movies = prioritizeMovies([
      { title: "Second", source: "letterboxd" },
      { title: "First", source: "letterboxd" }
    ]);

    assert.deepEqual(
      movies.map((movie) => movie.title),
      ["First", "Second"]
    );
  });

  it("throws a parse error for malformed non-RSS responses", () => {
    assert.throws(
      () => parseLetterboxdRss("<html>Blocked</html>"),
      (error) =>
        error instanceof LetterboxdImportException &&
        error.code === "PARSE_FAILED"
    );
  });

  it("returns an empty movie list for valid RSS with no movie entries", () => {
    assert.deepEqual(parseLetterboxdRss(buildRss("")), []);
  });
});
