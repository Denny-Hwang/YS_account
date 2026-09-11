import { useMemo, useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Card, Empty, Notice } from '../components/Ui'
import {
  TABS,
  availableMonths,
  configNumber,
  monthTransactions,
  patchIn,
  type SheetRow,
  type Workbook,
} from '../lib/ledger'
import type { SheetsContext } from '../lib/sheets'

const STATUS_LABEL: Record<string, string> = {
  expected: '예정',
  confirmed: '확정',
  active: '기록됨',
  deleted: '삭제됨',
}

export function RecurringScreen({
  workbook,
  ctx,
  today,
  onChanged,
}: {
  workbook: Workbook
  ctx: SheetsContext
  today: string
  onChanged: () => void
}) {
  const months = availableMonths(workbook, today)
  const [month, setMonth] = useState(months[0] ?? today.slice(0, 7))
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fx = configNumber(workbook.config, 'fx_usd_krw', 1332)
  const transactions = useMemo(() => monthTransactions(workbook, month), [workbook, month])

  function actualFor(id: string): { amount: number; status: string } {
    const hits = transactions.filter(
      (row) => String(row.recurring_id).trim() === id && String(row.status) !== 'deleted'
    )
    const amount = hits.reduce((acc, row) => acc + (Number(row.amount_usd) || 0), 0)
    return { amount: Math.round(amount * 100) / 100, status: hits.length ? String(hits[hits.length - 1].status) : '' }
  }

  function expectedUsd(row: SheetRow): number {
    const raw = Number(row.expected_amount) || 0
    return String(row.currency).trim().toUpperCase() === 'KRW' ? Math.round((raw / fx) * 100) / 100 : raw
  }

  async function save(row: SheetRow, patch: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await patchIn(ctx, workbook, TABS.recurring, row, patch)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const totalExpected = workbook.recurring
    .filter((row) => String(row.active).trim().toUpperCase() === 'Y')
    .reduce((acc, row) => acc + expectedUsd(row), 0)

  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}

      <Card>
        <div className="row">
          <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 160 }}>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="meta">예상 합계 {formatUsd(totalExpected)}</span>
        </div>
      </Card>

      {workbook.recurring.length === 0 ? (
        <Empty>Recurring 탭이 비어 있습니다. Apps Script 의 runSetupAll 을 먼저 실행하세요.</Empty>
      ) : (
        workbook.recurring.map((row) => {
          const id = String(row.id).trim()
          const actual = actualFor(id)
          const expected = expectedUsd(row)
          const diff = actual.amount - expected
          const tolerance = Number(row.tolerance_pct) || 0
          const overTolerance =
            expected > 0 && actual.amount > 0 && Math.abs(diff / expected) * 100 > tolerance
          const active = String(row.active).trim().toUpperCase() === 'Y'
          const draft = drafts[id] ?? String(row.expected_amount ?? '')
          return (
            <section className="card" key={id || row._row}>
              <div className="row">
                <span className="envelope-name" style={{ opacity: active ? 1 : 0.5 }}>
                  {String(row.name) || id}
                </span>
                <span className="pill">
                  {actual.status ? STATUS_LABEL[actual.status] ?? actual.status : '미기장'}
                </span>
              </div>
              <p className="meta" style={{ marginTop: 6 }}>
                {String(row.due_day)}일 · 예상 {formatUsd(expected)}
                {actual.amount > 0 && <> · 실제 {formatUsd(actual.amount)}</>}
                {actual.amount > 0 && overTolerance && (
                  <span style={{ color: 'var(--warn)' }}>
                    {' '}
                    · 편차 {diff >= 0 ? '+' : '-'}
                    {formatUsd(Math.abs(diff))}
                  </span>
                )}
              </p>
              {String(row.amount_rule).startsWith('income_pct:') && (
                <p className="meta">그 달 수입의 {String(row.amount_rule).split(':')[1]}% 로 자동 계산됩니다.</p>
              )}
              <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
                <div className="grow">
                  <label>예상 금액 ({String(row.currency) || 'USD'})</label>
                  <input
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
                  />
                </div>
                <button
                  className="primary"
                  disabled={busy || draft === String(row.expected_amount ?? '')}
                  onClick={() => void save(row, { expected_amount: draft === '' ? '' : Number(draft) })}
                >
                  저장
                </button>
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => void save(row, { active: active ? 'N' : 'Y' })}
                >
                  {active ? '중지' : '사용'}
                </button>
              </div>
            </section>
          )
        })
      )}
    </>
  )
}
