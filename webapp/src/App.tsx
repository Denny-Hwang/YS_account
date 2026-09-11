import { useCallback, useEffect, useState } from 'react'
import { Notice } from './components/Ui'
import { getAccessToken, hasToken, signOut } from './lib/auth'
import { loadWorkbook, todayIn, type Workbook } from './lib/ledger'
import { isConfigured, loadSettings, saveSettings, type Settings } from './lib/settings'
import type { SheetsContext } from './lib/sheets'
import { LedgerScreen } from './screens/LedgerScreen'
import { Setup } from './screens/Setup'
import { Today } from './screens/Today'

type Tab = 'today' | 'ledger' | 'setup'

const TAB_LABELS: Array<{ id: Tab; label: string }> = [
  { id: 'today', label: '오늘' },
  { id: 'ledger', label: '원장' },
  { id: 'setup', label: '설정' },
]

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [tab, setTab] = useState<Tab>(() => (isConfigured(loadSettings()) ? 'today' : 'setup'))
  const [workbook, setWorkbook] = useState<Workbook | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  const ctx: SheetsContext = {
    clientId: settings.clientId.trim(),
    spreadsheetId: settings.spreadsheetId.trim(),
  }

  const refresh = useCallback(async () => {
    if (!isConfigured(settings)) return
    setLoading(true)
    setError(null)
    try {
      const data = await loadWorkbook(ctx)
      setWorkbook(data)
      setSignedIn(hasToken())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
    // ctx 는 settings 에서 파생된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.clientId, settings.spreadsheetId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function connect() {
    setError(null)
    try {
      await getAccessToken(ctx.clientId, true)
      setSignedIn(true)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleSave(next: Settings) {
    saveSettings(next)
    setSettings(next)
    if (isConfigured(next)) setTab('today')
  }

  async function handleSignOut() {
    await signOut()
    setSignedIn(false)
    setWorkbook(null)
  }

  const timezone = workbook?.config.timezone || 'America/Los_Angeles'
  const today = todayIn(timezone)
  const ready = isConfigured(settings) && workbook !== null

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{TAB_LABELS.find((t) => t.id === tab)?.label ?? '가계부'}</h1>
          <p className="sub">{today}</p>
        </div>
        <button className="ghost" onClick={() => void refresh()} disabled={loading || !isConfigured(settings)}>
          {loading ? '불러오는 중' : '새로고침'}
        </button>
      </header>

      {error && (
        <Notice kind="error">
          {error}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => void connect()}>구글 계정으로 다시 연결</button>
          </div>
        </Notice>
      )}

      {!isConfigured(settings) && tab !== 'setup' && (
        <Notice kind="info">설정에서 클라이언트 ID 와 시트 주소를 먼저 입력하세요.</Notice>
      )}

      {tab === 'setup' && (
        <Setup settings={settings} onSave={handleSave} onSignOut={() => void handleSignOut()} signedIn={signedIn} />
      )}

      {tab !== 'setup' && isConfigured(settings) && !ready && !error && (
        <Notice kind="info">
          {loading ? '시트를 불러오는 중입니다.' : '구글 계정 연결이 필요합니다.'}
          {!loading && (
            <div style={{ marginTop: 8 }}>
              <button className="primary" onClick={() => void connect()}>
                구글 계정으로 연결
              </button>
            </div>
          )}
        </Notice>
      )}

      {tab === 'today' && ready && (
        <Today workbook={workbook} ctx={ctx} today={today} onChanged={() => void refresh()} />
      )}
      {tab === 'ledger' && ready && (
        <LedgerScreen workbook={workbook} ctx={ctx} today={today} onChanged={() => void refresh()} />
      )}

      <nav className="tabbar">
        {TAB_LABELS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
