import { useEffect, useRef, useState, type FormEvent } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { adjustBalance, createPet, getPets, getSettings, getUsers, health, setPetStats, setTrial, type Member, type Pet, type Settings } from './api'
import { auth } from './firebase'

type Page = 'overview' | 'members' | 'settings'

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function StatForm({ pet, disabled, save }: { pet: Pet; disabled: boolean; save: (pet: Pet) => Promise<void> }) {
  const [values, setValues] = useState({ hunger: pet.hunger, happiness: pet.happiness, energy: pet.energy })
  useEffect(() => setValues({ hunger: pet.hunger, happiness: pet.happiness, energy: pet.energy }), [pet])
  return (
    <form className="pet-form" onSubmit={(event) => { event.preventDefault(); void save({ ...pet, ...values }) }}>
      <div className="pet-title"><span className="pet-icon">🐾</span><div><strong>{pet.name}</strong><small>{pet.id}</small></div></div>
      <div className="stat-grid">
        {(['hunger', 'happiness', 'energy'] as const).map((key) => (
          <label key={key}>{key}
            <input type="number" min="0" max="100" step="any" value={values[key]}
              onChange={(event) => setValues({ ...values, [key]: event.target.valueAsNumber })} required />
          </label>
        ))}
      </div>
      <button className="secondary" disabled={disabled}>Save stats</button>
    </form>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(auth))
  const [authBusy, setAuthBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState<Page>('overview')
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [members, setMembers] = useState<Member[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [trial, setTrialValue] = useState('')
  const [selected, setSelected] = useState('')
  const [pets, setPets] = useState<Pet[] | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [petName, setPetName] = useState('')
  const [refresh, setRefresh] = useState(0)
  const adjustment = useRef<{ key: string; id: string } | null>(null)

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setMembers([])
      setSettings(null)
      setSelected('')
      setPets(null)
      setError('')
      setNotice('')
      setAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    let active = true
    setStatus('checking')
    void health().then(() => { if (active) setStatus('online') }).catch((failure: unknown) => {
      console.error('Health check failed', failure)
      if (active) setStatus('offline')
    })
    return () => { active = false }
  }, [refresh])

  useEffect(() => {
    if (!user) return
    let active = true
    void getUsers(user).then((users) => {
      if (!active) return
      setMembers(users.users)
      setNext(users.next)
    }).catch((failure: unknown) => {
      console.error('Member load failed', failure)
      if (active) setError(message(failure))
    })
    void getSettings(user).then((billing) => {
      if (!active) return
      setSettings(billing)
      setTrialValue(String(billing.trialTokens))
    }).catch((failure: unknown) => {
      console.error('Settings load failed', failure)
      if (active) setError(message(failure))
    })
    return () => { active = false }
  }, [user, refresh])

  useEffect(() => {
    if (!user || !selected) return
    let active = true
    setPets(null)
    void getPets(user, selected).then((result) => {
      if (active) setPets(result.pets)
    }).catch((failure: unknown) => {
      console.error('Pet load failed', failure)
      if (active) setError(message(failure))
    })
    return () => { active = false }
  }, [user, selected, refresh])

  async function doSignIn() {
    if (!auth) return
    setAuthBusy(true)
    setError('')
    try { await signInWithPopup(auth, new GoogleAuthProvider()) }
    catch (failure: unknown) { console.error('Sign-in failed', failure); setError(message(failure)) }
    finally { setAuthBusy(false) }
  }

  async function doSignOut() {
    if (!auth) return
    setAuthBusy(true)
    try { await signOut(auth) }
    catch (failure: unknown) { console.error('Sign-out failed', failure); setError(message(failure)) }
    finally { setAuthBusy(false) }
  }

  async function execute(operation: () => Promise<void>, success: string) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try { await operation(); setNotice(success) }
    catch (failure: unknown) { console.error('Admin operation failed', failure); setError(message(failure)) }
    finally { setBusy(false) }
  }

  function changeBalance(event: FormEvent) {
    event.preventDefault()
    if (!user || !selected) return
    const value = Number(amount)
    if (!Number.isSafeInteger(value) || value === 0 || !reason.trim()) {
      setError('Enter a non-zero whole number and a reason.')
      return
    }
    const uid = selected
    const key = JSON.stringify([user.uid, uid, value, reason.trim()])
    if (adjustment.current?.key !== key) adjustment.current = { key, id: crypto.randomUUID() }
    const requestId = adjustment.current.id
    void execute(async () => {
      const result = await adjustBalance(user, uid, value, reason.trim(), requestId)
      setMembers((items) => items.map((item) => item.uid === uid ? { ...item, tokenBalance: result.tokenBalance } : item))
      adjustment.current = null
      setAmount('')
      setReason('')
    }, 'Balance adjusted and recorded.')
  }

  function changeTrial(event: FormEvent) {
    event.preventDefault()
    if (!user || trial.trim() === '') return
    const value = Number(trial)
    if (!Number.isSafeInteger(value) || value < 0) { setError('Enter a non-negative whole number.'); return }
    void execute(async () => {
      const result = await setTrial(user, value)
      setSettings((current) => current && { ...current, trialTokens: result.trialTokens })
    }, 'Trial setting updated for future members.')
  }

  function addPet(event: FormEvent) {
    event.preventDefault()
    if (!user || !selected || pets === null || !petName.trim()) return
    const uid = selected
    void execute(async () => {
      const result = await createPet(user, uid, petName.trim())
      setPets((items) => items ? [...items, result.pet] : [result.pet])
      setPetName('')
    }, 'Pet created.')
  }

  async function saveStats(pet: Pet) {
    if (!user || !selected) return
    const uid = selected
    await execute(async () => {
      const result = await setPetStats(user, uid, pet)
      setPets((items) => items?.map((item) => item.id === pet.id ? result.pet : item) ?? null)
    }, 'Pet stats updated.')
  }

  const member = members.find((item) => item.uid === selected)
  const nav: { id: Page; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '◫' },
    { id: 'members', label: 'Members & pets', icon: '♧' },
    { id: 'settings', label: 'Settings', icon: '⚙' },
  ]

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand"><span>🐾</span><div><strong>AI Pets</strong><small>ADMIN CONSOLE</small></div></div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {nav.map((item) => <button key={item.id} className={page === item.id ? 'nav active' : 'nav'} onClick={() => setPage(item.id)}><span>{item.icon}</span>{item.label}</button>)}
        </nav>
        <div className="sidebar-foot"><span className={`dot ${status}`} /> Server {status}</div>
      </aside>
      <main>
        <header className="topbar"><div><span className="eyebrow">AI PETS / ADMIN</span><h1>{nav.find((item) => item.id === page)?.label}</h1></div>
          {user ? <div className="account"><span>{user.displayName || user.email}</span><button className="secondary" onClick={() => void doSignOut()} disabled={authBusy || busy}>Sign out</button></div> : null}
        </header>
        {error && <div className="banner error" role="alert">{error}</div>}
        {notice && <div className="banner success" role="status">{notice}</div>}
        {!auth && <div className="banner error" role="alert">Configure Firebase in web/.env.local before signing in.</div>}
        {authLoading ? <p>Loading account...</p> : !user ? (
          <section className="welcome card"><div className="welcome-icon">✳</div><span className="eyebrow">RESTRICTED ACCESS</span><h2>Welcome to your workspace</h2><p>Sign in with an administrator account to manage your AI Pets community.</p><button onClick={() => void doSignIn()} disabled={!auth || authBusy}>Sign in with Google <span>→</span></button></section>
        ) : (
          <>
            {page === 'overview' && <section>
              <div className="section-heading"><div><span className="eyebrow">AT A GLANCE</span><h2>System overview</h2><p>Keep an eye on your community and server.</p></div><button className="secondary" onClick={() => setRefresh((n) => n + 1)} disabled={busy}>↻ Refresh</button></div>
              <div className="cards">
                <article className="card metric"><span className="metric-icon mint">◉</span><span className="muted">Server status</span><strong>{status === 'online' ? 'Online' : status === 'offline' ? 'Unavailable' : 'Checking'}</strong><small>Health endpoint</small></article>
                <article className="card metric"><span className="metric-icon peach">♧</span><span className="muted">Members loaded</span><strong>{settings ? members.length : '—'}</strong><small>{next ? 'More members available' : 'Current results'}</small></article>
                <article className="card metric"><span className="metric-icon lilac">✳</span><span className="muted">Trial tokens</span><strong>{settings ? settings.trialTokens.toLocaleString() : '—'}</strong><small>For new members</small></article>
              </div>
              <div className="card callout"><div><span className="eyebrow">QUICK ACTION</span><h3>Manage your members</h3><p>Review balances, add pets and update pet stats in one place.</p></div><button onClick={() => setPage('members')}>View members →</button></div>
            </section>}
            {page === 'members' && <section>
              <div className="section-heading"><div><span className="eyebrow">COMMUNITY</span><h2>Members & pets</h2><p>Select a member to manage their balance and pets.</p></div><button className="secondary" onClick={() => setRefresh((n) => n + 1)} disabled={busy}>↻ Refresh</button></div>
              <div className="member-layout">
                <div className="card member-list"><div className="card-heading"><h3>Members</h3><span>{members.length} loaded</span></div>
                  {members.length === 0 && <p className="muted">No members loaded.</p>}
                  {members.map((item) => <button className={`member-row ${selected === item.uid ? 'selected' : ''}`} key={item.uid} onClick={() => { setSelected(item.uid); setError(''); setNotice('') }} disabled={busy}>
                    <span className="avatar">{(item.displayName || item.email || '?').slice(0, 1).toUpperCase()}</span><span className="member-text"><strong>{item.displayName || item.email || 'Member'}</strong><small>{item.email || item.uid}</small></span><span>›</span>
                  </button>)}
                  {next && <button className="secondary" disabled={busy} onClick={() => { if (user && next) void execute(async () => { const result = await getUsers(user, next); setMembers((items) => [...items, ...result.users]); setNext(result.next) }, 'More members loaded.') }}>Load more</button>}
                </div>
                {member ? <div className="detail">
                  <article className="card"><div className="card-heading"><div><span className="eyebrow">MEMBER PROFILE</span><h3>{member.displayName || member.email || member.uid}</h3><p className="muted break">{member.email || member.uid}</p></div><span className="badge">{member.memberStatus || 'Unknown'}</span></div>
                    <div className="balance"><span>Token balance</span><strong>{member.tokenBalance === null ? 'Unavailable' : member.tokenBalance.toLocaleString()}</strong></div>
                    <form onSubmit={changeBalance} className="stack"><h4>Adjust balance</h4><label>Token change <input type="number" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 500 or -500" required /></label><label>Reason <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required placeholder="Reason for this adjustment" /></label><button disabled={busy}>Apply adjustment</button></form>
                  </article>
                  <article className="card"><div className="card-heading"><div><span className="eyebrow">PET MANAGEMENT</span><h3>Member pets</h3></div><span>{pets?.length ?? '…'} pets</span></div>
                    {pets === null ? <p className="muted">Loading pets...</p> : pets.length === 0 ? <p className="muted">This member has no pets yet.</p> : pets.map((pet) => <StatForm key={pet.id} pet={pet} disabled={busy} save={saveStats} />)}
                    <form className="inline-form" onSubmit={addPet}><label>New pet name<input value={petName} onChange={(event) => setPetName(event.target.value)} maxLength={100} required placeholder="Pet name" /></label><button disabled={busy || pets === null}>Add pet</button></form>
                  </article>
                </div> : <div className="card empty"><span>♧</span><h3>Select a member</h3><p>Choose someone from the list to see their profile.</p></div>}
              </div>
            </section>}
            {page === 'settings' && <section>
              <div className="section-heading"><div><span className="eyebrow">CONFIGURATION</span><h2>Billing settings</h2><p>Changes apply to new memberships, not existing balances.</p></div></div>
              <article className="card settings-card"><span className="metric-icon lilac">✳</span><h3>Free trial</h3><p className="muted">Tokens granted once when a member first subscribes.</p><form className="stack" onSubmit={changeTrial}><label>Trial tokens<input type="number" min="0" step="1" value={trial} onChange={(event) => setTrialValue(event.target.value)} required /></label><button disabled={busy || !settings}>Save setting</button></form><hr /><p className="muted">Default coupon tokens: {settings ? settings.defaultCouponTokens.toLocaleString() : 'Unavailable'}</p></article>
            </section>}
          </>
        )}
      </main>
    </div>
  )
}
