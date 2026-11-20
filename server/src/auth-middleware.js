import { auth } from './firebase.js'

export async function requireUser(req, res, next) {
  const header = req.header('Authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    res.status(401).json({ error: 'Missing Authorization Bearer token.' })
    return
  }

  try {
    const decoded = await auth.verifyIdToken(match[1], true)
    req.user = decoded
    next()
  } catch (error) {
    console.error('Failed to verify Firebase ID token', error)
    res.status(401).json({ error: 'Invalid or expired Firebase ID token.' })
  }
}
