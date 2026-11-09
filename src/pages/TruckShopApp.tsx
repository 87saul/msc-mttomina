// @ts-nocheck
// TRUCK SHOP — aplicación principal (escritorio y celular).
// Todos los datos se leen y guardan en Supabase (ver src/lib/datos.ts).
import React, { useState, useMemo, useEffect, useRef, useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as db from "../lib/datos";
import { useBloqueoEdicion, iniciarPresencia, useEdicionesActivas } from "../lib/bloqueos";
import { escucharCambios } from "../lib/tiempoReal";
import { useSesion } from "../hooks/useSesion";
import { RUTAS, vistaDesdeRuta } from "../routes/rutas";
import CambiarContrasena from "../components/CambiarContrasena";

/**
 * TRUCK SHOP — Vista previa funcional (sin backend)
 * ---------------------------------------------------
 * Componente único, sin dependencias externas (sin Tailwind, sin librerías de
 * iconos ni gráficos), pensado para revisar visual y funcionalmente el
 * sistema antes de conectar Supabase. Todos los datos viven en memoria
 * (useState) y se pierden al refrescar — es solo una maqueta interactiva.
 *
 * Cómo usar: importar <TruckShopPreview /> en cualquier proyecto React
 * (Vite, CRA, etc.) y renderizarlo. No requiere configuración adicional.
 */

// ---------------------------------------------------------------------------
// Datos de referencia (catálogos fijos definidos en Fase 1)
// ---------------------------------------------------------------------------

// Flotas de equipos. Se pueden agregar y renombrar en Configuración →
// Flotas y equipos. Al renombrar, el nombre nuevo se aplica a los equipos y
// a todos los registros (trabajos, aceites, requerimientos) de esa flota.
const FLOTAS_INICIAL = ["ACARREO", "CARGUIO"];
const registroFlotas = { todas: FLOTAS_INICIAL, inactivas: [] };

// Flotas activas: las que se ofrecen al registrar equipos y las que se
// muestran en Inicio y en los filtros.
function listaFlotas() {
  return registroFlotas.todas.filter((f) => !registroFlotas.inactivas.includes(f));
}

// Todas las flotas, incluidas las inactivas (para la tabla de equipos).
function todasLasFlotas() {
  return registroFlotas.todas;
}

// Flotas y equipos reales (archivo FLOTAS.xlsx): código, flota, modelo y descripción.
const EQUIPOS_INICIAL = [];

const ROLES = ["Administrador", "Supervisor", "Técnico", "Planificador", "Lubricador"];


// Rol que corresponde a cada grupo del personal de Configuración.
function rolDeCategoria(categoria) {
  if (categoria === "supervision") return "Supervisor";
  if (categoria === "lubrico") return "Lubricador";
  if (categoria === "planificacion") return "Planificador";
  return "Técnico";
}

// Roles que se pueden asignar al personal desde Configuración (el rol
// Administrador es una cuenta aparte y no se asigna aquí). El rol define los
// permisos; el cargo es solo el puesto de la persona. Ambos son editables:
// p. ej. un técnico (cargo) puede tener permisos de Supervisor (rol), o un
// técnico ascendido puede pasar a cargo Planificador.
const ROLES_ASIGNABLES = ["Supervisor", "Planificador", "Técnico", "Lubricador"];
const CARGOS = ["Supervisor", "Planificador", "Técnico", "Lubricador"];

// Rol efectivo (permisos) de una persona: el asignado, o el de su grupo.
function rolDePersona(p) {
  return p.rol || rolDeCategoria(p.categoria);
}

// Cargo de una persona: el asignado, o el que corresponde a su grupo.
function cargoDePersona(p) {
  return p.cargo || rolDeCategoria(p.categoria);
}

// ---------------------------------------------------------------------------
// Grupos del personal (columna "Grupo" de Configuración)
// ---------------------------------------------------------------------------
// Cada grupo de trabajo se divide por flota en el mismo turno (GRUPO 1 –
// ACARREO, GRUPO 1 – CARGUIO…), y cada subgrupo tiene su propio personal y
// supervisor. Una persona guarda su grupo (categoria: número del grupo, o
// "supervision" / "lubrico" / "planificacion") y, si es de un grupo de
// trabajo, la flota del subgrupo (flota_grupo).
// GRUPO SUPERVISIÓN y Planificación también se dividen por flota.
// La "clave" identifica el cuadro de Configuración: "s:supervision:ACARREO",
// "g:1:ACARREO", "lubrico", "s:planificacion:CARGUIO".
// Secciones fijas que también se dividen por flota (ACARREO / CARGUIO).
const SECCIONES_POR_FLOTA = ["supervision", "planificacion"];

// Alcance de un grupo de trabajo respecto de las flotas:
//   "separado": un subgrupo (y un cuadro) por cada flota (Grupo 1 – ACARREO,
//               Grupo 1 – CARGUIO…).
//   "conjunto": trabaja con todas las flotas a la vez (un solo cuadro).
//   "todas":    igual que "conjunto", pero el cuadro lleva solo el nombre del
//               grupo, sin flotas (como Lubrico).
//   "<FLOTA>":  trabaja solo con esa flota (un solo cuadro).
// "*" es la flota del personal de un grupo "conjunto".
function grupoPorId(id) {
  return listaGrupos().find((g) => g.id === Number(id));
}
function flotasDeGrupo(grupo, flotas) {
  const alcance = (grupo && grupo.alcance) || "separado";
  if (alcance === "conjunto" || alcance === "todas") return ["*"];
  if (alcance === "separado") return flotas;
  return [alcance];
}
function textoFlotaDeGrupo(flota) {
  return flota === "*" ? listaFlotas().join(" / ") : flota;
}

function claveGrupoPersona(p) {
  const flota = p.flota_grupo || listaFlotas()[0] || "";
  if (typeof p.categoria === "number") {
    const opciones = flotasDeGrupo(grupoPorId(p.categoria), listaFlotas());
    const valida =
      p.flota_grupo && (opciones.includes(p.flota_grupo) || ((grupoPorId(p.categoria) || {}).alcance || "separado") === "separado");
    return `g:${p.categoria}:${valida ? p.flota_grupo : opciones[0] || flota}`;
  }
  if (SECCIONES_POR_FLOTA.includes(p.categoria)) return `s:${p.categoria}:${flota}`;
  return p.categoria;
}
function datosDeClaveGrupo(clave) {
  const texto = String(clave);
  if (texto.startsWith("g:") || texto.startsWith("s:")) {
    const [tipo, id, ...flota] = texto.split(":");
    return { categoria: tipo === "g" ? Number(id) : id, flota_grupo: flota.join(":") };
  }
  return { categoria: clave, flota_grupo: "" };
}
function textoClaveGrupo(clave) {
  const texto = String(clave);
  if (texto.startsWith("g:") || texto.startsWith("s:")) {
    const { categoria, flota_grupo } = datosDeClaveGrupo(clave);
    const base = typeof categoria === "number" ? nombreGrupo(categoria) : tituloSeccion(categoria);
    // Grupo de "todas las flotas" (como Lubrico): solo el nombre.
    if (typeof categoria === "number" && (grupoPorId(categoria) || {}).alcance === "todas") return base;
    return `${base} – ${textoFlotaDeGrupo(flota_grupo)}`;
  }
  return tituloSeccion(clave);
}
// Cuadros de personal eliminados en Configuración (Back Office – FLOTA,
// Planificación – FLOTA, Lubrico o un subgrupo de un grupo de trabajo).
const registroCuadrosOcultos = { lista: [] };
// Lista de grupos para elegir en la columna "Grupo".
function opcionesGrupoPersona(flotas) {
  return [
    ...flotas.map((f) => `s:supervision:${f}`),
    ...listaGrupos().flatMap((g) => flotasDeGrupo(g, flotas).map((f) => `g:${g.id}:${f}`)),
    "lubrico",
    ...flotas.map((f) => `s:planificacion:${f}`),
  ].filter((c) => !registroCuadrosOcultos.lista.includes(c));
}


// Personal real del taller (lista entregada el 09/10/2026, formato
// "Apellidos Nombres"). Back Office y Planificación con cargo Supervisor y
// Planificador; Grupos 1–4 con cargo Técnico; Lubrico con cargo Lubricador.
// Usuario provisional: primer apellido + inicial del primer nombre.
// 
const PERSONAL_INICIAL = [];

// Grupos de trabajo (técnicos por turno). El id numérico es el que se guarda
// en cada registro de trabajo y en el personal; el nombre es editable en
// Configuración (ej. "Grupo 1" → "GRUPO A1") y se pueden crear grupos nuevos.
// Supervisión y Lubrico son categorías fijas y no forman parte de esta lista.
const GRUPOS_TRABAJO_INICIAL = [
  { id: 1, nombre: "Grupo 1" },
  { id: 2, nombre: "Grupo 2" },
  { id: 3, nombre: "Grupo 3" },
  { id: 4, nombre: "Grupo 4" },
];

// Registro con la lista vigente de grupos. El componente principal lo
// actualiza en cada render, así cualquier tabla, formulario, impresión o
// exportación muestra el nombre actual del grupo.
const registroGrupos = { lista: GRUPOS_TRABAJO_INICIAL };

// Nombres editables de las secciones fijas de Configuración. La clave interna
// no cambia (el personal sigue asociado a "supervision", "lubrico", etc.);
// solo cambia el texto que se muestra.
const TITULOS_SECCIONES_INICIAL = {
  supervision: "Back Office",
  lubrico: "Lubrico",
  planificacion: "Planificación",
  flotas: "Flotas y equipos",
  aceites: "Aceites",
  sistemas: "Sistema de equipo",
};
const registroTitulos = { valores: TITULOS_SECCIONES_INICIAL };

function tituloSeccion(clave) {
  return registroTitulos.valores[clave] || TITULOS_SECCIONES_INICIAL[clave] || clave;
}

function listaGrupos() {
  return registroGrupos.lista;
}

function nombreGrupo(id) {
  if (id === undefined || id === null || id === "") return "";
  const g = registroGrupos.lista.find((x) => x.id === Number(id));
  return g ? g.nombre : `Grupo ${id}`;
}

// Paleta de colores de acento disponibles para personalizar el aspecto de
// la app (botones, pestaña activa, indicadores). El color por defecto
// coincide con el ámbar de seguridad usado en el diseño original.
const COLORES_ACENTO = [
  { nombre: "Azul", valor: "#4F8FE0" },
  { nombre: "Rojo", valor: "#E5534B" },
  { nombre: "Verde", valor: "#2FA36B" },
  { nombre: "Rosa", valor: "#D6488B" },
  { nombre: "Ámbar", valor: "#F2A93B" },
  { nombre: "Morado", valor: "#6C5FC7" },
  { nombre: "Verde azulado", valor: "#12876A" },
  { nombre: "Cian", valor: "#13A8B0" },
  { nombre: "Celeste", valor: "#2F8FEF" },
  { nombre: "Oscuro", valor: "#2A3138" },
  { nombre: "Azul marino", valor: "#00304E" },
  { nombre: "Negro", valor: "#000000" },
];

// Opciones de color para el panel izquierdo (sidebar), independientes del
// tema general oscuro/claro de la app.
const OPCIONES_PANEL_IZQUIERDO = [
  { clave: "oscuro", nombre: "Oscuro", bg: "#10141a", texto: "#e7ecef", textoDim: "#8b96a1", borde: "#333c44", hover: "#1d2329" },
  { clave: "claro", nombre: "Claro", bg: "#f7f5f3", texto: "#1b1f24", textoDim: "#6b6560", borde: "#e3dfda", hover: "#ece8e4" },
  { clave: "blanco", nombre: "Blanco", bg: "#ffffff", texto: "#1b1f24", textoDim: "#626b74", borde: "#e5e7eb", hover: "#f3f4f6" },
];

const FUENTES_DISPONIBLES = [
  { nombre: "Predeterminada (Inter)", valor: "Inter, -apple-system, \"Segoe UI\", Roboto, sans-serif" },
  { nombre: "Arial", valor: "Arial, Helvetica, sans-serif" },
  { nombre: "Georgia", valor: "Georgia, \"Times New Roman\", serif" },
  { nombre: "Roboto", valor: "Roboto, Arial, sans-serif" },
  { nombre: "Courier New", valor: "\"Courier New\", Courier, monospace" },
];

// Tamaño de fuente de toda la app. El valor es el tamaño base; todos los
// textos se escalan en proporción a él (base normal = 14px).
const TAMANOS_FUENTE = [
  { nombre: "Pequeño", valor: "13px" },
  { nombre: "Navegador (normal)", valor: "14px" },
  { nombre: "Grande", valor: "16px" },
  { nombre: "Muy grande", valor: "18px" },
];

// Tokens de color para el modo claro. El modo oscuro es el definido por
// defecto en los estilos base (.ts-root); estos valores se aplican como
// variables CSS inline cuando el usuario activa el modo claro.
const TEMA_CLARO = {
  "--bg": "#f7f5f3", // blanco cálido (tono hueso)
  "--panel": "#ffffff",
  "--panel-2": "#efece9",
  "--border": "#e3dfda",
  "--text": "#1b1f24",
  "--text-dim": "#626b74",
  "--sidebar-bg": "#ffffff",
  "--green": "#2e9e5f",
  "--green-dim": "#dcf3e6",
  "--red": "#d1443c",
  "--red-dim": "#fbe0de",
  "--blue": "#3f7fdb",
  "--blue-dim": "#e1ebfc",
  "--yellow": "#9a6b00",
  "--yellow-dim": "#fff1bf",
};

// Tokens de color para el modo blanco: fondo y paneles en blanco puro,
// separados solo por bordes suaves (estilo documento limpio).
const TEMA_BLANCO = {
  ...TEMA_CLARO,
  "--bg": "#ffffff",
  "--panel": "#ffffff",
  // Tono cálido (hueso), el mismo del panel izquierdo "Claro", en lugar
  // del gris plomo: filas resaltadas, campos, tarjetas y botones.
  "--panel-2": "#f3f0ed",
  "--border": "#e8e4df",
};

// Temas generales disponibles en Configuración → Aspecto.
const TEMAS_APP = {
  oscuro: {},
  claro: TEMA_CLARO,
  blanco: TEMA_BLANCO,
};

// Personal disponible para elegir como participante de un TRABAJO DE MANTENIMIENTO,
// según el grupo seleccionado en el formulario. Supervisión queda siempre
// disponible porque un supervisor puede participar en cualquier turno.
// El grupo Lubrico no participa en trabajos de mantenimiento: se dedica
// exclusivamente a adiciones y cambios de aceite.
// Texto corto para los chips de "Personal participante": el usuario de la
// persona (ej. QuintinC) en lugar del nombre completo, para ocupar menos
// espacio. Se sigue guardando el nombre completo (que se ve al pasar el mouse
// y sale en impresiones y reportes). El personal de apoyo escrito a mano se
// muestra tal cual.
function etiquetaPersona(personal, nombre) {
  const p = personal.find((x) => x.nombre === nombre);
  return (p && p.usuario) || nombre;
}

// Impresiones y descargas (PDF, Word, Excel): en "Personal" va solo el
// usuario de cada persona (ej. RaulQ, QuintinC) para ocupar menos espacio.
// El personal de apoyo escrito a mano sale tal cual.
const registroPersonal = { lista: [] };
const normalizarNombre = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .trim();
function usuarioDoc(nombre) {
  const p = personaDeNombre(nombre);
  return p && p.usuario ? p.usuario : nombre;
}
// Persona registrada (con usuario) que corresponde a un nombre, o null si es
// personal de apoyo escrito a mano.
function personaDeNombre(nombre) {
  if (!nombre) return null;
  const lista = registroPersonal.lista || [];
  const n = normalizarNombre(nombre);
  // 1) Nombre completo o usuario exactos.
  const exacto = lista.find((x) => normalizarNombre(x.nombre) === n || normalizarNombre(x.usuario) === n);
  if (exacto) return exacto.usuario ? exacto : null;
  // 2) Nombre corto de los reportes ("Raul", "Raymundo A."): una sola
  //    persona cuyo nombre tenga esa palabra (y la inicial, si la hay).
  const partes = n.split(/\s+/).filter(Boolean);
  if (!partes.length || partes.length > 2) return null;
  const [palabra, inicial] = partes;
  if (palabra.length < 3) return null;
  const candidatos = lista.filter((x) => {
    const t = normalizarNombre(x.nombre).split(/\s+/);
    const i = t.indexOf(palabra);
    if (i < 0) return false;
    return !inicial || t.some((o, j) => j !== i && o.startsWith(inicial));
  });
  return candidatos.length === 1 && candidatos[0].usuario ? candidatos[0] : null;
}
// Lista de personal: primero los usuarios registrados y al final el
// personal de apoyo (en el orden en que se agregaron).
const usuariosDoc = (lista) => {
  const todos = (lista || []).map((n) => ({ n, p: personaDeNombre(n) }));
  return [
    ...todos.filter((x) => x.p).map((x) => x.p.usuario),
    ...todos.filter((x) => !x.p).map((x) => x.n),
  ];
};

// Si se indica la flota (la del equipo del trabajo), solo se muestra el
// personal del subgrupo de esa flota (p. ej. GRUPO 1 – CARGUIO), incluido su
// supervisor. GRUPO SUPERVISIÓN ya no se ofrece: no hace trabajos en terreno.
// El personal eventual de apoyo se escribe a mano en el formulario.
function personalPorGrupo(personal, grupo, flota) {
  return personal
    .filter((p) => {
      if (p.categoria !== grupo) return false;
      if (!flota) return true;
      const flotaPersona = claveGrupoPersona(p).split(":").slice(2).join(":");
      return flotaPersona === "*" || flotaPersona === flota;
    })
    .map((p) => p.nombre);
}

// Personal autorizado para ADICIONES Y CAMBIOS DE ACEITE: únicamente el
// grupo Lubrico. Ni Supervisión ni los grupos 1, 2, 3 y 4 están
// autorizados para esta operación.
function personalLubricacion(personal) {
  return personal.filter((p) => p.categoria === "lubrico").map((p) => p.nombre);
}

// Fecha operativa actual (fecha real del dispositivo). Los datos de ejemplo
// se fechan en relación a ella para que la vista previa siempre tenga
// registros del día.
const HOY = turnoOperativoActual().fecha;
const AYER = diasAtras(1);

function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Fecha real del dispositivo en formato AAAA-MM-DD (hora local, no UTC),
// usada como valor por defecto de "Fecha de ingreso" en nuevos trabajos.
// Fecha y turno operativos según la hora del dispositivo:
//   06:00–17:59 → turno Día, fecha de hoy.
//   18:00–23:59 → turno Noche, fecha de hoy (día en que se ingresó al turno).
//   00:00–05:59 → turno Noche, fecha de AYER (el turno empezó ayer a las 18:00).
function turnoOperativoActual() {
  const d = new Date();
  const h = d.getHours();
  let turno = "dia";
  if (h < 6) {
    d.setDate(d.getDate() - 1);
    turno = "noche";
  } else if (h >= 18) {
    turno = "noche";
  }
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return { fecha: `${d.getFullYear()}-${mm}-${dd}`, turno };
}

function fechaActualLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Orden cronológico real: turno Día = 1, turno Noche = 2.
// La clave de orden es fecha + turno + hora de fin, y es lo que determina
// el estado ACTUAL del equipo — nunca el orden en que se ingresó el dato.
const TURNO_RANGO = { dia: 1, noche: 2 };

// Orden cronológico real de un registro: fecha del turno, turno y hora de
// finalización. En el turno noche (18:00 a 06:00) las horas de madrugada
// pertenecen al día siguiente, por eso se les suma 24 h para ordenarlas
// después de las 18:00–23:59 del mismo turno.
// Orden de las filas en la pestaña Trabajos: por fecha, luego turno (Día
// antes que Noche) y dentro del turno por hora de inicio (y de fin). En el
// turno noche (18:00 a 06:00) las horas de madrugada van después de las
// 18:00–23:59, porque pertenecen al final del mismo turno.
// Orden natural de códigos de equipo (101, 210, 213, P-023…).
function compararCodigosEquipo(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function minutosEnTurno(hora, turno) {
  if (!hora) return 99999;
  let m = horaAMinutos(hora);
  if (turno === "noche" && m < 18 * 60) m += 24 * 60;
  return m;
}

// ¿La hora de fin queda antes que la de inicio dentro del turno? (Día
// 06:00–18:00; Noche 18:00–06:00, donde 00:59 va después de 19:00.)
function horasInvertidas(horaInicio, horaFin, turno) {
  if (!horaInicio || !horaFin) return false;
  return minutosEnTurno(horaFin, turno) < minutosEnTurno(horaInicio, turno);
}

function compararPorHorarioDeTurno(a, b) {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  const ta = TURNO_RANGO[a.turno];
  const tb = TURNO_RANGO[b.turno];
  if (ta !== tb) return ta - tb;
  const ia = minutosEnTurno(a.hora_inicio, a.turno);
  const ib = minutosEnTurno(b.hora_inicio, b.turno);
  if (ia !== ib) return ia - ib;
  return minutosEnTurno(a.hora_fin, a.turno) - minutosEnTurno(b.hora_fin, b.turno);
}

function claveOrden(reg) {
  const turnoNum = TURNO_RANGO[reg.turno];
  let minutos = horaAMinutos(reg.hora_fin || "00:00");
  if (reg.turno === "noche" && minutos < 18 * 60) minutos += 24 * 60;
  return `${reg.fecha}-${turnoNum}-${String(minutos).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Datos de ejemplo
// ---------------------------------------------------------------------------

// Sin trabajos precargados: se cargarán los reportes reales de turno
// (día y noche) enviados por el usuario para probar los filtros.
const TRABAJOS_INICIALES = [];

// Solo las adiciones de aceite motor registradas en los reportes de turno
// del 24 al 27/09/2026 (8 reportes, turnos Día y Noche).
const ACEITES_INICIALES = [];

const REQUERIMIENTOS_INICIALES = [];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const TIPOS_ACEITE_INICIALES = [
  { id: "ta1", nombre: "15W40", activo: true },
  { id: "ta2", nombre: "SAE 10", activo: true },
  { id: "ta3", nombre: "SAE 30", activo: true },
  { id: "ta4", nombre: "SAE 50W", activo: true },
  { id: "ta5", nombre: "UnivisN46", activo: true },
  { id: "ta6", nombre: "Refrigerante", activo: true },
];

const SISTEMAS_EQUIPO_INICIALES = [
  { id: "se1", nombre: "Motor", activo: true },
  { id: "se2", nombre: "Sistema hidráulico", activo: true },
  { id: "se3", nombre: "Diferencial trasero", activo: true },
  { id: "se4", nombre: "Diferencial delantero", activo: true },
  { id: "se5", nombre: "Transmisión", activo: true },
  { id: "se6", nombre: "Mandos finales", activo: true },
];

const ESTADO_REQ_LABEL = {
  pendiente_aprobacion: "Pendiente de aprobación",
  aprobado: "Aprobado",
  no_aprobado: "No aprobado",
  en_proceso_compra: "En proceso de compra",
  comprado: "Comprado",
  cancelado: "Cancelado",
};

// Secuencia del requerimiento: cada cambio de estado con fecha y usuario.
// Los requerimientos antiguos (sin secuencia guardada) arrancan con la
// solicitud.
function seguimientoDe(req) {
  if (Array.isArray(req.seguimiento) && req.seguimiento.length) return req.seguimiento;
  return [{ estado: "pendiente_aprobacion", fecha: req.creado_en || req.fecha_solicitud, usuario: req.solicitante, nombre: req.solicitante }];
}
const NIVEL_ESTADO_REQ = { pendiente_aprobacion: 0, aprobado: 1, no_aprobado: 1, en_proceso_compra: 2, comprado: 3 };
// Detalle de compra (antes "orden de compra") del paso "En proceso de compra".
const detalleCompraReq = (d) => (d && (d.detalle_compra || d.orden_compra)) || "";
// Último paso antes de la cancelación (para restablecer un cancelado).
function pasoPrevioCancelacion(req) {
  if (req.estado !== "cancelado") return null;
  return seguimientoDe(req).filter((p) => p.estado !== "cancelado").slice(-1)[0] || null;
}
// Los 4 pasos (Solicitado → Aprobado → En proceso de compra → Comprado),
// con la fecha y el usuario del último registro de cada uno.
function pasosRequerimiento(req) {
  const seg = seguimientoDe(req);
  const ultimo = (estado) => seg.filter((p) => p.estado === estado).slice(-1)[0] || null;
  const cancelado = req.estado === "cancelado";
  // Cancelado: quedan hechos los pasos del estado anterior a la cancelación
  // y el paso siguiente se muestra como "Cancelado" (en rojo).
  const previo = cancelado ? seg.filter((p) => p.estado !== "cancelado").slice(-1)[0] : null;
  const nivel = cancelado ? Math.max(1, NIVEL_ESTADO_REQ[(previo || {}).estado] ?? 1) : NIVEL_ESTADO_REQ[req.estado] ?? 0;
  const noAprobado = req.estado === "no_aprobado";
  const paso = (clave, titulo, n) => {
    if (cancelado && n === nivel + 1) return { clave: "cancelado", titulo: "Cancelado", hecho: true, dato: ultimo("cancelado"), rechazo: true };
    const hecho = nivel >= n && !(noAprobado && n > 1);
    return { clave, titulo, hecho, dato: hecho ? ultimo(clave) : null };
  };
  return [
    paso("pendiente_aprobacion", "Solicitado", 0),
    noAprobado ? { clave: "no_aprobado", titulo: "No aprobado", hecho: true, dato: ultimo("no_aprobado"), rechazo: true } : paso("aprobado", "Aprobado", 1),
    paso("en_proceso_compra", "En proceso de compra", 2),
    paso("comprado", "Comprado", 3),
  ];
}
// "2026-11-06T15:37" → "06/11/2026 15:37"; "2026-11-06" → "06/11/2026"
function fechaHoraReq(v) {
  if (!v) return "";
  const [f, h] = String(v).split("T");
  const fecha = f.split("-").reverse().join("/");
  return h ? `${fecha} ${h.slice(0, 5)}` : fecha;
}
// Fechas clave para impresiones y descargas.
function fechasRequerimiento(req) {
  const pasos = pasosRequerimiento(req);
  const d = (clave) => (pasos.find((p) => p.clave === clave) || {}).dato;
  const compra = d("en_proceso_compra");
  const recibido = d("comprado");
  return {
    solicitud: fechaHoraReq((d("pendiente_aprobacion") || {}).fecha) || fechaHoraReq(req.fecha_solicitud),
    aprobacion: fechaHoraReq((d("aprobado") || {}).fecha),
    aprobado_por: usuarioDoc((d("aprobado") || {}).usuario || ""),
    no_aprobado: fechaHoraReq((d("no_aprobado") || {}).fecha),
    inicio_compra: fechaHoraReq((compra || {}).fecha),
    detalle_compra: detalleCompraReq(compra),
    comprado: fechaHoraReq((recibido || {}).fecha),
    comprado_por: usuarioDoc((recibido || {}).usuario || ""),
    cancelado: fechaHoraReq((d("cancelado") || {}).fecha),
    motivo: (d("cancelado") || d("no_aprobado") || {}).motivo || "",
  };
}

function deriveEstadoEquipo(codigo, trabajos) {
  const registros = trabajos
    .filter((t) => t.equipo === codigo)
    .slice()
    .sort((a, b) => (claveOrden(a) > claveOrden(b) ? 1 : -1));
  if (registros.length === 0) return "disponible";
  return registros[registros.length - 1].estado_final;
}

// Devuelve el registro de trabajo más reciente de un equipo (el que define
// su estado actual), o null si el equipo no tiene registros.
function ultimoTrabajoDeEquipo(codigo, trabajos) {
  const registros = trabajos
    .filter((t) => t.equipo === codigo)
    .slice()
    .sort((a, b) => (claveOrden(a) > claveOrden(b) ? 1 : -1));
  return registros.length ? registros[registros.length - 1] : null;
}

function mesDe(fecha) {
  return fecha.slice(0, 7); // "2026-09"
}

// Obtiene un nombre y usuario representativos para el rol elegido en "Vista
// previa de rol", tomando datos reales del personal cargado en
// Configuración cuando existen (Supervisión, Técnico, Lubrico, Planificación).
// Para roles sin personal asociado (Administrador) usa el nombre del rol.
function usuarioParaRol(rolActual, personal) {
  const conEseRol = personal.find((p) => p.activo !== false && rolDePersona(p) === rolActual);
  if (conEseRol) return { nombre: conEseRol.nombre, usuario: conEseRol.usuario };
  const categoriaPorRol = { Supervisor: "supervision", Lubricador: "lubrico", Planificador: "planificacion" };
  if (categoriaPorRol[rolActual]) {
    const encontrado = personal.find((p) => p.categoria === categoriaPorRol[rolActual]);
    if (encontrado) return { nombre: encontrado.nombre, usuario: encontrado.usuario };
  }
  if (rolActual === "Técnico") {
    const encontrado = personal.find((p) => typeof p.categoria === "number");
    if (encontrado) return { nombre: encontrado.nombre, usuario: encontrado.usuario };
  }
  return { nombre: rolActual, usuario: rolActual.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "") };
}

// Iniciales para el logo por defecto cuando no se sube una imagen (ej.
// "TRUCK SHOP" -> "TS", "Mi Taller" -> "MT").
// Mezcla dos colores "#rrggbb": proporción "p" del primero sobre el segundo.
function mezclarColores(a, b, p) {
  const c = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16) || 0);
  const [x, y] = [c(a), c(b)];
  return "#" + x.map((v, i) => Math.round(v * p + y[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
}

function inicialesDe(nombre) {
  const palabras = (nombre || "").trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "TS";
  const iniciales = palabras.slice(0, 2).map((p) => p[0].toUpperCase());
  return iniciales.join("");
}

function horaAMinutos(hhmm) {
  const [h, m] = (hhmm || "0:0").split(":").map(Number);
  return h * 60 + m;
}

// Calcula el tiempo de trabajo entre hora de inicio y hora de finalización,
// como texto "Xh Ym". Soporta turnos que cruzan la medianoche (fin < inicio).
function calcularTiempoTrabajo(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return "—";
  let minutos = horaAMinutos(horaFin) - horaAMinutos(horaInicio);
  if (minutos < 0) minutos += 24 * 60; // cruza medianoche
  const horas = Math.floor(minutos / 60);
  const restoMin = minutos % 60;
  return `${horas}h ${restoMin}m`;
}

// ---------------------------------------------------------------------------
// Exportación (Excel / Word / PDF) — sin librerías externas
// ---------------------------------------------------------------------------
//
// Excel y Word se generan como HTML con el MIME type que cada programa
// reconoce al abrir el archivo descargado (truco estándar, sin dependencias).
// PDF se genera abriendo una ventana de impresión lista para "Guardar como PDF",
// ya que generar un PDF real requeriría una librería externa.

function filasATablaHTML(filas, columnas) {
  if (filas.length === 0) {
    return "<table><tr><td>Sin registros con los filtros actuales.</td></tr></table>";
  }
  const encabezado = columnas.map((c) => `<th>${c.titulo}</th>`).join("");
  const cuerpo = filas
    .map(
      (f) =>
        `<tr>${columnas.map((c) => `<td>${f[c.clave] ?? ""}</td>`).join("")}</tr>`
    )
    .join("");
  return `<table border="1" cellspacing="0" cellpadding="4">
    <thead><tr>${encabezado}</tr></thead>
    <tbody>${cuerpo}</tbody>
  </table>`;
}

function descargarArchivo(contenido, nombreArchivo, tipoMime) {
  const blob = new Blob([contenido], { type: tipoMime });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

function exportarExcel(filas, columnas, nombreArchivo) {
  const tabla = filasATablaHTML(filas, columnas);
  const contenido = `<html><head><meta charset="UTF-8"></head><body>${tabla}</body></html>`;
  descargarArchivo(contenido, `${nombreArchivo}.xls`, "application/vnd.ms-excel");
}

// Word (.docx) con el mismo diseño que el PDF. La librería se carga solo al
// descargar (src/lib/word.ts).
function datosFormatoDoc() {
  const cfg = registroReporte.config || {};
  const org = registroReporte.nombreApp || cfg.empresa || "";
  return {
    color: registroReporte.color || "#4a8fe0",
    logoUrl: registroReporte.logoUrl,
    org,
    area: cfg.area || "",
    iniciales: inicialesDe(org),
    factorLetra: Number(cfg.tamanoLetra) || 1,
    fuente: cfg.fuente || "",
    urlFuente: urlFuenteDoc,
  };
}
function avisarErrorWord(e) {
  console.error(e);
  window.alert("No se pudo generar el documento Word. Inténtalo de nuevo.");
}
function exportarWord(filas, columnas, nombreArchivo, titulo) {
  const PILL_CLASE = {
    Disponible: "ok", Aprobado: "ok", Comprado: "ok",
    "No disponible": "no", "No aprobado": "no", Cancelado: "no", Derrame: "no",
    "Pendiente de aprobación": "pend",
    "En proceso de compra": "info", Cambio: "info",
    Día: "dia", Noche: "noche",
  };
  const celda = (c, f) => {
    const crudo = f[c.clave];
    if (c.clave === "verificaciones") return crudo ? { marca: crudo === "✓" ? "ok" : "no" } : { texto: "" };
    if (crudo === undefined || crudo === null || String(crudo).trim() === "") return { tenue: true };
    const valor = String(fechaDoc(crudo));
    if (c.clave === "estado_final") return { marca: valor === "Disponible" ? "ok" : "no" };
    if (COLS_PILL_DOC.includes(c.clave)) return PILL_CLASE[valor] !== undefined ? { texto: valor, pill: PILL_CLASE[valor] } : { texto: valor, pill: "gris" };
    if (c.clave === "cantidad_litros") return { texto: `${valor} L` };
    return { texto: valor };
  };
  const ctx = {
    ...datosFormatoDoc(),
    titulo,
    nombreArchivo,
    detalle: [
      { t: String(filas.length), b: true },
      { t: ` ${filas.length === 1 ? "registro" : "registros"} · Emitido el ${fechaEmisionDoc()}` },
    ],
    // Igual que el PDF: las tablas con muchas columnas van en hoja horizontal.
    horizontal: filas.length > 0 && columnas.length > 9,
    columnas: columnas.map((c) => ({
      clave: c.clave,
      titulo: c.titulo,
      tipo: COLS_NUM_DOC.includes(c.clave) ? "num" : COLS_LARGAS_DOC.includes(c.clave) ? "larga" : "corta",
    })),
    filas: filas.map((f) => columnas.map((c) => celda(c, f))),
  };
  import("../lib/word").then((m) => m.wordLista(ctx)).catch(avisarErrorWord);
}

// Vista previa de impresión dentro de la app. No usa ventanas emergentes
// (window.open), que el navegador bloquea en muchos casos: muestra el
// documento en una capa sobre la pantalla con los botones "Imprimir / PDF"
// y "Cerrar". "Imprimir" abre el diálogo del sistema, desde donde también se
// puede guardar como PDF.
// Reparte el contenido de un documento de impresión en hojas carta reales
// (.ts-pagina). Cada ".hoja" del documento empieza en una página nueva; si
// el contenido no entra, pasa a la siguiente página, y las tablas largas se
// cortan por filas repitiendo su encabezado. Los títulos no quedan solos al
// final de una página y los bloques marcados como "no partir"
// (page-break-inside: avoid: filas, firmas, cajetín…) se mueven completos.
// Devuelve la lista de páginas creadas.
function paginarDocumento(doc) {
  const body = doc.body;
  const ventana = doc.defaultView;
  const hojas = Array.from(body.children).filter((n) => n.classList.contains("hoja"));
  const fuentes = hojas.length ? hojas : [body];
  // Pie de página (".pie-pagina"): no entra en el flujo; se coloca fijo al
  // final de CADA hoja que ocupa esa sección.
  const pies = fuentes.map((f) => Array.from(f.children).find((n) => n.classList.contains("pie-pagina")) || null);
  const grupos = fuentes.map((f, i) =>
    Array.from(f.childNodes).filter((n) => n !== pies[i] && (n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())))
  );

  const contenedor = doc.createElement("div");
  contenedor.className = "ts-paginas";
  body.innerHTML = "";
  body.appendChild(contenedor);

  let cuerpo = null;
  let pila = [];
  const cascarones = [];

  function nuevaPagina() {
    const pagina = doc.createElement("div");
    pagina.className = "ts-pagina";
    cuerpo = doc.createElement("div");
    cuerpo.className = "ts-pagina-cuerpo";
    pagina.appendChild(cuerpo);
    contenedor.appendChild(pagina);
  }
  const desborda = () => cuerpo.scrollHeight > cuerpo.clientHeight + 1;
  const padreActual = () => (pila.length ? pila[pila.length - 1] : cuerpo);
  const paginaVacia = () => !cuerpo.textContent.trim() && !cuerpo.querySelector("img, svg, table");
  const esTitulo = (el) =>
    el && el.nodeType === 1 && (/^H[1-6]$/.test(el.tagName) || el.classList.contains("flota-titulo"));
  const noPartir = (el) => {
    if (["TR", "IMG", "SVG"].includes(el.tagName)) return true;
    const cs = ventana.getComputedStyle(el);
    return cs.breakInside === "avoid" || cs.pageBreakInside === "avoid";
  };

  // Cierra la página actual y abre otra, recreando los contenedores abiertos.
  // Si lo último de la página era un título, se lleva a la nueva página.
  function saltarPagina() {
    const padre = padreActual();
    let arrastrar = null;
    if (esTitulo(padre.lastElementChild) && padre.childElementCount > 1) {
      arrastrar = padre.lastElementChild;
      arrastrar.remove();
    }
    nuevaPagina();
    const nuevaPila = [];
    let destino = cuerpo;
    pila.forEach((c) => {
      const copia = c.cloneNode(false);
      cascarones.push(copia);
      destino.appendChild(copia);
      nuevaPila.push(copia);
      destino = copia;
    });
    pila = nuevaPila;
    if (arrastrar) padreActual().appendChild(arrastrar);
  }

  function partirTabla(tabla) {
    const filas = Array.from(tabla.tBodies).flatMap((tb) => Array.from(tb.rows));
    let t;
    let tb;
    const abrir = () => {
      t = tabla.cloneNode(false);
      if (tabla.tHead) t.appendChild(tabla.tHead.cloneNode(true));
      tb = doc.createElement("tbody");
      t.appendChild(tb);
      padreActual().appendChild(t);
    };
    abrir();
    let enEsta = 0;
    filas.forEach((fila) => {
      const copia = fila.cloneNode(true);
      tb.appendChild(copia);
      if (desborda()) {
        copia.remove();
        if (enEsta === 0) t.remove();
        if (!paginaVacia()) saltarPagina();
        abrir();
        tb.appendChild(copia);
        enEsta = 0;
      }
      enEsta += 1;
    });
    if (tabla.tFoot) {
      const pie = tabla.tFoot.cloneNode(true);
      t.appendChild(pie);
      if (desborda()) {
        pie.remove();
        saltarPagina();
        abrir();
        t.appendChild(pie);
      }
    }
  }

  function colocar(nodo) {
    const padre = padreActual();
    const copia = nodo.cloneNode(true);
    padre.appendChild(copia);
    if (!desborda()) return;
    copia.remove();
    if (nodo.nodeType === 1 && nodo.tagName === "TABLE" && nodo.tBodies.length) {
      partirTabla(nodo);
      return;
    }
    if (nodo.nodeType === 1 && nodo.children.length > 0 && !noPartir(nodo)) {
      const cascaron = nodo.cloneNode(false);
      cascarones.push(cascaron);
      padre.appendChild(cascaron);
      pila.push(cascaron);
      Array.from(nodo.childNodes)
        .filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()))
        .forEach(colocar);
      pila.pop();
      return;
    }
    if (!paginaVacia()) saltarPagina();
    padreActual().appendChild(copia);
  }

  grupos.forEach((nodos, gi) => {
    pila = [];
    const inicio = contenedor.children.length;
    nuevaPagina();
    nodos.forEach(colocar);
    if (pies[gi]) {
      Array.from(contenedor.children)
        .slice(inicio)
        .forEach((pg) => {
          const pie = pies[gi].cloneNode(true);
          pie.classList.add("ts-pie-fijo");
          pg.classList.add("ts-con-pie");
          pg.appendChild(pie);
        });
    }
  });

  // Limpieza: contenedores que quedaron vacíos y páginas sin contenido.
  cascarones.forEach((c) => {
    if (c.isConnected && !c.textContent.trim() && !c.querySelector("img, svg, table")) c.remove();
  });
  Array.from(contenedor.children).forEach((p) => {
    const c = p.querySelector(".ts-pagina-cuerpo");
    if (c && !c.textContent.trim() && !c.querySelector("img, svg, table")) p.remove();
  });

  const paginas = Array.from(contenedor.children);
  paginas.forEach((p, i) => {
    const texto = `Página ${i + 1} de ${paginas.length}`;
    const enPie = p.querySelector(".pie-num");
    if (enPie) {
      enPie.textContent = texto;
      return;
    }
    const num = doc.createElement("div");
    num.className = "ts-pagina-num";
    num.textContent = texto;
    p.appendChild(num);
  });
  return paginas;
}

// Historial del navegador para la vista previa de impresión: al abrirla se
// agrega una entrada; la flecha "Atrás" (celular o navegador) la cierra sin
// salir de la pantalla actual.
// Letra de los documentos (PDF y Word): Inter, incluida en la app
// (carpeta public/fuentes), así el PDF y el Word se ven con la misma letra en
// cualquier equipo. Cada peso es un archivo.
function urlFuenteDoc(archivo) {
  const propias = typeof window !== "undefined" && window.__TS_FUENTES__;
  if (propias && propias[archivo]) return propias[archivo];
  return `${window.location.origin}/fuentes/${archivo}`;
}
function fontFaceDoc() {
  return [
    ["ts-inter-400.ttf", 400, "normal"],
    ["ts-inter-400i.ttf", 400, "italic"],
    ["ts-inter-600.ttf", 600, "normal"],
    ["ts-inter-700.ttf", 700, "normal"],
    ["ts-inter-800.ttf", 800, "normal"],
  ]
    .map(([a, w, st]) => `@font-face { font-family: "TS Doc"; src: url("${urlFuenteDoc(a)}") format("truetype"); font-weight: ${w}; font-style: ${st}; font-display: block; }`)
    .join("\n");
}
const LETRA_DOC = `"TS Doc", "Segoe UI", Inter, Roboto, Arial, sans-serif`;
const estadoVistaImpresion = { abierta: false, ignorarPop: false, cerrar: null };
function abrirVistaImpresion(html, opciones = {}) {
  // Hoja horizontal (apaisada) para tablas con muchas columnas.
  const horizontal = !!opciones.horizontal;
  const anchoHoja = horizontal ? "11in" : "8.5in";
  const altoHoja = horizontal ? "8.5in" : "11in";
  const anchoPx = horizontal ? 1056 : 816;
  // Margen "estrecho" (1.27 cm, como en Word) solo para el reporte de turno.
  const estrecho = opciones.margen === "estrecho";
  const margenX = estrecho ? "1.27cm" : horizontal ? "1.5cm" : "1.8cm";
  const margenSup = estrecho ? "1.27cm" : horizontal ? "1.6cm" : "2.2cm";
  const margenInf = estrecho ? "1.55cm" : margenSup;
  // Tipo de letra y tamaño elegidos en Configuración → Reportes: se aplican a
  // todos los documentos impresos. Los tamaños de letra del documento se
  // multiplican por el factor elegido.
  const cfgRep = registroReporte.config || {};
  const factorLetra = Number(cfgRep.tamanoLetra) || 1;
  const fuenteDoc = cfgRep.fuente || "";
  html = html.replace(/font-size:\s*([\d.]+)px/g, (m, n) => `font-size: calc(${n}px * var(--ts-k, 1))`);
  // Si ya hay una vista abierta (p. ej. al pasar a hoja horizontal), se
  // reemplaza y se reutiliza su entrada del historial.
  const yaAbierta = estadoVistaImpresion.abierta && estadoVistaImpresion.cerrar;
  if (yaAbierta) estadoVistaImpresion.cerrar({ reemplazo: true });
  const previa = document.getElementById("ts-vista-impresion");
  if (previa) previa.remove();

  const capa = document.createElement("div");
  capa.id = "ts-vista-impresion";
  capa.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(10,14,18,.6);display:flex;flex-direction:column;align-items:center;padding:16px;box-sizing:border-box;";

  const barra = document.createElement("div");
  barra.style.cssText =
    "width:100%;max-width:" + (horizontal ? 1100 : 860) + "px;display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px;font-family:Arial,sans-serif;";
  const boton = (texto, principal) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = texto;
    b.style.cssText =
      "padding:9px 16px;border-radius:8px;border:none;font-weight:700;font-size:14px;cursor:pointer;" +
      (principal ? "background:#4a8fe0;color:#fff;" : "background:#fff;color:#1b1f24;");
    return b;
  };
  const btnImprimir = boton("Imprimir / PDF", true);
  const btnCerrar = boton("Cerrar", false);
  barra.appendChild(btnImprimir);
  barra.appendChild(btnCerrar);

  const marco = document.createElement("iframe");
  marco.title = "Vista de impresión";
  marco.style.cssText = "width:100%;max-width:" + (horizontal ? 1140 : 900) + "px;flex:1;border:none;border-radius:8px;background:#d9dce0;";
  // Hoja carta (8.5 x 11 in) con márgenes de 2.54 cm arriba/abajo y 1.91 cm
  // a los lados. El contenido se reparte en hojas reales (ver
  // paginarDocumento), así la vista previa muestra exactamente las mismas
  // páginas que salen al imprimir o guardar como PDF.
  const estiloHoja = `<style>
    @page { size: letter ${horizontal ? "landscape" : "portrait"}; margin: 0; }
    :root { --ts-k: ${factorLetra}; }
    ${fontFaceDoc()}
    body, table, th, td, div, span, b, strong, h1, h2, h3, h4, p, em { font-family: ${fuenteDoc || LETRA_DOC} !important; }
    .ts-pie-fijo { position: absolute; left: ${margenX}; right: ${margenX}; bottom: ${estrecho ? "0.5cm" : "0.85cm"}; margin: 0 !important; }
    html, body { margin: 0 !important; padding: 0 !important; }
    html { background: #d9dce0; }
    .ts-paginas { display: flex; flex-direction: column; align-items: center; gap: 22px; padding: 22px 0 30px; }
    @media screen {
      html { overflow-x: hidden; }
      .ts-paginas { transform-origin: top center; transform: scale(var(--ts-escala, 1)); }
    }
    .ts-pagina {
      position: relative; flex-shrink: 0;
      width: ${anchoHoja}; height: ${altoHoja}; box-sizing: border-box;
      padding: ${margenSup} ${margenX} ${margenInf}; background: #fff; overflow: hidden;
      box-shadow: 0 2px 14px rgba(0,0,0,.25);
    }
    .ts-pagina-cuerpo { height: 100%; overflow: hidden; }
    .ts-pagina-num {
      position: absolute; left: 0; right: 0; bottom: 1.1cm;
      text-align: center; font: 9px Arial, sans-serif; color: #777;
    }
    @media print {
      html, body { background: #fff !important; }
      .ts-paginas { display: block; padding: 0; gap: 0; transform: none !important; }
      body { height: auto !important; }
      .ts-pagina { box-shadow: none; height: calc(${altoHoja} - 1px); break-after: page; page-break-after: always; }
      .ts-pagina:last-child { break-after: auto; page-break-after: auto; }
    }
  </style>`;
  marco.srcdoc = html.includes("</head>") ? html.replace("</head>", estiloHoja + "</head>") : estiloHoja + html;

  // Navegación por página: ‹ Página X de N ›
  const nav = document.createElement("div");
  nav.style.cssText =
    "margin-right:auto;display:flex;align-items:center;gap:6px;color:#fff;font-size:14px;font-weight:600;" +
    "background:rgba(20,24,28,.85);padding:4px;border-radius:10px;";
  const btnAnterior = boton("‹", false);
  const btnSiguiente = boton("›", false);
  [btnAnterior, btnSiguiente].forEach((b) => (b.style.padding = "7px 13px"));
  btnAnterior.title = "Página anterior";
  btnSiguiente.title = "Página siguiente";
  const contador = document.createElement("span");
  contador.style.cssText = "min-width:120px;text-align:center;";
  contador.textContent = "Preparando páginas…";
  nav.appendChild(btnAnterior);
  nav.appendChild(contador);
  nav.appendChild(btnSiguiente);
  barra.insertBefore(nav, barra.firstChild);

  let paginas = [];
  let actual = 0;
  function mostrarContador() {
    contador.textContent = paginas.length ? `Página ${actual + 1} de ${paginas.length}` : "";
    btnAnterior.disabled = actual <= 0;
    btnSiguiente.disabled = actual >= paginas.length - 1;
    btnAnterior.style.opacity = btnAnterior.disabled ? "0.45" : "1";
    btnSiguiente.style.opacity = btnSiguiente.disabled ? "0.45" : "1";
  }
  function irA(i) {
    if (!paginas[i]) return;
    actual = i;
    paginas[i].scrollIntoView({ block: "start", behavior: "smooth" });
    mostrarContador();
  }
  btnAnterior.onclick = () => irA(actual - 1);
  btnSiguiente.onclick = () => irA(actual + 1);
  marco.onload = () => {
    const doc = marco.contentDocument;
    const ventana = marco.contentWindow;
    if (!doc) return;
    if (horizontal) doc.documentElement.classList.add("ts-horizontal");
    // Se mide y pagina cuando la letra ya cargó (si no, las medidas cambian).
    setTimeout(() => {
      const listo = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
      const espera = new Promise((ok) => setTimeout(ok, 2500));
      Promise.race([listo, espera]).then(medirYPaginar);
    }, 30);
    function medirYPaginar() {
      // Si una tabla no entra a lo ancho de la hoja vertical, se vuelve a
      // abrir la vista en hoja horizontal.
      if (opciones.autoHorizontal && !horizontal) {
        const util = anchoPx - 2 * 68; // ancho útil aprox. (márgenes 1.8 cm)
        const anchoPrevio = doc.body.style.width;
        doc.body.style.width = util + "px";
        const ancha = Array.from(doc.querySelectorAll("table")).some((t) => t.scrollWidth > util + 2);
        doc.body.style.width = anchoPrevio;
        if (ancha) {
          abrirVistaImpresion(html, { ...opciones, horizontal: true });
          return;
        }
      }
      paginas = paginarDocumento(doc);
      // Celular: la hoja se muestra reducida (escala visual, sin volver a
      // acomodar el texto) para que entre completa a lo ancho de la pantalla.
      const escala = Math.min(1, (ventana.innerWidth - 16) / anchoPx);
      if (escala < 1) {
        const contenedor = doc.querySelector(".ts-paginas");
        doc.documentElement.style.setProperty("--ts-escala", String(escala));
        doc.body.style.height = Math.ceil(contenedor.offsetHeight * escala) + "px";
      }
      ventana.addEventListener("scroll", () => {
        const y = ventana.scrollY + ventana.innerHeight * 0.35;
        let i = 0;
        paginas.forEach((p, n) => {
          if (p.getBoundingClientRect().top + ventana.scrollY <= y) i = n;
        });
        if (i !== actual) {
          actual = i;
          mostrarContador();
        }
      });
      mostrarContador();
    }
  };

  capa.appendChild(barra);
  capa.appendChild(marco);
  document.body.appendChild(capa);

  function alVolverAtras() {
    cerrar({ desdeAtras: true });
  }
  function cerrar(op = {}) {
    capa.remove();
    document.removeEventListener("keydown", alTeclear);
    window.removeEventListener("popstate", alVolverAtras);
    estadoVistaImpresion.abierta = false;
    estadoVistaImpresion.cerrar = null;
    // Cerrada con botón o Escape: se quita la entrada que se agregó al abrir.
    if (!op.desdeAtras && !op.reemplazo) {
      estadoVistaImpresion.ignorarPop = true;
      try {
        window.history.back();
      } catch (e) {
        estadoVistaImpresion.ignorarPop = false;
      }
    }
  }
  if (!yaAbierta) {
    try {
      window.history.pushState({ tsImpresion: true }, "");
    } catch (e) {}
  }
  window.addEventListener("popstate", alVolverAtras);
  estadoVistaImpresion.abierta = true;
  estadoVistaImpresion.cerrar = cerrar;
  function alTeclear(e) {
    if (e.key === "Escape") cerrar();
  }
  document.addEventListener("keydown", alTeclear);
  btnCerrar.onclick = () => cerrar();
  btnImprimir.onclick = () => {
    try {
      marco.contentWindow.focus();
      marco.contentWindow.print();
    } catch (err) {
      window.print();
    }
  };
}

// ---------------------------------------------------------------------------
// Formato común de los documentos impresos (listas y fichas): encabezado con
// logo/iniciales, organización, título del documento y fecha de emisión, y
// una línea de color con el acento de la app. Estilo limpio y moderno.
// ---------------------------------------------------------------------------
function fechaEmisionDoc() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fechaDoc(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split("-").reverse().join("/") : v;
}
function cabeceraDocumento(titulo, detalle) {
  const cfg = registroReporte.config;
  const org = registroReporte.nombreApp || cfg.empresa || "";
  const logo = registroReporte.logoUrl
    ? `<img class="doc-logo-img" src="${registroReporte.logoUrl}" alt="logo">`
    : `<div class="doc-logo-ini">${escaparHTML(inicialesDe(org))}</div>`;
  return `<header class="doc-cab">
      <div class="doc-marca">
        ${logo}
        <div>
          <div class="doc-org">${escaparHTML(org)}</div>
          <div class="doc-area">${escaparHTML(cfg.area || "")}</div>
        </div>
      </div>
      <div class="doc-meta">
        <div class="doc-titulo">${escaparHTML(titulo)}</div>
        <div class="doc-detalle">${detalle}</div>
      </div>
    </header>`;
}
function estilosDocumento(color) {
  return `
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
      body { font-family: ${LETRA_DOC}; color: #1b1f24; font-size: 10px; margin: 0; }
      .doc-cab { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 10px; border-bottom: 2.5px solid ${color}; margin-bottom: 14px; }
      .doc-marca { display: flex; align-items: center; gap: 10px; }
      .doc-logo-img { max-width: 52px; max-height: 44px; object-fit: contain; }
      .doc-logo-ini { width: 40px; height: 40px; background: ${color}; color: #fff; font-weight: 800; font-size: 15px; display: flex; align-items: center; justify-content: center; letter-spacing: .02em; }
      .doc-org { font-size: 12px; font-weight: 400; letter-spacing: .04em; }
      .doc-area { font-size: 9.5px; color: #6b7280; margin-top: 1px; }
      .doc-meta { text-align: right; }
      .doc-titulo { font-size: 15px; font-weight: 400; color: #111827; letter-spacing: -.01em; }
      .doc-detalle { font-size: 9px; color: #6b7280; margin-top: 3px; }
      .doc-detalle b { color: #374151; font-weight: 600; }
      .pill { display: inline-block; padding: 1.5px 7px; font-weight: 600; font-size: 8.5px; white-space: nowrap; background: #eef0f3; color: #4b5563; }
      .pill.ok { background: #e3f4ea; color: #1f7a45; }
      .pill.no { background: #fde8e7; color: #b42318; }
      .pill.pend { background: #fff3c4; color: #8a6100; }
      .pill.info { background: #e1ebfc; color: #2f5fb3; }
      .pill.dia { background: #fff4dc; color: #9a6400; }
      .pill.noche { background: #e6e9f5; color: #3b4a7a; }
      .tenue { color: #a0a6ad; }
  `;
}
// Clase de "pastilla" de color según el valor (estados, turno, operación).
function pillDoc(valor) {
  const v = String(valor || "");
  const mapa = {
    Disponible: "ok", Aprobado: "ok", Comprado: "ok",
    "No disponible": "no", "No aprobado": "no", Cancelado: "no", Derrame: "no",
    "Pendiente de aprobación": "pend",
    "En proceso de compra": "info", Cambio: "info",
    Día: "dia", Noche: "noche",
  };
  return mapa[v] !== undefined ? `<span class="pill ${mapa[v]}">${escaparHTML(v)}</span>` : null;
}

// Columnas cortas (no se parten en dos líneas) y columnas de texto largo.
const COLS_CORTAS_DOC = ["puesto", "registros", "litros", "ultima", "fallas", "intervencion", "detenido", "confiabilidad", "disponibilidad", "mtbf", "mttr", "ot", "id", "equipo", "flota", "fecha", "fecha_solicitud", "turno", "hora_inicio", "hora_fin", "cantidad_litros", "horometro", "cantidad", "numero_parte", "grupo", "tipo_operacion", "estado", "estado_final"];
const COLS_LARGAS_DOC = ["descripcion", "sintoma_causa", "observaciones", "personal"];
const COLS_PILL_DOC = ["turno", "estado", "estado_final", "tipo_operacion"];
const COLS_NUM_DOC = ["cantidad_litros", "horometro", "cantidad", "puesto", "registros", "litros", "fallas", "intervencion", "detenido", "confiabilidad", "disponibilidad", "mtbf", "mttr"];

// Lista de registros en PDF. Si la tabla tiene muchas columnas (p. ej.
// Aceites o Historial), la hoja se imprime en horizontal para que entre.
function exportarPDF(filas, columnas, titulo, opciones = {}) {
  const color = registroReporte.color || "#4a8fe0";
  // Primero se intenta en vertical; si la tabla no alcanza, pasa a horizontal.
  const celda = (c, f) => {
    const crudo = f[c.clave];
    if (c.clave === "verificaciones") {
      if (!crudo) return "";
      const ok = crudo === "✓";
      return `<span class="marca ${ok ? "ok" : "no"}" title="${ok ? "Verificaciones completas" : "Faltan verificaciones"}">${ok ? "✓" : "✗"}</span>`;
    }
    if (crudo === undefined || crudo === null || String(crudo).trim() === "") return `<span class="tenue">—</span>`;
    const valor = fechaDoc(crudo);
    if (c.clave === "estado_final") {
      const ok = String(valor) === "Disponible";
      return `<span class="marca ${ok ? "ok" : "no"}" title="${escaparHTML(valor)}">${ok ? "✓" : "✗"}</span>`;
    }
    if (COLS_PILL_DOC.includes(c.clave)) {
      const pill = pillDoc(valor);
      if (pill) return pill;
    }
    if (c.clave === "cantidad_litros") return `${escaparHTML(valor)} L`;
    return escaparHTML(valor).replace(/\n/g, "<br>");
  };
  const clase = (c) =>
    ["c-" + c.clave, COLS_CORTAS_DOC.includes(c.clave) && "nw", COLS_LARGAS_DOC.includes(c.clave) && "largo", COLS_NUM_DOC.includes(c.clave) && "num", c.clave === "equipo" && "eq"]
      .filter(Boolean)
      .join(" ");
  const tabla = filas.length
    ? `<table class="doc-tabla">
        <thead><tr>${columnas.map((c) => `<th class="${clase(c)}">${escaparHTML(c.titulo)}</th>`).join("")}</tr></thead>
        <tbody>${filas
          .map((f) => `<tr>${columnas.map((c) => `<td class="${clase(c)}">${celda(c, f)}</td>`).join("")}</tr>`)
          .join("")}</tbody>
      </table>`
    : `<div class="doc-vacio">Sin registros con los filtros actuales.</div>`;
  const detalle = `<b>${filas.length}</b> ${filas.length === 1 ? "registro" : "registros"} · Emitido el ${fechaEmisionDoc()}`;
  abrirVistaImpresion(
    `<html><head><title>${escaparHTML(titulo)}</title>
    <style>
      ${estilosDocumento(color)}
      .doc-tabla { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 9.4px; }
      .ts-horizontal .doc-tabla { font-size: 8.4px; }
      .ts-horizontal .doc-tabla th { font-size: 7.6px !important; }
      .doc-tabla th { background: ${color}14; color: #374151; font-weight: 700; font-size: 8.4px; text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 6px 6px; border-bottom: 1.5px solid ${color}; vertical-align: bottom; }
      .doc-tabla td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; line-height: 1.35; }
      .doc-tabla tbody tr:nth-child(even) td { background: #f9fafb; }
      .doc-tabla tr { page-break-inside: avoid; break-inside: avoid; }
      .doc-tabla td.nw { white-space: nowrap; }
      .doc-tabla .largo { min-width: 120px; overflow-wrap: anywhere; }
      .ts-horizontal .doc-tabla .largo { min-width: 78px; }
      .doc-tabla .c-descripcion { min-width: 190px; }
      .ts-horizontal .doc-tabla .c-descripcion { min-width: 200px; }
      .doc-tabla .c-personal { min-width: 0 !important; width: 70px; max-width: 80px; }
      .doc-tabla .c-estado_final, .doc-tabla .c-verificaciones { text-align: center; width: 34px; }
      .marca { display: inline-block; width: 15px; height: 15px; line-height: 15px; text-align: center; font-size: 10px; font-weight: 700; }
      .marca.ok { background: #e3f4ea; color: #1f7a45; }
      .marca.no { background: #fde8e7; color: #b42318; }
      .ts-horizontal .doc-tabla th, .ts-horizontal .doc-tabla td { padding-left: 4px; padding-right: 4px; }
      .doc-tabla .num { text-align: right; font-variant-numeric: tabular-nums; }
      .doc-tabla td.eq { font-weight: 400; color: #111827; }
      .doc-vacio { color: #6b7280; font-style: italic; padding: 18px 0; text-align: center; border: 1px dashed #d1d5db; }
    </style>
  </head><body>${cabeceraDocumento(titulo, detalle)}${tabla}</body></html>`,
    { autoHorizontal: true }
  );
}

// Impresión de los rankings de Inicio separada por flota, con el detalle de
// cada equipo: cabecera del equipo (puesto, equipo y total), sus registros
// del periodo y su pie (totales o indicadores).
// flotas: [{ flota, equipos: [{ puesto, equipo, resumen, columnas, filas, pie: [[etiqueta, valor] | [texto]] }] }]
function imprimirRankingDetallado({ titulo, flotas }) {
  const color = registroReporte.color || "#4a8fe0";
  const total = flotas.reduce((s, f) => s + f.equipos.length, 0);
  const cuerpo = flotas
    .map(({ flota, equipos }) => {
      const bloques = equipos.length
        ? equipos
            .map(
              (e) => `<div class="eq-bloque">
              <div class="eq-cab"><span class="eq-puesto">${e.puesto}</span><b>Equipo ${escaparHTML(e.equipo)}</b><span class="eq-res">${escaparHTML(e.resumen)}</span></div>
              <table class="doc-tabla">
                <thead><tr>${e.columnas.map((c) => `<th>${escaparHTML(c)}</th>`).join("")}</tr></thead>
                <tbody>${e.filas.map((f) => `<tr>${f.map((v) => `<td>${escaparHTML(v)}</td>`).join("")}</tr>`).join("")}</tbody>
              </table>
              ${
                e.pie && e.pie.length
                  ? `<div class="eq-pie">${e.pie
                      .map((p) => (p.length === 2 ? `<span><em>${escaparHTML(p[0])}</em> ${escaparHTML(p[1])}</span>` : `<span>${escaparHTML(p[0])}</span>`))
                      .join("")}</div>`
                  : ""
              }
            </div>`
            )
            .join("")
        : `<div class="doc-vacio">Sin registros en el periodo.</div>`;
      return `<div class="flota-titulo">Flota ${escaparHTML(flota)} <span>${equipos.length} ${equipos.length === 1 ? "equipo" : "equipos"}</span></div>${bloques}`;
    })
    .join("");
  abrirVistaImpresion(
    `<html><head><title>${escaparHTML(titulo)}</title>
    <style>
      ${estilosDocumento(color)}
      .flota-titulo { background: ${color}14; color: #111827; font-weight: 700; padding: 6px 10px; letter-spacing: .06em; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; font-size: 11px; border-bottom: 1.5px solid ${color}; margin: 14px 0 8px; page-break-after: avoid; break-after: avoid; }
      .flota-titulo:first-of-type { margin-top: 0; }
      .flota-titulo span { font-weight: 600; font-size: 9.5px; text-transform: none; letter-spacing: 0; background: ${color}; color: #fff; padding: 1px 8px; }
      .eq-bloque { margin: 0 0 12px; page-break-inside: avoid; break-inside: avoid; }
      .eq-cab { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #111827; margin-bottom: 4px; }
      .eq-puesto { display: inline-block; min-width: 18px; text-align: center; background: ${color}1f; color: ${color}; font-size: 9.5px; padding: 1px 5px; }
      .eq-res { margin-left: auto; color: #4b5563; font-size: 9.5px; }
      .doc-tabla { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 9.4px; border: 1px solid #e5e7eb; }
      .doc-tabla th { background: #f3f4f6; color: #374151; font-weight: 700; font-size: 8px; text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 4px 6px; border-bottom: 1px solid #d1d5db; }
      .doc-tabla td { padding: 4px 6px; border-bottom: 1px solid #eef0f2; vertical-align: top; line-height: 1.3; }
      .doc-tabla tbody tr:last-child td { border-bottom: none; }
      .doc-tabla tbody tr:nth-child(even) td { background: #f9fafb; }
      .eq-pie { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 5px 6px; font-size: 9.4px; color: #111827; font-weight: 600; border: 1px solid #e5e7eb; border-top: none; background: ${color}0d; }
      .eq-pie em { font-style: normal; font-weight: 400; color: #6b7280; }
      .doc-vacio { color: #6b7280; font-style: italic; padding: 10px 0; text-align: center; border: 1px dashed #d1d5db; }
    </style>
  </head><body>${cabeceraDocumento(titulo, `<b>${total}</b> ${total === 1 ? "equipo" : "equipos"} · Emitido el ${fechaEmisionDoc()}`)}${cuerpo}</body></html>`
  );
}

// Ficha de un solo registro (trabajo, aceite o requerimiento): datos
// principales destacados arriba, campos en una cuadrícula y los textos
// largos en bloques con borde de color.
function imprimirFicha({ titulo, destacado, chips = [], campos = [], bloques = [] }) {
  const color = registroReporte.color || "#4a8fe0";
  const vacio = (v) => v === undefined || v === null || String(v).trim() === "";
  const valor = (v) => (vacio(v) ? `<span class="tenue">—</span>` : pillDoc(v) || escaparHTML(v));
  const html = `<html><head><title>${escaparHTML(titulo)} — ${escaparHTML(destacado)}</title>
    <style>
      ${estilosDocumento(color)}
      body { font-size: 11px; }
      .resumen { display: flex; align-items: center; gap: 14px; padding: 12px 14px; background: ${color}12; border: 1px solid ${color}33; margin-bottom: 14px; }
      .destacado { font-size: 11.5px; font-weight: 600; color: #111827; line-height: 1.25; padding-right: 14px; border-right: 1px solid ${color}40; }
      .destacado small { display: block; font-size: 8.5px; font-weight: 400; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 0; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px 16px; }
      .chip > span { display: block; font-size: 8.5px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
      .chip b { font-size: 11.5px; font-weight: 600; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #e5e7eb; overflow: hidden; margin-bottom: 14px; }
      .campo { padding: 8px 11px; border-bottom: 1px solid #eef0f2; border-right: 1px solid #eef0f2; }
      .campo:nth-child(3n) { border-right: none; }
      .etiqueta { font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; margin-bottom: 3px; }
      .valor { font-size: 11.5px; font-weight: 600; color: #111827; }
      .bloque { border-left: 3px solid ${color}; background: #f9fafb; padding: 9px 12px; margin-bottom: 10px; page-break-inside: avoid; }
      .bloque .valor { font-weight: 400; white-space: pre-wrap; line-height: 1.55; }
    </style>
  </head><body>
    ${cabeceraDocumento(titulo, `Emitido el ${fechaEmisionDoc()}`)}
    <div class="resumen">
      <div class="destacado"><small>${escaparHTML(destacado.split(" ")[0])}</small>${escaparHTML(destacado.split(" ").slice(1).join(" "))}</div>
      <div class="chips">${chips.map(([e, v]) => `<div class="chip"><span>${escaparHTML(e)}</span><b>${valor(v)}</b></div>`).join("")}</div>
    </div>
    <div class="grid">${campos.map(([e, v]) => `<div class="campo"><div class="etiqueta">${escaparHTML(e)}</div><div class="valor">${valor(v)}</div></div>`).join("")}</div>
    ${bloques.map(([e, v]) => `<div class="bloque"><div class="etiqueta">${escaparHTML(e)}</div><div class="valor">${vacio(v) ? '<span class="tenue">—</span>' : escaparHTML(v)}</div></div>`).join("")}
  </body></html>`;
  abrirVistaImpresion(html);
}

// Reporte de turno en PDF (formato de los reportes del taller): una hoja por
// fecha + turno, con encabezado "Turno · Grupo · Fecha · Impreso por" y los
// trabajos separados por FLOTA y, dentro de cada flota, en "Equipos
// Programados" y "Equipos No Programados", ordenados por horario.
function escaparHTML(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Configuración editable del encabezado/presentación de los reportes
// (Configuración → Reportes).
const CONFIG_REPORTE_INICIAL = {
  empresa: "TRUCK SHOP",
  area: "Taller de Mantenimiento",
  titulo: "REPORTE DE TURNO",
  subtitulo: "Mantenimiento de equipos de acarreo y carguío",
  codigo: "TS-REP-001",
  revision: "01",
  // Tipo de letra ("" = la del documento) y tamaño (factor) de los
  // documentos impresos.
  fuente: "",
  tamanoLetra: "1",
  pie: "Documento generado por el sistema TRUCK SHOP",
  // Cajetín (encabezado del reporte de turno): textos de los datos del
  // documento y tamaños (px).
  etiquetaCodigo: "Código",
  etiquetaRevision: "Revisión",
  etiquetaEmitido: "Emitido",
  cajAnchoLogo: 170,
  cajAnchoDatos: 170,
  cajAltoLogo: 54,
  cajAlto: 0,
  cajLetraEmpresa: 12,
  cajLetraArea: 10,
  cajLetraTitulo: 14,
  cajLetraSubtitulo: 9.5,
  cajLetraDatos: 9.5,
};
// Número de la configuración del cajetín (si falta o no es válido, el valor
// inicial).
function numCaj(cfg, clave) {
  const n = Number(cfg && cfg[clave]);
  return Number.isFinite(n) && n >= 0 ? n : CONFIG_REPORTE_INICIAL[clave];
}
// Medidas del cajetín para los documentos (PDF y Word) y la vista previa.
function medidasCajetin(cfg) {
  return {
    anchoLogo: numCaj(cfg, "cajAnchoLogo"),
    anchoDatos: numCaj(cfg, "cajAnchoDatos"),
    altoLogo: numCaj(cfg, "cajAltoLogo"),
    alto: numCaj(cfg, "cajAlto"),
    empresa: numCaj(cfg, "cajLetraEmpresa"),
    area: numCaj(cfg, "cajLetraArea"),
    titulo: numCaj(cfg, "cajLetraTitulo"),
    subtitulo: numCaj(cfg, "cajLetraSubtitulo"),
    datos: numCaj(cfg, "cajLetraDatos"),
    etCodigo: cfg.etiquetaCodigo ?? CONFIG_REPORTE_INICIAL.etiquetaCodigo,
    etRevision: cfg.etiquetaRevision ?? CONFIG_REPORTE_INICIAL.etiquetaRevision,
    etEmitido: cfg.etiquetaEmitido ?? CONFIG_REPORTE_INICIAL.etiquetaEmitido,
  };
}
const registroReporte = { config: CONFIG_REPORTE_INICIAL, logoUrl: null, nombreApp: "TRUCK SHOP", color: "#4a8fe0" };

function imprimirReporteTurno(trabajos, impresoPor) {
  const cfg = registroReporte.config;
  const color = registroReporte.color || "#4a8fe0";
  const emitido = fechaEmisionDoc();
  const mc = medidasCajetin(cfg);

  const bloques = {};
  trabajos.forEach((t) => {
    const clave = `${t.fecha}|${t.turno}`;
    (bloques[clave] = bloques[clave] || []).push(t);
  });
  const claves = Object.keys(bloques).sort((a, b) => {
    const [fa, ta] = a.split("|");
    const [fb, tb] = b.split("|");
    return fa !== fb ? (fa < fb ? -1 : 1) : TURNO_RANGO[ta] - TURNO_RANGO[tb];
  });

  // El logo es obligatorio en el reporte (si no hay imagen, las iniciales).
  const logo = registroReporte.logoUrl
    ? `<img class="logo-img" src="${registroReporte.logoUrl}" alt="logo">`
    : `<div class="logo-ini">${escaparHTML(inicialesDe(registroReporte.nombreApp || cfg.empresa))}</div>`;

  const tablaTrabajos = (lista) => {
    if (lista.length === 0) return `<div class="vacio">Sin registros en este turno.</div>`;
    const filas = lista
      .slice()
      .sort(compararPorHorarioDeTurno)
      .map((t) => {
        const lineas = (t.descripcion || "").split("\n").filter((l) => l.trim());
        const esSubtitulo = (l) => !/^\s*-/.test(l) && l.trim() === l.trim().toUpperCase();
        const tieneSubtitulos = lineas.some(esSubtitulo);
        const desc = [
          !tieneSubtitulos && t.sintoma_causa ? `<div class="tit">${escaparHTML(t.sintoma_causa)}</div>` : "",
          ...lineas.map((l) => (esSubtitulo(l) ? `<div class="tit">${escaparHTML(l)}</div>` : `<div>${escaparHTML(l)}</div>`)),
          t.observaciones ? `<div class="nota">Síntoma y causa: ${escaparHTML(t.observaciones)}</div>` : "",
        ].join("");
        const personal = (t.participantes || []).length
          ? usuariosDoc(t.participantes).map(escaparHTML).join("<br>")
          : `<span class="tenue">Sin intervención</span>`;
        const ok = t.estado_final === "disponible";
        return `<tr>
          <td class="eq">${escaparHTML(t.equipo)}</td>
          <td class="desc">${desc}</td>
          <td class="pers">${personal}</td>
          <td>${escaparHTML(t.ubicacion || "")}</td>
          <td class="hora">${t.hora_inicio || t.hora_fin ? `${escaparHTML(t.hora_inicio || "--:--")} – ${escaparHTML(t.hora_fin || "--:--")}` : ""}</td>
          <td><span class="estado ${ok ? "ok" : "no"}">${ok ? "Operativo" : "No Operativo"}</span></td>
        </tr>`;
      })
      .join("");
    return `<table class="tabla">
      <thead><tr><th>Equipo</th><th>Descripción</th><th>Personal</th><th>Ubicación</th><th>Horario</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>`;
  };

  const hojas = claves
    .map((clave) => {
      const lista = bloques[clave];
      const [fecha, turno] = clave.split("|");
      const conteoGrupos = {};
      lista.forEach((t) => (conteoGrupos[t.grupo] = (conteoGrupos[t.grupo] || 0) + 1));
      const grupo = Object.keys(conteoGrupos).sort((a, b) => conteoGrupos[b] - conteoGrupos[a])[0];
      const flotas = [...new Set([...todasLasFlotas(), ...lista.map((t) => t.flota)])].filter((f) =>
        lista.some((t) => t.flota === f)
      );

      // Cada flota es una sección; a partir de la segunda (p. ej. CARGUIO)
      // empieza en una hoja nueva con el cajetín repetido arriba.
      const secciones = flotas.map((f) => {
        const deFlota = lista.filter((t) => t.flota === f);
        const p = deFlota.filter((t) => t.tipo_trabajo === "programado");
        const n = deFlota.filter((t) => t.tipo_trabajo !== "programado");
        return `<div class="flota">
            <div class="flota-titulo">Flota ${escaparHTML(f)} <span>${deFlota.length} ${deFlota.length === 1 ? "trabajo" : "trabajos"}</span></div>
            <h3>Equipos Programados <span class="cuenta">${p.length}</span></h3>
            ${tablaTrabajos(p)}
            <h3>Equipos No Programados <span class="cuenta">${n.length}</span></h3>
            ${tablaTrabajos(n)}
          </div>`;
      });

      // Cajetín: logo y datos del documento con el mismo ancho (simétricos).
      const cajetin = `<table class="encabezado">
          <tr>
            <td class="enc-lado enc-logo">${logo}</td>
            <td class="enc-centro">
              <div class="empresa">${escaparHTML(cfg.empresa)}</div>
              <div class="area">${escaparHTML(cfg.area)}</div>
              <div class="titulo">${escaparHTML(cfg.titulo)}</div>
              ${cfg.subtitulo ? `<div class="subtitulo">${escaparHTML(cfg.subtitulo)}</div>` : ""}
            </td>
            <td class="enc-lado enc-doc">
              <div><span>${escaparHTML(mc.etCodigo)}</span>${escaparHTML(cfg.codigo)}</div>
              <div><span>${escaparHTML(mc.etRevision)}</span>${escaparHTML(cfg.revision)}</div>
              <div><span>${escaparHTML(mc.etEmitido)}</span>${emitido}</div>
            </td>
          </tr>
        </table>`;

      // Pie de página fijo al final de cada hoja: datos del turno.
      const pie = `<div class="pie-pagina">
          <div class="pie-datos">
            <span><em>Fecha</em>${formatoFecha(fecha)}</span>
            <span><em>Turno</em>${turno === "dia" ? "Día (06:00 – 18:00)" : "Noche (18:00 – 06:00)"}</span>
            <span><em>Grupo</em>${escaparHTML(nombreGrupo(grupo))}</span>
            <span><em>Impreso por</em>${escaparHTML(impresoPor || "")}</span>
            <span class="pie-num"></span>
          </div>
          ${cfg.pie ? `<div class="pie-texto">${escaparHTML(cfg.pie)}</div>` : ""}
        </div>`;

      const paginas = secciones.length ? secciones : [""];
      return paginas
        .map(
          (seccion) => `<section class="hoja">
        ${cajetin}
        ${seccion}
        ${pie}
      </section>`
        )
        .join("");
    })
    .join("");

  abrirVistaImpresion(`<html><head><title>${escaparHTML(cfg.titulo)}</title>
    <style>
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
      body { font-family: ${LETRA_DOC}; color: #1b1f24; font-size: 10.5px; }
      .hoja { page-break-after: always; }
      .hoja:last-child { page-break-after: auto; }
      .encabezado { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #d5d9df; margin-bottom: 12px; table-layout: fixed; }
      .encabezado td { padding: 8px 10px; vertical-align: middle; }
      .enc-logo { width: ${mc.anchoLogo}px; }
      .enc-doc { width: ${mc.anchoDatos}px; }
      ${mc.alto ? `.encabezado tr { height: ${mc.alto}px; }` : ""}
      .enc-doc div { white-space: nowrap; }
      .enc-logo { text-align: center; border-right: 1px solid #e3e6ea; }
      .enc-doc { border-left: 1px solid #e3e6ea; font-size: ${mc.datos}px; }
      .logo-img { max-width: ${Math.max(20, mc.anchoLogo - 24)}px; max-height: ${mc.altoLogo}px; object-fit: contain; }
      .logo-ini { width: ${Math.min(mc.altoLogo, 50)}px; height: ${Math.min(mc.altoLogo, 50)}px; margin: 0 auto; background: ${color}; color: #fff; font-weight: 800; font-size: ${Math.round(Math.min(mc.altoLogo, 50) * 0.36)}px; display: flex; align-items: center; justify-content: center; }
      .enc-centro { text-align: center; }
      .empresa { font-size: ${mc.empresa}px; font-weight: 400; letter-spacing: .04em; }
      .area { font-size: ${mc.area}px; color: #6b7280; margin-top: 1px; }
      .titulo { font-size: ${mc.titulo}px; font-weight: 400; color: ${color}; margin-top: 4px; letter-spacing: .03em; }
      .subtitulo { font-size: ${mc.subtitulo}px; color: #6b7280; margin-top: 2px; }
      .enc-doc div { display: flex; justify-content: space-between; gap: 8px; padding: 1.5px 0; }
      .enc-doc span { color: #6b7280; }
      .flota { margin-top: 4px; }
      .flota-titulo { background: ${color}14; color: #111827; font-weight: 700; padding: 6px 10px; letter-spacing: .06em; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; font-size: 11px; border-bottom: 1.5px solid ${color}; }
      .flota-titulo span { font-weight: 600; font-size: 9.5px; text-transform: none; letter-spacing: 0; background: ${color}; color: #fff; padding: 1px 8px; }
      h3 { font-size: 10.5px; font-weight: 400; margin: 12px 0 6px; color: #111827; display: flex; align-items: center; gap: 6px; }
      h3 .cuenta { font-size: 9px; font-weight: 400; color: ${color}; background: ${color}1f; padding: 1px 7px; }
      .tabla { border-collapse: separate; border-spacing: 0; width: 100%; border: 1px solid #e3e6ea; overflow: hidden; table-layout: fixed; }
      /* Mismo ancho de columnas en todas las tablas del reporte */
      .tabla th:nth-child(1) { width: 6%; } .tabla th:nth-child(2) { width: 49%; } .tabla th:nth-child(3) { width: 11%; }
      .tabla th:nth-child(4) { width: 10%; } .tabla th:nth-child(5) { width: 13%; } .tabla th:nth-child(6) { width: 11%; }
      .tabla td { overflow-wrap: anywhere; }
      .tabla tr { page-break-inside: avoid; break-inside: avoid; }
      .tabla th { background: ${color}14; color: #374151; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; text-align: left; padding: 6px 7px; border-bottom: 1.5px solid ${color}; }
      /* Letra de 9 pt (12 px) con interlineado sencillo para leer mejor */
      .tabla td { padding: 6px 7px; border-bottom: 1px solid #eef0f2; vertical-align: top; text-align: left; font-size: 12px; line-height: 1.15; }
      .tabla tbody tr:last-child td { border-bottom: none; }
      .tabla tbody tr:nth-child(even) td { background: #f9fafb; }
      td.eq { font-weight: 400; white-space: nowrap; font-size: 12px; color: #111827; }
      td.desc { line-height: 1.15; }
      td.desc .tit { font-weight: 700; color: #111827; }
      td.desc .nota { font-style: italic; color: #6b7280; margin-top: 2px; }
      td.pers { color: #374151; }
      td.hora { white-space: nowrap; font-variant-numeric: tabular-nums; }
      .estado { display: inline-block; padding: 2px 7px; font-weight: 600; font-size: 8.5px; white-space: nowrap; }
      .estado.ok { background: #e3f4ea; color: #1f7a45; }
      .estado.no { background: #fde8e7; color: #b42318; }
      .tenue { color: #9ca3af; font-style: italic; }
      .vacio { color: #6b7280; font-style: italic; padding: 8px 10px; border: 1px dashed #d5d9df; }
      .pie-pagina { border-top: 1px solid #d5d9df; padding-top: 5px; color: #4b5563; }
      .pie-datos { display: flex; gap: 16px; align-items: baseline; font-size: 9px; }
      .pie-datos em { font-style: normal; color: #9ca3af; text-transform: uppercase; letter-spacing: .05em; font-size: 7.5px; margin-right: 4px; }
      .pie-datos .pie-num { margin-left: auto; color: #6b7280; }
      .pie-texto { font-size: 8px; color: #9ca3af; margin-top: 2px; }
    </style>
  </head><body>${hojas || '<div class="vacio">No hay trabajos con los filtros actuales.</div>'}</body></html>`, { margen: "estrecho" });
}

// Reporte de turno en Word (.docx): mismas hojas, cajetín, tablas y pie que
// el PDF de imprimirReporteTurno.
function exportarWordReporteTurno(trabajos, impresoPor, nombreArchivo = "reporte_de_turno") {
  const cfg = registroReporte.config;
  const bloques = {};
  trabajos.forEach((t) => {
    const clave = `${t.fecha}|${t.turno}`;
    (bloques[clave] = bloques[clave] || []).push(t);
  });
  const claves = Object.keys(bloques).sort((a, b) => {
    const [fa, ta] = a.split("|");
    const [fb, tb] = b.split("|");
    return fa !== fb ? (fa < fb ? -1 : 1) : TURNO_RANGO[ta] - TURNO_RANGO[tb];
  });
  const fila = (t) => {
    const lineas = (t.descripcion || "").split("\n").filter((l) => l.trim());
    const esSubtitulo = (l) => !/^\s*-/.test(l) && l.trim() === l.trim().toUpperCase();
    const tieneSubtitulos = lineas.some(esSubtitulo);
    return {
      equipo: t.equipo || "",
      lineas: [
        ...(!tieneSubtitulos && t.sintoma_causa ? [{ t: t.sintoma_causa, tit: true }] : []),
        ...lineas.map((l) => ({ t: l, tit: esSubtitulo(l) })),
      ],
      nota: t.observaciones || "",
      personal: usuariosDoc(t.participantes),
      ubicacion: t.ubicacion || "",
      horario: t.hora_inicio || t.hora_fin ? `${t.hora_inicio || "--:--"} – ${t.hora_fin || "--:--"}` : "",
      ok: t.estado_final === "disponible",
    };
  };
  const hojas = claves.map((clave) => {
    const lista = bloques[clave];
    const [fecha, turno] = clave.split("|");
    const conteoGrupos = {};
    lista.forEach((t) => (conteoGrupos[t.grupo] = (conteoGrupos[t.grupo] || 0) + 1));
    const grupo = Object.keys(conteoGrupos).sort((a, b) => conteoGrupos[b] - conteoGrupos[a])[0];
    const flotas = [...new Set([...todasLasFlotas(), ...lista.map((t) => t.flota)])].filter((f) => lista.some((t) => t.flota === f));
    return {
      fecha: formatoFecha(fecha),
      turnoTexto: turno === "dia" ? "Día (06:00 – 18:00)" : "Noche (18:00 – 06:00)",
      grupo: nombreGrupo(grupo),
      impresoPor,
      secciones: flotas.map((f) => {
        const deFlota = lista.filter((t) => t.flota === f);
        const ordenar = (l) => l.slice().sort(compararPorHorarioDeTurno).map(fila);
        return {
          flota: f,
          total: deFlota.length,
          programados: ordenar(deFlota.filter((t) => t.tipo_trabajo === "programado")),
          noProgramados: ordenar(deFlota.filter((t) => t.tipo_trabajo !== "programado")),
        };
      }),
    };
  });
  const ctx = {
    ...datosFormatoDoc(),
    iniciales: inicialesDe(registroReporte.nombreApp || cfg.empresa),
    cfg,
    mc: medidasCajetin(cfg),
    emitido: fechaEmisionDoc(),
    hojas,
    nombreArchivo,
  };
  import("../lib/word").then((m) => m.wordReporteTurno(ctx)).catch(avisarErrorWord);
}

// Imprime el registro de trabajo COMPLETO de una sola intervención, en
// formato de ficha (campo: valor), legible en una hoja impresa — a
// diferencia de exportarPDF, que arma una tabla angosta pensada para
// listas de varios registros.
function imprimirRegistroTrabajo(trabajo) {
  imprimirFicha({
    titulo: "Registro de trabajo",
    destacado: `Equipo ${trabajo.equipo || "—"}`,
    chips: [
      ["Flota", trabajo.flota],
      ["Fecha de ingreso", fechaDoc(trabajo.fecha)],
      ["Turno", trabajo.turno === "dia" ? "Día" : "Noche"],
      ["Estado final", trabajo.estado_final === "disponible" ? "Disponible" : "No disponible"],
      ["OT", trabajo.ot],
    ],
    campos: [
      ["Tipo de trabajo", trabajo.tipo_trabajo === "programado" ? "Programado" : "No programado"],
      ["Grupo", nombreGrupo(trabajo.grupo)],
      ["Ubicación", trabajo.ubicacion],
      ["Hora de inicio", trabajo.hora_inicio],
      ["Hora de finalización", trabajo.hora_fin],
      ["Tiempo de trabajo", calcularTiempoTrabajo(trabajo.hora_inicio, trabajo.hora_fin)],
    ],
    bloques: [
      ["Falla del equipo", trabajo.sintoma_causa],
      ["Descripción del trabajo", trabajo.descripcion],
      ["Personal participante", usuariosDoc(trabajo.participantes).join(", ")],
      ["Síntoma y causa de la falla", trabajo.observaciones],
    ],
  });
}

// Imprime la ficha completa de un registro de aceite, en el mismo formato
// que imprimirRegistroTrabajo.
function imprimirRegistroAceite(aceite) {
  imprimirFicha({
    titulo: "Registro de aceite",
    destacado: `Equipo ${aceite.equipo || "—"}`,
    chips: [
      ["Flota", aceite.flota],
      ["Fecha de ingreso", fechaDoc(aceite.fecha)],
      ["Turno", aceite.turno === "dia" ? "Día" : "Noche"],
      ["Tipo de registro", textoOperacionAceite(aceite.tipo_operacion)],
      ["Cantidad", aceite.cantidad_litros != null && aceite.cantidad_litros !== "" ? `${aceite.cantidad_litros} L` : ""],
    ],
    campos: [
      ["Tipo de trabajo", aceite.tipo_trabajo === "programado" ? "Programado" : "No programado"],
      ["Tipo de aceite", aceite.tipo_aceite],
      ["Sistema del equipo", aceite.sistema_equipo],
      ["Horómetro", aceite.horometro],
      ["Ubicación", aceite.ubicacion],
      ["Hora de inicio", aceite.hora_inicio],
      ["Hora de finalización", aceite.hora_fin],
      ["Tiempo de trabajo", calcularTiempoTrabajo(aceite.hora_inicio, aceite.hora_fin)],
    ],
    bloques: [
      ...(aceite.tipo_operacion === "adicion" && aceite.verificaciones
        ? [["Verificaciones", VERIFICACIONES_ADICION.map(([k, t]) => `${aceite.verificaciones[k] ? "☑" : "☐"} ${t}`).join("\n")]]
        : []),
      ["Personal participante", usuariosDoc(aceite.participantes).join(", ")],
      ["Observaciones", aceite.observaciones],
    ],
  });
}

// Imprime la ficha completa de un requerimiento.
// --- Requerimientos impresos: fila de la tabla + secuencia del proceso
// (Solicitado → Aprobado → En proceso de compra → Comprado), igual que en la
// app pero sin botones.
function estilosReqDoc(color) {
  return `
      .req-tabla { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 9.6px; }
      .req-tabla th { color: #6b7280; font-weight: 600; font-size: 9px; text-align: left; padding: 6px 6px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
      .req-tabla td { padding: 7px 6px 5px; vertical-align: middle; }
      .req-tabla tr.req-fila td { border-top: 1px solid #e5e7eb; }
      .req-tabla tr.req-fila:first-child td { border-top: none; }
      .req-tabla tr.req-fila.con-seg td { padding-bottom: 2px; }
      .req-tabla td.mono { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 9.2px; white-space: nowrap; }
      .req-tabla tr.req-seg td { padding: 2px 6px 9px; }
      .req-tabla tbody { page-break-inside: auto; }
      .req-tabla tr { page-break-inside: avoid; break-inside: avoid; }
      .seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      .seg-paso .barra { height: 3px; border-radius: 3px; background: #e5e7eb; margin-bottom: 4px; }
      .seg-paso.hecho .barra { background: ${color}59; }
      .seg-paso.actual .barra { background: ${color}; }
      .seg-paso.rechazo .barra { background: #b42318; }
      .seg-paso .tit { display: flex; align-items: center; gap: 5px; font-size: 9.4px; font-weight: 600; color: #6b7280; }
      .seg-paso.hecho .tit { color: #111827; }
      .seg-paso .ico { width: 11px; height: 11px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 7px; font-weight: 700; border: 1px solid #d1d5db; color: #6b7280; }
      .seg-paso.hecho .ico { background: ${color}; border-color: ${color}; color: #fff; }
      .seg-paso.rechazo .ico { background: #b42318; border-color: #b42318; }
      .seg-paso .meta, .seg-paso .extra { font-size: 8.6px; color: #6b7280; padding-left: 16px; }
      .seg-paso .extra { color: #111827; }
  `;
}
function htmlSeguimientoReq(req) {
  const pasos = pasosRequerimiento(req);
  const actual = pasos.filter((p) => p.hecho).length - 1;
  return `<div class="seg">${pasos
    .map((p, i) => {
      const d = p.dato || {};
      const fecha = fechaHoraReq(d.fecha);
      const meta = p.hecho ? `${escaparHTML(fecha || "—")}${d.usuario ? ` · ${escaparHTML(usuarioDoc(d.usuario))}` : ""}` : "Pendiente";
      const extra =
        p.hecho && p.clave === "en_proceso_compra" && detalleCompraReq(d)
          ? `<div class="extra">${escaparHTML(detalleCompraReq(d))}</div>`
          : p.hecho && d.motivo
          ? `<div class="extra">${escaparHTML(d.motivo)}</div>`
          : "";
      const restab =
        p.hecho && d.restablecido_en
          ? `<div class="meta">Restablecido ${escaparHTML(fechaHoraReq(d.restablecido_en))}${d.restablecido_por ? ` · ${escaparHTML(usuarioDoc(d.restablecido_por))}` : ""}</div>`
          : "";
      const clases = ["seg-paso", p.hecho ? "hecho" : "", i === actual ? "actual" : "", p.rechazo ? "rechazo" : ""].join(" ");
      return `<div class="${clases}"><div class="barra"></div><div class="tit"><span class="ico">${p.hecho ? (p.rechazo ? "✕" : "✓") : i + 1}</span>${escaparHTML(p.titulo)}</div><div class="meta">${meta}</div>${extra}${restab}</div>`;
    })
    .join("")}</div>`;
}
function htmlTablaReq(lista, siempreSeguimiento = false) {
  const cab = ["N°", "Equipo", "Parte", "Descripción", "Cant.", "Solicitante", "Fecha", "Estado"];
  const filas = lista
    .map((r) => {
      const conSeg = siempreSeguimiento || r.estado !== "pendiente_aprobacion";
      return `<tr class="req-fila${conSeg ? " con-seg" : ""}">
          <td class="mono">${escaparHTML(r.id)}</td>
          <td class="mono">${escaparHTML(r.equipo)}</td>
          <td class="mono">${escaparHTML(r.numero_parte)}</td>
          <td>${escaparHTML(r.descripcion)}</td>
          <td class="mono">${escaparHTML(r.cantidad)}</td>
          <td>${escaparHTML(usuarioDoc(r.solicitante))}</td>
          <td class="mono">${escaparHTML(r.fecha_solicitud)}</td>
          <td>${pillDoc(ESTADO_REQ_LABEL[r.estado] || r.estado) || escaparHTML(r.estado)}</td>
        </tr>${conSeg ? `<tr class="req-seg"><td colspan="8">${htmlSeguimientoReq(r)}</td></tr>` : ""}`;
    })
    .join("");
  return `<table class="req-tabla"><thead><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${filas}</tbody></table>`;
}
// Impresión de un requerimiento (botón 🖨 de la fila): mismo diseño que el
// cuadro emergente — datos en una fila, descripción y proceso.
function imprimirRegistroRequerimiento(req) {
  const color = registroReporte.color || "#4a8fe0";
  const dato = (e, v) => `<div class="dato"><span>${escaparHTML(e)}</span><b>${escaparHTML(v === "" || v == null ? "—" : v)}</b></div>`;
  const estado = pillDoc(ESTADO_REQ_LABEL[req.estado] || req.estado) || escaparHTML(req.estado);
  abrirVistaImpresion(`<html><head><title>Requerimiento ${escaparHTML(req.id)}</title>
    <style>
      ${estilosDocumento(color)}
      .datos { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin: 4px 0 14px; }
      .dato span, .subt { display: block; font-size: 8.5px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 3px; }
      .dato b { font-size: 11px; font-weight: 500; color: #111827; }
      .desc { background: #f4f2ef; padding: 9px 11px; font-size: 11px; color: #111827; margin-bottom: 14px; white-space: pre-wrap; }
      .subt { margin-bottom: 6px; }
      ${estilosReqDoc(color)}
      .seg-paso .tit { font-size: 10px; }
      .seg-paso .meta, .seg-paso .extra { font-size: 9px; }
    </style></head><body>
    ${cabeceraDocumento(`Requerimiento ${req.id}`, `${estado} · Emitido el ${fechaEmisionDoc()}`)}
    <div class="datos">
      ${dato("Equipo", req.equipo)}
      ${dato("Flota", req.flota)}
      ${dato("Número de parte", req.numero_parte)}
      ${dato("Cantidad", req.cantidad)}
      ${dato("Solicitante", usuarioDoc(req.solicitante))}
      ${dato("Fecha de solicitud", fechaDoc(req.fecha_solicitud))}
    </div>
    <div class="subt">Descripción del repuesto o material</div>
    <div class="desc">${escaparHTML(req.descripcion || "—")}</div>
    <div class="subt">Proceso</div>
    ${htmlSeguimientoReq(req)}
  </body></html>`);
}
// Impresión general (Exportar → PDF): tabla con la secuencia debajo de cada
// requerimiento.
function imprimirListaRequerimientos(lista) {
  const color = registroReporte.color || "#4a8fe0";
  const detalle = `<b>${lista.length}</b> ${lista.length === 1 ? "registro" : "registros"} · Emitido el ${fechaEmisionDoc()}`;
  abrirVistaImpresion(`<html><head><title>Requerimientos</title>
    <style>
      ${estilosDocumento(color)}
      ${estilosReqDoc(color)}
      .doc-vacio { color: #6b7280; font-style: italic; padding: 18px 0; text-align: center; border: 1px dashed #d1d5db; }
    </style></head><body>
    ${cabeceraDocumento("Requerimientos", detalle)}
    ${lista.length ? htmlTablaReq(lista) : `<div class="doc-vacio">Sin registros con los filtros actuales.</div>`}
  </body></html>`);
}

const COLUMNAS_EXPORT_TRABAJOS = [
  { clave: "ot", titulo: "OT" },
  { clave: "equipo", titulo: "Equipo" },
  { clave: "flota", titulo: "Flota" },
  { clave: "tipo_trabajo", titulo: "Tipo" },
  { clave: "sintoma_causa", titulo: "Falla del equipo" },
  { clave: "descripcion", titulo: "Trabajo realizado" },
  { clave: "ubicacion", titulo: "Ubicación" },
  { clave: "fecha", titulo: "Fecha" },
  { clave: "turno", titulo: "Turno" },
  { clave: "grupo", titulo: "Grupo" },
  { clave: "hora_inicio", titulo: "Hora inicio" },
  { clave: "hora_fin", titulo: "Hora fin" },
  { clave: "estado_final", titulo: "Estado" },
  { clave: "personal", titulo: "Personal participante" },
  { clave: "observaciones", titulo: "Síntoma y causa de la falla" },
];

function filasExportTrabajos(trabajos) {
  return trabajos.map((t) => ({
    ...t,
    tipo_trabajo: t.tipo_trabajo === "programado" ? "Programado" : "No programado",
    turno: t.turno === "dia" ? "Día" : "Noche",
    grupo: nombreGrupo(t.grupo),
    estado_final: t.estado_final === "disponible" ? "Disponible" : "No disponible",
    personal: usuariosDoc(t.participantes).join(", "),
  }));
}

const COLUMNAS_EXPORT_ACEITES = [
  { clave: "equipo", titulo: "Equipo" },
  { clave: "flota", titulo: "Flota" },
  { clave: "tipo_trabajo", titulo: "Tipo de trabajo" },
  { clave: "fecha", titulo: "Fecha" },
  { clave: "turno", titulo: "Turno" },
  { clave: "tipo_operacion", titulo: "Tipo de registro" },
  { clave: "ubicacion", titulo: "Ubicación" },
  { clave: "tipo_aceite", titulo: "Tipo de aceite" },
  { clave: "sistema_equipo", titulo: "Sistema" },
  { clave: "cantidad_litros", titulo: "Litros" },
  { clave: "horometro", titulo: "Horómetro" },
  { clave: "hora_inicio", titulo: "Hora inicio" },
  { clave: "hora_fin", titulo: "Hora fin" },
  { clave: "verificaciones", titulo: "Verificaciones" },
  { clave: "personal", titulo: "Personal participante" },
  { clave: "observaciones", titulo: "Observaciones" },
];

// Verificaciones de una adición: "✓" (las tres marcadas), "✗" (falta
// alguna) o vacío (cambio y derrame).
function textoVerificaciones(a) {
  if (a.tipo_operacion !== "adicion") return "";
  const v = a.verificaciones || {};
  return VERIFICACIONES_ADICION.every(([k]) => v[k]) ? "✓" : "✗";
}

function filasExportAceites(aceites) {
  return aceites.map((a) => ({
    ...a,
    turno: a.turno === "dia" ? "Día" : "Noche",
    tipo_trabajo: a.tipo_trabajo === "programado" ? "Programado" : "No programado",
    tipo_operacion: textoOperacionAceite(a.tipo_operacion),
    verificaciones: textoVerificaciones(a),
    personal: usuariosDoc(a.participantes).join(", "),
  }));
}

const COLUMNAS_EXPORT_REQUERIMIENTOS = [
  { clave: "id", titulo: "N°" },
  { clave: "equipo", titulo: "Equipo" },
  { clave: "flota", titulo: "Flota" },
  { clave: "numero_parte", titulo: "N° de parte" },
  { clave: "descripcion", titulo: "Descripción" },
  { clave: "cantidad", titulo: "Cantidad" },
  { clave: "solicitante", titulo: "Solicitante" },
  { clave: "fecha_solicitud", titulo: "Fecha de solicitud" },
  { clave: "estado", titulo: "Estado" },
  { clave: "fecha_aprobacion", titulo: "Aprobación" },
  { clave: "fecha_inicio_compra", titulo: "Inicio de compra" },
  { clave: "detalle_compra", titulo: "Detalle de compra" },
  { clave: "fecha_comprado", titulo: "Comprado" },
  { clave: "comprado_por", titulo: "Comprado por" },
  { clave: "fecha_cancelado", titulo: "Cancelado" },
  { clave: "motivo", titulo: "Motivo" },
];

function filasExportRequerimientos(requerimientos) {
  return requerimientos.map((r) => ({
    ...r,
    estado: ESTADO_REQ_LABEL[r.estado] || r.estado,
    solicitante: usuarioDoc(r.solicitante),
    ...(() => {
      const f = fechasRequerimiento(r);
      return {
        fecha_aprobacion: f.aprobacion,
        fecha_inicio_compra: f.inicio_compra,
        detalle_compra: f.detalle_compra,
        fecha_comprado: f.comprado,
        comprado_por: f.comprado_por,
        fecha_cancelado: f.cancelado,
        motivo: f.motivo,
      };
    })(),
  }));
}

// Texto de la operación de aceite (adición, cambio o derrame). Los tres
// tipos se guardan en la misma tabla (aceites) con tipo_operacion.
const TEXTO_OPERACION_ACEITE = { adicion: "Adición", cambio: "Cambio", derrame: "Derrame" };
function textoOperacionAceite(op) {
  return TEXTO_OPERACION_ACEITE[op] || "Adición";
}

// Permisos por rol, según la Fase 1
const PERMISOS_INICIAL = {
  Administrador: {
    nav: ["dashboard", "trabajos", "requerimientos", "componentes", "aceites", "engrase", "historial", "config"],
    registrarEngrase: true,
    crearTrabajo: true,
    crearAceite: true,
    registrarDerrame: true,
    crearRequerimiento: true,
    aprobarRequerimiento: true,
    avanzarCompra: false,
  },
  Supervisor: {
    nav: ["dashboard", "trabajos", "requerimientos", "componentes", "aceites", "engrase", "historial"],
    registrarEngrase: true,
    crearTrabajo: true,
    crearAceite: true,
    registrarDerrame: true,
    crearRequerimiento: true,
    aprobarRequerimiento: true,
    avanzarCompra: false,
  },
  Técnico: {
    nav: ["dashboard", "trabajos", "requerimientos", "componentes", "aceites", "engrase", "historial"],
    registrarEngrase: true,
    crearTrabajo: true,
    crearAceite: true,
    registrarDerrame: true,
    crearRequerimiento: true,
    aprobarRequerimiento: false,
    avanzarCompra: false,
  },
  Planificador: {
    nav: ["dashboard", "requerimientos", "componentes", "aceites", "historial"],
    registrarEngrase: false,
    crearTrabajo: false,
    crearAceite: false,
    registrarDerrame: true,
    crearRequerimiento: false,
    aprobarRequerimiento: false,
    avanzarCompra: true,
  },
  Lubricador: {
    nav: ["aceites", "engrase"],
    registrarEngrase: true,
    crearTrabajo: false,
    crearAceite: true,
    registrarDerrame: true,
    crearRequerimiento: false,
    aprobarRequerimiento: false,
    avanzarCompra: false,
  },
};

// Filas del cuadro de "Roles y permisos" de Configuración, armadas
// directamente a partir de PERMISOS (así nunca queda desactualizado
// respecto a los permisos reales del sistema).

const FILAS_PERMISOS = [
  { etiqueta: "Ver Inicio", tipo: "nav", clave: "dashboard" },
  { etiqueta: "Ver Trabajos", tipo: "nav", clave: "trabajos" },
  { etiqueta: "Ver Requerimientos", tipo: "nav", clave: "requerimientos" },
  { etiqueta: "Ver Componentes", tipo: "nav", clave: "componentes" },
  { etiqueta: "Ver Aceites", tipo: "nav", clave: "aceites" },
  { etiqueta: "Ver Engrase", tipo: "nav", clave: "engrase" },
  { etiqueta: "Ver Historial", tipo: "nav", clave: "historial" },
  { etiqueta: "Registrar trabajos", tipo: "bool", clave: "crearTrabajo" },
  { etiqueta: "Registrar adiciones/cambios de aceite", tipo: "bool", clave: "crearAceite" },
  { etiqueta: "Registrar derrame de aceite", tipo: "bool", clave: "registrarDerrame" },
  { etiqueta: "Crear requerimientos", tipo: "bool", clave: "crearRequerimiento" },
  { etiqueta: "Aprobar / no aprobar requerimientos", tipo: "bool", clave: "aprobarRequerimiento" },
  { etiqueta: "Avanzar estado de compra", tipo: "bool", clave: "avanzarCompra" },
  { etiqueta: "Registrar inspecciones de engrase", tipo: "bool", clave: "registrarEngrase" },
];

// Pestañas agregadas después: en los permisos ya guardados de cada rol se
// agregan según los permisos iniciales (una sola vez; luego el
// Administrador decide en Configuración → Roles y permisos).
const NAV_NUEVOS = ["componentes", "engrase"];
function completarPermisosRol(inicial, guardado) {
  if (!guardado) return inicial;
  const p = { ...inicial, ...guardado };
  const revisados = guardado.navRevisados || [];
  const faltan = NAV_NUEVOS.filter((k) => !revisados.includes(k) && inicial.nav.includes(k) && !(p.nav || []).includes(k));
  if (faltan.length) {
    const orden = NAV_ITEMS_INICIAL.map((n) => n.key);
    p.nav = [...(p.nav || []), ...faltan].sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
  }
  p.navRevisados = [...new Set([...revisados, ...NAV_NUEVOS])];
  return p;
}

function permisoActivo(permisoRol, fila) {
  return fila.tipo === "nav" ? permisoRol.nav.includes(fila.clave) : !!permisoRol[fila.clave];
}

const ROLES_CUADRO_PERMISOS = ["Supervisor", "Técnico", "Planificador", "Lubricador"];

const NAV_ITEMS_INICIAL = [
  { key: "dashboard", label: "Inicio" },
  { key: "trabajos", label: "Trabajos" },
  { key: "requerimientos", label: "Requerimientos" },
  { key: "componentes", label: "Componentes" },
  { key: "aceites", label: "Aceites" },
  { key: "engrase", label: "Engrase" },
  { key: "historial", label: "Historial" },
  { key: "config", label: "Configuración" },
];

// Nombres originales de cada opción del menú, usados como etiqueta fija en
// el formulario de edición de Configuración (aunque el texto ya se haya
// personalizado, así se sabe a qué pestaña corresponde cada campo).
const NOMBRES_MENU_ORIGINALES = {
  dashboard: "Inicio",
  trabajos: "Trabajos",
  aceites: "Aceites",
  requerimientos: "Requerimientos",
  componentes: "Componentes",
  engrase: "Engrase",
  historial: "Historial",
  config: "Configuración",
};

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

// Guarda en Supabase (tabla "configuracion") un ajuste de la app cuando
// cambia, con una pequeña espera para no guardar en cada tecla. Solo el
// Administrador guarda; "ultimoGuardado" evita reescribir lo recién leído.
const ultimoGuardado = {};
function useConfigPersistente(clave, valor, habilitado, alError) {
  const json = JSON.stringify(valor);
  useEffect(() => {
    if (!habilitado || ultimoGuardado[clave] === json) return;
    const t = setTimeout(() => {
      db.guardarConfig(clave, valor)
        .then(() => (ultimoGuardado[clave] = json))
        .catch(alError);
    }, 700);
    return () => clearTimeout(t);
  }, [clave, json, habilitado]);
}

export default function TruckShopApp() {
  const ubicacion = useLocation();
  const navegar = useNavigate();

  // -- Sesión (Supabase Auth) y perfil del usuario conectado ---------------
  const { sesion, verificando: verificandoSesion } = useSesion();
  const sesionActiva = !!sesion;
  const [perfil, setPerfil] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");
  const [datosListos, setDatosListos] = useState(false);
  const [aviso, setAviso] = useState("");
  const rol = (perfil && perfil.rol) || "Técnico";
  const esAdmin = rol === "Administrador";
  function avisarError(e) {
    setAviso(db.mensajeError(e));
  }
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const [vista, setVista] = useState(() => vistaDesdeRuta(window.location.pathname));
  // Registro de trabajo que debe abrirse en modo edición al entrar a
  // Trabajos (por ejemplo, desde "Equipos no disponibles" en Inicio).
  const [trabajoAEditar, setTrabajoAEditar] = useState(null);

  const [trabajos, setTrabajos] = useState([]);
  const [aceites, setAceites] = useState([]);
  const [requerimientos, setRequerimientos] = useState([]);
  const [engrases, setEngrases] = useState([]);
  const [frecuenciasEngrase, setFrecuenciasEngrase] = useState({});
  const [tiposAceite, setTiposAceite] = useState([]);
  const [sistemasEquipo, setSistemasEquipo] = useState([]);
  const [gruposTrabajo, setGruposTrabajo] = useState(GRUPOS_TRABAJO_INICIAL);
  registroGrupos.lista = gruposTrabajo;
  const [titulosSecciones, setTitulosSecciones] = useState(TITULOS_SECCIONES_INICIAL);
  registroTitulos.valores = titulosSecciones;

  function renombrarSeccion(clave, nombre) {
    const limpio = nombre.trim();
    if (!limpio) return;
    setTitulosSecciones((prev) => ({ ...prev, [clave]: limpio }));
  }
  const [personal, setPersonal] = useState([]);
  // Orden manual de los cuadros de personal en Configuración (arrastrar).
  const [ordenCuadrosPersonal, setOrdenCuadrosPersonal] = useState([]);
  const [equipos, setEquipos] = useState([]);
  const [flotas, setFlotas] = useState(FLOTAS_INICIAL);
  const [flotasInactivas, setFlotasInactivas] = useState([]);
  registroFlotas.todas = flotas;
  registroFlotas.inactivas = flotasInactivas;

  function toggleFlotaActiva(nombre) {
    setFlotasInactivas((prev) => (prev.includes(nombre) ? prev.filter((f) => f !== nombre) : [...prev, nombre]));
    setFiltros((prev) => (prev.flota === nombre ? { ...prev, flota: "todos" } : prev));
  }

  // Solo se permite eliminar una flota sin equipos (se valida también en la
  // interfaz). Los registros históricos conservan el nombre de la flota.
  function eliminarFlota(nombre) {
    if (equipos.some((e) => e.flota === nombre)) return;
    setFlotas((prev) => prev.filter((f) => f !== nombre));
    setFlotasInactivas((prev) => prev.filter((f) => f !== nombre));
    setFiltros((prev) => (prev.flota === nombre ? { ...prev, flota: "todos" } : prev));
  }

  function agregarFlota(nombre) {
    const limpio = nombre.trim();
    if (!limpio) return;
    setFlotas((prev) => [...prev, limpio]);
  }

  // Renombra una flota y actualiza el nombre en equipos, trabajos, aceites,
  // requerimientos, personal y grupos (en la base de datos y en pantalla).
  function renombrarFlota(anterior, nuevo) {
    const limpio = nuevo.trim();
    if (!limpio || limpio === anterior) return;
    const cambiar = (lista) => lista.map((x) => (x.flota === anterior ? { ...x, flota: limpio } : x));
    setFlotas((prev) => prev.map((f) => (f === anterior ? limpio : f)));
    setFlotasInactivas((prev) => prev.map((f) => (f === anterior ? limpio : f)));
    setEquipos(cambiar);
    setTrabajos(cambiar);
    setAceites(cambiar);
    setRequerimientos(cambiar);
    setPersonal((prev) => prev.map((x) => (x.flota_grupo === anterior ? { ...x, flota_grupo: limpio } : x)));
    setGruposTrabajo((prev) => prev.map((g) => (g.alcance === anterior ? { ...g, alcance: limpio } : g)));
    setFiltros((prev) => (prev.flota === anterior ? { ...prev, flota: limpio } : prev));
    db.renombrarFlota(anterior, limpio).catch(errorYRecargar);
  }
  // Color principal por defecto: Negro.
  const [colorAcento, setColorAcento] = useState((COLORES_ACENTO.find((c) => c.nombre === "Negro") || COLORES_ACENTO[0]).valor);
  const [nombreApp, setNombreApp] = useState("TRUCK SHOP");
  const [logoUrl, setLogoUrl] = useState(null);
  // Presentación de los reportes impresos (Configuración → Reportes)
  const [configReporte, setConfigReporte] = useState(CONFIG_REPORTE_INICIAL);
  registroReporte.config = configReporte;
  registroReporte.logoUrl = logoUrl;
  registroReporte.nombreApp = nombreApp;
  registroReporte.color = colorAcento;
  const [temaApp, setTemaApp] = useState("blanco"); // "oscuro" | "claro" | "blanco"
  const modoOscuro = temaApp === "oscuro";
  const [panelIzquierdoTema, setPanelIzquierdoTema] = useState("blanco");

  // Barras del sistema del celular (barra de estado arriba y barra de
  // navegación abajo): toman el color del "Panel izquierdo".
  useEffect(() => {
    const opcion = OPCIONES_PANEL_IZQUIERDO.find((o) => o.clave === panelIzquierdoTema) || OPCIONES_PANEL_IZQUIERDO[0];
    const color = opcion.bg;
    function asegurarMeta(nombre) {
      let meta = document.querySelector(`meta[name="${nombre}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", nombre);
        document.head.appendChild(meta);
      }
      return meta;
    }
    asegurarMeta("theme-color").setAttribute("content", color);
    asegurarMeta("msapplication-navbutton-color").setAttribute("content", color);
    asegurarMeta("apple-mobile-web-app-status-bar-style").setAttribute("content", panelIzquierdoTema === "oscuro" ? "black-translucent" : "default");
    document.documentElement.style.backgroundColor = color;
  }, [panelIzquierdoTema]);
  const [fuenteFamilia, setFuenteFamilia] = useState(FUENTES_DISPONIBLES[0].valor);
  const [fuenteTamano, setFuenteTamano] = useState(TAMANOS_FUENTE[1].valor);
  const [coloresMarca, setColoresMarca] = useState(COLORES_MARCA_INICIAL);
  const [navItems, setNavItems] = useState(NAV_ITEMS_INICIAL);
  const [permisosPorRol, setPermisosPorRol] = useState(PERMISOS_INICIAL);

  function toggleAccesoModulo(rolObjetivo, clave) {
    setPermisosPorRol((prev) => {
      const navActual = prev[rolObjetivo].nav;
      const nuevoNav = navActual.includes(clave) ? navActual.filter((k) => k !== clave) : [...navActual, clave];
      return { ...prev, [rolObjetivo]: { ...prev[rolObjetivo], nav: nuevoNav } };
    });
  }

  function toggleAccionPermiso(rolObjetivo, campo) {
    setPermisosPorRol((prev) => ({
      ...prev,
      [rolObjetivo]: { ...prev[rolObjetivo], [campo]: !prev[rolObjetivo][campo] },
    }));
  }
  const [confirmarSalir, setConfirmarSalir] = useState(false);
  const [menuPerfilAbierto, setMenuPerfilAbierto] = useState(false);
  const [cambiandoContrasena, setCambiandoContrasena] = useState(false);
  const [cuadrosOcultos, setCuadrosOcultos] = useState([]);
  registroCuadrosOcultos.lista = cuadrosOcultos;
  const datosUsuario = perfil
    ? { nombre: perfil.nombre, usuario: perfil.usuario }
    : { nombre: "", usuario: (sesion && sesion.user && sesion.user.email) || "" };
  usuarioEnSesion.nombre = datosUsuario.nombre;
  usuarioEnSesion.usuario = datosUsuario.usuario;
  usuarioEnSesion.esAdmin = esAdmin;
  registroPersonal.lista = personal;

  // Registro releído después de que otra persona lo editó (ver ModalFormulario).
  useEffect(() => {
    function alRecargar(e) {
      const { tabla, fila } = e.detail || {};
      const poner = (prev) => prev.map((r) => (r.id === fila.id ? fila : r));
      if (tabla === "trabajos") setTrabajos(poner);
      if (tabla === "aceites") setAceites(poner);
      if (tabla === "requerimientos") setRequerimientos(poner);
    }
    window.addEventListener("ts-registro-recargado", alRecargar);
    return () => window.removeEventListener("ts-registro-recargado", alRecargar);
  }, []);

  // -- Aspecto visible en la pantalla de inicio de sesión (nombre y logo) --
  function aplicarAspecto(a) {
    if (!a) return;
    if (a.colorAcento) setColorAcento(a.colorAcento);
    if (a.nombreApp) setNombreApp(a.nombreApp);
    if (a.logoUrl !== undefined) setLogoUrl(a.logoUrl || null);
    if (a.temaApp) setTemaApp(a.temaApp);
    if (a.panelIzquierdoTema) setPanelIzquierdoTema(a.panelIzquierdoTema);
    if (a.fuenteFamilia) setFuenteFamilia(a.fuenteFamilia);
    if (a.fuenteTamano) setFuenteTamano(a.fuenteTamano);
    if (a.coloresMarca) setColoresMarca({ ...COLORES_MARCA_INICIAL, ...a.coloresMarca });
    if (Array.isArray(a.navItems)) setNavItems(NAV_ITEMS_INICIAL.map((n) => a.navItems.find((x) => x.key === n.key) || n));
  }
  useEffect(() => {
    db.cargarAspectoPublico().then(aplicarAspecto);
  }, []);

  // -- Carga de todos los datos al iniciar sesión ---------------------------
  async function cargarDatos() {
    if (!sesion) return;
    setCargando(true);
    setErrorCarga("");
    try {
      const d = await db.cargarTodo(sesion.user.id);
      if (!d.perfil) {
        setErrorCarga(
          "Tu usuario no tiene un perfil en la base de datos. Si eres el administrador, ejecuta el Script 2 (administrador) en Supabase con tu correo."
        );
        setDatosListos(false);
        return;
      }
      if (!d.perfil.activo) {
        await db.cerrarSesion();
        setAviso("Este usuario está inactivo. Consulta con el administrador.");
        return;
      }
      const c = d.configuracion || {};
      const asp = c.aspecto || {};
      // Valores normalizados (los mismos que se guardan al cambiar algo)
      const aspecto = {
        colorAcento: asp.colorAcento || (COLORES_ACENTO.find((x) => x.nombre === "Negro") || COLORES_ACENTO[0]).valor,
        nombreApp: asp.nombreApp || "TRUCK SHOP",
        logoUrl: asp.logoUrl || null,
        temaApp: asp.temaApp || "blanco",
        panelIzquierdoTema: asp.panelIzquierdoTema || "blanco",
        fuenteFamilia: asp.fuenteFamilia || FUENTES_DISPONIBLES[0].valor,
        fuenteTamano: asp.fuenteTamano || TAMANOS_FUENTE[1].valor,
        coloresMarca: { ...COLORES_MARCA_INICIAL, ...(asp.coloresMarca || {}) },
        navItems: NAV_ITEMS_INICIAL.map((n) => (asp.navItems || []).find((x) => x.key === n.key) || n),
      };
      const reporte = { ...CONFIG_REPORTE_INICIAL, ...(c.reporte || {}) };
      const permisos = {};
      Object.keys(PERMISOS_INICIAL).forEach((r) => {
        permisos[r] = r === "Administrador" ? PERMISOS_INICIAL[r] : completarPermisosRol(PERMISOS_INICIAL[r], (c.permisos || {})[r]);
      });
      const titulos = { ...TITULOS_SECCIONES_INICIAL, ...(c.titulos || {}) };
      const flotasCfg = {
        todas: (c.flotas && c.flotas.todas) || FLOTAS_INICIAL,
        inactivas: (c.flotas && c.flotas.inactivas) || [],
      };
      const orden = c.orden_cuadros || [];
      const ocultos = c.cuadros_ocultos || [];
      Object.assign(ultimoGuardado, {
        aspecto: JSON.stringify(aspecto),
        reporte: JSON.stringify(reporte),
        permisos: JSON.stringify(permisos),
        titulos: JSON.stringify(titulos),
        flotas: JSON.stringify(flotasCfg),
        orden_cuadros: JSON.stringify(orden),
        cuadros_ocultos: JSON.stringify(ocultos),
      });
      aplicarAspecto(aspecto);
      setConfigReporte(reporte);
      setPermisosPorRol(permisos);
      setTitulosSecciones(titulos);
      setFlotas(flotasCfg.todas);
      setFlotasInactivas(flotasCfg.inactivas);
      setOrdenCuadrosPersonal(orden);
      setCuadrosOcultos(ocultos);
      setPerfil(d.perfil);
      setPersonal(d.personal);
      setGruposTrabajo(d.grupos.length ? d.grupos : []);
      setEquipos(d.equipos);
      setTiposAceite(d.tiposAceite);
      setSistemasEquipo(d.sistemasEquipo);
      setTrabajos(d.trabajos);
      setAceites(d.aceites);
      setRequerimientos(d.requerimientos);
      setEngrases(d.engrases || []);
      setFrecuenciasEngrase(d.frecuenciasEngrase || {});
      setDatosListos(true);
    } catch (e) {
      setErrorCarga(db.mensajeError(e));
    } finally {
      setCargando(false);
    }
  }
  // -- Tiempo real: lo que registran, editan o eliminan los demás aparece
  //    solo, sin pulsar "Actualizar" ------------------------------------------
  const refPersonal = useRef([]);
  refPersonal.current = personal;
  const refCargarDatos = useRef(null);
  refCargarDatos.current = cargarDatos;
  useEffect(() => {
    if (!datosListos || !sesion) return;
    iniciarPresencia();
    const miId = sesion.user.id;
    const NOMBRE_TABLA = { trabajos: "un trabajo", aceites: "un registro de aceite", requerimientos: "un requerimiento", engrases: "una inspección de engrase" };
    return escucharCambios(
      (tabla, tipo, fila, id, creadoPor) => {
        const setter = { trabajos: setTrabajos, aceites: setAceites, requerimientos: setRequerimientos, engrases: setEngrases }[tabla];
        if (!setter) return;
        if (tipo === "DELETE") {
          setter((prev) => prev.filter((r) => r.id !== id));
          return;
        }
        setter((prev) => (prev.some((r) => r.id === id) ? prev.map((r) => (r.id === id ? fila : r)) : [...prev, fila]));
        if (tipo === "INSERT" && creadoPor && creadoPor !== miId) {
          const quien = refPersonal.current.find((p) => p.id === creadoPor);
          const nombre = quien ? quien.usuario || quien.nombre : "Otro usuario";
          setAviso(`${nombre} registró ${NOMBRE_TABLA[tabla]}${fila && fila.equipo ? ` · equipo ${fila.equipo}` : ""}.`);
        }
      },
      () => refCargarDatos.current && refCargarDatos.current()
    );
  }, [datosListos, sesion && sesion.user && sesion.user.id]);

  useEffect(() => {
    if (sesion) {
      cargarDatos();
    } else {
      setPerfil(null);
      setDatosListos(false);
    }
  }, [sesion && sesion.user && sesion.user.id]);

  // Si una escritura falla, se avisa y se vuelve a leer todo desde la base
  // de datos para que la pantalla muestre lo que realmente quedó guardado.
  function errorYRecargar(e) {
    avisarError(e);
    cargarDatos();
  }

  // -- Ajustes que se guardan automáticamente (solo el Administrador) -------
  const guardarAjustes = datosListos && esAdmin;
  useConfigPersistente(
    "aspecto",
    { colorAcento, nombreApp, logoUrl, temaApp, panelIzquierdoTema, fuenteFamilia, fuenteTamano, coloresMarca, navItems },
    guardarAjustes,
    avisarError
  );
  useConfigPersistente("reporte", configReporte, guardarAjustes, avisarError);
  useConfigPersistente("permisos", permisosPorRol, guardarAjustes, avisarError);
  useConfigPersistente("titulos", titulosSecciones, guardarAjustes, avisarError);
  useConfigPersistente("flotas", { todas: flotas, inactivas: flotasInactivas }, guardarAjustes, avisarError);
  useConfigPersistente("orden_cuadros", ordenCuadrosPersonal, guardarAjustes, avisarError);
  useConfigPersistente("cuadros_ocultos", cuadrosOcultos, guardarAjustes, avisarError);

  // Cuadro de filtros flotante: se abre con el ícono de filtro (arriba a la
  // derecha) y se cierra solo al hacer clic fuera o tras un rato sin uso.
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  // Buscador de Historial (lupa junto al filtro)
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [textoBusqueda, setTextoBusqueda] = useState("");
  const [filtrosActivos, setFiltrosActivos] = useState(false);
  const [resumenFiltros, setResumenFiltros] = useState("");
  const contextoFiltros = useMemo(
    () => ({
      abierto: mostrarFiltros,
      cerrar: () => setMostrarFiltros(false),
      setActivos: setFiltrosActivos,
      setResumen: setResumenFiltros,
    }),
    [mostrarFiltros]
  );

  // "Actualizar" del menú: vuelve a leer todos los datos de la base de datos.
  // Igual que volver a cargar la página: trae la versión más reciente de la
  // app y de los datos.
  function actualizarApp() {
    setMenuPerfilAbierto(false);
    window.location.reload();
  }

  async function cerrarSesion() {
    setConfirmarSalir(false);
    await db.cerrarSesion();
    setPerfil(null);
    setDatosListos(false);
    setTrabajos([]);
    setAceites([]);
    setRequerimientos([]);
    setEngrases([]);
    setPersonal([]);
  }

  function actualizarEtiquetaNav(key, label) {
    setNavItems((prev) => prev.map((n) => (n.key === key ? { ...n, label } : n)));
  }

  // Sincroniza el color de la barra de desplazamiento del navegador con el tema.
  useEffect(() => {
    const raiz = document.documentElement;
    const claro = !modoOscuro;
    const blanco = temaApp === "blanco";
    raiz.style.setProperty("--ts-scroll-track", blanco ? "#f7f5f3" : claro ? "#efece9" : "#262e35");
    raiz.style.setProperty("--ts-scroll-thumb", blanco ? "#e3dfda" : claro ? "#e3dfda" : "#333c44");
  }, [modoOscuro, temaApp]);

  // Vista móvil: las tablas de datos (.ts-tabla-cards) se muestran como
  // tarjetas; cada celda recibe la etiqueta de su columna (data-label).
  useEffect(() => {
    const etiquetar = () => {
      document.querySelectorAll("table.ts-tabla-cards").forEach((tabla) => {
        const encabezados = Array.from(tabla.querySelectorAll("thead th")).map((th) => th.textContent.trim());
        tabla.querySelectorAll("tbody tr").forEach((tr) => {
          Array.from(tr.children).forEach((td, i) => {
            const etiqueta = td.colSpan > 1 ? "" : encabezados[i] || "";
            if (td.getAttribute("data-label") !== etiqueta) td.setAttribute("data-label", etiqueta);
          });
        });
      });
    };
    etiquetar();
    const observador = new MutationObserver(etiquetar);
    observador.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observador.disconnect();
  }, []);

  useEffect(() => {
    setMostrarFiltros(false);
  }, [vista]);

  // Filtro de Inicio y Trabajos: por defecto la fecha y el turno en curso
  const [filtros, setFiltros] = useState({
    fecha: HOY,
    turno: turnoOperativoActual().turno,
    equipo: "todos",
    flota: "todos",
  });

  const permisos = permisosPorRol[rol] || PERMISOS_INICIAL["Técnico"];

  // -- Filtrado compartido -----------------------------------------------
  const trabajosFiltrados = useMemo(() => {
    return trabajos.filter((t) => {
      if (filtros.fecha && t.fecha !== filtros.fecha) return false;
      if (filtros.turno !== "todos" && t.turno !== filtros.turno) return false;
      if (filtros.equipo !== "todos" && t.equipo !== filtros.equipo) return false;
      if (filtros.flota !== "todos" && t.flota !== filtros.flota) return false;
      return true;
    });
  }, [trabajos, filtros]);

  const aceitesFiltrados = useMemo(() => {
    return aceites.filter((a) => {
      if (filtros.fecha && a.fecha !== filtros.fecha) return false;
      if (filtros.turno !== "todos" && a.turno !== filtros.turno) return false;
      if (filtros.equipo !== "todos" && a.equipo !== filtros.equipo) return false;
      if (filtros.flota !== "todos" && a.flota !== filtros.flota) return false;
      return true;
    });
  }, [aceites, filtros]);

  // -- Indicadores ----------------------------------------------------------
  const indicadores = useMemo(() => {
    // Solo equipos activos de flotas activas: un equipo (o flota) inactivado
    // temporalmente no cuenta ni aparece en "Equipos no disponibles".
    const flotasActivas = listaFlotas();
    const equiposVisibles = equipos
      .filter((e) => e.activo)
      .filter((e) => flotasActivas.includes(e.flota))
      .filter((e) => filtros.flota === "todos" || e.flota === filtros.flota)
      .filter((e) => filtros.equipo === "todos" || e.codigo === filtros.equipo);

    // Estado de los equipos "al cierre" del periodo filtrado: se consideran
    // solo los trabajos hasta la fecha elegida y, si se filtra por turno, hasta
    // ese turno (Día = cierre del turno día; Noche = cierre del turno noche,
    // que incluye el día). Sin fecha se usa el estado actual.
    const trabajosHastaCorte = trabajos.filter((t) => {
      if (!filtros.fecha) return true;
      if (t.fecha < filtros.fecha) return true;
      if (t.fecha > filtros.fecha) return false;
      if (filtros.turno === "todos") return true;
      return TURNO_RANGO[t.turno] <= TURNO_RANGO[filtros.turno];
    });

    // Turno más reciente con registros dentro del corte (fecha + turno).
    const claveTurno = (t) => `${t.fecha}-${TURNO_RANGO[t.turno]}`;
    const turnoVigente = trabajosHastaCorte.reduce((max, t) => (claveTurno(t) > max ? claveTurno(t) : max), "");

    let disponibles = 0;
    let noDisponibles = 0;
    const noDisponiblesPorFlota = {};
    // Equipos que siguen "No disponible" desde un turno anterior sin ningún
    // registro en el turno vigente: posible olvido de cambiar el estado.
    const arrastrados = {};
    listaFlotas().forEach((f) => (noDisponiblesPorFlota[f] = []));
    equiposVisibles.forEach((e) => {
      const estado = deriveEstadoEquipo(e.codigo, trabajosHastaCorte);
      if (estado === "disponible") {
        disponibles += 1;
      } else {
        noDisponibles += 1;
        if (!noDisponiblesPorFlota[e.flota]) noDisponiblesPorFlota[e.flota] = [];
        noDisponiblesPorFlota[e.flota].push(e.codigo);
        const ultimo = ultimoTrabajoDeEquipo(e.codigo, trabajosHastaCorte);
        if (ultimo && claveTurno(ultimo) < turnoVigente) arrastrados[e.codigo] = ultimo;
      }
    });

    const litrosHoy = aceitesFiltrados
      .filter((a) => a.fecha === HOY)
      .reduce((sum, a) => sum + Number(a.cantidad_litros || 0), 0);

    const mesActual = mesDe(HOY);
    const litrosMes = aceites
      .filter((a) => mesDe(a.fecha) === mesActual)
      .filter((a) => filtros.flota === "todos" || a.flota === filtros.flota)
      .filter((a) => filtros.equipo === "todos" || a.equipo === filtros.equipo)
      .reduce((sum, a) => sum + Number(a.cantidad_litros || 0), 0);

    return { disponibles, noDisponibles, noDisponiblesPorFlota, arrastrados, litrosHoy, litrosMes };
  }, [trabajos, aceites, aceitesFiltrados, filtros, equipos, flotas, flotasInactivas]);

  // -- Acciones: cada cambio se guarda en Supabase -------------------------
  async function agregarTrabajo(nuevo) {
    try {
      const fila = await db.insertar("trabajos", { ...nuevo, creado_en: marcaDeTiempo() });
      setTrabajos((prev) => (prev.some((r) => r.id === fila.id) ? prev.map((r) => (r.id === fila.id ? fila : r)) : [...prev, fila]));
    } catch (e) {
      avisarError(e);
    }
  }

  // Marca de color (rojo / amarillo / verde) de un trabajo.
  function marcarTrabajo(id, marca) {
    setTrabajos((prev) => prev.map((t) => (t.id === id ? { ...t, marca: marca || null } : t)));
    db.actualizar("trabajos", id, { marca: marca || null }).catch(errorYRecargar);
  }

  function actualizarTrabajo(id, datos) {
    const cambios = { ...datos, editado_en: marcaDeTiempo() };
    setTrabajos((prev) => prev.map((t) => (t.id === id ? { ...t, ...cambios, id } : t)));
    db.actualizar("trabajos", id, cambios).catch(errorYRecargar);
  }

  function eliminarTrabajo(id) {
    setTrabajos((prev) => prev.filter((t) => t.id !== id));
    db.eliminar("trabajos", id).catch(errorYRecargar);
  }

  async function agregarAceite(nuevo) {
    try {
      const fila = await db.insertar("aceites", { ...nuevo, creado_en: marcaDeTiempo() });
      setAceites((prev) => (prev.some((r) => r.id === fila.id) ? prev.map((r) => (r.id === fila.id ? fila : r)) : [...prev, fila]));
    } catch (e) {
      avisarError(e);
    }
  }

  function actualizarAceite(id, datos) {
    const cambios = { ...datos, editado_en: marcaDeTiempo() };
    setAceites((prev) => prev.map((a) => (a.id === id ? { ...a, ...cambios, id } : a)));
    db.actualizar("aceites", id, cambios).catch(errorYRecargar);
  }

  function eliminarAceite(id) {
    setAceites((prev) => prev.filter((a) => a.id !== id));
    db.eliminar("aceites", id).catch(errorYRecargar);
  }

  async function agregarRequerimiento(nuevo) {
    try {
      const ahora = marcaDeTiempo();
      const fila = await db.insertar("requerimientos", {
        ...nuevo,
        estado: "pendiente_aprobacion",
        creado_en: ahora,
        seguimiento: [{ estado: "pendiente_aprobacion", fecha: ahora, usuario: datosUsuario.usuario, nombre: datosUsuario.nombre }],
      });
      setRequerimientos((prev) => (prev.some((r) => r.id === fila.id) ? prev.map((r) => (r.id === fila.id ? fila : r)) : [...prev, fila]));
    } catch (e) {
      avisarError(e);
    }
  }

  function actualizarRequerimiento(id, datos) {
    const cambios = { ...datos, editado_en: marcaDeTiempo() };
    setRequerimientos((prev) => prev.map((r) => (r.id === id ? { ...r, ...cambios, id } : r)));
    db.actualizar("requerimientos", id, cambios).catch(errorYRecargar);
  }

  function eliminarRequerimiento(id) {
    setRequerimientos((prev) => prev.filter((r) => r.id !== id));
    db.eliminar("requerimientos", id).catch(errorYRecargar);
  }

  // Cada cambio de estado queda en la secuencia del requerimiento (fecha,
  // usuario y datos: detalle de compra, motivo de rechazo o cancelación).
  function cambiarEstadoRequerimiento(id, nuevoEstado, datos = {}) {
    const actual = requerimientos.find((r) => r.id === id);
    if (!actual) return;
    const previo = pasoPrevioCancelacion(actual);
    const paso =
      previo && previo.estado === nuevoEstado
        ? // Cancelado por error: vuelve el paso anterior con sus datos y queda
          // anotado quién lo restableció y cuándo.
          { ...previo, restablecido_en: marcaDeTiempo(), restablecido_por: datosUsuario.usuario }
        : { estado: nuevoEstado, fecha: marcaDeTiempo(), usuario: datosUsuario.usuario, nombre: datosUsuario.nombre, ...datos };
    const nuevo = { ...actual, estado: nuevoEstado, seguimiento: [...seguimientoDe(actual), paso], editado_en: marcaDeTiempo() };
    setRequerimientos((prev) => prev.map((r) => (r.id === id ? nuevo : r)));
    // Se envía el registro completo para no perder los datos adicionales.
    db.actualizar("requerimientos", id, nuevo).catch(errorYRecargar);
  }

  // Engrase: inspecciones del sistema de lubricación.
  async function agregarEngrase(nuevo) {
    try {
      const fila = await db.insertar("engrases", { ...nuevo, creado_en: marcaDeTiempo() });
      setEngrases((prev) => (prev.some((r) => r.id === fila.id) ? prev.map((r) => (r.id === fila.id ? fila : r)) : [...prev, fila]));
      return true;
    } catch (e) {
      avisarError(e);
      return false;
    }
  }
  // Se envía el registro completo para no perder los datos adicionales.
  function actualizarEngrase(registro) {
    const nuevo = { ...registro, editado_en: marcaDeTiempo() };
    setEngrases((prev) => prev.map((r) => (r.id === registro.id ? nuevo : r)));
    db.actualizar("engrases", registro.id, nuevo).catch(errorYRecargar);
  }
  function eliminarEngrase(id) {
    setEngrases((prev) => prev.filter((r) => r.id !== id));
    db.eliminar("engrases", id).catch(errorYRecargar);
  }
  function guardarFrecuenciaEngrase(equipo, dias) {
    setFrecuenciasEngrase((prev) => {
      const n = { ...prev };
      if (dias) n[equipo] = dias;
      else delete n[equipo];
      return n;
    });
    db.guardarFrecuenciaEngrase(equipo, dias || null, datosUsuario.usuario).catch(errorYRecargar);
  }

  // Catálogos (tipos de aceite y sistemas de equipo)
  function accionesCatalogo(tabla, setLista) {
    return {
      agregar: async (nombre) => {
        try {
          const fila = await db.insertar(tabla, { nombre, activo: true });
          setLista((prev) => [...prev, fila]);
        } catch (e) {
          avisarError(e);
        }
      },
      actualizar: (id, nombre) => {
        setLista((prev) => prev.map((t) => (t.id === id ? { ...t, nombre } : t)));
        db.actualizar(tabla, id, { nombre }).catch(errorYRecargar);
      },
      eliminar: (id) => {
        setLista((prev) => prev.filter((t) => t.id !== id));
        db.eliminar(tabla, id).catch(errorYRecargar);
      },
      alternar: (id) => {
        let nuevo = true;
        setLista((prev) =>
          prev.map((t) => {
            if (t.id !== id) return t;
            nuevo = !t.activo;
            return { ...t, activo: nuevo };
          })
        );
        const actual = (tabla === "tipos_aceite" ? tiposAceite : sistemasEquipo).find((t) => t.id === id);
        db.actualizar(tabla, id, { activo: actual ? !actual.activo : nuevo }).catch(errorYRecargar);
      },
    };
  }
  const catTipos = accionesCatalogo("tipos_aceite", setTiposAceite);
  const catSistemas = accionesCatalogo("sistemas_equipo", setSistemasEquipo);
  const agregarTipoAceite = catTipos.agregar;
  const actualizarTipoAceite = catTipos.actualizar;
  const eliminarTipoAceite = catTipos.eliminar;
  const toggleTipoAceite = catTipos.alternar;
  const agregarSistemaEquipo = catSistemas.agregar;
  const actualizarSistemaEquipo = catSistemas.actualizar;
  const eliminarSistemaEquipo = catSistemas.eliminar;
  const toggleSistemaEquipo = catSistemas.alternar;

  // Grupos de trabajo
  async function agregarGrupoTrabajo(nombre, alcance = "separado") {
    const limpio = nombre.trim();
    if (!limpio) return;
    const nuevoId = Math.max(0, ...gruposTrabajo.map((g) => g.id)) + 1;
    const grupo = { id: nuevoId, nombre: limpio, alcance };
    setGruposTrabajo((prev) => [...prev, grupo]);
    db.insertar("grupos_trabajo", grupo).catch(errorYRecargar);
  }

  function eliminarGrupoTrabajo(id) {
    setGruposTrabajo((prev) => prev.filter((g) => g.id !== id));
    db.eliminar("grupos_trabajo", id).catch(errorYRecargar);
  }

  // Elimina un cuadro de personal de Configuración (solo si está vacío).
  function eliminarCuadroPersonal(clave) {
    const { categoria, flota_grupo } = datosDeClaveGrupo(clave);
    if (typeof categoria === "number") {
      const g = gruposTrabajo.find((x) => x.id === categoria);
      if (!g) return;
      if ((g.alcance || "separado") === "separado") {
        const resto = listaFlotas().filter((f) => f !== flota_grupo && !cuadrosOcultos.includes(`g:${g.id}:${f}`));
        if (resto.length === 0) eliminarGrupoTrabajo(g.id);
        else if (resto.length === 1) {
          setGruposTrabajo((prev) => prev.map((x) => (x.id === g.id ? { ...x, alcance: resto[0] } : x)));
          db.actualizar("grupos_trabajo", g.id, { alcance: resto[0] }).catch(errorYRecargar);
        } else setCuadrosOcultos((prev) => [...prev, clave]);
        return;
      }
      eliminarGrupoTrabajo(g.id);
      return;
    }
    setCuadrosOcultos((prev) => [...prev, clave]);
  }

  function renombrarGrupoTrabajo(id, nombre) {
    const limpio = nombre.trim();
    if (!limpio) return;
    setGruposTrabajo((prev) => prev.map((g) => (g.id === id ? { ...g, nombre: limpio } : g)));
    db.actualizar("grupos_trabajo", id, { nombre: limpio }).catch(errorYRecargar);
  }

  // Personal: cada persona es un usuario real de Supabase Auth.
  async function agregarPersona(datos) {
    try {
      await db.crearUsuario(datos);
      setPersonal(await db.cargarPersonal());
    } catch (e) {
      avisarError(e);
    }
  }

  async function actualizarPersona(id, datos) {
    const { contrasena, ...resto } = datos;
    try {
      const actual = personal.find((p) => p.id === id) || {};
      await db.actualizarUsuario(id, { ...actual, ...datos });
      setPersonal((prev) => prev.map((p) => (p.id === id ? { ...p, ...resto, id } : p)));
      if (contrasena) setAviso("Contraseña actualizada.");
    } catch (e) {
      errorYRecargar(e);
    }
  }

  async function eliminarPersona(id) {
    try {
      await db.eliminarUsuario(id);
      setPersonal((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      avisarError(e);
    }
  }

  async function toggleActivoPersona(id) {
    const p = personal.find((x) => x.id === id);
    if (!p) return;
    try {
      await db.cambiarActivoUsuario(id, !p.activo);
      setPersonal((prev) => prev.map((x) => (x.id === id ? { ...x, activo: !p.activo } : x)));
    } catch (e) {
      avisarError(e);
    }
  }

  // Equipos
  async function agregarEquipo(datos) {
    try {
      const fila = await db.insertar("equipos", { ...datos, activo: true });
      setEquipos((prev) => [...prev, fila]);
    } catch (e) {
      avisarError(e);
    }
  }

  function actualizarEquipo(id, datos) {
    setEquipos((prev) => prev.map((e) => (e.id === id ? { ...e, ...datos, id } : e)));
    db.actualizar("equipos", id, datos).catch(errorYRecargar);
  }

  function eliminarEquipo(id) {
    setEquipos((prev) => prev.filter((e) => e.id !== id));
    db.eliminar("equipos", id).catch(errorYRecargar);
  }

  function toggleActivoEquipo(id) {
    const e = equipos.find((x) => x.id === id);
    if (!e) return;
    setEquipos((prev) => prev.map((x) => (x.id === id ? { ...x, activo: !e.activo } : x)));
    db.actualizar("equipos", id, { activo: !e.activo }).catch(errorYRecargar);
  }


  const navVisible = navItems.filter((item) => permisos.nav.includes(item.key));
  // Equipos en orden numérico (101, 102… 202… P-039), como en Configuración.
  // Al agregar o cambiar equipos se actualizan solos todos los selectores.
  const equiposOrden = useMemo(() => [...equipos].sort((a, b) => compararCodigosEquipo(a.codigo, b.codigo)), [equipos]);
  // Celular: si las opciones no entran, la barra inferior se desliza y la
  // opción activa se acomoda a la vista.
  const refNavInferior = useRef(null);
  useEffect(() => {
    const nav = refNavInferior.current;
    const activo = nav && nav.querySelector('[data-activo="si"]');
    if (!activo || nav.scrollWidth <= nav.clientWidth) return;
    const destino = activo.offsetLeft - (nav.clientWidth - activo.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, destino), behavior: "smooth" });
  });

  // Si el rol cambia y la vista actual ya no está permitida, saltar a una válida
  const vistaActiva = permisos.nav.includes(vista) ? vista : permisos.nav[0];

  // La dirección del navegador (/inicio, /trabajos, ...) sigue a la pestaña.
  useEffect(() => {
    if (!sesionActiva || !datosListos) return;
    const ruta = RUTAS[vistaActiva];
    if (ruta && ubicacion.pathname !== ruta) navegar(ruta, { replace: true });
  }, [vistaActiva, sesionActiva, datosListos]);

  // Celular / navegador: la flecha "Atrás" lleva a la vista de Inicio (la
  // primera pestaña permitida del rol) en vez de salir de la aplicación. Se
  // agrega una entrada "guardia" al historial; al pulsar Atrás desde otra
  // pestaña se vuelve a Inicio y se repone la guardia. Desde Inicio, Atrás
  // sale normalmente.
  const refVolver = React.useRef({ vistaActiva, vistaInicio: permisos.nav[0] });
  refVolver.current = { vistaActiva, vistaInicio: permisos.nav[0] };
  useEffect(() => {
    try {
      window.history.pushState({ tsGuardia: true }, "");
    } catch (e) {}
    function alVolver() {
      // La vista previa de impresión maneja su propio "Atrás".
      if (estadoVistaImpresion.ignorarPop) {
        estadoVistaImpresion.ignorarPop = false;
        return;
      }
      if (estadoVistaImpresion.abierta) return;
      const { vistaActiva: actual, vistaInicio } = refVolver.current;
      if (actual !== vistaInicio) {
        setVista(vistaInicio);
        window.scrollTo(0, 0);
        try {
          window.history.pushState({ tsGuardia: true }, "");
        } catch (e) {}
      } else {
        try {
          window.history.back();
        } catch (e) {}
      }
    }
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);

  // Celular: al deslizar hacia abajo se ocultan la barra superior y la
  // barra de navegación inferior (como Gmail); al deslizar hacia arriba o
  // llegar al inicio vuelven a aparecer.
  const [barrasOcultas, setBarrasOcultas] = useState(false);

  // Panel lateral (computadora): expandido, contraído (solo íconos) o
  // contraído que se expande al pasar el cursor. Se recuerda en este
  // navegador.
  const [modoLateral, setModoLateral] = useState(() => {
    try {
      const v = window.localStorage.getItem("ts-modo-lateral-2");
      return ["expandido", "contraido", "hover"].includes(v) ? v : "hover";
    } catch (e) {
      return "hover";
    }
  });
  const [menuLateralAbierto, setMenuLateralAbierto] = useState(false);
  const refMenuLateral = useRef(null);
  function elegirModoLateral(v) {
    setModoLateral(v);
    setMenuLateralAbierto(false);
    try {
      window.localStorage.setItem("ts-modo-lateral-2", v);
    } catch (e) {}
  }
  useEffect(() => {
    if (!menuLateralAbierto) return;
    function fuera(e) {
      if (refMenuLateral.current && !refMenuLateral.current.contains(e.target)) setMenuLateralAbierto(false);
    }
    function tecla(e) {
      if (e.key === "Escape") setMenuLateralAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [menuLateralAbierto]);
  // Celular: al deslizar, las barras superior e inferior se vuelven
  // semitransparentes ("desplazado"); al deslizar hacia abajo la barra
  // inferior además se oculta y vuelve a aparecer al deslizar hacia arriba.
  const [desplazado, setDesplazado] = useState(false);
  useEffect(() => {
    let ultimaY = window.scrollY;
    function alDesplazar() {
      const y = window.scrollY;
      setDesplazado(y >= 40);
      if (y < 40) setBarrasOcultas(false);
      else if (y > ultimaY + 6) setBarrasOcultas(true);
      else if (y < ultimaY - 6) setBarrasOcultas(false);
      ultimaY = y;
    }
    window.addEventListener("scroll", alDesplazar, { passive: true });
    return () => window.removeEventListener("scroll", alDesplazar);
  }, []);
  useEffect(() => {
    setBarrasOcultas(false);
    setDesplazado(window.scrollY >= 40);
  }, [vista]);
  // Barra de estado del sistema (la de la hora): mismo color del panel
  // izquierdo y, al deslizar, el mismo tono semitransparente que la barra
  // superior de la app.
  useEffect(() => {
    const opcion = OPCIONES_PANEL_IZQUIERDO.find((o) => o.clave === panelIzquierdoTema) || OPCIONES_PANEL_IZQUIERDO[0];
    const fondoPagina = temaApp === "oscuro" ? "#14181c" : temaApp === "claro" ? "#f7f5f3" : "#ffffff";
    const color = desplazado ? mezclarColores(opcion.bg, fondoPagina, 0.55) : opcion.bg;
    ["theme-color", "msapplication-navbutton-color"].forEach((nombre) => {
      const meta = document.querySelector(`meta[name="${nombre}"]`);
      if (meta) meta.setAttribute("content", color);
    });
  }, [desplazado, panelIzquierdoTema, temaApp]);
  // Al cambiar de pestaña se cierra la búsqueda
  useEffect(() => {
    setBuscadorAbierto(false);
    setTextoBusqueda("");
  }, [vista]);

  return (
    <div
      className={
        "ts-root" +
        (barrasOcultas ? " ts-barras-ocultas" : "") +
        (desplazado ? " ts-desplazado" : "") +
        (modoLateral !== "expandido" ? " ts-lateral-contraido" : "") +
        (modoLateral === "hover" ? " ts-lateral-hover" : "") +
        (menuLateralAbierto ? " ts-lateral-menu-abierto" : "")
      }
      style={{
        "--amber": colorAcento,
        "--amber-dim": colorAcento + "26",
        ...(TEMAS_APP[temaApp] || {}),
        colorScheme: modoOscuro ? "dark" : "light",
        "--app-font-family": fuenteFamilia,
        "--app-font-size": fuenteTamano,
        "--ts-escala-fuente": String((parseFloat(fuenteTamano) || 14) / 14),
        "--marca-rojo": coloresMarca.rojo,
        "--marca-amarillo": coloresMarca.amarillo,
        "--marca-verde": coloresMarca.verde,
        ...(() => {
          const t = OPCIONES_PANEL_IZQUIERDO.find((o) => o.clave === panelIzquierdoTema) || OPCIONES_PANEL_IZQUIERDO[0];
          return {
            "--sidebar-bg": t.bg,
            "--sidebar-text": t.texto,
            "--sidebar-text-dim": t.textoDim,
            "--sidebar-border": t.borde,
            "--sidebar-hover": t.hover,
          };
        })(),
      }}
    >
      <Estilos />
      {verificandoSesion ? (
        <PantallaCargando nombreApp={nombreApp} logoUrl={logoUrl} texto="Cargando…" />
      ) : !sesionActiva ? (
        <PantallaSesionCerrada nombreApp={nombreApp} logoUrl={logoUrl} />
      ) : !datosListos ? (
        <PantallaCargando
          nombreApp={nombreApp}
          logoUrl={logoUrl}
          texto={cargando ? "Cargando datos…" : ""}
          error={errorCarga}
          onReintentar={cargarDatos}
          onSalir={cerrarSesion}
        />
      ) : (
        <>
      <aside className="ts-sidebar">
        <div className="ts-brand">
          {logoUrl ? (
            <img src={logoUrl} alt={nombreApp} className="ts-brand-logo" />
          ) : (
            <span className="ts-brand-mark">{inicialesDe(nombreApp)}</span>
          )}
          <span className="ts-brand-name">{nombreApp}</span>
        </div>
        <nav className="ts-nav">
          {navVisible.map((item) => (
            <button
              key={item.key}
              className={"ts-nav-item" + (vistaActiva === item.key ? " ts-nav-item-activo" : "")}
              onClick={() => setVista(item.key)}
              title={modoLateral === "contraido" ? item.label : undefined}
            >
              <span className="ts-nav-icono">
                <IconoLateral clave={item.key} />
              </span>
              <span className="ts-nav-texto">{item.label}</span>
            </button>
          ))}
        </nav>
        {/* Control del panel lateral */}
        <div className="ts-lateral-pie" ref={refMenuLateral}>
          {menuLateralAbierto && (
            <div className="ts-lateral-menu" role="menu">
              <div className="ts-lateral-menu-titulo">Control del panel lateral</div>
              {MODOS_PANEL_LATERAL.map(([v, n]) => (
                <button
                  key={v}
                  type="button"
                  role="menuitemradio"
                  aria-checked={modoLateral === v}
                  className={"ts-lateral-menu-op" + (modoLateral === v ? " ts-lateral-menu-op-activa" : "")}
                  onClick={() => elegirModoLateral(v)}
                >
                  <span className="ts-lateral-menu-punto" />
                  {n}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="ts-lateral-boton"
            title="Control del panel lateral"
            aria-label="Control del panel lateral"
            aria-expanded={menuLateralAbierto}
            onClick={() => setMenuLateralAbierto((v) => !v)}
          >
            <IconoLateral clave="panel" />
          </button>
        </div>
      </aside>

      <div className="ts-main">
        <header className="ts-topbar">
          <div>
            <div className="ts-topbar-title">
              {navItems.find((n) => n.key === vistaActiva)?.label}
            </div>
          </div>
          <div className="ts-topbar-acciones">
            {!["config", "dashboard"].includes(vistaActiva) && (
              <button
                type="button"
                data-filtro-toggle="true"
                className={"ts-filtros-resumen" + (filtrosActivos ? " ts-filtros-resumen-activo" : "")}
                title={`Filtro aplicado: ${resumenFiltros || "sin filtros"}`}
                onClick={() => setMostrarFiltros((v) => !v)}
              >
                {resumenFiltros || "Sin filtros · todos los registros"}
              </button>
            )}
            {!["config", "dashboard"].includes(vistaActiva) && (
              <button
                data-filtro-toggle="true"
                className={"ts-btn-tres-puntos ts-btn-filtro" + (mostrarFiltros ? " ts-btn-filtro-activo" : "")}
                title={mostrarFiltros ? "Ocultar filtros" : filtrosActivos ? "Filtros aplicados — mostrar" : "Mostrar filtros"}
                onClick={() => setMostrarFiltros((v) => !v)}
              >
                <IconoFiltro />
                {filtrosActivos && !mostrarFiltros && <span className="ts-filtro-punto" />}
              </button>
            )}
            {VISTAS_CON_BUSQUEDA.includes(vistaActiva) && (
              <button
                className={"ts-btn-tres-puntos ts-btn-filtro ts-btn-lupa" + (buscadorAbierto ? " ts-btn-filtro-activo" : "")}
                title={buscadorAbierto ? "Cerrar búsqueda" : "Buscar"}
                onClick={() => {
                  if (buscadorAbierto) setTextoBusqueda("");
                  setBuscadorAbierto((v) => !v);
                }}
              >
                <IconoLupa />
              </button>
            )}
            <div className="ts-export-dropdown">
              <button
                className="ts-btn-tres-puntos"
                title="Más opciones"
                onClick={() => setMenuPerfilAbierto((v) => !v)}
              >
                <IconoTresPuntos />
              </button>
              {menuPerfilAbierto && (
                <>
                  <div className="ts-overlay-cerrar" onClick={() => setMenuPerfilAbierto(false)} />
                  <div className="ts-export-menu ts-menu-arriba-topbar ts-menu-perfil">
                    <div className="ts-menu-perfil-cabecera">
                      <span className="ts-menu-avatar">{inicialesDe(datosUsuario.nombre)}</span>
                      <div>
                        <div className="ts-menu-perfil-nombre">{datosUsuario.nombre}</div>
                        <div className="ts-menu-perfil-usuario">{datosUsuario.usuario}</div>
                        <span className="ts-menu-perfil-rol">{rol}</span>
                      </div>
                    </div>
                    <div className="ts-menu-separador" />
                    <button
                      onClick={() => {
                        setMenuPerfilAbierto(false);
                        setCambiandoContrasena(true);
                      }}
                    >
                      <IconoMenuIngresar />
                      Cambiar contraseña
                    </button>
                    <button onClick={actualizarApp}>
                      <IconoMenuActualizar />
                      Actualizar
                    </button>
                    <div className="ts-menu-separador" />
                    <button
                      className="ts-menu-salir"
                      onClick={() => {
                        setMenuPerfilAbierto(false);
                        setConfirmarSalir(true);
                      }}
                    >
                      <IconoMenuSalir />
                      Salir
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <FiltrosContext.Provider value={contextoFiltros}>
        <main className="ts-content ts-content-con-nav-inferior">
          {vistaActiva === "dashboard" && (
            <Dashboard
              indicadores={indicadores}
              filtros={filtros}
              setFiltros={setFiltros}
              trabajosFiltrados={trabajosFiltrados}
              trabajos={trabajos}
              aceitesTodos={aceites}
              equipos={equiposOrden}
              aceites={aceitesFiltrados}
              tiposAceite={tiposAceite.filter((t) => t.activo).map((t) => t.nombre)}
              mostrarFiltros={mostrarFiltros}
              puedeEditarTrabajos={permisos.crearTrabajo && permisos.nav.includes("trabajos")}
              engrase={permisos.nav.includes("engrase") ? { registros: engrases, frecuencias: frecuenciasEngrase } : null}
              onEditarEquipo={(codigo) => {
                const registro = ultimoTrabajoDeEquipo(codigo, trabajos);
                if (!registro) return;
                setTrabajoAEditar(registro);
                setVista("trabajos");
              }}
            />
          )}

          <ZonaBusqueda
            key={vistaActiva}
            abierto={buscadorAbierto && VISTAS_CON_BUSQUEDA.includes(vistaActiva)}
            texto={VISTAS_CON_BUSQUEDA.includes(vistaActiva) ? textoBusqueda : ""}
            onTexto={setTextoBusqueda}
            onCerrar={() => {
              setTextoBusqueda("");
              setBuscadorAbierto(false);
            }}
            colorAcento={colorAcento}
            placeholder={PLACEHOLDER_BUSQUEDA[vistaActiva]}
          >
          {vistaActiva === "trabajos" && (
            <Trabajos
              trabajos={trabajosFiltrados}
              onMarcar={marcarTrabajo}
              puedeCrear={permisos.crearTrabajo}
              onCrear={agregarTrabajo}
              onActualizar={actualizarTrabajo}
              onEliminar={eliminarTrabajo}
              filtros={filtros}
              setFiltros={setFiltros}
              personal={personal}
              equipos={equiposOrden}
              mostrarFiltros={mostrarFiltros}
              trabajoAEditar={trabajoAEditar}
              onEdicionExternaAbierta={() => setTrabajoAEditar(null)}
              impresoPor={datosUsuario.usuario}
            />
          )}

          {vistaActiva === "aceites" && (
            <Aceites
              registros={aceites}
              puedeCrear={permisos.crearAceite || permisos.registrarDerrame}
              puedeAdicion={!!permisos.crearAceite}
              puedeDerrame={!!permisos.registrarDerrame}
              onCrear={agregarAceite}
              onActualizar={actualizarAceite}
              onEliminar={eliminarAceite}
              tiposAceite={tiposAceite.filter((t) => t.activo).map((t) => t.nombre)}
              sistemasEquipo={sistemasEquipo.filter((s) => s.activo).map((s) => s.nombre)}
              personal={personal}
              equipos={equiposOrden}
              mostrarFiltros={mostrarFiltros}
            />
          )}

          {vistaActiva === "requerimientos" && (
            <Requerimientos
              registros={requerimientos}
              /* Secuencia del requerimiento por rol: lo crean Supervisor y
                 Técnico; lo aprueba solo el Supervisor; "En proceso de
                 compra" y "Comprado" solo el Planificador. */
              puedeCrear={permisos.crearRequerimiento && rol !== "Planificador"}
              puedeAprobar={permisos.aprobarRequerimiento && (rol === "Supervisor" || rol === "Administrador")}
              puedeAvanzarCompra={permisos.avanzarCompra && rol === "Planificador"}
              onCrear={agregarRequerimiento}
              onActualizar={actualizarRequerimiento}
              onEliminar={eliminarRequerimiento}
              onCambiarEstado={cambiarEstadoRequerimiento}
              personal={personal}
              solicitantesAutorizados={personal
                .filter((p) => p.activo && permisosPorRol[rolDePersona(p)]?.crearRequerimiento)
                .map((p) => p.nombre)}
              solicitanteActual={datosUsuario.usuario || datosUsuario.nombre}
              equipos={equiposOrden}
              mostrarFiltros={mostrarFiltros}
              esAdmin={rol === "Administrador"}
              usuarioActual={datosUsuario.usuario}
            />          )}

          {vistaActiva === "historial" && (
            <Historial trabajos={trabajos} aceites={aceites} equipos={equiposOrden} />
          )}

          {vistaActiva === "componentes" && <Componentes esAdmin={rol === "Administrador"} usuario={datosUsuario.usuario} equipos={equiposOrden} />}

          {vistaActiva === "engrase" && (
            <Engrase
              registros={engrases}
              equipos={equiposOrden}
              puedeRegistrar={!!permisos.registrarEngrase}
              onCrear={agregarEngrase}
              onActualizar={actualizarEngrase}
              onEliminar={eliminarEngrase}
              usuario={datosUsuario.usuario}
              frecuencias={frecuenciasEngrase}
              onFrecuencia={guardarFrecuenciaEngrase}
            />
          )}
          </ZonaBusqueda>

          {vistaActiva === "config" && (
            <Configuracion
              tiposAceite={tiposAceite}
              sistemasEquipo={sistemasEquipo}
              onAgregarTipoAceite={agregarTipoAceite}
              onActualizarTipoAceite={actualizarTipoAceite}
              onEliminarTipoAceite={eliminarTipoAceite}
              onToggleTipoAceite={toggleTipoAceite}
              onAgregarSistemaEquipo={agregarSistemaEquipo}
              onActualizarSistemaEquipo={actualizarSistemaEquipo}
              onEliminarSistemaEquipo={eliminarSistemaEquipo}
              onToggleSistemaEquipo={toggleSistemaEquipo}
              gruposTrabajo={gruposTrabajo}
              onAgregarGrupoTrabajo={agregarGrupoTrabajo}
              onRenombrarGrupoTrabajo={renombrarGrupoTrabajo}
              onEliminarCuadroPersonal={eliminarCuadroPersonal}
              cuadrosOcultos={cuadrosOcultos}
              titulosSecciones={titulosSecciones}
              configReporte={configReporte}
              onCambiarConfigReporte={setConfigReporte}
              trabajosParaReporte={trabajos}
              usuarioReporte={datosUsuario.usuario}
              onRenombrarSeccion={renombrarSeccion}
              ordenCuadrosPersonal={ordenCuadrosPersonal}
              onCambiarOrdenCuadrosPersonal={setOrdenCuadrosPersonal}
              personal={personal}
              onAgregarPersona={agregarPersona}
              onActualizarPersona={actualizarPersona}
              onEliminarPersona={eliminarPersona}
              onToggleActivoPersona={toggleActivoPersona}
              colorAcento={colorAcento}
              onCambiarColorAcento={setColorAcento}
              nombreApp={nombreApp}
              onCambiarNombreApp={setNombreApp}
              logoUrl={logoUrl}
              onCambiarLogoUrl={setLogoUrl}
              temaApp={temaApp}
              onCambiarTemaApp={setTemaApp}
              panelIzquierdoTema={panelIzquierdoTema}
              onCambiarPanelIzquierdoTema={setPanelIzquierdoTema}
              fuenteFamilia={fuenteFamilia}
              onCambiarFuenteFamilia={setFuenteFamilia}
              fuenteTamano={fuenteTamano}
              onCambiarFuenteTamano={setFuenteTamano}
              coloresMarca={coloresMarca}
              onCambiarColoresMarca={setColoresMarca}
              navItems={navItems}
              onActualizarEtiquetaNav={actualizarEtiquetaNav}
              permisosPorRol={permisosPorRol}
              onToggleAccesoModulo={toggleAccesoModulo}
              onToggleAccionPermiso={toggleAccionPermiso}
              equipos={equiposOrden}
              onAgregarEquipo={agregarEquipo}
              onActualizarEquipo={actualizarEquipo}
              onEliminarEquipo={eliminarEquipo}
              onToggleActivoEquipo={toggleActivoEquipo}
              flotas={flotas}
              onAgregarFlota={agregarFlota}
              onRenombrarFlota={renombrarFlota}
              flotasInactivas={flotasInactivas}
              onToggleFlota={toggleFlotaActiva}
              onEliminarFlota={eliminarFlota}
            />
          )}
        </main>
        </FiltrosContext.Provider>
      </div>

      <nav className={"ts-bottom-nav" + (navVisible.length > 5 ? " ts-bottom-nav-desliza" : "")} ref={refNavInferior}>
        {navVisible.map((item) => (
          <button
            key={item.key}
            data-activo={vistaActiva === item.key ? "si" : undefined}
            className={"ts-bottom-nav-item" + (vistaActiva === item.key ? " ts-bottom-nav-item-activo" : "")}
            onClick={() => setVista(item.key)}
          >
            <span className="ts-bottom-nav-icono">
              <IconoLateral clave={item.key} />
            </span>
            <span className="ts-bottom-nav-texto">{item.label}</span>
          </button>
        ))}
      </nav>
        </>
      )}

      {cambiandoContrasena && <CambiarContrasena onCerrar={() => setCambiandoContrasena(false)} />}

      {aviso && (
        <div className="ts-aviso-flotante" role="status" onClick={() => setAviso("")}>
          {aviso}
        </div>
      )}

      {confirmarSalir && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setConfirmarSalir(false)} />
          <div className="ts-modal-confirmacion">
            <h3>¿Cerrar sesión?</h3>
            <p>
              Se cerrará tu sesión actual ({rol}) y volverás a la pantalla de inicio de sesión.
            </p>
            <div className="ts-modal-acciones">
              <button className="ts-btn-ghost" onClick={() => setConfirmarSalir(false)}>
                Cancelar
              </button>
              <button className="ts-btn-confirmar-eliminar" onClick={cerrarSesion}>
                Sí, cerrar sesión
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista: Inicio / Dashboard
// ---------------------------------------------------------------------------

// Formulario de inicio de sesión (usuario + contraseña). Se usa en la
// pantalla de sesión cerrada y en "Iniciar sesión" del menú de tres puntos.
function FormularioInicioSesion({ nombreApp, logoUrl, titulo, texto }) {
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [verContrasena, setVerContrasena] = useState(false);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Inicia sesión en Supabase. El personal escribe su usuario (ej. GuidoC);
  // el administrador principal puede escribir su correo.
  async function ingresar() {
    if (enviando) return;
    setEnviando(true);
    setError("");
    const resultado = await db.iniciarSesion(usuario, contrasena);
    setEnviando(false);
    if (resultado) setError(resultado);
  }

  return (
    <div className="ts-login" onKeyDown={(e) => enviarConEnter(e, ingresar)}>
      {logoUrl ? (
        <img src={logoUrl} alt={nombreApp} className="ts-sesion-cerrada-logo" />
      ) : (
        <span className="ts-brand-mark ts-login-marca">{inicialesDe(nombreApp)}</span>
      )}
      <h2>{titulo}</h2>
      {texto && <p>{texto}</p>}
      <label className="ts-campo">
        <span>Usuario</span>
        <input
          autoFocus
          autoComplete="username"
          value={usuario}
          placeholder="Tu usuario"
          onChange={(e) => {
            setUsuario(e.target.value);
            setError("");
          }}
        />
      </label>
      <label className="ts-campo">
        <span>Contraseña</span>
        <div className="ts-login-clave">
          <input
            type={verContrasena ? "text" : "password"}
            autoComplete="current-password"
            value={contrasena}
            onChange={(e) => {
              setContrasena(e.target.value);
              setError("");
            }}
          />
          <button
            type="button"
            className="ts-login-ver"
            onClick={() => setVerContrasena((v) => !v)}
            title={verContrasena ? "Ocultar contraseña" : "Ver contraseña"}
            aria-label={verContrasena ? "Ocultar contraseña" : "Ver contraseña"}
          >
            {verContrasena ? "Ocultar" : "Ver"}
          </button>
        </div>
      </label>
      {error && <span className="ts-error-texto">{error}</span>}
      <button type="button" className="ts-btn ts-login-btn" onClick={ingresar} disabled={enviando}>
        {enviando ? "Ingresando…" : "Ingresar"}
      </button>
    </div>
  );
}

// Pantalla de espera mientras se verifica la sesión o se cargan los datos.
function PantallaCargando({ nombreApp, logoUrl, texto, error, onReintentar, onSalir }) {
  return (
    <div className="ts-sesion-cerrada">
      <div className="ts-login-caja ts-login-caja-plana">
        <div className="ts-login">
          {logoUrl ? (
            <img src={logoUrl} alt={nombreApp} className="ts-sesion-cerrada-logo" />
          ) : (
            <span className="ts-brand-mark ts-login-marca">{inicialesDe(nombreApp)}</span>
          )}
          <h2>{nombreApp}</h2>
          {error ? (
            <>
              <span className="ts-error-texto">{error}</span>
              <div className="ts-form-acciones">
                {onSalir && (
                  <button type="button" className="ts-btn-ghost" onClick={onSalir}>
                    Salir
                  </button>
                )}
                {onReintentar && (
                  <button type="button" className="ts-btn" onClick={onReintentar}>
                    Reintentar
                  </button>
                )}
              </div>
            </>
          ) : (
            <p>{texto}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PantallaSesionCerrada({ nombreApp, logoUrl }) {
  return (
    <div className="ts-sesion-cerrada">
      <div className="ts-login-caja ts-login-caja-plana">
        <FormularioInicioSesion
          nombreApp={nombreApp}
          logoUrl={logoUrl}
          titulo={nombreApp}
          texto="Inicia sesión para continuar."
        />
      </div>
    </div>
  );
}

function IconoMenuIngresar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  );
}

function IconoMenuActualizar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function IconoMenuSalir() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function IconoFiltro() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4" />
    </svg>
  );
}

function IconoLupa() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.2" y2="16.2" />
    </svg>
  );
}

function IconoTresPuntos() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

// Íconos de la barra de navegación inferior (vista móvil), uno por sección.
// Ícono de Trabajos: grupo de tres personas (equipo de trabajo). La persona
// del frente se separa de las de atrás con una máscara, así el espacio entre
// ellas se ve igual sobre cualquier color de fondo.
function IconoNavTrabajos() {
  const frente = (
    <>
      <circle cx="12" cy="9.6" r="3.4" />
      <path d="M6.2 21.5v-2.6c0-2.8 2.5-4.8 5.8-4.8s5.8 2 5.8 4.8v2.6Z" />
    </>
  );
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <defs>
        <mask id="ts-mascara-trabajos" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <g fill="#000" stroke="#000" strokeWidth="1.8">
            {frente}
          </g>
        </mask>
      </defs>
      <g mask="url(#ts-mascara-trabajos)">
        <circle cx="6.6" cy="6.6" r="3.1" />
        <path d="M1 17.6v-2.2c0-2.6 2.3-4.4 5.6-4.4s5.6 1.8 5.6 4.4v2.2Z" />
        <circle cx="17.4" cy="6.6" r="3.1" />
        <path d="M11.8 17.6v-2.2c0-2.6 2.3-4.4 5.6-4.4s5.6 1.8 5.6 4.4v2.2Z" />
      </g>
      {frente}
    </svg>
  );
}

// Íconos sólidos de la barra de navegación inferior (celular). Cada ícono es
// una lista de trazados rellenos; los huecos (puerta, líneas, agujas del
// reloj, centro del engranaje) se logran con fillRule="evenodd".
const ICONOS_NAV = {
  dashboard: [
    "M12 2.6 2.4 11a1 1 0 0 0 1.3 1.5l.8-.7V20a1.5 1.5 0 0 0 1.5 1.5h3.5v-5.5h5v5.5h3.5a1.5 1.5 0 0 0 1.5-1.5v-8.2l.8.7a1 1 0 0 0 1.3-1.5Z"
  ],
  aceites: [
    "M12 2c-.35 0-.66.16-.86.43C9.55 4.55 5.3 10 5.3 14.3a6.7 6.7 0 0 0 13.4 0c0-4.3-4.25-9.75-5.84-11.87A1.07 1.07 0 0 0 12 2Z M8.4 14.1a.9.9 0 0 1 .9.9 2.8 2.8 0 0 0 2.2 2.6.9.9 0 1 1-.4 1.75A4.6 4.6 0 0 1 7.5 15a.9.9 0 0 1 .9-.9Z"
  ],
  requerimientos: [
    "M7 3.5h1.3v.9A1.6 1.6 0 0 0 9.9 6h4.2a1.6 1.6 0 0 0 1.6-1.6v-.9H17a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z M8.5 10.2h7v1.7h-7Z M8.5 14.3h7V16h-7Z",
    "M10 2h4a.9.9 0 0 1 .9.9v1.3a.8.8 0 0 1-.8.8H9.9a.8.8 0 0 1-.8-.8V2.9A.9.9 0 0 1 10 2Z"
  ],
  historial: [
    "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20Z M11.1 6.5h1.8v5.1l3.3 3.3-1.3 1.3-3.8-3.8Z"
  ],
  config: [
    "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z M12 8.6a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8Z"
  ],
};

// Íconos de línea del panel lateral (computadora), estilo delgado.
const ICONOS_LATERAL = {
  dashboard: ["M3.5 10.5 12 3.5l8.5 7", "M5.5 9v11h4.5v-6h4v6h4.5V9"],
  trabajos: [
    "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11Z",
    "M3 20v-1.2c0-2.7 2.7-4.6 6-4.6s6 1.9 6 4.6V20",
    "M15.5 4.8a3.1 3.1 0 0 1 0 6",
    "M17.5 14.4c2.1.5 3.5 2 3.5 4.1V20",
  ],
  aceites: ["M12 3.2c-2 2.6-6 7.4-6 11a6 6 0 0 0 12 0c0-3.6-4-8.4-6-11Z", "M9.2 15.2a2.9 2.9 0 0 0 2.3 2.6"],
  requerimientos: [
    "M9 4.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 21.5h10a1.8 1.8 0 0 0 1.8-1.8V6.3A1.8 1.8 0 0 0 17 4.5h-2",
    "M9.5 3h5a.8.8 0 0 1 .8.8v1.4a.8.8 0 0 1-.8.8h-5a.8.8 0 0 1-.8-.8V3.8a.8.8 0 0 1 .8-.8Z",
    "M8.8 11h6.4", "M8.8 15h6.4",
  ],
  historial: ["M3.6 12a8.4 8.4 0 1 0 2.5-6", "M3.5 3.8v4.4h4.4", "M12 7.6V12l3 2.2"],
  // Componentes: tres engranajes
  componentes: [
    "M6.83 11.76L6.86 10.31L9.14 10.31L9.17 11.76L10.59 12.44L11.74 11.56L13.16 13.34L12.05 14.27L12.40 15.80L13.80 16.16L13.29 18.37L11.87 18.09L10.89 19.31L11.49 20.63L9.44 21.62L8.79 20.33L7.21 20.33L6.56 21.62L4.51 20.63L5.11 19.31L4.13 18.09L2.71 18.37L2.20 16.16L3.60 15.80L3.95 14.27L2.84 13.34L4.26 11.56L5.41 12.44Z",
    "M9.80 16.00a1.8 1.8 0 1 0 -3.60 0a1.8 1.8 0 1 0 3.60 0Z",
    "M18.36 9.00L18.68 8.01L20.42 8.55L20.13 9.55L20.98 10.46L21.99 10.25L22.40 12.03L21.39 12.27L21.02 13.46L21.72 14.24L20.38 15.48L19.66 14.72L18.44 15.00L18.12 15.99L16.38 15.45L16.67 14.45L15.82 13.54L14.81 13.75L14.40 11.97L15.41 11.73L15.78 10.54L15.08 9.76L16.42 8.52L17.14 9.28Z",
    "M19.60 12.00a1.2 1.2 0 1 0 -2.40 0a1.2 1.2 0 1 0 2.40 0Z",
    "M10.12 2.12L10.30 1.30L11.78 1.60L11.63 2.42L12.41 3.11L13.21 2.86L13.69 4.29L12.90 4.58L12.69 5.60L13.31 6.16L12.31 7.29L11.67 6.75L10.68 7.08L10.50 7.90L9.02 7.60L9.17 6.78L8.39 6.09L7.59 6.34L7.11 4.91L7.90 4.62L8.11 3.60L7.49 3.04L8.49 1.91L9.13 2.45Z",
    "M11.30 4.60a0.9 0.9 0 1 0 -1.80 0a0.9 0.9 0 1 0 1.80 0Z",
  ],
  // Engrase: pistola de grasa
  engrase: [
    "M4.5 9.2h10.3a1.6 1.6 0 0 1 1.6 1.6v2.4a1.6 1.6 0 0 1-1.6 1.6H4.5Z",
    "M3 9.7v4.6",
    "M16.4 12h3.4l1.7-1.7",
    "M9 14.8 7.4 20",
    "M11.4 9.2 9 4.6h2.8",
  ],
  config: [
    "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z",
    "M19.2 14.6a1.4 1.4 0 0 0 .3 1.6l.1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.4 1.4 0 0 0-1.6-.3 1.4 1.4 0 0 0-.9 1.3v.2a1.8 1.8 0 0 1-3.6 0v-.1a1.4 1.4 0 0 0-.9-1.3 1.4 1.4 0 0 0-1.6.3l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.4 1.4 0 0 0 .3-1.6 1.4 1.4 0 0 0-1.3-.9h-.2a1.8 1.8 0 0 1 0-3.6h.1a1.4 1.4 0 0 0 1.3-.9 1.4 1.4 0 0 0-.3-1.6l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.4 1.4 0 0 0 1.6.3h.1a1.4 1.4 0 0 0 .8-1.3v-.2a1.8 1.8 0 0 1 3.6 0v.1a1.4 1.4 0 0 0 .9 1.3 1.4 1.4 0 0 0 1.6-.3l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.4 1.4 0 0 0-.3 1.6v.1a1.4 1.4 0 0 0 1.3.8h.2a1.8 1.8 0 0 1 0 3.6h-.1a1.4 1.4 0 0 0-1.3.9Z",
  ],
  panel: ["M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z", "M9.5 4.5v15"],
};
function IconoLateral({ clave }) {
  const trazados = ICONOS_LATERAL[clave];
  if (!trazados) return null;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={clave === "componentes" ? 1.25 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {trazados.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

// Opciones del control del panel lateral (computadora).
const MODOS_PANEL_LATERAL = [
  ["expandido", "Expandido"],
  ["contraido", "Contraído"],
  ["hover", "Expandir al pasar el cursor"],
];

function IconoNav({ clave }) {
  if (clave === "trabajos") return <IconoNavTrabajos />;
  const trazados = ICONOS_NAV[clave];
  if (!trazados) return null;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      {trazados.map((d, i) => (
        <path key={i} fillRule="evenodd" d={d} />
      ))}
    </svg>
  );
}

function Dashboard({ indicadores, filtros, setFiltros, trabajosFiltrados, trabajos = [], aceitesTodos = [], equipos, aceites, tiposAceite, mostrarFiltros, puedeEditarTrabajos, onEditarEquipo, engrase = null }) {
  return (
    <div className="ts-stack">
      <Panel
        titulo="Equipos no disponibles"
        acciones={
          <FiltroPanel
            activo={hayFiltrosGenerales(filtros)}
            resumen={[fechaCorta(filtros.fecha), TEXTO_TURNO[filtros.turno], filtros.flota !== "todos" && `Flota ${filtros.flota}`]
              .filter(Boolean)
              .join(" · ") || "Sin filtros"}
          >
            <FiltrosBar filtros={filtros} setFiltros={setFiltros} equipos={equipos} mostrarEquipo={false} />
          </FiltroPanel>
        }
      >
        <div className="ts-grid-2">
          {listaFlotas().map((f) => (
            <div key={f}>
              <h4 className="ts-grafico-subtitulo">Flota {f}</h4>
              {indicadores.noDisponiblesPorFlota[f] && indicadores.noDisponiblesPorFlota[f].length > 0 ? (
                <div className="ts-chips-select">
                  {indicadores.noDisponiblesPorFlota[f].map((codigo) => {
                    const arrastre = indicadores.arrastrados && indicadores.arrastrados[codigo];
                    const aviso = arrastre
                      ? `Sin registro en el turno actual. Sigue "No disponible" desde el ${arrastre.fecha.split("-").reverse().join("/")} turno ${
                          arrastre.turno === "dia" ? "Día" : "Noche"
                        }. Verifica si quedó marcado por error y corrige el estado.`
                      : "";
                    const triangulo = arrastre ? (
                      <span className="ts-badge-aviso" aria-label="Posible olvido de cambio de estado">
                        <IconoAvisoTriangulo />
                      </span>
                    ) : null;
                    return puedeEditarTrabajos ? (
                      <button
                        key={codigo}
                        type="button"
                        className={"ts-badge ts-badge-alerta ts-badge-boton" + (arrastre ? " ts-badge-con-aviso" : "")}
                        title={(aviso ? aviso + "\n\n" : "") + `Editar el último registro de trabajo del equipo ${codigo}`}
                        onClick={() => onEditarEquipo(codigo)}
                      >
                        {codigo}
                        {triangulo}
                      </button>
                    ) : (
                      <span
                        key={codigo}
                        className={"ts-badge ts-badge-alerta" + (arrastre ? " ts-badge-con-aviso" : "")}
                        title={aviso || undefined}
                      >
                        {codigo}
                        {triangulo}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="ts-vacio">Todos los equipos de esta flota están disponibles.</div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <ResumenMensualAceites aceites={aceitesTodos} tiposCatalogo={tiposAceite} />

      {engrase && <ResumenEngrase registros={engrase.registros} equipos={equipos} frecuencias={engrase.frecuencias} />}

      <TopAdicionesMotor aceites={aceitesTodos} />

      <TopAdicionesRefrigerante aceites={aceitesTodos} />

      <TopNoProgramados trabajos={trabajos} />

      <IndicadoresMantenimiento trabajos={trabajos} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking: 10 equipos con más trabajos no programados, uno por flota activa
// (Acarreo, Carguío y las que se agreguen). Periodo: últimos 14 días hasta la
// fecha del filtro (o hoy). Respeta los filtros de Turno y Flota.
// ---------------------------------------------------------------------------
const DIAS_RANKING = 14;

// Ranking genérico por flota: cuenta registros por equipo dentro de los
// últimos DIAS_RANKING días hasta la fecha del filtro, respetando los filtros
// de Turno y Flota. Muestra hasta 10 equipos por flota activa.
// ---------------------------------------------------------------------------
// Inicio: cada cuadro tiene su propio filtro (pastilla con el resumen + icono)
// ---------------------------------------------------------------------------
const PERIODOS_INICIO = [
  ["7", "Últimos 7 días"],
  ["14", "Últimos 14 días"],
  ["30", "Últimos 30 días"],
];
function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Rango de fechas del periodo (hasta hoy) y el rango anterior equivalente,
// para comparar. "Último mes" = mes calendario en curso.
function rangoPeriodo(periodo) {
  const hasta = turnoOperativoActual().fecha;
  const h = new Date(hasta + "T00:00:00");
  if (periodo === "mes") {
    const desde = fechaISO(new Date(h.getFullYear(), h.getMonth(), 1));
    const antDesde = fechaISO(new Date(h.getFullYear(), h.getMonth() - 1, 1));
    const antHasta = fechaISO(new Date(h.getFullYear(), h.getMonth(), 0));
    return { desde, hasta, antDesde, antHasta, etiqueta: NOMBRES_MES[h.getMonth()].toUpperCase() };
  }
  const dias = Number(periodo);
  const d = new Date(h);
  d.setDate(d.getDate() - (dias - 1));
  const a2 = new Date(d);
  a2.setDate(a2.getDate() - 1);
  const a1 = new Date(a2);
  a1.setDate(a1.getDate() - (dias - 1));
  return { desde: fechaISO(d), hasta, antDesde: fechaISO(a1), antHasta: fechaISO(a2), etiqueta: `Últimos ${dias} días` };
}

// Pastilla con el filtro aplicado + icono de filtro; abre un cuadro de
// filtros propio del panel (mismo estilo que el cuadro de Filtros general).
function FiltroPanel({ resumen, activo, children }) {
  const [abierto, setAbierto] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    if (!abierto) return;
    function fuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    }
    function tecla(e) {
      if (e.key === "Escape") setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    document.addEventListener("touchstart", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("touchstart", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);
  return (
    <div className="ts-filtro-panel" ref={ref}>
      <button
        type="button"
        className={"ts-filtros-resumen" + (activo ? " ts-filtros-resumen-activo" : "")}
        title={`Filtro aplicado: ${resumen}`}
        onClick={() => setAbierto((v) => !v)}
      >
        {resumen}
      </button>
      <button
        type="button"
        className={"ts-btn-tres-puntos ts-btn-filtro" + (abierto ? " ts-btn-filtro-activo" : "")}
        title={abierto ? "Ocultar filtros" : "Mostrar filtros"}
        onClick={() => setAbierto((v) => !v)}
      >
        <IconoFiltro />
        {activo && !abierto && <span className="ts-filtro-punto" />}
      </button>
      {abierto && (
        <div className="ts-filtros-popover ts-filtro-panel-popover">
          <div className="ts-filtros-popover-cabecera">
            <span>Filtros</span>
            <button type="button" className="ts-filtros-popover-cerrar" onClick={() => setAbierto(false)}>
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}

function SelectorPeriodo({ valor, onCambiar }) {
  return (
    <div className="ts-filtros ts-filtros-periodo">
      <div className="ts-filtro ts-filtro-vista">
        <span>Periodo</span>
        <div className="ts-segmento" role="tablist">
          {PERIODOS_INICIO.map(([clave, texto]) => (
            <button
              key={clave}
              type="button"
              role="tab"
              aria-selected={valor === clave}
              className={"ts-segmento-op" + (valor === clave ? " activo" : "")}
              onClick={() => onCambiar(clave)}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Cantidad de equipos por flota en los cuadros de Inicio.
const CANTIDADES_EQUIPOS = [
  ["10", "10 equipos"],
  ["20", "20 equipos"],
  ["todos", "Todos"],
];
function SelectorCantidadEquipos({ valor, onCambiar }) {
  return (
    <div className="ts-filtros ts-filtros-periodo">
      <div className="ts-filtro ts-filtro-vista">
        <span>Número de equipos</span>
        <div className="ts-segmento" role="tablist">
          {CANTIDADES_EQUIPOS.map(([clave, texto]) => (
            <button
              key={clave}
              type="button"
              role="tab"
              aria-selected={valor === clave}
              className={"ts-segmento-op" + (valor === clave ? " activo" : "")}
              onClick={() => onCambiar(clave)}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
const textoCantidadEquipos = (c) => (c === "todos" ? "Todos los equipos" : `${c} equipos`);

// Filtro de los cuadros de Inicio: periodo + número de equipos.
function FiltroRanking({ periodo, setPeriodo, cantidad, setCantidad }) {
  return (
    <FiltroPanel resumen={`${rangoPeriodo(periodo).etiqueta} · ${textoCantidadEquipos(cantidad)}`} activo>
      <SelectorPeriodo valor={periodo} onCambiar={setPeriodo} />
      <SelectorCantidadEquipos valor={cantidad} onCambiar={setCantidad} />
    </FiltroPanel>
  );
}

// Equipos de una flota ordenados por cantidad de registros en el periodo.
function rankingEquiposFlota(registros, flota, desde, hasta, cantidad) {
  const conteo = {};
  registros.forEach((r) => {
    if (r.flota !== flota) return;
    if (r.fecha < desde || r.fecha > hasta) return;
    if (!conteo[r.equipo]) conteo[r.equipo] = { equipo: r.equipo, cantidad: 0, litros: 0, ultima: r.fecha, items: [] };
    conteo[r.equipo].cantidad += 1;
    conteo[r.equipo].items.push(r);
    conteo[r.equipo].litros += Number(r.cantidad_litros || 0);
    if (r.fecha > conteo[r.equipo].ultima) conteo[r.equipo].ultima = r.fecha;
  });
  const lista = Object.values(conteo).sort(
    (a, b) => b.cantidad - a.cantidad || b.litros - a.litros || (a.ultima < b.ultima ? 1 : -1)
  );
  return cantidad === "todos" ? lista : lista.slice(0, Number(cantidad) || 10);
}

// Botón de imprimir de los cuadros de Inicio.
function BotonImprimirPanel({ onImprimir, titulo = "Imprimir (PDF)" }) {
  return (
    <button
      type="button"
      className="ts-btn-tres-puntos ts-btn-imprimir-panel"
      title={titulo}
      aria-label={titulo}
      onClick={(e) => {
        e.stopPropagation();
        onImprimir();
      }}
    >
      <IconoImprimir />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Indicadores de confiabilidad de un equipo (pie del detalle en Inicio)
// ---------------------------------------------------------------------------
// Inicio y fin reales (ms) de un trabajo. En el turno noche las horas de
// madrugada pertenecen al día siguiente. Sin hora se usa el inicio o fin del
// turno (Día 06:00–18:00, Noche 18:00–06:00).
function tramoTrabajo(t) {
  if (!t.fecha) return null;
  const base = new Date(t.fecha + "T00:00:00").getTime();
  const noche = t.turno === "noche";
  const ini = t.hora_inicio ? minutosEnTurno(t.hora_inicio, t.turno) : noche ? 18 * 60 : 6 * 60;
  let fin = t.hora_fin ? minutosEnTurno(t.hora_fin, t.turno) : noche ? 30 * 60 : 18 * 60;
  // Hora de fin anterior al inicio en el mismo turno = error de digitación:
  // no se le asigna duración (antes se tomaba como casi 24 h detenido).
  if (fin < ini) fin = ini;
  return { s: base + ini * 60000, e: base + fin * 60000 };
}

// Ventana del periodo: desde el inicio del turno Día de "desde" hasta el fin
// del turno Noche de "hasta". Nunca pasa de "ahora" ni del fin del último
// turno con trabajos registrados (así los días aún sin reportes no cuentan
// como tiempo detenido).
function ventanaPeriodo(desde, hasta, todosLosTrabajos = []) {
  const ini = new Date(desde + "T06:00:00").getTime();
  const finTeorico = new Date(hasta + "T00:00:00").getTime() + 30 * 3600000;
  let finDatos = Infinity;
  if (todosLosTrabajos.length) {
    finDatos = todosLosTrabajos.reduce((max, t) => {
      if (!t.fecha) return max;
      const finTurno = new Date(t.fecha + "T00:00:00").getTime() + (t.turno === "noche" ? 30 : 18) * 3600000;
      return Math.max(max, finTurno);
    }, -Infinity);
  }
  return { ini, fin: Math.max(ini + 3600000, Math.min(Date.now(), finTeorico, finDatos)) };
}
function textoFechaHora(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Disponibilidad, MTBF y MTTR de un equipo en la ventana [ini, fin]:
//  - Detención: desde que empieza un trabajo con el equipo disponible hasta
//    que un trabajo lo deja "Disponible". Incluye los relevos de turno. Los
//    trabajos de turnos siguientes sobre la misma avería son la misma detención.
//  - Falla: detención que empezó con un trabajo NO programado y que cae (toda
//    o en parte) dentro de la ventana.
//  - Disponibilidad = (horas del periodo − horas detenido) ÷ horas del periodo.
//  - MTBF = horas operativas ÷ fallas.  MTTR = horas detenido por fallas ÷ fallas.
function confiabilidadEquipo(trabajosEquipo, ini, fin) {
  const tramos = trabajosEquipo
    .map((t) => ({ ...tramoTrabajo(t), estado: t.estado_final, tipo: t.tipo_trabajo }))
    .filter((x) => x.s)
    .sort((a, b) => a.s - b.s);
  const detenciones = [];
  let actual = null;
  tramos.forEach((x) => {
    const finActual = actual ? (actual.abierta ? Infinity : actual.finReal) : -Infinity;
    if (!actual || x.s > finActual) {
      if (actual) detenciones.push(actual);
      actual = { ini: x.s, finReal: x.e, abierta: x.estado === "no_disponible", falla: x.tipo === "no_programado" };
    } else {
      actual.finReal = Math.max(actual.finReal, x.e);
      actual.abierta = x.estado === "no_disponible";
    }
  });
  if (actual) detenciones.push(actual);
  let horasDetenido = 0;
  let fallas = 0;
  let horasFallas = 0;
  detenciones.forEach((d) => {
    const finDet = d.abierta ? Infinity : d.finReal;
    const a = Math.max(d.ini, ini);
    const b = Math.min(finDet, fin);
    if (b > a) horasDetenido += (b - a) / 3600000;
    // Falla: la que empezó en el periodo o la que ya venía de antes y sigue
    // dentro del periodo (así un equipo parado todo el periodo no queda con
    // 0 fallas y confiabilidad 100 %). Solo cuenta su tiempo dentro del periodo.
    if (d.falla && d.ini < fin && finDet > ini) {
      fallas += 1;
      horasFallas += (Math.min(finDet, fin) - Math.max(d.ini, ini)) / 3600000;
    }
  });
  const horasPeriodo = (fin - ini) / 3600000;
  horasDetenido = Math.min(horasDetenido, horasPeriodo);
  const horasOperativas = Math.max(0, horasPeriodo - horasDetenido);
  return {
    horasPeriodo,
    horasDetenido,
    fallas,
    disponibilidad: horasPeriodo > 0 ? (horasOperativas / horasPeriodo) * 100 : 100,
    // Confiabilidad: probabilidad de operar un turno completo (12 h) sin
    // falla, R = e^(−12 / MTBF). Sin fallas en el periodo = 100 %.
    confiabilidad: fallas ? Math.exp(-HORAS_MISION_CONFIABILIDAD / (horasOperativas / fallas || 1e-9)) * 100 : 100,
    mtbf: fallas ? horasOperativas / fallas : null,
    mttr: fallas ? horasFallas / fallas : null,
  };
}

const HORAS_MISION_CONFIABILIDAD = 12;
const textoPorcentaje = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} %`;

// Todos los indicadores de un equipo en el periodo (pie del detalle,
// "Indicadores de mantenimiento" e impresiones).
function kpisEquipo(trabajos, equipo, desde, hasta, itemsNoProgramados) {
  const { ini, fin } = ventanaPeriodo(desde, hasta, trabajos);
  const m = confiabilidadEquipo(trabajos.filter((t) => t.equipo === equipo), ini, fin);
  const intervencion = itemsNoProgramados.reduce((s, r) => s + minutosDeTrabajo(r.hora_inicio, r.hora_fin), 0);
  return { ...m, ini, fin, intervencionMin: intervencion };
}
const textoMinutos = (min) => `${Math.floor(min / 60)}h ${min % 60}m`;

// Horas decimales → "13h 18m"
function textoHorasMinutos(h) {
  if (h === null || h === undefined) return "—";
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function RankingPorFlota({ titulo, registros, singular, plural, conLitros, colorBarra, tituloDetalle, columnasDetalle, totalDetalle, pieDetalle, pieImpresion }) {
  const [detalle, setDetalle] = useState(null); // { equipo, flota, items }
  const [periodo, setPeriodo] = useState("7");
  const [cantidad, setCantidad] = useState("10");
  const rango = rangoPeriodo(periodo);
  const fechaRef = rango.hasta;
  const desde = rango.desde;
  const formato = (f) => f.split("-").reverse().join("/");

  const flotasMostradas = listaFlotas();

  const rankings = flotasMostradas.map((flota) => {
    const lista = rankingEquiposFlota(registros, flota, desde, fechaRef, cantidad);
    return { flota, lista, maximo: lista.length ? lista[0].cantidad : 1 };
  });

  // Impresión con el mismo formato de las demás, separada por flota y con el
  // detalle de cada equipo (sus registros del periodo y sus totales o
  // indicadores), igual que al abrir el equipo en pantalla.
  function imprimir() {
    imprimirRankingDetallado({
      titulo: `${titulo} · ${formato(desde)} al ${formato(fechaRef)} · ${textoCantidadEquipos(cantidad)}`,
      flotas: rankings.map(({ flota, lista }) => ({
        flota,
        equipos: lista.map((item, i) => ({
          puesto: i + 1,
          equipo: item.equipo,
          resumen: `${item.cantidad} ${item.cantidad === 1 ? singular : plural}${conLitros ? ` · ${item.litros} L` : ""}`,
          columnas: columnasDetalle.map((c) => c.titulo),
          filas: item.items
            .slice()
            .sort((a, b) => (claveOrden(a) > claveOrden(b) ? 1 : -1))
            .map((r) => columnasDetalle.map((c) => (c.texto ? c.texto(r) : c.valor(r)))),
          pie: pieImpresion ? pieImpresion(item.equipo, desde, fechaRef, item.items) : totalDetalle ? [[totalDetalle(item.items)]] : [],
        })),
      })),
    });
  }

  return (
    <Panel
      titulo={`${titulo} · ${formato(desde)} al ${formato(fechaRef)}`}
      acciones={
        <div className="ts-acciones-panel">
          <FiltroRanking periodo={periodo} setPeriodo={setPeriodo} cantidad={cantidad} setCantidad={setCantidad} />
          <BotonImprimirPanel onImprimir={imprimir} />
        </div>
      }
    >
      <div className="ts-grid-2">
        {rankings.map(({ flota, lista, maximo }) => (
          <div key={flota}>
            <h4 className="ts-grafico-subtitulo">Flota {flota}</h4>
            {lista.length === 0 ? (
              <div className="ts-vacio">Sin registros en el periodo.</div>
            ) : (
              <ol className="ts-ranking">
                {lista.map((item, i) => (
                  <li
                    key={item.equipo}
                    className={"ts-ranking-fila ts-ranking-fila-clicable" + (conLitros ? " ts-ranking-fila-litros" : "")}
                    title={`Ver detalle del equipo ${item.equipo}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetalle({ equipo: item.equipo, flota, items: item.items })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setDetalle({ equipo: item.equipo, flota, items: item.items });
                    }}
                  >
                    <span className={"ts-ranking-puesto" + (i < 3 ? " ts-ranking-puesto-top" : "")}>{i + 1}</span>
                    <span className="ts-ranking-equipo">{item.equipo}</span>
                    <span className="ts-ranking-barra">
                      <span style={{ width: `${(item.cantidad / maximo) * 100}%`, background: colorBarra || undefined }} />
                    </span>
                    <span className="ts-ranking-cantidad">
                      {item.cantidad} {item.cantidad === 1 ? singular : plural}
                      {conLitros && <span className="ts-ranking-litros">{item.litros} L</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>

      {detalle && (
        <ModalFormulario onCerrar={() => setDetalle(null)}>
          <Panel titulo={`${tituloDetalle} — Equipo ${detalle.equipo} · Flota ${detalle.flota}`}>
            <div className="ts-detalle-rango">
              {formato(desde)} al {formato(fechaRef)} · {detalle.items.length} {detalle.items.length === 1 ? singular : plural}
            </div>
            <div className="ts-tabla-wrap">
              <table className="ts-tabla ts-tabla-detalle">
                <thead>
                  <tr>
                    {columnasDetalle.map((c) => (
                      <th key={c.titulo}>{c.titulo}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detalle.items
                    .slice()
                    .sort((a, b) => (claveOrden(a) > claveOrden(b) ? 1 : -1))
                    .map((r) => (
                      <tr key={r.id}>
                        {columnasDetalle.map((c) => (
                          <td key={c.titulo} className={c.clase || ""}>
                            {c.valor(r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
                {totalDetalle && (
                  <tfoot>
                    {pieDetalle ? (
                      <tr className="ts-detalle-indicadores">
                        <td colSpan={columnasDetalle.length}>{pieDetalle(detalle.equipo, desde, fechaRef, detalle.items)}</td>
                      </tr>
                    ) : (
                      <tr>
                        <td colSpan={columnasDetalle.length}>{totalDetalle(detalle.items)}</td>
                      </tr>
                    )}
                  </tfoot>
                )}
              </table>
            </div>
          </Panel>
        </ModalFormulario>
      )}
    </Panel>
  );
}

const formatoFecha = (f) => (f ? f.split("-").reverse().join("/") : "");
const textoTurno = (t) => (t === "dia" ? "Día" : "Noche");

function minutosDeTrabajo(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return 0;
  let m = horaAMinutos(horaFin) - horaAMinutos(horaInicio);
  if (m < 0) m += 24 * 60;
  return m;
}

function TopNoProgramados({ trabajos }) {
  // Indicadores del equipo en el periodo, con todos sus trabajos (programados
  // y no programados) para reconstruir cuándo estuvo detenido.
  // Pie del detalle: un indicador por línea, todos con el mismo formato.
  // El periodo termina en el último turno reportado (los días sin reportes
  // no cuentan como tiempo detenido).
  function indicadores(equipo, desde, hasta, items) {
    const m = kpisEquipo(trabajos, equipo, desde, hasta, items);
    const { ini, fin } = m;
    const filas = [
      ["Fallas", m.fallas],
      ["Tiempo total de intervención", textoMinutos(m.intervencionMin)],
      ["Tiempo detenido", textoHorasMinutos(m.horasDetenido)],
      ["Confiabilidad", textoPorcentaje(m.confiabilidad)],
      ["Disponibilidad", `${Math.round(m.disponibilidad * 10) / 10} %`],
      ["MTBF", textoHorasMinutos(m.mtbf)],
      ["MTTR", textoHorasMinutos(m.mttr)],
    ];
    return (
      <div
        className="ts-detalle-kpis"
        title={`Periodo evaluado: ${textoFechaHora(ini)} – ${textoFechaHora(fin)}. El tiempo detenido incluye los relevos de turno; una avería atendida en varios turnos cuenta como una sola falla.`}
      >
        {filas.map(([etiqueta, valor]) => (
          <div key={etiqueta}>
            {etiqueta}: {valor}
          </div>
        ))}
      </div>
    );
  }
  return (
    <RankingPorFlota
      pieDetalle={indicadores}
      pieImpresion={(equipo, desde, hasta, items) => {
        const m = kpisEquipo(trabajos, equipo, desde, hasta, items);
        return [
          ["Fallas", m.fallas],
          ["Tiempo de intervención", textoMinutos(m.intervencionMin)],
          ["Tiempo detenido", textoHorasMinutos(m.horasDetenido)],
          ["Confiabilidad", textoPorcentaje(m.confiabilidad)],
          ["Disponibilidad", textoPorcentaje(m.disponibilidad)],
          ["MTBF", textoHorasMinutos(m.mtbf)],
          ["MTTR", textoHorasMinutos(m.mttr)],
        ];
      }}
      titulo="Equipos con más trabajos no programados"
      registros={trabajos.filter((t) => t.tipo_trabajo === "no_programado")}
      singular="trabajo"
      plural="trabajos"
      tituloDetalle="Trabajos no programados"
      columnasDetalle={[
        { titulo: "Fecha", valor: (r) => formatoFecha(r.fecha), clase: "ts-mono" },
        { titulo: "Turno", valor: (r) => <span className={"ts-badge ts-badge-" + (r.turno === "dia" ? "dia" : "noche")}>{textoTurno(r.turno)}</span>, texto: (r) => textoTurno(r.turno) },
        { titulo: "Horario", valor: (r) => `${r.hora_inicio || "--:--"}–${r.hora_fin || "--:--"}`, clase: "ts-mono" },
        { titulo: "Tiempo de trabajo", valor: (r) => calcularTiempoTrabajo(r.hora_inicio, r.hora_fin), clase: "ts-mono" },
        { titulo: "Estado final", valor: (r) => (r.estado_final === "disponible" ? "Disponible" : "No disponible") },
        { titulo: "Trabajo", valor: (r) => <div className="ts-clamp-2">{r.sintoma_causa || r.descripcion}</div>, texto: (r) => r.sintoma_causa || r.descripcion || "" },
      ]}
      totalDetalle={(items) => {
        const total = items.reduce((s, r) => s + minutosDeTrabajo(r.hora_inicio, r.hora_fin), 0);
        return `Tiempo total de intervención: ${Math.floor(total / 60)}h ${total % 60}m`;
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Inicio: Indicadores de mantenimiento por equipo (mismos equipos y filtros
// que "Equipos con más trabajos no programados"): fallas, tiempos,
// confiabilidad, disponibilidad, MTBF y MTTR. Se puede imprimir.
// ---------------------------------------------------------------------------
function IndicadoresMantenimiento({ trabajos }) {
  const [periodo, setPeriodo] = useState("7");
  const [cantidad, setCantidad] = useState("10");
  const rango = rangoPeriodo(periodo);
  const { desde, hasta } = rango;
  const formato = (f) => f.split("-").reverse().join("/");
  const noProgramados = trabajos.filter((t) => t.tipo_trabajo === "no_programado");
  // Primero los de MÁS BAJO rendimiento: menor disponibilidad, luego menor
  // confiabilidad y más fallas. Se calcula con el periodo elegido y luego se
  // toman los N equipos del filtro.
  const porFlota = listaFlotas().map((flota) => {
    const todos = rankingEquiposFlota(noProgramados, flota, desde, hasta, "todos").map((item) => ({
      equipo: item.equipo,
      ...kpisEquipo(trabajos, item.equipo, desde, hasta, item.items),
    }));
    todos.sort((a, b) => a.disponibilidad - b.disponibilidad || a.confiabilidad - b.confiabilidad || b.fallas - a.fallas || b.horasDetenido - a.horasDetenido);
    const elegidos = cantidad === "todos" ? todos : todos.slice(0, Number(cantidad) || 10);
    return { flota, filas: elegidos.map((k, i) => ({ ...k, puesto: i + 1 })) };
  });
  const COLUMNAS = [
    ["fallas", "Fallas", (k) => k.fallas],
    ["intervencion", "T. intervención", (k) => textoMinutos(k.intervencionMin)],
    ["detenido", "T. detenido", (k) => textoHorasMinutos(k.horasDetenido)],
    ["confiabilidad", "Confiabilidad", (k) => textoPorcentaje(k.confiabilidad)],
    ["disponibilidad", "Disponibilidad", (k) => textoPorcentaje(k.disponibilidad)],
    ["mtbf", "MTBF", (k) => textoHorasMinutos(k.mtbf)],
    ["mttr", "MTTR", (k) => textoHorasMinutos(k.mttr)],
  ];
  function imprimir() {
    const filas = [];
    porFlota.forEach(({ flota, filas: f }) =>
      f.forEach((k) => {
        const fila = { flota, puesto: k.puesto, equipo: k.equipo };
        COLUMNAS.forEach(([clave, , valor]) => (fila[clave] = String(valor(k))));
        filas.push(fila);
      })
    );
    exportarPDF(
      filas,
      [
        { clave: "flota", titulo: "Flota" },
        { clave: "puesto", titulo: "N°" },
        { clave: "equipo", titulo: "Equipo" },
        ...COLUMNAS.map(([clave, titulo]) => ({ clave, titulo })),
      ],
      `Indicadores de mantenimiento · ${formato(desde)} al ${formato(hasta)} · ${textoCantidadEquipos(cantidad)}`
    );
  }
  return (
    <Panel
      titulo={`Indicadores de mantenimiento · ${formato(desde)} al ${formato(hasta)}`}
      acciones={
        <div className="ts-acciones-panel">
          <FiltroRanking periodo={periodo} setPeriodo={setPeriodo} cantidad={cantidad} setCantidad={setCantidad} />
          <BotonImprimirPanel onImprimir={imprimir} />
        </div>
      }
    >
      {porFlota.map(({ flota, filas }) => (
        <div key={flota} className="ts-kpi-flota">
          <h4 className="ts-grafico-subtitulo">Flota {flota}</h4>
          {filas.length === 0 ? (
            <div className="ts-vacio">Sin trabajos no programados en el periodo.</div>
          ) : (
            <div className="ts-tabla-wrap">
              <table className="ts-tabla ts-tabla-kpi">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Equipo</th>
                    {COLUMNAS.map(([clave, titulo]) => (
                      <th key={clave} className={clave === "confiabilidad" || clave === "disponibilidad" ? "ts-kpi-destacado" : ""}>
                        {titulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((k) => (
                    <tr key={k.equipo}>
                      <td className="ts-mono">{k.puesto}</td>
                      <td className="ts-mono">{k.equipo}</td>
                      {COLUMNAS.map(([clave, , valor]) => (
                        <td key={clave} className={"ts-mono" + (clave === "confiabilidad" || clave === "disponibilidad" ? " ts-kpi-destacado" : "")}>
                          {valor(k)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Inicio: adiciones y derrames por tipo de aceite (todos los tipos), con
// filtro propio de periodo: últimos 7 días, últimos 14 días o último mes.
// ---------------------------------------------------------------------------
const NOMBRES_MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
function litrosDe(lista) {
  return lista.reduce((s, r) => s + (Number(r.cantidad_litros) || 0), 0);
}
function formatoLitros(n) {
  return `${Math.round(n * 10) / 10} L`;
}

function ResumenMensualAceites({ aceites, tiposCatalogo = [] }) {
  // Mismo filtro que "Equipos no disponibles": Fecha, Turno y Flota. Por
  // defecto muestra la fecha de hoy y el turno operativo actual (por horario).
  const [filtroAd, setFiltroAd] = useState(() => ({
    fecha: turnoOperativoActual().fecha,
    turno: turnoOperativoActual().turno,
    equipo: "todos",
    flota: "todos",
  }));
  const base = aceites;
  const actuales = base.filter(
    (a) =>
      (!filtroAd.fecha || a.fecha === filtroAd.fecha) &&
      (filtroAd.turno === "todos" || a.turno === filtroAd.turno) &&
      (filtroAd.flota === "todos" || a.flota === filtroAd.flota)
  );

  // Todos los tipos de aceite: los del catálogo y los que aparezcan en registros.
  const tipos = [...new Set([...tiposCatalogo, ...base.map((a) => a.tipo_aceite).filter(Boolean)])].sort();

  function bloque(op, titulo, color) {
    const regs = actuales.filter((a) => a.tipo_operacion === op);
    const porTipo = tipos.map((t) => {
      const r = regs.filter((a) => a.tipo_aceite === t);
      return { tipo: t, litros: litrosDe(r), cantidad: r.length };
    });
    const max = Math.max(1, ...porTipo.map((x) => x.litros));
    return (
      <div className="ts-mes-bloque">
        <div className="ts-mes-cabecera">
          <h4 className="ts-grafico-subtitulo">{titulo}</h4>
        </div>
        <div className="ts-mes-lista">
          {porTipo.map((x) => (
            <div key={x.tipo} className={"ts-mes-fila" + (x.litros ? "" : " ts-mes-fila-cero")} title={`${x.tipo}: ${formatoLitros(x.litros)} en ${x.cantidad} registro(s)`}>
              <span className="ts-mes-tipo">{x.tipo}</span>
              <span className="ts-mes-barra">
                <span style={{ width: `${(x.litros / max) * 100}%`, background: color }} />
              </span>
              <span className="ts-mes-litros">{formatoLitros(x.litros)}</span>
            </div>
          ))}
          {tipos.length === 0 && <div className="ts-vacio">No hay tipos de aceite configurados.</div>}
        </div>
      </div>
    );
  }

  return (
    <Panel
      titulo="Adiciones y derrames"
      acciones={
        <FiltroPanel
          activo={hayFiltrosGenerales(filtroAd)}
          resumen={[fechaCorta(filtroAd.fecha), TEXTO_TURNO[filtroAd.turno], filtroAd.flota !== "todos" && `Flota ${filtroAd.flota}`]
            .filter(Boolean)
            .join(" · ") || "Sin filtros"}
        >
          <FiltrosBar filtros={filtroAd} setFiltros={setFiltroAd} mostrarEquipo={false} />
        </FiltroPanel>
      }
    >
      <div className="ts-grid-2">
        {bloque("adicion", "Adiciones", "var(--amber)")}
        {bloque("derrame", "Derrames", "var(--red)")}
      </div>
    </Panel>
  );
}

// Adiciones de aceite de motor: operación "Adición" en el sistema Motor (o
// con un tipo de aceite de motor).
// Refrigerante: tipo de aceite "Anticongelante" / "Refrigerante" / "Coolant"
// (o un sistema de enfriamiento). No se cuenta como aceite de motor aunque
// se registre en el sistema Motor.
function esRefrigerante(a) {
  return /anticongelante|refrigerante|coolant/i.test(a.tipo_aceite || "") || /refrigeraci|enfriamiento|radiador/i.test(a.sistema_equipo || "");
}
function TopAdicionesMotor({ aceites }) {
  const adicionesMotor = aceites.filter(
    (a) => a.tipo_operacion === "adicion" && !esRefrigerante(a) && (a.sistema_equipo === "Motor" || /motor/i.test(a.tipo_aceite || ""))
  );
  return (
    <RankingPorFlota
      titulo="Equipos con más adiciones de aceite motor"
      registros={adicionesMotor}
      singular="adición"
      plural="adiciones"
      conLitros
      colorBarra="var(--amber)"
      tituloDetalle="Adiciones de aceite motor"
      columnasDetalle={[
        { titulo: "Fecha", valor: (r) => formatoFecha(r.fecha), clase: "ts-mono" },
        { titulo: "Turno", valor: (r) => <span className={"ts-badge ts-badge-" + (r.turno === "dia" ? "dia" : "noche")}>{textoTurno(r.turno)}</span>, texto: (r) => textoTurno(r.turno) },
        { titulo: "Horario", valor: (r) => `${r.hora_inicio || "--:--"}–${r.hora_fin || "--:--"}`, clase: "ts-mono" },
        { titulo: "Cantidad", valor: (r) => (r.cantidad_litros === "" || r.cantidad_litros == null ? "—" : `${r.cantidad_litros} L`), clase: "ts-mono" },
        { titulo: "Tipo de aceite", valor: (r) => r.tipo_aceite },
        { titulo: "Horómetro", valor: (r) => r.horometro || "—", clase: "ts-mono" },
        { titulo: "Personal", valor: (r) => usuariosDoc(r.participantes).join(", ") || "—" },
      ]}
      totalDetalle={(items) => `Total agregado: ${items.reduce((s, r) => s + Number(r.cantidad_litros || 0), 0)} L`}
    />
  );
}

// Inicio: equipos con más adiciones de refrigerante (mismo filtro de
// periodo que "Equipos con más adiciones de aceite motor").
function TopAdicionesRefrigerante({ aceites }) {
  const adiciones = aceites.filter((a) => a.tipo_operacion === "adicion" && esRefrigerante(a));
  return (
    <RankingPorFlota
      titulo="Equipos con más adiciones de refrigerante"
      registros={adiciones}
      singular="adición"
      plural="adiciones"
      conLitros
      colorBarra="var(--blue)"
      tituloDetalle="Adiciones de refrigerante"
      columnasDetalle={[
        { titulo: "Fecha", valor: (r) => formatoFecha(r.fecha), clase: "ts-mono" },
        { titulo: "Turno", valor: (r) => <span className={"ts-badge ts-badge-" + (r.turno === "dia" ? "dia" : "noche")}>{textoTurno(r.turno)}</span>, texto: (r) => textoTurno(r.turno) },
        { titulo: "Horario", valor: (r) => `${r.hora_inicio || "--:--"}–${r.hora_fin || "--:--"}`, clase: "ts-mono" },
        { titulo: "Cantidad", valor: (r) => (r.cantidad_litros === "" || r.cantidad_litros == null ? "—" : `${r.cantidad_litros} L`), clase: "ts-mono" },
        { titulo: "Tipo", valor: (r) => r.tipo_aceite },
        { titulo: "Sistema", valor: (r) => r.sistema_equipo },
        { titulo: "Horómetro", valor: (r) => r.horometro || "—", clase: "ts-mono" },
        { titulo: "Personal", valor: (r) => usuariosDoc(r.participantes).join(", ") || "—" },
      ]}
      totalDetalle={(items) => `Total agregado: ${items.reduce((s, r) => s + Number(r.cantidad_litros || 0), 0)} L`}
    />
  );
}

// ---------------------------------------------------------------------------
// Gráfica: Adiciones de aceite por turno, por tipo de aceite, separado por flota
// ---------------------------------------------------------------------------

const COLORES_GRAFICO = ["#4F8FE0", "#E5534B", "#2FA36B", "#D6488B", "#F2A93B", "#6C5FC7", "#13A8B0", "#2A3138"];

function GraficoAdicionesPorTurno({ aceites, tiposCatalogo }) {
  const adiciones = aceites.filter((a) => a.tipo_operacion === "adicion");

  // Se muestran TODOS los tipos de aceite activos registrados en
  // Configuración (aunque todavía no tengan adiciones), para que el
  // catálogo y la gráfica queden siempre consistentes.
  const tipos = tiposCatalogo.slice().sort();
  const colorPorTipo = {};
  tipos.forEach((t, i) => (colorPorTipo[t] = COLORES_GRAFICO[i % COLORES_GRAFICO.length]));

  function datosDe(flota) {
    const datos = { dia: {}, noche: {} };
    adiciones
      .filter((a) => a.flota === flota)
      .forEach((a) => {
        const turno = a.turno === "noche" ? "noche" : "dia";
        datos[turno][a.tipo_aceite] = (datos[turno][a.tipo_aceite] || 0) + Number(a.cantidad_litros || 0);
      });
    return datos;
  }

  // Una gráfica por flota (se adapta si se agregan flotas nuevas).
  const porFlota = listaFlotas().map((f) => ({ flota: f, datos: datosDe(f) }));

  const maxValor = Math.max(
    1,
    ...porFlota.flatMap(({ datos }) => ["dia", "noche"].flatMap((turno) => tipos.map((t) => datos[turno][t] || 0)))
  );

  if (tipos.length === 0) {
    return <div className="ts-vacio">No hay tipos de aceite activos configurados en Configuración.</div>;
  }

  return (
    <div className="ts-grafico-adiciones">
      <div className="ts-grid-2">
        {porFlota.map(({ flota, datos }) => (
          <div key={flota}>
            <h4 className="ts-grafico-subtitulo">Flota {flota}</h4>
            <BarrasPorTurno datos={datos} tipos={tipos} colorPorTipo={colorPorTipo} maxValor={maxValor} />
          </div>
        ))}
      </div>
      <div className="ts-grafico-leyenda">
        {tipos.map((t) => (
          <div key={t} className="ts-grafico-leyenda-item">
            <span className="ts-grafico-leyenda-color" style={{ background: colorPorTipo[t] }} />
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function BarrasPorTurno({ datos, tipos, colorPorTipo, maxValor }) {
  const ancho = 460;
  const alto = 220;
  const margenInferior = 34;
  const margenSuperior = 14;
  const altoUtil = alto - margenInferior - margenSuperior;
  const anchoGrupo = (ancho - 20) / 2;
  const anchoBarra = Math.min(34, (anchoGrupo - 20) / Math.max(tipos.length, 1));

  function grupo(turno, xInicio, etiqueta) {
    return (
      <g key={turno}>
        <text x={xInicio + anchoGrupo / 2} y={alto - 10} textAnchor="middle" className="ts-grafico-eje-texto">
          {etiqueta}
        </text>
        {tipos.map((t, i) => {
          const valor = datos[turno][t] || 0;
          const h = maxValor > 0 ? (valor / maxValor) * altoUtil : 0;
          const x = xInicio + (anchoGrupo - anchoBarra * tipos.length) / 2 + i * anchoBarra;
          const y = alto - margenInferior - h;
          return (
            <g key={t}>
              {valor > 0 && (
                <text x={x + anchoBarra / 2} y={y - 4} textAnchor="middle" className="ts-grafico-valor-texto">
                  {valor}
                </text>
              )}
              <rect
                x={x + 2}
                y={y}
                width={Math.max(anchoBarra - 4, 1)}
                height={Math.max(h, 0)}
                fill={colorPorTipo[t]}
                rx="2"
              />
            </g>
          );
        })}
      </g>
    );
  }

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="ts-grafico-svg" role="img" aria-label="Litros de aceite adicionados por turno">
      <line x1="0" y1={alto - margenInferior} x2={ancho} y2={alto - margenInferior} className="ts-grafico-eje" />
      {grupo("dia", 10, "Día")}
      {grupo("noche", 10 + anchoGrupo + 10, "Noche")}
    </svg>
  );
}

function Kpi({ valor, etiqueta, tono }) {
  return (
    <div className={"ts-kpi ts-kpi-" + tono}>
      <div className="ts-kpi-valor">{valor}</div>
      <div className="ts-kpi-etiqueta">{etiqueta}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cuadro de filtros flotante
// ---------------------------------------------------------------------------

const FiltrosContext = React.createContext({ abierto: false, cerrar: () => {}, setActivos: () => {}, setResumen: () => {} });

// Texto corto de los filtros aplicados, para mostrarlo en la barra superior.
const fechaCorta = (f) => (f ? f.split("-").reverse().join("/") : "");
function textoRango(desde, hasta) {
  if (desde && hasta) return desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} – ${fechaCorta(hasta)}`;
  if (desde) return `Desde ${fechaCorta(desde)}`;
  if (hasta) return `Hasta ${fechaCorta(hasta)}`;
  return "";
}
const TEXTO_TURNO = { dia: "Turno Día", noche: "Turno Noche" };
const SEGUNDOS_INACTIVIDAD_FILTROS = 10;

function hayFiltrosGenerales(f) {
  return !!(f.fecha || f.turno !== "todos" || f.flota !== "todos" || f.equipo !== "todos");
}

// Muestra los filtros de la vista actual en un cuadro flotante bajo el ícono
// de filtro. Se cierra al hacer clic fuera, con Escape, o tras
// SEGUNDOS_INACTIVIDAD_FILTROS segundos sin uso (si el cursor no está encima).
// También informa si hay filtros aplicados, para marcar el ícono.
function PopoverFiltros({ activos, resumen = [], children }) {
  const { abierto, cerrar, setActivos, setResumen } = React.useContext(FiltrosContext);
  const resumenTexto = resumen.filter(Boolean).join(" · ");
  useEffect(() => {
    setResumen(resumenTexto);
  }, [resumenTexto]);
  useEffect(() => () => setResumen(""), []);
  const ref = React.useRef(null);
  const encima = React.useRef(false);
  const temporizador = React.useRef(null);

  useEffect(() => {
    setActivos(!!activos);
  }, [activos]);
  useEffect(() => () => setActivos(false), []);

  useEffect(() => {
    if (!abierto) return;

    function reiniciarTemporizador() {
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(function revisar() {
        if (encima.current) {
          temporizador.current = setTimeout(revisar, SEGUNDOS_INACTIVIDAD_FILTROS * 1000);
        } else {
          cerrar();
        }
      }, SEGUNDOS_INACTIVIDAD_FILTROS * 1000);
    }

    function alPresionarFuera(e) {
      const dentro = ref.current && ref.current.contains(e.target);
      const enBoton = e.target.closest && e.target.closest("[data-filtro-toggle]");
      if (!dentro && !enBoton) cerrar();
    }
    function alTeclear(e) {
      if (e.key === "Escape") cerrar();
    }

    reiniciarTemporizador();
    const nodo = ref.current;
    const eventosUso = ["pointerdown", "pointermove", "input", "change", "keydown", "focusin"];
    eventosUso.forEach((ev) => nodo && nodo.addEventListener(ev, reiniciarTemporizador));
    document.addEventListener("mousedown", alPresionarFuera);
    document.addEventListener("touchstart", alPresionarFuera);
    document.addEventListener("keydown", alTeclear);
    return () => {
      clearTimeout(temporizador.current);
      eventosUso.forEach((ev) => nodo && nodo.removeEventListener(ev, reiniciarTemporizador));
      document.removeEventListener("mousedown", alPresionarFuera);
      document.removeEventListener("touchstart", alPresionarFuera);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [abierto]);

  if (!abierto) return null;
  return (
    <div
      ref={ref}
      className="ts-filtros-popover"
      onMouseEnter={() => (encima.current = true)}
      onMouseLeave={() => (encima.current = false)}
    >
      <div className="ts-filtros-popover-cabecera">
        <span>Filtros</span>
        <button type="button" className="ts-filtros-popover-cerrar" title="Cerrar" onClick={cerrar}>
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

function FiltrosBar({ filtros, setFiltros, mostrarEquipo = true, contenidoEquipo, equipos, extraActivo, onLimpiarExtra }) {
  function set(campo, valor) {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
  }
  return (
    <div className="ts-filtros">
      <label className="ts-filtro">
        <span>Fecha</span>
        <input
          type="date"
          value={filtros.fecha}
          onChange={(e) => set("fecha", e.target.value)}
        />
      </label>
      <label className="ts-filtro">
        <span>Turno</span>
        <select value={filtros.turno} onChange={(e) => set("turno", e.target.value)}>
          <option value="todos">Todos</option>
          <option value="dia">Día</option>
          <option value="noche">Noche</option>
        </select>
      </label>
      <label className="ts-filtro">
        <span>Flota</span>
        <select value={filtros.flota} onChange={(e) => set("flota", e.target.value)}>
          <option value="todos">Todas</option>
          {listaFlotas().map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      {mostrarEquipo ? (
        <label className="ts-filtro">
          <span>Equipo</span>
          <select value={filtros.equipo} onChange={(e) => set("equipo", e.target.value)}>
            <option value="todos">Todos</option>
            {equipos.filter((eq) => eq.activo).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo}
              </option>
            ))}
          </select>
        </label>
      ) : (
        contenidoEquipo
      )}
      {(extraActivo || filtros.fecha || filtros.turno !== "todos" || filtros.equipo !== "todos" || filtros.flota !== "todos") && (
        <button
          className="ts-btn-ghost"
          onClick={() => {
            setFiltros({ fecha: "", turno: "todos", equipo: "todos", flota: "todos" });
            if (onLimpiarExtra) onLimpiarExtra();
          }}
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

// Fecha y hora local del dispositivo en formato AAAA-MM-DDTHH:MM, para
// guardar cuándo se registró (creado_en) o editó (editado_en) un registro.
function marcaDeTiempo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function textoMarca(marca) {
  if (!marca) return "";
  const [f, h] = marca.split("T");
  return `${f.split("-").reverse().join("/")} ${h || ""}`.trim();
}

// Texto pequeño junto al título de los formularios de Trabajos, Aceites y
// Requerimientos: al registrar muestra la fecha y hora actuales (se
// actualiza cada 30 s); al editar, cuándo se registró y cuándo se editó
// por última vez.
function SelloRegistro({ inicial }) {
  const [ahora, setAhora] = useState(marcaDeTiempo);
  useEffect(() => {
    const t = setInterval(() => setAhora(marcaDeTiempo()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!inicial) return <>Registro: {textoMarca(ahora)}</>;
  return (
    <>
      Registrado: {inicial.creado_en ? textoMarca(inicial.creado_en) : "sin fecha"}
      {inicial.editado_en && <> · Editado: {textoMarca(inicial.editado_en)}</>}
    </>
  );
}

// Aplica un orden guardado a una lista de claves. Las claves nuevas (p. ej.
// un grupo o una flota recién creados) se insertan después de la clave que
// las precede en el orden natural.
function ordenarSegun(naturales, guardado) {
  if (!guardado || guardado.length === 0) return naturales;
  const resultado = guardado.filter((c) => naturales.includes(c));
  naturales.forEach((c, i) => {
    if (resultado.includes(c)) return;
    let pos = 0;
    for (let k = i - 1; k >= 0; k--) {
      const idx = resultado.indexOf(naturales[k]);
      if (idx >= 0) {
        pos = idx + 1;
        break;
      }
    }
    resultado.splice(pos, 0, c);
  });
  return resultado;
}

// Lista que se puede ordenar arrastrando (mouse o dedo). Cada elemento
// recibe:
//   asaProps: para el ícono de agarre (arrastra al instante; funciona en
//             celular porque desactiva el desplazamiento táctil sobre él).
//   cabeceraProps: para la cabecera completa; con el mouse se arrastra al
//             mantener presionado y mover, sin afectar el clic normal que
//             despliega o pliega el cuadro.
// El orden cambia en vivo mientras se arrastra y se informa con onReordenar.
function ListaOrdenable({ claves, onReordenar, render }) {
  const refs = React.useRef({});
  const [activa, setActiva] = useState(null);
  const estado = React.useRef(null);
  const ordenRef = React.useRef(claves);
  ordenRef.current = claves;
  const reordenarRef = React.useRef(onReordenar);
  reordenarRef.current = onReordenar;
  const huboArrastre = React.useRef(false);

  function activar() {
    estado.current.activo = true;
    huboArrastre.current = true;
    setActiva(estado.current.clave);
    document.body.classList.add("ts-arrastrando");
  }
  function mover(e) {
    const st = estado.current;
    if (!st) return;
    if (!st.activo) {
      if (Math.abs(e.clientY - st.y0) > 6) activar();
      else return;
    }
    e.preventDefault();
    const margen = 70;
    if (e.clientY < margen) window.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - margen) window.scrollBy(0, 14);
    const orden = ordenRef.current;
    const otras = orden.filter((c) => c !== st.clave);
    let indice = otras.length;
    for (let i = 0; i < otras.length; i++) {
      const el = refs.current[otras[i]];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        indice = i;
        break;
      }
    }
    const nuevo = [...otras.slice(0, indice), st.clave, ...otras.slice(indice)];
    if (nuevo.join("|") !== orden.join("|")) reordenarRef.current(nuevo);
  }
  function soltar() {
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
    window.removeEventListener("pointercancel", soltar);
    document.body.classList.remove("ts-arrastrando");
    estado.current = null;
    setActiva(null);
    setTimeout(() => (huboArrastre.current = false), 0);
  }
  function iniciar(clave, e, inmediato) {
    if (e.button !== undefined && e.button !== 0) return;
    if (!inmediato && e.target.closest(".ts-acciones-grupo, .ts-renombrar-grupo, input, select, textarea")) return;
    estado.current = { clave, y0: e.clientY, activo: false };
    huboArrastre.current = false;
    window.addEventListener("pointermove", mover, { passive: false });
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    if (inmediato) {
      e.preventDefault();
      activar();
    }
  }

  return (
    <div
      className="ts-lista-ordenable"
      onClickCapture={(e) => {
        // Evita que soltar después de arrastrar despliegue o pliegue el cuadro.
        if (huboArrastre.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      {claves.map((clave) => (
        <div
          key={clave}
          ref={(el) => (refs.current[clave] = el)}
          className={"ts-ordenable" + (activa === clave ? " ts-ordenable-activo" : "")}
        >
          {render(clave, {
            asaProps: {
              className: "ts-asa-arrastre",
              title: "Mantén presionado y arrastra para ordenar",
              onPointerDown: (e) => iniciar(clave, e, true),
            },
            cabeceraProps: {
              onPointerDown: (e) => {
                if (e.pointerType === "mouse") iniciar(clave, e, false);
              },
            },
          })}
        </div>
      ))}
    </div>
  );
}

function IconoAsa() {
  return (
    <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
      {[3, 8, 13].map((y) => (
        <React.Fragment key={y}>
          <circle cx="3.5" cy={y} r="1.4" />
          <circle cx="8.5" cy={y} r="1.4" />
        </React.Fragment>
      ))}
    </svg>
  );
}

function Panel({ titulo, subtitulo, acciones, children, colapsable, inicialAbierto = false, asa, cabeceraProps, abrir }) {
  const [abierto, setAbierto] = useState(inicialAbierto);
  // "abrir": despliega el cuadro (p. ej. al pulsar "+ Agregar" con el cuadro plegado).
  useEffect(() => {
    if (abrir) setAbierto(true);
  }, [abrir]);
  const mostrarBody = !colapsable || abierto;

  return (
    <section className="ts-panel">
      <div className="ts-panel-head" {...(cabeceraProps || {})}>
        {colapsable ? (
          <div className="ts-panel-titulo-grupo">
            {asa}
            <button
              type="button"
              className="ts-panel-titulo-btn"
              onClick={() => setAbierto((v) => !v)}
            >
              <IconoChevron abierto={abierto} />
              <h3>{titulo}</h3>
            </button>
          </div>
        ) : subtitulo ? (
          <div className="ts-panel-titulo-con-sello">
            <h3>{titulo}</h3>
            <span className="ts-panel-sello">{subtitulo}</span>
          </div>
        ) : (
          <h3>{titulo}</h3>
        )}
        {acciones}
      </div>
      {mostrarBody && <div className="ts-panel-body">{children}</div>}
    </section>
  );
}

function IconoChevron({ abierto }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"ts-chevron" + (abierto ? " ts-chevron-abierto" : "")}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Vista: Trabajos
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ventana flotante (modal) para crear o editar registros de Trabajos, Aceites
// y Requerimientos. Se superpone a la pantalla en escritorio (centrada) y en
// celular (a pantalla completa). Se cierra con la ×, con Escape o al guardar;
// tocar fuera NO la cierra, para no perder lo escrito por accidente.
// ---------------------------------------------------------------------------
// Al cerrar un formulario con la X (o Escape) con cambios sin guardar, se
// pregunta si guardarlos o descartarlos. Cada formulario se registra con
// useConfirmarCierre(form, guardar).
const ContextoCierre = React.createContext(null);
function useConfirmarCierre(form, guardar) {
  const ctx = useContext(ContextoCierre);
  const base = useRef(null);
  const actual = useRef(form);
  actual.current = form;
  const refGuardar = useRef(guardar);
  refGuardar.current = guardar;
  useEffect(() => {
    // Se toma el estado inicial cuando el formulario ya terminó de armarse.
    const t = setTimeout(() => (base.current = JSON.stringify(actual.current)), 300);
    if (ctx)
      ctx.current = {
        sucio: () => base.current !== null && JSON.stringify(actual.current) !== base.current,
        guardar: () => refGuardar.current(),
      };
    return () => {
      clearTimeout(t);
      if (ctx) ctx.current = null;
    };
  }, []);
}

// Usuario conectado (nombre y usuario), para avisar a los demás quién está
// editando un registro.
const usuarioEnSesion = { nombre: "", usuario: "" };

// Al editar un registro existente (bloqueo = { tabla, id }), a la izquierda
// de la × se muestra quién lo está editando. Si otra persona ya lo está
// editando, no se puede editar: se muestra un aviso y, cuando esa persona
// sale del cuadro o cierra la app, se cargan los datos más recientes y se
// habilita la edición.
function ModalFormulario({ onCerrar, children, bloqueo = null, onRecargado }) {
  const refCierre = useRef(null);
  const [preguntarCierre, setPreguntarCierre] = useState(false);
  const refIntentarCerrar = useRef(null);
  function intentarCerrar() {
    if (refCierre.current && refCierre.current.sucio()) setPreguntarCierre(true);
    else onCerrar();
  }
  refIntentarCerrar.current = intentarCerrar;
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function alTeclear(e) {
      if (e.key === "Escape") refIntentarCerrar.current();
    }
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.body.style.overflow = anterior;
      document.removeEventListener("keydown", alTeclear);
    };
  }, []);

  const clave = bloqueo && bloqueo.id != null ? `${bloqueo.tabla}:${bloqueo.id}` : null;
  const { estado, editor } = useBloqueoEdicion(clave, usuarioEnSesion);
  const [version, setVersion] = useState(0);
  const [recargando, setRecargando] = useState(false);
  const estuvoOcupado = useRef(false);
  useEffect(() => {
    if (estado === "ocupado") estuvoOcupado.current = true;
    if (estado === "propio" && estuvoOcupado.current) {
      // La otra persona terminó: se leen sus cambios antes de editar.
      estuvoOcupado.current = false;
      setRecargando(true);
      db.leerRegistro(bloqueo.tabla, bloqueo.id)
        .then((fila) => {
          if (fila) {
            window.dispatchEvent(new CustomEvent("ts-registro-recargado", { detail: { tabla: bloqueo.tabla, fila } }));
            if (onRecargado) onRecargado(fila);
          }
          setVersion((v) => v + 1);
        })
        .catch(() => {})
        .finally(() => setRecargando(false));
    }
  }, [estado]);

  const nombreEditor = editor ? editor.usuario || editor.nombre : "";
  return (
    <div className="ts-modal-form-fondo">
      <div className={"ts-modal-form" + (clave ? " ts-modal-con-editor" : "")} role="dialog" aria-modal="true">
        {clave && (
          <div className={"ts-modal-editor" + (estado === "ocupado" ? " ts-modal-editor-ocupado" : "")} title={editor && editor.usuario ? `Usuario: ${editor.usuario}` : undefined}>
            <span className="ts-modal-editor-punto" />
            {estado === "ocupado"
              ? `En edición: ${nombreEditor}`
              : estado === "verificando" || recargando
              ? "Comprobando…"
              : `Editando: ${nombreEditor}`}
          </div>
        )}
        <button type="button" className="ts-modal-form-cerrar" title="Cerrar" onClick={intentarCerrar}>
          <IconoFabCerrar />
        </button>
        {preguntarCierre && (
          <div className="ts-confirmar-cierre-fondo" onClick={() => setPreguntarCierre(false)}>
            <div className="ts-confirmar-cierre" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="ts-confirmar-cierre-titulo">¿Guardar los cambios?</div>
              <div className="ts-confirmar-cierre-texto">Hiciste cambios en este registro que aún no se guardaron.</div>
              <div className="ts-confirmar-cierre-botones">
                <button type="button" className="ts-btn-ghost ts-btn-descartar" onClick={onCerrar}>
                  Descartar
                </button>
                <button type="button" className="ts-btn-ghost" onClick={() => setPreguntarCierre(false)}>
                  Seguir editando
                </button>
                <button
                  type="button"
                  className="ts-btn"
                  onClick={() => {
                    setPreguntarCierre(false);
                    refCierre.current && refCierre.current.guardar();
                  }}
                >
                  Guardar cambios
                </button>
              </div>
            </div>
          </div>
        )}
        {estado === "ocupado" ? (
          <Panel titulo="Registro en edición">
            <div className="ts-edicion-ocupada">
              <div className="ts-edicion-ocupada-icono">
                <IconoLateral clave="trabajos" />
              </div>
              <div>
                <b>{(editor && editor.nombre) || nombreEditor}</b>
                {editor && editor.usuario && editor.usuario !== editor.nombre ? ` (${editor.usuario})` : ""} está editando este
                registro desde las {new Date(editor.desde).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}.
              </div>

              <div className="ts-form-acciones">
                <button type="button" className="ts-btn-ghost" onClick={onCerrar}>
                  Cerrar
                </button>
              </div>
            </div>
          </Panel>
        ) : recargando ? (
          <Panel titulo="Cargando datos actualizados…">
            <div className="ts-edicion-ocupada">Cargando los cambios guardados por la otra persona…</div>
          </Panel>
        ) : (
          <ContextoCierre.Provider value={refCierre}>
            <React.Fragment key={version}>{children}</React.Fragment>
          </ContextoCierre.Provider>
        )}
      </div>
    </div>
  );
}

// Descripción del trabajo en una sola línea corrida (sin guiones ni saltos),
// para mostrarla a continuación del título en las tablas.
function resumenDescripcion(texto) {
  return (texto || "")
    .split("\n")
    // Se omiten los subtítulos en mayúsculas (ya están en el título del trabajo)
    .filter((l) => !(l.trim() && l.trim() === l.trim().toUpperCase() && !/^\s*-/.test(l)))
    .map((l) => l.replace(/^\s*-\s*/, "").replace(/\.\s*$/, "").trim())
    .filter(Boolean)
    .join("; ");
}

// sinFechaTurnoGrupo: vista de la pestaña Trabajos, donde la fecha, el turno y
// el grupo ya se eligen en el filtro; así la columna Trabajo tiene más espacio.
// Tarjetas compactas de registros de aceite (solo celular): en dos líneas
// muestra equipo, fecha, turno, litros, operación, aceite, sistema, horario
// y personal.
// Etiquetas de color (las mismas de la vista de celular) para las tablas
function EtiquetaTurno({ turno }) {
  return (
    <span className={"ts-am-tag " + (turno === "dia" ? "ts-am-tag-dia" : "ts-am-tag-noche")}>
      {turno === "dia" ? "Día" : "Noche"}
    </span>
  );
}
function EtiquetaTipoTrabajo({ registro }) {
  if (registro.tipo_operacion === "derrame") return <span className="ts-texto-dim">—</span>;
  const prog = registro.tipo_trabajo === "programado";
  return <span className={"ts-am-tag " + (prog ? "ts-am-tag-prog" : "ts-am-tag-noprog")}>{prog ? "Programado" : "No programado"}</span>;
}
function EtiquetaRegistroAceite({ op }) {
  return (
    <span className={"ts-am-tag ts-am-tag-" + (TEXTO_OPERACION_ACEITE[op] ? op : "adicion")}>{textoOperacionAceite(op)}</span>
  );
}

function TarjetasAceiteMovil({ registros, onClick, onImprimir, onEliminar }) {
  return (
    <div className="ts-aceites-movil">
      {registros.map((a) => (
        <div
          key={a.id}
          className={"ts-am-card" + (onClick ? " ts-tm-card-clicable" : "")}
          onClick={onClick ? () => onClick(a) : undefined}
        >
          <div className="ts-am-fila1">
            <strong className="ts-am-equipo">{a.equipo}</strong>
            <span className="ts-am-fecha">{formatoFecha(a.fecha)}</span>
            <span className="ts-am-litros">
              {a.cantidad_litros === "" || a.cantidad_litros == null ? "—" : `${a.cantidad_litros} L`}
            </span>
            {(onImprimir || onEliminar) && (
              <span className="ts-acciones-fila" onClick={(e) => e.stopPropagation()}>
                {onImprimir && (
                  <button className="ts-btn-mini" title="Imprimir registro (PDF)" onClick={() => onImprimir(a)}>
                    <IconoImprimir />
                  </button>
                )}
                {onEliminar && (
                  <button className="ts-btn-mini ts-btn-mini-alerta" title="Eliminar registro" onClick={() => onEliminar(a)}>
                    <IconoEliminar />
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="ts-am-etiquetas">
            <span className={"ts-am-tag " + (a.turno === "dia" ? "ts-am-tag-dia" : "ts-am-tag-noche")}>
              {a.turno === "dia" ? "Día" : "Noche"}
            </span>
            {a.tipo_operacion !== "derrame" && (
              <span className={"ts-am-tag " + (a.tipo_trabajo === "programado" ? "ts-am-tag-prog" : "ts-am-tag-noprog")}>
                {a.tipo_trabajo === "programado" ? "Programado" : "No programado"}
              </span>
            )}
            <span className={"ts-am-tag ts-am-tag-" + (TEXTO_OPERACION_ACEITE[a.tipo_operacion] ? a.tipo_operacion : "adicion")}>
              {textoOperacionAceite(a.tipo_operacion)}
            </span>
          </div>
          <div className="ts-am-fila2">
            <strong>{a.tipo_aceite || "—"}</strong>
            {a.ubicacion ? ` · ${a.ubicacion}` : ""}
            {a.tipo_operacion === "derrame" ? (a.grupo ? ` · ${nombreGrupo(a.grupo)}` : "") : ` · ${a.sistema_equipo || "—"}`}
            {(a.hora_inicio || a.hora_fin) && ` · ${a.hora_inicio || "--:--"}-${a.hora_fin || "--:--"}`}
            {(a.participantes || []).length > 0 && ` · ${a.participantes.join(", ")}`}
            {a.horometro ? ` · Horóm. ${a.horometro}` : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marcadores de color para filas (estilo apps de correo)
// ---------------------------------------------------------------------------
// Colores por defecto; se pueden cambiar en Configuración → Aspecto.
// Los componentes usan las variables CSS --marca-<clave>.
const COLORES_MARCA_INICIAL = { rojo: "#e5484d", amarillo: "#f2b20f", verde: "#2fa36b" };
const MARCAS = [
  { clave: "rojo", texto: "Rojo", color: "var(--marca-rojo)" },
  { clave: "amarillo", texto: "Amarillo", color: "var(--marca-amarillo)" },
  { clave: "verde", texto: "Verde", color: "var(--marca-verde)" },
];
const TEXTO_FILTRO_MARCA = { todas: "Todas", rojo: "Rojo", amarillo: "Amarillo", verde: "Verde", marcadas: "Solo marcadas", ninguna: "Sin marca" };

function IconoBandera({ color }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 21V4M5 4h11l-2 4 2 4H5"
        style={{ fill: color || "none", stroke: color || "currentColor" }}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Botón de bandera a la izquierda de la fila: al tocarlo se elige el color
// (o se quita la marca). Sin onMarcar solo muestra la marca (lectura).
// Posición fija del menú de marcas junto al botón: así no queda recortado
// dentro de la tabla (p. ej. cuando hay una sola fila).
function posicionMenu(e, alto = 60) {
  const r = e.currentTarget.getBoundingClientRect();
  const abajo = window.innerHeight - r.bottom > alto + 12;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 230));
  return abajo ? { position: "fixed", top: r.bottom + 4, left, zIndex: 95 } : { position: "fixed", bottom: window.innerHeight - r.top + 4, left, zIndex: 95 };
}

function MarcadorFila({ marca, onMarcar }) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState(null);
  const actual = MARCAS.find((m) => m.clave === marca);
  if (!onMarcar) {
    return actual ? (
      <span className="ts-marcador" title={`Marca ${actual.texto}`}>
        <IconoBandera color={actual.color} />
      </span>
    ) : null;
  }
  return (
    <span className="ts-marcador-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={"ts-marcador" + (actual ? " ts-marcador-activo" : "")}
        title={actual ? `Marca ${actual.texto} · cambiar` : "Marcar"}
        onClick={(e) => {
          setPos(posicionMenu(e, 50));
          setAbierto((v) => !v);
        }}
      >
        <IconoBandera color={actual?.color} />
      </button>
      {abierto && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAbierto(false)} />
          <div className="ts-marcador-menu" style={pos || undefined}>
            {MARCAS.map((m) => (
              <button
                key={m.clave}
                type="button"
                title={m.texto}
                className={"ts-marcador-color" + (marca === m.clave ? " ts-marcador-color-activo" : "")}
                style={{ background: m.color }}
                onClick={() => {
                  onMarcar(marca === m.clave ? null : m.clave);
                  setAbierto(false);
                }}
              />
            ))}
            {marca && (
              <button
                type="button"
                className="ts-marcador-quitar"
                onClick={() => {
                  onMarcar(null);
                  setAbierto(false);
                }}
              >
                Quitar
              </button>
            )}
          </div>
        </>
      )}
    </span>
  );
}

// Filtro de marcas (en la cabecera de la columna Equipo y en el cuadro de
// filtros): Todas, Rojo, Amarillo, Verde, Solo marcadas o Sin marca.
function FiltroMarcas({ valor, onCambiar }) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState(null);
  const color = MARCAS.find((m) => m.clave === valor)?.color;
  return (
    <span className="ts-marcador-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={"ts-marcador ts-filtro-marca-btn" + (valor !== "todas" ? " ts-marcador-activo" : "")}
        title={`Filtrar por marca: ${TEXTO_FILTRO_MARCA[valor]}`}
        onClick={(e) => {
          setPos(posicionMenu(e, 240));
          setAbierto((v) => !v);
        }}
      >
        <IconoBandera color={color || (valor === "marcadas" ? "var(--amber)" : undefined)} />
        <span className="ts-filtro-marca-flecha">▾</span>
      </button>
      {abierto && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAbierto(false)} />
          <div className="ts-export-menu ts-filtro-marca-menu" style={pos || undefined}>
            {Object.entries(TEXTO_FILTRO_MARCA).map(([clave, texto]) => {
              const m = MARCAS.find((x) => x.clave === clave);
              return (
                <button
                  key={clave}
                  className={valor === clave ? "ts-opcion-activa" : ""}
                  onClick={() => {
                    onCambiar(clave);
                    setAbierto(false);
                  }}
                >
                  <span className="ts-punto-marca" style={{ background: m ? m.color : "transparent", borderColor: m ? m.color : "var(--text-dim)" }} />
                  {texto}
                </button>
              );
            })}
          </div>
        </>
      )}
    </span>
  );
}

function filtrarPorMarca(lista, filtro) {
  if (!filtro || filtro === "todas") return lista;
  if (filtro === "marcadas") return lista.filter((t) => t.marca);
  if (filtro === "ninguna") return lista.filter((t) => !t.marca);
  return lista.filter((t) => t.marca === filtro);
}

function TablaTrabajos({ filas, compacta, onFilaClick, onImprimir, onEliminar, sinFechaTurnoGrupo, onMarcar, filtroMarca, onFiltroMarca }) {
  const conPersonal = !compacta && sinFechaTurnoGrupo;
  // Quién está editando cada trabajo ahora mismo (se ve sin abrirlo).
  const ediciones = useEdicionesActivas();
  const editando = (t) => {
    const e = ediciones[`trabajos:${t.id}`];
    return e ? (
      <span className="ts-pill-editando" title={`${e.nombre || e.usuario} está editando este trabajo`}>
        ✎ {e.usuario || e.nombre}
      </span>
    ) : null;
  };
  if (filas.length === 0) {
    return (
      <div className="ts-vacio">
        Sin trabajos registrados con los filtros actuales.
        {onFiltroMarca && filtroMarca && filtroMarca !== "todas" && (
          <>
            {" "}
            <button type="button" className="ts-link-btn" onClick={() => onFiltroMarca("todas")}>
              Ver todas las marcas
            </button>
          </>
        )}
      </div>
    );
  }
  const mostrarAcciones = !compacta && (onImprimir || onEliminar);
  return (
    <>
    {/* Vista celular (Trabajos e Historial): tarjetas de color según estado
        del equipo, con equipo, ubicación y horario arriba y hasta 4 líneas
        de descripción. */}
    {!compacta && (
      <div className="ts-trabajos-movil">
        {filas.map((t) => {
          const ok = t.estado_final === "disponible";
          return (
            <div
              key={t.id}
              className={
                "ts-tm-card " +
                (ok ? "ts-tm-card-ok" : "ts-tm-card-alerta") +
                (onFilaClick ? " ts-tm-card-clicable" : "") +
                (t.marca ? ` ts-marca-${t.marca}` : "")
              }
              onClick={onFilaClick ? () => onFilaClick(t) : undefined}
            >
              <div className="ts-tm-cabecera">
                {!mostrarAcciones && t.marca && <MarcadorFila marca={t.marca} />}
                <div className="ts-tm-info">
                  {!sinFechaTurnoGrupo && (
                    <div className="ts-tm-fecha">
                      {formatoFecha(t.fecha)} · {textoTurno(t.turno)} · {nombreGrupo(t.grupo)}
                    </div>
                  )}
                  <div className="ts-tm-linea">
                    {t.ot && <span className="ts-tm-ot">OT {t.ot} · </span>}
                    <strong>{t.equipo}</strong>
                    {editando(t)}
                    {t.ubicacion && <> · {t.ubicacion}</>} ·{" "}
                    <span className="ts-tm-horario">
                      {t.hora_inicio || "--:--"} - {t.hora_fin || "--:--"}
                    </span>
                  </div>
                </div>
                {mostrarAcciones && (
                  <div className="ts-acciones-fila" onClick={(e) => e.stopPropagation()}>
                    {(onMarcar || t.marca) && (
                      <MarcadorFila marca={t.marca} onMarcar={onMarcar ? (m) => onMarcar(t.id, m) : undefined} />
                    )}
                    {onImprimir && (
                      <button className="ts-btn-mini" title="Imprimir registro (PDF)" onClick={() => onImprimir(t)}>
                        <IconoImprimir />
                      </button>
                    )}
                    {onEliminar && (
                      <button className="ts-btn-mini ts-btn-mini-alerta" title="Eliminar trabajo" onClick={() => onEliminar(t)}>
                        <IconoEliminar />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="ts-tm-trabajo">
                {t.sintoma_causa && <span className="ts-trabajo-titulo">{t.sintoma_causa}</span>}
                {resumenDescripcion(t.descripcion) && (
                  <span className="ts-trabajo-desc">
                    {t.sintoma_causa ? " — " : ""}
                    {resumenDescripcion(t.descripcion)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    )}
    <div className={"ts-tabla-wrap" + (!compacta ? " ts-trabajos-tabla" : "")}>
      {/* Pestaña Trabajos (vista de computadora): columna Personal con los
          usuarios seleccionados en el registro. */}
      <table
        className={
          "ts-tabla ts-tabla-cards" +
          (!compacta ? (sinFechaTurnoGrupo ? " ts-tabla-trabajos-amplia" : " ts-tabla-trabajos") : "")
        }
      >
        <thead>
          <tr>
            <th>
              <span className="ts-th-equipo">
                {onFiltroMarca && <FiltroMarcas valor={filtroMarca || "todas"} onCambiar={onFiltroMarca} />}
                {compacta ? "Equipo" : "OT"}
              </span>
            </th>
            {!compacta && <th>Equipo</th>}
            <th>Trabajo</th>
            {conPersonal && <th>Personal</th>}
            {!compacta && <th>Ubicación</th>}
            {!sinFechaTurnoGrupo && <th>Fecha</th>}
            {!sinFechaTurnoGrupo && <th>Turno</th>}
            {!compacta && !sinFechaTurnoGrupo && <th>Grupo</th>}
            {!compacta && <th>Horario</th>}
            <th>Estado</th>
            {mostrarAcciones && <th></th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((t) => (
            <React.Fragment key={t.id}>
            <tr
              className={(onFilaClick ? "ts-fila-clicable" : "") + (t.marca ? ` ts-marca-${t.marca}` : "")}
              onClick={onFilaClick ? () => onFilaClick(t) : undefined}
            >
              {/* Columna OT (a la izquierda de Equipo); la bandera de marca va
                  al inicio de la fila. */}
              <td className="ts-mono">
                <span className="ts-td-equipo">
                  {(onMarcar || onFiltroMarca || t.marca) && (
                    <MarcadorFila marca={t.marca} onMarcar={onMarcar ? (m) => onMarcar(t.id, m) : undefined} />
                  )}
                  {compacta ? t.equipo : t.ot || <span className="ts-texto-tenue">—</span>}
                </span>
              </td>
              {!compacta && (
                <td className="ts-mono">
                  {t.equipo}
                  {editando(t)}
                </td>
              )}
              <td>
                <div className="ts-clamp-2 ts-trabajo-celda" title={[t.sintoma_causa, t.descripcion].filter(Boolean).join("\n")}>
                  {t.sintoma_causa && <span className="ts-trabajo-titulo">{t.sintoma_causa}</span>}
                  {resumenDescripcion(t.descripcion) && (
                    <span className="ts-trabajo-desc">
                      {t.sintoma_causa ? " — " : ""}
                      {resumenDescripcion(t.descripcion)}
                    </span>
                  )}
                </div>
              </td>
              {conPersonal && (
                <td>
                  <div className="ts-clamp-2 ts-trabajo-personal" title={usuariosDoc(t.participantes).join(", ")}>
                    {usuariosDoc(t.participantes).join(", ") || <span className="ts-texto-tenue">—</span>}
                  </div>
                </td>
              )}
              {!compacta && <td><div className="ts-clamp-2" title={t.ubicacion || ""}>{t.ubicacion}</div></td>}
              {!sinFechaTurnoGrupo && <td className="ts-mono">{t.fecha}</td>}
              {!sinFechaTurnoGrupo && (
                <td>
                  <BadgeTurno turno={t.turno} />
                </td>
              )}
              {!compacta && !sinFechaTurnoGrupo && <td>{nombreGrupo(t.grupo)}</td>}
              {!compacta && (
                <td className="ts-mono">
                  {t.hora_inicio}–{t.hora_fin}
                </td>
              )}
              <td>
                <BadgeEstado estado={t.estado_final} />
              </td>
              {mostrarAcciones && (
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="ts-acciones-fila">
                    {onImprimir && (
                      <button
                        className="ts-btn-mini"
                        title="Imprimir registro (PDF)"
                        onClick={() => onImprimir(t)}
                      >
                        <IconoImprimir />
                      </button>
                    )}
                    {onEliminar && (
                      <button
                        className="ts-btn-mini ts-btn-mini-alerta"
                        title="Eliminar trabajo"
                        onClick={() => onEliminar(t)}
                      >
                        <IconoEliminar />
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function BadgeTurno({ turno }) {
  return (
    <span className={"ts-badge " + (turno === "dia" ? "ts-badge-dia" : "ts-badge-noche")}>
      {turno === "dia" ? "Día" : "Noche"}
    </span>
  );
}

// Estado del equipo como ícono: cuadro verde suave con "✓" (Disponible) o
// cuadro rojo suave con "✕" (No disponible). El texto queda en el tooltip y para
// lectores de pantalla.
// Columna "Verificaciones" de Aceites: solo en ADICIÓN. ✓ si se marcaron las
// tres verificaciones; ✕ si falta alguna. Cambio y derrame quedan en blanco.
function IconoVerificaciones({ registro }) {
  if (registro.tipo_operacion !== "adicion") return null;
  const v = registro.verificaciones || {};
  const faltan = VERIFICACIONES_ADICION.filter(([k]) => !v[k]).map(([, t]) => t);
  const ok = faltan.length === 0;
  const texto = ok ? "Se marcaron las tres verificaciones" : `Falta marcar: ${faltan.join("; ")}`;
  return (
    <span className={"ts-estado-icono " + (ok ? "ts-estado-icono-ok" : "ts-estado-icono-alerta")} title={texto} aria-label={texto} role="img">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ok ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7L7 17" />}
      </svg>
    </span>
  );
}

function BadgeEstado({ estado }) {
  const ok = estado === "disponible";
  const texto = ok ? "Disponible" : "No disponible";
  return (
    <span className={"ts-estado-icono " + (ok ? "ts-estado-icono-ok" : "ts-estado-icono-alerta")} title={texto} aria-label={texto} role="img">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ok ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7L7 17" />}
      </svg>
    </span>
  );
}

function Trabajos({ trabajos, onMarcar, puedeCrear, onCrear, onActualizar, onEliminar, filtros, setFiltros, personal, equipos, mostrarFiltros, trabajoAEditar, onEdicionExternaAbierta, impresoPor }) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState(null);

  // Abre directamente en modo edición un registro enviado desde otra vista
  // (p. ej. al tocar un equipo en "Equipos no disponibles" de Inicio).
  useEffect(() => {
    if (!trabajoAEditar) return;
    if (puedeCrear) {
      setEditando(trabajoAEditar);
      setMostrarForm(true);
    }
    if (onEdicionExternaAbierta) onEdicionExternaAbierta();
  }, [trabajoAEditar]);
  const [menuExportAbierto, setMenuExportAbierto] = useState(false);
  const [aEliminar, setAEliminar] = useState(null);
  // Filtros propios de la pestaña Trabajos: Equipo (solo los intervenidos
  // en la fecha/turno/flota filtrados) y Estado final del equipo.
  const [filtroEquipoT, setFiltroEquipoT] = useState("todos");
  const [filtroEstadoT, setFiltroEstadoT] = useState("todos");
  // Filtro de marcas de color (rojo / amarillo / verde)
  const [filtroMarcaT, setFiltroMarcaT] = useState("todas");
  const equiposIntervenidos = [...new Set(trabajos.map((t) => t.equipo))].sort(compararCodigosEquipo);
  useEffect(() => {
    if (filtroEquipoT !== "todos" && !equiposIntervenidos.includes(filtroEquipoT)) setFiltroEquipoT("todos");
  }, [equiposIntervenidos.join(",")]);
  const trabajosVista = trabajos
    .filter((t) => filtroEquipoT === "todos" || t.equipo === filtroEquipoT)
    .filter((t) => filtroEstadoT === "todos" || t.estado_final === filtroEstadoT);
  const trabajosMarcados = filtrarPorMarca(trabajosVista, filtroMarcaT);
  const ordenados = trabajosMarcados.slice().sort(compararPorHorarioDeTurno);
  const programados = ordenados.filter((t) => t.tipo_trabajo === "programado");
  const noProgramados = ordenados.filter((t) => t.tipo_trabajo === "no_programado");

  function abrirEdicion(registro) {
    if (!puedeCrear) return;
    setEditando(registro);
    setMostrarForm(true);
  }

  function cerrar() {
    setMostrarForm(false);
    setEditando(null);
  }

  function alternarFormulario() {
    if (mostrarForm) {
      cerrar();
    } else {
      setEditando(null);
      setMostrarForm(true);
    }
  }

  function exportar(formato) {
    setMenuExportAbierto(false);
    const filas = filasExportTrabajos(ordenados);
    if (formato === "excel") exportarExcel(filas, COLUMNAS_EXPORT_TRABAJOS, "trabajos");
    if (formato === "word") exportarWordReporteTurno(ordenados, impresoPor, "trabajos");
    if (formato === "pdf") imprimirReporteTurno(ordenados, impresoPor);
  }

  function formularioTrabajo(registro) {
    return (
      <FormularioTrabajo
        key={registro ? registro.id : "nuevo"}
        inicial={registro}
        personal={personal}
        equipos={equipos}
        onGuardar={(datos) => {
          if (registro) onActualizar(registro.id, datos);
          else onCrear(datos);
          cerrar();
        }}
      />
    );
  }

  function imprimirTrabajo(trabajo) {
    imprimirRegistroTrabajo(trabajo);
  }

  function confirmarEliminar() {
    if (aEliminar) onEliminar(aEliminar.id);
    setAEliminar(null);
  }

  return (
    <div className="ts-stack">
      <PopoverFiltros
        activos={hayFiltrosGenerales(filtros) || filtroEquipoT !== "todos" || filtroEstadoT !== "todos" || filtroMarcaT !== "todas"}
        resumen={[
          fechaCorta(filtros.fecha),
          TEXTO_TURNO[filtros.turno],
          filtros.flota !== "todos" && `Flota ${filtros.flota}`,
          filtroEquipoT !== "todos" && `Equipo ${filtroEquipoT}`,
          filtroEstadoT !== "todos" && (filtroEstadoT === "disponible" ? "Disponible" : "No disponible"),
          filtroMarcaT !== "todas" && `Marca: ${TEXTO_FILTRO_MARCA[filtroMarcaT]}`,
        ]}
      >
        <FiltrosBar
          filtros={filtros}
          setFiltros={setFiltros}
          equipos={equipos}
          mostrarEquipo={false}
          extraActivo={filtroEquipoT !== "todos" || filtroEstadoT !== "todos" || filtroMarcaT !== "todas"}
          onLimpiarExtra={() => {
            setFiltroEquipoT("todos");
            setFiltroEstadoT("todos");
            setFiltroMarcaT("todas");
          }}
          contenidoEquipo={
            <>
              <label className="ts-filtro">
                <span>Equipo</span>
                <select value={filtroEquipoT} onChange={(e) => setFiltroEquipoT(e.target.value)}>
                  <option value="todos">Todos ({equiposIntervenidos.length})</option>
                  {equiposIntervenidos.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ts-filtro">
                <span>Estado</span>
                <select value={filtroEstadoT} onChange={(e) => setFiltroEstadoT(e.target.value)}>
                  <option value="todos">Todos</option>
                  <option value="disponible">Disponible</option>
                  <option value="no_disponible">No disponible</option>
                </select>
              </label>
              <label className="ts-filtro">
                <span>Marca</span>
                <select value={filtroMarcaT} onChange={(e) => setFiltroMarcaT(e.target.value)}>
                  {Object.entries(TEXTO_FILTRO_MARCA).map(([clave, texto]) => (
                    <option key={clave} value={clave}>
                      {texto}
                    </option>
                  ))}
                </select>
              </label>
            </>
          }
        />
      </PopoverFiltros>

      <div className="ts-accion-row ts-accion-row-split">
        <div className="ts-export-dropdown">
          <button className="ts-btn ts-btn-exportar" title="Exportar" onClick={() => setMenuExportAbierto((v) => !v)}>
            <span className="ts-btn-texto">Exportar ▾</span>
            <span className="ts-fab-icono"><IconoFabExportar /></span>
          </button>
          {menuExportAbierto && (
            <>
              <div className="ts-overlay-cerrar" onClick={() => setMenuExportAbierto(false)} />
              <div className="ts-export-menu">
                <button onClick={() => exportar("pdf")}>Formato PDF</button>
                <button onClick={() => exportar("word")}>Formato Word</button>
                <button onClick={() => exportar("excel")}>Formato Excel</button>
              </div>
            </>
          )}
        </div>
        {puedeCrear && (
          <button
            className="ts-btn ts-btn-crear"
            title={mostrarForm ? "Cerrar formulario" : "Registrar trabajo"}
            onClick={alternarFormulario}
          >
            <span className="ts-btn-texto">{mostrarForm ? "Cerrar formulario" : "Registrar trabajo"}</span>
            <span className="ts-fab-icono">{mostrarForm ? <IconoFabCerrar /> : <IconoFabMas />}</span>
          </button>
        )}
      </div>

      {mostrarForm && (
        <ModalFormulario onCerrar={cerrar} bloqueo={editando ? { tabla: "trabajos", id: editando.id } : null} onRecargado={setEditando}>
          {formularioTrabajo(editando)}
        </ModalFormulario>
      )}

      <Panel titulo="Trabajos programados">
        <TablaTrabajos
          filas={programados}
          onMarcar={onMarcar}
          filtroMarca={filtroMarcaT}
          onFiltroMarca={setFiltroMarcaT}
          onFilaClick={puedeCrear ? abrirEdicion : undefined}
          onImprimir={imprimirTrabajo}
          onEliminar={puedeCrear ? setAEliminar : undefined}
          sinFechaTurnoGrupo
        />
      </Panel>
      <Panel titulo="Trabajos no programados">
        <TablaTrabajos
          filas={noProgramados}
          onMarcar={onMarcar}
          filtroMarca={filtroMarcaT}
          onFiltroMarca={setFiltroMarcaT}
          onFilaClick={puedeCrear ? abrirEdicion : undefined}
          onImprimir={imprimirTrabajo}
          onEliminar={puedeCrear ? setAEliminar : undefined}
          sinFechaTurnoGrupo
        />
      </Panel>

      {aEliminar && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAEliminar(null)} />
          <div className="ts-modal-confirmacion">
            <h3>¿Eliminar este trabajo?</h3>
            <p>
              Equipo <strong>{aEliminar.equipo}</strong> · {aEliminar.descripcion || "Sin descripción"} · {aEliminar.fecha}
              <br />
              Esta acción no se puede deshacer.
            </p>
            <div className="ts-modal-acciones">
              <button className="ts-btn-ghost" onClick={() => setAEliminar(null)}>
                Cancelar
              </button>
              <button className="ts-btn-confirmar-eliminar" onClick={confirmarEliminar}>
                Sí, eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FormularioTrabajo({ onGuardar, inicial, personal, equipos }) {
  const [form, setForm] = useState(() => {
    if (inicial) return { ...inicial, participantes: inicial.participantes || [], sintoma_causa: inicial.sintoma_causa || "" };
    return {
      equipo: equipos.find((e) => e.activo)?.codigo || "",
      tipo_trabajo: "no_programado",
      sintoma_causa: "",
      descripcion: "",
      ubicacion: "",
      // Fecha de ingreso y turno según la hora actual; grupo: el primero de la lista
      fecha: turnoOperativoActual().fecha,
      turno: turnoOperativoActual().turno,
      grupo: listaGrupos()[0] ? listaGrupos()[0].id : 1,
      hora_inicio: "",
      hora_fin: "",
      estado_final: "disponible",
      participantes: [],
      observaciones: "",
    };
  });

  // Flota del equipo elegido: define el subgrupo del personal participante.
  const flotaDelEquipo = equipos.find((e) => e.codigo === form.equipo)?.flota || "";

  function campo(nombre, valor) {
    setForm((prev) => ({ ...prev, [nombre]: valor }));
  }

  // Personal eventual de apoyo (nombre libre)
  const [apoyo, setApoyo] = useState("");
  function agregarApoyo() {
    const nombre = apoyo.trim().replace(/\s+/g, " ");
    if (!nombre) return;
    setForm((prev) =>
      prev.participantes.includes(nombre) ? prev : { ...prev, participantes: [...prev.participantes, nombre] }
    );
    setApoyo("");
  }

  function togglePersona(nombre) {
    setForm((prev) => {
      const yaEsta = prev.participantes.includes(nombre);
      return {
        ...prev,
        participantes: yaEsta
          ? prev.participantes.filter((p) => p !== nombre)
          : [...prev.participantes, nombre],
      };
    });
  }

  // Hora de fin anterior a la de inicio dentro del mismo turno (p. ej. noche
  // 00:50 → 00:13): es un error de digitación y alteraría los indicadores.
  const horasInvalidas = horasInvertidas(form.hora_inicio, form.hora_fin, form.turno);
  const [avisoHoras, setAvisoHoras] = useState(false);
  function enviar(e) {
    e.preventDefault();
    if (horasInvalidas) {
      setAvisoHoras(true);
      return;
    }
    const equipo = equipos.find((eq) => eq.codigo === form.equipo);
    onGuardar({ ...form, flota: equipo?.flota || "" });
  }
  // X o Escape con cambios sin guardar: preguntar.
  useConfirmarCierre(form, () => enviar({ preventDefault() {} }));

  return (
    <Panel titulo={inicial ? `Editar trabajo — ${inicial.equipo}` : "Nuevo registro de trabajo"} subtitulo={<SelloRegistro inicial={inicial} />}>
      <div className="ts-form" onKeyDown={(e) => enviarConEnter(e, enviar)}>
        <div className="ts-form-grid">
          <CampoSelect etiqueta="Equipo" valor={form.equipo} onChange={(v) => campo("equipo", v)}>
            {equipos.filter((e) => e.activo).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} · {e.flota}
              </option>
            ))}
          </CampoSelect>

          <CampoSelect
            etiqueta="Tipo de trabajo"
            valor={form.tipo_trabajo}
            onChange={(v) => campo("tipo_trabajo", v)}
          >
            <option value="programado">Programado</option>
            <option value="no_programado">No programado</option>
          </CampoSelect>

          <CampoTexto etiqueta="Fecha de ingreso" tipo="date" valor={form.fecha} onChange={(v) => campo("fecha", v)} />

          <CampoSelect etiqueta="Turno" className="ts-select-acento" valor={form.turno} onChange={(v) => campo("turno", v)}>
            <option value="dia">Día</option>
            <option value="noche">Noche</option>
          </CampoSelect>

          <CampoSelect etiqueta="Grupo" className="ts-select-acento" valor={form.grupo} onChange={(v) => campo("grupo", Number(v))}>
            {listaGrupos().map((g) => (
              <option key={g.id} value={g.id}>
                {g.nombre}
              </option>
            ))}
          </CampoSelect>

          <CampoTexto etiqueta="Ubicación" valor={form.ubicacion} onChange={(v) => campo("ubicacion", v)} />
          <CampoTexto etiqueta="Hora de inicio" tipo="time" valor={form.hora_inicio} onChange={(v) => campo("hora_inicio", v)} />
          <CampoTexto etiqueta="Hora de finalización" tipo="time" valor={form.hora_fin} onChange={(v) => campo("hora_fin", v)} />

          <div className="ts-campo">
            <span>Tiempo de trabajo</span>
            <div className={"ts-tiempo-calculado" + (horasInvalidas ? " ts-tiempo-invalido" : "")}>
              {horasInvalidas ? "Revisar horas" : calcularTiempoTrabajo(form.hora_inicio, form.hora_fin)}
            </div>
            {horasInvalidas && (
              <span className={"ts-aviso-horas" + (avisoHoras ? " ts-aviso-horas-fuerte" : "")}>
                La hora de finalización es anterior a la de inicio en este turno.
              </span>
            )}
          </div>

          <CampoSelect
            etiqueta="Estado final del equipo"
            className={form.estado_final === "no_disponible" ? "ts-select-estado-alerta" : "ts-select-estado-ok"}
            valor={form.estado_final}
            onChange={(v) => campo("estado_final", v)}
          >
            <option value="disponible">Disponible</option>
            <option value="no_disponible">No disponible</option>
          </CampoSelect>
          <CampoTexto etiqueta="OT" valor={form.ot || ""} onChange={(v) => campo("ot", v)} placeholder="Orden de trabajo" />
        </div>

        <label className="ts-campo ts-campo-full">
          <span>Falla del equipo</span>
          <AreaTexto
            rows={2}
            value={form.sintoma_causa}
            onChange={(e) => campo("sintoma_causa", e.target.value)}
            placeholder="Descripción del fallo"
          />
        </label>

        <label className="ts-campo ts-campo-full">
          <span>Descripción del trabajo</span>
          <AreaTexto
            rows={2}
            value={form.descripcion}
            onChange={(e) => campo("descripcion", e.target.value)}
            placeholder="Detalle de la intervención realizada"
          />
        </label>

        <div className="ts-campo ts-campo-full">
          <span>Personal participante</span>
          <div className="ts-chips-select">
            {/* Personal del grupo + participantes ya guardados que no están en la
                lista (p. ej. nombres cargados desde reportes de turno). */}
            {[...new Set([...personalPorGrupo(personal, form.grupo, flotaDelEquipo), ...form.participantes])].map((p) => (
              <button
                type="button"
                key={p}
                className={"ts-chip" + (form.participantes.includes(p) ? " ts-chip-activo" : "")}
                onClick={() => togglePersona(p)}
                title={p}
              >
                {etiquetaPersona(personal, p)}
              </button>
            ))}
          </div>
          <span className="ts-campo-ayuda">
            Mostrando {nombreGrupo(form.grupo)}
            {["conjunto", "todas"].includes((grupoPorId(form.grupo) || {}).alcance) ? " – todas las flotas" : flotaDelEquipo ? ` – ${flotaDelEquipo}` : ""}.
          </span>
          {/* Personal eventual de apoyo: nombre escrito a mano. Queda como
              participante (chip marcado); tocar el chip lo quita. */}
          <div className="ts-apoyo">
            <input
              type="text"
              value={apoyo}
              placeholder="Personal de apoyo"
              aria-label="Personal de apoyo"
              onChange={(e) => setApoyo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  agregarApoyo();
                }
              }}
            />
            <button type="button" className="ts-btn-icono" onClick={agregarApoyo} disabled={!apoyo.trim()}>
              + Agregar
            </button>
          </div>
        </div>

        <label className="ts-campo ts-campo-full">
          <span>Síntoma y causa de la falla</span>
          <AreaTexto
            rows={2}
            value={form.observaciones}
            onChange={(e) => campo("observaciones", e.target.value)}
            placeholder="Qué síntoma presentaba el equipo y a qué se debió la falla"
          />
        </label>

        <div className="ts-form-acciones">
          <button type="button" className="ts-btn" onClick={enviar}>
            {inicial ? "Guardar cambios" : "Guardar trabajo"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Vista: Aceites
// ---------------------------------------------------------------------------

function Aceites({ registros, puedeCrear, puedeAdicion = true, puedeDerrame = true, onCrear, onActualizar, onEliminar, tiposAceite, sistemasEquipo, personal, equipos, mostrarFiltros }) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const [menuExportAbierto, setMenuExportAbierto] = useState(false);
  const [filtroEquipo, setFiltroEquipo] = useState("todos");
  // Fecha de ingreso y turno por defecto: los del turno operativo actual,
  // igual que en "Registrar trabajo" (06:00–17:59 Día de hoy; 18:00–23:59
  // Noche de hoy; 00:00–05:59 Noche con fecha de ayer).
  const [filtroFecha, setFiltroFecha] = useState(() => turnoOperativoActual().fecha);
  const [filtroOperacion, setFiltroOperacion] = useState("todas");
  const [filtroTipoAceite, setFiltroTipoAceite] = useState("todos");
  const [filtroTurno, setFiltroTurno] = useState(() => turnoOperativoActual().turno);

  // Un derrame lo puede editar quien tenga "Registrar derrame de aceite";
  // una adición o cambio, quien tenga "Registrar adiciones/cambios".
  function puedeEditar(registro) {
    return registro && registro.tipo_operacion === "derrame" ? puedeDerrame : puedeAdicion;
  }
  function abrirEdicion(registro) {
    if (!puedeCrear || !puedeEditar(registro)) return;
    setEditando(registro);
    setMostrarForm(true);
  }

  function cerrar() {
    setMostrarForm(false);
    setEditando(null);
  }

  function alternarFormulario() {
    if (mostrarForm) {
      cerrar();
    } else {
      setEditando(null);
      setMostrarForm(true);
    }
  }

  function confirmarEliminar() {
    if (aEliminar) onEliminar(aEliminar.id);
    setAEliminar(null);
  }

  const textoBotonAceite = puedeAdicion ? (puedeDerrame ? "Registrar adición / cambio / derrame" : "Registrar adición / cambio") : "Registrar derrame";

  function formularioAceite(registro) {
    return (
      <FormularioAceite
        key={registro ? registro.id : "nuevo"}
        inicial={registro}
        tiposAceite={tiposAceite}
        sistemasEquipo={sistemasEquipo}
        personal={personal}
        equipos={equipos}
        puedeAdicion={puedeAdicion}
        puedeDerrame={puedeDerrame}
        onGuardar={(datos) => {
          if (registro) onActualizar(registro.id, datos);
          else onCrear(datos);
          cerrar();
        }}
      />
    );
  }

  const registrosFiltrados = registros
    .filter((a) => filtroEquipo === "todos" || a.equipo === filtroEquipo)
    .filter((a) => !filtroFecha || a.fecha === filtroFecha)
    .filter((a) => filtroOperacion === "todas" || a.tipo_operacion === filtroOperacion)
    .filter((a) => filtroTipoAceite === "todos" || a.tipo_aceite === filtroTipoAceite)
    .filter((a) => filtroTurno === "todos" || a.turno === filtroTurno);

  const hayFiltrosActivos =
    filtroEquipo !== "todos" ||
    filtroFecha ||
    filtroOperacion !== "todas" ||
    filtroTipoAceite !== "todos" ||
    filtroTurno !== "todos";

  function limpiarFiltros() {
    setFiltroEquipo("todos");
    setFiltroFecha("");
    setFiltroOperacion("todas");
    setFiltroTipoAceite("todos");
    setFiltroTurno("todos");
  }

  function exportar(formato) {
    setMenuExportAbierto(false);
    const filas = filasExportAceites(registrosFiltrados);
    if (formato === "excel") exportarExcel(filas, COLUMNAS_EXPORT_ACEITES, "aceites");
    if (formato === "word") exportarWord(filas, COLUMNAS_EXPORT_ACEITES, "aceites", "Registros de aceite");
    if (formato === "pdf") exportarPDF(filas, COLUMNAS_EXPORT_ACEITES, "Registros de aceite");
  }

  return (
    <div className="ts-stack">
      <PopoverFiltros
        activos={!!hayFiltrosActivos}
        resumen={[
          fechaCorta(filtroFecha),
          filtroEquipo !== "todos" && `Equipo ${filtroEquipo}`,
          filtroOperacion !== "todas" && textoOperacionAceite(filtroOperacion),
          filtroTipoAceite !== "todos" && filtroTipoAceite,
          TEXTO_TURNO[filtroTurno],
        ]}
      >
      <div className="ts-filtros">
        <label className="ts-filtro">
          <span>Equipo</span>
          <select value={filtroEquipo} onChange={(e) => setFiltroEquipo(e.target.value)}>
            <option value="todos">Todos</option>
            {equipos.filter((eq) => eq.activo).map((eq) => (
              <option key={eq.codigo} value={eq.codigo}>
                {eq.codigo}
              </option>
            ))}
          </select>
        </label>
        <label className="ts-filtro">
          <span>Fecha</span>
          <input type="date" value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)} />
        </label>
        <label className="ts-filtro">
          <span>Turno</span>
          <select value={filtroTurno} onChange={(e) => setFiltroTurno(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="dia">Día</option>
            <option value="noche">Noche</option>
          </select>
        </label>
        <label className="ts-filtro">
          <span>Tipo de registro</span>
          <select value={filtroOperacion} onChange={(e) => setFiltroOperacion(e.target.value)}>
            <option value="todas">Todas</option>
            <option value="adicion">Adición</option>
            <option value="cambio">Cambio</option>
            <option value="derrame">Derrame</option>
          </select>
        </label>
        <label className="ts-filtro">
          <span>Tipo de aceite</span>
          <select value={filtroTipoAceite} onChange={(e) => setFiltroTipoAceite(e.target.value)}>
            <option value="todos">Todos</option>
            {tiposAceite.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {hayFiltrosActivos && (
          <button className="ts-btn-ghost" onClick={limpiarFiltros}>
            Limpiar filtros
          </button>
        )}
      </div>
      </PopoverFiltros>

      <div className="ts-accion-row ts-accion-row-split">
        <div className="ts-export-dropdown">
          <button className="ts-btn ts-btn-exportar" title="Exportar" onClick={() => setMenuExportAbierto((v) => !v)}>
            <span className="ts-btn-texto">Exportar ▾</span>
            <span className="ts-fab-icono"><IconoFabExportar /></span>
          </button>
          {menuExportAbierto && (
            <>
              <div className="ts-overlay-cerrar" onClick={() => setMenuExportAbierto(false)} />
              <div className="ts-export-menu">
                <button onClick={() => exportar("pdf")}>Formato PDF</button>
                <button onClick={() => exportar("word")}>Formato Word</button>
                <button onClick={() => exportar("excel")}>Formato Excel</button>
              </div>
            </>
          )}
        </div>
        {puedeCrear && (
          <button
            className="ts-btn ts-btn-crear"
            title={mostrarForm ? "Cerrar formulario" : textoBotonAceite}
            onClick={alternarFormulario}
          >
            <span className="ts-btn-texto">{mostrarForm ? "Cerrar formulario" : textoBotonAceite}</span>
            <span className="ts-fab-icono">{mostrarForm ? <IconoFabCerrar /> : <IconoFabMas />}</span>
          </button>
        )}
      </div>

      {mostrarForm && (
        <ModalFormulario onCerrar={cerrar} bloqueo={editando ? { tabla: "aceites", id: editando.id } : null} onRecargado={setEditando}>
          {formularioAceite(editando)}
        </ModalFormulario>
      )}

      <Panel titulo="Registros de aceite">
        {registrosFiltrados.length === 0 ? (
          <div className="ts-vacio">Sin registros con los filtros actuales.</div>
        ) : (
          <>
          <TarjetasAceiteMovil
            registros={registrosFiltrados}
            onClick={puedeCrear ? abrirEdicion : undefined}
            onImprimir={imprimirRegistroAceite}
            onEliminar={puedeCrear ? (a) => puedeEditar(a) && setAEliminar(a) : undefined}
          />
          <div className="ts-tabla-wrap ts-aceites-tabla">
            <table className="ts-tabla ts-tabla-cards">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th>Fecha</th>
                  <th>Turno</th>
                  <th>Tipo de trabajo</th>
                  <th>Registro</th>
                  <th>Ubicación</th>
                  <th>Tipo de aceite</th>
                  <th>Sistema</th>
                  <th>Litros</th>
                  <th>Horómetro</th>
                  <th>Horario</th>
                  <th className="ts-col-verif">Verificaciones</th>
                  <th>Personal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {registrosFiltrados.map((a) => (
                  <React.Fragment key={a.id}>
                  <tr
                    className={puedeCrear ? "ts-fila-clicable" : ""}
                    onClick={puedeCrear ? () => abrirEdicion(a) : undefined}
                  >
                    <td className="ts-mono">{a.equipo}</td>
                    <td className="ts-mono">{a.fecha}</td>
                    <td>
                      <EtiquetaTurno turno={a.turno} />
                    </td>
                    <td>
                      <EtiquetaTipoTrabajo registro={a} />
                    </td>
                    <td>
                      <EtiquetaRegistroAceite op={a.tipo_operacion} />
                    </td>
                    <td><div className="ts-clamp-2">{a.ubicacion || "—"}</div></td>
                    <td><div className="ts-clamp-2">{a.tipo_aceite}</div></td>
                    <td><div className="ts-clamp-2">{a.sistema_equipo}</div></td>
                    <td className="ts-mono">{a.cantidad_litros === "" || a.cantidad_litros == null ? "—" : `${a.cantidad_litros} L`}</td>
                    <td className="ts-mono">{a.horometro}</td>
                    <td className="ts-mono">{a.hora_inicio || "—"}{a.hora_fin ? `–${a.hora_fin}` : ""}</td>
                    <td className="ts-col-verif">
                      <IconoVerificaciones registro={a} />
                    </td>
                    <td><div className="ts-clamp-2">{(a.participantes || []).join(", ") || "—"}</div></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="ts-acciones-fila">
                        <button
                          className="ts-btn-mini"
                          title="Imprimir registro (PDF)"
                          onClick={() => imprimirRegistroAceite(a)}
                        >
                          <IconoImprimir />
                        </button>
                        {puedeCrear && puedeEditar(a) && (
                          <button
                            className="ts-btn-mini ts-btn-mini-alerta"
                            title="Eliminar registro"
                            onClick={() => setAEliminar(a)}
                          >
                            <IconoEliminar />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Panel>

      {aEliminar && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAEliminar(null)} />
          <div className="ts-modal-confirmacion">
            <h3>¿Eliminar este registro de aceite?</h3>
            <p>
              Equipo <strong>{aEliminar.equipo}</strong> · {textoOperacionAceite(aEliminar.tipo_operacion)} de {aEliminar.tipo_aceite} · {aEliminar.fecha}
              <br />
              Esta acción no se puede deshacer.
            </p>
            <div className="ts-modal-acciones">
              <button className="ts-btn-ghost" onClick={() => setAEliminar(null)}>
                Cancelar
              </button>
              <button className="ts-btn-confirmar-eliminar" onClick={confirmarEliminar}>
                Sí, eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Verificaciones obligatorias antes de registrar una ADICIÓN de aceite
// (evitan adiciones repetidas). Se guardan con el registro.
const VERIFICACIONES_ADICION = [
  ["pm", "Se verificó fecha de próximo PM"],
  ["adiciones", "Se verificó últimas adiciones del aceite"],
  ["supervision", "Se coordinó con supervisión la adición de aceite"],
];

function FormularioAceite({ onGuardar, inicial, tiposAceite, sistemasEquipo, personal, equipos, puedeAdicion = true, puedeDerrame = true }) {
  const [form, setForm] = useState(
    inicial
      ? { ...inicial, participantes: inicial.participantes || [], hora_inicio: inicial.hora_inicio || "", hora_fin: inicial.hora_fin || "", tipo_trabajo: inicial.tipo_trabajo || "no_programado", grupo: inicial.grupo ?? listaGrupos()[0]?.id ?? 1 }
      : {
          equipo: equipos.find((e) => e.activo)?.codigo || "",
          tipo_trabajo: "no_programado",
          fecha: turnoOperativoActual().fecha,
          turno: turnoOperativoActual().turno,
          tipo_operacion: puedeAdicion ? "adicion" : "derrame",
          ubicacion: "",
          grupo: listaGrupos()[0]?.id ?? 1,
          tipo_aceite: tiposAceite[0] || "",
          sistema_equipo: sistemasEquipo[0] || "",
          cantidad_litros: "",
          horometro: "",
          hora_inicio: "",
          hora_fin: "",
          participantes: [],
          observaciones: "",
        }
  );


  function campo(nombre, valor) {
    setForm((prev) => ({ ...prev, [nombre]: valor }));
  }

  function togglePersona(nombre) {
    setForm((prev) => {
      const yaEsta = prev.participantes.includes(nombre);
      return {
        ...prev,
        participantes: yaEsta
          ? prev.participantes.filter((p) => p !== nombre)
          : [...prev.participantes, nombre],
      };
    });
  }

  // Personal eventual de apoyo (nombre libre), igual que en Trabajos.
  const [apoyo, setApoyo] = useState("");
  function agregarApoyo() {
    const nombre = apoyo.trim().replace(/\s+/g, " ");
    if (!nombre) return;
    setForm((prev) =>
      prev.participantes.includes(nombre) ? prev : { ...prev, participantes: [...prev.participantes, nombre] }
    );
    setApoyo("");
  }

  const esDerrame = form.tipo_operacion === "derrame";
  const flotaEquipo = equipos.find((eq) => eq.codigo === form.equipo)?.flota || "";
  // Al pasar entre derrame y adición/cambio, el personal elegido ya no
  // corresponde (Lubrico vs. grupo del turno), así que se limpia.
  function cambiarOperacion(v) {
    setForm((prev) => ({
      ...prev,
      tipo_operacion: v,
      participantes: (prev.tipo_operacion === "derrame") === (v === "derrame") ? prev.participantes : [],
    }));
  }
  const opcionesPersonal = esDerrame
    ? [...new Set([...personalPorGrupo(personal, form.grupo, flotaEquipo), ...form.participantes])]
    : personalLubricacion(personal);

  const esAdicion = form.tipo_operacion === "adicion";
  const verificaciones = form.verificaciones || {};
  // Obligatorias al registrar una adición nueva (o al cambiar un registro a adición).
  const exigirVerificaciones = esAdicion && (!inicial || inicial.tipo_operacion !== "adicion" || !!inicial.verificaciones);
  const faltanVerificaciones = exigirVerificaciones && VERIFICACIONES_ADICION.some(([k]) => !verificaciones[k]);
  const [avisoVerificar, setAvisoVerificar] = useState(false);
  function marcarVerificacion(k, v) {
    setAvisoVerificar(false);
    setForm((prev) => ({ ...prev, verificaciones: { ...(prev.verificaciones || {}), [k]: v } }));
  }

  function enviar(e) {
    e.preventDefault();
    if (faltanVerificaciones) {
      setAvisoVerificar(true);
      return;
    }
    const equipo = equipos.find((eq) => eq.codigo === form.equipo);
    // El derrame se guarda en la misma tabla que adiciones y cambios; los
    // campos que no aplican quedan vacíos.
    const extra = esDerrame
      ? { tipo_trabajo: null, sistema_equipo: "", horometro: "", hora_inicio: "", hora_fin: "" }
      : {};
    onGuardar({
      ...form,
      ...extra,
      flota: equipo?.flota || "",
      cantidad_litros: form.cantidad_litros === "" ? 0 : Number(form.cantidad_litros),
      horometro: esDerrame ? "" : form.horometro === "" ? 0 : Number(form.horometro),
    });
  }
  // X o Escape con cambios sin guardar: preguntar.
  useConfirmarCierre(form, () => enviar({ preventDefault() {} }));

  return (
    <Panel
      titulo={
        inicial
          ? `Editar ${esDerrame ? "derrame" : "registro"} de aceite — ${inicial.equipo}`
          : esDerrame
          ? "Nuevo registro de derrame de aceite"
          : "Nuevo registro de aceite"
      }
      subtitulo={<SelloRegistro inicial={inicial} />}
    >
      <div className="ts-form" onKeyDown={(e) => enviarConEnter(e, enviar)}>
        <div className="ts-campo ts-campo-full ts-tipo-registro">
          <span>Tipo de registro</span>
          <div className="ts-segmento" role="tablist">
            {[
              ["adicion", "Adición", puedeAdicion],
              ["cambio", "Cambio", puedeAdicion],
              ["derrame", "Derrame", puedeDerrame],
            ]
              .filter(([clave, , permitido]) => permitido || form.tipo_operacion === clave)
              .map(([clave, texto]) => (
                <button
                  key={clave}
                  type="button"
                  role="tab"
                  aria-selected={form.tipo_operacion === clave}
                  className={"ts-segmento-op" + (form.tipo_operacion === clave ? " activo" : "")}
                  onClick={() => cambiarOperacion(clave)}
                >
                  {texto}
                </button>
              ))}
          </div>
        </div>
        {/* Solo en ADICIÓN: verificaciones que el personal de Lubrico debe
            marcar antes de guardar. Ocupa dos columnas de la misma grilla
            que los campos de abajo, para quedar alineado con ellos. */}
        {esAdicion && (
          <div className="ts-form-grid ts-grid-verificaciones">
            <div className={"ts-verificaciones" + (avisoVerificar ? " ts-verificaciones-aviso" : "")}>
              <span className="ts-verificaciones-titulo">Verificaciones antes de la adición</span>
              {VERIFICACIONES_ADICION.map(([k, texto]) => (
                <label key={k} className="ts-verificacion">
                  <span>{texto}</span>
                  <input type="checkbox" checked={!!verificaciones[k]} onChange={(e) => marcarVerificacion(k, e.target.checked)} />
                </label>
              ))}
              {avisoVerificar && <span className="ts-verificaciones-error">Marca las tres verificaciones para registrar la adición.</span>}
            </div>
          </div>
        )}
        <div className="ts-form-grid">
          <CampoSelect etiqueta="Equipo" valor={form.equipo} onChange={(v) => campo("equipo", v)}>
            {equipos.filter((e) => e.activo).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} · {e.flota}
              </option>
            ))}
          </CampoSelect>

          {!esDerrame && (
            <CampoSelect
              etiqueta="Tipo de trabajo"
              valor={form.tipo_trabajo}
              onChange={(v) => campo("tipo_trabajo", v)}
            >
              <option value="programado">Programado</option>
              <option value="no_programado">No programado</option>
            </CampoSelect>
          )}

          <CampoTexto etiqueta="Fecha de ingreso" tipo="date" valor={form.fecha} onChange={(v) => campo("fecha", v)} />

          {esDerrame && (
            <CampoSelect etiqueta="Grupo" valor={form.grupo} onChange={(v) => campo("grupo", Number(v))}>
              {listaGrupos().map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nombre}
                </option>
              ))}
            </CampoSelect>
          )}

          <CampoSelect etiqueta="Turno" valor={form.turno} onChange={(v) => campo("turno", v)}>
            <option value="dia">Día</option>
            <option value="noche">Noche</option>
          </CampoSelect>

          <CampoTexto etiqueta="Ubicación" valor={form.ubicacion || ""} onChange={(v) => campo("ubicacion", v)} />

          <CampoSelect
            etiqueta="Tipo de aceite"
            valor={form.tipo_aceite}
            onChange={(v) => campo("tipo_aceite", v)}
          >
            {tiposAceite.length === 0 && <option value="">Sin tipos configurados</option>}
            {tiposAceite.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </CampoSelect>

          {!esDerrame && (
            <CampoSelect
              etiqueta="Sistema del equipo"
              valor={form.sistema_equipo}
              onChange={(v) => campo("sistema_equipo", v)}
            >
              {sistemasEquipo.length === 0 && <option value="">Sin sistemas configurados</option>}
              {sistemasEquipo.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </CampoSelect>
          )}

          <CampoTexto
            etiqueta={esDerrame ? "Cantidad derramada (litros)" : "Cantidad (litros)"}
            tipo="number"
            valor={form.cantidad_litros}
            onChange={(v) => campo("cantidad_litros", v)}
          />

          {!esDerrame && (
            <>
              <CampoTexto etiqueta="Horómetro" tipo="number" valor={form.horometro} onChange={(v) => campo("horometro", v)} />
              <CampoTexto etiqueta="Hora de inicio" tipo="time" valor={form.hora_inicio} onChange={(v) => campo("hora_inicio", v)} />
              <CampoTexto etiqueta="Hora de finalización" tipo="time" valor={form.hora_fin} onChange={(v) => campo("hora_fin", v)} />
              <div className="ts-campo">
                <span>Tiempo de trabajo</span>
                <div className="ts-tiempo-calculado">{calcularTiempoTrabajo(form.hora_inicio, form.hora_fin)}</div>
              </div>
            </>
          )}
        </div>

        <div className="ts-campo ts-campo-full">
          <span>Personal participante</span>
          <div className="ts-chips-select">
            {opcionesPersonal.map((p) => (
              <button
                type="button"
                key={p}
                className={"ts-chip" + (form.participantes.includes(p) ? " ts-chip-activo" : "")}
                onClick={() => togglePersona(p)}
                title={p}
              >
                {etiquetaPersona(personal, p)}
              </button>
            ))}
          </div>
          <span className="ts-campo-ayuda">
            {esDerrame
              ? `Mostrando ${nombreGrupo(form.grupo)}${["conjunto", "todas"].includes((grupoPorId(form.grupo) || {}).alcance) ? " – todas las flotas" : flotaEquipo ? ` – ${flotaEquipo}` : ""}.`
              : `Solo personal del grupo ${tituloSeccion("lubrico")} está autorizado para esta operación.`}
          </span>
          {/* Derrame: personal eventual de apoyo escrito a mano, igual que en
              el registro de trabajo. Queda como participante (chip marcado). */}
          {esDerrame && (
            <div className="ts-apoyo">
              <input
                type="text"
                value={apoyo}
                placeholder="Personal de apoyo"
                aria-label="Personal de apoyo"
                onChange={(e) => setApoyo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    agregarApoyo();
                  }
                }}
              />
              <button type="button" className="ts-btn-icono" onClick={agregarApoyo} disabled={!apoyo.trim()}>
                + Agregar
              </button>
            </div>
          )}
        </div>

        <label className="ts-campo ts-campo-full">
          <span>Observaciones</span>
          <AreaTexto rows={2} value={form.observaciones} onChange={(e) => campo("observaciones", e.target.value)} />
        </label>

        <div className="ts-form-acciones">
          <button type="button" className="ts-btn" onClick={enviar}>
            {inicial ? "Guardar cambios" : "Guardar registro"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Vista: Requerimientos
// ---------------------------------------------------------------------------

function Requerimientos({
  registros,
  puedeCrear,
  puedeAprobar,
  puedeAvanzarCompra,
  onCrear,
  onActualizar,
  onEliminar,
  onCambiarEstado: cambiarEstado,
  personal,
  solicitantesAutorizados = [],
  solicitanteActual,
  equipos,
  mostrarFiltros,
  esAdmin = false,
  usuarioActual = "",
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const [almacenAbierto, setAlmacenAbierto] = useState(false);
  // Cambio de estado pendiente de confirmar: { req, estado }
  const [cambioPedido, setCambioPedido] = useState(null);
  const onCambiarEstado = (id, estado) => {
    const req = registros.find((r) => r.id === id);
    if (req && estado !== req.estado) setCambioPedido({ req, estado });
  };
  // Solo se edita mientras está "Pendiente de aprobación".
  const editable = (r) => puedeCrear && r.estado === "pendiente_aprobacion";

  function abrirEdicion(registro) {
    if (!editable(registro)) return;
    setEditando(registro);
    setMostrarForm(true);
  }
  // Clic en la fila: si aún se puede editar, abre el formulario; si no, un
  // cuadro con toda la información del proceso.
  const [detalleId, setDetalleId] = useState(null);
  const detalle = detalleId ? registros.find((r) => r.id === detalleId) : null;
  function abrirFila(r) {
    if (editable(r)) abrirEdicion(r);
    else setDetalleId(r.id);
  }

  function cerrar() {
    setMostrarForm(false);
    setEditando(null);
  }

  function alternarFormulario() {
    if (mostrarForm) {
      cerrar();
    } else {
      setEditando(null);
      setMostrarForm(true);
    }
  }

  function confirmarEliminar() {
    if (aEliminar) onEliminar(aEliminar.id);
    setAEliminar(null);
  }

  const [menuExportAbierto, setMenuExportAbierto] = useState(false);
  const [filtroEquipo, setFiltroEquipo] = useState("todos");
  const [filtroParte, setFiltroParte] = useState("");
  const [filtroFlota, setFiltroFlota] = useState("todas");
  const [filtroFecha, setFiltroFecha] = useState(HOY);
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroSolicitante, setFiltroSolicitante] = useState("todos");
  // Solicitantes que aparecen en los requerimientos, ordenados alfabéticamente
  const solicitantes = [...new Set(registros.map((r) => r.solicitante).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  function formularioRequerimiento(registro) {
    return (
      <FormularioRequerimiento
        key={registro ? registro.id : "nuevo"}
        inicial={registro}
        personal={personal}
        solicitantes={solicitantesAutorizados}
        solicitanteActual={solicitanteActual}
        equipos={equipos}
        onGuardar={(datos) => {
          if (registro) onActualizar(registro.id, datos);
          else onCrear(datos);
          cerrar();
        }}
      />
    );
  }

  const registrosFiltrados = registros
    .filter((r) => filtroEquipo === "todos" || r.equipo === filtroEquipo)
    .filter((r) => !filtroParte.trim() || (r.numero_parte || "").toLowerCase().includes(filtroParte.trim().toLowerCase()))
    .filter((r) => filtroFlota === "todas" || r.flota === filtroFlota)
    .filter((r) => !filtroFecha || r.fecha_solicitud === filtroFecha)
    .filter((r) => filtroEstado === "todos" || r.estado === filtroEstado)
    .filter((r) => filtroSolicitante === "todos" || r.solicitante === filtroSolicitante);

  const hayFiltrosActivos =
    filtroSolicitante !== "todos" ||
    filtroEquipo !== "todos" ||
    filtroParte.trim() ||
    filtroFlota !== "todas" ||
    filtroFecha ||
    filtroEstado !== "todos";

  function limpiarFiltros() {
    setFiltroEquipo("todos");
    setFiltroParte("");
    setFiltroFlota("todas");
    setFiltroFecha("");
    setFiltroEstado("todos");
    setFiltroSolicitante("todos");
  }

  function exportar(formato) {
    setMenuExportAbierto(false);
    const filas = filasExportRequerimientos(registrosFiltrados);
    if (formato === "excel") exportarExcel(filas, COLUMNAS_EXPORT_REQUERIMIENTOS, "requerimientos");
    if (formato === "word") exportarWord(filas, COLUMNAS_EXPORT_REQUERIMIENTOS, "requerimientos", "Requerimientos");
    if (formato === "pdf") imprimirListaRequerimientos(registrosFiltrados);
  }

  return (
    <div className="ts-stack">
      <PopoverFiltros
        activos={!!hayFiltrosActivos}
        resumen={[
          fechaCorta(filtroFecha),
          filtroEquipo !== "todos" && `Equipo ${filtroEquipo}`,
          filtroParte.trim() && `Parte ${filtroParte.trim()}`,
          filtroFlota !== "todas" && `Flota ${filtroFlota}`,
          filtroEstado !== "todos" && filtroEstado.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
          filtroSolicitante !== "todos" && `Solicitante ${filtroSolicitante}`,
        ]}
      >
      <div className="ts-filtros">
        <label className="ts-filtro">
          <span>Equipo</span>
          <select value={filtroEquipo} onChange={(e) => setFiltroEquipo(e.target.value)}>
            <option value="todos">Todos</option>
            {equipos.filter((e) => e.activo).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo}
              </option>
            ))}
          </select>
        </label>
        <label className="ts-filtro">
          <span>Parte</span>
          <input
            type="text"
            value={filtroParte}
            onChange={(e) => setFiltroParte(e.target.value)}
            placeholder="Ej. FLT-4471"
          />
        </label>
        <label className="ts-filtro">
          <span>Flota</span>
          <select value={filtroFlota} onChange={(e) => setFiltroFlota(e.target.value)}>
            <option value="todas">Todas</option>
            {listaFlotas().map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="ts-filtro">
          <span>Fecha</span>
          <input type="date" value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)} />
        </label>
        <label className="ts-filtro">
          <span>Estado</span>
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="todos">Todos</option>
            {Object.entries(ESTADO_REQ_LABEL).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label className="ts-filtro">
          <span>Solicitante</span>
          <select value={filtroSolicitante} onChange={(e) => setFiltroSolicitante(e.target.value)}>
            <option value="todos">Todos</option>
            {solicitantes.map((nombre) => (
              <option key={nombre} value={nombre}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
        {hayFiltrosActivos && (
          <button className="ts-btn-ghost" onClick={limpiarFiltros}>
            Limpiar filtros
          </button>
        )}
      </div>
      </PopoverFiltros>

      <div className="ts-accion-row ts-accion-row-split">
        <div className="ts-export-dropdown">
          <button className="ts-btn ts-btn-exportar" title="Exportar" onClick={() => setMenuExportAbierto((v) => !v)}>
            <span className="ts-btn-texto">Exportar ▾</span>
            <span className="ts-fab-icono"><IconoFabExportar /></span>
          </button>
          {menuExportAbierto && (
            <>
              <div className="ts-overlay-cerrar" onClick={() => setMenuExportAbierto(false)} />
              <div className="ts-export-menu">
                <button onClick={() => exportar("pdf")}>Formato PDF</button>
                <button onClick={() => exportar("word")}>Formato Word</button>
                <button onClick={() => exportar("excel")}>Formato Excel</button>
              </div>
            </>
          )}
        </div>
        {/* Almacén: buscar repuestos por número de parte */}
        <button className="ts-btn ts-btn-almacen" title="Almacén — buscar por número de parte" onClick={() => setAlmacenAbierto(true)}>
          <span className="ts-btn-texto">Almacén</span>
          <span className="ts-fab-icono"><IconoCaja /></span>
        </button>
        {puedeCrear && (
          <button
            className="ts-btn ts-btn-crear"
            title={mostrarForm ? "Cerrar formulario" : "Nuevo requerimiento"}
            onClick={alternarFormulario}
          >
            <span className="ts-btn-texto">{mostrarForm ? "Cerrar formulario" : "Nuevo requerimiento"}</span>
            <span className="ts-fab-icono">{mostrarForm ? <IconoFabCerrar /> : <IconoFabMas />}</span>
          </button>
        )}
      </div>

      {almacenAbierto && (
        <ModalFormulario onCerrar={() => setAlmacenAbierto(false)}>
          <BuscadorAlmacen esAdmin={esAdmin} usuario={usuarioActual} />
        </ModalFormulario>
      )}

      {mostrarForm && (
        <ModalFormulario onCerrar={cerrar} bloqueo={editando ? { tabla: "requerimientos", id: editando.id } : null} onRecargado={setEditando}>
          {formularioRequerimiento(editando)}
        </ModalFormulario>
      )}

      <Panel titulo="Requerimientos">
        {/* Celular: tarjetas compactas (3 líneas por requerimiento) */}
        <div className="ts-req-movil">
          {registrosFiltrados.length === 0 && <div className="ts-vacio">Sin requerimientos con los filtros actuales.</div>}
          {registrosFiltrados.map((r) => {
            const tieneAccion =
              (puedeAprobar && r.estado === "pendiente_aprobacion") ||
              (puedeAvanzarCompra && (r.estado === "aprobado" || r.estado === "en_proceso_compra"));
            return (
              <div
                key={r.id}
                className="ts-am-card ts-tm-card-clicable"
                onClick={() => abrirFila(r)}
              >
                <div className="ts-am-fila1">
                  <strong className="ts-am-equipo">{r.equipo || "—"}</strong>
                  <span className="ts-req-num">{r.id}</span>
                  <span className="ts-req-estado">
                    <EstadoRequerimientoEditable
                      req={r}
                      puedeAprobar={puedeAprobar}
                      puedeAvanzarCompra={puedeAvanzarCompra}
                      onCambiarEstado={onCambiarEstado}
                    />
                  </span>
                  <span className="ts-acciones-fila" onClick={(e) => e.stopPropagation()}>
                    <button className="ts-btn-mini" title="Imprimir requerimiento (PDF)" onClick={() => imprimirRegistroRequerimiento(r)}>
                      <IconoImprimir />
                    </button>
                    {puedeCrear && (
                      <button className="ts-btn-mini ts-btn-mini-alerta" title="Eliminar requerimiento" onClick={() => setAEliminar(r)}>
                        <IconoEliminar />
                      </button>
                    )}
                  </span>
                </div>
                <div className="ts-am-fila2">
                  {r.numero_parte && <span className="ts-req-parte">{r.numero_parte}</span>}
                  {r.numero_parte && " · "}
                  {r.descripcion || "Sin descripción"}
                  {r.cantidad !== "" && r.cantidad != null && <strong> · Cant. {r.cantidad}</strong>}
                </div>
                <div className="ts-req-fila3">
                  {usuarioDoc(r.solicitante) || "—"} · {formatoFecha(r.fecha_solicitud)}
                </div>
                {tieneAccion && (
                  <div className="ts-req-acciones" onClick={(e) => e.stopPropagation()}>
                    <AccionesRequerimiento
                      req={r}
                      puedeAprobar={puedeAprobar}
                      puedeAvanzarCompra={puedeAvanzarCompra}
                      onCambiarEstado={onCambiarEstado}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="ts-tabla-wrap ts-req-tabla">
          <table className="ts-tabla ts-tabla-cards">
            <thead>
              <tr>
                <th>N°</th>
                <th>Equipo</th>
                <th>Parte</th>
                <th>Descripción</th>
                <th>Cant.</th>
                <th>Solicitante</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {registrosFiltrados.map((r) => (
                <React.Fragment key={r.id}>
                <tr
                  className="ts-fila-clicable"
                  onClick={() => abrirFila(r)}
                >
                  <td className="ts-mono">{r.id}</td>
                  <td className="ts-mono">{r.equipo}</td>
                  <td className="ts-mono">{r.numero_parte}</td>
                  <td><div className="ts-clamp-2">{r.descripcion}</div></td>
                  <td className="ts-mono">{r.cantidad}</td>
                  <td><div className="ts-clamp-2">{usuarioDoc(r.solicitante)}</div></td>
                  <td className="ts-mono">{r.fecha_solicitud}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <EstadoRequerimientoEditable
                      req={r}
                      puedeAprobar={puedeAprobar}
                      puedeAvanzarCompra={puedeAvanzarCompra}
                      onCambiarEstado={onCambiarEstado}
                    />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <AccionesRequerimiento
                      req={r}
                      puedeAprobar={puedeAprobar}
                      puedeAvanzarCompra={puedeAvanzarCompra}
                      onCambiarEstado={onCambiarEstado}
                    />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="ts-acciones-fila">
                      <button
                        className="ts-btn-mini"
                        title="Imprimir requerimiento (PDF)"
                        onClick={() => imprimirRegistroRequerimiento(r)}
                      >
                        <IconoImprimir />
                      </button>
                      {puedeCrear && (
                        <button
                          className="ts-btn-mini ts-btn-mini-alerta"
                          title="Eliminar requerimiento"
                          onClick={() => setAEliminar(r)}
                        >
                          <IconoEliminar />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {detalle && (
        <ModalFormulario onCerrar={() => setDetalleId(null)}>
          <DetalleRequerimiento req={detalle} />
        </ModalFormulario>
      )}

      {cambioPedido && (
        <ConfirmarEstadoRequerimiento
          req={cambioPedido.req}
          estado={cambioPedido.estado}
          onCancelar={() => setCambioPedido(null)}
          onConfirmar={(datos) => {
            cambiarEstado(cambioPedido.req.id, cambioPedido.estado, datos);
            setCambioPedido(null);
          }}
        />
      )}

      {aEliminar && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAEliminar(null)} />
          <div className="ts-modal-confirmacion">
            <h3>¿Eliminar este requerimiento?</h3>
            <p>
              <strong>{aEliminar.id}</strong> · Equipo {aEliminar.equipo} · {aEliminar.descripcion || "Sin descripción"}
              <br />
              Esta acción no se puede deshacer.
            </p>
            <div className="ts-modal-acciones">
              <button className="ts-btn-ghost" onClick={() => setAEliminar(null)}>
                Cancelar
              </button>
              <button className="ts-btn-confirmar-eliminar" onClick={confirmarEliminar}>
                Sí, eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EstadoRequerimientoBadge({ estado }) {
  const tono =
    estado === "aprobado" || estado === "comprado"
      ? "ts-badge-ok"
      : estado === "no_aprobado" || estado === "cancelado"
      ? "ts-badge-alerta"
      : estado === "en_proceso_compra"
      ? "ts-badge-info"
      : estado === "pendiente_aprobacion"
      ? "ts-badge-pendiente"
      : "ts-badge-neutro";
  return <span className={"ts-badge " + tono}>{ESTADO_REQ_LABEL[estado]}</span>;
}

// Estado del requerimiento editable con un clic (p. ej. para corregir una
// aprobación hecha por error). Las opciones dependen de los permisos:
// aprobar → Pendiente / Aprobado / No aprobado; compras → Aprobado /
// En proceso de compra / Comprado.
function estadosPermitidosReq(puedeAprobar, puedeAvanzarCompra, estadoActual, estadoPrevioReq = null) {
  const lista = [];
  // Supervisor: decide la aprobación mientras no haya empezado la compra.
  if (puedeAprobar && ["pendiente_aprobacion", "aprobado", "no_aprobado"].includes(estadoActual))
    lista.push("pendiente_aprobacion", "aprobado", "no_aprobado");
  // Planificador: solo sobre requerimientos ya aprobados (nunca aprueba).
  // Sigue la secuencia: Aprobado → En proceso de compra → Comprado (y desde
  // Comprado puede volver a En proceso para corregir).
  // Puede cancelar un requerimiento aprobado o en proceso de compra.
  if (puedeAvanzarCompra && estadoActual === "aprobado") lista.push("en_proceso_compra", "cancelado");
  if (puedeAvanzarCompra && estadoActual === "en_proceso_compra") lista.push("comprado", "cancelado");
  if (puedeAvanzarCompra && estadoActual === "comprado") lista.push("en_proceso_compra");
  // Cancelado por error: puede volver al estado que tenía antes de cancelar.
  if (puedeAvanzarCompra && estadoActual === "cancelado" && estadoPrevioReq) lista.push(estadoPrevioReq);
  if (lista.length) lista.push(estadoActual);
  return Object.keys(ESTADO_REQ_LABEL).filter((e) => lista.includes(e));
}
// El menú se posiciona "fijo" respecto de la ventana (no dentro de la tabla),
// para que no lo recorte el contenedor con scroll de la tabla en la última
// fila. Si no hay espacio debajo del botón, se abre hacia arriba.
function EstadoRequerimientoEditable({ req, puedeAprobar, puedeAvanzarCompra, onCambiarEstado }) {
  const [abierto, setAbierto] = useState(false);
  const [posMenu, setPosMenu] = useState(null);
  const opciones = estadosPermitidosReq(puedeAprobar, puedeAvanzarCompra, req.estado, (pasoPrevioCancelacion(req) || {}).estado);
  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(false);
    window.addEventListener("resize", cerrar);
    window.addEventListener("scroll", cerrar, true);
    return () => {
      window.removeEventListener("resize", cerrar);
      window.removeEventListener("scroll", cerrar, true);
    };
  }, [abierto]);
  if (!opciones.length || !onCambiarEstado) return <EstadoRequerimientoBadge estado={req.estado} />;
  function alternar(e) {
    if (abierto) {
      setAbierto(false);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const altoMenu = 44 + opciones.length * 38;
    const anchoMenu = 220;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - anchoMenu - 8));
    const haciaArriba = window.innerHeight - r.bottom < altoMenu + 12 && r.top > altoMenu + 12;
    setPosMenu(
      haciaArriba
        ? { position: "fixed", left, right: "auto", top: "auto", bottom: window.innerHeight - r.top + 4, zIndex: 60 }
        : { position: "fixed", left, right: "auto", top: r.bottom + 4, zIndex: 60 }
    );
    setAbierto(true);
  }
  return (
    <span className="ts-estado-editable" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="ts-estado-btn" title="Cambiar estado" onClick={alternar}>
        <EstadoRequerimientoBadge estado={req.estado} />
        <span className="ts-estado-flecha">▾</span>
      </button>
      {abierto && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAbierto(false)} />
          <div className="ts-export-menu ts-estado-menu ts-estado-menu-fijo" style={posMenu || undefined}>
            <div className="ts-estado-menu-titulo">Cambiar estado</div>
            {opciones.map((e) => (
              <button
                key={e}
                type="button"
                className={req.estado === e ? "ts-opcion-activa" : ""}
                onClick={() => {
                  if (e !== req.estado) onCambiarEstado(req.id, e);
                  setAbierto(false);
                }}
              >
                <EstadoRequerimientoBadge estado={e} />
                {req.estado === e && <span className="ts-estado-actual">actual</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// Secuencia del requerimiento en la fila: Solicitado → Aprobado → En
// proceso de compra → Comprado, con fecha, usuario y datos de la compra.
function SeguimientoRequerimiento({ req }) {
  const pasos = pasosRequerimiento(req);
  const actual = pasos.filter((p) => p.hecho).length - 1;
  return (
    <div className="ts-req-seguimiento" onClick={(e) => e.stopPropagation()}>
      {pasos.map((p, i) => {
        const d = p.dato || {};
        const fecha = fechaHoraReq(d.fecha);
        return (
          <div
            key={p.clave}
            className={
              "ts-req-paso" +
              (p.hecho ? " ts-req-paso-hecho" : "") +
              (i === actual ? " ts-req-paso-actual" : "") +
              (p.rechazo ? " ts-req-paso-rechazo" : "")
            }
          >
            <span className="ts-req-paso-barra" />
            <div className="ts-req-paso-titulo">
              <span className="ts-req-paso-icono">
                {p.hecho ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {p.rechazo ? <path d="M7 7l10 10M17 7L7 17" /> : <path d="M5 12.5l4.5 4.5L19 7.5" />}
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {p.titulo}
            </div>
            <div className="ts-req-paso-meta">
              {p.hecho ? (
                <>
                  {fecha || "—"}
                  {d.usuario && <> · {usuarioDoc(d.usuario)}</>}
                </>
              ) : (
                "Pendiente"
              )}
            </div>
            {p.hecho && p.clave === "en_proceso_compra" && detalleCompraReq(d) && (
              <div className="ts-req-paso-extra">{detalleCompraReq(d)}</div>
            )}
            {p.hecho && d.motivo && <div className="ts-req-paso-extra">{d.motivo}</div>}
            {p.hecho && d.restablecido_en && (
              <div className="ts-req-paso-extra ts-texto-dim">
                Restablecido {fechaHoraReq(d.restablecido_en)}
                {d.restablecido_por && <> · {usuarioDoc(d.restablecido_por)}</>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Cuadro emergente con toda la información del requerimiento y su proceso.
function DetalleRequerimiento({ req }) {
  const dato = (etiqueta, valor, clase) => (
    <div className="ts-detalle-dato">
      <span>{etiqueta}</span>
      <div className={clase || ""}>{valor || "—"}</div>
    </div>
  );
  return (
    <Panel
      titulo={`Requerimiento ${req.id}`}
      subtitulo={<EstadoRequerimientoBadge estado={req.estado} />}
    >
      <div className="ts-detalle-grid ts-detalle-grid-req">
        {dato("Equipo", req.equipo, "ts-mono")}
        {dato("Flota", req.flota)}
        {dato("Número de parte", req.numero_parte, "ts-mono")}
        {dato("Cantidad", req.cantidad, "ts-mono")}
        {dato("Solicitante", usuarioDoc(req.solicitante))}
        {dato("Fecha de solicitud", formatoFecha(req.fecha_solicitud), "ts-mono")}
      </div>
      <div className="ts-detalle-bloque">
        {dato("Descripción del repuesto o material", req.descripcion, "ts-detalle-texto")}
      </div>
      <div className="ts-alm-subtitulo">Proceso</div>
      <SeguimientoRequerimiento req={req} />
    </Panel>
  );
}

// Confirmación de cada cambio de estado ("¿Está seguro…?"). "En proceso de
// compra" pide el detalle de compra; "No aprobado" y "Cancelado", el motivo
// (obligatorios). "Comprado" registra solo fecha, hora y usuario.
function ConfirmarEstadoRequerimiento({ req, estado, onConfirmar, onCancelar }) {
  const [detalle, setDetalle] = useState("");
  const [motivo, setMotivo] = useState("");
  const [falta, setFalta] = useState(false);
  const textos = {
    aprobado: `¿Está seguro de APROBAR el requerimiento ${req.id}?`,
    no_aprobado: `¿Está seguro de NO APROBAR el requerimiento ${req.id}?`,
    en_proceso_compra: `¿Está seguro de cambiar el requerimiento ${req.id} al estado "EN PROCESO DE COMPRA"?`,
    comprado: `¿Está seguro de cambiar el requerimiento ${req.id} al estado "COMPRADO"?`,
    cancelado: `¿Está seguro de CANCELAR el requerimiento ${req.id}?`,
    pendiente_aprobacion: `¿Volver el requerimiento ${req.id} a "Pendiente de aprobación"?`,
  };
  const restablecer = req.estado === "cancelado";
  const pideMotivo = !restablecer && (estado === "no_aprobado" || estado === "cancelado");
  const titulo = restablecer
    ? `¿Está seguro de anular la cancelación y volver el requerimiento ${req.id} al estado "${(ESTADO_REQ_LABEL[estado] || estado).toUpperCase()}"?`
    : textos[estado] || `¿Cambiar el estado de ${req.id}?`;
  function confirmar() {
    if (restablecer) return onConfirmar({});
    if (estado === "en_proceso_compra") {
      if (!detalle.trim()) return setFalta(true);
      return onConfirmar({ detalle_compra: detalle.trim() });
    }
    if (pideMotivo) {
      if (!motivo.trim()) return setFalta(true);
      return onConfirmar({ motivo: motivo.trim() });
    }
    onConfirmar({});
  }
  const alEnter = (e) => {
    if (e.key === "Enter") confirmar();
  };
  return (
    <div className="ts-confirmar-cierre-fondo" onClick={onCancelar}>
      <div className="ts-confirmar-cierre" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="ts-confirmar-cierre-titulo">{titulo}</div>
        <div className="ts-confirmar-cierre-texto">
          Equipo {req.equipo} · {req.numero_parte ? `${req.numero_parte} · ` : ""}
          {req.descripcion || "Sin descripción"}
        </div>
        {restablecer && (
          <div className="ts-confirmar-cierre-texto">Se recuperan los datos que tenía antes de cancelarse y queda registrado quién lo restableció.</div>
        )}
        {!restablecer && estado === "en_proceso_compra" && (
          <label className="ts-campo ts-confirmar-campos">
            <span>Detalle de compra</span>
            <input
              type="text"
              value={detalle}
              className={falta && !detalle.trim() ? "ts-input-error" : ""}
              onChange={(e) => {
                setDetalle(e.target.value);
                setFalta(false);
              }}
              onKeyDown={alEnter}
              placeholder="Número de orden de compra"
              autoFocus
            />
          </label>
        )}
        {!restablecer && estado === "comprado" && (
          <div className="ts-confirmar-cierre-texto">Se registrará la fecha, la hora y tu usuario en el seguimiento.</div>
        )}
        {pideMotivo && (
          <label className="ts-campo ts-confirmar-campos">
            <span>Motivo</span>
            <input
              type="text"
              value={motivo}
              className={falta && !motivo.trim() ? "ts-input-error" : ""}
              onChange={(e) => {
                setMotivo(e.target.value);
                setFalta(false);
              }}
              onKeyDown={alEnter}
              autoFocus
            />
          </label>
        )}
        {falta && (
          <div className="ts-verificaciones-error">
            {pideMotivo ? "Escribe el motivo para continuar." : "Escribe el detalle de compra para continuar."}
          </div>
        )}
        <div className="ts-confirmar-cierre-botones">
          <button type="button" className="ts-btn-ghost" onClick={onCancelar}>
            Cancelar
          </button>
          <button type="button" className="ts-btn" onClick={confirmar}>
            Sí, confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function AccionesRequerimiento({ req, puedeAprobar, puedeAvanzarCompra, onCambiarEstado }) {
  if (puedeAprobar && req.estado === "pendiente_aprobacion") {
    return (
      <div className="ts-acciones-fila">
        <button className="ts-btn-mini ts-btn-mini-ok" onClick={() => onCambiarEstado(req.id, "aprobado")}>
          Aprobar
        </button>
        <button className="ts-btn-mini ts-btn-mini-alerta" onClick={() => onCambiarEstado(req.id, "no_aprobado")}>
          No aprobar
        </button>
      </div>
    );
  }
  if (puedeAvanzarCompra && (req.estado === "aprobado" || req.estado === "en_proceso_compra")) {
    const siguiente = req.estado === "aprobado" ? "en_proceso_compra" : "comprado";
    return (
      <div className="ts-acciones-fila">
        <button className="ts-btn-mini" onClick={() => onCambiarEstado(req.id, siguiente)}>
          {req.estado === "aprobado" ? "Marcar en proceso de compra" : "Marcar comprado"}
        </button>
        <button className="ts-btn-mini ts-btn-mini-alerta" onClick={() => onCambiarEstado(req.id, "cancelado")}>
          Cancelar
        </button>
      </div>
    );
  }
  if (puedeAvanzarCompra && req.estado === "cancelado") {
    const previo = pasoPrevioCancelacion(req);
    if (previo && previo.estado !== "pendiente_aprobacion")
      return (
        <button className="ts-btn-mini" title="Anular la cancelación (hecha por error)" onClick={() => onCambiarEstado(req.id, previo.estado)}>
          Restablecer
        </button>
      );
  }
  return <span className="ts-texto-dim">—</span>;
}

// Solicitante: solo el personal activo cuyo rol tiene el permiso "Crear
// requerimientos" (Configuración → Roles y permisos). Por defecto, el
// usuario que inició sesión si está autorizado.
function FormularioRequerimiento({ onGuardar, inicial, personal, solicitantes = [], solicitanteActual, equipos }) {
  const listaSolicitantes = [
    ...new Set([...(inicial?.solicitante ? [inicial.solicitante] : []), ...solicitantes]),
  ];
  const [form, setForm] = useState(
    inicial || {
      equipo: equipos.find((e) => e.activo)?.codigo || "",
      flota: equipos.find((e) => e.activo)?.flota || listaFlotas()[0],
      numero_parte: "",
      descripcion: "",
      cantidad: 1,
      fecha_solicitud: HOY,
      solicitante: solicitanteActual || "",
    }
  );

  function campo(nombre, valor) {
    setForm((prev) => ({ ...prev, [nombre]: valor }));
  }

  // Al elegir un equipo, la Flota se autocompleta según a qué flota
  // pertenece ese equipo (se puede corregir manualmente si hace falta).
  function cambiarEquipo(valor) {
    const equipo = equipos.find((e) => e.codigo === valor);
    setForm((prev) => ({
      ...prev,
      equipo: valor,
      flota: equipo ? equipo.flota : prev.flota,
    }));
  }

  function enviar(e) {
    e.preventDefault();
    onGuardar(form);
  }
  // X o Escape con cambios sin guardar: preguntar.
  useConfirmarCierre(form, () => enviar({ preventDefault() {} }));

  return (
    <Panel titulo={inicial ? `Editar requerimiento — ${inicial.id}` : "Nuevo requerimiento"} subtitulo={<SelloRegistro inicial={inicial} />}>
      <div className="ts-form" onKeyDown={(e) => enviarConEnter(e, enviar)}>
        <div className="ts-form-grid">
          <CampoSelect etiqueta="Equipo relacionado" valor={form.equipo} onChange={cambiarEquipo}>
            {equipos.filter((e) => e.activo).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} · {e.flota}
              </option>
            ))}
          </CampoSelect>

          <div className="ts-campo">
            <span>Flota</span>
            <div className="ts-dato-fijo ts-dato-acento">{form.flota}</div>
          </div>

          <CampoTexto etiqueta="Número de parte" valor={form.numero_parte} onChange={(v) => campo("numero_parte", v)} />
          <CampoTexto etiqueta="Cantidad" tipo="number" valor={form.cantidad} onChange={(v) => campo("cantidad", Number(v))} />
          {/* Fecha y solicitante: automáticos, solo se muestran. */}
          <div className="ts-campo">
            <span>Fecha de solicitud</span>
            <div className="ts-dato-fijo ts-dato-acento">{formatoFecha(form.fecha_solicitud)}</div>
          </div>

          <div className="ts-campo">
            <span>Solicitante</span>
            <div className="ts-dato-fijo ts-dato-ok">{usuarioDoc(form.solicitante) || "—"}</div>
          </div>
        </div>

        <label className="ts-campo ts-campo-full">
          <span>Descripción del repuesto o material</span>
          <AreaTexto rows={2} value={form.descripcion} onChange={(e) => campo("descripcion", e.target.value)} />
        </label>

        <div className="ts-form-acciones">
          <button type="button" className="ts-btn" onClick={enviar}>
            {inicial ? "Guardar cambios" : "Crear requerimiento"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Carga de Excel (solo Administrador): Componentes y Almacén
// ---------------------------------------------------------------------------
const numeroMiles = (n) =>
  n === null || n === undefined || n === "" || isNaN(Number(n)) ? "" : Number(n).toLocaleString("es-ES", { maximumFractionDigits: 2, useGrouping: true });

function textoFechaHoraImp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "Actualizado el 29/10/2026 14:05 por admin · archivo.xlsx"
function MetaImportacion({ imp, conUsuario = true }) {
  if (!imp) return null;
  return (
    <span className="ts-imp-meta" title={imp.archivo || ""}>
      Actualizado el {textoFechaHoraImp(imp.fecha)}
      {conUsuario && imp.usuario ? ` por ${usuarioDoc(imp.usuario)}` : ""}
    </span>
  );
}

function IconoExcel() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9.5 12.5l4 5" />
      <path d="M13.5 12.5l-4 5" />
    </svg>
  );
}

// Botón "Actualizar con Excel": lee el archivo en el navegador, muestra un
// resumen para confirmar y lo sube por partes (tipo: componentes/inventario).
function ImportarExcel({ tipo, usuario, onImportado, texto = "Actualizar con Excel" }) {
  const refArchivo = useRef(null);
  const [leyendo, setLeyendo] = useState(false);
  const [vista, setVista] = useState(null); // { archivo, filas, resumen }
  const [avance, setAvance] = useState(null);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");

  async function alElegir(e) {
    const archivo = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!archivo) return;
    setError("");
    setListo("");
    setLeyendo(true);
    try {
      const ex = await import("../lib/excel");
      const libro = await ex.leerExcel(archivo);
      if (tipo === "componentes") {
        const r = ex.interpretarComponentes(libro);
        const equipos = r.modelos.reduce((s, m) => s + m.equipos, 0);
        setVista({
          archivo: archivo.name,
          filas: r.filas,
          titulo: "Actualizar horas de componentes",
          lineas: [`${r.modelos.length} modelos · ${equipos} equipos`, `Modelos: ${r.modelos.map((m) => m.modelo).join(", ")}`],
          aviso: "Reemplaza todas las horas de componentes actuales.",
        });
      } else {
        const r = ex.interpretarInventario(libro);
        setVista({
          archivo: archivo.name,
          filas: r.filas,
          titulo: "Actualizar inventario de almacén",
          lineas: [`${numeroMiles(r.filas.length)} ítems (hoja "${r.hoja}")`],
          aviso: "Reemplaza todo el inventario actual.",
          faltan: r.faltan,
        });
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLeyendo(false);
    }
  }

  async function subir() {
    const v = vista;
    setAvance({ hechas: 0, total: v.filas.length });
    try {
      await db.importarDatos(tipo, v.filas, v.archivo, usuario, (hechas, total) => setAvance({ hechas, total }));
      setVista(null);
      setListo(tipo === "componentes" ? "Horas de componentes actualizadas." : "Inventario actualizado.");
      if (onImportado) onImportado();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setAvance(null);
    }
  }

  return (
    <>
      <button type="button" className="ts-btn-ghost ts-btn-excel" onClick={() => refArchivo.current && refArchivo.current.click()} disabled={leyendo}>
        <IconoExcel />
        {leyendo ? "Leyendo…" : texto}
      </button>
      <input ref={refArchivo} type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={alElegir} />
      {(vista || error || listo) && (
        <div className="ts-confirmar-cierre-fondo" onClick={() => !avance && (setVista(null), setError(""), setListo(""))}>
          <div className="ts-confirmar-cierre ts-imp-dialogo" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {error ? (
              <>
                <div className="ts-confirmar-cierre-titulo">No se pudo cargar el Excel</div>
                <div className="ts-confirmar-cierre-texto">{error}</div>
                <div className="ts-confirmar-cierre-botones">
                  <button type="button" className="ts-btn" onClick={() => (setError(""), setVista(null))}>
                    Entendido
                  </button>
                </div>
              </>
            ) : listo ? (
              <>
                <div className="ts-confirmar-cierre-titulo">✓ {listo}</div>
                <div className="ts-confirmar-cierre-botones">
                  <button type="button" className="ts-btn" onClick={() => setListo("")}>
                    Aceptar
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="ts-confirmar-cierre-titulo">{vista.titulo}</div>
                <div className="ts-imp-archivo">
                  <IconoExcel />
                  <span>{vista.archivo}</span>
                </div>
                {vista.lineas.map((l, i) => (
                  <div key={i} className="ts-confirmar-cierre-texto">
                    {l}
                  </div>
                ))}
                {vista.faltan && vista.faltan.length > 0 && (
                  <div className="ts-imp-aviso">No se encontraron estas columnas (quedarán vacías): {vista.faltan.join(", ")}.</div>
                )}
                <div className="ts-confirmar-cierre-texto ts-texto-dim">{vista.aviso}</div>
                {avance && (
                  <div className="ts-imp-progreso">
                    <div style={{ width: `${Math.round((avance.hechas / Math.max(1, avance.total)) * 100)}%` }} />
                  </div>
                )}
                <div className="ts-confirmar-cierre-botones">
                  <button type="button" className="ts-btn-ghost" disabled={!!avance} onClick={() => setVista(null)}>
                    Cancelar
                  </button>
                  <button type="button" className="ts-btn" disabled={!!avance} onClick={subir}>
                    {avance ? `Subiendo… ${Math.round((avance.hechas / Math.max(1, avance.total)) * 100)}%` : "Subir y reemplazar"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Vista: Componentes (horas de cada componente por equipo)
// El Administrador sube el Excel cada semana: una hoja por modelo, equipos en
// la fila 1 y componentes en la columna A. Celda vacía = nunca se cambió.
// ---------------------------------------------------------------------------
// Vida útil de referencia de un componente: verde hasta 60 %, amarillo desde
// 60 % y rojo desde 90 % de vida.
const VIDA_COMPONENTE_H = 27000;
function nivelVida(h) {
  if (h === null || h === undefined) return "";
  const r = h / VIDA_COMPONENTE_H;
  return r >= 0.9 ? "rojo" : r >= 0.6 ? "amarillo" : "verde";
}

function agruparComponentes(filas) {
  const modelos = [];
  const porModelo = {};
  filas.forEach((f) => {
    let m = porModelo[f.modelo];
    if (!m) {
      m = porModelo[f.modelo] = { modelo: f.modelo, equipos: [], componentes: [], horas: {} };
      modelos.push(m);
    }
    if (!m.equipos.includes(f.equipo)) m.equipos.push(f.equipo);
    if (!m.componentes.includes(f.componente)) m.componentes.push(f.componente);
    const h = f.horas === "" || f.horas === null || f.horas === undefined ? null : Number(f.horas);
    m.horas[f.equipo + "|" + f.componente] = h;
  });
  modelos.forEach((m) => {
    // Máximo de cada componente entre los equipos del modelo (para el color).
    m.maxComp = {};
    m.componentes.forEach((c) => {
      m.maxComp[c] = Math.max(0, ...m.equipos.map((e) => m.horas[e + "|" + c] || 0));
    });
  });
  return modelos;
}

function Componentes({ esAdmin, usuario, equipos }) {
  const [imp, setImp] = useState(null);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Por defecto: modelo 789C, equipo 210 (si existen en el Excel).
  const [modeloSel, setModeloSel] = useState("789C");
  const [equipoSel, setEquipoSel] = useState("210");
  const [compSel, setCompSel] = useState(""); // componente resaltado

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const i = await db.leerImportacion("componentes");
      setImp(i);
      setFilas(i ? await db.leerHorasComponentes(i.lote) : []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  const modelos = useMemo(() => agruparComponentes(filas), [filas]);
  const modelo = modelos.find((m) => m.modelo === modeloSel) || modelos[0];
  const equipoActivo = modelo && (modelo.equipos.includes(equipoSel) ? equipoSel : modelo.equipos[0]);
  const datosEquipo = (codigo) => equipos.find((e) => String(e.codigo) === String(codigo));

  const verEquipo = (codigo, componente = "") => {
    setEquipoSel(codigo);
    setCompSel(componente);
  };

  const cabecera = (
    <div className="ts-comp-acciones">
      <MetaImportacion imp={imp} />
      {esAdmin && <ImportarExcel tipo="componentes" usuario={usuario} onImportado={cargar} texto="Actualizar horas (Excel)" />}

    </div>
  );

  return (
    <div className="ts-stack">
      {/* Filtros (ícono de filtro de la barra superior, igual que Trabajos) */}
      <PopoverFiltros activos={!!modelo} resumen={modelo ? [modelo.modelo, `Equipo ${equipoActivo}`] : []}>
        {modelo && (
          <div className="ts-filtros ts-filtros-dos">
            <label className="ts-filtro">
              <span>Modelo</span>
              <select value={modelo.modelo} onChange={(e) => (setModeloSel(e.target.value), setCompSel(""))}>
                {modelos.map((m) => (
                  <option key={m.modelo} value={m.modelo}>
                    {m.modelo} ({m.equipos.length} {m.equipos.length === 1 ? "equipo" : "equipos"})
                  </option>
                ))}
              </select>
            </label>
            <label className="ts-filtro">
              <span>Equipo</span>
              <select value={equipoActivo} onChange={(e) => verEquipo(e.target.value)}>
                {modelo.equipos.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </PopoverFiltros>
      <Panel titulo="Horas de componentes" acciones={cabecera}>
        {cargando ? (
          <div className="ts-vacio">Cargando…</div>
        ) : error ? (
          <div className="ts-vacio">{error}</div>
        ) : !modelos.length ? (
          <div className="ts-vacio">
            Aún no se cargaron las horas de componentes.
            {esAdmin ? " Usa “Actualizar horas (Excel)” para subir el archivo." : " El administrador las cargará desde un Excel."}
          </div>
        ) : (
          <>
            <div className="ts-comp-layout">
              <div className="ts-comp-tabla-wrap">
                <table className="ts-comp-tabla">
                  <thead>
                    <tr>
                      <th className="ts-comp-col-nombre">Componente</th>
                      {modelo.equipos.map((e) => (
                        <th key={e} className={e === equipoActivo ? "ts-comp-sel" : ""}>
                          <button type="button" className="ts-comp-equipo-btn" title={`Ver equipo ${e}`} onClick={() => verEquipo(e)}>
                            {e}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modelo.componentes.map((c) => (
                      <tr key={c}>
                        <th className="ts-comp-col-nombre">{c}</th>
                        {modelo.equipos.map((e) => {
                          const h = modelo.horas[e + "|" + c];
                          const sel = (e === equipoActivo ? " ts-comp-sel" : "") + (e === equipoActivo && c === compSel ? " ts-comp-celda-sel" : "");
                          if (h === null || h === undefined)
                            return (
                              <td key={e} className={"ts-comp-vacio" + sel} title={`${c} · equipo ${e}: nunca se cambió`} onClick={() => verEquipo(e, c)}>
                                —
                              </td>
                            );
                          return (
                            <td key={e} className={"ts-vida-" + nivelVida(h) + sel} title={`${c} · equipo ${e}: ${numeroMiles(h)} h`} onClick={() => verEquipo(e, c)}>
                              {numeroMiles(h)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DetalleEquipoComponentes
                modelo={modelo}
                equipo={equipoActivo}
                datos={datosEquipo(equipoActivo)}
                seleccion={compSel}
                onSeleccion={setCompSel}
              />
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

// Gráfica del equipo elegido: misma altura de filas que la tabla para que
// queden alineadas. Al tocar una fila se muestra el detalle en un cuadro.
function DetalleEquipoComponentes({ modelo, equipo, datos, seleccion, onSeleccion }) {
  const [cuadro, setCuadro] = useState(null); // { c, h, top }
  useEffect(() => setCuadro(null), [equipo, modelo.modelo]);
  const lista = modelo.componentes
    .map((c) => ({ c, h: modelo.horas[equipo + "|" + c] }))
    .sort((a, b) => (b.h ?? -1) - (a.h ?? -1));
  function tocar(ev, c, h) {
    onSeleccion(c);
    const fila = ev.currentTarget;
    const caja = fila.closest(".ts-comp-grafica");
    const top = fila.getBoundingClientRect().top - caja.getBoundingClientRect().top;
    setCuadro(cuadro && cuadro.c === c ? null : { c, h, top });
  }
  return (
    <div className="ts-comp-grafica">
      <table className="ts-comp-tabla ts-comp-tabla-grafica">
        <thead>
          <tr>
            <th className="ts-comp-g-nombre">Componente</th>
            <th className="ts-comp-g-equipo">
              <b>Equipo {equipo}</b>
              <span>{modelo.modelo}</span>
            </th>
            <th className="ts-comp-g-horas">Horas</th>
          </tr>
        </thead>
        <tbody>
          {lista.map(({ c, h }) => {
            const vacio = h === null || h === undefined;
            const pct = vacio ? 0 : Math.round((h / VIDA_COMPONENTE_H) * 100);
            return (
              <tr key={c} className={c === seleccion ? "ts-comp-g-sel" : ""} onClick={(ev) => tocar(ev, c, h)}>
                <th className="ts-comp-g-nombre">{c}</th>
                <td className="ts-comp-g-barra">
                  <span className="ts-comp-barra-fondo">
                    {!vacio && <span className={"ts-comp-barra-relleno ts-vida-barra-" + nivelVida(h)} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />}
                  </span>
                </td>
                <td className={"ts-comp-g-horas" + (vacio ? " ts-texto-dim" : "")}>{vacio ? "Sin cambio" : `${numeroMiles(h)} h`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {cuadro && (
        <div className="ts-comp-cuadro" style={{ top: cuadro.top + 36 }} onClick={() => setCuadro(null)}>
          <b>
            Equipo {equipo} – {cuadro.c}
          </b>
          <span>{cuadro.h === null || cuadro.h === undefined ? "Nunca se cambió" : `${numeroMiles(cuadro.h)} h`}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista: Engrase (inspecciones del sistema de lubricación)
// Equipos por flota y por tipo. Primero los que nunca se inspeccionaron y
// luego los de inspección más antigua. Una falla queda "por reparar" hasta
// que alguien la marca como reparada.
// ---------------------------------------------------------------------------

function diasDesde(fecha) {
  if (!fecha) return null;
  const [a, m, d] = fecha.split("-").map(Number);
  const [ha, hm, hd] = fechaActualLocal().split("-").map(Number);
  return Math.round((Date.UTC(ha, hm - 1, hd) - Date.UTC(a, m - 1, d)) / 86400000);
}
const ordenEngrase = (a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.creado_en || "").localeCompare(String(a.creado_en || ""));
const fallaPendiente = (r) => r.resultado === "falla" && !(r.reparacion && r.reparacion.estado === "reparado");

function EstadoEngrase({ ultima, pendientes }) {
  if (pendientes > 0) return <span className="ts-badge ts-badge-alerta">Falla por reparar{pendientes > 1 ? ` (${pendientes})` : ""}</span>;
  if (!ultima) return <span className="ts-texto-dim">—</span>;
  return <span className="ts-badge ts-badge-ok">Sin observaciones</span>;
}

// Color según la frecuencia del equipo: verde dentro del plazo, ámbar el
// día que vence y rojo cuando ya pasó. Sin frecuencia: gris.
function DiasEngrase({ dias, frecuencia }) {
  if (dias === null) return <span className="ts-eng-dias ts-eng-dias-nunca">Sin inspección</span>;
  const clase = !frecuencia ? "neutro" : dias < frecuencia ? "ok" : dias === frecuencia ? "aviso" : "alerta";
  const titulo = frecuencia ? (dias > frecuencia ? `Vencida hace ${dias - frecuencia} día(s)` : dias === frecuencia ? "Vence hoy" : `Vence en ${frecuencia - dias} día(s)`) : "Sin frecuencia definida";
  return (
    <span className={"ts-eng-dias ts-eng-dias-" + clase} title={titulo}>
      {dias <= 0 ? "Hoy" : dias === 1 ? "Hace 1 día" : `Hace ${dias} días`}
    </span>
  );
}

// Frecuencia de inspección (días) de un equipo, editable desde la tabla.
function FrecuenciaEngrase({ equipo, dias, puedeEditar, onGuardar }) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [falta, setFalta] = useState(false);
  const texto = dias ? `${dias} ${dias === 1 ? "día" : "días"}` : null;
  if (!puedeEditar) return texto ? <span>{texto}</span> : <span className="ts-texto-dim">—</span>;
  function guardar() {
    const n = valor.trim() === "" ? null : Math.round(Number(valor));
    if (n !== null && (!isFinite(n) || n < 1 || n > 365)) return setFalta(true);
    onGuardar(equipo, n);
    setAbierto(false);
  }
  return (
    <>
      <button
        type="button"
        className={"ts-eng-frec" + (texto ? "" : " vacia")}
        title="Cambiar frecuencia de inspección"
        onClick={(ev) => {
          ev.stopPropagation();
          setValor(dias ? String(dias) : "");
          setFalta(false);
          setAbierto(true);
        }}
      >
        {texto || "Definir"}
      </button>
      {abierto && (
        <div className="ts-confirmar-cierre-fondo" onClick={(ev) => (ev.stopPropagation(), setAbierto(false))}>
          <div className="ts-confirmar-cierre" role="alertdialog" aria-modal="true" onClick={(ev) => ev.stopPropagation()}>
            <div className="ts-confirmar-cierre-titulo">Frecuencia de inspección — equipo {equipo}</div>
            <div className="ts-confirmar-cierre-texto">Cada cuántos días se debe inspeccionar el sistema de lubricación de este equipo.</div>
            <label className="ts-campo ts-confirmar-campos">
              <span>Frecuencia (días)</span>
              <input
                type="number"
                min="1"
                max="365"
                inputMode="numeric"
                value={valor}
                className={falta ? "ts-input-error" : ""}
                onChange={(ev) => (setValor(ev.target.value), setFalta(false))}
                onKeyDown={(ev) => ev.key === "Enter" && guardar()}
                autoFocus
              />
            </label>
            {falta && <div className="ts-verificaciones-error">Escribe un número de días entre 1 y 365 (o déjalo vacío para quitarla).</div>}
            <div className="ts-confirmar-cierre-botones">
              <button type="button" className="ts-btn-ghost" onClick={() => setAbierto(false)}>
                Cancelar
              </button>
              <button type="button" className="ts-btn" onClick={guardar}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Situación de engrase de cada equipo activo: última inspección, días
// transcurridos y fallas por reparar (se usa en Engrase y en Inicio).
function filasEngrase(registros, equipos) {
  const porEquipo = {};
  registros.forEach((r) => (porEquipo[r.equipo] = porEquipo[r.equipo] || []).push(r));
  return equipos
    .filter((e) => e.activo)
    .map((e) => {
      const lista = (porEquipo[e.codigo] || []).slice().sort(ordenEngrase);
      const ultima = lista[0] || null;
      return { e, lista, ultima, dias: ultima ? diasDesde(ultima.fecha) : null, pendientes: lista.filter(fallaPendiente).length };
    });
}
function cuentaEngrase(filas) {
  return {
    todos: filas.length,
    sin: filas.filter((x) => !x.ultima).length,
    falla: filas.filter((x) => x.pendientes > 0).length,
    ok: filas.filter((x) => x.ultima && x.pendientes === 0).length,
  };
}

// Inicio: "Engrase de equipos". Inspecciones registradas en la fecha y turno
// elegidos (por defecto el turno actual), separadas por flota.
function ResumenEngrase({ registros, equipos, frecuencias = {} }) {
  const [filtro, setFiltro] = useState(() => ({
    fecha: turnoOperativoActual().fecha,
    turno: turnoOperativoActual().turno,
    equipo: "todos",
    flota: "todos",
  }));
  const delTurno = registros.filter(
    (r) => (!filtro.fecha || r.fecha === filtro.fecha) && (filtro.turno === "todos" || r.turno === filtro.turno)
  );
  const datosEquipo = (codigo) => equipos.find((e) => e.codigo === codigo) || {};
  const flotaDe = (r) => r.flota || datosEquipo(r.equipo).flota || "Sin flota";
  const flotas = listaFlotas().filter((f) => filtro.flota === "todos" || f === filtro.flota);
  return (
    <Panel
      titulo="Engrase de equipos"
      acciones={
        <FiltroPanel
          activo={hayFiltrosGenerales(filtro)}
          resumen={[fechaCorta(filtro.fecha), TEXTO_TURNO[filtro.turno], filtro.flota !== "todos" && `Flota ${filtro.flota}`].filter(Boolean).join(" · ") || "Sin filtros"}
        >
          <FiltrosBar filtros={filtro} setFiltros={setFiltro} mostrarEquipo={false} />
        </FiltroPanel>
      }
    >
      <div className="ts-eng-inicio">
        {flotas.map((flota) => {
          const lista = delTurno
            .filter((r) => flotaDe(r) === flota)
            .sort((a, b) => String(a.equipo).localeCompare(String(b.equipo), "es", { numeric: true }));
          const fallas = lista.filter((r) => r.resultado === "falla").length;
          return (
            <div key={flota} className="ts-eng-inicio-flota">
              <h4 className="ts-grafico-subtitulo">
                Flota {flota}{" "}
                <span className="ts-texto-dim">
                  · {lista.length} {lista.length === 1 ? "inspección" : "inspecciones"}
                  {fallas ? ` · ${fallas} ${fallas === 1 ? "falla" : "fallas"}` : ""}
                </span>
              </h4>
              {lista.length ? (
                <div className="ts-tabla-wrap">
                  <table className="ts-tabla ts-eng-inicio-tabla">
                    <thead>
                      <tr>
                        <th>Equipo</th>
                        <th>Tipo</th>
                        <th>Estado</th>
                        <th>Frecuencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((r) => (
                        <tr
                          key={r.id}
                          title={[
                            `Equipo ${r.equipo}${datosEquipo(r.equipo).modelo ? ` · ${datosEquipo(r.equipo).modelo}` : ""}`,
                            `Fecha: ${formatoFecha(r.fecha)}${r.turno ? ` · Turno ${r.turno === "noche" ? "Noche" : "Día"}` : ""}`,
                            `Estado: ${r.resultado === "falla" ? (r.reparacion && r.reparacion.estado === "reparado" ? "Falla reparada" : "Falla por reparar") : "Sin observaciones"}`,
                            `Comentario: ${r.comentario || "—"}`,
                            `Personal: ${usuarioDoc(r.inspector) || "—"}`,
                            `Frecuencia: ${frecuencias[r.equipo] ? `${frecuencias[r.equipo]} días` : "sin definir"}`,
                          ].join("\n")}
                        >
                          <td className="ts-mono ts-eng-equipo">{r.equipo}</td>
                          <td>{datosEquipo(r.equipo).descripcion || "—"}</td>
                          <td>
                            {r.resultado === "falla" ? (
                              <span className="ts-badge ts-badge-alerta">{r.reparacion && r.reparacion.estado === "reparado" ? "Falla reparada" : "Falla por reparar"}</span>
                            ) : (
                              <span className="ts-badge ts-badge-ok">Sin observaciones</span>
                            )}
                          </td>
                          <td>{frecuencias[r.equipo] ? `${frecuencias[r.equipo]} días` : <span className="ts-texto-dim">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ts-vacio">Sin engrases registrados en este turno.</div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

const COLUMNAS_EXPORT_ENGRASE = [
  { clave: "equipo", titulo: "Equipo" },
  { clave: "flota", titulo: "Flota" },
  { clave: "tipo", titulo: "Tipo" },
  { clave: "modelo", titulo: "Modelo" },
  { clave: "ultima", titulo: "Última inspección" },
  { clave: "turno", titulo: "Turno" },
  { clave: "tiempo", titulo: "Tiempo" },
  { clave: "estado", titulo: "Estado" },
  { clave: "comentario", titulo: "Comentario" },
  { clave: "frecuencia", titulo: "Frecuencia" },
  { clave: "personal", titulo: "Personal" },
];

function Engrase({ registros, equipos, puedeRegistrar, onCrear, onActualizar, onEliminar, usuario, frecuencias = {}, onFrecuencia }) {
  const [menuExportAbierto, setMenuExportAbierto] = useState(false);
  // Mismo filtro que Trabajos: Fecha, Turno, Flota, Equipo y Estado. Por
  // defecto la fecha y el turno actuales.
  const [filtros, setFiltros] = useState(() => ({
    fecha: turnoOperativoActual().fecha,
    turno: turnoOperativoActual().turno,
    equipo: "todos",
    flota: "todos",
  }));
  const [estado, setEstado] = useState("todos");
  const [registrar, setRegistrar] = useState(null); // { equipo } | {}
  const [detalle, setDetalle] = useState(null); // código de equipo

  // Con fecha/turno elegidos, cada equipo muestra su inspección de ese
  // turno (reg). Sin filtro de fecha/turno, la última inspección.
  const enTurno = !!filtros.fecha || filtros.turno !== "todos";
  const filasEquipo = useMemo(
    () =>
      filasEngrase(registros, equipos).map((x) => ({
        ...x,
        reg: enTurno
          ? x.lista.find((r) => (!filtros.fecha || r.fecha === filtros.fecha) && (filtros.turno === "todos" || r.turno === filtros.turno)) || null
          : x.ultima,
      })),
    [registros, equipos, filtros.fecha, filtros.turno]
  );
  const base = filasEquipo.filter(
    (x) => (filtros.flota === "todos" || x.e.flota === filtros.flota) && (filtros.equipo === "todos" || x.e.codigo === filtros.equipo)
  );
  const cuenta = {
    todos: base.length,
    sin: base.filter((x) => !x.reg).length,
    falla: base.filter((x) => x.pendientes > 0).length,
    ok: base.filter((x) => x.reg && x.reg.resultado !== "falla").length,
  };
  const pasa = (x) =>
    base.includes(x) &&
    (estado === "todos" || (estado === "sin" && !x.reg) || (estado === "falla" && x.pendientes > 0) || (estado === "ok" && x.reg && x.reg.resultado !== "falla"));
  // Primero los no inspeccionados (en el turno); luego la inspección más antigua.
  const orden = (a, b) =>
    (a.reg ? 1 : 0) - (b.reg ? 1 : 0) ||
    String(a.ultima ? a.ultima.fecha : "").localeCompare(String(b.ultima ? b.ultima.fecha : "")) ||
    String(a.e.codigo).localeCompare(String(b.e.codigo), "es", { numeric: true });
  const textoEstado = (x) => {
    if (x.reg) {
      if (x.reg.resultado === "falla") return x.reg.reparacion && x.reg.reparacion.estado === "reparado" ? "Falla reparada" : "Falla por reparar";
      return "Sin observaciones";
    }
    return enTurno ? "Pendiente" : "";
  };
  const ESTADO_TEXTO = { sin: "Sin inspección", falla: "Fallas por reparar", ok: "Sin observaciones" };

  const flotasConEquipos = listaFlotas().filter((f) => base.some((x) => x.e.flota === f));

  // Exporta lo que se ve (con los filtros aplicados), en el mismo orden.
  function exportar(formato) {
    setMenuExportAbierto(false);
    const filas = [];
    flotasConEquipos.forEach((flota) => {
      const deFlota = filasEquipo.filter((x) => x.e.flota === flota && pasa(x));
      const tipos = [...new Set(deFlota.map((x) => x.e.descripcion || "Sin tipo"))].sort((a, b) => a.localeCompare(b, "es"));
      tipos.forEach((tipo) =>
        deFlota
          .filter((x) => (x.e.descripcion || "Sin tipo") === tipo)
          .sort(orden)
          .forEach((x) =>
            filas.push({
              equipo: x.e.codigo,
              flota: x.e.flota,
              tipo: x.e.descripcion || "",
              modelo: x.e.modelo || "",
              ultima: x.ultima ? formatoFecha(x.ultima.fecha) : "Sin inspección",
              turno: x.ultima && x.ultima.turno ? (x.ultima.turno === "noche" ? "Noche" : "Día") : "",
              tiempo: x.dias === null ? "" : x.dias <= 0 ? "Hoy" : `${x.dias} días`,
              estado: textoEstado(x),
              comentario: x.reg ? x.reg.comentario || "" : "",
              frecuencia: frecuencias[x.e.codigo] ? `${frecuencias[x.e.codigo]} días` : "",
              personal: x.reg ? usuarioDoc(x.reg.inspector) || "" : "",
            })
          )
      );
    });
    if (formato === "excel") exportarExcel(filas, COLUMNAS_EXPORT_ENGRASE, "engrase_de_equipos");
    if (formato === "word") exportarWord(filas, COLUMNAS_EXPORT_ENGRASE, "engrase_de_equipos", "Engrase de equipos");
    if (formato === "pdf") exportarPDF(filas, COLUMNAS_EXPORT_ENGRASE, "Engrase de equipos");
  }
  const equipoDetalle = detalle ? filasEquipo.find((x) => x.e.codigo === detalle) : null;

  return (
    <div className="ts-stack">
      {/* Filtros (ícono de filtro de la barra superior, igual que Trabajos) */}
      <PopoverFiltros
        activos={hayFiltrosGenerales(filtros) || estado !== "todos"}
        resumen={[
          fechaCorta(filtros.fecha),
          TEXTO_TURNO[filtros.turno],
          filtros.flota !== "todos" && `Flota ${filtros.flota}`,
          filtros.equipo !== "todos" && `Equipo ${filtros.equipo}`,
          estado !== "todos" && ESTADO_TEXTO[estado],
        ]}
      >
        <FiltrosBar
          filtros={filtros}
          setFiltros={setFiltros}
          mostrarEquipo={false}
          extraActivo={estado !== "todos"}
          onLimpiarExtra={() => setEstado("todos")}
          contenidoEquipo={
            <>
              <label className="ts-filtro">
                <span>Equipo</span>
                <select value={filtros.equipo} onChange={(e) => setFiltros((p) => ({ ...p, equipo: e.target.value }))}>
                  <option value="todos">Todos</option>
                  {equipos
                    .filter((e) => e.activo && (filtros.flota === "todos" || e.flota === filtros.flota))
                    .map((e) => (
                      <option key={e.codigo} value={e.codigo}>
                        {e.codigo}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ts-filtro">
                <span>Estado</span>
                <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                  <option value="todos">Todos ({cuenta.todos})</option>
                  <option value="sin">Sin inspección ({cuenta.sin})</option>
                  <option value="falla">Fallas por reparar ({cuenta.falla})</option>
                  <option value="ok">Sin observaciones ({cuenta.ok})</option>
                </select>
              </label>
            </>
          }
        />
      </PopoverFiltros>

      {flotasConEquipos
        .map((flota) => {
          const deFlota = filasEquipo.filter((x) => x.e.flota === flota && pasa(x));
          if (!deFlota.length) return null;
          const tipos = [...new Set(deFlota.map((x) => x.e.descripcion || "Sin tipo"))].sort((a, b) =>
            a === "Sin tipo" ? 1 : b === "Sin tipo" ? -1 : a.localeCompare(b, "es")
          );
          return (
            <Panel key={flota} titulo={`Flota ${flota}`} subtitulo={`${deFlota.length} equipos`}>
              {tipos.map((tipo) => {
                const filas = deFlota.filter((x) => (x.e.descripcion || "Sin tipo") === tipo).sort(orden);
                return (
                  <div key={tipo} className="ts-eng-grupo">
                    <div className="ts-eng-grupo-titulo">
                      {tipo}
                      <span>{filas.length}</span>
                    </div>
                    <div className="ts-tabla-wrap">
                      <table className="ts-tabla ts-eng-tabla">
                        <thead>
                          <tr>
                            <th>Equipo</th>
                            <th>Modelo</th>
                            <th>Última inspección</th>
                            <th>Tiempo</th>
                            <th>Estado</th>
                            <th>Comentario</th>
                            <th>Frecuencia</th>
                            <th>Personal</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {filas.map((x) => (
                            <tr key={x.e.codigo} className="ts-fila-click" onClick={() => setDetalle(x.e.codigo)}>
                              <td className="ts-mono ts-eng-equipo" data-label="Equipo">{x.e.codigo}</td>
                              <td data-label="Modelo">{x.e.modelo || "—"}</td>
                              <td className="ts-mono" data-label="Última">{x.ultima ? formatoFecha(x.ultima.fecha) : "—"}</td>
                              <td data-label="Tiempo"><DiasEngrase dias={x.dias} frecuencia={frecuencias[x.e.codigo]} /></td>
                              <td data-label="Estado">
                                {x.reg ? (
                                  <span className={"ts-badge " + (x.reg.resultado === "falla" && textoEstado(x) === "Falla por reparar" ? "ts-badge-alerta" : "ts-badge-ok")}>{textoEstado(x)}</span>
                                ) : enTurno ? (
                                  <span className="ts-badge ts-badge-neutro-eng" title="Sin inspección en el turno elegido">Pendiente</span>
                                ) : (
                                  <span className="ts-texto-dim">—</span>
                                )}
                              </td>
                              <td data-label="Comentario">
                                <div className="ts-clamp-2">{x.reg && x.reg.comentario ? x.reg.comentario : <span className="ts-texto-dim">—</span>}</div>
                              </td>
                              <td data-label="Frecuencia" onClick={(ev) => puedeRegistrar && ev.stopPropagation()}>
                                <FrecuenciaEngrase equipo={x.e.codigo} dias={frecuencias[x.e.codigo]} puedeEditar={puedeRegistrar} onGuardar={onFrecuencia} />
                              </td>
                              <td data-label="Personal">{x.reg ? usuarioDoc(x.reg.inspector) || "—" : "—"}</td>
                              <td className="ts-eng-accion">
                                {puedeRegistrar && (
                                  <button
                                    type="button"
                                    className="ts-btn-mini"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      setRegistrar({ equipo: x.e.codigo });
                                    }}
                                  >
                                    Registrar
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </Panel>
          );
        })}
      {!filasEquipo.some(pasa) && <div className="ts-vacio">No hay equipos con este filtro.</div>}

      <div className="ts-accion-row ts-accion-row-split">
        <div className="ts-export-dropdown">
          <button className="ts-btn ts-btn-exportar" title="Exportar" onClick={() => setMenuExportAbierto((v) => !v)}>
            <span className="ts-btn-texto">Exportar ▾</span>
            <span className="ts-fab-icono"><IconoFabExportar /></span>
          </button>
          {menuExportAbierto && (
            <>
              <div className="ts-overlay-cerrar" onClick={() => setMenuExportAbierto(false)} />
              <div className="ts-export-menu">
                <button onClick={() => exportar("pdf")}>Formato PDF</button>
                <button onClick={() => exportar("word")}>Formato Word</button>
                <button onClick={() => exportar("excel")}>Formato Excel</button>
              </div>
            </>
          )}
        </div>
        {puedeRegistrar && (
          <button className="ts-btn ts-btn-crear" title="Registrar inspección" onClick={() => setRegistrar({})}>
            <span className="ts-btn-texto">Registrar inspección</span>
            <span className="ts-fab-icono"><IconoFabMas /></span>
          </button>
        )}
      </div>

      {registrar && (
        <ModalFormulario onCerrar={() => setRegistrar(null)}>
          <FormularioEngrase
            equipos={equipos}
            equipoInicial={registrar.equipo}
            usuario={usuario}
            onGuardar={async (datos) => {
              if (await onCrear(datos)) setRegistrar(null);
            }}
          />
        </ModalFormulario>
      )}

      {equipoDetalle && !registrar && (
        <ModalFormulario onCerrar={() => setDetalle(null)}>
          <HistorialEngrase
            fila={equipoDetalle}
            frecuencia={frecuencias[equipoDetalle.e.codigo]}
            puedeRegistrar={puedeRegistrar}
            usuario={usuario}
            onActualizar={onActualizar}
            onEliminar={onEliminar}
          />
        </ModalFormulario>
      )}
    </div>
  );
}

function FormularioEngrase({ equipos, equipoInicial, usuario, onGuardar }) {
  const activos = equipos.filter((e) => e.activo);
  const ahora = turnoOperativoActual();
  const [form, setForm] = useState({
    equipo: equipoInicial || (activos[0] && activos[0].codigo) || "",
    fecha: ahora.fecha,
    turno: ahora.turno,
    resultado: "ok",
    comentario: "",
  });
  const [falta, setFalta] = useState("");
  const [guardando, setGuardando] = useState(false);
  const eq = activos.find((e) => e.codigo === form.equipo);
  const campo = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setFalta("");
  };
  async function enviar() {
    if (!form.equipo) return setFalta("Elige el equipo.");
    if (!form.fecha) return setFalta("Indica la fecha de ingreso.");
    if (form.fecha > fechaActualLocal()) return setFalta("La fecha no puede ser futura.");
    if (form.resultado === "falla" && !form.comentario.trim()) return setFalta("Describe la falla encontrada para reportarla a reparación.");
    setGuardando(true);
    await onGuardar({
      equipo: form.equipo,
      flota: eq ? eq.flota : "",
      fecha: form.fecha,
      turno: form.turno,
      resultado: form.resultado,
      comentario: form.comentario.trim(),
      inspector: usuario,
      reparacion: form.resultado === "falla" ? { estado: "pendiente" } : null,
    });
    setGuardando(false);
  }
  useConfirmarCierre(form, enviar);

  return (
    <Panel titulo="Registrar inspección de engrase">
      <div className="ts-form">
        <div className="ts-form-grid">
          <CampoSelect etiqueta="Equipo" valor={form.equipo} onChange={(v) => campo("equipo", v)}>
            {activos.map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} · {e.descripcion || e.flota}
              </option>
            ))}
          </CampoSelect>
          <div className="ts-campo">
            <span>Flota</span>
            <div className="ts-dato-fijo ts-dato-acento">{eq ? eq.flota : "—"}</div>
          </div>
          <label className="ts-campo">
            <span>Fecha de ingreso</span>
            <input type="date" value={form.fecha} max={fechaActualLocal()} onChange={(e) => campo("fecha", e.target.value)} />
          </label>
          <CampoSelect etiqueta="Turno" className="ts-select-acento" valor={form.turno} onChange={(v) => campo("turno", v)}>
            <option value="dia">Día</option>
            <option value="noche">Noche</option>
          </CampoSelect>
          <div className="ts-campo">
            <span>Personal</span>
            <div className="ts-dato-fijo ts-dato-ok">{usuario || "—"}</div>
          </div>
          {/* Como "Estado final del equipo" en Trabajos: verde / rojo */}
          <CampoSelect
            etiqueta="Sistema de lubricación"
            className={"ts-eng-select-sistema " + (form.resultado === "falla" ? "ts-select-estado-alerta" : "ts-select-estado-ok")}
            valor={form.resultado}
            onChange={(v) => campo("resultado", v)}
          >
            <option value="ok">Sin observaciones</option>
            <option value="falla">Reportar falla</option>
          </CampoSelect>
        </div>
        <label className="ts-campo ts-campo-full">
          <span>{form.resultado === "falla" ? "Falla encontrada (obligatorio)" : "Comentario"}</span>
          <AreaTexto
            rows={3}
            value={form.comentario}
            className={falta && form.resultado === "falla" && !form.comentario.trim() ? "ts-input-error" : ""}
            placeholder={form.resultado === "falla" ? "Ej. Bomba no presuriza, línea rota en pasador de dirección…" : "Opcional"}
            onChange={(e) => campo("comentario", e.target.value)}
          />
        </label>
        {falta && <div className="ts-verificaciones-error">{falta}</div>}
        <div className="ts-form-acciones">
          <button type="button" className="ts-btn" onClick={enviar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar inspección"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

// Historial del equipo: solo las 3 últimas inspecciones.
const ENGRASE_HISTORIAL_MAX = 3;
function HistorialEngrase({ fila, frecuencia, puedeRegistrar, usuario, onActualizar, onEliminar }) {
  const [reparar, setReparar] = useState(null);
  const [notaReparacion, setNotaReparacion] = useState("");
  const [faltaNota, setFaltaNota] = useState(false);
  const [eliminar, setEliminar] = useState(null);
  const { e } = fila;
  const lista = fila.lista.slice(0, ENGRASE_HISTORIAL_MAX);
  return (
    <Panel titulo={`Engrase — equipo ${e.codigo}`} subtitulo={[e.descripcion, e.modelo, e.flota].filter(Boolean).join(" · ")}>
      <div className="ts-eng-hist-cab">
        <div>
          Última inspección: <b>{fila.ultima ? formatoFecha(fila.ultima.fecha) : "nunca"}</b> <DiasEngrase dias={fila.dias} frecuencia={frecuencia} />
        </div>
        <div className="ts-texto-dim">Frecuencia: {frecuencia ? `${frecuencia} días` : "sin definir"}</div>
      </div>
      {fila.lista.length > ENGRASE_HISTORIAL_MAX && (
        <div className="ts-alm-subtitulo">Últimas {ENGRASE_HISTORIAL_MAX} inspecciones</div>
      )}
      {!lista.length ? (
        <div className="ts-vacio">Este equipo aún no tiene inspecciones registradas.</div>
      ) : (
        <div className="ts-eng-hist">
          {lista.map((r) => {
            const rep = r.reparacion || {};
            return (
              <div key={r.id} className={"ts-eng-hist-item" + (r.resultado === "falla" ? " falla" : "")}>
                <div className="ts-eng-hist-punto" />
                <div className="ts-eng-hist-cuerpo">
                  <div className="ts-eng-hist-linea">
                    <span className="ts-mono">{formatoFecha(r.fecha)}</span>
                    {r.turno && <span className={"ts-badge ts-badge-" + (r.turno === "noche" ? "noche" : "dia")}>{TEXTO_TURNO[r.turno] || r.turno}</span>}
                    {r.resultado === "falla" ? (
                      rep.estado === "reparado" ? (
                        <span className="ts-badge ts-badge-ok">Falla reparada</span>
                      ) : (
                        <span className="ts-badge ts-badge-alerta">Falla por reparar</span>
                      )
                    ) : (
                      <span className="ts-badge ts-badge-ok">Sin observaciones</span>
                    )}
                    <span className="ts-texto-dim">{usuarioDoc(r.inspector) || ""}</span>
                  </div>
                  {r.comentario && <div className="ts-eng-hist-texto">{r.comentario}</div>}
                  {rep.estado === "reparado" && (
                    <div className="ts-eng-hist-rep">
                      Reparado {textoMarca(rep.fecha)}
                      {rep.usuario ? ` · ${usuarioDoc(rep.usuario)}` : ""}
                      {rep.nota ? ` — ${rep.nota}` : ""}
                    </div>
                  )}
                  {puedeRegistrar && (
                    <div className="ts-eng-hist-botones">
                      {fallaPendiente(r) && (
                        <button type="button" className="ts-btn-mini" onClick={() => (setNotaReparacion(""), setFaltaNota(false), setReparar(r))}>
                          Marcar reparado
                        </button>
                      )}
                      <button type="button" className="ts-btn-mini ts-btn-mini-alerta" onClick={() => setEliminar(r)}>
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {reparar && (
        <div className="ts-confirmar-cierre-fondo" onClick={() => setReparar(null)}>
          <div className="ts-confirmar-cierre" role="alertdialog" aria-modal="true" onClick={(ev) => ev.stopPropagation()}>
            <div className="ts-confirmar-cierre-titulo">¿Marcar como reparada la falla del equipo {e.codigo}?</div>
            <div className="ts-confirmar-cierre-texto">{reparar.comentario}</div>
            <label className="ts-campo ts-confirmar-campos">
              <span>Detalle de la reparación</span>
              <input
                type="text"
                value={notaReparacion}
                className={faltaNota ? "ts-input-error" : ""}
                onChange={(ev) => (setNotaReparacion(ev.target.value), setFaltaNota(false))}
                autoFocus
              />
            </label>
            {faltaNota && <div className="ts-verificaciones-error">Escribe el detalle de la reparación para continuar.</div>}
            <div className="ts-confirmar-cierre-botones">
              <button type="button" className="ts-btn-ghost" onClick={() => setReparar(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="ts-btn"
                onClick={() => {
                  if (!notaReparacion.trim()) return setFaltaNota(true);
                  onActualizar({ ...reparar, reparacion: { estado: "reparado", fecha: marcaDeTiempo(), usuario, nota: notaReparacion.trim() } });
                  setReparar(null);
                }}
              >
                Sí, confirmar
              </button>
            </div>
          </div>
        </div>
      )}
      {eliminar && (
        <div className="ts-confirmar-cierre-fondo" onClick={() => setEliminar(null)}>
          <div className="ts-confirmar-cierre" role="alertdialog" aria-modal="true" onClick={(ev) => ev.stopPropagation()}>
            <div className="ts-confirmar-cierre-titulo">¿Eliminar la inspección del {formatoFecha(eliminar.fecha)}?</div>
            <div className="ts-confirmar-cierre-texto">Equipo {e.codigo}. Esta acción no se puede deshacer.</div>
            <div className="ts-confirmar-cierre-botones">
              <button type="button" className="ts-btn-ghost" onClick={() => setEliminar(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="ts-btn ts-btn-peligro"
                onClick={() => {
                  onEliminar(eliminar.id);
                  setEliminar(null);
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Almacén: búsqueda por número de parte (botón de la caja en Requerimientos)
// El Administrador actualiza el inventario subiendo el Excel semanal.
// ---------------------------------------------------------------------------
function IconoCaja() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8.2 12 4.6l8 3.6v8.4L12 20.4 4 16.6Z" />
      <path d="M4 8.2 12 12l8-3.8" />
      <path d="M12 12v8.4" />
      <path d="M4 8.2 2 11.4l8 3.8L12 12" />
      <path d="M20 8.2l2 3.2-8 3.8L12 12" />
    </svg>
  );
}

const normalNP = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function FichaInventario({ item }) {
  const disp = item.cantidad_disponible === null || item.cantidad_disponible === "" || item.cantidad_disponible === undefined ? 0 : Number(item.cantidad_disponible);
  const dato = (etiqueta, valor, clase = "") => (
    <div className={"ts-alm-dato " + clase}>
      <span>{etiqueta}</span>
      <b>{valor === null || valor === undefined || valor === "" ? "—" : valor}</b>
    </div>
  );
  return (
    <div className="ts-alm-ficha">
      <div className="ts-alm-ficha-cab">
        <div>
          <div className="ts-alm-ficha-np">{item.numero_parte}</div>
          <div className="ts-alm-ficha-desc">{item.descripcion || "Sin descripción"}</div>
        </div>
        <span className={"ts-alm-stock " + (disp > 0 ? "ok" : "no")}>{disp > 0 ? `${numeroMiles(disp)} disponibles` : "Sin stock disponible"}</span>
      </div>
      <div className="ts-alm-datos">
        {dato("Número de parte", item.numero_parte, "ts-mono")}
        {dato("Descripción", item.descripcion)}
        {dato("Detalle", item.detalle)}
        {dato("Unidad", item.unidad)}
        {dato("Cantidad disponible", numeroMiles(item.cantidad_disponible), "ts-mono ts-alm-dato-clave")}
        {dato("Cantidad neta", numeroMiles(item.cantidad_neta), "ts-mono")}
        {dato("Cantidad en recepción", numeroMiles(item.cantidad_recepcion), "ts-mono")}
        {dato("Ubicación", item.ubicacion, "ts-mono")}
      </div>
    </div>
  );
}

function BuscadorAlmacen({ esAdmin, usuario }) {
  const [imp, setImp] = useState(undefined);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(null);
  const refConsulta = useRef(0);

  function cargarImp() {
    db.leerImportacion("inventario").then(setImp, (e) => (setImp(null), setError(e.message || String(e))));
  }
  useEffect(cargarImp, []);

  useEffect(() => {
    const q = texto.trim();
    setAbierto(null);
    if (normalNP(q).length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const n = ++refConsulta.current;
    const t = setTimeout(async () => {
      try {
        const r = await db.buscarInventario(q);
        if (n === refConsulta.current) {
          setResultados(r);
          setError("");
        }
      } catch (e) {
        if (n === refConsulta.current) setError(e.message || String(e));
      } finally {
        if (n === refConsulta.current) setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const q = normalNP(texto);
  const exactos = resultados.filter((r) => normalNP(r.numero_parte) === q || normalNP(r.segundo_numero) === q);
  const otros = resultados.filter((r) => !exactos.includes(r));

  return (
    <Panel
      titulo="Almacén"
      subtitulo={esAdmin && imp ? `Inventario: ${numeroMiles(imp.filas)} ítems` : undefined}
      acciones={esAdmin ? <ImportarExcel tipo="inventario" usuario={usuario} onImportado={cargarImp} texto="Actualizar inventario (Excel)" /> : null}
    >
      <div className="ts-alm-buscar">
        <IconoLupa />
        <input
          type="search"
          autoFocus
          value={texto}
          /* Se quitan solos los guiones y espacios (6V-5686 → 6V5686) */
          onChange={(e) => setTexto(e.target.value.replace(/[\s\-‐-―]+/g, ""))}
          placeholder="Número de parte"
          aria-label="Número de parte"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="ts-alm-meta">
        {imp ? <MetaImportacion imp={imp} conUsuario={false} /> : imp === null && !error ? "Aún no se cargó el inventario." : ""}
      </div>
      {error ? (
        <div className="ts-vacio">{error}</div>
      ) : q.length < 2 ? (
        <div className="ts-alm-ayuda">Escribe el número de parte con o sin guiones y espacios.</div>
      ) : buscando && !resultados.length ? (
        <div className="ts-vacio">Buscando…</div>
      ) : !resultados.length ? (
        <div className="ts-vacio">No se encontró “{texto.trim()}” en el inventario.</div>
      ) : (
        <div className="ts-alm-resultados">
          {exactos.map((r) => (
            <FichaInventario key={r.id} item={r} />
          ))}
          {otros.length > 0 && (
            <>
              <div className="ts-alm-subtitulo">{exactos.length ? "Otras coincidencias" : "Coincidencias"} ({otros.length})</div>
              <div className="ts-alm-lista">
                {otros.map((r) =>
                  abierto === r.id ? (
                    <div key={r.id} onClick={() => setAbierto(null)}>
                      <FichaInventario item={r} />
                    </div>
                  ) : (
                    <button key={r.id} type="button" className="ts-alm-fila" onClick={() => setAbierto(r.id)}>
                      <span className="ts-mono ts-alm-fila-np">{r.numero_parte}</span>
                      <span className="ts-alm-fila-desc">{r.descripcion}</span>
                      <span className={"ts-alm-fila-disp " + (Number(r.cantidad_disponible) > 0 ? "ok" : "no")}>{numeroMiles(r.cantidad_disponible) || "0"}</span>
                    </button>
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Vista: Historial
// ---------------------------------------------------------------------------

// Detalle de solo lectura de un trabajo (Historial): descripción completa,
// personal y demás datos del registro.
function DetalleTrabajo({ trabajo: t, onCerrar }) {
  const ok = t.estado_final === "disponible";
  const dato = (etiqueta, valor, clase) => (
    <div className="ts-detalle-dato">
      <span>{etiqueta}</span>
      <div className={clase || ""}>{valor || "—"}</div>
    </div>
  );
  return (
    <ModalFormulario onCerrar={onCerrar}>
      <Panel titulo={`Trabajo — ${t.equipo} · Flota ${t.flota}`}>
        <div className="ts-detalle-grid">
          {dato("OT", t.ot, "ts-mono")}
          {dato("Fecha", formatoFecha(t.fecha), "ts-mono")}
          {dato("Turno", textoTurno(t.turno))}
          {dato("Grupo", nombreGrupo(t.grupo))}
          {dato("Tipo", t.tipo_trabajo === "programado" ? "Programado" : "No programado")}
          {dato("Ubicación", t.ubicacion)}
          {dato("Horario", `${t.hora_inicio || "--:--"} – ${t.hora_fin || "--:--"}`, "ts-mono")}
          {dato("Tiempo de trabajo", calcularTiempoTrabajo(t.hora_inicio, t.hora_fin), "ts-mono")}
          {dato(
            "Estado final",
            <span className={"ts-badge " + (ok ? "ts-badge-ok" : "ts-badge-alerta")}>{ok ? "Disponible" : "No disponible"}</span>
          )}
        </div>
        {dato("Falla del equipo", t.sintoma_causa, "ts-detalle-titulo")}
        {dato("Descripción del trabajo", t.descripcion, "ts-detalle-texto")}
        {dato(
          "Personal que realizó el trabajo",
          (t.participantes || []).length ? (
            <div className="ts-detalle-personal">
              {t.participantes.map((p) => (
                <span key={p} className="ts-chip-persona">
                  {p}
                </span>
              ))}
            </div>
          ) : (
            "Sin personal registrado"
          )
        )}
        {t.observaciones && dato("Síntoma y causa de la falla", t.observaciones, "ts-detalle-texto")}
      </Panel>
    </ModalFormulario>
  );
}

const HISTORIAL_POR_PAGINA = 25;

// Pie de lista con el conteo y el botón para cargar la siguiente tanda.
function CargarMas({ mostrados, total, onCargar, texto }) {
  if (total === 0) return null;
  const restantes = total - mostrados;
  return (
    <div className="ts-cargar-mas">
      <span>
        Mostrando {Math.min(mostrados, total)} de {total} {texto}
      </span>
      {restantes > 0 ? (
        <button type="button" className="ts-btn-ghost ts-cargar-mas-btn" onClick={onCargar}>
          Cargar {Math.min(HISTORIAL_POR_PAGINA, restantes)} más
        </button>
      ) : (
        total > HISTORIAL_POR_PAGINA && <span className="ts-cargar-mas-fin">Se cargó todo el rango filtrado</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Búsqueda en Historial: sin distinguir mayúsculas ni tildes. El resaltado
// usa la API CSS Custom Highlight (no modifica el DOM de React).
// ---------------------------------------------------------------------------
function normalizarCaracter(c) {
  const n = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return n.length === 1 ? n : c.toLowerCase().slice(0, 1);
}
function normalizarBusqueda(texto) {
  return Array.from(String(texto || "")).map(normalizarCaracter).join("");
}
// Color de resaltado distinto al color principal del tema: amarillo, o
// celeste si el tema ya es amarillo/naranja.
function coloresResaltado(acento) {
  const h = (acento || "").replace("#", "");
  let tono = 210;
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d) {
      tono = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      tono = (tono * 60 + 360) % 360;
    }
  }
  return tono >= 20 && tono <= 75
    ? { todas: "#7fe3f0", actual: "#22b8e6" }
    : { todas: "#ffe44d", actual: "#ff9632" };
}

const VISTAS_CON_BUSQUEDA = ["trabajos", "aceites", "requerimientos", "componentes", "engrase", "historial"];
const PLACEHOLDER_BUSQUEDA = {
  componentes: "Buscar equipo o componente",
  engrase: "Buscar equipo o comentario",
  trabajos: "Buscar en trabajos",
  aceites: "Buscar en aceites",
  requerimientos: "Buscar en requerimientos",
  historial: "Buscar en historial",
};

// Cuadro de búsqueda con el mismo estilo que el cuadro de Filtros:
// cabecera con título y ×, campo de la app y navegación entre coincidencias.
function IconoFlechaBusqueda({ dir }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {dir === "arriba" ? <polyline points="6 15 12 9 18 15" /> : <polyline points="6 9 12 15 18 9" />}
    </svg>
  );
}
function BarraBusqueda({ texto, onTexto, placeholder = "Buscar", total, actual, onAnterior, onSiguiente, onCerrar }) {
  const ref = React.useRef(null);
  useEffect(() => {
    ref.current && ref.current.focus();
  }, []);
  const hayTexto = !!texto.trim();
  return (
    <div className="ts-buscador" role="search">
      <div className="ts-filtros-popover-cabecera">
        <span>Buscar</span>
        <button type="button" className="ts-filtros-popover-cerrar" title="Cerrar búsqueda (Esc)" onClick={onCerrar}>
          ×
        </button>
      </div>
      <div className="ts-buscador-cuerpo">
        <label className="ts-buscador-campo">
          <IconoLupa />
          <input
            ref={ref}
            type="search"
            value={texto}
            placeholder={placeholder}
            onChange={(e) => onTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.shiftKey ? onAnterior : onSiguiente)();
              if (e.key === "Escape") onCerrar();
            }}
          />
          {hayTexto && (
            <button type="button" className="ts-buscador-borrar" title="Borrar texto" onClick={() => { onTexto(""); ref.current && ref.current.focus(); }}>
              ×
            </button>
          )}
        </label>
        <span className={"ts-buscador-conteo" + (hayTexto && !total ? " ts-buscador-sin" : "")}>
          {hayTexto ? (total ? `${actual + 1} de ${total}` : "Sin resultados") : "0 de 0"}
        </span>
        <div className="ts-buscador-nav">
          <button type="button" className="ts-btn-mini" title="Anterior (Mayús + Enter)" disabled={!total} onClick={onAnterior}>
            <IconoFlechaBusqueda dir="arriba" />
          </button>
          <button type="button" className="ts-btn-mini" title="Siguiente (Enter)" disabled={!total} onClick={onSiguiente}>
            <IconoFlechaBusqueda dir="abajo" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Envuelve una pestaña (Trabajos, Aceites, Requerimientos, Historial) y
// resalta las coincidencias del buscador. No oculta registros ni cambia la
// carga por partes. Si una palabra queda dentro de un texto recortado ("…"),
// ese texto se expande para que la palabra se vea.
const CLASE_EXPANDIDO = "ts-expandido-busqueda";
function textoRecortaA(el, rango) {
  const cs = getComputedStyle(el);
  const recorta =
    cs.overflow === "hidden" || cs.overflowX === "hidden" || cs.overflowY === "hidden" || cs.webkitLineClamp !== "none";
  if (!recorta) return false;
  const a = el.getBoundingClientRect();
  const r = rango.getBoundingClientRect();
  return r.bottom > a.bottom + 1 || r.right > a.right + 1 || el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
}
function ZonaBusqueda({ abierto, texto, onTexto, onCerrar, colorAcento, placeholder, children }) {
  const termino = normalizarBusqueda((texto || "").trim());
  const contenedorRef = React.useRef(null);
  const rangosRef = React.useRef([]);
  const [total, setTotal] = useState(0);
  const [actual, setActual] = useState(0);
  const actualRef = React.useRef(0);
  actualRef.current = actual;
  const api = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";

  useEffect(() => {
    const raiz = contenedorRef.current;
    if (!raiz) return;
    let pendiente = null;
    function limpiar() {
      if (api) {
        CSS.highlights.delete("ts-busqueda");
        CSS.highlights.delete("ts-busqueda-actual");
      }
    }
    function buscarRangos() {
      const rangos = [];
      const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
      let nodo;
      while ((nodo = recorrido.nextNode())) {
        const el = nodo.parentElement;
        if (!el || el.closest(".ts-buscador, select, option, button, .ts-filtros-popover, .ts-modal-form-fondo")) continue;
        if (!el.getClientRects().length) continue; // oculto (vista móvil/escritorio, cuadro cerrado)
        const norm = normalizarBusqueda(nodo.textContent);
        let i = norm.indexOf(termino);
        while (i !== -1) {
          const r = document.createRange();
          r.setStart(nodo, i);
          r.setEnd(nodo, i + termino.length);
          rangos.push(r);
          i = norm.indexOf(termino, i + termino.length);
        }
      }
      return rangos;
    }
    function calcular() {
      pendiente = null;
      limpiar();
      raiz.querySelectorAll("." + CLASE_EXPANDIDO).forEach((n) => n.classList.remove(CLASE_EXPANDIDO));
      if (!termino) {
        rangosRef.current = [];
        setTotal(0);
        return;
      }
      let rangos = buscarRangos();
      // Expandir textos recortados que esconden una coincidencia
      let expandio = false;
      rangos.forEach((r) => {
        const fila = r.startContainer.parentElement.closest("tr, .ts-tm-card, .ts-tabla-wrap, .ts-panel") || raiz;
        let el = r.startContainer.parentElement;
        while (el && el !== fila && el !== raiz) {
          if (textoRecortaA(el, r)) {
            el.classList.add(CLASE_EXPANDIDO);
            expandio = true;
          }
          el = el.parentElement;
        }
      });
      if (expandio) rangos = buscarRangos();
      rangosRef.current = rangos;
      setTotal(rangos.length);
      setActual((n) => (n < rangos.length ? n : 0));
      if (api && rangos.length) {
        CSS.highlights.set("ts-busqueda", new Highlight(...rangos));
        CSS.highlights.set("ts-busqueda-actual", new Highlight(rangos[actualRef.current] || rangos[0]));
      }
    }
    function programar() {
      if (!pendiente) pendiente = requestAnimationFrame(calcular);
    }
    programar();
    // Se recalcula cuando cambia el contenido (Cargar más, filtros, edición)
    const observador = new MutationObserver(programar);
    observador.observe(raiz, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", programar);
    return () => {
      if (pendiente) cancelAnimationFrame(pendiente);
      observador.disconnect();
      window.removeEventListener("resize", programar);
      limpiar();
      raiz.querySelectorAll("." + CLASE_EXPANDIDO).forEach((n) => n.classList.remove(CLASE_EXPANDIDO));
    };
  }, [termino]);

  useEffect(() => setActual(0), [termino]);

  // Coincidencia actual: color más intenso y se desplaza hasta su fila
  useEffect(() => {
    const r = rangosRef.current[actual];
    if (!r) return;
    if (api) CSS.highlights.set("ts-busqueda-actual", new Highlight(r));
    const el = r.startContainer.parentElement;
    const destino = el && (el.closest("tr, .ts-tm-card, .ts-aceite-card") || el);
    destino && destino.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [actual, total, termino]);

  function mover(paso) {
    if (!total) return;
    setActual((n) => (n + paso + total) % total);
  }
  const resaltado = coloresResaltado(colorAcento);
  return (
    <div
      ref={contenedorRef}
      className="ts-zona-busqueda"
      style={{ "--ts-resaltado": resaltado.todas, "--ts-resaltado-actual": resaltado.actual }}
    >
      {abierto && (
        <BarraBusqueda
          texto={texto}
          onTexto={onTexto}
          placeholder={placeholder}
          total={total}
          actual={actual}
          onAnterior={() => mover(-1)}
          onSiguiente={() => mover(1)}
          onCerrar={onCerrar}
        />
      )}
      {children}
    </div>
  );
}

function Historial({ trabajos, aceites, equipos }) {
  const [detalleTrabajo, setDetalleTrabajo] = useState(null);
  const [equipo, setEquipo] = useState("todos");
  const [fechaInicio, setFechaInicio] = useState(HOY);
  const [fechaFin, setFechaFin] = useState(HOY);
  const [turno, setTurno] = useState("todos");
  const [grupo, setGrupo] = useState("todos");
  // Qué registros mostrar en el historial: "trabajos" o "aceites".
  const [vista, setVista] = useState("trabajos");
  const verTrabajos = vista === "trabajos";
  const verAceites = vista === "aceites";
  const [menuExportAbierto, setMenuExportAbierto] = useState(false);
  // Carga por partes: se muestran HISTORIAL_POR_PAGINA registros y el botón
  // "Cargar más" agrega otra tanda, hasta cubrir todo el rango filtrado.
  const [limiteTrabajos, setLimiteTrabajos] = useState(HISTORIAL_POR_PAGINA);
  const [limiteAceites, setLimiteAceites] = useState(HISTORIAL_POR_PAGINA);
  useEffect(() => {
    setLimiteTrabajos(HISTORIAL_POR_PAGINA);
    setLimiteAceites(HISTORIAL_POR_PAGINA);
  }, [equipo, fechaInicio, fechaFin, turno, grupo]);

  const trabajosOrdenados = trabajos
    .filter((t) => equipo === "todos" || t.equipo === equipo)
    .filter((t) => !fechaInicio || t.fecha >= fechaInicio)
    .filter((t) => !fechaFin || t.fecha <= fechaFin)
    .filter((t) => turno === "todos" || t.turno === turno)
    .filter((t) => grupo === "todos" || String(t.grupo) === grupo)
    .slice()
    .sort((a, b) => (claveOrden(a) < claveOrden(b) ? 1 : -1));

  const aceitesOrdenados = aceites
    .filter((a) => equipo === "todos" || a.equipo === equipo)
    .filter((a) => !fechaInicio || a.fecha >= fechaInicio)
    .filter((a) => !fechaFin || a.fecha <= fechaFin)
    .filter((a) => turno === "todos" || a.turno === turno)
    .slice()
    .sort((a, b) => (claveOrden(a) < claveOrden(b) ? 1 : -1));

  const limiteT = limiteTrabajos;
  const limiteA = limiteAceites;

  const hayFiltrosActivos =
    equipo !== "todos" || fechaInicio || fechaFin || turno !== "todos" || grupo !== "todos";

  function limpiarFiltros() {
    setEquipo("todos");
    setFechaInicio("");
    setFechaFin("");
    setTurno("todos");
    setGrupo("todos");
  }

  // Exporta lo que se está mostrando: trabajos o aceites.
  function exportar(formato) {
    setMenuExportAbierto(false);
    if (verTrabajos) {
      const filas = filasExportTrabajos(trabajosOrdenados);
      if (formato === "excel") exportarExcel(filas, COLUMNAS_EXPORT_TRABAJOS, "historial_mantenimiento");
      if (formato === "word") exportarWord(filas, COLUMNAS_EXPORT_TRABAJOS, "historial_mantenimiento", "Historial de mantenimiento");
      if (formato === "pdf") exportarPDF(filas, COLUMNAS_EXPORT_TRABAJOS, "Historial de mantenimiento");
    }
    if (verAceites) {
      const filas = filasExportAceites(aceitesOrdenados);
      if (formato === "excel") exportarExcel(filas, COLUMNAS_EXPORT_ACEITES, "historial_aceites");
      if (formato === "word") exportarWord(filas, COLUMNAS_EXPORT_ACEITES, "historial_aceites", "Historial de aceites");
      if (formato === "pdf") exportarPDF(filas, COLUMNAS_EXPORT_ACEITES, "Historial de aceites");
    }
  }

  return (
    // ts-historial: en Historial los trabajos se muestran completos (sin recorte)
    <div className="ts-stack ts-historial">
      <PopoverFiltros
        activos={!!hayFiltrosActivos}
        resumen={[
          vista === "trabajos" ? "Trabajos" : "Aceites",
          textoRango(fechaInicio, fechaFin),
          equipo !== "todos" && `Equipo ${equipo}`,
          TEXTO_TURNO[turno],
          grupo !== "todos" && nombreGrupo(grupo),
        ]}
      >
      <div className="ts-filtros">
        <div className="ts-filtro ts-filtro-vista">
          <span>Mostrar</span>
          <div className="ts-segmento" role="tablist">
            {[
              ["trabajos", "Trabajos"],
              ["aceites", "Aceites"],
            ].map(([clave, texto]) => (
              <button
                key={clave}
                type="button"
                role="tab"
                aria-selected={vista === clave}
                className={"ts-segmento-op" + (vista === clave ? " activo" : "")}
                onClick={() => setVista(clave)}
              >
                {texto}
              </button>
            ))}
          </div>
        </div>
        <label className="ts-filtro">
          <span>Equipo</span>
          <select value={equipo} onChange={(e) => setEquipo(e.target.value)}>
            <option value="todos">Todos</option>
            {equipos.map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo}
              </option>
            ))}
          </select>
        </label>
        <label className="ts-filtro">
          <span>Desde</span>
          <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        </label>
        <label className="ts-filtro">
          <span>Hasta</span>
          <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
        </label>
        <label className="ts-filtro">
          <span>Turno</span>
          <select value={turno} onChange={(e) => setTurno(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="dia">Día</option>
            <option value="noche">Noche</option>
          </select>
        </label>
        <label className="ts-filtro" style={verTrabajos ? undefined : { opacity: 0.45 }} title={verTrabajos ? undefined : "El grupo solo aplica a trabajos"}>
          <span>Grupo</span>
          <select value={grupo} disabled={!verTrabajos} onChange={(e) => setGrupo(e.target.value)}>
            <option value="todos">Todos</option>
            {listaGrupos().map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.nombre}
              </option>
            ))}
          </select>
        </label>
        {hayFiltrosActivos && (
          <button className="ts-btn-ghost" onClick={limpiarFiltros}>
            Limpiar filtros
          </button>
        )}
      </div>
      </PopoverFiltros>

      <div className="ts-accion-row ts-accion-row-split">
        <div className="ts-export-dropdown">
          <button className="ts-btn ts-btn-exportar" title="Exportar" onClick={() => setMenuExportAbierto((v) => !v)}>
            <span className="ts-btn-texto">Exportar ▾</span>
            <span className="ts-fab-icono"><IconoFabExportar /></span>
          </button>
          {menuExportAbierto && (
            <>
              <div className="ts-overlay-cerrar" onClick={() => setMenuExportAbierto(false)} />
              <div className="ts-export-menu">
                <button onClick={() => exportar("pdf")}>Formato PDF</button>
                <button onClick={() => exportar("word")}>Formato Word</button>
                <button onClick={() => exportar("excel")}>Formato Excel</button>
              </div>
            </>
          )}
        </div>
      </div>

      {verTrabajos && (
      <Panel titulo="Historial de mantenimiento">
        <TablaTrabajos filas={trabajosOrdenados.slice(0, limiteT)} onFilaClick={setDetalleTrabajo} />
        <CargarMas
          mostrados={limiteT}
          total={trabajosOrdenados.length}
          texto="trabajos"
          onCargar={() => setLimiteTrabajos((n) => n + HISTORIAL_POR_PAGINA)}
        />
        {detalleTrabajo && <DetalleTrabajo trabajo={detalleTrabajo} onCerrar={() => setDetalleTrabajo(null)} />}
      </Panel>
      )}

      {verAceites && (
      <Panel titulo="Historial de aceites">
        {aceitesOrdenados.length === 0 ? (
          <div className="ts-vacio">Sin registros.</div>
        ) : (
          <>
          <TarjetasAceiteMovil registros={aceitesOrdenados.slice(0, limiteA)} onImprimir={imprimirRegistroAceite} />
          <div className="ts-tabla-wrap ts-aceites-tabla">
            <table className="ts-tabla ts-tabla-cards">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th>Fecha</th>
                  <th>Turno</th>
                  <th>Tipo de trabajo</th>
                  <th>Registro</th>
                  <th>Ubicación</th>
                  <th>Tipo de aceite</th>
                  <th>Sistema</th>
                  <th>Litros</th>
                  <th>Horómetro</th>
                  <th>Horario</th>
                  <th className="ts-col-verif">Verificaciones</th>
                  <th>Personal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {aceitesOrdenados.slice(0, limiteA).map((a) => (
                  <tr key={a.id}>
                    <td className="ts-mono">{a.equipo}</td>
                    <td className="ts-mono">{a.fecha}</td>
                    <td>
                      <EtiquetaTurno turno={a.turno} />
                    </td>
                    <td>
                      <EtiquetaTipoTrabajo registro={a} />
                    </td>
                    <td>
                      <EtiquetaRegistroAceite op={a.tipo_operacion} />
                    </td>
                    <td><div className="ts-clamp-2">{a.ubicacion || "—"}</div></td>
                    <td><div className="ts-clamp-2">{a.tipo_aceite}</div></td>
                    <td><div className="ts-clamp-2">{a.sistema_equipo}</div></td>
                    <td className="ts-mono">{a.cantidad_litros === "" || a.cantidad_litros == null ? "—" : `${a.cantidad_litros} L`}</td>
                    <td className="ts-mono">{a.horometro}</td>
                    <td className="ts-mono">{a.hora_inicio || "—"}{a.hora_fin ? `–${a.hora_fin}` : ""}</td>
                    <td className="ts-col-verif">
                      <IconoVerificaciones registro={a} />
                    </td>
                    <td><div className="ts-clamp-2">{(a.participantes || []).join(", ") || "—"}</div></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="ts-acciones-fila">
                        <button className="ts-btn-mini" title="Imprimir registro (PDF)" onClick={() => imprimirRegistroAceite(a)}>
                          <IconoImprimir />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        <CargarMas
          mostrados={limiteA}
          total={aceitesOrdenados.length}
          texto="registros"
          onCargar={() => setLimiteAceites((n) => n + HISTORIAL_POR_PAGINA)}
        />
      </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista: Configuración
// ---------------------------------------------------------------------------

const TAMANOS_LETRA_REPORTE = [
  ["0.9", "Pequeño"],
  ["1", "Normal"],
  ["1.12", "Grande"],
  ["1.25", "Muy grande"],
];

// Configuración → Reportes: textos del encabezado, firmas y pie de página de
// los reportes impresos (reporte de turno), con vista previa.
function PanelConfigReporte({ config, onCambiar, trabajos, usuario }) {
  const campo = (clave) => (v) => onCambiar((prev) => ({ ...prev, [clave]: v }));
  const texto = (clave, etiqueta, placeholder) => (
    <label className="ts-campo">
      <span>{etiqueta}</span>
      <input type="text" value={config[clave]} placeholder={placeholder} onChange={(e) => campo(clave)(e.target.value)} />
    </label>
  );
  // Medida del cajetín en px (campo numérico).
  const numero = (clave, etiqueta, min, max, paso = 1) => (
    <label className="ts-campo">
      <span>{etiqueta}</span>
      <div className="ts-campo-px">
        <input
          type="number"
          min={min}
          max={max}
          step={paso}
          value={config[clave] ?? CONFIG_REPORTE_INICIAL[clave]}
          onChange={(e) => campo(clave)(e.target.value === "" ? "" : Number(e.target.value))}
        />
        <em>px</em>
      </div>
    </label>
  );
  const mc = medidasCajetin(config);
  const colorDoc = registroReporte.color || "#4a8fe0";
  const ladoLogo = Math.min(mc.altoLogo, 50);
  const casilla = (clave, etiqueta) => (
    <label className="ts-campo ts-check">
      <input type="checkbox" checked={!!config[clave]} onChange={(e) => campo(clave)(e.target.checked)} />
      <span>{etiqueta}</span>
    </label>
  );

  function verEjemplo() {
    // Usa el turno más reciente con trabajos registrados
    const ordenados = trabajos.slice().sort((a, b) => (claveOrden(a) > claveOrden(b) ? -1 : 1));
    const ultimo = ordenados[0];
    const delTurno = ultimo ? trabajos.filter((t) => t.fecha === ultimo.fecha && t.turno === ultimo.turno) : [];
    imprimirReporteTurno(delTurno, usuario);
  }

  return (
    <Panel titulo="Reportes" colapsable>
      <div className="ts-campo-ayuda" style={{ marginBottom: 12 }}>
        Edita el encabezado y la presentación del reporte de turno (Trabajos → Exportar → Formato PDF). El logo y el
        color se toman de Aspecto. El tipo y tamaño de letra se aplican a todos los documentos impresos.
      </div>
      <div className="ts-form-grid">
        {texto("empresa", "Nombre de la empresa", "Ej. Minera San Cristóbal")}
        {texto("area", "Área / Departamento", "Ej. Taller de Mantenimiento")}
        {texto("titulo", "Título del reporte", "Ej. REPORTE DE TURNO")}
        {texto("subtitulo", "Subtítulo", "Ej. Mantenimiento de equipos mineros")}
        {texto("codigo", "Código del documento", "Ej. TS-REP-001")}
        {texto("revision", "Revisión", "Ej. 01")}
        <label className="ts-campo">
          <span>Tipo de letra</span>
          <select value={config.fuente || ""} onChange={(e) => campo("fuente")(e.target.value)}>
            <option value="">Predeterminada del reporte</option>
            {FUENTES_DISPONIBLES.filter((f) => !f.nombre.startsWith("Predeterminada")).map((f) => (
              <option key={f.nombre} value={f.valor}>
                {f.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="ts-campo">
          <span>Tamaño de letra</span>
          <select value={config.tamanoLetra || "1"} onChange={(e) => campo("tamanoLetra")(e.target.value)}>
            {TAMANOS_LETRA_REPORTE.map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ts-campo-full">{texto("pie", "Pie de página", "Ej. Documento generado por TRUCK SHOP")}</div>

      {/* Cajetín: textos de los datos del documento y todos sus tamaños, con
          vista previa en vivo. */}
      <div className="ts-cajetin-config">
        <div className="ts-cajetin-titulo">Cajetín del reporte</div>
        <div className="ts-cajetin-previa" aria-label="Vista previa del cajetín">
          <table style={{ height: mc.alto ? mc.alto : undefined }}>
            <tbody>
              <tr>
                <td className="ts-cp-logo" style={{ width: mc.anchoLogo }}>
                  {registroReporte.logoUrl ? (
                    <img src={registroReporte.logoUrl} alt="logo" style={{ maxWidth: Math.max(20, mc.anchoLogo - 24), maxHeight: mc.altoLogo }} />
                  ) : (
                    <div
                      className="ts-cp-ini"
                      style={{ width: ladoLogo, height: ladoLogo, background: colorDoc, fontSize: Math.round(ladoLogo * 0.36) }}
                    >
                      {inicialesDe(registroReporte.nombreApp || config.empresa)}
                    </div>
                  )}
                </td>
                <td className="ts-cp-centro">
                  <div style={{ fontSize: mc.empresa, letterSpacing: ".04em" }}>{config.empresa}</div>
                  <div style={{ fontSize: mc.area, color: "#6b7280", marginTop: 1 }}>{config.area}</div>
                  <div style={{ fontSize: mc.titulo, color: colorDoc, marginTop: 4, letterSpacing: ".03em" }}>{config.titulo}</div>
                  {config.subtitulo && <div style={{ fontSize: mc.subtitulo, color: "#6b7280", marginTop: 2 }}>{config.subtitulo}</div>}
                </td>
                <td className="ts-cp-doc" style={{ width: mc.anchoDatos, fontSize: mc.datos }}>
                  <div><span>{mc.etCodigo}</span>{config.codigo}</div>
                  <div><span>{mc.etRevision}</span>{config.revision}</div>
                  <div><span>{mc.etEmitido}</span>{fechaEmisionDoc()}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="ts-cajetin-sub">Descripciones</div>
        <div className="ts-form-grid">
          {texto("etiquetaCodigo", "Descripción de «Código»", "Ej. Código")}
          {texto("etiquetaRevision", "Descripción de «Revisión»", "Ej. Revisión")}
          {texto("etiquetaEmitido", "Descripción de «Emitido»", "Ej. Emitido")}
        </div>
        <div className="ts-cajetin-sub">Tamaños</div>
        <div className="ts-form-grid ts-form-grid-3">
          {numero("cajAnchoLogo", "Ancho del lado del logo", 60, 320)}
          {numero("cajAnchoDatos", "Ancho del lado de datos", 100, 320)}
          {numero("cajAltoLogo", "Alto del logo", 20, 120)}
          {numero("cajAlto", "Alto mínimo del cajetín (0 = automático)", 0, 220)}
          {numero("cajLetraEmpresa", "Letra: empresa", 6, 30, 0.5)}
          {numero("cajLetraArea", "Letra: área", 6, 30, 0.5)}
          {numero("cajLetraTitulo", "Letra: título", 6, 36, 0.5)}
          {numero("cajLetraSubtitulo", "Letra: subtítulo", 6, 30, 0.5)}
          {numero("cajLetraDatos", "Letra: Código, Revisión y Emitido", 6, 24, 0.5)}
        </div>
      </div>
      <div className="ts-form-acciones">
        <button type="button" className="ts-btn-ghost" onClick={() => onCambiar(CONFIG_REPORTE_INICIAL)}>
          Restablecer
        </button>
        <button type="button" className="ts-btn" onClick={verEjemplo}>
          Ver vista previa
        </button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Configuración → Almacenamiento (solo Administrador): espacio usado por la
// base de datos y por los archivos (imágenes de los registros, en el futuro),
// frente al límite del plan de Supabase, con el historial de uso en un
// gráfico y una estimación de cuándo se llenaría. Cada día que el
// Administrador abre este cuadro se guarda una medición (configuración
// "almacenamiento").
// ---------------------------------------------------------------------------
const LIMITES_ALMACENAMIENTO_INICIAL = { base_mb: 500, archivos_mb: 1024 };
const NOMBRES_TABLAS = {
  trabajos: "Trabajos",
  aceites: "Aceites",
  requerimientos: "Requerimientos",
  perfiles: "Personal (usuarios)",
  equipos: "Equipos",
  configuracion: "Configuración",
  tipos_aceite: "Tipos de aceite",
  sistemas_equipo: "Sistemas de equipo",
  grupos_trabajo: "Grupos",
};
function textoBytes(b) {
  const n = Number(b) || 0;
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function hoyISO() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function MedidorAlmacenamiento({ titulo, usado, limiteMb, detalle }) {
  const limite = limiteMb * 1024 * 1024;
  const pct = limite > 0 ? (usado / limite) * 100 : 0;
  const nivel = pct >= 90 ? "rojo" : pct >= 70 ? "amarillo" : "verde";
  return (
    <div className="ts-alm-medidor">
      <div className="ts-alm-medidor-cab">
        <span>{titulo}</span>
        <b>{pct < 0.1 && usado > 0 ? "< 0.1" : (Math.round(pct * 10) / 10).toString()} %</b>
      </div>
      <div className="ts-alm-barra">
        <div className={"ts-alm-barra-uso ts-alm-" + nivel} style={{ width: `${Math.min(100, Math.max(pct, usado > 0 ? 0.6 : 0))}%` }} />
      </div>
      <div className="ts-alm-medidor-pie">
        {textoBytes(usado)} de {limiteMb >= 1024 ? `${(limiteMb / 1024).toFixed(limiteMb % 1024 ? 1 : 0)} GB` : `${limiteMb} MB`}
        {detalle ? ` · ${detalle}` : ""}
      </div>
      {nivel !== "verde" && (
        <div className={"ts-alm-alerta ts-alm-alerta-" + nivel}>
          {nivel === "rojo"
            ? "Espacio casi lleno: libera espacio o amplía el plan de Supabase."
            : "Más del 70 % usado: conviene planificar."}
        </div>
      )}
    </div>
  );
}

// Gráfico de líneas del uso (MB) por día.
function GraficoAlmacenamiento({ historial }) {
  if (!historial || historial.length < 2) {
    return <div className="ts-campo-ayuda">El gráfico aparecerá cuando haya mediciones de al menos dos días distintos.</div>;
  }
  const W = 640, H = 190, mI = 46, mD = 12, mS = 12, mA = 28;
  const pts = historial.map((h) => ({ f: h.f, b: (h.b || 0) / 1048576, a: (h.a || 0) / 1048576 }));
  const maxY = Math.max(1, ...pts.map((p) => Math.max(p.b, p.a))) * 1.15;
  const x = (i) => mI + (i * (W - mI - mD)) / (pts.length - 1);
  const y = (v) => mS + (H - mS - mA) * (1 - v / maxY);
  const linea = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const marcasY = [0, 0.25, 0.5, 0.75, 1].map((t) => maxY * t);
  const etiquetasX = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
  const fecha = (f) => f.split("-").reverse().slice(0, 2).join("/");
  const hayArchivos = pts.some((p) => p.a > 0);
  return (
    <div className="ts-alm-grafico">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Uso de almacenamiento por día">
        {marcasY.map((v, i) => (
          <g key={i}>
            <line x1={mI} x2={W - mD} y1={y(v)} y2={y(v)} className="ts-alm-rejilla" />
            <text x={mI - 6} y={y(v) + 3.5} textAnchor="end" className="ts-alm-eje">
              {v >= 10 ? Math.round(v) : v.toFixed(1)} MB
            </text>
          </g>
        ))}
        {etiquetasX.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} className="ts-alm-eje">
            {fecha(pts[i].f)}
          </text>
        ))}
        <path d={linea("b")} className="ts-alm-linea-base" />
        {hayArchivos && <path d={linea("a")} className="ts-alm-linea-archivos" />}
        {pts.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.b)} r="2.6" className="ts-alm-punto-base">
            <title>{`${fecha(p.f)} · Base de datos: ${p.b.toFixed(1)} MB${hayArchivos ? ` · Archivos: ${p.a.toFixed(1)} MB` : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className="ts-alm-leyenda">
        <span><i className="ts-alm-ley-base" /> Base de datos</span>
        {hayArchivos && <span><i className="ts-alm-ley-archivos" /> Archivos</span>}
      </div>
    </div>
  );
}

// Estimación: crecimiento por mes y cuándo se alcanzaría el límite.
function estimacionLlenado(historial, clave, limiteMb) {
  if (!historial || historial.length < 2) return null;
  const a = historial[0];
  const z = historial[historial.length - 1];
  const dias = (new Date(z.f) - new Date(a.f)) / 86400000;
  if (dias < 7) return { texto: "Se necesitan al menos 7 días de mediciones para estimar el crecimiento." };
  const porDia = ((z[clave] || 0) - (a[clave] || 0)) / dias;
  const porMesMb = (porDia * 30) / 1048576;
  if (porDia <= 0) return { texto: "Sin crecimiento en el periodo medido." };
  const restante = limiteMb * 1048576 - (z[clave] || 0);
  const meses = restante / porDia / 30;
  const cuando = meses > 120 ? "más de 10 años" : meses >= 24 ? `unos ${Math.round(meses / 12)} años` : `unos ${Math.max(1, Math.round(meses))} meses`;
  return { texto: `Crece unos ${porMesMb < 1 ? porMesMb.toFixed(2) : porMesMb.toFixed(1)} MB por mes; a ese ritmo el límite se alcanzaría en ${cuando}.` };
}

function CuerpoAlmacenamiento() {
  const [uso, setUso] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [cfg, setCfg] = useState({ limites: LIMITES_ALMACENAMIENTO_INICIAL, historial: [] });

  async function medir() {
    setCargando(true);
    setError("");
    try {
      const [u, guardado] = await Promise.all([db.usoAlmacenamiento(), db.leerConfig("almacenamiento").catch(() => null)]);
      const limites = { ...LIMITES_ALMACENAMIENTO_INICIAL, ...((guardado && guardado.limites) || {}) };
      let historial = ((guardado && guardado.historial) || []).filter((h) => h && h.f);
      // Una medición por día (la última del día reemplaza a la anterior).
      const hoy = hoyISO();
      const punto = { f: hoy, b: Number(u.base_bytes) || 0, a: Number(u.archivos_bytes) || 0 };
      historial = [...historial.filter((h) => h.f !== hoy), punto].sort((p, q) => (p.f < q.f ? -1 : 1)).slice(-730);
      const nuevo = { limites, historial };
      setUso(u);
      setCfg(nuevo);
      db.guardarConfig("almacenamiento", nuevo).catch(() => {});
    } catch (e) {
      const m = String((e && e.message) || e);
      setError(
        /uso_almacenamiento|function|could not find/i.test(m)
          ? "Falta instalar el control de almacenamiento: ejecuta una vez el archivo supabase/4_almacenamiento.sql en Supabase → SQL Editor."
          : m
      );
    } finally {
      setCargando(false);
    }
  }
  // Se mide al abrir el cuadro (el contenido se crea al desplegarlo).
  useEffect(() => {
    medir();
  }, []);

  function cambiarLimite(clave, v) {
    const n = Math.max(1, Number(v) || 0);
    const nuevo = { ...cfg, limites: { ...cfg.limites, [clave]: n } };
    setCfg(nuevo);
    db.guardarConfig("almacenamiento", nuevo).catch(() => {});
  }

  const lim = cfg.limites || LIMITES_ALMACENAMIENTO_INICIAL;
  const estBase = estimacionLlenado(cfg.historial, "b", lim.base_mb);
  const tablas = (uso && uso.tablas) || [];
  const maxTabla = Math.max(1, ...tablas.map((t) => Number(t.bytes) || 0));

  return (
    <>
      <div className="ts-campo-ayuda" style={{ marginBottom: 12 }}>
        Espacio usado en Supabase frente al límite del plan. Cada día que abres este cuadro se guarda una medición para ver
        el crecimiento. El tráfico de descargas (egress) solo se ve en Supabase → Usage.
      </div>
      {error ? (
        <div className="ts-alm-error">{error}</div>
      ) : !uso ? (
        <div className="ts-campo-ayuda">{cargando ? "Midiendo el almacenamiento…" : ""}</div>
      ) : (
        <>
          <div className="ts-alm-medidores">
            <MedidorAlmacenamiento
              titulo="Base de datos"
              usado={Number(uso.base_bytes) || 0}
              limiteMb={lim.base_mb}
            />
            <MedidorAlmacenamiento
              titulo="Archivos e imágenes"
              usado={Number(uso.archivos_bytes) || 0}
              limiteMb={lim.archivos_mb}
              detalle={`${Number(uso.archivos_cantidad) || 0} archivos`}
            />
          </div>
          {!Number(uso.archivos_cantidad) && (
            <div className="ts-campo-ayuda" style={{ marginBottom: 12 }}>
              Aún no hay imágenes guardadas. Cuando se agreguen fotos a los registros, aquí se verá cuánto ocupan.
            </div>
          )}
          <div className="ts-alm-subtitulo">Historial de uso</div>
          <GraficoAlmacenamiento historial={cfg.historial} />
          {estBase && <div className="ts-alm-estimacion">{estBase.texto}</div>}

          <div className="ts-alm-subtitulo">Espacio por tabla</div>
          <div className="ts-alm-tablas">
            {tablas.map((t) => (
              <div key={t.tabla} className="ts-alm-tabla">
                <span className="ts-alm-tabla-nombre">{NOMBRES_TABLAS[t.tabla] || t.tabla}</span>
                <span className="ts-alm-tabla-barra">
                  <i style={{ width: `${Math.max(2, ((Number(t.bytes) || 0) / maxTabla) * 100)}%` }} />
                </span>
                <span className="ts-alm-tabla-dato">{textoBytes(t.bytes)}</span>
                <span className="ts-alm-tabla-dato ts-texto-tenue">{Number(t.filas || 0).toLocaleString("es")} filas</span>
              </div>
            ))}
          </div>
          <div className="ts-campo-ayuda" style={{ margin: "6px 0 12px" }}>
            El total de la base incluye además el espacio interno de Supabase (usuarios, índices y sistema).
          </div>

          <div className="ts-alm-subtitulo">Límites del plan</div>
          <div className="ts-form-grid">
            <label className="ts-campo">
              <span>Base de datos (MB)</span>
              <input type="number" min="1" value={lim.base_mb} onChange={(e) => cambiarLimite("base_mb", e.target.value)} />
            </label>
            <label className="ts-campo">
              <span>Archivos e imágenes (MB)</span>
              <input type="number" min="1" value={lim.archivos_mb} onChange={(e) => cambiarLimite("archivos_mb", e.target.value)} />
            </label>
          </div>
          <div className="ts-form-acciones">
            <span className="ts-campo-ayuda" style={{ marginRight: "auto" }}>
              Medido: {uso.medido_en ? new Date(uso.medido_en).toLocaleString("es") : "—"} · Plan gratuito: 500 MB y 1 GB.
            </span>
            <button type="button" className="ts-btn" onClick={medir} disabled={cargando}>
              {cargando ? "Midiendo…" : "Actualizar"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function PanelAlmacenamiento() {
  return (
    <Panel titulo="Almacenamiento" colapsable>
      <CuerpoAlmacenamiento />
    </Panel>
  );
}

function Configuracion({
  ordenCuadrosPersonal,
  onCambiarOrdenCuadrosPersonal,
  tiposAceite,
  sistemasEquipo,
  onAgregarTipoAceite,
  onActualizarTipoAceite,
  onEliminarTipoAceite,
  onToggleTipoAceite,
  onAgregarSistemaEquipo,
  onActualizarSistemaEquipo,
  onEliminarSistemaEquipo,
  onToggleSistemaEquipo,
  gruposTrabajo,
  onAgregarGrupoTrabajo,
  onRenombrarGrupoTrabajo,
  onEliminarCuadroPersonal,
  cuadrosOcultos = [],
  titulosSecciones,
  configReporte,
  onCambiarConfigReporte,
  trabajosParaReporte,
  usuarioReporte,
  onRenombrarSeccion,
  personal,
  onAgregarPersona,
  onActualizarPersona,
  onEliminarPersona,
  onToggleActivoPersona,
  colorAcento,
  onCambiarColorAcento,
  nombreApp,
  onCambiarNombreApp,
  logoUrl,
  onCambiarLogoUrl,
  temaApp,
  onCambiarTemaApp,
  panelIzquierdoTema,
  onCambiarPanelIzquierdoTema,
  fuenteFamilia,
  onCambiarFuenteFamilia,
  fuenteTamano,
  onCambiarFuenteTamano,
  coloresMarca,
  onCambiarColoresMarca,
  equipos,
  onAgregarEquipo,
  onActualizarEquipo,
  onEliminarEquipo,
  onToggleActivoEquipo,
  flotas,
  onAgregarFlota,
  onRenombrarFlota,
  flotasInactivas,
  onToggleFlota,
  onEliminarFlota,
  navItems,
  onActualizarEtiquetaNav,
  permisosPorRol,
  onToggleAccesoModulo,
  onToggleAccionPermiso,
}) {
  // Flotas para los subgrupos: las activas, más cualquier flota que todavía
  // tenga personal asignado (para que nadie quede fuera de un cuadro).
  const flotasPersonal = [
    ...new Set([
      ...listaFlotas(),
      ...personal.filter((p) => p.flota_grupo).map((p) => p.flota_grupo),
    ]),
  ];
  const [editandoPermisos, setEditandoPermisos] = useState(false);
  const permisosBloqueados = !editandoPermisos;

  function subirLogo(e) {
    const archivo = e.target.files && e.target.files[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = () => onCambiarLogoUrl(lector.result);
    lector.readAsDataURL(archivo);
    e.target.value = "";
  }

  return (
    <div className="ts-stack">
      <Panel titulo="Aspecto" colapsable>
        <div className="ts-form-grid" style={{ marginBottom: 16 }}>
          <label className="ts-campo">
            <span>Organización o institución</span>
            <input
              type="text"
              value={nombreApp}
              aria-label="Organización o institución"
              title="Organización o institución"
              placeholder="Organización o institución"
              onChange={(e) => onCambiarNombreApp(e.target.value)}
            />
          </label>
        </div>

        <div className="ts-campo ts-campo-full" style={{ marginBottom: 18 }}>
          <span>Logo</span>
          <div className="ts-logo-uploader">
            <div className="ts-logo-preview">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" />
              ) : (
                <span>{inicialesDe(nombreApp)}</span>
              )}
            </div>
            <label className="ts-btn-icono" style={{ cursor: "pointer" }}>
              Subir logo
              <input type="file" accept="image/*" onChange={subirLogo} style={{ display: "none" }} />
            </label>
            {logoUrl && (
              <button className="ts-btn-ghost" onClick={() => onCambiarLogoUrl(null)}>
                Quitar logo
              </button>
            )}
          </div>
        </div>

        <div className="ts-form-grid" style={{ marginBottom: 18 }}>
          <CampoSelect etiqueta="Familia de tipo de letra" valor={fuenteFamilia} onChange={onCambiarFuenteFamilia}>
            {FUENTES_DISPONIBLES.map((f) => (
              <option key={f.nombre} value={f.valor}>
                {f.nombre}
              </option>
            ))}
          </CampoSelect>
          <CampoSelect etiqueta="Tamaño de fuente" valor={fuenteTamano} onChange={onCambiarFuenteTamano}>
            {TAMANOS_FUENTE.map((t) => (
              <option key={t.nombre} value={t.valor}>
                {t.nombre}
              </option>
            ))}
          </CampoSelect>
        </div>

        <div className="ts-campo ts-campo-full" style={{ marginBottom: 18 }}>
          <span>Colores de marca</span>
          <div className="ts-colores-marca">
            {MARCAS.map((m) => (
              <label key={m.clave} className="ts-color-marca" title={`Elegir color para la marca ${m.texto}`}>
                <span className="ts-color-marca-muestra" style={{ background: coloresMarca[m.clave] }}>
                  <input
                    type="color"
                    value={coloresMarca[m.clave]}
                    onChange={(e) => onCambiarColoresMarca({ ...coloresMarca, [m.clave]: e.target.value })}
                  />
                </span>
                <span className="ts-color-marca-texto">
                  {m.texto}
                  <small>{coloresMarca[m.clave].toUpperCase()}</small>
                </span>
              </label>
            ))}
            {MARCAS.some((m) => coloresMarca[m.clave] !== COLORES_MARCA_INICIAL[m.clave]) && (
              <button type="button" className="ts-btn-ghost" onClick={() => onCambiarColoresMarca(COLORES_MARCA_INICIAL)}>
                Restablecer
              </button>
            )}
          </div>
        </div>

        <div className="ts-campo ts-campo-full" style={{ marginBottom: 18 }}>
          <span>Tema</span>
          <div className="ts-tema-switch">
            <button
              className={"ts-tema-opcion" + (temaApp === "oscuro" ? " ts-tema-opcion-activa" : "")}
              onClick={() => onCambiarTemaApp("oscuro")}
            >
              <IconoOscuro />
              Oscuro
            </button>
            <button
              className={"ts-tema-opcion" + (temaApp === "claro" ? " ts-tema-opcion-activa" : "")}
              onClick={() => onCambiarTemaApp("claro")}
            >
              <IconoClaro />
              Claro
            </button>
            <button
              className={"ts-tema-opcion" + (temaApp === "blanco" ? " ts-tema-opcion-activa" : "")}
              onClick={() => onCambiarTemaApp("blanco")}
            >
              <IconoBlanco />
              Blanco
            </button>
          </div>
        </div>

        <div className="ts-campo ts-campo-full" style={{ marginBottom: 18 }}>
          <span>Panel izquierdo</span>
          <div className="ts-panel-izq-opciones">
            {OPCIONES_PANEL_IZQUIERDO.map((op) => (
              <button
                key={op.clave}
                type="button"
                className="ts-panel-izq-opcion"
                onClick={() => onCambiarPanelIzquierdoTema(op.clave)}
              >
                <span className="ts-panel-izq-miniatura">
                  <span className="ts-panel-izq-miniatura-sidebar" style={{ background: op.bg }}>
                    <span className="ts-panel-izq-miniatura-barra" style={{ background: colorAcento }} />
                    <span className="ts-panel-izq-miniatura-linea" style={{ background: op.textoDim }} />
                    <span className="ts-panel-izq-miniatura-linea" style={{ background: op.textoDim }} />
                    <span className="ts-panel-izq-miniatura-linea" style={{ background: op.textoDim }} />
                  </span>
                  <span className="ts-panel-izq-miniatura-contenido" />
                </span>
                <span className="ts-panel-izq-radio">
                  <span
                    className={
                      "ts-panel-izq-punto" + (panelIzquierdoTema === op.clave ? " ts-panel-izq-punto-activo" : "")
                    }
                  />
                  {op.nombre}
                </span>
              </button>
            ))}
          </div>
          <span className="ts-campo-ayuda">Elige el color del menú lateral, independiente del tema general.</span>
        </div>

        <div className="ts-paleta">
          {COLORES_ACENTO.map((c) => (
            <button
              key={c.valor}
              className="ts-swatch"
              style={{ background: c.valor }}
              title={c.nombre}
              onClick={() => onCambiarColorAcento(c.valor)}
            >
              {colorAcento === c.valor && <IconoCheck />}
            </button>
          ))}
        </div>
        <span className="ts-campo-ayuda">Cambia el nombre, el logo y el color principal de la app.</span>

        <div className="ts-campo ts-campo-full" style={{ marginTop: 18 }}>
          <span>Nombres del menú</span>
          <div className="ts-form-grid" style={{ marginTop: 6 }}>
            {navItems.map((item) => (
              // Solo el campo editable: la etiqueta con el nombre original queda
              // oculta a la vista (se conserva como texto de ayuda al pasar el
              // mouse y para lectores de pantalla).
              <input
                key={item.key}
                type="text"
                value={item.label}
                title={NOMBRES_MENU_ORIGINALES[item.key]}
                aria-label={NOMBRES_MENU_ORIGINALES[item.key]}
                placeholder={NOMBRES_MENU_ORIGINALES[item.key]}
                onChange={(e) => onActualizarEtiquetaNav(item.key, e.target.value)}
              />
            ))}
          </div>
          <span className="ts-campo-ayuda">Cambia el texto que se muestra en cada opción del menú lateral.</span>
        </div>
      </Panel>

      <PanelConfigReporte
        config={configReporte}
        onCambiar={onCambiarConfigReporte}
        trabajos={trabajosParaReporte}
        usuario={usuarioReporte}
      />

      {usuarioEnSesion.esAdmin && <PanelAlmacenamiento />}

      <Panel
        titulo="Roles y permisos"
        colapsable
        acciones={
          permisosBloqueados ? (
            <button className="ts-btn-icono" onClick={() => setEditandoPermisos(true)} title="Editar permisos">
              <IconoEditar />
              <span className="ts-ocultar-movil">Editar</span>
            </button>
          ) : (
            <button
              className="ts-btn-icono ts-btn-icono-ok"
              onClick={() => setEditandoPermisos(false)}
              title="Guardar y bloquear edición"
            >
              <IconoGuardar />
              <span className="ts-ocultar-movil">Guardar</span>
            </button>
          )
        }
      >
        <div className="ts-tabla-wrap">
          <table className="ts-tabla ts-tabla-permisos">
            <thead>
              <tr>
                <th>Permiso</th>
                {ROLES_CUADRO_PERMISOS.map((r) => (
                  <th key={r}>{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FILAS_PERMISOS.map((fila) => (
                <tr key={fila.etiqueta}>
                  <td>{fila.etiqueta}</td>
                  {ROLES_CUADRO_PERMISOS.map((r) => {
                    const activo = permisoActivo(permisosPorRol[r], fila);
                    const alternar = () =>
                      fila.tipo === "nav"
                        ? onToggleAccesoModulo(r, fila.clave)
                        : onToggleAccionPermiso(r, fila.clave);
                    return (
                      <td key={r}>
                        {permisosBloqueados ? (
                          <span className={"ts-badge " + (activo ? "ts-badge-ok" : "ts-badge-neutro")}>
                            {activo ? "Sí" : "No"}
                          </span>
                        ) : (
                          <button
                            className={"ts-btn-estado " + (activo ? "ts-btn-estado-activo" : "ts-btn-estado-inactivo")}
                            onClick={alternar}
                          >
                            {activo ? "Sí" : "No"}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="ts-campo-ayuda">
          {permisosBloqueados
            ? 'Campos bloqueados. Presiona "Editar" para modificar los permisos.'
            : "Todos los Supervisores pueden aprobar o no aprobar requerimientos — no hay un único supervisor autorizado."}
        </span>
      </Panel>

      {(() => {
        // GRUPO SUPERVISIÓN (Back Office) y Planificación divididos por flota;
        // los grupos de trabajo, un cuadro por subgrupo (grupo × flota).
        const cuadros = [
          ...flotasPersonal.map((f) => ({ clave: `s:supervision:${f}`, seccion: "supervision", titulo: `${titulosSecciones.supervision} – ${f}`, nombreBase: titulosSecciones.supervision })),
          ...gruposTrabajo.flatMap((g) =>
            flotasDeGrupo(g, flotasPersonal).map((f) => ({
              clave: `g:${g.id}:${f}`,
              grupoId: g.id,
              titulo: g.alcance === "todas" ? g.nombre : `${g.nombre} – ${textoFlotaDeGrupo(f)}`,
              nombreBase: g.nombre,
            }))
          ),
          { clave: "lubrico", seccion: "lubrico", titulo: titulosSecciones.lubrico, nombreBase: titulosSecciones.lubrico },
          // Planificación: usuarios con rol Planificador. No participan en
          // trabajos de mantenimiento ni en adiciones/cambios de aceite.
          ...flotasPersonal.map((f) => ({ clave: `s:planificacion:${f}`, seccion: "planificacion", titulo: `${titulosSecciones.planificacion} – ${f}`, nombreBase: titulosSecciones.planificacion })),
        ];
        const porClave = Object.fromEntries(cuadros.map((c) => [c.clave, c]));
        const nombresBase = [...new Set(cuadros.map((x) => x.nombreBase))];
        const claves = ordenarSegun(
          cuadros.map((c) => c.clave).filter((c) => !cuadrosOcultos.includes(c)),
          ordenCuadrosPersonal
        );
        return (
          <>
            <ListaOrdenable
              claves={claves}
              onReordenar={onCambiarOrdenCuadrosPersonal}
              render={(clave, arrastre) => {
                const g = porClave[clave];
                return (
                  <GrupoUsuariosPanel
                    titulo={g.titulo}
                    clave={g.clave}
                    personal={personal}
                    onAgregar={onAgregarPersona}
                    onActualizar={onActualizarPersona}
                    onEliminar={onEliminarPersona}
                    onToggleActivo={onToggleActivoPersona}
                    flotasPersonal={flotasPersonal}
                    tituloRenombrar={g.nombreBase}
                    arrastre={arrastre}
                    onRenombrar={(nombre) => (g.seccion ? onRenombrarSeccion(g.seccion, nombre) : onRenombrarGrupoTrabajo(g.grupoId, nombre))}
                    onEliminarCuadro={() => onEliminarCuadroPersonal(g.clave)}
                    nombresExistentes={nombresBase.filter((n) => n !== g.nombreBase)}
                  />
                );
              }}
            />
            <NuevoGrupoTrabajo nombresExistentes={nombresBase} onCrear={onAgregarGrupoTrabajo} />
          </>
        );
      })()}

      <EquipoPanel
        titulo={titulosSecciones.flotas}
        onRenombrar={(nombre) => onRenombrarSeccion("flotas", nombre)}
        equipos={equipos}
        onAgregar={onAgregarEquipo}
        onActualizar={onActualizarEquipo}
        onEliminar={onEliminarEquipo}
        onToggleActivo={onToggleActivoEquipo}
        flotas={flotas}
        onAgregarFlota={onAgregarFlota}
        onRenombrarFlota={onRenombrarFlota}
        flotasInactivas={flotasInactivas}
        onToggleFlota={onToggleFlota}
        onEliminarFlota={onEliminarFlota}
      />

      <CatalogoEditable
        titulo={titulosSecciones.aceites}
        onRenombrar={(nombre) => onRenombrarSeccion("aceites", nombre)}
        nombresExistentes={[titulosSecciones.sistemas, titulosSecciones.flotas]}
        items={tiposAceite}
        onAgregar={onAgregarTipoAceite}
        onActualizar={onActualizarTipoAceite}
        onEliminar={onEliminarTipoAceite}
        onToggle={onToggleTipoAceite}
        placeholder="Ej. 15W40 Motor"
      />

      <CatalogoEditable
        titulo={titulosSecciones.sistemas}
        onRenombrar={(nombre) => onRenombrarSeccion("sistemas", nombre)}
        nombresExistentes={[titulosSecciones.aceites, titulosSecciones.flotas]}
        items={sistemasEquipo}
        onAgregar={onAgregarSistemaEquipo}
        onActualizar={onActualizarSistemaEquipo}
        onEliminar={onEliminarSistemaEquipo}
        onToggle={onToggleSistemaEquipo}
        placeholder="Ej. Sistema hidráulico"
      />
    </div>
  );
}

function CatalogoEditable({ titulo, items, onAgregar, onActualizar, onEliminar, onToggle, placeholder, onRenombrar, nombresExistentes }) {
  const [mostrarAgregar, setMostrarAgregar] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);

  function confirmarEliminar() {
    if (aEliminar) onEliminar(aEliminar.id);
    setAEliminar(null);
  }

  return (
    <Panel
      titulo={titulo}
      colapsable
      abrir={mostrarAgregar}
      acciones={
        <AccionesRenombrables titulo={titulo} nombresExistentes={nombresExistentes} onRenombrar={onRenombrar}>
          <BotonAgregarCabecera abierto={mostrarAgregar} onClick={() => setMostrarAgregar((v) => !v)} />
        </AccionesRenombrables>
      }
    >
      {mostrarAgregar && (
        <FilaCatalogoForm
          placeholder={placeholder}
          onGuardar={(nombre) => {
            onAgregar(nombre);
            setMostrarAgregar(false);
          }}
          onCancelar={() => setMostrarAgregar(false)}
        />
      )}

      <div className="ts-tabla-wrap">
        <table className="ts-tabla ts-tabla-cards ts-tabla-catalogo">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) =>
              editandoId === it.id ? (
                <FilaCatalogoForm
                  key={it.id}
                  esFila
                  inicial={it.nombre}
                  placeholder={placeholder}
                  onGuardar={(nombre) => {
                    onActualizar(it.id, nombre);
                    setEditandoId(null);
                  }}
                  onCancelar={() => setEditandoId(null)}
                />
              ) : (
                <tr key={it.id}>
                  <td>{it.nombre}</td>
                  <td>
                    <button
                      className={"ts-btn-estado " + (it.activo ? "ts-btn-estado-activo" : "ts-btn-estado-inactivo")}
                      title={it.activo ? "Desactivar" : "Activar"}
                      onClick={() => onToggle(it.id)}
                    >
                      {it.activo ? "Activo" : "Desactivado"}
                    </button>
                  </td>
                  <td>
                    <div className="ts-acciones-fila">
                      <button className="ts-btn-mini" title="Editar" onClick={() => setEditandoId(it.id)}>
                        <IconoEditar />
                      </button>
                      <button
                        className="ts-btn-mini ts-btn-mini-alerta"
                        title="Eliminar"
                        onClick={() => setAEliminar(it)}
                      >
                        <IconoEliminar />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {items.length === 0 && !mostrarAgregar && (
              <tr>
                <td colSpan={3} className="ts-vacio">
                  Sin registros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {aEliminar && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAEliminar(null)} />
          <div className="ts-modal-confirmacion">
            <h3>¿Eliminar este registro?</h3>
            <p>
              <strong>{aEliminar.nombre}</strong>
              <br />
              Esta acción no se puede deshacer.
            </p>
            <div className="ts-modal-acciones">
              <button className="ts-btn-ghost" onClick={() => setAEliminar(null)}>
                Cancelar
              </button>
              <button className="ts-btn-confirmar-eliminar" onClick={confirmarEliminar}>
                Sí, eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function FilaCatalogoForm({ inicial, onGuardar, onCancelar, placeholder, esFila }) {
  const [nombre, setNombre] = useState(inicial || "");

  function enviar(e) {
    e.preventDefault();
    const valor = nombre.trim();
    if (!valor) return;
    onGuardar(valor);
  }

  if (esFila) {
    return (
      <tr>
        <td>
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </td>
        <td></td>
        <td>
          <div className="ts-acciones-fila">
            <button className="ts-btn-mini ts-btn-mini-ok" onClick={enviar}>
              <IconoGuardar />
            </button>
            <button className="ts-btn-mini" onClick={onCancelar}>
              Cancelar
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="ts-catalogo-form" onKeyDown={(e) => enviarConEnter(e, enviar)}>
      <input
        type="text"
        value={nombre}
        placeholder={placeholder}
        onChange={(e) => setNombre(e.target.value)}
      />
      <button type="button" className="ts-btn" onClick={enviar}>
        Guardar
      </button>
      <button type="button" className="ts-btn-ghost" onClick={onCancelar}>
        Cancelar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel de usuarios por grupo (Configuración): agregar, editar y eliminar
// personal con nombre, usuario y contraseña. El Administrador es quien
// otorga las credenciales de acceso al personal.
// ---------------------------------------------------------------------------

// Valida el nombre de un grupo: no vacío y sin repetir otro existente
// (sin distinguir mayúsculas). Devuelve el mensaje de error o "".
function errorNombreGrupo(nombre, existentes) {
  const limpio = (nombre || "").trim();
  if (!limpio) return "Escribe un nombre para el grupo.";
  if (existentes.some((n) => n.trim().toLowerCase() === limpio.toLowerCase())) return "Ya existe un grupo con ese nombre.";
  return "";
}

// Botón al final de la lista de grupos para crear uno nuevo.
// Crear un grupo nuevo (de trabajo, confiabilidad, etc.). Se elige con qué
// flotas trabaja: una sola flota, todas a la vez (un solo cuadro) o todas por
// separado (un cuadro por flota, como Grupo 1–4).
function NuevoGrupoTrabajo({ nombresExistentes, onCrear }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [alcance, setAlcance] = useState("conjunto");
  const [intentado, setIntentado] = useState(false);
  const error = errorNombreGrupo(nombre, nombresExistentes);
  const flotas = listaFlotas();

  function crear() {
    setIntentado(true);
    if (error) return;
    onCrear(nombre, alcance);
    setNombre("");
    setAlcance("conjunto");
    setIntentado(false);
    setAbierto(false);
  }

  if (!abierto) {
    return (
      <button type="button" className="ts-nuevo-grupo-btn" onClick={() => setAbierto(true)}>
        + Crear grupo
      </button>
    );
  }
  const opciones = [
    ...flotas.map((f) => ({ valor: f, titulo: `Solo ${f}`, texto: `Un cuadro: "${nombre.trim() || "Grupo"} – ${f}"` })),
    { valor: "conjunto", titulo: `Ambas flotas a la vez`, texto: `Un solo cuadro: "${nombre.trim() || "Grupo"} – ${flotas.join(" / ")}"` },
    { valor: "separado", titulo: `Ambas flotas por separado`, texto: `Un cuadro por flota, como Grupo 1–4` },
    { valor: "todas", titulo: `Todas`, texto: `Un solo cuadro: "${nombre.trim() || "Grupo"}" trabaja con todas las flotas` },
  ];
  return (
    <div className="ts-panel ts-nuevo-grupo-form">
      <label className="ts-campo">
        <span>Nombre del grupo</span>
        <input
          autoFocus
          value={nombre}
          placeholder="Ej. Confiabilidad"
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") crear();
            if (e.key === "Escape") setAbierto(false);
          }}
        />
      </label>
      {intentado && error && <span className="ts-error-texto">{error}</span>}
      <div className="ts-campo">
        <span>¿Con qué flota trabaja este grupo?</span>
        <div className="ts-opciones-alcance">
          {opciones.map((o) => (
            <button
              key={o.valor}
              type="button"
              className={"ts-opcion-alcance" + (alcance === o.valor ? " ts-opcion-alcance-activa" : "")}
              onClick={() => setAlcance(o.valor)}
            >
              <span className="ts-opcion-alcance-radio" />
              <span>
                <strong>{o.titulo}</strong>
                <small>{o.texto}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      <span className="ts-campo-ayuda">
        El grupo se agrega también en la lista de grupos del Registro de trabajo.
      </span>
      <div className="ts-form-acciones">
        <button type="button" className="ts-btn-ghost" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
        <button type="button" className="ts-btn" onClick={crear}>
          Crear grupo
        </button>
      </div>
    </div>
  );
}

// Acciones de cabecera con opción de editar el nombre de la sección: botón
// "✎ Nombre" que convierte la cabecera en un campo editable (✓ guarda,
// × o Escape cancela), más los botones propios de la sección (children).
function AccionesRenombrables({ titulo, nombresExistentes = [], onRenombrar, children }) {
  const [renombrando, setRenombrando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState(titulo);
  const error = errorNombreGrupo(nuevoNombre, nombresExistentes);

  function guardar() {
    if (error) return;
    onRenombrar(nuevoNombre);
    setRenombrando(false);
  }

  if (renombrando) {
    return (
      <div className="ts-renombrar-grupo">
        <input
          autoFocus
          value={nuevoNombre}
          title={error ? error.replace("grupo", "sección") : "Nuevo nombre"}
          className={error ? "ts-input-error" : ""}
          onChange={(e) => setNuevoNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") guardar();
            if (e.key === "Escape") setRenombrando(false);
          }}
        />
        <button className="ts-btn-icono ts-btn-icono-ok" title="Guardar nombre" disabled={!!error} onClick={guardar}>
          <IconoCheck />
        </button>
        <button className="ts-btn-icono" title="Cancelar" onClick={() => setRenombrando(false)}>
          ×
        </button>
      </div>
    );
  }
  return (
    <div className="ts-acciones-grupo">
      {onRenombrar && (
        <button
          className="ts-btn-icono"
          title="Editar nombre"
          onClick={() => {
            setNuevoNombre(titulo);
            setRenombrando(true);
          }}
        >
          <IconoEditar />
          <span className="ts-ocultar-movil">Nombre</span>
        </button>
      )}
      {children}
    </div>
  );
}

function GrupoUsuariosPanel({ titulo, clave, personal, onAgregar, onActualizar, onEliminar, onToggleActivo, onRenombrar, nombresExistentes = [], flotasPersonal = [], tituloRenombrar, arrastre, onEliminarCuadro }) {
  const [mostrarAgregar, setMostrarAgregar] = useState(false);
  // Eliminar este cuadro (solo si no tiene personal).
  const [eliminandoGrupo, setEliminandoGrupo] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);

  const miembros = personal.filter((p) => claveGrupoPersona(p) === clave);
  const personasDelGrupo = miembros.length;

  function confirmarEliminar() {
    if (aEliminar) onEliminar(aEliminar.id);
    setAEliminar(null);
  }

  return (
    <Panel
      titulo={titulo}
      colapsable
      abrir={mostrarAgregar}
      asa={arrastre ? <span {...arrastre.asaProps}><IconoAsa /></span> : null}
      cabeceraProps={arrastre ? arrastre.cabeceraProps : undefined}
      acciones={
        <AccionesRenombrables titulo={tituloRenombrar || titulo} nombresExistentes={nombresExistentes} onRenombrar={onRenombrar}>
          <BotonAgregarCabecera abierto={mostrarAgregar} onClick={() => setMostrarAgregar((v) => !v)} />
          {onEliminarCuadro && (
            <button className="ts-btn-icono ts-btn-icono-peligro ts-btn-solo-icono" title="Eliminar" aria-label="Eliminar" onClick={() => setEliminandoGrupo(true)}>
              <IconoEliminar />
            </button>
          )}
          {eliminandoGrupo && (
            <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <>
          <div className="ts-overlay-cerrar" onClick={() => setEliminandoGrupo(false)} />
          <div className="ts-modal-confirmacion">
            {personasDelGrupo > 0 ? (
              <>
                <h3>No se puede eliminar "{titulo}"</h3>
                <p>
                  El grupo tiene <strong>{personasDelGrupo}</strong> {personasDelGrupo === 1 ? "persona asignada" : "personas asignadas"}. Muévelas a otro
                  grupo (columna Grupo) o elimínalas, y luego vuelve a intentarlo.
                </p>
                <div className="ts-modal-acciones">
                  <button className="ts-btn" onClick={() => setEliminandoGrupo(false)}>
                    Entendido
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>¿Eliminar "{titulo}"?</h3>
                <p>
                  Se quitará este cuadro de Configuración. Los trabajos y registros ya guardados se conservan.
                </p>
                <div className="ts-modal-acciones">
                  <button className="ts-btn-ghost" onClick={() => setEliminandoGrupo(false)}>
                    Cancelar
                  </button>
                  <button
                    className="ts-btn-confirmar-eliminar"
                    onClick={() => {
                      setEliminandoGrupo(false);
                      onEliminarCuadro();
                    }}
                  >
                    Sí, eliminar
                  </button>
                </div>
              </>
            )}
          </div>
        </>
            </span>
          )}
        </AccionesRenombrables>
      }
    >
      {mostrarAgregar && (
        <FilaUsuarioForm
          flotasPersonal={flotasPersonal}
          personal={personal}
          categoria={clave}
          onGuardar={(datos) => {
            onAgregar(datos);
            setMostrarAgregar(false);
          }}
          onCancelar={() => setMostrarAgregar(false)}
        />
      )}

      <div className="ts-tabla-wrap">
        <table className="ts-tabla ts-tabla-cards ts-tabla-personal">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Usuario</th>
              <th>Contraseña</th>
              <th>Grupo</th>
              <th>Cargo</th>
              <th>Rol</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {miembros.map((p) =>
              editandoId === p.id ? (
                <FilaUsuarioForm
                  key={p.id}
                  esFila
                  flotasPersonal={flotasPersonal}
                  personal={personal}
                  categoria={clave}
                  inicial={p}
                  onGuardar={(datos) => {
                    onActualizar(p.id, datos);
                    setEditandoId(null);
                  }}
                  onCancelar={() => setEditandoId(null)}
                />
              ) : (
                <tr key={p.id}>
                  <td>{p.nombre}</td>
                  <td className="ts-mono">{p.usuario}</td>
                  <td className="ts-mono ts-texto-dim" title="Las contraseñas no se pueden ver. Edita la fila para poner una nueva.">••••••</td>
                  <td title={textoClaveGrupo(claveGrupoPersona(p))}>{textoClaveGrupo(claveGrupoPersona(p))}</td>
                  <td>{cargoDePersona(p)}</td>
                  <td>
                    {rolDePersona(p) !== cargoDePersona(p) ? (
                      <span className="ts-rol-distinto" title={`Tiene permisos de ${rolDePersona(p)} (cargo: ${cargoDePersona(p)})`}>
                        {rolDePersona(p)}
                      </span>
                    ) : (
                      rolDePersona(p)
                    )}
                  </td>
                  <td>
                    <button
                      className={"ts-btn-estado " + (p.activo ? "ts-btn-estado-activo" : "ts-btn-estado-inactivo")}
                      title={p.activo ? "Desactivar usuario" : "Activar usuario"}
                      onClick={() => onToggleActivo(p.id)}
                    >
                      {p.activo ? "Activo" : "Desactivado"}
                    </button>
                  </td>
                  <td>
                    <div className="ts-acciones-fila">
                      <button className="ts-btn-mini" title="Editar" onClick={() => setEditandoId(p.id)}>
                        <IconoEditar />
                      </button>
                      <button
                        className="ts-btn-mini ts-btn-mini-alerta"
                        title="Eliminar"
                        onClick={() => setAEliminar(p)}
                      >
                        <IconoEliminar />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {miembros.length === 0 && !mostrarAgregar && (
              <tr>
                <td colSpan={8} className="ts-vacio">
                  Sin personal registrado en este grupo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {aEliminar && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAEliminar(null)} />
          <div className="ts-modal-confirmacion">
            <h3>¿Eliminar a este usuario?</h3>
            <p>
              <strong>{aEliminar.nombre}</strong> · usuario {aEliminar.usuario}
              <br />
              Esta acción no se puede deshacer.
            </p>
            <div className="ts-modal-acciones">
              <button className="ts-btn-ghost" onClick={() => setAEliminar(null)}>
                Cancelar
              </button>
              <button className="ts-btn-confirmar-eliminar" onClick={confirmarEliminar}>
                Sí, eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Usuario sugerido a partir del nombre (formato "Apellidos Nombres"):
// primer nombre + inicial del primer apellido (ej. "Cabita Mamani Quintín" →
// QuintinC). Si ya existe, se usan las iniciales de los dos apellidos
// (QuintinCM).
// ---------------------------------------------------------------------------
function sinAcentos(texto) {
  return (texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function partesNombre(nombre) {
  const t = (nombre || "").trim().split(/\s+/).filter(Boolean);
  if (t.length <= 2) return { apellidos: t.slice(0, 1), nombres: t.slice(1) };
  return { apellidos: t.slice(0, 2), nombres: t.slice(2) };
}
function sugerirUsuario(nombre, iniciales = 1) {
  const { apellidos, nombres } = partesNombre(nombre);
  if (!apellidos.length) return "";
  const limpio = (x) => sinAcentos(x).replace(/[^A-Za-z]/g, "");
  const primerNombre = limpio(nombres[0] || apellidos[0]);
  const nombreCap = primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase();
  const ap1 = limpio(apellidos[0]);
  const ap2 = limpio(apellidos[1] || "");
  const sufijo =
    iniciales === 1
      ? ap1.charAt(0).toUpperCase()
      : ap2
      ? (ap1.charAt(0) + ap2.charAt(0)).toUpperCase()
      : ap1.charAt(0).toUpperCase() + ap1.charAt(1).toLowerCase();
  return nombreCap + sufijo;
}
function usuarioOcupado(usuario, personal, excluirId) {
  const u = (usuario || "").trim().toLowerCase();
  if (!u) return null;
  return personal.find((p) => p.id !== excluirId && (p.usuario || "").toLowerCase() === u) || null;
}

function FilaUsuarioForm({ categoria, inicial, onGuardar, onCancelar, esFila, flotasPersonal = [], personal = [] }) {
  const [nombre, setNombre] = useState(inicial?.nombre || "");
  const [usuario, setUsuario] = useState(inicial?.usuario || "");
  const [contrasena, setContrasena] = useState("");
  const [errorClave, setErrorClave] = useState("");
  // "categoria" es la clave del cuadro donde se abrió el formulario.
  const categoriaBase = datosDeClaveGrupo(categoria).categoria;
  const [cargo, setCargo] = useState(inicial ? cargoDePersona(inicial) : rolDeCategoria(categoriaBase));
  const [rol, setRol] = useState(inicial ? rolDePersona(inicial) : rolDeCategoria(categoriaBase));
  // Grupo de la persona (define en qué cuadro aparece).
  const [grupo, setGrupo] = useState(inicial ? claveGrupoPersona(inicial) : categoria);

  // Grupo, Cargo y Rol se eligen manualmente: cambiar uno no modifica los
  // otros dos.
  function cambiarCargo(nuevo) {
    setCargo(nuevo);
  }


  const opcionesGrupo = opcionesGrupoPersona(flotasPersonal);
  // Aviso cuando el usuario ya existe: sugiere usar las dos iniciales de los
  // apellidos (ej. JuanMF) y no guarda hasta corregirlo.
  const [aviso, setAviso] = useState(null);
  const sugerido = sugerirUsuario(nombre, 1);
  function enviar(e) {
    e.preventDefault();
    const u = (usuario.trim() || sugerido).trim();
    // Validaciones de la cuenta (Supabase): usuario sin espacios ni tildes y
    // contraseña de 6 caracteres o más (obligatoria solo al crear).
    if (!/^[A-Za-z0-9._-]+$/.test(u)) {
      setErrorClave("El usuario solo puede tener letras, números, punto o guion (sin espacios ni tildes).");
      return;
    }
    if ((!inicial && contrasena.length < 6) || (contrasena && contrasena.length < 6)) {
      setErrorClave(inicial ? "La contraseña nueva debe tener al menos 6 caracteres." : "Escribe una contraseña de al menos 6 caracteres.");
      return;
    }
    setErrorClave("");
    const ocupado = usuarioOcupado(u, personal, inicial?.id);
    if (ocupado) {
      const base = sugerirUsuario(nombre, 2);
      let alternativa = base;
      let k = 2;
      while (alternativa && usuarioOcupado(alternativa, personal, inicial?.id)) alternativa = `${base}${k++}`;
      setAviso({ usuario: u, de: ocupado.nombre, alternativa });
      return;
    }
    setAviso(null);
    onGuardar({ nombre, usuario: u, contrasena, cargo, rol, ...datosDeClaveGrupo(grupo) });
  }
  const textoAviso = aviso && (
    <div className="ts-aviso-usuario" role="alert">
      <IconoAvisoTriangulo />
      <span>
        El usuario <strong>{aviso.usuario}</strong> ya existe ({aviso.de}). Usa las dos iniciales de los apellidos
        {aviso.alternativa ? <>, por ejemplo <strong>{aviso.alternativa}</strong></> : null}.
      </span>
      {aviso.alternativa && (
        <button
          type="button"
          className="ts-btn-icono"
          onClick={() => {
            setUsuario(aviso.alternativa);
            setAviso(null);
          }}
        >
          Usar {aviso.alternativa}
        </button>
      )}
    </div>
  );
  function cambiarUsuario(valor) {
    setUsuario(valor);
    setAviso(null);
  }
  const opcionesGrupoJSX = opcionesGrupo.map((clave) => (
    <option key={clave} value={clave}>{textoClaveGrupo(clave)}</option>
  ));

  const opcionesCargo = CARGOS.map((c) => (
    <option key={c} value={c}>{c}</option>
  ));
  const opcionesRol = ROLES_ASIGNABLES.map((r) => (
    <option key={r} value={r}>{r}</option>
  ));

  if (esFila) {
    return (
      <>
      <tr>
        <td>
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </td>
        <td>
          <input
            type="text"
            value={usuario}
            placeholder={sugerido}
            className={aviso ? "ts-input-error" : ""}
            onChange={(e) => cambiarUsuario(e.target.value)}
          />
        </td>
        <td>
          <input type="text" value={contrasena} placeholder="Nueva (opcional)" onChange={(e) => setContrasena(e.target.value)} />
        </td>
        <td>
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>{opcionesGrupoJSX}</select>
        </td>
        <td>
          <select value={cargo} onChange={(e) => cambiarCargo(e.target.value)}>{opcionesCargo}</select>
        </td>
        <td>
          <select value={rol} onChange={(e) => setRol(e.target.value)}>{opcionesRol}</select>
        </td>
        <td></td>
        <td>
          <div className="ts-acciones-fila">
            <button className="ts-btn-mini ts-btn-mini-ok" onClick={enviar}>
              <IconoGuardar />
            </button>
            <button className="ts-btn-mini" onClick={onCancelar}>
              Cancelar
            </button>
          </div>
        </td>
      </tr>
      {aviso && (
        <tr className="ts-fila-aviso">
          <td colSpan={8}>{textoAviso}</td>
        </tr>
      )}
      {errorClave && (
        <tr className="ts-fila-aviso">
          <td colSpan={8}>
            <span className="ts-error-texto">{errorClave}</span>
          </td>
        </tr>
      )}
      </>
    );
  }

  return (
    <div className="ts-form" onKeyDown={(e) => enviarConEnter(e, enviar)}>
      <div className="ts-form-grid">
        <CampoTexto etiqueta="Nombre (apellidos y nombres)" valor={nombre} onChange={setNombre} placeholder="Ej. Cabita Mamani Quintín" />
        <label className="ts-campo">
          <span>Usuario</span>
          <input
            type="text"
            value={usuario}
            placeholder={sugerido || "Ej. QuintinC"}
            className={aviso ? "ts-input-error" : ""}
            onChange={(e) => cambiarUsuario(e.target.value)}
          />
        </label>
        <CampoTexto
          etiqueta={inicial ? "Contraseña nueva (opcional)" : "Contraseña"}
          valor={contrasena}
          onChange={setContrasena}
          placeholder="Mínimo 6 caracteres"
        />
        <CampoSelect etiqueta="Grupo" valor={grupo} onChange={setGrupo}>{opcionesGrupoJSX}</CampoSelect>
        <CampoSelect etiqueta="Cargo" valor={cargo} onChange={cambiarCargo}>{opcionesCargo}</CampoSelect>
        <CampoSelect etiqueta="Rol (permisos)" valor={rol} onChange={setRol}>{opcionesRol}</CampoSelect>
      </div>
      {sugerido && !usuario && !aviso && (
        <span className="ts-campo-ayuda">
          Si dejas el usuario vacío se usará <strong>{sugerido}</strong>.
        </span>
      )}
      {textoAviso}
      {errorClave && <span className="ts-error-texto">{errorClave}</span>}
      <div className="ts-form-acciones">
        <button type="button" className="ts-btn-ghost" onClick={onCancelar}>
          Cancelar
        </button>
        <button type="button" className="ts-btn" onClick={enviar}>
          Guardar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel de Flotas y equipos (Configuración): agregar, editar, eliminar y
// activar/desactivar equipos.
// ---------------------------------------------------------------------------

// Lista de flotas con opción de renombrar cada una y crear nuevas.
function GestorFlotas({ flotas, inactivas = [], equipos, onAgregar, onRenombrar, onToggle, onEliminar }) {
  const [editando, setEditando] = useState(null); // nombre de la flota en edición
  const [valor, setValor] = useState("");
  const [creando, setCreando] = useState(false);
  const [aEliminar, setAEliminar] = useState(null); // { nombre, cantidad }
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  function pedirEliminar(nombre) {
    const cantidad = equipos.filter((e) => e.flota === nombre).length;
    setAEliminar({ nombre, cantidad });
  }

  function confirmarEliminar() {
    onEliminar(aEliminar.nombre);
    setAviso(`Flota ${aEliminar.nombre} eliminada.`);
    setAEliminar(null);
    setEditando(null);
  }

  const existentes = (excepto) => flotas.filter((f) => f !== excepto);
  const errorEdicion = editando !== null ? errorNombreGrupo(valor, existentes(editando)).replace("grupo", "flota") : "";
  const errorNueva = creando ? errorNombreGrupo(valor, flotas).replace("grupo", "flota") : "";

  function guardarEdicion() {
    if (errorEdicion) return;
    onRenombrar(editando, valor);
    setEditando(null);
  }
  function guardarNueva() {
    if (errorNueva) return;
    onAgregar(valor);
    setCreando(false);
    setValor("");
  }

  return (
    <div className="ts-flotas">
      <div className="ts-flotas-titulo">Flotas</div>
      <div className="ts-flotas-lista">
        {flotas.map((f) => {
          const cantidad = equipos.filter((e) => e.flota === f).length;
          if (editando === f) {
            return (
              <div key={f} className="ts-flota-chip ts-flota-chip-editando">
                <input
                  autoFocus
                  value={valor}
                  title={errorEdicion || "Nuevo nombre de la flota"}
                  className={errorEdicion ? "ts-input-error" : ""}
                  onChange={(e) => setValor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") guardarEdicion();
                    if (e.key === "Escape") setEditando(null);
                  }}
                />
                <button className="ts-btn-icono ts-btn-icono-ok" title="Guardar" disabled={!!errorEdicion} onClick={guardarEdicion}>
                  <IconoCheck />
                </button>
                <button
                  className="ts-btn-icono"
                  title={inactivas.includes(f) ? "Activar flota" : "Inactivar flota"}
                  onClick={() => {
                    onToggle(f);
                    setAviso(`Flota ${f} ${inactivas.includes(f) ? "activada" : "inactivada"}.`);
                    setEditando(null);
                  }}
                >
                  {inactivas.includes(f) ? "Activar" : "Inactivar"}
                </button>
                <button className="ts-btn-icono ts-btn-icono-alerta" title="Eliminar flota" onClick={() => pedirEliminar(f)}>
                  <IconoEliminar />
                </button>
                <button className="ts-btn-icono" title="Cancelar" onClick={() => setEditando(null)}>
                  ×
                </button>
              </div>
            );
          }
          return (
            <div key={f} className={"ts-flota-chip" + (inactivas.includes(f) ? " ts-flota-chip-inactiva" : "")}>
              <span className="ts-flota-nombre">{f}</span>
              {inactivas.includes(f) && <span className="ts-badge ts-badge-neutro">Inactiva</span>}
              <span className="ts-flota-cantidad">{cantidad} {cantidad === 1 ? "equipo" : "equipos"}</span>
              <button
                className="ts-flota-editar"
                title="Editar nombre de la flota"
                onClick={() => {
                  setCreando(false);
                  setEditando(f);
                  setValor(f);
                }}
              >
                <IconoEditar />
              </button>
            </div>
          );
        })}
        {creando ? (
          <div className="ts-flota-chip ts-flota-chip-editando">
            <input
              autoFocus
              value={valor}
              placeholder="Nombre de la flota"
              title={errorNueva || ""}
              className={valor && errorNueva ? "ts-input-error" : ""}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") guardarNueva();
                if (e.key === "Escape") setCreando(false);
              }}
            />
            <button className="ts-btn-icono ts-btn-icono-ok" title="Crear flota" disabled={!!errorNueva} onClick={guardarNueva}>
              <IconoCheck />
            </button>
            <button className="ts-btn-icono" title="Cancelar" onClick={() => setCreando(false)}>
              ×
            </button>
          </div>
        ) : (
          <button
            className="ts-flota-nueva"
            onClick={() => {
              setEditando(null);
              setValor("");
              setCreando(true);
            }}
          >
            + Nueva flota
          </button>
        )}
      </div>
      {aviso && <div className="ts-flotas-aviso">{aviso}</div>}

      {aEliminar && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAEliminar(null)} />
          <div className="ts-modal-confirmacion">
            {aEliminar.cantidad > 0 ? (
              <>
                <h3>No se puede eliminar la flota</h3>
                <p>
                  La flota <strong>{aEliminar.nombre}</strong> todavía tiene{" "}
                  <strong>
                    {aEliminar.cantidad} {aEliminar.cantidad === 1 ? "equipo" : "equipos"}
                  </strong>
                  . Primero elimina todos sus equipos en la tabla de abajo, o usa <strong>Inactivar</strong> para dejar de
                  usarla sin borrar nada.
                </p>
                <div className="ts-modal-acciones">
                  <button className="ts-btn" onClick={() => setAEliminar(null)}>
                    Entendido
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>¿Eliminar la flota?</h3>
                <p>
                  <strong>{aEliminar.nombre}</strong>
                  <br />
                  La flota no tiene equipos y se quitará de la lista. Los trabajos, aceites y requerimientos ya registrados
                  conservan su nombre. Esta acción no se puede deshacer.
                </p>
                <div className="ts-modal-acciones">
                  <button className="ts-btn-ghost" onClick={() => setAEliminar(null)}>
                    Cancelar
                  </button>
                  <button className="ts-btn-confirmar-eliminar" onClick={confirmarEliminar}>
                    Sí, eliminar
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EquipoPanel({ titulo = "Flotas y equipos", onRenombrar, equipos, onAgregar, onActualizar, onEliminar, onToggleActivo, flotas = [], onAgregarFlota, onRenombrarFlota, flotasInactivas = [], onToggleFlota, onEliminarFlota }) {
  const [mostrarAgregar, setMostrarAgregar] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const [filtroCodigo, setFiltroCodigo] = useState("");
  const [filtroFlota, setFiltroFlota] = useState("todas");
  const [filtroEstado, setFiltroEstado] = useState("todos");

  function confirmarEliminar() {
    if (aEliminar) onEliminar(aEliminar.id);
    setAEliminar(null);
  }

  // Orden numérico/alfanumérico automático (ej. 210, 211, 212, P-023, P-040),
  // se recalcula solo cada vez que se agrega, edita o elimina un equipo.
  const equiposOrdenados = equipos
    .slice()
    .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true, sensitivity: "base" }));

  const equiposFiltrados = equiposOrdenados
    .filter((e) => {
      const q = filtroCodigo.trim().toLowerCase();
      if (!q) return true;
      return [e.codigo, e.modelo, e.descripcion].some((v) => (v || "").toLowerCase().includes(q));
    })
    .filter((e) => filtroFlota === "todas" || e.flota === filtroFlota)
    .filter((e) => filtroEstado === "todos" || (filtroEstado === "activo" ? e.activo : !e.activo));

  const hayFiltrosActivos = filtroCodigo.trim() || filtroFlota !== "todas" || filtroEstado !== "todos";

  return (
    <Panel
      titulo={titulo}
      colapsable
      abrir={mostrarAgregar}
      acciones={
        <AccionesRenombrables titulo={titulo} onRenombrar={onRenombrar}>
          <BotonAgregarCabecera abierto={mostrarAgregar} onClick={() => setMostrarAgregar((v) => !v)} />
        </AccionesRenombrables>
      }
    >
      <GestorFlotas
        flotas={flotas}
        inactivas={flotasInactivas}
        equipos={equipos}
        onAgregar={onAgregarFlota}
        onRenombrar={onRenombrarFlota}
        onToggle={onToggleFlota}
        onEliminar={onEliminarFlota}
      />

      {mostrarAgregar && (
        <FilaEquipoForm
          onGuardar={(datos) => {
            onAgregar(datos);
            setMostrarAgregar(false);
          }}
          onCancelar={() => setMostrarAgregar(false)}
        />
      )}

      <div className="ts-filtros" style={{ marginBottom: 14 }}>
        <label className="ts-filtro">
          <span>Buscar</span>
          <input
            type="text"
            value={filtroCodigo}
            onChange={(e) => setFiltroCodigo(e.target.value)}
            placeholder="Código, modelo o descripción"
          />
        </label>
        <label className="ts-filtro">
          <span>Flota</span>
          <select value={filtroFlota} onChange={(e) => setFiltroFlota(e.target.value)}>
            <option value="todas">Todas</option>
            {todasLasFlotas().map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="ts-filtro">
          <span>Estado</span>
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="activo">Activo</option>
            <option value="desactivado">Desactivado</option>
          </select>
        </label>
        {hayFiltrosActivos && (
          <button
            className="ts-btn-ghost"
            onClick={() => {
              setFiltroCodigo("");
              setFiltroFlota("todas");
              setFiltroEstado("todos");
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="ts-tabla-wrap">
        <table className="ts-tabla ts-tabla-cards ts-tabla-equipos">
          <thead>
            <tr>
              <th>Equipo</th>
              <th>Flota</th>
              <th>Modelo</th>
              <th>Descripción</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {equiposFiltrados.map((e) =>
              editandoId === e.id ? (
                <FilaEquipoForm
                  key={e.id}
                  esFila
                  inicial={e}
                  onGuardar={(datos) => {
                    onActualizar(e.id, datos);
                    setEditandoId(null);
                  }}
                  onCancelar={() => setEditandoId(null)}
                />
              ) : (
                <tr key={e.id}>
                  <td className="ts-mono">{e.codigo}</td>
                  <td>{e.flota}</td>
                  <td>{e.modelo || "—"}</td>
                  <td>
                    <div className="ts-clamp-2">{e.descripcion || "—"}</div>
                  </td>
                  <td>
                    <button
                      className={"ts-btn-estado " + (e.activo ? "ts-btn-estado-activo" : "ts-btn-estado-inactivo")}
                      title={e.activo ? "Desactivar equipo" : "Activar equipo"}
                      onClick={() => onToggleActivo(e.id)}
                    >
                      {e.activo ? "Activo" : "Desactivado"}
                    </button>
                  </td>
                  <td>
                    <div className="ts-acciones-fila">
                      <button className="ts-btn-mini" title="Editar" onClick={() => setEditandoId(e.id)}>
                        <IconoEditar />
                      </button>
                      <button
                        className="ts-btn-mini ts-btn-mini-alerta"
                        title="Eliminar"
                        onClick={() => setAEliminar(e)}
                      >
                        <IconoEliminar />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {equiposFiltrados.length === 0 && !mostrarAgregar && (
              <tr>
                <td colSpan={4} className="ts-vacio">
                  {equipos.length === 0 ? "Sin equipos registrados." : "Sin equipos con los filtros actuales."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {aEliminar && (
        <>
          <div className="ts-overlay-cerrar" onClick={() => setAEliminar(null)} />
          <div className="ts-modal-confirmacion">
            <h3>¿Eliminar este equipo?</h3>
            <p>
              Equipo <strong>{aEliminar.codigo}</strong> · Flota {aEliminar.flota}
              <br />
              Se recomienda desactivar en vez de eliminar, para conservar el historial de mantenimiento. Esta acción no se puede deshacer.
            </p>
            <div className="ts-modal-acciones">
              <button className="ts-btn-ghost" onClick={() => setAEliminar(null)}>
                Cancelar
              </button>
              <button className="ts-btn-confirmar-eliminar" onClick={confirmarEliminar}>
                Sí, eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function FilaEquipoForm({ inicial, onGuardar, onCancelar, esFila }) {
  const [codigo, setCodigo] = useState(inicial?.codigo || "");
  const [flota, setFlota] = useState(inicial?.flota || listaFlotas()[0]);
  const [modelo, setModelo] = useState(inicial?.modelo || "");
  const [descripcion, setDescripcion] = useState(inicial?.descripcion || "");
  // Flotas activas + la flota actual del equipo (aunque esté inactiva).
  const opcionesFlota = inicial?.flota && !listaFlotas().includes(inicial.flota) ? [inicial.flota, ...listaFlotas()] : listaFlotas();

  function enviar(e) {
    e.preventDefault();
    onGuardar({ codigo, flota, modelo: modelo.trim(), descripcion: descripcion.trim() });
  }

  if (esFila) {
    return (
      <tr>
        <td>
          <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </td>
        <td>
          <select value={flota} onChange={(e) => setFlota(e.target.value)}>
            {opcionesFlota.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input type="text" value={modelo} placeholder="Ej. CAT 793F" onChange={(e) => setModelo(e.target.value)} />
        </td>
        <td>
          <input type="text" value={descripcion} placeholder="Ej. Camión minero 240 t" onChange={(e) => setDescripcion(e.target.value)} />
        </td>
        <td></td>
        <td>
          <div className="ts-acciones-fila">
            <button className="ts-btn-mini ts-btn-mini-ok" onClick={enviar}>
              <IconoGuardar />
            </button>
            <button className="ts-btn-mini" onClick={onCancelar}>
              Cancelar
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="ts-form" onKeyDown={(e) => enviarConEnter(e, enviar)}>
      <div className="ts-form-grid">
        <CampoTexto etiqueta="Código del equipo" valor={codigo} onChange={setCodigo} placeholder="Ej. 214" />
        <CampoSelect etiqueta="Flota" valor={flota} onChange={setFlota}>
          {opcionesFlota.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </CampoSelect>
        <CampoTexto etiqueta="Modelo" valor={modelo} onChange={setModelo} placeholder="Ej. CAT 793F" />
        <CampoTexto etiqueta="Descripción" valor={descripcion} onChange={setDescripcion} placeholder="Ej. Camión minero de acarreo 240 t" />
      </div>
      <div className="ts-form-acciones">
        <button type="button" className="ts-btn-ghost" onClick={onCancelar}>
          Cancelar
        </button>
        <button type="button" className="ts-btn" onClick={enviar}>
          Guardar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campos de formulario reutilizables
// ---------------------------------------------------------------------------

function CampoTexto({ etiqueta, tipo = "text", valor, onChange, placeholder }) {
  return (
    <label className="ts-campo">
      <span>{etiqueta}</span>
      <input
        type={tipo}
        value={valor}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

// Los formularios no usan la etiqueta <form>: dentro de la vista previa
// (iframe con sandbox) el envío nativo se bloquea y el botón "Guardar" no
// hacía nada. Se guarda con onClick y, como en un formulario normal, al
// presionar Enter en un campo de una línea (no en textos largos).
function enviarConEnter(e, enviar) {
  if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") {
    e.preventDefault();
    enviar(e);
  }
}

// Área de texto que crece sola para mostrar todo su contenido (sin barra de
// desplazamiento interna); así al editar se ve la descripción completa.
function AreaTexto({ style, ...props }) {
  const ref = React.useRef(null);
  function ajustar() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }
  useEffect(ajustar, [props.value]);
  useEffect(() => {
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);
  return <textarea ref={ref} {...props} style={{ ...style, overflow: "hidden", resize: "none" }} />;
}

function CampoSelect({ etiqueta, valor, onChange, children, className }) {
  return (
    <label className="ts-campo">
      <span>{etiqueta}</span>
      <select className={className} value={valor} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

function IconoEditar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconoGuardar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

// Íconos de los botones flotantes (vista celular)
// Botón "+ Agregar" / "Cerrar" de la cabecera de los cuadros. En celular se
// muestra solo el ícono (+ o ×) para ahorrar espacio.
function BotonAgregarCabecera({ abierto, onClick }) {
  return (
    <button className="ts-btn-icono" onClick={onClick} title={abierto ? "Cerrar" : "Agregar"} aria-label={abierto ? "Cerrar" : "Agregar"}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d={abierto ? "M6 6l12 12M18 6L6 18" : "M12 5v14M5 12h14"} />
      </svg>
      <span className="ts-ocultar-movil">{abierto ? "Cerrar" : "Agregar"}</span>
    </button>
  );
}

function IconoFabMas() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconoFabCerrar() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconoFabExportar() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

// Triángulo amarillo de advertencia con signo de exclamación.
function IconoAvisoTriangulo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.3 3.2a2 2 0 0 1 3.4 0l8.6 15a2 2 0 0 1-1.7 3H3.4a2 2 0 0 1-1.7-3Z" fill="#f5b50a" stroke="#ffffff" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 8.6v5.6" stroke="#1b1f24" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="12" cy="17.6" r="1.3" fill="#1b1f24" />
    </svg>
  );
}

function IconoEditarMini() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconoImprimir() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </svg>
  );
}

function IconoEliminar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function IconoCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconoOscuro() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

function IconoBlanco() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  );
}

function IconoClaro() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Estilos — panel de control industrial (charcoal + ámbar de seguridad)
// ---------------------------------------------------------------------------

function Estilos() {
  return (
    <style>{`
      ${fontFaceDoc()}
      .ts-root, .ts-root * { box-sizing: border-box; }
      .ts-root {
        --bg: #14181c;
        --panel: #1d2329;
        --panel-2: #262e35;
        --border: #333c44;
        --text: #e7ecef;
        --text-dim: #8b96a1;
        --sidebar-bg: #10141a;
        --amber: #f2a93b;
        --amber-dim: #4a3a1e;
        --green: #4caf7d;
        --green-dim: #1f3329;
        --red: #e1564c;
        --red-dim: #3a2220;
        --blue: #5c8def;
        --blue-dim: #1f2a3d;
        --yellow: #f5c542;
        --yellow-dim: #40361a;

        display: grid;
        grid-template-columns: 220px 1fr;
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
        font-family: var(--app-font-family, Inter, -apple-system, "Segoe UI", Roboto, sans-serif);
        font-size: var(--app-font-size, 14px);
        line-height: 1.45;

        /* Firefox */
        scrollbar-width: thin;
        scrollbar-color: var(--border) var(--panel-2);
      }

      /* Chrome / Edge / Safari */
      .ts-root *::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      .ts-root *::-webkit-scrollbar-track {
        background: var(--panel-2);
      }
      .ts-root *::-webkit-scrollbar-thumb {
        background: var(--border);
        border-radius: 6px;
        border: 2px solid var(--panel-2);
      }
      .ts-root *::-webkit-scrollbar-thumb:hover {
        background: var(--text-dim);
      }
      .ts-root *::-webkit-scrollbar-corner {
        background: var(--panel-2);
      }

      /* Barra de desplazamiento de toda la página (fuera del contenedor de
         la app), sincronizada por JS con el tema actual */
      html, body {
        scrollbar-width: thin;
        scrollbar-color: var(--ts-scroll-thumb, #333c44) var(--ts-scroll-track, #262e35);
      }
      html::-webkit-scrollbar, body::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      html::-webkit-scrollbar-track, body::-webkit-scrollbar-track {
        background: var(--ts-scroll-track, #262e35);
      }
      html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-thumb {
        background: var(--ts-scroll-thumb, #333c44);
        border-radius: 6px;
      }

      .ts-root * {
        scrollbar-width: thin;
        scrollbar-color: var(--border) var(--panel-2);
      }

      .ts-mono {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        letter-spacing: 0.02em;
      }

      /* Sidebar */
      .ts-sidebar {
        background: var(--sidebar-bg);
        border-right: 1px solid var(--sidebar-border);
        color: var(--sidebar-text);
        display: flex;
        flex-direction: column;
        padding: 18px 14px;
        gap: 22px;
        /* Fija: no se mueve al desplazar el contenido */
        position: sticky;
        top: 0;
        height: 100vh;
        box-sizing: border-box;
        overflow: visible;
      }
      .ts-brand { display: flex; align-items: center; gap: 10px; padding: 0 4px; }
      .ts-brand-mark {
        width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        background: var(--amber); color: #ffffff;
        font-weight: 700; font-size: calc(13px * var(--ts-escala-fuente, 1));
        border-radius: 3px;
      }
      .ts-brand-logo {
        width: 32px; height: 32px;
        object-fit: cover;
        border-radius: 3px;
      }
      .ts-brand-name { font-weight: 600; letter-spacing: 0.02em; font-size: calc(14px * var(--ts-escala-fuente, 1)); flex: 1; }

      .ts-sesion-cerrada {
        grid-column: 1 / -1;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        text-align: center;
        padding: 24px;
      }
      .ts-sesion-cerrada h2 { margin: 8px 0 0; font-size: calc(18px * var(--ts-escala-fuente, 1)); }
      .ts-sesion-cerrada p { margin: 0 0 10px; color: var(--text-dim); font-size: calc(13.5px * var(--ts-escala-fuente, 1)); max-width: 320px; }
      .ts-sesion-cerrada-logo { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; }

      .ts-logo-uploader { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .ts-logo-preview {
        width: 48px; height: 48px;
        border-radius: 4px;
        background: var(--panel-2);
        border: 1px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        overflow: hidden;
        font-weight: 700;
        font-size: calc(14px * var(--ts-escala-fuente, 1));
        color: var(--amber);
      }
      .ts-logo-preview img { width: 100%; height: 100%; object-fit: cover; }

      .ts-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
      .ts-nav-item {
        display: flex; align-items: center; gap: 10px;
        white-space: nowrap; overflow: hidden;
        text-align: left;
        background: transparent;
        border: none;
        color: var(--sidebar-text-dim);
        padding: 9px 10px;
        border-radius: 3px;
        font-size: calc(13.5px * var(--ts-escala-fuente, 1));
        cursor: pointer;
        border-left: 2px solid transparent;
      }
      .ts-nav-item:hover { background: var(--sidebar-hover); color: var(--sidebar-text); }
      .ts-nav-item-activo {
        background: var(--sidebar-hover);
        color: var(--sidebar-text);
        border-left: 2px solid var(--amber);
        font-weight: 600;
      }

      .ts-nav-icono { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; flex-shrink: 0; }
      .ts-nav-texto { overflow: hidden; text-overflow: ellipsis; }

      /* Control del panel lateral (abajo a la izquierda) */
      .ts-lateral-pie { position: relative; margin-top: auto; }
      .ts-lateral-boton {
        display: flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; margin-left: 2px;
        background: transparent; border: none; border-radius: 4px;
        color: var(--sidebar-text-dim); cursor: pointer;
      }
      .ts-lateral-boton:hover, .ts-lateral-menu-abierto .ts-lateral-boton { background: var(--sidebar-hover); color: var(--sidebar-text); }
      .ts-lateral-menu {
        position: absolute; left: 0; bottom: calc(100% + 6px); z-index: 60;
        min-width: 230px; padding: 6px;
        background: var(--sidebar-bg); color: var(--sidebar-text);
        border: 1px solid var(--sidebar-border); border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,.28);
      }
      .ts-lateral-menu-titulo {
        font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--sidebar-text-dim);
        padding: 4px 8px 6px; margin-bottom: 4px; border-bottom: 1px solid var(--sidebar-border);
      }
      .ts-lateral-menu-op {
        display: flex; align-items: center; gap: 10px; width: 100%;
        background: transparent; border: none; border-radius: 4px;
        color: var(--sidebar-text); text-align: left; cursor: pointer;
        padding: 7px 8px; font-size: calc(13px * var(--ts-escala-fuente, 1)); white-space: nowrap;
      }
      .ts-lateral-menu-op:hover { background: var(--sidebar-hover); }
      .ts-lateral-menu-punto { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
      .ts-lateral-menu-op-activa .ts-lateral-menu-punto { background: var(--sidebar-text); }

      /* Panel contraído: solo íconos */
      @media (min-width: 721px) {
        .ts-root.ts-lateral-contraido { grid-template-columns: 60px 1fr; }
        .ts-sidebar { transition: width .16s ease, box-shadow .16s ease; }
        .ts-lateral-contraido .ts-sidebar { width: 60px; padding-left: 10px; padding-right: 10px; }
        .ts-lateral-contraido .ts-brand { padding: 0 2px; }
        .ts-lateral-contraido .ts-brand-name,
        .ts-lateral-contraido .ts-nav-texto { display: none; }
        .ts-lateral-contraido .ts-nav-item { justify-content: center; padding: 9px 0; }
        .ts-lateral-contraido .ts-lateral-boton { margin-left: 4px; }
        /* Expandir al pasar el cursor: el panel se abre por encima del contenido */
        .ts-lateral-hover .ts-sidebar { z-index: 45; }
        .ts-lateral-hover .ts-sidebar:hover,
        .ts-lateral-hover.ts-lateral-menu-abierto .ts-sidebar {
          width: 220px; margin-right: -160px; padding-left: 14px; padding-right: 14px;
          box-shadow: 6px 0 24px rgba(0,0,0,.18);
        }
        .ts-lateral-hover .ts-sidebar:hover .ts-brand-name,
        .ts-lateral-hover .ts-sidebar:hover .ts-nav-texto,
        .ts-lateral-hover.ts-lateral-menu-abierto .ts-brand-name,
        .ts-lateral-hover.ts-lateral-menu-abierto .ts-nav-texto { display: inline; }
        .ts-lateral-hover .ts-sidebar:hover .ts-nav-item,
        .ts-lateral-hover.ts-lateral-menu-abierto .ts-nav-item { justify-content: flex-start; padding: 9px 10px; }
        .ts-lateral-hover .ts-sidebar:hover .ts-lateral-boton,
        .ts-lateral-hover.ts-lateral-menu-abierto .ts-lateral-boton { margin-left: 2px; }
      }

      .ts-sidebar-foot { border-top: 1px solid var(--sidebar-border); padding-top: 12px; }
      .ts-rol-cabecera { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
      .ts-rol-label { font-size: calc(11px * var(--ts-escala-fuente, 1)); color: var(--sidebar-text-dim); flex: 1; }
      .ts-sidebar .ts-select {
        background: var(--sidebar-hover);
        border-color: transparent;
        color: var(--sidebar-text);
      }

      .ts-btn-tres-puntos {
        background: transparent;
        border: none;
        color: var(--text-dim);
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .ts-btn-tres-puntos svg { width: 18px; height: 18px; }
      .ts-btn-tres-puntos:hover { background: var(--panel-2); color: var(--text); }
      .ts-btn-tres-puntos:hover { background: var(--panel-2); color: var(--text); }
      .ts-btn-filtro-activo { color: var(--amber); background: var(--amber-dim); }
      .ts-btn-filtro { position: relative; }
      /* Buscador: mismo estilo y posición que el cuadro de Filtros */
      .ts-buscador {
        position: fixed; top: 62px; right: 20px; z-index: 60;
        width: min(480px, calc(100vw - 40px));
        background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        animation: ts-aparecer 0.14s ease-out;
      }
      .ts-buscador-cuerpo { display: flex; align-items: center; gap: 8px; padding: 10px 14px 14px; }
      .ts-buscador-campo {
        flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
        height: 36px; padding: 0 6px 0 10px; box-sizing: border-box;
        background: var(--panel-2); border-radius: 6px; color: var(--text-dim);
        border: 1px solid transparent; transition: border-color 0.15s;
      }
      .ts-buscador-campo:focus-within { border-color: var(--border); background: var(--panel); }
      .ts-buscador-campo input {
        flex: 1; min-width: 0; height: 100%; padding: 0; color: var(--text);
        font: inherit; font-size: calc(14px * var(--ts-escala-fuente, 1));
      }
      .ts-buscador-campo input, .ts-buscador-campo input:focus, .ts-buscador-campo input:focus-visible {
        border: none !important; box-shadow: none !important; outline: none !important; background: transparent !important;
      }
      .ts-buscador-campo input::-webkit-search-cancel-button { display: none; }
      .ts-buscador-borrar {
        border: none; background: transparent; color: var(--text-dim); cursor: pointer;
        width: 24px; height: 24px; border-radius: 50%; font-size: calc(16px * var(--ts-escala-fuente, 1)); line-height: 1;
      }
      .ts-buscador-borrar:hover { background: var(--border); color: var(--text); }
      .ts-buscador-conteo {
        min-width: 64px; text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums;
        font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim);
      }
      .ts-buscador-sin { color: var(--red); }
      .ts-buscador-nav { display: flex; gap: 4px; }
      .ts-buscador-nav .ts-btn-mini { width: 32px; height: 32px; }
      .ts-buscador-nav .ts-btn-mini:disabled { opacity: 0.4; cursor: default; }
      @media (max-width: 768px) {
        .ts-buscador { top: 56px; right: 12px; width: calc(100vw - 24px); }
        .ts-barras-ocultas .ts-buscador { top: 8px; }
        .ts-buscador-conteo { min-width: 0; }
      }
      /* Texto recortado ("…") que contiene una coincidencia: se muestra completo */
      .ts-expandido-busqueda {
        -webkit-line-clamp: unset !important; display: block !important; overflow: visible !important;
        white-space: normal !important; max-height: none !important; text-overflow: clip !important;
      }
      .ts-zona-busqueda { display: contents; }
      /* Historial: trabajos y aceites completos, sin recorte a 2 líneas */
      .ts-historial .ts-clamp-2, .ts-historial .ts-tm-trabajo, .ts-historial .ts-am-fila2 {
        -webkit-line-clamp: unset; display: block; overflow: visible; white-space: normal;
      }
      .ts-historial .ts-tabla td .ts-clamp-2 { white-space: normal; }
      ::highlight(ts-busqueda) { background-color: var(--ts-resaltado, #ffe44d); color: #1a1a1a; }
      ::highlight(ts-busqueda-actual) { background-color: var(--ts-resaltado-actual, #ff9632); color: #1a1a1a; }

      /* Resumen del filtro aplicado (barra superior) */
      .ts-filtros-resumen {
        max-width: 420px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        padding: 6px 12px;
        border: none; border-radius: 999px;
        background: var(--panel-2);
        color: var(--text-dim);
        font: inherit; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-weight: 500;
        cursor: pointer;
      }
      .ts-filtros-resumen-activo { background: var(--amber-dim); color: var(--amber); font-weight: 600; }
      .ts-filtros-resumen:hover { filter: brightness(0.97); }
      .ts-filtro-punto {
        position: absolute; top: 3px; right: 3px;
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--amber);
        box-shadow: 0 0 0 2px var(--bg);
      }

      /* Cuadro de filtros flotante (bajo el ícono de filtro) */
      .ts-filtros-popover {
        position: fixed;
        top: 62px;
        right: 20px;
        z-index: 60;
        width: min(620px, calc(100vw - 40px));
        max-height: calc(100vh - 90px);
        overflow-y: auto;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        animation: ts-aparecer 0.14s ease-out;
      }
      @keyframes ts-aparecer { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
      .ts-filtros-popover-cabecera {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px 0;
        font-size: calc(13px * var(--ts-escala-fuente, 1)); font-weight: 600; color: var(--text);
      }
      .ts-filtros-popover-cerrar {
        background: transparent; border: none; color: var(--text-dim);
        font-size: calc(20px * var(--ts-escala-fuente, 1)); line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 4px;
      }
      .ts-filtros-popover-cerrar:hover { background: var(--panel-2); color: var(--text); }
      .ts-filtros-popover .ts-filtros {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        border: none;
        background: transparent;
        padding: 10px 14px 14px;
        margin: 0 !important;
      }
      .ts-filtros-popover .ts-filtro select, .ts-filtros-popover .ts-filtro input { min-width: 0; width: 100%; box-sizing: border-box; }
      .ts-filtros-popover .ts-btn-ghost { align-self: end; }

      /* Historial: selector "Mostrar" (Ambos / Trabajos / Aceites) tipo pestañas */
      .ts-filtro-vista { grid-column: 1 / -1; }
      .ts-segmento {
        display: inline-flex; gap: 4px; padding: 4px;
        background: var(--panel-2); border-radius: 8px; align-self: flex-start;
        max-width: 100%; box-sizing: border-box;
      }
      .ts-segmento-op {
        border: none; background: transparent; color: var(--text-dim);
        font: inherit; font-size: calc(13px * var(--ts-escala-fuente, 1)); font-weight: 600;
        padding: 7px 16px; border-radius: 6px; cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .ts-segmento-op:hover { color: var(--text); }
      .ts-segmento-op.activo { background: var(--amber); color: #ffffff; }
      .ts-tipo-registro { margin-bottom: 14px; }
      .ts-aceites-tabla .ts-acciones-fila { flex-wrap: nowrap; }
      .ts-aceites-tabla td:last-child { width: 1%; white-space: nowrap; }
      .ts-tipo-registro .ts-segmento-op { min-width: 96px; }

      /* Campos de formulario y filtros sin borde visible: se distinguen solo
         por su fondo. El borde transparente conserva el tamaño original. */
      .ts-select, select, input, textarea {
        background: var(--panel-2);
        border: 1px solid transparent;
        color: var(--text);
        padding: 7px 9px;
        border-radius: 3px;
        font-size: calc(13px * var(--ts-escala-fuente, 1));
        font-family: inherit;
      }
      .ts-select { width: 100%; }

      /* Selects resaltados en el formulario de Registro de trabajo:
         Turno y Grupo con el color principal de la app; Estado final en
         verde (Disponible) o rojo (No disponible) según lo seleccionado. */
      select.ts-select-acento {
        background-color: color-mix(in srgb, var(--amber) 32%, var(--panel));
        color: var(--text);
        font-weight: 600;
      }
      select.ts-select-estado-ok {
        background-color: color-mix(in srgb, var(--green) 32%, var(--panel));
        color: var(--text);
        font-weight: 600;
      }
      select.ts-select-estado-alerta {
        background-color: color-mix(in srgb, var(--red) 32%, var(--panel));
        color: var(--text);
        font-weight: 600;
      }
      select.ts-select-acento option,
      select.ts-select-estado-ok option,
      select.ts-select-estado-alerta option {
        background: var(--panel);
        color: var(--text);
        font-weight: 400;
      }
      input:focus, select:focus, textarea:focus, button:focus-visible {
        outline: 2px solid var(--amber);
        outline-offset: 1px;
      }

      /* Main */
      .ts-main { display: flex; flex-direction: column; min-width: 0; }
      .ts-topbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 26px;
        border-bottom: 1px solid var(--border);
        /* Fija arriba: el contenido se desplaza por debajo */
        position: sticky;
        top: 0;
        z-index: 30;
        background: var(--bg);
      }
      .ts-topbar-title { font-size: calc(18px * var(--ts-escala-fuente, 1)); font-weight: 600; }
      .ts-topbar-sub { font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-top: 2px; }
      .ts-topbar-acciones { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
      .ts-rol-movil { display: none; }

      .ts-content { padding: 22px 26px 40px; overflow-x: auto; }
      .ts-stack { display: flex; flex-direction: column; gap: 18px; }

      /* KPIs */
      .ts-kpi-band {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      .ts-kpi {
        background: var(--panel);
        border: 1px solid var(--border);
        border-top: 3px solid var(--border);
        border-radius: 3px;
        padding: 16px 16px 14px;
      }
      .ts-kpi-ok { border-top-color: var(--green); }
      .ts-kpi-alerta { border-top-color: var(--red); }
      .ts-kpi-dato { border-top-color: var(--amber); }
      .ts-kpi-valor { font-size: calc(28px * var(--ts-escala-fuente, 1)); font-weight: 700; font-variant-numeric: tabular-nums; }
      .ts-kpi-etiqueta { font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-top: 4px; }

      /* Filtros */
      .ts-filtros {
        display: flex; flex-wrap: wrap; align-items: end; gap: 12px;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 14px 16px;
      }
      .ts-filtro { display: flex; flex-direction: column; gap: 5px; font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      .ts-filtro select, .ts-filtro input { min-width: 130px; }

      /* Panels & grid */
      .ts-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      @media (max-width: 900px) { .ts-grid-2 { grid-template-columns: 1fr; } }

      .ts-grafico-subtitulo { margin: 0 0 6px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-weight: 600; color: var(--text-dim); }
      .ts-grafico-svg { width: 100%; height: auto; }
      /* Inicio: filtro propio de cada cuadro */
      .ts-filtro-panel { position: relative; display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .ts-filtro-panel .ts-filtros-resumen { text-transform: none; }
      .ts-filtro-panel-popover {
        position: absolute !important; top: calc(100% + 8px) !important; right: 0 !important; left: auto !important;
        width: min(560px, calc(100vw - 32px)) !important; max-height: none !important; text-align: left;
      }
      .ts-filtros-periodo .ts-segmento { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
      .ts-filtros-periodo .ts-segmento-op { padding: 7px 8px; white-space: nowrap; }
      .ts-panel-head { gap: 10px; }
      /* Inicio: aceite del mes */
      .ts-mes-nav { display: inline-flex; align-items: center; gap: 6px; }
      .ts-mes-nav .ts-btn-mini { width: 28px; height: 28px; font-size: calc(16px * var(--ts-escala-fuente, 1)); }
      .ts-mes-nombre { min-width: 118px; text-align: center; font-weight: 600; font-size: calc(13px * var(--ts-escala-fuente, 1)); }
      .ts-mes-nota { font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-bottom: 8px; }
      .ts-mes-bloque { background: var(--panel-2); border-radius: 8px; padding: 12px 14px 14px; min-width: 0; }
      .ts-mes-cabecera { margin-bottom: 10px; }
      .ts-mes-total { font-size: calc(26px * var(--ts-escala-fuente, 1)); font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
      .ts-mes-sub { font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 2px; }
      .ts-mes-dif.sube { color: var(--red); }
      .ts-mes-dif.baja { color: var(--green, #2fa36b); }
      .ts-mes-lista { display: flex; flex-direction: column; gap: 7px; }
      .ts-mes-fila { display: grid; grid-template-columns: minmax(70px, 30%) 1fr 64px; align-items: center; gap: 10px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); }
      .ts-mes-fila-cero { color: var(--text-dim); }
      .ts-mes-tipo { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ts-mes-barra { height: 10px; background: var(--panel); border-radius: 5px; overflow: hidden; }
      .ts-mes-barra > span { display: block; height: 100%; border-radius: 5px; min-width: 0; transition: width 0.25s; }
      .ts-mes-litros { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
      .ts-grafico-eje { stroke: var(--border); stroke-width: 1; }
      .ts-grafico-eje-texto { fill: var(--text-dim); font-size: calc(11px * var(--ts-escala-fuente, 1)); }
      .ts-grafico-valor-texto { fill: var(--text); font-size: calc(9.5px * var(--ts-escala-fuente, 1)); font-weight: 600; }
      .ts-grafico-leyenda { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 14px; }
      .ts-grafico-leyenda-item { display: flex; align-items: center; gap: 6px; font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      .ts-grafico-leyenda-color { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }

      .ts-panel { background: var(--panel); border: 1px solid var(--border); border-radius: 3px; }
      .ts-panel-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 13px 16px; border-bottom: 1px solid var(--border);
      }
      .ts-panel-head h3 { margin: 0; font-size: calc(14px * var(--ts-escala-fuente, 1)); font-weight: 600; }
      /* Fecha y hora de registro / edición junto al título del formulario */
      .ts-panel-titulo-con-sello { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 14px; min-width: 0; }
      .ts-panel-sello { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); font-weight: 400; }
      .ts-panel-body { padding: 14px 16px 16px; }

      .ts-panel-titulo-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        color: inherit;
        font: inherit;
        text-align: left;
      }
      /* Marcadores de color (estilo apps de correo) */
      .ts-th-equipo, .ts-td-equipo { display: inline-flex; align-items: center; gap: 6px; }
      .ts-marcador-wrap { position: relative; display: inline-flex; }
      .ts-marcador {
        display: inline-flex; align-items: center; justify-content: center; gap: 1px;
        width: 26px; height: 26px; padding: 0; border: none; border-radius: 6px;
        background: transparent; color: var(--text-dim); cursor: pointer; opacity: 0.55; flex-shrink: 0;
      }
      .ts-marcador:hover, .ts-marcador-activo { opacity: 1; }
      .ts-marcador:hover { background: color-mix(in srgb, var(--text-dim) 14%, transparent); }
      .ts-filtro-marca-btn { width: auto; padding: 0 4px; }
      .ts-filtro-marca-flecha { font-size: calc(9px * var(--ts-escala-fuente, 1)); }
      .ts-marcador-menu {
        position: absolute; top: calc(100% + 4px); left: 0; z-index: 12;
        display: flex; align-items: center; gap: 8px; padding: 8px 10px;
        background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.18); animation: ts-aparecer 0.12s ease-out;
      }
      .ts-marcador-color {
        width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
      }
      .ts-marcador-color:hover { transform: scale(1.12); }
      .ts-marcador-color-activo { border-color: var(--text); }
      .ts-marcador-quitar {
        border: none; background: transparent; color: var(--text-dim); cursor: pointer;
        font: inherit; font-size: calc(12px * var(--ts-escala-fuente, 1)); padding: 2px 4px; white-space: nowrap;
      }
      .ts-marcador-quitar:hover { color: var(--text); text-decoration: underline; }
      .ts-filtro-marca-menu { left: 0; min-width: 170px; }
      .ts-filtro-marca-menu .ts-opcion-activa { background: var(--amber-dim); color: var(--amber); font-weight: 600; }
      .ts-punto-marca { width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid; flex-shrink: 0; }
      .ts-link-btn { border: none; background: none; padding: 0; color: var(--amber); font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; }
      /* Fila / tarjeta marcada: toda la fila toma el color de la marca */
      .ts-tabla tr.ts-marca-rojo > td { background: color-mix(in srgb, var(--marca-rojo) 16%, transparent); }
      .ts-tabla tr.ts-marca-amarillo > td { background: color-mix(in srgb, var(--marca-amarillo) 20%, transparent); }
      .ts-tabla tr.ts-marca-verde > td { background: color-mix(in srgb, var(--marca-verde) 16%, transparent); }
      .ts-tabla tr.ts-marca-rojo:hover > td { background: color-mix(in srgb, var(--marca-rojo) 24%, transparent); }
      .ts-tabla tr.ts-marca-amarillo:hover > td { background: color-mix(in srgb, var(--marca-amarillo) 28%, transparent); }
      .ts-tabla tr.ts-marca-verde:hover > td { background: color-mix(in srgb, var(--marca-verde) 24%, transparent); }
      .ts-tm-card.ts-marca-rojo { background: color-mix(in srgb, var(--marca-rojo) 20%, var(--panel)); }
      .ts-tm-card.ts-marca-amarillo { background: color-mix(in srgb, var(--marca-amarillo) 24%, var(--panel)); }
      .ts-tm-card.ts-marca-verde { background: color-mix(in srgb, var(--marca-verde) 20%, var(--panel)); }
      .ts-acciones-fila .ts-marcador-menu { left: auto; right: 0; }
            .ts-colores-marca { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .ts-color-marca {
        display: inline-flex; align-items: center; gap: 10px; padding: 6px 12px 6px 6px;
        border: 1px solid var(--border); border-radius: 10px; background: var(--panel-2); cursor: pointer;
      }
      .ts-color-marca:hover { border-color: var(--text-dim); }
      .ts-color-marca-muestra {
        position: relative; width: 30px; height: 30px; border-radius: 50%; overflow: hidden;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
      }
      .ts-color-marca-muestra input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: none; padding: 0; }
      .ts-color-marca-texto { display: flex; flex-direction: column; line-height: 1.2; font-size: calc(13px * var(--ts-escala-fuente, 1)); color: var(--text); }
      .ts-color-marca-texto small { font-family: var(--mono, monospace); color: var(--text-dim); font-size: calc(11px * var(--ts-escala-fuente, 1)); }
      .ts-chevron { color: var(--text-dim); flex-shrink: 0; transition: transform 0.15s ease; }
      /* Ordenar cuadros arrastrando */
      .ts-panel-titulo-grupo { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .ts-asa-arrastre {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 28px; margin-left: -6px; border-radius: 5px;
        color: var(--text-dim); cursor: grab; touch-action: none; flex-shrink: 0; opacity: 0.6;
      }
      .ts-asa-arrastre:hover { opacity: 1; background: var(--panel-2); }
      .ts-lista-ordenable { display: flex; flex-direction: column; gap: inherit; }
      .ts-ordenable { position: relative; }
      .ts-ordenable-activo { z-index: 5; }
      .ts-ordenable-activo > .ts-panel {
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
        outline: 2px solid var(--amber); outline-offset: -2px;
      }
      body.ts-arrastrando, body.ts-arrastrando * { user-select: none !important; cursor: grabbing !important; }
      .ts-chevron-abierto { transform: rotate(90deg); }

      .ts-vacio { color: var(--text-dim); font-size: calc(13px * var(--ts-escala-fuente, 1)); padding: 10px 2px; }

      /* Tables */
      .ts-tabla-wrap { overflow-x: auto; }
      .ts-tabla { width: 100%; border-collapse: collapse; font-size: calc(13px * var(--ts-escala-fuente, 1)); }
      .ts-tabla th {
        text-align: left; font-weight: 600; color: var(--text-dim);
        border-bottom: 1px solid var(--border);
        padding: 8px 10px; white-space: nowrap;
      }
      .ts-tabla td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
      .ts-tabla tbody tr:last-child td { border-bottom: none; }
      /* Fechas, códigos, horas y badges no deben partirse en dos líneas. */
      .ts-tabla td.ts-mono, .ts-tabla td .ts-badge { white-space: nowrap; }

      /* Limita el texto largo (descripciones, observaciones, listas de
         personal) a un máximo de 2 líneas dentro de una fila de tabla,
         recortando el resto con puntos suspensivos. */
      .ts-trabajo-titulo { font-weight: 600; }
      .ts-trabajo-desc { color: var(--text); }
      .ts-clamp-2 {
        display: -webkit-box;
        min-width: 0;
        word-break: break-word;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .ts-tabla tbody tr:hover { background: var(--panel-2); }
      .ts-fila-clicable { cursor: pointer; }
      .ts-fila-clicable:hover { background: var(--panel-2); box-shadow: inset 2px 0 0 var(--amber); }

      /* Anchos de columna fijos y consistentes entre cuadros de Configuración
         (Supervisión, Grupo 1-4, Lubrico, Flotas y equipos, catálogos), para
         que todos queden alineados entre sí sin depender del largo del
         contenido de cada tabla individual. */
      .ts-tabla-personal,
      .ts-tabla-equipos,
      .ts-tabla-catalogo {
        table-layout: fixed;
      }
      .ts-tabla-personal th:nth-child(1), .ts-tabla-personal td:nth-child(1) { width: 22%; }
      .ts-tabla-personal th:nth-child(2), .ts-tabla-personal td:nth-child(2) { width: 9%; }
      .ts-tabla-personal th:nth-child(3), .ts-tabla-personal td:nth-child(3) { width: 8%; }
      .ts-tabla-personal th:nth-child(4), .ts-tabla-personal td:nth-child(4) { width: 15%; }
      .ts-tabla-personal th:nth-child(5), .ts-tabla-personal td:nth-child(5) { width: 11%; }
      .ts-tabla-personal th:nth-child(6), .ts-tabla-personal td:nth-child(6) { width: 11%; }
      .ts-tabla-personal th:nth-child(7), .ts-tabla-personal td:nth-child(7) { width: 10%; }
      .ts-tabla-personal th:nth-child(8), .ts-tabla-personal td:nth-child(8) { width: 14%; }
      .ts-tabla-personal select { width: 100%; }
      /* Nombre completo (apellidos y nombres): puede ocupar dos líneas */
      .ts-tabla-personal td:nth-child(1) { white-space: normal; overflow-wrap: anywhere; }
      /* Rol distinto al cargo (permisos extra o reducidos): se resalta */
      .ts-rol-distinto { color: var(--amber); font-weight: 700; }
      /* Cargo (y grupo de destino) en la fila de edición: ocupan todo el ancho
         de la celda y tienen la misma altura que los campos de texto. */
      .ts-cargo-celda { display: flex; flex-direction: column; gap: 6px; width: 100%; }
      .ts-tabla-personal input,
      .ts-tabla-personal select {
        width: 100%;
        height: 32px;
        box-sizing: border-box;
      }

      .ts-tabla-equipos th:nth-child(1), .ts-tabla-equipos td:nth-child(1) { width: 11%; }
      .ts-tabla-equipos th:nth-child(2), .ts-tabla-equipos td:nth-child(2) { width: 14%; }
      .ts-tabla-equipos th:nth-child(3), .ts-tabla-equipos td:nth-child(3) { width: 18%; }
      .ts-tabla-equipos th:nth-child(4), .ts-tabla-equipos td:nth-child(4) { width: 31%; }
      .ts-tabla-equipos th:nth-child(5), .ts-tabla-equipos td:nth-child(5) { width: 12%; }
      .ts-tabla-equipos th:nth-child(6), .ts-tabla-equipos td:nth-child(6) { width: 14%; }

      .ts-tabla-catalogo th:nth-child(1), .ts-tabla-catalogo td:nth-child(1) { width: 50%; }
      .ts-tabla-catalogo th:nth-child(2), .ts-tabla-catalogo td:nth-child(2) { width: 25%; }
      .ts-tabla-catalogo th:nth-child(3), .ts-tabla-catalogo td:nth-child(3) { width: 25%; }

      /* Tablas de Trabajos e Historial: las columnas cortas (equipo, ubicación,
         fecha, turno, grupo, horario, estado y botones) se ajustan a su
         contenido y quedan pegadas a la derecha; todo el espacio sobrante es
         para la columna Trabajo. */
      .ts-tabla.ts-tabla-trabajos,
      .ts-tabla.ts-tabla-trabajos-amplia { table-layout: auto; }
      .ts-tabla-trabajos th, .ts-tabla-trabajos td,
      .ts-tabla-trabajos-amplia th, .ts-tabla-trabajos-amplia td { width: 1%; white-space: nowrap; }
      /* Columnas: 1 OT (con la bandera), 2 Equipo, 3 Trabajo (la ancha), ... */
      .ts-tabla-trabajos th:nth-child(3), .ts-tabla-trabajos td:nth-child(3),
      .ts-tabla-trabajos-amplia th:nth-child(3), .ts-tabla-trabajos-amplia td:nth-child(3) {
        width: auto;
        min-width: 320px;
        white-space: normal;
        padding-right: 22px;
      }
      .ts-tabla-trabajos td .ts-clamp-2, .ts-tabla-trabajos-amplia td .ts-clamp-2 { white-space: normal; }
      .ts-tabla-trabajos td:not(:nth-child(3)) .ts-clamp-2,
      .ts-tabla-trabajos-amplia td:not(:nth-child(3)) .ts-clamp-2 { white-space: nowrap; display: block; }
      .ts-tabla-trabajos .ts-acciones-fila,
      .ts-tabla-trabajos-amplia .ts-acciones-fila { flex-wrap: nowrap; }
      .ts-tabla-trabajos td:last-child .ts-acciones-fila,
      .ts-tabla-trabajos-amplia td:last-child .ts-acciones-fila { padding-left: 4px; }
      /* Pestaña Trabajos: las tablas de programados y no programados usan los
         mismos anchos fijos para que sus columnas queden alineadas. */
      /* Ancho mínimo: en pantallas angostas (celular horizontal) la columna
         Trabajo no se aplasta; la tabla se recorre con la barra inferior. */
      .ts-tabla.ts-tabla-trabajos-amplia { table-layout: fixed; width: 100%; min-width: 980px; }
      /* 1 OT · 2 Equipo · 3 Trabajo (todo el espacio libre) · 4 Personal ·
         5 Ubicación · 6 Horario · 7 Estado · 8 Botones */
      .ts-tabla-trabajos-amplia th:nth-child(1), .ts-tabla-trabajos-amplia td:nth-child(1) { width: 126px; }
      .ts-tabla-trabajos-amplia th:nth-child(2), .ts-tabla-trabajos-amplia td:nth-child(2) { width: 80px; }
      .ts-tabla-trabajos td .ts-pill-editando, .ts-tabla-trabajos-amplia td .ts-pill-editando { display: block; width: fit-content; margin: 3px 0 0; }
      .ts-tabla-trabajos-amplia th:nth-child(3), .ts-tabla-trabajos-amplia td:nth-child(3) { width: auto; min-width: 0; }
      .ts-tabla-trabajos-amplia th:nth-child(4), .ts-tabla-trabajos-amplia td:nth-child(4) { width: 150px; }
      .ts-tabla-trabajos-amplia th:nth-child(5), .ts-tabla-trabajos-amplia td:nth-child(5) { width: 104px; }
      .ts-tabla-trabajos-amplia th:nth-child(6), .ts-tabla-trabajos-amplia td:nth-child(6) { width: 112px; }
      .ts-tabla-trabajos-amplia th:nth-child(7), .ts-tabla-trabajos-amplia td:nth-child(7) { width: 62px; }
      .ts-tabla-trabajos-amplia th:nth-child(8), .ts-tabla-trabajos-amplia td:nth-child(8) { width: 100px; }
      .ts-tabla-trabajos-amplia td:nth-child(5) .ts-clamp-2 { overflow: hidden; text-overflow: ellipsis; }
      /* Personal: hasta 2 líneas */
      .ts-tabla.ts-tabla-trabajos-amplia td:nth-child(4) .ts-clamp-2.ts-trabajo-personal { white-space: normal; display: -webkit-box; overflow-wrap: anywhere; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }

      /* Ancho mínimo: en pantallas angostas la tabla se desplaza dentro de su cuadro */
      .ts-tabla-trabajos { min-width: 980px; }
      .ts-tabla-trabajos-amplia { min-width: 700px; }
      .ts-tabla-personal { min-width: 860px; }
      .ts-tabla-equipos { min-width: 720px; }
      .ts-tabla-catalogo { min-width: 320px; }
      .ts-tabla-trabajos th, .ts-tabla-personal th, .ts-tabla-equipos th, .ts-tabla-catalogo th {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ts-tabla-personal td, .ts-tabla-equipos td, .ts-tabla-catalogo td {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ts-tabla-personal td:last-child,
      .ts-tabla-equipos td:last-child,
      .ts-tabla-catalogo td:last-child {
        overflow: visible;
        white-space: normal;
      }
      .ts-tabla-personal input,
      .ts-tabla-equipos input,
      .ts-tabla-equipos select,
      .ts-tabla-catalogo input {
        width: 100%;
      }

      /* Badges */
      .ts-badge {
        display: inline-block;
        padding: 3px 9px;
        border-radius: 3px;
        font-size: calc(11.5px * var(--ts-escala-fuente, 1));
        font-weight: 600;
        white-space: nowrap;
      }
      .ts-badge-ok { background: var(--green-dim); color: var(--green); }
      .ts-badge-alerta { background: var(--red-dim); color: var(--red); }
      /* Tarjetas compactas de aceites (solo celular) */
      .ts-aceites-movil { display: none; }
      .ts-am-card {
        background: var(--panel-2);
        border-radius: 10px;
        padding: 8px 10px;
        margin-bottom: 8px;
      }
      .ts-am-card:last-child { margin-bottom: 0; }
      .ts-am-fila1 { display: flex; align-items: center; gap: 8px; font-size: calc(13px * var(--ts-escala-fuente, 1)); color: var(--text); }
      .ts-am-equipo { font-size: calc(16px * var(--ts-escala-fuente, 1)); font-family: var(--mono, monospace); }
      .ts-am-litros { margin-left: auto; font-weight: 700; font-size: calc(14px * var(--ts-escala-fuente, 1)); white-space: nowrap; }
      .ts-am-fila1 .ts-acciones-fila { flex-shrink: 0; }
      .ts-am-fila1 .ts-btn-mini { width: 30px; height: 30px; }
      .ts-am-fila2 {
        margin-top: 4px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text); line-height: 1.4;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      .ts-am-op { font-weight: 700; color: var(--amber); }
      .ts-am-fecha { color: var(--text-dim); font-size: calc(12.5px * var(--ts-escala-fuente, 1)); }
      /* Etiquetas de color: turno, tipo de trabajo y operación. Colores fijos
         (no dependen del color de acento) y fondos translúcidos para que se
         vean bien en los temas Oscuro, Claro y Blanco. */
      .ts-am-etiquetas { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
      .ts-am-tag {
        display: inline-flex; align-items: center;
        font-size: calc(11px * var(--ts-escala-fuente, 1)); font-weight: 700; line-height: 1;
        padding: 4px 8px; border-radius: 999px; white-space: nowrap;
      }
      .ts-tabla .ts-am-tag { white-space: nowrap; }
      .ts-estado-editable { position: relative; display: inline-flex; }
      .ts-estado-btn { display: inline-flex; align-items: center; gap: 4px; border: none; background: transparent; padding: 2px; border-radius: 6px; cursor: pointer; font: inherit; }
      .ts-estado-btn:hover { background: var(--panel-2); }
      .ts-estado-flecha { color: var(--text-dim); font-size: calc(10px * var(--ts-escala-fuente, 1)); }
      .ts-estado-menu { left: 0; right: auto; top: calc(100% + 4px); min-width: 210px; z-index: 30; }
      .ts-estado-menu-fijo { position: fixed; right: auto; z-index: 60; }
      .ts-estado-menu button { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .ts-estado-menu-titulo { padding: 6px 12px 4px; font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); font-weight: 600; }
      .ts-req-estado .ts-estado-menu { left: auto; right: 0; }
      .ts-aceites-tabla .ts-tabla th, .ts-aceites-tabla .ts-tabla td { padding-left: 5px; padding-right: 5px; }
      .ts-estado-actual { font-size: calc(11px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      .ts-am-tag-dia { background: rgba(245, 158, 11, 0.18); color: #c27c0e; }
      .ts-am-tag-noche { background: rgba(99, 102, 241, 0.18); color: #5b5fd6; }
      .ts-am-tag-prog { background: rgba(34, 160, 90, 0.16); color: #1e8a4f; }
      .ts-am-tag-noprog { background: rgba(220, 70, 60, 0.15); color: #c9413a; }
      .ts-am-tag-adicion { background: rgba(14, 165, 233, 0.16); color: #0b84b8; }
      .ts-am-tag-cambio { background: rgba(168, 85, 247, 0.16); color: #8b3fd1; }
      .ts-am-tag-derrame { background: var(--red-dim); color: var(--red); }
      .ts-am-op-cambio { color: var(--blue); }
      /* Tarjetas compactas de requerimientos (solo celular) */
      .ts-req-movil { display: none; }
      .ts-req-num { font-family: var(--mono, monospace); font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      .ts-req-estado { margin-left: auto; }
      .ts-req-estado .ts-badge { font-size: calc(11px * var(--ts-escala-fuente, 1)); padding: 2px 7px; white-space: nowrap; }
      .ts-req-parte { font-family: var(--mono, monospace); font-weight: 600; }
      .ts-req-fila3 { margin-top: 2px; font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      .ts-req-acciones { margin-top: 6px; }
      .ts-req-acciones .ts-btn-mini { width: auto; height: 28px; padding: 0 10px; }

      /* Tarjetas de trabajos (solo celular) */
      .ts-trabajos-movil { display: none; }
      .ts-tm-card {
        border-radius: 10px;
        padding: 10px 12px 12px;
        margin-bottom: 10px;
        border: none;
      }
      .ts-tm-card:last-child { margin-bottom: 0; }
      /* Disponible: fondo neutro. Solo los No disponibles se resaltan en rojo. */
      .ts-tm-card-ok { background: var(--panel-2); }
      .ts-tm-card-alerta { background: var(--red-dim); }
      .ts-tm-card-clicable { cursor: pointer; }
      .ts-tm-cabecera {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding-bottom: 9px; margin-bottom: 9px;
        border-bottom: 1px dashed color-mix(in srgb, var(--text-dim) 35%, transparent);
        font-size: calc(13px * var(--ts-escala-fuente, 1)); color: var(--text);
      }
      .ts-tm-info { min-width: 0; line-height: 1.35; }
      .ts-tm-linea { color: var(--text); font-weight: 500; font-size: calc(15px * var(--ts-escala-fuente, 1)); }
      .ts-tm-ot { color: var(--text-dim); font-weight: 500; }
      .ts-tiempo-invalido { color: var(--red); }
      .ts-aviso-horas { color: var(--red); font-size: calc(11.5px * var(--ts-escala-fuente, 1)); margin-top: 3px; }
      .ts-aviso-horas-fuerte { font-weight: 600; }
      /* Inicio: botón imprimir de los cuadros e Indicadores de mantenimiento */
      .ts-btn-imprimir-panel svg { width: 16px; height: 16px; }
      .ts-acciones-panel { display: flex; align-items: center; gap: 6px; margin-left: auto; }
      .ts-kpi-flota + .ts-kpi-flota { margin-top: 16px; }
      .ts-tabla-kpi th, .ts-tabla-kpi td { white-space: nowrap; text-align: right; }
      .ts-tabla-kpi th:nth-child(-n+2), .ts-tabla-kpi td:nth-child(-n+2) { text-align: left; }
      .ts-tabla-kpi td.ts-kpi-destacado { font-weight: 600; color: var(--text); }
      .ts-kpi-nota { margin-top: 12px; }
      .ts-pill-editando {
        display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; vertical-align: 1px;
        background: var(--red-dim); color: var(--red); font-family: inherit; font-weight: 600; white-space: nowrap;
        font-size: calc(11px * var(--ts-escala-fuente, 1)); animation: ts-latido 1.6s ease-in-out infinite;
      }
      .ts-texto-tenue { color: var(--text-dim); }
      .ts-tm-linea strong, .ts-tm-linea .ts-tm-horario { color: var(--text); }
      .ts-tm-info strong { font-size: calc(17px * var(--ts-escala-fuente, 1)); font-family: var(--mono, monospace); }
      .ts-tm-fecha { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-bottom: 2px; }
      .ts-tm-horario { font-family: inherit; white-space: nowrap; }
      .ts-tm-cabecera .ts-acciones-fila { flex-shrink: 0; flex-wrap: nowrap; }
      .ts-tm-card .ts-btn-mini { background: color-mix(in srgb, var(--panel) 55%, transparent); }
      .ts-tm-trabajo {
        font-size: calc(13px * var(--ts-escala-fuente, 1)); line-height: 1.45;
        display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
        word-break: break-word;
      }
      .ts-tm-etiqueta { font-weight: 600; color: var(--text-dim); margin-right: 8px; }

      .ts-estado-icono {
        display: inline-flex; align-items: center; justify-content: center;
        width: 24px; height: 24px; border-radius: 6px;
        flex-shrink: 0;
        vertical-align: middle;
      }
      /* Fondo suave (transparente) y símbolo en el color del estado */
      .ts-estado-icono-ok { background: var(--green-dim); color: var(--green); }
      .ts-col-verif { text-align: center; }
      .ts-estado-icono-alerta { background: var(--red-dim); color: var(--red); }

      /* Ventana flotante de formularios (crear / editar) */
      .ts-modal-form-fondo {
        position: fixed;
        inset: 0;
        z-index: 80;
        background: rgba(10, 14, 18, 0.55);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 5vh 20px;
        overflow-y: auto;
        animation: ts-fondo-aparecer 0.15s ease-out;
      }
      @keyframes ts-fondo-aparecer { from { opacity: 0; } to { opacity: 1; } }
      .ts-modal-form {
        position: relative;
        width: 100%;
        max-width: 980px;
        margin: auto 0;
        border-radius: 10px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
        animation: ts-aparecer 0.16s ease-out;
      }
      .ts-modal-form > .ts-panel { border-radius: 10px; border: none; }
      .ts-modal-form .ts-panel-head { padding-right: 56px; }
      .ts-modal-form-cerrar {
        position: absolute;
        top: 7px;
        right: 8px;
        z-index: 2;
        width: 36px; height: 36px;
        display: flex; align-items: center; justify-content: center;
        border: none; border-radius: 8px;
        background: transparent;
        color: var(--text-dim);
        cursor: pointer;
      }
      .ts-modal-form-cerrar:hover { background: var(--panel-2); color: var(--text); }
      /* Quién está editando el registro (a la izquierda de la ×) */
      .ts-modal-con-editor .ts-panel-head { padding-right: 290px; }
      .ts-modal-editor {
        position: absolute; top: 12px; right: 52px; z-index: 2;
        max-width: 240px; display: flex; align-items: center; gap: 7px;
        padding: 4px 11px; border-radius: 999px;
        background: var(--green-dim); color: var(--green);
        font-size: calc(12px * var(--ts-escala-fuente, 1)); font-weight: 600;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ts-modal-editor-punto { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex-shrink: 0; animation: ts-latido 1.6s ease-in-out infinite; }
      .ts-modal-editor-ocupado { background: var(--red-dim); color: var(--red); }
      /* Confirmación al cerrar con cambios sin guardar */
      .ts-confirmar-cierre-fondo { position: fixed; inset: 0; z-index: 120; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; padding: 16px; }
      .ts-confirmar-cierre { background: var(--panel); color: var(--text); width: min(440px, 100%); border-radius: 8px; padding: 20px 20px 16px; box-shadow: 0 12px 40px rgba(0,0,0,.3); }
      .ts-confirmar-cierre-titulo { font-size: calc(16px * var(--ts-escala-fuente, 1)); font-weight: 600; margin-bottom: 6px; }
      .ts-confirmar-cierre-texto { font-size: calc(13.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-bottom: 18px; line-height: 1.45; }
      .ts-confirmar-cierre-botones { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
      .ts-confirmar-campos { margin: -4px 0 14px; }
      /* Campos de los cuadros de confirmación: como el registro de trabajo, sin borde negro al escribir */
      .ts-confirmar-cierre input, .ts-confirmar-cierre select, .ts-confirmar-cierre textarea { border: 1px solid transparent; }
      .ts-confirmar-cierre input:focus, .ts-confirmar-cierre select:focus, .ts-confirmar-cierre textarea:focus { outline: none; border-color: var(--border); background: var(--panel); }
      /* Datos automáticos del formulario (solo se muestran) */
      .ts-dato-fijo { border: 1px solid transparent; padding: 7px 9px; border-radius: 3px; font-size: calc(13px * var(--ts-escala-fuente, 1)); font-weight: 600; color: var(--text); min-height: 34px; box-sizing: border-box; }
      .ts-dato-acento { background: color-mix(in srgb, var(--amber) 32%, var(--panel)); }
      .ts-dato-ok { background: color-mix(in srgb, var(--green) 32%, var(--panel)); }
      /* Requerimientos: secuencia de estados en la fila */
      .ts-tabla tr.ts-req-con-seguimiento td { border-bottom: none; }
      .ts-tabla tr.ts-req-fila-seguimiento td { padding-top: 0; padding-bottom: 12px; }
      .ts-tabla tr.ts-req-fila-seguimiento:hover td { background: transparent; }
      .ts-req-seguimiento { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 2px 0 0; }
      .ts-req-paso { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .ts-req-paso-barra { height: 4px; border-radius: 999px; background: var(--border); margin-bottom: 5px; }
      .ts-req-paso-hecho .ts-req-paso-barra { background: var(--amber); opacity: .35; }
      .ts-req-paso-actual .ts-req-paso-barra { opacity: 1; }
      .ts-req-paso-rechazo .ts-req-paso-barra { background: var(--red); opacity: 1; }
      .ts-req-paso-titulo { display: flex; align-items: center; gap: 6px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-weight: 600; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ts-req-paso-hecho .ts-req-paso-titulo { color: var(--text); }
      .ts-req-paso-icono {
        width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
        font-size: 9.5px; font-weight: 700; border: 1px solid var(--border); color: var(--text-dim); background: var(--panel);
      }
      .ts-req-paso-hecho .ts-req-paso-icono { background: var(--amber); border-color: var(--amber); color: var(--panel); }
      .ts-req-paso-rechazo .ts-req-paso-icono { background: var(--red); border-color: var(--red); color: #fff; }
      .ts-req-paso-meta { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); padding-left: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ts-req-paso-extra { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--text); padding-left: 22px; }
      .ts-am-card .ts-req-seguimiento { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
      @media (max-width: 600px) {
        .ts-req-seguimiento { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
        .ts-req-paso-meta { white-space: normal; }
      }
      .ts-confirmar-cierre .ts-btn-descartar { color: var(--red); border-color: var(--red); margin-right: auto; }
      @keyframes ts-latido { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
      .ts-edicion-ocupada { display: flex; flex-direction: column; gap: 12px; padding: 6px 4px 4px; font-size: calc(14px * var(--ts-escala-fuente, 1)); color: var(--text); line-height: 1.5; }
      .ts-edicion-ocupada-icono { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--red-dim); color: var(--red); }
      .ts-edicion-ocupada-icono svg { width: 22px; height: 22px; }
      /* Mientras el formulario está abierto se ocultan los botones flotantes */
      .ts-stack:has(.ts-modal-form-fondo) .ts-accion-row-split { display: none; }
      /* Equipos no disponibles (Inicio): etiqueta convertida en botón que
         abre el último registro de trabajo del equipo en modo edición. */
      .ts-badge-boton {
        display: inline-flex; align-items: center; gap: 5px;
        border: 1px solid transparent;
        font-family: inherit;
        cursor: pointer;
        padding: 6px 10px;
        transition: border-color 0.12s, filter 0.12s;
      }
      .ts-badge-boton:hover { border-color: var(--red); filter: brightness(0.97); }
      /* Aviso de posible olvido: triángulo amarillo en la esquina superior derecha */
      .ts-badge-con-aviso { position: relative; overflow: visible; }
      .ts-badge-aviso {
        position: absolute;
        top: -9px;
        right: -9px;
        display: flex;
        line-height: 0;
        filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25));
        pointer-events: none;
      }
      .ts-badge-info { background: var(--blue-dim); color: var(--blue); }
      .ts-badge-pendiente { background: var(--yellow-dim); color: var(--yellow); }
      .ts-badge-neutro { background: var(--panel-2); color: var(--text-dim); }

      .ts-btn-estado {
        border: 1px solid transparent;
        border-radius: 3px;
        padding: 3px 10px;
        font-size: calc(11.5px * var(--ts-escala-fuente, 1));
        font-weight: 600;
        cursor: pointer;
      }
      .ts-btn-estado-activo { background: var(--green-dim); color: var(--green); }
      .ts-btn-estado-activo:hover { border-color: var(--green); }
      .ts-btn-estado-inactivo { background: var(--panel-2); color: var(--text-dim); }
      .ts-btn-estado-inactivo:hover { border-color: var(--border); color: var(--text); }

      .ts-paleta { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }

      .ts-tema-switch { display: inline-flex; gap: 6px; }
      .ts-tema-opcion {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--panel-2);
        border: 1px solid var(--border);
        color: var(--text-dim);
        padding: 7px 14px;
        border-radius: 3px;
        font-size: calc(12.5px * var(--ts-escala-fuente, 1));
        font-weight: 600;
        cursor: pointer;
      }
      .ts-tema-opcion-activa { border-color: var(--amber); color: var(--amber); background: var(--amber-dim); }
      .ts-swatch {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 2px solid transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
      }
      .ts-swatch:hover { border-color: var(--text-dim); }

      .ts-panel-izq-opciones { display: flex; gap: 16px; flex-wrap: wrap; }
      .ts-panel-izq-opcion {
        background: transparent;
        border: none;
        padding: 0;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        color: var(--text);
      }
      .ts-panel-izq-miniatura {
        width: 84px;
        height: 58px;
        border-radius: 4px;
        border: 1px solid var(--border);
        overflow: hidden;
        display: flex;
      }
      .ts-panel-izq-opcion:hover .ts-panel-izq-miniatura { border-color: var(--amber); }
      .ts-panel-izq-miniatura-sidebar {
        width: 30px;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 4px;
        box-sizing: border-box;
      }
      .ts-panel-izq-miniatura-barra { width: 60%; height: 4px; border-radius: 2px; }
      .ts-panel-izq-miniatura-linea { width: 90%; height: 2px; border-radius: 1px; opacity: 0.7; }
      .ts-panel-izq-miniatura-contenido { flex: 1; background: #f4f5f7; }
      .ts-panel-izq-radio { display: flex; align-items: center; gap: 6px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); }
      .ts-panel-izq-punto {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 1.5px solid var(--border);
        display: inline-block;
        position: relative;
      }
      .ts-panel-izq-punto-activo { border-color: var(--amber); }
      .ts-panel-izq-punto-activo::after {
        content: "";
        position: absolute;
        top: 2.5px; left: 2.5px;
        width: 7px; height: 7px;
        border-radius: 50%;
        background: var(--amber);
      }

      .ts-badge-dia { background: var(--amber-dim); color: var(--amber); }
      .ts-badge-noche { background: var(--blue-dim); color: var(--blue); }

      /* Buttons */
      .ts-accion-row { display: flex; justify-content: flex-end; }
      .ts-accion-row-split { justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
      .ts-fab-icono { display: none; }
      /* Botones flotantes (escritorio, tablet y celular): "+" (crear) abajo a
         la derecha y "Exportar" encima. En celular se suben sobre la barra de
         navegación inferior (ver media query). */
      .ts-accion-row-split {
        position: fixed;
        right: 28px;
        bottom: 28px;
        z-index: 25;
        flex-direction: column;
        flex-wrap: nowrap;
        align-items: center;
        gap: 14px;
      }
      .ts-accion-row-split .ts-btn-texto { display: none; }
      .ts-accion-row-split .ts-fab-icono { display: flex; align-items: center; justify-content: center; }
      .ts-accion-row-split .ts-btn-exportar,
      .ts-accion-row-split .ts-btn-crear {
        display: flex; align-items: center; justify-content: center;
        padding: 0;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
        transition: transform 0.12s, filter 0.12s;
      }
      .ts-accion-row-split .ts-btn-exportar:hover,
      .ts-accion-row-split .ts-btn-crear:hover { transform: translateY(-2px); filter: brightness(1.06); }
      .ts-accion-row-split .ts-btn-exportar { width: 46px; height: 46px; border-radius: 12px; }
      .ts-accion-row-split .ts-btn-crear { width: 60px; height: 60px; border-radius: 18px; }
      /* Almacén (caja): entre Exportar y "+" */
      .ts-accion-row-split .ts-btn-almacen {
        width: 60px; height: 60px; border-radius: 18px; padding: 0;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
        transition: transform 0.12s, filter 0.12s;
      }
      .ts-accion-row-split .ts-btn-almacen:hover { transform: translateY(-2px); filter: brightness(1.06); }
      .ts-accion-row-split .ts-export-menu {
        top: auto; left: auto;
        bottom: 0;
        right: calc(100% + 10px);
      }
      /* Espacio final para que los botones flotantes no tapen el último registro */
      .ts-content { padding-bottom: 150px; }
      .ts-export-dropdown { position: relative; }
      .ts-overlay-cerrar { position: fixed; inset: 0; z-index: 5; background: transparent; cursor: default; }

      .ts-btn-icono-peligro { color: var(--red) !important; }
      .ts-btn-icono-peligro:hover { background: var(--red-dim) !important; }
      .ts-btn-icono-peligro svg { width: 14px; height: 14px; }
      .ts-btn-solo-icono { padding-left: 8px !important; padding-right: 8px !important; }
      .ts-btn-icono { white-space: nowrap; }
      .ts-modal-confirmacion {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 20;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 20px 22px;
        max-width: 380px;
        width: calc(100% - 40px);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
      }
      .ts-modal-confirmacion h3 { margin: 0 0 10px; font-size: calc(15px * var(--ts-escala-fuente, 1)); }
      .ts-modal-confirmacion p { margin: 0 0 18px; font-size: calc(13px * var(--ts-escala-fuente, 1)); color: var(--text-dim); line-height: 1.5; }
      .ts-modal-acciones { display: flex; justify-content: flex-end; gap: 10px; }
      .ts-btn-confirmar-eliminar {
        background: var(--red);
        color: #fff;
        border: none;
        padding: 8px 14px;
        border-radius: 3px;
        font-weight: 600;
        font-size: calc(12.5px * var(--ts-escala-fuente, 1));
        cursor: pointer;
      }
      .ts-btn-confirmar-eliminar:hover { filter: brightness(1.1); }
      /* Menús desplegables (Exportar y tres puntos): mismo estilo que el
         cuadro de filtros: fondo del panel, bordes redondeados y sombra suave. */
      .ts-export-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
        overflow: hidden;
        z-index: 10;
        min-width: 150px;
        padding: 4px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        animation: ts-aparecer 0.14s ease-out;
      }
      .ts-menu-arriba { top: auto; bottom: calc(100% + 4px); right: 0; left: auto; }
      .ts-menu-arriba-topbar { left: auto; right: 0; }
      .ts-menu-perfil { min-width: 240px; }
      .ts-menu-perfil-cabecera { display: flex; align-items: center; gap: 11px; padding: 12px 10px 10px; }
      .ts-menu-avatar {
        width: 38px; height: 38px; border-radius: 50%;
        background: var(--amber); color: #ffffff;
        display: flex; align-items: center; justify-content: center;
        font-weight: 700; font-size: calc(13.5px * var(--ts-escala-fuente, 1)); flex-shrink: 0;
      }
      .ts-menu-perfil-nombre { font-size: calc(14px * var(--ts-escala-fuente, 1)); font-weight: 700; color: var(--text); line-height: 1.2; }
      .ts-menu-perfil-usuario { font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); font-family: var(--mono, monospace); }
      .ts-menu-perfil-rol {
        display: inline-block; margin-top: 4px;
        padding: 2px 8px; border-radius: 999px;
        background: var(--amber-dim); color: var(--amber);
        font-size: calc(11px * var(--ts-escala-fuente, 1)); font-weight: 600;
      }
      .ts-menu-separador { height: 1px; background: var(--border); margin: 4px 6px; }
      .ts-menu-rol {
        display: flex; flex-direction: column; gap: 5px;
        padding: 8px 10px 10px;
      }
      .ts-menu-rol .ts-rol-select { width: 100%; padding: 7px 9px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); }

      /* Inicio de sesión */
      .ts-login-fondo { align-items: center; }
      .ts-login-caja {
        position: relative;
        width: 100%;
        max-width: 360px;
        margin: auto;
        background: var(--panel);
        border-radius: 10px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
        padding: 26px 24px 22px;
      }
      .ts-login-caja-plana { box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12); border: 1px solid var(--border); }
      .ts-login { display: flex; flex-direction: column; gap: 12px; text-align: left; }
      .ts-login h2 { margin: 4px 0 0; font-size: calc(18px * var(--ts-escala-fuente, 1)); text-align: center; }
      .ts-login p { margin: 0 0 4px; color: var(--text-dim); font-size: calc(13px * var(--ts-escala-fuente, 1)); text-align: center; }
      .ts-login-marca, .ts-login .ts-sesion-cerrada-logo { align-self: center; width: 44px; height: 44px; font-size: calc(15px * var(--ts-escala-fuente, 1)); display: flex; align-items: center; justify-content: center; }
      .ts-login input { width: 100%; box-sizing: border-box; }
      .ts-login-clave { position: relative; }
      .ts-login-clave input { padding-right: 72px; }
      /* Oculta el ojo propio del navegador (Edge/IE) para que no salgan dos */
      .ts-login-clave input::-ms-reveal, .ts-login-clave input::-ms-clear { display: none; }
      .ts-login-ver {
        position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
        background: transparent; border: none; color: var(--amber);
        font: inherit; font-size: calc(12px * var(--ts-escala-fuente, 1)); font-weight: 600; cursor: pointer; padding: 4px 6px;
      }
      .ts-login-btn { width: 100%; padding: 11px; margin-top: 4px; }
      .ts-menu-datos-usuario {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ts-menu-dato { display: flex; flex-direction: column; gap: 1px; }
      .ts-menu-dato-etiqueta { font-size: calc(10px * var(--ts-escala-fuente, 1)); text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-dim); }
      .ts-menu-dato-valor { font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-weight: 600; color: var(--text); }
      .ts-export-menu button {
        display: block;
        width: 100%;
        text-align: left;
        background: transparent;
        border: none;
        color: var(--text);
        padding: 9px 12px;
        font-size: calc(12.5px * var(--ts-escala-fuente, 1));
        cursor: pointer;
      }
      .ts-export-menu button { border-radius: 6px; display: flex; align-items: center; gap: 10px; }
      .ts-export-menu button:hover { background: var(--amber-dim); color: var(--amber); }
      .ts-export-menu button svg { flex-shrink: 0; opacity: 0.75; }
      .ts-export-menu button.ts-menu-salir { color: var(--red); }
      .ts-export-menu button.ts-menu-salir:hover { background: var(--red-dim); color: var(--red); }
      .ts-export-menu button:hover svg { opacity: 1; }
      .ts-btn {
        background: var(--amber);
        color: #ffffff;
        border: none;
        font-weight: 700;
        padding: 9px 16px;
        border-radius: 3px;
        cursor: pointer;
        font-size: calc(13px * var(--ts-escala-fuente, 1));
      }
      .ts-btn:hover { filter: brightness(1.08); }
      .ts-btn-ghost {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--text-dim);
        padding: 7px 12px;
        border-radius: 3px;
        cursor: pointer;
        font-size: calc(12.5px * var(--ts-escala-fuente, 1));
      }
      .ts-btn-mini {
        background: var(--panel-2);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 5px 10px;
        border-radius: 3px;
        font-size: calc(12px * var(--ts-escala-fuente, 1));
        cursor: pointer;
      }
      .ts-btn-mini-ok { border-color: #2c5c42; color: var(--green); }
      .ts-btn-mini-alerta { border-color: #5c2c28; color: var(--red); }
      .ts-acciones-fila { display: flex; gap: 6px; flex-wrap: wrap; }
      .ts-texto-dim { color: var(--text-dim); }

      .ts-btn-icono {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--panel-2);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 6px 12px;
        border-radius: 3px;
        font-size: calc(12.5px * var(--ts-escala-fuente, 1));
        font-weight: 600;
        cursor: pointer;
      }
      .ts-btn-icono:hover { border-color: var(--amber); color: var(--amber); }
      .ts-btn-icono-ok { border-color: #2c5c42; color: var(--green); }
      .ts-btn-icono:disabled { opacity: 0.45; cursor: not-allowed; }
      .ts-btn-icono-ok:hover { background: var(--green-dim); }

      input:disabled, select:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      /* Forms */
      .ts-form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 12px;
        margin-bottom: 12px;
      }
      .ts-campo { display: flex; flex-direction: column; gap: 5px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      .ts-campo-full { grid-column: 1 / -1; margin-bottom: 12px; }
      .ts-check { flex-direction: row; align-items: center; gap: 8px; }
      /* Aceites → Adición: verificaciones obligatorias */
      .ts-verificaciones { grid-column: span 2; display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); min-width: 0; }
      .ts-verificaciones-titulo { font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-bottom: 4px; }
      .ts-verificacion { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 6px 0; cursor: pointer; font-size: calc(13.5px * var(--ts-escala-fuente, 1)); color: var(--text); }
      .ts-verificacion + .ts-verificacion { border-top: 1px solid var(--border); }
      .ts-grid-verificaciones { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
      .ts-verificacion span { flex: 1; min-width: 0; }
      .ts-verificacion input { width: 18px !important; min-width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--amber); cursor: pointer; margin: 0; }
      .ts-verificaciones-aviso { border-color: var(--red); }
      .ts-verificaciones-error { color: var(--red); font-size: calc(12.5px * var(--ts-escala-fuente, 1)); margin-top: 4px; }
      /* Configuración → Almacenamiento */
      .ts-alm-medidores { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-bottom: 12px; }
      .ts-alm-medidor { border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; background: var(--panel); }
      .ts-alm-medidor-cab { display: flex; justify-content: space-between; align-items: baseline; color: var(--text); font-size: calc(13.5px * var(--ts-escala-fuente, 1)); margin-bottom: 8px; }
      .ts-alm-medidor-cab b { font-size: calc(18px * var(--ts-escala-fuente, 1)); font-weight: 600; font-variant-numeric: tabular-nums; }
      .ts-alm-barra { height: 10px; border-radius: 999px; background: var(--panel-2); overflow: hidden; }
      .ts-alm-barra-uso { height: 100%; border-radius: 999px; transition: width .4s ease; }
      .ts-alm-verde { background: var(--green); }
      .ts-alm-amarillo { background: var(--yellow); }
      .ts-alm-rojo { background: var(--red); }
      .ts-alm-medidor-pie { margin-top: 7px; color: var(--text-dim); font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-variant-numeric: tabular-nums; }
      .ts-alm-alerta { margin-top: 8px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-weight: 600; }
      .ts-alm-alerta-amarillo { color: #a67c00; }
      .ts-alm-alerta-rojo { color: var(--red); }
      .ts-alm-subtitulo { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); margin: 14px 0 8px; }
      .ts-alm-grafico { max-width: 760px; }
      .ts-alm-grafico svg { width: 100%; height: auto; display: block; }
      .ts-alm-rejilla { stroke: var(--border); stroke-width: 1; }
      .ts-alm-eje { fill: var(--text-dim); font-size: 10.5px; font-family: inherit; }
      .ts-alm-linea-base { fill: none; stroke: var(--blue); stroke-width: 2; }
      .ts-alm-linea-archivos { fill: none; stroke: var(--green); stroke-width: 2; }
      .ts-alm-punto-base { fill: var(--blue); }
      .ts-alm-leyenda { display: flex; gap: 16px; font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-top: 4px; }
      .ts-alm-leyenda i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 5px; }
      .ts-alm-ley-base { background: var(--blue); }
      .ts-alm-ley-archivos { background: var(--green); }
      .ts-alm-estimacion { margin-top: 8px; font-size: calc(13px * var(--ts-escala-fuente, 1)); color: var(--text); }
      .ts-alm-tablas { display: flex; flex-direction: column; gap: 6px; }
      .ts-alm-tabla { display: grid; grid-template-columns: minmax(120px, 170px) 1fr 72px 82px; align-items: center; gap: 10px; font-size: calc(13px * var(--ts-escala-fuente, 1)); color: var(--text); }
      .ts-alm-tabla-barra { height: 7px; background: var(--panel-2); border-radius: 999px; overflow: hidden; }
      .ts-alm-tabla-barra i { display: block; height: 100%; background: var(--blue); border-radius: 999px; opacity: .75; }
      .ts-alm-tabla-dato { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .ts-alm-error { padding: 10px 12px; border-radius: 6px; background: var(--red-dim); color: var(--red); font-size: calc(13px * var(--ts-escala-fuente, 1)); }
      @media (max-width: 600px) {
        .ts-alm-tabla { grid-template-columns: 1fr 64px 70px; }
        .ts-alm-tabla-barra { display: none; }
      }
      /* Configuración → Reportes: cajetín */
      .ts-cajetin-config { border-top: 1px solid var(--border); margin: 6px 0 14px; padding-top: 12px; }
      .ts-cajetin-titulo { font-size: calc(13.5px * var(--ts-escala-fuente, 1)); font-weight: 600; color: var(--text); margin-bottom: 10px; }
      .ts-cajetin-sub { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); margin: 4px 0 8px; }
      .ts-cajetin-previa { background: #fff; color: #1b1f24; border-radius: 4px; padding: 12px; margin-bottom: 14px; overflow-x: auto; border: 1px solid var(--border); }
      .ts-cajetin-previa table { width: 100%; min-width: 520px; border: 1px solid #d5d9df; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-family: "TS Doc", "Segoe UI", Inter, Roboto, Arial, sans-serif; }
      .ts-cajetin-previa td { padding: 8px 10px; vertical-align: middle; }
      .ts-cp-logo { text-align: center; border-right: 1px solid #e3e6ea; }
      .ts-cp-logo img { object-fit: contain; }
      .ts-cp-ini { margin: 0 auto; color: #fff; font-weight: 800; display: flex; align-items: center; justify-content: center; }
      .ts-cp-centro { text-align: center; }
      .ts-cp-doc { border-left: 1px solid #e3e6ea; }
      .ts-cp-doc div { display: flex; justify-content: space-between; gap: 8px; padding: 1.5px 0; white-space: nowrap; }
      .ts-cp-doc span { color: #6b7280; }
      .ts-form-grid-3 { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
      .ts-campo-px { display: flex; align-items: center; gap: 6px; }
      .ts-campo-px input { flex: 1; min-width: 0; }
      .ts-campo-px em { font-style: normal; color: var(--text-dim); font-size: calc(12px * var(--ts-escala-fuente, 1)); }
      .ts-config-reporte-opciones { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 4px 0 14px; }
      .ts-config-reporte-opciones .ts-check { font-size: calc(13px * var(--ts-escala-fuente, 1)); color: var(--text); }
      .ts-config-reporte-opciones input[type="checkbox"] { width: 16px; height: 16px; }
      .ts-form-acciones { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 4px; }

      .ts-chips-select { display: flex; flex-wrap: wrap; gap: 6px; }
      .ts-chip {
        background: var(--panel-2);
        border: 1px solid var(--border);
        color: var(--text-dim);
        padding: 6px 11px;
        border-radius: 3px;
        font-size: calc(12.5px * var(--ts-escala-fuente, 1));
        cursor: pointer;
      }
      .ts-chip-activo { border-color: var(--amber); color: var(--amber); background: var(--amber-dim); }
      .ts-campo-ayuda { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      /* Personal de apoyo: misma grilla que los campos del formulario, así el
         cuadro tiene exactamente el ancho y alto del campo "Grupo". */
      .ts-apoyo {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 12px; align-items: center; margin-top: 8px;
      }
      .ts-apoyo input { width: 100%; min-width: 0; box-sizing: border-box; height: var(--ts-alto-campo, 34px); }
      .ts-apoyo .ts-btn-icono { justify-self: start; height: var(--ts-alto-campo, 34px); }
      .ts-tiempo-calculado {
        background: var(--panel-2);
        border: 1px solid transparent;
        color: var(--amber);
        font-weight: 600;
        padding: 7px 9px;
        border-radius: 3px;
        font-size: calc(13px * var(--ts-escala-fuente, 1));
      }

      .ts-catalogo-form { display: flex; gap: 8px; margin-bottom: 14px; }

      /* Grupos de trabajo: renombrar en la cabecera y crear nuevos */
      .ts-acciones-grupo { display: flex; gap: 8px; align-items: center; }

      /* Ranking de equipos con más trabajos no programados (Inicio) */
      .ts-ranking { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
      .ts-ranking-fila {
        display: grid;
        grid-template-columns: 26px 60px 1fr 76px;
        align-items: center;
        gap: 10px;
        padding: 6px 4px;
        border-bottom: 1px dashed var(--border);
      }
      .ts-ranking-fila:last-child { border-bottom: none; }
      .ts-ranking-fila-clicable { cursor: pointer; border-radius: 6px; transition: background 0.12s; }
      .ts-ranking-fila-clicable:hover, .ts-ranking-fila-clicable:focus-visible { background: var(--panel-2); outline: none; }
      .ts-detalle-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px 16px; margin-bottom: 14px; }
      .ts-detalle-dato { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
      .ts-detalle-grid .ts-detalle-dato { margin-bottom: 0; }
      .ts-detalle-bloque { margin-top: 14px; }
      .ts-detalle-grid.ts-detalle-grid-req { grid-template-columns: repeat(6, minmax(0, 1fr)); }
      @media (max-width: 600px) { .ts-detalle-grid.ts-detalle-grid-req { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      .ts-detalle-dato > span { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.03em; }
      .ts-detalle-dato > div { font-size: calc(13.5px * var(--ts-escala-fuente, 1)); color: var(--text); }
      .ts-detalle-titulo { font-weight: 700; }
      .ts-detalle-texto { white-space: pre-wrap; line-height: 1.55; background: var(--panel-2); padding: 10px 12px; border-radius: 8px; }
      .ts-detalle-personal { display: flex; flex-wrap: wrap; gap: 6px; }
      .ts-chip-persona { padding: 4px 10px; border-radius: 999px; background: var(--amber-dim); color: var(--amber); font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-weight: 600; }
      .ts-cargar-mas {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        padding: 14px 0 4px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim);
      }
      .ts-cargar-mas-btn { min-width: 200px; font-weight: 600; color: var(--amber); }
      .ts-cargar-mas-fin { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); }
      .ts-detalle-rango { font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-bottom: 10px; }
      .ts-modal-form:has(.ts-tabla-detalle) { max-width: 760px; }
      .ts-tabla-detalle tfoot td { font-weight: 700; padding-top: 12px; border-bottom: none; }
      /* Celular: columna "Trabajo" del detalle del equipo (Inicio) más ancha */
      @media (max-width: 600px) {
        .ts-tabla-detalle th:last-child, .ts-tabla-detalle td:last-child { min-width: 340px; }
        .ts-tabla-detalle td:last-child .ts-clamp-2 { word-break: normal; overflow-wrap: break-word; }
      }
      .ts-detalle-kpis { display: flex; flex-direction: column; gap: 4px; }
      .ts-ranking-puesto {
        width: 22px; height: 22px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: calc(11.5px * var(--ts-escala-fuente, 1)); font-weight: 700;
        background: var(--panel-2); color: var(--text-dim);
      }
      .ts-ranking-puesto-top { background: var(--red-dim); color: var(--red); }
      .ts-ranking-equipo { font-family: var(--mono, monospace); font-weight: 600; }
      .ts-ranking-barra { height: 8px; background: var(--panel-2); border-radius: 4px; overflow: hidden; }
      .ts-ranking-barra span { display: block; height: 100%; background: var(--red); opacity: 0.75; border-radius: 4px; }
      .ts-ranking-cantidad { font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); white-space: nowrap; text-align: right; }
      .ts-ranking-fila-litros { grid-template-columns: 26px 60px 1fr 132px; }
      .ts-ranking-litros { display: inline-block; min-width: 46px; margin-left: 8px; font-weight: 600; color: var(--text); font-family: var(--mono, monospace); }

      /* Flotas (Configuración → Flotas y equipos) */
      .ts-flotas { margin-bottom: 14px; }
      .ts-flotas-titulo { font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-bottom: 6px; }
      .ts-flotas-lista { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .ts-flota-chip {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 6px 6px 12px;
        background: var(--panel-2);
        border-radius: 8px;
      }
      .ts-flota-nombre { font-weight: 600; font-size: calc(13px * var(--ts-escala-fuente, 1)); }
      .ts-flota-cantidad { font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      .ts-flota-editar {
        display: flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border: none; border-radius: 6px;
        background: transparent; color: var(--text-dim); cursor: pointer;
      }
      .ts-flota-editar:hover { background: var(--amber-dim); color: var(--amber); }
      .ts-flota-chip-editando { padding: 4px; gap: 6px; }
      .ts-flota-chip-editando input { width: 160px; padding: 6px 9px; font-weight: 600; background: var(--panel); }
      .ts-flota-nueva {
        padding: 8px 12px; border: 1.5px dashed var(--border); border-radius: 8px;
        background: transparent; color: var(--amber); font: inherit; font-size: calc(13px * var(--ts-escala-fuente, 1)); font-weight: 600; cursor: pointer;
      }
      .ts-flota-nueva:hover { border-color: var(--amber); background: var(--amber-dim); }
      .ts-flota-chip-inactiva { opacity: 0.6; }
      .ts-badge-neutro { background: var(--panel); color: var(--text-dim); }
      .ts-btn-icono-alerta { color: var(--red); }
      .ts-btn-icono-alerta:hover { background: var(--red-dim); }
      .ts-flotas-aviso {
        margin-top: 8px; display: inline-block;
        padding: 6px 10px; border-radius: 6px;
        background: var(--green-dim); color: var(--green);
        font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-weight: 600;
      }
      .ts-renombrar-grupo { display: flex; gap: 6px; align-items: center; }
      .ts-renombrar-grupo input { width: 180px; padding: 6px 9px; font-weight: 600; }
      .ts-input-error { border-color: var(--red) !important; }
      .ts-aviso-flotante {
        position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 10000;
        max-width: min(92vw, 520px); background: #1b1f24; color: #fff; padding: 10px 16px;
        font-size: calc(13px * var(--ts-escala-fuente, 1)); line-height: 1.4; box-shadow: 0 8px 24px rgba(0,0,0,.25);
        cursor: pointer;
      }
      @media (min-width: 900px) { .ts-aviso-flotante { bottom: 28px; } }
      .ts-aviso-usuario {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        margin: 8px 0 10px; padding: 9px 12px; border-radius: 8px;
        background: rgba(245, 181, 10, 0.14); color: var(--text);
        font-size: calc(12.5px * var(--ts-escala-fuente, 1)); line-height: 1.4;
      }
      .ts-aviso-usuario span { flex: 1; min-width: 200px; }
      .ts-fila-aviso td { white-space: normal !important; overflow: visible !important; padding-top: 0; }
      .ts-error-texto { font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--red); }
      .ts-nuevo-grupo-btn {
        width: 100%;
        padding: 13px 16px;
        border: 1.5px dashed var(--border);
        border-radius: 3px;
        background: transparent;
        color: var(--amber);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        text-align: left;
      }
      .ts-nuevo-grupo-btn:hover { background: var(--amber-dim); border-color: var(--amber); }
      .ts-nuevo-grupo-form { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
      .ts-nuevo-grupo-form input { max-width: 320px; }
      .ts-opciones-alcance { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; margin-top: 2px; }
      .ts-opcion-alcance {
        display: flex; align-items: flex-start; gap: 10px; text-align: left;
        padding: 10px 12px; border-radius: 8px; cursor: pointer;
        background: var(--panel-2); border: 1.5px solid transparent; color: var(--text); font: inherit;
      }
      .ts-opcion-alcance strong { display: block; font-size: calc(13px * var(--ts-escala-fuente, 1)); }
      .ts-opcion-alcance small { display: block; font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin-top: 2px; }
      .ts-opcion-alcance-activa { border-color: var(--amber); background: var(--amber-dim); }
      .ts-opcion-alcance-radio {
        width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--text-dim);
        flex-shrink: 0; margin-top: 2px; position: relative;
      }
      .ts-opcion-alcance-activa .ts-opcion-alcance-radio { border-color: var(--amber); }
      .ts-opcion-alcance-activa .ts-opcion-alcance-radio::after {
        content: ""; position: absolute; inset: 2.5px; border-radius: 50%; background: var(--amber);
      }
      .ts-nuevo-grupo-form .ts-form-acciones { display: flex; gap: 8px; justify-content: flex-end; }
      .ts-catalogo-form input { flex: 1; }

      /* Barra de navegación inferior (solo vista móvil) */
      .ts-bottom-nav {
        display: none;
        justify-content: space-around;
        position: fixed;
        left: 0; right: 0; bottom: 0;
        background: var(--sidebar-bg);
        border-top: 1px solid var(--sidebar-border);
        padding: 8px 2px calc(8px + env(safe-area-inset-bottom, 0px));
        z-index: 30;
      }
      .ts-bottom-nav-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: 0;
        background: transparent;
        border: none;
        color: var(--sidebar-text-dim);
        padding: 2px 1px;
        cursor: pointer;
        border-radius: 4px;
      }
      /* Estilo tipo Android: ícono dentro de una "píldora" que se resalta en
         la opción activa, y texto debajo. */
      .ts-bottom-nav-icono {
        display: flex; align-items: center; justify-content: center;
        width: 56px; height: 30px;
        border-radius: 16px;
        transition: background 0.15s, color 0.15s;
      }
      .ts-bottom-nav-icono svg { width: 23px; height: 23px; }
      .ts-bottom-nav-texto {
        font-size: calc(11.5px * var(--ts-escala-fuente, 1)); font-weight: 500; line-height: 1.1; text-align: center;
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ts-bottom-nav-item-activo .ts-bottom-nav-icono { background: var(--amber-dim); color: var(--amber); }
      .ts-bottom-nav-item-activo .ts-bottom-nav-texto { color: var(--sidebar-text); font-weight: 700; }
      /* Muchas opciones: la barra se desliza de lado (sin barra visible) */
      .ts-bottom-nav-desliza { justify-content: flex-start; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; }
      .ts-bottom-nav-desliza::-webkit-scrollbar { display: none; }
      .ts-bottom-nav-desliza .ts-bottom-nav-item { flex: 1 0 auto; min-width: 72px; padding: 2px 6px; scroll-snap-align: center; }
      .ts-bottom-nav-desliza .ts-bottom-nav-texto { overflow: visible; text-overflow: clip; }

      /* ---- Carga de Excel (Componentes y Almacén) ---- */
      .ts-btn-excel { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
      .ts-btn-excel svg { color: #1f7a45; }
      .ts-imp-meta { font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); white-space: nowrap; }
      .ts-imp-dialogo { max-width: 460px; }
      .ts-imp-archivo {
        display: flex; align-items: center; gap: 8px; margin: 2px 0 8px; padding: 8px 10px;
        background: var(--panel-2); border-radius: 8px; font-size: calc(13px * var(--ts-escala-fuente, 1)); font-weight: 600;
        overflow: hidden;
      }
      .ts-imp-archivo span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ts-imp-archivo svg { color: #1f7a45; flex-shrink: 0; }
      .ts-imp-aviso { margin: 6px 0; padding: 8px 10px; border-radius: 8px; background: var(--yellow-dim); color: var(--yellow); font-size: calc(12.5px * var(--ts-escala-fuente, 1)); }
      .ts-imp-progreso { height: 6px; border-radius: 6px; background: var(--panel-2); overflow: hidden; margin: 10px 0 4px; }
      .ts-imp-progreso > div { height: 100%; background: var(--amber); transition: width 0.2s; }

      /* Chips deslizables (modelos, equipos, flotas) */
      .ts-chips-desliza { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; min-width: 0; }
      .ts-chips-desliza::-webkit-scrollbar { display: none; }
      .ts-chips-desliza .ts-chip { flex-shrink: 0; border-radius: 999px; padding: 6px 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
      .ts-chip-n { font-size: calc(11px * var(--ts-escala-fuente, 1)); opacity: 0.75; font-weight: 600; }
      .ts-chip-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

      /* ---- Componentes ---- */
      .ts-comp-acciones { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
      .ts-comp-barra { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
      .ts-comp-barra .ts-segmento { flex-shrink: 0; }
      /* Sin barra de desplazamiento vertical: se ven todas las filas */
      .ts-comp-tabla-wrap { overflow-x: auto; overflow-y: visible; border: 1px solid var(--border); border-radius: 0; }
      .ts-comp-tabla { border-collapse: separate; border-spacing: 0; width: max-content; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); }
      .ts-comp-tabla thead th:not(.ts-comp-col-nombre) { width: 84px; min-width: 84px; }
      .ts-comp-tabla-wrap { width: fit-content; max-width: 100%; }
      /* Filas de alto fijo: la tabla y la gráfica quedan alineadas */
      .ts-comp-tabla th, .ts-comp-tabla td { padding: 0 10px; height: 33px; box-sizing: border-box; border-bottom: 1px solid var(--border); white-space: nowrap; }
      .ts-comp-tabla thead th { height: 40px; }
      .ts-comp-tabla thead th { background: var(--panel); text-align: right; font-weight: 600; color: var(--text-dim); }
      .ts-comp-tabla td { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; background: var(--panel); }
      /* Vida del componente (27 000 h): verde < 60 %, amarillo 60–90 %, rojo ≥ 90 % */
      :root { --ts-vida-verde: #2f9e44; --ts-vida-amarillo: #f5c518; --ts-vida-rojo: #e03131; }
      .ts-comp-tabla td.ts-vida-verde { background: var(--green-dim); color: var(--green); }
      .ts-comp-tabla td.ts-vida-amarillo { background: var(--yellow-dim); color: var(--yellow); font-weight: 600; }
      .ts-comp-tabla td.ts-vida-rojo { background: var(--red-dim); color: var(--red); font-weight: 700; }
      .ts-vida-barra-verde { background: var(--ts-vida-verde) !important; }
      .ts-vida-barra-amarillo { background: var(--ts-vida-amarillo) !important; }
      .ts-vida-barra-rojo { background: var(--ts-vida-rojo) !important; }
      .ts-vida-texto-verde { color: var(--ts-vida-verde); }
      .ts-vida-texto-amarillo { color: #b58900; }
      .ts-vida-texto-rojo { color: var(--ts-vida-rojo); }
      .ts-comp-tabla .ts-comp-col-nombre { position: sticky; left: 0; z-index: 1; background: var(--panel); text-align: left; font-weight: 600; color: var(--text);
        border-right: 1px solid var(--border); min-width: 170px; }
      .ts-comp-tabla thead .ts-comp-col-nombre { z-index: 3; color: var(--text-dim); }
      .ts-comp-tabla tbody tr:hover .ts-comp-col-nombre { background: var(--panel-2); }
      .ts-comp-tabla tbody tr:last-child th, .ts-comp-tabla tbody tr:last-child td { border-bottom: none; }
      .ts-comp-vacio { color: var(--text-dim); text-align: center !important; background: var(--panel) !important; }
      .ts-comp-equipo-btn {
        background: none; border: none; font: inherit; color: var(--text); font-weight: 700; cursor: pointer; padding: 2px 4px; border-radius: 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .ts-comp-equipo-btn:hover { background: var(--panel-2); text-decoration: underline; }
      .ts-comp-leyenda { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; font-size: calc(11.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      .ts-comp-leyenda-escala { width: 54px; height: 10px; border-radius: 3px; background: linear-gradient(90deg, color-mix(in srgb, #ef8a17 5%, var(--panel)), color-mix(in srgb, #ef8a17 43%, var(--panel))); border: 1px solid var(--border); }
      .ts-comp-leyenda-vacio { margin-left: 10px; font-weight: 700; }
      .ts-comp-equipos { margin-bottom: 12px; }
      .ts-comp-ficha { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
      /* Tabla a la izquierda y gráfica del equipo elegido a la derecha */
      .ts-comp-layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(420px, 1fr); gap: 16px; align-items: start; }
      @media (max-width: 1100px) { .ts-comp-layout { grid-template-columns: 1fr; } }
      .ts-comp-grafica { position: relative; border: 1px solid var(--border); }
      .ts-comp-tabla-grafica { width: 100%; table-layout: fixed; }
      .ts-comp-tabla-grafica tbody tr { cursor: pointer; }
      .ts-comp-tabla-grafica tbody tr:hover > * { background: var(--panel-2); }
      .ts-comp-tabla-grafica .ts-comp-g-nombre { width: 150px; text-align: left; position: static; border-right: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .ts-comp-tabla-grafica thead .ts-comp-g-nombre, .ts-comp-tabla-grafica thead .ts-comp-g-horas { font-size: calc(11px * var(--ts-escala-fuente, 1)); text-transform: uppercase; letter-spacing: 0.04em; }
      .ts-comp-tabla-grafica thead .ts-comp-g-equipo { text-align: center; color: var(--text); overflow: hidden; text-overflow: ellipsis; }
      .ts-comp-g-equipo b { font-weight: 700; margin-right: 8px; }
      .ts-comp-g-equipo span { font-weight: 400; color: var(--text-dim); font-size: calc(12px * var(--ts-escala-fuente, 1)); }
      .ts-comp-tabla-grafica .ts-comp-g-horas { width: 92px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 600; }
      .ts-comp-tabla-grafica td.ts-comp-g-barra { background: var(--panel); }
      .ts-comp-g-barra .ts-comp-barra-fondo { display: block; }
      .ts-comp-tabla-grafica tr.ts-comp-g-sel > * { background: var(--panel-2); font-weight: 800; }
      .ts-comp-tabla-grafica tr.ts-comp-g-sel .ts-comp-barra-fondo { box-shadow: 0 0 0 2px var(--panel), 0 0 0 3px var(--text-dim); }
      .ts-comp-tabla td.ts-comp-celda-sel { outline: 2px solid var(--text); outline-offset: -2px; }
      .ts-comp-cuadro {
        position: absolute; left: 50%; transform: translateX(-50%); z-index: 5; min-width: 220px;
        background: var(--panel); border: 1px solid var(--border); box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
        padding: 10px 14px; display: flex; flex-direction: column; gap: 2px; cursor: pointer;
      }
      .ts-comp-cuadro b { font-size: calc(13px * var(--ts-escala-fuente, 1)); }
      .ts-comp-cuadro span { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: calc(15px * var(--ts-escala-fuente, 1)); font-weight: 700; }
      .ts-comp-tabla td { cursor: pointer; }
      /* Equipo elegido: columna resaltada suavemente */
      .ts-comp-tabla thead th.ts-comp-sel { background: var(--panel-2); }
      .ts-comp-tabla th.ts-comp-sel .ts-comp-equipo-btn { text-decoration: underline; }
      .ts-comp-tabla td.ts-comp-sel { filter: brightness(0.93) saturate(1.15); font-weight: 700; }
      .ts-comp-ficha-cab { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
      .ts-comp-ficha-equipo { font-size: calc(14px * var(--ts-escala-fuente, 1)); font-weight: 700; }
      .ts-comp-ficha-sub { color: var(--text-dim); font-size: calc(12.5px * var(--ts-escala-fuente, 1)); margin-top: 2px; }
      .ts-comp-ficha-resumen { font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
      .ts-comp-ficha-resumen b { color: var(--text); }
      .ts-comp-lista { padding: 0 16px 8px; }
      .ts-comp-fila { display: grid; grid-template-columns: minmax(120px, 160px) minmax(60px, 1fr) 80px; align-items: center; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border); }
      .ts-comp-fila-cab { padding: 10px 0 8px; }
      .ts-comp-fila-cab span { font-size: calc(11px * var(--ts-escala-fuente, 1)); text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); font-weight: 600; }
      .ts-comp-fila-cab span:nth-child(3) { text-align: right; }
      .ts-comp-fila-pct { text-align: right; font-weight: 700; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-variant-numeric: tabular-nums; }
      .ts-comp-fila:last-child { border-bottom: none; }
      .ts-comp-fila-nombre { font-weight: 600; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); }
      .ts-comp-barra-fondo { height: 10px; background: var(--panel-2); overflow: hidden; }
      .ts-comp-barra-relleno { display: block; height: 100%; }
      .ts-comp-fila-horas { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-weight: 600; }
      .ts-comp-fila-vacia .ts-comp-fila-nombre, .ts-comp-fila-vacia .ts-comp-fila-horas { color: var(--text-dim); font-weight: 500; }

      /* ---- Engrase ---- */
      .ts-eng-resumen { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .ts-eng-kpi { font: inherit; color: var(--text); text-align: left; cursor: pointer; transition: background 0.15s, box-shadow 0.15s; }
      .ts-eng-kpi:hover { background: var(--panel-2); }
      .ts-eng-kpi.activo { background: var(--panel-2); box-shadow: inset 0 0 0 1px var(--text-dim); }
      .ts-kpi-aviso { border-top-color: var(--yellow); }

      /* Filtro de Componentes: solo Modelo y Equipo, sin espacio vacío */
      .ts-filtros-popover:has(.ts-filtros-dos) { width: min(460px, calc(100vw - 40px)); }
      .ts-filtros-popover .ts-filtros-dos { grid-template-columns: 1fr 1fr; }
      .ts-eng-inicio { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 20px; }
      .ts-eng-inicio-tabla { table-layout: fixed; }
      .ts-eng-inicio-tabla th:nth-child(1) { width: 18%; }
      .ts-eng-inicio-tabla th:nth-child(2) { width: 30%; }
      .ts-eng-inicio-tabla th:nth-child(3) { width: 30%; }
      .ts-eng-inicio-tabla th:nth-child(4) { width: 22%; }
      .ts-eng-inicio-tabla tbody tr { cursor: pointer; }
      .ts-badge-aviso-eng { background: var(--yellow-dim); color: var(--yellow); }
      .ts-badge-neutro-eng { background: var(--panel-2); color: var(--text); }
      .ts-eng-flotas { align-self: flex-start; overflow-x: auto; scrollbar-width: none; }
      .ts-eng-flotas .ts-segmento-op { white-space: nowrap; }
      .ts-eng-frec {
        background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 3px 8px; margin-left: -8px;
        font: inherit; color: var(--text); cursor: pointer; white-space: nowrap;
      }
      .ts-eng-frec:hover { border-color: var(--border); background: var(--panel-2); }
      .ts-eng-frec.vacia { color: var(--text-dim); border: 1px dashed var(--border); margin-left: 0; font-size: calc(12px * var(--ts-escala-fuente, 1)); }
      .ts-eng-grupo + .ts-eng-grupo { margin-top: 18px; }
      .ts-eng-grupo-titulo { display: flex; align-items: center; gap: 8px; font-size: calc(12px * var(--ts-escala-fuente, 1)); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 6px; }
      .ts-eng-grupo-titulo span { background: var(--panel-2); border-radius: 999px; padding: 1px 8px; font-size: calc(11px * var(--ts-escala-fuente, 1)); }
      /* Anchos proporcionales: Comentario se queda con lo que sobra, sin exagerar */
      .ts-eng-tabla { table-layout: fixed; width: 100%; min-width: 960px; }
      .ts-eng-tabla th:nth-child(1) { width: 8%; }
      .ts-eng-tabla th:nth-child(2) { width: 9%; }
      .ts-eng-tabla th:nth-child(3) { width: 13%; }
      .ts-eng-tabla th:nth-child(4) { width: 13%; }
      .ts-eng-tabla th:nth-child(5) { width: 14%; }
      .ts-eng-tabla th:nth-child(6) { width: 13%; }
      .ts-eng-tabla th:nth-child(7) { width: 11%; }
      .ts-eng-tabla th:nth-child(8) { width: 11%; }
      .ts-eng-tabla th:nth-child(9) { width: 8%; }
      .ts-eng-equipo { font-weight: 700; }
      .ts-eng-accion { text-align: right; }
      .ts-fila-click { cursor: pointer; }
      .ts-eng-dias { display: inline-flex; align-items: center; gap: 6px; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); font-weight: 600; white-space: nowrap; }
      .ts-eng-dias::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
      .ts-eng-dias-ok { color: var(--green); }
      .ts-eng-dias-aviso { color: var(--yellow); }
      .ts-eng-dias-alerta { color: var(--red); }
      .ts-eng-dias-neutro { color: var(--text-dim); }
      .ts-eng-dias-nunca { color: var(--red); background: var(--red-dim); padding: 2px 8px; border-radius: 999px; }
      .ts-eng-dias-nunca::before { display: none; }
      /* Ocupa dos columnas del formulario: cada opción mide lo mismo que "Equipo" */
      .ts-eng-resultado-campo { grid-column: span 2; }
      .ts-eng-resultado { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; row-gap: 8px; }
      .ts-eng-resultado button {
        height: 34px; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 6px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text-dim);
        font: inherit; font-size: calc(13px * var(--ts-escala-fuente, 1)); font-weight: 600; cursor: pointer; text-align: center; line-height: 1.2;
      }
      .ts-eng-resultado button.activo.ok { border-color: var(--green); background: var(--green-dim); color: var(--green); }
      .ts-eng-resultado button.activo.falla { border-color: var(--red); background: var(--red-dim); color: var(--red); }
      .ts-eng-hist-cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
      .ts-eng-hist-cab > div { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ts-eng-hist { position: relative; padding-left: 4px; }
      .ts-eng-hist-item { display: grid; grid-template-columns: 18px 1fr; gap: 10px; position: relative; padding-bottom: 14px; }
      .ts-eng-hist-item::before { content: ""; position: absolute; left: 6px; top: 16px; bottom: 0; width: 2px; background: var(--border); }
      .ts-eng-hist-item:last-child::before { display: none; }
      .ts-eng-hist-punto { width: 14px; height: 14px; border-radius: 50%; background: var(--green); margin-top: 3px; box-shadow: 0 0 0 3px var(--green-dim); }
      .ts-eng-hist-item.falla .ts-eng-hist-punto { background: var(--red); box-shadow: 0 0 0 3px var(--red-dim); }
      .ts-eng-hist-linea { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: calc(13px * var(--ts-escala-fuente, 1)); }
      .ts-eng-hist-texto { margin-top: 4px; font-size: calc(13px * var(--ts-escala-fuente, 1)); }
      .ts-eng-hist-rep { margin-top: 4px; font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--green); }
      .ts-eng-hist-botones { display: flex; gap: 8px; margin-top: 8px; }
      .ts-btn-peligro { background: var(--red) !important; border-color: var(--red) !important; color: #fff !important; }

      /* ---- Almacén ---- */
      /* Buscador: mismo estilo que los campos del registro de trabajo (sin borde negro) */
      .ts-alm-buscar { display: flex; align-items: center; gap: 8px; padding: 0 12px; border: none; border-radius: 0; background: var(--panel-2); }
      .ts-alm-buscar svg { color: var(--text-dim); flex-shrink: 0; }
      .ts-alm-buscar input, .ts-alm-buscar input:focus, .ts-alm-buscar input:focus-visible { flex: 1; border: none !important; outline: none !important; background: transparent !important; padding: 9px 0 !important;
        font-size: calc(14px * var(--ts-escala-fuente, 1)); font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: var(--text); box-shadow: none !important; min-width: 0; }
      /* Cuadro de almacén más angosto */
      .ts-modal-form:has(.ts-alm-buscar) { max-width: 820px; }
      .ts-alm-buscar input::placeholder { text-transform: none; font-weight: 500; letter-spacing: 0; }
      .ts-alm-meta { font-size: calc(12px * var(--ts-escala-fuente, 1)); color: var(--text-dim); margin: 6px 2px 12px; min-height: 16px; }
      .ts-alm-ayuda { color: var(--text-dim); font-size: calc(13px * var(--ts-escala-fuente, 1)); padding: 8px 2px; }
      .ts-alm-resultados { display: flex; flex-direction: column; gap: 12px; }
      .ts-alm-ficha { border: 1px solid var(--border); border-radius: 0; overflow: hidden; background: var(--panel); }
      .ts-alm-ficha-cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 12px 16px; }
      .ts-alm-ficha-np { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: calc(17px * var(--ts-escala-fuente, 1)); font-weight: 700; }
      .ts-alm-ficha-desc { color: var(--text-dim); font-size: calc(12.5px * var(--ts-escala-fuente, 1)); margin-top: 2px; }
      .ts-alm-stock { flex-shrink: 0; font-size: calc(12px * var(--ts-escala-fuente, 1)); font-weight: 700; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
      .ts-alm-stock.ok { background: var(--green-dim); color: var(--green); }
      .ts-alm-stock.no { background: var(--red-dim); color: var(--red); }
      .ts-alm-datos { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .ts-alm-dato { padding: 10px 16px; border-top: 1px solid var(--border); border-right: 1px solid var(--border); min-width: 0; }
      .ts-alm-dato:nth-child(4n) { border-right: none; }
      .ts-alm-dato > span {
        display: block; font-size: calc(11px * var(--ts-escala-fuente, 1)); text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim);
        font-weight: 600; margin-bottom: 3px; font-family: var(--app-font-family, Inter, -apple-system, "Segoe UI", Roboto, sans-serif);
      }
      .ts-alm-dato b { font-weight: 600; font-size: calc(13.5px * var(--ts-escala-fuente, 1)); overflow-wrap: anywhere; }
      .ts-alm-dato.ts-mono b { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .ts-alm-dato-clave b { font-size: calc(17px * var(--ts-escala-fuente, 1)); font-weight: 800; }
      .ts-alm-lista { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 0; overflow: hidden; }
      .ts-alm-fila { display: grid; grid-template-columns: 120px 1fr auto; gap: 12px; align-items: center; text-align: left; padding: 10px 14px; background: var(--panel); border: none; border-bottom: 1px solid var(--border); color: var(--text); font: inherit; cursor: pointer; }
      .ts-alm-fila:last-child { border-bottom: none; }
      .ts-alm-fila:hover { background: var(--panel-2); }
      .ts-alm-fila-np { font-weight: 700; }
      .ts-alm-fila-desc { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: calc(13px * var(--ts-escala-fuente, 1)); }
      .ts-alm-fila-disp { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 700; padding: 2px 9px; border-radius: 999px; font-size: calc(12px * var(--ts-escala-fuente, 1)); }
      .ts-alm-fila-disp.ok { background: var(--green-dim); color: var(--green); }
      .ts-alm-fila-disp.no { background: var(--red-dim); color: var(--red); }



      @media (max-width: 720px) {
        .ts-comp-tabla-grafica .ts-comp-g-nombre { width: 120px; }
        .ts-comp-g-equipo span { display: none; }
        .ts-comp-fila { grid-template-columns: minmax(0, 1fr) 76px; gap: 4px 10px; }
        .ts-comp-fila .ts-comp-barra-fondo { grid-column: 1 / -1; grid-row: 2; }
        .ts-comp-fila-cab span:nth-child(2) { display: none; }
        .ts-comp-layout { grid-template-columns: 1fr; }
        .ts-comp-acciones { justify-content: flex-start; }
        .ts-eng-resumen { grid-template-columns: 1fr 1fr; }
        .ts-eng-inicio { grid-template-columns: 1fr; }
        /* Engrase en celular: cada equipo como tarjeta */
        .ts-eng-tabla { min-width: 0; table-layout: auto; }
        .ts-eng-tabla thead { display: none; }
        .ts-eng-tabla, .ts-eng-tabla tbody { display: block; }
        .ts-eng-tabla tr { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 10px; padding: 10px 2px; border-bottom: 1px solid var(--border); align-items: center; }
        .ts-eng-tabla td { display: block; padding: 0 !important; border: none !important; }
        .ts-eng-tabla td[data-label="Equipo"] { grid-column: 1; grid-row: 1; font-size: calc(15px * var(--ts-escala-fuente, 1)); }
        .ts-eng-tabla td[data-label="Modelo"] { grid-column: 2; grid-row: 1; color: var(--text-dim); font-size: calc(12px * var(--ts-escala-fuente, 1)); }
        .ts-eng-tabla td.ts-eng-accion { grid-column: 3; grid-row: 1 / span 2; }
        .ts-eng-tabla td[data-label="Tiempo"] { grid-column: 1 / span 2; grid-row: 2; }
        .ts-eng-tabla td[data-label="Última"] { display: none; }
        .ts-eng-tabla td[data-label="Estado"] { grid-column: 1 / -1; grid-row: 3; }
        .ts-eng-tabla td[data-label="Estado"] .ts-texto-dim { display: none; }
        .ts-eng-tabla td[data-label="Comentario"] { grid-column: 1 / -1; grid-row: 4; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); color: var(--text-dim); }
        .ts-eng-tabla td[data-label="Comentario"] .ts-texto-dim { display: none; }

        .ts-eng-resultado-campo { grid-column: 1 / -1; }
        .ts-eng-resultado { grid-template-columns: 1fr; }
        .ts-eng-tabla td[data-label="Frecuencia"] { grid-column: 1 / -1; grid-row: 5; font-size: calc(12.5px * var(--ts-escala-fuente, 1)); }
        .ts-eng-tabla td[data-label="Frecuencia"]::before { content: "Frecuencia: "; color: var(--text-dim); }
        .ts-eng-tabla td[data-label="Personal"] { display: none; }
        .ts-alm-datos { grid-template-columns: 1fr 1fr; }
        .ts-alm-dato:nth-child(4n) { border-right: 1px solid var(--border); }
        .ts-alm-dato:nth-child(2n) { border-right: none; }
        .ts-alm-ficha-cab { flex-direction: column; }
        .ts-alm-fila { grid-template-columns: 1fr auto; }
        .ts-alm-fila-desc { grid-column: 1 / -1; grid-row: 2; }
      }

      @media (max-width: 720px) {
        .ts-root { grid-template-columns: 1fr; }
        .ts-sidebar { display: none; }
        .ts-bottom-nav { display: flex; }
        .ts-content-con-nav-inferior { padding-bottom: calc(170px + env(safe-area-inset-bottom, 0px)); }

        /* Botones flotantes en celular: por encima de la barra de navegación inferior. */
        .ts-accion-row-split { right: 16px; bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
        .ts-topbar {
          padding: 14px 16px; padding-top: calc(14px + env(safe-area-inset-top, 0px));
          background: var(--sidebar-bg); color: var(--sidebar-text); border-bottom-color: var(--sidebar-border);
        }
        .ts-topbar-title { color: var(--sidebar-text); }
        .ts-topbar .ts-btn-tres-puntos, .ts-topbar .ts-btn-buscar { color: var(--sidebar-text-dim); }
        .ts-topbar .ts-filtros-resumen { background: var(--sidebar-hover); color: var(--sidebar-text-dim); }
        .ts-topbar .ts-filtros-resumen-activo { color: var(--sidebar-text); font-weight: 600; }
        .ts-topbar .ts-filtro-punto { background: var(--sidebar-text); box-shadow: 0 0 0 2px var(--sidebar-bg); }
        .ts-topbar .ts-btn-filtro-activo { background: var(--sidebar-hover); color: var(--sidebar-text); }
        .ts-topbar .ts-rol-movil { background: var(--sidebar-hover); color: var(--sidebar-text); border-color: var(--sidebar-border); }
        .ts-topbar-title { font-size: calc(17px * var(--ts-escala-fuente, 1)); }
        /* Íconos de la barra superior más grandes y fáciles de tocar */
        .ts-btn-tres-puntos { width: 40px; height: 40px; border-radius: 12px; }
        .ts-btn-tres-puntos svg { width: 22px; height: 22px; }
        .ts-topbar-acciones { gap: 4px; flex-shrink: 1; min-width: 0; }
        .ts-topbar-title { flex-shrink: 0; margin-right: 8px; }
        .ts-filtros-resumen { max-width: none; min-width: 0; flex-shrink: 1; font-size: calc(11.5px * var(--ts-escala-fuente, 1)); padding: 5px 10px; }
        .ts-filtro-punto { top: 7px; right: 7px; width: 8px; height: 8px; }
        .ts-rol-movil { display: block; width: auto; min-width: 0; max-width: 118px; font-size: calc(11.5px * var(--ts-escala-fuente, 1)); padding: 6px 8px; }

        /* Contenido más compacto en móvil */
        .ts-content { padding: 14px 12px 40px; }
        .ts-stack { gap: 14px; }

        .ts-filtros-popover { top: 56px; right: 12px; width: calc(100vw - 24px); max-height: calc(100vh - 140px); }
        .ts-filtros-popover .ts-filtros { grid-template-columns: 1fr 1fr; }

        /* Filtros: grilla de 2 columnas a todo el ancho */
        .ts-filtros { display: grid; grid-template-columns: 1fr 1fr; padding: 12px; gap: 10px; }
        .ts-filtro select, .ts-filtro input { min-width: 0; width: 100%; box-sizing: border-box; }

        /* Formularios: una columna, botones a todo el ancho */
        /* Formularios compactos en celular: dos columnas para campos cortos */
        .ts-form-grid, .ts-grid-verificaciones { grid-template-columns: 1fr 1fr; gap: 10px 10px; margin-bottom: 10px; }
        .ts-apoyo { grid-template-columns: 1fr 1fr; gap: 10px; }
        .ts-form-grid input, .ts-form-grid select, .ts-campo input, .ts-campo select {
          width: 100%; min-width: 0; box-sizing: border-box;
        }
        .ts-campo { gap: 3px; font-size: calc(11.5px * var(--ts-escala-fuente, 1)); }
        .ts-campo-full { margin-bottom: 10px; }
        .ts-modal-form .ts-panel-body { padding-top: 10px; }
        .ts-form-acciones { flex-wrap: wrap; }
        .ts-form-acciones .ts-btn, .ts-form-acciones .ts-btn-ghost { flex: 1 1 auto; }

        /* Tablas de datos convertidas en tarjetas apiladas */
        .ts-tabla-wrap:has(.ts-tabla-cards) { overflow-x: visible; }
        .ts-tabla.ts-tabla-cards { min-width: 0; table-layout: auto; }
        .ts-tabla-cards thead { display: none; }
        .ts-tabla-cards, .ts-tabla-cards tbody { display: block; width: 100%; }
        .ts-tabla-cards tbody tr {
          display: block;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 10px;
          background: var(--panel);
        }
        .ts-tabla-cards tbody tr:last-child { margin-bottom: 0; }
        .ts-tabla-cards.ts-tabla td,
        .ts-tabla-cards tbody tr:last-child td {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          width: auto !important;
          padding: 6px 0;
          border-bottom: 1px dashed var(--border);
          text-align: right;
        }
        .ts-tabla-cards.ts-tabla td:last-child { border-bottom: none; }
        .ts-tabla-cards td::before {
          content: attr(data-label);
          flex-shrink: 0;
          font-weight: 600;
          font-size: calc(12px * var(--ts-escala-fuente, 1));
          color: var(--text-dim);
          text-align: left;
          font-family: var(--app-font-family);
        }
        .ts-tabla-cards td[data-label=""]::before { display: none; }
        .ts-tabla-cards.ts-tabla td[data-label=""] { justify-content: flex-end; }
        .ts-tabla-cards td .ts-clamp-2 { max-width: 70%; }
        .ts-tabla-cards td[colspan] { justify-content: center; text-align: center; }
        .ts-tabla-trabajos td:last-child .ts-acciones-fila { padding-left: 0; }

        /* Celdas editables dentro de tarjetas (Configuración) */
        .ts-tabla-cards td input, .ts-tabla-cards td select { max-width: 62%; width: 62% !important; }
        /* Cargo + grupo de destino apilados: el bloque ocupa el mismo ancho
           que los demás campos y cada select lo llena por completo. */
        .ts-tabla-cards td .ts-cargo-celda { width: 62%; }
        .ts-tabla-cards td .ts-cargo-celda select { width: 100% !important; max-width: 100%; }
        .ts-tabla-cards.ts-tabla td { overflow: visible; white-space: normal; }

        /* Roles y permisos: se mantiene como tabla con scroll horizontal */
        .ts-tabla-permisos { min-width: 520px; }
        /* Paneles de borde a borde: sin márgenes laterales ni marco doble,
           para que las tarjetas aprovechen todo el ancho de la pantalla. */
        .ts-content { padding-left: 0; padding-right: 0; }
        /* Espacio final para que los botones flotantes ("+" y Exportar,
           ~205 px sobre el borde inferior) no tapen el último registro:
           se puede desplazar hasta dejarlo por encima de ellos. */
        .ts-content.ts-content-con-nav-inferior { padding-bottom: calc(230px + env(safe-area-inset-bottom, 0px)); }

        /* Sin espacio entre la barra superior y el primer cuadro, y
           separación mínima entre cuadros, para ganar pantalla. */
        .ts-content { padding-top: 0; }
        .ts-stack { gap: 8px; }
        .ts-stack > .ts-panel:first-child { border-top: none; }
        .ts-stack > :first-child:not(.ts-panel):not(.ts-grid-2) { margin-top: 10px; }
        .ts-stack > :not(.ts-panel):not(.ts-grid-2):not(.ts-accion-row-split) { margin-left: 10px; margin-right: 10px; }
        .ts-panel { border-left: none; border-right: none; border-radius: 0; }
        .ts-panel-head { padding: 12px 12px; }
        .ts-panel-body { padding: 10px 8px 12px; }
        .ts-tabla-cards tbody tr { margin-bottom: 8px; }
        .ts-ocultar-movil { display: none; }
        /* Barras que se ocultan al deslizar hacia abajo */
        /* Barras superior e inferior con el color del panel izquierdo; al
           deslizar se vuelven transparentes (como Gmail) y el contenido se
           ve por debajo. */
        .ts-topbar, .ts-bottom-nav { transition: background-color 0.25s ease, border-color 0.25s ease, backdrop-filter 0.25s ease; }
        .ts-desplazado .ts-topbar,
        .ts-desplazado .ts-bottom-nav {
          background: color-mix(in srgb, var(--sidebar-bg) 55%, transparent);
          -webkit-backdrop-filter: blur(6px);
          backdrop-filter: blur(6px);
          border-color: transparent;
        }
        /* Deslizando hacia abajo: la barra inferior se oculta */
        .ts-bottom-nav, .ts-accion-row-split { transition: transform 0.22s ease, background-color 0.25s ease, border-color 0.25s ease; }
        .ts-barras-ocultas .ts-bottom-nav { transform: translateY(110%); }
        .ts-barras-ocultas .ts-accion-row-split { transform: translateY(72px); }
        /* La barra superior también se oculta al deslizar hacia abajo y vuelve
           (semitransparente) al deslizar hacia arriba. */
        .ts-topbar { transition: transform 0.22s ease, background-color 0.25s ease, border-color 0.25s ease; }
        .ts-barras-ocultas .ts-topbar { transform: translateY(-110%); }
        .ts-trabajos-movil { display: block; }
        .ts-aceites-movil { display: block; }
        .ts-req-movil { display: block; }
        .ts-req-tabla { display: none !important; }
        .ts-aceites-tabla { display: none; }
        .ts-trabajos-tabla { display: none; }
        /* Formularios a pantalla completa en celular */
        .ts-modal-form-fondo { padding: 0; margin: 0 !important; background: var(--panel); }
        .ts-modal-form { max-width: none; min-height: 100%; margin: 0; border-radius: 0; box-shadow: none; }
        .ts-modal-form > .ts-panel { border-radius: 0; min-height: 100%; }
        .ts-modal-form .ts-panel-head {
          position: sticky; top: 0; z-index: 1;
          background: var(--panel);
          padding-top: calc(12px + env(safe-area-inset-top, 0px));
        }
        .ts-modal-form-cerrar { position: fixed; top: calc(6px + env(safe-area-inset-top, 0px)); right: 8px; z-index: 81; }
        .ts-modal-editor { position: fixed; top: calc(12px + env(safe-area-inset-top, 0px)); right: 50px; z-index: 81; max-width: 46vw; }
        .ts-modal-con-editor .ts-panel-head { padding-right: calc(46vw + 56px); }
        .ts-modal-form .ts-panel-body { padding: 14px 14px calc(24px + env(safe-area-inset-bottom, 0px)); }
        .ts-renombrar-grupo input { width: 130px; }

        /* Trabajos e Historial en celular: cada tarjeta muestra solo Equipo,
           Trabajo y Estado (más los botones de acción). El detalle completo
           se ve al tocar la tarjeta para editar, al imprimir o en escritorio. */
        .ts-tabla-trabajos td:not([data-label="Equipo"]):not([data-label="Trabajo"]):not([data-label="Estado"]):not([data-label=""]),
        .ts-tabla-trabajos-amplia td:not([data-label="Equipo"]):not([data-label="Trabajo"]):not([data-label="Estado"]):not([data-label=""]) {
          display: none;
        }
      }

      /* Tablet: menú lateral más angosto */
      @media (min-width: 721px) and (max-width: 1024px) {
        .ts-root { grid-template-columns: 190px 1fr; }
        .ts-root.ts-lateral-contraido { grid-template-columns: 60px 1fr; }
        .ts-topbar { padding: 14px 16px; }
      }

      /* Computadora y tablet: contenido de borde a borde (sin márgenes
         alrededor de los cuadros), igual que en celular, para aprovechar
         todo el ancho y alto del monitor. */
      @media (min-width: 721px) {
        .ts-content { padding: 0 0 150px; }
        .ts-stack { gap: 8px; }
        .ts-grid-2 { gap: 8px; }
        .ts-panel { border-left: none; border-right: none; border-radius: 0; }
        .ts-stack > .ts-panel:first-child { border-top: none; }
        .ts-stack > :not(.ts-panel):not(.ts-grid-2):not(.ts-accion-row-split):not(.ts-modal-form-fondo) { margin-left: 8px; margin-right: 8px; }
        .ts-stack > :first-child:not(.ts-panel):not(.ts-grid-2) { margin-top: 8px; }
        .ts-kpi-band { gap: 8px; }
        /* Los formularios en ventana flotante conservan su marco redondeado */
        .ts-modal-form > .ts-panel { border-radius: 10px; }
      }
    `}</style>
  );
}
