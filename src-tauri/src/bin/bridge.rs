//! Dev-only HTTP bridge: `POST /call {cmd, args}` on 127.0.0.1:1441, so the UI served by Vite can
//! drive the real backend from a normal browser. Never shipped (feature `dev-bridge`).

use axum::Json;
use axum::Router;
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use serde_json::Value;

async fn call(Json(body): Json<Value>) -> Response {
    let cmd = body
        .get("cmd")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let args = body.get("args").cloned().unwrap_or(Value::Null);
    match mailstudio_core::dispatch(&cmd, args).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::to_value(&e).unwrap_or_default()),
        )
            .into_response(),
    }
}

async fn cors(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let mut res = if req.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(req).await
    };
    let h = res.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("http://localhost:1440"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST, OPTIONS"),
    );
    res
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route(
            "/call",
            post(call).options(|| async { StatusCode::NO_CONTENT }),
        )
        .layer(axum::middleware::from_fn(cors));
    tokio::spawn(mailstudio_core::background_loop());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:1441")
        .await
        .expect("bind 1441");
    println!("MailStudio dev bridge on http://127.0.0.1:1441");
    axum::serve(listener, app).await.expect("serve");
}
