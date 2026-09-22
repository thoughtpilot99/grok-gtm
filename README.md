# Grok GTM

A signal-based outreach bot for Grok in Cursor. Leads come from [Max](https://yourmax.ai). Grok reads the evidence and ranks it. [Overloop](https://overloop.com) runs the email and LinkedIn sequences. Nothing in this repo calls a separate model API.

The ranking method follows the signal-based outbound loop: verify the evidence, treat two signals as timing only when they are one story, keep the gate in code, and read the score as a sort order. Tiers decide the channel.

| Tier | What it means | What gets sent |
| --- | --- | --- |
| Strike | A verified need and the right buyer | LinkedIn visit, connection, email, LinkedIn note, email follow-up |
| Priority | Strong, less urgent | The same two channels, with longer gaps |
| Standard | One real signal | Email, or LinkedIn when the evidence happened there |
| Light | A hint | One email, or a connection request |
| Reroute | Hot account, wrong person | Nothing. Find the buyer |
| Hold | No live need, or a competitor | Nothing |

## Run it from Cursor

Clone the repo, open it in Cursor, and tell Grok to run the GTM loop. The instructions are in [SKILL.md](SKILL.md). Grok will pull leads, write judgments, and stop before anything sends.

From the terminal:

```bash
npm install
cp .env.example .env
```

Put your Overloop key and your Max key in `.env`. They stay on this machine.

```bash
npm run gtm -- doctor
npm run gtm -- watch --pages 1 --per-page 25
npm run gtm -- dossier
# Grok writes out/judgments.jsonl
npm run gtm -- rank
npm run gtm -- draft
npm run gtm -- draft --confirm
```

`draft` without `--confirm` only prints the plan. With `--confirm` it creates **paused** campaigns and enrolls judged leads. Overloop queues the messages for review. Starting a campaign is a separate command, and it also requires `--confirm`:

```bash
npm run gtm -- activate --campaign 123 --confirm
```

## Configure the offer

`config/offer.yaml` is seeded for the Overloop business already in this Max account (`business_id: 3`). Change the pitch, the ICP, and `business_id` if you prospect for someone else. `npm run gtm -- businesses` lists the Max businesses this key can see.

Set `sender_id` to the `user_id` of a mailbox from `doctor` before you activate. LinkedIn steps also need a LinkedIn account connected in Overloop. This bot cannot connect either account for you.

`config/ranker.yaml` holds the weights and the floors. Change a number and rank again. You do not re-judge unless the evidence changed.

## Signals

`npm run gtm -- signals` prints the catalog: the signals Max emits today, plus watch-only signals (launches, regulatory changes, technology replacement, and the rest) so a judgment can name evidence Max has not turned into a feed yet.

Strongest first: a public tender, a contract award, a competitor's sales team adding the contact, a hiring spike, a reposted role, then a fresh posting. A website visit is a hint. An ICP match with no other signal is not a reason to write.

## Tests

```bash
npm test
```

`npm run gtm -- probe` creates an empty Overloop campaign and deletes it. It does not enroll anyone.
