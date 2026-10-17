# Vision2Code: build empaquetado y checklist de la app instalada

Guía para compilar, instalar y probar la versión **instalada** de Vision2Code en Windows. La primera verificación del build empaquetado se hizo el 2026-10-17 en la rama `chore/packaged-build-verification`. Lo marcado como *verificado* se ejecutó de verdad; lo demás es el resultado esperado según el código.

## 1. Qué produce el build

| Artefacto | Ruta (relativa a `desktop/src-tauri/target/release/`) | Tamaño verificado |
| --- | --- | --- |
| Instalador NSIS (recomendado) | `bundle/nsis/Vision2Code_0.1.0_x64-setup.exe` | 5,4 MB |
| Instalador MSI | `bundle/msi/Vision2Code_0.1.0_x64_en-US.msi` | 6,3 MB |
| Ejecutable sin instalar | `desktop.exe` | 10,0 MB |

- **Configuración del paquete:**
  - Identificador `com.vision2code.desktop`, nombre `Vision2Code`, versión `0.1.0`.
  - Ventana de 1280 × 820, mínimo 720 × 540.
  - `targets: "all"`, que en Windows genera MSI y NSIS.
- **DevTools:** desactivadas en release (el crate `tauri` no tiene la feature `devtools`).
- **Firma:** ninguno de los tres archivos está firmado (*verificado*).
- **Ignorados por git:** `target/` y `desktop/dist` (*verificado*).

## 2. Compilar

Prerrequisitos:
- Node.js 22.12+ (se verificó con 24.21.0) y npm.
- Rust estable con toolchain MSVC (se verificó con 1.98.1) y Microsoft C++ Build Tools ("Desktop development with C++").
- WebView2 Runtime (en Windows 11 viene de serie; se verificó con 155.0.4283.60).
- **Red la primera vez:** Tauri descarga WiX 3.14 y NSIS 3.11 desde GitHub y los guarda en caché.
- `desktop/.env` con las variables públicas del apartado 3. Se incrustan al compilar: cambiarlas exige recompilar.

Desde la raíz del repositorio:

```sh
npm install
npx prisma generate --schema server/prisma/schema.prisma   # solo para el backend
npm run desktop:build                                      # en PowerShell: npm.cmd run desktop:build
```

El primer build tardó unos 12 minutos (714 s), de los que el perfil `release` con LTO de Rust fueron 10 min 10 s. Avisos conocidos que no bloquean el build:
- chunks de JavaScript de más de 500 kB (Monaco);
- `STATIC_VCRUNTIME is deprecated`, que viene de una variable de entorno de la máquina, no del repositorio.

## 3. A qué servicios habla la app instalada

| Servicio | De dónde sale la dirección | Valor en el build verificado |
| --- | --- | --- |
| API propia (NestJS) | `VITE_API_BASE_URL` al compilar; si falta, `http://localhost:3000/api/v1` | **`http://localhost:3000/api/v1`** (la variable no estaba definida) |
| Supabase Auth | `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` al compilar | El proyecto de `desktop/.env`, que coincide con el origen permitido en el CSP |
| OpenAI y PostgreSQL | Solo los usa el servidor | — |

El CSP del paquete solo permite conectarse a:
- `http://localhost:3000` y `http://127.0.0.1:3000`;
- un único `https://<proyecto>.supabase.co`;
- la IPC de Tauri.

Apuntar la app a otro backend u otro proyecto de Supabase exige cambiar la variable **y** el CSP de `desktop/src-tauri/tauri.conf.json`, y recompilar.

El servidor escucha solo en `127.0.0.1`. Por eso **el backend tiene que correr en la misma máquina que la app instalada**. Su CORS ya admite el origen de la app empaquetada (`http://tauri.localhost`).

## 4. Qué tiene que estar levantado para la demo

1. **Internet:** Supabase Auth y OpenAI están en la nube.
2. **Backend en la misma máquina:** `npm run server:dev` (en PowerShell, `npm.cmd run server:dev`), con `server/.env` completo:
   - `PORT=3000`
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - `SUPABASE_URL`: el mismo proyecto que la app.
   - `DATABASE_URL`, con las migraciones aplicadas.

   Comprobación: <http://localhost:3000/api/v1/health> responde.
3. **Cuenta de Supabase:** una cuenta ya confirmada para la demo, porque el registro exige confirmar el correo.

## 5. Instalar

