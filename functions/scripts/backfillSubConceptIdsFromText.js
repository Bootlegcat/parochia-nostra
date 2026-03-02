// Set subCategoryId / conceptId on movimientos using text fields
// If no subcategoria/concepto, assigns to "General" (creates if missing)
// Usage:
//  node scripts/backfillSubConceptIdsFromText.js --dry --bottle=construyendo-lazos
//  node scripts/backfillSubConceptIdsFromText.js --commit --bottle=construyendo-lazos

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

  const catIds = catsSnap.docs.map((d) => d.id);

  const subByCatAndName = new Map();
  const conBySubAndName = new Map();

  for (const catId of catIds) {
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
      for (const c of conSnap.docs) {
        conBySubAndName.set(`${s.id}::${normKey(c.data()?.name)}`, c.id);
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
    const catId = data.categoryId;
    if (!catId) continue;

    let subId = data.subCategoryId || "";
    let conId = data.conceptId || "";

    if (!subId) {
      const subName = normKey(data.subcategoria || data.subCategory || data.subcategoria || "General");
      const key = `${catId}::${subName}`;
      subId = subByCatAndName.get(key) || "";
      if (!subId) subId = await ensureGeneralSub(catId, subByCatAndName);
    }

    if (!conId) {
      const conName = normKey(data.concepto || data.concept || "General");
      const key = `${subId}::${conName}`;
      conId = conBySubAndName.get(key) || "";
      if (!conId) conId = await ensureGeneralConcept(catId, subId, conBySubAndName);
    }

    if (!data.subCategoryId || !data.conceptId) {
      batch.update(m.ref, { subCategoryId: subId, conceptId: conId });
      ops++;
      updated++;
      await commitIfNeeded(false);
    }
  }

  await commitIfNeeded(true);
  console.log(`${dry ? "DRY" : "COMMIT"}: movimientos actualizados=${updated}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
