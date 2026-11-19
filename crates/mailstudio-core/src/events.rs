//! Backend → UI notifications. The UI long-polls `events.poll`, which works the same inside
//! Tauri and through the dev HTTP bridge.

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::Notify;

const KEEP: usize = 500;

#[derive(Debug, Clone, Serialize)]
pub struct Event {
    pub seq: u64,
    /// `sync`, `folders`, `messages` or `newMail`.
    pub kind: String,
    pub data: Value,
}

struct Bus {
    queue: Mutex<(u64, VecDeque<Event>)>,
    notify: Notify,
}

fn bus() -> &'static Bus {
    static BUS: OnceLock<Bus> = OnceLock::new();
    BUS.get_or_init(|| Bus {
        queue: Mutex::new((0, VecDeque::new())),
        notify: Notify::new(),
    })
}

pub fn emit(kind: &str, data: Value) {
    let b = bus();
    {
        let mut q = b.queue.lock().unwrap_or_else(|p| p.into_inner());
        q.0 += 1;
        let seq = q.0;
        q.1.push_back(Event {
            seq,
            kind: kind.to_string(),
            data,
        });
        while q.1.len() > KEEP {
            q.1.pop_front();
        }
    }
    b.notify.notify_waiters();
}

fn since(after: u64) -> (u64, Vec<Event>) {
    let q = bus().queue.lock().unwrap_or_else(|p| p.into_inner());
    (q.0, q.1.iter().filter(|e| e.seq > after).cloned().collect())
}

/// Events newer than `after`; waits up to `wait` for the first one. `after == None` returns the
/// current position without events (the UI's first call).
pub async fn poll(after: Option<u64>, wait: Duration) -> Value {
    let Some(after) = after else {
        return json!({ "seq": since(u64::MAX).0, "events": [] });
    };
    let notified = bus().notify.notified();
    tokio::pin!(notified);
    // Register before checking, so an event emitted in between is not missed.
    notified.as_mut().enable();
    let (seq, events) = since(after);
    if !events.is_empty() || seq < after {
        return json!({ "seq": seq, "events": events });
    }
    let _ = tokio::time::timeout(wait, notified).await;
    let (seq, events) = since(after);
    json!({ "seq": seq, "events": events })
}
