// @ts-nocheck
// ---------------------------------------------------------------------------
// Lector de archivos Excel (.xlsx) en el navegador, sin librerías externas.
//
// Un .xlsx es un ZIP con archivos XML adentro. Aquí se abre el ZIP (con el
// descompresor que traen los navegadores: DecompressionStream) y se leen las
// hojas como una tabla de valores (texto o número). Se usa para subir las
// horas de componentes y el inventario de almacén.
// ---------------------------------------------------------------------------

// --- ZIP -------------------------------------------------------------------
function u16(v, i) {
  return v.getUint16(i, true);
}
function u32(v, i) {
  return v.getUint32(i, true);
}

function entradasZip(buf) {
  const v = new DataView(buf);
  // Fin del directorio central (firma 0x06054b50), buscado desde el final.
  let fin = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (u32(v, i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("El archivo no es un Excel válido (.xlsx).");
  const total = u16(v, fin + 10);
  let p = u32(v, fin + 16);
  const dec = new TextDecoder();
  const entradas = {};
  for (let k = 0; k < total; k++) {
    if (u32(v, p) !== 0x02014b50) break;
    const metodo = u16(v, p + 10);
    const tamComp = u32(v, p + 20);
    const largoNombre = u16(v, p + 28);
    const largoExtra = u16(v, p + 30);
    const largoComent = u16(v, p + 32);
    const local = u32(v, p + 42);
    const nombre = dec.decode(new Uint8Array(buf, p + 46, largoNombre));
    entradas[nombre] = { metodo, tamComp, local };
    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return entradas;
}

async function leerEntrada(buf, e) {
  const v = new DataView(buf);
  const inicio = e.local + 30 + u16(v, e.local + 26) + u16(v, e.local + 28);
  const datos = new Uint8Array(buf, inicio, e.tamComp);
  if (e.metodo === 0) return new TextDecoder().decode(datos);
  if (e.metodo !== 8) throw new Error("Formato de compresión no compatible.");
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Este navegador no puede leer archivos Excel. Actualiza el navegador (Chrome, Edge o Safari recientes).");
  }
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(flujo).text();
}

// --- XML -------------------------------------------------------------------
const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
const todos = (nodo, nombre) => Array.from(nodo.getElementsByTagNameNS("*", nombre));
const hijo = (nodo, nombre) => todos(nodo, nombre)[0] || null;

function textoSi(si) {
  // Texto de una celda de texto compartido (sin la guía fonética <rPh>).
  return todos(si, "t")
    .filter((t) => !(t.parentNode && t.parentNode.localName === "rPh"))
    .map((t) => t.textContent)
    .join("");
}

function columnaDe(ref) {
  let n = 0;
  for (const ch of String(ref || "").replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Devuelve { hojas: [{ nombre, filas: [[valor, ...], ...] }] }
// Cada valor es un número, un texto o null (celda vacía).
export async function leerExcel(archivo) {
  if (!/\.(xlsx|xlsm)$/i.test(archivo.name || "")) {
    throw new Error("Elige un archivo de Excel .xlsx (si está en .xls, ábrelo en Excel y guárdalo como .xlsx).");
  }
  const buf = await archivo.arrayBuffer();
  const entradas = entradasZip(buf);
  const leer = async (ruta) => (entradas[ruta] ? await leerEntrada(buf, entradas[ruta]) : null);

  const libro = xml((await leer("xl/workbook.xml")) || "");
  const rels = xml((await leer("xl/_rels/workbook.xml.rels")) || "<r/>");
  const destinos = {};
  todos(rels, "Relationship").forEach((r) => (destinos[r.getAttribute("Id")] = r.getAttribute("Target")));
  const compartidosXml = await leer("xl/sharedStrings.xml");
  const compartidos = compartidosXml ? todos(xml(compartidosXml), "si").map(textoSi) : [];

  const hojas = [];
  for (const h of todos(libro, "sheet")) {
    const nombre = h.getAttribute("name");
    const rid = h.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || h.getAttribute("r:id");
    let destino = destinos[rid] || "";
    destino = destino.startsWith("/") ? destino.slice(1) : "xl/" + destino.replace(/^\.\//, "");
    const contenido = await leer(destino);
    if (!contenido) continue;
    const doc = xml(contenido);
    const filas = [];
    todos(doc, "row").forEach((fila) => {
      const r = Number(fila.getAttribute("r")) - 1;
      const valores = [];
      let siguiente = 0;
      todos(fila, "c").forEach((c) => {
        const ref = c.getAttribute("r");
        const col = ref ? columnaDe(ref) : siguiente;
        siguiente = col + 1;
        const tipo = c.getAttribute("t");
        const vNodo = hijo(c, "v");
        let valor = null;
        if (tipo === "s") valor = vNodo ? compartidos[Number(vNodo.textContent)] ?? null : null;
        else if (tipo === "inlineStr") valor = hijo(c, "is") ? textoSi(hijo(c, "is")) : null;
        else if (tipo === "str" || tipo === "e") valor = vNodo ? vNodo.textContent : null;
        else if (tipo === "b") valor = vNodo ? (vNodo.textContent === "1" ? "VERDADERO" : "FALSO") : null;
        else if (vNodo && vNodo.textContent !== "") {
          const n = Number(vNodo.textContent);
          valor = isNaN(n) ? vNodo.textContent : n;
        }
        if (typeof valor === "string") {
          valor = valor.trim();
          if (valor === "") valor = null;
        }
        valores[col] = valor;
      });
      filas[r >= 0 ? r : filas.length] = Array.from(valores, (x) => (x === undefined ? null : x));
    });
    hojas.push({ nombre, filas: Array.from(filas, (x) => x || []) });
  }
  return { hojas };
}

// --- Interpretación de cada Excel ----------------------------------------
const normal = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[°º]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const comoTexto = (v) => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : String(v).trim());
const comoNumero = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
};

// Horas de componentes: una hoja por modelo; en la fila 1 los equipos y en
// la columna A los componentes. Celda vacía = el componente nunca se cambió.
export function interpretarComponentes(libro) {
  const filas = [];
  const modelos = [];
  libro.hojas.forEach((hoja) => {
    const cab = hoja.filas[0] || [];
    const equipos = [];
    cab.forEach((v, col) => {
      if (col > 0 && comoTexto(v)) equipos.push({ col, equipo: comoTexto(v) });
    });
    if (!equipos.length) return;
    let nComp = 0;
    hoja.filas.slice(1).forEach((f) => {
      const componente = comoTexto(f[0]);
      if (!componente) return;
      nComp++;
      equipos.forEach((e, i) => {
        filas.push({
          modelo: hoja.nombre.trim(),
          equipo: e.equipo,
          componente,
          horas: comoNumero(f[e.col]),
          orden_equipo: i + 1,
          orden_componente: nComp,
        });
      });
    });
    if (nComp) modelos.push({ modelo: hoja.nombre.trim(), equipos: equipos.length, componentes: nComp });
  });
  if (!filas.length) throw new Error("No se encontraron horas de componentes. Revisa que cada hoja tenga los equipos en la fila 1 y los componentes en la columna A.");
  return { filas, modelos };
}

// Inventario: primera hoja con la columna "Numero de Parte".
const COLUMNAS_INVENTARIO = [
  { clave: "numero_parte", titulo: "Numero de Parte", prueba: (t) => /^(numero|nro\.?|no\.?|n) de parte$|^numero parte$|^part number$/.test(t) },
  { clave: "descripcion", titulo: "Descripción", prueba: (t) => /^descripcion/.test(t) },
  { clave: "detalle", titulo: "Detalle", prueba: (t) => /^detalle/.test(t) },
  { clave: "segundo_numero", titulo: "2do numero artículo", prueba: (t) => /2do numero|segundo numero/.test(t) },
  { clave: "unidad", titulo: "Unidad", prueba: (t) => /^unidad|^um$|^u\.m\.?$/.test(t) },
  { clave: "cantidad_disponible", titulo: "Cantidad disponible", prueba: (t) => /^cant(idad)? disponible/.test(t) },
  { clave: "cantidad_neta", titulo: "Cantidad neta", prueba: (t) => /^cant(idad)? neta/.test(t) },
  { clave: "cantidad_comprometida", titulo: "Cant compr en firme a OT", prueba: (t) => /compr/.test(t) },
  { clave: "cantidad_recepcion", titulo: "Cantidad en recepción", prueba: (t) => /recepcion/.test(t) },
  { clave: "cantidad_oc", titulo: "Cant en OC", prueba: (t) => /^cant(idad)? en oc$|^en oc$/.test(t) },
  { clave: "numero_corto", titulo: "N° Corto", prueba: (t) => /corto/.test(t) },
  { clave: "ubicacion", titulo: "Ubicación", prueba: (t) => /^ubicacion/.test(t) },
];
const NUMERICAS = ["cantidad_disponible", "cantidad_neta", "cantidad_comprometida", "cantidad_recepcion", "cantidad_oc"];

export function interpretarInventario(libro) {
  for (const hoja of libro.hojas) {
    for (let r = 0; r < Math.min(15, hoja.filas.length); r++) {
      const cab = (hoja.filas[r] || []).map(normal);
      const mapa = {};
      COLUMNAS_INVENTARIO.forEach((c) => {
        const i = cab.findIndex((t, j) => t && c.prueba(t) && !Object.values(mapa).includes(j));
        if (i >= 0) mapa[c.clave] = i;
      });
      if (mapa.numero_parte === undefined) continue;
      const filas = [];
      hoja.filas.slice(r + 1).forEach((f) => {
        const np = comoTexto(f[mapa.numero_parte]);
        if (!np) return;
        const o = {};
        COLUMNAS_INVENTARIO.forEach((c) => {
          if (mapa[c.clave] === undefined) return;
          const v = f[mapa[c.clave]];
          o[c.clave] = NUMERICAS.includes(c.clave) ? comoNumero(v) : comoTexto(v);
        });
        o.numero_parte = np;
        filas.push(o);
      });
      const faltan = COLUMNAS_INVENTARIO.filter((c) => mapa[c.clave] === undefined).map((c) => c.titulo);
      if (!filas.length) throw new Error("La hoja de inventario no tiene filas con número de parte.");
      return { filas, hoja: hoja.nombre, faltan };
    }
  }
  throw new Error('No se encontró la columna "Numero de Parte" en el Excel.');
}
