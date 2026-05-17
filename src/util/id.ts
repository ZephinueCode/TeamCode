import { randomUUID } from "crypto"

export function ulid(): string {
  return randomUUID()
}
