import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Bullet, Stat } from '../components/Charts'
import { RowSheet } from '../components/RowSheet'
import { Card, Empty, Notice } from '../components/Ui'
import { TABS, availableMonths, nextIdFor, patchIn, patchTransaction, statusBadge, type SheetRow, type Workbook } from '../lib/ledger'
import { incomePlan, paydaysOf, type RecurringActual } from '../lib/metrics'
import type { SheetsContext } from '../lib/sheets'
import { TransactionEditSheet } from './LedgerScreen'

const STATUS_LABEL: Record<string, string> = { expected: '예정', confirmed: '확정', active: '기록됨', deleted: '삭제됨' }

/** 예상 수입. 고정(급여)은 매월 예약 행이 생기고, 변동(레슨)은 같은 카테고리의 기록을 합한다. */
export function Income({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const months = availableMonths(workbook, today)
  const [month, setMonth] = useState(months[0] ?? today.slice(0, 7))
  const [editing, setEditing] = useState<SheetRow | 'new' | null>(null)
  // 펼쳐 둔 수입원. 누르면 그 달에 이 수입원으로 들어온 기록이 아래에 나온다.
  const [open, setOpen] = useState<string | null>(null)
  const [editingTx, setEditingTx] = useState<SheetRow | null>(null)
  const [undo, setUndo] = useState<{ row: SheetRow; previousStatus: string; label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const plan = incomePlan(workbook, month)
  const diff = plan.actualTotal - plan.expectedTotal

  async function toggleActive(row: SheetRow) {
    setBusy(true)
    try {
      const active = String(row.active).trim().toUpperCase() !== 'N'
      await patchIn(ctx, workbook, TABS.recurring, row, { active: active ? 'N' : 'Y' })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    if (!undo) return
    try {
      await patchTransaction(ctx, workbook, undo.row, { status: undo.previousStatus, updated_by: 'web' })
      setUndo(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function hintOf(s: RecurringActual): string {
    if (s.kind !== 'fixed') return `카테고리 "${s.category}" 로 기록된 수입을 합칩니다`
    const paydays = paydaysOf(s.row, month)
    if (paydays.length > 0) {
      return `${month} 급여일 ${paydays.length}번 (${paydays.map((d) => d.slice(8)).join(', ')}일) · 받을 때마다 봇에 "${s.name} 금액" 을 보내면 확정됩니다`
    }
    return `${String(s.row.due_day)}일 · 봇에 "${s.name} 금액" 을 보내면 확정됩니다`
  }

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}
      {undo && (
        <Notice kind="info">
          <span className="row" style={{ gap: 10 }}>
            <span className="grow">{undo.label} 삭제했습니다.</span>
            <button className="ghost" style={{ padding: '2px 10px' }} onClick={() => void restore()}>
              되돌리기
            </button>
            <button className="ghost" style={{ padding: '2px 10px' }} onClick={() => setUndo(null)}>
              닫기
            </button>
          </span>
        </Notice>
      )}

      <Card>
        <div className="row">
          <select value={month} onChange={(e) => { setMonth(e.target.value); setOpen(null) }} style={{ maxWidth: 160 }}>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button onClick={() => setEditing('new')}>수입원 추가</button>
        </div>
        <div className="stat-row" style={{ marginTop: 14 }}>
          <Stat label="예상 수입" value={formatUsd(plan.expectedTotal)} size="md" />
          <Stat label="들어온 수입" value={formatUsd(plan.actualTotal)} size="md" tone={plan.actualTotal > 0 ? 'good' : undefined} />
          <Stat label="차이" value={`${diff >= 0 ? '+' : '-'}${formatUsd(Math.abs(diff))}`} size="md" tone={diff < 0 ? 'muted' : 'good'} />
        </div>
        <div style={{ marginTop: 10 }}>
          <Bullet label="이달 전체" value={plan.actualTotal} target={plan.expectedTotal} tone="income" />
        </div>
      </Card>

      <Card title="수입원별">
        {plan.sources.length === 0 ? (
          <Empty>수입원이 없습니다. 위 버튼으로 급여나 레슨을 추가하세요.</Empty>
        ) : (
          plan.sources.map((s) => {
            const expanded = open === s.id
            const isActive = String(s.row.active).trim().toUpperCase() !== 'N'
            return (
              <div key={s.id}>
                <Bullet
                  label={
                    <>
                      {s.name} <span className="pill">{s.kind === 'fixed' ? '고정' : '변동'}</span>
                      {s.status && <span className="pill">{STATUS_LABEL[s.status] ?? s.status}</span>}
                      <span className="meta"> {expanded ? '▴' : '▾'}</span>
                    </>
                  }
                  value={s.actualUsd}
                  target={s.expectedUsd}
                  tone="income"
                  hint={hintOf(s)}
                  onClick={() => setOpen(expanded ? null : s.id)}
                />
                {expanded && (
                  <div className="detail">
                    {s.rows.length === 0 ? (
                      <Empty>{month} 에 이 수입원으로 들어온 기록이 없습니다.</Empty>
                    ) : (
                      s.rows.map((row) => {
                        const badge = statusBadge(row)
                        return (
                          <div
                            className="tx"
                            key={String(row.id) || row._row}
                            role="button"
                            tabIndex={0}
                            onClick={() => setEditingTx(row)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') setEditingTx(row)
                            }}
                          >
                            <span className="date">{String(row.date).slice(5, 10)}</span>
                            <span className="grow ellipsis">
                              {String(row.merchant) || s.name}
                              {String(row.memo ?? '').trim() && <span className="meta"> · {String(row.memo)}</span>}
                              {badge && (
                                <>
                                  <br />
                                  <span className={`pill pill-${badge.tone}`}>{badge.label}</span>
                                </>
                              )}
                            </span>
                            <span className={`amount income${badge ? ' pending' : ''}`}>+{formatUsd(Number(row.amount_usd) || 0)}</span>
                          </div>
                        )
                      })
                    )}
                    <div className="detail-foot">
                      <span className="meta">
                        {s.rows.length > 0 && `${s.rows.length}건 · 항목을 누르면 고칠 수 있습니다`}
                      </span>
                      <span className="btns">
                        <button className="ghost" style={{ padding: '4px 12px' }} onClick={() => setEditing(s.row)}>
                          수입원 수정
                        </button>
                        <button className="ghost" style={{ padding: '4px 12px' }} disabled={busy} onClick={() => void toggleActive(s.row)}>
                          {isActive ? '중지' : '사용'}
                        </button>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
        <p className="meta" style={{ marginTop: 10 }}>
          수입원을 누르면 그 달에 들어온 기록이 펼쳐집니다. 고정 수입은 매월 예정 행이 자동으로 생기고 실제 금액을 보내면 확정됩니다. 변동 수입은 건별로 기록하면 여기 합산됩니다.
        </p>
      </Card>

      {editing && (
        <RowSheet
          title={editing === 'new' ? '수입원 추가' : '수입원 수정'}
          tab={TABS.recurring}
          row={editing === 'new' ? null : editing}
          workbook={workbook}
          ctx={ctx}
          fields={[
            { key: 'name', label: '이름 (예: 급여, 레슨)' },
            { key: 'kind', label: '방식', options: [{ value: 'fixed', label: '고정 (매월 예정 행 생성)' }, { value: 'variable', label: '변동 (건별 기록 합산)' }] },
            { key: 'category', label: '카테고리 (변동 수입은 이 값으로 기록을 묶습니다)' },
            { key: 'expected_amount', label: '월 예상 금액', numeric: true },
            { key: 'currency', label: '통화', options: ['USD', 'KRW'] },
            { key: 'due_day', label: '입금일 (고정 수입만)', numeric: true },
            { key: 'notes', label: '메모' },
          ]}
          defaults={{
            id: nextIdFor(workbook.recurring, 'I'),
            type: 'income',
            active: 'Y',
            amount_rule: 'fixed',
            tolerance_pct: 0,
            kind: 'fixed',
            currency: 'USD',
            due_day: 1,
          }}
          onClose={() => setEditing(null)}
          onError={setError}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}

      {editingTx && (
        <TransactionEditSheet
          row={editingTx}
          workbook={workbook}
          ctx={ctx}
          onClose={() => setEditingTx(null)}
          onError={setError}
          onDeleted={(row, previousStatus) =>
            setUndo({ row, previousStatus, label: `${String(row.merchant) || '(이름 없음)'} ${formatUsd(Number(row.amount_usd) || 0)}` })
          }
          onChanged={() => {
            setEditingTx(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
