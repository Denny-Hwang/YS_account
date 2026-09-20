import { useMemo, useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { DivergingBars, LineChart, MonthlyBars, RankBars, SmallMultiples, StackedBars, Stat } from '../components/Charts'
import { Card, Empty } from '../components/Ui'
import { configList, latestAssetsTotal, monthsBack, type Workbook } from '../lib/ledger'
import { averageNet, categoryBreakdown, cumulativePace, envelopeMonthly, envelopeSummary, monthlyTotals, topMerchants } from '../lib/metrics'

export function Report({ workbook, today }: { workbook: Workbook; today: string }) {
  const thisMonth = today.slice(0, 7)
  const [selected, setSelected] = useState(thisMonth)
  const [asTable, setAsTable] = useState(false)

  const months = useMemo(() => monthsBack(thisMonth, 12), [thisMonth])
  const totals = useMemo(() => monthlyTotals(workbook, months), [workbook, months])
  const current = totals.find((t) => t.month === selected) ?? totals[totals.length - 1]
  const avgNet = averageNet(totals)
  const savingRate = current.income > 0 ? Math.round((current.net / current.income) * 100) : null
  const twelve = totals.reduce((a, t) => ({ income: a.income + t.income, expense: a.expense + t.expense }), { income: 0, expense: 0 })

  const pace = useMemo(() => cumulativePace(workbook, selected, today), [workbook, selected, today])
  const paceToday = pace.actual.filter((v): v is number => v !== null).slice(-1)[0] ?? 0
  const planToday = pace.plan[Math.max(0, Math.min(pace.todayDay, pace.days) - 1)] ?? 0

  const envelopes = configList(workbook.config, 'envelopes')
  const sixMonths = useMemo(() => monthsBack(selected, 6), [selected])
  const multiples = envelopes.map((env) => ({
    title: env,
    values: envelopeMonthly(workbook, sixMonths, env),
    target: envelopeSummary(workbook, selected).find((s) => s.envelope === env)?.budget,
  }))

  const categories = useMemo(() => categoryBreakdown(workbook, selected), [workbook, selected])
  const merchants = useMemo(() => topMerchants(workbook, selected, 8), [workbook, selected])
  const assets = latestAssetsTotal(workbook)

  return (
    <div className="viz">
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="meta">{selected} 기준 · 아래 막대를 누르면 달이 바뀝니다</span>
          <button className="ghost" onClick={() => setAsTable((v) => !v)}>{asTable ? '그래프로' : '표로'}</button>
        </div>
        <div className="stat-row">
          <Stat label="이달 순저축" value={formatUsd(current.net)} tone={current.net < 0 ? 'bad' : 'good'} sub={savingRate !== null ? `저축률 ${savingRate}%` : '수입 기록 없음'} />
          <Stat label="12개월 월평균 순저축" value={formatUsd(avgNet)} size="md" tone={avgNet < 0 ? 'bad' : undefined} />
          <Stat label="이달 수입" value={formatUsd(current.income)} size="md" />
          <Stat label="이달 지출" value={formatUsd(current.expense)} size="md" />
        </div>
      </Card>

      {asTable ? (
        <Card title="최근 12개월">
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr><th>월</th><th>수입</th><th>지출</th><th>고정</th><th>유동</th><th>순저축</th></tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.month} onClick={() => setSelected(t.month)} style={{ cursor: 'pointer', fontWeight: t.month === selected ? 600 : 400 }}>
                    <td>{t.month}</td><td>{formatUsd(t.income)}</td><td>{formatUsd(t.expense)}</td><td>{formatUsd(t.fixed)}</td><td>{formatUsd(t.variable)}</td><td>{formatUsd(t.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <>
          <Card title="수입과 지출">
            <MonthlyBars months={months} selected={selected} onSelect={setSelected}
              series={[{ label: '수입', values: totals.map((t) => t.income), tone: 'income' }, { label: '지출', values: totals.map((t) => t.expense), tone: 'expense' }]} />
            <div className="row" style={{ marginTop: 10 }}>
              <span className="meta">12개월 합계</span>
              <span className="meta">수입 {formatUsd(twelve.income)} · 지출 {formatUsd(twelve.expense)}</span>
            </div>
          </Card>

          <Card title="순저축 추이">
            <DivergingBars months={months} values={totals.map((t) => t.net)} selected={selected} onSelect={setSelected} />
            <p className="meta" style={{ marginTop: 8 }}>수입에서 지출을 뺀 값입니다. 위로 솟으면 남긴 달, 아래로 내려가면 모자란 달입니다.</p>
          </Card>

          <Card title="고정비와 유동비">
            <StackedBars months={months} selected={selected} onSelect={setSelected}
              series={[{ label: '고정비', values: totals.map((t) => t.fixed), tone: 'plan' }, { label: '유동비', values: totals.map((t) => t.variable), tone: 'expense' }]} />
            <p className="meta" style={{ marginTop: 8 }}>
              {selected} 고정비 {formatUsd(current.fixed)} · 유동비 {formatUsd(current.variable)}
              {current.expense > 0 && ` · 유동비 비중 ${Math.round((current.variable / current.expense) * 100)}%`}
            </p>
          </Card>
        </>
      )}

      <Card title={`${selected} 유동비 누적`}>
        {pace.budget === 0 ? (
          <Empty>이 달의 예산이 없습니다. 예산 탭에서 세부예산 금액을 넣으세요.</Empty>
        ) : (
          <>
            <LineChart
              series={[
                { label: '실제 누적', points: pace.actual, tone: 'expense' },
                { label: '계획선', points: pace.plan, tone: 'plan', dashed: true },
              ]}
              xLabels={pace.labels}
            />
            <p className="meta" style={{ marginTop: 6 }}>
              {selected === thisMonth ? `오늘까지 ` : '이 달 '}실제 {formatUsd(paceToday)} · 계획 {formatUsd(planToday)} ·{' '}
              {paceToday <= planToday ? `계획보다 ${formatUsd(planToday - paceToday)} 덜 씀` : `계획보다 ${formatUsd(paceToday - planToday)} 더 씀`}
              {' '}· 월 예산 {formatUsd(pace.budget)}
            </p>
          </>
        )}
      </Card>

      {multiples.length > 0 && (
        <Card title="세부예산별 6개월 추이">
          <SmallMultiples items={multiples} months={sixMonths} />
        </Card>
      )}

      <Card title={`${selected} 카테고리`}>
        {categories.length === 0 ? (
          <Empty>이 달의 지출 기록이 없습니다.</Empty>
        ) : (
          <>
            <RankBars items={categories.map((c) => ({ name: c.name, value: c.value, delta: c.delta }))} />
            <p className="meta" style={{ marginTop: 8 }}>▲▼ 는 전월 대비 증감입니다.</p>
          </>
        )}
      </Card>

      {merchants.length > 0 && (
        <Card title={`${selected} 많이 쓴 곳`}>
          <RankBars items={merchants.map((m) => ({ name: `${m.name} · ${m.count}회`, value: m.value }))} />
        </Card>
      )}

      {assets.date && (
        <Card title="자산">
          <Stat label={`${assets.date} 스냅샷`} value={formatUsd(assets.total)} size="md" sub={avgNet > 0 ? `지금 순저축 속도면 1년 뒤 약 ${formatUsd(assets.total + avgNet * 12)}` : undefined} />
        </Card>
      )}
    </div>
  )
}
