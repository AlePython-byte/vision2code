# Vision2Code: build empaquetado y checklist de la app instalada

Guía para compilar, instalar y probar la versión **instalada** de Vision2Code en Windows. La primera verificación del build empaquetado se hizo el 2026-10-17 en la rama `chore/packaged-build-verification`. Lo marcado como *verificado* se ejecutó de verdad; lo demás es el resultado esperado según el código.

## 1. Qué produce el build

| Artefacto | Ruta (relativa a `desktop/src-tauri/target/release/`) | Tamaño verificado |
| --- | --- | --- |
| Instalador NSIS (único) | `bundle/nsis/Vision2Code_0.1.0_x64-setup.exe` | 5,4 MB |
| Ejecutable sin instalar | `desktop.exe` | 10,0 MB |

- **Configuración del paquete:**
  - Identificador `com.vision2code.desktop`, nombre `Vision2Code`, versión `0.1.0`.
  - Ventana de 1280 × 820, mínimo 720 × 540.
  - `targets: ["nsis"]`: un único instalador, con `installMode: currentUser` (por usuario, sin administrador). Ya no se genera MSI.
- **DevTools:** desactivadas en release (el crate `tauri` no tiene la feature `devtools`).
- **Firma:** ninguno de los tres archivos está firmado (*verificado*).
- **Ignorados por git:** `target/` y `desktop/dist` (*verificado*).

## 2. Compilar

Prerrequisitos:
- Node.js 22.12+ (se verificó con 24.21.0) y npm.
- Rust estable con toolchain MSVC (se verificó con 1.98.1) y Microsoft C++ Build Tools ("Desktop development with C++").
- WebView2 Runtime (en Windows 11 viene de serie; se verificó con 155.0.4283.60).
- **Red la primera vez:** Tauri descarga NSIS 3.11 desde GitHub y los guarda en caché.
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
| API propia (NestJS) | `VITE_API_BASE_URL` al compilar: `desktop/.env.production` (versionado) la fija en Render para `desktop:build`; `desktop:dev`, `npm run dev` y los tests no lo leen y usan `http://localhost:3000/api/v1` | **`https://vision2code-api.onrender.com/api/v1`** en el instalador |
| Supabase Auth | `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` al compilar | El proyecto de `desktop/.env`, que coincide con el origen permitido en el CSP |
| OpenAI y PostgreSQL | Solo los usa el servidor | — |

El CSP del paquete solo permite conectarse a:
- `http://localhost:3000` y `http://127.0.0.1:3000`;
- `https://vision2code-api.onrender.com` (origen exacto de la API alojada);
- un único `https://<proyecto>.supabase.co`;
- la IPC de Tauri.

Apuntar la app a otro backend u otro proyecto de Supabase exige cambiar la variable **y** el CSP de `desktop/src-tauri/tauri.conf.json`, y recompilar.

Con el servidor de Render (`docs/deployment.md`) el instalador ya no necesita un backend local. Si compilas con una `VITE_API_BASE_URL` local, ese servidor escucha solo en `127.0.0.1` y **tiene que correr en la misma máquina que la app instalada**. Su CORS ya admite el origen de la app empaquetada (`http://tauri.localhost`).

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

