# Aislamiento de la vista previa frente a la IPC de Tauri

Verificado el 2026-11-07 con Tauri 2.12.2, tauri-runtime-wry 2.12.1, wry 0.57.0 y WebView2 en Windows 11 (versiones fijadas en `desktop/src-tauri/Cargo.lock`). Pregunta: ¿puede el código que corre en la vista previa (iframe sandbox, origen `v2cpreview`) llamar a la IPC de Tauri o a un comando sensible?

**Respuesta: no.** Todos los vectores probados están bloqueados, tanto por análisis del código como empíricamente (`npm run probe:preview-ipc`, ver §4). Este documento no contiene secretos: la sonda solo registra si una llamada se resuelve, se rechaza o expira, nunca el valor devuelto.

## 1. Cómo se monta la vista previa

- `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer" src="http://v2cpreview.localhost/">` (`desktop/src/features/preview/PreviewPanel.tsx:140`, `PREVIEW_SANDBOX` en `previewDocument.ts:8`). Sin `allow-same-origin`, así que el origen es **opaco** (`window.origin === "null"`). Tampoco tiene `allow-forms`, `allow-popups`, `allow-top-navigation` ni `allow-modals`.
- Sirve el contenido el esquema propio `v2cpreview`, registrado en Rust (`desktop/src-tauri/src/lib.rs:110`, `src/preview.rs:41-61`). Solo responde `GET /` e `/index.html` con un *bootstrap* fijo; todo lo demás es 404. No lee archivos ni sale a la red.
- La CSP propia llega como cabecera (`preview.rs:18`) y la repite como `<meta>` el documento generado (`previewDocument.ts:14-15`, `:108`). Contiene `default-src 'none'`, `connect-src 'none'`, `img-src data: blob:`, `form-action 'none'`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'none'`, y en la cabecera `frame-ancestors`, limitado a los orígenes de la app.
- El documento llega por `postMessage`. El *bootstrap* solo acepta mensajes de `window.parent` (`preview.rs:26-35`) y el anfitrión solo envía al `contentWindow` del iframe (`PreviewPanel.tsx:126`).

## 2. Configuración de Tauri

- **Capabilities:** una sola, `capabilities/default.json`, para la ventana `main`, sin `remote` ni `webviews`. Permisos: siete de Stronghold más `allow-get-vault-key`, `allow-get-vault-path`, `allow-export-project` y `allow-lifecycle-log`. `build.rs` declara los cuatro comandos, lo que activa la ACL para comandos propios.
- **`tauri.conf.json`:** no tiene `withGlobalTauri` (no hay `window.__TAURI__`), ni `dangerousRemoteDomainIpcAccess` (no existe en Tauri 2), ni ventanas con URL remota. El patrón es *brownfield*, sin *isolation*.
- **Comandos** (`lib.rs:53-103`, registrados en `:136`):

| Comando | Sensible | Qué toca |
| --- | --- | --- |
| `get_vault_key` | Sí, crítico | Lee o crea la clave maestra en el almacén de credenciales del SO; borra un `vault.key` heredado. |
| `get_vault_path` | Medio | Devuelve la ruta de `vault.hold`; no escribe nada. |
| `export_project` | Medio | Escribe archivos, pero solo en la carpeta que el usuario elige en un diálogo nativo; valida rutas en Rust. |
| `lifecycle_log` | Bajo | Añade una línea de una lista cerrada a un log opcional. |
| `plugin:stronghold\|*` | Sí | Lee y escribe el vault (sesión). |

## 3. Cómo decide Tauri si una llamada IPC está permitida (código del crate instalado)

1. **Clave de invocación.** Cada llamada debe traer `__TAURI_INVOKE_KEY__`, que coincide con una clave aleatoria de la app; si no coincide, se descarta (`tauri-2.12.2/src/webview/mod.rs:2005-2022`). La clave vive en el cierre del script `scripts/ipc-protocol.js`.
2. **Scripts de inicialización en subframes.** Tauri marca sus scripts como `for_main_frame_only: true` (`src/manager/webview.rs:161-185`), pero **wry en Windows los inyecta también en todos los iframes**: `wry-0.57.0/src/lib.rs:1029` («Windows: scripts are always added to subframes») y `src/webview2/mod.rs:506-508`. **Consecuencia confirmada empíricamente:** el iframe de la vista previa tiene `window.__TAURI_INTERNALS__.invoke` y la clave de invocación encerrada en él. La clave **no** protege la vista previa en Windows.
3. **Origen y ACL.** `is_local_url` (`src/webview/mod.rs:1961-2003`) considera **local** cualquier esquema propio registrado; en Windows, `http://<esquema>.localhost`. **`http://v2cpreview.localhost` cuenta como origen local**, y un origen local recibe los permisos de la capability `default` (`:2043-2058`).
4. **Qué impide entonces la llamada:**
   - **Protocolo `ipc://` (`fetch` a `http://ipc.localhost`):** lo bloquea `connect-src 'none'`. Aunque no lo bloqueara, Tauri toma la URL de la cabecera `Origin` (`src/ipc/protocol.rs:478-494`), que en un iframe opaco vale `null`, una URL inválida, así que la petición se rechaza.
   - **Reserva por `postMessage`** (`ipc-protocol.js`, `window.ipc.postMessage` → `window.chrome.webview.postMessage`): wry solo escucha `ICoreWebView2::WebMessageReceived`, el del marco principal (`wry-0.57.0/src/webview2/mod.rs:944-978`), y no se suscribe a `CoreWebView2Frame` (no usa `FrameCreated`). WebView2 no entrega a ese manejador los mensajes de un iframe, así que nunca llegan a Rust. La sonda lo confirma con un testigo en Rust (§4).

