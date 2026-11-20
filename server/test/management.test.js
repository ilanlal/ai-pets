import assert from 'node:assert/strict'
import { after, before, beforeEach, mock, test } from 'node:test'
import express from 'express'

const documents = new Map()
let generatedId = 0

function snapshot(ref) {
  const value = documents.get(ref.path)
  return { id: ref.id, exists: value !== undefined, data: () => value }
}

function collection(path) {
  return {
    doc(id = `generated${++generatedId}`) {
      return {
        id,
        path: `${path}/${id}`,
        collection(name) { return collection(`${this.path}/${name}`) },
        async get() { return snapshot(this) },
      }
    },
    limit(limit) { return query(path, limit) },
    orderBy() { return query(path) },
    async get() { return query(path).get() },
  }
}

function query(path, limit = Infinity, afterId = '') {
  return {
    limit(n) { return query(path, n, afterId) },
    startAfter(id) { return query(path, limit, id) },
    async get() {
      const docs = [...documents.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map((key) => ({ path: key, id: key.slice(path.length + 1) }))
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((ref) => ref.id > afterId)
        .slice(0, limit)
        .map(snapshot)
      return { docs, empty: docs.length === 0 }
    },
  }
}

const db = {
  collection,
  async runTransaction(callback) {
    const writes = []
    const tx = {
      get: (ref) => ref.path ? Promise.resolve(snapshot(ref)) : ref.get(),
      create: (ref, data) => writes.push({ ref, data, create: true }),
      set: (ref, data) => writes.push({ ref, data }),
      update: (ref, data) => writes.push({ ref, data, update: true }),
    }
    const result = await callback(tx)
    for (const { ref, data, create, update } of writes) {
      if (create && documents.has(ref.path)) throw new Error('Already exists')
      if (update && !documents.has(ref.path)) throw new Error('Missing document')
      documents.set(ref.path, update ? { ...documents.get(ref.path), ...data } : data)
    }
    return result
  },
}

const auth = {
  async verifyIdToken(token) {
    if (token === 'admin') return { uid: 'operator', admin: true }
    if (token === 'member') return { uid: 'member' }
    if (token === 'other') return { uid: 'other' }
    throw new Error('Invalid token')
  },
}
const admin = { firestore: { FieldValue: { serverTimestamp: () => 'timestamp' }, FieldPath: { documentId: () => '__name__' } } }
mock.module('../src/firebase.js', { namedExports: { db, auth, admin } })
const { default: router } = await import('../src/management.js')

let server
let url
before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', router)
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  url = `http://127.0.0.1:${server.address().port}`
})
after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
beforeEach(() => {
  documents.clear()
  documents.set('users/member', { tokenBalance: 100, memberStatus: 'active' })
  documents.set('serverSettings/billing', { trialTokens: 5000, defaultCouponTokens: 5000 })
})

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${url}/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, data: await response.json() }
}

const pet = { name: 'Fluffy', hunger: 30, happiness: 70, energy: 80, excited: 0, updatedAt: 1700000000000 }
const requestId = 'c1744deb-7460-4981-8488-3240a0cdbaf4'

test('admin endpoints reject unauthenticated and non-admin users', async () => {
  assert.equal((await request('/admin/users')).status, 401)
  assert.equal((await request('/admin/users', { token: 'member' })).status, 403)
  assert.equal((await request('/admin/users', { token: 'admin' })).status, 200)
})

test('balance adjustments are audited, idempotent and cannot become negative', async () => {
  const body = { amount: 25, reason: 'Support credit', requestId }
  const options = { token: 'admin', method: 'POST', body }
  assert.equal((await request('/admin/users/member/balance', options)).data.tokenBalance, 125)
  assert.equal((await request('/admin/users/member/balance', options)).data.tokenBalance, 125)
  assert.equal(documents.get('users/member').tokenBalance, 125)
  assert.equal(documents.get(`adminAudit/${requestId}`).reason, 'Support credit')
  documents.set('users/member', { ...documents.get('users/member'), tokenBalance: 120 })
  assert.equal((await request('/admin/users/member/balance', options)).data.tokenBalance, 120)
  assert.equal((await request('/admin/users/member/balance', { ...options, body: { ...body, amount: -200, requestId: 'aa5b01b6-4f69-4f22-b2fa-3e088f790bd0' } })).status, 400)
  assert.equal(documents.get('users/member').tokenBalance, 120)
  assert.equal((await request('/admin/users/member/balance', { ...options, body: { ...body, reason: '' } })).status, 400)
})

test('trial setting changes preserve coupon settings and reject invalid values', async () => {
  const options = { token: 'admin', method: 'PUT', body: { trialTokens: 9000 } }
  assert.equal((await request('/admin/settings', options)).status, 200)
  assert.deepEqual(documents.get('serverSettings/billing'), { trialTokens: 9000, defaultCouponTokens: 5000 })
  assert.equal((await request('/admin/settings', { ...options, body: { trialTokens: -1 } })).status, 400)
  assert.equal(documents.get('serverSettings/billing').trialTokens, 9000)
})

test('member imports a local pet once without replacing server pets', async () => {
  const options = { token: 'member', method: 'POST', body: { pet } }
  const first = await request('/pets/import', options)
  const second = await request('/pets/import', { ...options, body: { pet: { ...pet, name: 'Another' } } })
  assert.equal(first.data.pets.length, 1)
  assert.equal(second.data.pets.length, 1)
  assert.equal(second.data.pets[0].name, 'Fluffy')
  assert.equal(documents.get('users/member').petMigrationComplete, true)
})

test('existing server pets are preserved when local migration runs', async () => {
  documents.set('users/member/pets/existing', { ...pet, name: 'Server pet' })
  const result = await request('/pets/import', { token: 'member', method: 'POST', body: { pet: null } })
  assert.equal(result.status, 200)
  assert.equal(result.data.pets.length, 1)
  assert.equal(result.data.pets[0].name, 'Server pet')
  assert.equal(documents.get('users/member').petMigrationComplete, true)
})

test('admin creates pets and members cannot change another users pet', async () => {
  const created = await request('/admin/users/member/pets', { token: 'admin', method: 'POST', body: { name: 'Pip' } })
  assert.equal(created.status, 201)
  const id = created.data.pet.id
  assert.equal((await request(`/pets/${id}/actions`, { token: 'other', method: 'POST', body: { action: 'feed' } })).status, 404)
  const feed = await request(`/pets/${id}/actions`, { token: 'member', method: 'POST', body: { action: 'feed' } })
  assert.equal(feed.status, 200)
  assert.equal(feed.data.pet.hunger, 0)
})

test('admins can edit pet stats while invalid stats do not modify data', async () => {
  documents.set('users/member/pets/pet1', pet)
  const path = '/admin/users/member/pets/pet1/stats'
  const options = { token: 'admin', method: 'PUT', body: { hunger: 20, happiness: 40, energy: 60 } }
  assert.equal((await request(path, options)).status, 200)
  assert.equal(documents.get('users/member/pets/pet1').energy, 60)
  assert.equal((await request(path, { ...options, body: { ...options.body, energy: 101 } })).status, 400)
  assert.equal(documents.get('users/member/pets/pet1').energy, 60)
})
