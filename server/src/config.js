import dotenv from 'dotenv'

dotenv.config()

function required(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

const rawOrigins = process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173'
const allowedOrigins = rawOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

export const config = {
  port: Number.parseInt(process.env.PORT ?? '8080', 10),
  allowedOrigins,
  geminiApiKey: required('GEMINI_API_KEY'),
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
}

if (!Number.isFinite(config.port) || config.port < 1) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`)
}

