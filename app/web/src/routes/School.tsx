import { useCallback, useEffect, useState } from 'react'
import { Check } from '../components/icons'
import { DocTiles, DocUploadForm, readFileAsB64 } from '../components/Docs'
import { api, type SchoolDoc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'

/**
 * School section (LC-style): teachers of the school upload materials as
 * tiles — students (and teachers) browse, open inline or download.
 * Uploading is teacher-only (enforced server-side too).
 */
export function School() {
  const { t } = useI18n()
  const { role, school, refresh } = useAuth()
  const isTeacher = role === 'teacher'
  const [data, setData] = useState<{ categories: string[]; docs: SchoolDoc[] } | null>(null)
  const [cat, setCat] = useState('')
  const [schools, setSchools] = useState<string[]>([])
  const [joinName, setJoinName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!school) return
    api
      .schoolDocs(cat)
      .then(setData)
      .catch(() => setData({ categories: [], docs: [] }))
  }, [school, cat])

  useEffect(load, [load])
  useEffect(() => {
    if (!school) api.schools().then((d) => setSchools(d.schools)).catch(() => {})
  }, [school])

  async function upload(file: File, title: string) {
    setBusy(true)
    setMsg(null)
    try {
      const dataB64 = await readFileAsB64(file)
      await api.schoolDocUpload({
        category: cat || 'math',
        chapter: '—',
        title,
        filename: file.name,
        data_b64: dataB64,
      })
      setMsg({ ok: true, text: t('docUploaded') })
      load()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function del(d: SchoolDoc) {
    try {
      await api.schoolDocDelete(d.id)
      load()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  async function join() {
    setMsg(null)
    try {
      await api.schoolJoin(joinName.trim())
      await refresh()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  // Not in any school yet -> offer joining one (LC classroom membership).
  if (!school) {
    return (
      <section className="card">
        <h3>{t('tabSchool')}</h3>
        <p className="muted">{t('schNeedJoin')}</p>
        <div className="pk-form">
          <input
            type="text"
            list="mt-schools"
            placeholder={t('schJoinPh')}
            style={{ flex: 1, minWidth: 160 }}
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
          />
          <datalist id="mt-schools">
            {schools.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button className="btn" type="button" onClick={() => void join()} disabled={!joinName.trim()}>
            {t('schJoin')}
          </button>
        </div>
        {msg && (
          <div className={`auth-msg ${msg.ok ? 'ok' : 'err'}`}>
            {msg.ok && <Check size={14} aria-hidden="true" />} {msg.text}
          </div>
        )}
      </section>
    )
  }

  const byCat = new Map<string, SchoolDoc[]>()
  for (const d of data?.docs ?? []) {
    const k = d.category || 'other'
    if (!byCat.has(k)) byCat.set(k, [])
    byCat.get(k)!.push(d)
  }

  return (
    <section className="card">
      <h3>
        {t('tabSchool')} — <span className="muted">{school}</span>
      </h3>
      {isTeacher && (
        <div className="doc-teacher-bar">
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t('schAllCats')}</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }}>
            <DocUploadForm onUpload={(f, title) => void upload(f, title)} busy={busy} />
          </div>
        </div>
      )}
      {!isTeacher && (data?.categories?.length ?? 0) > 1 && (
        <div className="doc-teacher-bar">
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t('schAllCats')}</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}
      {msg && <div className={`auth-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
      {!data ? (
        <p className="muted">{t('loading')}</p>
      ) : byCat.size === 0 ? (
        <p className="muted">{t('docNone')}</p>
      ) : (
        [...byCat.entries()].map(([c, docs]) => (
          <div key={c} className="doc-cat">
            <h4 className="dr-cat-head" style={{ textTransform: 'capitalize' }}>
              {c} <span className="an-pct">({docs.length})</span>
            </h4>
            <DocTiles
              docs={docs}
              downloadUrl={(d) => `/api/school/docs/${d.id}/download`}
              canDelete={() => isTeacher}
              onDelete={isTeacher ? (d) => void del(d as SchoolDoc) : undefined}
            />
          </div>
        ))
      )}
    </section>
  )
}
