// ═══════════════════════════════════════════════════════════════════
// CORE 2026 — Sistema de Arbitraje — Backend: Supabase
// Migrado desde Google Apps Script. Sin CORS issues, sin tokens inestables.
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useContext, createContext, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx-js-style";

// ─── CLIENTE SUPABASE ──────────────────────────────────────────────
// Variables en .env: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
// En Vercel: añadir las mismas en Project Settings → Environment Variables
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string
);

const C = {
  purple: "#CC67FE", blue: "#0474FD", orange: "#FF5500", green: "#84CD05",
  white: "#FFFFFF", dark: "#1A1A2E", gray: "#F4F4F8", grayMid: "#D0D0DC",
  text: "#1A1A2E", textSub: "#555577", red: "#E53E3E",
};

const PHASE_COLOR: Record<number, string> = { 1: C.blue, 2: C.green, 3: C.purple, 4: C.orange };
const PHASE_TEXT: Record<number, string> = { 1: C.white, 2: C.dark, 3: C.white, 4: C.white };

// ─── TIPOS ─────────────────────────────────────────────────────────
interface JuezInfo { nombre: string; rol: "juez" | "admin" | "espectador"; }
interface SessionUser extends JuezInfo { pin: string; token: string; offline?: boolean; }
interface TeamData { id: number; name: string; }
interface ScoreEntry { [key: string]: string | number | undefined; judge?: string; ts?: string; }
interface AppData {
  teams: TeamData[];
  scores: Record<string, ScoreEntry>;
  qualified: Record<string, number[]>;
  lastUpdated: string | null;
}
interface RankingEntry { id: number; name: string; score: number | null; tiebreak: number | null; sd?: ScoreEntry; }

// ─── CONFIGURACIÓN DE FASES ────────────────────────────────────────
interface FieldOption { label: string; sub: string; value: number; color: string; }
interface FieldConfig { key: string; label: string; type: "number" | "buttons" | "cards"; opts?: FieldOption[]; }
interface PhaseConfig {
  label: string; title: string; icon: string; description: string;
  fields: FieldConfig[]; max: number | null; cutPercent?: number;
}

