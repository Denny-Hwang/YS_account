/**
 * apps-script/src 의 순수 모듈 타입 선언.
 * 실제 구현은 그 파일들에 있고, vite.config.ts 의 gasSharedModules 플러그인이
 * ESM export 를 붙여서 넘겨 준다. 여기서는 타입만 알려 준다.
 */

declare module '@shared/Budget.js' {
  export interface EnvelopeStatus {
    budget: number
    spentBeforeToday: number
    spentToday: number
    spentTotal: number
    remaining: number
    remainingDays: number
    allowanceToday: number
    plannedPaceToDate: number
    deltaVsPlan: number
  }
  export interface EnvelopeStatusInput {
    budget: number
    transactions: Array<Record<string, unknown>>
    envelope: string
    today: string
  }
  export function envelopeStatus(input: EnvelopeStatusInput): EnvelopeStatus
  export function formatStatusLine(status: EnvelopeStatus, envelopeName: string): string
  export function formatUsd(n: number): string
  export function daysInMonth(yyyyMm: string): number
  export function remainingDaysInclToday(today: string): number
  export function roundCents(n: number): number
}

declare module '@shared/Parser.js' {
  export interface ParseContext {
    today: string
    defaultCurrency: string
    fxUsdKrw: number
  }
  export interface ParsedMessage {
    intent: 'record' | 'query' | 'undo' | 'unknown'
    type: string
    amount: number | null
    currency: string
    amount_usd: number | null
    date: string
    merchantText: string
    merchantTextRaw: string
    memo: string
    confidence: 'high' | 'low'
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
