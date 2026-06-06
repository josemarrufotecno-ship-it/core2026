// ═══════════════════════════════════════════════════════════════════
// CORE 2026 — Backend Google Apps Script
// Desplegar como: Web App → Ejecutar como: "Yo" → Acceso: "Cualquiera"
// ═══════════════════════════════════════════════════════════════════

const SS_ID = "TU_ID_AQUI"; // ← Pega aquí el ID de tu Google Sheet
const SPREADSHEET = SpreadsheetApp.openById(SS_ID);

// ─── Estructura de hojas ───────────────────────────────────────────
// Usuarios       → A:PIN | B:Nombre | C:Rol
// Fase_1         → A:EquipoID | B:NombreEquipo | C:Tiempo | D:Juez | E:Timestamp
// Fase_2         → A:EquipoID | B:NombreEquipo | C:Precision | D:Parking | E:Timing | F:Tiebreak | G:Total | H:Juez | I:Timestamp
// Fase_3         → A:EquipoID | B:NombreEquipo | C:Trace1 | D:Trace2 | E:Trace3 | F:Tiebreak | G:Total | H:Juez | I:Timestamp
// Fase_4         → A:EquipoID | B:NombreEquipo | C:Obj1 | D:Obj2 | E:Obj3 | F:Tiebreak | G:Total | H:Juez | I:Timestamp
// Clasificados   → A:Fase | B:EquipoIDs (JSON array)
// Reporte_Final  → Calculada automáticamente desde las fases

// ─── CORS Helper ──────────────────────────────────────────────────
// Sin esto, el fetch desde React falla. Esto es lo que reemplaza 'no-cors'.
function corsResponse(data) {
  const output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  // ContentService no permite setear headers custom directamente,
  // pero al desplegar como "Cualquiera" con doGet/doPost, GAS maneja CORS.
  // Para orígenes específicos, usa HtmlService + appendUntrusted si necesitas mayor control.
  return output;
}

