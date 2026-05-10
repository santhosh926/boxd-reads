import Link from "next/link";
import { AdaptationMatchCard } from "@/components/AdaptationMatchCard";
import { matchBookAdaptations } from "@/lib/bookAdaptations";
import {
  importLetterboxdMovies,
  LetterboxdImportException
} from "@/lib/letterboxd";

type ResultsPageProps = {
  params: Promise<{
    username: string;
  }>;
};

export default async function ResultsPage({ params }: ResultsPageProps) {
  const { username: encodedUsername } = await params;
  const requestedUsername = decodeURIComponent(encodedUsername);
  const importResult = await loadLetterboxdImport(requestedUsername);

  if (!importResult.ok) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
        <ResultsNav />

        <section className="py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">
            Import failed
          </p>
          <h1 className="mt-4 text-4xl font-bold text-ink sm:text-5xl">
            We could not import @{requestedUsername}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-ink/70">
            {importResult.message}
          </p>
        </section>
      </main>
    );
  }

  const matchResult = await matchBookAdaptations(importResult.data.movies);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
      <ResultsNav />

      <section className="py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">
          {importResult.data.isFallbackData ? "Sample Letterboxd import" : "Letterboxd import"}
        </p>
        <h1 className="mt-4 text-4xl font-bold text-ink sm:text-5xl">
          Book matches for @{importResult.data.username}
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-ink/70">
          We imported {importResult.data.totalImported} movies, checked adaptation
          metadata, and searched Google Books for the identified source books. No
          profile data or reading lists are saved.
        </p>
      </section>

      {matchResult.lookupError ? (
        <section className="py-3">
          <p className="rounded-lg border border-clay/20 bg-white/70 p-4 text-sm leading-6 text-clay shadow-soft">
            {matchResult.lookupError}
          </p>
        </section>
      ) : null}

      <section className="py-6">
        <div className="grid gap-3 rounded-lg border border-ink/10 bg-white/70 p-5 shadow-soft sm:grid-cols-5">
          <div>
            <p className="text-sm text-ink/60">Source checks</p>
            <p className="mt-1 text-2xl font-bold text-ink">
              {matchResult.sourceLookupCount}
            </p>
          </div>
          <div>
            <p className="text-sm text-ink/60">Imported movies</p>
            <p className="mt-1 text-2xl font-bold text-ink">{matchResult.totalMovies}</p>
          </div>
          <div>
            <p className="text-sm text-ink/60">Adaptations found</p>
            <p className="mt-1 text-2xl font-bold text-ink">
              {matchResult.adaptedMovieCount}
            </p>
          </div>
          <div>
            <p className="text-sm text-ink/60">Book searches</p>
            <p className="mt-1 text-2xl font-bold text-ink">
              {matchResult.googleBooksSearchCount}
            </p>
          </div>
          <div>
            <p className="text-sm text-ink/60">Book matches</p>
            <p className="mt-1 text-2xl font-bold text-moss">{matchResult.matches.length}</p>
          </div>
        </div>
      </section>

      <section className="py-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-ink">Google Books matches</h2>
            <p className="mt-2 text-sm text-ink/65">
              Each result starts from a source work identified in Wikidata, then links to
              the matching Google Books record.
            </p>
          </div>
          <span className="rounded-full bg-white/70 px-3 py-1 text-sm font-semibold text-moss">
            {matchResult.matches.length}{" "}
            {matchResult.matches.length === 1 ? "match" : "matches"}
          </span>
        </div>

        {matchResult.matches.length > 0 ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {matchResult.matches.map((match) => (
              <AdaptationMatchCard key={match.id} match={match} />
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-ink/10 bg-white/70 p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-ink">No Google Books matches found</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/70">
              None of the imported movies produced both a book-adaptation source and a
              matching Google Books record.
            </p>
          </div>
        )}
      </section>

      <section className="pb-14 pt-4">
        <p className="rounded-lg bg-fog p-4 text-sm leading-6 text-ink/70">
          {matchResult.unmatchedCount > 0
            ? `${matchResult.unmatchedCount} imported movie${
                matchResult.unmatchedCount === 1 ? "" : "s"
              } did not produce a source-book match.`
            : "Every imported movie produced a source-book match."}
        </p>
      </section>
    </main>
  );
}

function ResultsNav() {
  return (
    <nav className="flex items-center justify-between py-2">
      <Link className="text-base font-bold text-ink" href="/">
        BoxdReads
      </Link>
      <Link
        className="rounded-md border border-ink/10 bg-white/70 px-4 py-2 text-sm font-semibold text-ink transition hover:border-moss hover:text-moss"
        href="/"
      >
        New search
      </Link>
    </nav>
  );
}

async function loadLetterboxdImport(username: string) {
  try {
    return {
      ok: true as const,
      data: await importLetterboxdMovies(username)
    };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof LetterboxdImportException
          ? error.message
          : "Something went wrong while importing this Letterboxd profile."
    };
  }
}
