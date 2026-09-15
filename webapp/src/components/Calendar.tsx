/**
 * Calendar.tsx — 원장을 달력으로 보는 뷰.
 * 한 칸에 그날의 수입·지출을 넣어 "어느 날 무슨 일이 있었는지" 를 한눈에 본다.
 * 집행된 것과 아직 집행 전인 것(예정·선반영)은 색과 표기를 다르게 한다.
 */

import { daysInMonth, formatUsd } from '@shared/Budget.js'
import { isCounted, isSettled, type SheetRow } from '../lib/ledger'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export interface DayBucket {
  /** 'YYYY-MM-DD' */
  date: string
  /** 실제 들어온 수입 */
  income: number
  /** 들어올 예정인 수입. 실제로 받기 전까지 예산에 넣지 않는다 */
  expectedIncome: number
  /** 실제 나간 지출 */
  expense: number
  /** 아직 집행 전이지만 예산에서 이미 뺀 지출(committed) */
  committed: number
  /** 금액이 정해지지 않은 예정(expected). 예산에 넣지 않는다 */
  expected: number
  count: number
}

/** 좁은 칸에 들어가도록 줄인 금액. 1,234 → 1.2k */
export function compactUsd(n: number): string {
  const v = Math.abs(Number(n) || 0)
  if (v === 0) return '0'
  if (v < 1000) return String(Math.round(v))
  return `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}k`
}

/** 그 달 원장 행을 날짜별로 모은다. 삭제 행은 세지 않는다. */
export function bucketByDay(rows: SheetRow[], month: string): Record<string, DayBucket> {
  const out: Record<string, DayBucket> = {}
  rows.forEach((row) => {
    const date = String(row.date).slice(0, 10)
    if (date.slice(0, 7) !== month) return
    const status = String(row.status).trim()
    if (status === 'deleted') return
    const bucket =
      out[date] ??
      (out[date] = { date, income: 0, expectedIncome: 0, expense: 0, committed: 0, expected: 0, count: 0 })
    bucket.count++
    const usd = Number(row.amount_usd) || 0
    const type = String(row.type).trim()
    if (type === 'income') {
      if (isSettled(row)) bucket.income += usd
      else bucket.expectedIncome += usd
      return
    }
    if (type !== 'expense') return // transfer(저축)는 수입도 지출도 아니다
    if (isSettled(row)) bucket.expense += usd
    else if (isCounted(row)) bucket.committed += usd
    else bucket.expected += usd
  })
  return out
}

/** 달력 격자에 쓸 주 단위 날짜 배열. 빈 칸은 null. */
export function monthGrid(month: string): Array<Array<string | null>> {
  const total = daysInMonth(month)
  if (!total) return []
  const [y, m] = month.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const cells: Array<string | null> = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= total; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: Array<Array<string | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export function MonthCalendar({
  month,
  rows,
  today,
  selected,
  onSelect,
}: {
  month: string
  rows: SheetRow[]
  today: string
  selected: string | null
  onSelect: (date: string | null) => void
}) {
  const buckets = bucketByDay(rows, month)
  const weeks = monthGrid(month)

  return (
    <div className="cal">
      <div className="cal-head">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={i === 0 ? 'sun' : undefined}>
            {w}
          </span>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div className="cal-week" key={wi}>
          {week.map((date, di) => {
            if (!date) return <div className="cal-day empty" key={di} />
            const b = buckets[date]
            const classes = ['cal-day']
            if (date === today) classes.push('today')
            if (date === selected) classes.push('selected')
            if (!b) classes.push('quiet')
            return (
              <button
                type="button"
                className={classes.join(' ')}
                key={di}
                aria-label={`${date} ${b ? `${b.count}건` : '기록 없음'}`}
                aria-pressed={date === selected}
                onClick={() => onSelect(date === selected ? null : date)}
              >
                <span className={`cal-num${di === 0 ? ' sun' : ''}`}>
                  {Number(date.slice(8, 10))}
                </span>
                {b && b.income > 0 && <span className="cal-in">+{compactUsd(b.income)}</span>}
                {b && b.expectedIncome > 0 && (
                  <span className="cal-in-expected" title="수입 예정">
                    +{compactUsd(b.expectedIncome)}
                  </span>
                )}
                {b && b.expense > 0 && <span className="cal-out">{compactUsd(b.expense)}</span>}
                {b && b.committed > 0 && (
                  <span className="cal-committed" title="금액 확정 · 예산 선반영">
                    {compactUsd(b.committed)}
                  </span>
                )}
                {b && b.expected > 0 && (
                  <span className="cal-expected" title="예정 · 금액 미정">
                    {compactUsd(b.expected)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
      <div className="cal-legend">
        <span className="cal-in">+수입</span>
        <span className="cal-out">지출</span>
        <span className="cal-committed">선반영</span>
        <span className="cal-expected">예정</span>
      </div>
      {selected && (
        <p className="meta" style={{ marginBottom: 0 }}>
          {selected} 선택됨 · 아래 목록이 이 날짜만 보여 줍니다.{' '}
          <button className="ghost" style={{ padding: '2px 8px' }} onClick={() => onSelect(null)}>
            전체 보기
          </button>
        </p>
      )}
    </div>
  )
}

/** 달력 위에 얹는 그 달 요약. 집행과 예정을 나눠서 보여 준다. */
export function MonthSummary({ rows, month }: { rows: SheetRow[]; month: string }) {
  const buckets = Object.values(bucketByDay(rows, month))
  const sum = buckets.reduce(
    (acc, b) => ({
      income: acc.income + b.income,
      expectedIncome: acc.expectedIncome + b.expectedIncome,
      expense: acc.expense + b.expense,
      committed: acc.committed + b.committed,
      expected: acc.expected + b.expected,
    }),
    { income: 0, expectedIncome: 0, expense: 0, committed: 0, expected: 0 }
  )
  // 예산에 반영된 지출 = 집행 + 선반영. 예정은 금액이 정해지지 않아 아직 넣지 않는다.
  const counted = sum.expense + sum.committed
  return (
    <>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="meta">수입 {formatUsd(sum.income)}</span>
        <span className="meta">지출 {formatUsd(counted)}</span>
        <span>순 {formatUsd(sum.income - counted)}</span>
      </div>
      <p className="meta" style={{ margin: '6px 0 0' }}>
        지출에는 아직 안 나갔지만 금액이 정해진 고정비 {formatUsd(sum.committed)} 가 이미 들어 있습니다.
        {(sum.expected > 0 || sum.expectedIncome > 0) &&
          ` 금액이 정해지지 않은 예정(지출 ${formatUsd(sum.expected)} · 수입 ${formatUsd(
            sum.expectedIncome
          )})은 실제로 오갈 때 셉니다.`}
      </p>
    </>
  )
}