- **NSIS (recomendado):** ejecuta `Vision2Code_0.1.0_x64-setup.exe`. Como no está firmado, Windows SmartScreen muestra "Windows protegió su PC". Pulsa **Más información → Ejecutar de todas formas**. Se instala por usuario, sin permisos de administrador.
- **MSI:** ejecuta el `.msi`. El aviso de UAC muestra "Editor: desconocido".
- **Datos que crea la app:**
  - `%LOCALAPPDATA%\com.vision2code.desktop\` guarda `vault.hold` (sesión cifrada), `salt.txt` y `EBWebView\` (perfil de WebView2, con tema e idioma).
  - El Administrador de credenciales de Windows guarda la entrada `vision2code` / `vault_master_key` (clave de la bóveda).

## 6. Checklist de la app instalada

Marca cada casilla y anota lo observado si no coincide con lo esperado.

### Primer arranque
- [ ] Abrir Vision2Code desde el menú Inicio. **Esperado:** ventana de 1280 × 820 titulada "Vision2Code" con la pantalla de acceso, en español y tema claro.
- [ ] Reducir la ventana todo lo posible. **Esperado:** no baja de 720 × 540.
- [ ] Pulsar F12 y abrir el menú del clic derecho. **Esperado:** no se abren las herramientas de desarrollo y el menú no ofrece "Inspeccionar". El menú básico de WebView2 puede seguir apareciendo.

### Registro y acceso
- [ ] Pestaña **Crear cuenta** con un correo nuevo. **Esperado:** mensaje "Revisa tu correo"; la cuenta queda pendiente de confirmación.
- [ ] Iniciar sesión con la cuenta de la demo, ya confirmada. **Esperado:** se abre el Archivo de proyectos con la lista de proyectos.
- [ ] Iniciar sesión con una contraseña incorrecta. **Esperado:** "El correo o la contraseña no son correctos."
- [ ] Con el backend apagado, iniciar sesión. **Esperado:** entra igualmente (el acceso solo depende de Supabase), pero los proyectos muestran "No se pudieron cargar tus proyectos." con un botón para reintentar.

### Persistencia de sesión
- [ ] Cerrar la app con la sesión iniciada y volver a abrirla. **Esperado:** entra directamente, sin pedir credenciales.
- [ ] Cerrar sesión, cerrar y abrir. **Esperado:** pantalla de acceso.

### Captura y análisis
- [ ] Ir a **Captura** y arrastrar una imagen PNG, JPEG o WEBP de menos de 10 MB. **Esperado:** vista previa con nombre, dimensiones, tamaño y formato; insignia **LISTA**.
- [ ] Analizar en **Rápido**. **Esperado:** "Analizando…" con "hasta 2 minutos", y después "Interfaz analizada correctamente."
- [ ] Analizar en **Equilibrado**. **Esperado:** lo mismo, con "hasta 3 minutos".
- [ ] Analizar en **Preciso**. **Esperado:** lo mismo, con "hasta 5 minutos".
- [ ] Analizar con el backend apagado. **Esperado:** "No se pudo conectar con el servicio de análisis…" y botón **Reintentar análisis**, sin cerrar la sesión.
- [ ] **Generar y abrir código**. **Esperado:** se abre Código con el editor, los archivos y la vista previa en vivo. ⚠️ **Fallo conocido:** en el build actual la vista previa queda en blanco aunque marque "Activa" (apartado 7).
- [ ] Con un proyecto seleccionado antes de analizar. **Esperado:** aviso "Guardado en la nube."; la generación aparece en **Biblioteca** y en el historial.

### Exportar
- [ ] En Código, pulsar **Exportar** y elegir una carpeta en el diálogo nativo de Windows. **Esperado:** se crea una subcarpeta nueva (con sufijo `-2`, `-3` si ya existe) y aparece un aviso con el nombre de la carpeta. No necesita el backend.
- [ ] Dentro de la carpeta exportada, ejecutar `npm install` y `npm run dev`. **Esperado:** el proyecto arranca.
- [ ] Cancelar el diálogo. **Esperado:** no se crea nada.

### Tema e idioma
- [ ] En **Ajustes**, cambiar a modo oscuro e inglés; cerrar y abrir. **Esperado:** se conservan el tema y el idioma.
- [ ] En la pantalla de acceso, cambiar tema e idioma con los controles segmentados (también con las flechas del teclado). **Esperado:** se aplican al momento y persisten.

### Desinstalar y reinstalar
- [ ] Desinstalar desde **Configuración → Aplicaciones**, dejando sin marcar "eliminar datos de la aplicación" en NSIS. **Esperado:** se elimina el programa; `%LOCALAPPDATA%\com.vision2code.desktop\` se conserva.
- [ ] Reinstalar y abrir. **Esperado:** entra con la sesión anterior, y tema e idioma se conservan.
- [ ] Desinstalar marcando "eliminar datos de la aplicación" y reinstalar. **Esperado:** pantalla de acceso con valores por defecto; el login funciona porque se crea una bóveda nueva con la misma clave del Administrador de credenciales.

## 7. Problemas conocidos del build verificado

| Severidad | Problema | Detalle |
| --- | --- | --- |
| **Bloquea demo** | La vista previa en vivo no ejecuta el código generado en la app empaquetada | El iframe `srcdoc` de la vista previa hereda el CSP de la app: `script-src 'self' 'sha256-…'`, sin `'unsafe-inline'`. Verificado en el ejecutable release: el script inline queda bloqueado, y en un navegador sin CSP el mismo iframe se ejecuta. Además no hay aviso: el panel dice "Activa" con el lienzo vacío. Pendiente para la tarea 012D. |
| Importante | Instaladores sin firmar | Aviso de SmartScreen y editor desconocido. |
| Importante | La API apunta a `localhost:3000` y el servidor solo escucha en `127.0.0.1` | El backend debe ejecutarse en la misma máquina que la app. |
| Importante | La sesión puede dejar de guardarse sin aviso | Si falla el Administrador de credenciales o la bóveda no se puede abrir, la app pasa a memoria sin decir nada. Hay que iniciar sesión en cada arranque (apartado 8). |
| Menor | Iconos decorativos de Monaco bloqueados | `img-src` no permite `data:`; Monaco usa algunos SVG en línea para decoraciones. |
| Menor | Se puede depurar el WebView2 de la versión instalada | Con la variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<n>` se adjunta un depurador. Solo afecta a la propia máquina. |

