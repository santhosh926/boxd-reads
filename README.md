# BoxdReads

V1 app for a tool that accepts a Letterboxd username, imports public movie activity, and matches those movies to books they were adapted from.

Flow: user enters Letterboxd username -> app imports normalized films -> checks Wikipedia film source metadata for book-adaptation source works -> searches Open Library for the identified source title and author -> displays likely source-book matches with direct Goodreads book links when Open Library exposes a Goodreads ID or ISBN, confidence, and match details.

This version is intentionally small. It does not include auth, a database, saved reading lists, or LLM calls.

## Getting Started

Use Node.js 20.19+ or 22.13+.

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

Wikipedia and Open Library lookups run without user authentication. Goodreads is
linked only as an outbound destination; the app does not scrape Goodreads.

To allow Wikidata as a fallback source lookup when Wikipedia does not identify a
source work, add this server-side flag to `.env.local`:

```bash
WIKIDATA_SOURCE_LOOKUP_ENABLED=true
```

Wikipedia lookups use likely film page titles first to keep request volume low.
If you want a broader but noisier Wikipedia search fallback, you can also set:

```bash
WIKIPEDIA_SEARCH_FALLBACK_ENABLED=true
```

Run tests:

```bash
npm test
```

## Current Scope

- Landing page with Letterboxd username input
- Server-side Letterboxd import route at `/api/letterboxd/import`
- Letterboxd RSS import with normalized movie output
- Wikipedia source-work lookup before Open Library search
- Open Library search by identified source title and author
- Goodreads outbound links from Open Library Goodreads IDs or ISBNs
- Optional Wikidata fallback behind `WIKIDATA_SOURCE_LOOKUP_ENABLED=true`
- In-memory server cache for repeated Wikipedia and Open Library lookups
- Matched results page at `/results/[username]`
- Unmatched movie counts and empty states
- Parser and matching tests with Node's built-in test runner

## Future Work

- Broaden source-work metadata coverage beyond Wikidata
- Store analysis history
- Generate personalized book recommendations
- Add authentication only if user accounts become necessary
