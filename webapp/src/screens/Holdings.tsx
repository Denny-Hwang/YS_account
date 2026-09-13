import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Bullet, LineChart, RankBars, Stat } from '../components/Charts'
import { RowSheet } from '../components/RowSheet'
import { Card, Empty, Notice } from '../components/Ui'
import { TABS, assetUsd, latestAssetsTotal, monthsBack, nextIdFor, type SheetRow, type Workbook } from '../lib/ledger'
import { assetsHistory, averageNet, debtOverview, debtSchedule, emergencyFund, monthlyTotals } from '../lib/metrics'
import type { SheetsContext } from '../lib/sheets'

type Editing = SheetRow | 'new' | null

/** 부채. 원금 순위, 이자 반영 상환 종료, 눈사태(이율 높은 것 먼저) 안내. */
export function Debts({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)
  const debts = debtSchedule(workbook, today)
  const overview = debtOverview(debts)
  const longest = Math.max(0, ...debts.map((d) => d.amortized ?? d.remaining))
  const recurringOptions = workbook.recurring
    .filter((r) => String(r.type ?? 'expense').trim().toLowerCase() !== 'income')
    .map((r) => ({ value: String(r.id), label: `${String(r.id)} ${String(r.name)}` }))

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}
      <Card action={<button onClick={() => setEditing('new')}>추가</button>}>
        <div className="stat-row">
          <Stat label="남은 원금" value={formatUsd(overview.totalPrincipal)} />
          <Stat label="월 상환 합계" value={formatUsd(overview.totalMonthly)} size="md" sub={`가중 평균 이율 ${overview.weightedRate.toFixed(1)}%`} />
        </div>
        {overview.avalanche && (
          <p className="meta" style={{ marginTop: 10 }}>
            여유 자금은 이율이 가장 높은 <strong>{overview.avalanche.name}</strong>({overview.avalanche.rate}%)에 먼저. $100 를 더 갚으면 연 이자 약 {formatUsd((100 * overview.avalanche.rate) / 100)} 가 줄어듭니다.
          </p>
        )}
        {overview.krwPrincipalUsd > 0 && (
          <p className="meta" style={{ marginTop: 6 }}>
            원화 부채 {formatUsd(overview.krwPrincipalUsd)} 는 Config.fx_usd_krw 로 환산한 값이라 환율에 따라 달러 표시가 움직입니다.
          </p>
        )}
      </Card>

      {debts.length === 0 ? (
        <Empty>등록된 부채가 없습니다.</Empty>
      ) : (
        <>
          <Card title="원금 구성">
            <RankBars
              items={debts.map((d) => ({ name: d.name, value: d.principalUsd, hint: `${d.rate}%${d.linked ? ` · ${d.linked} 확정 시 자동 감소` : ''}` }))}
              onSelect={(name) => {
                const hit = debts.find((d) => d.name === name)
                if (hit) setEditing(hit.row)
              }}
            />
          </Card>
          <Card title="상환 종료까지 (이자 반영)">
            <RankBars
              items={debts
                .slice()
                .sort((a, b) => (a.amortized ?? a.remaining) - (b.amortized ?? b.remaining))
                .map((d) => ({
                  name: d.name,
                  value: d.amortized ?? d.remaining,
                  hint:
                    d.amortized === null
                      ? `월 ${formatUsd(d.monthlyUsd)} 로는 이자도 못 갚습니다`
                      : `${d.payoff} 종료 · 월 ${formatUsd(d.monthlyUsd)}${d.amortized !== d.remaining ? ` · 시트 회차 ${d.remaining}` : ''}`,
                }))}
              tone="plan"
              format={(n) => `${n}개월`}
            />
            <p className="meta" style={{ marginTop: 10 }}>
              가장 오래 남은 것은 {longest}개월입니다. 원금·이율·월 상환액으로 계산한 값이라 시트의 남은 회차와 다를 수 있습니다. 항목을 누르면 고칠 수 있습니다.
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
            { key: 'recurring_id', label: '연결 고정비 (확정할 때 원금이 줄어듭니다)', options: [{ value: '', label: '(없음)' }, ...recurringOptions] },
            { key: 'notes', label: '메모' },
          ]}
          defaults={{ id: nextIdFor(workbook.debts, 'D'), currency: 'USD', recurring_id: '' }}
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

