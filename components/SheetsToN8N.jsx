"use client";
import React, { useEffect, useMemo, useState } from "react";

const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "19265018680-6ba2ee602hgbcue9l891pt2heg03hfqb.apps.googleusercontent.com";

export default function SheetsToN8N() {
  // Estado de librerías y auth
  const [gisLoaded, setGisLoaded] = useState(false);
  const [gapiLoaded, setGapiLoaded] = useState(false);
  const [token, setToken] = useState(null);
  const [permitirVacios, setPermitirVacios] = useState(true);


  // UI
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [toast, setToast] = useState({ open: false, type: "info", message: "" });

  // Entrada manual de URL/ID
  const [sheetUrl, setSheetUrl] = useState("");

  // Dropdown #1: Spreadsheets
  const [spreadsheetList, setSpreadsheetList] = useState([]);
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [loadingSheetsList, setLoadingSheetsList] = useState(false);

  // Dropdown #2: Hojas
  const [tabs, setTabs] = useState([]);
  const [sheetName, setSheetName] = useState("");
  const [loadingTabs, setLoadingTabs] = useState(false);

  // Dropdown #3: Respuesta
  const [selectedColIndex2, setSelectedColIndex2] = useState(0);
  const [preguntaRow2, setPreguntaRow2] = useState(2);
  const [respuestaRow2, setRespuestaRow2] = useState(3);

  // IA 
  const [selectedColIndex3, setSelectedColIndex3] = useState(0);
  const [preguntaRow3, setPreguntaRow3] = useState(2);
  const [respuestaRow3, setRespuestaRow3] = useState(3);

  // Tipo de pregunta
  const [tipoPregunta, setTipoPregunta] = useState("Problemas");

  // Datos de la hoja seleccionada
  const [values, setValues] = useState([]); // matriz de celdas
  const [loadingValues, setLoadingValues] = useState(false);

  // Selección de columna + filas para "pregunta" y "respuesta"
  const [selectedColIndex, setSelectedColIndex] = useState(0); // 0 = columna A
  const [preguntaRow, setPreguntaRow] = useState(2); // 2 = primera fila de datos (asumiendo fila 1 = encabezados)
  const [respuestaRow, setRespuestaRow] = useState(3);

  // Derivados
  const headers = useMemo(() => (values?.[0] ?? []), [values]);
  const colLetter = useMemo(() => indexToColumnLetter(selectedColIndex), [selectedColIndex]);
  const preguntaPreview = useMemo(() => safeCell(values, preguntaRow - 1, selectedColIndex), [values, preguntaRow, selectedColIndex]);
  const respuestaPreview = useMemo(() => safeCell(values, respuestaRow - 1, selectedColIndex), [values, respuestaRow, selectedColIndex]);

  const colLetter2 = indexToColumnLetter(selectedColIndex2);
  const preguntaPreview2 = values?.[preguntaRow2 - 1]?.[selectedColIndex2];
  const respuestaPreview2 = values?.[respuestaRow2 - 1]?.[selectedColIndex2];

  const colLetter3 = indexToColumnLetter(selectedColIndex3);
  const preguntaPreview3 = values?.[preguntaRow3 - 1]?.[selectedColIndex3];
  const respuestaPreview3 = values?.[respuestaRow3 - 1]?.[selectedColIndex3];

  // 'idle' | 'sending' | 'queued' | 'error'
  const [progress, setProgress] = useState("idle"); 
  const [sendLocked, setSendLocked] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [polling, setPolling] = useState(false);

  // Toast helper
  const showToast = (type, message, timeout = 2600) => {
    setToast({ open: true, type, message });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast((t) => ({ ...t, open: false })), timeout);
  };

  // Cargar scripts externos
  const loadScript = (src) =>
    new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = res;
      s.onerror = rej;
      document.body.appendChild(s);
    });

  // Cargar GIS + gapi al inicio
  useEffect(() => {
    (async () => {
      try {
        await loadScript("https://accounts.google.com/gsi/client");
        setGisLoaded(true);
        await loadScript("https://apis.google.com/js/api.js");
        await new Promise((resolve) => window.gapi.load("client", resolve));
        await window.gapi.client.init({
          discoveryDocs: [
            "https://sheets.googleapis.com/$discovery/rest?version=v4",
            "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
          ],
        });
        setGapiLoaded(true);
        setStatus("Librerías de Google listas ✅");
      } catch (e) {
        console.error(e);
        setStatus("Error cargando librerías de Google");
        showToast("error", "No se pudieron cargar las librerías de Google");
      }
    })();
  }, []);


