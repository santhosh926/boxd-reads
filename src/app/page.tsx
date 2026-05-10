"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanUsername = username.trim();
    if (!cleanUsername) {
      setValidationMessage("Enter a Letterboxd username to import movies.");
      return;
    }

    setValidationMessage("");
    setIsSubmitting(true);
    router.push(`/results/${encodeURIComponent(cleanUsername)}`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8 lg:px-10">
      <nav className="flex items-center justify-between py-2">
        <Link className="text-base font-bold text-ink" href="/">
          BoxdReads
        </Link>
        <span className="rounded-full border border-ink/10 bg-white/60 px-3 py-1 text-sm text-ink/70">
          V1 matching
        </span>
      </nav>

      <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1fr_0.8fr] lg:py-16">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">
            Letterboxd in, reading list out
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl font-bold leading-[1.02] text-ink sm:text-6xl">
            Turn your favorite films into your next favorite books.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/70">
            Enter a Letterboxd username to import public movie activity and match those
            films to known source books.
          </p>

          <form
            className="mt-9 flex w-full max-w-2xl flex-col gap-3 rounded-lg border border-ink/10 bg-white/82 p-3 shadow-soft sm:flex-row"
            onSubmit={handleSubmit}
          >
            <label className="sr-only" htmlFor="username">
              Letterboxd username
            </label>
            <input
              autoComplete="off"
              className="min-h-12 flex-1 rounded-md border border-ink/10 bg-paper px-4 text-base text-ink outline-none transition focus:border-moss focus:ring-4 focus:ring-moss/15"
              id="username"
              onChange={(event) => {
                setUsername(event.target.value);
                setValidationMessage("");
              }}
              placeholder="letterboxd username"
              value={username}
            />
            <button
              className="min-h-12 rounded-md bg-ink px-6 text-base font-semibold text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:bg-ink/45"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Importing..." : "Import movies"}
            </button>
          </form>
          {validationMessage ? (
            <p className="mt-3 text-sm font-medium text-clay">{validationMessage}</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-ink/10 bg-ink p-6 text-white shadow-soft">
          <div className="rounded-md bg-white/8 p-5">
            <p className="text-sm uppercase tracking-[0.16em] text-wheat">
              Adaptation preview
            </p>
            <div className="mt-6 space-y-5">
              {[
                "Fetch public activity",
                "Find source works",
                "Match Google Books"
              ].map((title, index) => (
                  <div className="flex items-center gap-4" key={title}>
                    <span className="flex h-11 w-11 items-center justify-center rounded-md bg-clay text-sm font-bold">
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-semibold">{title}</p>
                      <p className="text-sm text-white/60">Ready for recommendations</p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
