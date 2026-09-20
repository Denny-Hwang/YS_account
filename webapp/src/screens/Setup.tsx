import { useState } from 'react'
import { Card, Field, Notice } from '../components/Ui'
import { connectedEmail, reconsentDate } from '../lib/auth'
import { extractSpreadsheetId, type Settings } from '../lib/settings'

export function Setup({
  settings,
  onSave,
  onSignOut,
  signedIn,
}: {
  settings: Settings
  onSave: (next: Settings) => void
  onSignOut: () => void
  signedIn: boolean
}) {
  const [clientId, setClientId] = useState(settings.clientId)
  const [spreadsheet, setSpreadsheet] = useState(settings.spreadsheetId)
  const [saved, setSaved] = useState(false)
  const email = connectedEmail()
  const nextCheck = reconsentDate()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSave({
      clientId: clientId.trim(),
      spreadsheetId: extractSpreadsheetId(spreadsheet),
    })
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
            {signedIn && (
              <button type="button" className="ghost" onClick={onSignOut}>
                로그아웃
              </button>
            )}
          </div>
          {saved && <p className="meta" style={{ marginTop: 10 }}>저장했습니다.</p>}
        </form>
      </Card>

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
