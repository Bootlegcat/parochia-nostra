const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

// ====================== CONFIG ======================
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccountKey.json");
const EXCEL_PATH = path.join(__dirname, "LIBRO DIARIO CL 1385 maestro.xlsx"); // ✅ ESTE es el nuevo que subiste

const BOTELLA_ID = "construyendo-lazos";
const ROOT_COLLECTION = "botellas";
const MOVS_SUBCOLLECTION = "movimientos";

const META_SUBCOLLECTION = "meta";
const META_DOC_ID = "migration";

const DRY_RUN = false; // ✅ primero true
// ===================================================

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error("❌ No encuentro serviceAccountKey.json");
  process.exit(1);
}
if (!fs.existsSync(EXCEL_PATH)) {
  console.error("❌ No encuentro el archivo Excel:", EXCEL_PATH);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
});
const db = admin.firestore();

// ---------- helpers ----------
function norm(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}
function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}
function toDate(v) {
  if (!v) return null;
  if (isValidDate(v)) return v;

  // Excel serial
  if (typeof v === "number") {
    const dc = XLSX.SSF.parse_date_code(v);
    if (dc && dc.y && dc.m && dc.d) {
      const d = new Date(dc.y, dc.m - 1, dc.d);
      return isValidDate(d) ? d : null;
    }
  }

  const d = new Date(String(v));
  return isValidDate(d) ? d : null;
}
function stableId(parts) {
  const raw = parts.filter(Boolean).join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  return String(hash);
}

const MONTHS = [
  "ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
  "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE",
];
function sheetIsMonth(sheetName) {
  return MONTHS.includes(norm(sheetName));
}
function monthKey(sheetName) {
  const idx = MONTHS.indexOf(norm(sheetName));
  return `2025-${String(idx + 1).padStart(2, "0")}`;
}

function findHeaderRow(matrix) {
  const maxScan = Math.min(matrix.length, 600);

  let best = { idx: -1, score: 0 };

  for (let i = 0; i < maxScan; i++) {
    const row = (matrix[i] || []).map(norm);
    const hasFecha = row.some((c) => c.includes("FECHA"));
    const hasTipo = row.some((c) => c === "TIPO" || c.includes("TIPO"));
    const hasFolioCheque = row.some((c) => c.includes("FOLIO") && c.includes("CHEQ"));

    let score = 0;
    if (hasFecha) score += 10;
    if (hasTipo) score += 8;
    if (hasFolioCheque) score += 4;

    if (score > best.score) best = { idx: i, score };
  }

  return best.score >= 12 ? best.idx : -1;
}

function findCol(headerNorm, includesArr, { excludeArr = [] } = {}) {
  for (let j = 0; j < headerNorm.length; j++) {
    const cell = headerNorm[j];
    if (!cell) continue;

    if (excludeArr.some((t) => cell.includes(t))) continue;
    if (includesArr.some((t) => cell.includes(t))) return j;
  }
  return -1;
}

function normalizeTipo(v) {
  const t = norm(v);
  if (!t) return null;
  if (t.startsWith("ING")) return "ingreso";
  if (t.startsWith("EGR")) return "egreso";
  if (t === "I") return "ingreso";
  if (t === "E") return "egreso";
  return null;
}

/**
 * ✅ CLAVE: detectar columnas de monto desde sub-headers
 * Escanea headerIdx..headerIdx+6 para encontrar palabras TRANSFERENCIA/EFECTIVO/CHEQUES
 * y devuelve el índice de columna real donde están los montos.
 */
function detectMoneyCols(matrix, headerIdx, headerNorm) {
  // 1) intentamos con header principal (pero evitando Folio/Cheque)
  let transferenciaCol = findCol(headerNorm, ["TRANSFER"], { excludeArr: ["FOLIO"] });
  let efectivoCol = findCol(headerNorm, ["EFECT"], { excludeArr: ["FOLIO"] });
  let chequesCol = findCol(headerNorm, ["CHEQUES"], { excludeArr: ["FOLIO"] });

  // 2) si no salen (o salen mal), buscamos en subheaders
  const scanTo = Math.min(matrix.length - 1, headerIdx + 6);

  for (let r = headerIdx; r <= scanTo; r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = norm(row[c]);
      if (!cell) continue;

      // IMPORTANTÍSIMO: nunca confundir "FOLIO/ CHEQUE" con columna de monto
      if (cell.includes("FOLIO") && cell.includes("CHEQ")) continue;

      if (cell.includes("TRANSFER")) transferenciaCol = c;
      if (cell.includes("EFECT")) efectivoCol = c;
      if (cell === "CHEQUES" || cell.includes("CHEQUES")) chequesCol = c;
    }
  }

  return { transferenciaCol, efectivoCol, chequesCol };
}

