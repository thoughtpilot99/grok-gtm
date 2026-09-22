import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Judgment, LeadRecord, RankedLead } from "./types.js"

export function dataPath(name: string, root = process.cwd()): string {
  return resolve(root, "data", name)
}

export function outPath(name: string, root = process.cwd()): string {
  return resolve(root, "out", name)
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")
}

export function writeText(path: string, value: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true })
  writeFileSync(path, value)
}

export function loadLeads(root = process.cwd()): LeadRecord[] {
  const rows = readJsonl<LeadRecord>(dataPath("leads.jsonl", root))
  const byId = new Map<number, LeadRecord>()
  for (const row of rows) byId.set(row.id, row)
  return [...byId.values()]
}

export function saveLeads(leads: LeadRecord[], root = process.cwd()): void {
  const path = dataPath("leads.jsonl", root)
  mkdirSync(resolve(path, ".."), { recursive: true })
  const byId = new Map(loadLeads(root).map((lead) => [lead.id, lead]))
  for (const lead of leads) byId.set(lead.id, lead)
  const body = [...byId.values()].map((lead) => JSON.stringify(lead)).join("\n")
  writeFileSync(path, body ? body + "\n" : "")
}

/**
 * Top-level JSON objects in order, whether each sits on one line or is wrapped
 * across several. Grok sometimes pretty-prints a judgment; that should not
 * break rank.
 */
export function parseJsonObjects<T>(text: string): T[] {
  const out: T[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === "}") {
      depth -= 1
      if (depth === 0 && start !== -1) {
        out.push(JSON.parse(text.slice(start, i + 1)) as T)
        start = -1
      }
    }
  }
  return out
}

export function loadJudgments(root = process.cwd()): Map<number, Judgment> {
  const path = outPath("judgments.jsonl", root)
  const rows = existsSync(path) ? parseJsonObjects<Judgment>(readFileSync(path, "utf8")) : []
  const map = new Map<number, Judgment>()
  for (const row of rows) {
    if (row && typeof row.lead_id === "number") map.set(row.lead_id, { ...row, judged: row.judged !== false })
  }
  return map
}

export function appendOutcome(row: Record<string, unknown>, root = process.cwd()): void {
  const path = dataPath("outcomes.jsonl", root)
  mkdirSync(resolve(path, ".."), { recursive: true })
  appendFileSync(path, JSON.stringify({ ...row, at: new Date().toISOString() }) + "\n")
}

export const OUTCOMES = ["reply", "meeting", "no_reply", "bounce"] as const

/** The latest logged outcome per lead. Logging a lead twice replaces, never double-counts. */
export function loadOutcomes(root = process.cwd()): Array<{ lead_id: number; result: string }> {
  const latest = new Map<number, { lead_id: number; result: string }>()
  for (const row of readJsonl<{ lead_id: number; result: string }>(dataPath("outcomes.jsonl", root))) {
    if (row && typeof row.lead_id === "number") latest.set(row.lead_id, row)
  }
  return [...latest.values()]
}

export interface Enrollment {
  lead_id: number
  account: string
  campaign_id: number
  campaign: string
  playbook: string
  tier: string
  prospect_id: number
  at: string
}

export function appendEnrollment(row: Enrollment, root = process.cwd()): void {
  const path = dataPath("enrollments.jsonl", root)
  mkdirSync(resolve(path, ".."), { recursive: true })
  appendFileSync(path, JSON.stringify(row) + "\n")
}

export function loadEnrollments(root = process.cwd()): Enrollment[] {
  return readJsonl<Enrollment>(dataPath("enrollments.jsonl", root))
}

export function rankedToCsv(rows: RankedLead[]): string {
  const header = ["tier", "score", "playbook", "company", "title", "signal", "age_days", "lead_id", "account", "reason", "hook", "why"]
  const lines = [header.join(",")]
  for (const row of rows) {
    lines.push(
      [
        row.tier,
        row.score,
        row.playbook ?? "",
        row.lead.company ?? "",
        row.lead.jobTitle ?? "",
        row.primarySignal ?? "",
        row.ageDays ?? "",
        row.lead.id,
        row.account ?? "",
        row.judgment.reason,
        row.judgment.hook,
        row.reasons.join(" "),
      ]
        .map(csv)
        .join(","),
    )
  }
  return lines.join("\n") + "\n"
}

function csv(value: unknown): string {
  const text = String(value ?? "")
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((row) => row.map(csv).join(","))].join("\n") + "\n"
}
