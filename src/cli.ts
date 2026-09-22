import { existsSync, readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { loadEnv, requireEnv, hint } from "./env.js"
import { loadOffer, loadRanker } from "./config.js"
import { Max } from "./max.js"
import { Overloop } from "./overloop.js"
import { SIGNALS } from "./signals.js"
import { PLAYBOOKS, campaignName } from "./playbooks.js"
import { applyAccountRules, gateLead, heuristicJudgment, scoreLead } from "./policy.js"
import { buildAccounts, withAccountSignals, type Account } from "./accounts.js"
import {
  OUTCOMES,
  appendEnrollment,
  appendOutcome,
  dataPath,
  loadEnrollments,
  toCsv,
  loadJudgments,
  loadLeads,
  loadOutcomes,
  outPath,
  rankedToCsv,
  readJsonl,
  saveLeads,
  writeJson,
  writeText,
} from "./store.js"
import type { Judgment, LeadRecord, OfferConfig, PlaybookId, RankedLead } from "./types.js"

loadEnv()

const command = process.argv[2] ?? "help"
const parsed = parseArgs({
  args: process.argv.slice(3),
  options: {
    business: { type: "string" },
    pages: { type: "string", default: "1" },
    "per-page": { type: "string", default: "25" },
    limit: { type: "string", default: "20" },
    confirm: { type: "boolean", default: false },
    heuristic: { type: "boolean", default: false },
    tier: { type: "string" },
    lead: { type: "string" },
    result: { type: "string" },
    campaign: { type: "string" },
    help: { type: "boolean", default: false },
    live: { type: "boolean", default: false },
  },
  strict: false,
})
const flags = parsed.values

async function main(): Promise<void> {
  if (command === "help" || flags.help || command === "--help") {
    printHelp()
    return
  }
  switch (command) {
    case "doctor":
      return doctor()
    case "businesses":
      return businesses()
    case "signals":
      return signals()
    case "watch":
      return watch()
    case "prep":
      return prep()
    case "dossier":
      return dossier()
    case "rank":
      return rank()
    case "draft":
      return draft()
    case "calls":
      return calls()
    case "activate":
      return setStatus("on")
    case "pause":
      return setStatus("off")
    case "stats":
      return stats()
    case "inbox":
      return inbox()
    case "outcome":
      return outcome()
    case "learn":
      return learn()
    case "probe":
      return probe()
    default:
      throw new Error(`Unknown command "${command}". Run: npm run gtm -- help`)
  }
}

function printHelp(): void {
  console.log(`Grok GTM

  npm run gtm -- doctor
  npm run gtm -- businesses
  npm run gtm -- signals [--live]
  npm run gtm -- watch [--pages 1] [--per-page 25] [--business 3]
  npm run gtm -- dossier [--limit 20]
  npm run gtm -- prep                 watch, then dossier (the morning job)
  npm run gtm -- rank [--heuristic]
  npm run gtm -- calls [--tier strike]
  npm run gtm -- draft [--tier strike,priority] [--limit 20]
  npm run gtm -- draft --confirm
  npm run gtm -- activate --campaign <id> --confirm
  npm run gtm -- pause --campaign <id> --confirm
  npm run gtm -- stats --campaign <id>
  npm run gtm -- inbox
  npm run gtm -- outcome --lead <id> --result reply|meeting|no_reply|bounce
  npm run gtm -- learn
  npm run gtm -- probe

Grok writes out/judgments.jsonl between dossier and rank.
Draft and activate do nothing until you pass --confirm.
Campaigns are created with auto-send off, so every message waits for review.`)
}

function offer(): OfferConfig {
  return loadOffer()
}

function businessId(): number {
  if (flags.business) return Number(flags.business)
  return offer().business_id
}

async function doctor(): Promise<void> {
  const overloopKey = requireEnv("OVERLOOP_API_KEY")
  const maxKey = requireEnv("MAX_API_KEY")
  const overloop = new Overloop(overloopKey)
  const max = new Max(maxKey)
  const [me, account, addresses, maxBusinesses] = await Promise.all([
    overloop.me(),
    overloop.account(),
    overloop.sendingAddresses(),
    max.businesses(),
  ])
  const cfg = offer()
  const subs = await max.subscriptions(cfg.business_id).catch(() => [])
  const working = addresses.filter((address) => address.working)
  console.log(
    JSON.stringify(
      {
        overloop: {
          key: hint(overloopKey),
          user: { id: me.id, name: me.name, email: me.email, role: me.role },
          account: { id: account.id, name: account.name, plan: account.plan_name, credits: account.remaining_credits },
          sending_addresses: working.map((address) => ({
            user_id: address.user_id,
            email: address.email,
            from_name: address.from_name,
            provider: address.provider,
          })),
          sender_id_in_offer: cfg.sender_id,
          sender_ready: cfg.sender_id != null && working.some((address) => address.user_id === cfg.sender_id),
        },
        max: {
          key: hint(maxKey),
          businesses: maxBusinesses.map((item) => ({ id: item.id, name: item.name, website: item.website })),
          selected_business_id: cfg.business_id,
          subscriptions: subs.map((item) => ({
            id: item.id,
            name: item.name,
            signal: item.signal_slug ?? item.signal?.slug ?? null,
            active: item.active ?? null,
          })),
        },
      },
      null,
      2,
    ),
  )
}

async function businesses(): Promise<void> {
  const max = new Max(requireEnv("MAX_API_KEY"))
  const rows = await max.businesses()
  console.log(JSON.stringify(rows.map((item) => ({ id: item.id, name: item.name, website: item.website, description: item.description })), null, 2))
}

async function signals(): Promise<void> {
  const live = flags.live ? new Set((await new Max(requireEnv("MAX_API_KEY")).signals()).map((item) => item.slug)) : null
  console.log(
    JSON.stringify(
      SIGNALS.map((signal) => ({
        slug: signal.slug,
        name: signal.name,
        family: signal.family,
        strength: signal.strength,
        channel: signal.channelBias,
        live_need_prior: signal.liveNeedPrior,
        max_catalog: signal.available,
        ...(live ? { live_in_max_api: live.has(signal.slug) } : {}),
        summary: signal.summary,
      })),
      null,
      2,
    ),
  )
}

async function watch(): Promise<void> {
  const max = new Max(requireEnv("MAX_API_KEY"))
  const id = businessId()
  const pages = Math.max(1, Number(flags.pages))
  const perPage = Math.min(100, Math.max(1, Number(flags["per-page"])))
  const collected: LeadRecord[] = []
  let total = 0
  for (let page = 1; page <= pages; page += 1) {
    const batch = await max.leads(id, page, perPage)
    total = batch.total
    collected.push(...batch.leads)
    if (page >= batch.pages) break
  }
  saveLeads(collected)
  const gated = collected.filter((lead) => gateLead(lead, offer())).length
  console.log(
    JSON.stringify(
      {
        business_id: id,
        fetched: collected.length,
        total_in_max: total,
        gated_in_this_batch: gated,
        stored: dataPath("leads.jsonl"),
      },
      null,
      2,
    ),
  )
}

async function prep(): Promise<void> {
  await watch()
  await dossier()
}

function currentJudgment(judgment: Judgment | undefined, account: Account | undefined): Judgment | undefined {
  if (!judgment) return undefined
  if (judgment.fingerprint && account && judgment.fingerprint !== account.fingerprint) return undefined
  return judgment
}

function recentlyEnrolledAccounts(cooldownDays: number): Map<string, string> {
  const cutoff = Date.now() - cooldownDays * 86_400_000
  const map = new Map<string, string>()
  for (const row of loadEnrollments()) {
    const at = new Date(row.at).getTime()
    if (Number.isNaN(at) || at < cutoff) continue
    map.set(row.account, `${row.campaign}, ${row.at.slice(0, 10)}`)
  }
  return map
}

function rankAll(useHeuristic: boolean): { ranked: RankedLead[]; gated: Array<{ lead_id: number; reason: string }>; stale: number } {
  const cfg = offer()
  const ranker = loadRanker()
  const judgments = loadJudgments()
  const leads = loadLeads()
  const accounts = buildAccounts(leads.filter((lead) => !gateLead(lead, cfg)))
  const accountOf = new Map<number, Account>()
  for (const account of accounts.values()) for (const lead of account.leads) accountOf.set(lead.id, account)
  const gated: Array<{ lead_id: number; reason: string }> = []
  const ranked: RankedLead[] = []
  let stale = 0
  for (const lead of leads) {
    const gate = gateLead(lead, cfg)
    if (gate) {
      gated.push({ lead_id: lead.id, reason: gate })
      continue
    }
    const account = accountOf.get(lead.id)
    const stored = judgments.get(lead.id)
    const current = currentJudgment(stored, account)
    if (stored && !current) stale += 1
    const judgment = current ?? (useHeuristic ? heuristicJudgment(lead, cfg) : null)
    if (!judgment) continue
    const row = scoreLead(withAccountSignals(lead, account), judgment, ranker)
    ranked.push({ ...row, lead, account: account?.key })
  }
  ranked.sort((a, b) => b.score - a.score)
  const ruled = applyAccountRules(ranked, ranker, recentlyEnrolledAccounts(ranker.account_cooldown_days))
  return { ranked: ruled, gated, stale }
}

async function dossier(): Promise<void> {
  const cfg = offer()
  const limit = Number(flags.limit)
  const judgments = loadJudgments()
  const open = loadLeads().filter((lead) => !gateLead(lead, cfg))
  const accounts = buildAccounts(open)
  const accountOf = new Map<number, Account>()
  for (const account of accounts.values()) for (const lead of account.leads) accountOf.set(lead.id, account)
  const leads = open
    .filter((lead) => !currentJudgment(judgments.get(lead.id), accountOf.get(lead.id)))
    .sort((a, b) => (b.triggeredAt ?? "").localeCompare(a.triggeredAt ?? ""))
    .slice(0, limit)
  const rejudged = leads.filter((lead) => judgments.has(lead.id)).length
  if (leads.length === 0) {
    console.log("No unjudged leads. Run watch, or judgments already cover the store.")
    return
  }
  const lines: string[] = []
  lines.push("# Dossier")
  lines.push("")
  lines.push("Judge each lead. Write one JSON object per line to out/judgments.jsonl.")
  lines.push("Company questions use the Company block only. The persona score is the only one that reads Contact.")
  lines.push("Questions, each 0 to 1 unless noted: live_need, need_matches_offer, icp_fit, persona_fit, signals_one_story (true/false), competitor (true/false).")
  lines.push("Also write hook (one sentence) and reason (one sentence). Set judged to true.")
  lines.push("Copy the lead's Fingerprint into fingerprint. Write each judgment on a single line.")
  lines.push("Signals are pooled per account: the Company block lists every signal max sent for this company, from any contact.")
  lines.push("")
  lines.push("## Offer")
  lines.push(cfg.offer.selling_description)
  lines.push("")
  lines.push(cfg.offer.pain_points)
  lines.push("")
  lines.push(`Intent: ${cfg.offer.campaign_intent}`)
  lines.push("")
  lines.push("## ICP")
  lines.push(`Titles: ${cfg.icp.titles.join(", ")}`)
  lines.push(`Industries: ${cfg.icp.industries.join(", ")}`)
  lines.push(`Sizes: ${cfg.icp.sizes.join(", ")}`)
  lines.push(`Locations: ${cfg.icp.locations.join(", ")}`)
  lines.push(`Bad fits: ${cfg.icp.bad_fits.join(", ") || "none listed"}`)
  lines.push("")
  for (const lead of leads) {
    const account = accountOf.get(lead.id)
    const slugs = (account?.signals ?? lead.signals).map((signal) => signal.slug)
    const others = (account?.leads ?? []).filter((other) => other.id !== lead.id)
    lines.push(`## Lead ${lead.id}`)
    lines.push("")
    lines.push("### Company")
    lines.push(`- Company: ${lead.company ?? "unknown"}`)
    lines.push(`- Industry: ${lead.companyIndustry ?? "unknown"}`)
    lines.push(`- Size: ${lead.companySize ?? "unknown"}`)
    lines.push(`- Website: ${lead.companyWebsite ?? "unknown"}`)
    lines.push(`- Location: ${lead.location ?? "unknown"}`)
    lines.push(`- Account: ${account?.key ?? "unknown"}`)
    lines.push(`- Fingerprint: ${account?.fingerprint ?? "none"}`)
    lines.push(`- Signals at this account: ${slugs.join(", ") || "none"}`)
    lines.push(`- Evidence: ${lead.evidence ?? "none"}`)
    for (const other of others) {
      if (other.evidence && other.evidence !== lead.evidence) lines.push(`- Evidence from another contact here: ${other.evidence}`)
    }
    if (others.length) lines.push(`- Other contacts max sent for this account: ${others.length}`)
    lines.push(`- Source: ${lead.postUrl ?? "none"}`)
    lines.push(`- When: ${lead.triggeredAt ?? "unknown"}`)
    lines.push(`- max ICP score: ${lead.icpScore ?? "unknown"}`)
    lines.push("")
    lines.push("### Contact")
    lines.push("Read this block only for persona_fit.")
    lines.push(`- Name: ${lead.name ?? "unknown"}`)
    lines.push(`- Title: ${lead.jobTitle ?? "unknown"}`)
    lines.push(`- Headline: ${lead.headline ?? "unknown"}`)
    lines.push(`- Email on file: ${lead.email ? "yes" : "no"}`)
    lines.push(`- LinkedIn on file: ${lead.linkedinUrl ? "yes" : "no"}`)
    lines.push("")
  }
  writeText(outPath("dossier.md"), lines.join("\n"))
  console.log(JSON.stringify({ leads: leads.length, rejudge_new_evidence: rejudged, dossier: outPath("dossier.md") }, null, 2))
}

async function rank(): Promise<void> {
  const { ranked, gated, stale } = rankAll(Boolean(flags.heuristic) || loadJudgments().size === 0)
  writeJson(outPath("ranked.json"), ranked)
  writeText(outPath("ranked.csv"), rankedToCsv(ranked))
  writeJson(outPath("gated.json"), gated)
  const counts: Record<string, number> = {}
  for (const row of ranked) counts[row.tier] = (counts[row.tier] ?? 0) + 1
  console.log(
    JSON.stringify(
      {
        ranked: ranked.length,
        gated: gated.length,
        counts,
        judged: ranked.filter((row) => row.judgment.judged).length,
        stale_judgments: stale,
        csv: outPath("ranked.csv"),
      },
      null,
      2,
    ),
  )
}

async function draft(): Promise<void> {
  const { ranked } = rankAll(false)
  const wanted = new Set((flags.tier ? String(flags.tier).split(",") : ["strike", "priority", "standard", "light"]).map((item) => item.trim()))
  const limit = Number(flags.limit)
  const ready = ranked.filter((row) => row.judgment.judged && row.playbook && wanted.has(row.tier)).slice(0, limit)
  const grouped = new Map<PlaybookId, RankedLead[]>()
  for (const row of ready) {
    const key = row.playbook as PlaybookId
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  const plan = [...grouped.entries()].map(([playbook, rows]) => ({
    playbook,
    campaign: campaignName(playbook),
    channel: PLAYBOOKS[playbook].channel,
    leads: rows.map((row) => ({
      lead_id: row.lead.id,
      company: row.lead.company,
      tier: row.tier,
      score: row.score,
      has_email: Boolean(row.lead.email),
      has_linkedin: Boolean(row.lead.linkedinUrl),
    })),
  }))
  writeJson(outPath("draft-plan.json"), { confirm: Boolean(flags.confirm), plan })
  if (!flags.confirm) {
    console.log(JSON.stringify({ dry_run: true, enrollments: ready.length, plan }, null, 2))
    console.log("\nDry run. Nothing was created. Re-run with --confirm to create the campaigns (auto-send off) and enroll these leads.")
    return
  }
  if (ready.length === 0) {
    console.log("Nothing to enroll. Judge the dossier first, then rank.")
    return
  }
  const cfg = offer()
  const overloop = new Overloop(requireEnv("OVERLOOP_API_KEY"))
  const me = await overloop.me()
  const senderId = cfg.sender_id ?? me.id
  const results: Array<Record<string, unknown>> = []
  const now = new Date().toISOString()
  for (const [playbook, rows] of grouped) {
    const name = campaignName(playbook)
    let campaign = await overloop.findCampaignByName(name)
    let created = false
    if (!campaign) {
      campaign = await overloop.createCampaign(campaignBody(name, playbook, cfg, senderId))
      created = true
    }
    const enrolled: number[] = []
    const skipped: Array<{ lead_id: number; error: string }> = []
    for (const row of rows) {
      try {
        const prospectId = await upsertProspect(overloop, row)
        await overloop.enroll(campaign.id, prospectId)
        enrolled.push(row.lead.id)
        appendEnrollment({
          lead_id: row.lead.id,
          account: row.account ?? `lead:${row.lead.id}`,
          campaign_id: campaign.id,
          campaign: name,
          playbook,
          tier: row.tier,
          prospect_id: prospectId,
          at: now,
        })
      } catch (error) {
        skipped.push({ lead_id: row.lead.id, error: error instanceof Error ? error.message : String(error) })
      }
    }
    results.push({ campaign_id: campaign.id, name, created, status: campaign.status, enrolled, skipped })
  }
  writeJson(outPath("draft-result.json"), results)
  console.log(
    JSON.stringify(
      {
        auto_send: false,
        note: "Campaign status is what Overloop reports. New campaigns stay off until activate --confirm.",
        results,
      },
      null,
      2,
    ),
  )
}

function campaignBody(name: string, playbook: PlaybookId, cfg: OfferConfig, senderId: number): Record<string, unknown> {
  const book = PLAYBOOKS[playbook]
  return {
    name,
    sender_id: senderId,
    timezone: cfg.timezone,
    sending_days: cfg.sending_days,
    start_sending_minutes: cfg.start_sending_minutes,
    end_sending_minutes: cfg.end_sending_minutes,
    automatically_send_messages: false,
    automatically_send_follow_ups: false,
    only_allow_manual_enrollment: true,
    pitch_settings: cfg.offer,
    message_personalization_settings: cfg.voice,
    steps: book.steps,
  }
}

function normalizeLinkedin(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.toLowerCase().match(/linkedin\.com\/in\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]).replace(/\/$/, "") : null
}

async function upsertProspect(overloop: Overloop, row: RankedLead): Promise<number> {
  const lead = row.lead
  if (lead.email) {
    const existing = await overloop.searchProspects(lead.email)
    const match = existing.find((item) => item.email?.toLowerCase() === lead.email?.toLowerCase())
    if (match) return match.id
  }
  const handle = normalizeLinkedin(lead.linkedinUrl)
  if (handle) {
    const existing = await overloop.searchProspects(handle).catch(() => [])
    const match = existing.find((item) => normalizeLinkedin(item.linkedin_profile) === handle)
    if (match) return match.id
  }
  const [first, ...rest] = (lead.name ?? "").split(/\s+/).filter(Boolean)
  const created = await overloop.createProspect({
    email: lead.email ?? undefined,
    first_name: first || undefined,
    last_name: rest.join(" ") || undefined,
    jobtitle: lead.jobTitle ?? undefined,
    linkedin_profile: lead.linkedinUrl ?? undefined,
    description: trim(
      [`Signal: ${row.primarySignal ?? "unknown"}`, row.lead.evidence, row.judgment.hook ? `Hook: ${row.judgment.hook}` : ""]
        .filter(Boolean)
        .join("\n"),
      1500,
    ),
  })
  return created.id
}

async function setStatus(status: "on" | "off"): Promise<void> {
  if (!flags.campaign) throw new Error("--campaign is required")
  if (!flags.confirm) {
    console.log(`Dry run. Campaign ${flags.campaign} would be set to ${status}. Re-run with --confirm.`)
    return
  }
  const overloop = new Overloop(requireEnv("OVERLOOP_API_KEY"))
  const updated = await overloop.updateCampaign(Number(flags.campaign), { status })
  console.log(JSON.stringify({ id: updated.id, name: updated.name, status: updated.status }, null, 2))
}

async function stats(): Promise<void> {
  if (!flags.campaign) throw new Error("--campaign is required")
  const overloop = new Overloop(requireEnv("OVERLOOP_API_KEY"))
  const body = await overloop.campaignStats(Number(flags.campaign))
  console.log(JSON.stringify(body, null, 2))
}

async function inbox(): Promise<void> {
  const overloop = new Overloop(requireEnv("OVERLOOP_API_KEY"))
  const body = await overloop.listConversations()
  const rows = (body.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    created_from: row.created_from,
    last_activity_at: row.last_activity_at,
    archived_at: row.archived_at,
  }))
  console.log(JSON.stringify({ total: body.pagination?.total ?? rows.length, conversations: rows }, null, 2))
}

