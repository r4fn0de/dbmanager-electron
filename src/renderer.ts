function renderBootstrapError(error: unknown): void {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);

  console.error("[renderer] bootstrap failed:", error);

  const safeMessage = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  document.body.innerHTML = `
    <div style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 24px;
      font-family: Inter, system-ui, -apple-system, sans-serif;
      background: #111827;
      color: #f9fafb;
    ">
      <div style="
        max-width: 760px;
        width: 100%;
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 12px;
        background: rgba(17, 24, 39, 0.92);
        padding: 16px 18px;
      ">
        <h1 style="margin: 0 0 8px; font-size: 18px; line-height: 1.2;">Renderer startup error</h1>
        <p style="margin: 0 0 12px; font-size: 13px; opacity: 0.9;">
          TarsDB could not initialize the renderer process.
        </p>
        <pre style="
          margin: 0;
          padding: 12px;
          border-radius: 8px;
          overflow: auto;
          background: rgba(0,0,0,0.35);
          border: 1px solid rgba(255,255,255,0.12);
          font-size: 12px;
          line-height: 1.45;
          white-space: pre-wrap;
        ">${safeMessage}</pre>
      </div>
    </div>
  `;
}

window.addEventListener("error", (event) => {
  console.error("[renderer] window error:", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[renderer] unhandled rejection:", event.reason);
});

void import("@/app").catch((error) => {
  renderBootstrapError(error);
});
