import { useState } from 'react'
import { api, fmt } from '../api'
import type { Account, Category, Tx } from '../api'

export default function TransactionsTable({
  txs,
  categories,
  accounts,
  onChanged,
  userId,
}: {
  txs: Tx[]
  categories: Category[]
  accounts: Account[]
  onChanged: () => void
  userId: number
}) {
  const [manual, setManual] = useState({
    account_id: 0,
    date: new Date().toISOString().slice(0, 10),
    description: '',
    amount: '',
  })
  const [notesEdit, setNotesEdit] = useState<{ id: number; value: string } | null>(null)

  const patch = async (id: number, body: Record<string, unknown>) => {
    await api.patch(`/api/transactions/${id}`, body)
    onChanged()
  }

  const addManual = async () => {
    const amount = parseFloat(manual.amount)
    const account_id = manual.account_id || accounts[0]?.id
    if (!account_id || !manual.description.trim() || isNaN(amount)) return
    await api.post('/api/transactions', { ...manual, account_id, amount })
    setManual({ ...manual, description: '', amount: '' })
    onChanged()
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: '0.75rem' }}>
        <select value={manual.account_id || accounts[0]?.id || 0} onChange={(e) => setManual({ ...manual, account_id: Number(e.target.value) })}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
        <input
          placeholder="Manual entry: description"
          value={manual.description}
          onChange={(e) => setManual({ ...manual, description: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && addManual()}
          style={{ flex: 1, minWidth: '10rem' }}
        />
        <input
          type="number"
          step="0.01"
          placeholder="-12.50"
          value={manual.amount}
          onChange={(e) => setManual({ ...manual, amount: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && addManual()}
          style={{ width: '7rem' }}
        />
        <button className="secondary" onClick={addManual} disabled={accounts.length === 0}>
          + Add
        </button>
      </div>

      {txs.length === 0 ? (
        <div className="muted">No transactions match.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Category</th>
                <th>Shared</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                  <td>
                    {t.needs_review && (
                      <span
                        className="badge-review"
                        title="Marked for review — set a category or click to clear"
                        onClick={() => patch(t.id, { needs_review: false })}
                      >
                        ⚑{' '}
                      </span>
                    )}
                    {t.description}
                  </td>
                  <td className={t.amount >= 0 ? 'amount-pos' : 'amount-neg'}>{fmt(t.amount)}</td>
                  <td>
                    <select
                      value={t.category_id ?? 0}
                      style={{ borderColor: t.category_color }}
                      onChange={(e) =>
                        patch(t.id, {
                          category_id: Number(e.target.value) || null,
                          needs_review: false,
                        })
                      }
                    >
                      <option value={0}>—</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      title="Household expense (split with partner)"
                      checked={t.is_shared}
                      onChange={(e) => patch(t.id, { is_shared: e.target.checked })}
                    />
                    {t.is_shared && (
                      <select
                        value={t.split_ratio}
                        title="Your share"
                        onChange={(e) => patch(t.id, { split_ratio: Number(e.target.value) })}
                      >
                        <option value={0.5}>50/50</option>
                        <option value={0.6}>60/40</option>
                        <option value={0.7}>70/30</option>
                        <option value={1}>100/0</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {notesEdit?.id === t.id ? (
                      <input
                        autoFocus
                        value={notesEdit.value}
                        onChange={(e) => setNotesEdit({ id: t.id, value: e.target.value })}
                        onBlur={async () => {
                          await patch(t.id, { notes: notesEdit.value })
                          setNotesEdit(null)
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    ) : (
                      <span
                        className="muted"
                        style={{ cursor: 'pointer' }}
                        title="Click to edit note"
                        onClick={() => setNotesEdit({ id: t.id, value: t.notes })}
                      >
                        {t.notes || '✎'}
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      title="Delete transaction"
                      onClick={async () => {
                        await api.del(`/api/transactions/${t.id}`)
                        onChanged()
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ marginTop: '0.5rem' }}>
        Showing {txs.length} transactions (user #{userId}). ⚑ = uncategorized import, needs review.
      </div>
    </div>
  )
}
