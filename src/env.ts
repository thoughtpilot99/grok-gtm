import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

export function loadEnv(root = process.cwd()): void {
  const path = resolve(root, ".env")
  if (!existsSync(path)) return
  const text = readFileSync(path, "utf8")
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}. Add it to .env (see .env.example).`)
  return value
}

export function hint(secret: string): string {
  if (secret.length < 4) return "set"
  return `••••${secret.slice(-4)}`
}