function calls(): void {
  const { ranked } = rankAll(false)
  const wanted = new Set((flags.tier ? String(flags.tier) : "strike").split(",").map((item) => item.trim()))
  const rows = ranked.filter((row) => row.judgment.judged && wanted.has(row.tier))
  const path = outPath("calls.csv")
  writeText(
    path,
    toCsv(
      ["tier", "score", "name", "title", "company", "phone", "email", "linkedin", "signal", "hook", "reason", "lead_id"],
      rows.map((row) => [
        row.tier,
        row.score,
        row.lead.name,
        row.lead.jobTitle,
        row.lead.company,
        row.lead.phone ?? "",
        row.lead.email ?? "",
        row.lead.linkedinUrl ?? "",
        row.primarySignal ?? "",
        row.judgment.hook,
        row.judgment.reason,
        row.lead.id,
      ]),
    ),
  )
  console.log(
    JSON.stringify(
      { tiers: [...wanted], leads: rows.length, with_phone: rows.filter((row) => row.lead.phone).length, calls: path },
      null,
      2,
    ),
  )
}

function outcome(): void {
  if (!flags.lead || !flags.result) throw new Error("--lead and --result are required")
  if (!(OUTCOMES as readonly string[]).includes(String(flags.result))) {
    throw new Error(`--result must be one of: ${OUTCOMES.join(", ")}`)
  }
  appendOutcome({ lead_id: Number(flags.lead), result: String(flags.result) })
  console.log(JSON.stringify({ logged: { lead_id: Number(flags.lead), result: flags.result } }, null, 2))
}

