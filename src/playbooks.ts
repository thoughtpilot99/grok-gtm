import type { PlaybookId } from "./types.js"

export interface SequenceStep {
  type: string
  config: Record<string, unknown>
}

export interface Playbook {
  id: PlaybookId
  label: string
  channel: "multichannel" | "email" | "linkedin"
  summary: string
  steps: SequenceStep[]
}

const ai = { generate_with_ai: true }

export const PLAYBOOKS: Record<PlaybookId, Playbook> = {
  "multichannel-strike": {
    id: "multichannel-strike",
    label: "Strike · email and LinkedIn",
    channel: "multichannel",
    summary: "Same-week coverage. Visit, connect, email, then a LinkedIn note and one email follow-up. For a verified need and the right buyer.",
    steps: [
      { type: "linkedin_visit_profile", config: {} },
      { type: "delay", config: { hours_delay: 4 } },
      { type: "linkedin_send_invitation", config: ai },
      { type: "delay", config: { days_delay: 1 } },
      { type: "email", config: ai },
      { type: "delay", config: { days_delay: 3 } },
      { type: "linkedin_send_message", config: ai },
      { type: "delay", config: { days_delay: 4 } },
      { type: "email", config: ai },
    ],
  },
  "multichannel-priority": {
    id: "multichannel-priority",
    label: "Priority · email and LinkedIn",
    channel: "multichannel",
    summary: "Same shape as strike, with more time between touches so a strong but less urgent signal is not rushed.",
    steps: [
      { type: "linkedin_visit_profile", config: {} },
      { type: "delay", config: { days_delay: 1 } },
      { type: "linkedin_send_invitation", config: ai },
      { type: "delay", config: { days_delay: 2 } },
      { type: "email", config: ai },
      { type: "delay", config: { days_delay: 4 } },
      { type: "linkedin_send_message", config: ai },
      { type: "delay", config: { days_delay: 5 } },
      { type: "email", config: ai },
    ],
  },
  "email-standard": {
    id: "email-standard",
    label: "Standard · email",
    channel: "email",
    summary: "Three emails. Use when the signal is real and email is the channel you have, or LinkedIn is the wrong first move.",
    steps: [
      { type: "email", config: ai },
      { type: "delay", config: { days_delay: 3 } },
      { type: "email", config: ai },
      { type: "delay", config: { days_delay: 5 } },
      { type: "email", config: ai },
    ],
  },
  "email-light": {
    id: "email-light",
    label: "Light · one email",
    channel: "email",
    summary: "A single email. Hints and weak timing get one ask, not a chase.",
    steps: [{ type: "email", config: ai }],
  },
  "linkedin-standard": {
    id: "linkedin-standard",
    label: "Standard · LinkedIn",
    channel: "linkedin",
    summary: "Visit, connect, then two messages. For engagement signals and people you can only reach on LinkedIn.",
    steps: [
      { type: "linkedin_visit_profile", config: {} },
      { type: "delay", config: { hours_delay: 12 } },
      { type: "linkedin_send_invitation", config: ai },
      { type: "delay", config: { days_delay: 3 } },
      { type: "linkedin_send_message", config: ai },
      { type: "delay", config: { days_delay: 5 } },
      { type: "linkedin_send_message", config: ai },
    ],
  },
  "linkedin-light": {
    id: "linkedin-light",
    label: "Light · LinkedIn visit and connect",
    channel: "linkedin",
    summary: "Profile visit and a connection request. No message sequence until a stronger signal shows up.",
    steps: [
      { type: "linkedin_visit_profile", config: {} },
      { type: "delay", config: { days_delay: 1 } },
      { type: "linkedin_send_invitation", config: ai },
    ],
  },
}

export function campaignName(playbook: PlaybookId): string {
  return `Grok · ${PLAYBOOKS[playbook].label}`
}
