// src/utils/excelMaestro.js
import ExcelJS from "exceljs";

const MONTHS_ES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];

function toJsDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate(); // Firestore Timestamp
  if (v instanceof Date) return v;
  if (typeof v?.seconds === "number") return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function money(n) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function monthKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

function monthLabelEs(d) {
  return `${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}

function addHeader(ws, headers) {
  ws.addRow(headers);

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  ws.views = [{ state: "frozen", ySplit: 1 }];

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  // widths
  ws.columns = headers.map((h) => ({
    header: h,
    key: h,
    width:
      h.includes("Descripción") ? 34 :
      h.includes("Categor") ? 18 :
      h.includes("Sub") ? 18 :
      h.includes("Concept") ? 18 :
      h.includes("Cuenta") ? 18 :
      h.includes("Forma") ? 16 :
      h.includes("Monto") ? 14 :
      14,
  }));
}

function styleMoney(ws, colIdx) {
  ws.getColumn(colIdx).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
  ws.getColumn(colIdx).alignment = { horizontal: "right" };
}

export async function buildExcelMaestro({ entries, lookups }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Parochia Nostra";
  wb.created = new Date();

  const normalized = (entries || [])
    .map((e) => {
      const d = toJsDate(e.date || e.fecha || e.createdAt);
      return { ...e, __date: d };
    })
    .filter((e) => e.__date && !isNaN(e.__date.getTime()));

  // group by month
  const byMonth = new Map();
  for (const e of normalized) {
    const key = monthKey(e.__date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(e);
  }

  const monthKeys = Array.from(byMonth.keys()).sort((a, b) => a.localeCompare(b));

  // lookups
  const maps = lookups || {};
  const getName = (kind, e) => {
    if (kind === "category") {
      return (
        maps.categoryNameById?.get(e.categoryId) ||
        e.categoria ||
        e.category ||
        "—"
      );
    }
    if (kind === "sub") {
      return (
        maps.subNameById?.get(e.subCategoryId) ||
        e.subcategoria ||
        e.subCategory ||
        "—"
      );
    }
    if (kind === "concept") {
      return (
        maps.conceptNameById?.get(e.conceptId) ||
        e.concepto ||
        e.concept ||
        "—"
      );
    }
    if (kind === "bank") {
      return (
        maps.bankNameById?.get(e.bankAccountId) ||
        e.cuentaBancaria ||
        e.bankAccount ||
        "—"
      );
    }
    return "—";
  };

  const makeSheet = (title, rows) => {
    const ws = wb.addWorksheet(title.substring(0, 31)); // Excel sheet name limit

    const headers = [
      "Fecha",
      "Descripción",
      "Categoría",
      "Subcategoría",
      "Concepto",
      "Cuenta bancaria",
      "Forma de pago",
      "Referencia/Beneficiario",
      "Monto",
    ];

    addHeader(ws, headers);

    rows
      .sort((a, b) => a.__date - b.__date)
      .forEach((e) => {
        ws.addRow([
          e.__date,
          e.referencia || e.beneficiario || "",
          getName("category", e),
          getName("sub", e),
          getName("concept", e),
          getName("bank", e),
          e.formaPago || "",
          e.beneficiario || e.referencia || "",
          money(e.amount ?? e.monto),
        ]);
      });

    ws.getColumn(1).numFmt = "dd/mm/yyyy";
    styleMoney(ws, 9);

    const lastDataRow = ws.lastRow?.number || 1;
    ws.addRow([]);
    const totalRow = ws.addRow([
      "", "", "", "", "", "", "", "TOTAL",
      { formula: `SUM(I2:I${lastDataRow})` },
    ]);
    totalRow.font = { bold: true };
    styleMoney(ws, 9);

    return ws;
  };

  for (const mk of monthKeys) {
    const list = byMonth.get(mk);
    const label = monthLabelEs(list[0].__date);

    const incomes = list.filter((e) => e.type === "income");
    const expenses = list.filter((e) => e.type === "expense");

    makeSheet(`Ingresos ${label}`, incomes);
    makeSheet(`Egresos ${label}`, expenses);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer; // ArrayBuffer
}
