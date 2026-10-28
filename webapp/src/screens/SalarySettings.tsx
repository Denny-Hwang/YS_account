import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { biweeklyPaydays, biweeklyRuleString } from '@shared/LedgerRules.js'
import { Card, Empty, Field } from '../components/Ui'
import { TABS, configNumber, isReserved, patchIn, patchTransaction, recurringTypeOf, shiftMonth, type SheetRow, type Workbook } from '../lib/ledger'
import { perCheckOf } from '../lib/metrics'
import type { SheetsContext } from '../lib/sheets'

/** 2주급 규칙에서 기준 급여일. 2주급이 아니면 빈 문자열. */
function anchorOf(row: SheetRow): string {
  const m = /@(\d{4}-\d{2}-\d{2})$/.exec(String(row.amount_rule ?? '').trim())
  return m ? m[1] : ''
}

/**
 * 설정 › 급여. 2주급 1회 금액(평균)과 기준 급여일을 고친다. 급여 인상·승진 때 여기만 바꾸면 된다.
 * 저장하면 Recurring.amount_rule 을 'biweekly:<금액>@<기준일>' 로 쓰고,
 * 오늘 이후 아직 확정되지 않은 급여 예정 행의 금액도 새 금액으로 맞춘다. 이미 들어온(확정된) 급여는 건드리지 않는다.
 */
export function SalarySettings({
  workbook,
  ctx,
  today,
  onChanged,
}: {
  workbook: Workbook | null
  ctx: SheetsContext
  today: string
  onChanged: () => void
}) {
  if (!workbook) {
    return (
      <Card title="급여 (2주급)">
        <Empty>구글 계정을 연결하면 급여 금액과 기준 급여일을 고칠 수 있습니다.</Empty>
      </Card>
    )
  }
  const sources = workbook.recurring.filter(
    (r) => recurringTypeOf(r) === 'income' && String(r.kind || 'fixed').trim() === 'fixed' && String(r.active).trim().toUpperCase() !== 'N'
  )
  return (
    <Card title="급여 (2주급)">
      {sources.length === 0 ? (
        <Empty>고정 수입원이 없습니다. 수입 탭에서 "수입원 추가" 로 급여를 먼저 만드세요.</Empty>
      ) : (
        sources.map((row) => <SalaryForm key={String(row.id)} row={row} workbook={workbook} ctx={ctx} today={today} onChanged={onChanged} />)
      )}
    </Card>
  )
}

function SalaryForm({ row, workbook, ctx, today, onChanged }: { row: SheetRow; workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const current = perCheckOf(row)
  const [amount, setAmount] = useState(current ? String(current) : '')
  const [anchor, setAnchor] = useState(anchorOf(row))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const name = String(row.name || row.id)
  const rule = biweeklyRuleString(Number(amount), anchor)
  const thisMonth = today.slice(0, 7)
  const preview = rule ? [thisMonth, shiftMonth(thisMonth, 1), shiftMonth(thisMonth, 2)].flatMap((m) => biweeklyPaydays(m, anchor)).filter((d) => d >= today).slice(0, 4) : []

  async function save() {
    if (!rule) {
      setMessage({ ok: false, text: '1회 금액(0보다 큰 숫자)과 기준 급여일을 모두 넣으세요.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const perCheck = Number(amount)
      // expected_amount 는 규칙을 못 읽을 때의 대체값이다. 보통 달(두 번)로 둔다.
      await patchIn(ctx, workbook, TABS.recurring, row, { amount_rule: rule, expected_amount: Math.round(perCheck * 2 * 100) / 100 })
      const currency = String(row.currency || 'USD').trim().toUpperCase()
      const fx = configNumber(workbook.config, 'fx_usd_krw', 1332)
      const amountUsd = currency === 'KRW' ? Math.round((perCheck / fx) * 100) / 100 : perCheck
      const pending = workbook.transactions.filter(
        (t) => String(t.recurring_id).trim() === String(row.id).trim() && isReserved(t) && String(t.date).slice(0, 10) >= today
      )
      for (const t of pending) {
        await patchTransaction(ctx, workbook, t, { amount: perCheck, amount_usd: amountUsd, updated_by: 'web' })
      }
      setMessage({ ok: true, text: `저장했습니다.${pending.length ? ` 남은 예정 ${pending.length}건 금액도 바꿨습니다.` : ''}` })
      onChanged()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <p className="meta" style={{ marginTop: 0 }}>
        <strong>{name}</strong>
        {current ? ` · 지금 1회 ${formatUsd(current)}, 기준일 ${anchorOf(row)}` : ' · 아직 2주급이 아닙니다. 저장하면 2주급으로 바뀝니다.'}
      </p>
      <Field label="1회 금액 (평균, 인상·승진 때 고치세요)">
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 3000" />
      </Field>
      <Field label="기준 급여일 (실제로 받은 날 하나, 2주 간격으로 셉니다)">
        <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
      </Field>
      {preview.length > 0 && <p className="meta">다음 급여일: {preview.map((d) => d.slice(5)).join(', ')}</p>}
      <div className="actions">
        <button className="primary" onClick={() => void save()} disabled={busy}>
          급여 저장
        </button>
      </div>
      {message && (
        <p className="meta" style={{ marginTop: 8, color: message.ok ? undefined : 'var(--bad)' }}>
          {message.text}
        </p>
      )}
    </div>
  )
}
