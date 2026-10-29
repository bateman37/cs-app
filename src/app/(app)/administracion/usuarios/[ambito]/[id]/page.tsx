import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/session";
import { getMatrix } from "@/server/usuarios";
import { DomainError } from "@/server/errors";
import { HISTORIC_YEAR, KIND_LABEL, MONTHS, currentYear } from "@/domain/usuarios";
import { first, formatDateTime, type SearchParams } from "@/lib/format";
import { BASE, Cell, Legend, SCOPE_LABEL, SLUG_SCOPE, SCOPE_SLUG, monthName } from "../../_lib";

export const metadata: Metadata = { title: "Usuarios contratados: ficha" };

export default async function FichaUsuariosPage({ params, searchParams }: { params: Promise<{ ambito: string; id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const { ambito, id } = await params;
  const sp = await searchParams;
  const type = SLUG_SCOPE[ambito];
  if (!type) notFound();
  const cy = currentYear();
  const yp = Number(first(sp.anio));
  const year = Number.isInteger(yp) && yp >= 2000 && yp <= 2100 ? yp : cy;
  let m;
  try {
    m = await getMatrix(user.id, { type, id }, year);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const isAdmin = user.role === "ADMIN";
  const revisar = `${BASE}/${ambito}/${id}/revisar`;
  const monthOptions = MONTHS.map((n) => (
    <option key={n} value={n}>{monthName(n)}</option>
  ));
  const empty = m.months.every((x) => x.value === null);
  const years: number[] = [];
  for (let y = HISTORIC_YEAR; y <= cy + 1; y++) years.push(y);
  return (
    <>
      <p><Link href={`${BASE}?anio=${year}&ambito=${SCOPE_SLUG[type]}`}>← Volver a la matriz</Link></p>
      <h1>{m.scope.name} <span className="badge badge-int">{SCOPE_LABEL[type]}</span> {!m.scope.isActive ? <span className="badge badge-off">Inactivo</span> : null}</h1>
      <p className="muted">Usuarios contratados (los que pagan) en {year}. Sin informar no es cero: solo un 0 explícito es un cero confirmado.</p>
      {first(sp.ok) ? <p className="notice notice-ok" role="status">Cambio guardado.</p> : null}
      <ul className="subnav" aria-label="Año">
        {years.map((y) => (
          <li key={y}>
            <Link href={`${BASE}/${ambito}/${id}?anio=${y}`} aria-current={y === year ? "page" : undefined}>{y}</Link>
          </li>
        ))}
      </ul>
      {m.reason ? <p className="notice notice-info" role="note">{m.reason}</p> : null}

      <section className="card" aria-labelledby="sec-matriz">
        <h2 id="sec-matriz">Matriz {year}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{MONTHS.map((n) => <th key={n} style={{ textAlign: "right" }}>{monthName(n).slice(0, 3)}</th>)}</tr>
            </thead>
            <tbody>
              <tr>{m.months.map((x) => <Cell key={x.month} value={x.value} kind={x.kind} locked={x.isLocked} />)}</tr>
            </tbody>
          </table>
        </div>
        <Legend />
      </section>

      {isAdmin && m.editable ? (
        <section className="card" aria-labelledby="sec-editar">
          <h2 id="sec-editar">Editar</h2>
          <p className="muted">Siempre se muestra una vista previa antes de guardar.</p>
          <div className="grid-2">
            <form className="form" action={revisar} method="get">
              <input type="hidden" name="accion" value="cambio" />
              <input type="hidden" name="op" value="SET_MONTH" />
              <input type="hidden" name="anio" value={year} />
              <h3 style={{ flexBasis: "100%" }}>Editar un mes</h3>
              <p className="muted" style={{ flexBasis: "100%", margin: 0 }}>Cambia solo ese mes y lo marca como ajuste explícito.</p>
              <div className="field"><label htmlFor="mes-1">Mes</label><select id="mes-1" name="mes">{monthOptions}</select></div>
              <div className="field"><label htmlFor="valor-1">Usuarios</label><input id="valor-1" name="valor" inputMode="numeric" autoComplete="off" /></div>
              <div className="form-actions"><button className="btn btn-primary" type="submit">Ver vista previa</button></div>
            </form>
            <form className="form" action={revisar} method="get">
              <input type="hidden" name="accion" value="cambio" />
              <input type="hidden" name="op" value="APPLY_FROM" />
              <input type="hidden" name="anio" value={year} />
              <h3 style={{ flexBasis: "100%" }}>Aplicar desde este mes</h3>
              <p className="muted" style={{ flexBasis: "100%", margin: 0 }}>Cambia el mes y los posteriores del año, salvo los que ya tengan un ajuste explícito.</p>
              <div className="field"><label htmlFor="mes-2">Desde el mes</label><select id="mes-2" name="mes">{monthOptions}</select></div>
              <div className="field"><label htmlFor="valor-2">Usuarios</label><input id="valor-2" name="valor" inputMode="numeric" autoComplete="off" /></div>
              <div className="form-actions"><button className="btn btn-primary" type="submit">Ver vista previa</button></div>
            </form>
          </div>
          {year === cy ? (
            <p>
              <Link className="btn btn-secondary" href={`${revisar}?accion=copiar&anio=${year}`}>Copiar base de {year - 1} (solo meses sin informar)</Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {isAdmin && year === HISTORIC_YEAR && m.scope.isActive ? (
        empty ? (
          <section className="card" aria-labelledby="sec-init">
            <h2 id="sec-init">Inicializar el histórico {HISTORIC_YEAR}</h2>
            <p className="muted">
              Carga inicial única: el dato conocido de este ámbito se repite los doce meses y queda bloqueado. No es una reapertura y no se puede repetir con otro valor.
              Este dato es solo de este {SCOPE_LABEL[type].toLowerCase()}: no se copia a otros ámbitos.
            </p>
            <form className="form" action={revisar} method="get">
              <input type="hidden" name="accion" value="inicializar" />
              <input type="hidden" name="anio" value={HISTORIC_YEAR} />
              <div className="field"><label htmlFor="valor-i">Usuarios contratados</label><input id="valor-i" name="valor" inputMode="numeric" autoComplete="off" /></div>
              <div className="field"><label htmlFor="proc-i">Procedencia</label><input id="proc-i" name="procedencia" defaultValue="Valor inicial indicado por el administrador" maxLength={200} /></div>
              <div className="form-actions"><button className="btn btn-primary" type="submit">Ver vista previa</button></div>
            </form>
          </section>
        ) : null
      ) : null}

      <section className="card" aria-labelledby="sec-detalle">
        <h2 id="sec-detalle">Detalle por mes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Mes</th><th>Usuarios</th><th>Origen</th><th>Procedencia</th><th>Revisión</th><th>Autor</th><th>Fecha</th></tr>
            </thead>
            <tbody>
              {m.months.map((x) => (
                <tr key={x.month}>
                  <td>{monthName(x.month)}</td>
                  <td>{x.value === null ? <span className="muted">Sin informar</span> : x.value === 0 ? "0 (cero confirmado)" : x.value}</td>
                  <td>{x.kind ? `${KIND_LABEL[x.kind]}${x.isLocked ? " · bloqueado" : ""}` : <span className="muted">—</span>}</td>
                  <td>{x.source ?? <span className="muted">—</span>}</td>
                  <td>{x.revision ?? <span className="muted">—</span>}</td>
                  <td>{x.updatedBy ?? <span className="muted">—</span>}</td>
                  <td>{x.updatedAt ? formatDateTime(x.updatedAt) : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
