export type Movie = {
  id: string;
  title: string;
  year: number;
  rating: number;
  basedOn: string;
  note: string;
};

export type Book = {
  id: string;
  title: string;
  author: string;
  year: number;
  reason: string;
};

export type Recommendation = {
  id: string;
  title: string;
  author: string;
  match: string;
  tags: string[];
};

export const matchedMovies: Movie[] = [
  {
    id: "arrival",
    title: "Arrival",
    year: 2016,
    rating: 4.5,
    basedOn: "Story of Your Life",
    note: "Quiet speculative sci-fi with an emotional core."
  },
  {
    id: "no-country",
    title: "No Country for Old Men",
    year: 2007,
    rating: 4.5,
    basedOn: "No Country for Old Men",
    note: "Austere crime fiction with dread baked into every choice."
  },
  {
    id: "howls",
    title: "Howl's Moving Castle",
    year: 2004,
    rating: 5,
    basedOn: "Howl's Moving Castle",
    note: "Whimsical fantasy, shapeshifting homes, and stubborn hearts."
  }
];

export const adaptedBooks: Book[] = [
  {
    id: "story-of-your-life",
    title: "Stories of Your Life and Others",
    author: "Ted Chiang",
    year: 2002,
    reason: "Includes the novella that inspired Arrival, plus more precise, humane science fiction."
  },
  {
    id: "no-country-book",
    title: "No Country for Old Men",
    author: "Cormac McCarthy",
    year: 2005,
    reason: "The source novel preserves the movie's spare violence and fatalistic momentum."
  },
  {
    id: "howls-book",
    title: "Howl's Moving Castle",
    author: "Diana Wynne Jones",
    year: 1986,
    reason: "A warmer, wittier take on the magical world behind the film."
  }
];

export const similarBooks: Recommendation[] = [
  {
    id: "station-eleven",
    title: "Station Eleven",
    author: "Emily St. John Mandel",
    match: "For reflective sci-fi that cares as much about memory and art as plot.",
    tags: ["literary sci-fi", "melancholy", "ensemble"]
  },
  {
    id: "winter-counts",
    title: "Winter Counts",
    author: "David Heska Wanbli Weiden",
    match: "For crime stories driven by moral pressure and a strong sense of place.",
    tags: ["crime", "noir", "contemporary"]
  },
  {
    id: "uprooted",
    title: "Uprooted",
    author: "Naomi Novik",
    match: "For readers who want mythic fantasy, strange magic, and prickly romance.",
    tags: ["fantasy", "folklore", "magic"]
  }
];
