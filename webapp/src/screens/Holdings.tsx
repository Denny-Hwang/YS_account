import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Card, Empty, Field, Notice, Sheet } from '../components/Ui'
import {
  TABS,
  appendTo,
  configNumber,
  latestAssetsTotal,
  patchIn,
  type SheetRow,
  type Workbook,
} from '../lib/ledger'
import type { SheetsContext } from '../lib/sheets'

function nextId(rows: SheetRow[], prefix: string): string {
  let max = 0
  rows.forEach((row) => {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(row.id).trim())
    if (m) max = Math.max(max, Number(m[1]))
  })
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}

/** 부채 목록과 편집. */
export function Debts({
  workbook,
  ctx,
  onChanged,
}: {
  workbook: Workbook
  ctx: SheetsContext
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<SheetRow | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fx = configNumber(workbook.config, 'fx_usd_krw', 1332)

  const toUsd = (row: SheetRow, key: string) => {
    const v = Number(row[key]) || 0
    return String(row.currency).trim().toUpperCase() === 'KRW' ? v / fx : v
  }
  const totalPrincipal = workbook.debts.reduce((acc, row) => acc + toUsd(row, 'principal'), 0)
  const totalMonthly = workbook.debts.reduce((acc, row) => acc + toUsd(row, 'monthly_payment'), 0)

  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      <Card
        title="부채"
        action={<button onClick={() => setEditing('new')}>추가</button>}
      >
        <div className="row">
          <span className="meta">남은 원금</span>
          <span>{formatUsd(Math.round(totalPrincipal * 100) / 100)}</span>
        </div>
        <div className="row">
          <span className="meta">월 상환 합계</span>
          <span>{formatUsd(Math.round(totalMonthly * 100) / 100)}</span>
        </div>
      </Card>

      {workbook.debts.length === 0 ? (
        <Empty>등록된 부채가 없습니다.</Empty>
      ) : (
        <Card>
          {workbook.debts.map((row) => (
            <div className="tx" key={String(row.id) || row._row} onClick={() => setEditing(row)}>
              <span className="grow ellipsis">
                {String(row.name)}
                <br />
                <span className="pill">
                  {String(row.rate_pct) || 0}% · 남은 {String(row.remaining_count) || 0}회
                </span>
              </span>
              <span className="amount">
                {formatUsd(Math.round(toUsd(row, 'principal') * 100) / 100)}
              </span>
            </div>
          ))}
        </Card>
      )}

      {editing && (
        <RowSheet
          title={editing === 'new' ? '부채 추가' : '부채 수정'}
          tab={TABS.debts}
          row={editing === 'new' ? null : editing}
          workbook={workbook}
          ctx={ctx}
          fields={[
            { key: 'name', label: '이름' },
            { key: 'principal', label: '남은 원금', numeric: true },
            { key: 'rate_pct', label: '연이율 (%)', numeric: true },
            { key: 'monthly_payment', label: '월 상환액', numeric: true },
            { key: 'remaining_count', label: '남은 회차', numeric: true },
            { key: 'currency', label: '통화', options: ['USD', 'KRW'] },
            { key: 'notes', label: '메모' },
          ]}
          defaults={{ id: nextId(workbook.debts, 'D'), currency: 'USD' }}
          onClose={() => setEditing(null)}
          onError={setError}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}

/** 자산 스냅샷. 같은 날짜로 계좌별 행을 넣는다. */
export function Assets({
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
  const [editing, setEditing] = useState<SheetRow | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = latestAssetsTotal(workbook)
  const rows = workbook.assets
    .filter((row) => String(row.snapshot_date).slice(0, 10) === latest.date)
    .sort((a, b) => String(a.account).localeCompare(String(b.account)))

  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      <Card title="자산" action={<button onClick={() => setEditing('new')}>추가</button>}>
        <p className="hero">{formatUsd(latest.total)}</p>
        <p className="meta">{latest.date ? `${latest.date} 스냅샷` : '기록 없음'}</p>
      </Card>

      {rows.length === 0 ? (
        <Empty>자산 스냅샷이 없습니다. 같은 날짜로 계좌별 잔액을 넣으세요.</Empty>
      ) : (
        <Card>
          {rows.map((row) => (
            <div className="tx" key={row._row} onClick={() => setEditing(row)}>
              <span className="grow ellipsis">{String(row.account)}</span>
              <span className="amount">
                {Number(row.balance).toLocaleString()} {String(row.currency)}
              </span>
            </div>
          ))}
        </Card>
      )}

      {editing && (
        <RowSheet
          title={editing === 'new' ? '자산 추가' : '자산 수정'}
          tab={TABS.assets}
          row={editing === 'new' ? null : editing}
          workbook={workbook}
          ctx={ctx}
          fields={[
            { key: 'snapshot_date', label: '기준일', type: 'date' },
            { key: 'account', label: '계좌' },
            { key: 'balance', label: '잔액', numeric: true },
            { key: 'currency', label: '통화', options: ['USD', 'KRW'] },
          ]}
          defaults={{ snapshot_date: latest.date || today, currency: 'USD' }}
          onClose={() => setEditing(null)}
          onError={setError}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}

/** 목표와 진행률. 현재 자산 합계를 목표액과 견준다. */
export function Goals({
  workbook,
  ctx,
  onChanged,
}: {
  workbook: Workbook
  ctx: SheetsContext
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<SheetRow | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const assets = latestAssetsTotal(workbook)

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}
      <Card title="목표" action={<button onClick={() => setEditing('new')}>추가</button>}>
        <p className="meta">
          진행률은 {assets.date || '기록 없음'} 기준 자산 합계 {formatUsd(assets.total)} 로 계산합니다.
        </p>
      </Card>

      {workbook.goals.length === 0 ? (
        <Empty>등록된 목표가 없습니다.</Empty>
      ) : (
        <Card>
          <div className="rank">
            {workbook.goals.map((row) => {
              const target = Number(row.target_amount) || 0
              const share = target > 0 ? Math.min(assets.total / target, 1) : 0
              return (
                <div className="item" key={String(row.id) || row._row} onClick={() => setEditing(row)}>
                  <div className="row">
                    <span className="ellipsis">
                      {String(row.title)} <span className="pill">{String(row.horizon)}</span>
                    </span>
                    <span className="meta">
                      {formatUsd(target)} · {(share * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="track">
                    <span style={{ width: `${Math.max(share * 100, 1)}%` }} />
                  </div>
                  {String(row.deadline) && <p className="meta">목표일 {String(row.deadline)}</p>}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {editing && (
        <RowSheet
          title={editing === 'new' ? '목표 추가' : '목표 수정'}
          tab={TABS.goals}
          row={editing === 'new' ? null : editing}
          workbook={workbook}
          ctx={ctx}
          fields={[
            { key: 'title', label: '목표' },
            { key: 'horizon', label: '기간', options: ['short', 'mid', 'long'] },
            { key: 'target_amount', label: '목표 금액 (USD)', numeric: true },
            { key: 'deadline', label: '목표일', type: 'date' },
            { key: 'notes', label: '메모' },
          ]}
          defaults={{ id: nextId(workbook.goals, 'G'), horizon: 'mid' }}
          onClose={() => setEditing(null)}
          onError={setError}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

interface FieldSpec {
  key: string
  label: string
  numeric?: boolean
  type?: 'date'
  options?: string[]
}

/** 탭 하나의 행을 추가하거나 고치는 공용 시트. */
function RowSheet({
  title,
  tab,
  row,
  workbook,
  ctx,
  fields,
  defaults,
  onClose,
  onSaved,
  onError,
}: {
  title: string
  tab: string
  row: SheetRow | null
  workbook: Workbook
  ctx: SheetsContext
  fields: FieldSpec[]
  defaults: Record<string, string>
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = { ...defaults }
    fields.forEach((f) => {
      initial[f.key] = row ? String(row[f.key] ?? '') : (defaults[f.key] ?? '')
    })
    return initial
  })
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {}
      fields.forEach((f) => {
        payload[f.key] = f.numeric ? (form[f.key] === '' ? '' : Number(form[f.key])) : form[f.key]
      })
      if (row) {
        await patchIn(ctx, workbook, tab, row, payload)
      } else {
        await appendTo(ctx, workbook, tab, { ...defaults, ...payload })
      }
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      {fields.map((f) => (
        <Field label={f.label} key={f.key}>
          {f.options ? (
            <select value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type === 'date' ? 'date' : 'text'}
              inputMode={f.numeric ? 'decimal' : undefined}
              value={form[f.key]}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
            />
          )}
        </Field>
      ))}
      <div className="actions">
        <button className="primary" onClick={() => void save()} disabled={busy}>
          저장
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          취소
        </button>
      </div>
    </Sheet>
  )
}
