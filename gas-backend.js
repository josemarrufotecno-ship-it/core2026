// ═══════════════════════════════════════════════════════════════════
// CORE 2026 — Backend Google Apps Script
//
// INSTRUCCIONES DE DESPLIEGUE:
//  1. Abre Google Sheets → Extensiones → Apps Script
//  2. Pega TODO este código (reemplaza el contenido existente)
//  3. Clic en "Implementar" → "Nueva implementación"
//  4. Tipo: Aplicación Web
//  5. Ejecutar como: Yo (tu cuenta de Google)
//  6. Quién tiene acceso: Cualquier usuario
//  7. Clic en "Implementar" → copia la URL resultante
//  8. Pon esa URL en la variable VITE_GAS_URL del .env y en Vercel
//
//  PRIMERA VEZ: Ejecutar manualmente la función setupSpreadsheet()
//  desde el editor de Apps Script para crear la estructura de hojas.
//
// CAMBIOS APLICADOS:
//  FIX: SpreadsheetApp.openById() ya NO está en el nivel global.
//       Antes fallaba al cargar si el ID no estaba configurado.
//       Ahora se llama dentro de cada función que lo necesita,
//       usando la función helper getSpreadsheet().
// ═══════════════════════════════════════════════════════════════════

// ─── ID del Google Sheet ──────────────────────────────────────────
// ID real de la hoja de cálculo del torneo CORE 2026
const SS_ID = "1rycHuZV27WV_aoFaE40PYgEUipM_8Gbh8RMDd5LFkw0";

// FIX: Helper en lugar de variable global para evitar error al cargar
// SpreadsheetApp.openById() solo es válido dentro de una función GAS
function getSpreadsheet() {
  return SpreadsheetApp.openById(SS_ID);
}

// ─── Estructura de hojas ──────────────────────────────────────────
// Usuarios       → A:PIN | B:Nombre | C:Rol
// Fase_1         → A:EquipoID | B:NombreEquipo | C:Tiempo | D:Juez | E:Timestamp
// Fase_2         → A:EquipoID | B:NombreEquipo | C:Precision | D:Parking | E:Timing | F:Tiebreak | G:Total | H:Juez | I:Timestamp
// Fase_3         → A:EquipoID | B:NombreEquipo | C:Trace1 | D:Trace2 | E:Trace3 | F:Tiebreak | G:Total | H:Juez | I:Timestamp
// Fase_4         → A:EquipoID | B:NombreEquipo | C:Obj1 | D:Obj2 | E:Obj3 | F:Tiebreak | G:Total | H:Juez | I:Timestamp
// Clasificados   → A:Fase | B:EquipoIDs (JSON array) | C:Timestamp
// Reporte_Final  → Calculada automáticamente desde las fases

// ─── CORS Helper ──────────────────────────────────────────────────
// Sin esto, el fetch desde React falla. Esto es lo que reemplaza 'no-cors'.
// Al desplegar como "Cualquiera", GAS maneja CORS automáticamente en doGet/doPost.
function corsResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Tokens de sesión en PropertiesService ────────────────────────
function generateToken(pin) {
  const token = Utilities.getUuid();
  const props = PropertiesService.getScriptProperties();
  const sessions = JSON.parse(props.getProperty("sessions") || "{}");
  sessions[token] = { pin, ts: Date.now() };
  // Limpiar tokens expirados (> 12h) para no acumular
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  Object.keys(sessions).forEach(k => {
    if (sessions[k].ts < cutoff) delete sessions[k];
  });
  props.setProperty("sessions", JSON.stringify(sessions));
  return token;
}

function validateToken(token) {
  if (!token) return null;
  const props = PropertiesService.getScriptProperties();
  const sessions = JSON.parse(props.getProperty("sessions") || "{}");
  const session = sessions[token];
  if (!session) return null;
  // Token válido por 12 horas
  if (Date.now() - session.ts > 12 * 60 * 60 * 1000) return null;
  return session;
}

