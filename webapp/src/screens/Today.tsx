import { useMemo, useState } from 'react'
import { envelopeStatus, formatUsd } from '@shared/Budget.js'
import { parseMessage } from '@shared/Parser.js'
import { classify } from '@shared/Classifier.js'
import { Card, Empty, Notice } from '../components/Ui'
import {
  appendTransaction,
  budgetAmount,
  configList,
  configNumber,
  monthTransactions,
  newTxId,
  nowIso,
  type SheetRow,
  type Workbook,
} from '../lib/ledger'
import type { SheetsContext } from '../lib/sheets'

function shiftDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return dt.toISOString().slice(0, 10)
}

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

  const yesterday = shiftDays(today, -1)
  const sumOn = (day: string) =>
    transactions
      .filter(
        (row) =>
          String(row.date).slice(0, 10) === day &&
          String(row.type) === 'expense' &&
          String(row.kind) === 'variable' &&
          ['active', 'confirmed'].includes(String(row.status))
      )
      .reduce((acc, row) => acc + (Number(row.amount_usd) || 0), 0)

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
      })
      if (!parsed || parsed.intent !== 'record' || parsed.amount === null) {
        setMessage({ kind: 'error', text: '금액을 읽지 못했습니다. "코스트코 85.89" 처럼 적어 주세요.' })
        return
      }
      const merchants = workbook.merchants as unknown as Array<Record<string, unknown>>
      const hit =
        classify(parsed.merchantText, merchants) ||
        classify(parsed.merchantTextRaw, merchants)

      const now = nowIso()
      const row: Record<string, unknown> = {
        id: newTxId(),
        date: parsed.date,
        type: String(hit?.type ?? parsed.type ?? 'expense'),
        kind: String(hit?.kind ?? 'variable'),
        category: String(hit?.category ?? ''),
        envelope: String(hit?.envelope ?? (envelopes[0] ?? '')),
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
      setMessage({
        kind: 'info',
        text: `${row.merchant || '항목'} ${formatUsd(Number(row.amount_usd))} 기록했습니다.`,
      })
      onChanged()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <Card title="빠른 입력">
        <form onSubmit={submitQuick} className="row">
          <input
            className="grow"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="코스트코 85.89"
            enterKeyHint="done"
            autoComplete="off"
          />
          <button className="primary" type="submit" disabled={busy || !quick.trim()}>
            {busy ? '기록 중' : '기록'}
          </button>
        </form>
        <p className="meta" style={{ marginTop: 8 }}>
          텔레그램 봇과 같은 파서를 씁니다. "어제", "9/8", "5만원" 도 알아봅니다.
        </p>
      </Card>

      {statuses.length === 0 ? (
        <Empty>Config 탭의 envelopes 가 비어 있습니다.</Empty>
      ) : (
        statuses.map(({ envelope, status }) => {
          const used = status.budget > 0 ? Math.min(status.spentTotal / status.budget, 1) : 0
          const over = status.remaining < 0
          return (
            <section className="card" key={envelope}>
              <div className="row">
                <span className="envelope-name">{envelope}</span>
                <span className="meta">예산 {formatUsd(status.budget)}</span>
              </div>
              <p className={`allowance${status.allowanceToday < 0 ? ' negative' : ''}`}>
                {formatUsd(status.allowanceToday)}
                <span className="meta" style={{ fontSize: 14, fontWeight: 400 }}> / 오늘</span>
              </p>
              <p className="meta">
                잔액 {formatUsd(status.remaining)} · 남은 {status.remainingDays}일 · 계획 대비{' '}
                {status.deltaVsPlan >= 0 ? '+' : '-'}
                {formatUsd(Math.abs(status.deltaVsPlan))}
              </p>
              <div className="bar">
                <span className={over ? 'over' : ''} style={{ width: `${Math.round(used * 100)}%` }} />
              </div>
              {status.spentToday > 0 && (
                <p className="meta" style={{ marginTop: 8 }}>
                  오늘 이미 {formatUsd(status.spentToday)} 썼습니다.
                </p>
              )}
            </section>
          )
        })
      )}

      <Card title="최근 지출">
        <div className="row">
          <span className="meta">어제</span>
          <span>{formatUsd(sumOn(yesterday))}</span>
        </div>
        <div className="row">
          <span className="meta">오늘</span>
          <span>{formatUsd(sumOn(today))}</span>
        </div>
      </Card>
    </>
  )
}

export type { SheetRow }
