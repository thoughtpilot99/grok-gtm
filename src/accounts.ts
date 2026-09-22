import { createHash } from "node:crypto"
import type { LeadRecord, LeadSignal } from "./types.js"

/**
 * An account is every lead max sent for the same company. Signals are company
 * facts, so they are pooled at the account: a reposted role on one contact and
 * a launch on another are two signals at one account, which is what "hold it
 * until a second signal lands on the same account" needs.
 */
export interface Account {
  key: string
  company: string | null
  leads: LeadRecord[]
  signals: LeadSignal[]
  evidence: string[]
  latestAt: string | null
  fingerprint: string
}

export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null
  const raw = website.trim().toLowerCase()
  if (!raw) return null
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`)
    const host = url.hostname.replace(/^www\./, "")
    return host.includes(".") ? host : null
  } catch {
    return null
  }
}

function normalizeCompany(name: string | null | undefined): string | null {
  if (!name) return null
  const cleaned = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(sa|sas|sarl|srl|bv|nv|bvba|gmbh|ltd|limited|inc|llc|group|groupe)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  return cleaned || null
}

/** Website domain first, then a normalized company name, then the lead itself. */
export function accountKey(lead: LeadRecord): string {
  const domain = domainOf(lead.companyWebsite)
  if (domain) return `domain:${domain}`
  const company = normalizeCompany(lead.company)
  if (company) return `company:${company}`
  return `lead:${lead.id}`
}

function latest(values: Array<string | null>): string | null {
  let best: string | null = null
  let bestTime = -Infinity
  for (const value of values) {
    if (!value) continue
    const time = new Date(value).getTime()
    if (!Number.isNaN(time) && time > bestTime) {
      best = value
      bestTime = time
    }
  }
  return best
}

/**
 * The fingerprint changes when the account gets a new signal or a new lead.
 * A judgment carries the fingerprint it was made against, so a new signal on
 * the account sends every lead there back to Grok instead of leaving an old
 * "hold" in place forever.
 */
export function fingerprintOf(key: string, signals: LeadSignal[], leads: LeadRecord[]): string {
  const slugs = [...new Set(signals.map((signal) => signal.slug))].sort()
  const ids = leads.map((lead) => lead.id).sort((a, b) => a - b)
  return createHash("sha1").update(`${key}|${slugs.join(",")}|${ids.join(",")}`).digest("hex").slice(0, 10)
}

export function buildAccounts(leads: LeadRecord[]): Map<string, Account> {
  const grouped = new Map<string, LeadRecord[]>()
  for (const lead of leads) {
    const key = accountKey(lead)
    grouped.set(key, [...(grouped.get(key) ?? []), lead])
  }
  const accounts = new Map<string, Account>()
  for (const [key, members] of grouped) {
    const seen = new Set<string>()
    const signals: LeadSignal[] = []
    for (const lead of members) {
      for (const signal of lead.signals) {
        if (seen.has(signal.slug)) continue
        seen.add(signal.slug)
        signals.push(signal)
      }
    }
    const evidence = [...new Set(members.map((lead) => lead.evidence).filter((item): item is string => Boolean(item)))]
    accounts.set(key, {
      key,
      company: members.find((lead) => lead.company)?.company ?? null,
      leads: members,
      signals,
      evidence,
      latestAt: latest(members.map((lead) => lead.triggeredAt)),
      fingerprint: fingerprintOf(key, signals, members),
    })
  }
  return accounts
}

/**
 * The lead as the ranker should see it: its own contact, the account's pooled
 * signals, and the account's most recent signal date for recency.
 */
export function withAccountSignals(lead: LeadRecord, account: Account | undefined): LeadRecord {
  if (!account || account.leads.length < 2) return lead
  const own = new Set(lead.signals.map((signal) => signal.slug))
  const pooled = [...lead.signals, ...account.signals.filter((signal) => !own.has(signal.slug))]
  return { ...lead, signals: pooled, triggeredAt: account.latestAt ?? lead.triggeredAt }
}
