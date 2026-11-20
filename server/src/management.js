import { Router } from 'express'
import { admin, db } from './firebase.js'
import { requireUser } from './auth-middleware.js'

const router = Router()
const timestamp = () => admin.firestore.FieldValue.serverTimestamp()
const invalid = (message) => Object.assign(new Error(message), { status: 400 })
const missing = (message) => Object.assign(new Error(message), { status: 404 })
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 128 && !id.includes('/') && id !== '.' && id !== '..'
const userRef = (uid) => db.collection('users').doc(uid)
const petsRef = (uid) => userRef(uid).collection('pets')
const settingsRef = () => db.collection('serverSettings').doc('billing')

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error.status === 400 || error.status === 404) {
        res.status(error.status).json({ error: error.message })
      } else {
        console.error('Management request failed', error)
        res.status(500).json({ error: 'Request failed.' })
      }
    }
  }
}

function requireAdmin(req, res, next) {
  if (req.user.admin !== true) {
    res.status(403).json({ error: 'Administrator access required.' })
    return
  }
  next()
}

function parseId(id) {
  if (!validId(id)) throw invalid('Invalid document identifier.')
  return id
}

function parsePet(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Invalid pet.')
  const { name, hunger, happiness, energy, excited, updatedAt } = value
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw invalid('Invalid pet name.')
  if (![hunger, happiness, energy].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)) throw invalid('Pet stats must be between 0 and 100.')
  if (![excited, updatedAt].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= Date.now() + 86400000)) throw invalid('Invalid pet timestamp.')
  return { name: name.trim(), hunger, happiness, energy, excited, updatedAt }
}

function stats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Invalid pet stats.')
  const { hunger, happiness, energy } = value
  if (![hunger, happiness, energy].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)) throw invalid('Pet stats must be between 0 and 100.')
  return { hunger, happiness, energy }
}

function clamp(n) {
  return Math.max(0, Math.min(100, n))
}

function tick(pet, now) {
  const minutes = Math.max(0, (now - pet.updatedAt) / 60000)
  return {
    ...pet,
    hunger: clamp(pet.hunger + minutes),
    energy: clamp(pet.energy - minutes * 0.5),
    happiness: clamp(pet.happiness - minutes * (pet.hunger > 70 ? 1.5 : 0.5)),
    updatedAt: now,
  }
}

async function listPets(uid) {
  const snapshot = await petsRef(uid).get()
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

router.get('/pets', requireUser, route(async (req, res) => {
  res.json({ pets: await listPets(req.user.uid) })
}))

router.post('/pets/import', requireUser, route(async (req, res) => {
  const user = userRef(req.user.uid)
  await db.runTransaction(async (tx) => {
    const [snapshot, existing] = await Promise.all([tx.get(user), tx.get(petsRef(req.user.uid).limit(1))])
    if (!snapshot.exists) throw missing('Member not found.')
    if (snapshot.data().petMigrationComplete) return
    if (existing.empty) tx.create(petsRef(req.user.uid).doc(), parsePet(req.body?.pet))
    tx.update(user, { petMigrationComplete: true })
  })
  res.json({ pets: await listPets(req.user.uid) })
}))

router.post('/pets/:petId/actions', requireUser, route(async (req, res) => {
  const petRef = petsRef(req.user.uid).doc(parseId(req.params.petId))
  const action = req.body?.action
  if (!['feed', 'play', 'sleep', 'rename'].includes(action)) throw invalid('Invalid pet action.')
  const name = req.body?.name
  if (action === 'rename' && (typeof name !== 'string' || !name.trim() || name.trim().length > 100)) throw invalid('Invalid pet name.')
  const pet = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(petRef)
    if (!snapshot.exists) throw missing('Pet not found.')
    const now = Date.now()
    const next = tick(parsePet(snapshot.data()), now)
    if (action === 'feed') {
      next.hunger = clamp(next.hunger - 40)
      next.happiness = clamp(next.happiness + 5)
    } else if (action === 'play') {
      next.happiness = clamp(next.happiness + 20)
      next.energy = clamp(next.energy - 15)
      next.hunger = clamp(next.hunger + 10)
      next.excited = now + 8000
    } else if (action === 'sleep') {
      next.energy = clamp(next.energy + 50)
    } else {
      next.name = name.trim()
    }
    tx.set(petRef, next)
    return { id: petRef.id, ...next }
  })
  res.json({ pet })
}))

router.use('/admin', requireUser, requireAdmin)

