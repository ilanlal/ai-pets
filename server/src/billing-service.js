import { admin, db } from './firebase.js'

function nowTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp()
}

function usersDoc(uid) {
  return db.collection('users').doc(uid)
}

function couponsDoc(code) {
  return db.collection('couponCodes').doc(code)
}

function redemptionsDoc(uid, code) {
  return db.collection('couponRedemptions').doc(`${uid}_${code}`)
}

function billingSettingsDoc() {
  return db.collection('serverSettings').doc('billing')
}

function requiredTokens(data, name, minimum) {
  const value = data?.[name]
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Invalid or missing Firestore billing setting: ${name}`)
  }
  return value
}

export async function subscribeMember({ uid, email, displayName, photoURL }) {
  const userRef = usersDoc(uid)

  return db.runTransaction(async (tx) => {
    const [existing, settings] = await Promise.all([
      tx.get(userRef),
      tx.get(billingSettingsDoc()),
    ])
    const data = existing.exists ? existing.data() : {}
    const trialAlreadyGranted = Boolean(data?.trialGranted)
    const beforeBalance = Number.isFinite(data?.tokenBalance) ? data.tokenBalance : 0
    const grant = trialAlreadyGranted ? 0 : requiredTokens(settings.data(), 'trialTokens', 0)
    const nextBalance = beforeBalance + grant

    tx.set(
      userRef,
      {
        uid,
        email: email ?? null,
        displayName: displayName ?? null,
        photoURL: photoURL ?? null,
        memberStatus: 'active',
        trialGranted: true,
        tokenBalance: nextBalance,
        updatedAt: nowTimestamp(),
        createdAt: existing.exists ? data?.createdAt ?? nowTimestamp() : nowTimestamp(),
      },
      { merge: true },
    )

    return {
      tokenBalance: nextBalance,
      grantedTokens: grant,
      trialGranted: true,
    }
  })
}

export async function redeemCoupon({ uid, code }) {
  const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!/^[A-Z0-9_-]{1,128}$/.test(normalizedCode)) {
    return { accepted: false, reason: 'invalid_code' }
  }

  const userRef = usersDoc(uid)
  const couponRef = couponsDoc(normalizedCode)
  const redemptionRef = redemptionsDoc(uid, normalizedCode)

  return db.runTransaction(async (tx) => {
    const [userSnap, couponSnap, redemptionSnap, settingsSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(couponRef),
      tx.get(redemptionRef),
      tx.get(billingSettingsDoc()),
    ])

    if (!couponSnap.exists) {
      return { accepted: false, reason: 'invalid_code' }
    }

    if (redemptionSnap.exists) {
      return { accepted: false, reason: 'already_redeemed' }
    }

    const couponData = couponSnap.data()
    const isEnabled = couponData?.enabled ?? true
    if (!isEnabled) {
      return { accepted: false, reason: 'disabled_coupon' }
    }

    const maxRedemptions = Number.isFinite(couponData?.maxRedemptions)
      ? couponData.maxRedemptions
      : null
    const redeemedCount = Number.isFinite(couponData?.redeemedCount) ? couponData.redeemedCount : 0
    if (maxRedemptions !== null && redeemedCount >= maxRedemptions) {
      return { accepted: false, reason: 'coupon_exhausted' }
    }

    const bonusTokens = couponData?.tokens === undefined
      ? requiredTokens(settingsSnap.data(), 'defaultCouponTokens', 1)
      : requiredTokens(couponData, 'tokens', 1)
    const userData = userSnap.exists ? userSnap.data() : {}
    const currentBalance = Number.isFinite(userData?.tokenBalance) ? userData.tokenBalance : 0
    const nextBalance = currentBalance + bonusTokens

    tx.set(
      userRef,
      {
        tokenBalance: nextBalance,
        memberStatus: 'active',
        updatedAt: nowTimestamp(),
        createdAt: userSnap.exists ? userData?.createdAt ?? nowTimestamp() : nowTimestamp(),
      },
      { merge: true },
    )

    tx.set(redemptionRef, {
      uid,
      code: normalizedCode,
      redeemedAt: nowTimestamp(),
      grantedTokens: bonusTokens,
    })

    tx.set(
      couponRef,
      {
        code: normalizedCode,
        enabled: isEnabled,
        redeemedCount: redeemedCount + 1,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    )

    return {
      accepted: true,
      grantedTokens: bonusTokens,
      tokenBalance: nextBalance,
    }
  })
}

export async function consumeTokens({ uid, usedTokens, metadata }) {
  if (!Number.isFinite(usedTokens) || usedTokens < 0) {
    throw new Error(`usedTokens must be a non-negative number. Received: ${usedTokens}`)
  }

  const userRef = usersDoc(uid)
  const usageRef = db.collection('tokenUsages').doc()

  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef)
    const userData = userSnap.exists ? userSnap.data() : {}
    const currentBalance = Number.isFinite(userData?.tokenBalance) ? userData.tokenBalance : 0
    const nextBalance = Math.max(0, currentBalance - usedTokens)

    tx.set(
      userRef,
      {
        tokenBalance: nextBalance,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    )

    tx.set(usageRef, {
      uid,
      usedTokens,
      previousBalance: currentBalance,
      nextBalance,
      metadata,
      createdAt: nowTimestamp(),
    })

    return {
      previousBalance: currentBalance,
      tokenBalance: nextBalance,
      usedTokens,
    }
  })
}