## 8. Sesión: dónde vive y qué puede fallar

- **La clave:** el comando nativo `get_vault_key` lee la entrada `vision2code` / `vault_master_key` del Administrador de credenciales de Windows. Si no existe, la genera (256 bits aleatorios) y la guarda.
- **La bóveda:** `vault.hold` en `%LOCALAPPDATA%\com.vision2code.desktop\` (Stronghold con Argon2 y `salt.txt`). Solo guarda la sesión de Supabase: los proyectos y generaciones están en el servidor, y los borradores del editor nunca se guardan.
- **Si falla el keyring, o la bóveda está dañada o se cifró con otra clave:** la app sigue funcionando con un almacenamiento en memoria y no muestra ningún mensaje. Hay que volver a iniciar sesión en cada arranque.
- **Cómo se llega a eso:** el caso típico es borrar la entrada del Administrador de credenciales y conservar `vault.hold`. Se resuelve borrando `vault.hold`; la app crea una nueva.
- **Pérdida de datos al reinstalar o actualizar:** como mucho se pierde la sesión, nunca proyectos ni generaciones. Hay que tener en cuenta que el identificador `com.vision2code.desktop` y la entrada del keyring son los mismos que usa `npm run desktop:dev`, así que el modo desarrollo y la app instalada comparten sesión y datos locales.

## 9. Sin servidor o sin red

| Situación | Qué ve el usuario | Qué funciona |
| --- | --- | --- |
| Backend apagado, con internet | Acceso correcto. Proyectos: "No se pudieron cargar tus proyectos." Análisis: "No se pudo conectar con el servicio de análisis…". Biblioteca: "No se pudieron cargar las generaciones de este proyecto.". Guardar: "Código generado, pero no se pudo guardar en la nube." con **Reintentar**. | Captura, tema, idioma, editor y exportación de lo que ya está abierto. |
| Sin red | En el acceso: "No se pudo conectar con el servicio de autenticación. Comprueba tu conexión." Con una sesión guardada aún válida se entra igualmente; si caducó, aparece ese mensaje. | Lo mismo que en la fila anterior. |
| OpenAI no disponible | "El servicio de análisis no está disponible temporalmente." Ningún error de red o 5xx cierra la sesión; solo un 401 la cierra. | Todo lo que no es análisis. |
