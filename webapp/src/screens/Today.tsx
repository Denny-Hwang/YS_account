import { useMemo, useState } from 'react'
import { envelopeStatus, formatSigned, formatUsd, remainingDaysInclToday, signalGlyph } from '@shared/Budget.js'
import { parseMessage } from '@shared/Parser.js'
import { classify } from '@shared/Classifier.js'
import { matchRecurringName } from '@shared/LedgerRules.js'
import { Bullet, MonthlyBars, Stat } from '../components/Charts'
import { Card, Empty, Notice } from '../components/Ui'
import { budgetAmount, configList, configNumber, monthTransactions, recordParsed, type Workbook } from '../lib/ledger'
import { emergencyFund, recentDaily, savingsPlan } from '../lib/metrics'
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
  const leftTotal = statuses.reduce((a, s) => a + s.status.allowanceLeftToday, 0)
  const allowanceTotal = statuses.reduce((a, s) => a + s.status.allowanceToday, 0)
  const remainingTotal = statuses.reduce((a, s) => a + s.status.remaining, 0)
  const spentTodayTotal = statuses.reduce((a, s) => a + s.status.spentToday, 0)
  const remainingDays = remainingDaysInclToday(today)
  const worst = statuses.some((s) => s.status.signal === 'red') ? 'red' : statuses.some((s) => s.status.signal === 'yellow') ? 'yellow' : 'green'
  const week = recentDaily(workbook, today, 7)
  const savings = savingsPlan(workbook, month)
  const fund = emergencyFund(workbook, month)

  async function submitQuick(e: React.FormEvent) {
    e.preventDefault()
    const text = quick.trim()
    if (!text || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const parsed = parseMessage(text, {
        today,
        defaultCurrency: workbook.config.default_currency || 'USD',
        fxUsdKrw: fx,
        incomeHints: configList(workbook.config, 'income_hints'),
      })
      if (!parsed || parsed.intent !== 'record' || parsed.amount === null) {
        setMessage({ kind: 'error', text: '금액을 읽지 못했습니다. "코스트코 85.89" 처럼 적어 주세요.' })
        return
      }
      if (parsed.ambiguous) {
        setMessage({ kind: 'error', text: `금액이 여럿입니다 (${parsed.amountCandidates.map((c) => c.amount).join(', ')}). 하나만 남겨 주세요.` })
        return
      }
      const merchants = workbook.merchants as unknown as Array<Record<string, unknown>>
      let hit = classify(parsed.merchantText, merchants) || classify(parsed.merchantTextRaw, merchants)
      if (!hit) {
        const def = matchRecurringName(parsed.merchantTextRaw || parsed.merchantText, workbook.recurring as unknown as Array<Record<string, unknown>>)
        if (def) hit = { recurring_id: def.id, type: def.type, kind: def.kind, category: def.category, envelope: '' }
      }
      const result = await recordParsed(ctx, workbook, parsed, hit, 'web')
      setQuick('')
      const amount = formatUsd(Math.abs(Number(parsed.amount_usd)))
      setMessage({
        kind: 'info',
        text:
          result.mode === 'confirm'
            ? `${result.name} ${amount} 확정했습니다.${result.nth > 1 ? ` (이번 달 ${result.nth}번째)` : ''}`
            : result.mode === 'refund'
              ? `${result.name} ${amount} 환불로 기록했습니다.`
              : `${result.name} ${amount} 기록했습니다.`,
      })
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
            label={`${signalGlyph(worst)} 오늘 남은 돈`}
            value={formatUsd(leftTotal)}
            tone={leftTotal < 0 ? 'bad' : undefined}
            sub={`하루치 ${formatUsd(allowanceTotal)} · 남은 ${remainingDays}일${spentTodayTotal !== 0 ? ` · 오늘 ${formatUsd(spentTodayTotal)} 씀` : ''}`}
          />
          <Stat label="이달 남은 유동비" value={formatUsd(remainingTotal)} size="md" sub={`봉투 ${statuses.length}개 합산`} />
        </div>
        <form onSubmit={submitQuick} className="row" style={{ marginTop: 14 }}>
          <input className="grow" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="코스트코 85.89 · 환불 코스트코 20" enterKeyHint="done" autoComplete="off" />
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
              label={`${signalGlyph(status.signal)} ${envelope}`}
              value={status.spentTotal}
              target={status.budget}
              pace={status.plannedPaceToDate}
              hint={
                <>
                  오늘 남은 {formatUsd(status.allowanceLeftToday)} · 하루치 {formatUsd(status.allowanceToday)} · 잔액 {formatUsd(status.remaining)} · 계획 대비{' '}
                  {formatSigned(status.deltaVsPlan)}
                </>
              }
            />
          ))
        )}
        <p className="meta" style={{ marginTop: 10 }}>
          🟢 계획 안 · 🟡 계획보다 앞서 씀(예산의 10% 이내) · 🔴 그 이상 또는 봉투 초과. 회색 트랙이 예산, 색 막대가 실제, 검은 눈금이 오늘까지의 계획 진도입니다.
        </p>
      </Card>

      {savings.expected > 0 && (
        <Card title="이달 저축 (먼저 저축)">
          <Bullet
            label="저축"
            value={savings.actual}
            target={savings.expected}
            tone="income"
            hint={savings.actual >= savings.expected ? '이달 저축 목표를 채웠습니다' : `${formatUsd(savings.expected - savings.actual)} 남음 · 옮긴 뒤 봇에 "저축 금액" 을 보내면 확정됩니다`}
          />
        </Card>
      )}

      {fund.monthly > 0 && (
        <Card title={`비상금 (고정비 ${fund.months}개월치)`}>
          <Bullet
            label="비상금"
            value={Math.min(fund.assets, fund.target)}
            target={fund.target}
            tone="income"
            hint={
              fund.assetsDate
                ? `자산 ${formatUsd(fund.assets)} (${fund.assetsDate}) = 고정비 ${fund.covered ?? 0}개월분 · 목표 ${formatUsd(fund.target)}`
                : `자산 스냅샷이 없습니다. 더보기 › 자산에서 잔액을 넣으면 몇 개월분인지 보입니다 · 목표 ${formatUsd(fund.target)}`
            }
          />
        </Card>
      )}

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
