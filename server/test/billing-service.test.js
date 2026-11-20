import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const documents = new Map()
const db = {
  collection(collection) {
    return { doc: (id) => `${collection}/${id}` }
  },
  async runTransaction(callback) {
    const writes = []
    const tx = {
      async get(ref) {
        const data = documents.get(ref)
        return { exists: data !== undefined, data: () => data }
      },
      set(ref, data, options) {
        writes.push({ ref, data, merge: options?.merge })
      },
    }
    const result = await callback(tx)
    for (const { ref, data, merge } of writes) {
      documents.set(ref, merge ? { ...documents.get(ref), ...data } : data)
    }
    return result
  },
}

mock.module('../src/firebase.js', {
  namedExports: { db, admin: { firestore: { FieldValue: { serverTimestamp: () => 'timestamp' } } } },
})
const { subscribeMember, redeemCoupon } = await import('../src/billing-service.js')

test('grants the configured trial once per member', async () => {
  documents.clear()
  documents.set('serverSettings/billing', { trialTokens: 5000, defaultCouponTokens: 5000 })
  assert.equal((await subscribeMember({ uid: 'user' })).tokenBalance, 5000)
  documents.set('serverSettings/billing', { trialTokens: 9000, defaultCouponTokens: 5000 })
  const second = await subscribeMember({ uid: 'user' })
  assert.equal(second.grantedTokens, 0)
  assert.equal(second.tokenBalance, 5000)
})

test('redeems a stored coupon using the current default once per member', async () => {
  documents.clear()
  documents.set('serverSettings/billing', { trialTokens: 5000, defaultCouponTokens: 5000 })
  documents.set('users/user', { tokenBalance: 100 })
  documents.set('couponCodes/SECRET', { enabled: true, redeemedCount: 0 })
  assert.deepEqual(await redeemCoupon({ uid: 'user', code: ' secret ' }), {
    accepted: true, grantedTokens: 5000, tokenBalance: 5100,
  })
  assert.deepEqual(await redeemCoupon({ uid: 'user', code: 'SECRET' }), {
    accepted: false, reason: 'already_redeemed',
  })
  assert.equal(documents.get('couponCodes/SECRET').redeemedCount, 1)
  assert.equal(documents.get('users/user').tokenBalance, 5100)
  documents.set('serverSettings/billing', { trialTokens: 5000, defaultCouponTokens: 3000 })
  const next = await redeemCoupon({ uid: 'other', code: 'SECRET' })
  assert.equal(next.grantedTokens, 3000)
  assert.equal(next.tokenBalance, 3000)
})

test('rejects unknown and malformed coupon codes without granting tokens', async () => {
  documents.clear()
  documents.set('users/user', { tokenBalance: 100 })
  assert.equal((await redeemCoupon({ uid: 'user', code: 'UNKNOWN' })).reason, 'invalid_code')
  assert.equal((await redeemCoupon({ uid: 'user', code: '../billing' })).reason, 'invalid_code')
  assert.equal(documents.get('users/user').tokenBalance, 100)
})

test('fails without a valid Firestore token setting rather than granting a default', async () => {
  documents.clear()
  documents.set('serverSettings/billing', { trialTokens: -1 })
  await assert.rejects(subscribeMember({ uid: 'user' }), /trialTokens/)
  assert.equal(documents.has('users/user'), false)
  documents.set('couponCodes/SECRET', { enabled: true })
  await assert.rejects(redeemCoupon({ uid: 'user', code: 'SECRET' }), /defaultCouponTokens/)
  assert.equal(documents.has('users/user'), false)
})
