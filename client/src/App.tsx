import { useEffect, useRef, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { chatWithPet, getPets, importPet, petAction, redeemCoupon, subscribe, type ServerPet } from './api'
import { auth } from './firebase'
import { MOODS, feed, getMood, loadPet, play, savePet, sleep, tick, type Pet } from './pet'
import { playMoodSound } from './sounds'

interface Msg {
  from: 'me' | 'pet'
  text: string
}

const Bar = ({ label, value, bad }: { label: string; value: number; bad?: boolean }) => (
  <div className="bar">
    <span>{label}</span>
    <progress max={100} value={bad ? 100 - value : value} />
  </div>
)

export default function App() {
  const [guestPet, setGuestPet] = useState<Pet>(loadPet)
  const [now, setNow] = useState(Date.now())
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(auth))
  const [authBusy, setAuthBusy] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [couponBusy, setCouponBusy] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [coupon, setCoupon] = useState('')
  const [accountMessage, setAccountMessage] = useState('')
  const [membershipAttempt, setMembershipAttempt] = useState(0)
  const currentUserId = useRef<string | null>(null)
  const guestPetRef = useRef(guestPet)
  const petVersion = useRef(0)
  const petActionPending = useRef(false)
  const [pets, setPets] = useState<ServerPet[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [petBusy, setPetBusy] = useState(false)
  const [petMessage, setPetMessage] = useState('')
  const [petName, setPetName] = useState('')
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem('ai-pets:sound-enabled') === 'true',
  )
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem('ai-pets:volume'))
    return Number.isFinite(saved) && localStorage.getItem('ai-pets:volume') !== null
      ? Math.max(0, Math.min(100, saved))
      : 45
  })

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    guestPetRef.current = guestPet
    if (!user) savePet(guestPet)
  }, [guestPet, user])

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, (nextUser) => {
      currentUserId.current = nextUser?.uid ?? null
      petVersion.current += 1
      setUser(nextUser)
      setBalance(null)
      setAccountMessage('')
      setMsgs([])
      setCoupon('')
      setPets(null)
      setSelectedId('')
      setPetMessage('')
      setAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!user) return
    let active = true
    setAccountBusy(true)
    void subscribe(user).then(async (nextBalance) => {
      const imported = await importPet(user, guestPetRef.current)
      if (active) {
        setBalance(nextBalance)
        setPets(imported)
        setSelectedId((id) => imported.some((pet) => pet.id === id) ? id : imported[0]?.id ?? '')
      }
    }).catch((error: unknown) => {
      console.error('Membership setup failed', error)
      if (active) setAccountMessage('לא ניתן לטעון את החברות. בדקו את החיבור לשרת ונסו שוב.')
    }).finally(() => {
      if (active) setAccountBusy(false)
    })
    return () => { active = false }
  }, [user, membershipAttempt])

  const petsLoaded = pets !== null
  useEffect(() => {
    if (!user || !petsLoaded) return
    let active = true
    const timer = setInterval(() => {
      if (petActionPending.current) return
      const version = petVersion.current
      void getPets(user).then((next) => {
        if (!active || version !== petVersion.current) return
        setPets(next)
        setSelectedId((id) => next.some((pet) => pet.id === id) ? id : next[0]?.id ?? '')
        setPetMessage('')
      }).catch((error: unknown) => {
        console.error('Unable to refresh pets', error)
        if (active) setPetMessage('לא ניתן לרענן את החיות מהשרת.')
      })
    }, 10000)
    return () => { active = false; clearInterval(timer) }
  }, [user, petsLoaded])

  const selectedPet = pets?.find((item) => item.id === selectedId)
  const pet = user ? (selectedPet ? tick(selectedPet, now) : guestPet) : tick(guestPet, now)
  const mood = getMood(pet, now)
  const previousMood = useRef(mood)
  useEffect(() => {
    localStorage.setItem('ai-pets:sound-enabled', String(soundEnabled))
  }, [soundEnabled])

  useEffect(() => {
    localStorage.setItem('ai-pets:volume', String(volume))
  }, [volume])

  useEffect(() => {
    if (previousMood.current === mood) return
    previousMood.current = mood
    if (soundEnabled) {
      void playMoodSound(mood, volume / 100).catch((error: unknown) => {
        console.error('Unable to play pet mood sound', error)
      })
    }
  }, [mood, soundEnabled, volume])

  const act = async (action: 'feed' | 'play' | 'sleep' | 'rename', name?: string) => {
    if (user) {
      if (!selectedPet || petActionPending.current) return
      petActionPending.current = true
      petVersion.current += 1
      setPetBusy(true)
      setPetMessage('')
      try {
        const updated = await petAction(user, selectedPet.id, action, name)
        if (currentUserId.current === user.uid) {
          setPets((previous) => previous?.map((item) => item.id === updated.id ? updated : item) ?? null)
          setPetName('')
        }
      } catch (error: unknown) {
        console.error('Pet action failed', error)
        if (currentUserId.current === user.uid) setPetMessage('לא ניתן לעדכן את החיה בשרת.')
      } finally {
        petActionPending.current = false
        setPetBusy(false)
      }
      return
    }
    if (action === 'rename') {
      if (name?.trim()) setGuestPet((p) => ({ ...p, name: name.trim() }))
    } else {
      const fn = { feed, play, sleep }[action]
      setGuestPet((p) => fn(tick(p)))
    }
    setNow(Date.now())
  }

  const toggleSound = () => {
    const enabled = !soundEnabled
    setSoundEnabled(enabled)
    if (enabled) {
      void playMoodSound(mood, volume / 100).catch((error: unknown) => {
        console.error('Unable to play pet mood sound', error)
      })
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const message = text.trim()
    if (!message || busy || accountBusy || couponBusy || authBusy || !user || !selectedPet || balance === null || balance <= 0) return
    setText('')
    setMsgs((m) => [...m, { from: 'me', text: message }])
    setBusy(true)
    try {
      const result = await chatWithPet(user, pet, mood, message)
      if (currentUserId.current !== user.uid) return
      setBalance(result.remaining)
      setMsgs((m) => [...m, { from: 'pet', text: result.reply }])
    } catch (error: unknown) {
      console.error('Chat failed', error)
      if (currentUserId.current === user.uid) {
        setMsgs((m) => [...m, { from: 'pet', text: 'אופס, לא הצלחנו לקבל תשובה מהשרת 😿 נסו שוב.' }])
      }
    } finally {
      setBusy(false)
    }
  }

  async function signIn() {
    if (!auth) return
    setAuthBusy(true)
    setAccountMessage('')
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (error: unknown) {
      console.error('Google sign-in failed', error)
      setAccountMessage('ההתחברות נכשלה. בדקו את הגדרות Firebase ונסו שוב.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function logOut() {
    if (!auth) return
    setAuthBusy(true)
    try {
      await signOut(auth)
    } catch (error: unknown) {
      console.error('Sign-out failed', error)
      setAccountMessage('ההתנתקות נכשלה. נסו שוב.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function submitCoupon(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !coupon.trim() || busy || accountBusy || couponBusy || authBusy || balance === null) return
    setCouponBusy(true)
    setAccountMessage('')
    try {
      const nextBalance = await redeemCoupon(user, coupon.trim())
      if (currentUserId.current !== user.uid) return
      setBalance(nextBalance)
      setCoupon('')
      setAccountMessage('הקופון מומש בהצלחה.')
    } catch (error: unknown) {
      console.error('Coupon redemption failed', error)
      if (currentUserId.current === user.uid) {
        setAccountMessage(error instanceof Error ? error.message : 'מימוש הקופון נכשל.')
      }
    } finally {
      setCouponBusy(false)
    }
  }

  return (
    <main>
      <header>
        <h1>🐾 חיות AI</h1>
        <button onClick={() => setShowSettings((s) => !s)} aria-label="הגדרות">⚙️</button>
      </header>

      <section className="card account" aria-label="חברות ויתרת טוקנים">
        {!auth && <p role="alert">יש להגדיר את פרטי Firebase בקובץ הסביבה של האפליקציה.</p>}
        {authLoading && <p>טוען חשבון...</p>}
        {auth && !authLoading && !user && (
          <button type="button" onClick={signIn} disabled={authBusy}>התחברות עם Google</button>
        )}
        {user && (
          <>
            <p>מחובר: {user.displayName || user.email || user.uid}</p>
            <p>יתרת טוקנים: {balance === null ? 'לא זמינה' : balance.toLocaleString()}</p>
            {balance === null && !accountBusy && (
              <button type="button" onClick={() => setMembershipAttempt((n) => n + 1)}>נסה לטעון שוב</button>
            )}
            <form onSubmit={submitCoupon}>
              <input aria-label="קוד קופון" value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="קוד קופון" />
              <button disabled={busy || accountBusy || couponBusy || authBusy || balance === null || !coupon.trim()}>מימוש</button>
            </form>
            <button type="button" onClick={logOut} disabled={busy || accountBusy || couponBusy || authBusy}>התנתקות</button>
          </>
        )}
        {accountMessage && <p role="status">{accountMessage}</p>}
      </section>

      <section className="card sound-control" aria-label="בקרת צלילים">
        <button
          className="sound-toggle"
          type="button"
          onClick={toggleSound}
          aria-pressed={soundEnabled}
        >
          <span className="sound-icon" aria-hidden="true">{soundEnabled ? '🔊' : '🔇'}</span>
          <span>{soundEnabled ? 'השתק צלילים' : 'הפעל צלילים'}</span>
        </button>
        <label className="volume-control">
          <span>עוצמת קול: {volume}%</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="עוצמת קול"
          />
        </label>
      </section>

      {showSettings && (
        <section className="card">
          <form onSubmit={(event) => { event.preventDefault(); void act('rename', petName) }}>
            <label>
              שם החיה
              <input value={petName} onChange={(e) => setPetName(e.target.value)} placeholder={pet.name} maxLength={100} />
            </label>
            <button disabled={!petName.trim() || petBusy || Boolean(user && !selectedPet)}>שמור</button>
          </form>
        </section>
      )}

      <section className="card pet">
        {user && pets && pets.length > 0 && (
          <label>בחירת חיה
            <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setMsgs([]) }} disabled={petBusy}>
              {pets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
        {user && !selectedPet && <p>אין חיה זמינה בשרת.</p>}
        {petMessage && <p role="alert">{petMessage}</p>}
        <div className={`face ${mood}`} role="img" aria-label={MOODS[mood].label}>
          {MOODS[mood].emoji}
        </div>
        <h2>{pet.name} • {MOODS[mood].label}</h2>
        <Bar label="שובע" value={pet.hunger} bad />
        <Bar label="שמחה" value={pet.happiness} />
        <Bar label="אנרגיה" value={pet.energy} />
        <div className="actions">
          <button onClick={() => void act('feed')} disabled={petBusy || Boolean(user && !selectedPet)}>🍖 האכל</button>
          <button onClick={() => void act('play')} disabled={petBusy || Boolean(user && !selectedPet)}>🎾 שחק</button>
          <button onClick={() => void act('sleep')} disabled={petBusy || Boolean(user && !selectedPet)}>🛏️ שינה</button>
        </div>
      </section>

      <section className="card chat">
        {user && balance === 0 && <p role="status">יתרת הטוקנים נגמרה. אפשר לממש קופון כדי להמשיך.</p>}
        {!user && <p>כדי לשוחח, יש להתחבר עם Google.</p>}
        <div className="msgs">
          {msgs.map((m, i) => (
            <p key={i} className={m.from}>{m.text}</p>
          ))}
          {busy && <p className="pet">...</p>}
        </div>
        <form onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`דבר עם ${pet.name}...`} disabled={!user || !selectedPet || balance === null || balance <= 0 || accountBusy || couponBusy || authBusy || busy} />
          <button disabled={!user || !selectedPet || balance === null || balance <= 0 || accountBusy || couponBusy || authBusy || busy}>שלח</button>
        </form>
      </section>
    </main>
  )
}
