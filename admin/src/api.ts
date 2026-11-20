import type { User } from 'firebase/auth'

export interface Member {
  uid: string
  email: string | null
  displayName: string | null
  memberStatus: string | null
  tokenBalance: number | null
}

export interface Pet {
  id: string
  name: string
  hunger: number
  happiness: number
  energy: number
}

export interface Settings {
  trialTokens: number
  defaultCouponTokens: number
}

const base = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/+$/, '')

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPet(value: unknown): value is Pet {
  return record(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    [value.hunger, value.happiness, value.energy].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)
}

function isMember(value: unknown): value is Member {
  return record(value) && typeof value.uid === 'string' &&
    [value.email, value.displayName, value.memberStatus].every((n) => n === null || typeof n === 'string') &&
    (value.tokenBalance === null || (typeof value.tokenBalance === 'number' && Number.isSafeInteger(value.tokenBalance)))
}

function numberField(data: unknown, key: string): number {
  if (!record(data) || typeof data[key] !== 'number' || !Number.isSafeInteger(data[key])) throw new Error('The server returned an invalid response.')
  return data[key]
}

async function call(user: User, path: string, method = 'GET', body?: object): Promise<unknown> {
  const token = await user.getIdToken()
  const response = await fetch(`${base}/api/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 403) throw new Error('This account does not have the admin claim.')
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error : `Request failed (${response.status}).`
    throw new Error(message)
  }
  if (!data || typeof data !== 'object') throw new Error('The server returned an invalid response.')
  return data
}

export async function health(): Promise<boolean> {
  const response = await fetch(`${base}/health`)
  if (!response.ok) throw new Error(`Health check failed (${response.status}).`)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) {
    throw new Error('Invalid health response.')
  }
  return true
}

export async function getUsers(user: User, after?: string): Promise<{ users: Member[]; next: string | null }> {
  const data = await call(user, `/users${after ? `?after=${encodeURIComponent(after)}` : ''}`)
  if (!record(data) || !Array.isArray(data.users) || !data.users.every(isMember) ||
      !(data.next === null || typeof data.next === 'string')) throw new Error('The server returned an invalid member list.')
  return { users: data.users, next: data.next }
}

export async function getSettings(user: User): Promise<Settings> {
  const data = await call(user, '/settings')
  return { trialTokens: numberField(data, 'trialTokens'), defaultCouponTokens: numberField(data, 'defaultCouponTokens') }
}

export async function setTrial(user: User, trialTokens: number) {
  const data = await call(user, '/settings', 'PUT', { trialTokens })
  return { trialTokens: numberField(data, 'trialTokens') }
}

export async function adjustBalance(user: User, uid: string, amount: number, reason: string, requestId: string) {
  const data = await call(user, `/users/${encodeURIComponent(uid)}/balance`, 'POST', { amount, reason, requestId })
  return { tokenBalance: numberField(data, 'tokenBalance') }
}

export async function getPets(user: User, uid: string): Promise<{ pets: Pet[] }> {
  const data = await call(user, `/users/${encodeURIComponent(uid)}/pets`)
  if (!record(data) || !Array.isArray(data.pets) || !data.pets.every(isPet)) throw new Error('The server returned an invalid pet list.')
  return { pets: data.pets }
}

async function petResult(request: Promise<unknown>): Promise<{ pet: Pet }> {
  const data = await request
  if (!record(data) || !isPet(data.pet)) throw new Error('The server returned an invalid pet.')
  return { pet: data.pet }
}

export const createPet = (user: User, uid: string, name: string) =>
  petResult(call(user, `/users/${encodeURIComponent(uid)}/pets`, 'POST', { name }))
export const setPetStats = (user: User, uid: string, pet: Pet) =>
  petResult(call(user, `/users/${encodeURIComponent(uid)}/pets/${encodeURIComponent(pet.id)}/stats`, 'PUT', {
    hunger: pet.hunger, happiness: pet.happiness, energy: pet.energy,
  }))
