/**
 * Google Identity Services 토큰 클라이언트.
 * 액세스 토큰은 메모리에만 둔다. 새로고침하면 조용히 다시 받는다.
 */

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    prompt?: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }): TokenClient
  revoke(token: string, done?: () => void): void
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } }
  }
}

let client: TokenClient | null = null
let clientIdInUse = ''
let token: { value: string; expiresAt: number } | null = null
let pending: ((r: TokenResponse) => void) | null = null

/** GIS 스크립트가 로드될 때까지 기다린다. */
async function waitForGis(timeoutMs = 10000): Promise<GoogleOAuth2> {
  const started = Date.now()
  while (!window.google?.accounts?.oauth2) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('구글 로그인 스크립트를 불러오지 못했습니다. 네트워크를 확인하세요.')
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return window.google.accounts.oauth2
}

async function ensureClient(clientId: string): Promise<TokenClient> {
  if (client && clientIdInUse === clientId) return client
  const oauth2 = await waitForGis()
  clientIdInUse = clientId
  client = oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (response) => {
      pending?.(response)
      pending = null
    },
    error_callback: (error) => {
      pending?.({ error: error.type || 'popup_error', error_description: error.message })
      pending = null
    },
  })
  return client
}

function isFresh(): boolean {
  return Boolean(token && token.expiresAt - Date.now() > 60_000)
}

/** 지금 유효한 토큰이 있는지. 로그인 상태 표시에 쓴다. */
export function hasToken(): boolean {
  return isFresh()
}

/**
 * 액세스 토큰을 받는다.
 * @param clientId OAuth 클라이언트 ID
 * @param interactive true 면 동의 창을 띄운다. false 면 조용히 갱신만 시도한다.
 */
export async function getAccessToken(clientId: string, interactive: boolean): Promise<string> {
  if (isFresh()) return token!.value

  const tokenClient = await ensureClient(clientId)
  const response = await new Promise<TokenResponse>((resolve) => {
    pending = resolve
    tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' })
  })

  if (response.error || !response.access_token) {
    throw new Error(
      response.error_description || response.error || '구글 인증에 실패했습니다.'
    )
  }
  token = {
    value: response.access_token,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
  }
  return token.value
}

/** 토큰을 버린다. 다음 요청에서 다시 받는다. */
export function forgetToken(): void {
  token = null
}

/** 구글에서 권한까지 해제한다. */
export async function signOut(): Promise<void> {
  const current = token?.value
  token = null
  if (!current) return
  const oauth2 = await waitForGis().catch(() => null)
  oauth2?.revoke(current)
}
