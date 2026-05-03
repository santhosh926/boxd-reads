import type { Book } from "@/lib/mockData";

type BookCardProps = {
  book: Book;
};

export function BookCard({ book }: BookCardProps) {
  return (
    <article className="h-full rounded-lg border border-ink/10 bg-paper p-5 shadow-soft">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-clay">
        Adapted book
      </p>
      <h3 className="mt-3 text-lg font-semibold text-ink">{book.title}</h3>
      <p className="mt-1 text-sm text-ink/60">
        {book.author}, {book.year}
      </p>
      <p className="mt-4 text-sm leading-6 text-ink/70">{book.reason}</p>
    </article>
  );
}