**Riesgo residual (no es un fallo hoy):** en el camino `postMessage`, la única barrera es que wry/WebView2 no enruten mensajes de iframes. Si una actualización de wry empezara a atender `CoreWebView2Frame.WebMessageReceived`, el mensaje del iframe llevaría la clave correcta (paso 2) y una URL `v2cpreview` local (paso 3), y la ACL lo permitiría. Por eso:
- Tras actualizar `tauri`, `tauri-runtime-wry`, `wry` o la versión mínima de WebView2, hay que volver a ejecutar `npm run probe:preview-ipc`.
- Nunca se debe añadir `allow-same-origin` ni relajar `connect-src` de la vista previa. Los tests de `desktop/tests/preview-sandbox-security.test.ts` lo fijan.

## 4. Prueba empírica

`npm run probe:preview-ipc` (`scripts/probe-preview-ipc.mts`, solo Windows, no forma parte de `npm test` ni del build):

1. Compila y abre la app nativa con `tauri dev` bajo el identificador `com.vision2code.desktop.probe`. Tiene su propia carpeta de datos, perfil WebView y nombre de servicio en el keyring, así que nunca toca el keyring, el vault ni la sesión de la app instalada o de la de desarrollo. Antes de empezar comprueba que el puerto 1420 está libre en IPv4 e IPv6 (si hubiera un Vite abierto, la ventana cargaría la app real, que llama a `get_vault_key` al arrancar).
2. En lugar de la app, la ventana carga una página anfitriona mínima. Esa página monta el iframe exactamente como `PreviewPanel` y le envía un documento construido con `buildPreviewDocument`, cuyo script prueba cada canal. Después el iframe se navega a sí mismo a una página **sin** la CSP de la vista previa y repite las pruebas.
3. **Control positivo:** el marco principal invoca `get_vault_path` y `lifecycle_log`; las dos deben resolverse.
4. **Testigo en Rust:** con `VISION2CODE_DEBUG_LIFECYCLE=1`, el iframe llama a `lifecycle_log("page:hide")`. Si cualquier llamada suya llegara a Rust, aparecería en el `lifecycle.log` de la sonda, aunque la respuesta fuera al marco principal. El iframe no llama a `get_vault_key`, porque crearía una entrada en el keyring; `get_vault_path` y `lifecycle_log` pasan por la misma decisión de capability, ventana y origen.
5. Termina con código 0 solo si el control funcionó y ningún vector del iframe pasó, y borra su carpeta de datos.

### Resultado (2026-11-07, `tauri dev`)

