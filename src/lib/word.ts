// @ts-nocheck
// ---------------------------------------------------------------------------
// Descargas en formato Word (.docx) con el MISMO diseño que los documentos
// PDF: encabezado con logo, tablas con encabezado de color, filas alternas,
// "pastillas" de estado, cajetín del reporte de turno y pie de página con
// "Página X de N".
//
// Se arma un .docx real con la librería "docx" (se carga solo al descargar,
// así no hace más lenta la app). El .doc anterior era una página web con
// extensión .doc, por eso Word lo mostraba desconfigurado.
// ---------------------------------------------------------------------------
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  LineRuleType,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

// --- Medidas -----------------------------------------------------------------
// 1 px (CSS) = 0.75 pt = 15 twips; los tamaños de letra de Word van en
// medios puntos (1 px = 1.5 medios puntos).
const TW = 15;
const CM = 567; // twips por centímetro
const CARTA_ANCHO = 12240; // 8.5 in
const CARTA_ALTO = 15840; // 11 in

let K = 1; // factor de tamaño de letra (Configuración → Reportes)
let FUENTE = "TS Inter";
// Letra del documento: la misma de los PDF (Inter), incrustada dentro del
// Word para que se vea igual en cualquier computadora o celular, aunque no
// la tenga instalada. Cada peso va como una familia aparte.
const FAMILIAS = { 400: "TS Inter", 600: "TS Inter SemiBold", 700: "TS Inter Bold", 800: "TS Inter ExtraBold", i: "TS Inter Italic" };
const ARCHIVOS_FUENTE = { 400: "ts-inter-400.ttf", 600: "ts-inter-600.ttf", 700: "ts-inter-700.ttf", 800: "ts-inter-800.ttf", i: "ts-inter-400i.ttf" };
let EMBEBIDA = true;
let FUENTES_DOC = [];
function letraRun(op) {
  if (!EMBEBIDA) return { font: FUENTE, bold: !!(op.negrita || (op.peso || 0) >= 600), italics: !!op.cursiva };
  const peso = op.peso || (op.negrita ? 700 : 400);
  if (op.cursiva && peso < 600) return { font: FAMILIAS.i };
  return { font: FAMILIAS[peso] || FAMILIAS[400], italics: !!op.cursiva };
}
// Descarga los archivos de la letra (carpeta /fuentes de la app).
async function cargarFuentes(url) {
  const claves = Object.keys(ARCHIVOS_FUENTE);
  const datos = await Promise.all(
    claves.map(async (k) => {
      const r = await fetch(url(ARCHIVOS_FUENTE[k]));
      if (!r.ok) throw new Error("fuente");
      return new Uint8Array(await r.arrayBuffer());
    })
  );
  return claves.map((k, i) => ({ name: FAMILIAS[k], data: datos[i] }));
}
const pt = (px) => Math.max(8, Math.round(px * 1.5 * K)); // medios puntos

// Color de fondo con transparencia sobre blanco (equivale a "#rrggbbAA" del PDF).
function mezcla(hex, alfa) {
  const h = String(hex || "#4a8fe0").replace("#", "").slice(0, 6).padEnd(6, "0");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  return c.map((v) => Math.round(v * alfa + 255 * (1 - alfa)).toString(16).padStart(2, "0")).join("");
}
const hex = (c) => String(c || "#000000").replace("#", "").slice(0, 6);

// Primer nombre de la lista de fuentes CSS ("Georgia, serif" -> "Georgia").
function nombreFuente(css) {
  const primero = String(css || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  return primero || "Segoe UI";
}

const SIN_BORDE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const sinBordes = { top: SIN_BORDE, bottom: SIN_BORDE, left: SIN_BORDE, right: SIN_BORDE };
const borde = (color, px = 1) => ({ style: BorderStyle.SINGLE, size: Math.max(2, Math.round(px * 6)), color: hex(color) });

function texto(t, op = {}) {
  return new TextRun({
    text: String(t ?? ""),
    ...letraRun(op),
    size: pt(op.px || 10),
    color: op.color ? hex(op.color) : "1B1F24",
    allCaps: !!op.mayus,
    shading: op.fondo ? { type: ShadingType.CLEAR, color: "auto", fill: hex(op.fondo) } : undefined,
    characterSpacing: op.espacio || undefined,
  });
}
function parrafo(runs, op = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    alignment: op.alinear || AlignmentType.LEFT,
    spacing: { before: op.antes || 0, after: op.despues || 0, line: op.linea || 252, lineRule: LineRuleType.AUTO },
    keepNext: !!op.conSiguiente,
    tabStops: op.tabs,
    border: op.borde,
  });
}

