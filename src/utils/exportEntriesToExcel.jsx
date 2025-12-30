// src/utils/exportEntriesToExcel.jsx
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

function safe(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

export function exportEntriesToExcel({
  entries,
  lookups,
  filenameBase = "registro",
  format = "xlsx", // "xlsx" | "csv"
}) {
  const {
    categoryById = {},
    subCategoryById = {},
    conceptById = {},
    bankAccountById = {},
  } = lookups || {};

  const rows = entries.map((e) => ({
    Fecha: safe(e.date),
    Tipo: e.type === "income" ? "Ingreso" : "Egreso",
    Monto: Number(e.amount || 0),
    "Cuenta bancaria": safe(bankAccountById[e.bankAccountId]?.name),
    Categoría: safe(categoryById[e.categoryId]?.name),
    "Sub-categoría": safe(subCategoryById[e.subCategoryId]?.name),
    Concepto: safe(conceptById[e.conceptId]?.name),
    "Forma de pago": safe(e.paymentMethod),
    "Beneficiario / proveedor": safe(e.beneficiary),
    Nota: safe(e.note),
    ID: safe(e.id),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Registro");

  const fileType = format === "csv" ? "csv" : "xlsx";
  const mimeType =
    format === "csv"
      ? "text/csv;charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const fileData = XLSX.write(workbook, {
    bookType: fileType,
    type: "array",
  });

  saveAs(
    new Blob([fileData], { type: mimeType }),
    `${filenameBase}.${fileType}`
  );
}
