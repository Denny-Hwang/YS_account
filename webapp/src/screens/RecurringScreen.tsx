import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Bullet, RankBars, Stat } from '../components/Charts'
import { Card, Empty, Notice } from '../components/Ui'
import { TABS, availableMonths, patchIn, type SheetRow, type Workbook } from '../lib/ledger'
import { recurringActuals } from '../lib/metrics'
import type { SheetsContext } from '../lib/sheets'

const STATUS_LABEL: Record<string, string> = { expected: '예정', confirmed: '확정', active: '기록됨', deleted: '삭제됨' }

export function RecurringScreen({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const months = availableMonths(workbook, today)
  const [month, setMonth] = useState(months[0] ?? today.slice(0, 7))
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = recurringActuals(workbook, month, 'expense')
  const active = items.filter((i) => String(i.row.active).trim().toUpperCase() === 'Y')
  const expectedTotal = active.reduce((a, i) => a + i.expectedUsd, 0)
  const confirmedTotal = active.reduce((a, i) => a + i.actualUsd, 0)
  const pendingCount = active.filter((i) => i.status !== 'confirmed' && i.status !== 'active').length

  const byCategory = new Map<string, number>()
  active.forEach((i) => byCategory.set(i.category || '(분류 없음)', (byCategory.get(i.category || '(분류 없음)') ?? 0) + i.expectedUsd))
  const categoryRank = Array.from(byCategory.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  async function save(row: SheetRow, patch: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await patchIn(ctx, workbook, TABS.recurring, row, patch)
      setEditing(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

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
          <span className="meta">{pendingCount > 0 ? `미확정 ${pendingCount}건` : '전부 확정'}</span>
        </div>
        <div className="stat-row" style={{ marginTop: 14 }}>
          <Stat label="이달 고정비 예상" value={formatUsd(expectedTotal)} size="md" />
          <Stat label="확정된 금액" value={formatUsd(confirmedTotal)} size="md" />
        </div>
        <div style={{ marginTop: 10 }}>
          <Bullet label="확정 진행" value={confirmedTotal} target={expectedTotal} />
        </div>
      </Card>

      <Card title="항목별 예상 대비 실제">
        {items.length === 0 ? (
          <Empty>Recurring 탭이 비어 있습니다. Apps Script 의 runSetupAll 을 먼저 실행하세요.</Empty>
        ) : (
          items.map((i) => {
            const isActive = String(i.row.active).trim().toUpperCase() === 'Y'
            const open = editing === i.id
            const draft = drafts[i.id] ?? String(i.row.expected_amount ?? '')
            const tolerance = Number(i.row.tolerance_pct) || 0
            const diff = i.actualUsd - i.expectedUsd
            const overTol = i.expectedUsd > 0 && i.actualUsd > 0 && Math.abs(diff / i.expectedUsd) * 100 > tolerance
            return (
              <div key={i.id} style={{ opacity: isActive ? 1 : 0.5 }}>
                <Bullet
                  label={
                    <>
                      {i.name} <span className="pill">{i.status ? STATUS_LABEL[i.status] ?? i.status : '미기장'}</span>
                    </>
                  }
                  value={i.actualUsd}
                  target={i.expectedUsd}
                  hint={
                    <>
                      {String(i.row.due_day)}일 · {i.category}
                      {i.actualUsd > 0 && overTol && (
                        <span style={{ color: 'var(--warn)' }}>
                          {' '}· 허용치 {tolerance}% 초과 ({diff >= 0 ? '+' : '-'}{formatUsd(Math.abs(diff))})
                        </span>
                      )}
                      {String(i.row.amount_rule).startsWith('income_pct:') && ` · 수입의 ${String(i.row.amount_rule).split(':')[1]}%`}
                    </>
                  }
                  onClick={() => setEditing(open ? null : i.id)}
                />
                {open && (
                  <div className="row" style={{ alignItems: 'flex-end', padding: '4px 0 12px' }}>
                    <div className="grow">
                      <label>예상 금액 ({String(i.row.currency) || 'USD'})</label>
                      <input inputMode="decimal" value={draft} onChange={(e) => setDrafts((d) => ({ ...d, [i.id]: e.target.value }))} />
                    </div>
                    <button className="primary" disabled={busy || draft === String(i.row.expected_amount ?? '')} onClick={() => void save(i.row, { expected_amount: draft === '' ? '' : Number(draft) })}>
                      저장
                    </button>
                    <button className="ghost" disabled={busy} onClick={() => void save(i.row, { active: isActive ? 'N' : 'Y' })}>
                      {isActive ? '중지' : '사용'}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </Card>

      {categoryRank.length > 0 && (
        <Card title="고정비 구성">
          <RankBars items={categoryRank} />
        </Card>
      )}
    </div>
  )
}
