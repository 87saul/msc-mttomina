// Capa de datos: todas las lecturas y escrituras a Supabase pasan por aquí.
import { supabase, correoDeUsuario } from "./supabase";

type Fila = Record<string, any>;

// Columnas reales de cada tabla. Cualquier otro dato del formulario se
// guarda en la columna "extra" (así no se pierde nada si el formulario crece).
const COLUMNAS: Record<string, string[]> = {
  trabajos: [
    "equipo", "flota", "tipo_trabajo", "sintoma_causa", "descripcion", "ubicacion", "fecha", "turno", "grupo",
    "hora_inicio", "hora_fin", "estado_final", "participantes", "observaciones", "marca", "creado_en", "editado_en",
  ],
  aceites: [
    "equipo", "flota", "tipo_trabajo", "fecha", "turno", "tipo_operacion", "ubicacion", "grupo", "tipo_aceite",
    "sistema_equipo", "cantidad_litros", "horometro", "hora_inicio", "hora_fin", "participantes", "observaciones",
    "creado_en", "editado_en",
  ],
  requerimientos: [
    "equipo", "flota", "numero_parte", "descripcion", "cantidad", "solicitante", "fecha_solicitud", "estado",
    "creado_en", "editado_en",
  ],
  equipos: ["codigo", "flota", "modelo", "descripcion", "activo"],
  tipos_aceite: ["nombre", "activo"],
  sistemas_equipo: ["nombre", "activo"],
  grupos_trabajo: ["id", "nombre", "alcance"],
};
const CON_EXTRA = ["trabajos", "aceites", "requerimientos"];
const FECHAS = ["fecha", "fecha_solicitud"];
const NUMEROS = ["cantidad_litros", "horometro", "cantidad", "grupo"];
const IGNORAR = ["id", "extra", "creado_por", "registrado"];

function aFila(tabla: string, obj: Fila): Fila {
  const columnas = COLUMNAS[tabla];
  const fila: Fila = {};
  const extra: Fila = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (columnas.includes(k)) {
      if (FECHAS.includes(k)) fila[k] = v ? v : null;
      else if (NUMEROS.includes(k)) fila[k] = v === "" || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v);
      else if (k === "participantes") fila[k] = Array.isArray(v) ? v : [];
      else fila[k] = v === undefined ? null : v;
    } else if (!IGNORAR.includes(k) && v !== undefined && typeof v !== "function") {
      extra[k] = v;
    }
  });
  if (tabla === "grupos_trabajo" && obj.id !== undefined) fila.id = obj.id;
  if (CON_EXTRA.includes(tabla) && Object.keys(extra).length) fila.extra = extra;
  return fila;
}

// Convierte una fila de la base de datos al formato que usa la app
// (textos vacíos en lugar de null, participantes como lista).
function desdeFila(fila: Fila): Fila {
  if (!fila) return fila;
  const { extra, creado_por, registrado, ...resto } = fila;
  const obj: Fila = { ...(extra || {}), ...resto };
  Object.keys(obj).forEach((k) => {
    if (obj[k] === null) obj[k] = k === "participantes" ? [] : k === "marca" ? null : "";
  });
  if (!Array.isArray(obj.participantes) && "participantes" in obj) obj.participantes = [];
  return obj;
}

function perfilDesdeFila(f: Fila) {
  const cat = f.categoria;
  return {
    id: f.id,
    nombre: f.nombre || "",
    usuario: f.usuario || "",
    rol: f.rol || "Técnico",
    cargo: f.cargo || "",
    categoria: cat !== null && cat !== undefined && /^\d+$/.test(String(cat)) ? Number(cat) : cat || "",
    flota_grupo: f.flota_grupo || "",
    activo: f.activo !== false,
    orden: f.orden || 0,
    contrasena: "",
  };
}

// Traduce los errores técnicos a mensajes simples.
export function mensajeError(e: any): string {
  const m = String(e?.message || e || "");
  if (/Invalid login credentials/i.test(m)) return "Usuario o contraseña incorrectos.";
  if (/banned/i.test(m)) return "Este usuario está inactivo. Consulta con el administrador.";
  if (/Email not confirmed/i.test(m)) return "La cuenta no está confirmada. Pide al administrador que la revise.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Sin conexión. Revisa tu internet e intenta de nuevo.";
  if (/row-level security|permission denied/i.test(m)) return "No tienes permiso para realizar esta acción.";
  if (/duplicate key.*codigo/i.test(m)) return "Ya existe un equipo con ese código.";
  if (/JWT|token/i.test(m)) return "Tu sesión expiró. Vuelve a iniciar sesión.";
  return m || "Ocurrió un error inesperado.";
}

async function revisar<T>(promesa: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await promesa;
  if (error) throw new Error(mensajeError(error));
  return data;
}

