# Despliegue del servidor en Render (plan gratuito)

Solo se despliega `server/` (NestJS). La app de escritorio sigue siendo Tauri y apunta a la URL pública del servicio.
`render.yaml` en la raíz describe el servicio; ningún valor secreto vive en el repositorio.

## 1. Crear el servicio

1. En Render: **New > Blueprint**, conecta el repositorio y elige la rama a desplegar. Render lee `render.yaml`.
   (Alternativa manual: **New > Web Service**, runtime Node, plan Free, y copia los comandos de abajo.)
2. Comandos (ya están en `render.yaml`):
   - Build: `npm ci --include=dev && npm run build --workspace @vision2code/server` (compila contratos, ejecuta `prisma generate` y `tsc`).
   - Start: `npm run start:prod --workspace @vision2code/server` (ejecuta `prisma migrate deploy` y después `node dist/main.js`).
   - Health check path: `/api/v1/health`.
3. Rellena en el panel las variables marcadas `sync: false` (tabla siguiente). Render define `PORT` solo.
4. Despliega y espera a que el estado sea **Live**.

## 2. Variables de entorno

| Nombre | Para qué sirve | Obligatoria | Dónde se obtiene |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Origen del proyecto Supabase; el servidor verifica los JWT contra su JWKS. Sin ella el servidor no arranca. | Sí | Supabase > Project Settings > API (Project URL) |
| `DATABASE_URL` | Conexión de la aplicación a Postgres. En Supabase, el **pooler** (Supavisor, modo transacción, puerto 6543, con `?pgbouncer=true`). | Sí | Supabase > Connect > Transaction pooler |
| `DIRECT_URL` | Conexión usada solo por `prisma migrate deploy`. Conexión directa (puerto 5432) o Session pooler; nunca el puerto 6543. | Sí | Supabase > Connect > Direct connection / Session pooler |
| `OPENAI_API_KEY` | Clave del proveedor de IA. Sin ella `POST /analyses` falla; el resto del servicio arranca. | Sí (para analizar) | platform.openai.com > API keys |
| `CORS_ALLOWED_ORIGINS` | Orígenes extra permitidos, separados por comas (`https://host`, sin ruta ni `*`). Se suman a los fijos. | No | Solo si usas otro origen web |
| `OPENAI_MODEL` | Modelo a usar; hay un valor por defecto en el código. | No | — |
| `HOST` | Interfaz de escucha. Por defecto `0.0.0.0` con `NODE_ENV=production`. | No | — |
| `NODE_ENV` | `production` (ya en `render.yaml`): escucha en `0.0.0.0` y reduce diagnósticos. | Sí (ya definida) | — |
| `PORT` | Puerto de escucha. Lo inyecta Render. | Automática | Render |
| `ANALYSIS_*` | Ajustes opcionales de perfiles, plazos y cuota (ver `server/.env.example`). | No | — |

CORS: los orígenes de la app de escritorio ya están fijos en el código (`tauri://localhost`, `http://tauri.localhost`,
`https://tauri.localhost`) junto con los de desarrollo (`http://localhost:1420`, `http://127.0.0.1:1420`). La app no es un
sitio web, así que normalmente `CORS_ALLOWED_ORIGINS` queda vacía. Cualquier otro origen no recibe cabeceras CORS.

## 3. Migraciones

`prisma migrate deploy` corre en cada arranque, antes de levantar el servidor. Solo aplica migraciones pendientes
(es idempotente y usa un bloqueo de Postgres, así que dos arranques simultáneos no chocan). Si falla, el servicio no
arranca y Render conserva la versión anterior en línea. `prisma/schema.prisma` declara `directUrl = env("DIRECT_URL")`:
las migraciones usan esa conexión y la aplicación usa `DATABASE_URL`.

## 4. Comprobar con /health

```text
GET https://<tu-servicio>.onrender.com/api/v1/health
-> 200 {"status":"ok","service":"vision2code-api"}
```

No requiere autenticación ni expone datos. Cualquier otra ruta (`/analyses`, `/auth/me`, `/projects/**`) devuelve 401 sin token.
Después apunta la app de escritorio a esa URL base (`/api/v1` incluido según la resolución de `features/api`).

## 5. Arranque en frío y calentamiento antes de una demo

El plan gratuito duerme el servicio tras ~15 minutos sin tráfico; la primera petición tarda del orden de un minuto
(arranque de Node más `prisma migrate deploy`). Antes de una demo:

1. 5–10 minutos antes, abre `/api/v1/health` hasta recibir 200 (repite si da 502/timeout).
2. Haz una petición autenticada ligera (inicia sesión en la app) para calentar la conexión JWKS y a la base.
3. No dejes un ping automático permanente: consume horas gratuitas del mes.

Además, la cuota de análisis (160 unidades/h por usuario) vive en la memoria del proceso: se reinicia cuando el servicio
duerme o se redespliega, y no se comparte entre instancias (el plan gratuito usa una sola).

## 6. Conectar el instalador de escritorio

El instalador (`npm run desktop:build`) lee `desktop/.env.production`, que contiene solo la URL pública
`VITE_API_BASE_URL=https://vision2code-api.onrender.com/api/v1`. `npm run dev`, `npm run desktop:dev` y los tests no
cargan ese archivo y siguen usando `http://localhost:3000/api/v1`. Las variables de Supabase siguen en `desktop/.env` (local, ignorado).

Para cambiar la URL de producción hay que modificar **tres cosas juntas** y recompilar el instalador:

1. `VITE_API_BASE_URL` en `desktop/.env.production` (con `/api/v1` al final).
2. El origen exacto (sin comodines) en `connect-src` de `desktop/src-tauri/tauri.conf.json`.
3. `PRODUCTION_API_ORIGIN` y el patrón permitido en `desktop/tests/tauri-csp.test.ts`.

Los orígenes de Tauri ya están fijos en el CORS del servidor. La comprobación real se hace con el instalador:
`docs/packaged-build-checklist.md`, sección 14. Antes de una demo, calienta el servicio como en la sección 5
(abre `/api/v1/health` hasta recibir 200).

## 7. Rollback

- **Código**: Render > servicio > **Events/Deploys** > elige un despliegue anterior en estado *Live* > **Rollback**.
  `autoDeploy` está en `false`: nada se despliega sin que lo pidas (Manual Deploy).
- **Base de datos**: Prisma no revierte migraciones. Haz un rollback de código solo si la migración nueva es compatible
  con el código anterior (migraciones aditivas). Si no, crea una migración correctiva nueva y despliégala; ante un
  desastre, restaura desde las copias de Supabase.
- **Variables**: un cambio de variable provoca un reinicio; revierte el valor en el panel y vuelve a desplegar.
