import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

// Sesión actual de Supabase Auth (se mantiene al refrescar la página).
export function useSesion() {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [verificando, setVerificando] = useState(true);

  useEffect(() => {
    let activo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!activo) return;
      setSesion(data.session);
      setVerificando(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, nueva) => {
      setSesion(nueva);
      setVerificando(false);
    });
    return () => {
      activo = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return { sesion, verificando };
}
