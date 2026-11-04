-- =====================================================================
-- TRUCK SHOP — Actualización en tiempo real
-- Pegar UNA vez en Supabase → SQL Editor → Run.
-- Activa el aviso en tiempo real (Supabase Realtime) para trabajos, aceites
-- y requerimientos: cuando alguien registra, edita o elimina un registro, los
-- demás lo ven aparecer sin tener que actualizar la app.
-- La seguridad (RLS) se mantiene: cada usuario solo recibe lo que ya puede leer.
-- =====================================================================

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['trabajos', 'aceites', 'requerimientos'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Comprobación: deben aparecer las 3 tablas.
select tablename as "Tablas con tiempo real"
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename in ('trabajos', 'aceites', 'requerimientos')
order by tablename;
