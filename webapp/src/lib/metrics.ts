/**
 * 화면이 쓰는 집계. 전부 순수 함수다. 시트 접근이 없다.
 * "실제" 는 status 가 active 또는 confirmed 인 행만 센다. expected 는 예정이고 deleted 는 없는 것이다.
 */
import { daysInMonth } from '@shared/Budget.js'
import { budgetAmount, configList, configNumber, isCounted, monthsBack, recurringTypeOf, type SheetRow, type Workbook } from './ledger'

const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (row: SheetRow) => Number(row.amount_usd) || 0
const monthOf = (row: SheetRow) => String(row.date).slice(0, 7)
const dayOf = (row: SheetRow) => String(row.date).slice(0, 10)

export interface MonthTotals {
  month: string
  income: number
  expense: number
  fixed: number
  variable: number
  net: number
}

/** 월별 수입·지출·고정·유동·순저축. */
export function monthlyTotals(wb: Workbook, months: string[]): MonthTotals[] {
  const map = new Map<string, MonthTotals>()
  months.forEach((m) => map.set(m, { month: m, income: 0, expense: 0, fixed: 0, variable: 0, net: 0 }))
  wb.transactions.forEach((row) => {
    if (!isCounted(row)) return
    const b = map.get(monthOf(row))
    if (!b) return
    const v = usd(row)
    if (String(row.type) === 'income') b.income += v
    else if (String(row.type) === 'expense') {
      b.expense += v
      if (String(row.kind) === 'fixed') b.fixed += v
      else b.variable += v
    }
  })
  return months.map((m) => {
    const b = map.get(m)!
    return { month: m, income: r2(b.income), expense: r2(b.expense), fixed: r2(b.fixed), variable: r2(b.variable), net: r2(b.income - b.expense) }
  })
}

/** 최근 N개월 평균 순저축. 기록이 전혀 없는 달은 뺀다. */
export function averageNet(totals: MonthTotals[]): number {
  const active = totals.filter((t) => t.income > 0 || t.expense > 0)
  if (!active.length) return 0
  return r2(active.reduce((a, t) => a + t.net, 0) / active.length)
}

/** 봉투 하나의 월별 유동비 지출. */
export function envelopeMonthly(wb: Workbook, months: string[], envelope: string): number[] {
  return months.map((m) =>
    r2(
      wb.transactions
        .filter((row) => isCounted(row) && monthOf(row) === m && String(row.envelope).trim() === envelope &&
          String(row.type) === 'expense' && String(row.kind) === 'variable')
        .reduce((a, row) => a + usd(row), 0)
    )
  )
}

/** 봉투별 이번 달 요약(예산·실행·잔액). */
export function envelopeSummary(wb: Workbook, month: string) {
  return configList(wb.config, 'envelopes').map((envelope) => {
    const budget = budgetAmount(wb, month, envelope)
    const spent = envelopeMonthly(wb, [month], envelope)[0]
    return { envelope, budget, spent, remaining: r2(budget - spent) }
  })
}

/**
 * 이번 달 누적 유동비: 실제(오늘까지) vs 계획(예산을 일수로 균등 배분).
 * 오늘 이후의 실제는 null 이라 선이 거기서 멈춘다.
 */
export function cumulativePace(wb: Workbook, month: string, today: string) {
  const dim = daysInMonth(month)
  const todayDay = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : dim
  const budget = configList(wb.config, 'envelopes').reduce((a, e) => a + budgetAmount(wb, month, e), 0)
  const daily = new Array<number>(dim).fill(0)
  wb.transactions.forEach((row) => {
    if (!isCounted(row) || monthOf(row) !== month) return
    if (String(row.type) !== 'expense' || String(row.kind) !== 'variable') return
    const d = Number(dayOf(row).slice(8, 10))
    if (d >= 1 && d <= dim) daily[d - 1] += usd(row)
  })
  let acc = 0
  const actual: Array<number | null> = daily.map((v, i) => {
    if (i + 1 > todayDay) return null
    acc += v
    return r2(acc)
  })
  const plan = daily.map((_, i) => r2((budget * (i + 1)) / dim))
  const labels = Array.from({ length: dim }, (_, i) => (i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : ''))
  return { days: dim, todayDay, budget, actual, plan, labels, daily: daily.map(r2) }
}

/** 최근 N일 일별 유동비. 오늘이 마지막. */
export function recentDaily(wb: Workbook, today: string, count: number) {
  const out: Array<{ day: string; value: number }> = []
  const [y, m, d] = today.split('-').map(Number)
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i))
    const key = dt.toISOString().slice(0, 10)
    const v = wb.transactions
      .filter((row) => isCounted(row) && dayOf(row) === key && String(row.type) === 'expense' && String(row.kind) === 'variable')
      .reduce((a, row) => a + usd(row), 0)
    out.push({ day: key, value: r2(v) })
  }
  return out
}

