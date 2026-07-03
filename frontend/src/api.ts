export interface User {
  id: number
  name: string
}

export interface Account {
  id: number
  user_id: number
  name: string
  bank: string
  currency: string
  balance: number
  transaction_count: number
  last_activity: string | null
}

export interface Category {
  id: number
  name: string
  keywords: string
  color: string
}

export interface Tx {
  id: number
  account_id: number
  date: string
  description: string
  amount: number
  category_id: number | null
  category: string | null
  category_color: string
  notes: string
  needs_review: boolean
  is_shared: boolean
  split_ratio: number
}

export interface BudgetRow {
  id: number
  category_id: number
  category: string
  color: string
  monthly_limit: number
  spent: number
}

export interface Insight {
  severity: 'info' | 'warning' | 'alert'
  kind: string
  message: string
}

export interface RecurringCharge {
  merchant: string
  occurrences: number
  cadence: string
  average_amount: number
  monthly_cost: number
  yearly_cost: number
  last_charged: string
}

export interface Summary {
  income: number
  expenses: number
  net: number
  by_category: { category: string; color: string; total: number }[]
  monthly: { month: string; income: number; expenses: number }[]
}

export interface Comparison {
  per_user: Record<
    string,
    {
      user_id: number
      income: number
      expenses: number
      net: number
      savings_rate: number
      by_category: Record<string, number>
    }
  >
  category_comparison: ({ category: string } & Record<string, number | string>)[]
  shared_expenses: {
    user: string
    date: string
    description: string
    amount: number
    split_ratio: number
    owed_by_other: number
  }[]
  household_net: number
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string) => fetch(path).then((r) => handle<T>(r)),
  post: <T>(path: string, body: unknown) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  patch: <T>(path: string, body: unknown) =>
    fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  del: (path: string) => fetch(path, { method: 'DELETE' }).then((r) => handle<void>(r)),
  upload: <T>(path: string, form: FormData) =>
    fetch(path, { method: 'POST', body: form }).then((r) => handle<T>(r)),
}

export const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n)
