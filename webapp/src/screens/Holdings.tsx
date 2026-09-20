import { useState } from 'react'
import { formatUsd } from '@shared/Budget.js'
import { Bullet, LineChart, RankBars, Stat } from '../components/Charts'
import { RowSheet } from '../components/RowSheet'
import { Card, Empty, Notice, Sheet } from '../components/Ui'
import { ASSET_KINDS, TABS, appendManyTo, assetKindOf, latestAssetRows, latestAssetsTotal, monthsBack, nextIdFor, removeRows, type SheetRow, type Workbook } from '../lib/ledger'
import { assetsByKind, assetsHistory, averageNet, debtOverview, debtSchedule, emergencyFund, monthlyTotals } from '../lib/metrics'
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
      <Card title="부채 요약" action={<button onClick={() => setEditing('new')}>부채 추가</button>}>
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

/** 원화 표기. 스냅샷 목록에서 원래 통화 금액을 함께 보여 줄 때 쓴다. */
function formatNative(row: SheetRow): string {
  const balance = Number(row.balance) || 0
  if (String(row.currency).trim().toUpperCase() === 'KRW') return `₩${Math.round(balance).toLocaleString('ko-KR')}`
  return formatUsd(balance)
}

/**
 * 자산. 종류별(계좌 잔액·주식·연금·퇴직연금·401k·HSA)로 묶어 보여 준다.
 * 계좌 잔액만 "아무 때나 빼 쓸 수 있는 돈" 이라 비상금 계산에 들어간다.
 * 새 스냅샷은 직전 스냅샷의 계좌 목록을 불러와 잔액만 고쳐 넣는다.
 */
export function Assets({ workbook, ctx, today, onChanged }: { workbook: Workbook; ctx: SheetsContext; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [snapshot, setSnapshot] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = latestAssetsTotal(workbook)
  const history = assetsHistory(workbook)
  const groups = assetsByKind(workbook)
  const prev = history.length >= 2 ? history[history.length - 2] : null
  const change = prev ? latest.total - prev.total : null
  const fx = Number(workbook.config.fx_usd_krw) || 1332
  const hasKindColumn = workbook.tables[TABS.assets]?.headers.includes('kind')
  const locked = latest.total - latest.liquid
  const [busy, setBusy] = useState(false)

  /** 최신 스냅샷을 통째로 비운다. 같은 스냅샷을 두 번 저장했을 때 한 번에 정리하는 용도다. */
  async function removeLatestSnapshot() {
    const rows = latestAssetRows(workbook)
    if (rows.length === 0) return
    if (!window.confirm(`${latest.date} 스냅샷 ${rows.length}줄을 전부 지울까요? 되돌릴 수 없습니다.`)) return
    setBusy(true)
    setError(null)
    try {
      await removeRows(ctx, workbook, TABS.assets, rows)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="viz">
      {error && <Notice kind="error">{error}</Notice>}
      {!hasKindColumn && (
        <Notice kind="info">
          시트의 Assets 탭에 아직 <code>kind</code> 열이 없어 종류를 저장할 수 없습니다. Apps Script 편집기에서 <code>Setup.gs</code> 의 <code>setupSheet</code> 를 한 번 실행하면 열이 붙습니다.
        </Notice>
      )}
      <Card title={latest.date ? `${latest.date} 스냅샷` : '스냅샷 없음'} action={<button className="primary" onClick={() => setSnapshot(true)}>새 스냅샷</button>}>
        <div className="stat-row">
          <Stat label="자산 합계" value={formatUsd(latest.total)} sub={latest.date ? `${latest.date} 기준` : '기록 없음'} />
          <Stat label="바로 쓸 수 있는 돈" value={formatUsd(latest.liquid)} size="md" sub="계좌 잔액만" tone="good" />
          {locked > 0 && <Stat label="묶인 돈" value={formatUsd(locked)} size="md" sub="주식·연금·401k·HSA" />}
          {change !== null && prev && (
            <Stat label={`${prev.date} 대비`} value={`${change >= 0 ? '+' : '-'}${formatUsd(Math.abs(change))}`} size="md" tone={change >= 0 ? 'good' : 'bad'} />
          )}
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card title="시작하기">
          <Empty>자산 스냅샷이 없습니다. "새 스냅샷" 을 누르면 계좌·주식·국민연금·퇴직연금·401k·HSA 칸이 준비됩니다. 잔액만 채우면 됩니다.</Empty>
        </Card>
      ) : (
        <>
          <Card title={`${latest.date} 종류별 구성`}>
            <RankBars
              items={groups.map((g) => ({ name: g.kind.label, value: g.total, hint: g.kind.liquid ? '바로 쓸 수 있음' : undefined }))}
              tone="income"
            />
          </Card>

          {groups.map((g) => (
            <Card key={g.kind.id} title={`${g.kind.label} · ${formatUsd(g.total)}`}>
              {g.rows.map(({ row, usd }) => (
                <div
                  className="tx"
                  key={row._row}
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditing(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setEditing(row)
                  }}
                >
                  <span className="grow ellipsis">
                    {String(row.account) || '(이름 없음)'}
                    {String(row.currency).toUpperCase() === 'KRW' && (
                      <span className="meta"> · {formatNative(row)}{row.fx_usd_krw ? ` @${row.fx_usd_krw}` : ''}</span>
                    )}
                  </span>
                  <span className="amount">{formatUsd(usd)}</span>
                </div>
              ))}
            </Card>
          ))}
          <p className="meta">
            항목을 누르면 고치거나 지울 수 있습니다. 원화 자산은 그날 환율로 달러 환산해 합칩니다. 비상금(고정비 N개월치)은 계좌 잔액만으로 셉니다.
          </p>
          <p className="meta" style={{ marginTop: 4 }}>
            <button className="ghost danger" style={{ padding: '4px 12px' }} disabled={busy} onClick={() => void removeLatestSnapshot()}>
              {latest.date} 스냅샷 전체 지우기
            </button>
            <span> 같은 날짜를 두 번 저장했을 때 씁니다. 지운 뒤 "새 스냅샷" 으로 다시 넣으면 됩니다.</span>
          </p>
        </>
      )}

      {history.length >= 2 && (
        <Card title="자산 추이">
          <LineChart series={[{ label: '자산 합계', points: history.map((h) => h.total), tone: 'income' }]} xLabels={history.map((h) => h.date.slice(2, 7))} />
        </Card>
      )}

      {snapshot && (
        <SnapshotSheet
          workbook={workbook}
          ctx={ctx}
          today={today}
          onClose={() => setSnapshot(false)}
          onError={setError}
          onSaved={() => {
            setSnapshot(false)
            onChanged()
          }}
        />
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
            { key: 'kind', label: '종류', options: ASSET_KINDS.map((k) => ({ value: k.id, label: k.label })) },
            { key: 'balance', label: '잔액', numeric: true },
            { key: 'currency', label: '통화', options: ['USD', 'KRW'] },
            { key: 'fx_usd_krw', label: '그날 환율 (KRW 만, 비우면 Config 값)', numeric: true },
          ]}
          defaults={{ snapshot_date: today, kind: 'cash', currency: 'USD', fx_usd_krw: fx }}
          onClose={() => setEditing(null)}
          onError={setError}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
          onDelete={(row) => removeRows(ctx, workbook, TABS.assets, [row])}
          deleteLabel="이 항목 삭제"
        />
      )}
    </div>
  )
}

