// Backfill "tipo" (ingreso/egreso) for categories missing it.
// Usage:
//   node scripts/backfillCategoryTipo.js --dry
//   node scripts/backfillCategoryTipo.js --commit
//   node scripts/backfillCategoryTipo.js --commit --bottle=de-la-iglesia
//
// Requires Firebase Admin credentials (GOOGLE_APPLICATION_CREDENTIALS).

const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const dry = args.includes("--dry") || !commit;
const heuristicOnly = args.includes("--heuristic-only");
const bottleArg = args.find((a) => a.startsWith("--bottle="));
const onlyBottleId = bottleArg ? bottleArg.split("=").slice(1).join("=") : "";

function normTipo(val) {
  const t = String(val || "").toLowerCase();
  if (!t) return "";
  if (t.includes("ing")) return "ingreso";
  if (t.includes("egr") || t.includes("gasto") || t.includes("exp")) return "egreso";
  if (t === "income") return "ingreso";
  if (t === "expense") return "egreso";
  return "";
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[()]/g, " ") // quita paréntesis
    .replace(/\s+/g, " ") // colapsa espacios
    .trim();
}

function guessByName(name) {
  const n = normalizeText(name);
  if (!n) return "";

  // Manual overrides (exact-ish matches)
  const overrides = {
    "iguala": "egreso",
    "imss": "egreso",
    "colectas": "ingreso",
    "bautizos": "ingreso",
    "refrendos y tenencias": "egreso",
    "equipo y mobiliario": "egreso",
    "impuestos federales (sat)": "egreso",
    "impuestos federales sat": "egreso",
    "catecismo": "ingreso",
    "cargos diversos banco": "egreso",
    "comisiones bancarias": "egreso",
    "gas": "egreso",
    "ayuda a parroquias": "egreso",
    "papeleria de oficina": "egreso",
    "constancias": "ingreso",
    "honorarios contador": "egreso",
    "seguros medicos": "egreso",
    "primeras comuniones": "ingreso",
    "cartas de traslado": "ingreso",
    "articulo de limpieza": "egreso",
    "equipo de computo": "egreso",
    "confirmaciones": "ingreso",
    "presentaciones matrimoniales": "ingreso",
    "viaticos": "egreso",
    "devoluciones": "ingreso",
    "celebraciones especiales": "ingreso",
  };

  for (const key of Object.keys(overrides)) {
    if (n === key) return overrides[key];
  }

  const ingresoKeys = [
    "ingres",
    "aport",
    "ofrend",
    "diezm",
    "donac",
    "venta",
    "cuota",
    "cooper",
    "limos",
    "kerm",
    "apoyo",
    "recaud",
    "evento",
  ];

  const egresoKeys = [
    "egres",
    "gasto",
    "gastos",
    "constru",
    "obra",
    "pago",
    "compra",
    "servic",
    "nomina",
    "sueldo",
    "luz",
    "agua",
    "telefono",
    "internet",
    "renta",
    "manten",
    "material",
    "gasol",
    "combust",
    "material",
    "repar",
  ];

  if (ingresoKeys.some((k) => n.includes(k))) return "ingreso";
  if (egresoKeys.some((k) => n.includes(k))) return "egreso";
  return "";
}

async function getBottleIds() {
  if (onlyBottleId) return [onlyBottleId];
  const snap = await db.collection("botellas").get();
  return snap.docs.map((d) => d.id);
}

async function inferTipoFromEntries(bottleId, catId) {
  const snap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("entries")
    .where("categoryId", "==", catId)
    .limit(300)
    .get();

  let ing = 0;
  let egr = 0;

  snap.forEach((d) => {
    const tipo = normTipo(d.data()?.type || d.data()?.tipo);
    if (tipo === "ingreso") ing++;
    else if (tipo === "egreso") egr++;
  });

  if (ing === 0 && egr === 0) return "";
  return ing >= egr ? "ingreso" : "egreso";
}

async function inferTipoFromMovimientos(bottleId, catName) {
  if (!catName) return "";
  const snap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("movimientos")
    .where("categoria", "==", catName)
    .limit(300)
    .get();

  let ing = 0;
  let egr = 0;

  snap.forEach((d) => {
    const tipo = normTipo(d.data()?.tipo);
    if (tipo === "ingreso") ing++;
    else if (tipo === "egreso") egr++;
  });

  if (ing === 0 && egr === 0) return "";
  return ing >= egr ? "ingreso" : "egreso";
}

async function run() {
  const bottleIds = await getBottleIds();
  console.log(`Botellas a revisar: ${bottleIds.length}`);

  for (const bottleId of bottleIds) {
    const catsSnap = await db
      .collection("botellas")
      .doc(bottleId)
      .collection("categories")
      .get();

    const totalCats = catsSnap.size;
    if (totalCats === 0) {
      console.log(`Botella ${bottleId}: 0 categorías encontradas.`);
      continue;
    }

    let updates = [];
    let pending = 0;

    for (const catDoc of catsSnap.docs) {
      const cat = catDoc.data() || {};
      if (cat.tipo) continue;

      let tipo = "";
      let source = "";

      // Special case: duplicate categories into ingreso/egreso
      const normName = normalizeText(cat.name);
      const dupNames = new Map([
        ["varios", "VARIOS (Ingreso)"],
        ["transferencias", "TRANSFERENCIAS (Ingreso)"],
      ]);

      if (dupNames.has(normName)) {
        const newName = dupNames.get(normName);
        console.log(
          `[DUP]  ${bottleId}/${catDoc.id} "${cat.name}" -> crear ${newName} y marcar ${cat.name} como egreso`
        );

        if (commit) {
          const batch = db.batch();
          batch.update(catDoc.ref, { tipo: "egreso" });

          const newRef = db
            .collection("botellas")
            .doc(bottleId)
            .collection("categories")
            .doc();
          batch.set(newRef, {
            name: newName,
            tipo: "ingreso",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: "backfill",
          });

          await batch.commit();
        }

        pending++;
        continue;
      }

      if (!heuristicOnly) {
        tipo = await inferTipoFromEntries(bottleId, catDoc.id);
        source = tipo ? "entries" : "";

        if (!tipo) {
          tipo = await inferTipoFromMovimientos(bottleId, cat.name);
          source = tipo ? "movimientos" : "";
        }
      }

      if (!tipo) {
        tipo = guessByName(cat.name);
        source = tipo ? "heuristic" : "";
      }

      if (!tipo) {
        console.log(
          `[SKIP] ${bottleId}/${catDoc.id} "${cat.name}" -> sin tipo`
        );
        continue;
      }

      console.log(
        `[SET]  ${bottleId}/${catDoc.id} "${cat.name}" -> ${tipo} (${source})`
      );

      updates.push({ ref: catDoc.ref, tipo });
      pending++;

      if (updates.length >= 450 && commit) {
        const batch = db.batch();
        updates.forEach((u) => batch.update(u.ref, { tipo: u.tipo }));
        await batch.commit();
        updates = [];
      }
    }

    if (commit && updates.length) {
      const batch = db.batch();
      updates.forEach((u) => batch.update(u.ref, { tipo: u.tipo }));
      await batch.commit();
    }

    console.log(
      `Botella ${bottleId}: ${pending} categorías actualizadas (total ${totalCats}).`
    );
  }

  console.log(dry ? "DRY RUN completo." : "COMMIT completo.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