// ─── Tokens de sesión en memoria (PropertiesService) ─────────────
function generateToken(pin) {
  const token = Utilities.getUuid();
  const props = PropertiesService.getScriptProperties();
  const sessions = JSON.parse(props.getProperty("sessions") || "{}");
  sessions[token] = { pin, ts: Date.now() };
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

// ─── doGet — Lectura pública (Leaderboard) ────────────────────────
function doGet(e) {
  try {
    const action = e?.parameter?.action || "GET_LEADERBOARD";
    if (action === "GET_LEADERBOARD") {
      return corsResponse({ status: "ok", leaderboard: buildLeaderboard() });
    }
    return corsResponse({ status: "error", message: "Acción no reconocida" });
  } catch (err) {
    return corsResponse({ status: "error", message: err.message });
  }
}

// ─── doPost — Escritura autenticada ───────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { action } = payload;

    // LOGIN no requiere token
    if (action === "LOGIN") return corsResponse(handleLogin(payload));

    // Todo lo demás requiere token válido
    const session = validateToken(payload.token);
    if (!session) {
      return corsResponse({ status: "error", message: "Sesión inválida o expirada. Vuelve a iniciar sesión." });
    }

    switch (action) {
      case "SUBMIT_SCORE":   return corsResponse(handleSubmitScore(payload, session));
      case "SET_QUALIFIED":  return corsResponse(handleSetQualified(payload, session));
      case "GET_LEADERBOARD": return corsResponse({ status: "ok", leaderboard: buildLeaderboard() });
      default:               return corsResponse({ status: "error", message: `Acción desconocida: ${action}` });
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

  const sheet = SPREADSHEET.getSheetByName("Usuarios");
  if (!sheet) return { status: "error", message: "Hoja 'Usuarios' no encontrada" };

  const data = sheet.getDataRange().getValues();
  // Buscar desde fila 2 (fila 1 = headers)
  for (let i = 1; i < data.length; i++) {
    const rowPin   = String(data[i][0]).trim();
    const nombre   = String(data[i][1]).trim();
    const rol      = String(data[i][2]).trim().toLowerCase();
    if (rowPin === String(pin).trim()) {
      const token = generateToken(pin);
      return { status: "ok", nombre, rol, token };
    }
  }
  return { status: "error", message: "PIN inválido" };
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER: SUBMIT SCORE
// LockService previene colisiones concurrentes
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
  const sheet = SPREADSHEET.getSheetByName(sheetName);
  if (!sheet) return { status: "error", message: `Hoja '${sheetName}' no encontrada` };

  // ── LockService: previene escrituras simultáneas ──────────────
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Esperar hasta 10 segundos por el lock
  } catch (e) {
    return { status: "error", message: "El sistema está ocupado. Intenta en 5 segundos." };
  }

  try {
    const team = getTeamName(equipoId);
    const data = sheet.getDataRange().getValues();

    // Buscar fila existente del equipo
    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(equipoId)) {
        targetRow = i + 1; // +1 porque getValues es 0-indexed, Sheets es 1-indexed
        break;
      }
    }

    const rowData = buildRowData(fase, equipoId, team, payload, juez, timestamp);

    if (targetRow > 0) {
      // Actualizar fila existente
      sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      // Insertar nueva fila
      sheet.appendRow(rowData);
    }

    // Actualizar Reporte_Final
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
                     parseFloat(payload.parking || 0) +
                     parseFloat(payload.timing || 0));
      return [equipoId, teamName, payload.precision, payload.parking, payload.timing,
              payload.tiebreak || "", Math.round(total * 100) / 100, juez, ts];
    }

    case 3: {
      const total = (parseFloat(payload.trace1 || 0) +
                     parseFloat(payload.trace2 || 0) +
                     parseFloat(payload.trace3 || 0));
      return [equipoId, teamName, payload.trace1, payload.trace2, payload.trace3,
              payload.tiebreak || "", Math.round(total * 100) / 100, juez, ts];
    }

    case 4: {
      const total = (parseFloat(payload.obj1 || 0) +
                     parseFloat(payload.obj2 || 0) +
                     parseFloat(payload.obj3 || 0));
      return [equipoId, teamName, payload.obj1, payload.obj2, payload.obj3,
              payload.tiebreak || "", Math.round(total * 100) / 100, juez, ts];
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

  const sheet = SPREADSHEET.getSheetByName("Clasificados") ||
                SPREADSHEET.insertSheet("Clasificados");

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
  [2, 3, 4].forEach(fase => {
    const sheet = SPREADSHEET.getSheetByName(`Fase_${fase}`);
    if (!sheet) return;
    const rows = sheet.getDataRange().getValues();
    rows.slice(1).forEach(row => {
      const id    = String(row[0]);
      const name  = String(row[1]);
      const total = parseFloat(row[6]) || 0; // columna G = Total
      const tb    = parseFloat(row[5]) || 0; // columna F = Tiebreak
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
    let sheet = SPREADSHEET.getSheetByName("Reporte_Final");
    if (!sheet) sheet = SPREADSHEET.insertSheet("Reporte_Final");

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
  const sheet = SPREADSHEET.getSheetByName("Usuarios");
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
  // Puedes crear una hoja "Equipos" o derivar el nombre del ID
  return `Equipo ${String(equipoId).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════
// SETUP: Crea la estructura inicial de la hoja de cálculo
// Ejecutar manualmente UNA VEZ después de desplegar
// ═══════════════════════════════════════════════════════════════════
function setupSpreadsheet() {
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
    let sheet = SPREADSHEET.getSheetByName(name);
    if (!sheet) sheet = SPREADSHEET.insertSheet(name);
    sheet.getRange(1, 1, 1, cols.length).setValues([cols])
         .setFontWeight("bold")
         .setBackground("#1A1A2E")
         .setFontColor("#FFFFFF");
  });

  // Poblar jueces iniciales
  const usuarios = SPREADSHEET.getSheetByName("Usuarios");
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
  Logger.log("✅ Estructura creada exitosamente. Despliega el script como Web App.");
}
