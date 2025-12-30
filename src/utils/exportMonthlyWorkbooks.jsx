import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

function safe(v) {
  if (v === undefined || v === null) return "";
  return String(v);
}

function monthKeyFromISO(dateStr) {
  // dateStr esperado: YYYY-MM-DD
  if (!dateStr) return "Sin fecha";
  return dateStr.slice(0, 7); // YYYY-MM
}

function buildRows({ entries, lookups, typeLabel }) {
  const {
    categoryById = {},
    subCategoryById = {},
    conceptById = {},
    bankAccountById = {},
  } = lookups || {};

  return entries.map((e) => {
    const categoria = categoryById[e.categoryId]?.name || "";
    const subcategoria = subCategoryById[e.subCategoryId]?.name || "";
    const concepto = conceptById[e.conceptId]?.name || "";
    const cuenta = bankAccountById[e.bankAccountId]?.name || "";

    return {
      Tipo: typeLabel, // Ingreso/Egreso
      "Cuenta bancaria": safe(cuenta),
      Fecha: safe(e.date),
      Categoría: safe(categoria),
      "Sub-categoría": safe(subcategoria),
      Concepto: safe(concepto),
      "Forma de pago": safe(e.paymentMethod),
      "Beneficiario/Proveedor": safe(e.beneficiary),
      Importe: Number(e.amount || 0),
    };
  });
}

function setColWidths(ws) {
  // Ajusta ancho de columnas para que se vea bonito
  ws["!cols"] = [
    { wch: 10 }, // Tipo
    { wch: 22 }, // Cuenta
    { wch: 12 }, // Fecha
    { wch: 18 }, // Categoria
    { wch: 20 }, // Sub
    { wch: 18 }, // Concepto
    { wch: 18 }, // Forma pago
    { wch: 28 }, // Beneficiario
    { wch: 12 }, // Importe
  ];
}

function addMonthlySheet({ wb, sheetName, rows }) {
  // Header + data
  const ws = XLSX.utils.json_to_sheet(rows, { origin: "A1" });

  // Agregar TOTAL al final (en la columna Importe = I)
  const startRow = 2; // fila 2 porque fila 1 es header
  const dataCount = rows.length;
  const totalRowIndex = dataCount + 2; // +1 header +1 para 1-index excel

  // Etiqueta "TOTAL DEL MES" en H (col 8)
  ws[`H${totalRowIndex}`] = { v: "TOTAL DEL MES", t: "s" };

  // Fórmula SUM en I
  // SUM(I2:I{lastDataRow})
  const lastDataRow = dataCount + 1;
  ws[`I${totalRowIndex}`] = {
    f: dataCount > 0 ? `SUM(I${startRow}:I${lastDataRow})` : "0",
    t: "n",
  };

  // Un poquito de estilo simple (no todos los viewers lo respetan)
  setColWidths(ws);

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

export function exportIncomeExpenseMonthlyXLSX({
  entries,
  lookups,
  orgId = "org",
  kind = "income", // "income" | "expense"
}) {
  const typeLabel = kind === "income" ? "Ingreso" : "Egreso";

  // Filtrar por tipo
  const filtered = entries.filter((e) => e.type === kind);

  // Agrupar por mes
  const byMonth = new Map();
  for (const e of filtered) {
    const m = monthKeyFromISO(e.date);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(e);
  }

  // Ordenar meses ASC
  const months = Array.from(byMonth.keys()).sort();

  const wb = XLSX.utils.book_new();

  // Si no hay datos, crea una hoja vacía con headers y total
  if (months.length === 0) {
    const rows = buildRows({ entries: [], lookups, typeLabel });
    addMonthlySheet({ wb, sheetName: "Sin datos", rows });
  } else {
    for (const m of months) {
      // Ordena por fecha ASC dentro del mes
      const entriesMonth = byMonth.get(m).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const rows = buildRows({ entries: entriesMonth, lookups, typeLabel });
      // Nombre de pestaña: "2025-05" (Excel limita 31 chars)
      addMonthlySheet({ wb, sheetName: m.slice(0, 31), rows });
    }
  }

  const filename = `${orgId}-${kind === "income" ? "ingresos" : "egresos"}-${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename
  );
}
