/**
 * Google Sheets API v4 얇은 래퍼.
 * 별도 백엔드가 없다. 시트 공유 권한이 곧 접근 권한이다.
 */

import { forgetToken, getAccessToken } from './auth'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

export interface Table {
  headers: string[]
  /** 시트 행 번호(1-based, 헤더는 1행). rows[i] 의 실제 행 번호는 i + 2 다. */
  rows: string[][]
}

export interface SheetsContext {
  clientId: string
  spreadsheetId: string
}

async function request<T>(ctx: SheetsContext, path: string, init?: RequestInit): Promise<T> {
  const send = async (interactive: boolean): Promise<Response> => {
    const token = await getAccessToken(ctx.clientId, interactive)
    return fetch(`${API}/${ctx.spreadsheetId}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
  }

  let response = await send(false)
  if (response.status === 401) {
    // 토큰이 만료됐다. 한 번만 다시 받아 본다.
    forgetToken()
    response = await send(true)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Sheets API ${response.status}: ${body.slice(0, 300)}`)
  }
  return (await response.json()) as T
}

function toTable(values: string[][] | undefined): Table {
  const all = values ?? []
  if (all.length === 0) return { headers: [], rows: [] }
  const headers = (all[0] ?? []).map((h) => String(h ?? '').trim())
  const rows = all.slice(1).map((row) => {
    const filled = headers.map((_, i) => String(row[i] ?? ''))
    return filled
  })
  return { headers, rows }
}

/** 탭 여러 개를 한 번에 읽는다. */
export async function readTabs(ctx: SheetsContext, names: string[]): Promise<Record<string, Table>> {
  const query = names.map((n) => `ranges=${encodeURIComponent(`'${n}'`)}`).join('&')
  const data = await request<{ valueRanges?: Array<{ values?: string[][] }> }>(
    ctx,
    `/values:batchGet?${query}&majorDimension=ROWS`
  )
  const out: Record<string, Table> = {}
  names.forEach((name, i) => {
    out[name] = toTable(data.valueRanges?.[i]?.values)
  })
  return out
}

/** 탭 하나를 읽는다. */
export async function readTab(ctx: SheetsContext, name: string): Promise<Table> {
  const tabs = await readTabs(ctx, [name])
  return tabs[name]
}

/** 탭 끝에 한 행을 추가한다. 원장은 append-only 다. */
export async function appendValues(
  ctx: SheetsContext,
  name: string,
  values: (string | number)[]
): Promise<void> {
  await request(
    ctx,
    `/values/${encodeURIComponent(`'${name}'`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [values] }) }
  )
}

/** A1 표기의 열 문자. 0-based 입력. */
export function columnLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * 한 행의 특정 셀들만 쓴다. 행 전체를 덮어쓰지 않으므로
 * 그 사이 다른 사람이 고친 다른 열을 되돌리지 않는다(lost update 방지).
 * 행을 지우지 않는다(soft delete 만 쓴다).
 */
export async function updateCells(
  ctx: SheetsContext,
  name: string,
  rowNumber: number,
  cells: Array<{ col: number; value: string | number }>
): Promise<void> {
  if (cells.length === 0) return
  const data = cells.map((c) => ({
    range: `'${name}'!${columnLetter(c.col)}${rowNumber}`,
    values: [[c.value]],
  }))
  await request(ctx, `/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  })
}
