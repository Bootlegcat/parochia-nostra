const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const XLSX = require("xlsx");

admin.initializeApp();

function safe(v) {
  if (v === undefined || v === null) return "";
  return String(v);
}

function monthKeyFromISO(dateStr) {
  if (!dateStr) return "Sin-fecha";
  return String(dateStr).slice(0, 7); // YYYY-MM
}

function sheetName(s) {
  // Excel: max 31 chars, no []:*?/\
  return String(s)
    .replace(/[\\/[\\]*?:]/g, "-")
    .slice(0, 31);
}

function setColWidths(ws) {
  ws["!cols"] = [
    { wch: 10 }, // Tipo
    { wch: 22 }, // Cuenta bancaria
    { wch: 12 }, // Fecha
    { wch: 18 }, // Categoría
    { wch: 20 }, // Sub-categoría
    { wch: 18 }, // Concepto
    { wch: 18 }, // Forma de pago
    { wch: 28 }, // Beneficiario/Proveedor
    { wch: 12 }, // Importe
  ];
}

function buildRow(entry, lookups, tipoLabel) {
  const { categoryById, subById, conceptById, bankById } = lookups;

  return {
    Tipo: tipoLabel,
    "Cuenta bancaria": safe(bankById[entry.bankAccountId]?.name),
    Fecha: safe(entry.date),
    Categoría: safe(categoryById[entry.categoryId]?.name),
    "Sub-categoría": safe(subById[entry.subCategoryId]?.name),
    Concepto: safe(conceptById[entry.conceptId]?.name),
    "Forma de pago": safe(entry.paymentMethod),
    "Beneficiario/Proveedor": safe(entry.beneficiary),
    Importe: Number(entry.amount || 0),
  };
}

function addMonthlySheetToWB(wb, name, rows) {
  const ws = XLSX.utils.json_to_sheet(rows, { origin: "A1" });

  // TOTAL DEL MES al final
  const dataCount = rows.length;
  const totalRow = dataCount + 2; // header + 1-index
  const startRow = 2;
  const lastDataRow = dataCount + 1;

  ws[`H${totalRow}`] = { v: "TOTAL DEL MES", t: "s" };
  ws[`I${totalRow}`] = {
    f: dataCount > 0 ? `SUM(I${startRow}:I${lastDataRow})` : "0",
    t: "n",
  };

  setColWidths(ws);
  XLSX.utils.book_append_sheet(wb, ws, sheetName(name));
}

function groupByMonth(entries) {
  const map = new Map();
  for (const e of entries) {
    const m = monthKeyFromISO(e.date);
    if (!map.has(m)) map.set(m, []);
    map.get(m).push(e);
  }
  const months = Array.from(map.keys()).sort(); // ASC
  return { map, months };
}

async function loadLookups(uid, orgId) {
  const db = admin.firestore();

  // categories
  const catsSnap = await db.collection("users").doc(uid).collection("orgs").doc(orgId).collection("categories").get();
  const categoryById = {};
  catsSnap.forEach((d) => (categoryById[d.id] = d.data() || {}));

  // bankAccounts
  const bankSnap = await db.collection("users").doc(uid).collection("orgs").doc(orgId).collection("bankAccounts").get();
  const bankById = {};
  bankSnap.forEach((d) => (bankById[d.id] = d.data() || {}));

  // subcategories + concepts (scan completo para que siempre salgan nombres)
  const subById = {};
  const conceptById = {};

  for (const catDoc of catsSnap.docs) {
    const subSnap = await db
      .collection("users").doc(uid)
      .collection("orgs").doc(orgId)
      .collection("categories").doc(catDoc.id)
      .collection("subcategories")
      .get();

    subSnap.forEach((s) => (subById[s.id] = s.data() || {}));

    for (const subDoc of subSnap.docs) {
      const conSnap = await db
        .collection("users").doc(uid)
        .collection("orgs").doc(orgId)
        .collection("categories").doc(catDoc.id)
        .collection("subcategories").doc(subDoc.id)
        .collection("concepts")
        .get();

      conSnap.forEach((c) => (conceptById[c.id] = c.data() || {}));
    }
  }

  return { categoryById, subById, conceptById, bankById };
}

