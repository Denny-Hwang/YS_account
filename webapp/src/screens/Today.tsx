import { useMemo, useState } from 'react'
import { envelopeStatus, formatUsd, remainingDaysInclToday } from '@shared/Budget.js'
import { parseMessage } from '@shared/Parser.js'
import { classify } from '@shared/Classifier.js'
import { Bullet, MonthlyBars, Stat } from '../components/Charts'
import { Card, Empty, Notice } from '../components/Ui'
import { appendTransaction, budgetAmount, configList, configNumber, monthTransactions, newTxId, nowIso, type Workbook } from '../lib/ledger'
import { recentDaily } from '../lib/metrics'
import type { SheetsContext } from '../lib/sheets'

export function Today({
  workbook,
  ctx,
  today,
  onChanged,
}: {
  workbook: Workbook
  ctx: SheetsContext
  today: string
  onChanged: () => void
}) {
  const [quick, setQuick] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  const month = today.slice(0, 7)
  const envelopes = configList(workbook.config, 'envelopes')
  const fx = configNumber(workbook.config, 'fx_usd_krw', 1332)
  const transactions = useMemo(() => monthTransactions(workbook, month), [workbook, month])

  const statuses = envelopes.map((envelope) => ({
    envelope,
    status: envelopeStatus({
      budget: budgetAmount(workbook, month, envelope),
      transactions: transactions as unknown as Array<Record<string, unknown>>,
      envelope,
      today,
    }),
  }))
  const allowanceTotal = statuses.reduce((a, s) => a + s.status.allowanceToday, 0)
  const remainingTotal = statuses.reduce((a, s) => a + s.status.remaining, 0)
  const spentTodayTotal = statuses.reduce((a, s) => a + s.status.spentToday, 0)
  const remainingDays = remainingDaysInclToday(today)
  const week = recentDaily(workbook, today, 7)

  async function submitQuick(e: React.FormEvent) {
    e.preventDefault()
    const text = quick.trim()
    if (!text || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const parsed = parseMessage(text, { today, defaultCurrency: workbook.config.default_currency || 'USD', fxUsdKrw: fx })
      if (!parsed || parsed.intent !== 'record' || parsed.amount === null) {
        setMessage({ kind: 'error', text: '금액을 읽지 못했습니다. "코스트코 85.89" 처럼 적어 주세요.' })
        return
      }
      const merchants = workbook.merchants as unknown as Array<Record<string, unknown>>
      const hit = classify(parsed.merchantText, merchants) || classify(parsed.merchantTextRaw, merchants)
      const now = nowIso()
      const type = String(hit?.type ?? parsed.type ?? 'expense')
      const row: Record<string, unknown> = {
        id: newTxId(),
        date: parsed.date,
        type,
        kind: String(hit?.kind ?? 'variable'),
        category: String(hit?.category ?? ''),
        // 수입은 봉투가 없다. 지출인데 사전에 없으면 첫 봉투로 넣고 원장에서 고친다.
        envelope: type === 'income' ? '' : String(hit?.envelope ?? (envelopes[0] ?? '')),
        merchant: parsed.merchantTextRaw || parsed.merchantText,
        amount: parsed.amount,
        currency: parsed.currency,
        amount_usd: parsed.amount_usd ?? 0,
        recurring_id: '',
        status: 'active',
        memo: parsed.confidence === 'low' ? text : '',
        payer: '',
        source: 'web',
        created_at: now,
        updated_at: now,
        updated_by: 'web',
      }
      await appendTransaction(ctx, workbook, row)
      setQuick('')
      setMessage({ kind: 'info', text: `${row.merchant || '항목'} ${formatUsd(Number(row.amount_usd))} 기록했습니다.` })
      onChanged()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="viz">
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <Card>
        <div className="stat-row">
          <Stat
            label="오늘 쓸 수 있는 돈"
            value={formatUsd(allowanceTotal)}
            tone={allowanceTotal < 0 ? 'bad' : undefined}
            sub={`봉투 ${statuses.length}개 합산 · 남은 ${remainingDays}일`}
          />
          <Stat label="이달 남은 유동비" value={formatUsd(remainingTotal)} size="md" sub={spentTodayTotal > 0 ? `오늘 ${formatUsd(spentTodayTotal)} 씀` : '오늘 아직 지출 없음'} />
        </div>
        <form onSubmit={submitQuick} className="row" style={{ marginTop: 14 }}>
          <input className="grow" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="코스트코 85.89" enterKeyHint="done" autoComplete="off" />
          <button className="primary" type="submit" disabled={busy || !quick.trim()}>
            {busy ? '기록 중' : '기록'}
          </button>
        </form>
      </Card>

      <Card title="봉투별 진행">
        {statuses.length === 0 ? (
          <Empty>Config 탭의 envelopes 가 비어 있습니다.</Empty>
        ) : (
          statuses.map(({ envelope, status }) => (
            <Bullet
              key={envelope}
              label={envelope}
              value={status.spentTotal}
              target={status.budget}
              pace={status.plannedPaceToDate}
              hint={
                <>
                  오늘 {formatUsd(status.allowanceToday)}/일 · 잔액 {formatUsd(status.remaining)} · 계획 대비{' '}
                  {status.deltaVsPlan >= 0 ? '+' : '-'}
                  {formatUsd(Math.abs(status.deltaVsPlan))}
                </>
              }
            />
          ))
        )}
        <p className="meta" style={{ marginTop: 10 }}>
          회색 트랙이 예산, 색 막대가 실제, 검은 눈금이 오늘까지의 계획 진도입니다. 막대가 눈금 왼쪽이면 계획보다 덜 쓴 것입니다.
        </p>
      </Card>

      <Card title="최근 7일 유동비">
        <MonthlyBars months={week.map((d) => d.day.slice(5))} series={[{ label: '지출', values: week.map((d) => d.value), tone: 'expense' }]} height={90} />
        <div className="row" style={{ marginTop: 6 }}>
          <span className="meta">7일 합계 {formatUsd(week.reduce((a, d) => a + d.value, 0))}</span>
          <span className="meta">하루 평균 {formatUsd(week.reduce((a, d) => a + d.value, 0) / 7)}</span>
        </div>
      </Card>
    </div>
  )
}
