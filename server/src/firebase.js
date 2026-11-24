import admin from 'firebase-admin'

function parseServiceAccountFromJson() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) {
    return null
  }
  const parsed = JSON.parse(raw)
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  }
  return parsed
}

function parseServiceAccountFromFields() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY

  if (!projectId || !clientEmail || !privateKey) {
    return null
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, '\n'),
  }
}

function buildCredential() {
  const fromJson = parseServiceAccountFromJson()
  if (fromJson) {
    return admin.credential.cert(fromJson)
  }

  const fromFields = parseServiceAccountFromFields()
  if (fromFields) {
    return admin.credential.cert(fromFields)
  }

  return null
}

let firebaseInitialized = false
const credential = buildCredential()

if (credential) {
  if (!admin.apps.length) {
    admin.initializeApp({ credential })
  }
  firebaseInitialized = true
} else {
  console.warn(
    '[AI Studio] Firebase Admin credentials not set — running without Firebase backend. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY to enable server auth and Firestore.',
  )
}

const unconfiguredError = () =>
  new Error('Firebase Admin is not configured in this environment.')

export const auth = firebaseInitialized
  ? admin.auth()
  : {
      verifyIdToken: async () => {
        throw unconfiguredError()
      },
    }

export const db = firebaseInitialized
  ? admin.firestore()
  : {
      collection: () => {
        throw unconfiguredError()
      },
      runTransaction: async () => {
        throw unconfiguredError()
      },
    }

export { admin }
