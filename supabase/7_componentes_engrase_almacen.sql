-- =====================================================================
-- TRUCK SHOP — Componentes, Engrase y Almacén
-- Pegar UNA vez en Supabase → SQL Editor → Run. Se puede volver a ejecutar.
--
--  * Componentes: horas de los componentes de cada equipo. El Administrador
--    las actualiza subiendo el Excel desde la app (pestaña Componentes).
--  * Almacén: inventario del almacén. El Administrador lo actualiza
--    subiendo el Excel desde la app (Requerimientos → botón de la caja).
--  * Engrase: inspecciones del sistema de lubricación de cada equipo.
--
-- Cada Excel se sube por partes y se activa al final de una sola vez: si la
-- carga se corta a medio camino, se sigue viendo el inventario anterior.
-- No usa claves secretas ni funciones externas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Última carga de cada Excel ("componentes" / "inventario")
create table if not exists public.importaciones (
  tipo       text primary key,
  lote       uuid not null,
  archivo    text,
  filas      integer not null default 0,
  usuario    text,
  fecha      timestamptz not null default now()
);

-- Horas de componentes (una fila por equipo y componente)
create table if not exists public.horas_componentes (
  id               bigint generated always as identity primary key,
  lote             uuid not null,
  modelo           text not null,          -- hoja del Excel (793D, 789C, D10T…)
  equipo           text not null,
  componente       text not null,
  horas            numeric,                -- vacío = nunca se cambió
  orden_equipo     integer not null default 0,
  orden_componente integer not null default 0
);
create index if not exists horas_componentes_lote_idx on public.horas_componentes (lote);

-- Inventario de almacén
create table if not exists public.inventario (
  id                   bigint generated always as identity primary key,
  lote                 uuid not null,
  numero_parte         text,
  descripcion          text,
  detalle              text,
  segundo_numero       text,
  unidad               text,
  cantidad_disponible  numeric,
  cantidad_neta        numeric,
  cantidad_comprometida numeric,
  cantidad_recepcion   numeric,
  cantidad_oc          numeric,
  numero_corto         text,
  ubicacion            text,
  -- número de parte sin guiones ni espacios, en mayúsculas (para buscar)
  np_normal            text generated always as (upper(regexp_replace(coalesce(numero_parte, ''), '[^A-Za-z0-9]', '', 'g'))) stored
);
create index if not exists inventario_lote_np_idx on public.inventario (lote, np_normal);

-- Inspecciones de engrase (sistema de lubricación)
create table if not exists public.engrases (
  id           uuid primary key default gen_random_uuid(),
  equipo       text not null,
  flota        text,
  fecha        date not null,                -- fecha de ingreso
  turno        text,                         -- 'dia' | 'noche'
  resultado    text not null default 'ok',   -- 'ok' | 'falla'
  comentario   text,
  inspector    text,                         -- personal que registró
  extra        jsonb not null default '{}'::jsonb,  -- reparación: estado, fecha, usuario
  creado_en    text,
  editado_en   text,
  creado_por   uuid default auth.uid(),
  registrado   timestamptz not null default now()
);
alter table public.engrases add column if not exists turno text;
create index if not exists engrases_equipo_fecha_idx on public.engrases (equipo, fecha);

