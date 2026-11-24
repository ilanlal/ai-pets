import dotenv from 'dotenv'

dotenv.config()

const rawOrigins = process.env.ALLOWED_ORIGINS ?? ''
const allowedOrigins = rawOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

export const config = {
  port: 3000,
  allowedOrigins,
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
}

if (!Number.isFinite(config.port) || config.port < 1) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`)
}

