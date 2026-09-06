# Invitación de Dilan y Laura — Vercel

Copia independiente de la invitación, preparada con Next.js, PostgreSQL/Neon y NextAuth.js.
Conserva el diseño aprobado, las fotografías, el audio y el formulario individual.
No utiliza el alojamiento ni el inicio de sesión de ChatGPT.

## Estado de la entrega

- La portada y el resto del diseño se pueden publicar sin variables privadas.
- Las confirmaciones requieren conectar una base Neon y ejecutar la migración.
- El panel queda cerrado hasta configurar el inicio de sesión GitHub y su lista de administradores.
- No se incluyen invitados, enlaces personalizados reales, contraseñas ni claves.
- Los avisos por correo son opcionales y requieren configurar Resend; un fallo de correo no anula una respuesta guardada.
- La fecha límite de respuesta es el final del 20 de septiembre de 2026, hora de Colombia.

## 1. Importar en Vercel

1. Importa este repositorio desde tu cuenta personal de GitHub.
2. Usa el nombre de proyecto deseado, por ejemplo `invitacion-dilan-laura` (la dirección depende de la disponibilidad).
3. Framework: **Next.js**. Root Directory: **raíz del repositorio**. Node.js: **22.x**.
4. Conserva los comandos automáticos: `npm ci` para instalar, `npm run build` para construir. No configures una carpeta Output Directory manualmente.
5. Publica y copia la dirección real asignada. Las vistas previas pueden estar protegidas: comprueba que el dominio de producción sea público para los invitados.
6. En Environment Variables, configura `SITE_URL` y `NEXTAUTH_URL` con esa dirección HTTPS (sin rutas) y vuelve a desplegar.

El primer despliegue muestra la invitación general. No distribuyas todavía enlaces personalizados.

## 2. Conectar las confirmaciones

En Vercel, abre **Storage / Marketplace**, elige **Neon**, revisa el plan y conecta una base PostgreSQL a este proyecto.
No hace falta contratar un plan de pago para preparar el proyecto; verifica los límites y el precio antes de aceptar cualquier alta.
La conexión puede quedar como `DATABASE_URL` o como `DATABASE_WEEDING_DATABASE_URL`, el nombre exacto creado por la integración de este proyecto. Ambas se leen solo en el servidor; configura la conexión en Production. No hace falta renombrar la integración ni copiar su contraseña al chat. El prefijo `WEEDING` se conserva tal como está en Vercel.
Si se configuran ambas variables, `DATABASE_URL` tiene prioridad tanto en la aplicación como en el script de migración. Deja una sola conexión configurada para evitar confusiones; no uses las variables de contraseña aislada ni las que terminan en `NO_SSL`. Vuelve a desplegar después de guardar variables.
No reutilices la base de producción para pruebas ni previews con datos reales.

Para preparar las tablas, descarga de forma segura las variables a `.env.local` con la herramienta de Vercel, o coloca allí tu conexión. Nunca la pegues en el chat ni la subas a GitHub.

```sh
npm ci
npm run db:migrate
```

El script registra la migración y es repetible: si ya se aplicó, no modifica los datos. Si existe una estructura no reconocida, se detiene. Las migraciones NO se ejecutan automáticamente durante cada build.
La consulta de confirmación utiliza `ON CONFLICT DO NOTHING`: una segunda respuesta no sustituye a la primera.

Los invitados se cargarán posteriormente desde **únicamente la pestaña principal del Excel corregido**. El Excel y la lista de enlaces deben permanecer fuera del repositorio. Cada enlace individual contiene un token aleatorio y la base guarda solo su hash SHA-256.

## 3. Activar el panel privado

Se usa GitHub OAuth únicamente para los administradores, no para los invitados.

1. Crea una **OAuth App** en tu cuenta GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.
2. Homepage URL: tu dirección pública real de Vercel.
3. Authorization callback URL: `https://TU-DIRECCION.vercel.app/api/auth/callback/github`.
4. Guarda Client ID y Client Secret en `GITHUB_ID` y `GITHUB_SECRET` de Vercel. No son el token del repositorio.
5. Configura `ADMIN_GITHUB_IDS` con el ID **numérico e inmutable** de tu cuenta GitHub. Se verifica en `https://api.github.com/users/TU-USUARIO`. Se pueden separar varios IDs con comas; sin una lista válida nadie entra.
6. Genera un secreto localmente y guárdalo únicamente en `NEXTAUTH_SECRET` de Vercel:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

7. Vuelve a desplegar y entra en `/admin`. El acceso a la descarga CSV también verifica la sesión y la lista autorizada.

La aplicación nunca confía en cabeceras de identidad enviadas por visitantes. Las sesiones duran ocho horas y se vuelve a comprobar la lista de administradores en cada consulta.

## 4. Avisos por correo (opcional)

Configura `RSVP_NOTIFY_TO`, `RSVP_EMAIL_FROM` y `RESEND_API_KEY`. El remitente debe estar autorizado por Resend.
Si todavía no tienes remitente, deja los avisos pendientes y consulta el panel. No se simula ningún correo enviado.

## Pruebas y desarrollo

```sh
npm ci
npm run dev
npm test
npm run lint
```

Las pruebas arrancan servidores locales con variables privadas vacías o credenciales ficticias que nunca se envían a GitHub. Verifican textos, archivos, sobre inicial, control de acceso y validación del formulario. Las consultas y la migración se prueban en un PostgreSQL local en memoria con datos ficticios, incluidas respuestas simultáneas y el corte de fecha dentro de SQL.
El flujo real de GitHub OAuth, la base Neon y los avisos deben comprobarse después de conectar esas cuentas, con invitados de prueba antes de cargar la lista definitiva.

## Referencias oficiales

- [Next.js en Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Almacenamiento e integraciones de Vercel](https://vercel.com/docs/storage)
- [Driver de Neon](https://github.com/neondatabase/serverless)
- [GitHub con NextAuth.js](https://next-auth.js.org/providers/github)

La copia original de Sites y su sitio público no se han modificado. Las guías Sites de construcción y alojamiento se usaron para conservar sus recursos y separar las dependencias específicas del proveedor.
