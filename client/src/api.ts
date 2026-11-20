import type { User } from 'firebase/auth'
import type { Mood, Pet } from './pet'

const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/+$/, '')

async function request(user: User, path: string, body?: object): Promise<unknown> {
  const token = await user.getIdToken()
  const response = await fetch(`${apiUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const reason = data && typeof data === 'object' && 'reason' in data ? data.reason : null
    const reasons: Record<string, string> = {
      invalid_code: 'קוד הקופון אינו תקין.',
      already_redeemed: 'הקופון כבר מומש בחשבון זה.',
      disabled_coupon: 'הקופון אינו פעיל.',
      coupon_exhausted: 'הקופון מוצה.',
    }
    throw new Error(typeof reason === 'string' && reason in reasons
      ? reasons[reason]
      : `השרת החזיר שגיאה (${response.status}).`)
  }
  return data
}

function balance(data: unknown): number {
  if (!data || typeof data !== 'object' || !('tokenBalance' in data) ||
      typeof data.tokenBalance !== 'number' || !Number.isFinite(data.tokenBalance)) {
    throw new Error('השרת החזיר יתרה לא תקינה.')
  }
  return data.tokenBalance
}

export async function subscribe(user: User): Promise<number> {
  return balance(await request(user, '/api/events', { eventType: 'member_subscribed' }))
}

export async function redeemCoupon(user: User, couponCode: string): Promise<number> {
  return balance(await request(user, '/api/events', { eventType: 'redeem_coupon', couponCode }))
}

export async function chatWithPet(user: User, pet: Pet, mood: Mood, message: string) {
  const data = await request(user, '/api/chat', {
    message,
    pet: { name: pet.name, mood, hunger: pet.hunger, energy: pet.energy },
  })
  if (!data || typeof data !== 'object' || !('reply' in data) ||
      typeof data.reply !== 'string' || !('balance' in data) ||
      !data.balance || typeof data.balance !== 'object' ||
      !('remaining' in data.balance) || typeof data.balance.remaining !== 'number' ||
      !Number.isFinite(data.balance.remaining)) {
    throw new Error('השרת החזיר תשובה לא תקינה.')
  }
  return { reply: data.reply, remaining: data.balance.remaining }
}

export type ServerPet = Pet & { id: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isServerPet(value: unknown): value is ServerPet {
  if (!record(value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string' &&
    ['hunger', 'happiness', 'energy', 'excited', 'updatedAt']
      .every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))
}

function parsePets(data: unknown): ServerPet[] {
  if (!data || typeof data !== 'object' || !('pets' in data) ||
      !Array.isArray(data.pets) || !data.pets.every(isServerPet)) {
    throw new Error('השרת החזיר רשימת חיות לא תקינה.')
  }
  return data.pets
}

export async function importPet(user: User, pet: Pet): Promise<ServerPet[]> {
  return parsePets(await request(user, '/api/pets/import', { pet }))
}

export async function getPets(user: User): Promise<ServerPet[]> {
  return parsePets(await request(user, '/api/pets'))
}

export async function petAction(user: User, id: string, action: 'feed' | 'play' | 'sleep' | 'rename', name?: string): Promise<ServerPet> {
  const data = await request(user, `/api/pets/${encodeURIComponent(id)}/actions`, { action, name })
  if (!data || typeof data !== 'object' || !('pet' in data) || !isServerPet(data.pet)) {
    throw new Error('השרת החזיר חיה לא תקינה.')
  }
  return data.pet
}
