import { useState } from 'react'
import { Card, Field, Notice } from '../components/Ui'
import { connectedEmail, hasRememberedAccount, reconsentDate } from '../lib/auth'
import type { Workbook } from '../lib/ledger'
import { clientIdProblem, extractSpreadsheetId, normalizeClientId, type Settings } from '../lib/settings'
import type { SheetsContext } from '../lib/sheets'
import { SalarySettings } from './SalarySettings'

export function Setup({
  settings,
  onSave,
  onSignOut,
  signedIn,
  workbook,
  ctx,
  today,
  onChanged,
}: {
  settings: Settings
  onSave: (next: Settings) => void
  onSignOut: () => void
  signedIn: boolean
  /** 시트를 읽었으면 급여 설정을 보여 준다. 아직이면 null. */
  workbook: Workbook | null
  ctx: SheetsContext
  today: string
  onChanged: () => void
}) {
  const [clientId, setClientId] = useState(settings.clientId)
  const [spreadsheet, setSpreadsheet] = useState(settings.spreadsheetId)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState('')
  const email = connectedEmail()
  const nextCheck = reconsentDate()
  // 토큰이 없어도 기억한 계정이 남아 있으면 지울 수 있어야 한다. 잘못된 계정이 hint 로 계속 쓰이는 걸 막는다.
  const canSignOut = signedIn || hasRememberedAccount()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const id = normalizeClientId(clientId)
    const sheet = extractSpreadsheetId(spreadsheet)
    const why = clientIdProblem(id) || (sheet ? '' : '스프레드시트 주소를 입력하세요.')
    setProblem(why)
    setSaved(false)
    if (why) return
    setClientId(id)
    onSave({ clientId: id, spreadsheetId: sheet })
    setSaved(true)
  }

  return (
    <>
      <Notice kind="info">
        두 값은 이 기기의 브라우저에만 저장됩니다. 저장소나 서버에는 올라가지 않습니다.
      </Notice>

      <Card title="연결 설정">
        <form onSubmit={submit}>
          <Field label="Google OAuth 클라이언트 ID">
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="스프레드시트 ID 또는 전체 주소">
            <input
              value={spreadsheet}
              onChange={(e) => setSpreadsheet(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..../edit"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="actions">
            <button className="primary" type="submit">
              저장하고 연결
            </button>
            {canSignOut && (
              <button type="button" className="ghost" onClick={onSignOut}>
                로그아웃
              </button>
            )}
          </div>
          {problem && (
            <p className="meta" style={{ marginTop: 10, color: 'var(--bad)' }}>
              {problem}
            </p>
          )}
          {saved && <p className="meta" style={{ marginTop: 10 }}>저장했습니다.</p>}
        </form>
      </Card>

      <Card title="로그인이 막혔을 때">
        <ul style={{ paddingLeft: 18, margin: 0, color: 'var(--muted)', fontSize: 14 }}>
          <li>
            구글 창에 <b>Error 401: invalid_client</b> 가 뜨면 위 클라이언트 ID 가 틀린 것입니다. 구글 창을 닫고
            여기서 고친 뒤 저장하면 다시 연결합니다.
          </li>
          <li>
            <b>Error 403: access_denied</b> 는 그 계정이 테스트 사용자에 없다는 뜻입니다. 다른 계정으로 들어갔다면
            로그아웃 후 다시 연결합니다.
          </li>
          <li>그래도 반응이 없으면 아래 버튼으로 앱을 다시 불러옵니다. 입력한 설정은 남습니다.</li>
        </ul>
        <div className="actions" style={{ marginTop: 10 }}>
          <button type="button" className="ghost" onClick={() => window.location.reload()}>
            앱 다시 불러오기
          </button>
        </div>
      </Card>

      <SalarySettings workbook={workbook} ctx={ctx} today={today} onChanged={onChanged} />

      <Card title="로그인 유지">
        <p className="meta" style={{ margin: 0 }}>
          {signedIn ? '연결돼 있습니다.' : '지금은 연결돼 있지 않습니다.'}
          {email && ` 계정 ${email}.`}
          {nextCheck && ` 다음 재검증 ${nextCheck}.`}
        </p>
        <p className="meta" style={{ marginTop: 8 }}>
          서버가 없어 구글이 1시간짜리 토큰만 줍니다. 토큰은 이 기기에 남겨 두어 1시간 안에는 아무것도 묻지 않고,
          그 뒤에는 창이 잠깐 떴다 저절로 닫힙니다(같은 계정을 기억해 계정 선택도 건너뜁니다).
          동의 화면은 30일에 한 번만 다시 뜹니다. 로그아웃하면 기억한 계정도 지웁니다.
        </p>
      </Card>

      <Card title="처음 여는 경우">
        <ol style={{ paddingLeft: 18, margin: 0, color: 'var(--muted)', fontSize: 14 }}>
          <li>Google Cloud 콘솔에서 OAuth 2.0 클라이언트 ID(웹 애플리케이션)를 만듭니다.</li>
          <li>승인된 JavaScript 원본에 이 페이지의 주소를 넣습니다.</li>
          <li>같은 프로젝트에서 Google Sheets API 를 사용 설정합니다.</li>
          <li>시트 주소를 위 칸에 붙여 넣고 저장합니다.</li>
        </ol>
        <p className="meta" style={{ marginTop: 10 }}>
          자세한 절차는 저장소의 docs/SETUP.md 에 있습니다.
        </p>
      </Card>
    </>
  )
}
