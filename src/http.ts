export class ApiError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(formatMessage(status, body))
    this.status = status
    this.body = body
  }
}

function formatMessage(status: number, body: string): string {
  try {
    const json = JSON.parse(body) as {
      error?: { message?: string } | string
      errors?: Array<{ field?: string; message?: string } | string>
    }
    if (typeof json.error === "string") return `API ${status}: ${json.error}`
    if (json.error?.message) return `API ${status}: ${json.error.message}`
    if (Array.isArray(json.errors)) {
      const text = json.errors
        .map((item) => (typeof item === "string" ? item : `${item.field ?? "field"}: ${item.message ?? ""}`))
        .join(", ")
      if (text) return `API ${status}: ${text}`
    }
  } catch {
    // Body was not JSON.
  }
  const trimmed = body.replace(/\s+/g, " ").slice(0, 400)
  return `API ${status}: ${trimmed || "empty response"}`
}

export async function requestJson<T>(url: string, apiKey: string, init: RequestInit = {}, auth: "raw" | "bearer" = "raw"): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  headers.set("User-Agent", "GrokGTM/0.1")
  headers.set("Authorization", auth === "bearer" ? `Bearer ${apiKey}` : apiKey)
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")

  const response = await fetch(url, { ...init, headers })
  if (response.status === 204) return null as T
  const text = await response.text()
  if (!response.ok) throw new ApiError(response.status, text)
  if (!text) return null as T
  return JSON.parse(text) as T
}
