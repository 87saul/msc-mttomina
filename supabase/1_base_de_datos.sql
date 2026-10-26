-- =====================================================================
--  TRUCK SHOP — SCRIPT 1 DE 3: BASE DE DATOS COMPLETA
--  Cópialo COMPLETO y pégalo UNA sola vez en Supabase → SQL Editor → Run.
--  Crea todas las tablas, la seguridad, las funciones para administrar
--  usuarios desde la app y los datos iniciales (equipos, aceites, grupos).
--  Se puede volver a ejecutar sin perder datos.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Perfil de cada usuario (uno por cada cuenta de Authentication)
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '',
  usuario text unique,
  rol text not null default 'Técnico',
  cargo text,
  categoria text,          -- grupo: número de grupo, 'supervision', 'planificacion', 'lubrico' o 'admin'
  flota_grupo text,        -- flota del subgrupo (ACARREO, CARGUIO, '*' = todas)
  activo boolean not null default true,
  orden integer not null default 0,
  creado_en timestamptz not null default now()
);

-- Grupos de trabajo (Grupo 1, Grupo 2, ...)
create table if not exists public.grupos_trabajo (
  id integer primary key,
  nombre text not null,
  alcance text not null default 'separado',
  creado_en timestamptz not null default now()
);

-- Equipos y su flota
create table if not exists public.equipos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  flota text,
  modelo text not null default '',
  descripcion text not null default '',
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Catálogos de Configuración
create table if not exists public.tipos_aceite (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create table if not exists public.sistemas_equipo (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Ajustes generales de la app (aspecto, reportes, permisos, etc.)
create table if not exists public.configuracion (
  clave text primary key,
  valor jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);

-- Registro de trabajos de mantenimiento
create table if not exists public.trabajos (
  id uuid primary key default gen_random_uuid(),
  equipo text,
  flota text,
  tipo_trabajo text,
  sintoma_causa text,
  descripcion text,
  ubicacion text,
  fecha date,
  turno text,
  grupo integer,
  hora_inicio text,
  hora_fin text,
  estado_final text,
  participantes jsonb not null default '[]'::jsonb,
  observaciones text,
  marca text,
  extra jsonb not null default '{}'::jsonb,
  creado_en text,
  editado_en text,
  creado_por uuid default auth.uid(),
  registrado timestamptz not null default now()
);
create index if not exists trabajos_fecha_idx on public.trabajos (fecha);
create index if not exists trabajos_equipo_idx on public.trabajos (equipo);

-- Adiciones, cambios y derrames de aceite
create table if not exists public.aceites (
  id uuid primary key default gen_random_uuid(),
  equipo text,
  flota text,
  tipo_trabajo text,
  fecha date,
  turno text,
  tipo_operacion text,
  ubicacion text,
  grupo integer,
  tipo_aceite text,
  sistema_equipo text,
  cantidad_litros numeric,
  horometro numeric,
  hora_inicio text,
  hora_fin text,
  participantes jsonb not null default '[]'::jsonb,
  observaciones text,
  extra jsonb not null default '{}'::jsonb,
  creado_en text,
  editado_en text,
  creado_por uuid default auth.uid(),
  registrado timestamptz not null default now()
);
create index if not exists aceites_fecha_idx on public.aceites (fecha);

-- Requerimientos de repuestos (número automático REQ-001, REQ-002, ...)
create sequence if not exists public.requerimientos_numero_seq;
create table if not exists public.requerimientos (
  id text primary key default ('REQ-' || lpad(nextval('public.requerimientos_numero_seq')::text, 3, '0')),
  equipo text,
  flota text,
  numero_parte text,
  descripcion text,
  cantidad numeric,
  solicitante text,
  fecha_solicitud date,
  estado text not null default 'pendiente_aprobacion',
  extra jsonb not null default '{}'::jsonb,
  creado_en text,
  editado_en text,
  creado_por uuid default auth.uid(),
  registrado timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. FUNCIONES DE APOYO
-- ---------------------------------------------------------------------

-- ¿El usuario conectado es administrador?
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'Administrador' and activo from public.perfiles where id = auth.uid()), false);
$$;

-- ¿El usuario conectado está activo?
create or replace function public.usuario_activo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select activo from public.perfiles where id = auth.uid()), false);
$$;

