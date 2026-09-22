import { requestJson } from "./http.js"
import type { LeadRecord } from "./types.js"

interface MaxLead {
  id: number
  name?: string | null
  job_title?: string | null
  headline?: string | null
  email?: string | null
  linkedin_url?: string | null
  company?: string | null
  company_industry?: string | null
  company_size?: string | null
  company_website?: string | null
  location?: string | null
  icp_score?: number | null
  phone?: string | null
  mobile_phone?: string | null
  phone_number?: string | null
  signals?: Array<{ slug?: string; name?: string }>
  post_url?: string | null
  triggered_at?: string | null
  created_at?: string | null
  payload?: {
    signal_excerpt?: string | null
    engagement_context?: string | null
    company_summary?: string | null
  }
}

export interface MaxBusiness {
  id: number
  name: string
  website: string | null
  description: string | null
  ideal_customer_profile?: {
    target_job_titles?: string[]
    target_locations?: string[]
    target_industries?: string[]
    company_sizes?: string[]
    mandatory_keywords?: string[]
    excluded_companies?: string[]
  }
}

export class Max {
  constructor(
    private apiKey: string,
    private baseUrl = (process.env.MAX_API_URL || "https://api.yourmax.ai").replace(/\/$/, ""),
  ) {}

  private url(path: string): string {
    return `${this.baseUrl}/api/v1${path}`
  }

  private get<T>(path: string): Promise<T> {
    return requestJson(this.url(path), this.apiKey, {}, "bearer")
  }

  async businesses(): Promise<MaxBusiness[]> {
    const body = await this.get<{ businesses: MaxBusiness[] }>("/businesses")
    return body.businesses ?? []
  }

  async business(id: number): Promise<MaxBusiness> {
    const body = await this.get<{ business: MaxBusiness }>(`/businesses/${id}`)
    return body.business
  }

  async signals(): Promise<Array<{ slug: string; name: string; description?: string }>> {
    const body = await this.get<{ signals: Array<{ slug: string; name: string; description?: string }> }>("/signals")
    return body.signals ?? []
  }

  async leads(businessId: number, page: number, perPage: number): Promise<{ leads: LeadRecord[]; total: number; pages: number }> {
    const body = await this.get<{ leads: MaxLead[]; meta?: { total_count?: number; total_pages?: number } }>(
      `/businesses/${businessId}/leads?page=${page}&per_page=${perPage}`,
    )
    return {
      leads: (body.leads ?? []).map((lead) => normalizeLead(lead, businessId)),
      total: body.meta?.total_count ?? body.leads?.length ?? 0,
      pages: body.meta?.total_pages ?? 1,
    }
  }

  async subscriptions(businessId: number): Promise<Array<{ id: number; name: string; active?: boolean; signal_slug?: string; signal?: { slug?: string } }>> {
    const body = await this.get<{
      subscriptions: Array<{ id: number; name: string; active?: boolean; signal_slug?: string; signal?: { slug?: string } }>
    }>(`/businesses/${businessId}/subscriptions`)
    return body.subscriptions ?? []
  }
}

export function normalizeLead(lead: MaxLead, businessId: number): LeadRecord {
  const payload = lead.payload ?? {}
  const evidence = payload.signal_excerpt || payload.engagement_context || payload.company_summary || null
  return {
    id: lead.id,
    businessId,
    name: lead.name ?? null,
    jobTitle: lead.job_title ?? null,
    headline: lead.headline ?? null,
    email: lead.email ?? null,
    linkedinUrl: lead.linkedin_url ?? null,
    company: lead.company ?? null,
    companyIndustry: lead.company_industry ?? null,
    companySize: lead.company_size ?? null,
    companyWebsite: lead.company_website ?? null,
    location: lead.location ?? null,
    icpScore: lead.icp_score ?? null,
    signals: (lead.signals ?? [])
      .filter((signal) => signal.slug)
      .map((signal) => ({ slug: signal.slug as string, name: signal.name })),
    evidence,
    postUrl: lead.post_url ?? null,
    triggeredAt: lead.triggered_at ?? lead.created_at ?? null,
    phone: lead.mobile_phone ?? lead.phone ?? lead.phone_number ?? null,
  }
}