// Supabase entrega como máximo 1000 filas por consulta: se leen por partes.
async function leerTodo(tabla: string, orden = "registrado"): Promise<Fila[]> {
  const tam = 1000;
  let desde = 0;
  const todo: Fila[] = [];
  for (;;) {
    const parte = await revisar(
      supabase.from(tabla).select("*").order(orden, { ascending: true }).range(desde, desde + tam - 1)
    );
    todo.push(...(parte || []));
    if (!parte || parte.length < tam) break;
    desde += tam;
  }
  return todo;
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------
export async function iniciarSesion(usuario: string, contrasena: string): Promise<string | null> {
  if (!usuario.trim() || !contrasena) return "Escribe tu usuario y contraseña.";
  const { error } = await supabase.auth.signInWithPassword({ email: correoDeUsuario(usuario), password: contrasena });
  return error ? mensajeError(error) : null;
}

export async function cerrarSesion() {
  await supabase.auth.signOut();
}

export async function cambiarMiContrasena(nueva: string) {
  if ((nueva || "").length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
  await revisar(supabase.auth.updateUser({ password: nueva }) as any);
}

// ---------------------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------------------
export async function cargarAspectoPublico(): Promise<Fila | null> {
  try {
    const { data } = await supabase.from("configuracion").select("valor").eq("clave", "aspecto").maybeSingle();
    return data ? data.valor : null;
  } catch {
    return null;
  }
}

export async function cargarTodo(idUsuario: string) {
  const [perfiles, grupos, equipos, tipos, sistemas, config, trabajos, aceites, requerimientos] = await Promise.all([
    leerTodo("perfiles", "creado_en"),
    leerTodo("grupos_trabajo", "id"),
    leerTodo("equipos", "creado_en"),
    leerTodo("tipos_aceite", "creado_en"),
    leerTodo("sistemas_equipo", "creado_en"),
    leerTodo("configuracion", "clave"),
    leerTodo("trabajos"),
    leerTodo("aceites"),
    leerTodo("requerimientos"),
  ]);
  const personal = perfiles.map(perfilDesdeFila);
  const configuracion: Fila = {};
  config.forEach((c) => (configuracion[c.clave] = c.valor));
  return {
    perfil: personal.find((p) => p.id === idUsuario) || null,
    personal: personal.sort((a, b) => (a.orden || 0) - (b.orden || 0)),
    grupos: grupos.map((g) => ({ id: g.id, nombre: g.nombre, alcance: g.alcance })),
    equipos: equipos.map(desdeFila),
    tiposAceite: tipos.map(desdeFila),
    sistemasEquipo: sistemas.map(desdeFila),
    configuracion,
    trabajos: trabajos.map(desdeFila),
    aceites: aceites.map(desdeFila),
    requerimientos: requerimientos.map(desdeFila),
  };
}

export async function cargarPersonal() {
  const filas = await leerTodo("perfiles", "creado_en");
  return filas.map(perfilDesdeFila).sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

// ---------------------------------------------------------------------------
// Registros (trabajos, aceites, requerimientos, equipos, catálogos, grupos)
// ---------------------------------------------------------------------------
export async function insertar(tabla: string, obj: Fila): Promise<Fila> {
  const fila = await revisar(supabase.from(tabla).insert(aFila(tabla, obj)).select().single());
  return desdeFila(fila as Fila);
}

export async function actualizar(tabla: string, id: string | number, cambios: Fila): Promise<void> {
  const fila = aFila(tabla, cambios);
  delete fila.id;
  if (!Object.keys(fila).length) return;
  await revisar(supabase.from(tabla).update(fila).eq("id", id));
}

export async function eliminar(tabla: string, id: string | number): Promise<void> {
  await revisar(supabase.from(tabla).delete().eq("id", id));
}

export async function guardarConfig(clave: string, valor: unknown): Promise<void> {
  await revisar(
    supabase.from("configuracion").upsert({ clave, valor, actualizado_en: new Date().toISOString() }, { onConflict: "clave" })
  );
}

export async function renombrarFlota(anterior: string, nuevo: string) {
  await revisar(supabase.rpc("renombrar_flota", { p_anterior: anterior, p_nuevo: nuevo }));
}

// ---------------------------------------------------------------------------
// Usuarios (solo el Administrador)
// ---------------------------------------------------------------------------
function categoriaTexto(c: unknown): string | null {
  return c === undefined || c === null || c === "" ? null : String(c);
}

export async function crearUsuario(d: Fila): Promise<string> {
  return await revisar(
    supabase.rpc("admin_crear_usuario", {
      p_usuario: d.usuario,
      p_contrasena: d.contrasena,
      p_nombre: d.nombre,
      p_rol: d.rol,
      p_cargo: d.cargo,
      p_categoria: categoriaTexto(d.categoria),
      p_flota_grupo: d.flota_grupo || null,
    })
  );
}

export async function actualizarUsuario(id: string, d: Fila): Promise<void> {
  await revisar(
    supabase.rpc("admin_actualizar_usuario", {
      p_id: id,
      p_usuario: d.usuario,
      p_nombre: d.nombre,
      p_rol: d.rol,
      p_cargo: d.cargo,
      p_categoria: categoriaTexto(d.categoria),
      p_flota_grupo: d.flota_grupo || null,
      p_contrasena: d.contrasena || null,
    })
  );
}

export async function cambiarActivoUsuario(id: string, activo: boolean): Promise<void> {
  await revisar(supabase.rpc("admin_cambiar_activo", { p_id: id, p_activo: activo }));
}

export async function eliminarUsuario(id: string): Promise<void> {
  await revisar(supabase.rpc("admin_eliminar_usuario", { p_id: id }));
}