-- Frecuencia de inspección de engrase de cada equipo (en días)
create table if not exists public.engrase_frecuencias (
  equipo          text primary key,
  dias            integer not null check (dias > 0),
  actualizado_por text,
  actualizado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. SEGURIDAD
-- ---------------------------------------------------------------------
alter table public.importaciones     enable row level security;
alter table public.horas_componentes enable row level security;
alter table public.inventario        enable row level security;
alter table public.engrases          enable row level security;
alter table public.engrase_frecuencias enable row level security;

-- Todos los usuarios conectados pueden leer
do $$
declare t text;
begin
  foreach t in array array['importaciones', 'horas_componentes', 'inventario', 'engrases', 'engrase_frecuencias'] loop
    execute format('drop policy if exists "leer" on public.%I', t);
    execute format('create policy "leer" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Componentes e inventario: solo se escriben con las funciones de abajo
-- (que verifican que sea el Administrador).
revoke insert, update, delete on public.importaciones, public.horas_componentes, public.inventario from anon, authenticated;
grant select on public.importaciones, public.horas_componentes, public.inventario to authenticated;

-- Engrase: cualquier usuario activo registra (lo que cada rol puede hacer
-- se controla en Configuración → Roles y permisos)
drop policy if exists "activos insertan" on public.engrases;
drop policy if exists "activos editan" on public.engrases;
drop policy if exists "activos eliminan" on public.engrases;
create policy "activos insertan" on public.engrases for insert to authenticated with check (public.usuario_activo());
create policy "activos editan" on public.engrases for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "activos eliminan" on public.engrases for delete to authenticated using (public.usuario_activo());
grant select, insert, update, delete on public.engrases to authenticated;

drop policy if exists "activos insertan" on public.engrase_frecuencias;
drop policy if exists "activos editan" on public.engrase_frecuencias;
drop policy if exists "activos eliminan" on public.engrase_frecuencias;
create policy "activos insertan" on public.engrase_frecuencias for insert to authenticated with check (public.usuario_activo());
create policy "activos editan" on public.engrase_frecuencias for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "activos eliminan" on public.engrase_frecuencias for delete to authenticated using (public.usuario_activo());
grant select, insert, update, delete on public.engrase_frecuencias to authenticated;

-- ---------------------------------------------------------------------
-- 3. CARGA DE LOS EXCEL (solo Administrador)
-- ---------------------------------------------------------------------

-- Sube una parte de las filas (la app envía de a 1000).
create or replace function public.importar_lote(p_tipo text, p_lote uuid, p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede actualizar estos datos.';
  end if;
  if p_lote is null then raise exception 'Falta el lote.'; end if;

  if p_tipo = 'componentes' then
    insert into public.horas_componentes (lote, modelo, equipo, componente, horas, orden_equipo, orden_componente)
    select p_lote, trim(f->>'modelo'), trim(f->>'equipo'), trim(f->>'componente'),
           nullif(f->>'horas', '')::numeric,
           coalesce((f->>'orden_equipo')::integer, 0), coalesce((f->>'orden_componente')::integer, 0)
    from jsonb_array_elements(p_filas) f
    where coalesce(trim(f->>'equipo'), '') <> '' and coalesce(trim(f->>'componente'), '') <> '';
  elsif p_tipo = 'inventario' then
    insert into public.inventario (lote, numero_parte, descripcion, detalle, segundo_numero, unidad,
      cantidad_disponible, cantidad_neta, cantidad_comprometida, cantidad_recepcion, cantidad_oc, numero_corto, ubicacion)
    select p_lote, trim(f->>'numero_parte'), f->>'descripcion', f->>'detalle', f->>'segundo_numero', f->>'unidad',
           nullif(f->>'cantidad_disponible', '')::numeric, nullif(f->>'cantidad_neta', '')::numeric,
           nullif(f->>'cantidad_comprometida', '')::numeric, nullif(f->>'cantidad_recepcion', '')::numeric,
           nullif(f->>'cantidad_oc', '')::numeric, f->>'numero_corto', f->>'ubicacion'
    from jsonb_array_elements(p_filas) f
    where coalesce(trim(f->>'numero_parte'), '') <> '';
  else
    raise exception 'Tipo de carga desconocido: %', p_tipo;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Activa la carga completa (reemplaza los datos anteriores de una vez).
create or replace function public.confirmar_importacion(p_tipo text, p_lote uuid, p_archivo text, p_usuario text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas integer;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede actualizar estos datos.';
  end if;
  if p_tipo = 'componentes' then
    select count(*) into v_filas from public.horas_componentes where lote = p_lote;
    if v_filas = 0 then raise exception 'El archivo no tiene datos de componentes.'; end if;
    delete from public.horas_componentes where lote <> p_lote;
  elsif p_tipo = 'inventario' then
    select count(*) into v_filas from public.inventario where lote = p_lote;
    if v_filas = 0 then raise exception 'El archivo no tiene datos de inventario.'; end if;
    delete from public.inventario where lote <> p_lote;
  else
    raise exception 'Tipo de carga desconocido: %', p_tipo;
  end if;

  insert into public.importaciones (tipo, lote, archivo, filas, usuario, fecha)
  values (p_tipo, p_lote, p_archivo, v_filas, p_usuario, now())
  on conflict (tipo) do update
    set lote = excluded.lote, archivo = excluded.archivo, filas = excluded.filas,
        usuario = excluded.usuario, fecha = excluded.fecha;
  return v_filas;
end;
$$;

-- Descarta una carga que no se terminó (por ejemplo, si se cortó la conexión).
create or replace function public.descartar_importacion(p_tipo text, p_lote uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then return; end if;
  if exists (select 1 from public.importaciones where tipo = p_tipo and lote = p_lote) then return; end if;
  if p_tipo = 'componentes' then delete from public.horas_componentes where lote = p_lote; end if;
  if p_tipo = 'inventario' then delete from public.inventario where lote = p_lote; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. BÚSQUEDA EN EL ALMACÉN (por número de parte)
--    Busca en el número de parte (con o sin guiones), en el 2do número y
--    en el detalle (donde suelen ir los números alternos). Primero los
--    que coinciden exactamente.
-- ---------------------------------------------------------------------
create or replace function public.buscar_inventario(p_texto text)
returns setof public.inventario
language sql
stable
security definer
set search_path = public
as $$
  with activo as (select lote from public.importaciones where tipo = 'inventario'),
  q as (
    select upper(regexp_replace(coalesce(p_texto, ''), '[^A-Za-z0-9]', '', 'g')) as n,
           upper(trim(coalesce(p_texto, ''))) as t
  )
  select i.*
  from public.inventario i, activo a, q
  where auth.uid() is not null
    and i.lote = a.lote
    and length(q.n) >= 2
    and (
      i.np_normal like '%' || q.n || '%'
      or upper(regexp_replace(coalesce(i.segundo_numero, ''), '[^A-Za-z0-9]', '', 'g')) like '%' || q.n || '%'
      or upper(coalesce(i.detalle, '')) like '%' || q.t || '%'
    )
  order by
    (i.np_normal = q.n) desc,
    (upper(regexp_replace(coalesce(i.segundo_numero, ''), '[^A-Za-z0-9]', '', 'g')) = q.n) desc,
    (i.np_normal like q.n || '%') desc,
    i.numero_parte
  limit 40;
$$;

revoke all on function public.importar_lote(text, uuid, jsonb) from public, anon;
revoke all on function public.confirmar_importacion(text, uuid, text, text) from public, anon;
revoke all on function public.descartar_importacion(text, uuid) from public, anon;
revoke all on function public.buscar_inventario(text) from public, anon;
grant execute on function public.importar_lote(text, uuid, jsonb) to authenticated;
grant execute on function public.confirmar_importacion(text, uuid, text, text) to authenticated;
grant execute on function public.descartar_importacion(text, uuid) to authenticated;
grant execute on function public.buscar_inventario(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. TIEMPO REAL para Engrase (las inspecciones aparecen sin actualizar)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'engrases'
  ) then
    alter publication supabase_realtime add table public.engrases;
  end if;
end $$;

-- Comprobación: deben aparecer las 5 tablas nuevas.
select table_name as "Tablas creadas"
from information_schema.tables
where table_schema = 'public'
  and table_name in ('importaciones', 'horas_componentes', 'inventario', 'engrases', 'engrase_frecuencias')
order by table_name;
