import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { MessageCircle } from '../components/icons'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

/** Login / register — the first real view, exercising the AuthProvider end-to-end. */
export function Login() {
  const { t } = useI18n()
  const { user, ready, login, register, refresh } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState<'login' | 'register' | 'wechat'>('login')
  const [role, setRole] = useState<'student' | 'teacher'>('student')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [school, setSchool] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [wx, setWx] = useState<{ configured: boolean; url: string } | null>(null)
  const [wxErr, setWxErr] = useState('')

  // WeChat tab: load the QR page once, then poll /api/me until the iframe's
  // callback sets the session cookie (callback is same-origin, so polling works).
  useEffect(() => {
    if (mode !== 'wechat') return
    let stop = false
    setWx(null)
    setWxErr('')
    api
      .wechatLoginUrl()
      .then((d) => {
        if (!stop) setWx(d)
      })
      .catch(() => {
        if (!stop) setWxErr(t('wxNotConfigured'))
      })
    const iv = setInterval(() => {
      api
        .me()
        .then((m) => {
          if (!stop && m.user) {
            stop = true
            void refresh().then(() => navigate('/'))
          }
        })
        .catch(() => {})
    }, 2000)
    return () => {
      stop = true
      clearInterval(iv)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh/navigate are stable
  }, [mode])

  if (ready && user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const needsSchool = mode === 'register' && role === 'teacher'
    if (!username || !password || (mode === 'register' && !confirm) || (needsSchool && !school)) {
      setError(t('authFillAll'))
      return
    }
    if (mode === 'register' && password !== confirm) {
      setError(t('authPassMismatch'))
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(username, password)
      } else {
        await register(username, password, role, needsSchool ? school : undefined)
      }
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card auth-box">
      <h2 style={{ textAlign: 'center', marginBottom: 8 }}>MockTest Maker</h2>
      <p style={{ textAlign: 'center', color: 'var(--ink-2)', fontSize: 14 }}>{t('authRequired')}</p>
      <div className="auth-tabs">
        <div className={mode === 'login' ? 'auth-tab active' : 'auth-tab'} onClick={() => setMode('login')}>
          {t('login')}
        </div>
        <div className={mode === 'register' ? 'auth-tab active' : 'auth-tab'} onClick={() => setMode('register')}>
          {t('register')}
        </div>
        <div className={mode === 'wechat' ? 'auth-tab active' : 'auth-tab'} onClick={() => setMode('wechat')}>
          <MessageCircle size={14} aria-hidden="true" /> {t('wxTab')}
        </div>
      </div>
      {mode === 'wechat' && (
        <div style={{ textAlign: 'center' }}>
          <p className="muted" style={{ fontSize: 13.5 }}>
            {t('wxScanHint')}
          </p>
          {wxErr && <div className="auth-msg err">{wxErr}</div>}
          {!wx && !wxErr && <p className="muted">{t('wxLoading')}</p>}
          {wx && !wx.configured && <div className="auth-msg err">{t('wxNotConfigured')}</div>}
          {wx && wx.configured && (
            <iframe
              title="WeChat QR login"
              src={wx.url}
              style={{ width: 300, height: 380, border: 'none', margin: '0 auto', display: 'block' }}
            />
          )}
        </div>
      )}
      {mode === 'register' && (
        <div className="auth-tabs" style={{ marginBottom: 2 }}>
          <div className={role === 'student' ? 'auth-tab active' : 'auth-tab'} onClick={() => setRole('student')}>
            {t('authStudent')}
          </div>
          <div className={role === 'teacher' ? 'auth-tab active' : 'auth-tab'} onClick={() => setRole('teacher')}>
            {t('authTeacher')}
          </div>
        </div>
      )}
      <form className="auth-form" onSubmit={onSubmit} style={mode === 'wechat' ? { display: 'none' } : undefined}>
        <label>{t('username')}</label>
        <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label>{t('password')}</label>
        <input
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === 'register' && (
          <>
            <label>{t('authConfirm')}</label>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </>
        )}
        {mode === 'register' && role === 'teacher' && (
          <>
            <label>{t('school')}</label>
            <input type="text" value={school} onChange={(e) => setSchool(e.target.value)} />
          </>
        )}
        <button type="submit" className="btn" disabled={busy}>
          {mode === 'login' ? t('login') : t('register')}
        </button>
      </form>
      <div className="auth-msg err" style={mode === 'wechat' ? { display: 'none' } : undefined}>
        {error}
      </div>
    </div>
  )
}
