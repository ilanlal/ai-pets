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

  throw new Error(
    'Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.',
  )
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: buildCredential(),
  })
}

export const auth = admin.auth()
export const db = admin.firestore()
export { admin }