// ─── doGet — Lectura pública (Leaderboard sin auth) ──────────────
function doGet(e) {
  try {
    const action = e?.parameter?.action || "GET_LEADERBOARD";
    if (action === "GET_LEADERBOARD") {
      return corsResponse({ status: "ok", leaderboard: buildLeaderboard() });
    }
    return corsResponse({ status: "error", message: "Acción no reconocida" });
  } catch (err) {
    console.error("doGet error:", err.message);
    return corsResponse({ status: "error", message: err.message });
  }
}

// ─── doPost — Escritura autenticada ──────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { action } = payload;

    // LOGIN no requiere token previo
    if (action === "LOGIN") return corsResponse(handleLogin(payload));

    // Todo lo demás requiere token válido
    const session = validateToken(payload.token);
    if (!session) {
      return corsResponse({
        status: "error",
        message: "Sesión inválida o expirada. Vuelve a iniciar sesión."
      });
    }

    switch (action) {
      case "SUBMIT_SCORE":
        return corsResponse(handleSubmitScore(payload, session));
      case "SET_QUALIFIED":
        return corsResponse(handleSetQualified(payload, session));
      case "GET_LEADERBOARD":
        return corsResponse({ status: "ok", leaderboard: buildLeaderboard() });
      default:
        return corsResponse({ status: "error", message: `Acción desconocida: ${action}` });
    }
  } catch (err) {
    console.error("doPost error:", err.message, err.stack);
    return corsResponse({ status: "error", message: "Error interno del servidor: " + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER: LOGIN
// ═══════════════════════════════════════════════════════════════════
function handleLogin({ pin }) {
  if (!pin) return { status: "error", message: "PIN requerido" };

  // FIX: usar getSpreadsheet() en lugar de SPREADSHEET global
  const sheet = getSpreadsheet().getSheetByName("Usuarios");
  if (!sheet) return { status: "error", message: "Hoja 'Usuarios' no encontrada. Ejecuta setupSpreadsheet() primero." };

  const data = sheet.getDataRange().getValues();
  // Buscar desde fila 2 (fila 1 = headers)
  for (let i = 1; i < data.length; i++) {
    const rowPin = String(data[i][0]).trim();
    const nombre = String(data[i][1]).trim();
    const rol    = String(data[i][2]).trim().toLowerCase();
    if (rowPin === String(pin).trim()) {
      const token = generateToken(pin);
      return { status: "ok", nombre, rol, token };
    }
  }
  return { status: "error", message: "PIN inválido" };
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER: SUBMIT SCORE
// LockService previene colisiones concurrentes (múltiples jueces)
// ═══════════════════════════════════════════════════════════════════
function handleSubmitScore(payload, session) {
  const { fase, equipoId, juez, timestamp } = payload;

  if (!fase || !equipoId) {
    return { status: "error", message: "Faltan campos requeridos: fase y equipoId" };
  }

  // Solo jueces y admins pueden enviar puntajes
  const userRole = getUserRole(session.pin);
  if (!["juez", "admin"].includes(userRole)) {
    return { status: "error", message: "Sin permisos para enviar puntajes" };
  }

  const sheetName = `Fase_${fase}`;
  // FIX: usar getSpreadsheet() en lugar de SPREADSHEET global
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return { status: "error", message: `Hoja '${sheetName}' no encontrada` };

  // ── LockService: previene escrituras simultáneas ───────────────
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Esperar hasta 10 segundos
  } catch (e) {
    return { status: "error", message: "El sistema está ocupado. Intenta en 5 segundos." };
  }

  try {
    const team = getTeamName(equipoId);
    const data = sheet.getDataRange().getValues();

    // Buscar fila existente del equipo (para actualizar, no duplicar)
    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(equipoId)) {
        targetRow = i + 1; // +1: getValues es 0-indexed, Sheets es 1-indexed
        break;
      }
    }

    const rowData = buildRowData(fase, equipoId, team, payload, juez, timestamp);

    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    // Actualizar el reporte consolidado
    updateReporteFinal();

    return { status: "ok", message: "Puntaje guardado correctamente", equipoId, fase };

  } finally {
    lock.releaseLock(); // SIEMPRE liberar el lock
  }
}

// ─── Construir fila según la fase ────────────────────────────────
function buildRowData(fase, equipoId, teamName, payload, juez, timestamp) {
  const ts = timestamp || new Date().toISOString();
  switch (parseInt(fase)) {
    case 1:
      return [equipoId, teamName, payload.time, juez, ts];

    case 2: {
      const total = (parseFloat(payload.precision || 0) +
                     parseFloat(payload.parking   || 0) +
                     parseFloat(payload.timing     || 0));
      return [
        equipoId, teamName,
        payload.precision, payload.parking, payload.timing,
        payload.tiebreak || "",
        Math.round(total * 100) / 100,
        juez, ts
      ];
    }

    case 3: {
      const total = (parseFloat(payload.trace1 || 0) +
                     parseFloat(payload.trace2 || 0) +
                     parseFloat(payload.trace3 || 0));
      return [
        equipoId, teamName,
        payload.trace1, payload.trace2, payload.trace3,
        payload.tiebreak || "",
        Math.round(total * 100) / 100,
        juez, ts
      ];
    }

    case 4: {
      const total = (parseFloat(payload.obj1 || 0) +
                     parseFloat(payload.obj2 || 0) +
                     parseFloat(payload.obj3 || 0));
      return [
        equipoId, teamName,
        payload.obj1, payload.obj2, payload.obj3,
        payload.tiebreak || "",
        Math.round(total * 100) / 100,
        juez, ts
      ];
    }

    default:
      throw new Error(`Fase desconocida: ${fase}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER: SET QUALIFIED (solo admin)
// ═══════════════════════════════════════════════════════════════════
function handleSetQualified(payload, session) {
  const userRole = getUserRole(session.pin);
  if (userRole !== "admin") {
    return { status: "error", message: "Solo el administrador puede clasificar equipos" };
  }

  const { fase, teamIds } = payload;
  if (!fase || !teamIds) return { status: "error", message: "Faltan fase o teamIds" };

  // FIX: usar getSpreadsheet() en lugar de SPREADSHEET global
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName("Clasificados") || ss.insertSheet("Clasificados");

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { status: "error", message: "Sistema ocupado" }; }

  try {
    const data = sheet.getDataRange().getValues();
    let faseRow = -1;
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(fase)) { faseRow = i + 1; break; }
    }
    const rowData = [fase, JSON.stringify(teamIds), new Date().toISOString()];
    if (faseRow > 0) {
      sheet.getRange(faseRow, 1, 1, 3).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }
    return { status: "ok", message: `Clasificación F${fase} guardada: ${teamIds.length} equipos` };
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════════
// LEADERBOARD BUILDER
// ═══════════════════════════════════════════════════════════════════
function buildLeaderboard() {
  const result = {};
  // FIX: usar getSpreadsheet() en lugar de SPREADSHEET global
  const ss = getSpreadsheet();

  [2, 3, 4].forEach(fase => {
    const sheet = ss.getSheetByName(`Fase_${fase}`);
    if (!sheet) return;
    const rows = sheet.getDataRange().getValues();
    rows.slice(1).forEach(row => {
      const id    = String(row[0]);
      const name  = String(row[1]);
      const total = parseFloat(row[6]) || 0; // columna G = Total
      const tb    = parseFloat(row[5]) || 0; // columna F = Tiebreak
      if (!id || id === "EquipoID") return; // Saltar headers si accidentalmente se leen
      if (!result[id]) result[id] = { id, name, f2: 0, f3: 0, f4: 0, tb2: 0, tb3: 0, tb4: 0 };
      result[id][`f${fase}`] = total;
      result[id][`tb${fase}`] = tb;
    });
  });

  return Object.values(result)
    .map(t => ({ ...t, total: +(t.f2 + t.f3 + t.f4).toFixed(2) }))
    .sort((a, b) => b.total - a.total || a.tb4 - b.tb4);
}

// ─── Actualizar hoja Reporte_Final ───────────────────────────────
function updateReporteFinal() {
  try {
    const lb = buildLeaderboard();
    // FIX: usar getSpreadsheet() en lugar de SPREADSHEET global
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName("Reporte_Final");
    if (!sheet) sheet = ss.insertSheet("Reporte_Final");

    sheet.clearContents();
    sheet.appendRow(["Posición", "EquipoID", "Nombre", "F2", "F3", "F4", "Total", "Actualizado"]);
    lb.forEach((t, i) => {
      sheet.appendRow([i + 1, t.id, t.name, t.f2, t.f3, t.f4, t.total, new Date().toISOString()]);
    });
  } catch (err) {
    console.error("Error actualizando Reporte_Final:", err.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────
function getUserRole(pin) {
  // FIX: usar getSpreadsheet() en lugar de SPREADSHEET global
  const sheet = getSpreadsheet().getSheetByName("Usuarios");
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(pin).trim()) {
      return String(data[i][2]).trim().toLowerCase();
    }
  }
  return null;
}

function getTeamName(equipoId) {
  return `Equipo ${String(equipoId).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════
// SETUP: Crea la estructura inicial de la hoja de cálculo
// ─────────────────────────────────────────────────────────────────
// INSTRUCCIÓN: Ejecutar MANUALMENTE desde Apps Script UNA SOLA VEZ
// después de desplegar. Menú: Ejecutar → setupSpreadsheet
// ═══════════════════════════════════════════════════════════════════
function setupSpreadsheet() {
  const ss = getSpreadsheet(); // FIX: usar helper en lugar de global

  const headers = {
    "Usuarios":       ["PIN", "Nombre", "Rol"],
    "Fase_1":         ["EquipoID", "Nombre", "Tiempo", "Juez", "Timestamp"],
    "Fase_2":         ["EquipoID", "Nombre", "Precision", "Parking", "Timing", "Tiebreak", "Total", "Juez", "Timestamp"],
    "Fase_3":         ["EquipoID", "Nombre", "Trace1", "Trace2", "Trace3", "Tiebreak", "Total", "Juez", "Timestamp"],
    "Fase_4":         ["EquipoID", "Nombre", "Obj1", "Obj2", "Obj3", "Tiebreak", "Total", "Juez", "Timestamp"],
    "Clasificados":   ["Fase", "EquiposJSON", "Timestamp"],
    "Reporte_Final":  ["Posicion", "EquipoID", "Nombre", "F2", "F3", "F4", "Total", "Actualizado"],
  };

  Object.entries(headers).forEach(([name, cols]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    // Limpiar y escribir headers con estilo
    sheet.clearContents();
    sheet.getRange(1, 1, 1, cols.length)
      .setValues([cols])
      .setFontWeight("bold")
      .setBackground("#1A1A2E")
      .setFontColor("#FFFFFF");
  });

  // Poblar jueces iniciales en la hoja Usuarios
  const usuarios = ss.getSheetByName("Usuarios");
  const jueces = [
    ["1001", "Alexis Cáceres",      "juez"],
    ["1002", "Abril Urdaneta",      "juez"],
    ["1003", "Mirian Echenique",    "juez"],
    ["1004", "Oscar Alvarado",      "juez"],
    ["1005", "Jose Marrufo",        "juez"],
    ["1006", "Jehova Leal",         "juez"],
    ["1007", "Xioleidy Colmenarez", "juez"],
    ["1008", "Mariangela Moreno",   "juez"],
    ["1009", "Mariangel Rojas",     "juez"],
    ["9999", "Admin Master",        "admin"],
  ];
  jueces.forEach(row => usuarios.appendRow(row));

  SpreadsheetApp.flush();
  Logger.log("✅ Estructura creada exitosamente en la hoja: " + SS_ID);
  Logger.log("✅ Jueces poblados. Ahora despliega el script como Web App.");
}
