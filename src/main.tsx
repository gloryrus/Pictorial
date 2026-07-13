import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

type AppComponent = React.ComponentType;

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauriRuntime() {
  return (
    window.location.protocol === "tauri:" ||
    Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__)
  );
}

function BrowserBlocked() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        margin: 0,
        background: "#111",
        color: "#eee",
        font: "14px system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <div>
        <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>Pictorial</h1>
        <p style={{ margin: 0, color: "#aaa" }}>
          Это приложение можно запускать только через Pictorial.exe.
        </p>
      </div>
    </main>
  );
}

function Root() {
  const [App, setApp] = useState<AppComponent | null>(null);
  const tauri = isTauriRuntime();

  useEffect(() => {
    if (!tauri) return;
    import("./App").then((module) => setApp(() => module.default));
  }, [tauri]);

  if (!tauri) return <BrowserBlocked />;
  if (!App) return null;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
