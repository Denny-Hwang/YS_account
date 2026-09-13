import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Bullet, LineChart, RankBars, Stat } from '../components/Charts'
import { RowSheet } from '../components/RowSheet'
import { Card, Empty, Notice } from '../components/Ui'
import { TABS, latestAssetsTotal, monthsBack, nextIdFor, type SheetRow, type Workbook } from '../lib/ledger'
import { assetsHistory, averageNet, debtSchedule, monthlyTotals } from '../lib/metrics'
import type { SheetsContext } from '../lib/sheets'

type Editing = SheetRow | 'new' | null

/** 부채. 원금 순위와 상환 종료 시점을 함께 본다. */
export function Debts({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)
  const debts = debtSchedule(workbook, today)
  const totalPrincipal = debts.reduce((a, d) => a + d.principalUsd, 0)
  const totalMonthly = debts.reduce((a, d) => a + d.monthlyUsd, 0)
  const longest = Math.max(0, ...debts.map((d) => d.remaining))
  const weightedRate = totalPrincipal > 0 ? debts.reduce((a, d) => a + d.rate * d.principalUsd, 0) / totalPrincipal : 0

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}
      <Card action={<button onClick={() => setEditing('new')}>추가</button>}>
        <div className="stat-row">
          <Stat label="남은 원금" value={formatUsd(totalPrincipal)} />
          <Stat label="월 상환 합계" value={formatUsd(totalMonthly)} size="md" sub={`가중 평균 이율 ${weightedRate.toFixed(1)}%`} />
        </div>
      </Card>

      {debts.length === 0 ? (
        <Empty>등록된 부채가 없습니다.</Empty>
      ) : (
        <>
          <Card title="원금 구성">
            <RankBars
              items={debts.map((d) => ({ name: d.name, value: d.principalUsd, hint: `${d.rate}%` }))}
              onSelect={(name) => {
                const hit = debts.find((d) => d.name === name)
                if (hit) setEditing(hit.row)
              }}
            />
          </Card>
          <Card title="상환 종료까지">
            <RankBars
              items={debts
                .slice()
                .sort((a, b) => a.remaining - b.remaining)
                .map((d) => ({ name: d.name, value: d.remaining, hint: `${d.payoff} 종료 · 월 ${formatUsd(d.monthlyUsd)}` }))}
              tone="plan"
              format={(n) => `${n}개월`}
            />
            <p className="meta" style={{ marginTop: 10 }}>
              가장 오래 남은 것은 {longest}개월입니다. 먼저 끝나는 것부터 월 상환액이 줄어듭니다. 항목을 누르면 고칠 수 있습니다.
            </p>
          </Card>
        </>
      )}

      {editing && (
        <RowSheet
          title={editing === 'new' ? '부채 추가' : '부채 수정'}
          tab={TABS.debts}
          row={editing === 'new' ? null : editing}
          workbook={workbook}
          ctx={ctx}
          fields={[
            { key: 'name', label: '이름' },
            { key: 'principal', label: '남은 원금', numeric: true },
            { key: 'rate_pct', label: '연이율 (%)', numeric: true },
            { key: 'monthly_payment', label: '월 상환액', numeric: true },
            { key: 'remaining_count', label: '남은 회차', numeric: true },
            { key: 'currency', label: '통화', options: ['USD', 'KRW'] },
            { key: 'notes', label: '메모' },
          ]}
          defaults={{ id: nextIdFor(workbook.debts, 'D'), currency: 'USD' }}
          onClose={() => setEditing(null)}
          onError={setError}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

/** 자산. 스냅샷 추이와 최신 구성. */
export function Assets({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = latestAssetsTotal(workbook)
  const history = assetsHistory(workbook)
  const rows = workbook.assets.filter((row) => String(row.snapshot_date).slice(0, 10) === latest.date)
  const prev = history.length >= 2 ? history[history.length - 2] : null
  const change = prev ? latest.total - prev.total : null

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}
      <Card action={<button onClick={() => setEditing('new')}>스냅샷 추가</button>}>
        <div className="stat-row">
          <Stat label="자산 합계" value={formatUsd(latest.total)} sub={latest.date ? `${latest.date} 기준` : '기록 없음'} />
          {change !== null && prev && (
            <Stat label={`${prev.date} 대비`} value={`${change >= 0 ? '+' : '-'}${formatUsd(Math.abs(change))}`} size="md" tone={change >= 0 ? 'good' : 'bad'} />
          )}
        </div>
      </Card>

      {history.length >= 2 && (
        <Card title="자산 추이">
          <LineChart series={[{ label: '자산 합계', points: history.map((h) => h.total), tone: 'income' }]} xLabels={history.map((h) => h.date.slice(2, 7))} />
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty>자산 스냅샷이 없습니다. 같은 날짜로 계좌별 잔액을 넣으세요.</Empty>
      ) : (
        <Card title={`${latest.date} 구성`}>
          <RankBars
            items={rows.map((row) => {
              const bal = Number(row.balance) || 0
              const fx = Number(workbook.config.fx_usd_krw) || 1332
              return { name: String(row.account), value: String(row.currency).toUpperCase() === 'KRW' ? Math.round((bal / fx) * 100) / 100 : bal, hint: String(row.currency) }
            })}
            tone="income"
            onSelect={(name) => {
              const hit = rows.find((r) => String(r.account) === name)
              if (hit) setEditing(hit)
            }}
          />
          <p className="meta" style={{ marginTop: 10 }}>새 스냅샷은 같은 날짜로 계좌마다 한 줄씩 넣습니다. 추이는 날짜별 합계로 그립니다.</p>
        </Card>
      )}

      {editing && (
        <RowSheet
          title={editing === 'new' ? '자산 추가' : '자산 수정'}
          tab={TABS.assets}
          row={editing === 'new' ? null : editing}
          workbook={workbook}
          ctx={ctx}
          fields={[
            { key: 'snapshot_date', label: '기준일', type: 'date' },
            { key: 'account', label: '계좌' },
            { key: 'balance', label: '잔액', numeric: true },
            { key: 'currency', label: '통화', options: ['USD', 'KRW'] },
          ]}
          defaults={{ snapshot_date: today, currency: 'USD' }}
          onClose={() => setEditing(null)}
          onError={setError}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

/** 목표. 진행률과, 최근 순저축 속도로 본 도달 예상. */
export function Goals({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)
  const assets = latestAssetsTotal(workbook)
  const avg = averageNet(monthlyTotals(workbook, monthsBack(today.slice(0, 7), 6)))

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}
      <Card action={<button onClick={() => setEditing('new')}>추가</button>}>
        <div className="stat-row">
          <Stat label="현재 자산" value={formatUsd(assets.total)} size="md" sub={assets.date || '스냅샷 없음'} />
          <Stat label="최근 6개월 월평균 순저축" value={formatUsd(avg)} size="md" tone={avg < 0 ? 'bad' : undefined} />
        </div>
      </Card>

      {workbook.goals.length === 0 ? (
        <Empty>등록된 목표가 없습니다.</Empty>
      ) : (
        <Card title="목표별 진행">
          {workbook.goals.map((row) => {
            const target = Number(row.target_amount) || 0
            const gap = Math.max(target - assets.total, 0)
            const months = avg > 0 && gap > 0 ? Math.ceil(gap / avg) : null
            const eta = months !== null ? monthsBack(today.slice(0, 7), 1)[0] && (() => {
              const [y, m] = today.slice(0, 7).split('-').map(Number)
              const d = new Date(Date.UTC(y, m - 1 + months, 1))
              return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
            })() : null
            return (
              <Bullet
                key={String(row.id) || row._row}
                label={
                  <>
                    {String(row.title)} <span className="pill">{String(row.horizon)}</span>
                  </>
                }
                value={Math.min(assets.total, target)}
                target={target}
                tone="income"
                hint={
                  gap === 0
                    ? '도달했습니다'
                    : months !== null
                      ? `${formatUsd(gap)} 남음 · 지금 속도면 ${months}개월 뒤(${eta})${String(row.deadline) ? ` · 목표일 ${String(row.deadline)}` : ''}`
                      : `${formatUsd(gap)} 남음 · 순저축이 양수가 되면 예상 시점을 계산합니다`
                }
                onClick={() => setEditing(row)}
              />
            )
          })}
        </Card>
      )}

      {editing && (
        <RowSheet
          title={editing === 'new' ? '목표 추가' : '목표 수정'}
          tab={TABS.goals}
          row={editing === 'new' ? null : editing}
          workbook={workbook}
          ctx={ctx}
          fields={[
            { key: 'title', label: '목표' },
            { key: 'horizon', label: '기간', options: [{ value: 'short', label: '단기' }, { value: 'mid', label: '중기' }, { value: 'long', label: '장기' }] },
            { key: 'target_amount', label: '목표 금액 (USD)', numeric: true },
            { key: 'deadline', label: '목표일', type: 'date' },
            { key: 'notes', label: '메모' },
          ]}
          defaults={{ id: nextIdFor(workbook.goals, 'G'), horizon: 'mid' }}
          onClose={() => setEditing(null)}
          onError={setError}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
