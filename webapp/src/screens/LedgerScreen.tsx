import { useMemo, useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { initialRecurringStatus } from '@shared/LedgerRules.js'
import { MonthCalendar, MonthSummary } from '../components/Calendar'
import { Card, Empty, Field, Notice, Sheet } from '../components/Ui'
import {
  availableMonths,
  categoryFields,
  categoryOptions,
  categoryOf,
  monthTransactions,
  patchTransaction,
  softDeleteTransaction,
  statusBadge,
  type SheetRow,
  type Workbook,
} from '../lib/ledger'
import type { SheetsContext } from '../lib/sheets'

const VIEW_KEY = 'family-budget.ledger-view.v1'

/**
 * 지운 행을 되살릴 때 돌려놓을 상태.
 * 지운 직후라면 화면이 원래 상태를 기억하고 있어 그대로 쓰지만, 한참 뒤에 되살리는 경우는
 * 기억이 없다. 고정 항목이면 그 정의의 예약 상태로, 그 밖에는 보통 기록(active)으로 돌린다.
 * confirmed 였는지까지는 알 수 없으므로 실제 금액은 다시 확정해야 한다.
 */
function restoreStatusOf(workbook: Workbook, row: SheetRow): string {
  const id = String(row.recurring_id ?? '').trim()
  if (!id) return 'active'
  const def = workbook.recurring.find((r) => String(r.id).trim() === id)
  return def ? initialRecurringStatus(def as Record<string, unknown>) : 'active'
}

/** 세부예산 목록의 "직접 입력" 항목 값. 실제 이름과 겹치지 않게 둔다. */
const NEW_CATEGORY = '\u0000new'

/** 마지막으로 고른 보기 방식. 저장이 막혀 있어도(프라이빗 모드) 목록으로 연다. */
function readView(): 'list' | 'calendar' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'
  } catch {
    return 'list'
  }
}

const TYPES = ['expense', 'income', 'transfer']
const KINDS = ['variable', 'fixed']