| Vector | Resultado | Evidencia |
| --- | --- | --- |
| Acceso al DOM / `localStorage` / cookies del padre | Bloqueado (`SecurityError`) | Origen opaco: `PreviewPanel.tsx:140`, `previewDocument.ts:8`; sonda: `parentDomBlocked`, `parentStorageBlocked` |
| Almacenamiento propio y cookies | Bloqueado | Sonda: `ownStorageBlocked`, `cookieBlocked` |
| `window.__TAURI__` | No existe | No hay `withGlobalTauri` en `tauri.conf.json`; sonda: `hasGlobalTauri: false` |
| `window.__TAURI_INTERNALS__.invoke` presente en el iframe | **Presente** (comportamiento de wry en Windows) | `wry-0.57.0/src/lib.rs:1029`; sonda: `hasInvoke: true` |
| `invoke("get_vault_path")`, `invoke("lifecycle_log")`, `invoke("plugin:stronghold\|save")` desde el iframe | Bloqueado: no llega a Rust (expira sin respuesta) | Testigo `frameReachedRust: false`; control `controlReachedRust: true` |
| `fetch` a `http://ipc.localhost` | Bloqueado (CSP; además `Origin: null`) | `previewDocument.ts:15`, `preview.rs:18`, `tauri/src/ipc/protocol.rs:486-494` |
| `window.ipc.postMessage` / `chrome.webview.postMessage` sin clave | Se envía, pero no llega a Rust | `wry/src/webview2/mod.rs:944-978`; testigo |
| `fetch`, imagen y WebSocket a un servidor | Bloqueado (CSP); ningún canario llegó | `connect-src 'none'`, `img-src data: blob:` |
| `window.open` | Bloqueado (sin `allow-popups`) | Sonda: `windowOpenBlocked: true` |
| Envío de formulario | Bloqueado (sin `allow-forms`, `form-action 'none'`); ningún canario | Sonda: sin `form-*` en canarios |
| Navegar la ventana principal (`top.location`) | Bloqueado (sin `allow-top-navigation`) | Sonda: `topNavigation: threw` |
| `postMessage` hostil al padre (con forma de Tauri, de *isolation* o de la vista previa) | Sin efecto: Tauri no escucha `message` en patrón *brownfield* (`tauri/scripts/ipc.js:187` solo con *isolation*); la app tiene un único listener, que filtra por `event.source` | `previewDocument.ts:61-70`, `PreviewPanel.tsx:130-131`; test `preview-sandbox-security.test.ts` |
| El iframe se navega a sí mismo y sale de su CSP | **Permitido.** La página nueva tiene red (llegó `fetch-navigated`), pero sigue opaca y sin IPC (`frameReachedRust: false`) | Sonda, fase `navigated` |
| Iframe incrustado por otra web (`frame-ancestors`) | Bloqueado: solo orígenes de la app | `preview.rs:18` |
| Build empaquetado | **No verificado** (regla 8) | Procedimiento manual en §6 |

## 5. Observación (no es un fallo de IPC)

**La vista previa puede navegarse a sí misma.** Ningún sandbox impide que un iframe cambie su propia URL, y la CSP no controla la navegación. Un código de vista previa malicioso podría ir a `https://…/?datos=…`, y desde allí tendría red, aunque seguiría opaco y sin IPC. Lo único que hay en el iframe es el código que el propio usuario ve en el editor, y el generador no emite enlaces, scripts ni URLs (reglas de generación y sus tests). Es decir, para explotarlo, el usuario tendría que pegar él mismo código hostil en el editor. Mitigación posible, **no aplicada**: cancelar en Rust las navegaciones de subframes que salgan de `v2cpreview` (WebView2 `FrameNavigationStarting`; Tauri no lo expone directamente). Es una decisión, no una urgencia.

## 6. Procedimiento manual en el build empaquetado (regla 8)

Con el instalador de release y `desktop.exe` instalado:

1. Cierra la app. En PowerShell: `$env:VISION2CODE_DEBUG_LIFECYCLE = "1"; $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"`, y lanza `desktop.exe` desde esa misma consola.
2. Entra, genera o abre un proyecto y ve a **Código**, para que la vista previa esté montada.
3. En Edge, abre `edge://inspect`, elige el destino `http://v2cpreview.localhost/` (el iframe) y, en su consola, ejecuta solo:

   ```js
   const t = (p) => Promise.race([p.then(() => "resolved", () => "rejected"), new Promise((r) => setTimeout(() => r("timeout"), 4000))]);
   ({ origin: String(window.origin), hasInvoke: typeof window.__TAURI_INTERNALS__?.invoke === "function",
      log: await t(window.__TAURI_INTERNALS__.invoke("lifecycle_log", { event: "page:hide" })) });
   ```

   No invoques `get_vault_key` ni imprimas valores devueltos.
4. Esperado: `origin: "null"` y `log` distinto de `"resolved"`. En `%LOCALAPPDATA%\com.vision2code.desktop\lifecycle.log` **no** debe aparecer una línea `client:page:hide` con la hora de la prueba; las demás líneas son de la propia app.
5. Cierra la app y borra las dos variables de entorno.
