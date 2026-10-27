/**
 * Google Identity Services 토큰 클라이언트.
 *
 * 서버가 없으므로 구글이 갱신 토큰(refresh token)을 주지 않는다. 액세스 토큰은 1시간짜리다.
 * 그 안에서 "다시 로그인하는 느낌" 을 최대한 없애려고 이렇게 한다.
 *   1. 토큰을 localStorage 에 둔다. 앱을 닫았다 열어도 1시간 안이면 아무것도 묻지 않는다.
 *   2. 만료되면 prompt '' 로 조용히 다시 받는다. 구글 세션이 살아 있고 이미 동의했으면 창이 잠깐 떴다 저절로 닫힌다.
 *   3. 처음 받은 계정 이메일을 hint 로 넘겨 계정 선택 화면을 건너뛴다.
 *   4. 동의 화면(prompt 'consent')은 마지막 동의로부터 30일이 지났을 때만 다시 띄운다.
 * 팝업이 막힌 상태(앱을 막 열었을 때 등)면 오류 대신 AuthRequiredError 를 던져 화면이 "연결" 버튼을 보여 주게 한다.
 */

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email'
const TOKEN_KEY = 'family-budget.token.v2'
const ACCOUNT_KEY = 'family-budget.account.v1'
/** 이 기간이 지나면 동의 화면을 다시 띄워 재검증한다. */
const RECONSENT_MS = 30 * 24 * 60 * 60 * 1000

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string; hint?: string }): void
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

interface StoredToken {
  value: string
  expiresAt: number
}

interface StoredAccount {
  /** 처음 연결한 구글 계정. 다음부터 계정 선택 화면을 건너뛰는 데 쓴다. */
  email: string
  /** 마지막으로 사람이 직접 연결(동의)한 시각. 30일이 지나면 동의 화면을 다시 띄운다. */
  consentAt: number
}

/** 사람이 "연결" 을 눌러야 진행할 수 있을 때 던진다. 오류가 아니라 안내로 다룬다. */
export class AuthRequiredError extends Error {
  constructor(message = '구글 계정 연결이 필요합니다.') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

let client: TokenClient | null = null
let clientIdInUse = ''
let token: StoredToken | null = readJson<StoredToken>(TOKEN_KEY, isValidToken)
let account: StoredAccount | null = readJson<StoredAccount>(ACCOUNT_KEY, (a) => typeof a.email === 'string')
let pending: ((r: TokenResponse) => void) | null = null
/** 같은 순간에 여러 요청이 토큰을 달라고 해도 팝업은 한 번만 띄운다. */
let inflight: Promise<string> | null = null
/**
 * 팝업 응답을 이만큼 기다린다. 구글 창에 오류(invalid_client 등)가 뜬 채 닫히면
 * 모바일 브라우저에서는 GIS 가 아무 콜백도 부르지 않아, 기한이 없으면 요청이 영원히 걸린다.
 */
const POPUP_TIMEOUT_MS = 90_000

function isValidToken(t: Partial<StoredToken>): boolean {
  return typeof t.value === 'string' && typeof t.expiresAt === 'number' && t.expiresAt - Date.now() > 60_000
}

function readJson<T>(key: string, ok: (v: Partial<T>) => boolean): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<T>
    return ok(saved) ? (saved as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown | null): void {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
  } catch {
    // 저장이 막힌 브라우저(시크릿 창 등)에서는 메모리만 쓴다.
  }
}

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

/** 연결된 구글 계정 이메일. 아직 모르면 빈 문자열. */
export function connectedEmail(): string {
  return account?.email ?? ''
}

/** 마지막 동의로부터 30일이 지나 재검증이 필요한가. */
export function reconsentDue(): boolean {
  return !account || Date.now() - account.consentAt > RECONSENT_MS
}

/** 다음 재검증 예정일(YYYY-MM-DD). 계정 기록이 없으면 빈 문자열. */
export function reconsentDate(): string {
  if (!account) return ''
  return new Date(account.consentAt + RECONSENT_MS).toISOString().slice(0, 10)
}

/**
 * 액세스 토큰을 받는다.
 * @param clientId OAuth 클라이언트 ID
 * @param mode
 *   'silent' — 사람이 누르지 않은 상황(앱을 막 열었을 때, 만료 뒤 첫 요청). 팝업이 막히거나
 *              재검증 기한이 지났으면 AuthRequiredError 를 던진다. 동의 화면은 띄우지 않는다.
 *   'user'   — 사람이 "연결" 을 눌렀다. 필요한 만큼만 묻는다(보통은 창이 잠깐 떴다 닫힌다).
 *              30일이 지났으면 동의 화면을 다시 띄운다.
 */
