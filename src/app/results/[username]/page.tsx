import Link from "next/link";
import { BookCard } from "@/components/BookCard";
import { MovieCard } from "@/components/MovieCard";
import { RecommendationCard } from "@/components/RecommendationCard";
import { adaptedBooks, matchedMovies, similarBooks } from "@/lib/mockData";

type ResultsPageProps = {
  params: {
    username: string;
  };
};

export default function ResultsPage({ params }: ResultsPageProps) {
  const username = decodeURIComponent(params.username);

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
          New search
        </Link>
      </nav>

      <section className="py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">
          Mocked analysis
        </p>
        <h1 className="mt-4 text-4xl font-bold text-ink sm:text-5xl">
          Reading picks for @{username}
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-ink/70">
          This V1 uses fixed sample data to shape the product experience before scraping,
          APIs, storage, or recommendation logic are added.
        </p>
      </section>

      <section className="py-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-ink">Highly rated adapted films</h2>
            <p className="mt-2 text-sm text-ink/65">Movies matched to likely source books.</p>
          </div>
          <span className="rounded-full bg-white/70 px-3 py-1 text-sm font-semibold text-moss">
            {matchedMovies.length} matches
          </span>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {matchedMovies.map((movie) => (
            <MovieCard key={movie.id} movie={movie} />
          ))}
        </div>
      </section>

      <section className="py-8">
        <h2 className="text-2xl font-bold text-ink">Read the source material</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {adaptedBooks.map((book) => (
            <BookCard book={book} key={book.id} />
          ))}
        </div>
      </section>

      <section className="pb-14 pt-8">
        <h2 className="text-2xl font-bold text-ink">Similar books to try next</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {similarBooks.map((recommendation) => (
            <RecommendationCard
              key={recommendation.id}
              recommendation={recommendation}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
