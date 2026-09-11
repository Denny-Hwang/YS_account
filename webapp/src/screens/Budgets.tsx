import { useMemo, useState } from 'react'
import { envelopeStatus, formatUsd } from '@shared/Budget.js'
import { Card, Empty, Notice } from '../components/Ui'
import {
  TABS,
  appendTo,
  availableMonths,
  budgetAmount,
  configList,
  monthTransactions,
  patchIn,
  type SheetRow,
  type Workbook,
} from '../lib/ledger'
import type { SheetsContext } from '../lib/sheets'

export function Budgets({
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

  const envelopes = configList(workbook.config, 'envelopes')
  const transactions = useMemo(() => monthTransactions(workbook, month), [workbook, month])

  function findBudgetRow(envelope: string): SheetRow | undefined {
    return workbook.budgets.find(
      (row) => String(row.month).trim() === month && String(row.envelope).trim() === envelope
    )
  }

  async function save(envelope: string, patch: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const existing = findBudgetRow(envelope)
      if (existing) {
        await patchIn(ctx, workbook, TABS.budgets, existing, patch)
      } else {
        await appendTo(ctx, workbook, TABS.budgets, {
          month,
          envelope,
          amount: 0,
          carryover: 'reset',
          ...patch,
        })
      }
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const totalBudget = envelopes.reduce((acc, env) => acc + budgetAmount(workbook, month, env), 0)

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
          <span className="meta">합계 {formatUsd(totalBudget)}</span>
        </div>
      </Card>

      {envelopes.length === 0 ? (
        <Empty>Config 탭의 envelopes 가 비어 있습니다.</Empty>
      ) : (
        envelopes.map((envelope) => {
          const row = findBudgetRow(envelope)
          const amount = budgetAmount(workbook, month, envelope)
          const status = envelopeStatus({
            budget: amount,
            transactions: transactions as unknown as Array<Record<string, unknown>>,
            envelope,
            today,
          })
          const draft = drafts[envelope] ?? String(amount)
          const carryover = String(row?.carryover ?? 'reset')
          return (
            <section className="card" key={envelope}>
              <div className="row">
                <span className="envelope-name">{envelope}</span>
                <span className="meta">
                  실행 {formatUsd(status.spentTotal)} · 잔액 {formatUsd(status.remaining)}
                </span>
              </div>
              <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
                <div className="grow">
                  <label>예산</label>
                  <input
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [envelope]: e.target.value }))}
                  />
                </div>
                <div style={{ width: 128 }}>
                  <label>월말 잔액</label>
                  <select
                    value={carryover}
                    onChange={(e) => void save(envelope, { carryover: e.target.value })}
                    disabled={busy}
                  >
                    <option value="reset">초기화</option>
                    <option value="carry">이월</option>
                  </select>
                </div>
                <button
                  className="primary"
                  disabled={busy || Number(draft) === amount || !Number.isFinite(Number(draft))}
                  onClick={() => void save(envelope, { amount: Number(draft) })}
                >
                  저장
                </button>
              </div>
            </section>
          )
        })
      )}

      <p className="meta" style={{ padding: '0 4px' }}>
        월말 잔액을 이월로 두면 다음 달 monthlyOpen 이 남은 금액을 다음 달 예산에 더합니다.
      </p>
    </>
  )
}
