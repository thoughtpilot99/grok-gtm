import assert from "node:assert/strict"
import test from "node:test"
import { heuristicJudgment, scoreLead } from "./policy.js"
import type { LeadRecord, OfferConfig } from "./types.js"

const offer: OfferConfig = {
  business_id: 1,
  sender_id: null,
  timezone: "Etc/UTC",
  sending_days: ["monday"],
  start_sending_minutes: 540,
  end_sending_minutes: 1020,
  offer: {
    website_url: "https://overloop.com",
    selling_description: "Multi-channel outbound sequences.",
    pain_points: "Generic cold email.",
    benefits: "Email and LinkedIn in one sequence.",
    proof_points: "",
    campaign_intent: "Book a working session",
  },
  voice: { language: "english (United States)", formality: "friendly", tone_of_voice: "straightforward", length: "short" },
  icp: {
    titles: ["Head of Sales", "VP Sales"],
    industries: ["Software"],
    sizes: ["11-50"],
    locations: ["Belgium"],
    bad_fits: ["agency"],
    excluded_keywords: ["intern"],
    competitors: ["Instantly"],
  },
}

function lead(partial: Partial<LeadRecord>): LeadRecord {
  return {
    id: 1,
    businessId: 1,
    name: "Ada Buyer",
    jobTitle: "Head of Sales",
    headline: "Head of Sales",
    email: "ada@example.com",
    linkedinUrl: "https://www.linkedin.com/in/ada",
    company: "Northwind",
    companyIndustry: "Software",
    companySize: "11-50",
    companyWebsite: "https://northwind.example",
    location: "Brussels",
    icpScore: 8,
    signals: [{ slug: "public-tenders" }],
    evidence: "Tender for sales engagement software, deadline in 12 days.",
    postUrl: null,
    triggeredAt: new Date().toISOString(),
    ...partial,
  }
}

const judged = {
  lead_id: 1,
  live_need: 0.95,
  need_matches_offer: 0.9,
  icp_fit: 0.85,
  persona_fit: 0.9,
  signals_one_story: false,
  competitor: false,
  hook: "The tender closes in 12 days.",
  reason: "The tender asks for the work we sell, and the contact owns it.",
  judged: true,
}

test("a matching tender with the right buyer is a strike on both channels", () => {
  const row = scoreLead(lead({}), judged)
  assert.equal(row.tier, "strike")
  assert.equal(row.playbook, "multichannel-strike")
  assert.ok(row.score >= 80)
})

test("fit without a live need stays under the line", () => {
  const row = scoreLead(
    lead({ signals: [{ slug: "atlas-icp" }], evidence: "Matches a title search." }),
    { ...judged, live_need: 0.1, need_matches_offer: 0.2, hook: "Title match only." },
  )
  assert.equal(row.tier, "hold")
  assert.equal(row.playbook, null)
})

test("a strong need with the wrong person is a reroute, not a sequence", () => {
  const row = scoreLead(lead({ jobTitle: "Recruiter" }), { ...judged, persona_fit: 0.2 })
  assert.equal(row.tier, "reroute")
  assert.equal(row.playbook, null)
})

test("a competitor is not enrolled even with a tender", () => {
  const row = scoreLead(lead({ company: "Instantly" }), { ...judged, competitor: true })
  assert.equal(row.tier, "hold")
  assert.equal(row.playbook, null)
  assert.ok(row.score <= 34)
})

test("a second signal adds only when the two are one story", () => {
  const base = lead({ signals: [{ slug: "republished-job-offers" }, { slug: "product-launch" }] })
  const apart = scoreLead(base, { ...judged, signals_one_story: false, live_need: 0.8, need_matches_offer: 0.8 })
  const together = scoreLead(base, { ...judged, signals_one_story: true, live_need: 0.8, need_matches_offer: 0.8 })
  assert.ok(together.score > apart.score)
})

test("engagement with only a hint stays light and starts on LinkedIn", () => {
  const row = scoreLead(
    lead({
      signals: [{ slug: "linkedin-reactions" }],
      evidence: "Commented on a post about outbound personalization.",
    }),
    { ...judged, live_need: 0.42, need_matches_offer: 0.42, icp_fit: 0.4, persona_fit: 0.5, hook: "" },
  )
  assert.equal(row.tier, "light")
  assert.equal(row.playbook, "linkedin-light")
})

test("heuristic does not mark the lead judged", () => {
  const judgment = heuristicJudgment(lead({ signals: [{ slug: "atlas-icp" }] }), offer)
  assert.equal(judgment.judged, false)
})
