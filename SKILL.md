---
name: grok-gtm
description: Signal-based multi-channel GTM bot. Pull Max leads, judge buying signals, and enroll the right tier into paused Overloop email and LinkedIn sequences.
---

# Grok GTM

You are the judge. This repo does not call another model. Max supplies leads and the evidence. You decide whether the evidence is a live need, whether it matches the offer, and whether the contact can buy. Overloop runs the email and LinkedIn sequences. Code applies the weights.

Do not enroll a lead you have not judged. Do not turn a campaign on unless the operator explicitly tells you to.

## The loop

From the repo root:

1. `npm run gtm -- doctor` — confirm both keys, the mailbox, and which Max business is selected.
2. `npm run gtm -- watch --pages 1 --per-page 25` — pull the newest leads into `data/leads.jsonl`. That file is local and stays out of git.
3. `npm run gtm -- dossier` — write `out/dossier.md`.
4. Judge every lead in the dossier. Append JSON lines to `out/judgments.jsonl`.
5. `npm run gtm -- rank` — write `out/ranked.csv`. Read it from the top.
6. `npm run gtm -- draft` — dry run. Show the operator the plan.
7. `npm run gtm -- draft --confirm` — only after the operator agrees. Creates paused Overloop campaigns and enrolls judged leads. Review mode stays on, so Overloop queues messages instead of sending them.
8. `npm run gtm -- activate --campaign <id> --confirm` — only when the operator says to start that campaign.
9. When replies come in, `npm run gtm -- outcome --lead <id> --result reply` and then `npm run gtm -- learn`.

`npm run gtm -- rank --heuristic` is a preview. Those rows are unjudged. Draft skips them.

## How to judge

The Company block and the Contact block are separate on purpose. If the contact is visible to every question, a recruiter makes a real need look weak and a senior title makes a weak need look strong.

For each lead, answer from the Company block only:

- `live_need` — is there a current need in the evidence, not a guess about next quarter.
- `need_matches_offer` — is that need one this offer serves. A tender for office furniture is not a need for outbound software. A funding round is cash, not a need, unless the stated use of proceeds matches the offer.
- `icp_fit` — company size, industry, and location against the ICP in the dossier.
- `signals_one_story` — true only when two signals are the same situation. A reposted Head of Growth role plus a launch in a new market can be one story. A sponsorship, a sustainability page, and a podcast are three announcements, not urgency.
- `competitor` — true when the company sells the same thing we do.

Then read the Contact block and answer only:

- `persona_fit` — can this person buy or champion. A recruiter on a hot account is a low score. Do not go back and edit `live_need`.

Write one line:

```json
{"lead_id":123,"live_need":0.8,"need_matches_offer":0.7,"icp_fit":0.6,"persona_fit":0.2,"signals_one_story":true,"competitor":false,"hook":"They reposted the Head of Growth role after the Germany launch.","reason":"The role is still open and the contact is a recruiter, so this is a reroute.","judged":true}
```

Open `post_url` or the company site before you give a strike score, and only keep evidence you actually saw. If the page is dead, say so in `reason` and set `live_need` to 0.

## What the code will do with that

Weights live in `config/ranker.yaml`. A live need for this offer counts the most, then the contact's seat, then ICP fit and signal strength, then recency. A second signal adds weight only when `signals_one_story` is true.

Order of the gates:

1. A competitor is held. They are not enrolled.
2. A contact under the persona floor cannot clear the line. If the need is strong, the tier is `reroute`: hot account, wrong person. Do not enroll them. Say who to look for instead.
3. No live need for this offer stays `hold`, even if the title matches.

Tiers, high to low:

| Tier | When | Sequence |
| --- | --- | --- |
| strike | Score at or above 80, live need, right buyer | Email and LinkedIn in the same week |
| priority | 65–79 | Email and LinkedIn, slower gaps |
| standard | 50–64 | One channel. Engagement signals start on LinkedIn. Hiring, funding, and tenders start on email when an address exists |
| light | 35–49 | One touch. A connection request, or one email |
| reroute | Strong need, wrong person | No sequence |
| hold | No live need, a competitor, or no way to reach them | No sequence |

Signal strength, strongest first: public tender, contract award, competitor sales relationship, M&A, hiring spike, reposted role, technology replacement, key departure, regulatory change, competitor social engagement, funding (only if the use matches), product launch, fresh job, expansion, job change, then engagement, mentions, new registrations, and website visits. An ICP match with no other signal is fit, not timing. The full list with numbers is `npm run gtm -- signals`.

One website visit is a hint. Do not stack unrelated announcements into urgency.

## Channels

Strike and priority use both channels when the lead has an email and a LinkedIn URL. If one is missing, the sequence uses the channel that exists. Standard follows the signal: LinkedIn-native evidence (comments, reactions, page engagement, job changes) starts on LinkedIn. Light never chases.

Campaign names are stable (`Grok · Strike · email and LinkedIn` and the other five). A later draft reuses the campaign instead of creating a duplicate. Messages are `generate_with_ai` inside Overloop, from `config/offer.yaml`. You do not call an LLM API to write them. You do put the hook on the prospect so the reviewer can see why they were enrolled.

Autopilot stays off. Turning a campaign on schedules the sequence. It does not skip review unless someone later changes that in Overloop.

## Before you activate

`doctor` must show a working mailbox, and `sender_id` in `config/offer.yaml` must be that mailbox's `user_id`. The API key owner is not always the sender. LinkedIn steps also need a LinkedIn account connected in Overloop. This bot cannot connect either one.

Do not activate to "test". `npm run gtm -- probe` creates an empty campaign and deletes it.

## After replies

Log `reply`, `meeting`, `no_reply`, or `bounce`. `learn` compares reply rate above the line with reply rate below it. If the bottom replies more, it prints `MISCALIBRATED`. Fix the offer, the ICP, or one weight, then rank again. Do not invent a new model call.
