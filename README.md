# Grok GTM

A signal-based outreach bot for Grok in Cursor. Leads come from [max](https://yourmax.ai). Grok reads the evidence and ranks it. [Overloop](https://overloop.com) runs the email and LinkedIn sequences. Nothing in this repo calls a separate model API.

The ranking method follows the signal-based outbound loop: verify the evidence, treat two signals as timing only when they are one story, keep the gate in code, and read the score as a sort order. Tiers decide the channel.

| Tier | What it means | What gets sent |
| --- | --- | --- |
| Strike | A verified need and the right buyer | LinkedIn visit, connection, email, LinkedIn note, email follow-up |
| Priority | Strong, less urgent | The same two channels, with longer gaps |
| Standard | One real signal | Email, or LinkedIn when the evidence happened there |
| Light | A hint | One email, or a connection request |
| Reroute | Hot account, wrong person | Nothing. Find the buyer |
| Hold | No live need, a competitor, the wrong contact without a strong need, or a second contact at an account already covered | Nothing |

## Run it from Cursor

Clone the repo, open it in Cursor, and tell Grok to run the GTM loop. The instructions are in [SKILL.md](SKILL.md). Grok will pull leads, write judgments, and stop before anything sends.

From the terminal:

```bash
npm install
cp .env.example .env
```

Put your Overloop key and your max key in `.env`. They stay on this machine.

```bash
npm run gtm -- doctor
npm run gtm -- watch --pages 1 --per-page 25
npm run gtm -- dossier
# Grok writes out/judgments.jsonl
npm run gtm -- rank
npm run gtm -- draft
npm run gtm -- draft --confirm
```

`draft` without `--confirm` only prints the plan. With `--confirm` it creates the campaigns with auto-send off and enrolls judged leads, one contact per account, and records each enrollment in `data/enrollments.jsonl`. Overloop queues the messages for review. Starting a campaign is a separate command, and it also requires `--confirm`:

```bash
npm run gtm -- activate --campaign 123 --confirm
```

## Accounts

max can send several contacts for one company. Leads are grouped into accounts by website domain, then company name.

- Signals pool across the account, so a reposted role on one contact and a launch on another count as two signals at one account.
- Only the best contact per account is enrolled in a run. The others are held, and `ranked.csv` names the lead that covers the account.
- An account enrolled in the last `account_cooldown_days` (30 by default) is held, so a re-run never enrolls the same company twice. Enrollments live in `data/enrollments.jsonl`.
- Every judgment carries the account's fingerprint. When a new signal or a new contact lands on the account, the fingerprint changes and the leads there go back into the dossier. A lead held for a thin signal gets judged again when the second signal arrives.

## Call list

```bash
npm run gtm -- calls
```

Writes the strike rows to `out/calls.csv`: name, title, company, phone when max sends one, email, LinkedIn, the signal, the hook and Grok's reason. Call them first; the sequence runs behind the call.

## The morning job

Judging happens in Cursor, so schedule the part that does not need Grok:

```bash
0 8 * * 1-5 cd ~/grok-gtm && npm run gtm -- prep >> out/prep.log 2>&1
```

`prep` runs `watch` then `dossier`. Open Cursor, tell Grok to judge the dossier, then rank and draft.

## No max account

`data/leads.jsonl` is plain JSON lines. Write your own leads in the same shape `watch` writes (numeric `id`, `company`, `companyWebsite`, `jobTitle`, `email`, `linkedinUrl`, `signals: [{"slug": "..."}]`, `evidence`, `triggeredAt`) and everything from `dossier` on works the same.

## Configure the offer

`config/offer.yaml` is seeded for the Overloop business already in this max account (`business_id: 3`). Change the pitch, the ICP, and `business_id` if you prospect for someone else. `npm run gtm -- businesses` lists the max businesses this key can see.

Set `sender_id` to the `user_id` of a working mailbox from `doctor` before your first `draft --confirm`. Left at `null`, campaigns send from the owner of the Overloop API key. LinkedIn steps also need a LinkedIn account connected in Overloop. This bot cannot connect either account for you.

`config/ranker.yaml` holds the weights, the floors and the account settings. Change a number and rank again; judgments stay valid. If you change the offer or the ICP, clear `out/judgments.jsonl` and judge again, because Grok read `need_matches_offer` and `icp_fit` against the old ones.

## Signals

`npm run gtm -- signals` prints the catalog: the signals max emits today, plus watch-only signals (launches, regulatory changes, technology replacement, and the rest) so a judgment can name evidence max has not turned into a feed yet. Only signals on the lead records count toward the score. `npm run gtm -- signals --live` checks the catalog against max's API.

Strongest first: a public tender, a contract award, a competitor's sales team adding the contact, a hiring spike, a reposted role, then a fresh posting. A website visit is a hint. An ICP match with no other signal is not a reason to write.

## Learn from replies

```bash
npm run gtm -- inbox
npm run gtm -- outcome --lead 123 --result reply
npm run gtm -- learn
```

Outcomes are `reply`, `meeting`, `no_reply` or `bounce`, latest per lead. `learn` compares the reply rate above the line with the rate below it. With at least five on each side it prints `MISCALIBRATED` when the bottom replies more, otherwise `HOLDS`. Light-tier leads sit under the line and still get one touch, which is where the below-the-line replies come from.

## Tests

```bash
npm test
```

`npm run gtm -- probe` creates an empty Overloop campaign and deletes it. It does not enroll anyone.

## License

MIT. See [LICENSE](LICENSE).
