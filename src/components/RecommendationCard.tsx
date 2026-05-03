import type { Recommendation } from "@/lib/mockData";

type RecommendationCardProps = {
  recommendation: Recommendation;
};

export function RecommendationCard({ recommendation }: RecommendationCardProps) {
  return (
    <article className="h-full rounded-lg border border-moss/20 bg-white p-5 shadow-soft">
      <h3 className="text-lg font-semibold text-ink">{recommendation.title}</h3>
      <p className="mt-1 text-sm text-ink/60">{recommendation.author}</p>
      <p className="mt-4 text-sm leading-6 text-ink/70">{recommendation.match}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {recommendation.tags.map((tag) => (
          <span
            className="rounded-full bg-fog px-3 py-1 text-xs font-medium text-moss"
            key={tag}
          >
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}
