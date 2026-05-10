import type { Movie } from "./letterboxd";
import type { SourceWork } from "./sourceWorkTypes";
import { findWikipediaSourceWorksForMovie } from "./wikipedia";
import { findWikidataSourceWorksForMovie } from "./wikidata";

export async function findSourceWorksForMovie(movie: Movie): Promise<SourceWork[]> {
  let wikipediaError: unknown;

  try {
    const sourceWorks = await findWikipediaSourceWorksForMovie(movie);

    if (sourceWorks.length > 0 || !isWikidataSourceLookupEnabled()) {
      return sourceWorks;
    }
  } catch (error) {
    wikipediaError = error;

    if (!isWikidataSourceLookupEnabled()) {
      throw error;
    }
  }

  try {
    const wikidataWorks = await findWikidataSourceWorksForMovie(movie);
    return wikidataWorks.map((work) => ({
      id: work.id,
      title: work.title,
      authors: work.authors,
      ...(work.publishedDate ? { publishedDate: work.publishedDate } : {}),
      ...(work.description ? { description: work.description } : {}),
      sourceDataUrl: work.wikidataUrl,
      sourceProvider: "wikidata" as const,
      filmId: work.filmId,
      ...(work.filmTitle ? { filmTitle: work.filmTitle } : {}),
      ...(work.filmYear ? { filmYear: work.filmYear } : {})
    }));
  } catch (wikidataError) {
    if (wikipediaError) {
      throw wikipediaError;
    }

    throw wikidataError;
  }
}

function isWikidataSourceLookupEnabled(): boolean {
  return process.env.WIKIDATA_SOURCE_LOOKUP_ENABLED === "true";
}
