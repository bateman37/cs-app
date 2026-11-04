import Link from "next/link";
import { DiagnosticoDatos } from "../conciliacion/diagnostico";

/**
 * Herramientas técnicas (HOTFIX-03 §3): lo que antes eran pestañas del menú principal. Comprobar cifras, saber si el trabajador funciona y las excepciones de servicio
 * conservan sus motores y permisos; aquí solo cambian de sitio y de lenguaje. Las URL antiguas siguen funcionando.
 */
export async function HerramientasSection({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  return (
    <>
      <section className="card" aria-labelledby="sec-tools">
        <h2 id="sec-tools">Herramientas técnicas</h2>
        <ul className="tool-list">
          <li><strong>Comprobación de datos</strong>: qué deja cifras incompletas y qué hacer (abajo). Comprobación en tres niveles: <Link href="/administracion/conciliacion">Conciliación</Link> · detalle de un Grupo: <Link href="/administracion/economia">Comprobación económica</Link>.</li>
          <li><strong>Excepciones de servicio</strong> (avanzado): corrige cómo se clasifica un entorno o proyecto concreto. El recorrido normal usa la clasificación automática. <Link href="/administracion/servicios">Abrir excepciones</Link>.</li>
          <li><strong>Estado de la aplicación</strong>: trabajador, cola, fallos, recuperación y copias. {isAdmin ? <Link href="/administracion/operacion">Abrir estado de la aplicación</Link> : "Solo Administradores."}</li>
          <li><strong>Descargas y exportaciones</strong>: {isAdmin ? <Link href="/administracion/exportaciones">archivos grandes, propietarios y cancelación</Link> : "Solo Administradores."}</li>
          <li><strong>Catálogo de productos</strong> (avanzado): <Link href="/administracion/clientes/productos">mantenimiento del catálogo</Link>; la separación técnica VFS/VSW se conserva.</li>
        </ul>
      </section>
      <DiagnosticoDatos userId={userId} />
    </>
  );
}
