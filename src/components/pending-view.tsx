export function PendingView({ title, what }: { title: string; what: string }) {
  return (
    <>
      <h1>{title}</h1>
      <div className="pending-box" role="status">
        <h2>Todavía no disponible</h2>
        <p>
          La vista {title} aún no está disponible en esta versión. {what}
        </p>
        <p className="muted">No se muestran cifras ni gráficos hasta que existan los datos y los cálculos que los respaldan.</p>
      </div>
    </>
  );
}
