import { useMemo, useState } from 'react'
import { envelopeStatus, formatUsd } from '@shared/Budget.js'
import { Bullet, Stat } from '../components/Charts'
import { Card, Empty, Notice } from '../components/Ui'
import { TABS, appendTo, availableMonths, budgetAmount, configList, monthTransactions, patchIn, type SheetRow, type Workbook } from '../lib/ledger'
import type { SheetsContext } from '../lib/sheets'

export function Budgets({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const months = availableMonths(workbook, today)
  const [month, setMonth] = useState(months[0] ?? today.slice(0, 7))
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const envelopes = configList(workbook.config, 'envelopes')
  const transactions = useMemo(() => monthTransactions(workbook, month), [workbook, month])
  const asOf = month === today.slice(0, 7) ? today : `${month}-28`

  const findBudgetRow = (envelope: string): SheetRow | undefined =>
    workbook.budgets.find((row) => String(row.month).trim() === month && String(row.envelope).trim() === envelope)

  async function save(envelope: string, patch: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const existing = findBudgetRow(envelope)
      if (existing) await patchIn(ctx, workbook, TABS.budgets, existing, patch)
      else await appendTo(ctx, workbook, TABS.budgets, { month, envelope, amount: 0, carryover: 'reset', ...patch })
      setEditing(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const rows = envelopes.map((envelope) => {
    const budget = budgetAmount(workbook, month, envelope)
    const status = envelopeStatus({ budget, transactions: transactions as unknown as Array<Record<string, unknown>>, envelope, today: asOf })
    return { envelope, budget, status, carryover: String(findBudgetRow(envelope)?.carryover ?? 'reset') }
  })
  const totalBudget = rows.reduce((a, r) => a + r.budget, 0)
  const totalSpent = rows.reduce((a, r) => a + r.status.spentTotal, 0)
  const totalPace = rows.reduce((a, r) => a + r.status.plannedPaceToDate, 0)

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}

      <Card>
        <div className="row">
          <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 160 }}>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <Stat label="예산 대비 집행" value={`${totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0}%`} size="md" />
        </div>
        <div style={{ marginTop: 10 }}>
          <Bullet label="전체" value={totalSpent} target={totalBudget} pace={totalPace} hint={`잔액 ${formatUsd(totalBudget - totalSpent)}`} />
        </div>
      </Card>

      <Card title="봉투별">
        {rows.length === 0 ? (
          <Empty>Config 탭의 envelopes 가 비어 있습니다.</Empty>
        ) : (
          rows.map(({ envelope, budget, status, carryover }) => {
            const open = editing === envelope
            const draft = drafts[envelope] ?? String(budget)
            return (
              <div key={envelope}>
                <Bullet
                  label={
                    <>
                      {envelope} <span className="pill">{carryover === 'carry' ? '이월' : '초기화'}</span>
                    </>
                  }
                  value={status.spentTotal}
                  target={budget}
                  pace={status.plannedPaceToDate}
                  hint={`잔액 ${formatUsd(status.remaining)} · 남은 ${status.remainingDays}일 · ${formatUsd(status.allowanceToday)}/일`}
                  onClick={() => setEditing(open ? null : envelope)}
                />
                {open && (
                  <div className="row" style={{ alignItems: 'flex-end', padding: '4px 0 12px' }}>
                    <div className="grow">
                      <label>예산 (USD)</label>
                      <input inputMode="decimal" value={draft} onChange={(e) => setDrafts((d) => ({ ...d, [envelope]: e.target.value }))} />
                    </div>
                    <div style={{ width: 118 }}>
                      <label>월말 잔액</label>
                      <select value={carryover} onChange={(e) => void save(envelope, { carryover: e.target.value })} disabled={busy}>
                        <option value="reset">초기화</option>
                        <option value="carry">이월</option>
                      </select>
                    </div>
                    <button className="primary" disabled={busy || Number(draft) === budget || !Number.isFinite(Number(draft))} onClick={() => void save(envelope, { amount: Number(draft) })}>
                      저장
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
        <p className="meta" style={{ marginTop: 10 }}>봉투를 누르면 예산을 고칠 수 있습니다. 이월로 두면 다음 달 시작 때 남은 금액이 더해집니다.</p>
      </Card>
    </div>
  )
}
