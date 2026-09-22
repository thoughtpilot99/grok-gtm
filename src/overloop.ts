import { requestJson } from "./http.js"

export interface OverloopUser {
  id: number
  name: string
  email: string
  role: string
  timezone: string
}

export interface OverloopAccount {
  id: number
  name: string
  website: string | null
  plan_name: string
  remaining_credits: number
}

export interface SendingAddress {
  id: number
  email: string
  from_name: string
  provider: string
  working: boolean
  user_id: number
}

export interface OverloopCampaign {
  id: number
  name: string
  status: "on" | "off"
  sender_id?: number
  sourcing_id?: string | null
}

export class Overloop {
  constructor(
    private apiKey: string,
    private baseUrl = (process.env.OVERLOOP_API_URL || "https://api.overloop.ai").replace(/\/$/, ""),
  ) {}

  private url(path: string): string {
    return `${this.baseUrl}/public/v2${path}`
  }

  me(): Promise<OverloopUser> {
    return requestJson(this.url("/me"), this.apiKey)
  }

  account(): Promise<OverloopAccount> {
    return requestJson(this.url("/account"), this.apiKey)
  }

  async sendingAddresses(): Promise<SendingAddress[]> {
    const body = await requestJson<{ data: SendingAddress[] }>(this.url("/sending_addresses"), this.apiKey)
    return body.data ?? []
  }

  async listCampaigns(page = 1): Promise<OverloopCampaign[]> {
    const body = await requestJson<{ data: OverloopCampaign[] }>(
      this.url(`/campaigns?per_page=100&page=${page}`),
      this.apiKey,
    )
    return body.data ?? []
  }

  async findCampaignByName(name: string): Promise<OverloopCampaign | null> {
    for (let page = 1; page <= 10; page += 1) {
      const rows = await this.listCampaigns(page)
      const found = rows.find((row) => row.name === name)
      if (found) return found
      if (rows.length < 100) return null
    }
    return null
  }

  createCampaign(body: Record<string, unknown>): Promise<OverloopCampaign> {
    return requestJson(this.url("/campaigns"), this.apiKey, { method: "POST", body: JSON.stringify(body) })
  }

  updateCampaign(id: number, body: Record<string, unknown>): Promise<OverloopCampaign> {
    return requestJson(this.url(`/campaigns/${id}`), this.apiKey, { method: "PATCH", body: JSON.stringify(body) })
  }

  deleteCampaign(id: number): Promise<unknown> {
    return requestJson(this.url(`/campaigns/${id}`), this.apiKey, { method: "DELETE" })
  }

  async campaignStats(id: number): Promise<unknown> {
    return requestJson(this.url(`/campaigns/${id}/stats`), this.apiKey)
  }

  async searchProspects(search: string): Promise<Array<{ id: number; email?: string; linkedin_profile?: string }>> {
    const body = await requestJson<{ data: Array<{ id: number; email?: string; linkedin_profile?: string }> }>(
      this.url(`/prospects?search=${encodeURIComponent(search)}&per_page=20`),
      this.apiKey,
    )
    return body.data ?? []
  }

  createProspect(body: Record<string, unknown>): Promise<{ id: number }> {
    return requestJson(this.url("/prospects"), this.apiKey, { method: "POST", body: JSON.stringify(body) })
  }

  enroll(campaignId: number, prospectId: number): Promise<unknown> {
    return requestJson(this.url(`/campaigns/${campaignId}/enrollments`), this.apiKey, {
      method: "POST",
      body: JSON.stringify({ prospect_id: prospectId }),
    })
  }

  async listConversations(page = 1): Promise<{ data: Array<Record<string, unknown>>; pagination?: { total?: number } }> {
    return requestJson(this.url(`/conversations?per_page=50&page=${page}&sort=-last_activity_at`), this.apiKey)
  }
}
