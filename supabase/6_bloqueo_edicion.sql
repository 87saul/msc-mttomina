-- =====================================================================
-- TRUCK SHOP — Bloqueo de edición (versión con base de datos)
-- Pegar UNA vez en Supabase → SQL Editor → Run.
--
-- Guarda en una tabla quién está editando cada registro. Así el bloqueo se
-- toma y se libera al instante (al guardar, al cerrar con la X o al salir
-- de la app) y no depende de que el celular cierre bien su conexión.
-- Si una app se cierra de golpe (sin señal, batería), el registro se libera
-- solo a los 40 segundos, porque la app que edita avisa cada 15 s que sigue
-- ahí.
-- =====================================================================

create table if not exists public.bloqueos_edicion (
  clave      text primary key,               -- "trabajos:ID", "aceites:ID"…
  sesion     text not null,                  -- app/pestaña que edita
  usuario_id uuid not null default auth.uid(),
  usuario    text,
  nombre     text,
  desde      timestamptz not null default now(),
  latido     timestamptz not null default now()
);

alter table public.bloqueos_edicion enable row level security;

drop policy if exists "bloqueos: leer" on public.bloqueos_edicion;
create policy "bloqueos: leer" on public.bloqueos_edicion
  for select to authenticated using (true);
-- Se escribe solo con las funciones de abajo.
revoke insert, update, delete on public.bloqueos_edicion from anon, authenticated;
grant select on public.bloqueos_edicion to authenticated;

-- Tomar (o renovar) la edición de un registro. Devuelve quién la tiene.
create or replace function public.tomar_edicion(p_clave text, p_sesion text, p_usuario text, p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.bloqueos_edicion;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para editar.';
  end if;
  -- Ediciones abandonadas (sin señal hace más de 40 s).
  delete from public.bloqueos_edicion where latido < now() - interval '40 seconds';
  -- Una misma app edita un solo registro a la vez.
  delete from public.bloqueos_edicion where sesion = p_sesion and clave <> p_clave;

  insert into public.bloqueos_edicion (clave, sesion, usuario_id, usuario, nombre)
  values (p_clave, p_sesion, auth.uid(), p_usuario, p_nombre)
  on conflict (clave) do update
    set latido = now()
    where public.bloqueos_edicion.sesion = excluded.sesion;

  select * into r from public.bloqueos_edicion where clave = p_clave;
  return jsonb_build_object(
    'propio',  r.sesion = p_sesion,
    'sesion',  r.sesion,
    'usuario', r.usuario,
    'nombre',  r.nombre,
    'desde',   r.desde
  );
end;
$$;

-- Liberar la edición (al guardar, cerrar con la X o salir de la app).
-- p_clave null = liberar todo lo de esa app.
create or replace function public.soltar_edicion(p_sesion text, p_clave text default null)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.bloqueos_edicion
  where sesion = p_sesion and (p_clave is null or clave = p_clave) and auth.uid() is not null;
$$;

-- Ediciones en curso (para mostrar "✎ usuario" en las listas).
create or replace function public.ediciones_activas()
returns table (clave text, sesion text, usuario text, nombre text, desde timestamptz, edad_seg double precision)
language sql
stable
security definer
set search_path = public
as $$
  select b.clave, b.sesion, b.usuario, b.nombre, b.desde, extract(epoch from now() - b.latido)
  from public.bloqueos_edicion b
  where b.latido >= now() - interval '40 seconds' and auth.uid() is not null;
$$;

revoke all on function public.tomar_edicion(text, text, text, text) from public, anon;
revoke all on function public.soltar_edicion(text, text) from public, anon;
revoke all on function public.ediciones_activas() from public, anon;
grant execute on function public.tomar_edicion(text, text, text, text) to authenticated;
grant execute on function public.soltar_edicion(text, text) to authenticated;
grant execute on function public.ediciones_activas() to authenticated;

-- Aviso en tiempo real de los cambios de esta tabla.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bloqueos_edicion'
  ) then
    alter publication supabase_realtime add table public.bloqueos_edicion;
  end if;
end $$;
