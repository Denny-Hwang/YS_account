/**
 * 시트 테이블을 앱이 쓰는 객체로 바꾸고 다시 되돌린다.
 * 열 순서는 항상 시트의 헤더 행을 따른다. 코드에 열 번호를 박지 않는다.
 */

import { appendValues, readTabs, updateRow, type SheetsContext, type Table } from './sheets'

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

/** 원장에 한 행을 추가한다. */
export async function appendTransaction(
  ctx: SheetsContext,
  workbook: Workbook,
  row: Record<string, unknown>
): Promise<void> {
  const headers = workbook.tables[TABS.transactions].headers
  await appendValues(ctx, TABS.transactions, rowToValues(headers, row))
}

/** 원장 한 행을 수정한다. updated_at 은 자동으로 채운다. */
export async function patchTransaction(
  ctx: SheetsContext,
  workbook: Workbook,
  target: SheetRow,
  patch: Record<string, unknown>
): Promise<void> {
  const headers = workbook.tables[TABS.transactions].headers
  const merged: Record<string, unknown> = { ...target, ...patch }
  if (headers.includes('updated_at')) merged.updated_at = nowIso()
  await updateRow(ctx, TABS.transactions, target._row, rowToValues(headers, merged))
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

/** 해당 월·봉투의 예산 금액. */
export function budgetAmount(workbook: Workbook, month: string, envelope: string): number {
  const hit = workbook.budgets.find(
    (row) => String(row.month).trim() === month && String(row.envelope).trim() === envelope
  )
  return hit ? Number(hit.amount) || 0 : 0
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
