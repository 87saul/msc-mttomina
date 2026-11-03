-- =====================================================================
-- TRUCK SHOP — Control de almacenamiento (Configuración → Almacenamiento)
-- Pegar UNA vez en Supabase → SQL Editor → Run.
-- Crea una función de solo lectura que devuelve cuánto espacio ocupa la
-- base de datos (total y por tabla) y los archivos subidos (imágenes, en
-- el futuro). Solo el Administrador puede consultarla.
-- =====================================================================

create or replace function public.uso_almacenamiento()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tablas jsonb;
  v_archivos_bytes bigint := 0;
  v_archivos_cantidad bigint := 0;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver el almacenamiento.';
  end if;

  -- Tablas de la app: tamaño (datos + índices) y cantidad de filas.
  select coalesce(jsonb_agg(t order by (t->>'bytes')::bigint desc), '[]'::jsonb)
    into v_tablas
  from (
    select jsonb_build_object(
      'tabla', c.relname,
      'bytes', pg_total_relation_size(c.oid),
      'filas', (xpath('/row/n/text()',
                 query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint
    ) as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  ) x;

  -- Archivos subidos a Supabase Storage (si existe).
  if to_regclass('storage.objects') is not null then
    execute 'select coalesce(sum((metadata->>''size'')::bigint), 0), count(*) from storage.objects'
      into v_archivos_bytes, v_archivos_cantidad;
  end if;

  return jsonb_build_object(
    'base_bytes', pg_database_size(current_database()),
    'tablas', v_tablas,
    'archivos_bytes', v_archivos_bytes,
    'archivos_cantidad', v_archivos_cantidad,
    'medido_en', now()
  );
end;
$$;

revoke all on function public.uso_almacenamiento() from public, anon;
grant execute on function public.uso_almacenamiento() to authenticated;
