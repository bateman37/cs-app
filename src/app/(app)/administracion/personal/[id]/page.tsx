import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/session";
import { getPerson, listCatalog, listPersonHistory } from "@/server/personal";
import { resolvePersonAt } from "@/server/personal-terms";
import { first, sanitizeBack, type SearchParams } from "@/lib/format";
import { isIsoDate, todayMadrid } from "@/domain/vigencia";
import { ActionForm, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { StatusBadge } from "@/components/list";
import { updatePersonAction } from "../actions";
import { ToggleActive } from "../toggle-active";
import { AliasesSection, SituationCard, TermsSection } from "../_sections/person-sections";
import type { CatalogOptions } from "../_sections/person-forms";
import { HistorySection } from "../../clientes/_sections/sections";

export const metadata: Metadata = { title: "Persona" };

export default async function PersonaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const sp = await searchParams;
  const person = await getPerson(user.id, id);
  if (!person) notFound();
  const isAdmin = user.role === "ADMIN";
  const volver = first(sp.volver);
  const back = sanitizeBack(volver, ["q", "status", "equipo", "pmo", "fecha", "sort", "dir", "page"]);
  const fecha = isIsoDate(first(sp.fecha)) ? first(sp.fecha) : todayMadrid();
  const hp = Math.max(Number(first(sp.hp)) || 1, 1);
  const [catalog, resolved, history] = await Promise.all([
    listCatalog(user.id, undefined, { onlyActive: true }),
    resolvePersonAt(user.id, id, fecha),
    isAdmin ? listPersonHistory(user.id, id, { page: hp }) : null,
  ]);
  const options: CatalogOptions = { LEVEL: [], TEAM: [], PMO_ROLE: [] };
  for (const c of catalog) options[c.kind].push({ value: c.id, label: c.name });
  const canEdit = isAdmin && person.isActive;
  const baseQs = `?${new URLSearchParams({ ...(volver ? { volver } : {}), ...(sp.fecha ? { fecha } : {}) }).toString()}`;
  return (
    <>
      <p><Link href={`/administracion/personal${back ? `?${back}` : ""}`}>← Volver a Personal</Link></p>
      <h1>{person.name} {" "}<StatusBadge active={person.isActive} /></h1>
      {first(sp.creada) ? <p className="notice notice-ok" role="status">Persona creada. Añada ahora sus alias y su situación.</p> : null}
      {!person.isActive ? <p className="notice notice-info">Persona inactiva: se conserva con sus alias, vigencias e historial, pero no admite nuevos datos hasta reactivarla.</p> : null}

      <section className="card" aria-labelledby="sec-datos">
        <h2 id="sec-datos">Datos de la persona</h2>
        {isAdmin ? (
          <ActionForm action={updatePersonAction} hidden={{ id: person.id, expectedVersion: person.version }}>
            <TextField name="name" label="Nombre canónico" initial={person.name} required maxLength={200} />
            <TextAreaField name="note" label="Nota" initial={person.note ?? ""} />
            <div className="form-actions"><SubmitButton>Guardar cambios</SubmitButton></div>
          </ActionForm>
        ) : (
          <dl className="kv"><dt>Nombre</dt><dd>{person.name}</dd><dt>Nota</dt><dd>{person.note ?? "—"}</dd></dl>
        )}
        {isAdmin ? <div className="row-actions" style={{ marginTop: "0.5rem" }}><ToggleActive entity="person" id={person.id} version={person.version} active={person.isActive} /></div> : null}
      </section>

      <section className="card" aria-labelledby="sec-situacion">
        <h2 id="sec-situacion">Situación a una fecha</h2>
        <form className="toolbar" method="get" action={`/administracion/personal/${id}`}>
          {volver ? <input type="hidden" name="volver" value={volver} /> : null}
          <div className="field"><label htmlFor="fecha">Fecha</label><input id="fecha" type="date" name="fecha" defaultValue={fecha} /></div>
          <button className="btn btn-secondary" type="submit">Consultar</button>
        </form>
        <SituationCard date={fecha} resolved={resolved} />
      </section>

      <AliasesSection personId={person.id} rows={person.aliases} canEdit={canEdit} />
      <TermsSection personId={person.id} rows={person.terms} catalog={options} canEdit={canEdit} />
      {history ? <HistorySection events={history.rows} total={history.total} page={history.page} pageCount={history.pageCount} base={`/administracion/personal/${id}${baseQs}`} /> : null}
    </>
  );
}
