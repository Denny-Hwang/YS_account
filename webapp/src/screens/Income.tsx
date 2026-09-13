import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Bullet, Stat } from '../components/Charts'
import { RowSheet } from '../components/RowSheet'
import { Card, Empty, Notice } from '../components/Ui'
import { TABS, availableMonths, nextIdFor, patchIn, type SheetRow, type Workbook } from '../lib/ledger'
import { incomePlan, paydaysOf } from '../lib/metrics'
import type { SheetsContext } from '../lib/sheets'

const STATUS_LABEL: Record<string, string> = { expected: '예정', confirmed: '확정', active: '기록됨', deleted: '삭제됨' }

/** 예상 수입. 고정(급여)은 매월 예약 행이 생기고, 변동(레슨)은 같은 카테고리의 기록을 합한다. */
export function Income({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const months = availableMonths(workbook, today)
  const [month, setMonth] = useState(months[0] ?? today.slice(0, 7))
  const [editing, setEditing] = useState<SheetRow | 'new' | null>(null)
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
          plan.sources.map((s) => (
            <Bullet
              key={s.id}
              label={
                <>
                  {s.name} <span className="pill">{s.kind === 'fixed' ? '고정' : '변동'}</span>
                  {s.status && <span className="pill">{STATUS_LABEL[s.status] ?? s.status}</span>}
                </>
              }
              value={s.actualUsd}
              target={s.expectedUsd}
              tone="income"
              hint={
                s.kind !== 'fixed'
                  ? `카테고리 "${s.category}" 로 기록된 수입을 합칩니다`
                  : paydaysOf(s.row, month).length > 0
                    ? `${month} 급여일 ${paydaysOf(s.row, month).length}번 (${paydaysOf(s.row, month).map((d) => d.slice(8)).join(', ')}일) · 받을 때마다 봇에 "${s.name} 금액" 을 보내면 확정됩니다`
                    : `${String(s.row.due_day)}일 · 봇에 "${s.name} 금액" 을 보내면 확정됩니다`
              }
              onClick={() => setEditing(s.row)}
            />
          ))
        )}
        <p className="meta" style={{ marginTop: 10 }}>
          고정 수입은 매월 예정 행이 자동으로 생기고 실제 금액을 보내면 확정됩니다. 변동 수입은 건별로 기록하면 여기 합산됩니다.
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

      {editing && editing !== 'new' && (
        <div style={{ position: 'fixed', bottom: 90, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 30 }}>
          <button className="ghost" disabled={busy} onClick={() => void toggleActive(editing)}>
            {String(editing.active).trim().toUpperCase() === 'N' ? '이 수입원 사용' : '이 수입원 중지'}
          </button>
        </div>
      )}
    </div>
  )
}