/** 카테고리별 지출과 전월 대비. */
export function categoryBreakdown(wb: Workbook, month: string) {
  const prev = monthsBack(month, 2)[0]
  const sum = (m: string) => {
    const acc = new Map<string, number>()
    wb.transactions.forEach((row) => {
      if (!isCounted(row) || monthOf(row) !== m || String(row.type) !== 'expense') return
      const k = String(row.category).trim() || '(분류 없음)'
      acc.set(k, (acc.get(k) ?? 0) + usd(row))
    })
    return acc
  }
  const cur = sum(month)
  const before = sum(prev)
  return Array.from(cur.entries())
    .map(([name, amount]) => ({ name, value: r2(amount), delta: r2(amount - (before.get(name) ?? 0)) }))
    .sort((a, b) => b.value - a.value)
}

/** 이번 달 가맹점 순위(유동비). */
export function topMerchants(wb: Workbook, month: string, limit: number) {
  const acc = new Map<string, { value: number; count: number }>()
  wb.transactions.forEach((row) => {
    if (!isCounted(row) || monthOf(row) !== month || String(row.type) !== 'expense' || String(row.kind) !== 'variable') return
    const k = String(row.merchant).trim() || '(이름 없음)'
    const cur = acc.get(k) ?? { value: 0, count: 0 }
    acc.set(k, { value: cur.value + usd(row), count: cur.count + 1 })
  })
  return Array.from(acc.entries())
    .map(([name, v]) => ({ name, value: r2(v.value), count: v.count }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

export interface RecurringActual {
  row: SheetRow
  id: string
  name: string
  kind: string
  category: string
  expectedUsd: number
  actualUsd: number
  status: string
}

function expectedUsdOf(wb: Workbook, row: SheetRow): number {
  const raw = Number(row.expected_amount) || 0
  const fx = configNumber(wb.config, 'fx_usd_krw', 1332)
  return String(row.currency).trim().toUpperCase() === 'KRW' ? r2(raw / fx) : raw
}

/**
 * Recurring 정의별 이번 달 실제.
 * fixed 는 recurring_id 로 묶인 행, variable 은 같은 category 의 기록을 합한다.
 */
export function recurringActuals(wb: Workbook, month: string, type: 'income' | 'expense'): RecurringActual[] {
  return wb.recurring
    .filter((row) => recurringTypeOf(row) === type)
    .map((row) => {
      const id = String(row.id).trim()
      const kind = String(row.kind || 'fixed').trim()
      const category = String(row.category).trim()
      let hits: SheetRow[]
      if (kind === 'fixed') {
        hits = wb.transactions.filter((t) => monthOf(t) === month && String(t.recurring_id).trim() === id && String(t.status) !== 'deleted')
      } else {
        hits = wb.transactions.filter((t) => isCounted(t) && monthOf(t) === month && String(t.type) === type && String(t.category).trim() === category)
      }
      const counted = hits.filter(isCounted)
      const actual = r2(counted.reduce((a, t) => a + usd(t), 0))
      const status = counted.length ? String(counted[counted.length - 1].status) : hits.length ? String(hits[hits.length - 1].status) : ''
      return { row, id, name: String(row.name) || id, kind, category, expectedUsd: expectedUsdOf(wb, row), actualUsd: actual, status }
    })
}

/** 수입 계획 요약. */
export function incomePlan(wb: Workbook, month: string) {
  const sources = recurringActuals(wb, month, 'income').filter((s) => String(s.row.active).trim().toUpperCase() !== 'N')
  const expectedTotal = r2(sources.reduce((a, s) => a + s.expectedUsd, 0))
  const actualTotal = r2(
    wb.transactions
      .filter((t) => isCounted(t) && monthOf(t) === month && String(t.type) === 'income')
      .reduce((a, t) => a + usd(t), 0)
  )
  return { sources, expectedTotal, actualTotal }
}

/** 부채 목록을 USD 로 맞추고 상환 종료 월을 계산한다. */
export function debtSchedule(wb: Workbook, today: string) {
  const fx = configNumber(wb.config, 'fx_usd_krw', 1332)
  const toUsd = (row: SheetRow, key: string) => {
    const v = Number(row[key]) || 0
    return String(row.currency).trim().toUpperCase() === 'KRW' ? r2(v / fx) : v
  }
  const [y, m] = today.split('-').map(Number)
  return wb.debts
    .map((row) => {
      const remaining = Number(row.remaining_count) || 0
      const end = new Date(Date.UTC(y, m - 1 + remaining, 1))
      return {
        row,
        id: String(row.id),
        name: String(row.name),
        principalUsd: toUsd(row, 'principal'),
        monthlyUsd: toUsd(row, 'monthly_payment'),
        remaining,
        rate: Number(row.rate_pct) || 0,
        payoff: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}`,
      }
    })
    .sort((a, b) => b.principalUsd - a.principalUsd)
}

/** 자산 스냅샷 날짜별 합계(USD). 오래된 순. */
export function assetsHistory(wb: Workbook) {
  const fx = configNumber(wb.config, 'fx_usd_krw', 1332)
  const acc = new Map<string, number>()
  wb.assets.forEach((row) => {
    const d = String(row.snapshot_date).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    const bal = Number(row.balance) || 0
    acc.set(d, (acc.get(d) ?? 0) + (String(row.currency).trim().toUpperCase() === 'KRW' ? bal / fx : bal))
  })
  return Array.from(acc.entries())
    .map(([date, total]) => ({ date, total: r2(total) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
