---
name: Runtime overlay and external scripts
description: How the Vite runtime error overlay should handle browser events from third-party scripts.
---

Third-party cross-origin scripts can trigger browser `error` events without an attached `Error` object. The Vite runtime overlay cannot provide a stack trace or source location for those events, so it should not show its application-error modal for them.

**Why:** An opaque external-script event otherwise becomes a misleading “unknown runtime error” modal, even when the React application is operating normally.

**How to apply:** Keep the runtime overlay enabled for normal exceptions, but filter only its synthetic unknown-error case. Do not broadly disable error reporting.