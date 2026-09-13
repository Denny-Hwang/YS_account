/**
 * apps-script/src 의 순수 모듈 타입 선언.
 * 실제 구현은 그 파일들에 있고, vite.config.ts 의 gasSharedModules 플러그인이
 * ESM export 를 붙여서 넘겨 준다. 여기서는 타입만 알려 준다.
 */

declare module '@shared/Budget.js' {
  export type Signal = 'green' | 'yellow' | 'red'
  export interface EnvelopeStatus {
    budget: number
    spentBeforeToday: number
    spentToday: number
    spentTotal: number
    remaining: number
    remainingDays: number
    /** 오늘 아침 기준 하루치. */
    allowanceToday: number
    /** 하루치에서 오늘 쓴 만큼 뺀 "지금 남은 오늘치". 먼저 보여 줄 숫자. */
    allowanceLeftToday: number
    plannedPaceToDate: number
    deltaVsPlan: number
    signal: Signal
  }
  export interface EnvelopeStatusInput {
    budget: number
    transactions: Array<Record<string, unknown>>
    envelope: string
    today: string
  }
  export function envelopeStatus(input: EnvelopeStatusInput): EnvelopeStatus
  export function formatStatusLine(status: EnvelopeStatus, envelopeName: string): string
  export function formatStatusShort(status: EnvelopeStatus, envelopeName: string): string
  export function formatUsd(n: number): string
  export function formatSigned(n: number): string
  export function daysInMonth(yyyyMm: string): number
  export function remainingDaysInclToday(today: string): number
  export function roundCents(n: number): number
  export function signalOf(status: { budget: number; remaining: number; deltaVsPlan: number }): Signal
  export function signalGlyph(signal: Signal): string
}

declare module '@shared/Parser.js' {
  export interface ParseContext {
    today: string
    defaultCurrency: string
    fxUsdKrw: number
    incomeHints?: string[]
  }
  export interface AmountCandidate {
    amount: number
    currency: string
  }
  export interface ParsedMessage {
    intent: 'record' | 'query' | 'undo' | 'move' | 'unknown'
    type: string
    amount: number | null
    currency: string
    amount_usd: number | null
    amountCandidates: AmountCandidate[]
    ambiguous: boolean
    refund: boolean
    date: string
    merchantText: string
    merchantTextRaw: string
    memo: string
    confidence: 'high' | 'low'
    moveFrom?: string
    moveTo?: string
  }
  export function parseMessage(text: string, ctx: ParseContext): ParsedMessage | null
}

declare module '@shared/Classifier.js' {
  export function classify<T extends Record<string, unknown>>(
    merchantText: string,
    merchants: T[]
  ): T | null
  export function normalize(s: unknown): string
}

declare module '@shared/LedgerRules.js' {
  export interface AmountRule {
    type: 'fixed' | 'income_pct' | 'biweekly'
    pct?: number
    perCheck?: number
    anchor?: string
  }
  export function parseAmountRule(rule: string): AmountRule
  export function biweeklyPaydays(month: string, anchor: string): string[]
  export function expectedAmountFor(
    definition: Record<string, unknown>,
    month: string,
    monthIncome: number
  ): number
  export function pickConfirmTarget<T extends Record<string, unknown>>(
    monthRows: T[],
    recurringId: string
  ): { target: T | null; confirmedCount: number }
  export function matchRecurringName<T extends Record<string, unknown>>(text: string, definitions: T[]): T | null
  export function undoPlan(
    row: Record<string, unknown>,
    memo: { mode?: string; previous?: Record<string, unknown> } | null,
    fallbackExpected: Record<string, unknown> | null
  ): { action: 'delete' | 'revert'; patch: Record<string, unknown> }
  export function nextMonthBudgets(
    prevBudgets: Array<{ envelope: string; amount: number; carryover: string }>,
    statusByEnvelope: Record<string, { remaining: number }>,
    overspendEnvelope: string
  ): Array<{ envelope: string; amount: number; carryover: string; note: string }>
  export function amortizeOnce(
    principal: number,
    ratePct: number,
    payment: number
  ): { interest: number; principalPaid: number; newPrincipal: number }
  export function payoffMonths(principal: number, ratePct: number, payment: number): number | null
  export function monthScore(
    totals: { income: number; expense: number },
    envelopeStatuses: Array<{ remaining: number }>,
    deviationCount: number
  ): { savingRate: number | null; withinBudget: number; envelopes: number; deviations: number }
}
