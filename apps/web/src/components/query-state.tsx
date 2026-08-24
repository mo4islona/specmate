interface QueryStateProps {
  title: string
  detail?: string
}

export function LoadingState({ title }: QueryStateProps) {
  return (
    <div className="panel grid min-h-48 place-items-center text-center">
      <p className="font-mono text-sm text-muted">{title}</p>
    </div>
  )
}

export function ErrorState({ title, detail }: QueryStateProps) {
  return (
    <div className="panel border-danger/35">
      <p className="micro-label text-danger">Request failed</p>
      <h2 className="mt-2 text-lg font-semibold">{title}</h2>
      {detail && <p className="mt-2 text-sm text-muted">{detail}</p>}
    </div>
  )
}
