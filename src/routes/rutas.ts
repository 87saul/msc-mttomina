// Rutas de la app. Cada pestaña tiene su propia dirección, así se puede
// entrar directo (ej. tu-sitio.netlify.app/trabajos) o refrescar la página.
export const RUTAS: Record<string, string> = {
  dashboard: "/inicio",
  trabajos: "/trabajos",
  aceites: "/aceites",
  requerimientos: "/requerimientos",
  historial: "/historial",
  config: "/configuracion",
};

export function vistaDesdeRuta(ruta: string): string {
  const encontrada = Object.entries(RUTAS).find(([, r]) => ruta === r || ruta.startsWith(r + "/"));
  return encontrada ? encontrada[0] : "dashboard";
}