export function LedgerScreen({
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
  const [view, setView] = useState<'list' | 'calendar'>(() => readView())
  const [day, setDay] = useState<string | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [editing, setEditing] = useState<SheetRow | null>(null)
  const [undo, setUndo] = useState<{ row: SheetRow; previousStatus: string; label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const monthRows = useMemo(() => monthTransactions(workbook, month), [workbook, month])

  const rows = useMemo(() => {
    const visible = showDeleted ? monthRows : monthRows.filter((r) => String(r.status) !== 'deleted')
    const picked = day ? visible.filter((r) => String(r.date).slice(0, 10) === day) : visible
    return picked.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b._row - a._row)
  }, [monthRows, showDeleted, day])

  function switchView(next: 'list' | 'calendar') {
    setView(next)
    if (next === 'list') setDay(null)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // 사파리 프라이빗 모드 등. 보기 방식은 못 기억해도 화면은 돌아간다
    }
  }

  return (
    <>
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
        <div className="row controls">
          <select value={month} onChange={(e) => { setMonth(e.target.value); setDay(null) }} style={{ maxWidth: 130 }}>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="seg" role="group" aria-label="보기 방식">
            <button
              type="button"
              className={view === 'list' ? 'on' : undefined}
              aria-pressed={view === 'list'}
              onClick={() => switchView('list')}
            >
              목록
            </button>
            <button
              type="button"
              className={view === 'calendar' ? 'on' : undefined}
              aria-pressed={view === 'calendar'}
              onClick={() => switchView('calendar')}
            >
              달력
            </button>
          </div>
          <label className="meta" style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
              style={{ width: 'auto' }}
            />
            삭제 포함
          </label>
        </div>
        <MonthSummary rows={monthRows} month={month} />
      </Card>

      {view === 'calendar' && (
        <Card>
          <MonthCalendar month={month} rows={monthRows} today={today} selected={day} onSelect={setDay} />
        </Card>
      )}

      <Card title={day ? `${day} · ${rows.length}건` : `${rows.length}건`}>
        {rows.length === 0 ? (
          <Empty>{day ? '이 날짜에 기록이 없습니다.' : '이 달에 기록이 없습니다.'}</Empty>
        ) : (
          rows.map((row) => {
            const deleted = String(row.status) === 'deleted'
            const income = String(row.type) === 'income'
            const badge = statusBadge(row)
            return (
              <div
                className={`tx${deleted ? ' deleted' : ''}`}
                key={String(row.id) || row._row}
                onClick={() => setEditing(row)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setEditing(row)
                }}
              >
                <span className="date">{String(row.date).slice(5)}</span>
                <span className="grow ellipsis">
                  {String(row.merchant) || '(이름 없음)'}
                  <br />
                  <span className="pill">{categoryOf(row) || String(row.kind)}</span>
                  {badge && <span className={`pill pill-${badge.tone}`}>{badge.label}</span>}
                </span>
                <span className={`amount${income ? ' income' : ''}${badge && badge.tone !== 'deleted' ? ' pending' : ''}`}>
                  {income ? '+' : ''}
                  {formatUsd(Number(row.amount_usd) || 0)}
                </span>
              </div>
            )
          })
        )}
      </Card>

      {editing && (
        <TransactionEditSheet
          row={editing}
          workbook={workbook}
          ctx={ctx}
          onClose={() => setEditing(null)}
          onError={setError}
          onDeleted={(row, previousStatus) =>
            setUndo({
              row,
              previousStatus,
              label: `${String(row.merchant) || '(이름 없음)'} ${formatUsd(Number(row.amount_usd) || 0)}`,
            })
          }
          onChanged={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}

/** 원장 한 행을 고치는 시트. 원장 탭과 수입 탭이 같이 쓴다. */
export function TransactionEditSheet({
  row,
  workbook,
  ctx,
  onClose,
  onChanged,
  onError,
  onDeleted,
}: {
  row: SheetRow
  workbook: Workbook
  ctx: SheetsContext
  onClose: () => void
  onChanged: () => void
  onError: (m: string) => void
  onDeleted: (row: SheetRow, previousStatus: string) => void
}) {
  const options = categoryOptions(workbook)
  // 시트의 envelope 과 category 를 화면에서는 한 칸으로 다룬다. envelope 이 있으면 그것이 세부예산이다.
  const current = String(row.envelope ?? '').trim() || String(row.category ?? '').trim()
  const known = options.some((o) => o.name === current)
  const [freeform, setFreeform] = useState(current !== '' && !known)
  const [form, setForm] = useState({
    date: String(row.date).slice(0, 10),
    merchant: String(row.merchant ?? ''),
    amount: String(row.amount ?? ''),
    currency: String(row.currency || 'USD'),
    type: String(row.type || 'expense'),
    kind: String(row.kind || 'variable'),
    category: current,
    memo: String(row.memo ?? ''),
  })
  const [busy, setBusy] = useState(false)
  const deleted = String(row.status) === 'deleted'

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const fx = Number(workbook.config.fx_usd_krw) || 1332

  async function save() {
    setBusy(true)
    try {
      const amount = Number(form.amount)
      if (!Number.isFinite(amount)) throw new Error('금액이 숫자가 아닙니다.')
      const amountUsd =
        form.currency === 'KRW' ? Math.round((amount / fx) * 100) / 100 : Math.round(amount * 100) / 100
      await patchTransaction(ctx, workbook, row, {
        ...form,
        ...categoryFields(workbook, form.category), // category 와 envelope 을 함께 채운다
        amount,
        amount_usd: amountUsd,
        updated_by: 'web',
      })
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function toggleDelete() {
    setBusy(true)
    try {
      if (deleted) {
        await patchTransaction(ctx, workbook, row, { status: restoreStatusOf(workbook, row), updated_by: 'web' })
      } else {
        const before = String(row.status).trim() || 'active'
        await softDeleteTransaction(ctx, workbook, row, 'web')
        // 지운 직후 되돌릴 수 있게 원래 상태를 위로 넘긴다. 실수로 지웠을 때 한 번에 복구된다.
        onDeleted(row, before)
      }
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="항목 수정" onClose={onClose}>
      <Field label="날짜">
        <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
      </Field>
      <Field label="가맹점">
        <input value={form.merchant} onChange={(e) => set('merchant', e.target.value)} />
      </Field>
      <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
        <div className="grow">
          <label>금액</label>
          <input
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
          />
        </div>
        <div style={{ width: 110 }}>
          <label>통화</label>
          <select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
            <option value="USD">USD</option>
            <option value="KRW">KRW</option>
          </select>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="grow">
          <label>유형</label>
          <select value={form.type} onChange={(e) => set('type', e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="grow">
          <label>구분</label>
          <select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Field label="세부예산">
        {freeform ? (
          <div className="row">
            <input
              className="grow"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="새 세부예산 이름"
            />
            <button className="ghost" type="button" onClick={() => setFreeform(false)}>
              목록에서
            </button>
          </div>
        ) : (
          <select
            value={form.category}
            onChange={(e) => {
              if (e.target.value === NEW_CATEGORY) {
                set('category', '')
                setFreeform(true)
                return
              }
              set('category', e.target.value)
            }}
          >
            <option value="">(없음)</option>
            <optgroup label="유동비 세부예산">
              {options.filter((o) => o.budgeted).map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name}
                </option>
              ))}
            </optgroup>
            {options.some((o) => !o.budgeted) && (
              <optgroup label="그 밖의 분류">
                {options.filter((o) => !o.budgeted).map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={NEW_CATEGORY}>+ 직접 입력</option>
          </select>
        )}
      </Field>
      <p className="meta" style={{ margin: '4px 0 0' }}>
        유동비 세부예산만 하루치·신호등 계산에 들어갑니다. 그 밖의 분류는 기록만 남습니다.
      </p>
      <Field label="메모">
        <input value={form.memo} onChange={(e) => set('memo', e.target.value)} />
      </Field>

      <div className="actions">
        <button className="primary" onClick={save} disabled={busy}>
          저장
        </button>
        <button className={deleted ? 'ghost' : 'danger'} onClick={toggleDelete} disabled={busy}>
          {deleted ? '되살리기' : '삭제'}
        </button>
      </div>
      <p className="meta" style={{ marginTop: 10 }}>
        삭제는 행을 지우지 않고 status 를 deleted 로 바꿉니다.
      </p>
    </Sheet>
  )
}
