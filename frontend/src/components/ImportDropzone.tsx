import { useRef, useState } from 'react'
import { api } from '../api'
import type { Account } from '../api'

interface ImportResult {
  batch_id: number
  imported: number
  duplicates_skipped: number
  filename: string
}

export default function ImportDropzone({
  accounts,
  onImported,
}: {
  accounts: Account[]
  onImported: () => void
}) {
  const [accountId, setAccountId] = useState<number>(0)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ImportResult[]>([])
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const target = accountId || accounts[0]?.id || 0

  const uploadFiles = async (files: FileList | File[]) => {
    if (!target) {
      setError('Create an account first, then import into it.')
      return
    }
    setBusy(true)
    setError('')
    for (const file of Array.from(files)) {
      try {
        const form = new FormData()
        form.append('account_id', String(target))
        form.append('file', file)
        const res = await api.upload<Omit<ImportResult, 'filename'>>('/api/imports', form)
        setResults((prev) => [{ ...res, filename: file.name }, ...prev].slice(0, 5))
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : e}`)
      }
    }
    setBusy(false)
    onImported()
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: '0.6rem' }}>
        <span className="muted">Into account:</span>
        <select value={target} onChange={(e) => setAccountId(Number(e.target.value))}>
          {accounts.length === 0 && <option value={0}>— create an account first —</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          uploadFiles(e.dataTransfer.files)
        }}
        onClick={() => fileInput.current?.click()}
      >
        {busy ? 'Importing…' : 'Drop CSV / Excel / OFX / QIF files here, or click to browse'}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".csv,.tsv,.xlsx,.xls,.ofx,.qfx,.qif"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
      </div>
      {error && <div className="error-banner" style={{ marginTop: '0.6rem' }}>{error}</div>}
      {results.map((r) => (
        <div key={r.batch_id} className="row muted" style={{ marginTop: '0.5rem', justifyContent: 'space-between' }}>
          <span>
            {r.filename}: {r.imported} imported, {r.duplicates_skipped} duplicates skipped
          </span>
          <button
            className="danger"
            onClick={async () => {
              await api.del(`/api/imports/${r.batch_id}`)
              setResults((prev) => prev.filter((x) => x.batch_id !== r.batch_id))
              onImported()
            }}
          >
            Undo
          </button>
        </div>
      ))}
    </div>
  )
}