function buildMovimientoDoc({ fecha, descripcion, formaPago, referencia, monto, tipo, mesKey, sheetName, rowHuman }) {
  const id = stableId([
    "CL",
    sheetName,
    mesKey,
    String(rowHuman),
    tipo,
    formaPago,
    String(monto),
    descripcion,
    referencia,
  ]);

  return {
    id,
    data: {
      Fecha: admin.firestore.Timestamp.fromDate(fecha),
      "Descripción": descripcion ?? "—",
      "Categoría": "—",
      "Subcategoría": "—",
      "Concepto": "—",
      "Cuenta bancaria": "—",
      "Forma de pago": formaPago ?? "—",
      "Referencia/Beneficiario": referencia ?? "—",
      "Monto": monto,

      tipo,
      mes: mesKey,
      bottleId: BOTELLA_ID,

      source: {
        file: path.basename(EXCEL_PATH),
        sheet: sheetName,
        row: rowHuman,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };
}

async function main() {
  console.log("✅ Conectando...");
  console.log("📄 Leyendo Excel:", EXCEL_PATH);

  const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const sheets = workbook.SheetNames;

  const baseRef = db.collection(ROOT_COLLECTION).doc(BOTELLA_ID).collection(MOVS_SUBCOLLECTION);
  const metaRef = db.collection(ROOT_COLLECTION).doc(BOTELLA_ID).collection(META_SUBCOLLECTION).doc(META_DOC_ID);

  let total = 0;
  let skipped = 0;
  const monthsSummary = {};

  let batch = db.batch();
  let batchCount = 0;

  for (const sheetName of sheets) {
    if (!sheetIsMonth(sheetName)) continue;

    const mesKey = monthKey(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const headerIdx = findHeaderRow(matrix);
    if (headerIdx === -1) {
      console.log("⚠️ No encontré header en:", sheetName, "-> skip");
      continue;
    }

    const headerRow = matrix[headerIdx];
    const headerNorm = (headerRow || []).map(norm);

    const dateCol = findCol(headerNorm, ["FECHA"]);
    const tipoCol = findCol(headerNorm, ["TIPO"]);

    const { transferenciaCol, efectivoCol, chequesCol } = detectMoneyCols(matrix, headerIdx, headerNorm);

    console.log(`\n📅 ${sheetName} (${mesKey}) headerRow=${headerIdx + 1}`);
    console.log("🧩 Cols:", { dateCol, tipoCol, transferenciaCol, efectivoCol, chequesCol });

    let countIng = 0, countEgr = 0;
    let sumIng = 0, sumEgr = 0;

    for (let i = headerIdx + 1; i < matrix.length; i++) {
      const row = matrix[i];
      const rowHuman = i + 1;

      const fecha = toDate(row?.[dateCol]);
      const tipo = normalizeTipo(row?.[tipoCol]);

      if (!fecha || !tipo) { skipped++; continue; }

      // descripción: en tu excel CL casi siempre está en la col del "Concepto" (4 o 5)
      // para no mover el UI, aquí lo dejamos simple y seguro
      const descripcion = String(row?.[4] ?? row?.[5] ?? "—").trim() || "—";
      const referencia = String(row?.[5] ?? row?.[4] ?? "—").trim() || "—";

      const candidates = [];
      const add = (col, formaPago) => {
        if (typeof col !== "number" || col < 0) return;
        const n = toNumber(row?.[col]);
        if (!n || n === 0) return;
        candidates.push({ formaPago, monto: Math.abs(n) });
      };

      add(transferenciaCol, "Transferencia");
      add(efectivoCol, "Efectivo");
      add(chequesCol, "Cheque");

      if (candidates.length === 0) continue;

      for (const c of candidates) {
        const mov = buildMovimientoDoc({
          fecha,
          descripcion,
          formaPago: c.formaPago,
          referencia,
          monto: c.monto,
          tipo,
          mesKey,
          sheetName,
          rowHuman,
        });

        if (tipo === "ingreso") { countIng++; sumIng += c.monto; }
        else { countEgr++; sumEgr += c.monto; }

        const docRef = baseRef.doc(mov.id);
        if (!DRY_RUN) batch.set(docRef, mov.data, { merge: false });

        total++; batchCount++;

        if (batchCount >= 450) {
          if (!DRY_RUN) await batch.commit();
          console.log(`✅ Commit batch (acumulado: ${total})`);
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    monthsSummary[mesKey] = {
      ingresos: countIng,
      egresos: countEgr,
      totalIngresos: Number(sumIng.toFixed(2)),
      totalEgresos: Number(sumEgr.toFixed(2)),
    };
  }

  if (batchCount > 0) {
    if (!DRY_RUN) await batch.commit();
    console.log(`✅ Commit final (acumulado: ${total})`);
  }

  console.log("\n==============================");
  console.log(DRY_RUN ? "🟡 DRY_RUN=true (NO se escribió nada)" : "🟢 Migración REAL completada");
  console.log("Total movimientos:", total);
  console.log("Saltados (sin fecha o sin tipo):", skipped);
  console.log("Resumen por mes:", monthsSummary);
  console.log("==============================\n");

  const metaPayload = {
    bottleId: BOTELLA_ID,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    sourceFile: path.basename(EXCEL_PATH),
    ignoreSaldos: true,
    onlyMonthSheets: true,
    totalMovimientos: total,
    skippedRows: skipped,
    monthsSummary,
  };

  if (!DRY_RUN) {
    await metaRef.set(metaPayload, { merge: true });
    console.log("✅ Meta migration actualizada.");
  } else {
    console.log("ℹ️ DRY_RUN=true: meta migration NO se escribió.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