// --- Logo ------------------------------------------------------------------
// Se dibuja en un canvas y se pasa a PNG (sirve para cualquier formato de
// imagen). Si no se puede leer, se usan las iniciales como en el PDF.
async function cargarLogo(url) {
  if (!url) return null;
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => ok(i);
      i.onerror = mal;
      i.src = url;
    });
    const w = img.naturalWidth || 200;
    const h = img.naturalHeight || 200;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const datos = canvas.toDataURL("image/png").split(",")[1];
    const bin = atob(datos);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, w, h };
  } catch (e) {
    return null;
  }
}
// Logo ajustado a un máximo de ancho/alto (px), manteniendo proporción.
function runLogo(logo, maxW, maxH) {
  const esc = Math.min(maxW / logo.w, maxH / logo.h, 1e9);
  return new ImageRun({
    type: "png",
    data: logo.bytes,
    transformation: { width: Math.max(8, Math.round(logo.w * esc)), height: Math.max(8, Math.round(logo.h * esc)) },
  });
}
// Iniciales en un cuadro de color (cuando no hay logo).
function celdaIniciales(iniciales, color, ladoPx) {
  return new Table({
    width: { size: ladoPx * TW, type: WidthType.DXA },
    columnWidths: [ladoPx * TW],
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: { ...sinBordes, insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE },
    rows: [
      new TableRow({
        height: { value: ladoPx * TW, rule: "exact" },
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: "auto", fill: hex(color) },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: [parrafo(texto(iniciales, { px: Math.round(ladoPx * 0.36), peso: 800, color: "#FFFFFF" }), { alinear: AlignmentType.CENTER, linea: 240 })],
          }),
        ],
      }),
    ],
  });
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function pagina(horizontal, margenes) {
  return {
    page: {
      size: { width: CARTA_ANCHO, height: CARTA_ALTO, orientation: horizontal ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
      margin: { ...margenes, header: 400, footer: margenes.pie || 480 },
    },
  };
}

async function prepararFormato(ctx) {
  K = Number(ctx.factorLetra) || 1;
  FUENTES_DOC = [];
  if (ctx.fuente) {
    // Letra elegida en Configuración → Reportes (Arial, Georgia…).
    EMBEBIDA = false;
    FUENTE = nombreFuente(ctx.fuente);
    return;
  }
  try {
    FUENTES_DOC = await cargarFuentes(ctx.urlFuente);
    EMBEBIDA = true;
    FUENTE = FAMILIAS[400];
  } catch (e) {
    EMBEBIDA = false;
    FUENTE = "Arial";
  }
}

// Número de página centrado al pie ("Página X de N").
function pieNumero() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES], font: FUENTE, size: pt(9), color: "777777" }),
        ],
      }),
    ],
  });
}

// ===========================================================================
// 1) Listas (Aceites, Requerimientos, Historial): igual que exportarPDF
// ===========================================================================
const PILL = {
  ok: ["E3F4EA", "1F7A45"],
  no: ["FDE8E7", "B42318"],
  pend: ["FFF3C4", "8A6100"],
  info: ["E1EBFC", "2F5FB3"],
  dia: ["FFF4DC", "9A6400"],
  noche: ["E6E9F5", "3B4A7A"],
  gris: ["EEF0F3", "4B5563"],
};

