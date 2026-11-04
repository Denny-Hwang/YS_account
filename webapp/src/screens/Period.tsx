import { useMemo, useState } from 'react'
import { daysInMonth, formatUsd } from '@shared/Budget.js'
import { periodReport } from '@shared/LedgerRules.js'
import { MonthlyBars, RankBars, Stat } from '../components/Charts'
import { Card, Empty, Field, Notice } from '../components/Ui'
import { patchTransaction, recurringTypeOf, shiftMonth, type SheetRow, type Workbook } from '../lib/ledger'
import type { SheetsContext } from '../lib/sheets'
import { TransactionEditSheet } from './LedgerScreen'

type Preset = 'month' | '3m' | 'year' | 'all' | 'custom'
type Kind = 'income' | 'expense'

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'month', label: '이번 달' },
  { id: '3m', label: '3개월' },
  { id: 'year', label: '올해' },
  { id: 'all', label: '전체' },
  { id: 'custom', label: '직접' },
]

/** 한 번에 보여 주는 거래 줄 수. "더 보기" 로 늘린다. */
const PAGE = 50

const lastDay = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`

/** 프리셋이 가리키는 기간. 전체는 원장의 첫 기록부터 오늘(또는 가장 늦은 기록)까지. */
function rangeOf(preset: Exclude<Preset, 'custom'>, today: string, workbook: Workbook): { from: string; to: string } {
  const month = today.slice(0, 7)
  if (preset === 'month') return { from: `${month}-01`, to: lastDay(month) }
  if (preset === '3m') return { from: `${shiftMonth(month, -2)}-01`, to: lastDay(month) }
  if (preset === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }
  const dates = workbook.transactions.map((t) => String(t.date).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  const first = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today
  const last = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : today
  return { from: first, to: last > today ? last : today }
}

/**
 * 기간 화면. 고정 수입원이 아니라 원장 전체에서 기간을 골라 실제 수입·지출을 본다.
 * 실제로 일어난 기록(기록됨·확정)만 센다. 예정·선반영은 빼고 건수만 알려 준다.
 * 수입은 수입원별(안 묶이면 기타), 지출은 카테고리별. 묶음을 누르면 아래 거래 목록이 그것만 보인다.
 */
export function Period({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const [preset, setPreset] = useState<Preset>('3m')
  const [custom, setCustom] = useState(() => ({ from: `${today.slice(0, 7)}-01`, to: today }))
  const [kind, setKind] = useState<Kind>('expense')
  const [focus, setFocus] = useState<{ kind: Kind; name: string } | null>(null)
  const [listType, setListType] = useState<'all' | Kind>('all')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [editing, setEditing] = useState<SheetRow | null>(null)
  const [undo, setUndo] = useState<{ row: SheetRow; previousStatus: string; label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const range = preset === 'custom' ? custom : rangeOf(preset, today, workbook)
  const rangeOk = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to

  // 중지된 수입원도 넣는다. 합치거나 멈춘 수입원의 옛 기록이 기타로 빠지지 않게.
  const sources = useMemo(() => workbook.recurring.filter((r) => recurringTypeOf(r) === 'income'), [workbook])
  const report = useMemo(
    () => periodReport(workbook.transactions, sources, range.from, range.to, today.slice(0, 7)),
    [workbook, sources, range.from, range.to, today]
  )

  function choose(next: Preset) {
    if (next === 'custom' && preset !== 'custom') setCustom(range)
    setPreset(next)
    setFocus(null)
    setShown(PAGE)
  }

  /** 막대의 달을 누르면 그 달로 좁힌다. */
  function narrowTo(month: string) {
    setCustom({ from: `${month}-01`, to: lastDay(month) })
    setPreset('custom')
    setFocus(null)
    setShown(PAGE)
  }

  function toggleFocus(k: Kind, name: string) {
    setFocus((f) => (f && f.kind === k && f.name === name ? null : { kind: k, name }))
    setListType(k)
    setShown(PAGE)
  }

  const groups = kind === 'income' ? report.incomeGroups : report.expenseGroups
  const groupTotal = kind === 'income' ? report.income : report.expense
  const elapsed = report.elapsedMonths
  const thin = report.months.length > 12 ? Math.ceil(report.months.length / 8) : 1

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    return report.items.filter((it) => {
      if (listType !== 'all' && it.type !== listType) return false
      if (focus && (it.type !== focus.kind || it.group !== focus.name)) return false
      if (!q) return true
      const row = workbook.transactions[it.index]
      const text = `${String(row.merchant ?? '')} ${String(row.category ?? '')} ${String(row.memo ?? '')} ${it.group}`.toLowerCase()
      return text.includes(q)
    })
  }, [report.items, listType, focus, q, workbook])

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
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button key={p.id} className={preset === p.id ? 'primary' : 'ghost'} style={{ padding: '4px 12px' }} onClick={() => choose(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div style={{ marginTop: 10 }}>
            <Field label="시작일">
              <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </Field>
            <Field label="끝일">
              <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </Field>
          </div>
        )}
        <p className="meta" style={{ marginTop: 10, marginBottom: 0 }}>
          {rangeOk ? `${range.from} ~ ${range.to} · ${report.months.length}개월` : '시작일이 끝일보다 늦거나 날짜가 비었습니다.'}
        </p>
      </Card>

      {!rangeOk ? (
        <Empty>기간을 다시 고르세요.</Empty>
      ) : (
        <>
          <Card>
            <div className="stat-row">
              <Stat label="수입" value={formatUsd(report.income)} size="md" tone="good" />
              <Stat label="지출" value={formatUsd(report.expense)} size="md" />
              <Stat label="순저축" value={formatUsd(report.net)} size="md" tone={report.net < 0 ? 'bad' : 'good'} sub={report.income > 0 ? `저축률 ${Math.round((report.net / report.income) * 100)}%` : undefined} />
              {elapsed > 1 && <Stat label={`월평균 수입 (${elapsed}개월)`} value={formatUsd(report.income / elapsed)} size="md" />}
              {elapsed > 1 && <Stat label={`월평균 지출 (${elapsed}개월)`} value={formatUsd(report.expense / elapsed)} size="md" />}
            </div>
            {report.pending.count > 0 && (
              <p className="meta" style={{ marginTop: 10, marginBottom: 0 }}>
                예정·선반영 {report.pending.count}건(수입 {formatUsd(report.pending.income)}, 지출 {formatUsd(report.pending.expense)})은 아직 들어오거나 나가지 않아 뺐습니다.
              </p>
            )}
          </Card>

          {report.months.length > 1 && (
            <Card title="월별 수입과 지출">
              <MonthlyBars
                months={report.months}
                axisEvery={thin}
                onSelect={narrowTo}
                series={[
                  { label: '수입', values: report.monthly.map((m) => m.income), tone: 'income' },
                  { label: '지출', values: report.monthly.map((m) => m.expense), tone: 'expense' },
                ]}
              />
              <p className="meta" style={{ marginTop: 8, marginBottom: 0 }}>막대를 누르면 그 달만 봅니다.</p>
            </Card>
          )}

          <Card
            title={kind === 'income' ? '수입원별' : '카테고리별'}
            action={
              <span className="row" style={{ gap: 6 }}>
                <button className={kind === 'income' ? 'primary' : 'ghost'} style={{ padding: '4px 12px' }} onClick={() => setKind('income')}>
                  수입
                </button>
                <button className={kind === 'expense' ? 'primary' : 'ghost'} style={{ padding: '4px 12px' }} onClick={() => setKind('expense')}>
                  지출
                </button>
              </span>
            }
          >
            {groups.length === 0 ? (
              <Empty>이 기간에 {kind === 'income' ? '들어온 수입' : '쓴 지출'} 기록이 없습니다.</Empty>
            ) : (
              <>
                <RankBars
                  tone={kind === 'income' ? 'income' : 'expense'}
                  items={groups.map((g) => ({ name: g.name, value: g.value, hint: `${g.count}건${focus && focus.kind === kind && focus.name === g.name ? ' · 아래 목록에서 이것만 보는 중' : ''}` }))}
                  onSelect={(name) => toggleFocus(kind, name)}
                />
                <p className="meta" style={{ marginTop: 10, marginBottom: 0 }}>
                  합계 {formatUsd(groupTotal)} · 항목을 누르면 아래 목록이 그것만 보입니다.
                  {kind === 'income' && ' 수입원에 묶이지 않은 수입은 기타입니다.'}
                </p>
              </>
            )}
          </Card>

          <Card title="거래 목록">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {([['all', '전체'], ['income', '수입'], ['expense', '지출']] as const).map(([id, label]) => (
                <button key={id} className={listType === id ? 'primary' : 'ghost'} style={{ padding: '4px 12px' }} onClick={() => { setListType(id); setShown(PAGE) }}>
                  {label}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }}
              placeholder="가맹점·카테고리·메모 검색"
              autoComplete="off"
              style={{ marginBottom: 10 }}
            />
            {focus && (
              <p className="row" style={{ gap: 8, margin: '0 0 10px' }}>
                <span className="pill">{focus.kind === 'income' ? '수입' : '지출'} · {focus.name}</span>
                <button className="ghost" style={{ padding: '2px 10px' }} onClick={() => setFocus(null)}>
                  해제
                </button>
              </p>
            )}
            {visible.length === 0 ? (
              <Empty>조건에 맞는 기록이 없습니다.</Empty>
            ) : (
              <>
                {visible.slice(0, shown).map((it) => {
                  const row = workbook.transactions[it.index]
                  const income = it.type === 'income'
                  return (
                    <div
                      className="tx"
                      key={String(row.id) || row._row}
                      role="button"
                      tabIndex={0}
                      onClick={() => setEditing(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setEditing(row)
                      }}
                    >
                      <span className="date" style={{ whiteSpace: 'nowrap', marginRight: 10 }}>{it.date.slice(2)}</span>
                      <span className="grow ellipsis">
                        {String(row.merchant ?? '').trim() || it.group}
                        <br />
                        <span className="meta">
                          {it.group}
                          {String(row.memo ?? '').trim() && ` · ${String(row.memo)}`}
                        </span>
                      </span>
                      <span className={`amount${income ? ' income' : ''}`}>
                        {income ? '+' : '-'}
                        {formatUsd(Math.abs(it.amount))}
                      </span>
                    </div>
                  )
                })}
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="meta">
                    {visible.length}건 중 {Math.min(shown, visible.length)}건 · 항목을 누르면 고칠 수 있습니다
                  </span>
                  {visible.length > shown && (
                    <button className="ghost" style={{ padding: '4px 12px' }} onClick={() => setShown((n) => n + PAGE)}>
                      더 보기
                    </button>
                  )}
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {editing && (
        <TransactionEditSheet
          row={editing}
          workbook={workbook}
          ctx={ctx}
          onClose={() => setEditing(null)}
          onError={setError}
          onDeleted={(row, previousStatus) =>
            setUndo({ row, previousStatus, label: `${String(row.merchant) || '(이름 없음)'} ${formatUsd(Number(row.amount_usd) || 0)}` })
          }
          onChanged={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
