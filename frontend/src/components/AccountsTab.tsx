import { useCallback, useEffect, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { api, fmt } from '../api'
import type { Account, BudgetRow, Category, Summary, Tx, User } from '../api'
import ImportDropzone from './ImportDropzone'
import TransactionsTable from './TransactionsTable'

export default function AccountsTab({ user, categories }: { user: User; categories: Category[] }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState<number | 0>(0)
  const [txs, setTxs] = useState<Tx[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [budgets, setBudgets] = useState<BudgetRow[]>([])
  const [newAccount, setNewAccount] = useState({ name: '', bank: '' })
  const [budgetForm, setBudgetForm] = useState({ category_id: 0, monthly_limit: '' })
  const [search, setSearch] = useState('')
  const [reviewOnly, setReviewOnly] = useState(false)

  const reload = useCallback(() => {
    api.get<Account[]>(`/api/accounts?user_id=${user.id}`).then(setAccounts)
    const params = new URLSearchParams({ user_id: String(user.id) })
    if (selectedAccount) params.set('account_id', String(selectedAccount))
    if (search) params.set('search', search)
    if (reviewOnly) params.set('needs_review', 'true')
    api.get<Tx[]>(`/api/transactions?${params}`).then(setTxs)
    api.get<Summary>(`/api/reports/summary?user_id=${user.id}`).then(setSummary)
    api.get<BudgetRow[]>(`/api/budgets?user_id=${user.id}`).then(setBudgets)
  }, [user.id, selectedAccount, search, reviewOnly])

  useEffect(reload, [reload])

  const addAccount = async () => {
    if (!newAccount.name.trim()) return
    await api.post('/api/accounts', { user_id: user.id, ...newAccount })
    setNewAccount({ name: '', bank: '' })
    reload()
  }

  const saveBudget = async () => {
    const limit = parseFloat(budgetForm.monthly_limit)
    if (!budgetForm.category_id || !limit) return
    await api.post('/api/budgets', {
      user_id: user.id,
      category_id: budgetForm.category_id,
      monthly_limit: limit,
    })
    setBudgetForm({ category_id: 0, monthly_limit: '' })
    reload()
  }

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0)

  return (
    <div>
      <div className="grid cols-3 section">
        <div className="card">
          <h3>Total Balance</h3>
          <div className={`stat ${totalBalance >= 0 ? 'pos' : 'neg'}`}>{fmt(totalBalance)}</div>
          <div className="muted">
            {accounts.length} account{accounts.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="card">
          <h3>Income / Expenses (all time)</h3>
          <div className="stat pos">{summary ? fmt(summary.income) : '—'}</div>
          <div className="stat neg">{summary ? `-${fmt(summary.expenses)}` : '—'}</div>
        </div>
        <div className="card">
          <h3>Spending by Category</h3>
          {summary && summary.by_category.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie
                  data={summary.by_category}
                  dataKey="total"
                  nameKey="category"
                  innerRadius={35}
                  outerRadius={60}
                >
                  {summary.by_category.map((c) => (
                    <Cell key={c.category} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ background: '#1e2230', border: '1px solid #2a2f40' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="muted">No expenses yet — import a statement below.</div>
          )}
        </div>
      </div>

      <div className="grid cols-2 section">
        <div className="card">
          <h3>Accounts</h3>
          {accounts.length === 0 && <div className="muted">No accounts yet. Add one to start importing.</div>}
          <table>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                    <div className="muted">{a.bank}</div>
                  </td>
                  <td className={a.balance >= 0 ? 'amount-pos' : 'amount-neg'}>{fmt(a.balance, a.currency)}</td>
                  <td className="muted">
                    {a.transaction_count} txs
                    {a.last_activity ? ` · last ${a.last_activity}` : ''}
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      title="Delete account and all its transactions"
                      onClick={async () => {
                        if (confirm(`Delete account "${a.name}" and all its transactions?`)) {
                          await api.del(`/api/accounts/${a.id}`)
                          if (selectedAccount === a.id) setSelectedAccount(0)
                          reload()
                        }
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <input
              placeholder="Account name"
              value={newAccount.name}
              onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
            />
            <input
              placeholder="Bank"
              value={newAccount.bank}
              onChange={(e) => setNewAccount({ ...newAccount, bank: e.target.value })}
            />
            <button onClick={addAccount}>Add account</button>
          </div>
        </div>

        <div className="card">
          <h3>Import Statement</h3>
          <ImportDropzone accounts={accounts} onImported={reload} />
        </div>
      </div>

      <div className="card section">
        <h3>Monthly Budgets</h3>
        {budgets.map((b) => {
          const pct = b.monthly_limit ? Math.min((b.spent / b.monthly_limit) * 100, 100) : 0
          const over = b.spent > b.monthly_limit
          return (
            <div key={b.id} style={{ marginBottom: '0.7rem' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {b.category}{' '}
                  <button
                    className="icon-btn"
                    title="Remove budget"
                    onClick={async () => {
                      await api.del(`/api/budgets/${b.id}`)
                      reload()
                    }}
                  >
                    ✕
                  </button>
                </span>
                <span className="muted">
                  {fmt(b.spent)} / {fmt(b.monthly_limit)}
                  {over ? ' — over!' : ''}
                </span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${pct}%`, background: over ? 'var(--red)' : pct > 80 ? 'var(--amber)' : b.color }}
                />
              </div>
            </div>
          )
        })}
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <select
            value={budgetForm.category_id}
            onChange={(e) => setBudgetForm({ ...budgetForm, category_id: Number(e.target.value) })}
          >
            <option value={0}>Category…</option>
            {categories
              .filter((c) => c.name !== 'Income')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <input
            type="number"
            placeholder="Monthly limit"
            value={budgetForm.monthly_limit}
            onChange={(e) => setBudgetForm({ ...budgetForm, monthly_limit: e.target.value })}
            style={{ width: '9rem' }}
          />
          <button onClick={saveBudget}>Set budget</button>
        </div>
      </div>

      <div className="card">
        <h3>Transactions</h3>
        <div className="row" style={{ marginBottom: '0.6rem' }}>
          <select value={selectedAccount} onChange={(e) => setSelectedAccount(Number(e.target.value))}>
            <option value={0}>All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input placeholder="Search description…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="row muted" style={{ gap: '0.3rem' }}>
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
            needs review only
          </label>
        </div>
        <TransactionsTable txs={txs} categories={categories} accounts={accounts} onChanged={reload} userId={user.id} />
      </div>
    </div>
  )
}
