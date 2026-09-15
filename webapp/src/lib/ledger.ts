/**
 * 시트 테이블을 앱이 쓰는 객체로 바꾸고 다시 되돌린다.
 * 열 순서는 항상 시트의 헤더 행을 따른다. 코드에 열 번호를 박지 않는다.
 */

import { isSpentStatus, isSettledStatus } from '@shared/Budget.js'
import { isReservedStatus, pickConfirmTarget } from '@shared/LedgerRules.js'
import type { ParsedMessage } from '@shared/Parser.js'
import { appendValues, readTabs, updateCells, type SheetsContext, type Table } from './sheets'

export const TABS = {
  transactions: 'Transactions',
  recurring: 'Recurring',
  budgets: 'Budgets',
  merchants: 'Merchants',
  debts: 'Debts',
  assets: 'Assets',
  goals: 'Goals',
  config: 'Config',
} as const

export interface SheetRow {
  /** 시트의 실제 행 번호. 쓰기에 쓴다. */
  _row: number
  [key: string]: string | number
}

export function tableToRows(table: Table): SheetRow[] {
  return table.rows
    .map((cells, i) => {
      const obj: SheetRow = { _row: i + 2 }
      table.headers.forEach((header, c) => {
        if (header) obj[header] = cells[c] ?? ''
      })
      return obj
    })
    .filter((row) => Object.keys(row).some((k) => k !== '_row' && String(row[k]).trim() !== ''))
}

export function rowToValues(headers: string[], row: Record<string, unknown>): (string | number)[] {
  return headers.map((h) => {
    const v = row[h]
    if (v === null || v === undefined) return ''
    return typeof v === 'number' ? v : String(v)
  })
}

export interface Workbook {
  tables: Record<string, Table>
  transactions: SheetRow[]
  recurring: SheetRow[]
  budgets: SheetRow[]
  merchants: SheetRow[]
  debts: SheetRow[]
  assets: SheetRow[]
  goals: SheetRow[]
  config: Record<string, string>
}

const ALL_TABS = Object.values(TABS)

export async function loadWorkbook(ctx: SheetsContext): Promise<Workbook> {
  const tables = await readTabs(ctx, ALL_TABS as unknown as string[])
  const configRows = tableToRows(tables[TABS.config])
  const config: Record<string, string> = {}
  configRows.forEach((row) => {
    const key = String(row.key ?? '').trim()
    if (key) config[key] = String(row.value ?? '').trim()
  })
  return {
    tables,
    transactions: tableToRows(tables[TABS.transactions]),
    recurring: tableToRows(tables[TABS.recurring]),
    budgets: tableToRows(tables[TABS.budgets]),
    merchants: tableToRows(tables[TABS.merchants]),
    debts: tableToRows(tables[TABS.debts]),
    assets: tableToRows(tables[TABS.assets]),
    goals: tableToRows(tables[TABS.goals]),
    config,
  }
}

