import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { requireUser } from './auth-middleware.js'
import { subscribeMember, redeemCoupon, consumeTokens } from './billing-service.js'
import { createPetReply } from './chat-service.js'
import management from './management.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDistDir = path.resolve(__dirname, '../../client/dist')

export const app = express()

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`))
    },
  }),
)
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api', management)

app.post('/api/events', requireUser, async (req, res) => {
  const eventType = req.body?.eventType

  try {
    if (eventType === 'member_subscribed') {
      const result = await subscribeMember({
        uid: req.user.uid,
        email: req.user.email,
        displayName: req.user.name,
        photoURL: req.user.picture,
      })
      res.json({
        eventType,
        membership: 'active',
        tokenBalance: result.tokenBalance,
        grantedTokens: result.grantedTokens,
        trialGranted: result.trialGranted,
      })
      return
    }

    if (eventType === 'redeem_coupon') {
      const couponCode = req.body?.couponCode
      const result = await redeemCoupon({
        uid: req.user.uid,
        code: couponCode,
      })
      if (!result.accepted) {
        res.status(400).json({
          eventType,
          accepted: false,
          reason: result.reason,
        })
        return
      }
      res.json({
        eventType,
        accepted: true,
        grantedTokens: result.grantedTokens,
        tokenBalance: result.tokenBalance,
      })
      return
    }

    res.status(400).json({
      error: 'Unsupported eventType. Allowed values: member_subscribed, redeem_coupon.',
    })
  } catch (error) {
    console.error('Event handling failed', { eventType, error })
    res.status(500).json({ error: 'Failed to process event.' })
  }
})

app.post('/api/chat', requireUser, async (req, res) => {
  const { message, pet } = req.body ?? {}

  try {
    const chat = await createPetReply({ message, pet })
    const balance = await consumeTokens({
      uid: req.user.uid,
      usedTokens: chat.usedTokens,
      metadata: {
        source: 'chat',
        model: config.geminiModel,
      },
    })

    res.json({
      reply: chat.text,
      usage: {
        usedTokens: balance.usedTokens,
        usageMetadata: chat.usageMetadata,
      },
      balance: {
        previous: balance.previousBalance,
        remaining: balance.tokenBalance,
      },
    })
  } catch (error) {
    console.error('Chat failed', error)
    res.status(500).json({ error: 'Failed to process chat request.' })
  }
})

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(path.join(clientDistDir, 'index.html'))
  })
}

app.use((err, _req, res, _next) => {
  if (err?.message?.startsWith('Origin not allowed by CORS')) {
    res.status(403).json({ error: err.message })
    return
  }
  console.error('Unhandled error', err)
  res.status(500).json({ error: 'Internal server error.' })
})
