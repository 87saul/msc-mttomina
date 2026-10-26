# TRUCK SHOP — Guía de instalación

Esta guía explica, paso a paso y sin tecnicismos, cómo dejar funcionando la aplicación con su base de datos real.

Vas a usar dos servicios gratuitos:

- **Supabase** guarda los datos: trabajos, aceites, requerimientos, personal y equipos.
- **Netlify** publica la aplicación en internet, con una dirección como `truck-shop.netlify.app`.

La misma aplicación funciona en computadora y en celular. En el celular se puede instalar como app: desde el navegador elige "Agregar a pantalla de inicio".

---

## Lo que trae esta carpeta

| Archivo o carpeta | Para qué sirve |
|---|---|
| `supabase/1_base_de_datos.sql` | Crea toda la base de datos. Se pega **una sola vez** en Supabase. |
| `supabase/2_administrador.sql` | Convierte en Administrador al usuario que creas en Supabase. |
| `supabase/3_personal_inicial_opcional.sql` | **Opcional.** Crea las cuentas de las 99 personas del taller. |
| `src/` | El código de la aplicación. No necesitas tocarlo. |
| `netlify.toml` y `public/_redirects` | Ajustes para que Netlify no muestre la página en blanco al refrescar. |
| `.env.example` | Modelo de las dos variables de conexión. |

**No hace falta crear "buckets" (carpetas de almacenamiento)**. La app no guarda fotos ni archivos: el logo se guarda dentro de la configuración.

---

## PARTE 1 — Supabase (la base de datos)

### Paso 1. Crear el proyecto
1. Entra a https://supabase.com e inicia sesión.
2. Pulsa **New project**.
3. Ponle un nombre, por ejemplo `truck-shop`.
4. Escribe una contraseña para la base de datos y guárdala en un lugar seguro. La app no la usa, pero Supabase la pide.
5. Elige la región más cercana, por ejemplo *South America (São Paulo)*, y pulsa **Create new project**.
6. Espera uno o dos minutos a que termine de crearse.

### Paso 2. Crear la base de datos (Script 1)
1. En el menú de la izquierda entra a **SQL Editor**.
2. Pulsa **New query**.
3. Abre el archivo `supabase/1_base_de_datos.sql`, copia **todo** su contenido y pégalo.
4. Pulsa **Run**. Debe aparecer *"Success. No rows returned"*.

Con eso quedan creadas las tablas, la seguridad y los datos iniciales: los 96 equipos, los tipos de aceite, los sistemas y los grupos 1 a 4.

### Paso 3. Crear el usuario Administrador
1. En el menú de la izquierda entra a **Authentication** → **Users**.
2. Pulsa **Add user** → **Create new user**.
3. Escribe **tu correo** y **tu contraseña** (mínimo 6 caracteres).
4. Marca la casilla **Auto Confirm User** y pulsa **Create user**.

### Paso 4. Darle permisos de Administrador (Script 2)
1. Vuelve a **SQL Editor** → **New query**.
2. Pega el contenido de `supabase/2_administrador.sql`.
3. En la línea que dice `'admin@tuempresa.com'`, **cambia ese correo por el que usaste en el Paso 3**. Deja las comillas.
4. Pulsa **Run**. Debe aparecer *"Success"*. Si en cambio sale el mensaje *"No existe ningún usuario con el correo…"*, revisa que el correo esté bien escrito.

### Paso 5 (opcional). Cargar el personal del taller (Script 3)
Si quieres que las 99 personas de la lista ya tengan su cuenta:
1. **SQL Editor** → **New query** → pega `supabase/3_personal_inicial_opcional.sql` → **Run**.
2. Cada persona entra con **su usuario** (por ejemplo `GuidoC`, `QuintinC`) y la contraseña provisional **`Ts2026*`**.
3. Recomendación: pide a cada persona que cambie su contraseña en el menú **⋮ → Cambiar contraseña**.

Si no ejecutas este paso, puedes crear al personal desde la app, en **Configuración**.

### Paso 6. Copiar los dos datos de conexión
1. En Supabase pulsa **Connect** (arriba), o entra a **Project Settings** → **API**.
2. Copia estos dos datos:
   - **Project URL**: se ve como `https://abcdxyz.supabase.co`.
   - **Publishable key**: empieza con `sb_publishable_…`. Si tu proyecto muestra la clave antigua, usa la **anon public**, que empieza con `eyJ…`.

⚠️ **Nunca** uses la clave llamada *secret* o *service_role*.

---

## PARTE 2 — Netlify (publicar la app)

La forma de subir el código (por ejemplo, a través de GitHub) la ves en tu guía aparte. Aquí solo van los ajustes que necesita esta app.

