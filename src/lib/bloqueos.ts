// @ts-nocheck
// ---------------------------------------------------------------------------
// Bloqueo de edición: evita que dos personas editen el mismo registro a la vez.
//
// Quién edita cada registro se guarda en la tabla "bloqueos_edicion"
// (supabase/6_bloqueo_edicion.sql) mediante funciones seguras:
//  - tomar_edicion: toma (o renueva) la edición; si otra persona ya la tiene,
//    devuelve quién es. Es atómico: nunca quedan dos editando.
//  - soltar_edicion: la libera al instante (al guardar, cerrar con la X, dejar
//    la app en segundo plano o cerrarla).
// La app que edita avisa cada 15 s; si una app se cierra de golpe (sin
// señal, sin batería), el registro se libera solo a los 40 s.
// Los cambios llegan a los demás en tiempo real y, además, quien espera
// vuelve a intentar cada 4 s, así se entera aunque falle el tiempo real.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "./supabase";

// Identificador de esta pestaña/app.
const SESION = Math.random().toString(36).slice(2) + Date.now().toString(36);
const LATIDO_MS = 15000;
const REINTENTO_MS = 4000;
const VENCE_MS = 45000;

// Ediciones en curso de todos: clave -> { sesion, usuario, nombre, desde, vistoEn }
let activas = {};
const oyentes = new Set();
const avisar = () => oyentes.forEach((f) => f());

let iniciado = false;
let sinServidor = false; // no está instalado el SQL: no se bloquea
let token = null; // para liberar al cerrar la app (fetch keepalive)

function registrar(fila, edadSeg = 0) {
  if (!fila || !fila.clave) return;
  activas[fila.clave] = {
    sesion: fila.sesion,
    usuario: fila.usuario,
    nombre: fila.nombre,
    desde: fila.desde,
    vistoEn: Date.now() - (Number(edadSeg) || 0) * 1000,
  };
}
const vigente = (e) => e && Date.now() - e.vistoEn < VENCE_MS;

async function cargarActivas() {
  const { data, error } = await supabase.rpc("ediciones_activas");
  if (error) {
    if (/ediciones_activas|function/i.test(error.message || "")) sinServidor = true;
    return;
  }
  activas = {};
  (data || []).forEach((f) => registrar(f, f.edad_seg));
  avisar();
}

// Se llama al iniciar sesión: carga quién edita qué y escucha los cambios.
export function iniciarPresencia() {
  if (iniciado) return;
  iniciado = true;
  supabase.auth.getSession().then(({ data }) => (token = data && data.session ? data.session.access_token : null));
  supabase.auth.onAuthStateChange((_e, s) => (token = s ? s.access_token : null));
  cargarActivas();
  try {
    supabase
      .channel("ts-bloqueos")
      .on("postgres_changes", { event: "*", schema: "public", table: "bloqueos_edicion" }, (p) => {
        if (p.eventType === "DELETE") {
          const clave = p.old && p.old.clave;
          if (clave && activas[clave] && (!p.old.sesion || activas[clave].sesion === p.old.sesion)) delete activas[clave];
        } else registrar(p.new);
        avisar();
      })
      .subscribe((st) => {
        if (st === "SUBSCRIBED") cargarActivas();
      });
  } catch (e) {}
  // Revisión periódica (por si se perdió algún aviso) y vencimientos.
  setInterval(() => {
    if (document.visibilityState === "visible") cargarActivas();
  }, LATIDO_MS * 2);
}

// Ediciones en curso de OTRAS apps: { "trabajos:ID": { usuario, nombre, ... } }
export function useEdicionesActivas() {
  const [, refrescar] = useState(0);
  useEffect(() => {
    iniciarPresencia();
    const f = () => refrescar((n) => n + 1);
    oyentes.add(f);
    const t = setInterval(f, 10000);
    return () => {
      oyentes.delete(f);
      clearInterval(t);
    };
  }, []);
  const mapa = {};
  Object.entries(activas).forEach(([clave, e]) => {
    if (e.sesion !== SESION && vigente(e)) mapa[clave] = e;
  });
  return mapa;
}

// --- Edición propia ---------------------------------------------------------
let miClave = null;
let enPausa = false;

async function tomar(clave, yo) {
  const { data, error } = await supabase.rpc("tomar_edicion", {
    p_clave: clave,
    p_sesion: SESION,
    p_usuario: (yo && yo.usuario) || "",
    p_nombre: (yo && (yo.nombre || yo.usuario)) || "",
  });
  if (error) {
    if (/tomar_edicion|function/i.test(error.message || "")) sinServidor = true;
    return null;
  }
  if (data) {
    registrar({ clave, ...data });
    avisar();
  }
  return data;
}
function soltar(clave) {
  if (activas[clave] && activas[clave].sesion === SESION) delete activas[clave];
  avisar();
  return supabase.rpc("soltar_edicion", { p_sesion: SESION, p_clave: clave }).then(
    () => {},
    () => {}
  );
}
// Al cerrar la app, el pedido debe salir aunque la página se cierre.
function soltarAlCerrar() {
  if (!miClave || !token || !SUPABASE_URL) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/soltar_edicion`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ p_sesion: SESION, p_clave: null }),
    });
  } catch (e) {}
}

// Hook para el cuadro de edición de un registro.
// clave: "trabajos:ID" (null al crear un registro nuevo: no se bloquea).
// Devuelve { estado: "libre" | "verificando" | "propio" | "ocupado", editor }
export function useBloqueoEdicion(clave, yo) {
  const [estado, setEstado] = useState(clave ? "verificando" : "libre");
  const [editor, setEditor] = useState(null);

  useEffect(() => {
    if (!clave) return;
    iniciarPresencia();
    let vivo = true;
    let temporizador = null;
    miClave = clave;

    async function intentar() {
      if (!vivo) return;
      clearTimeout(temporizador);
      if (enPausa) {
        temporizador = setTimeout(intentar, 1000);
        return;
      }
      const r = await tomar(clave, yo);
      if (!vivo) return;
      if (!r) {
        // Sin conexión o sin el SQL instalado: no se bloquea la edición.
        setEstado("propio");
        setEditor({ usuario: yo && yo.usuario, nombre: yo && yo.nombre });
        temporizador = setTimeout(intentar, sinServidor ? 60000 : REINTENTO_MS);
        return;
      }
      setEditor({ usuario: r.usuario, nombre: r.nombre, desde: r.desde });
      setEstado(r.propio ? "propio" : "ocupado");
      // Dueño: renueva cada 15 s. Esperando: reintenta cada 4 s.
      temporizador = setTimeout(intentar, r.propio ? LATIDO_MS : REINTENTO_MS);
    }
    intentar();

    // Si el que editaba liberó el registro, se intenta enseguida.
    const alCambiar = () => {
      const e = activas[clave];
      if (!e || e.sesion !== SESION) {
        if (!e && vivo) intentar();
      }
    };
    oyentes.add(alCambiar);

    // App en segundo plano: se libera; al volver se pide de nuevo.
    const alVisibilidad = () => {
      if (document.visibilityState === "hidden") {
        enPausa = true;
        soltar(clave);
      } else if (enPausa) {
        enPausa = false;
        intentar();
      }
    };
    document.addEventListener("visibilitychange", alVisibilidad);

    return () => {
      vivo = false;
      clearTimeout(temporizador);
      oyentes.delete(alCambiar);
      document.removeEventListener("visibilitychange", alVisibilidad);
      if (miClave === clave) miClave = null;
      soltar(clave);
    };
  }, [clave]);

  if (!clave) return { estado: "libre", editor: null };
  return { estado, editor };
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", soltarAlCerrar);
}