const phaseConfig: Record<number, PhaseConfig> = {
  1: {
    label: "Fase 1", title: "Drag Race", icon: "🏁",
    description: "Clasificatoria — todos pasan. Ordena por menor tiempo.",
    fields: [
      { key: "time", label: "Tiempo exacto (segundos, ej: 12.43)", type: "number" },
    ],
    max: null,
  },
  2: {
    label: "Fase 2", title: "Estacionamiento", icon: "🅿️",
    description: "Avanza el 50% de los que pasaron F1. Desempate por menor tiempo.",
    cutPercent: 0.5,
    max: 10,
    fields: [
      {
        key: "precision", label: "Precisión de Navegación", type: "buttons",
        opts: [
          { label: "0 Faltas", sub: "2 pts", value: 2, color: C.green },
          { label: "1 Falta", sub: "1.75 pts", value: 1.75, color: C.blue },
          { label: "2 Faltas", sub: "1.5 pts", value: 1.5, color: C.purple },
          { label: "3 Faltas", sub: "1 pt", value: 1, color: C.orange },
          { label: "+3 Faltas", sub: "0 pts", value: 0, color: "#999" },
        ],
      },
      {
        key: "parking", label: "Cobertura del Área Verde", type: "cards",
        opts: [
          { label: "✅ Totalidad / Mayoría", sub: "Cubre área total", value: 4, color: C.green },
          { label: "⚠️ Parcialmente", sub: "Cubre parcial", value: 2, color: C.blue },
          { label: "📍 Llega pero fuera", sub: "Fuera del cuadro", value: 1, color: C.purple },
          { label: "❌ No estacionó", sub: "0 pts", value: 0, color: C.orange },
        ],
      },
      {
        key: "timing", label: "Tiempo de Ejecución", type: "cards",
        opts: [
          { label: "< 1:00 min", sub: "Muy rápido", value: 4, color: C.green },
          { label: "< 1:30 min", sub: "Rápido", value: 2, color: C.blue },
          { label: "< 2:00 min", sub: "Regular", value: 1, color: C.purple },
          { label: "≥ 2:00 min", sub: "Anulada", value: 0, color: "#999" },
        ],
      },
      { key: "tiebreak", label: "Tiempo exacto para desempate (segundos, ej: 87.50)", type: "number" },
    ],
  },
  3: {
    label: "Fase 3", title: "Recorrido", icon: "🛤️",
    description: "Avanza el 50% de los que pasaron F2. Desempate por menor tiempo.",
    cutPercent: 0.5,
    max: 12,
    fields: [
      {
        key: "trace1", label: "Trazo 1 — Cono Rojo", type: "cards",
        opts: [
          { label: "✅ Por la derecha", sub: "Correcto — 4 pts", value: 4, color: C.green },
          { label: "❌ Infracción", sub: "Por izquierda — 0 pts", value: 0, color: C.orange },
        ],
      },
      {
        key: "trace2", label: "Trazo 2 — Cono Verde", type: "cards",
        opts: [
          { label: "✅ Por la izquierda", sub: "Correcto — 4 pts", value: 4, color: C.green },
          { label: "❌ Infracción", sub: "Por derecha — 0 pts", value: 0, color: C.orange },
        ],
      },
      {
        key: "trace3", label: "Trazo 3 — Final", type: "cards",
        opts: [
          { label: "✅ Sin saltar secciones", sub: "Correcto — 4 pts", value: 4, color: C.green },
          { label: "❌ Saltó sección", sub: "Anulada — 0 pts", value: 0, color: C.orange },
        ],
      },
      { key: "tiebreak", label: "Tiempo exacto para desempate (segundos, ej: 95.20)", type: "number" },
    ],
  },
  4: {
    label: "Fase 4", title: "Empuje", icon: "💥",
    description: "Gran Final. Mayor puntaje gana; tiempo exacto desempata.",
    cutPercent: undefined, max: 15,
    fields: [
      {
        key: "obj1", label: "Objeto 1", type: "cards",
        opts: [
          { label: "✅ Dentro zona roja", sub: "5 pts", value: 5, color: C.green },
          { label: "⚠️ Parcial zona roja", sub: "2.5 pts", value: 2.5, color: C.blue },
          { label: "📍 Movido, fuera zona", sub: "1 pt", value: 1, color: C.purple },
          { label: "❌ No fue movido", sub: "0 pts", value: 0, color: "#999" },
        ],
      },
      {
        key: "obj2", label: "Objeto 2", type: "cards",
        opts: [
          { label: "✅ Dentro zona roja", sub: "5 pts", value: 5, color: C.green },
          { label: "⚠️ Parcial zona roja", sub: "2.5 pts", value: 2.5, color: C.blue },
          { label: "📍 Movido, fuera zona", sub: "1 pt", value: 1, color: C.purple },
          { label: "❌ No fue movido", sub: "0 pts", value: 0, color: "#999" },
        ],
      },
      {
        key: "obj3", label: "Objeto 3", type: "cards",
        opts: [
          { label: "✅ Dentro zona roja", sub: "5 pts", value: 5, color: C.green },
          { label: "⚠️ Parcial zona roja", sub: "2.5 pts", value: 2.5, color: C.blue },
          { label: "📍 Movido, fuera zona", sub: "1 pt", value: 1, color: C.purple },
          { label: "❌ No fue movido", sub: "0 pts", value: 0, color: "#999" },
        ],
      },
      { key: "tiebreak", label: "Tiempo exacto para desempate (segundos)", type: "number" },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════
// AUTH CONTEXT
// ═══════════════════════════════════════════════════════════════════
interface AuthContextValue {
  user: SessionUser | null;
  authLoading: boolean;
  authError: string | null;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Intentar restaurar sesión del sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("core2026_session");
      if (saved) setUser(JSON.parse(saved) as SessionUser);
    } catch (_) { }
  }, []);

  const login = useCallback(async (pin: string): Promise<boolean> => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      // Validar PIN contra tabla jueces en Supabase
      const { data, error } = await supabase
        .from("jueces")
        .select("nombre, rol")
        .eq("pin", pin);

      if (error || !data || data.length === 0) {
        setAuthError("PIN incorrecto");
        return false;
      }

      const juezData = data[0];

      // Supabase respondió OK
      const sessionUser: SessionUser = {
        nombre: juezData.nombre as string,
        rol: juezData.rol as "juez" | "admin" | "espectador",
        pin,
        token: `sb_${Date.now()}`,
      };
      setUser(sessionUser);
      try { sessionStorage.setItem("core2026_session", JSON.stringify(sessionUser)); } catch (_) { }
      return true;
    } catch {
      setAuthError("Error de conexión con la base de datos. Intenta de nuevo.");
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    try { sessionStorage.removeItem("core2026_session"); } catch (_) { }
  }, []);

  return (
    <AuthContext.Provider value={{ user, authLoading, authError, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

// ═══════════════════════════════════════════════════════════════════
// useSupabaseAPI HOOK — Reemplaza useSheetsAPI. Sin CORS, sin tokens GAS.
// ═══════════════════════════════════════════════════════════════════
interface PendingItem { fase: number; equipoId: number; scoreData: ScoreEntry; ts: number; }

function useSupabaseAPI() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingQueue = useRef<PendingItem[]>([]);

  // ── Guardar puntaje ──────────────────────────────────────────────
  const submitScore = useCallback(async (
    fase: number,
    equipoId: number,
    scoreData: Record<string, unknown>
  ): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      let total = 0;
      if (fase === 1) total = parseFloat(String(scoreData.time || 0));
      if (fase === 2) total = parseFloat(String(scoreData.precision || 0)) + parseFloat(String(scoreData.parking || 0)) + parseFloat(String(scoreData.timing || 0));
      if (fase === 3) total = parseFloat(String(scoreData.trace1 || 0)) + parseFloat(String(scoreData.trace2 || 0)) + parseFloat(String(scoreData.trace3 || 0));
      if (fase === 4) total = parseFloat(String(scoreData.obj1 || 0)) + parseFloat(String(scoreData.obj2 || 0)) + parseFloat(String(scoreData.obj3 || 0));

      const { error: sbError } = await supabase
        .from("puntajes")
        .upsert({
          equipo_id: equipoId,
          fase,
          juez_nombre: user?.nombre || "Desconocido",
          total: Math.round(total * 100) / 100,
          tiebreak: scoreData.tiebreak ? parseFloat(String(scoreData.tiebreak)) : null,
          tiempo: scoreData.time ? parseFloat(String(scoreData.time)) : null,
          precision: scoreData.precision ? parseFloat(String(scoreData.precision)) : null,
          parking: scoreData.parking ? parseFloat(String(scoreData.parking)) : null,
          timing: scoreData.timing ? parseFloat(String(scoreData.timing)) : null,
          trace1: scoreData.trace1 ? parseFloat(String(scoreData.trace1)) : null,
          trace2: scoreData.trace2 ? parseFloat(String(scoreData.trace2)) : null,
          trace3: scoreData.trace3 ? parseFloat(String(scoreData.trace3)) : null,
          obj1: scoreData.obj1 ? parseFloat(String(scoreData.obj1)) : null,
          obj2: scoreData.obj2 ? parseFloat(String(scoreData.obj2)) : null,
          obj3: scoreData.obj3 ? parseFloat(String(scoreData.obj3)) : null,
        }, { onConflict: "equipo_id,fase" });

      if (sbError) throw sbError;
      return true;
    } catch (err) {
      console.error("Supabase submitScore error:", err);
      pendingQueue.current.push({ fase, equipoId, scoreData: scoreData as ScoreEntry, ts: Date.now() });
      setError("Sin conexión. Puntaje guardado localmente, se sincronizará al reconectar.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // ── Clasificar equipos ───────────────────────────────────────────
  const qualify = useCallback(async (fase: number, teamIds: number[]): Promise<boolean> => {
    try {
      const { error: sbError } = await supabase
        .from("clasificados")
        .upsert({ fase, equipo_ids: teamIds }, { onConflict: "fase" });
      if (sbError) throw sbError;
      return true;
    } catch (err) {
      console.error("Error qualify:", err);
      return false;
    }
  }, []);

  // ── Leer todos los puntajes ──────────────────────────────────────
  const fetchAllScores = useCallback(async () => {
    try {
      const { data, error: sbError } = await supabase.from("puntajes").select("*");
      if (sbError) throw sbError;
      return data || [];
    } catch { return []; }
  }, []);

  // ── Leer clasificados ────────────────────────────────────────────
  const fetchClasificados = useCallback(async () => {
    try {
      const { data, error: sbError } = await supabase.from("clasificados").select("*");
      if (sbError) throw sbError;
      return data || [];
    } catch { return []; }
  }, []);

  // ── Reintentar cola offline cada 15s ────────────────────────────
  useEffect(() => {
    const flush = async () => {
      if (!pendingQueue.current.length) return;
      const toRetry = [...pendingQueue.current];
      pendingQueue.current = [];
      for (const item of toRetry) {
        const ok = await submitScore(item.fase, item.equipoId, item.scoreData);
        if (!ok) pendingQueue.current.push(item); // Reencolar si sigue fallando
      }
    };
    const interval = setInterval(flush, 15000);
    return () => clearInterval(interval);
  }, [submitScore]);

  return { submitScore, qualify, fetchAllScores, fetchClasificados, isLoading, error, setError };
}

// ═══════════════════════════════════════════════════════════════════
// ESTADO LOCAL — Persistencia en localStorage (espejo local de Sheets)
// ═══════════════════════════════════════════════════════════════════
const STORAGE_KEY = "core2026-v3";
const defaultData = (): AppData => ({
  teams: Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, name: `Equipo ${String(i + 1).padStart(2, "0")}`,
  })),
  scores: {}, qualified: {}, lastUpdated: null,
});

// ═══════════════════════════════════════════════════════════════════
// HELPERS DE CÁLCULO
// ═══════════════════════════════════════════════════════════════════
function calcScore(phase: number, vals: ScoreEntry | undefined): number | null {
  if (!vals) return null;
  const cfg = phaseConfig[phase];
  if (phase === 1) return vals.time != null && vals.time !== "" ? parseFloat(String(vals.time)) : null;
  let total = 0;
  for (const f of cfg.fields) {
    if (f.key === "tiebreak" || f.key === "time") continue;
    const v = vals[f.key];
    if (v == null || v === "") return null;
    total += parseFloat(String(v));
  }
  return Math.round(total * 100) / 100;
}

function getRankings(data: AppData, phase: number): RankingEntry[] {
  const eligible: number[] = phase === 1
    ? data.teams.map(t => t.id)
    : (data.qualified[`p${phase}`] || []);
  return eligible.map(id => {
    const sd = data.scores[`${phase}_${id}`];
    const score = calcScore(phase, sd);
    const team = data.teams.find(t => t.id === id);
    const tiebreak = sd?.tiebreak != null && sd?.tiebreak !== "" ? parseFloat(String(sd.tiebreak)) : null;
    return { id, name: team?.name || `Equipo ${id}`, score, tiebreak, sd };
  }).sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    // F1: menor tiempo gana
    if (phase === 1) return a.score - b.score;
    // F2+: mayor puntaje; empate → menor tiebreak
    if (b.score !== a.score) return b.score - a.score;
    const at = a.tiebreak ?? Infinity;
    const bt = b.tiebreak ?? Infinity;
    return at - bt;
  });
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════
function LoginScreen() {
  const { login, authLoading, authError } = useAuth();
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  const handleDigit = (d: string) => setPin(p => p.length < 4 ? p + d : p);
  const handleClear = () => setPin("");

  // FIX #4: handleSubmit como useCallback para evitar stale closure en useEffect
  const handleSubmit = useCallback(async () => {
    if (pin.length < 4) return;
    const ok = await login(pin);
    if (!ok) {
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 500);
    }
  }, [pin, login]);

  // Auto-submit al completar 4 dígitos
  useEffect(() => {
    if (pin.length === 4) { handleSubmit(); }
  }, [pin, handleSubmit]);

  return (
    <div style={{ minHeight: "100vh", background: C.dark, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 24 }}>
        {[C.purple, C.blue, C.orange, C.green].map((c, i) => (<div key={i} style={{ width: 22, height: 22, background: c, borderRadius: 5 }} />))}
      </div>
      <div style={{ color: C.white, fontWeight: 900, fontSize: 28, letterSpacing: 2, marginBottom: 4 }}>CORE 2026</div>
      <div style={{ color: C.grayMid, fontSize: 13, marginBottom: 32 }}>Sistema de Arbitraje</div>

      {/* Botón espectador — PIN público 0000 */}
      <button
        id="btn-espectador"
        onClick={() => login("0000")}
        style={{ background: "transparent", border: `1.5px solid ${C.grayMid}44`, color: C.grayMid, borderRadius: 10, padding: "6px 18px", fontSize: 12, cursor: "pointer", marginBottom: 24 }}
      >
        👁 Entrar como Espectador (Leaderboard)
      </button>

      <div style={{ background: "#252540", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 320 }}>
        <div style={{ color: C.grayMid, fontSize: 13, textAlign: "center", marginBottom: 16 }}>Ingresa tu PIN de Juez</div>

        {/* PIN display */}
        <div style={{
          display: "flex", gap: 12, justifyContent: "center", marginBottom: 24,
          transform: shake ? "translateX(-8px)" : "none", transition: "transform .1s"
        }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ width: 48, height: 48, borderRadius: 12, background: pin.length > i ? C.purple : "#1A1A2E", border: `2px solid ${pin.length > i ? C.purple : "#3A3A5E"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: C.white }}>
              {pin.length > i ? "●" : ""}
            </div>
          ))}
        </div>

        {/* Teclado numérico */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "✓"].map((d, i) => (
            <button key={i}
              id={`btn-pin-${d}`}
              onClick={() => {
                if (d === "⌫") handleClear();
                else if (d === "✓") handleSubmit();
                else handleDigit(String(d));
              }}
              style={{
                height: 56, borderRadius: 14, border: "none",
                background: d === "✓" ? C.purple : d === "⌫" ? "#3A3A5E" : "#1A1A2E",
                color: C.white, fontSize: d === "⌫" || d === "✓" ? 20 : 22,
                fontWeight: 700, cursor: "pointer",
                boxShadow: d === "✓" ? `0 4px 14px ${C.purple}55` : "none",
                opacity: authLoading ? .5 : 1,
              }}>
              {authLoading && d === "✓" ? "⏳" : d}
            </button>
          ))}
        </div>

        {authError && (
          <div style={{ marginTop: 16, background: "#FF550022", border: `1px solid ${C.orange}`, borderRadius: 10, padding: "10px 14px", color: C.orange, fontSize: 13, textAlign: "center" }}>
            {authError}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC LEADERBOARD
// ═══════════════════════════════════════════════════════════════════
function PublicLeaderboard({ data }: { data: AppData }) {
  const { logout } = useAuth();
  const accumulated = [...data.teams]
    .map(t => ({
      ...t,
      s2: calcScore(2, data.scores[`2_${t.id}`]) || 0,
      s3: calcScore(3, data.scores[`3_${t.id}`]) || 0,
      s4: calcScore(4, data.scores[`4_${t.id}`]) || 0,
    }))
    .map(t => ({ ...t, total: +(t.s2 + t.s3 + t.s4).toFixed(2) }))
    .sort((a, b) => b.total - a.total);

  return (
    <div style={{ minHeight: "100vh", background: C.dark, fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingTop: 8 }}>
        <div style={{ color: C.white, fontWeight: 800, fontSize: 22 }}>🏆 Leaderboard CORE 2026</div>
        <button onClick={logout} style={{ background: "transparent", border: `1px solid ${C.grayMid}55`, color: C.grayMid, borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>Salir</button>
      </div>
      {accumulated.map((t, i) => (
        <div key={t.id} style={{ background: i < 3 ? `${[C.green, C.blue, C.purple][i]}22` : "#252540", border: `2px solid ${i < 3 ? [C.green, C.blue, C.purple][i] : "#3A3A5E"}`, borderRadius: 14, padding: "14px 18px", marginBottom: 10, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: i < 3 ? [C.green, C.blue, C.purple][i] : "#3A3A5E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
            {i < 3 ? ["🥇", "🥈", "🥉"][i] : <span style={{ color: C.grayMid, fontWeight: 700 }}>{i + 1}</span>}
          </div>
          <div style={{ flex: 1, color: C.white, fontWeight: 700, fontSize: 15 }}>{t.name}</div>
          <div style={{ display: "flex", gap: 10, fontSize: 12, color: C.grayMid }}>
            <span>F2:{t.s2 || "–"}</span><span>F3:{t.s3 || "–"}</span><span>F4:{t.s4 || "–"}</span>
          </div>
          <div style={{ color: i < 3 ? [C.green, C.blue, C.purple][i] : C.white, fontWeight: 900, fontSize: 22 }}>{t.total || "–"}</div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD LAYOUT — Juez / Admin
// ═══════════════════════════════════════════════════════════════════
function DashboardLayout() {
  const { user, logout } = useAuth();
  const { submitScore, qualify: qualifyAPI, fetchAllScores, fetchClasificados, isLoading: apiLoading, error: apiError, setError: setApiError } = useSupabaseAPI();
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"dashboard" | "phase" | "score">("dashboard");
  const [phase, setPhase] = useState(1);
  const [scoringId, setScoringId] = useState<number | null>(null);
  const [form, setForm] = useState<ScoreEntry>({});
  const [saveMsg, setSaveMsg] = useState("");
  const [confirmPhase, setConfirmPhase] = useState<number | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [manageTeams, setManageTeams] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  // load() — solo lee localStorage, instantáneo sin red
  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      setData(raw ? JSON.parse(raw) as AppData : defaultData());
    } catch { setData(defaultData()); }
    setLoading(false);
  }, []);

  // syncFromServer() — lee Supabase en segundo plano y fusiona con estado local
  const syncFromServer = useCallback(async () => {
    try {
      const [scoresRaw, clasificadosRaw, equiposResp] = await Promise.all([
        fetchAllScores(),
        fetchClasificados(),
        supabase.from("equipos").select("id, nombre"),
      ]);
      const equiposRaw = equiposResp.data || [];

      setData(prev => {
        if (!prev) return prev;
        const newScores = { ...prev.scores };
        (scoresRaw as any[]).forEach(row => {
          const key = `${row.fase}_${row.equipo_id}`;
          newScores[key] = {
            time: row.tiempo,
            precision: row.precision,
            parking: row.parking,
            timing: row.timing,
            trace1: row.trace1,
            trace2: row.trace2,
            trace3: row.trace3,
            obj1: row.obj1,
            obj2: row.obj2,
            obj3: row.obj3,
            tiebreak: row.tiebreak,
            judge: row.juez_nombre as string,
          } as ScoreEntry;
        });
        const newQualified = { ...prev.qualified };
        (clasificadosRaw as any[]).forEach(row => {
          newQualified[`p${row.fase}`] = row.equipo_ids as number[];
        });
        const teams = equiposRaw.length > 0
          ? equiposRaw.map((e: Record<string, unknown>) => ({ id: e.id as number, name: e.nombre as string }))
          : prev.teams;
        const updated = { ...prev, scores: newScores, qualified: newQualified, teams, lastUpdated: new Date().toISOString() };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch (_) { }
        return updated;
      });
    } catch (err) {
      console.warn("syncFromServer falló (modo offline):", err);
    }
  }, [fetchAllScores, fetchClasificados]);

  // Carga inicial desde localStorage (inmediata)
  useEffect(() => { load(); }, [load]);

  // Sync inicial + polling cada 5s con Supabase
  useEffect(() => {
    syncFromServer();
    const iv = setInterval(syncFromServer, 5000);
    return () => clearInterval(iv);
  }, [syncFromServer]);

  // Realtime: actualizar en todos los dispositivos cuando un juez guarda
  useEffect(() => {
    const channel = supabase
      .channel("puntajes_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "puntajes" }, () => {
        syncFromServer();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [syncFromServer]);

  // Exportación XLS (solo admin)
  const exportarXLS = useCallback(async () => {
    try {
      const { data: dbScoresData } = await supabase.from('puntajes').select('*');
      const { data: dbTeamsData } = await supabase.from('equipos').select('id, nombre');
      const { data: clasificadosResp } = await supabase.from('clasificados').select('*');

      const dbScores = (dbScoresData || []) as Array<Record<string, any>>;
      const dbTeams = (dbTeamsData || []) as Array<Record<string, any>>;
      const clasificados = (clasificadosResp || []) as Array<Record<string, any>>;

      // Helper to style worksheet
      const applyExcelStyles = (ws: any, numericColumns: string[]) => {
        if (!ws || !ws['!ref']) return;
        const range = XLSX.utils.decode_range(ws['!ref']);

        // Active auto-filters
        ws['!autofilter'] = { ref: ws['!ref'] };

        const colWidths: number[] = [];
        for (let C = range.s.c; C <= range.e.c; ++C) {
          colWidths[C] = 10;
        }

        const headers: string[] = [];
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const headerCell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
          headers[C] = headerCell ? String(headerCell.v) : "";
        }

        for (let R = range.s.r; R <= range.e.r; ++R) {
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[cellRef];
            if (!cell) continue;

            const valStr = cell.v !== undefined && cell.v !== null ? String(cell.v) : "";
            if (valStr.length > colWidths[C]) {
              colWidths[C] = valStr.length;
            }

            if (R === 0) {
              // Header styling: bold, light-gray background (#E0E0E0), centered alignment
              cell.s = {
                font: { bold: true, color: { rgb: "000000" }, name: "Arial", sz: 11 },
                fill: { fgColor: { rgb: "E0E0E0" } },
                alignment: { horizontal: "center", vertical: "center", wrapText: true }
              };
            } else {
              const headerName = headers[C];
              const isNumeric = numericColumns.includes(headerName);

              cell.s = {
                font: { name: "Arial", sz: 10 },
                alignment: { vertical: "center" }
              };

              if (isNumeric) {
                cell.s.alignment.horizontal = "center";
                if (typeof cell.v === "number") {
                  cell.t = "n";
                  cell.z = "0"; // integer format
                  cell.v = Math.round(cell.v);
                }
              } else {
                cell.s.alignment.horizontal = "left";
              }
            }
          }
        }

        ws['!cols'] = colWidths.map(w => ({ wch: Math.max(w + 3, 12) }));
      };

      const wb = XLSX.utils.book_new();

      // Pestaña "Fase_1" (Prueba de Velocidad)
      const fase1Data = dbTeams.map(eq => {
        const s = dbScores.find(score => String(score.equipo_id) === String(eq.id) && String(score.fase) === "1");
        return {
          "EquipoID": eq.id,
          "Nombre": eq.nombre,
          "Tiempo": s?.tiempo !== null && s?.tiempo !== undefined ? Math.round(Number(s.tiempo)) : 0,
          "Juez": s?.juez_nombre || "0",
          "Timestamp": s?.actualizado_en || "0"
        };
      }).sort((a, b) => {
        const tA = a.Tiempo === 0 ? Infinity : a.Tiempo;
        const tB = b.Tiempo === 0 ? Infinity : b.Tiempo;
        return tA - tB;
      });
      const wsF1 = XLSX.utils.json_to_sheet(fase1Data);
      applyExcelStyles(wsF1, ["EquipoID", "Tiempo"]);
      XLSX.utils.book_append_sheet(wb, wsF1, "Fase_1");

      // Pestaña "Fase_2" (Habilidades de Conducción)
      const fase2Data = dbTeams.map(eq => {
        const s = dbScores.find(score => String(score.equipo_id) === String(eq.id) && String(score.fase) === "2");
        return {
          "EquipoID": eq.id,
          "Nombre": eq.nombre,
          "Precision": s?.precision !== null && s?.precision !== undefined ? Math.round(Number(s.precision)) : 0,
          "Parking": s?.parking !== null && s?.parking !== undefined ? Math.round(Number(s.parking)) : 0,
          "Timing": s?.timing !== null && s?.timing !== undefined ? Math.round(Number(s.timing)) : 0,
          "Tiebreak": s?.tiebreak !== null && s?.tiebreak !== undefined ? Math.round(Number(s.tiebreak)) : 0,
          "Total": s?.total !== null && s?.total !== undefined ? Math.round(Number(s.total)) : 0,
          "Juez": s?.juez_nombre || "0"
        };
      }).sort((a, b) => {
        if (b.Total !== a.Total) return b.Total - a.Total;
        return b.Tiebreak - a.Tiebreak;
      });
      const wsF2 = XLSX.utils.json_to_sheet(fase2Data);
      applyExcelStyles(wsF2, ["EquipoID", "Precision", "Parking", "Timing", "Tiebreak", "Total"]);
      XLSX.utils.book_append_sheet(wb, wsF2, "Fase_2");

      // Pestaña "Fase_3" (Seguidor de Línea)
      const fase3Data = dbTeams.map(eq => {
        const s = dbScores.find(score => String(score.equipo_id) === String(eq.id) && String(score.fase) === "3");
        return {
          "EquipoID": eq.id,
          "Nombre": eq.nombre,
          "Trace1": s?.trace1 !== null && s?.trace1 !== undefined ? Math.round(Number(s.trace1)) : 0,
          "Trace2": s?.trace2 !== null && s?.trace2 !== undefined ? Math.round(Number(s.trace2)) : 0,
          "Trace3": s?.trace3 !== null && s?.trace3 !== undefined ? Math.round(Number(s.trace3)) : 0,
          "Tiebreak": s?.tiebreak !== null && s?.tiebreak !== undefined ? Math.round(Number(s.tiebreak)) : 0,
          "Total": s?.total !== null && s?.total !== undefined ? Math.round(Number(s.total)) : 0,
          "Juez": s?.juez_nombre || "0"
        };
      }).sort((a, b) => {
        if (b.Total !== a.Total) return b.Total - a.Total;
        return b.Tiebreak - a.Tiebreak;
      });
      const wsF3 = XLSX.utils.json_to_sheet(fase3Data);
      applyExcelStyles(wsF3, ["EquipoID", "Trace1", "Trace2", "Trace3", "Tiebreak", "Total"]);
      XLSX.utils.book_append_sheet(wb, wsF3, "Fase_3");

      // Pestaña "Fase_4" (Resolución de Objetivos)
      const fase4Data = dbTeams.map(eq => {
        const s = dbScores.find(score => String(score.equipo_id) === String(eq.id) && String(score.fase) === "4");
        return {
          "EquipoID": eq.id,
          "Nombre": eq.nombre,
          "Obj1": s?.obj1 !== null && s?.obj1 !== undefined ? Math.round(Number(s.obj1)) : 0,
          "Obj2": s?.obj2 !== null && s?.obj2 !== undefined ? Math.round(Number(s.obj2)) : 0,
          "Obj3": s?.obj3 !== null && s?.obj3 !== undefined ? Math.round(Number(s.obj3)) : 0,
          "Tiebreak": s?.tiebreak !== null && s?.tiebreak !== undefined ? Math.round(Number(s.tiebreak)) : 0,
          "Total": s?.total !== null && s?.total !== undefined ? Math.round(Number(s.total)) : 0,
          "Juez": s?.juez_nombre || "0"
        };
      }).sort((a, b) => {
        if (b.Total !== a.Total) return b.Total - a.Total;
        return b.Tiebreak - a.Tiebreak;
      });
      const wsF4 = XLSX.utils.json_to_sheet(fase4Data);
      applyExcelStyles(wsF4, ["EquipoID", "Obj1", "Obj2", "Obj3", "Tiebreak", "Total"]);
      XLSX.utils.book_append_sheet(wb, wsF4, "Fase_4");

      // Pestaña "Clasificados"
      const clasificadosData = clasificados.map(c => {
        let equiposList = "[]";
        try {
          const ids = Array.isArray(c.equipo_ids) ? c.equipo_ids : JSON.parse(c.equipo_ids || "[]");
          const names = ids.map((id: number) => {
            const eq = dbTeams.find(e => String(e.id) === String(id));
            return eq ? `${eq.nombre} (ID: ${id})` : `ID: ${id}`;
          });
          equiposList = JSON.stringify(names);
        } catch (e) {
          equiposList = String(c.equipo_ids || "[]");
        }

        return {
          "Fase": `Fase ${c.fase}`,
          "EquiposJSON": equiposList,
          "Timestamp": c.actualizado_en || c.created_at || "0"
        };
      }).sort((a, b) => {
        const fA = parseInt(a.Fase.replace(/\D/g, '')) || 0;
        const fB = parseInt(b.Fase.replace(/\D/g, '')) || 0;
        return fA - fB;
      });
      const wsClas = XLSX.utils.json_to_sheet(clasificadosData);
      applyExcelStyles(wsClas, []);
      XLSX.utils.book_append_sheet(wb, wsClas, "Clasificados");

      // Pestaña "Reporte_Final"
      const reporteFinalData = dbTeams.map(eq => {
        const f2 = dbScores.find(s => String(s.equipo_id) === String(eq.id) && String(s.fase) === "2");
        const f3 = dbScores.find(s => String(s.equipo_id) === String(eq.id) && String(s.fase) === "3");
        const f4 = dbScores.find(s => String(s.equipo_id) === String(eq.id) && String(s.fase) === "4");

        const s2 = f2?.total !== null && f2?.total !== undefined ? Math.round(Number(f2.total)) : 0;
        const s3 = f3?.total !== null && f3?.total !== undefined ? Math.round(Number(f3.total)) : 0;
        const s4 = f4?.total !== null && f4?.total !== undefined ? Math.round(Number(f4.total)) : 0;
        const total = s2 + s3 + s4;

        const timestamps = [f2?.actualizado_en, f3?.actualizado_en, f4?.actualizado_en].filter(Boolean);
        const latestUpdate = timestamps.length > 0 ? timestamps.sort().pop() : "0";

        return {
          "Posicion": 0,
          "EquipoID": eq.id,
          "Nombre": eq.nombre,
          "F2": s2,
          "F3": s3,
          "F4": s4,
          "Total": total,
          "Actualizado": latestUpdate
        };
      }).sort((a, b) => b.Total - a.Total);

      reporteFinalData.forEach((row, index) => {
        row.Posicion = index + 1;
      });

      const wsFinal = XLSX.utils.json_to_sheet(reporteFinalData);
      applyExcelStyles(wsFinal, ["Posicion", "EquipoID", "F2", "F3", "F4", "Total"]);
      XLSX.utils.book_append_sheet(wb, wsFinal, "Reporte_Final");

      XLSX.writeFile(wb, "Core 2026.xlsx");
    } catch (err) {
      console.error("Error exportando XLS:", err);
      alert("Error al exportar. Verifica la conexión con Supabase.");
    }
  }, []);

  const persist = useCallback(async (d: AppData) => {
    const nd: AppData = { ...d, lastUpdated: new Date().toISOString() };
    setData(nd);
    setSaveMsg("guardando…");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nd));
      setSaveMsg("✓ guardado");
    } catch { setSaveMsg("⚠ error"); }
    setTimeout(() => setSaveMsg(""), 2500);
  }, []);

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", flexDirection: "column", gap: 12, background: "#F0F2FF" }}>
      <div style={{ fontSize: 40 }}>⚙️</div>
      <div style={{ color: C.textSub }}>Cargando sistema CORE 2026…</div>
    </div>
  );

  if (!data) return null;

  // Redirigir espectadores
  if (user?.rol === "espectador") return <PublicLeaderboard data={data} />;

  const isAdmin = user?.rol === "admin";
  const rankings = getRankings(data, phase);

  // FIX #3: phaseCutTo ahora usa la clave de la SIGUIENTE fase que se va a alimentar
  // Clave p(phase+1) = cuántos pasan de 'phase' a 'phase+1'
  const phaseCutTo: Record<number, number | null> = {
    1: null, // F1: todos pasan, no hay corte
    2: (() => { const q = data.qualified["p2"] || []; return q.length ? Math.max(1, Math.ceil(q.length * 0.5)) : null; })(),
    3: (() => { const q = data.qualified["p3"] || []; return q.length ? Math.max(1, Math.ceil(q.length * 0.5)) : null; })(),
    4: null,
  };

  const openScore = (id: number) => {
    setScoringId(id);
    setForm({ ...(data.scores[`${phase}_${id}`] || {}) });
    setView("score");
  };

  // FIX #5: Validar que todos los campos requeridos están completos antes de guardar
  const isFormComplete = (): boolean => {
    const cfg = phaseConfig[phase];
    for (const f of cfg.fields) {
      if (f.key === "tiebreak") continue; // tiebreak es opcional
      const v = form[f.key];
      if (v == null || v === "") return false;
    }
    return true;
  };

  const submitScoreLocal = async () => {
    if (!isFormComplete()) {
      setSaveMsg("⚠ Completa todos los campos antes de guardar");
      setTimeout(() => setSaveMsg(""), 3000);
      return;
    }
    const key = `${phase}_${scoringId}`;
    const payload: ScoreEntry = { ...form, judge: user?.nombre, ts: new Date().toISOString() };

    // 1. Guardar localmente de inmediato (UX optimista)
    await persist({ ...data!, scores: { ...data!.scores, [key]: payload } });
    setScoringId(null);
    setView("phase");

    // 2. Enviar a Supabase en segundo plano (no bloquea la UI)
    const ok = await submitScore(phase, scoringId!, payload);
    if (!ok) {
      console.warn("Puntaje en cola offline para equipo", scoringId, "fase", phase);
    }
  };

  const doQualify = async (fromPhase: number) => {
    const rnk = getRankings(data, fromPhase);
    const scored = rnk.filter(r => r.score != null);
    let ids: number[];
    if (fromPhase === 1) {
      ids = scored.map(r => r.id); // TODOS los evaluados pasan
    } else {
      const cfg = phaseConfig[fromPhase];
      const pool = data.qualified[`p${fromPhase}`] || [];
      const cut = Math.max(1, Math.ceil(pool.length * (cfg.cutPercent ?? 0.5)));
      ids = scored.slice(0, cut).map(r => r.id);
    }
    qualifyAPI(fromPhase + 1, ids);
    const nd: AppData = { ...data, qualified: { ...data.qualified, [`p${fromPhase + 1}`]: ids } };
    await persist(nd);
    setConfirmPhase(null);
  };

  const resetPhase = async (p: number) => {
    const ns = { ...data.scores };
    Object.keys(ns).filter(k => k.startsWith(`${p}_`)).forEach(k => delete ns[k]);
    const nq = { ...data.qualified };
    for (let i = p; i <= 4; i++) delete nq[`p${i + 1}`];
    await persist({ ...data, scores: ns, qualified: nq });
  };

  const phaseUnlocked = (p: number) => p === 1 || (data.qualified[`p${p}`]?.length > 0);

  // ── Componentes internos ──────────────────────────────────────────
  const Pill = ({ bg, tc, label, onClick, active, locked }: {
    bg: string; tc: string; label: string; onClick?: () => void; active: boolean; locked?: boolean;
  }) => (
    <button onClick={!locked ? onClick : undefined} style={{
      padding: "7px 15px", borderRadius: 99, border: "none", cursor: locked ? "not-allowed" : "pointer",
      background: active ? bg : "transparent",
      color: active ? tc : locked ? C.grayMid : C.textSub,
      fontWeight: active ? 700 : 400, fontSize: 13,
      outline: active ? `2px solid ${bg}` : `1.5px solid ${C.grayMid}`,
      outlineOffset: active ? -2 : 0, opacity: locked ? .4 : 1, transition: "all .18s",
    }}>{label}</button>
  );

  const BigBtn = ({ bg, tc, label, onClick, disabled }: {
    bg: string; tc: string; label: string; onClick: () => void; disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? C.grayMid : bg, color: disabled ? "#999" : tc,
      border: "none", borderRadius: 14, padding: "14px 20px", fontWeight: 700,
      fontSize: 15, cursor: disabled ? "not-allowed" : "pointer", width: "100%",
      boxShadow: disabled ? "none" : `0 4px 14px ${bg}55`, transition: "all .12s",
    }}>{label}</button>
  );

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", background: "#F0F2FF", minHeight: "100vh", paddingBottom: "3rem" }}>

      {/* TOPBAR */}
      <div style={{ background: C.dark, padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, width: 26, height: 26 }}>
            {[C.purple, C.blue, C.orange, C.green].map((c, i) => (<div key={i} style={{ background: c, borderRadius: 4 }} />))}
          </div>
          <div>
            <div style={{ color: C.white, fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>CORE 2026</div>
            <div style={{ color: C.grayMid, fontSize: 10 }}>Juez: {user?.nombre} {user?.offline && "⚠ offline"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(saveMsg || apiLoading) && <span style={{ fontSize: 11, color: saveMsg.startsWith("✓") ? C.green : C.orange }}>{apiLoading ? "📡 sync…" : saveMsg}</span>}
          {/* FIX #6: Admin panel — solo visible para usuarios con rol admin, sin re-pedir PIN */}
          {isAdmin && <button id="btn-admin-panel" onClick={() => { setAdminOpen(!adminOpen); }} style={{ background: "transparent", border: `1.5px solid ${C.grayMid}`, borderRadius: 8, padding: "4px 10px", color: C.grayMid, fontSize: 12, cursor: "pointer" }}>⚙ Admin</button>}
          <button id="btn-refresh" onClick={load} style={{ background: "transparent", border: `1.5px solid ${C.grayMid}`, borderRadius: 8, padding: "4px 10px", color: C.grayMid, fontSize: 12, cursor: "pointer" }}>↺</button>
          <button id="btn-logout" onClick={logout} style={{ background: "transparent", border: `1.5px solid ${C.orange}44`, borderRadius: 8, padding: "4px 10px", color: C.orange, fontSize: 12, cursor: "pointer" }}>Salir</button>
        </div>
      </div>

      {/* API ERROR BANNER */}
      {apiError && (
        <div style={{ background: "#FF550022", borderBottom: `2px solid ${C.orange}`, padding: "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: C.orange, fontSize: 13 }}>⚠ {apiError}</span>
          <button onClick={() => setApiError(null)} style={{ background: "transparent", border: "none", color: C.orange, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* ADMIN PANEL — FIX #6: No requiere PIN adicional, el rol ya fue validado en login */}
      {adminOpen && isAdmin && (
        <div style={{ background: "#e8eaf6", borderBottom: `3px solid ${C.purple}`, padding: "12px 18px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.purple }}>🔓 Panel Admin — {user?.nombre}</span>
            <button id="btn-manage-teams" onClick={() => setManageTeams(!manageTeams)} style={{ fontSize: 12, background: C.blue, color: C.white, border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>👥 Equipos</button>
            {[1, 2, 3, 4].map(p => (
              <button key={p} id={`btn-reset-f${p}`} onClick={() => { if (window.confirm(`¿Reiniciar Fase ${p}? Se borrarán todos los puntajes de F${p} en adelante.`)) resetPhase(p); }} style={{ fontSize: 12, background: C.orange, color: C.white, border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>Reset F{p}</button>
            ))}
            <button id="btn-reset-all" onClick={async () => {
              if (window.confirm("¿Borrar TODO el torneo? Esta acción no se puede deshacer.")) {
                try {
                  const { error: rpcError } = await supabase.rpc('reset_torneo');
                  if (rpcError) {
                    const { error: delError } = await supabase.from('puntajes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                    if (delError) throw delError;
                  }
                  await persist(defaultData());
                } catch(e) {
                  console.error(e);
                  alert("Error al borrar en base de datos.");
                }
              }
            }} style={{ fontSize: 12, background: "#cc0000", color: C.white, border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>Reset Total</button>
            <button id="btn-export-xls" onClick={exportarXLS} style={{ fontSize: 12, background: C.green, color: C.dark, border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontWeight: 700 }}>📥 Exportar XLS</button>
            <button onClick={() => setAdminOpen(false)} style={{ fontSize: 12, background: C.grayMid, color: C.dark, border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>Cerrar</button>
          </div>
        </div>
      )}

      {/* TEAM MANAGEMENT */}
      {manageTeams && isAdmin && (
        <div style={{ margin: "12px 18px", background: C.white, borderRadius: 16, padding: "1rem 1.25rem", border: `2px solid ${C.purple}` }}>
          <div style={{ fontWeight: 700, color: C.purple, marginBottom: 10 }}>Gestión de Equipos</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              id="input-new-team"
              value={newTeamName}
              onChange={e => setNewTeamName(e.target.value)}
              placeholder="Nombre del equipo…"
              style={{ flex: 1, borderRadius: 8, border: `1.5px solid ${C.purple}`, padding: "7px 12px" }}
              onKeyDown={async e => {
                if (e.key === "Enter" && newTeamName.trim()) {
                  const trimmed = newTeamName.trim();
                  try {
                    const { error } = await supabase.from('equipos').insert([{ nombre: trimmed }]);
                    if (error) throw error;
                    setNewTeamName("");
                    syncFromServer();
                  } catch (err) {
                    console.error("Error adding team", err);
                    alert("Error al agregar equipo en Supabase.");
                  }
                }
              }}
            />
            <button onClick={async () => {
              const trimmed = newTeamName.trim();
              if (!trimmed) return;
              try {
                const { error } = await supabase.from('equipos').insert([{ nombre: trimmed }]);
                if (error) throw error;
                setNewTeamName("");
                syncFromServer();
              } catch (err) {
                console.error("Error adding team", err);
                alert("Error al agregar equipo en Supabase.");
              }
            }} style={{ background: C.purple, color: C.white, border: "none", borderRadius: 8, padding: "7px 16px", fontWeight: 700, cursor: "pointer" }}>+ Agregar</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {data.teams.map(t => (
              <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input defaultValue={t.name} style={{ flex: 1, borderRadius: 8, border: `1.5px solid ${C.grayMid}`, padding: "5px 10px", fontSize: 13 }}
                  onBlur={e => { if (e.target.value !== t.name) persist({ ...data, teams: data.teams.map(x => x.id === t.id ? { ...x, name: e.target.value } : x) }); }} />
                <button onClick={async () => {
                  if (window.confirm(`¿Eliminar "${t.name}"?`)) {
                    try {
                      const { error } = await supabase.from('equipos').delete().eq('id', t.id);
                      if (error) throw error;
                      syncFromServer();
                    } catch (err) {
                      console.error("Error deleting team", err);
                      alert("Error al eliminar equipo en Supabase.");
                    }
                  }
                }} style={{ background: C.orange, color: C.white, border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NAV */}
      <div style={{ padding: "14px 18px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Pill bg={C.dark} tc={C.white} label="📊 Panel" onClick={() => setView("dashboard")} active={view === "dashboard"} />
        {[1, 2, 3, 4].map(p => {
          const cfg = phaseConfig[p];
          return <Pill key={p} bg={PHASE_COLOR[p]} tc={PHASE_TEXT[p]} label={`${cfg.icon} ${cfg.label}`} onClick={() => { setPhase(p); setView("phase"); }} active={view === "phase" && phase === p} locked={!phaseUnlocked(p)} />;
        })}
      </div>

      <div style={{ padding: "16px 18px 0" }}>

        {/* ── DASHBOARD ── */}
        {view === "dashboard" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 18 }}>
              {[1, 2, 3, 4].map(p => {
                const eligible = p === 1 ? data.teams : (data.qualified[`p${p}`] || []).map(id => ({ id }));
                const scored = eligible.filter(t => calcScore(p, data.scores[`${p}_${t.id}`]) != null).length;
                const total = eligible.length; const pct = total ? Math.round(scored / total * 100) : 0;
                return (
                  <div key={p} onClick={() => { if (phaseUnlocked(p)) { setPhase(p); setView("phase"); } }} style={{ background: C.white, borderRadius: 16, padding: "14px 16px", borderTop: `5px solid ${PHASE_COLOR[p]}`, cursor: phaseUnlocked(p) ? "pointer" : "default", opacity: phaseUnlocked(p) ? 1 : .5 }}>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>{phaseConfig[p].icon}</div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: PHASE_COLOR[p] }}>{phaseConfig[p].label}</div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 6 }}>{phaseConfig[p].title}</div>
                    <div style={{ background: C.gray, borderRadius: 99, height: 6, overflow: "hidden" }}>
                      <div style={{ background: PHASE_COLOR[p], width: `${pct}%`, height: "100%", borderRadius: 99, transition: "width .5s" }} />
                    </div>
                    <div style={{ fontSize: 12, color: C.textSub, marginTop: 4 }}>{scored}/{total} evaluados</div>
                  </div>
                );
              })}
            </div>

            {/* Acumulado */}
            <div style={{ background: C.white, borderRadius: 16, padding: "14px 16px", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.dark, marginBottom: 12 }}>🏆 Acumulado (F2+F3+F4)</div>
              {[...data.teams]
                .map(t => ({ ...t, s2: calcScore(2, data.scores[`2_${t.id}`]) || 0, s3: calcScore(3, data.scores[`3_${t.id}`]) || 0, s4: calcScore(4, data.scores[`4_${t.id}`]) || 0 }))
                .map(t => ({ ...t, total: +(t.s2 + t.s3 + t.s4).toFixed(2) }))
                .sort((a, b) => b.total - a.total)
                .map((t, i) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.gray}` }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: i < 3 ? [C.green, C.blue, C.purple][i] : C.gray, display: "flex", alignItems: "center", justifyContent: "center", color: i < 3 ? C.white : C.textSub, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</div>
                    <div style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                    <div style={{ display: "flex", gap: 8, fontSize: 12, color: C.textSub }}>
                      <span style={{ color: PHASE_COLOR[2] }}>F2:{t.s2 || "–"}</span>
                      <span style={{ color: PHASE_COLOR[3] }}>F3:{t.s3 || "–"}</span>
                      <span style={{ color: PHASE_COLOR[4] }}>F4:{t.s4 || "–"}</span>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: C.dark, minWidth: 36, textAlign: "right" }}>{t.total || "–"}</div>
                  </div>
                ))}
            </div>
            {data.lastUpdated && <div style={{ fontSize: 11, color: C.textSub, textAlign: "right" }}>Actualizado: {new Date(data.lastUpdated).toLocaleTimeString("es")}</div>}
          </div>
        )}

        {/* ── PHASE LIST ── */}
        {view === "phase" && (
          <div>
            <div style={{ background: PHASE_COLOR[phase], borderRadius: 16, padding: "16px 18px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ color: PHASE_TEXT[phase], opacity: .8, fontSize: 13 }}>{phaseConfig[phase].label}</div>
                <div style={{ color: PHASE_TEXT[phase], fontWeight: 800, fontSize: 22 }}>{phaseConfig[phase].icon} {phaseConfig[phase].title}</div>
                <div style={{ color: PHASE_TEXT[phase], opacity: .85, fontSize: 12, marginTop: 4 }}>{phaseConfig[phase].description}</div>
                {phase > 1 && (
                  <div style={{ color: PHASE_TEXT[phase], opacity: .75, fontSize: 11, marginTop: 2 }}>
                    {data.qualified[`p${phase}`]?.length || 0} equipos clasificados
                    {phaseCutTo[phase] && ` → Top ${phaseCutTo[phase]} a F${phase + 1}`}
                  </div>
                )}
              </div>
              {phase < 4 && isAdmin && (
                <button id={`btn-qualify-f${phase}`} onClick={() => setConfirmPhase(phase)} style={{ background: "rgba(255,255,255,.2)", border: `2px solid rgba(255,255,255,.5)`, color: PHASE_TEXT[phase], borderRadius: 12, padding: "10px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                  Clasificar ▶ F{phase + 1}
                </button>
              )}
            </div>

            {phase !== 1 && !data.qualified[`p${phase}`]?.length ? (
              <div style={{ background: C.white, borderRadius: 16, padding: "2.5rem", textAlign: "center", color: C.textSub }}>
                <div style={{ fontSize: 40 }}>🔒</div>
                <div style={{ marginTop: 8, fontWeight: 600 }}>Clasifica desde la Fase {phase - 1} primero</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rankings.map((r, i) => {
                  // FIX #3: usar phaseCutTo[phase] (no [phase+1])
                  // phaseCutTo[phase] indica cuántos del ranking ACTUAL avanzan a la siguiente
                  const cutLine = phaseCutTo[phase];
                  const isAboveCut = cutLine != null && i < cutLine;
                  const isCutBorder = cutLine != null && i === cutLine - 1;
                  return (
                    <div key={r.id}>
                      <div style={{ background: C.white, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, border: `2px solid ${isAboveCut && cutLine ? PHASE_COLOR[phase] + "44" : "transparent"}` }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: i < 3 && r.score != null ? [C.green, C.blue, C.purple][i] : C.gray, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: i < 3 && r.score != null ? C.white : C.textSub, flexShrink: 0 }}>
                          {i < 3 && r.score != null ? ["🥇", "🥈", "🥉"][i] : i + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</div>
                          {r.sd?.judge && <div style={{ fontSize: 11, color: C.textSub }}>Juez: {r.sd.judge}</div>}
                          {r.tiebreak != null && phase !== 1 && r.score != null && (
                            <div style={{ fontSize: 11, color: C.blue }}>⏱ Tiempo: {r.tiebreak}s</div>
                          )}
                        </div>
                        {r.score != null ? (
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 800, fontSize: 22, color: PHASE_COLOR[phase] }}>{r.score}</div>
                            <div style={{ fontSize: 11, color: C.textSub }}>{phase === 1 ? "seg" : `/${phaseConfig[phase].max}pts`}</div>
                          </div>
                        ) : <div style={{ color: C.grayMid, fontWeight: 600 }}>—</div>}
                        <button id={`btn-score-t${r.id}-f${phase}`} onClick={() => openScore(r.id)} style={{ background: PHASE_COLOR[phase], color: PHASE_TEXT[phase], border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13, flexShrink: 0 }}>
                          {r.score != null ? "✏️" : "＋"}
                        </button>
                      </div>
                      {isCutBorder && (
                        <div style={{ textAlign: "center", margin: "6px 0", fontSize: 12, color: C.orange, fontWeight: 700, background: "#FF550022", borderRadius: 8, padding: "4px 0" }}>
                          — CORTE: Top {cutLine} de {data.qualified[`p${phase}`]?.length || data.teams.length} (50%) avanzan a F{phase + 1} —
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SCORING CARD ── */}
        {view === "score" && scoringId != null && (() => {
          const team = data.teams.find(t => t.id === scoringId);
          const cfg = phaseConfig[phase];
          const liveScore = calcScore(phase, form);
          const formOk = isFormComplete();
          return (
            <div>
              <button onClick={() => { setScoringId(null); setView("phase"); }} style={{ background: "transparent", border: `1.5px solid ${C.grayMid}`, borderRadius: 10, padding: "7px 14px", cursor: "pointer", fontSize: 13, marginBottom: 14 }}>← Volver</button>

              <div style={{ background: PHASE_COLOR[phase], borderRadius: "16px 16px 0 0", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ color: PHASE_TEXT[phase], opacity: .8, fontSize: 13 }}>{cfg.label} · {cfg.title}</div>
                  <div style={{ color: PHASE_TEXT[phase], fontWeight: 800, fontSize: 20 }}>{team?.name}</div>
                  <div style={{ color: PHASE_TEXT[phase], opacity: .75, fontSize: 12 }}>Juez: {user?.nombre}</div>
                </div>
                {phase !== 1 && (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: PHASE_TEXT[phase], fontWeight: 900, fontSize: 44, lineHeight: 1 }}>{liveScore ?? "—"}</div>
                    {cfg.max && <div style={{ color: PHASE_TEXT[phase], opacity: .75, fontSize: 13 }}>/ {cfg.max}</div>}
                  </div>
                )}
              </div>

              <div style={{ background: C.white, borderRadius: "0 0 16px 16px", padding: "20px", marginBottom: 14 }}>
                {cfg.fields.map(field => (
                  <div key={field.key} style={{ marginBottom: 22 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.dark, marginBottom: 10 }}>{field.label}</div>

                    {field.type === "buttons" && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {field.opts!.map(opt => {
                          const sel = form[field.key] === opt.value;
                          return <button key={opt.value} onClick={() => setForm(f => ({ ...f, [field.key]: opt.value }))} style={{ flex: "1 1 80px", minHeight: 60, borderRadius: 14, border: `3px solid ${sel ? opt.color : C.grayMid}`, background: sel ? opt.color : C.gray, color: sel ? C.white : C.text, fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, boxShadow: sel ? `0 4px 12px ${opt.color}55` : "none" }}>
                            <span>{opt.label}</span><span style={{ fontSize: 11, opacity: .8 }}>{opt.sub}</span>
                          </button>;
                        })}
                      </div>
                    )}

                    {field.type === "cards" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {field.opts!.map(opt => {
                          const sel = form[field.key] === opt.value;
                          return <button key={opt.value} onClick={() => setForm(f => ({ ...f, [field.key]: opt.value }))} style={{ border: `3px solid ${sel ? opt.color : C.grayMid}`, background: sel ? `${opt.color}18` : C.gray, borderRadius: 14, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                            <div style={{ textAlign: "left" }}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: sel ? opt.color : C.text }}>{opt.label}</div>
                              <div style={{ fontSize: 12, color: C.textSub }}>{opt.sub}</div>
                            </div>
                            <div style={{ width: 22, height: 22, borderRadius: "50%", border: `3px solid ${sel ? opt.color : C.grayMid}`, background: sel ? opt.color : "transparent", flexShrink: 0 }} />
                          </button>;
                        })}
                      </div>
                    )}

                    {field.type === "number" && (
                      <div>
                        <input id={`input-${field.key}`} type="number" min={0} step="0.01" value={form[field.key] as number ?? ""} onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                          placeholder="0.00" style={{ width: "100%", border: `2px solid ${PHASE_COLOR[phase]}`, borderRadius: 14, padding: "14px 16px", fontSize: 22, fontWeight: 700, color: C.dark, boxSizing: "border-box", textAlign: "center" }} />
                        {field.key === "tiebreak" && (
                          <div style={{ fontSize: 11, color: C.blue, marginTop: 6, textAlign: "center" }}>
                            ⏱ Este campo solo se usa para desempate cuando hay igualdad de puntaje
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <div style={{ display: "flex", gap: 10 }}>
                  <BigBtn
                    bg={formOk ? PHASE_COLOR[phase] : C.grayMid}
                    tc={formOk ? PHASE_TEXT[phase] : "#999"}
                    label={apiLoading ? "⏳ Guardando…" : formOk ? "💾 Guardar Evaluación" : "⚠ Completa todos los campos"}
                    onClick={submitScoreLocal}
                    disabled={apiLoading || !formOk}
                  />
                  <button onClick={() => { setScoringId(null); setView("phase"); }} style={{ background: C.gray, border: "none", borderRadius: 14, padding: "14px 20px", cursor: "pointer", fontWeight: 600, color: C.textSub }}>Cancelar</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* CONFIRM MODAL */}
      {confirmPhase && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
          <div style={{ background: C.white, borderRadius: 20, padding: "1.75rem", maxWidth: 380, width: "100%" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏁</div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Clasificar a Fase {confirmPhase + 1}</div>
            {confirmPhase === 1 && (() => {
              const scored = getRankings(data, 1).filter(r => r.score != null);
              return <div style={{ fontSize: 14, color: C.textSub, marginBottom: 20 }}>
                <strong>TODOS los {scored.length} equipos evaluados</strong> pasan a la Fase 2, ordenados por menor tiempo.<br />
                <span style={{ color: C.orange }}>Asegúrate de que todos los equipos estén evaluados antes de continuar.</span>
              </div>;
            })()}
            {confirmPhase === 2 && (() => {
              const pool = data.qualified["p2"] || [];
              const cut = Math.max(1, Math.ceil(pool.length * 0.5));
              return <div style={{ fontSize: 14, color: C.textSub, marginBottom: 20 }}>
                Los <strong>Top {cut} de {pool.length} equipos (50%)</strong> avanzan a Fase 3.<br />Desempate por menor tiempo registrado.
              </div>;
            })()}
            {confirmPhase === 3 && (() => {
              const pool = data.qualified["p3"] || [];
              const cut = Math.max(1, Math.ceil(pool.length * 0.5));
              return <div style={{ fontSize: 14, color: C.textSub, marginBottom: 20 }}>
                Los <strong>Top {cut} de {pool.length} equipos (50%)</strong> avanzan a la Gran Final.<br />Desempate por menor tiempo registrado.
              </div>;
            })()}
            <div style={{ display: "flex", gap: 10 }}>
              <BigBtn bg={PHASE_COLOR[confirmPhase]} tc={PHASE_TEXT[confirmPhase]} label="✅ Confirmar y Clasificar" onClick={() => doQualify(confirmPhase)} />
              <button onClick={() => setConfirmPhase(null)} style={{ background: C.gray, border: "none", borderRadius: 14, padding: "14px 20px", cursor: "pointer", fontWeight: 600, color: C.textSub }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOT APP — Wraps everything in AuthProvider
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setTimeout(() => setReady(true), 100); }, []);
  if (!ready) return null;
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

function AppRouter() {
  const { user } = useAuth();
  if (!user) return <LoginScreen />;
  return <DashboardLayout />;
}
