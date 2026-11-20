import { GoogleGenAI } from '@google/genai'
import { config } from './config.js'
import { buildPetSystemPrompt } from './pet-prompts.js'

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey })

function extractUsedTokens(response) {
  const usage = response?.usageMetadata ?? {}
  if (Number.isFinite(usage.totalTokenCount)) {
    return usage.totalTokenCount
  }

  const input = Number.isFinite(usage.promptTokenCount) ? usage.promptTokenCount : 0
  const output = Number.isFinite(usage.candidatesTokenCount) ? usage.candidatesTokenCount : 0
  return input + output
}

export async function createPetReply({ message, pet }) {
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('message is required.')
  }

  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: message.trim(),
    config: {
      systemInstruction: buildPetSystemPrompt({
        petName: pet?.name,
        mood: pet?.mood,
        hunger: pet?.hunger,
        energy: pet?.energy,
      }),
    },
  })

  const text = response?.text?.trim()
  if (!text) {
    throw new Error('Gemini returned an empty response.')
  }

  return {
    text,
    usedTokens: extractUsedTokens(response),
    usageMetadata: response?.usageMetadata ?? null,
  }
}