export async function getAccessToken(clientId: string, mode: 'silent' | 'user'): Promise<string> {
  if (isFresh()) return token!.value
  if (mode === 'silent' && reconsentDue()) {
    throw new AuthRequiredError('한 달에 한 번 구글 계정을 다시 확인합니다. 연결을 눌러 주세요.')
  }
  // 사람이 다시 누르면 앞선 요청이 걸려 있어도 버리고 새로 띄운다. 그래야 오류 창을 닫은 뒤 다시 시도할 수 있다.
  if (inflight && mode === 'user') cancelPending()
  else if (inflight) return inflight
  const mine = requestToken(clientId, mode).finally(() => {
    if (inflight === mine) inflight = null
  })
  inflight = mine
  return mine
}

/** 걸려 있는 팝업 요청을 "닫힘" 으로 끝낸다. 기다리던 쪽은 AuthRequiredError 를 받는다. */
function cancelPending(): void {
  pending?.({ error: 'popup_closed' })
  pending = null
  inflight = null
}

async function requestToken(clientId: string, mode: 'silent' | 'user'): Promise<string> {
  const tokenClient = await ensureClient(clientId)
  const forceConsent = mode === 'user' && reconsentDue()
  const response = await new Promise<TokenResponse>((resolve) => {
    const timer = setTimeout(() => {
      if (pending === finish) pending = null
      finish({ error: 'popup_closed' })
    }, POPUP_TIMEOUT_MS)
    let done = false
    const finish = (r: TokenResponse) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    pending = finish
    tokenClient.requestAccessToken({
      prompt: forceConsent ? 'consent' : '',
      ...(account?.email ? { hint: account.email } : {}),
    })
  })

  if (response.error || !response.access_token) {
    const type = response.error ?? ''
    // 팝업이 막혔거나 사람이 닫았다. 오류가 아니라 "눌러서 연결" 안내로 처리한다.
    if (type === 'popup_failed_to_open' || type === 'popup_closed' || type === 'user_cancel' || type === 'interaction_required') {
      throw new AuthRequiredError()
    }
    throw new Error(response.error_description || type || '구글 인증에 실패했습니다.')
  }
  token = {
    value: response.access_token,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
  }
  writeJson(TOKEN_KEY, token)
  if (mode === 'user' || !account) {
    account = { email: account?.email ?? '', consentAt: Date.now() }
    writeJson(ACCOUNT_KEY, account)
  }
  if (!account.email) void rememberEmail(token.value)
  return token.value
}

/** 연결한 계정 이메일을 한 번 받아 둔다. 다음 팝업에서 계정 선택을 건너뛰는 hint 로 쓴다. 실패해도 조용히 넘어간다. */
async function rememberEmail(accessToken: string): Promise<void> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return
    const info = (await res.json()) as { email?: string }
    if (info.email && account) {
      account = { ...account, email: info.email }
      writeJson(ACCOUNT_KEY, account)
    }
  } catch {
    // hint 없이도 동작한다. 계정 선택 화면이 한 번 더 뜰 뿐이다.
  }
}

/** 토큰을 버린다. 다음 요청에서 다시 받는다. */
export function forgetToken(): void {
  token = null
  writeJson(TOKEN_KEY, null)
}

/**
 * 클라이언트 ID 가 바뀌었을 때 부른다. 걸린 요청과 만들어 둔 토큰 클라이언트, 받은 토큰을 버린다.
 * 기억한 계정(hint)은 남긴다. 계정까지 지우려면 signOut.
 */
export function resetAuth(): void {
  cancelPending()
  client = null
  clientIdInUse = ''
  forgetToken()
}

/** 토큰이 없어도 기억한 계정이 있으면 true. 설정 화면이 로그아웃 버튼을 보여 줄지 정한다. */
export function hasRememberedAccount(): boolean {
  return Boolean(account || token)
}

/** 구글에서 권한까지 해제하고 기억한 계정도 지운다. */
export async function signOut(): Promise<void> {
  const current = token?.value
  resetAuth()
  account = null
  writeJson(TOKEN_KEY, null)
  writeJson(ACCOUNT_KEY, null)
  if (!current) return
  const oauth2 = await waitForGis().catch(() => null)
  oauth2?.revoke(current)
}
