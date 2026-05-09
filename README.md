# BoxdReads

V1 app for a tool that accepts a Letterboxd username, imports public movie activity, and prepares highly rated movies for future book-adaptation matching.

Flow: user enters Letterboxd username -> app imports public Letterboxd activity -> app normalizes movie data -> future features identify book adaptations and recommendations.

This version includes a small server-side Letterboxd RSS import route. It does not include book matching, auth, a database, or LLM calls.

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

## Current Scope

- Landing page with Letterboxd username input
- Server-side Letterboxd import route at `/api/letterboxd/import`
- Normalized movie parsing from public Letterboxd RSS
- Results page with loading, success, empty, error, and development fallback states
- Lightweight parser tests with Node's built-in test runner

## Future Work

- Detect movies based on books
- Store analysis history
- Generate personalized book recommendations
- Add authentication only if user accounts become necessary
