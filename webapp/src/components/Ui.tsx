import type { ReactNode } from 'react'

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="row" style={{ marginBottom: 10 }}>
          {title ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Notice({ kind, children }: { kind: 'error' | 'info'; children: ReactNode }) {
  return <div className={`notice ${kind}`}>{children}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