router.get('/admin/users', route(async (req, res) => {
  let query = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(51)
  if (req.query.after !== undefined) query = query.startAfter(parseId(req.query.after))
  const result = await query.get()
  const page = result.docs.slice(0, 50)
  res.json({
    users: page.map((doc) => {
      const { email, displayName, memberStatus, tokenBalance } = doc.data()
      return { uid: doc.id, email: email ?? null, displayName: displayName ?? null, memberStatus: memberStatus ?? null, tokenBalance: tokenBalance ?? null }
    }),
    next: result.docs.length > 50 ? page[page.length - 1].id : null,
  })
}))

router.post('/admin/users/:uid/balance', route(async (req, res) => {
  const uid = parseId(req.params.uid)
  const { amount, reason, requestId } = req.body ?? {}
  if (!Number.isSafeInteger(amount) || amount === 0) throw invalid('Amount must be a non-zero integer.')
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) throw invalid('A reason is required.')
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw invalid('A valid request ID is required.')
  const ref = userRef(uid)
  const audit = db.collection('adminAudit').doc(requestId)
  const balance = await db.runTransaction(async (tx) => {
    const [snapshot, prior] = await Promise.all([tx.get(ref), tx.get(audit)])
    if (!snapshot.exists) throw missing('Member not found.')
    if (prior.exists) {
      const saved = prior.data()
      if (saved.actor !== req.user.uid || saved.target !== uid || saved.action !== 'balance_adjustment' || saved.amount !== amount || saved.reason !== reason.trim()) throw invalid('Request ID was already used.')
      return snapshot.data().tokenBalance
    }
    const previous = snapshot.data().tokenBalance
    if (!Number.isSafeInteger(previous) || previous < 0 || !Number.isSafeInteger(previous + amount) || previous + amount < 0) throw invalid('Adjustment would create an invalid balance.')
    const next = previous + amount
    tx.update(ref, { tokenBalance: next, updatedAt: timestamp() })
    tx.create(audit, { actor: req.user.uid, target: uid, action: 'balance_adjustment', amount, reason: reason.trim(), previous, balance: next, createdAt: timestamp() })
    return next
  })
  res.json({ tokenBalance: balance })
}))

router.get('/admin/settings', route(async (_req, res) => {
  const snapshot = await settingsRef().get()
  if (!snapshot.exists) throw missing('Billing settings not found.')
  const { trialTokens, defaultCouponTokens } = snapshot.data()
  res.json({ trialTokens, defaultCouponTokens })
}))

router.put('/admin/settings', route(async (req, res) => {
  const { trialTokens } = req.body ?? {}
  if (!Number.isSafeInteger(trialTokens) || trialTokens < 0) throw invalid('Trial tokens must be a non-negative integer.')
  const ref = settingsRef()
  const audit = db.collection('adminAudit').doc()
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) throw missing('Billing settings not found.')
    tx.update(ref, { trialTokens })
    tx.create(audit, { actor: req.user.uid, action: 'trial_tokens_changed', previous: snapshot.data().trialTokens, trialTokens, createdAt: timestamp() })
  })
  res.json({ trialTokens })
}))

router.get('/admin/users/:uid/pets', route(async (req, res) => {
  res.json({ pets: await listPets(parseId(req.params.uid)) })
}))

router.post('/admin/users/:uid/pets', route(async (req, res) => {
  const uid = parseId(req.params.uid)
  const name = req.body?.name
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw invalid('Invalid pet name.')
  const user = userRef(uid)
  const ref = petsRef(uid).doc()
  const audit = db.collection('adminAudit').doc()
  const pet = { name: name.trim(), hunger: 30, happiness: 70, energy: 80, excited: 0, updatedAt: Date.now() }
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(user)).exists) throw missing('Member not found.')
    tx.create(ref, pet)
    tx.create(audit, { actor: req.user.uid, action: 'pet_created', target: uid, petId: ref.id, createdAt: timestamp() })
  })
  res.status(201).json({ pet: { id: ref.id, ...pet } })
}))

router.put('/admin/users/:uid/pets/:petId/stats', route(async (req, res) => {
  const uid = parseId(req.params.uid)
  const ref = petsRef(uid).doc(parseId(req.params.petId))
  const values = stats(req.body)
  const audit = db.collection('adminAudit').doc()
  const pet = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) throw missing('Pet not found.')
    const previous = parsePet(snapshot.data())
    const next = { ...previous, ...values, updatedAt: Date.now() }
    tx.set(ref, next)
    tx.create(audit, { actor: req.user.uid, action: 'pet_stats_changed', target: uid, petId: ref.id, previous: stats(previous), stats: values, createdAt: timestamp() })
    return { id: ref.id, ...next }
  })
  res.json({ pet })
}))

export default router
