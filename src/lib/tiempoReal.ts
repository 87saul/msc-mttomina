// @ts-nocheck
// ---------------------------------------------------------------------------
// Actualización en tiempo real: cuando alguien registra, edita o elimina un
// trabajo, aceite o requerimiento, los demás lo ven sin actualizar la app.
//
// Usa Supabase Realtime ("postgres_changes"). Requiere ejecutar una vez
// supabase/5_tiempo_real.sql. La seguridad (RLS) se mantiene.
// Si la conexión se corta (celular en segundo plano, sin señal), al volver se
// recargan los datos para no perder nada de lo que pasó mientras tanto.
// ---------------------------------------------------------------------------
import { supabase } from "./supabase";
import { desdeFila } from "./datos";

const TABLAS = ["trabajos", "aceites", "requerimientos", "engrases"];

// onCambio(tabla, tipo: "INSERT" | "UPDATE" | "DELETE", fila | null, id, creadoPor)
// onPerdido(): la conexión se cortó y volvió (conviene recargar todo).
export function escucharCambios(onCambio, onPerdido) {
  let canal = null;
  let yaConectado = false;
  let cortado = false;
  try {
    canal = supabase.channel("ts-cambios");
    TABLAS.forEach((tabla) => {
      canal.on("postgres_changes", { event: "*", schema: "public", table: tabla }, (p) => {
        const tipo = p.eventType;
        const nueva = p.new && Object.keys(p.new).length ? p.new : null;
        const id = (nueva && nueva.id) || (p.old && p.old.id);
        if (id === undefined || id === null) return;
        onCambio(tabla, tipo, tipo === "DELETE" ? null : desdeFila(nueva), id, nueva ? nueva.creado_por : null);
      });
    });
    canal.subscribe((estado) => {
      if (estado === "SUBSCRIBED") {
        if (yaConectado && cortado && onPerdido) onPerdido();
        yaConectado = true;
        cortado = false;
      } else if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED") {
        cortado = true;
      }
    });
  } catch (e) {
    canal = null;
  }

  // App en segundo plano más de 1 minuto: al volver se recarga todo.
  let ocultaDesde = 0;
  function alCambiarVisibilidad() {
    if (document.visibilityState === "hidden") ocultaDesde = Date.now();
    else if (ocultaDesde && Date.now() - ocultaDesde > 60000 && onPerdido) {
      ocultaDesde = 0;
      onPerdido();
    }
  }
  document.addEventListener("visibilitychange", alCambiarVisibilidad);

  return () => {
    document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    if (canal) {
      try {
        supabase.removeChannel(canal);
      } catch (e) {}
    }
  };
}
