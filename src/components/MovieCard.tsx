import type { Movie } from "@/lib/mockData";

type MovieCardProps = {
  movie: Movie;
};

export function MovieCard({ movie }: MovieCardProps) {
  return (
    <article className="h-full rounded-lg border border-ink/10 bg-white/78 p-5 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-ink">{movie.title}</h3>
          <p className="mt-1 text-sm text-ink/60">{movie.year}</p>
        </div>
        <span className="rounded-full bg-clay px-3 py-1 text-sm font-semibold text-white">
          {movie.rating.toFixed(1)}
        </span>
      </div>
      <p className="mt-4 text-sm font-medium text-moss">Based on {movie.basedOn}</p>
      <p className="mt-2 text-sm leading-6 text-ink/70">{movie.note}</p>
    </article>
  );
}
