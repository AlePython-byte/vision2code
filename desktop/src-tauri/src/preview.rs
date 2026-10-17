//! `v2cpreview` URI scheme: the live preview's own origin.
//!
//! The preview used to be an `<iframe srcdoc>`. A srcdoc (or blob:) document inherits the CSP of the document that
//! creates it, and the app's CSP has `script-src 'self' 'sha256-…'`, so its inline scripts never ran in Tauri. This
//! scheme serves a fixed bootstrap page with its OWN restrictive CSP header. The app embeds it in an
//! `<iframe sandbox="allow-scripts">` without `allow-same-origin` (opaque origin: no parent DOM, no app storage); the
//! bootstrap says "ready", receives the generated document once through `postMessage` from its parent and writes it.
//! Nothing here reads the request beyond its path, touches the filesystem or reaches the network.
//!
//! Windows / Android serve it as `http://v2cpreview.localhost/`; macOS / Linux as `v2cpreview://localhost/`.

use tauri::http::{header, Request, Response, StatusCode};

pub const SCHEME: &str = "v2cpreview";

/// Same policy as `PREVIEW_IFRAME_CSP` in `desktop/src/features/preview/previewDocument.ts` (a test keeps them equal),
/// plus `frame-ancestors`, which only works as a header: only the app (packaged or dev server) may embed it.
pub const PREVIEW_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors http://tauri.localhost https://tauri.localhost tauri://localhost http://localhost:1420 http://127.0.0.1:1420";

/// Accepts one render message from its parent window only, then replaces itself with the generated document
/// (`document.open` drops this listener, so a page can be rendered once per load).
pub const BOOTSTRAP_HTML: &str = r#"<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Vision2Code preview</title></head>
<body><script>
(function () {
  var host = window.parent;
  if (!host || host === window) return;
  window.addEventListener("message", function (event) {
    if (event.source !== host) return;
    var data = event.data;
    if (!data || data.source !== "v2c-host" || data.type !== "render" || typeof data.html !== "string") return;
    document.open();
    document.write(data.html);
    document.close();
  });
  host.postMessage({ source: "v2c-preview", type: "ready" }, "*");
})();
</script></body></html>
"#;

pub fn respond(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = request.uri().path();
    let builder = Response::builder()
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer");
    let response = if request.method() == "GET" && (path == "/" || path == "/index.html") {
        builder
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CONTENT_SECURITY_POLICY, PREVIEW_CSP)
            .body(BOOTSTRAP_HTML.as_bytes().to_vec())
    } else {
        builder
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .header(header::CONTENT_SECURITY_POLICY, "default-src 'none'")
            .body(b"not found".to_vec())
    };
    response.expect("static response parts are always valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(path: &str) -> Response<Vec<u8>> {
        respond(&Request::builder().method("GET").uri(format!("http://v2cpreview.localhost{path}")).body(Vec::new()).unwrap())
    }

    #[test]
    fn serves_the_bootstrap_with_its_own_restrictive_csp() {
        for path in ["/", "/index.html"] {
            let response = get(path);
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            assert_eq!(response.headers()[header::CONTENT_SECURITY_POLICY], PREVIEW_CSP);
            assert_eq!(response.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
            assert_eq!(response.headers()["X-Content-Type-Options"], "nosniff");
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
            assert_eq!(response.body(), BOOTSTRAP_HTML.as_bytes());
        }
    }

    #[test]
    fn the_preview_policy_allows_no_network_no_frames_and_only_the_app_as_embedder() {
        assert!(PREVIEW_CSP.starts_with("default-src 'none';"));
        assert!(PREVIEW_CSP.contains("connect-src 'none'"));
        assert!(PREVIEW_CSP.contains("frame-src 'none'"));
        assert!(!PREVIEW_CSP.contains("http://*") && !PREVIEW_CSP.contains("https://*") && !PREVIEW_CSP.contains(" * "));
        let ancestors = PREVIEW_CSP.split("frame-ancestors ").nth(1).unwrap();
        for origin in ancestors.split(' ') {
            assert!(origin.contains("tauri.localhost") || origin == "tauri://localhost" || origin.contains(":1420"), "{origin}");
        }
    }

    #[test]
    fn the_bootstrap_only_talks_to_its_parent_and_loads_nothing() {
        assert!(BOOTSTRAP_HTML.contains("event.source !== host"));
        for forbidden in ["fetch(", "XMLHttpRequest", "WebSocket", "src=", "href=", "__TAURI", "localStorage", "eval("] {
            assert!(!BOOTSTRAP_HTML.contains(forbidden), "{forbidden}");
        }
    }

    #[test]
    fn anything_else_is_not_found() {
        for path in ["/other", "/../lib.rs", "/index.html/x"] {
            assert_eq!(get(path).status(), StatusCode::NOT_FOUND, "{path}");
        }
        let post = respond(&Request::builder().method("POST").uri("http://v2cpreview.localhost/").body(Vec::new()).unwrap());
        assert_eq!(post.status(), StatusCode::NOT_FOUND);
    }
}
