import { useMemo, useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Card, Empty } from '../components/Ui'
import { latestAssetsTotal, type Workbook } from '../lib/ledger'

interface MonthTotals {
  month: string
  income: number
  expense: number
  net: number
}

function lastMonths(fromMonth: string, count: number): string[] {
  const [y, m] = fromMonth.split('-').map(Number)
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export function Report({ workbook, today }: { workbook: Workbook; today: string }) {
  const thisMonth = today.slice(0, 7)
  const [selected, setSelected] = useState(thisMonth)
  const [asTable, setAsTable] = useState(false)

  const months = useMemo(() => lastMonths(thisMonth, 12), [thisMonth])

  const totals: MonthTotals[] = useMemo(() => {
    const byMonth = new Map<string, MonthTotals>()
    months.forEach((month) => byMonth.set(month, { month, income: 0, expense: 0, net: 0 }))
    workbook.transactions.forEach((row) => {
      if (String(row.status) === 'deleted') return
      const bucket = byMonth.get(String(row.date).slice(0, 7))
      if (!bucket) return
      const usd = Number(row.amount_usd) || 0
      if (String(row.type) === 'income') bucket.income += usd
      else if (String(row.type) === 'expense') bucket.expense += usd
    })
    return months.map((month) => {
      const b = byMonth.get(month)!
      return {
        month,
        income: Math.round(b.income * 100) / 100,
        expense: Math.round(b.expense * 100) / 100,
        net: Math.round((b.income - b.expense) * 100) / 100,
      }
    })
  }, [workbook, months])

  const peak = Math.max(1, ...totals.map((t) => Math.max(t.income, t.expense)))
  const current = totals.find((t) => t.month === selected) ?? totals[totals.length - 1]

  const categories = useMemo(() => {
    const sums = new Map<string, number>()
    workbook.transactions.forEach((row) => {
      if (String(row.status) === 'deleted') return
      if (String(row.type) !== 'expense') return
      if (String(row.date).slice(0, 7) !== selected) return
      const key = String(row.category).trim() || '(분류 없음)'
      sums.set(key, (sums.get(key) ?? 0) + (Number(row.amount_usd) || 0))
    })
    const list = Array.from(sums.entries())
      .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount)
    const total = list.reduce((acc, c) => acc + c.amount, 0)
    return { list, total }
  }, [workbook, selected])

  const assets = latestAssetsTotal(workbook)
  const twelveMonth = totals.reduce(
    (acc, t) => ({ income: acc.income + t.income, expense: acc.expense + t.expense }),
    { income: 0, expense: 0 }
  )

  return (
    <div className="viz">
      <Card title={`${selected} 순저축`}>
        <p className={`hero${current.net < 0 ? ' negative' : ''}`}>{formatUsd(current.net)}</p>
        <p className="meta">
          수입 {formatUsd(current.income)} · 지출 {formatUsd(current.expense)}
        </p>
      </Card>

      <Card
        title="최근 12개월"
        action={
          <button className="ghost" onClick={() => setAsTable((v) => !v)}>
            {asTable ? '그래프로' : '표로'}
          </button>
        }
      >
        <div className="legend">
          <span>
            <i className="swatch" style={{ background: 'var(--series-income)' }} />
            수입
          </span>
          <span>
            <i className="swatch" style={{ background: 'var(--series-expense)' }} />
            지출
          </span>
          <span style={{ marginLeft: 'auto' }}>막대를 누르면 그 달을 봅니다</span>
        </div>

        {asTable ? (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>월</th>
                  <th>수입</th>
                  <th>지출</th>
                  <th>순저축</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.month}>
                    <td>{t.month}</td>
                    <td>{formatUsd(t.income)}</td>
                    <td>{formatUsd(t.expense)}</td>
                    <td>{formatUsd(t.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="bars">
              {totals.map((t) => (
                <button
                  key={t.month}
                  className={`col${t.month === selected ? ' selected' : ''}`}
                  onClick={() => setSelected(t.month)}
                  aria-label={`${t.month} 수입 ${formatUsd(t.income)}, 지출 ${formatUsd(t.expense)}`}
                  title={`${t.month}\n수입 ${formatUsd(t.income)}\n지출 ${formatUsd(t.expense)}`}
                >
                  <i className="income" style={{ height: `${(t.income / peak) * 100}%` }} />
                  <i className="expense" style={{ height: `${(t.expense / peak) * 100}%` }} />
                </button>
              ))}
            </div>
            <div className="bars-axis">
              {totals.map((t) => (
                <span key={t.month}>{t.month.slice(5)}</span>
              ))}
            </div>
          </>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <span className="meta">12개월 합계</span>
          <span className="meta">
            수입 {formatUsd(twelveMonth.income)} · 지출 {formatUsd(twelveMonth.expense)}
          </span>
        </div>
      </Card>

      <Card title={`${selected} 카테고리`}>
        {categories.list.length === 0 ? (
          <Empty>이 달의 지출 기록이 없습니다.</Empty>
        ) : (
          <div className="rank">
            {categories.list.map((c) => {
              const share = categories.total > 0 ? c.amount / categories.total : 0
              return (
                <div className="item" key={c.name}>
                  <div className="row">
                    <span className="ellipsis">{c.name}</span>
                    <span className="meta">
                      {formatUsd(c.amount)} · {(share * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="track">
                    <span style={{ width: `${Math.max(share * 100, 1)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {assets.date && (
        <Card title="자산">
          <p className="hero">{formatUsd(assets.total)}</p>
          <p className="meta">{assets.date} 스냅샷 기준</p>
        </Card>
      )}
    </div>
  )
}
