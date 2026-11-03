import type { StrengthEntry } from "@consyrion/core";
import { timeoutSignal } from "../retry";

export const ARTIFICIAL_ANALYSIS = { source: "Artificial Analysis Intelligence Index", sourceUrl: "https://artificialanalysis.ai/" } as const;

const ENDPOINT = "https://artificialanalysis.ai/api/v2/data/llms/models";

interface ApiModel {
  id?: string;
  slug?: string;
  name?: string;
  model_creator?: { name?: string; slug?: string };
  evaluations?: { artificial_analysis_intelligence_index?: number | null };
}

/**
 * Ranking entries from the Artificial Analysis data API (#139): its Intelligence Index per model. Needs the
 * platform's own `ARTIFICIAL_ANALYSIS_API_KEY` (free tier, 1,000 requests a day; attribution required). Models
 * without an index are left out. The key stays on the server and is never logged.
 */
export async function fetchArtificialAnalysis(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<StrengthEntry[]> {
  const response = await fetchImpl(ENDPOINT, { headers: { "x-api-key": apiKey, accept: "application/json" }, signal: timeoutSignal(20_000) });
  if (!response.ok) throw new Error(`Artificial Analysis answered HTTP ${response.status}`);
  const body = (await response.json()) as { data?: ApiModel[] };
  return (body.data ?? []).flatMap((m) => {
    const score = m.evaluations?.artificial_analysis_intelligence_index;
    if (typeof score !== "number" || !Number.isFinite(score) || !m.name) return [];
    return [
      {
        sourceModelId: m.id ?? m.slug ?? m.name,
        slug: m.slug ?? m.name,
        name: m.name,
        creator: m.model_creator?.name ?? m.model_creator?.slug ?? "",
        // Kept next to the display name: AA shows xAI as "SpaceXAI" but its creator slug stays "xai" (#171).
        ...(m.model_creator?.slug ? { creatorSlug: m.model_creator.slug } : {}),
        score,
      },
    ];
  });
}
