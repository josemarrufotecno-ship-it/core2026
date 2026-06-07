# 🚀 CORE 2026 - Contexto del Proyecto y Registro de Cambios

Este documento resume el estado actual del proyecto "CORE 2026", la arquitectura técnica y todas las modificaciones que se han aplicado hasta ahora. Está diseñado para proporcionar contexto técnico detallado a otros desarrolladores o asistentes de IA (como Claude).

## 🏗️ Arquitectura del Proyecto

- **Frontend:** React + TypeScript, compilado con Vite. Desplegado en Vercel.
- **Backend/Base de Datos:** Google Apps Script (GAS) actuando como API REST, conectado a un Google Sheet (ID: `1rycHuZV27WV_aoFaE40PYgEUipM_8Gbh8RMDd5LFkw0`).
- **Autenticación:** Sistema de PIN simple mapeado a roles (`juez` y `admin`).
- **Persistencia Local:** Uso intensivo de `localStorage` para que la aplicación funcione en entornos con conectividad inestable.

## 🛠️ Modificaciones y Optimizaciones Realizadas

1. **Refactorización Estructural (De Script Único a Proyecto Vite)**
   - Se migró un archivo monolítico de React a una estructura estándar de Vite (`package.json`, `vite.config.ts`, `tsconfig.json`).
   - Se creó un archivo `vercel.json` para asegurar que el enrutamiento SPA (Single Page Application) funcione en producción (`{"rewrites": [{"source": "/(.*)", "destination": "/index.html"}]}`).

2. **Correcciones en el Backend (Google Apps Script - `gas-backend.js`)**
   - **Bug Crítico de Ámbito Global:** Se eliminó la llamada `SpreadsheetApp.openById()` del scope global del script. Al estar en el ámbito global, la inicialización fallaba y arrojaba error 500 antes de ejecutar los handlers. Se movió a una función helper `getSpreadsheet()` que se llama bajo demanda.
   - **Soporte CORS y JSON:** La respuesta de doGet/doPost se envolvió en un helper `corsResponse` que utiliza `ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON)` para manejar adecuadamente las solicitudes cross-origin desde Vercel.

3. **Correcciones en el Frontend (`src/App.tsx`)**
   - **Manejo de Variables de Entorno:** La URL del API de Google Apps Script se movió de código duro a una variable de entorno de Vite (`VITE_GAS_URL`). Se añadió un fallback por defecto en el código en caso de que Vercel pierda la variable.
   - **Sincronización Multi-Dispositivo (Polling):** Se actualizó el método `load()` en el `DashboardLayout` para realizar peticiones periódicas (cada 5 segundos) usando `fetchLeaderboard()`. Los datos remotos se fusionan con el `localStorage` local para mantener la reactividad entre distintos dispositivos.
   - **Reparación del Modo Espectador:** El botón de "Entrar como Espectador" fallaba porque el PIN "0000" no estaba en el registro de usuarios válidos.
   - **Validación de Formularios de Jueces:** Se evitaron envíos de formularios vacíos o incompletos a la hoja de Google.
   - **Nuevo Admin:** Se añadió el PIN `8888` como `admin` de respaldo directamente en el diccionario local `JUECES_AUTORIZADOS`.

## ⚠️ Problema Activo / Incidencia Pendiente

**Reporte del Usuario:** *"No se pudo cargar el leaderboard. Esto desde un juez, yo estoy con el admin y tengo cargado ya información y sigue sin verse."*

**Hipótesis a Investigar (Para Claude o el siguiente dev):**
1. **Problema de Fetch/CORS en GET_LEADERBOARD:** Revisar si el `fetch` de `fetchLeaderboard` está fallando silenciosamente por un bloqueo de CORS en el navegador de los jueces, o si la URL desplegada en Vercel apunta a una implementación antigua del Apps Script.
2. **Lógica de Fusión en Polling:** En `src/App.tsx`, dentro de la función `load()`, se intentan fusionar los datos recibidos del servidor (`serverLeaderboard`) con `localData.scores`. Es posible que el formato devuelto por `buildLeaderboard()` en GAS no coincida con lo que el frontend espera (por ejemplo, `serverTeam.f2` vs `serverTeam.id`).
3. **Caché de Apps Script:** A veces, las implementaciones de Apps Script no reflejan los últimos cambios a menos que se cree explícitamente una *Nueva Implementación* (versión nueva). Verificar si el web app URL corresponde a la última versión del código.
4. **Permisos de la Hoja:** Asegurarse de que el script en Apps Script tiene permisos para leer la hoja y que se implementó para ejecutarse como el Propietario (Owner) permitiendo acceso a "Cualquier usuario" (Anyone).

---
*Archivo generado para facilitar el paso de contexto a otras herramientas de IA.*
