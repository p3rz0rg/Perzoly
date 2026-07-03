import { useEffect, useState } from 'react'
import { api } from './api'
import type { Category, User } from './api'
import AccountsTab from './components/AccountsTab'
import CombinedTab from './components/CombinedTab'
import ReportsTab from './components/ReportsTab'

export default function App() {
  const [users, setUsers] = useState<User[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tab, setTab] = useState<string>('user-1')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.get<User[]>('/api/users'), api.get<Category[]>('/api/categories')])
      .then(([u, c]) => {
        setUsers(u)
        setCategories(c)
      })
      .catch((e) => setError(`Could not reach the Perzoly backend (${e.message}). Is it running on port 8000?`))
  }, [])

  return (
    <div>
      <div className="topbar">
        <div className="logo">
          Perz<span>oly</span>
        </div>
        <div className="muted">household expense tracker</div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="tabs">
        {users.map((u) => (
          <button
            key={u.id}
            className={`tab ${tab === `user-${u.id}` ? 'active' : ''}`}
            onClick={() => setTab(`user-${u.id}`)}
          >
            {u.name === 'Me' ? 'My Accounts' : `${u.name}'s Accounts`}
          </button>
        ))}
        <button className={`tab ${tab === 'combined' ? 'active' : ''}`} onClick={() => setTab('combined')}>
          Combined View
        </button>
        <button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>
          Reports
        </button>
      </div>

      {users.map(
        (u) =>
          tab === `user-${u.id}` && <AccountsTab key={u.id} user={u} categories={categories} />,
      )}
      {tab === 'combined' && <CombinedTab />}
      {tab === 'reports' && <ReportsTab users={users} />}
    </div>
  )
}
