// @ts-nocheck
// ---------------------------------------------------------------------------
// Bloqueo de edición: evita que dos personas editen el mismo registro a la vez.
//
// Usa la "presencia" de Supabase Realtime (no necesita tablas ni SQL): cada
// app conectada avisa qué registro está editando. El que abrió primero la
// edición la conserva; los demás ven quién la tiene y esperan. Al cerrar el
// cuadro de edición, o al cerrar la app (se corta la conexión), el registro
// queda libre automáticamente.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Identificador de esta pestaña/app (dos pestañas del mismo usuario cuentan
// como dos ediciones distintas).
const SESION = Math.random().toString(36).slice(2) + Date.now().toString(36);

let canal = null;
let conectado = false;
let estado = {}; // presencia: { [sesion]: [{ clave, usuario, nombre, desde, sesion }] }
let miEdicion = null; // { clave, usuario, nombre, desde, sesion }
const oyentes = new Set();
const avisar = () => oyentes.forEach((f) => f());

function enviarMiEstado() {
  if (!canal || !conectado) return;
  if (miEdicion) canal.track(miEdicion).catch(() => {});
  else canal.untrack().catch(() => {});
}

function asegurarCanal() {
  if (canal) return;
  try {
    canal = supabase.channel("ts-edicion", { config: { presence: { key: SESION } } });
    canal
      .on("presence", { event: "sync" }, () => {
        estado = canal.presenceState() || {};
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

// Quién tiene la edición de un registro: el que la abrió primero.
function titularDe(clave) {
  const lista = [];
  Object.values(estado).forEach((metas) =>
    (metas || []).forEach((m) => {
      if (m && m.clave === clave) lista.push(m);
    })
  );
  if (miEdicion && miEdicion.clave === clave && !lista.some((m) => m.sesion === SESION)) lista.push(miEdicion);
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
    return () => {
      clearTimeout(t);
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

// Si se cierra la app o la pestaña, se libera la edición enseguida.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (miEdicion && canal) {
      miEdicion = null;
      try {
        canal.untrack();
      } catch (e) {}
    }
  });
}
