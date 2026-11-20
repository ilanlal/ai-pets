import 'dotenv/config'
import { auth } from '../src/firebase.js'

const uid = process.argv[2]
if (!uid || process.argv.length !== 3) {
  console.error('Usage: node scripts/grant-admin.js <firebase-user-uid>')
  process.exitCode = 1
} else {
  try {
    const user = await auth.getUser(uid)
    await auth.setCustomUserClaims(uid, { ...user.customClaims, admin: true })
    console.log('Admin claim granted. The user must sign in again or refresh their ID token.')
  } catch (error) {
    console.error('Failed to grant admin claim:', error)
    process.exitCode = 1
  }
}