function learn(): void {
  const outcomes = loadOutcomes()
  const rankedPath = outPath("ranked.json")
  const ranked: RankedLead[] = existsSync(rankedPath) ? JSON.parse(readFileSync(rankedPath, "utf8")) : []
  const byId = new Map(ranked.map((row) => [row.lead.id, row]))
  const floor = loadRanker().act_floor
  let above = 0
  let aboveReply = 0
  let below = 0
  let belowReply = 0
  const replies = new Set(["reply", "meeting"])
  for (const outcomeRow of outcomes) {
    const row = byId.get(outcomeRow.lead_id)
    if (!row) continue
    const replied = replies.has(outcomeRow.result)
    if (row.score >= floor && row.tier !== "hold" && row.tier !== "reroute") {
      above += 1
      if (replied) aboveReply += 1
    } else {
      below += 1
      if (replied) belowReply += 1
    }
  }
  const aboveRate = above ? aboveReply / above : null
  const belowRate = below ? belowReply / below : null
  const miscalibrated = above >= 5 && below >= 5 && aboveRate != null && belowRate != null && belowRate > aboveRate
  console.log(
    JSON.stringify(
      {
        outcomes: outcomes.length,
        matched: above + below,
        above_line: { n: above, replies: aboveReply, rate: aboveRate },
        below_line: { n: below, replies: belowReply, rate: belowRate },
        verdict: miscalibrated ? "MISCALIBRATED" : above < 5 || below < 5 ? "NEED_MORE_OUTCOMES" : "HOLDS",
        note: "Change config/ranker.yaml and rank again. Do not call another model.",
      },
      null,
      2,
    ),
  )
}

async function probe(): Promise<void> {
  const overloop = new Overloop(requireEnv("OVERLOOP_API_KEY"))
  const me = await overloop.me()
  const cfg = offer()
  const name = `Grok GTM probe ${new Date().toISOString()}`
  const created = await overloop.createCampaign(campaignBody(name, "email-light", cfg, cfg.sender_id ?? me.id))
  await overloop.deleteCampaign(created.id)
  console.log(JSON.stringify({ probed: true, created_and_deleted: created.id, name }, null, 2))
}

function trim(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
