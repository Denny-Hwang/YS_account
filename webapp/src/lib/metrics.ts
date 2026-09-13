/**
 * 화면이 쓰는 집계. 전부 순수 함수다. 시트 접근이 없다.
 * "실제" 는 status 가 active 또는 confirmed 인 행만 센다. expected 는 예정이고 deleted 는 없는 것이다.
 */
import { daysInMonth } from '@shared/Budget.js'
import { biweeklyPaydays, expectedAmountFor, parseAmountRule, payoffMonths } from '@shared/LedgerRules.js'
import { assetUsd, budgetAmount, configList, configNumber, isCounted, latestAssetsTotal, monthsBack, recurringTypeOf, type SheetRow, type Workbook } from './ledger'

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

/** 월별 수입·지출·고정·유동·순저축. transfer(저축 이동)는 어느 쪽도 아니다. */
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

/** 그 달 수입 합(USD). income_pct 규칙의 기준이다. */
export function monthIncome(wb: Workbook, month: string): number {
  return r2(
    wb.transactions
      .filter((t) => isCounted(t) && monthOf(t) === month && String(t.type) === 'income')
      .reduce((a, t) => a + usd(t), 0)
  )
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

/**
 * Recurring 정의의 그 달 예상 금액(USD).
 * amount_rule 이 income_pct:N 이면 그 달 수입의 N% (수입이 없으면 expected_amount). 봇과 같은 규칙.
 */
export function expectedUsdOf(wb: Workbook, row: SheetRow, month: string): number {
  const fx = configNumber(wb.config, 'fx_usd_krw', 1332)
  const amount = expectedAmountFor(row, month, monthIncome(wb, month))
  // income_pct 는 이미 USD 로 계산된 값이라 다시 환산하지 않는다.
  if (parseAmountRule(String(row.amount_rule ?? '')).type === 'income_pct') return r2(amount)
  return String(row.currency).trim().toUpperCase() === 'KRW' ? r2(amount / fx) : r2(amount)
}

/** 2주급 항목이면 그 달 급여일 목록. 아니면 빈 배열. 화면 설명에 쓴다. */
export function paydaysOf(row: SheetRow, month: string): string[] {
  const rule = parseAmountRule(String(row.amount_rule ?? ''))
  return rule.type === 'biweekly' ? biweeklyPaydays(month, rule.anchor as string) : []
}

/**
 * Recurring 정의별 이번 달 실제.
 * recurring_id 로 묶인 행을 합한다. variable 정의는 같은 category 의 기록도 합한다(사전이 category 만 남긴 경우).
 */
export function recurringActuals(wb: Workbook, month: string, type: 'income' | 'expense' | 'transfer'): RecurringActual[] {
  return wb.recurring
    .filter((row) => recurringTypeOf(row) === type)
    .map((row) => {
      const id = String(row.id).trim()
      const kind = String(row.kind || 'fixed').trim()
      const category = String(row.category).trim()
      const hits = wb.transactions.filter((t) => {
        if (monthOf(t) !== month || String(t.status) === 'deleted') return false
        if (String(t.recurring_id).trim() === id) return true
        return kind !== 'fixed' && isCounted(t) && String(t.type) === type && !String(t.recurring_id).trim() && String(t.category).trim() === category
      })
      const counted = hits.filter(isCounted)
      const actual = r2(counted.reduce((a, t) => a + usd(t), 0))
      const status = counted.length ? String(counted[counted.length - 1].status) : hits.length ? String(hits[hits.length - 1].status) : ''
      return { row, id, name: String(row.name) || id, kind, category, expectedUsd: expectedUsdOf(wb, row, month), actualUsd: actual, status }
    })
}

/** 수입 계획 요약. */
export function incomePlan(wb: Workbook, month: string) {
  const sources = recurringActuals(wb, month, 'income').filter((s) => String(s.row.active).trim().toUpperCase() !== 'N')
  const expectedTotal = r2(sources.reduce((a, s) => a + s.expectedUsd, 0))
  const actualTotal = monthIncome(wb, month)
  return { sources, expectedTotal, actualTotal }
}

/** 저축(type=transfer) 계획과 실행. 먼저 저축의 진행률이다. */
export function savingsPlan(wb: Workbook, month: string) {
  const items = recurringActuals(wb, month, 'transfer').filter((s) => String(s.row.active).trim().toUpperCase() !== 'N')
  return {
    items,
    expected: r2(items.reduce((a, s) => a + s.expectedUsd, 0)),
    actual: r2(items.reduce((a, s) => a + s.actualUsd, 0)),
  }
}

/** active 고정비(type=expense, kind=fixed)의 월 예상 합(USD). 비상금 목표의 기준이다. */
export function fixedMonthlyExpense(wb: Workbook, month: string): number {
  return r2(
    wb.recurring
      .filter((r) => recurringTypeOf(r) === 'expense' && String(r.kind || 'fixed').trim() === 'fixed' && String(r.active).trim().toUpperCase() === 'Y')
      .reduce((a, r) => a + expectedUsdOf(wb, r, month), 0)
  )
}

/**
 * 비상금: 고정비 N개월치(Config.emergency_fund_months, 기본 3)를 목표로,
 * 최신 자산 스냅샷이 몇 개월분인지 본다.
 */
export function emergencyFund(wb: Workbook, month: string) {
  const months = configNumber(wb.config, 'emergency_fund_months', 3)
  const monthly = fixedMonthlyExpense(wb, month)
  const assets = latestAssetsTotal(wb)
  const target = r2(monthly * months)
  const covered = monthly > 0 ? r2(assets.total / monthly) : null
  return { months, monthly, target, assets: assets.total, assetsDate: assets.date, covered }
}

/**
 * 부채 목록을 USD 로 맞추고 상환 종료를 계산한다.
 * payoffMonths 는 이자를 반영한 값이고 remaining 은 시트의 남은 회차다. 둘이 다르면 이자를 과소평가한 것이다.
 */
export function debtSchedule(wb: Workbook, today: string) {
  const fx = configNumber(wb.config, 'fx_usd_krw', 1332)
  const toUsd = (row: SheetRow, key: string) => {
    const v = Number(row[key]) || 0
    return String(row.currency).trim().toUpperCase() === 'KRW' ? r2(v / fx) : v
  }
  const [y, m] = today.split('-').map(Number)
  const endOf = (months: number) => {
    const end = new Date(Date.UTC(y, m - 1 + months, 1))
    return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}`
  }
  return wb.debts
    .map((row) => {
      const remaining = Number(row.remaining_count) || 0
      const rate = Number(row.rate_pct) || 0
      const amortized = payoffMonths(Number(row.principal) || 0, rate, Number(row.monthly_payment) || 0)
      return {
        row,
        id: String(row.id),
        name: String(row.name),
        principalUsd: toUsd(row, 'principal'),
        monthlyUsd: toUsd(row, 'monthly_payment'),
        remaining,
        amortized,
        rate,
        currency: String(row.currency || 'USD').trim().toUpperCase(),
        payoff: endOf(amortized ?? remaining),
        linked: String(row.recurring_id ?? '').trim(),
      }
    })
    .sort((a, b) => b.principalUsd - a.principalUsd)
}

/** 부채 요약: 가중 평균 이율, 이율이 가장 높은 부채(눈사태 대상), 원화 부채 노출. */
export function debtOverview(debts: ReturnType<typeof debtSchedule>) {
  const totalPrincipal = debts.reduce((a, d) => a + d.principalUsd, 0)
  const totalMonthly = debts.reduce((a, d) => a + d.monthlyUsd, 0)
  const weightedRate = totalPrincipal > 0 ? debts.reduce((a, d) => a + d.rate * d.principalUsd, 0) / totalPrincipal : 0
  const avalanche = debts.filter((d) => d.principalUsd > 0).sort((a, b) => b.rate - a.rate)[0] ?? null
  const krwPrincipalUsd = debts.filter((d) => d.currency === 'KRW').reduce((a, d) => a + d.principalUsd, 0)
  return { totalPrincipal: r2(totalPrincipal), totalMonthly: r2(totalMonthly), weightedRate, avalanche, krwPrincipalUsd: r2(krwPrincipalUsd) }
}

/** 자산 스냅샷 날짜별 합계(USD). 오래된 순. */
export function assetsHistory(wb: Workbook) {
  const fx = configNumber(wb.config, 'fx_usd_krw', 1332)
  const acc = new Map<string, number>()
  wb.assets.forEach((row) => {
    const d = String(row.snapshot_date).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    acc.set(d, (acc.get(d) ?? 0) + assetUsd(row, fx))
  })
  return Array.from(acc.entries())
    .map(([date, total]) => ({ date, total: r2(total) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
