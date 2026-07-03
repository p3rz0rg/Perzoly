import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, fmt } from '../api'
import type { Comparison } from '../api'

const PERIODS: Record<string, number | null> = {
  'Last 30 days': 30,
  'Last 90 days': 90,
  'This year': 365,
  'All time': null,
}

const USER_COLORS = ['#6366f1', '#ec4899', '#22c55e', '#f59e0b']

export default function CombinedTab() {
  const [data, setData] = useState<Comparison | null>(null)
  const [period, setPeriod] = useState('Last 30 days')

  useEffect(() => {
    const days = PERIODS[period]
    const params = new URLSearchParams()
    if (days) {
      const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
      params.set('start', start)
    }
    api.get<Comparison>(`/api/reports/comparison?${params}`).then(setData)
  }, [period])

  if (!data) return <div className="muted">Loading…</div>

  const names = Object.keys(data.per_user)

  return (
    <div>
      <div className="row section">
        <h2 style={{ margin: 0, flex: 1 }}>Household Spending Comparison</h2>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {Object.keys(PERIODS).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className="grid cols-3 section">
        {names.map((name, i) => {
          const u = data.per_user[name]
          return (
            <div className="card" key={name}>
              <h3 style={{ color: USER_COLORS[i % USER_COLORS.length] }}>{name}</h3>
              <div className="stat neg">{fmt(u.expenses)}</div>
              <div className="muted">
                income {fmt(u.income)} · net{' '}
                <span style={{ color: u.net >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(u.net)}</span> · savings
                rate {u.savings_rate}%
              </div>
            </div>
          )
        })}
        <div className="card">
          <h3>Household Net</h3>
          <div className={`stat ${data.household_net >= 0 ? 'pos' : 'neg'}`}>{fmt(data.household_net)}</div>
          <div className="muted">combined surplus for {period.toLowerCase()}</div>
        </div>
      </div>

      <div className="card section">
        <h3>Category Breakdown — Side by Side</h3>
        {data.category_comparison.length === 0 ? (
          <div className="muted">No expenses in this period.</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.category_comparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f40" />
              <XAxis dataKey="category" tick={{ fill: '#8b93a7', fontSize: 12 }} />
              <YAxis tick={{ fill: '#8b93a7', fontSize: 12 }} />
              <Tooltip
                formatter={(v) => fmt(Number(v))}
                contentStyle={{ background: '#1e2230', border: '1px solid #2a2f40' }}
              />
              <Legend />
              {names.map((name, i) => (
                <Bar key={name} dataKey={name} fill={USER_COLORS[i % USER_COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <h3>Shared Expenses (tagged household)</h3>
        {data.shared_expenses.length === 0 ? (
          <div className="muted">
            No shared expenses tagged in this period. Tick the “Shared” box on a transaction to include it here.
          </div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Paid by</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Split</th>
                  <th style={{ textAlign: 'right' }}>Partner owes</th>
                </tr>
              </thead>
              <tbody>
                {data.shared_expenses.map((s, i) => (
                  <tr key={i}>
                    <td>{s.date}</td>
                    <td>{s.user}</td>
                    <td>{s.description}</td>
                    <td className="amount-neg">{fmt(s.amount)}</td>
                    <td className="muted">
                      {Math.round(s.split_ratio * 100)}/{Math.round((1 - s.split_ratio) * 100)}
                    </td>
                    <td className="amount-neg">{fmt(s.owed_by_other)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <SettleUp shared={data.shared_expenses} names={names} />
          </>
        )}
      </div>
    </div>
  )
}

function SettleUp({
  shared,
  names,
}: {
  shared: Comparison['shared_expenses']
  names: string[]
}) {
  if (names.length < 2) return null
  const owedTo: Record<string, number> = {}
  for (const s of shared) owedTo[s.user] = (owedTo[s.user] ?? 0) + s.owed_by_other
  const [a, b] = names
  const net = (owedTo[a] ?? 0) - (owedTo[b] ?? 0)
  return (
    <div className="muted" style={{ marginTop: '0.75rem' }}>
      <strong>Settle up:</strong>{' '}
      {net === 0
        ? 'all square.'
        : net > 0
          ? `${b} owes ${a} ${fmt(net)}`
          : `${a} owes ${b} ${fmt(-net)}`}
    </div>
  )
}