async function loadEntries(uid, orgId) {
  const db = admin.firestore();
  const snap = await db
    .collection("users").doc(uid)
    .collection("orgs").doc(orgId)
    .collection("entries")
    .orderBy("date", "asc")
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function buildIncomeWB(entries, lookups) {
  const income = entries.filter((e) => e.type === "income");
  const { map, months } = groupByMonth(income);

  const wb = XLSX.utils.book_new();
  if (months.length === 0) {
    addMonthlySheetToWB(wb, "Sin-datos", []);
    return wb;
  }

  for (const m of months) {
    const monthEntries = map.get(m).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const rows = monthEntries.map((e) => buildRow(e, lookups, "Ingreso"));
    addMonthlySheetToWB(wb, m, rows);
  }
  return wb;
}

function buildExpenseWB(entries, lookups) {
  const exp = entries.filter((e) => e.type === "expense");
  const { map, months } = groupByMonth(exp);

  const wb = XLSX.utils.book_new();
  if (months.length === 0) {
    addMonthlySheetToWB(wb, "Sin-datos", []);
    return wb;
  }

  for (const m of months) {
    const monthEntries = map.get(m).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const rows = monthEntries.map((e) => buildRow(e, lookups, "Egreso"));
    addMonthlySheetToWB(wb, m, rows);
  }
  return wb;
}

// Maestro: pestañas por mes, pero separando Ing/Egr en el nombre
function buildMasterWB(entries, lookups) {
  const wb = XLSX.utils.book_new();

  const income = entries.filter((e) => e.type === "income");
  const expense = entries.filter((e) => e.type === "expense");

  const g1 = groupByMonth(income);
  const g2 = groupByMonth(expense);

  // Si no hay nada, crea hoja vacía
  if (g1.months.length === 0 && g2.months.length === 0) {
    addMonthlySheetToWB(wb, "Sin-datos", []);
    return wb;
  }

  for (const m of g1.months) {
    const monthEntries = g1.map.get(m).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const rows = monthEntries.map((e) => buildRow(e, lookups, "Ingreso"));
    addMonthlySheetToWB(wb, `Ing ${m}`, rows);
  }
  for (const m of g2.months) {
    const monthEntries = g2.map.get(m).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const rows = monthEntries.map((e) => buildRow(e, lookups, "Egreso"));
    addMonthlySheetToWB(wb, `Egr ${m}`, rows);
  }

  return wb;
}

async function uploadWB({ bucket, path, wb, contentType }) {
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  const file = bucket.file(path);

  await file.save(buffer, {
    contentType: contentType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    resumable: false,
  });

  // para que puedan descargarlo directo
  await file.makePublic(); // si NO quieres público, dime y lo hacemos con rules + getDownloadURL
  return file.publicUrl();
}

async function generateAndStore(uid, orgId) {
  const lookups = await loadLookups(uid, orgId);
  const entries = await loadEntries(uid, orgId);

  const bucket = admin.storage().bucket();

  const basePath = `users/${uid}/orgs/${orgId}/exports`;

  const wbIncome = buildIncomeWB(entries, lookups);
  const wbExpense = buildExpenseWB(entries, lookups);
  const wbMaster = buildMasterWB(entries, lookups);

  const incomeUrl = await uploadWB({ bucket, path: `${basePath}/ingresos.xlsx`, wb: wbIncome });
  const expenseUrl = await uploadWB({ bucket, path: `${basePath}/egresos.xlsx`, wb: wbExpense });
  const masterUrl = await uploadWB({ bucket, path: `${basePath}/maestro.xlsx`, wb: wbMaster });

  // guardar metadata en Firestore (opcional pero útil)
  await admin.firestore()
    .collection("users").doc(uid)
    .collection("orgs").doc(orgId)
    .collection("exports").doc("excel")
    .set(
      {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        masterUrl,
        incomeUrl,
        expenseUrl,
      },
      { merge: true }
    );

  return { masterUrl, incomeUrl, expenseUrl };
}

/* --------- 1) botón manual desde la app (callable) --------- */
exports.generateExcelMaestro = onCall(async (req) => {
  const uid = req.auth?.uid;
  const orgId = req.data?.orgId;

  if (!uid) throw new HttpsError("unauthenticated", "No autenticado.");
  if (!orgId) throw new HttpsError("invalid-argument", "Falta orgId.");

  return await generateAndStore(uid, orgId);
});

/* --------- 2) actualización semanal automática ---------
   OJO: Esto genera para TODOS los orgs de cada usuario.
   Si tú quieres SOLO 'iglesia', se filtra por orgId.
--------- */
exports.weeklyExcelRefresh = onSchedule("every monday 06:00", async () => {
  const db = admin.firestore();

  const usersSnap = await db.collection("users").get();
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;

    const orgsSnap = await db.collection("users").doc(uid).collection("orgs").get();
    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id;
      try {
        await generateAndStore(uid, orgId);
      } catch (e) {
        console.error("weeklyExcelRefresh error", { uid, orgId, e });
      }
    }
  }
});
