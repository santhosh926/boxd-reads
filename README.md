# BoxdReads

V1 app for a tool that accepts a Letterboxd username, imports public movie activity, and matches those movies to books they were adapted from.

Flow: user enters Letterboxd username -> app imports normalized films -> checks Wikidata for book-adaptation source works -> searches Google Books for the identified source title and author -> displays likely source-book matches with confidence and match details.

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

Google Books lookups can run without user authentication. For reliable local quota,
add a server-side API key to `.env.local`:

```bash
GOOGLE_BOOKS_API_KEY=your-google-books-api-key
```

Run tests:

```bash
npm test
```

## Current Scope

- Landing page with Letterboxd username input
- Server-side Letterboxd import route at `/api/letterboxd/import`
- Letterboxd RSS import with normalized movie output
- Wikidata source-work lookup before Google Books search
- Google Books search by identified source title and author
- In-memory server cache for repeated Wikidata and Google Books lookups
- Matched results page at `/results/[username]`
- Unmatched movie counts and empty states
- Parser and matching tests with Node's built-in test runner

## Future Work

- Broaden source-work metadata coverage beyond Wikidata
- Store analysis history
- Generate personalized book recommendations
- Add authentication only if user accounts become necessary
