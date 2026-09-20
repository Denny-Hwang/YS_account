import { useState } from 'react'
import { Field, Sheet } from './Ui'
import { appendTo, patchIn, type SheetRow, type Workbook } from '../lib/ledger'
import type { SheetsContext } from '../lib/sheets'

export interface FieldSpec {
  key: string
  label: string
  numeric?: boolean
  type?: 'date'
  options?: Array<string | { value: string; label: string }>
}

/** 탭 하나의 행을 추가하거나 고치는 공용 시트. 부채·자산·목표·수입원이 같이 쓴다. */
export function RowSheet({
  title,
  tab,
  row,
  workbook,
  ctx,
  fields,
  defaults,
  onClose,
  onSaved,
  onError,
  onDelete,
  deleteLabel = '삭제',
}: {
  title: string
  tab: string
  row: SheetRow | null
  workbook: Workbook
  ctx: SheetsContext
  fields: FieldSpec[]
  defaults: Record<string, string | number>
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
  /** 있으면 기존 행에 "삭제" 버튼이 생긴다. 확인을 받은 뒤 부른다. 끝나면 onSaved 와 같이 화면을 새로 읽는다. */
  onDelete?: (row: SheetRow) => Promise<void>
  deleteLabel?: string
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    fields.forEach((f) => {
      initial[f.key] = row ? String(row[f.key] ?? '') : String(defaults[f.key] ?? '')
    })
    return initial
  })
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {}
      fields.forEach((f) => {
        payload[f.key] = f.numeric ? (form[f.key] === '' ? '' : Number(form[f.key])) : form[f.key]
      })
      if (row) await patchIn(ctx, workbook, tab, row, payload)
      else await appendTo(ctx, workbook, tab, { ...defaults, ...payload })
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!row || !onDelete) return
    const name = String(row[fields[0]?.key ?? ''] ?? '').trim() || '이 항목'
    if (!window.confirm(`"${name}" 을(를) 지울까요? 되돌릴 수 없습니다.`)) return
    setBusy(true)
    try {
      await onDelete(row)
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      {fields.map((f) => (
        <Field label={f.label} key={f.key}>
          {f.options ? (
            <select value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}>
              {f.options.map((o) => {
                const v = typeof o === 'string' ? o : o.value
                const l = typeof o === 'string' ? o : o.label
                return (
                  <option key={v} value={v}>
                    {l}
                  </option>
                )
              })}
            </select>
          ) : (
            <input
              type={f.type === 'date' ? 'date' : 'text'}
              inputMode={f.numeric ? 'decimal' : undefined}
              value={form[f.key]}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
            />
          )}
        </Field>
      ))}
      <div className="actions">
        <button className="primary" onClick={() => void save()} disabled={busy}>
          저장
        </button>
        {row && onDelete ? (
          <button className="danger" onClick={() => void remove()} disabled={busy}>
            {deleteLabel}
          </button>
        ) : (
          <button className="ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
        )}
      </div>
    </Sheet>
  )
}
