/**
 * Google Sheets API v4 얇은 래퍼.
 * 별도 백엔드가 없다. 시트 공유 권한이 곧 접근 권한이다.
 */

import { AuthRequiredError, forgetToken, getAccessToken } from './auth'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

/** Sheets API 오류를 사람이 읽을 문장으로 바꾼다. 원문은 뒤에 짧게 붙인다. */
function describeError(status: number, body: string): string {
  const detail = body.replace(/\s+/g, ' ').slice(0, 160)
  if (status === 403) return `이 시트를 읽거나 쓸 권한이 없습니다. 시트가 이 구글 계정에 편집자로 공유돼 있는지 확인하세요. (${detail})`
  if (status === 404) return `시트를 찾지 못했습니다. 설정의 스프레드시트 주소를 확인하세요. (${detail})`
  if (status === 429) return '구글 시트 요청이 너무 잦습니다. 잠시 뒤 새로고침하세요.'
  if (status >= 500) return `구글 시트 서버 오류(${status})입니다. 잠시 뒤 다시 시도하세요.`
  return `Sheets API ${status}: ${detail}`
}

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
  const send = async (): Promise<Response> => {
    // 토큰이 없으면 조용히 받아 본다. 팝업이 막히면 AuthRequiredError 가 올라가 화면이 "연결" 버튼을 보여 준다.
    const token = await getAccessToken(ctx.clientId, 'silent')
    return fetch(`${API}/${ctx.spreadsheetId}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
  }

  let response = await send()
  if (response.status === 401) {
    // 토큰이 만료됐거나 취소됐다. 한 번만 다시 받아 본다.
    forgetToken()
    response = await send()
  }
  if (!response.ok) {
    const body = await response.text()
    if (response.status === 401) throw new AuthRequiredError()
    throw new Error(describeError(response.status, body))
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
  await appendManyValues(ctx, name, [values])
}

/** 탭 끝에 여러 행을 한 번에 추가한다. 자산 스냅샷처럼 같은 날짜의 행 묶음에 쓴다. */
export async function appendManyValues(
  ctx: SheetsContext,
  name: string,
  rows: (string | number)[][]
): Promise<void> {
  if (rows.length === 0) return
  await request(
    ctx,
    `/values/${encodeURIComponent(`'${name}'`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) }
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