- Ejecuta `Vision2Code_0.1.0_x64-setup.exe`. Como no está firmado, Windows SmartScreen muestra "Windows protegió su PC". Pulsa **Más información → Ejecutar de todas formas**. Se instala **por usuario**, sin permisos de administrador (no aparece el aviso de UAC).
- **Datos que crea la app:**
  - `%LOCALAPPDATA%\com.vision2code.desktop\` guarda `vault.hold` (sesión cifrada), `salt.txt` y `EBWebView\` (perfil de WebView2, con tema e idioma).
  - El Administrador de credenciales de Windows guarda la entrada `vision2code` / `vault_master_key` (clave de la bóveda).
  - **El modo desarrollo usa otros datos:** `npm run desktop:dev` arranca con el identificador `com.vision2code.desktop.dev` (`desktop/src-tauri/tauri.dev.conf.json`), así que su bóveda, su perfil de WebView2 y su entrada del keyring (`com.vision2code.desktop.dev` / `vault_master_key`) son distintos de los de la app instalada. Tras este cambio, la sesión de desarrollo anterior (que vivía en la carpeta del identificador de producción) deja de verse: hay que iniciar sesión una vez en el modo desarrollo.

## 6. Checklist de la app instalada

Marca cada casilla y anota lo observado si no coincide con lo esperado.

### Primer arranque
- [X ] Abrir Vision2Code desde el menú Inicio. **Esperado:** ventana de 1280 × 820 titulada "Vision2Code" con la pantalla de acceso, en español y tema claro.
- [X] Reducir la ventana todo lo posible. **Esperado:** no baja de 720 × 540.
- [x ] Pulsar F12 y abrir el menú del clic derecho. **Esperado:** no se abren las herramientas de desarrollo y el menú no ofrece "Inspeccionar". El menú básico de WebView2 puede seguir apareciendo.

### Registro y acceso
- [x ] Pestaña **Crear cuenta** con un correo nuevo. **Esperado:** mensaje "Revisa tu correo"; la cuenta queda pendiente de confirmación.
- [x] Iniciar sesión con la cuenta de la demo, ya confirmada. **Esperado:** se abre el Archivo de proyectos con la lista de proyectos.
- [x] Iniciar sesión con una contraseña incorrecta. **Esperado:** "El correo o la contraseña no son correctos."
- [x] Con el backend apagado, iniciar sesión. **Esperado:** entra igualmente (el acceso solo depende de Supabase), pero los proyectos muestran "No se pudieron cargar tus proyectos." con un botón para reintentar.

### Cuenta en la barra lateral
- [ ] Con la sesión iniciada, mirar la barra lateral. **Esperado:** un avatar generado (cara y color propios de la cuenta, el mismo en cada arranque) y la etiqueta "Cuenta" (o el nombre, si la cuenta tiene uno); **ningún correo** a la vista. Al pasar el ratón por el bloque, el tooltip muestra el correo completo.
- [ ] Abrir **Ajustes**. **Esperado:** una sección "Cuenta" con el mismo avatar (más pequeño) y una fila "Correo electrónico" con la dirección.
- [ ] Cambiar el tema (claro/oscuro): los ojos del avatar se ven sobre su mancha en ambos.

### Miniaturas en Proyectos y Biblioteca
- [ ] Con proyectos que tienen generaciones, abrir **Proyectos**. **Esperado:** cada tarjeta muestra una miniatura dibujada con la estructura de su última generación (bloques, líneas de texto, imágenes, botones), con el chip de fidelidad (Rápido / Equilibrado / Preciso) encima; en unos segundos desaparece el estado de carga. Un proyecto sin generaciones muestra "Sin generaciones".
- [ ] Cambiar entre tema claro y oscuro. **Esperado:** una captura clara se ve clara y una oscura se ve oscura en ambos temas; las líneas de texto se distinguen; no hay colores "sueltos" fuera de la paleta de la app.
- [ ] Reducir la ventana al mínimo (720 × 540). **Esperado:** dos columnas, sin barra de desplazamiento horizontal, miniaturas con la misma proporción 8:5.
- [ ] Con muchos proyectos, desplazarse por la lista. **Esperado:** las miniaturas van apareciendo al acercarse a cada tarjeta (no se descargan todas a la vez) y la app sigue fluida.
- [ ] Apagar el backend y reabrir **Proyectos**. **Esperado:** las tarjetas muestran "Sin vista previa" y el aviso habitual de proyectos, sin avisos nuevos ni cierre de sesión.
- [ ] Abrir **Biblioteca**, expandir un proyecto. **Esperado:** cada generación es una tarjeta con miniatura, "Generación NN", fecha relativa, chip de fidelidad y nombre del archivo; Tab llega a cada tarjeta con foco visible, Enter la abre (con la confirmación de ediciones sin guardar si hace falta) y toda la tarjeta, miniatura incluida, es clicable.
- [ ] Cerrar sesión y entrar con otra cuenta. **Esperado:** no aparece ninguna miniatura de la cuenta anterior, ni siquiera un instante.
- [ ] Con "reducir movimiento" activado en Windows, abrir **Proyectos**. **Esperado:** sin animación de pulso en las miniaturas y los esqueletos, y sin elevación al pasar el ratón por las tarjetas.

### Persistencia de sesión
- [x] Cerrar la app con la sesión iniciada y volver a abrirla. **Esperado:** entra directamente, sin pedir credenciales.
- [ ] **Cerrar sesión → cerrar → abrir.** Con la sesión iniciada, pulsar **Cerrar sesión** en la barra lateral. **Esperado:** aparece "Cerrando sesión…" (medido el 2026-10-17 en un build release desechable: unos 2 s con red, porque guardar la bóveda tarda ese tiempo; unos 4–5 s si Supabase no contesta) y después la pantalla de acceso sin ningún error. Cerrar la app con la X en cuanto se vea la pantalla de acceso, esperar a que no quede ningún `desktop.exe` y volver a abrirla. **Esperado:** "Restaurando sesión…" un momento y luego la **pantalla de acceso**, nunca el Archivo de proyectos. Si en lugar de eso aparece "Has cerrado sesión, pero no se pudo borrar la sesión guardada en este equipo…", la bóveda no se pudo reescribir: anotarlo y capturar el registro del apartado 10.
- [ ] Tras el paso anterior, volver a iniciar sesión, cerrar y abrir. **Esperado:** entra directamente (la sesión nueva sí se guarda).

### Captura y análisis
- [x] Ir a **Captura** y arrastrar una imagen PNG, JPEG o WEBP de menos de 10 MB. **Esperado:** vista previa con nombre, dimensiones, tamaño y formato; insignia **LISTA**.
- [x] Analizar en **Rápido**. **Esperado:** "Analizando…" con "hasta 2 minutos", y después "Interfaz analizada correctamente."
- [x] Analizar en **Equilibrado**. **Esperado:** lo mismo, con "hasta 3 minutos".
- [x] Analizar en **Preciso**. **Esperado:** lo mismo, con "hasta 5 minutos".
- [x] Analizar con el backend apagado. **Esperado:** "No se pudo conectar con el servicio de análisis…" y botón **Reintentar análisis**, sin cerrar la sesión.
- [x] **Generar y abrir código**. **Esperado:** se abre Código con el editor, los archivos y la vista previa en vivo con la interfaz generada dibujada. Si alguna vez no arranca, el panel muestra "La vista previa no pudo iniciarse" con **Reintentar**, nunca un lienzo vacío marcado como "Activa".
- [x] Con un proyecto seleccionado antes de analizar. **Esperado:** aviso "Guardado en la nube."; la generación aparece en **Biblioteca** y en el historial.

### Exportar
- [x] En Código, pulsar **Exportar** y elegir una carpeta en el diálogo nativo de Windows. **Esperado:** se crea una subcarpeta nueva (con sufijo `-2`, `-3` si ya existe) y aparece un aviso con el nombre de la carpeta. No necesita el backend.
- [x] Dentro de la carpeta exportada, ejecutar `npm install` y `npm run dev`. **Esperado:** el proyecto arranca.
- [x] Cancelar el diálogo. **Esperado:** no se crea nada.

### Tema e idioma
- [x] En **Ajustes**, cambiar a modo oscuro e inglés; cerrar y abrir. **Esperado:** se conservan el tema y el idioma.
- [x] En la pantalla de acceso, cambiar tema e idioma con los controles segmentados (también con las flechas del teclado). **Esperado:** se aplican al momento y persisten.

### Aviso de sesión no guardada
- [x] Con el keyring funcionando (caso normal). **Esperado:** no aparece ninguna insignia sobre el avatar ni aviso en Ajustes.
- [ ] (Opcional, para provocarlo) Cerrar la app, borrar la entrada `vision2code` del Administrador de credenciales y dejar `vault.hold`; abrir y entrar. **Esperado:** insignia de advertencia sobre el avatar y, en Ajustes, "Tu sesión no se guardará al cerrar la app". Después, borrar `vault.hold` para recuperar la persistencia.

### Desinstalar y reinstalar
- [ ] Desinstalar desde **Configuración → Aplicaciones**, dejando sin marcar "eliminar datos de la aplicación" en NSIS. **Esperado:** se elimina el programa; `%LOCALAPPDATA%\com.vision2code.desktop\` se conserva.
- [ ] Reinstalar y abrir. **Esperado:** entra con la sesión anterior, y tema e idioma se conservan.
- [ ] Desinstalar marcando "eliminar datos de la aplicación" y reinstalar. **Esperado:** pantalla de acceso con valores por defecto; el login funciona porque se crea una bóveda nueva con la misma clave del Administrador de credenciales.

## 7. Vista previa en la app empaquetada

Corregido el 2026-10-17 (rama `fix/preview-csp-isolation`). Antes, el iframe `srcdoc` heredaba el CSP de la app y su script no se ejecutaba. Ahora, dentro de Tauri, el iframe carga el origen propio de la vista previa, servido por Rust en `http://v2cpreview.localhost/` con su propio CSP, y recibe el documento por `postMessage`. El CSP de la app solo ganó `frame-src` para ese origen y `data:` en `img-src`.

