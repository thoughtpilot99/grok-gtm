import { rankSignalSlugs } from "./signals.js"
import type {
  Judgment,
  LeadRecord,
  OfferConfig,
  PlaybookId,
  RankedLead,
  RankerConfig,
  Tier,
} from "./types.js"

export const DEFAULT_RANKER: RankerConfig = {
  act_floor: 50,
  live_need_floor: 0.4,
  persona_floor: 0.45,
  reroute_need: 0.6,
  competitor_cap: 34,
  tiers: { strike: 80, priority: 65, standard: 50, light: 35 },
  weights: {
    live_need: 32,
    persona: 20,
    icp: 12,
    signal: 18,
    recency: 8,
    hook: 2,
    second_signal: 5,
    max_icp: 3,
  },
  recency_days: 30,
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function ageInDays(iso: string | null, now = new Date()): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.max(0, (now.getTime() - then) / 86_400_000)
}

export function recencyScore(ageDays: number | null, windowDays: number): number {
  if (ageDays == null) return 0.5
  if (windowDays <= 0) return 0
  return clamp01(1 - ageDays / windowDays)
}

/** Max sometimes scores ICP on a small integer scale, sometimes on 0–100. */
export function normalizeIcpScore(score: number | null): number {
  if (score == null || Number.isNaN(score)) return 0
  if (score <= 1) return clamp01(score)
  if (score <= 10) return clamp01(score / 10)
  return clamp01(score / 100)
}

function wholeWord(needle: string): RegExp {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u")
}

export function gateLead(lead: LeadRecord, offer: OfferConfig): string | null {
  if (!lead.company && !lead.name) return "No company and no person"
  const haystack = `${lead.company ?? ""} ${lead.jobTitle ?? ""} ${lead.headline ?? ""}`.toLowerCase()
  for (const word of offer.icp.excluded_keywords) {
    const needle = word.trim().toLowerCase()
    if (needle && wholeWord(needle).test(haystack)) return `Excluded keyword: ${word}`
  }
  if (lead.signals.length === 0 && !lead.evidence) return "No signal and no evidence"
  return null
}

export function heuristicJudgment(lead: LeadRecord, offer: OfferConfig): Judgment {
  const { primary } = rankSignalSlugs(lead.signals.map((signal) => signal.slug))
  const title = `${lead.jobTitle ?? ""} ${lead.headline ?? ""}`.toLowerCase()
  const titleHit = offer.icp.titles.some((item) => {
    const needle = item.trim().toLowerCase()
    return needle.length > 2 && title.includes(needle)
  })
  const company = (lead.company ?? "").toLowerCase()
  const competitor = offer.icp.competitors.some((item) => {
    const needle = item.trim().toLowerCase()
    return needle.length > 1 && company.includes(needle)
  })
  return {
    lead_id: lead.id,
    live_need: primary?.liveNeedPrior ?? 0.1,
    need_matches_offer: 0.45,
    icp_fit: titleHit ? 0.6 : 0.4,
    persona_fit: titleHit ? 0.62 : 0.3,
    signals_one_story: lead.signals.length >= 2,
    competitor,
    hook: (lead.evidence ?? "").slice(0, 180),
    reason: "Heuristic preview. Grok has not judged this lead.",
    judged: false,
  }
}

function needScore(judgment: Judgment): number {
  return Math.min(clamp01(judgment.live_need), clamp01(judgment.need_matches_offer))
}

function tierFromScore(score: number, tiers: RankerConfig["tiers"]): Tier {
  if (score >= tiers.strike) return "strike"
  if (score >= tiers.priority) return "priority"
  if (score >= tiers.standard) return "standard"
  if (score >= tiers.light) return "light"
  return "hold"
}

export function choosePlaybook(tier: Tier, lead: LeadRecord, channelBias: string | undefined): PlaybookId | null {
  if (tier === "hold" || tier === "reroute") return null
  const hasEmail = Boolean(lead.email)
  const hasLinkedin = Boolean(lead.linkedinUrl)
  if (!hasEmail && !hasLinkedin) return null

  if (tier === "strike" || tier === "priority") {
    if (hasEmail && hasLinkedin) {
      return tier === "strike" ? "multichannel-strike" : "multichannel-priority"
    }
    if (hasEmail) return "email-standard"
    return "linkedin-standard"
  }

  if (tier === "standard") {
    if (channelBias === "linkedin" && hasLinkedin) return "linkedin-standard"
    if (hasEmail) return "email-standard"
    return "linkedin-standard"
  }

  if ((channelBias === "linkedin" || channelBias === "multichannel") && hasLinkedin) {
    return "linkedin-light"
  }
  if (hasEmail) return "email-light"
  if (hasLinkedin) return "linkedin-light"
  return null
}

export function scoreLead(
  lead: LeadRecord,
  judgment: Judgment,
  ranker: RankerConfig = DEFAULT_RANKER,
  now = new Date(),
): RankedLead {
  const { primary, second } = rankSignalSlugs(lead.signals.map((signal) => signal.slug))
  const ageDays = ageInDays(lead.triggeredAt, now)
  const fresh = recencyScore(ageDays, ranker.recency_days)
  const need = needScore(judgment)
  const persona = clamp01(judgment.persona_fit)
  const icp = clamp01(judgment.icp_fit)
  const signalPart = (primary?.strength ?? 0) / 100
  const secondPart = judgment.signals_one_story && second ? second.strength / 100 : 0
  const weights = ranker.weights
  let score =
    weights.live_need * need +
    weights.persona * persona +
    weights.icp * icp +
    weights.signal * signalPart +
    weights.recency * fresh +
    weights.hook * (judgment.hook.trim() ? 1 : 0) +
    weights.second_signal * secondPart +
    weights.max_icp * normalizeIcpScore(lead.icpScore)

  score = Math.round(score * 10) / 10
  const reasons: string[] = []
  let tier = tierFromScore(score, ranker.tiers)

  if (judgment.competitor) {
    score = Math.min(score, ranker.competitor_cap)
    tier = "hold"
    reasons.push("Competitor. Capped and not enrolled.")
  } else if (persona < ranker.persona_floor) {
    if (need >= ranker.reroute_need) {
      tier = "reroute"
      reasons.push("Live need, wrong buyer. Find the person who owns the problem.")
    } else {
      tier = "hold"
      reasons.push("Contact is under the persona floor, and the need is not strong enough to reroute.")
    }
  } else if (need < ranker.live_need_floor) {
    tier = "hold"
    reasons.push("No live need for this offer in the evidence. Fit alone does not clear the line.")
  }

  if (tier !== "hold" && tier !== "reroute" && !judgment.judged) {
    reasons.push("Unjudged. Ranked with the heuristic so you can see the queue. Draft will skip it.")
  }

  if (primary) reasons.push(`Strongest signal: ${primary.name} (${primary.strength}).`)
  if (second && judgment.signals_one_story) {
    reasons.push(`Second signal counts: ${second.name}. Grok called them one story.`)
  } else if (second) {
    reasons.push(`Second signal ignored: ${second.name}. Not one story.`)
  }

  const playbook = choosePlaybook(tier, lead, primary?.channelBias)
  if ((tier === "strike" || tier === "priority" || tier === "standard" || tier === "light") && !playbook) {
    reasons.push("No email and no LinkedIn URL, so there is no sequence to run.")
  }

  return {
    lead,
    judgment,
    score,
    tier,
    playbook,
    primarySignal: primary?.slug ?? null,
    secondSignal: second?.slug ?? null,
    reasons,
    ageDays: ageDays == null ? null : Math.round(ageDays * 10) / 10,
  }
}
