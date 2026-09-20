import { useCallback, useEffect, useState } from 'react'
import { Card, Notice } from './components/Ui'
import { AuthRequiredError, getAccessToken, hasToken, signOut } from './lib/auth'
import { loadWorkbook, todayIn, type Workbook } from './lib/ledger'
import { isConfigured, loadSettings, saveSettings, type Settings } from './lib/settings'
import type { SheetsContext } from './lib/sheets'
import { Budgets } from './screens/Budgets'
import { Assets, Debts, Goals } from './screens/Holdings'
import { Income } from './screens/Income'
import { LedgerScreen } from './screens/LedgerScreen'
import { RecurringScreen } from './screens/RecurringScreen'
import { Report } from './screens/Report'
import { Setup } from './screens/Setup'
import { Today } from './screens/Today'

type Screen =
  | 'today'
  | 'ledger'
  | 'budgets'
  | 'income'
  | 'report'
  | 'more'
  | 'recurring'
  | 'debts'
  | 'assets'
  | 'goals'
  | 'setup'

const TITLES: Record<Screen, string> = {
  today: '오늘',
  ledger: '원장',
  budgets: '예산',
  income: '수입',
  report: '리포트',
  more: '더보기',
  recurring: '고정비',
  debts: '부채',
  assets: '자산',
  goals: '목표',
  setup: '설정',
}

const TABS: Array<{ id: Screen; label: string }> = [
  { id: 'today', label: '오늘' },
  { id: 'ledger', label: '원장' },
  { id: 'budgets', label: '예산' },
  { id: 'income', label: '수입' },
  { id: 'report', label: '리포트' },
  { id: 'more', label: '더보기' },
]

const MORE_ITEMS: Array<{ id: Screen; label: string; hint: string }> = [
  { id: 'recurring', label: '고정비', hint: '정기 항목의 예상 금액과 이번 달 확정 여부' },
  { id: 'debts', label: '부채', hint: '남은 원금과 월 상환액' },
  { id: 'assets', label: '자산', hint: '계좌 잔액·주식·연금·401k·HSA 종류별 스냅샷' },
  { id: 'goals', label: '목표', hint: '목표액 대비 진행률' },
  { id: 'setup', label: '설정', hint: '시트 연결과 로그아웃' },
]

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [screen, setScreen] = useState<Screen>(() => (isConfigured(loadSettings()) ? 'today' : 'setup'))
  const [workbook, setWorkbook] = useState<Workbook | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 사람이 "연결" 을 눌러야 하는 상태. 팝업이 막혔거나 30일 재검증 때다. 오류가 아니라 안내로 보여 준다.
  const [authNeeded, setAuthNeeded] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  const clientId = settings.clientId.trim()
  const spreadsheetId = settings.spreadsheetId.trim()
  const ctx: SheetsContext = { clientId, spreadsheetId }

  const refresh = useCallback(async () => {
    if (!clientId || !spreadsheetId) return
    setLoading(true)
    setError(null)
    try {
      const data = await loadWorkbook({ clientId, spreadsheetId })
      setWorkbook(data)
      setSignedIn(hasToken())
      setAuthNeeded(null)
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setAuthNeeded(err.message)
        setSignedIn(false)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setLoading(false)
    }
  }, [clientId, spreadsheetId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function connect() {
    setError(null)
    try {
      await getAccessToken(clientId, 'user')
      setSignedIn(true)
      setAuthNeeded(null)
      await refresh()
    } catch (err) {
      if (err instanceof AuthRequiredError) setAuthNeeded(err.message)
      else setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleSave(next: Settings) {
    saveSettings(next)
    setSettings(next)
    if (isConfigured(next)) setScreen('today')
  }

  async function handleSignOut() {
    await signOut()
    setSignedIn(false)
    setWorkbook(null)
  }

  const timezone = workbook?.config.timezone || 'America/Los_Angeles'
  const today = todayIn(timezone)
  const configured = isConfigured(settings)
  const ready = configured && workbook !== null
  const activeTab = TABS.some((t) => t.id === screen)
    ? screen
    : screen === 'setup' && !configured
      ? 'more'
      : 'more'
  const reload = () => void refresh()

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{TITLES[screen]}</h1>
          <p className="sub">{today}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!TABS.some((t) => t.id === screen) && (
            <button className="ghost" onClick={() => setScreen('more')}>
              뒤로
            </button>
          )}
          <button className="ghost" onClick={reload} disabled={loading || !configured}>
            {loading ? '불러오는 중' : '새로고침'}
          </button>
        </div>
      </header>

      {error && (
        <Notice kind="error">
          {error}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => void connect()}>구글 계정으로 다시 연결</button>
          </div>
        </Notice>
      )}

      {!configured && screen !== 'setup' && (
        <Notice kind="info">설정에서 클라이언트 ID 와 시트 주소를 먼저 입력하세요.</Notice>
      )}

      {authNeeded && !error && screen !== 'setup' && (
        <Notice kind="info">
          <span className="row" style={{ gap: 10 }}>
            <span className="grow">{authNeeded}</span>
            <button className="primary" onClick={() => void connect()} disabled={loading}>
              연결
            </button>
          </span>
        </Notice>
      )}

      {screen === 'setup' && (
        <Setup
          settings={settings}
          onSave={handleSave}
          onSignOut={() => void handleSignOut()}
          signedIn={signedIn}
        />
      )}

      {screen === 'more' && (
        <Card title="더보기">
          {MORE_ITEMS.map((item) => (
            <div className="tx" key={item.id} onClick={() => setScreen(item.id)}>
              <span className="grow">
                {item.label}
                <br />
                <span className="meta">{item.hint}</span>
              </span>
              <span className="meta">›</span>
            </div>
          ))}
        </Card>
      )}

      {screen !== 'setup' && screen !== 'more' && configured && !ready && !error && !authNeeded && (
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

      {ready && screen === 'today' && (
        <Today workbook={workbook} ctx={ctx} today={today} onChanged={reload} />
      )}
      {ready && screen === 'ledger' && (
        <LedgerScreen workbook={workbook} ctx={ctx} today={today} onChanged={reload} />
      )}
      {ready && screen === 'budgets' && (
        <Budgets workbook={workbook} ctx={ctx} today={today} onChanged={reload} />
      )}
      {ready && screen === 'income' && (
        <Income workbook={workbook} ctx={ctx} today={today} onChanged={reload} />
      )}
      {ready && screen === 'report' && <Report workbook={workbook} today={today} />}
      {ready && screen === 'recurring' && (
        <RecurringScreen workbook={workbook} ctx={ctx} today={today} onChanged={reload} />
      )}
      {ready && screen === 'debts' && <Debts workbook={workbook} ctx={ctx} today={today} onChanged={reload} />}
      {ready && screen === 'assets' && (
        <Assets workbook={workbook} ctx={ctx} today={today} onChanged={reload} />
      )}
      {ready && screen === 'goals' && <Goals workbook={workbook} ctx={ctx} today={today} onChanged={reload} />}

      <nav className="tabbar">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={activeTab === item.id ? 'active' : ''}
            onClick={() => setScreen(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
