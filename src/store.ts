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

export function loadJudgments(root = process.cwd()): Map<number, Judgment> {
  const rows = readJsonl<Judgment>(outPath("judgments.jsonl", root))
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

export function loadOutcomes(root = process.cwd()): Array<{ lead_id: number; result: string }> {
  return readJsonl(dataPath("outcomes.jsonl", root))
}

export function rankedToCsv(rows: RankedLead[]): string {
  const header = ["tier", "score", "playbook", "company", "title", "signal", "age_days", "lead_id", "reason", "hook"]
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
        row.judgment.reason,
        row.judgment.hook,
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