-- Crea automáticamente el perfil cuando se registra una cuenta nueva
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := coalesce(new.raw_user_meta_data->>'usuario', split_part(new.email, '@', 1));
begin
  begin
    insert into public.perfiles (id, nombre, usuario, rol)
    values (new.id, coalesce(new.raw_user_meta_data->>'nombre', v_usuario), v_usuario, 'Técnico')
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.perfiles (id, nombre, usuario, rol)
    values (new.id, v_usuario, v_usuario || '-' || substr(new.id::text, 1, 4), 'Técnico')
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();

-- ---------------------------------------------------------------------
-- 3. ADMINISTRACIÓN DE USUARIOS DESDE LA APP
--    (solo el Administrador puede usarlas; no se necesitan claves secretas)
--    Cada usuario entra con su "usuario" (ej. GuidoC). Internamente se le
--    asigna el correo usuario@truckshop.app, que nadie necesita conocer.
-- ---------------------------------------------------------------------

-- Función interna (no se puede llamar desde la app)
create or replace function public._crear_usuario(
  p_usuario text, p_contrasena text, p_nombre text, p_rol text,
  p_cargo text, p_categoria text, p_flota_grupo text
) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_usuario text := trim(coalesce(p_usuario, ''));
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_usuario, ''))) || '@truckshop.app';
begin
  if v_usuario = '' then raise exception 'Escribe un usuario.'; end if;
  if v_usuario !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'El usuario solo puede tener letras, números, punto, guion o guion bajo (sin espacios ni tildes).';
  end if;
  if length(coalesce(p_contrasena, '')) < 6 then raise exception 'La contraseña debe tener al menos 6 caracteres.'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email)
     or exists (select 1 from public.perfiles where lower(usuario) = lower(v_usuario)) then
    raise exception 'El usuario % ya existe.', v_usuario;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_contrasena, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nombre', coalesce(p_nombre, v_usuario), 'usuario', v_usuario),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into public.perfiles (id, nombre, usuario, rol, cargo, categoria, flota_grupo, activo)
  values (v_id, coalesce(nullif(trim(p_nombre), ''), v_usuario), v_usuario, coalesce(nullif(p_rol, ''), 'Técnico'),
          p_cargo, p_categoria, p_flota_grupo, true)
  on conflict (id) do update set
    nombre = excluded.nombre, usuario = excluded.usuario, rol = excluded.rol, cargo = excluded.cargo,
    categoria = excluded.categoria, flota_grupo = excluded.flota_grupo, activo = true;

  return v_id;
end;
$$;
revoke execute on function public._crear_usuario(text, text, text, text, text, text, text) from public, anon, authenticated;