interface SnapshotLine {
  account: string
  kind: string
  balance: string
  currency: string
}

/**
 * 새 스냅샷 입력. 직전 스냅샷의 계좌 목록을 그대로 불러오고(잔액은 직전 값), 없으면 종류별 템플릿을 깐다.
 * 잔액만 고쳐 저장하면 같은 날짜로 계좌마다 한 줄씩 들어간다. 잔액이 빈 줄은 저장하지 않는다.
 */
function SnapshotSheet({ workbook, ctx, today, onClose, onSaved, onError }: { workbook: Workbook; ctx: SheetsContext; today: string; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const configFx = Number(workbook.config.fx_usd_krw) || 1332
  const [date, setDate] = useState(today)
  const [fx, setFx] = useState(String(configFx))
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<SnapshotLine[]>(() => {
    const previous = latestAssetRows(workbook)
    if (previous.length > 0) {
      // 직전 스냅샷이 두 벌 저장돼 있어도 계좌마다 한 줄만 깐다(같은 계좌·종류·통화는 마지막 값).
      const byKey = new Map<string, SnapshotLine>()
      previous.forEach((row) => {
        const line = {
          account: String(row.account ?? ''),
          kind: assetKindOf(row).id,
          balance: String(row.balance ?? ''),
          currency: String(row.currency || 'USD').toUpperCase(),
        }
        byKey.set(`${line.account.trim()}|${line.kind}|${line.currency}`, line)
      })
      return Array.from(byKey.values())
    }
    return ASSET_KINDS.filter((k) => k.example).map((k) => ({ account: k.example, kind: k.id, balance: '', currency: k.currency }))
  })

  // 같은 날짜에 이미 저장된 줄. 그대로 저장하면 두 벌이 되므로 기본으로 먼저 비우고 넣는다.
  const sameDay = workbook.assets.filter((row) => String(row.snapshot_date).slice(0, 10) === date)
  const [replace, setReplace] = useState(true)

  function update(i: number, patch: Partial<SnapshotLine>) {
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  }

  async function save() {
    const fxNum = Number(fx)
    if (!Number.isFinite(fxNum) || fxNum <= 0) {
      onError('환율이 숫자가 아닙니다.')
      return
    }
    const filled = lines.filter((l) => l.account.trim() && l.balance.trim() !== '')
    if (filled.length === 0) {
      onError('잔액을 하나 이상 넣어 주세요.')
      return
    }
    const bad = filled.find((l) => !Number.isFinite(Number(l.balance)))
    if (bad) {
      onError(`"${bad.account}" 의 잔액이 숫자가 아닙니다.`)
      return
    }
    setBusy(true)
    try {
      if (sameDay.length > 0 && replace) await removeRows(ctx, workbook, TABS.assets, sameDay)
      await appendManyTo(
        ctx,
        workbook,
        TABS.assets,
        filled.map((l) => ({
          snapshot_date: date,
          account: l.account.trim(),
          balance: Number(l.balance),
          currency: l.currency,
          fx_usd_krw: l.currency === 'KRW' ? fxNum : '',
          kind: l.kind,
        }))
      )
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="새 스냅샷" onClose={onClose}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <label>기준일</label>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ width: 130 }}>
          <label>오늘 환율 (₩/$)</label>
          <input inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} />
        </div>
      </div>
      <p className="meta" style={{ margin: '8px 0 4px' }}>
        잔액만 고치면 됩니다. 비워 둔 줄은 저장하지 않습니다. 원화 계좌는 위 환율로 달러 환산됩니다.
      </p>
      {sameDay.length > 0 && (
        <label className="meta" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 8px' }}>
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} style={{ width: 'auto' }} />
          <span>
            {date} 에 이미 {sameDay.length}줄이 있습니다. 체크하면 그 줄들을 지우고 이 내용으로 바꿉니다. 풀면 뒤에 덧붙입니다.
          </span>
        </label>
      )}
      {lines.map((l, i) => (
        <div className="snap-line" key={i}>
          <div className="row" style={{ gap: 6 }}>
            <input className="grow" value={l.account} placeholder="계좌 이름" onChange={(e) => update(i, { account: e.target.value })} />
            <select value={l.kind} style={{ width: 118 }} onChange={(e) => update(i, { kind: e.target.value })}>
              {ASSET_KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input className="grow" inputMode="decimal" value={l.balance} placeholder="잔액" onChange={(e) => update(i, { balance: e.target.value })} />
            <select value={l.currency} style={{ width: 84 }} onChange={(e) => update(i, { currency: e.target.value })}>
              <option value="USD">USD</option>
              <option value="KRW">KRW</option>
            </select>
            <button type="button" className="ghost" aria-label="이 줄 지우기" style={{ padding: '8px 10px' }} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="ghost" style={{ marginTop: 8 }} onClick={() => setLines((ls) => [...ls, { account: '', kind: 'cash', balance: '', currency: 'USD' }])}>
        + 계좌 추가
      </button>
      <div className="actions">
        <button className="primary" onClick={() => void save()} disabled={busy}>
          {busy ? '저장 중' : `${lines.filter((l) => l.account.trim() && l.balance.trim() !== '').length}줄 저장`}
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          취소
        </button>
      </div>
    </Sheet>
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
      <Card title="지금 상태" action={<button onClick={() => setEditing('new')}>목표 추가</button>}>
        <div className="stat-row">
          <Stat label="현재 자산" value={formatUsd(assets.total)} size="md" sub={assets.date ? `${assets.date} · 바로 쓸 수 있는 돈 ${formatUsd(assets.liquid)}` : '스냅샷 없음'} />
          <Stat label="최근 6개월 월평균 순저축" value={formatUsd(avg)} size="md" tone={avg < 0 ? 'bad' : undefined} />
        </div>
      </Card>

      {fund.monthly > 0 && (
        <Card title="비상금 먼저">
          <Bullet
            label={`고정비 ${fund.months}개월치`}
            value={Math.min(fund.assets, fund.target)}
            target={fund.target}
            tone="income"
            hint={
              fund.assets >= fund.target
                ? `채웠습니다 · 월 고정비 ${formatUsd(fund.monthly)}`
                : `${formatUsd(fund.target - fund.assets)} 남음 · 월 고정비 ${formatUsd(fund.monthly)} · 지금 ${fund.covered ?? 0}개월분${etaFor(fund.target - fund.assets) ? ` · 지금 속도면 ${etaFor(fund.target - fund.assets)!.label}` : ''}`
            }
          />
          <p className="meta" style={{ marginTop: 8 }}>비상금은 계좌 잔액(바로 쓸 수 있는 돈)만으로 셉니다. 연금·401k 는 넣지 않습니다. Config 의 emergency_fund_months 로 개월 수를 바꿀 수 있습니다.</p>
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
