import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { recurringCertainty } from '@shared/LedgerRules.js'
import { Bullet, RankBars, Stat } from '../components/Charts'
import { Card, Empty, Notice } from '../components/Ui'
import { TABS, availableMonths, patchIn, type SheetRow, type Workbook } from '../lib/ledger'
import { recurringActuals } from '../lib/metrics'
import type { SheetsContext } from '../lib/sheets'

const STATUS_LABEL: Record<string, string> = {
  expected: '예정',
  committed: '확정·선반영',
  confirmed: '집행',
  active: '기록됨',
  deleted: '삭제됨',
}

export function RecurringScreen({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const months = availableMonths(workbook, today)
  const [month, setMonth] = useState(months[0] ?? today.slice(0, 7))
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = recurringActuals(workbook, month, 'expense')
  const savings = recurringActuals(workbook, month, 'transfer').filter((i) => String(i.row.active).trim().toUpperCase() === 'Y')
  const active = items.filter((i) => String(i.row.active).trim().toUpperCase() === 'Y')
  const expectedTotal = active.reduce((a, i) => a + i.expectedUsd, 0)
  const confirmedTotal = active.reduce((a, i) => a + i.actualUsd, 0)
  // 아직 실제 금액이 들어오지 않은 항목. committed 는 예산에는 이미 들어가 있지만 집행 전이다.
  const pendingCount = active.filter((i) => i.status !== 'confirmed' && i.status !== 'active').length
  const committedTotal = active
    .filter((i) => recurringCertainty(i.row) === 'fixed')
    .reduce((a, i) => a + i.expectedUsd, 0)

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
          <Stat label="집행된 금액" value={formatUsd(confirmedTotal)} size="md" />
        </div>
        <div style={{ marginTop: 10 }}>
          <Bullet label="집행 진행" value={confirmedTotal} target={expectedTotal} />
        </div>
        <p className="meta" style={{ marginTop: 8 }}>
          이 중 금액이 정해진 {formatUsd(committedTotal)} 는 달이 시작될 때 이미 예산에서 빠집니다.
          나머지는 실제 금액을 보낼 때 빠집니다.
        </p>
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
                      {recurringCertainty(i.row) === 'fixed' ? ' · 금액 확정(예산 선반영)' : ' · 금액 변동'}
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
                {open && (
                  <p className="meta" style={{ margin: '0 0 12px' }}>
                    <button
                      className="ghost"
                      style={{ padding: '2px 10px', marginRight: 8 }}
                      disabled={busy}
                      onClick={() =>
                        void save(i.row, {
                          certainty: recurringCertainty(i.row) === 'fixed' ? 'variable' : 'fixed',
                        })
                      }
                    >
                      {recurringCertainty(i.row) === 'fixed' ? '금액 변동으로' : '금액 확정으로'}
                    </button>
                    금액 확정으로 두면 다음 달부터 달이 열릴 때 예산에서 미리 빠집니다.
                    렌트·구독료처럼 액수가 정해진 것만 확정으로 두세요.
                  </p>
                )}
              </div>
            )
          })
        )}
      </Card>

      {savings.length > 0 && (
        <Card title="저축 (먼저 저축)">
          {savings.map((i) => (
            <Bullet
              key={i.id}
              label={
                <>
                  {i.name} <span className="pill">{i.status ? STATUS_LABEL[i.status] ?? i.status : '미기장'}</span>
                </>
              }
              value={i.actualUsd}
              target={i.expectedUsd}
              tone="income"
              hint={`${String(i.row.due_day)}일 · 옮긴 뒤 봇에 "${i.name} 금액" 을 보내면 확정됩니다`}
            />
          ))}
          <p className="meta" style={{ marginTop: 8 }}>수입에서 먼저 떼어 두는 돈입니다. 리포트의 순저축과는 별개로, 계획한 만큼 실제로 옮겼는지를 봅니다.</p>
        </Card>
      )}

      {categoryRank.length > 0 && (
        <Card title="고정비 구성">
          <RankBars items={categoryRank} />
        </Card>
      )}
    </div>
  )
}
