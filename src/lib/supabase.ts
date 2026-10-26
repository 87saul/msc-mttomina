import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Las dos únicas variables de conexión (se configuran en Netlify):
//   VITE_SUPABASE_URL       → Project URL de Supabase
//   VITE_SUPABASE_ANON_KEY  → Publishable / anon key de Supabase
const url = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const clave = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

export const supabaseConfigurado = Boolean(url && clave);

export const supabase: SupabaseClient = supabaseConfigurado
  ? createClient(url, clave, { auth: { persistSession: true, autoRefreshToken: true } })
  : (null as unknown as SupabaseClient);

// Dominio interno: cada usuario entra con su "usuario" (ej. GuidoC) y la app
// lo convierte en el correo interno guidoc@truckshop.app. El administrador
// principal entra con su propio correo.
export const DOMINIO_USUARIOS = "truckshop.app";

export function correoDeUsuario(usuario: string): string {
  const u = (usuario || "").trim();
  if (u.includes("@")) return u.toLowerCase();
  return `${u.toLowerCase()}@${DOMINIO_USUARIOS}`;
}
