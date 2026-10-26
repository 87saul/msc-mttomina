-- =====================================================================
--  TRUCK SHOP — SCRIPT 2 DE 3: CONVERTIR EN ADMINISTRADOR
--  Antes de ejecutarlo crea el usuario en Supabase → Authentication →
--  Users → "Add user" → "Create new user" (correo + contraseña, y marca
--  "Auto Confirm User").
--  Luego reemplaza el correo de abajo por ESE MISMO correo y pulsa Run.
-- =====================================================================

do $$
declare
  v_correo text := 'admin@tuempresa.com';   -- <<< ESCRIBE AQUÍ TU CORREO
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(v_correo));
  if v_id is null then
    raise exception 'No existe ningún usuario con el correo % en Authentication. Revisa que esté bien escrito.', v_correo;
  end if;

  insert into public.perfiles (id, nombre, usuario, rol, cargo, categoria, activo)
  values (v_id, 'Administrador', 'admin', 'Administrador', 'Administrador', 'admin', true)
  on conflict (id) do update set
    rol = 'Administrador', cargo = 'Administrador', categoria = 'admin', activo = true;

  update auth.users set banned_until = null, email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_id;
  raise notice 'Listo: % ahora es Administrador.', v_correo;
end $$;