// ctx: { titulo, detalle, columnas:[{clave,titulo,tipo:'corta'|'larga'|'num'}], filas:[[{texto,pill?,marca?,tenue?}]],
//        horizontal, color, logoUrl, org, area, iniciales, factorLetra, fuente, nombreArchivo }
export async function wordLista(ctx) {
  await prepararFormato(ctx);
  const color = ctx.color || "#4a8fe0";
  const horizontal = !!ctx.horizontal;
  const margenX = Math.round((horizontal ? 1.5 : 1.8) * CM);
  const margenY = Math.round((horizontal ? 1.6 : 2.2) * CM);
  const util = (horizontal ? CARTA_ALTO : CARTA_ANCHO) - 2 * margenX;
  const logo = await cargarLogo(ctx.logoUrl);

  // Encabezado: logo + organización a la izquierda; título y detalle a la derecha.
  const lineaColor = { style: BorderStyle.SINGLE, size: 15, color: hex(color) };
  const anchoLogo = 60 * TW;
  const cab = new Table({
    width: { size: util, type: WidthType.DXA },
    columnWidths: [anchoLogo, Math.round((util - anchoLogo) * 0.45), util - anchoLogo - Math.round((util - anchoLogo) * 0.45)],
    layout: TableLayoutType.FIXED,
    borders: { ...sinBordes, insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: { ...sinBordes, bottom: lineaColor },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 0, bottom: 150, left: 0, right: 0 },
            children: [logo ? parrafo(runLogo(logo, 52, 44)) : celdaIniciales(ctx.iniciales, color, 40)],
          }),
          new TableCell({
            borders: { ...sinBordes, bottom: lineaColor },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 0, bottom: 150, left: 0, right: 0 },
            children: [
              parrafo(texto(ctx.org, { px: 12, espacio: 10 })),
              parrafo(texto(ctx.area, { px: 9.5, color: "#6B7280" })),
            ],
          }),
          new TableCell({
            borders: { ...sinBordes, bottom: lineaColor },
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { top: 0, bottom: 150, left: 0, right: 0 },
            children: [
              parrafo(texto(ctx.titulo, { px: 15, color: "#111827" }), { alinear: AlignmentType.RIGHT }),
              parrafo(ctx.detalle.map((d) => texto(d.t, { px: 9, color: d.b ? "#374151" : "#6B7280", peso: d.b ? 600 : 400 })), {
                alinear: AlignmentType.RIGHT,
                antes: 40,
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const hijos = [cab, parrafo(texto(""), { despues: 120 })];

  if (!ctx.filas.length) {
    hijos.push(
      new Table({
        width: { size: util, type: WidthType.DXA },
        columnWidths: [util],
        borders: { top: borde("#D1D5DB"), bottom: borde("#D1D5DB"), left: borde("#D1D5DB"), right: borde("#D1D5DB"), insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE },
        rows: [new TableRow({ children: [new TableCell({ margins: { top: 270, bottom: 270 }, children: [parrafo(texto("Sin registros con los filtros actuales.", { px: 10, cursiva: true, color: "#6B7280" }), { alinear: AlignmentType.CENTER })] })] })],
      })
    );
  } else {
    const fs = horizontal ? 8.4 : 9.4;
    const fsTh = horizontal ? 7.6 : 8.4;
    const mH = horizontal ? 60 : 90;
    // Anchos como en el PDF: las columnas cortas se ajustan a su contenido
    // (sin partir la línea) y las de texto largo reparten el resto.
    // Ancho aprox. de un texto (twips): mayúsculas y números más anchos.
    const medir = (t, px, mayus = false) =>
      [...String(t)].reduce((a, ch) => a + (mayus || /[A-ZÁÉÍÓÚÑ]/.test(ch) ? 0.7 : /[0-9]/.test(ch) ? 0.6 : /[/]/.test(ch) ? 0.38 : /[\s.,:;il|]/.test(ch) ? 0.32 : 0.58), 0) * px * TW * K;
    const anchoCorta = (c, i) => {
      const palabraTh = Math.max(...String(c.titulo).split(/\s+/).map((w) => medir(w, fsTh, true) * 1.08));
      const contenido = Math.max(
        0,
        ...ctx.filas.map((f) => {
          const cel = f[i];
          if (cel.tenue) return medir("—", fs);
          if (cel.marca) return 18 * TW;
          const t = String(cel.texto || "");
          return t.length > 24 ? medir(t.slice(0, 24), fs) : medir(t, cel.pill ? 8.5 : fs) + (cel.pill ? 10 * TW : 0);
        })
      );
      return Math.round(Math.max(palabraTh, contenido) + 2 * mH + 60);
    };
    // Peso de cada columna larga según cuánto texto lleva (una columna casi
    // vacía, como Observaciones sin datos, queda angosta).
    const pesoLarga = (c) => {
      const i = ctx.columnas.indexOf(c);
      const largos = ctx.filas.map((f) => (f[i].tenue ? 0 : String(f[i].texto || "").length));
      const prom = largos.length ? largos.reduce((a, b) => a + b, 0) / largos.length : 0;
      const base = c.clave === "descripcion" ? 3.2 : c.clave === "personal" ? 1.35 : 2;
      return base * (0.3 + 0.7 * Math.min(1, prom / 50));
    };
    let anchos = ctx.columnas.map((c, i) => (c.tipo === "larga" ? 0 : anchoCorta(c, i)));
    const usadas = anchos.reduce((a, b) => a + b, 0);
    const largas = ctx.columnas.filter((c) => c.tipo === "larga");
    const pesoTotal = largas.reduce((a, c) => a + pesoLarga(c), 0);
    const resto = util - usadas;
    if (pesoTotal > 0 && resto > largas.length * 900) {
      anchos = anchos.map((a, i) => (ctx.columnas[i].tipo === "larga" ? Math.floor((resto * pesoLarga(ctx.columnas[i])) / pesoTotal) : a));
      // Mínimo: que entre la palabra más larga del título.
      ctx.columnas.forEach((c, i) => {
        if (c.tipo !== "larga") return;
        const min = Math.max(...String(c.titulo).split(/\s+/).map((w) => medir(w, fsTh, true) * 1.08)) + 2 * mH + 60;
        if (anchos[i] < min) {
          const falta = min - anchos[i];
          anchos[i] = Math.round(min);
          const j = anchos.indexOf(Math.max(...anchos));
          anchos[j] -= Math.round(falta);
        }
      });
    } else {
      // No alcanza: se reparte en proporción.
      const base = anchos.map((a, i) => (ctx.columnas[i].tipo === "larga" ? 1800 * pesoLarga(ctx.columnas[i]) : a));
      const suma = base.reduce((a, b) => a + b, 0);
      anchos = base.map((a) => Math.floor((a * util) / suma));
    }
    const filaTh = new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: ctx.columnas.map(
        (c, i) =>
          new TableCell({
            width: { size: anchos[i], type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: mezcla(color, 0x14 / 255) },
            borders: { ...sinBordes, bottom: borde(color, 1.5) },
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { top: 90, bottom: 90, left: mH, right: mH },
            children: [
              parrafo(texto(c.titulo, { px: fsTh, negrita: true, color: "#374151", mayus: true, espacio: 6 }), {
                alinear: c.clave === "estado_final" || c.clave === "verificaciones" ? AlignmentType.CENTER : c.tipo === "num" ? AlignmentType.RIGHT : AlignmentType.LEFT,
              }),
            ],
          })
      ),
    });
    const filas = ctx.filas.map(
      (fila, n) =>
        new TableRow({
          cantSplit: true,
          children: fila.map((celda, i) => {
            const c = ctx.columnas[i];
            let runs;
            if (celda.marca) {
              const [f, t] = celda.marca === "ok" ? PILL.ok : PILL.no;
              runs = [texto(celda.marca === "ok" ? " ✓ " : " ✗ ", { px: 10, negrita: true, color: t, fondo: f })];
            } else if (celda.pill) {
              const [f, t] = PILL[celda.pill] || PILL.gris;
              runs = [texto(` ${celda.texto} `, { px: 8.5, peso: 600, color: t, fondo: f })];
            } else if (celda.tenue) {
              runs = [texto("—", { px: fs, color: "#A0A6AD" })];
            } else {
              const lineas = String(celda.texto).split("\n");
              return new TableCell({
                width: { size: anchos[i], type: WidthType.DXA },
                shading: n % 2 === 1 ? { type: ShadingType.CLEAR, color: "auto", fill: "F9FAFB" } : undefined,
                borders: { ...sinBordes, bottom: borde("#E5E7EB") },
                margins: { top: 75, bottom: 75, left: mH, right: mH },
                children: lineas.map((l) => parrafo(texto(l, { px: fs, color: "#111827" }), { alinear: c.tipo === "num" ? AlignmentType.RIGHT : AlignmentType.LEFT })),
              });
            }
            return new TableCell({
              width: { size: anchos[i], type: WidthType.DXA },
              shading: n % 2 === 1 ? { type: ShadingType.CLEAR, color: "auto", fill: "F9FAFB" } : undefined,
              borders: { ...sinBordes, bottom: borde("#E5E7EB") },
              margins: { top: 75, bottom: 75, left: mH, right: mH },
              children: [parrafo(runs, { alinear: c.clave === "estado_final" || c.clave === "verificaciones" ? AlignmentType.CENTER : c.tipo === "num" ? AlignmentType.RIGHT : AlignmentType.LEFT })],
            });
          }),
        })
    );
    hijos.push(
      new Table({
        width: { size: util, type: WidthType.DXA },
        columnWidths: anchos,
        layout: TableLayoutType.FIXED,
        borders: { ...sinBordes, insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE },
        rows: [filaTh, ...filas],
      })
    );
  }

  const doc = new Document({
    creator: ctx.org || "TRUCK SHOP",
    title: ctx.titulo,
    fonts: FUENTES_DOC,
    styles: { default: { document: { run: { font: FUENTE, size: pt(10) } } } },
    sections: [
      {
        properties: pagina(horizontal, { top: margenY, bottom: margenY, left: margenX, right: margenX, pie: Math.round(1.0 * CM) }),
        footers: { default: pieNumero() },
        children: hijos,
      },
    ],
  });
  descargar(await Packer.toBlob(doc), `${ctx.nombreArchivo}.docx`);
}

// ===========================================================================
// 2) Reporte de turno (Trabajos): igual que imprimirReporteTurno
// ===========================================================================
// ctx: { hojas:[{ fecha, turnoTexto, grupo, impresoPor, secciones:[{ flota, total, programados:[fila], noProgramados:[fila] }] }],
//        cfg, mc (medidas del cajetín), emitido, color, logoUrl, iniciales, factorLetra, fuente, nombreArchivo }
// fila: { equipo, lineas:[{t, tit}], nota, personal:[...], ubicacion, horario, ok }
export async function wordReporteTurno(ctx) {
  await prepararFormato(ctx);
  const color = ctx.color || "#4a8fe0";
  const cfg = ctx.cfg;
  const mc = ctx.mc;
  // Letra de la tabla elegida en Configuración → Reportes (12 px normal).
  const PX = Math.min(16, Math.max(10, Number(cfg.letraReporte) || 12));
  const margen = Math.round(1.27 * CM);
  const util = CARTA_ANCHO - 2 * margen;
  const logo = await cargarLogo(ctx.logoUrl);
  const gris = "#6B7280";
  const lineaCaja = borde("#D5D9DF");
  const lineaSuave = borde("#E3E6EA");

  // Cajetín: logo | empresa, área, título, subtítulo | Código, Revisión, Emitido
  function cajetin() {
    const aL = Math.round(mc.anchoLogo * TW);
    const aD = Math.round(mc.anchoDatos * TW);
    const aC = Math.max(1200, util - aL - aD);
    const m = { top: 120, bottom: 120, left: 150, right: 150 };
    const ladoIni = Math.min(mc.altoLogo, 50);
    const datos = [
      [mc.etCodigo, cfg.codigo],
      [mc.etRevision, cfg.revision],
      [mc.etEmitido, ctx.emitido],
    ];
    return new Table({
      width: { size: aL + aC + aD, type: WidthType.DXA },
      columnWidths: [aL, aC, aD],
      layout: TableLayoutType.FIXED,
      borders: { top: lineaCaja, bottom: lineaCaja, left: lineaCaja, right: lineaCaja, insideHorizontal: SIN_BORDE, insideVertical: lineaSuave },
      rows: [
        new TableRow({
          cantSplit: true,
          height: mc.alto ? { value: Math.round(mc.alto * TW), rule: "atLeast" } : undefined,
          children: [
            new TableCell({
              width: { size: aL, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              margins: m,
              children: [logo ? parrafo(runLogo(logo, Math.max(20, mc.anchoLogo - 24), mc.altoLogo), { alinear: AlignmentType.CENTER }) : celdaIniciales(ctx.iniciales, color, ladoIni)],
            }),
            new TableCell({
              width: { size: aC, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              margins: m,
              children: [
                parrafo(texto(cfg.empresa, { px: mc.empresa, espacio: 10 }), { alinear: AlignmentType.CENTER }),
                parrafo(texto(cfg.area, { px: mc.area, color: gris }), { alinear: AlignmentType.CENTER }),
                parrafo(texto(cfg.titulo, { px: mc.titulo, color, espacio: 8 }), { alinear: AlignmentType.CENTER, antes: 60 }),
                ...(cfg.subtitulo ? [parrafo(texto(cfg.subtitulo, { px: mc.subtitulo, color: gris }), { alinear: AlignmentType.CENTER, antes: 30 })] : []),
              ],
            }),
            new TableCell({
              width: { size: aD, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              margins: m,
              children: datos.map(([e, v]) =>
                parrafo([texto(e, { px: mc.datos, color: gris }), texto("\t"), texto(v, { px: mc.datos })], {
                  tabs: [{ type: TabStopType.RIGHT, position: aD - 300 }],
                  antes: 20,
                  despues: 20,
                })
              ),
            }),
          ],
        }),
      ],
    });
  }

  // Franja de color con el nombre de la flota y la cantidad de trabajos.
  function tituloFlota(s) {
    return new Table({
      width: { size: util, type: WidthType.DXA },
      columnWidths: [util - 2200, 2200],
      layout: TableLayoutType.FIXED,
      borders: { ...sinBordes, insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, color: "auto", fill: mezcla(color, 0x14 / 255) },
              borders: { bottom: borde(color, 1.5) },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 90, bottom: 90, left: 150, right: 60 },
              children: [parrafo(texto(`Flota ${s.flota}`, { px: 11, color: "#111827", peso: 700, mayus: true, espacio: 12 }), { conSiguiente: true })],
            }),
            new TableCell({
              shading: { type: ShadingType.CLEAR, color: "auto", fill: mezcla(color, 0x14 / 255) },
              borders: { bottom: borde(color, 1.5) },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 90, bottom: 90, left: 60, right: 150 },
              children: [
                parrafo(texto(` ${s.total} ${s.total === 1 ? "trabajo" : "trabajos"} `, { px: 9.5, peso: 600, color: "#FFFFFF", fondo: hex(color) }), {
                  alinear: AlignmentType.RIGHT,
                  conSiguiente: true,
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  // "Equipos Programados  3"
  function subtitulo(t, n) {
    return parrafo([texto(t, { px: 10.5, color: "#111827" }), texto("  "), texto(` ${n} `, { px: 9, color, fondo: mezcla(color, 0x1f / 255) })], {
      antes: 240,
      despues: 120,
      conSiguiente: true,
    });
  }

  const ANCHOS = [6, 49, 11, 10, 13, 11];
  function tablaTrabajos(lista) {
    if (!lista.length) {
      return new Table({
        width: { size: util, type: WidthType.DXA },
        columnWidths: [util],
        borders: { top: borde("#D5D9DF"), bottom: borde("#D5D9DF"), left: borde("#D5D9DF"), right: borde("#D5D9DF"), insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE },
        rows: [new TableRow({ children: [new TableCell({ margins: { top: 120, bottom: 120, left: 150, right: 150 }, children: [parrafo(texto("Sin registros en este turno.", { px: 10.5, cursiva: true, color: gris }))] })] })],
      });
    }
    const anchos = ANCHOS.map((p) => Math.floor((util * p) / 100));
    const m = { top: 90, bottom: 90, left: 105, right: 105 };
    const th = new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: ["Equipo", "Descripción", "Personal", "Ubicación", "Horario", "Estado"].map(
        (t, i) =>
          new TableCell({
            width: { size: anchos[i], type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: mezcla(color, 0x14 / 255) },
            borders: { bottom: borde(color, 1.5) },
            margins: { ...m, left: 80, right: 40 },
            children: [parrafo(texto(t, { px: 8.5, negrita: true, color: "#374151", mayus: true, espacio: 4 }))],
          })
      ),
    });
    const filas = lista.map((f, n) => {
      const fondo = n % 2 === 1 ? { type: ShadingType.CLEAR, color: "auto", fill: "F9FAFB" } : undefined;
      const ultima = n === lista.length - 1;
      const bordes = { bottom: ultima ? SIN_BORDE : borde("#EEF0F2") };
      const celda = (i, hijos) =>
        new TableCell({ width: { size: anchos[i], type: WidthType.DXA }, shading: fondo, borders: bordes, margins: m, children: hijos });
      const desc = [
        ...f.lineas.map((l) => parrafo(texto(l.t, { px: PX, negrita: l.tit, color: l.tit ? "#111827" : "#1B1F24" }), { linea: 240 })),
        ...(f.nota ? [parrafo(texto(`Síntoma y causa: ${f.nota}`, { px: PX, cursiva: true, color: gris }), { antes: 30 })] : []),
      ];
      const personal = f.personal.length
        ? f.personal.map((p) => parrafo(texto(p, { px: PX, color: "#374151" })))
        : [parrafo(texto("Sin intervención", { px: PX, cursiva: true, color: "#9CA3AF" }))];
      const [fe, te] = f.ok ? PILL.ok : PILL.no;
      return new TableRow({
        cantSplit: true,
        children: [
          celda(0, [parrafo(texto(f.equipo, { px: PX, color: "#111827" }))]),
          celda(1, desc.length ? desc : [parrafo(texto(""))]),
          celda(2, personal),
          celda(3, [parrafo(texto(f.ubicacion, { px: PX }))]),
          celda(4, [parrafo(texto(String(f.horario).replace(/ /g, "\u00A0"), { px: PX - 1 }))]),
          celda(5, [parrafo(texto(f.ok ? " Operativo " : " No Operativo ", { px: 8.5, peso: 600, color: te, fondo: fe }))]),
        ],
      });
    });
    return new Table({
      width: { size: util, type: WidthType.DXA },
      columnWidths: anchos,
      layout: TableLayoutType.FIXED,
      borders: { top: lineaSuave, bottom: lineaSuave, left: lineaSuave, right: lineaSuave, insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE },
      rows: [th, ...filas],
    });
  }

  // Pie fijo de cada hoja: Fecha · Turno · Grupo · Impreso por · Página X de N
  function pie(h) {
    const et = (t) => texto(t.toUpperCase(), { px: 7.5, color: "#9CA3AF", espacio: 8 });
    const va = (t) => texto(t, { px: 9, color: "#4B5563" });
    const hijos = [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: "D5D9DF", space: 4 } },
        tabStops: [{ type: TabStopType.RIGHT, position: util }],
        children: [
          et("Fecha "), va(h.fecha), va("     "),
          et("Turno "), va(h.turnoTexto), va("     "),
          et("Grupo "), va(h.grupo), va("     "),
          et("Impreso por "), va(h.impresoPor || ""),
          new TextRun({ children: ["\t", "Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES], font: FUENTE, size: pt(9), color: "6B7280" }),
        ],
      }),
    ];
    if (cfg.pie) hijos.push(parrafo(texto(cfg.pie, { px: 8, color: "#9CA3AF" }), { antes: 30 }));
    return new Footer({ children: hijos });
  }

  // Una sección de Word por cada hoja del PDF (fecha + turno + flota), con
  // su cajetín arriba y su propio pie.
  const secciones = [];
  ctx.hojas.forEach((h) => {
    const partes = h.secciones.length ? h.secciones : [null];
    partes.forEach((s) => {
      const hijos = [cajetin(), parrafo(texto(""), { despues: 120 })];
      if (s) {
        hijos.push(tituloFlota(s));
        hijos.push(subtitulo("Equipos Programados", s.programados.length));
        hijos.push(tablaTrabajos(s.programados));
        hijos.push(subtitulo("Equipos No Programados", s.noProgramados.length));
        hijos.push(tablaTrabajos(s.noProgramados));
      }
      secciones.push({
        properties: pagina(false, { top: margen, bottom: Math.round(1.55 * CM) + 500, left: margen, right: margen, pie: Math.round(0.5 * CM) }),
        footers: { default: pie(h) },
        children: hijos,
      });
    });
  });
  if (!secciones.length) {
    secciones.push({
      properties: pagina(false, { top: margen, bottom: margen, left: margen, right: margen }),
      children: [parrafo(texto("No hay trabajos con los filtros actuales.", { px: 10.5, cursiva: true, color: gris }))],
    });
  }

  const doc = new Document({
    creator: cfg.empresa || "TRUCK SHOP",
    title: cfg.titulo,
    fonts: FUENTES_DOC,
    styles: { default: { document: { run: { font: FUENTE, size: pt(10.5) } } } },
    sections: secciones,
  });
  descargar(await Packer.toBlob(doc), `${ctx.nombreArchivo}.docx`);
}
