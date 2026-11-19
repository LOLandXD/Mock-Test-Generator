import { useRef, useState, type ChangeEvent } from 'react'
import { Download, Eye, File, FileText, Image, Trash2, Upload } from './icons'
import type { DocLike } from '../lib/api'
import { useI18n } from '../lib/i18n'

/** Extensions we let the browser open inline (pdf / images / plain text). */
const VIEWABLE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'txt', 'md'])

export function docIcon(ext: string) {
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return Image
  if (ext === 'pdf' || ext === 'txt' || ext === 'md' || ext === 'doc' || ext === 'docx') return FileText
  return File
}

export function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function readFileAsB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '')
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

/** LC-style tile grid of documents: open inline / download / delete. */
export function DocTiles({
  docs,
  downloadUrl,
  canDelete,
  onDelete,
}: {
  docs: DocLike[]
  downloadUrl: (d: DocLike) => string
  canDelete: (d: DocLike) => boolean
  onDelete?: (d: DocLike) => void
}) {
  const { t } = useI18n()
  if (!docs.length) return <p className="muted">{t('docNone')}</p>
  return (
    <div className="doc-grid">
      {docs.map((d) => {
        const Icon = docIcon(d.ext)
        const url = downloadUrl(d)
        return (
          <div key={d.id} className="doc-tile">
            <div className="doc-tile-head">
              <Icon size={26} aria-hidden="true" className="doc-tile-icon" />
              <div className="doc-tile-name" title={d.filename}>
                {d.title}
              </div>
            </div>
            <div className="meta doc-tile-meta">
              {d.uploader} · {d.uploaded_at?.slice(0, 10)} · {fmtSize(d.size)} · {d.ext.toUpperCase()}
            </div>
            <div className="doc-tile-actions">
              {VIEWABLE.has(d.ext) && (
                <a className="btn sm ghost" href={`${url}?inline=1`} target="_blank" rel="noreferrer">
                  <Eye size={13} aria-hidden="true" /> {t('docOpen')}
                </a>
              )}
              <a className="btn sm ghost" href={url}>
                <Download size={13} aria-hidden="true" /> {t('docDownload')}
              </a>
              {onDelete && canDelete(d) && (
                <button type="button" className="btn sm ghost danger" onClick={() => onDelete(d)}>
                  <Trash2 size={13} aria-hidden="true" /> {t('docDelete')}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** File picker + title field + upload button; reports errors via msg. */
export function DocUploadForm({
  extraFields,
  onUpload,
  busy,
}: {
  extraFields?: React.ReactNode
  onUpload: (file: File, title: string) => void
  busy: boolean
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <div className="doc-upload">
      <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={pick} />
      <div className="pk-form" style={{ margin: 0 }}>
        <button type="button" className="btn sm ghost" onClick={() => inputRef.current?.click()}>
          <Upload size={13} aria-hidden="true" /> {t('docChoose')}
        </button>
        <input
          type="text"
          placeholder={t('docTitlePh')}
          style={{ flex: 1, minWidth: 140 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {extraFields}
        <button
          type="button"
          className="btn sm"
          disabled={!file || busy}
          onClick={() => file && onUpload(file, title.trim())}
        >
          {t('docUpload')}
        </button>
      </div>
      {file && (
        <div className="meta">
          {file.name} · {fmtSize(file.size)}
        </div>
      )}
    </div>
  )
}