Verificado sobre el `desktop.exe` release y en `tauri dev`:
- **Renderizado:** un proyecto real se dibuja (43 elementos y texto visible).
- **Aislamiento:** el código de la vista previa no puede leer el DOM del padre, `localStorage` ni las cookies; no puede navegar la ventana principal; y no llega a la red, ni a la API local, ni a la IPC de Tauri.

Después de cualquier cambio en el CSP, la vista previa o los comandos nativos, repite en el build empaquetado el paso "Generar y abrir código" (regla 8 de `docs/engineering-rules.md`): `tauri dev` no aplica el CSP.

## 8. Problemas conocidos del build verificado

| Severidad | Problema | Detalle |
| --- | --- | --- |
| Importante | Instalador sin firmar | Aviso de SmartScreen y editor desconocido. |
| Importante | La API apunta a `localhost:3000` y el servidor solo escucha en `127.0.0.1` | El backend debe ejecutarse en la misma máquina que la app. |
| Importante | La sesión puede dejar de guardarse sin aviso | Si falla el Administrador de credenciales o la bóveda no se puede abrir, la app pasa a memoria y avisa. Hay que iniciar sesión en cada arranque (apartado 9). |
| Menor | Se puede depurar el WebView2 de la versión instalada | Con la variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<n>` se adjunta un depurador. Solo afecta a la propia máquina. |

## 9. Sesión: dónde vive y qué puede fallar

- **La clave:** el comando nativo `get_vault_key` lee la entrada `vision2code` / `vault_master_key` del Administrador de credenciales de Windows. Si no existe, la genera (256 bits aleatorios) y la guarda.
- **La bóveda:** `vault.hold` en `%LOCALAPPDATA%\com.vision2code.desktop\` (Stronghold con Argon2 y `salt.txt`). Solo guarda la sesión de Supabase: los proyectos y generaciones están en el servidor, y los borradores del editor nunca se guardan.
- **Si falla el keyring, o la bóveda está dañada o se cifró con otra clave:** la app sigue funcionando con un almacenamiento en memoria y lo avisa: una insignia de advertencia sobre el avatar del carril y, en **Ajustes**, el aviso "Tu sesión no se guardará al cerrar la app". Hay que volver a iniciar sesión en cada arranque.
- **Cómo se llega a eso:** el caso típico es borrar la entrada del Administrador de credenciales y conservar `vault.hold`. Se resuelve borrando `vault.hold`; la app crea una nueva.
- **Cerrar sesión:** la app no da la sesión por cerrada hasta que la ha borrado de `vault.hold` y la bóveda está guardada en disco; mientras tanto muestra "Cerrando sesión…". Primero pide a Supabase que revoque la sesión (`POST /logout`) y le espera como mucho 2,5 s; con o sin respuesta, borra después la copia local y espera a que la bóveda esté guardada (un guardado de `vault.hold` tarda 1,5–2 s). Solo guarda si hay algo que guardar. Desde ese momento y hasta el siguiente inicio de sesión, la bóveda ignora cualquier escritura tardía (por ejemplo, un refresco de token que ya estaba en curso). Si la bóveda no se puede reescribir, la sesión se borra igualmente de la memoria y la pantalla de acceso lo avisa.
- **Pérdida de datos al reinstalar o actualizar:** como mucho se pierde la sesión, nunca proyectos ni generaciones. El modo desarrollo ya no comparte esos datos con la app instalada (identificador y entrada del keyring propios).

## 10. Si la app no se cierra: registro de ciclo de vida

Hay un registro opcional del ciclo de vida, desactivado por defecto. Sirve para caracterizar el caso "pulsé Cerrar sesión, cerré la app y siguió viva".

**Qué guarda:** una línea por evento en `%LOCALAPPDATA%\com.vision2code.desktop\lifecycle.log`. Al pasar de 256 KiB lo rota a `lifecycle.log.1`. Cada línea lleva milisegundos desde 1970, tiempo desde el arranque, PID, hilo y nombre del evento. **No guarda datos personales:** la app solo acepta una lista cerrada de nombres de evento (`desktop/src-tauri/src/lifecycle.rs`), así que no puede escribir correos, rutas ni tokens.

**Cómo capturarlo la próxima vez que ocurra:**
1. Cierra Vision2Code. En el Administrador de tareas no debe quedar ningún `desktop.exe`.
2. Abre PowerShell y arranca la app con el registro activado. La variable solo vale para esa ventana de PowerShell:
   ```powershell
   $env:VISION2CODE_DEBUG_LIFECYCLE = "1"
   & "$env:LOCALAPPDATA\Vision2Code\desktop.exe"
   ```
3. Usa la app como siempre: inicia sesión, pulsa **Cerrar sesión** y cierra con la X.
4. Si la ventana o el proceso siguen vivos pasados 30 segundos, ejecuta esto en la misma PowerShell y guarda la salida:
   ```powershell
   Get-Process desktop, msedgewebview2 -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime, Responding, MainWindowTitle
   ```
5. Envía el archivo `%LOCALAPPDATA%\com.vision2code.desktop\lifecycle.log` y la salida del paso 4. Anota también la hora aproximada a la que pulsaste **Cerrar sesión** y la X.

**Cómo leerlo:**
- **Un cierre normal** muestra `window:close-requested`, `window:destroyed`, `app:exit-requested` y `app:exit` en menos de unos 100 ms. Medido el 2026-10-17: el proceso termina, con todos sus `msedgewebview2.exe`, en 1,0–1,6 s.
- **No aparece `window:close-requested` tras pulsar la X:** el hilo principal no atendió el cierre. Mira el último evento anterior; por ejemplo, un `client:vault:init:start` sin `done` apunta al keyring o a Stronghold.
- **Aparece `close-requested` pero no `destroyed`:** el cierre se atascó dentro de la ventana o de WebView2.
- **Está `app:exit` pero el proceso sigue vivo:** el atasco es posterior a la salida. La salida del paso 4 dirá si es `desktop.exe` o WebView2.
- **`client:signout:start` sin `client:signout:done`:** el cierre de sesión quedó pendiente (red de Supabase o escritura de la bóveda: `client:vault:remove:*`, `client:vault:save:*`).
- **`client:vault:clear:start` → `client:vault:clear:done`:** la sesión se borró de la bóveda y se guardó en disco. **`client:vault:clear:error`:** no se pudo guardar (la app lo avisa). **`client:vault:write:blocked`:** una escritura tardía de la sesión llegó después de "Cerrar sesión" y se descartó.

Nota: "Cerrar sesión" en la barra lateral **cierra la sesión, no la aplicación**; la ventana sigue abierta con la pantalla de acceso, y eso es lo esperado.

## 11. Sin servidor o sin red

| Situación | Qué ve el usuario | Qué funciona |
| --- | --- | --- |
| Backend apagado, con internet | Acceso correcto. Proyectos: "No se pudieron cargar tus proyectos." Análisis: "No se pudo conectar con el servicio de análisis…". Biblioteca: "No se pudieron cargar las generaciones de este proyecto.". Guardar: "Código generado, pero no se pudo guardar en la nube." con **Reintentar**. | Captura, tema, idioma, editor y exportación de lo que ya está abierto. |
| Sin red | En el acceso: "No se pudo conectar con el servicio de autenticación. Comprueba tu conexión." Con una sesión guardada aún válida se entra igualmente; si caducó, aparece ese mensaje. | Lo mismo que en la fila anterior. |
| OpenAI no disponible | "El servicio de análisis no está disponible temporalmente." Ningún error de red o 5xx cierra la sesión; solo un 401 la cierra. | Todo lo que no es análisis. |

## 12. Pulido visual y accesibilidad (tarea 016E)

Con la app instalada (`desktop.exe` del build de release), en claro y oscuro, en ES y EN, a 720 × 540 y en pantalla grande:

- **Visor de la imagen de referencia:** en Captura, elige una imagen y haz clic en su vista previa. Debe abrirse el visor con la imagen completa (la imagen se carga desde `blob:`; el CSP del paquete lo permite, pero solo el build lo prueba). `Tab` se queda en "Cerrar", `Esc` cierra y el foco vuelve a la vista previa; con "reducir animaciones" activado en Windows no hay fundido.
- **Captura sin hueco:** con y sin imagen, el botón "Analizar captura" queda justo debajo de la tarjeta del proyecto, sin un espacio vacío entre ambos. Repite a 720 × 540 (una columna, pie fijo abajo) y comprueba con el lector de pantalla (Narrador) que se anuncian los grupos "Perfil de generación" y "Acciones del análisis".
- **Código:** con una página generada más corta que el lienzo, el lienzo no muestra una franja blanca debajo de la página. El fondo sale del elemento raíz generado; ábrelo con 2 o 3 proyectos distintos.
- **Ajustes:** textos sencillos en ES y EN (sin "telemetría", "calibración" ni códigos de color), contenido centrado y limitado a unos 920 px en pantalla grande.
- **Cuenta:** el avatar es grande, siempre con dos ojos y una boca; es el mismo cada vez que entras con la misma cuenta y distinto con otra.
- **Miniaturas:** en Proyectos y Biblioteca no queda una franja gris vacía al pie de la miniatura, en ambos temas.
- **Fuentes y contraste:** las fuentes empaquetadas (Sora, Space Grotesk, IBM Plex Mono) se ven igual que en desarrollo; `npm run report:contrast` termina sin errores.

## 13. Identidad de marca (logo e iconos)

La fuente única es `desktop/src-tauri/icons/source/logo.svg` (visor de captura con `</>`, violeta de la marca). Los iconos se regeneran con `npx tauri icon desktop/src-tauri/icons/source/logo.svg` desde `desktop/` (borra después `icons/android` e `icons/ios`, que la app no usa). `desktop/public/logo.svg` es el favicon y debe ser idéntico a la fuente (lo comprueba `brand-identity.test.ts`). El icono de la ventana, el del instalador y el de "Aplicaciones instaladas" solo se prueban de verdad con el build de release:

- **Barra de tareas y ventana:** con `desktop.exe` abierto, el icono es el visor violeta (no el de Tauri amarillo y turquesa), nítido también con el icono pequeño de la barra de tareas y al hacer Alt+Tab.
- **Instalador (NSIS):** el ejecutable `Vision2Code_*_x64-setup.exe` y la ventana del asistente muestran el icono nuevo.
- **Aplicaciones instaladas:** tras instalar, "Configuración > Aplicaciones > Aplicaciones instaladas" muestra el icono nuevo junto a Vision2Code, y el acceso directo del menú Inicio también.
- **Login:** el símbolo aparece junto al nombre "Vision2Code", en claro y oscuro, a 720 × 540 y en pantalla grande.
- **Barra lateral:** el símbolo aparece arriba y sigue visible, sin recortes, en el carril compacto (≤ 850 px de ancho).
- Si el icono sigue siendo el antiguo, es la caché de iconos de Windows: reinicia el Explorador o desinstala y reinstala antes de darlo por fallido.

## 14. Servidor de producción (Render)

El instalador usa `https://vision2code-api.onrender.com/api/v1` (`desktop/.env.production`) y su CSP lo permite. Solo se comprueba con el instalador, no con `tauri dev` ni `npm run dev` (regla 8 de `docs/engineering-rules.md`). Compila con `npm run desktop:build` en una máquina que tenga `desktop/.env` con las variables de Supabase, instala y comprueba:

- **Dirección usada:** un análisis o la lista de proyectos llega a Render (en Render > Logs aparece la petición `/api/v1/...`); no hay errores de CSP ni "No se pudo conectar" con red disponible.
- **Acceso contra Supabase:** registro o inicio de sesión correcto; cerrar y abrir la app conserva la sesión; la sonda `/auth/me` no cierra la sesión.
- **Proyectos visibles:** los proyectos creados antes aparecen en Proyectos y Biblioteca con miniaturas; crear, renombrar y borrar uno funciona.
- **Análisis real:** una captura se analiza, genera código y se guarda en el proyecto; el modo Rápido responde sin error de CORS.
- **Primer intento tras servicio dormido:** deja el servicio sin tráfico unos 15 minutos y abre la app. La primera petición puede tardar de 30 a 60 s. Comprueba que sigue cargando sin cerrar la sesión; si falla con "no está disponible temporalmente", reintentar funciona. Para una demo, calienta antes el servicio (`docs/deployment.md`, sección 5).
- **Sin red:** con el Wi-Fi apagado salen los mensajes de la sección 11 y la sesión no se cierra.
- **Vista previa:** sigue sin red (`connect-src 'none'`); su CSP no cambió.
