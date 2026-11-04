import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Bullet, Stat } from '../components/Charts'
import { RowSheet } from '../components/RowSheet'
import { Card, Empty, Field, Notice, Sheet } from '../components/Ui'
import {
  TABS,
  appendTransaction,
  availableMonths,
  configNumber,
  loadWorkbook,
  newTxId,
  nextIdFor,
  planSourceMerge,
  nowIso,
  patchIn,
  patchTransaction,
  softDeleteTransaction,
  statusBadge,
  writeMergeEdits,
  type SheetRow,
  type Workbook,
} from '../lib/ledger'
import { incomePlan, paydaySlots, paydaysOf, perCheckOf, type PaydaySlot, type RecurringActual } from '../lib/metrics'
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
  // "들어옴" 을 누른 급여일. 금액·날짜를 확인하고 확정한다.
  const [confirming, setConfirming] = useState<{ source: RecurringActual; slot: PaydaySlot } | null>(null)
  // 방금 확정한 급여를 되돌리는 방법. 예정 행을 확정했으면 예정으로, 새로 썼으면 삭제로 되돌린다.
  // "합치기" 를 누른 수입원(from). 같은 수입원이 둘로 나뉘어 등록됐을 때 쓴다.
  const [merging, setMerging] = useState<RecurringActual | null>(null)
  const [undoConfirm, setUndoConfirm] = useState<{ label: string; run: () => Promise<void> } | null>(null)

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

  async function runUndoConfirm() {
    if (!undoConfirm) return
    try {
      await undoConfirm.run()
      setUndoConfirm(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function hintOf(s: RecurringActual): string {
    if (s.kind !== 'fixed') return `카테고리 "${s.category}" 로 기록된 수입을 합칩니다`
    const paydays = paydaysOf(s.row, month)
    if (paydays.length > 0) {
      return `${month} 급여일 ${paydays.length}번 · 1회 ${formatUsd(perCheckOf(s.row) ?? 0)} · 들어오면 아래 줄의 "들어옴" 을 누르세요`
    }
    return `${String(s.row.due_day)}일 · 봇에 "${s.name} 금액" 을 보내면 확정됩니다`
  }

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}
      {undoConfirm && (
        <Notice kind="info">
          <span className="row" style={{ gap: 10 }}>
            <span className="grow">{undoConfirm.label}</span>
            <button className="ghost" style={{ padding: '2px 10px' }} onClick={() => void runUndoConfirm()}>
              되돌리기
            </button>
            <button className="ghost" style={{ padding: '2px 10px' }} onClick={() => setUndoConfirm(null)}>
              닫기
            </button>
          </span>
        </Notice>
      )}
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
                {s.kind === 'fixed' && isActive && (
                  <PaydayList
                    slots={paydaySlots(s, month)}
                    perCheck={perCheckOf(s.row) ?? 0}
                    today={today}
                    onConfirm={(slot) => setConfirming({ source: s, slot })}
                    onOpen={(row) => setEditingTx(row)}
                  />
                )}
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
                        {s.kind !== 'fixed' && plan.sources.some((o) => o.id !== s.id && o.kind !== 'fixed') && (
                          <button className="ghost" style={{ padding: '4px 12px' }} disabled={busy} onClick={() => setMerging(s)}>
                            합치기
                          </button>
                        )}
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
          수입원을 누르면 그 달에 들어온 기록이 펼쳐집니다. 2주급 급여는 급여일마다 예정 줄이 있고, 들어온 걸 확인하면 "들어옴" 을 눌러 확정합니다(봇에 "급여 금액" 을 보내도 됩니다).
          1회 금액과 기준 급여일은 더보기 › 설정 › 급여 에서 바꿉니다. 변동 수입은 건별로 기록하면 여기 합산됩니다.
        </p>
      </Card>

      {merging && (
        <MergeSheet
          from={merging}
          candidates={plan.sources.filter((o) => o.id !== merging.id && o.kind !== 'fixed')}
          workbook={workbook}
          ctx={ctx}
          onClose={() => setMerging(null)}
          onError={setError}
          onDone={(undoStep) => {
            setMerging(null)
            setUndoConfirm(undoStep)
            onChanged()
          }}
        />
      )}

      {confirming && (
        <PaydayConfirmSheet
          source={confirming.source}
          slot={confirming.slot}
          workbook={workbook}
          ctx={ctx}
          today={today}
          onClose={() => setConfirming(null)}
          onError={setError}
          onDone={(undoStep) => {
            setConfirming(null)
            setUndoConfirm(undoStep)
            onChanged()
          }}
        />
      )}

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

const SLOT_LABEL: Record<PaydaySlot['state'], string> = { confirmed: '들어옴', reserved: '예정', none: '예정' }

/** 2주급 급여일 줄. 들어온 급여는 누르면 고칠 수 있고, 예정 줄은 "들어옴" 으로 확정한다. */
function PaydayList({
  slots,
  perCheck,
  today,
  onConfirm,
  onOpen,
}: {
  slots: PaydaySlot[]
  perCheck: number
  today: string
  onConfirm: (slot: PaydaySlot) => void
  onOpen: (row: SheetRow) => void
}) {
  if (slots.length === 0) return null
  return (
    <div className="detail" style={{ marginTop: 4 }}>
      {slots.map((slot) => {
        const done = slot.state === 'confirmed'
        const amount = done && slot.row ? Number(slot.row.amount_usd) || 0 : perCheck
        const late = !done && slot.date < today
        return (
          <div className="tx" key={slot.date}>
            <span className="date">{(done && slot.row ? String(slot.row.date) : slot.date).slice(5, 10)}</span>
            <span className="grow">
              <span className={`pill${done ? '' : ' pill-reserved'}`}>{SLOT_LABEL[slot.state]}</span>
              {late && <span className="meta"> 지남</span>}
            </span>
            <span className={`amount income${done ? '' : ' pending'}`}>+{formatUsd(amount)}</span>
            {done && slot.row ? (
              <button className="ghost" style={{ padding: '2px 10px' }} onClick={() => onOpen(slot.row as SheetRow)}>
                고치기
              </button>
            ) : (
              <button className="primary" style={{ padding: '2px 10px' }} onClick={() => onConfirm(slot)}>
                들어옴
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * 급여 한 번을 확정한다. 그 급여일에 예정 행이 있으면 그 행을 confirmed 로 바꾸고, 없으면 confirmed 행을 새로 쓴다.
 * 금액은 1회 금액으로 미리 채우되 실제 입금액으로 고칠 수 있다. 날짜는 급여일, 이미 지났으면 그날 그대로다.
 */
function PaydayConfirmSheet({
  source,
  slot,
  workbook,
  ctx,
  today,
  onClose,
  onError,
  onDone,
}: {
  source: RecurringActual
  slot: PaydaySlot
  workbook: Workbook
  ctx: SheetsContext
  today: string
  onClose: () => void
  onError: (m: string) => void
  onDone: (undo: { label: string; run: () => Promise<void> }) => void
}) {
  const currency = String(source.row.currency || 'USD').trim().toUpperCase() || 'USD'
  const [amount, setAmount] = useState(String(perCheckOf(source.row) || ''))
  const [date, setDate] = useState(slot.date <= today ? slot.date : today)
  const [busy, setBusy] = useState(false)

  async function save() {
    const value = Number(amount)
    if (!(value > 0)) {
      onError('금액을 숫자로 넣으세요.')
      return
    }
    const fx = configNumber(workbook.config, 'fx_usd_krw', 1332)
    const amountUsd = currency === 'KRW' ? Math.round((value / fx) * 100) / 100 : value
    const label = `${source.name} ${date.slice(5)} ${formatUsd(amountUsd)} 확정했습니다.`
    setBusy(true)
    try {
      const target = slot.row
      if (target && slot.state === 'reserved') {
        const previous = {
          amount: target.amount,
          currency: target.currency,
          amount_usd: target.amount_usd,
          date: String(target.date).slice(0, 10),
          status: String(target.status),
        }
        await patchTransaction(ctx, workbook, target, {
          amount: value,
          currency,
          amount_usd: amountUsd,
          date,
          status: 'confirmed',
          payer: 'web',
          updated_by: 'web',
        })
        // 되돌릴 때는 방금 쓴 값과 비교해야 바뀐 열만 다시 쓴다.
        const written: SheetRow = { ...target, amount: value, currency, amount_usd: amountUsd, date, status: 'confirmed' }
        onDone({ label, run: () => patchTransaction(ctx, workbook, written, { ...previous, updated_by: 'web' }) })
      } else {
        const now = nowIso()
        const id = newTxId()
        const row = {
          id,
          date,
          type: 'income',
          kind: 'fixed',
          category: String(source.row.category ?? ''),
          envelope: '',
          merchant: source.name,
          amount: value,
          currency,
          amount_usd: amountUsd,
          recurring_id: source.id,
          status: 'confirmed',
          memo: '',
          payer: 'web',
          source: 'web',
          created_at: now,
          updated_at: now,
          updated_by: 'web',
        }
        await appendTransaction(ctx, workbook, row)
        // 새로 쓴 행은 아직 행 번호를 모른다. 다시 읽은 원장에서 id 로 찾아 soft delete 한다.
        onDone({
          label,
          run: async () => {
            const fresh = await loadWorkbook(ctx)
            const hit = fresh.transactions.find((t) => String(t.id) === id)
            if (hit) await softDeleteTransaction(ctx, fresh, hit, 'web')
          },
        })
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={`${source.name} 들어옴 확인`} onClose={onClose}>
      <p className="meta" style={{ marginTop: 0 }}>
        급여일 {slot.date}. 통장에 들어온 금액이 다르면 고쳐서 확정하세요.
      </p>
      <Field label={`들어온 금액 (${currency})`}>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="들어온 날짜">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className="actions">
        <button className="primary" onClick={() => void save()} disabled={busy}>
          확정
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          취소
        </button>
      </div>
    </Sheet>
  )
}

/**
 * 같은 수입원이 둘로 나뉘어 있을 때(예: "레슨" 과 "영주 레슨") 하나로 합친다.
 * 선택한 쪽(from)의 기록·가맹점 사전을 대상(to)으로 옮기고 from 은 중지한다. 기록은 지우지 않는다.
 * 옮긴 칸의 원래 값을 들고 있어 바로 되돌릴 수 있다.
 */
function MergeSheet({
  from,
  candidates,
  workbook,
  ctx,
  onClose,
  onError,
  onDone,
}: {
  from: RecurringActual
  candidates: RecurringActual[]
  workbook: Workbook
  ctx: SheetsContext
  onClose: () => void
  onError: (m: string) => void
  onDone: (undo: { label: string; run: () => Promise<void> }) => void
}) {
  const [targetId, setTargetId] = useState(candidates[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const target = candidates.find((c) => c.id === targetId) ?? null
  const preview = target ? planSourceMerge(workbook, from.row, target.row) : null

  async function run() {
    if (!target || !preview) return
    setBusy(true)
    try {
      const wasActive = String(from.row.active).trim().toUpperCase() !== 'N'
      const note = String(from.row.notes ?? '').trim()
      await writeMergeEdits(ctx, preview.edits)
      await patchIn(ctx, workbook, TABS.recurring, from.row, {
        active: 'N',
        notes: `${note ? `${note} · ` : ''}${target.name} 로 합침`,
      })
      onDone({
        label: `${from.name} 을(를) ${target.name} 로 합쳤습니다(기록 ${preview.transactions}건).`,
        run: async () => {
          await writeMergeEdits(ctx, preview.edits, true)
          await patchIn(ctx, workbook, TABS.recurring, { ...from.row, active: 'N', notes: `${note ? `${note} · ` : ''}${target.name} 로 합침` }, {
            active: wasActive ? 'Y' : 'N',
            notes: note,
          })
        },
      })
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={`${from.name} 합치기`} onClose={onClose}>
      <p className="meta" style={{ marginTop: 0 }}>
        "{from.name}" 의 기록을 아래 수입원으로 옮기고 "{from.name}" 은 중지합니다. 기록은 지워지지 않고, 합친 직후 되돌릴 수 있습니다.
      </p>
      <Field label="합칠 곳 (남길 수입원)">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {preview && (
        <p className="meta">
          옮길 원장 기록 {preview.transactions}건{preview.merchants > 0 && `, 가맹점 사전 ${preview.merchants}건`}
          {preview.transactions === 0 && ' (옮길 기록이 없어도 수입원만 중지됩니다)'}
        </p>
      )}
      <div className="actions">
        <button className="primary" onClick={() => void run()} disabled={busy || !target}>
          합치기
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          취소
        </button>
      </div>
    </Sheet>
  )
}
