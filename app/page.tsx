"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { buildGeometry, exportStl, meshVolume } from "@/lib/geometry";
import { EMPTY_MODEL, type Model } from "@/lib/model";
import styles from "./page.module.css";

const Viewer = dynamic(() => import("@/components/Viewer"), { ssr: false });

const EXAMPLES = [
  "A 4 x 2 inch mounting plate, a quarter inch thick, with a 6 mm hole in each corner",
  "Make the holes bigger, 8 mm",
  "A 30 mm cube with a 20 mm sphere cut out of the top",
  "A flanged spacer: 40 mm diameter disc 5 mm thick, with a 20 mm diameter boss 15 mm tall on top and a 10 mm bore through both",
];

interface Turn {
  prompt: string;
  reply: string;
  kind: "ok" | "clarify" | "error";
}

const fmt = (mm: number) => `${mm.toFixed(1)} mm`;

export default function Home() {
  const [model, setModel] = useState<Model>(EMPTY_MODEL);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [engine, setEngine] = useState<string | null>(null);

  const geometry = useMemo(() => buildGeometry(model), [model]);
  const stats = useMemo(() => {
    if (!geometry?.boundingBox) return null;
    const s = geometry.boundingBox.max.clone().sub(geometry.boundingBox.min);
    return { x: s.x, y: s.y, z: s.z, volume: meshVolume(geometry) };
  }, [geometry]);

  async function submit(text: string) {
    const p = text.trim();
    if (!p || loading) return;
    setLoading(true);
    setPrompt("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p, current: model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setEngine(data.engine);
      if (data.status === "clarify") {
        setTurns((t) => [...t, { prompt: p, reply: data.question, kind: "clarify" }]);
      } else {
        setModel(data.model);
        setTurns((t) => [...t, { prompt: p, reply: data.summary, kind: "ok" }]);
      }
    } catch (e) {
      setTurns((t) => [...t, { prompt: p, reply: (e as Error).message, kind: "error" }]);
      setPrompt(p);
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!geometry) return;
    const url = URL.createObjectURL(exportStl(geometry));
    const a = document.createElement("a");
    a.href = url;
    a.download = "text2form.stl";
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setModel(EMPTY_MODEL);
    setTurns([]);
  }

  return (
    <div className={styles.layout}>
      <aside className={styles.panel}>
        <header className={styles.header}>
          <h1>Text2Form</h1>
          <p>Describe a part in plain English. Get a 3D model you can print.</p>
        </header>

        <div className={styles.thread} aria-live="polite">
          {turns.length === 0 && (
            <div className={styles.examples}>
              <span className={styles.label}>Try one</span>
              {EXAMPLES.filter((_, i) => i !== 1).map((ex) => (
                <button key={ex} onClick={() => submit(ex)} disabled={loading}>
                  {ex}
                </button>
              ))}
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={styles.turn}>
              <p className={styles.you}>{t.prompt}</p>
              <p className={styles[t.kind]}>{t.reply}</p>
            </div>
          ))}
          {loading && <p className={styles.thinking}>Building…</p>}
        </div>

        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            submit(prompt);
          }}
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(prompt);
              }
            }}
            placeholder={model.features.length ? "Change something: “move the holes 5 mm inward”" : "Describe a part…"}
            rows={3}
            maxLength={500}
            aria-label="Describe a part"
          />
          <div className={styles.actions}>
            <button type="submit" disabled={loading || !prompt.trim()}>
              {model.features.length ? "Update" : "Build"}
            </button>
            <button type="button" className={styles.secondary} onClick={download} disabled={!geometry}>
              Download STL
            </button>
            <button type="button" className={styles.secondary} onClick={reset} disabled={!turns.length}>
              Start over
            </button>
          </div>
        </form>
      </aside>

      <main className={styles.stage}>
        <Viewer geometry={geometry} />
        {stats && (
          <div className={styles.hud}>
            <div>
              <span>Size</span>
              {fmt(stats.x)} × {fmt(stats.y)} × {fmt(stats.z)}
            </div>
            <div>
              <span>Volume</span>
              {(stats.volume / 1000).toFixed(2)} cm³
            </div>
            <div>
              <span>Features</span>
              {model.features.length}
            </div>
          </div>
        )}
        {model.features.length > 0 && (
          <ol className={styles.features}>
            {model.features.map((f, i) => (
              <li key={i} className={f.op === "subtract" ? styles.cut : undefined}>
                <b>{f.op === "add" ? "+" : "−"}</b> {f.label}
              </li>
            ))}
          </ol>
        )}
        {engine === "rules" && (
          <div className={styles.badge} title="No ANTHROPIC_API_KEY set. Using the rule-based parser.">
            Offline mode (fixed phrasings only)
          </div>
        )}
      </main>
    </div>
  );
}