/** 자산. 스냅샷 추이와 최신 구성. 스냅샷마다 그날 환율을 함께 적는다. */
export function Assets({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = latestAssetsTotal(workbook)
  const history = assetsHistory(workbook)
  const rows = workbook.assets.filter((row) => String(row.snapshot_date).slice(0, 10) === latest.date)
  const prev = history.length >= 2 ? history[history.length - 2] : null
  const change = prev ? latest.total - prev.total : null
  const fx = Number(workbook.config.fx_usd_krw) || 1332

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
            items={rows.map((row) => ({
              name: String(row.account),
              value: Math.round(assetUsd(row, fx) * 100) / 100,
              hint: String(row.currency).toUpperCase() === 'KRW' && row.fx_usd_krw ? `KRW @${row.fx_usd_krw}` : String(row.currency),
            }))}
            tone="income"
            onSelect={(name) => {
              const hit = rows.find((r) => String(r.account) === name)
              if (hit) setEditing(hit)
            }}
          />
          <p className="meta" style={{ marginTop: 10 }}>새 스냅샷은 같은 날짜로 계좌마다 한 줄씩 넣습니다. 원화 계좌는 그날 환율을 함께 적어 두면 나중에 환율이 바뀌어도 그날 값이 유지됩니다.</p>
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
            { key: 'fx_usd_krw', label: '그날 환율 (KRW 만, 비우면 Config 값)', numeric: true },
          ]}
          defaults={{ snapshot_date: today, currency: 'USD', fx_usd_krw: fx }}
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

/** 목표. 비상금(고정비 N개월치)을 맨 위에 두고, 나머지는 최근 순저축 속도로 도달 시점을 어림한다. */
export function Goals({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)
  const assets = latestAssetsTotal(workbook)
  const month = today.slice(0, 7)
  const avg = averageNet(monthlyTotals(workbook, monthsBack(month, 6)))
  const fund = emergencyFund(workbook, month)

  const etaFor = (gap: number) => {
    if (!(avg > 0) || gap <= 0) return null
    const months = Math.ceil(gap / avg)
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + months, 1))
    return { months, label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
  }

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}
      <Card action={<button onClick={() => setEditing('new')}>추가</button>}>
        <div className="stat-row">
          <Stat label="현재 자산" value={formatUsd(assets.total)} size="md" sub={assets.date || '스냅샷 없음'} />
          <Stat label="최근 6개월 월평균 순저축" value={formatUsd(avg)} size="md" tone={avg < 0 ? 'bad' : undefined} />
        </div>
      </Card>

      {fund.monthly > 0 && (
        <Card title="비상금 먼저">
          <Bullet
            label={`고정비 ${fund.months}개월치`}
            value={Math.min(assets.total, fund.target)}
            target={fund.target}
            tone="income"
            hint={
              assets.total >= fund.target
                ? `채웠습니다 · 월 고정비 ${formatUsd(fund.monthly)}`
                : `${formatUsd(fund.target - assets.total)} 남음 · 월 고정비 ${formatUsd(fund.monthly)} · 지금 ${fund.covered ?? 0}개월분${etaFor(fund.target - assets.total) ? ` · 지금 속도면 ${etaFor(fund.target - assets.total)!.label}` : ''}`
            }
          />
          <p className="meta" style={{ marginTop: 8 }}>Config 의 emergency_fund_months 로 개월 수를 바꿀 수 있습니다. 활성 고정비(지출)의 월 예상 합을 기준으로 합니다.</p>
        </Card>
      )}

      {workbook.goals.length === 0 ? (
        <Empty>등록된 목표가 없습니다.</Empty>
      ) : (
        <Card title="목표별 진행">
          {workbook.goals.map((row) => {
            const target = Number(row.target_amount) || 0
            const gap = Math.max(target - assets.total, 0)
            const eta = etaFor(gap)
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
                    : eta
                      ? `${formatUsd(gap)} 남음 · 지금 속도면 ${eta.months}개월 뒤(${eta.label})${String(row.deadline) ? ` · 목표일 ${String(row.deadline)}` : ''}`
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
