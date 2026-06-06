// ═══════════════════════════════════════════════════════════════════
// CORE 2026 — Sistema de Arbitraje Completo
// Incluye: AuthContext, useSheetsAPI, DashboardLayout, App
// Backend: Google Apps Script (ver codigo.gs en artefacto separado)
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useContext, createContext, useCallback, useRef } from "react";

// ─── CONFIGURACIÓN ─────────────────────────────────────────────────
const API_URL = "https://script.google.com/macros/s/AKfycbwD2vy4w3F3dGxdlsj5U3eE36S1Q2vDZVBQWVy6Fz12PM6mSLnyoeCxvP_Q1sw1GZCRaA/exec";
// ↑ Reemplaza con tu URL de Web App una vez desplegado el codigo.gs

const C = {
  purple: "#CC67FE", blue: "#0474FD", orange: "#FF5500", green: "#84CD05",
  white: "#FFFFFF", dark: "#1A1A2E", gray: "#F4F4F8", grayMid: "#D0D0DC",
  text: "#1A1A2E", textSub: "#555577", red: "#E53E3E",
};

const PHASE_COLOR = { 1: C.blue, 2: C.green, 3: C.purple, 4: C.orange };
const PHASE_TEXT  = { 1: C.white, 2: C.dark,  3: C.white,  4: C.white  };

// ─── JUECES AUTORIZADOS (espejo local del backend) ─────────────────
// El backend es la fuente de verdad; esto permite UX offline parcial
const JUECES_AUTORIZADOS = {
  "1001": { nombre: "Alexis Cáceres",       rol: "juez"  },
  "1002": { nombre: "Abril Urdaneta",       rol: "juez"  },
  "1003": { nombre: "Mirian Echenique",     rol: "juez"  },
  "1004": { nombre: "Oscar Alvarado",       rol: "juez"  },
  "1005": { nombre: "Jose Marrufo",         rol: "juez"  },
  "1006": { nombre: "Jehova Leal",          rol: "juez"  },
  "1007": { nombre: "Xioleidy Colmenarez",  rol: "juez"  },
  "1008": { nombre: "Mariangela Moreno",    rol: "juez"  },
  "1009": { nombre: "Mariangel Rojas",      rol: "juez"  },
  "9999": { nombre: "Admin Master",         rol: "admin" },
};

