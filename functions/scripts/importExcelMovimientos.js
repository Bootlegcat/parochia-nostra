// Importa movimientos desde xlsx en un folder
// Uso:
//  node scripts/importExcelMovimientos.js --dir=/Users/max/Downloads/exceles --bottle=construyendo-lazos --dry
//  node scripts/importExcelMovimientos.js --dir=/Users/max/Downloads/exceles --bottle=construyendo-lazos --commit

const admin = require("firebase-admin");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");

admin.initializeApp();
const db = admin.firestore();

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const dry = args.includes("--dry") || !commit;
const dirArg = args.find((a) => a.startsWith("--dir="));
const bottleArg = args.find((a) => a.startsWith("--bottle="));
const bottleId = bottleArg ? bottleArg.split("=").slice(1).join("=") : "";
const dir = dirArg ? dirArg.split("=").slice(1).join("=") : "/Users/max/Downloads/exceles";

if (!bottleId) {
  console.error("Debes pasar --bottle=<id>");
  process.exit(1);
}

function isDate(v) {
  return v instanceof Date && !isNaN(v.getTime());
}

function parseExcelDate(v) {
  if (isDate(v)) return v;
  if (typeof v === "number") {
    const d = xlsx.SSF.parse_date_code(v);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  return null;
}

function norm(s) {
  return String(s || "").trim();
}

function inferType(sheetName, row) {
  const name = (sheetName || "").toLowerCase();
  if (name.includes("egres")) return "egreso";
  if (name.includes("ingres")) return "ingreso";

  const c2 = norm(row[2]).toLowerCase();
  const c3 = norm(row[3]).toLowerCase();
  const c4 = norm(row[4]).toLowerCase();
  const text = `${c2} ${c3} ${c4}`;
  if (/(aport|donat|ofrend|colect|diezm|ingres)/.test(text)) return "ingreso";
  if (/(pago|gasto|comis|honor|nomina|impuest|egres|servic|luz|agua|gas|viatic|manten)/.test(text)) return "egreso";

  // Usa columnas típicas
  const n4 = Number(row[4] || 0);
  const n5 = Number(row[5] || 0);
  const n6 = Number(row[6] || 0);
  const n7 = Number(row[7] || 0);

  if (n4 > 0 && n5 === 0) return "ingreso";
  if (n5 > 0 && n4 === 0) return "egreso";
  if (n6 > 0 && n7 === 0) return "ingreso";
  if (n7 > 0 && n6 === 0) return "egreso";

  return "ingreso"; // fallback
}

function pickAmount(row, tipo) {
  const vals = row.map((v) => (typeof v === "string" ? Number(v.replace(/,/g, "")) : v));
  const nums = vals.map((v) => (typeof v === "number" && !isNaN(v) ? v : 0));

  const ingresoIdx = [4, 6, 5, 7, 3, 8];
  const egresoIdx = [5, 7, 4, 6, 3, 8];

  const idxs = tipo === "egreso" ? egresoIdx : ingresoIdx;
  for (const i of idxs) {
    const n = nums[i] || 0;
    if (n > 0) return n;
  }

  // fallback: menor positivo (para evitar usar saldo)
  const positives = nums.filter((n) => n > 0).sort((a, b) => a - b);
  return positives[0] || 0;
}

function guessAccountFromFile(file) {
  const m = String(file).match(/\b(\d{3,6})\b/);
  return m ? m[1] : "";
}

async function run() {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".xlsx"))
    .map((f) => path.join(dir, f));

  if (!files.length) {
    console.error("No hay .xlsx en", dir);
    return;
  }

  console.log(`Archivos: ${files.length}`);

  let total = 0;
  let inserted = 0;

  let batch = db.batch();
  let ops = 0;

  async function commitIfNeeded(force = false) {
    if (ops >= 450 || (force && ops > 0)) {
      if (commit) await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  for (const file of files) {
    const wb = xlsx.readFile(file, { cellDates: true });
    const fileName = path.basename(file);
    const cuentaGuess = guessAccountFromFile(fileName);

    console.log(`\n== ${fileName} ==`);

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });

      let sheetInserted = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const date = parseExcelDate(row[0]);
        if (!date) continue;

        const tipo = inferType(sheetName, row);
        const monto = pickAmount(row, tipo);
        if (!monto || monto <= 0) continue;

        const categoria = norm(row[2]);
        const col3 = norm(row[3]);
        const concepto = tipo === "egreso" ? col3 : categoria;
        const beneficiario = tipo === "egreso" ? categoria : col3;

        const docRef = db
          .collection("botellas")
          .doc(bottleId)
          .collection("movimientos")
          .doc();

        const payload = {
          fecha: admin.firestore.Timestamp.fromDate(date),
          tipo,
          monto,
          categoria: categoria || "",
          subcategoria: "",
          concepto: concepto || "",
          cuentaBancaria: cuentaGuess || "",
          formaPago: "",
          beneficiario: beneficiario || "",
          referencia: "",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          source: {
            file: fileName,
            sheet: sheetName,
            row: i + 1,
          },
        };

        batch.set(docRef, payload);
        ops++;
        inserted++;
        sheetInserted++;
        total++;

        await commitIfNeeded(false);
      }

      if (sheetInserted > 0) {
        console.log(`  ${sheetName}: ${sheetInserted} filas`);
      }
    }
  }

  await commitIfNeeded(true);

  console.log(`\n${dry ? "DRY" : "COMMIT"}: ${inserted} movimientos importados.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
