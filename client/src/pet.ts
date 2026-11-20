export type Mood = 'happy' | 'sad' | 'hungry' | 'sleepy' | 'excited' | 'curious'

export interface Pet {
  name: string
  hunger: number // 0 = full, 100 = starving
  happiness: number
  energy: number
  excited: number // timestamp until which the pet is excited
  updatedAt: number
}

export const MOODS: Record<Mood, { emoji: string; label: string }> = {
  happy: { emoji: '😸', label: 'שמח' },
  sad: { emoji: '😿', label: 'עצוב' },
  hungry: { emoji: '🙀', label: 'רעב' },
  sleepy: { emoji: '😴', label: 'עייף' },
  excited: { emoji: '🤩', label: 'נרגש' },
  curious: { emoji: '🐱', label: 'סקרן' },
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))
const KEY = 'ai-pets:pet'

export const newPet = (name = 'פלאפי'): Pet => ({
  name,
  hunger: 30,
  happiness: 70,
  energy: 80,
  excited: 0,
  updatedAt: Date.now(),
})

export function loadPet(): Pet {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return tick({ ...newPet(), ...JSON.parse(raw) })
  } catch {
    /* ignore corrupt data */
  }
  return newPet()
}

export const savePet = (p: Pet) => localStorage.setItem(KEY, JSON.stringify(p))

// Stats drift over time, also while the app was closed.
export function tick(p: Pet, now = Date.now()): Pet {
  const minutes = (now - p.updatedAt) / 60000
  return {
    ...p,
    hunger: clamp(p.hunger + minutes * 1),
    energy: clamp(p.energy - minutes * 0.5),
    happiness: clamp(p.happiness - minutes * (p.hunger > 70 ? 1.5 : 0.5)),
    updatedAt: now,
  }
}

export function getMood(p: Pet, now = Date.now()): Mood {
  if (p.excited > now) return 'excited'
  if (p.hunger > 70) return 'hungry'
  if (p.energy < 20) return 'sleepy'
  if (p.happiness < 30) return 'sad'
  if (p.happiness > 70) return 'happy'
  return 'curious'
}

export const feed = (p: Pet): Pet => ({
  ...p,
  hunger: clamp(p.hunger - 40),
  happiness: clamp(p.happiness + 5),
})

export const play = (p: Pet): Pet => ({
  ...p,
  happiness: clamp(p.happiness + 20),
  energy: clamp(p.energy - 15),
  hunger: clamp(p.hunger + 10),
  excited: Date.now() + 8000,
})

export const sleep = (p: Pet): Pet => ({ ...p, energy: clamp(p.energy + 50) })
