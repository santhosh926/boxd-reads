"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type {
  LetterboxdImportError,
  LetterboxdImportResult,
  Movie
} from "@/lib/letterboxd";

type ImportState =
  | { status: "loading" }
  | { status: "success"; result: LetterboxdImportResult }
  | { status: "empty"; error: LetterboxdImportError }
  | { status: "error"; error: LetterboxdImportError };

export default function ResultsPage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username);
  const [importState, setImportState] = useState<ImportState>({
    status: "loading"
  });

  useEffect(() => {
    const controller = new AbortController();

    async function importMovies() {
      setImportState({ status: "loading" });

      try {
        const response = await fetch("/api/letterboxd/import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ username }),
          signal: controller.signal
        });
        const data = await response.json();

        if (!response.ok) {
          const error = data as LetterboxdImportError;
          setImportState(
            error.code === "NO_MOVIES_FOUND"
              ? { status: "empty", error }
              : { status: "error", error }
          );
          return;
        }

        setImportState({
          status: "success",
          result: data as LetterboxdImportResult
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        console.error("Letterboxd import request failed", error);
        setImportState({
          status: "error",
          error: {
            code: "FETCH_FAILED",
            message: "We couldn't reach the import service. Try again in a moment."
          }
        });
      }
    }

    importMovies();

    return () => controller.abort();
  }, [username]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
      <nav className="flex items-center justify-between py-2">
        <Link className="text-base font-bold text-ink" href="/">
          BoxdReads
        </Link>
        <Link
          className="rounded-md border border-ink/10 bg-white/70 px-4 py-2 text-sm font-semibold text-ink transition hover:border-moss hover:text-moss"
          href="/"
        >
          New import
        </Link>
      </nav>

      <section className="py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">
          Letterboxd import
        </p>
        <h1 className="mt-4 text-4xl font-bold text-ink sm:text-5xl">
          Imported movies for @{username}
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-ink/70">
          Public Letterboxd activity is parsed into a normalized movie list for
          future book-adaptation matching.
        </p>
      </section>

      {importState.status === "loading" ? (
        <StatusPanel
          eyebrow="Importing"
          message="Fetching public Letterboxd activity and parsing movie data."
          title="Working on it..."
        />
      ) : null}

      {importState.status === "empty" ? (
        <StatusPanel
          eyebrow="No movies found"
          message={importState.error.message}
          title="We couldn't find any public movies for this profile."
        />
      ) : null}

      {importState.status === "error" ? (
        <StatusPanel
          eyebrow="Import failed"
          message={importState.error.message}
          title="That profile could not be imported."
        />
      ) : null}

      {importState.status === "success" ? (
        <ImportResults result={importState.result} />
      ) : null}
    </main>
  );
}

function ImportResults({ result }: { result: LetterboxdImportResult }) {
  const previewMovies = result.movies.slice(0, 9);

  return (
    <section className="pb-14 pt-2">
      {result.isFallbackData ? (
        <div className="mb-6 rounded-lg border border-clay/25 bg-white/75 p-4 text-sm leading-6 text-ink/75">
          Live Letterboxd fetching is using development fallback data for this
          import.
        </div>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-ink">Normalized movie list</h2>
          <p className="mt-2 text-sm text-ink/65">
            Ratings of 4 stars and up are prioritized when available.
          </p>
        </div>
        <span className="w-fit rounded-full bg-white/70 px-3 py-1 text-sm font-semibold text-moss">
          {result.totalImported} imported
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {previewMovies.map((movie) => (
          <ImportedMovieCard movie={movie} key={movieKey(movie)} />
        ))}
      </div>
    </section>
  );
}

function ImportedMovieCard({ movie }: { movie: Movie }) {
  return (
    <article className="h-full rounded-lg border border-ink/10 bg-white/78 p-5 shadow-soft">
      <div className="flex items-start gap-4">
        {movie.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="h-24 w-16 rounded-md object-cover"
            src={movie.posterUrl}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-ink">{movie.title}</h3>
          <p className="mt-1 text-sm text-ink/60">
            {movie.year ? movie.year : "Year unavailable"}
          </p>
          {movie.rating !== undefined ? (
            <span className="mt-4 inline-flex rounded-full bg-clay px-3 py-1 text-sm font-semibold text-white">
              {movie.rating.toFixed(1)}
            </span>
          ) : (
            <span className="mt-4 inline-flex rounded-full bg-fog px-3 py-1 text-sm font-semibold text-moss">
              Unrated
            </span>
          )}
        </div>
      </div>
      {movie.letterboxdUrl ? (
        <a
          className="mt-5 inline-flex text-sm font-semibold text-moss transition hover:text-clay"
          href={movie.letterboxdUrl}
          rel="noreferrer"
          target="_blank"
        >
          View on Letterboxd
        </a>
      ) : null}
    </article>
  );
}

function StatusPanel({
  eyebrow,
  message,
  title
}: {
  eyebrow: string;
  message: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-ink/10 bg-white/78 p-6 shadow-soft">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-clay">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-bold text-ink">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/70">{message}</p>
    </section>
  );
}

function movieKey(movie: Movie): string {
  return movie.letterboxdUrl ?? `${movie.title}-${movie.year ?? "unknown"}`;
}