### Paso 7. Escribir las dos variables
1. En Netlify abre tu sitio → **Site configuration** → **Environment variables**.
2. Pulsa **Add a variable** y crea estas dos:

| Nombre (escríbelo exactamente así) | Valor |
|---|---|
| `VITE_SUPABASE_URL` | La **Project URL** del Paso 6 |
| `VITE_SUPABASE_ANON_KEY` | La **Publishable key** (o anon key) del Paso 6 |

3. Entra a **Deploys** → **Trigger deploy** → **Deploy site** para publicar con los datos nuevos.

Los ajustes de publicación ya vienen en `netlify.toml`. Si Netlify los pide, son: comando `npm run build` y carpeta `dist`.

### Paso 8. Comprobar que todo funciona
1. Abre la dirección de tu sitio. Debe aparecer la pantalla de inicio de sesión.
2. Ingresa con **tu correo** y **tu contraseña** de Administrador.
3. Entra directo a una página interna, por ejemplo `tu-sitio.netlify.app/trabajos`, y **refresca**. No debe quedar en blanco.
4. Prueba los roles:
   - Entra a **Configuración** y, en un grupo, pulsa **Agregar** para crear un usuario de prueba con su contraseña.
   - Cierra sesión (⋮ → Salir) y entra con ese usuario nuevo. Debe ver solo lo que su rol permite; por ejemplo, un Técnico no ve Configuración.

---

## Cómo se usa el día a día

- **Iniciar sesión:**
  - El personal escribe solo su **usuario** (por ejemplo `GuidoC`), sin correo.
  - El Administrador puede escribir su correo.
- **Crear personal:** **Configuración** → el cuadro del grupo → **Agregar**. Ahí se ponen nombre, usuario, contraseña, grupo, cargo y rol.
- **Contraseñas:**
  - Nadie puede ver las contraseñas, ni siquiera el Administrador. Así lo exige la seguridad de Supabase.
  - Si alguien olvida la suya, el Administrador edita la fila de esa persona (ícono de lápiz) y escribe una **contraseña nueva**.
  - Cada usuario puede cambiar la suya en **⋮ → Cambiar contraseña**.
- **Desactivar a alguien:** pulsa su botón **Activo**. Desde ese momento ya no puede ingresar, y sus registros se conservan.
- **Ajustes de la app** (color, logo, nombre, permisos, reportes): los cambia el Administrador en **Configuración** y se guardan solos para todos.
- **Ver lo que registraron otros:** usa **⋮ → Actualizar**, o vuelve a abrir la app.

---

## Problemas comunes

| Lo que ves | Qué hacer |
|---|---|
| "Falta conectar la base de datos" | Faltan las dos variables en Netlify (Paso 7). Escríbelas y vuelve a publicar con **Trigger deploy**. |
| "Usuario o contraseña incorrectos" | Revisa mayúsculas y minúsculas de la contraseña. El usuario no distingue mayúsculas. |
| "Tu usuario no tiene un perfil…" | Ejecuta el Script 2 con el correo correcto (Paso 4). |
| "No tienes permiso para realizar esta acción" | Esa acción solo la puede hacer el Administrador. |
| La página queda en blanco al refrescar | Comprueba que `netlify.toml` está en la carpeta principal del proyecto. |
| Un usuario nuevo no puede entrar | Revisa que esté **Activo** en Configuración y que la contraseña tenga al menos 6 caracteres. |

---

## Nota técnica (para quien mantenga el sistema)

- **Tecnología:** React 18 + TypeScript + Vite, con React Router para las rutas `/inicio`, `/trabajos`, `/aceites`, `/requerimientos`, `/historial` y `/configuracion`. Los datos van a Supabase (Auth + Postgres con Row Level Security).
- **Solo se usa la clave publishable/anon.** No hay `service_role` ni Edge Functions.
- **Gestión de usuarios:** las cuentas se crean y administran con funciones SQL (`admin_crear_usuario`, `admin_actualizar_usuario`, `admin_cambiar_activo`, `admin_eliminar_usuario`). Antes de actuar, cada función verifica que quien la llama sea Administrador.
  - Escriben directamente en las tablas internas de Supabase Auth. Es una técnica muy usada, pero no es una vía oficial: si Supabase cambiara esas tablas en el futuro, habría que ajustar las funciones.
  - Con este método no hace falta configurar correos ni confirmaciones.
- **Correo interno:** cada usuario del personal tiene el correo `usuario@truckshop.app`. Lo maneja la app y nadie lo usa para escribir.
- **Permisos de escritura en la base de datos:**
  - Trabajos, aceites y requerimientos: cualquier usuario activo puede registrarlos y editarlos. Lo que ve y hace cada rol lo controla la app según **Configuración → Roles y permisos**.
  - Catálogos, grupos, equipos, configuración y perfiles: solo el Administrador.