-- Crear un usuario (botón "Agregar" de Configuración)
create or replace function public.admin_crear_usuario(
  p_usuario text, p_contrasena text, p_nombre text, p_rol text,
  p_cargo text, p_categoria text, p_flota_grupo text
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede crear usuarios.'; end if;
  return public._crear_usuario(p_usuario, p_contrasena, p_nombre, p_rol, p_cargo, p_categoria, p_flota_grupo);
end;
$$;

-- Editar un usuario (y opcionalmente ponerle una contraseña nueva)
create or replace function public.admin_actualizar_usuario(
  p_id uuid, p_usuario text, p_nombre text, p_rol text, p_cargo text,
  p_categoria text, p_flota_grupo text, p_contrasena text default null
) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_usuario text := trim(coalesce(p_usuario, ''));
  v_email_actual text;
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede editar usuarios.'; end if;
  if v_usuario = '' then raise exception 'Escribe un usuario.'; end if;
  if v_usuario !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'El usuario solo puede tener letras, números, punto, guion o guion bajo (sin espacios ni tildes).';
  end if;
  if exists (select 1 from public.perfiles where lower(usuario) = lower(v_usuario) and id <> p_id) then
    raise exception 'El usuario % ya existe.', v_usuario;
  end if;

  select email into v_email_actual from auth.users where id = p_id;
  -- Solo las cuentas internas (@truckshop.app) cambian de correo al cambiar el usuario
  if v_email_actual like '%@truckshop.app' then
    if exists (select 1 from auth.users where lower(email) = lower(v_usuario) || '@truckshop.app' and id <> p_id) then
      raise exception 'El usuario % ya existe.', v_usuario;
    end if;
    update auth.users set email = lower(v_usuario) || '@truckshop.app', updated_at = now() where id = p_id;
    update auth.identities
       set identity_data = identity_data || jsonb_build_object('email', lower(v_usuario) || '@truckshop.app'), updated_at = now()
     where user_id = p_id and provider = 'email';
  end if;

  if coalesce(p_contrasena, '') <> '' then
    if length(p_contrasena) < 6 then raise exception 'La contraseña debe tener al menos 6 caracteres.'; end if;
    update auth.users set encrypted_password = extensions.crypt(p_contrasena, extensions.gen_salt('bf')), updated_at = now()
     where id = p_id;
  end if;

  update public.perfiles set
    usuario = v_usuario, nombre = coalesce(nullif(trim(p_nombre), ''), v_usuario),
    rol = case when rol = 'Administrador' then rol else coalesce(nullif(p_rol, ''), rol) end,
    cargo = p_cargo, categoria = case when rol = 'Administrador' then categoria else p_categoria end,
    flota_grupo = p_flota_grupo
  where id = p_id;
end;
$$;

-- Activar / desactivar un usuario (desactivado = no puede ingresar)
create or replace function public.admin_cambiar_activo(p_id uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede activar o desactivar usuarios.'; end if;
  if p_id = auth.uid() then raise exception 'No puedes desactivar tu propio usuario.'; end if;
  update public.perfiles set activo = p_activo where id = p_id;
  update auth.users set banned_until = case when p_activo then null else 'infinity'::timestamptz end where id = p_id;
end;
$$;

-- Eliminar un usuario
create or replace function public.admin_eliminar_usuario(p_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede eliminar usuarios.'; end if;
  if p_id = auth.uid() then raise exception 'No puedes eliminar tu propio usuario.'; end if;
  delete from auth.users where id = p_id;
end;
$$;

-- Renombrar una flota en todos los registros
create or replace function public.renombrar_flota(p_anterior text, p_nuevo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede renombrar flotas.'; end if;
  update public.equipos set flota = p_nuevo where flota = p_anterior;
  update public.trabajos set flota = p_nuevo where flota = p_anterior;
  update public.aceites set flota = p_nuevo where flota = p_anterior;
  update public.requerimientos set flota = p_nuevo where flota = p_anterior;
  update public.perfiles set flota_grupo = p_nuevo where flota_grupo = p_anterior;
  update public.grupos_trabajo set alcance = p_nuevo where alcance = p_anterior;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. SEGURIDAD (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.perfiles        enable row level security;
alter table public.grupos_trabajo  enable row level security;
alter table public.equipos         enable row level security;
alter table public.tipos_aceite    enable row level security;
alter table public.sistemas_equipo enable row level security;
alter table public.configuracion   enable row level security;
alter table public.trabajos        enable row level security;
alter table public.aceites         enable row level security;
alter table public.requerimientos  enable row level security;

do $$
declare t text;
begin
  -- Todos los usuarios conectados pueden LEER
  foreach t in array array['perfiles','grupos_trabajo','equipos','tipos_aceite','sistemas_equipo','configuracion','trabajos','aceites','requerimientos'] loop
    execute format('drop policy if exists "leer" on public.%I', t);
    execute format('create policy "leer" on public.%I for select to authenticated using (true)', t);
  end loop;

  -- Catálogos, grupos y configuración: solo el Administrador modifica
  foreach t in array array['grupos_trabajo','equipos','tipos_aceite','sistemas_equipo','configuracion'] loop
    execute format('drop policy if exists "admin modifica" on public.%I', t);
    execute format('create policy "admin modifica" on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;

  -- Registros del taller: cualquier usuario activo registra y edita
  -- (lo que cada rol puede hacer se controla en Configuración → Roles y permisos)
  foreach t in array array['trabajos','aceites','requerimientos'] loop
    execute format('drop policy if exists "activos insertan" on public.%I', t);
    execute format('drop policy if exists "activos editan" on public.%I', t);
    execute format('drop policy if exists "activos eliminan" on public.%I', t);
    execute format('create policy "activos insertan" on public.%I for insert to authenticated with check (public.usuario_activo())', t);
    execute format('create policy "activos editan" on public.%I for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo())', t);
    execute format('create policy "activos eliminan" on public.%I for delete to authenticated using (public.usuario_activo())', t);
  end loop;
end $$;

-- Perfiles: solo el Administrador los edita (nadie puede cambiarse su propio rol)
drop policy if exists "admin edita perfiles" on public.perfiles;
create policy "admin edita perfiles" on public.perfiles for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- La pantalla de inicio de sesión puede ver el nombre y logo de la app
drop policy if exists "aspecto publico" on public.configuracion;
create policy "aspecto publico" on public.configuracion for select to anon using (clave = 'aspecto');

-- ---------------------------------------------------------------------
-- 5. DATOS INICIALES
-- ---------------------------------------------------------------------
insert into public.configuracion (clave, valor) values
  ('flotas', '{"todas":["ACARREO","CARGUIO"],"inactivas":[]}'::jsonb)
on conflict (clave) do nothing;

insert into public.grupos_trabajo (id, nombre, alcance) values
  (1, 'Grupo 1', 'separado'), (2, 'Grupo 2', 'separado'), (3, 'Grupo 3', 'separado'), (4, 'Grupo 4', 'separado')
on conflict (id) do nothing;

insert into public.tipos_aceite (nombre)
select v from (values ('15W40'), ('SAE 10'), ('SAE 30'), ('SAE 50W'), ('UnivisN46'), ('Refrigerante')) as x(v)
where not exists (select 1 from public.tipos_aceite);

insert into public.sistemas_equipo (nombre)
select v from (values ('Motor'), ('Sistema hidráulico'), ('Diferencial trasero'), ('Diferencial delantero'), ('Transmisión'), ('Mandos finales')) as x(v)
where not exists (select 1 from public.sistemas_equipo);

insert into public.equipos (codigo, flota, modelo, descripcion) values
  ('101', 'CARGUIO', 'PC4000', 'EXCAVADORA'),
  ('102', 'CARGUIO', 'PC4000', 'PALA'),
  ('103', 'CARGUIO', 'PC4000', 'PALA'),
  ('104', 'CARGUIO', 'PC4000', 'PALA'),
  ('105', 'CARGUIO', 'PC8000', 'PALA'),
  ('106', 'CARGUIO', 'PC8000', 'PALA'),
  ('107', 'CARGUIO', '349D2L', 'EXCAVADORA'),
  ('108', 'CARGUIO', '336D2L', 'EXCAVADORA'),
  ('109', 'CARGUIO', '336D2L', 'EXCAVADORA'),
  ('202', 'ACARREO', '785C', 'AGUATERO'),
  ('203', 'ACARREO', '785C', 'AGUATERO'),
  ('210', 'ACARREO', '789C', 'CAMION'),
  ('211', 'ACARREO', '789C', 'CAMION'),
  ('212', 'ACARREO', '789C', 'CAMION'),
  ('213', 'ACARREO', '789C', 'CAMION'),
  ('214', 'ACARREO', '789C', 'CAMION'),
  ('215', 'ACARREO', '789C', 'CAMION'),
  ('216', 'ACARREO', '789C', 'CAMION'),
  ('217', 'ACARREO', '789C', 'CAMION'),
  ('218', 'ACARREO', '789C', 'CAMION'),
  ('219', 'ACARREO', '789C', 'CAMION'),
  ('220', 'ACARREO', '789C', 'CAMION'),
  ('221', 'ACARREO', '789C', 'CAMION'),
  ('222', 'ACARREO', '789C', 'CAMION'),
  ('223', 'ACARREO', '789C', 'CAMION'),
  ('224', 'ACARREO', '789C', 'CAMION'),
  ('225', 'ACARREO', '789C', 'CAMION'),
  ('226', 'ACARREO', '789C', 'CAMION'),
  ('227', 'ACARREO', '789C', 'TRACTO'),
  ('228', 'ACARREO', '789C', 'CAMION'),
  ('229', 'ACARREO', '789C', 'AGUATERO'),
  ('230', 'ACARREO', '789C', 'CAMION'),
  ('231', 'ACARREO', '789C', 'CAMION'),
  ('232', 'ACARREO', '789C', 'CAMION'),
  ('233', 'ACARREO', '789C', 'CAMION'),
  ('234', 'ACARREO', '793D', 'CAMION'),
  ('235', 'ACARREO', '793D', 'CAMION'),
  ('236', 'ACARREO', '793D', 'CAMION'),
  ('237', 'ACARREO', '793D', 'CAMION'),
  ('238', 'ACARREO', '793D', 'CAMION'),
  ('239', 'ACARREO', '793D', 'CAMION'),
  ('240', 'ACARREO', '793D', 'CAMION'),
  ('241', 'ACARREO', '793D', 'CAMION'),
  ('242', 'ACARREO', '793D', 'CAMION'),
  ('243', 'ACARREO', '793D', 'CAMION'),
  ('303', 'CARGUIO', '988F', 'MANIPULADOR DE LLANTAS'),
  ('305', 'CARGUIO', '7600SBA', 'MANIPULADOR DE LLANTAS'),
  ('306', 'CARGUIO', 'MHT10210', 'MANIPULADOR DE CILINDROS'),
  ('401', 'ACARREO', 'D10R', 'TRACTOR'),
  ('402', 'ACARREO', 'D10R', 'TRACTOR'),
  ('403', 'ACARREO', 'D10R', 'TRACTOR'),
  ('404', 'ACARREO', '', ''),
  ('408', 'CARGUIO', '834H', 'TRACTOR CON RUEDAS'),
  ('409', 'CARGUIO', '834H', 'TRACTOR CON RUEDAS'),
  ('410', 'CARGUIO', '834H', 'TRACTOR CON RUEDAS'),
  ('411', 'CARGUIO', '834H', 'TRACTOR CON RUEDAS'),
  ('412', 'CARGUIO', '834H', 'TRACTOR CON RUEDAS'),
  ('415', 'ACARREO', '', ''),
  ('416', 'ACARREO', 'D10T', 'TRACTOR'),
  ('417', 'ACARREO', 'D10T2', 'TRACTOR'),
  ('418', 'ACARREO', 'D10T', 'TRACTOR'),
  ('419', 'ACARREO', 'D10T', 'TRACTOR'),
  ('420', 'ACARREO', 'D10T', 'TRACTOR'),
  ('421', 'ACARREO', 'D10T', 'TRACTOR'),
  ('422', 'ACARREO', 'D10T', 'TRACTOR'),
  ('501', 'CARGUIO', '994D', 'CARGADOR FRONTAL'),
  ('502', 'CARGUIO', '994D', 'CARGADOR FRONTAL'),
  ('503', 'CARGUIO', '994F', 'CARGADOR FRONTAL'),
  ('504', 'CARGUIO', '992G', 'CARGADOR FRONTAL'),
  ('505', 'CARGUIO', '994F', 'CARGADOR FRONTAL'),
  ('506', 'CARGUIO', '980H', 'CARGADOR FRONTAL'),
  ('507', 'CARGUIO', '980L', 'CARGADOR FRONTAL'),
  ('508', 'CARGUIO', '980L', 'CARGADOR FRONTAL'),
  ('601', 'ACARREO', '16H', 'MOTONIVELADORA'),
  ('602', 'ACARREO', '16H', 'MOTONIVELADORA'),
  ('603', 'ACARREO', '16M', 'MOTONIVELADORA'),
  ('604', 'ACARREO', '16M', 'MOTONIVELADORA'),
  ('605', 'ACARREO', '16M', 'MOTONIVELADORA'),
  ('702', 'CARGUIO', 'D65LF', 'PERFORADORA'),
  ('703', 'CARGUIO', '', ''),
  ('704', 'CARGUIO', 'PV271', 'PERFORADORA'),
  ('705', 'CARGUIO', 'PV271', 'PERFORADORA'),
  ('706', 'CARGUIO', 'PV271', 'PERFORADORA'),
  ('708', 'CARGUIO', 'PV351D', 'PERFORADORA'),
  ('709', 'CARGUIO', 'PV351D', 'PERFORADORA'),
  ('710', 'CARGUIO', '', ''),
  ('901', 'CARGUIO', 'JQ1165', 'CHANCADOR MOVIL'),
  ('902', 'CARGUIO', 'ST8036', 'CORREA TRANSPORTADORA'),
  ('903', 'CARGUIO', 'ST4032', 'CORREA TRANSPORTADORA'),
  ('905', 'CARGUIO', 'ST2.8', 'CLASIFICADOR'),
  ('906', 'CARGUIO', 'ST2.8', 'CLASIFICADOR'),
  ('907', 'CARGUIO', 'ST2.8', 'CLASIFICADOR'),
  ('P-023', 'CARGUIO', 'CS563D', 'RODILLO'),
  ('P-039', 'ACARREO', 'D10R', 'TRACTOR'),
  ('P-040', 'ACARREO', 'D10R', 'TRACTOR'),
  ('P-086', 'CARGUIO', '', '')
on conflict (codigo) do nothing;

-- Listo. Ahora ejecuta el SCRIPT 2 (administrador).
