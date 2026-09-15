import { useMemo, useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { MonthCalendar, MonthSummary } from '../components/Calendar'
import { Card, Empty, Field, Notice, Sheet } from '../components/Ui'
import {
  availableMonths,
  configList,
  monthTransactions,
  patchTransaction,
  softDeleteTransaction,
  statusBadge,
  type SheetRow,
  type Workbook,
} from '../lib/ledger'
import type { SheetsContext } from '../lib/sheets'

const VIEW_KEY = 'family-budget.ledger-view.v1'

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
  const [error, setError] = useState<string | null>(null)

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
                  <span className="pill">{String(row.envelope || row.category || row.kind)}</span>
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
        <EditSheet
          row={editing}
          workbook={workbook}
          ctx={ctx}
          onClose={() => setEditing(null)}
          onError={setError}
          onChanged={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}

function EditSheet({
  row,
  workbook,
  ctx,
  onClose,
  onChanged,
  onError,
}: {
  row: SheetRow
  workbook: Workbook
  ctx: SheetsContext
  onClose: () => void
  onChanged: () => void
  onError: (m: string) => void
}) {
  const envelopes = configList(workbook.config, 'envelopes')
  const [form, setForm] = useState({
    date: String(row.date).slice(0, 10),
    merchant: String(row.merchant ?? ''),
    amount: String(row.amount ?? ''),
    currency: String(row.currency || 'USD'),
    type: String(row.type || 'expense'),
    kind: String(row.kind || 'variable'),
    category: String(row.category ?? ''),
    envelope: String(row.envelope ?? ''),
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
        await patchTransaction(ctx, workbook, row, { status: 'active', updated_by: 'web' })
      } else {
        await softDeleteTransaction(ctx, workbook, row, 'web')
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
      <Field label="봉투">
        <select value={form.envelope} onChange={(e) => set('envelope', e.target.value)}>
          <option value="">(없음)</option>
          {envelopes.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
      </Field>
      <Field label="카테고리">
        <input value={form.category} onChange={(e) => set('category', e.target.value)} />
      </Field>
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