useEffect(() => {
  setSendLocked(false);
  setProgress("idle");
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [spreadsheetId, sheetName, selectedColIndex, selectedColIndex2, preguntaRow, respuestaRow, tipoPregunta]);


  // Extraer ID de URL o aceptar ID directo
  const parseSpreadsheetId = (urlOrId) => {
    const m = String(urlOrId).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]+$/.test(urlOrId)) return urlOrId;
    return "";
  };

  // Login con Google
  const handleLogin = () => {
    if (!gisLoaded || !gapiLoaded) return;
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ].join(" "),
      callback: (resp) => {
        if (resp?.access_token) {
          setToken(resp.access_token);
          setStatus("Conectado con Google ✅");
          showToast("success", "Conectado con Google");
        } else {
          setStatus("No se obtuvo token");
          showToast("error", "No se obtuvo token de Google");
        }
      },
    });
    tokenClient.requestAccessToken();
  };

  // Listar spreadsheets desde Drive
  const fetchSpreadsheetList = async () => {
    if (!token) return;
    try {
      setLoadingSheetsList(true);
      window.gapi.client.setToken({ access_token: token });
      const res = await window.gapi.client.drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: "files(id, name)",
        pageSize: 50,
      });
      const files = res.result?.files || [];
      setSpreadsheetList(files);
      setSpreadsheetId((prev) => prev || files[0]?.id || "");
      setStatus(`Spreadsheets disponibles: ${files.length}`);
      showToast("info", `Se encontraron ${files.length} spreadsheets`);
    } catch (e) {
      console.error(e);
      setStatus("Error listando tus spreadsheets");
      showToast("error", "Revisa permisos o Drive API");
    } finally {
      setLoadingSheetsList(false);
    }
  };

  useEffect(() => {
    if (token) fetchSpreadsheetList();
  }, [token]);

  // Cargar pestañas de un spreadsheet
  const fetchTabs = async (id) => {
    if (!token || !id) return;
    try {
      setLoadingTabs(true);
      window.gapi.client.setToken({ access_token: token });
      const res = await window.gapi.client.sheets.spreadsheets.get({
        spreadsheetId: id,
        includeGridData: false,
      });
      const titles =
        res.result.sheets?.map((s) => s.properties?.title).filter(Boolean) ?? [];
      setTabs(titles);
      setSheetName((prev) => prev || titles[0] || "");
      setStatus(`Hojas encontradas: ${titles.length}`);
      showToast("info", `${titles.length} hojas encontradas`);
    } catch (e) {
      console.error(e);
      setStatus("Error cargando hojas");
      showToast("error", "No se pudieron cargar las hojas");
    } finally {
      setLoadingTabs(false);
    }
  };

  useEffect(() => {
    if (spreadsheetId && spreadsheetList.some ((s) => s.id === spreadsheetId)) {
    fetchTabs(spreadsheetId);
    }
  }, [spreadsheetId, spreadsheetList]);

  // Cargar valores de una hoja (primeras N filas y columnas)
  const fetchValues = async (id, tabName) => {
    if (!token || !id || !tabName) return;
    try {
      setLoadingValues(true);
      window.gapi.client.setToken({ access_token: token });
      // Rango amplio para cubrir columnas/filas comunes (ajusta si ocupas más)
      const range = `${escapeSheetName(tabName)}!A1:ZZ5000`;
      const res = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      });
      setValues(res.result.values || []);
      // Resetea selección de columna si se pasa de rango
      setSelectedColIndex((idx) => Math.min(idx, (res.result.values?.[0]?.length ?? 1) - 1));
      setStatus(`Celdas cargadas (${res.result.values?.length || 0} filas)`);
    } catch (e) {
      console.error(e);
      setStatus("Error cargando celdas");
      showToast("error", "No se pudieron cargar las celdas de la hoja");
    } finally {
      setLoadingValues(false);
    }
  };

  useEffect(() => {
    if (spreadsheetId && sheetName) fetchValues(spreadsheetId, sheetName);
  }, [spreadsheetId, sheetName]);

  const handleUseManualUrl = async () => {
    const id = parseSpreadsheetId(sheetUrl);
    if (!id) {
      showToast("error", "URL/ID no válido");
      return;
    }
    
    if (!token) {
      showToast("error", "Primero debes conectarte con Google");
      return;
    }

    // Resetear estado previo
    setSheetName("");
    setTabs([]);
    setValues([]);
    
    // Actualizar spreadsheetId y cargar tabs
    setSpreadsheetId(id);

    //cargar tabs
    setLoadingTabs(true);
    window.gapi.client.setToken({ access_token: token });
    const res = await window.gapi.client.sheets.spreadsheets.get({
      spreadsheetId: id,
      includeGridData: false,
    });
    const titles = res.result.sheets?.map((s) => s.properties?.title).filter(Boolean) ?? [];
    setTabs(titles);
    setSheetName(titles[0] || "");
    setLoadingTabs(false);
    showToast("success", "Spreadsheet seleccionado desde URL/ID");
  };

 const handleSendToN8N = async () => {
  if (sendLocked) {
    showToast("info", "Ya se envió. Espera a que n8n procese o cambia algún parámetro.");
    return;
  }
  if (!spreadsheetId || !sheetName) {
    showToast("error", "Selecciona spreadsheet y hoja");
    return;
  }
  if (!values || values.length === 0) {
    showToast("error", "No hay datos cargados de la hoja");
    return;
  }

  try {
    setIsSending(true);
    setSendLocked(true);
    setProgress("sending");

    const nombrePregunta   = headers[selectedColIndex] || "";
    const respuestaAbierta = safeCell(values, preguntaRow - 1, selectedColIndex);
    const columnaRespuesta = indexToColumnLetter(selectedColIndex2);
    const headerRespuesta  = headers[selectedColIndex2] || "";

    const preguntaEstaVacia =
      !respuestaAbierta || String(respuestaAbierta).trim() === "";
    if (preguntaEstaVacia) {
      showToast("info", "Enviando aunque la celda esté vacía (n8n filtrará).");
    }

    const payload = {
      spreadsheetId,
      sheetName,
      preguntaColumna: colLetter,
      preguntaHeader: nombrePregunta,
      preguntaFila: preguntaRow,
      preguntaValor: preguntaEstaVacia ? "" : respuestaAbierta,
      respuestaColumna: columnaRespuesta,
      respuestaHeader: headerRespuesta,
      respuestaFila: respuestaRow,
      tipoPregunta,
      IAColumna: colLetter3,
      rangoCompleto: `${colLetter}${preguntaRow}:${columnaRespuesta}${respuestaRow}`,
    };

    console.log("📤 Enviando a n8n:", payload);

    // Meta para polling (contar respuestas llenas)
    const endRowQ = lastDataRow(values, selectedColIndex, preguntaRow);
    const dataRows = Math.max(0, endRowQ - preguntaRow + 1);
    const startRowR = respuestaRow;
    const endRowR   = respuestaRow + dataRows - 1;
    const meta = {
      spreadsheetId,
      sheetName,
      col: columnaRespuesta,
      startRow: startRowR,
      endRow: endRowR,
    };

    const resp = await fetch("/api/n8n", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let payloadResp = null;
    try { payloadResp = await resp.json(); } catch { /* puede venir vacío */ }

    const ok = resp.status >= 200 && resp.status < 400;

    if (ok) {
      setProgress("queued");
      setStatus("n8n está trabajando. Puedes seguir en la app; en breve verás los resultados en tu hoja.");
      setProgressPct(0);
      startPolling(meta);
      showToast("info", "Enviado. n8n está procesando…");
    } else {
      setProgress("error");
      setSendLocked(false);
      const msg = payloadResp?.body || payloadResp?.message || `HTTP ${resp.status}`;
      setStatus(`Error al enviar a n8n: ${msg}`);
      showToast("error", `n8n respondió con error ${resp.status}`);
    }
  } catch (e) {
    console.error("Error enviando a n8n:", e);
    setProgress("error");
    setSendLocked(false);
    showToast("error", "Error de conexión con n8n");
  } finally {
    setIsSending(false);
  }
};



  // Utils
  function indexToColumnLetter(index) {
    let n = index + 1;
    let s = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s; // 0 -> A, 1 -> B, ...
  }

  function safeCell(matrix, rowIdx, colIdx) {
    if (!matrix || rowIdx < 0 || colIdx < 0) return "";
    const row = matrix[rowIdx] || [];
    return row[colIdx] ?? "";
  }

  function lastDataRow(valuesMatrix, colIdx, startAtRow = 2) {
  const rows = valuesMatrix?.length || 0;
  if (!rows) return startAtRow;
  for (let r = rows - 1; r >= startAtRow - 1; r--) {
    const v = valuesMatrix[r]?.[colIdx];
    if (v !== undefined && String(v).trim() !== "") return r + 1;
  }
  return startAtRow;
}


  function escapeSheetName(name) {
    // Cubre nombres con espacios o caracteres especiales
    if (/['!]/.test(name)) return `'${name.replace(/'/g, "''")}'`;
    if (/\s/.test(name)) return `'${name}'`;
    return name;
  }

  async function readFilledCount({ spreadsheetId, sheetName, col, startRow, endRow }) {
  // Usa gapi ya autenticado
  window.gapi.client.setToken({ access_token: token });
  const range = `${escapeSheetName(sheetName)}!${col}${startRow}:${col}${endRow}`;
  const res = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.result.values || [];
  // Cuenta celdas no vacías ("" o undefined se consideran vacías)
  let filled = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i]?.[0];
    if (v !== undefined && String(v).trim() !== "") filled++;
  }
  const total = (endRow - startRow + 1);
  return { filled, total, pct: Math.round((filled / total) * 100) };
}

function startPolling(meta) {
  if (!token) return; // necesita estar logueado a Google
  setPolling(true);
  setProgressPct(0);

  // poll cada 2.5s
  const intervalMs = 2500;
  const id = setInterval(async () => {
    try {
      const { pct } = await readFilledCount(meta);
      setProgressPct(pct);

      if (pct >= 100) {
        clearInterval(id);
        setPolling(false);
        setProgress("done");
        setStatus("¡Listo! Ya puedes revisar tu hoja.");
        showToast("success", "Procesamiento completado");
      }
    } catch (e) {
      console.error("Polling error:", e);
      // No abortamos; intentamos en el siguiente tick
    }
  }, intervalMs);

  // Por si el componente se desmonta:
  startPolling._id && clearInterval(startPolling._id);
  startPolling._id = id;
}


  // Helpers
  // === helpers para el anillo de progreso ===
const R = 16;                       // radio del círculo "activo"
const C = 2 * Math.PI * R;          // circunferencia
const dashOffset = C - (progressPct / 100) * C; // offset según %

  // Render
  return (
    <div className="w-full max-w-2xl">
      {/* Toast */}
      <div className="fixed top-3 right-3 z-50">
        {toast.open && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-start gap-2 rounded-xl px-4 py-3 shadow-lg text-sm text-white ring-1 ring-white/10 backdrop-blur-md transition-all duration-200
            ${toast.type === "success"
              ? "bg-emerald-600/95"
              : toast.type === "error"
              ? "bg-rose-600/95"
              : "bg-gray-900/95"}`}
          >
            <span className="mt-0.5">
              {toast.type === "success" ? (
                /* Check icon */
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M20 7L10 17l-6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : toast.type === "error" ? (
                /* X icon */
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M6 6l12 12M6 18L18 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                /* Info icon */
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="9" strokeWidth="2" />
                  <path d="M12 8h.01M11 12h2v4h-2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <div className="font-medium">{toast.message}</div>
          </div>
        )}
      </div>

      {/* Encabezado */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Sheets → n8n</h1>
        <p className="text-gray-500 mt-1">Selecciona un Spreadsheet y su hoja para enviarlo a n8n</p>
        {status && (
          <p className="inline-flex items-center gap-2 text-gray-500 text-xs mt-3 px-2 py-1 rounded-lg bg-gray-100">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {status}
          </p>
        )}
      </div>
      {/* Banner de progreso */}
{progress !== "idle" && (
  <div className={`mt-4 rounded-xl border p-3 text-sm flex items-center gap-3
                   ${progress === "done" ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                          : "bg-gray-50 border-gray-200 text-gray-700"}`}>
    {/* Anillo / Estado */}
    {progress === "sending" ? (
      // spinner mientras se manda el payload al webhook
      <svg className="size-6 animate-spin text-blue-600" viewBox="0 0 24 24">
        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
      </svg>
    ) : progress === "queued" ? (
      // anillo con % en vivo
      <div className="relative grid place-items-center">
        <svg width="36" height="36" viewBox="0 0 36 36" className="shrink-0">
          {/* base */}
          <circle cx="18" cy="18" r={R} fill="none" stroke="#e5e7eb" strokeWidth="4" />
          {/* progreso */}
          <circle
            cx="18" cy="18" r={R} fill="none"
            stroke="currentColor" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={dashOffset}
            className="text-amber-500 transition-[stroke-dashoffset] duration-500 ease-out -rotate-90 origin-center"
          />
        </svg>
        <span className="absolute text-[11px] tabular-nums font-medium">{progressPct}%</span>
      </div>
    ) : progress === "done" ? (
      // éxito
      <svg xmlns="http://www.w3.org/2000/svg" className="size-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" strokeWidth="2" className="opacity-30" />
        <path d="M7 12l3 3 7-7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : (
      // error
      <svg xmlns="http://www.w3.org/2000/svg" className="size-6 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" strokeWidth="2" className="opacity-30" />
        <path d="M8 8l8 8M8 16l8-8" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )}

    {/* Mensaje */}
    <span className="font-medium">
      {progress === "sending" && "Enviando a n8n…"}
      {progress === "queued"  && "n8n está trabajando. Puedes seguir en la app; en breve verás los resultados en tu hoja."}
      {progress === "done"    && "¡Listo! Ya puedes revisar tu hoja."}
      {progress === "error"   && "Ocurrió un error. Revisa la consola o el panel de n8n."}
    </span>

    {/* Botón abrir hoja */}
    {spreadsheetId && (
      <a
        href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`}
        target="_blank" rel="noreferrer"
        className={`ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg border transition
                    ${progress === "done" ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                                          : "bg-white text-gray-700 hover:bg-gray-100"}`}
      >
        Abrir hoja
        <svg xmlns="http://www.w3.org/2000/svg" className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M7 17L17 7M8 7h9v9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    )}

    {/* Desbloquear (si lo usas) */}
    {sendLocked && progress !== "sending" && progress !== "done" && (
      <button
        onClick={() => { setSendLocked(false); setProgress("idle"); }}
        className="ml-2 text-xs underline text-gray-500 hover:text-gray-700"
      >
        Desbloquear
      </button>
    )}
  </div>
)}
      <div className="bg-white rounded-2xl shadow hover:shadow-lg transition-shadow duration-200 p-6 space-y-6 ring-1 ring-gray-100">
        {/* Auth */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Autenticación</p>
            <p className="text-xs text-gray-500">{gisLoaded && gapiLoaded ? "Librerías listas" : "Cargando librerías…"}</p>
          </div>
          <button
            onClick={handleLogin}
            disabled={!gisLoaded || !gapiLoaded || !!token}
            className={`group inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white shadow transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
            ${token ? "bg-emerald-600 focus-visible:ring-emerald-600" : "bg-black hover:opacity-90 focus-visible:ring-black"}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="size-4 opacity-90" viewBox="0 0 24 24">
              <path fill="currentColor" d="M21.35 11.1h-9.18v2.96h5.28c-.23 1.34-1.59 3.93-5.28 3.93a6.1 6.1 0 1 1 0-12.2c1.74 0 2.9.74 3.57 1.38l2.43-2.35C17.09 3.6 15.03 2.7 12.17 2.7 6.97 2.7 2.79 6.89 2.79 12.08S6.97 21.5 12.17 21.5c7.01 0 8.66-6.12 7.95-10.4Z" />
            </svg>
            {token ? "Conectado ✅" : "Conectar Google"}
          </button>
        </div>

        {/* Dropdown Spreadsheets */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 19h16M4 4h16v11H4z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Spreadsheets en tu Drive
          </label>

          <div className="relative">
            <select
              disabled={!token || loadingSheetsList}
              className="w-full border rounded-xl p-2 pr-10 bg-white disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
            >
            {spreadsheetList.length === 0 ? (
              <option value="">Cargando spreadsheets...</option>
            ) : (
              spreadsheetList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))
            )}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">▼</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchSpreadsheetList}
              disabled={!token}
              className="inline-flex items-center gap-2 mt-1 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm transition disabled:opacity-60"
            >
              {loadingSheetsList ? (
                <>
                  <svg className="size-3 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
                  </svg>
                  Cargando…
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M4 4v6h6M20 20v-6h-6M20 4l-6 6M4 20l6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Recargar lista
                </>
              )}
            </button>

            {/* Skeleton mini hint */}
            {loadingSheetsList && <div className="h-4 w-24 rounded bg-gray-100 animate-pulse" />}
            <span className="text-xs text-gray-500">{spreadsheetList.length} archivos</span>
          </div>
        </div>

        {/* URL manual */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </label>
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
            />
            <button onClick={handleUseManualUrl} className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 transition">
              Usar
            </button>
          </div>
          <p className="text-xs text-gray-500">Sincroniza el dropdown con este ID.</p>
        </div>

        {/* Dropdown hojas */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Hoja
          </label>
          <div className="relative">
            <select
              disabled={!spreadsheetId || loadingTabs}
              className="w-full border rounded-xl p-2 pr-10 bg-white disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
            >
              {tabs.length === 0 ? (
                <option value="">Selecciona un spreadsheet primero...</option>
              ) : (
                tabs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))
              )}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">▼</div>
          </div>
          {loadingTabs && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <svg className="size-3 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
              </svg>
              Cargando pestañas…
            </div>
          )}
        </div>

        {/* Selección de columna 1 */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 4h16v16H4z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Columna 1 para extraer Pregunta
          </label>
          <div className="relative">
            <select
              disabled={!values?.length || loadingValues}
              className="w-full border rounded-xl p-2 pr-10 bg-white disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition"
              value={selectedColIndex}
              onChange={(e) => setSelectedColIndex(Number(e.target.value))}
            >
              {(!values || values.length === 0) ? (
  <option value="0">Cargando columnas...</option>
) : (
  (headers.length ? headers : Array(values?.[0]?.length || 1).fill(null)).map((h, i) => (                <option key={i} value={i}>
                  {`${indexToColumnLetter(i)} · ${h ? String(h).slice(0, 120) : "(sin encabezado)"}`}
                </option>
                  ))
)}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">▼</div>
          </div>
          {loadingValues && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <svg className="size-3 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
              </svg>
              Cargando celdas…
            </div>
          )}
          <p className="text-xs text-gray-500">Encabezado: <span className="font-medium">{headers?.[selectedColIndex] ?? "(sin encabezado)"}</span></p>
        </div>

        {/* Selección de columna 2 */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 4h16v16H4z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Columna 2 para insertar Respuesta
          </label>
          <div className="relative">
            <select
              disabled={!values?.length || loadingValues}
              className="w-full border rounded-xl p-2 pr-10 bg-white disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition"
              value={selectedColIndex2}
              onChange={(e) => setSelectedColIndex2(Number(e.target.value))}
            >
              {(headers.length ? headers : Array(values?.[0]?.length || 1).fill(null)).map((h, i) => (
                <option key={i} value={i}>
                  {`${indexToColumnLetter(i)} · ${h ? String(h).slice(0, 120) : "(sin encabezado)"}`}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">▼</div>
          </div>
          <p className="text-xs text-gray-500">Encabezado: <span className="font-medium">{headers?.[selectedColIndex2] ?? "(sin encabezado)"}</span></p>
        </div>
        {/* Selección de columna 3 */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 4h16v16H4z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Columna 3 para insertar si fue hecho con IA
          </label>
          <div className="relative">
            <select
              disabled={!values?.length || loadingValues}
              className="w-full border rounded-xl p-2 pr-10 bg-white disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition"
              value={selectedColIndex3}
              onChange={(e) => setSelectedColIndex3(Number(e.target.value))}
            >
              {(headers.length ? headers : Array(values?.[0]?.length || 1).fill(null)).map((h, i) => (
                <option key={i} value={i}>
                  {`${indexToColumnLetter(i)} · ${h ? String(h).slice(0, 120) : "(sin encabezado)"}`}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">▼</div>
          </div>
          <p className="text-xs text-gray-500">Encabezado: <span className="font-medium">{headers?.[selectedColIndex3] ?? "(sin encabezado)"}</span></p>
        </div>
        {/* Dropdown Tipo de pregunta */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Tipo de pregunta para decodificar
          </label>
          <div className="relative">
            <select
              className="w-full border rounded-xl p-2 pr-10 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition"
              value={tipoPregunta}
              onChange={(e) => setTipoPregunta(e.target.value)}
            >
              <option value="Problemas">Problemas</option>
              <option value="Variado">Variado</option>
              <option value="Personajes">Personajes</option>
              <option value="Seguridad">Seguridad</option>
              <option value="Voto/partidos">Voto/partidos</option>
              <option value="Medios">Medios</option>
              <option value="Transporte">Transporte</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">▼</div>
          </div>
        </div>

        {/* Enviar */}
        <div className="flex items-center justify-end gap-3">
          <p className="text-xs text-gray-500">
            {spreadsheetId && sheetName ? `Listo: Col ${colLetter} · ${headers?.[selectedColIndex] ?? "(sin encabezado)"}` : ""}
          </p>
          <button
  onClick={handleSendToN8N}
  disabled={!spreadsheetId || !sheetName || isSending || sendLocked}
  className="group inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white shadow hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600"
>
  {isSending ? (
    <>
      <svg className="size-4 animate-spin" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
      </svg>
      Enviando…
    </>
  ) : sendLocked ? (
    <>
      <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 10a2 2 0 1 0 4 0V6a2 2 0 1 0-4 0v4z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Enviado (bloqueado)
    </>
  ) : (
    <>
      <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M22 2L11 13" strokeWidth="2" strokeLinecap="round" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Enviar a n8n
    </>
  )}
</button>
        </div>
      </div>

      <div className="text-center text-xs text-gray-400 mt-4">Next.js + Tailwind + Google APIs · selección de columnas/filas ✨</div>
    </div>
  );
}