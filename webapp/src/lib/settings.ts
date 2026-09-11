/**
 * 앱 설정. 스프레드시트 ID 와 OAuth 클라이언트 ID 는 저장소에 두지 않고
 * 이 기기의 localStorage 에만 둔다(CLAUDE.md Golden Rule 1).
 */

const KEY = 'family-budget.settings.v1'

export interface Settings {
  clientId: string
  spreadsheetId: string
}

const EMPTY: Settings = { clientId: '', spreadsheetId: '' }

/** 빌드 시 주입된 기본 클라이언트 ID. 없으면 빈 문자열. */
const BUILD_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
    return {
      clientId: saved.clientId || BUILD_CLIENT_ID,
      spreadsheetId: saved.spreadsheetId || '',
    }
  } catch {
    return { ...EMPTY, clientId: BUILD_CLIENT_ID }
  }
}

export function saveSettings(next: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(next))
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.clientId.trim() && s.spreadsheetId.trim())
}

/**
 * 붙여 넣은 값에서 스프레드시트 ID 만 뽑는다.
 * 전체 URL 을 그대로 붙여 넣는 경우가 많다.
 */
export function extractSpreadsheetId(input: string): string {
  const text = input.trim()
  const m = /\/d\/([a-zA-Z0-9-_]+)/.exec(text)
  return m ? m[1] : text
}
