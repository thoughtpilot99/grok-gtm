import assert from "node:assert/strict"
import test from "node:test"
import { accountKey, buildAccounts, domainOf, withAccountSignals } from "./accounts.js"
import { applyAccountRules, DEFAULT_RANKER, scoreLead } from "./policy.js"
import { parseJsonObjects } from "./store.js"
import type { Judgment, LeadRecord } from "./types.js"

function lead(partial: Partial<LeadRecord>): LeadRecord {
  return {
    id: 1,
    businessId: 1,
    name: "Ada Buyer",
    jobTitle: "Head of Sales",
    headline: "Head of Sales",
    email: "ada@northwind.example",
    linkedinUrl: "https://www.linkedin.com/in/ada",
    company: "Northwind",
    companyIndustry: "Software",
    companySize: "11-50",
    companyWebsite: "https://www.northwind.example/about",
    location: "Brussels",
    icpScore: 8,
    signals: [{ slug: "republished-job-offers" }],
    evidence: "Head of Growth reposted.",
    postUrl: null,
    triggeredAt: new Date().toISOString(),
    ...partial,
  }
}

const judged: Judgment = {
  lead_id: 1,
  live_need: 0.8,
  need_matches_offer: 0.8,
  icp_fit: 0.85,
  persona_fit: 0.9,
  signals_one_story: true,
  competitor: false,
  hook: "The Head of Growth role went back up after the launch.",
  reason: "Repost and launch are one story, and the contact owns sales.",
  judged: true,
}

test("account key prefers the website domain, then the company name", () => {
  assert.equal(domainOf("https://www.northwind.example/about"), "northwind.example")
  assert.equal(accountKey(lead({})), "domain:northwind.example")
  assert.equal(accountKey(lead({ companyWebsite: null, company: "Northwind SA" })), "company:northwind")
  assert.equal(accountKey(lead({ companyWebsite: null, company: null, id: 9 })), "lead:9")
})

test("a second signal on another contact at the same account counts as the second signal", () => {
  const first = lead({ id: 1 })
  const second = lead({ id: 2, name: "Bo Other", jobTitle: "CMO", signals: [{ slug: "product-launch" }], evidence: "Launched in Germany." })
  const accounts = buildAccounts([first, second])
  const account = accounts.get("domain:northwind.example")
  assert.ok(account)
  const alone = scoreLead(first, judged)
  const pooled = scoreLead(withAccountSignals(first, account), judged)
  assert.equal(alone.secondSignal, null)
  assert.equal(pooled.secondSignal, "product-launch")
  assert.ok(pooled.score > alone.score)
  assert.equal(alone.tier, "priority")
  assert.equal(pooled.tier, "strike")
})

test("a new signal at the account changes the fingerprint, so the old judgment goes stale", () => {
  const before = buildAccounts([lead({ id: 1 })]).get("domain:northwind.example")
  const after = buildAccounts([lead({ id: 1 }), lead({ id: 2, signals: [{ slug: "product-launch" }] })]).get("domain:northwind.example")
  assert.ok(before && after)
  assert.notEqual(before.fingerprint, after.fingerprint)
  const same = buildAccounts([lead({ id: 1, evidence: "reworded" })]).get("domain:northwind.example")
  assert.equal(same?.fingerprint, before.fingerprint)
})

test("only the best contact per account is enrolled in a run", () => {
  const best = { ...scoreLead(lead({ id: 1 }), judged), account: "domain:northwind.example" }
  const next = { ...scoreLead(lead({ id: 2, jobTitle: "VP Sales" }), { ...judged, lead_id: 2, persona_fit: 0.7 }), account: "domain:northwind.example" }
  const elsewhere = { ...scoreLead(lead({ id: 3, companyWebsite: "https://acme.example" }), { ...judged, lead_id: 3 }), account: "domain:acme.example" }
  const ruled = applyAccountRules([best, next, elsewhere].sort((a, b) => b.score - a.score))
  const byId = new Map(ruled.map((row) => [row.lead.id, row]))
  assert.notEqual(byId.get(1)?.tier, "hold")
  assert.equal(byId.get(2)?.tier, "hold")
  assert.equal(byId.get(2)?.playbook, null)
  assert.notEqual(byId.get(3)?.tier, "hold")
})

test("an account enrolled inside the cooldown is not enrolled again", () => {
  const row = { ...scoreLead(lead({ id: 1 }), judged), account: "domain:northwind.example" }
  const ruled = applyAccountRules([row], DEFAULT_RANKER, new Map([["domain:northwind.example", "Grok · Strike, 2026-09-20"]]))
  assert.equal(ruled[0].tier, "hold")
  assert.match(ruled[0].reasons.join(" "), /already in a sequence/)
})

test("judgments wrapped across lines still parse", () => {
  const text = '{"lead_id":1,"hook":"a {brace} and a \\"quote\\"",\n "judged":true}\n{"lead_id":2,"judged":true}\n'
  const rows = parseJsonObjects<{ lead_id: number; hook?: string }>(text)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].hook, 'a {brace} and a "quote"')
  assert.equal(rows[1].lead_id, 2)
})
