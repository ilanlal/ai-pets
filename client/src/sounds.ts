import type { Mood } from './pet'

interface SoundPattern {
  notes: number[]
  spacing: number
  duration: number
  waveform: OscillatorType
}

const patterns: Record<Mood, SoundPattern> = {
  happy: { notes: [523, 659, 784], spacing: 0.09, duration: 0.16, waveform: 'sine' },
  sad: { notes: [440, 392, 330], spacing: 0.13, duration: 0.2, waveform: 'sine' },
  hungry: { notes: [740, 740], spacing: 0.16, duration: 0.09, waveform: 'square' },
  sleepy: { notes: [392, 330, 262], spacing: 0.16, duration: 0.23, waveform: 'sine' },
  excited: { notes: [660, 784, 988, 1175], spacing: 0.07, duration: 0.12, waveform: 'triangle' },
  curious: { notes: [523, 659], spacing: 0.12, duration: 0.17, waveform: 'triangle' },
}

let audioContext: AudioContext | undefined

function getAudioContext() {
  audioContext ??= new AudioContext()
  return audioContext
}

export async function playMoodSound(mood: Mood, volume: number): Promise<void> {
  if (volume <= 0) return

  const context = getAudioContext()
  if (context.state !== 'running') await context.resume()

  const pattern = patterns[mood]
  const start = context.currentTime
  pattern.notes.forEach((frequency, index) => {
    const noteStart = start + index * pattern.spacing
    const oscillator = context.createOscillator()
    const envelope = context.createGain()

    oscillator.type = pattern.waveform
    oscillator.frequency.setValueAtTime(frequency, noteStart)
    envelope.gain.setValueAtTime(0.0001, noteStart)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.12), noteStart + 0.015)
    envelope.gain.exponentialRampToValueAtTime(0.0001, noteStart + pattern.duration)
    oscillator.connect(envelope)
    envelope.connect(context.destination)
    oscillator.start(noteStart)
    oscillator.stop(noteStart + pattern.duration)
  })
}