export function configList(config: Record<string, string>, key: string): string[] {
  return (config[key] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function configNumber(config: Record<string, string>, key: string, fallback: number): number {
  const n = Number(config[key])
  return Number.isFinite(n) && config[key] !== '' ? n : fallback
}

/** 시트 시간대 기준의 오늘 날짜. */
export function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export function newTxId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `tx_${rand}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** 아무 탭에나 한 행을 추가한다. 헤더 순서는 시트에서 읽는다. */
export async function appendTo(
  ctx: SheetsContext,
  workbook: Workbook,
  tab: string,
  row: Record<string, unknown>
): Promise<void> {
  await appendValues(ctx, tab, rowToValues(workbook.tables[tab].headers, row))
}

/**
 * 아무 탭의 한 행을 부분 수정한다. 값이 실제로 바뀐 열만 쓴다.
 * 그 사이 다른 사람이 고친 다른 열은 건드리지 않는다.
 */
export async function patchIn(
  ctx: SheetsContext,
  workbook: Workbook,
  tab: string,
  target: SheetRow,
  patch: Record<string, unknown>
): Promise<void> {
  const headers = workbook.tables[tab].headers
  const merged: Record<string, unknown> = { ...patch }
  if (headers.includes('updated_at')) merged.updated_at = nowIso()
  const cells: Array<{ col: number; value: string | number }> = []
  headers.forEach((h, col) => {
    if (!h || !(h in merged)) return
    const v = merged[h]
    const value: string | number = v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v)
    const before = target[h]
    if (before !== undefined && String(before) === String(value)) return
    cells.push({ col, value })
  })
  await updateCells(ctx, tab, target._row, cells)
}

/** 최신 스냅샷 날짜의 자산 합계(USD 환산). 행에 fx_usd_krw 가 있으면 그 환율을 쓴다. */
export function latestAssetsTotal(workbook: Workbook): { date: string; total: number } {
  const dates = workbook.assets
    .map((row) => String(row.snapshot_date).slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  if (dates.length === 0) return { date: '', total: 0 }
  const latest = dates.sort().reverse()[0]
  const fx = configNumber(workbook.config, 'fx_usd_krw', 1332)
  const total = workbook.assets
    .filter((row) => String(row.snapshot_date).slice(0, 10) === latest)
    .reduce((acc, row) => acc + assetUsd(row, fx), 0)
  return { date: latest, total: Math.round(total * 100) / 100 }
}

/** 자산 행 하나의 USD 환산액. 스냅샷 당시 환율(fx_usd_krw 열)이 있으면 그 값을 쓴다. */
export function assetUsd(row: SheetRow, fallbackFx: number): number {
  const balance = Number(row.balance) || 0
  if (String(row.currency).trim().toUpperCase() !== 'KRW') return balance
  const rowFx = Number(row.fx_usd_krw)
  const fx = Number.isFinite(rowFx) && rowFx > 0 ? rowFx : fallbackFx
  return fx > 0 ? balance / fx : 0
}

/** 원장에 한 행을 추가한다. */
export async function appendTransaction(
  ctx: SheetsContext,
  workbook: Workbook,
  row: Record<string, unknown>
): Promise<void> {
  const headers = workbook.tables[TABS.transactions].headers
  await appendValues(ctx, TABS.transactions, rowToValues(headers, row))
}

/** 원장 한 행을 수정한다. 바뀐 열만 쓰고 updated_at 은 자동으로 채운다. */
export async function patchTransaction(
  ctx: SheetsContext,
  workbook: Workbook,
  target: SheetRow,
  patch: Record<string, unknown>
): Promise<void> {
  await patchIn(ctx, workbook, TABS.transactions, target, patch)
}

/** 원장 행을 soft delete 한다. 물리 삭제는 하지 않는다. */
export async function softDeleteTransaction(
  ctx: SheetsContext,
  workbook: Workbook,
  target: SheetRow,
  by: string
): Promise<void> {
  await patchTransaction(ctx, workbook, target, { status: 'deleted', updated_by: by })
}

/** 해당 월·세부예산의 예산 금액. */
export function budgetAmount(workbook: Workbook, month: string, envelope: string): number {
  const hit = workbook.budgets.find(
    (row) => String(row.month).trim() === month && String(row.envelope).trim() === envelope
  )
  return hit ? Number(hit.amount) || 0 : 0
}

/**
 * 화면에 보여 줄 세부예산 하나.
 *
 * 시트에는 분류가 두 열로 나뉘어 있다. `envelope` 은 예산이 붙는 유동비 세부예산이고,
 * `category` 는 그 밖의 분류(주거비·통신비 같은 고정비 포함)다.
 * 사람은 이 둘을 하나로 본다. 그래서 화면에서는 한 목록으로 합쳐 보여 주고,
 * 고를 때 어느 열에 쓸지는 categoryFields 가 정한다.
 */
export interface CategoryOption {
  name: string
  /** Config.envelopes 에 있는가. 예산과 신호등이 붙는 유동비 세부예산이다. */
  budgeted: boolean
}

/**
 * 고를 수 있는 세부예산 전부. 유동비 세부예산이 먼저 오고 그 밖의 분류가 뒤따른다.
 *
 * 뒤쪽은 네 군데에서 모은다.
 *   Config.categories  — 직접 적어 둔 목록. 아직 한 번도 안 쓴 분류를 미리 넣을 때
 *   Recurring.category — 고정비 분류(주거비·통신비·보험 …)
 *   Merchants.category — 사전이 아는 분류(외식 …)
 *   Transactions.category — 지금까지 실제로 쓴 분류
 * 한 번 쓴 분류는 다음부터 목록에 있으므로 따로 등록하지 않아도 된다.
 */
export function categoryOptions(workbook: Workbook): CategoryOption[] {
  const envelopes = configList(workbook.config, 'envelopes')
  const seen = new Set(envelopes)
  const others: string[] = []
  const add = (raw: unknown) => {
    const name = String(raw ?? '').trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    others.push(name)
  }
  configList(workbook.config, 'categories').forEach(add)
  workbook.recurring.forEach((row) => add(row.category))
  workbook.merchants.forEach((row) => add(row.category))
  workbook.transactions.forEach((row) => add(row.category))
  others.sort((a, b) => a.localeCompare(b, 'ko'))
  return envelopes
    .map((name) => ({ name, budgeted: true }))
    .concat(others.map((name) => ({ name, budgeted: false })))
}

/**
 * 고른 값을 원장의 두 열로 푼다.
 * 유동비 세부예산이면 envelope 에도 넣어 예산과 신호등에 잡히게 하고,
 * 그 밖의 분류면 envelope 을 비워 유동비 예산을 건드리지 않는다.
 */
export function categoryFields(workbook: Workbook, name: string): { category: string; envelope: string } {
  const picked = String(name ?? '').trim()
  const budgeted = configList(workbook.config, 'envelopes').indexOf(picked) >= 0
  return { category: picked, envelope: budgeted ? picked : '' }
}

/** 원장 행에 보여 줄 분류 이름. envelope 이 있으면 그것이 곧 세부예산이다. */
export function categoryOf(row: SheetRow): string {
  return String(row.envelope ?? '').trim() || String(row.category ?? '').trim()
}

/** 해당 월의 원장 행. */
export function monthTransactions(workbook: Workbook, month: string): SheetRow[] {
  return workbook.transactions.filter((row) => String(row.date).slice(0, 7) === month)
}

/** 원장에 들어 있는 월 목록(최신순). */
export function availableMonths(workbook: Workbook, today: string): string[] {
  const set = new Set<string>([today.slice(0, 7)])
  workbook.transactions.forEach((row) => {
    const month = String(row.date).slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(month)) set.add(month)
  })
  return Array.from(set).sort().reverse()
}

/**
 * 예산에 반영되는 상태인가. 봇·시트와 같은 기준을 쓰려고 공유 모듈을 그대로 호출한다.
 * committed(금액이 확정된 고정비)는 결제 전이라도 이미 쓴 돈으로 센다.
 * expected(금액 미정)와 deleted 는 빠진다.
 */
export function isCounted(row: SheetRow): boolean {
  return isSpentStatus(row.status)
}

/** 실제로 집행이 끝났는가. committed 는 예산에는 들어가지만 아직 결제 전이다. */
export function isSettled(row: SheetRow): boolean {
  return isSettledStatus(row.status)
}

/** 아직 집행 전인 예약 행인가. expected(금액 미정) 또는 committed(금액 확정). */
export function isReserved(row: SheetRow): boolean {
  return isReservedStatus(row.status)
}

/** 화면에 보여 줄 상태 배지. 집행된 행은 배지가 없다(null). */
export function statusBadge(row: SheetRow): { label: string; tone: 'reserved' | 'committed' | 'deleted' } | null {
  const s = String(row.status).trim()
  if (s === 'deleted') return { label: '삭제', tone: 'deleted' }
  if (s === 'committed') return { label: '확정·선반영', tone: 'committed' }
  if (s === 'expected') return { label: '예정', tone: 'reserved' }
  return null
}

/** Recurring 정의의 유형. type 열이 비어 있으면 expense(이전 시트와 호환). */
export function recurringTypeOf(row: SheetRow): 'income' | 'expense' | 'transfer' {
  const t = String(row.type ?? '').trim().toLowerCase()
  return t === 'income' || t === 'transfer' ? t : 'expense'
}

/** fromMonth 를 마지막으로 count 개월(오래된 순). */
export function monthsBack(fromMonth: string, count: number): string[] {
  const [y, m] = fromMonth.split('-').map(Number)
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** 접두사 + 2자리 번호로 다음 id. 예: R13, I02, D07 */
export function nextIdFor(rows: SheetRow[], prefix: string): string {
  let max = 0
  rows.forEach((row) => {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(row.id).trim())
    if (m) max = Math.max(max, Number(m[1]))
  })
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}

export interface RecordResult {
  mode: 'append' | 'confirm' | 'refund'
  txId: string
  name: string
  type: string
  envelope: string
  nth: number
}

/**
 * 파싱 결과를 봇과 같은 규칙으로 원장에 쓴다.
 * - 사전이 kind=fixed 인 Recurring 항목을 가리키면 이번 달 expected 행을 확정한다(pickConfirmTarget).
 *   expected 가 없으면(이미 확정됐으면) "이번 달 N번째" 로 confirmed 행을 새로 추가한다.
 * - kind=variable 정의(레슨)는 보통 행처럼 추가하되 recurring_id 를 남긴다.
 * - 그 밖에는 새 행. 환불은 음수 금액의 지출이다.
 */
export interface RecordOverrides {
  /** 'YYYY-MM-DD'. 비우면 파싱한 날짜를 쓴다. */
  date?: string
  /** 화면에서 고른 세부예산. 비우면 사전 분류에 맡긴다. */
  category?: string
  /** 'expense' | 'income' | 'transfer'. 비우면 파싱 결과를 쓴다. */
  type?: string
}

export async function recordParsed(
  ctx: SheetsContext,
  workbook: Workbook,
  parsed: ParsedMessage,
  hit: Record<string, unknown> | null,
  by: string,
  overrides: RecordOverrides = {}
): Promise<RecordResult> {
  // 사람이 고른 값이 파싱 결과를 이긴다. 비운 칸은 지금까지처럼 자동으로 채워진다.
  if (overrides.date) {
    parsed = { ...parsed, date: overrides.date }
  }
  const month = parsed.date.slice(0, 7)
  const now = nowIso()
  const recurringId = String(hit?.recurring_id ?? '').trim()
  const def = recurringId ? workbook.recurring.find((r) => String(r.id).trim() === recurringId) ?? null : null
  const envelopes = configList(workbook.config, 'envelopes')

  if (def && String(def.kind || 'fixed').trim() === 'fixed') {
    const pick = pickConfirmTarget(monthTransactions(workbook, month), recurringId)
    const name = String(def.name || recurringId)
    const type = recurringTypeOf(def)
    if (pick.target) {
      await patchTransaction(ctx, workbook, pick.target, {
        amount: parsed.amount,
        currency: parsed.currency,
        amount_usd: parsed.amount_usd ?? 0,
        date: parsed.date,
        status: 'confirmed',
        payer: by,
        updated_by: by,
      })
      return { mode: 'confirm', txId: String(pick.target.id), name, type, envelope: '', nth: 1 }
    }
    const txId = newTxId()
    await appendTransaction(ctx, workbook, {
      id: txId,
      date: parsed.date,
      type,
      kind: 'fixed',
      category: String(def.category ?? ''),
      envelope: '',
      merchant: name,
      amount: parsed.amount,
      currency: parsed.currency,
      amount_usd: parsed.amount_usd ?? 0,
      recurring_id: recurringId,
      status: 'confirmed',
      memo: pick.confirmedCount > 0 ? `이번 달 ${pick.confirmedCount + 1}번째` : '',
      payer: by,
      source: 'web',
      created_at: now,
      updated_at: now,
      updated_by: by,
    })
    return { mode: 'confirm', txId, name, type, envelope: '', nth: pick.confirmedCount + 1 }
  }

  const type = overrides.type || (def ? recurringTypeOf(def) : String(hit?.type ?? parsed.type ?? 'expense'))
  // 고른 값이 있으면 그대로 쓴다. 없으면 사전이 알려 준 값, 그것도 없으면 첫 유동비 세부예산이다.
  // 수입·저축은 유동비 세부예산을 갖지 않는다.
  const picked = overrides.category ? categoryFields(workbook, overrides.category) : null
  const envelope = picked
    ? picked.envelope
    : type === 'expense'
      ? String(hit?.envelope ?? (envelopes[0] ?? ''))
      : ''
  const txId = newTxId()
  await appendTransaction(ctx, workbook, {
    id: txId,
    date: parsed.date,
    type,
    kind: def ? 'variable' : String(hit?.kind ?? 'variable'),
    category: picked ? picked.category : def ? String(def.category ?? '') : String(hit?.category ?? ''),
    envelope,
    merchant: parsed.merchantTextRaw || parsed.merchantText,
    amount: parsed.amount,
    currency: parsed.currency,
    amount_usd: parsed.amount_usd ?? 0,
    recurring_id: def ? recurringId : '',
    status: 'active',
    memo: parsed.refund ? '환불' : parsed.confidence === 'low' ? parsed.memo : '',
    payer: by,
    source: 'web',
    created_at: now,
    updated_at: now,
    updated_by: by,
  })
  return {
    mode: parsed.refund ? 'refund' : 'append',
    txId,
    name: parsed.merchantTextRaw || parsed.merchantText || '항목',
    type,
    envelope,
    nth: 0,
  }
}
