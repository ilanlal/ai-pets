import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
const appId = import.meta.env.VITE_FIREBASE_APP_ID

export const auth = apiKey && authDomain && projectId && appId
  ? getAuth(initializeApp({ apiKey, authDomain, projectId, appId }))
  : null
