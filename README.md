# BoxdReads

V1 frontend for a tool that accepts a Letterboxd username, highlights highly rated movies that were adapted from books, and recommends those books plus similar reads.

Flow: user enters Letterboxd username -> app finds highly rated films -> identifies book adaptations -> recommends books with explanations.

This version is intentionally frontend-only. It uses mocked results and does not include scraping, APIs, auth, a database, or LLM calls.

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
- Submit button with loading state
- Mocked results page at `/results/[username]`
- Reusable `MovieCard`, `BookCard`, and `RecommendationCard` components
- Typed mock data in `src/lib/mockData.ts`

## Future Work

- Fetch public Letterboxd data
- Detect movies based on books
- Store analysis history
- Generate personalized book recommendations
- Add authentication only if user accounts become necessary
