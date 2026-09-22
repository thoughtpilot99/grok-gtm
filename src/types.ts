export type Tier = "strike" | "priority" | "standard" | "light" | "reroute" | "hold"

export type ChannelBias = "multichannel" | "email" | "linkedin" | "none"

export type PlaybookId =
  | "multichannel-strike"
  | "multichannel-priority"
  | "email-standard"
  | "email-light"
  | "linkedin-standard"
  | "linkedin-light"

export interface SignalDef {
  slug: string
  name: string
  family: string
  /** 0–100. A tender outranks a repost, which outranks a fresh posting, which outranks a hint. */
  strength: number
  channelBias: ChannelBias
  /** Prior that the evidence contains a live need, before Grok reads it. */
  liveNeedPrior: number
  available: boolean
  summary: string
}

export interface LeadSignal {
  slug: string
  name?: string
}

export interface LeadRecord {
  id: number
  businessId: number
  name: string | null
  jobTitle: string | null
  headline: string | null
  email: string | null
  linkedinUrl: string | null
  company: string | null
  companyIndustry: string | null
  companySize: string | null
  companyWebsite: string | null
  location: string | null
  icpScore: number | null
  signals: LeadSignal[]
  evidence: string | null
  postUrl: string | null
  triggeredAt: string | null
  /** A phone number when max sends one. The call list uses it. */
  phone?: string | null
}

export interface Judgment {
  lead_id: number
  /** 0–1. A live need is visible in the evidence. */
  live_need: number
  /** 0–1. That need is one this offer actually serves. */
  need_matches_offer: number
  /** 0–1. Company fit. Judged without the contact. */
  icp_fit: number
  /** 0–1. This person can buy. The only score that reads the contact. */
  persona_fit: number
  /** Two signals are one story, not two unrelated announcements. */
  signals_one_story: boolean
  /** The account competes with us. Capped, never enrolled. */
  competitor: boolean
  hook: string
  reason: string
  /** True only after Grok writes the judgment. Heuristics stay false. */
  judged?: boolean
  /** The account fingerprint from the dossier. A new signal on the account makes this judgment stale. */
  fingerprint?: string
}

export interface RankedLead {
  lead: LeadRecord
  judgment: Judgment
  score: number
  tier: Tier
  playbook: PlaybookId | null
  primarySignal: string | null
  secondSignal: string | null
  reasons: string[]
  ageDays: number | null
  /** Company domain or normalized name. One contact per account is enrolled. */
  account?: string
}

export interface OfferConfig {
  business_id: number
  sender_id: number | null
  timezone: string
  sending_days: string[]
  start_sending_minutes: number
  end_sending_minutes: number
  offer: {
    website_url: string
    selling_description: string
    pain_points: string
    benefits: string
    proof_points: string
    campaign_intent: string
  }
  voice: {
    language: string
    formality: string
    tone_of_voice: string
    length: string
  }
  icp: {
    titles: string[]
    industries: string[]
    sizes: string[]
    locations: string[]
    bad_fits: string[]
    excluded_keywords: string[]
    competitors: string[]
  }
}

export interface RankerConfig {
  act_floor: number
  live_need_floor: number
  persona_floor: number
  reroute_need: number
  competitor_cap: number
  tiers: { strike: number; priority: number; standard: number; light: number }
  weights: {
    live_need: number
    persona: number
    icp: number
    signal: number
    recency: number
    hook: number
    second_signal: number
    max_icp: number
  }
  recency_days: number
  /** Enroll only the best contact per account in a run. */
  one_per_account: boolean
  /** Skip an account that was enrolled this many days ago or less. */
  account_cooldown_days: number
}
