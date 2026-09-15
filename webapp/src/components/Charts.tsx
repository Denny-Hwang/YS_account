/**
 * 차트 부품. 라이브러리 없이 div 와 SVG 로 그린다.
 * 색은 역할로만 쓴다. 수입·자산 = 파랑, 지출·부채 = 주황, 계획·기준 = 회색, 초과 = 빨강(라벨 동반).
 * 계열이 둘 이상이면 범례를 띄우고, 값은 항상 글자로도 적는다. 색만으로 정보를 주지 않는다.
 */
import type { ReactNode } from 'react'
import { formatUsd } from '@shared/Budget.js'

export type Tone = 'income' | 'expense' | 'plan' | 'over'

const VAR: Record<Tone, string> = {
  income: 'var(--series-income)',
  expense: 'var(--series-expense)',
  plan: 'var(--series-plan)',
  over: 'var(--series-over)',
}

export function Legend({ items }: { items: Array<{ label: string; tone: Tone; dashed?: boolean }> }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i
            className={`swatch${it.dashed ? ' dashed' : ''}`}
            style={it.dashed ? { borderColor: VAR[it.tone] } : { background: VAR[it.tone] }}
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** 큰 숫자 하나. */
export function Stat({
  label,
  value,
  sub,
  tone,
  size = 'lg',
}: {
  label: string
  value: string
  sub?: ReactNode
  tone?: 'good' | 'bad' | 'muted'
  size?: 'lg' | 'md'
}) {
  return (
    <div className={`stat ${size}`}>
      <span className="meta">{label}</span>
      <strong className={tone ? `tone-${tone}` : ''}>{value}</strong>
      {sub && <span className="meta">{sub}</span>}
    </div>
  )
}

/**
 * 불릿 막대. 트랙 = 목표(예산·예상), 채움 = 실제, 세로 눈금 = 오늘까지의 계획 진도.
 * 예산 대비 집행을 한눈에 보는 데 가장 알맞은 형태다.
 */
export function Bullet({
  label,
  value,
  target,
  pace,
  tone = 'expense',
  hint,
  onClick,
}: {
  label: ReactNode
  value: number
  target: number
  pace?: number
  tone?: Tone
  hint?: ReactNode
  onClick?: () => void
}) {
  const scale = Math.max(target, value, 1)
  const fill = Math.max(0, Math.min(value / scale, 1)) * 100
  const trackW = Math.min(target / scale, 1) * 100
  const over = target > 0 && value > target
  const paceX = pace !== undefined && target > 0 ? Math.min(pace / scale, 1) * 100 : null
  const pct = target > 0 ? Math.round((value / target) * 100) : null
  return (
    <div className={`bullet${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="row">
        <span className="ellipsis bullet-label">{label}</span>
        <span className="meta bullet-val">
          {formatUsd(value)}
          {target > 0 && <> / {formatUsd(target)}</>}
          {pct !== null && <span className={`pill${over ? ' pill-over' : ''}`}>{over ? '초과 ' : ''}{pct}%</span>}
        </span>
      </div>
      <div
        className="bullet-track"
        title={`실제 ${formatUsd(value)} · 목표 ${formatUsd(target)}${pace !== undefined ? ` · 오늘까지 계획 ${formatUsd(pace)}` : ''}`}
      >
        <span className="bullet-target" style={{ width: `${trackW}%` }} />
        <span className="bullet-fill" style={{ width: `${fill}%`, background: over ? VAR.over : VAR[tone] }} />
        {paceX !== null && <span className="bullet-pace" style={{ left: `${paceX}%` }} />}
      </div>
      {hint && <p className="meta bullet-hint">{hint}</p>}
    </div>
  )
}

/** 가로 순위 막대. 계열 하나. 값과 비율을 직접 적는다. */
export function RankBars({
  items,
  tone = 'expense',
  format = formatUsd,
  onSelect,
}: {
  items: Array<{ name: string; value: number; hint?: ReactNode; delta?: number }>
  tone?: Tone
  format?: (n: number) => string
  onSelect?: (name: string) => void
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  const total = items.reduce((a, i) => a + i.value, 0)
  return (
    <div className="rank">
      {items.map((it) => (
        <div className={`item${onSelect ? ' clickable' : ''}`} key={it.name} onClick={onSelect ? () => onSelect(it.name) : undefined}>
          <div className="row">
            <span className="ellipsis">
              {it.name}
              {it.hint && <span className="meta"> · {it.hint}</span>}
            </span>
            <span className="meta" style={{ whiteSpace: 'nowrap' }}>
              {format(it.value)}
              {total > 0 && <> · {((it.value / total) * 100).toFixed(0)}%</>}
              {it.delta !== undefined && it.delta !== 0 && (
                <span className={`delta ${it.delta > 0 ? 'up' : 'down'}`}>
                  {it.delta > 0 ? '▲' : '▼'}
                  {format(Math.abs(it.delta))}
                </span>
              )}
            </span>
          </div>
          <div className="track">
            <span style={{ width: `${Math.max((it.value / max) * 100, 1)}%`, background: VAR[tone] }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 월별 세로 막대. 계열 1~2개를 나란히. 누르면 그 달을 고른다. */
export function MonthlyBars({
  months,
  series,
  selected,
  onSelect,
  height = 140,
}: {
  months: string[]
  series: Array<{ label: string; values: number[]; tone: Tone }>
  selected?: string
  onSelect?: (m: string) => void
  height?: number
}) {
  const peak = Math.max(1, ...series.flatMap((s) => s.values))
  return (
    <>
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, tone: s.tone }))} />}
      <div className="bars" style={{ height }}>
        {months.map((m, i) => (
          <button
            key={m}
            className={`col${m === selected ? ' selected' : ''}`}
            onClick={onSelect ? () => onSelect(m) : undefined}
            aria-label={`${m} ${series.map((s) => `${s.label} ${formatUsd(s.values[i] ?? 0)}`).join(', ')}`}
            title={`${m}\n${series.map((s) => `${s.label} ${formatUsd(s.values[i] ?? 0)}`).join('\n')}`}
          >
            {series.map((s) => (
              <i key={s.label} style={{ height: `${((s.values[i] ?? 0) / peak) * 100}%`, background: VAR[s.tone] }} />
            ))}
          </button>
        ))}
      </div>
      <Axis months={months} />
    </>
  )
}

/** 월별 양·음 막대. 순저축처럼 부호가 있는 값. 양수 파랑, 음수 빨강(라벨 동반). */
export function DivergingBars({
  months,
  values,
  selected,
  onSelect,
  height = 120,
}: {
  months: string[]
  values: number[]
  selected?: string
  onSelect?: (m: string) => void
  height?: number
}) {
  const peak = Math.max(1, ...values.map((v) => Math.abs(v)))
  const half = height / 2
  return (
    <>
      <Legend items={[{ label: '남음(+)', tone: 'income' }, { label: '모자람(−)', tone: 'over' }]} />
      <div className="diverging" style={{ height }}>
        <span className="zero" style={{ top: half }} />
        {months.map((m, i) => {
          const v = values[i] ?? 0
          const len = (Math.abs(v) / peak) * (half - 4)
          return (
            <button
              key={m}
              className={`col${m === selected ? ' selected' : ''}`}
              onClick={onSelect ? () => onSelect(m) : undefined}
              aria-label={`${m} 순저축 ${formatUsd(v)}`}
              title={`${m} 순저축 ${formatUsd(v)}`}
            >
              <i
                style={{
                  height: Math.max(len, 2),
                  top: v >= 0 ? half - len : half,
                  background: v >= 0 ? VAR.income : VAR.over,
                }}
              />
            </button>
          )
        })}
      </div>
      <Axis months={months} />
    </>
  )
}

/** 월별 누적 막대. 고정비/유동비처럼 부분의 합. 조각 사이 2px 틈. */
export function StackedBars({
  months,
  series,
  selected,
  onSelect,
  height = 140,
}: {
  months: string[]
  series: Array<{ label: string; values: number[]; tone: Tone }>
  selected?: string
  onSelect?: (m: string) => void
  height?: number
}) {
  const totals = months.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0))
  const peak = Math.max(1, ...totals)
  return (
    <>
      <Legend items={series.map((s) => ({ label: s.label, tone: s.tone }))} />
      <div className="bars stacked" style={{ height }}>
        {months.map((m, i) => (
          <button
            key={m}
            className={`col${m === selected ? ' selected' : ''}`}
            onClick={onSelect ? () => onSelect(m) : undefined}
            aria-label={`${m} ${series.map((s) => `${s.label} ${formatUsd(s.values[i] ?? 0)}`).join(', ')}`}
            title={`${m}\n${series.map((s) => `${s.label} ${formatUsd(s.values[i] ?? 0)}`).join('\n')}\n합계 ${formatUsd(totals[i])}`}
          >
            <span className="stack">
              {series.map((s) => (
                <i key={s.label} style={{ height: `${((s.values[i] ?? 0) / peak) * 100}%`, background: VAR[s.tone] }} />
              ))}
            </span>
          </button>
        ))}
      </div>
      <Axis months={months} />
    </>
  )
}

/** SVG 선 그래프. 계열 여러 개, 점선은 계획선. null 은 그리지 않는다. */
export function LineChart({
  series,
  xLabels,
  height = 150,
  yFormat = formatUsd,
}: {
  series: Array<{ label: string; points: Array<number | null>; tone: Tone; dashed?: boolean }>
  xLabels?: string[]
  height?: number
  yFormat?: (n: number) => string
}) {
  const W = 320
  const H = height
  const padB = 6
  const padT = 8
  const n = Math.max(2, ...series.map((s) => s.points.length))
  const max = Math.max(1, ...series.flatMap((s) => s.points.filter((p): p is number => p !== null)))
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => H - padB - (v / max) * (H - padB - padT)
  const paths = series.map((s) => {
    let d = ''
    let open = false
    s.points.forEach((p, i) => {
      if (p === null) {
        open = false
        return
      }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)} `
      open = true
    })
    return d
  })
  const lastIdx = series.map((s) => {
    let idx = -1
    s.points.forEach((p, i) => {
      if (p !== null) idx = i
    })
    return idx
  })
  return (
    <>
      <Legend items={series.map((s) => ({ label: s.label, tone: s.tone, dashed: s.dashed }))} />
      <svg className="line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={series.map((s, k) => `${s.label} 마지막 ${lastIdx[k] >= 0 ? yFormat(s.points[lastIdx[k]] as number) : '없음'}`).join(', ')}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} className="grid" />
        ))}
        {series.map((s, k) => (
          <path key={s.label} d={paths[k]} fill="none" stroke={VAR[s.tone]} strokeWidth={2}
            strokeDasharray={s.dashed ? '5 4' : undefined} vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s, k) =>
          lastIdx[k] >= 0 && !s.dashed ? (
            <circle key={`${s.label}-dot`} cx={x(lastIdx[k])} cy={y(s.points[lastIdx[k]] as number)} r={4}
              fill={VAR[s.tone]} stroke="var(--surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ) : null
        )}
      </svg>
      {xLabels && (
        <div className="bars-axis">
          {xLabels.map((l, i) => (
            <span key={`${l}-${i}`}>{l}</span>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        {series.map((s, k) => (
          <span key={s.label} className="meta">
            {s.label} {lastIdx[k] >= 0 ? yFormat(s.points[lastIdx[k]] as number) : '—'}
          </span>
        ))}
      </div>
    </>
  )
}

/** 작은 다중 차트. 세부예산별 월 추이처럼 같은 형태를 나란히 비교할 때. */
export function SmallMultiples({
  items,
  months,
  tone = 'expense',
}: {
  items: Array<{ title: string; values: number[]; target?: number }>
  months: string[]
  tone?: Tone
}) {
  const peak = Math.max(1, ...items.flatMap((it) => [...it.values, it.target ?? 0]))
  return (
    <div className="multiples">
      {items.map((it) => {
        const last = it.values[it.values.length - 1] ?? 0
        return (
          <div className="multiple" key={it.title}>
            <div className="row">
              <span className="ellipsis">{it.title}</span>
              <span className="meta">{formatUsd(last)}</span>
            </div>
            <div className="mini" title={months.map((m, i) => `${m} ${formatUsd(it.values[i] ?? 0)}`).join('\n')}>
              {it.target !== undefined && it.target > 0 && (
                <span className="mini-target" style={{ bottom: `${(it.target / peak) * 100}%` }} />
              )}
              {it.values.map((v, i) => (
                <i key={months[i] ?? i} style={{ height: `${(v / peak) * 100}%`, background: VAR[tone] }} />
              ))}
            </div>
          </div>
        )
      })}
      {items.some((it) => it.target) && (
        <p className="meta" style={{ gridColumn: '1 / -1' }}>회색 선은 그 세부예산의 이번 달 예산입니다.</p>
      )}
    </div>
  )
}

function Axis({ months }: { months: string[] }) {
  return (
    <div className="bars-axis">
      {months.map((m) => (
        <span key={m}>{m.length === 7 ? m.slice(5) : m}</span>
      ))}
    </div>
  )
}
