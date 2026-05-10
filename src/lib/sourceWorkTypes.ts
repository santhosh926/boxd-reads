export type SourceWorkProvider = "wikipedia" | "wikidata";

export type SourceWork = {
  id: string;
  title: string;
  authors: string[];
  publishedDate?: string;
  description?: string;
  sourceDataUrl: string;
  sourceProvider: SourceWorkProvider;
  filmId: string;
  filmTitle?: string;
  filmYear?: number;
};

export type SourceLookupErrorCode = "FETCH_FAILED" | "RATE_LIMITED";

export class SourceLookupException extends Error {
  code: SourceLookupErrorCode;

  constructor(code: SourceLookupErrorCode, message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, SourceLookupException.prototype);
  }
}
