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
import type { Insight, RecurringCharge, Summary, User } from '../api'

interface Cashflow {
  month_to_date_net: number
  projected_end_of_month_net: number
  upcoming_bills: { merchant: string; amount: number; due: string }[]
  overdraft_risk: boolean
}

const ICONS: Record<string, string> = { alert: '🔴', warning: '🟡', info: '🔵' }

export default function ReportsTab({ users }: { users: User[] }) {
  const [userId, setUserId] = useState<number>(users[0]?.id ?? 1)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [insights, setInsights] = useState<Insight[]>([])
  const [recurring, setRecurring] = useState<RecurringCharge[]>([])
  const [cashflow, setCashflow] = useState<Cashflow | null>(null)

  useEffect(() => {
    api.get<Summary>(`/api/reports/summary?user_id=${userId}`).then(setSummary)
    api.get<Insight[]>(`/api/reports/insights?user_id=${userId}`).then(setInsights)
    api.get<RecurringCharge[]>(`/api/reports/recurring?user_id=${userId}`).then(setRecurring)
    api.get<Cashflow>(`/api/reports/cashflow?user_id=${userId}`).then(setCashflow)
  }, [userId])

  const subsTotal = recurring.reduce((s, r) => s + r.monthly_cost, 0)

  return (
    <div>
      <div className="row section">
        <h2 style={{ margin: 0, flex: 1 }}>Reports & Coach</h2>
        <select value={userId} onChange={(e) => setUserId(Number(e.target.value))}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card section">
        <h3>Coach Insights</h3>
        {insights.map((ins, i) => (
          <div key={i} className={`insight ${ins.severity}`}>
            <span>{ICONS[ins.severity] ?? '🔵'}</span>
            <span>{ins.message}</span>
          </div>
        ))}
      </div>

      <div className="grid cols-2 section">
        <div className="card">
          <h3>Cash-flow Forecast</h3>
          {cashflow && (
            <>
              <div className="muted">Month to date net</div>
              <div className={`stat ${cashflow.month_to_date_net >= 0 ? 'pos' : 'neg'}`}>
                {fmt(cashflow.month_to_date_net)}
              </div>
              <div className="muted" style={{ marginTop: '0.5rem' }}>
                Projected end of month
              </div>
              <div className={`stat ${cashflow.projected_end_of_month_net >= 0 ? 'pos' : 'neg'}`}>
                {fmt(cashflow.projected_end_of_month_net)}
              </div>
              {cashflow.upcoming_bills.length > 0 && (
                <>
                  <div className="muted" style={{ marginTop: '0.5rem' }}>
                    Upcoming recurring bills:
                  </div>
                  {cashflow.upcoming_bills.map((b, i) => (
                    <div key={i} className="muted">
                      {b.due}: {b.merchant} — {fmt(b.amount)}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h3>Monthly Income vs Expenses</h3>
          {summary && summary.monthly.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={summary.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f40" />
                <XAxis dataKey="month" tick={{ fill: '#8b93a7', fontSize: 12 }} />
                <YAxis tick={{ fill: '#8b93a7', fontSize: 12 }} />
                <Tooltip
                  formatter={(v) => fmt(Number(v))}
                  contentStyle={{ background: '#1e2230', border: '1px solid #2a2f40' }}
                />
                <Legend />
                <Bar dataKey="income" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="muted">No data yet.</div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>
          Subscription Audit{' '}
          {recurring.length > 0 && (
            <span className="muted">
              — {fmt(subsTotal)}/month, {fmt(subsTotal * 12)}/year
            </span>
          )}
        </h3>
        {recurring.length === 0 ? (
          <div className="muted">
            No recurring charges detected yet. They show up once a merchant appears 3+ times at a steady amount and
            interval.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Cadence</th>
                <th style={{ textAlign: 'right' }}>Avg amount</th>
                <th style={{ textAlign: 'right' }}>Monthly cost</th>
                <th style={{ textAlign: 'right' }}>Yearly cost</th>
                <th>Last charged</th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((r) => (
                <tr key={r.merchant}>
                  <td>{r.merchant}</td>
                  <td className="muted">
                    {r.cadence} ×{r.occurrences}
                  </td>
                  <td className="amount-neg">{fmt(r.average_amount)}</td>
                  <td className="amount-neg">{fmt(r.monthly_cost)}</td>
                  <td className="amount-neg">{fmt(r.yearly_cost)}</td>
                  <td className="muted">{r.last_charged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
