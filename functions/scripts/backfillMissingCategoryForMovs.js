// Fill missing categoryId/subCategoryId/conceptId for movimientos
// Creates "Sin categoría (Ingreso/Egreso)" + "General" sub/concept as needed
// Usage:
//  node scripts/backfillMissingCategoryForMovs.js --dry --bottle=construyendo-lazos
//  node scripts/backfillMissingCategoryForMovs.js --commit --bottle=construyendo-lazos

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const dry = args.includes("--dry") || !commit;
const bottleArg = args.find((a) => a.startsWith("--bottle="));
const bottleId = bottleArg ? bottleArg.split("=").slice(1).join("=") : "";

if (!bottleId) {
  console.error("Debes pasar --bottle=<id>");
  process.exit(1);
}

function normKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toTipo(raw) {
  const t = String(raw || "").toLowerCase();
  if (t.includes("ing")) return "ingreso";
  if (t.includes("egr")) return "egreso";
  return "egreso";
}

async function ensureCategory(name, tipo, catByName) {
  const key = `${normKey(name)}::${tipo}`;
  if (catByName.has(key)) return catByName.get(key);

  const ref = db
    .collection("botellas")
    .doc(bottleId)
    .collection("categories")
    .doc();

  if (commit) {
    await ref.set({
      name,
      tipo,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "auto",
    });
  }

  catByName.set(key, ref.id);
  return ref.id;
}

async function ensureGeneralSub(catId, subByCatAndName) {
  const key = `${catId}::${normKey("General")}`;
  if (subByCatAndName.has(key)) return subByCatAndName.get(key);

  const ref = db
    .collection("botellas")
    .doc(bottleId)
    .collection("categories")
    .doc(catId)
    .collection("subcategories")
    .doc();

  if (commit) {
    await ref.set({
      name: "General",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "auto",
    });
  }
  subByCatAndName.set(key, ref.id);
  return ref.id;
}

async function ensureGeneralConcept(catId, subId, conBySubAndName) {
  const key = `${subId}::${normKey("General")}`;
  if (conBySubAndName.has(key)) return conBySubAndName.get(key);

  const ref = db
    .collection("botellas")
    .doc(bottleId)
    .collection("categories")
    .doc(catId)
    .collection("subcategories")
    .doc(subId)
    .collection("concepts")
    .doc();

  if (commit) {
    await ref.set({
      name: "General",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "auto",
    });
  }
  conBySubAndName.set(key, ref.id);
  return ref.id;
}

async function run() {
  const catsSnap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("categories")
    .get();

  const catByName = new Map();
  for (const d of catsSnap.docs) {
    const data = d.data() || {};
    const tipo = String(data.tipo || "").toLowerCase() || "egreso";
    const key = `${normKey(data.name)}::${tipo}`;
    catByName.set(key, d.id);
  }

  const subByCatAndName = new Map();
  const conBySubAndName = new Map();

  for (const c of catsSnap.docs) {
    const catId = c.id;
    const subSnap = await db
      .collection("botellas")
      .doc(bottleId)
      .collection("categories")
      .doc(catId)
      .collection("subcategories")
      .get();
    for (const s of subSnap.docs) {
      subByCatAndName.set(`${catId}::${normKey(s.data()?.name)}`, s.id);
      const conSnap = await db
        .collection("botellas")
        .doc(bottleId)
        .collection("categories")
        .doc(catId)
        .collection("subcategories")
        .doc(s.id)
        .collection("concepts")
        .get();
      for (const c2 of conSnap.docs) {
        conBySubAndName.set(`${s.id}::${normKey(c2.data()?.name)}`, c2.id);
      }
    }
  }

  const movSnap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("movimientos")
    .get();

  console.log(`Movimientos encontrados: ${movSnap.size}`);

  let batch = db.batch();
  let ops = 0;
  let updated = 0;

  async function commitIfNeeded(force = false) {
    if (ops >= 450 || (force && ops > 0)) {
      if (commit) await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  for (const m of movSnap.docs) {
    const data = m.data() || {};
    if (data.categoryId) continue;

    const tipo = toTipo(data.tipo || data.type);
    const catNameRaw = String(data.categoria || data.category || "").trim();

    let catId = "";
    if (catNameRaw) {
      const key = `${normKey(catNameRaw)}::${tipo}`;
      catId = catByName.get(key) || "";
      if (!catId) {
        catId = await ensureCategory(catNameRaw, tipo, catByName);
      }
    } else {
      const fallbackName =
        tipo === "ingreso" ? "Sin categoría (Ingreso)" : "Sin categoría (Egreso)";
      catId = await ensureCategory(fallbackName, tipo, catByName);
    }

    let subId = await ensureGeneralSub(catId, subByCatAndName);
    let conId = await ensureGeneralConcept(catId, subId, conBySubAndName);

    batch.update(m.ref, {
      categoryId: catId,
      subCategoryId: subId,
      conceptId: conId,
      categoria: data.categoria || data.category || "Sin categoría",
      subcategoria: data.subcategoria || data.subCategory || "General",
      concepto: data.concepto || data.concept || "General",
    });
    ops++;
    updated++;
    await commitIfNeeded(false);
  }

  await commitIfNeeded(true);
  console.log(`${dry ? "DRY" : "COMMIT"}: movimientos actualizados=${updated}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
