"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="dark">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0b", color: "#eee", padding: "4rem 1rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.1rem" }}>DiffLens hit an unexpected error</h1>
        <p style={{ color: "#999" }}>Your saved reviews are safe.</p>
        <button onClick={reset} style={{ marginTop: "1rem", padding: "0.4rem 0.9rem" }}>
          Reload
        </button>
      </body>
    </html>
  );
}
