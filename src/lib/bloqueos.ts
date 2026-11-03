// @ts-nocheck
// ---------------------------------------------------------------------------
// Bloqueo de edición: evita que dos personas editen el mismo registro a la vez.
//
// Usa la "presencia" de Supabase Realtime (no necesita tablas ni SQL): cada
// app conectada avisa qué registro está editando. El que abrió primero la
// edición la conserva; los demás ven quién la tiene y esperan.
//
// La edición se libera:
//  - al cerrar el cuadro de edición;
//  - al salir de la app o dejarla en segundo plano (cambiar de app, apagar la
//    pantalla), porque el celular puede dejar la conexión abierta un buen rato;
//  - si una app deja de dar señales de vida por más de 1 minuto (cada app que
//    edita avisa cada 20 s que sigue ahí).
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Identificador de esta pestaña/app (dos pestañas del mismo usuario cuentan
// como dos ediciones distintas).
const SESION = Math.random().toString(36).slice(2) + Date.now().toString(36);
const LATIDO_MS = 20000;
const VENCE_MS = 65000;

let canal = null;
let conectado = false;
let estado = {}; // presencia: { [sesion]: [{ clave, usuario, nombre, desde, latido, sesion }] }
let miEdicion = null; // { clave, usuario, nombre, desde, latido, sesion }
let enPausa = false; // app en segundo plano
const oyentes = new Set();
const avisar = () => oyentes.forEach((f) => f());

// Última vez (reloj de ESTE equipo) que vimos cambiar el latido de cada
// sesión: así no dependemos de que los relojes de los celulares coincidan.
const vistos = {}; // sesion -> { latido, en }

function enviarMiEstado() {
  if (!canal || !conectado) return;
  if (miEdicion && !enPausa) canal.track({ ...miEdicion, latido: Date.now() }).catch(() => {});
  else canal.untrack().catch(() => {});
}

function asegurarCanal() {
  if (canal) return;
  try {
    canal = supabase.channel("ts-edicion", { config: { presence: { key: SESION } } });
    canal
      .on("presence", { event: "sync" }, () => {
        estado = canal.presenceState() || {};
        const ahora = Date.now();
        Object.values(estado).forEach((metas) =>
          (metas || []).forEach((m) => {
            if (!m || !m.sesion) return;
            const v = vistos[m.sesion];
            if (!v || v.latido !== m.latido) vistos[m.sesion] = { latido: m.latido, en: ahora };
          })
        );
        avisar();
      })
      .subscribe((st) => {
        conectado = st === "SUBSCRIBED";
        if (conectado) enviarMiEstado();
        avisar();
      });
  } catch (e) {
    canal = null;
  }
}

// ¿Esa app sigue dando señales de vida?
function vigente(m) {
  if (m.sesion === SESION) return true;
  const v = vistos[m.sesion];
  return !v || Date.now() - v.en < VENCE_MS;
}

// Quién tiene la edición de un registro: el que la abrió primero (entre los
// que siguen activos).
function titularDe(clave) {
  const lista = [];
  Object.values(estado).forEach((metas) =>
    (metas || []).forEach((m) => {
      if (m && m.clave === clave && vigente(m)) lista.push(m);
    })
  );
  if (miEdicion && miEdicion.clave === clave && !enPausa && !lista.some((m) => m.sesion === SESION)) lista.push(miEdicion);
  lista.sort((a, b) => a.desde - b.desde || String(a.sesion).localeCompare(String(b.sesion)));
  return lista[0] || null;
}

// Hook para el cuadro de edición de un registro.
// clave: "trabajos:ID" (null al crear un registro nuevo: no se bloquea).
// Devuelve { estado: "libre" | "verificando" | "propio" | "ocupado", editor }
export function useBloqueoEdicion(clave, yo) {
  const [, refrescar] = useState(0);
  const [verificando, setVerificando] = useState(!!clave);

  useEffect(() => {
    if (!clave) return;
    asegurarCanal();
    const f = () => refrescar((n) => n + 1);
    oyentes.add(f);
    miEdicion = { clave, usuario: yo?.usuario || "", nombre: yo?.nombre || yo?.usuario || "", desde: Date.now(), sesion: SESION };
    enviarMiEstado();
    // Se espera un momento a que lleguen los demás (si no hay conexión, no se
    // bloquea la edición).
    setVerificando(true);
    const t = setTimeout(() => setVerificando(false), conectado ? 900 : 2500);
    // Señal de vida cada 20 s y revisión de ediciones vencidas.
    const latido = setInterval(() => {
      enviarMiEstado();
      f();
    }, LATIDO_MS);
    return () => {
      clearTimeout(t);
      clearInterval(latido);
      oyentes.delete(f);
      if (miEdicion && miEdicion.clave === clave) {
        miEdicion = null;
        enviarMiEstado();
      }
    };
  }, [clave]);

  if (!clave) return { estado: "libre", editor: null };
  const titular = titularDe(clave);
  if (titular && titular.sesion !== SESION) return { estado: "ocupado", editor: titular };
  if (verificando) return { estado: "verificando", editor: null };
  return { estado: "propio", editor: titular || miEdicion };
}

if (typeof window !== "undefined") {
  // App en segundo plano o cerrada: se libera la edición. Al volver, se pide
  // de nuevo (si otra persona la tomó mientras tanto, se queda esperando).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      enPausa = true;
      enviarMiEstado();
    } else if (enPausa) {
      enPausa = false;
      if (miEdicion) miEdicion = { ...miEdicion, desde: Date.now() };
      enviarMiEstado();
    }
    avisar();
  });
  window.addEventListener("pagehide", () => {
    enPausa = true;
    enviarMiEstado();
  });
}
