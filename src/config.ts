import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "yaml"
import { DEFAULT_RANKER } from "./policy.js"
import type { OfferConfig, RankerConfig } from "./types.js"

export function repoRoot(): string {
  return process.cwd()
}

export function loadOffer(root = repoRoot()): OfferConfig {
  const raw = parse(readFileSync(resolve(root, "config/offer.yaml"), "utf8")) as OfferConfig
  if (!raw?.business_id) throw new Error("config/offer.yaml is missing business_id")
  if (!raw.offer?.selling_description) throw new Error("config/offer.yaml is missing offer.selling_description")
  raw.icp ??= { titles: [], industries: [], sizes: [], locations: [], bad_fits: [], excluded_keywords: [], competitors: [] }
  raw.icp.competitors ??= []
  raw.icp.excluded_keywords ??= []
  raw.icp.bad_fits ??= []
  raw.sender_id = raw.sender_id ?? null
  return raw
}

export function loadRanker(root = repoRoot()): RankerConfig {
  const raw = parse(readFileSync(resolve(root, "config/ranker.yaml"), "utf8")) as Partial<RankerConfig>
  return {
    ...DEFAULT_RANKER,
    ...raw,
    tiers: { ...DEFAULT_RANKER.tiers, ...raw.tiers },
    weights: { ...DEFAULT_RANKER.weights, ...raw.weights },
  }
}