// ─── CONFIGURACIÓN DE FASES ────────────────────────────────────────
const phaseConfig = {
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
          { label: "0 Faltas",  sub: "2 pts",    value: 2,    color: C.green  },
          { label: "1 Falta",   sub: "1.75 pts", value: 1.75, color: C.blue   },
          { label: "2 Faltas",  sub: "1.5 pts",  value: 1.5,  color: C.purple },
          { label: "3 Faltas",  sub: "1 pt",     value: 1,    color: C.orange },
          { label: "+3 Faltas", sub: "0 pts",    value: 0,    color: "#999"   },
        ],
      },
      {
        key: "parking", label: "Cobertura del Área Verde", type: "cards",
        opts: [
          { label: "✅ Totalidad / Mayoría", sub: "Cubre área total",  value: 4, color: C.green  },
          { label: "⚠️ Parcialmente",        sub: "Cubre parcial",     value: 2, color: C.blue   },
          { label: "📍 Llega pero fuera",    sub: "Fuera del cuadro",  value: 1, color: C.purple },
          { label: "❌ No estacionó",         sub: "0 pts",             value: 0, color: C.orange },
        ],
      },
      {
        key: "timing", label: "Tiempo de Ejecución", type: "cards",
        opts: [
          { label: "< 1:00 min", sub: "Muy rápido", value: 4, color: C.green  },
          { label: "< 1:30 min", sub: "Rápido",     value: 2, color: C.blue   },
          { label: "< 2:00 min", sub: "Regular",    value: 1, color: C.purple },
          { label: "≥ 2:00 min", sub: "Anulada",    value: 0, color: "#999"   },
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
          { label: "✅ Por la derecha",  sub: "Correcto — 4 pts",       value: 4, color: C.green  },
          { label: "❌ Infracción",       sub: "Por izquierda — 0 pts",  value: 0, color: C.orange },
        ],
      },
      {
        key: "trace2", label: "Trazo 2 — Cono Verde", type: "cards",
        opts: [
          { label: "✅ Por la izquierda", sub: "Correcto — 4 pts", value: 4, color: C.green  },
          { label: "❌ Infracción",        sub: "Por derecha — 0 pts", value: 0, color: C.orange },
        ],
      },
      {
        key: "trace3", label: "Trazo 3 — Final", type: "cards",
        opts: [
          { label: "✅ Sin saltar secciones", sub: "Correcto — 4 pts", value: 4, color: C.green  },
          { label: "❌ Saltó sección",         sub: "Anulada — 0 pts",  value: 0, color: C.orange },
        ],
      },
      { key: "tiebreak", label: "Tiempo exacto para desempate (segundos, ej: 95.20)", type: "number" },
    ],
  },
  4: {
    label: "Fase 4", title: "Empuje", icon: "💥",
    description: "Gran Final. Mayor puntaje gana; tiempo exacto desempata.",
    cutPercent: null, max: 15,
    fields: [
      {
        key: "obj1", label: "Objeto 1", type: "cards",
        opts: [
          { label: "✅ Dentro zona roja",   sub: "5 pts",   value: 5,   color: C.green  },
          { label: "⚠️ Parcial zona roja",  sub: "2.5 pts", value: 2.5, color: C.blue   },
          { label: "📍 Movido, fuera zona", sub: "1 pt",    value: 1,   color: C.purple },
          { label: "❌ No fue movido",       sub: "0 pts",   value: 0,   color: "#999"   },
        ],
      },
      {
        key: "obj2", label: "Objeto 2", type: "cards",
        opts: [
          { label: "✅ Dentro zona roja",   sub: "5 pts",   value: 5,   color: C.green  },
          { label: "⚠️ Parcial zona roja",  sub: "2.5 pts", value: 2.5, color: C.blue   },
          { label: "📍 Movido, fuera zona", sub: "1 pt",    value: 1,   color: C.purple },
          { label: "❌ No fue movido",       sub: "0 pts",   value: 0,   color: "#999"   },
        ],
      },
      {
        key: "obj3", label: "Objeto 3", type: "cards",
        opts: [
          { label: "✅ Dentro zona roja",   sub: "5 pts",   value: 5,   color: C.green  },
          { label: "⚠️ Parcial zona roja",  sub: "2.5 pts", value: 2.5, color: C.blue   },
          { label: "📍 Movido, fuera zona", sub: "1 pt",    value: 1,   color: C.purple },
          { label: "❌ No fue movido",       sub: "0 pts",   value: 0,   color: "#999"   },
        ],
      },
      { key: "tiebreak", label: "Tiempo exacto para desempate (segundos)", type: "number" },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════
// AUTH CONTEXT
// ═══════════════════════════════════════════════════════════════════
const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { nombre, rol, pin, token }
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Intentar restaurar sesión del sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("core2026_session");
      if (saved) setUser(JSON.parse(saved));
    } catch (_) {}
  }, []);

  const login = useCallback(async (pin) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      // 1. Validación local instantánea (UX en campo)
      const localUser = JUECES_AUTORIZADOS[pin];
      if (!localUser) {
        setAuthError("PIN inválido. Verifica con el administrador.");
        return false;
      }

      // 2. Validación en backend (fuente de verdad)
      // En demo mode (sin API_URL real) usamos solo validación local
      let token = `local_${pin}_${Date.now()}`;
      if (API_URL && !API_URL.includes("TU_DEPLOYMENT_ID")) {
        const resp = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "LOGIN", pin }),
        });
        if (!resp.ok) throw new Error(`Error servidor: ${resp.status}`);
        const data = await resp.json();
        if (data.status === "error") throw new Error(data.message);
        token = data.token;
      }

      const sessionUser = { ...localUser, pin, token };
      setUser(sessionUser);
      try { sessionStorage.setItem("core2026_session", JSON.stringify(sessionUser)); } catch (_) {}
      return true;
    } catch (err) {
      // Si el backend falla pero local OK, continuar en modo degradado
      const localUser = JUECES_AUTORIZADOS[pin];
      if (localUser) {
        const fallback = { ...localUser, pin, token: `offline_${Date.now()}`, offline: true };
        setUser(fallback);
        try { sessionStorage.setItem("core2026_session", JSON.stringify(fallback)); } catch (_) {}
        setAuthError("⚠ Modo offline — cambios se sincronizarán al reconectar.");
        return true;
      }
      setAuthError("Error de conexión. Verifica tu red.");
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    try { sessionStorage.removeItem("core2026_session"); } catch (_) {}
  }, []);

  return (
    <AuthContext.Provider value={{ user, authLoading, authError, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

const useAuth = () => useContext(AuthContext);

// ═══════════════════════════════════════════════════════════════════
// useSheetsAPI HOOK — Comunicación con Google Apps Script
// Sin mode:'no-cors'. CORS resuelto en el backend (codigo.gs)
// ═══════════════════════════════════════════════════════════════════
function useSheetsAPI() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const pendingQueue = useRef([]); // Cola offline

  const apiCall = useCallback(async (payload, retries = 3) => {
    if (!API_URL || API_URL.includes("TU_DEPLOYMENT_ID")) {
      // DEMO MODE: simular latencia y éxito
      await new Promise(r => setTimeout(r, 600));
      return { status: "ok", demo: true };
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(API_URL, {
          method: "POST",
          // SIN mode:'no-cors' — CORS se gestiona en GAS con ContentService
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, token: user?.token }),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.status === "error") throw new Error(data.message || "Error del servidor");
        return data;
      } catch (err) {
        const isLast = attempt === retries;
        if (isLast) throw err;
        // Backoff exponencial: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }, [user]);

  const submitScore = useCallback(async (fase, equipoId, scoreData) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiCall({
        action: "SUBMIT_SCORE",
        fase,
        equipoId,
        juez: user?.nombre,
        timestamp: new Date().toISOString(),
        ...scoreData,
      });
      return true;
    } catch (err) {
      console.error("Error enviando puntaje:", err);
      // Encolar para reintento offline
      pendingQueue.current.push({ fase, equipoId, scoreData, ts: Date.now() });
      setError("Problema de conexión. El puntaje se reintentará al reconectar. No cierres la pantalla.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [apiCall, user]);

  const fetchLeaderboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiCall({ action: "GET_LEADERBOARD" });
      return data?.leaderboard || [];
    } catch (err) {
      setError("No se pudo cargar el leaderboard.");
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [apiCall]);

  const qualify = useCallback(async (fase, teamIds) => {
    setIsLoading(true);
    try {
      await apiCall({ action: "SET_QUALIFIED", fase, teamIds });
      return true;
    } catch (err) {
      setError("Error al clasificar equipos.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [apiCall]);

  // Reintentar cola pendiente cuando hay conexión
  useEffect(() => {
    const flush = async () => {
      if (!pendingQueue.current.length) return;
      const toRetry = [...pendingQueue.current];
      pendingQueue.current = [];
      for (const item of toRetry) {
        try {
          await apiCall({
            action: "SUBMIT_SCORE", fase: item.fase,
            equipoId: item.equipoId, juez: user?.nombre,
            timestamp: new Date().toISOString(), ...item.scoreData,
          });
        } catch (_) { pendingQueue.current.push(item); }
      }
    };
    const interval = setInterval(flush, 15000);
    return () => clearInterval(interval);
  }, [apiCall, user]);

  return { submitScore, fetchLeaderboard, qualify, isLoading, error, setError };
}

// ═══════════════════════════════════════════════════════════════════
// ESTADO LOCAL — Reemplazar con Sheets en producción
// ═══════════════════════════════════════════════════════════════════
const STORAGE_KEY = "core2026-v3";
const defaultData = () => ({
  teams: Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, name: `Equipo ${String(i+1).padStart(2,"0")}`,
  })),
  scores: {}, qualified: {}, lastUpdated: null,
});

// ═══════════════════════════════════════════════════════════════════
// HELPERS DE CÁLCULO
// ═══════════════════════════════════════════════════════════════════
function calcScore(phase, vals) {
  if (!vals) return null;
  const cfg = phaseConfig[phase];
  if (phase === 1) return vals.time != null && vals.time !== "" ? parseFloat(vals.time) : null;
  let total = 0;
  for (const f of cfg.fields) {
    if (f.key === "tiebreak" || f.key === "time") continue;
    const v = vals[f.key];
    if (v == null || v === "") return null;
    total += parseFloat(v);
  }
  return Math.round(total * 100) / 100;
}

// Calcula corte según equipos REALMENTE clasificados en esa fase
function getCutCount(data, forPhase) {
  if (forPhase === 2) return data.teams.length; // Todos pasan F1→F2
  const prev = forPhase - 1;
  const prevQualified = data.qualified[`p${forPhase}`] || [];
  if (prevQualified.length === 0) return 0;
  const cfg = phaseConfig[prev];
  const pct = cfg?.cutPercent ?? 0.5;
  return Math.max(1, Math.ceil(prevQualified.length * pct));
}

function getRankings(data, phase) {
  const eligible = phase === 1
    ? data.teams.map(t => t.id)
    : (data.qualified[`p${phase}`] || []);
  return eligible.map(id => {
    const sd = data.scores[`${phase}_${id}`];
    const score = calcScore(phase, sd);
    const team = data.teams.find(t => t.id === id);
    const tiebreak = sd?.tiebreak != null && sd?.tiebreak !== "" ? parseFloat(sd.tiebreak) : null;
    return { id, name: team?.name || `Equipo ${id}`, score, tiebreak, sd };
  }).sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    // F1: menor tiempo gana
    if (phase === 1) {
      if (a.score !== b.score) return a.score - b.score;
      return 0;
    }
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

  const handleDigit = (d) => setPin(p => p.length < 4 ? p + d : p);
  const handleClear = () => setPin("");

  const handleSubmit = async () => {
    if (pin.length < 4) return;
    const ok = await login(pin);
    if (!ok) {
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 500);
    }
  };

  useEffect(() => { if (pin.length === 4) handleSubmit(); }, [pin]);

  return (
    <div style={{ minHeight: "100vh", background: C.dark, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 24 }}>
        {[C.purple, C.blue, C.orange, C.green].map((c,i)=>(<div key={i} style={{ width: 22, height: 22, background: c, borderRadius: 5 }} />))}
      </div>
      <div style={{ color: C.white, fontWeight: 900, fontSize: 28, letterSpacing: 2, marginBottom: 4 }}>CORE 2026</div>
      <div style={{ color: C.grayMid, fontSize: 13, marginBottom: 32 }}>Sistema de Arbitraje</div>

      {/* Opción público */}
      <button onClick={() => login("0000")} style={{ background: "transparent", border: `1.5px solid ${C.grayMid}44`, color: C.grayMid, borderRadius: 10, padding: "6px 18px", fontSize: 12, cursor: "pointer", marginBottom: 24 }}>
        👁 Entrar como Espectador (Leaderboard)
      </button>

      <div style={{ background: "#252540", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 320 }}>
        <div style={{ color: C.grayMid, fontSize: 13, textAlign: "center", marginBottom: 16 }}>Ingresa tu PIN de Juez</div>

        {/* PIN display */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 24,
          transform: shake ? "translateX(-8px)" : "none", transition: "transform .1s" }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: 48, height: 48, borderRadius: 12, background: pin.length > i ? C.purple : "#1A1A2E", border: `2px solid ${pin.length > i ? C.purple : "#3A3A5E"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: C.white }}>
              {pin.length > i ? "●" : ""}
            </div>
          ))}
        </div>

        {/* Teclado numérico */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[1,2,3,4,5,6,7,8,9,"⌫",0,"✓"].map((d, i) => (
            <button key={i} onClick={() => {
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
function PublicLeaderboard({ data }) {
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
        <div key={t.id} style={{ background: i < 3 ? `${[C.green,C.blue,C.purple][i]}22` : "#252540", border: `2px solid ${i < 3 ? [C.green,C.blue,C.purple][i] : "#3A3A5E"}`, borderRadius: 14, padding: "14px 18px", marginBottom: 10, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: i < 3 ? [C.green,C.blue,C.purple][i] : "#3A3A5E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
            {i < 3 ? ["🥇","🥈","🥉"][i] : <span style={{color:C.grayMid,fontWeight:700}}>{i+1}</span>}
          </div>
          <div style={{ flex: 1, color: C.white, fontWeight: 700, fontSize: 15 }}>{t.name}</div>
          <div style={{ display:"flex", gap:10, fontSize:12, color:C.grayMid }}>
            <span>F2:{t.s2||"–"}</span><span>F3:{t.s3||"–"}</span><span>F4:{t.s4||"–"}</span>
          </div>
          <div style={{ color: i < 3 ? [C.green,C.blue,C.purple][i] : C.white, fontWeight: 900, fontSize: 22 }}>{t.total || "–"}</div>
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
  const { submitScore, qualify: qualifyAPI, isLoading: apiLoading, error: apiError, setError: setApiError } = useSheetsAPI();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [phase, setPhase] = useState(1);
  const [scoringId, setScoringId] = useState(null);
  const [form, setForm] = useState({});
  const [saveMsg, setSaveMsg] = useState("");
  const [confirmPhase, setConfirmPhase] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState("");
  const [adminOk, setAdminOk] = useState(false);
  const [manageTeams, setManageTeams] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  const load = useCallback(async () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      setData(raw ? JSON.parse(raw) : defaultData());
    } catch { setData(defaultData()); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!data) return; const iv = setInterval(load, 8000); return () => clearInterval(iv); }, [data, load]);

  const persist = async (d) => {
    const nd = { ...d, lastUpdated: new Date().toISOString() };
    setData(nd);
    setSaveMsg("guardando…");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nd));
      setSaveMsg("✓ guardado");
    } catch { setSaveMsg("⚠ error"); }
    setTimeout(() => setSaveMsg(""), 2500);
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"system-ui", flexDirection:"column", gap:12, background:"#F0F2FF" }}>
      <div style={{ fontSize:40 }}>⚙️</div>
      <div style={{ color:C.textSub }}>Cargando sistema CORE 2026…</div>
    </div>
  );

  // Redirigir espectadores
  if (user?.pin === "0000") return <PublicLeaderboard data={data} />;

  const isAdmin = user?.rol === "admin";
  const rankings = getRankings(data, phase);
  const phaseCutTo = {
    1: null,
    2: (() => { const q = data.qualified["p2"] || []; return q.length ? Math.max(1, Math.ceil(q.length * 0.5)) : null; })(),
    3: (() => { const q = data.qualified["p3"] || []; return q.length ? Math.max(1, Math.ceil(q.length * 0.5)) : null; })(),
    4: null,
  };

  const openScore = (id) => { setScoringId(id); setForm({ ...(data.scores[`${phase}_${id}`] || {}) }); setView("score"); };

  const submitScoreLocal = async () => {
    const key = `${phase}_${scoringId}`;
    const payload = { ...form, judge: user?.nombre, ts: new Date().toISOString() };
    // Enviar a Sheets (no bloquea si falla — cola offline)
    submitScore(phase, scoringId, payload);
    // Actualizar estado local inmediatamente (UX optimista)
    await persist({ ...data, scores: { ...data.scores, [key]: payload } });
    setScoringId(null); setView("phase");
  };

  const doQualify = async (fromPhase) => {
    const rnk = getRankings(data, fromPhase);
    const scored = rnk.filter(r => r.score != null);
    let ids;
    if (fromPhase === 1) {
      ids = scored.map(r => r.id); // TODOS los evaluados pasan
    } else {
      const cfg = phaseConfig[fromPhase];
      const pool = data.qualified[`p${fromPhase}`] || [];
      const cut = Math.max(1, Math.ceil(pool.length * cfg.cutPercent));
      ids = scored.slice(0, cut).map(r => r.id);
    }
    qualifyAPI(fromPhase + 1, ids);
    const nd = { ...data, qualified: { ...data.qualified, [`p${fromPhase + 1}`]: ids } };
    await persist(nd);
    setConfirmPhase(null);
  };

  const resetPhase = async (p) => {
    const ns = { ...data.scores };
    Object.keys(ns).filter(k => k.startsWith(`${p}_`)).forEach(k => delete ns[k]);
    const nq = { ...data.qualified };
    for (let i = p; i <= 4; i++) delete nq[`p${i+1}`];
    await persist({ ...data, scores: ns, qualified: nq });
  };

  const phaseUnlocked = (p) => p === 1 || (data.qualified[`p${p}`]?.length > 0);

  // ── Componentes internos ──────────────────────────────────────────
  const Pill = ({ bg, tc, label, onClick, active, locked }) => (
    <button onClick={!locked ? onClick : undefined} style={{
      padding: "7px 15px", borderRadius: 99, border: "none", cursor: locked ? "not-allowed" : "pointer",
      background: active ? bg : "transparent",
      color: active ? tc : locked ? C.grayMid : C.textSub,
      fontWeight: active ? 700 : 400, fontSize: 13,
      outline: active ? `2px solid ${bg}` : `1.5px solid ${C.grayMid}`,
      outlineOffset: active ? -2 : 0, opacity: locked ? .4 : 1, transition: "all .18s",
    }}>{label}</button>
  );

  const BigBtn = ({ bg, tc, label, onClick, disabled }) => (
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
            {[C.purple,C.blue,C.orange,C.green].map((c,i)=>(<div key={i} style={{ background:c, borderRadius:4 }} />))}
          </div>
          <div>
            <div style={{ color:C.white, fontWeight:800, fontSize:15, letterSpacing:1 }}>CORE 2026</div>
            <div style={{ color:C.grayMid, fontSize:10 }}>Juez: {user?.nombre} {user?.offline && "⚠ offline"}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {(saveMsg || apiLoading) && <span style={{ fontSize:11, color: saveMsg.startsWith("✓") ? C.green : C.orange }}>{apiLoading ? "📡 sync…" : saveMsg}</span>}
          {isAdmin && <button onClick={() => { setAdminOpen(!adminOpen); setAdminPinInput(""); }} style={{ background:"transparent", border:`1.5px solid ${C.grayMid}`, borderRadius:8, padding:"4px 10px", color:C.grayMid, fontSize:12, cursor:"pointer" }}>⚙</button>}
          <button onClick={load} style={{ background:"transparent", border:`1.5px solid ${C.grayMid}`, borderRadius:8, padding:"4px 10px", color:C.grayMid, fontSize:12, cursor:"pointer" }}>↺</button>
          <button onClick={logout} style={{ background:"transparent", border:`1.5px solid ${C.orange}44`, borderRadius:8, padding:"4px 10px", color:C.orange, fontSize:12, cursor:"pointer" }}>Salir</button>
        </div>
      </div>

      {/* API ERROR BANNER */}
      {apiError && (
        <div style={{ background:"#FF550022", borderBottom:`2px solid ${C.orange}`, padding:"10px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:C.orange, fontSize:13 }}>⚠ {apiError}</span>
          <button onClick={()=>setApiError(null)} style={{ background:"transparent", border:"none", color:C.orange, cursor:"pointer", fontSize:16 }}>✕</button>
        </div>
      )}

      {/* ADMIN PANEL */}
      {adminOpen && isAdmin && (
        <div style={{ background:"#e8eaf6", borderBottom:`3px solid ${C.purple}`, padding:"12px 18px" }}>
          {!adminOk ? (
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:13 }}>PIN admin:</span>
              <input type="password" value={adminPinInput} onChange={e => setAdminPinInput(e.target.value)} style={{ width:90, borderRadius:8, border:`1.5px solid ${C.purple}`, padding:"5px 10px" }} />
              <button onClick={() => { if (adminPinInput === "9999") setAdminOk(true); else setSaveMsg("⚠ PIN incorrecto"); }} style={{ background:C.purple, color:C.white, border:"none", borderRadius:8, padding:"6px 14px", cursor:"pointer", fontWeight:700 }}>Entrar</button>
            </div>
          ) : (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              <span style={{ fontSize:13, fontWeight:700, color:C.purple }}>🔓 Admin</span>
              <button onClick={() => setManageTeams(!manageTeams)} style={{ fontSize:12, background:C.blue, color:C.white, border:"none", borderRadius:8, padding:"5px 12px", cursor:"pointer" }}>👥 Equipos</button>
              {[1,2,3,4].map(p => <button key={p} onClick={() => { if (window.confirm(`¿Reiniciar Fase ${p}?`)) resetPhase(p); }} style={{ fontSize:12, background:C.orange, color:C.white, border:"none", borderRadius:8, padding:"5px 12px", cursor:"pointer" }}>Reset F{p}</button>)}
              <button onClick={() => { if (window.confirm("¿Borrar TODO?")) persist(defaultData()); }} style={{ fontSize:12, background:"#cc0000", color:C.white, border:"none", borderRadius:8, padding:"5px 12px", cursor:"pointer" }}>Reset Total</button>
              <button onClick={() => { setAdminOk(false); setAdminOpen(false); }} style={{ fontSize:12, background:C.grayMid, color:C.dark, border:"none", borderRadius:8, padding:"5px 12px", cursor:"pointer" }}>Cerrar</button>
            </div>
          )}
        </div>
      )}

      {/* TEAM MANAGEMENT */}
      {manageTeams && adminOk && (
        <div style={{ margin:"12px 18px", background:C.white, borderRadius:16, padding:"1rem 1.25rem", border:`2px solid ${C.purple}` }}>
          <div style={{ fontWeight:700, color:C.purple, marginBottom:10 }}>Gestión de Equipos</div>
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <input value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="Nombre del equipo…" style={{ flex:1, borderRadius:8, border:`1.5px solid ${C.purple}`, padding:"7px 12px" }}
              onKeyDown={e => { if (e.key==="Enter" && newTeamName.trim()) { const mx=Math.max(0,...data.teams.map(t=>t.id)); persist({...data,teams:[...data.teams,{id:mx+1,name:newTeamName.trim()}]}); setNewTeamName(""); }}} />
            <button onClick={() => { if (!newTeamName.trim()) return; const mx=Math.max(0,...data.teams.map(t=>t.id)); persist({...data,teams:[...data.teams,{id:mx+1,name:newTeamName.trim()}]}); setNewTeamName(""); }} style={{ background:C.purple, color:C.white, border:"none", borderRadius:8, padding:"7px 16px", fontWeight:700, cursor:"pointer" }}>+ Agregar</button>
          </div>
          <div style={{ maxHeight:220, overflowY:"auto", display:"flex", flexDirection:"column", gap:6 }}>
            {data.teams.map(t => (
              <div key={t.id} style={{ display:"flex", gap:8, alignItems:"center" }}>
                <input defaultValue={t.name} style={{ flex:1, borderRadius:8, border:`1.5px solid ${C.grayMid}`, padding:"5px 10px", fontSize:13 }}
                  onBlur={e => { if (e.target.value !== t.name) persist({ ...data, teams: data.teams.map(x => x.id===t.id ? {...x, name:e.target.value} : x) }); }} />
                <button onClick={() => { if (window.confirm(`¿Eliminar "${t.name}"?`)) persist({...data, teams:data.teams.filter(x=>x.id!==t.id)}); }} style={{ background:C.orange, color:C.white, border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer" }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NAV */}
      <div style={{ padding:"14px 18px 0", display:"flex", gap:8, flexWrap:"wrap" }}>
        <Pill bg={C.dark} tc={C.white} label="📊 Panel" onClick={()=>setView("dashboard")} active={view==="dashboard"} />
        {[1,2,3,4].map(p => {
          const cfg = phaseConfig[p];
          return <Pill key={p} bg={PHASE_COLOR[p]} tc={PHASE_TEXT[p]} label={`${cfg.icon} ${cfg.label}`} onClick={()=>{setPhase(p);setView("phase");}} active={view==="phase"&&phase===p} locked={!phaseUnlocked(p)} />;
        })}
      </div>

      <div style={{ padding:"16px 18px 0" }}>

        {/* ── DASHBOARD ── */}
        {view === "dashboard" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12, marginBottom:18 }}>
              {[1,2,3,4].map(p => {
                const eligible = p===1 ? data.teams : (data.qualified[`p${p}`]||[]).map(id=>({id}));
                const scored = eligible.filter(t => calcScore(p, data.scores[`${p}_${t.id}`]) != null).length;
                const total = eligible.length; const pct = total ? Math.round(scored/total*100) : 0;
                return (
                  <div key={p} onClick={()=>{ if(phaseUnlocked(p)){setPhase(p);setView("phase");}}} style={{ background:C.white, borderRadius:16, padding:"14px 16px", borderTop:`5px solid ${PHASE_COLOR[p]}`, cursor:phaseUnlocked(p)?"pointer":"default", opacity:phaseUnlocked(p)?1:.5 }}>
                    <div style={{ fontSize:24, marginBottom:4 }}>{phaseConfig[p].icon}</div>
                    <div style={{ fontWeight:800, fontSize:14, color:PHASE_COLOR[p] }}>{phaseConfig[p].label}</div>
                    <div style={{ fontWeight:600, fontSize:13, color:C.text, marginBottom:6 }}>{phaseConfig[p].title}</div>
                    <div style={{ background:C.gray, borderRadius:99, height:6, overflow:"hidden" }}>
                      <div style={{ background:PHASE_COLOR[p], width:`${pct}%`, height:"100%", borderRadius:99, transition:"width .5s" }} />
                    </div>
                    <div style={{ fontSize:12, color:C.textSub, marginTop:4 }}>{scored}/{total} evaluados</div>
                  </div>
                );
              })}
            </div>

            {/* Acumulado */}
            <div style={{ background:C.white, borderRadius:16, padding:"14px 16px", marginBottom:14 }}>
              <div style={{ fontWeight:800, fontSize:15, color:C.dark, marginBottom:12 }}>🏆 Acumulado (F2+F3+F4)</div>
              {[...data.teams].map(t=>({...t, s2:calcScore(2,data.scores[`2_${t.id}`])||0, s3:calcScore(3,data.scores[`3_${t.id}`])||0, s4:calcScore(4,data.scores[`4_${t.id}`])||0})).map(t=>({...t,total:+(t.s2+t.s3+t.s4).toFixed(2)})).sort((a,b)=>b.total-a.total).map((t,i)=>(
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:`1px solid ${C.gray}` }}>
                  <div style={{ width:26, height:26, borderRadius:8, background:i<3?[C.green,C.blue,C.purple][i]:C.gray, display:"flex", alignItems:"center", justifyContent:"center", color:i<3?C.white:C.textSub, fontWeight:700, fontSize:13, flexShrink:0 }}>{i<3?["🥇","🥈","🥉"][i]:i+1}</div>
                  <div style={{ flex:1, fontWeight:600, fontSize:13 }}>{t.name}</div>
                  <div style={{ display:"flex", gap:8, fontSize:12, color:C.textSub }}>
                    <span style={{color:PHASE_COLOR[2]}}>F2:{t.s2||"–"}</span>
                    <span style={{color:PHASE_COLOR[3]}}>F3:{t.s3||"–"}</span>
                    <span style={{color:PHASE_COLOR[4]}}>F4:{t.s4||"–"}</span>
                  </div>
                  <div style={{ fontWeight:800, fontSize:16, color:C.dark, minWidth:36, textAlign:"right" }}>{t.total||"–"}</div>
                </div>
              ))}
            </div>
            {data.lastUpdated && <div style={{ fontSize:11, color:C.textSub, textAlign:"right" }}>Actualizado: {new Date(data.lastUpdated).toLocaleTimeString("es")}</div>}
          </div>
        )}

        {/* ── PHASE LIST ── */}
        {view === "phase" && (
          <div>
            <div style={{ background:PHASE_COLOR[phase], borderRadius:16, padding:"16px 18px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ color:PHASE_TEXT[phase], opacity:.8, fontSize:13 }}>{phaseConfig[phase].label}</div>
                <div style={{ color:PHASE_TEXT[phase], fontWeight:800, fontSize:22 }}>{phaseConfig[phase].icon} {phaseConfig[phase].title}</div>
                <div style={{ color:PHASE_TEXT[phase], opacity:.85, fontSize:12, marginTop:4 }}>{phaseConfig[phase].description}</div>
                {phase > 1 && (
                  <div style={{ color:PHASE_TEXT[phase], opacity:.75, fontSize:11, marginTop:2 }}>
                    {data.qualified[`p${phase}`]?.length || 0} equipos clasificados
                    {phaseCutTo[phase] && ` → Top ${phaseCutTo[phase]} a F${phase+1}`}
                  </div>
                )}
              </div>
              {phase < 4 && isAdmin && (
                <button onClick={() => setConfirmPhase(phase)} style={{ background:"rgba(255,255,255,.2)", border:`2px solid rgba(255,255,255,.5)`, color:PHASE_TEXT[phase], borderRadius:12, padding:"10px 14px", fontWeight:700, cursor:"pointer", fontSize:13 }}>
                  Clasificar ▶ F{phase+1}
                </button>
              )}
            </div>

            {phase !== 1 && !data.qualified[`p${phase}`]?.length ? (
              <div style={{ background:C.white, borderRadius:16, padding:"2.5rem", textAlign:"center", color:C.textSub }}>
                <div style={{ fontSize:40 }}>🔒</div>
                <div style={{ marginTop:8, fontWeight:600 }}>Clasifica desde la Fase {phase-1} primero</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {rankings.map((r, i) => {
                  const cutLine = phaseCutTo[phase + 1];
                  const isAboveCut = cutLine && i < cutLine;
                  const isCutBorder = cutLine && i === cutLine - 1;
                  return (
                    <div key={r.id}>
                      <div style={{ background:C.white, borderRadius:14, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, border:`2px solid ${isAboveCut && cutLine ? PHASE_COLOR[phase]+"44" : "transparent"}` }}>
                        <div style={{ width:32, height:32, borderRadius:10, background:i<3&&r.score!=null?[C.green,C.blue,C.purple][i]:C.gray, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, color:i<3&&r.score!=null?C.white:C.textSub, flexShrink:0 }}>
                          {i<3&&r.score!=null?["🥇","🥈","🥉"][i]:i+1}
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700, fontSize:14 }}>{r.name}</div>
                          {r.sd?.judge && <div style={{ fontSize:11, color:C.textSub }}>Juez: {r.sd.judge}</div>}
                          {r.tiebreak != null && phase !== 1 && r.score != null && (
                            <div style={{ fontSize:11, color:C.blue }}>⏱ Tiempo: {r.tiebreak}s</div>
                          )}
                        </div>
                        {r.score != null ? (
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontWeight:800, fontSize:22, color:PHASE_COLOR[phase] }}>{r.score}</div>
                            <div style={{ fontSize:11, color:C.textSub }}>{phase===1?"seg":`/${phaseConfig[phase].max}pts`}</div>
                          </div>
                        ) : <div style={{ color:C.grayMid, fontWeight:600 }}>—</div>}
                        <button onClick={() => openScore(r.id)} style={{ background:PHASE_COLOR[phase], color:PHASE_TEXT[phase], border:"none", borderRadius:10, padding:"8px 14px", fontWeight:700, cursor:"pointer", fontSize:13, flexShrink:0 }}>
                          {r.score!=null?"✏️":"＋"}
                        </button>
                      </div>
                      {isCutBorder && (
                        <div style={{ textAlign:"center", margin:"6px 0", fontSize:12, color:C.orange, fontWeight:700, background:"#FF550022", borderRadius:8, padding:"4px 0" }}>
                          — CORTE: Top {cutLine} de {data.qualified[`p${phase}`]?.length||data.teams.length} (50%) avanzan a F{phase+1} —
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
          return (
            <div>
              <button onClick={() => { setScoringId(null); setView("phase"); }} style={{ background:"transparent", border:`1.5px solid ${C.grayMid}`, borderRadius:10, padding:"7px 14px", cursor:"pointer", fontSize:13, marginBottom:14 }}>← Volver</button>

              <div style={{ background:PHASE_COLOR[phase], borderRadius:"16px 16px 0 0", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ color:PHASE_TEXT[phase], opacity:.8, fontSize:13 }}>{cfg.label} · {cfg.title}</div>
                  <div style={{ color:PHASE_TEXT[phase], fontWeight:800, fontSize:20 }}>{team?.name}</div>
                  <div style={{ color:PHASE_TEXT[phase], opacity:.75, fontSize:12 }}>Juez: {user?.nombre}</div>
                </div>
                {phase !== 1 && (
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:PHASE_TEXT[phase], fontWeight:900, fontSize:44, lineHeight:1 }}>{liveScore ?? "—"}</div>
                    {cfg.max && <div style={{ color:PHASE_TEXT[phase], opacity:.75, fontSize:13 }}>/ {cfg.max}</div>}
                  </div>
                )}
              </div>

              <div style={{ background:C.white, borderRadius:"0 0 16px 16px", padding:"20px", marginBottom:14 }}>
                {cfg.fields.map(field => (
                  <div key={field.key} style={{ marginBottom:22 }}>
                    <div style={{ fontWeight:700, fontSize:14, color:C.dark, marginBottom:10 }}>{field.label}</div>

                    {field.type === "buttons" && (
                      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                        {field.opts.map(opt => {
                          const sel = form[field.key] === opt.value;
                          return <button key={opt.value} onClick={() => setForm(f => ({...f,[field.key]:opt.value}))} style={{ flex:"1 1 80px", minHeight:60, borderRadius:14, border:`3px solid ${sel?opt.color:C.grayMid}`, background:sel?opt.color:C.gray, color:sel?C.white:C.text, fontWeight:700, fontSize:13, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2, boxShadow:sel?`0 4px 12px ${opt.color}55`:"none" }}>
                            <span>{opt.label}</span><span style={{fontSize:11,opacity:.8}}>{opt.sub}</span>
                          </button>;
                        })}
                      </div>
                    )}

                    {field.type === "cards" && (
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        {field.opts.map(opt => {
                          const sel = form[field.key] === opt.value;
                          return <button key={opt.value} onClick={() => setForm(f => ({...f,[field.key]:opt.value}))} style={{ border:`3px solid ${sel?opt.color:C.grayMid}`, background:sel?`${opt.color}18`:C.gray, borderRadius:14, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
                            <div style={{ textAlign:"left" }}>
                              <div style={{ fontWeight:700, fontSize:14, color:sel?opt.color:C.text }}>{opt.label}</div>
                              <div style={{ fontSize:12, color:C.textSub }}>{opt.sub}</div>
                            </div>
                            <div style={{ width:22, height:22, borderRadius:"50%", border:`3px solid ${sel?opt.color:C.grayMid}`, background:sel?opt.color:"transparent", flexShrink:0 }} />
                          </button>;
                        })}
                      </div>
                    )}

                    {field.type === "number" && (
                      <div>
                        <input type="number" min={0} step="0.01" value={form[field.key] ?? ""} onChange={e => setForm(f => ({...f,[field.key]:e.target.value}))}
                          placeholder="0.00" style={{ width:"100%", border:`2px solid ${PHASE_COLOR[phase]}`, borderRadius:14, padding:"14px 16px", fontSize:22, fontWeight:700, color:C.dark, boxSizing:"border-box", textAlign:"center" }} />
                        {field.key === "tiebreak" && (
                          <div style={{ fontSize:11, color:C.blue, marginTop:6, textAlign:"center" }}>
                            ⏱ Este campo solo se usa para desempate cuando hay igualdad de puntaje
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <div style={{ display:"flex", gap:10 }}>
                  <BigBtn bg={PHASE_COLOR[phase]} tc={PHASE_TEXT[phase]} label={apiLoading ? "⏳ Guardando…" : "💾 Guardar Evaluación"} onClick={submitScoreLocal} disabled={apiLoading} />
                  <button onClick={() => { setScoringId(null); setView("phase"); }} style={{ background:C.gray, border:"none", borderRadius:14, padding:"14px 20px", cursor:"pointer", fontWeight:600, color:C.textSub }}>Cancelar</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* CONFIRM MODAL */}
      {confirmPhase && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:50, padding:20 }}>
          <div style={{ background:C.white, borderRadius:20, padding:"1.75rem", maxWidth:380, width:"100%" }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🏁</div>
            <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>Clasificar a Fase {confirmPhase+1}</div>
            {confirmPhase === 1 && (() => {
              const scored = getRankings(data, 1).filter(r => r.score != null);
              return <div style={{ fontSize:14, color:C.textSub, marginBottom:20 }}>
                <strong>TODOS los {scored.length} equipos evaluados</strong> pasan a la Fase 2, ordenados por menor tiempo.<br/>
                <span style={{color:C.orange}}>Asegúrate de que todos los equipos estén evaluados antes de continuar.</span>
              </div>;
            })()}
            {confirmPhase === 2 && (() => {
              const pool = data.qualified["p2"] || [];
              const cut = Math.max(1, Math.ceil(pool.length * 0.5));
              return <div style={{ fontSize:14, color:C.textSub, marginBottom:20 }}>
                Los <strong>Top {cut} de {pool.length} equipos (50%)</strong> avanzan a Fase 3.<br/>Desempate por menor tiempo registrado.
              </div>;
            })()}
            {confirmPhase === 3 && (() => {
              const pool = data.qualified["p3"] || [];
              const cut = Math.max(1, Math.ceil(pool.length * 0.5));
              return <div style={{ fontSize:14, color:C.textSub, marginBottom:20 }}>
                Los <strong>Top {cut} de {pool.length} equipos (50%)</strong> avanzan a la Gran Final.<br/>Desempate por menor tiempo registrado.
              </div>;
            })()}
            <div style={{ display:"flex", gap:10 }}>
              <BigBtn bg={PHASE_COLOR[confirmPhase]} tc={PHASE_TEXT[confirmPhase]} label="✅ Confirmar y Clasificar" onClick={() => doQualify(confirmPhase)} />
              <button onClick={() => setConfirmPhase(null)} style={{ background:C.gray, border:"none", borderRadius:14, padding:"14px 20px", cursor:"pointer", fontWeight:600, color:C.textSub }}>Cancelar</button>
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
