import type { BookAdaptationMatch } from "@/lib/bookAdaptations";

type AdaptationMatchCardProps = {
  match: BookAdaptationMatch;
};

export function AdaptationMatchCard({ match }: AdaptationMatchCardProps) {
  const { adaptation, confidence, movie } = match;

  return (
    <article className="h-full rounded-lg border border-ink/10 bg-white/78 p-5 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-clay">
            Goodreads match
          </p>
          <h3 className="mt-3 text-lg font-semibold text-ink">{adaptation.bookTitle}</h3>
          <p className="mt-1 text-sm text-ink/60">
            {adaptation.bookAuthor}
            {adaptation.bookYear ? `, ${adaptation.bookYear}` : ""}
          </p>
        </div>
        <span className="rounded-full bg-moss px-3 py-1 text-xs font-semibold uppercase text-white">
          {confidence}
        </span>
      </div>

      <div className="mt-5 rounded-md bg-fog p-4">
        <p className="text-sm font-semibold text-ink">
          Matched from {movie.title}
          {movie.year ? ` (${movie.year})` : ""}
        </p>
        <p className="mt-1 text-xs font-medium text-ink/60">
          Source: {adaptation.sourceTitle}
          {adaptation.sourceYear ? ` (${adaptation.sourceYear})` : ""} by{" "}
          {adaptation.sourceAuthor}
        </p>
        {movie.rating !== undefined ? (
          <p className="mt-1 text-xs font-medium text-moss">
            Letterboxd rating {movie.rating.toFixed(1)}
          </p>
        ) : null}
      </div>

      <p className="mt-4 text-sm leading-6 text-ink/70">{adaptation.detail}</p>
      <p className="mt-3 text-xs leading-5 text-ink/55">{match.reason}</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {adaptation.goodreadsUrl ? (
          <a
            className="inline-flex rounded-md border border-moss/20 px-3 py-2 text-sm font-semibold text-moss transition hover:border-moss hover:bg-fog"
            href={adaptation.goodreadsUrl}
            rel="noreferrer"
            target="_blank"
          >
            View on Goodreads
          </a>
        ) : null}
        {adaptation.sourceDataUrl ? (
          <a
            className="inline-flex rounded-md border border-ink/10 px-3 py-2 text-sm font-semibold text-ink/70 transition hover:border-ink/30 hover:text-ink"
            href={adaptation.sourceDataUrl}
            rel="noreferrer"
            target="_blank"
          >
            View source data
          </a>
        ) : null}
      </div>
    </article>
  );
}
