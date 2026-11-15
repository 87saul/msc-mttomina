-- =====================================================================
--  TRUCK SHOP — 8. BASE CERO PUEDE CARGAR LOS EXCEL
--  El personal del grupo "Base Cero" (y quien se agregue después a ese
--  grupo) puede cargar los Excel que actualizan la app: horas de
--  componentes, inventario de almacén y los que se agreguen.
--  Pégalo UNA vez en Supabase → SQL Editor → Run. Se puede volver a
--  ejecutar sin problema.
-- =====================================================================

-- ¿El usuario conectado puede cargar Excel? Administrador o personal
-- activo del grupo "Base Cero" (sin importar mayúsculas ni tildes).
create or replace function public.puede_importar()
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_admin() or coalesce((
    select p.activo
    from public.perfiles p
    join public.grupos_trabajo g on g.id::text = p.categoria
    where p.id = auth.uid()
      and trim(regexp_replace(lower(translate(g.nombre, 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')), '\s+', ' ', 'g')) = 'base cero'
    limit 1
  ), false);
$$;

create or replace function public.importar_lote(p_tipo text, p_lote uuid, p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
begin
  if not public.puede_importar() then
    raise exception 'Solo el administrador o el personal de Base Cero puede actualizar estos datos.';
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
  if not public.puede_importar() then
    raise exception 'Solo el administrador o el personal de Base Cero puede actualizar estos datos.';
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
  if not public.puede_importar() then return; end if;
  if exists (select 1 from public.importaciones where tipo = p_tipo and lote = p_lote) then return; end if;
  if p_tipo = 'componentes' then delete from public.horas_componentes where lote = p_lote; end if;
  if p_tipo = 'inventario' then delete from public.inventario where lote = p_lote; end if;
end;
$$;
