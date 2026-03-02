// Backfill subcategories and concepts from movimientos.
// Usage:
//   node scripts/backfillSubcatsConcepts.js --dry --bottle=de-la-iglesia
//   node scripts/backfillSubcatsConcepts.js --commit --bottle=de-la-iglesia
//
// Requires Firebase Admin credentials (GOOGLE_APPLICATION_CREDENTIALS).

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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

async function run() {
  const catSnap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("categories")
    .get();

  console.log(`Categorías encontradas: ${catSnap.size}`);

  const catByName = new Map();
  for (const d of catSnap.docs) {
    catByName.set(normKey(d.data()?.name), d.id);
  }

  const subByCatName = new Map(); // key: catId::subName -> subId
  const conBySubName = new Map(); // key: catId::subId::conceptName -> conceptId
  const loadedCats = new Set();

  async function loadCatCaches(catId) {
    if (loadedCats.has(catId)) return;
    loadedCats.add(catId);

    const subSnap = await db
      .collection("botellas")
      .doc(bottleId)
      .collection("categories")
      .doc(catId)
      .collection("subcategories")
      .get();
    for (const sd of subSnap.docs) {
      subByCatName.set(`${catId}::${normKey(sd.data()?.name)}`, sd.id);

      const conSnap = await db
        .collection("botellas")
        .doc(bottleId)
        .collection("categories")
        .doc(catId)
        .collection("subcategories")
        .doc(sd.id)
        .collection("concepts")
        .get();
      for (const cd of conSnap.docs) {
        conBySubName.set(
          `${catId}::${sd.id}::${normKey(cd.data()?.name)}`,
          cd.id
        );
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
  let createdSubs = 0;
  let createdCons = 0;

  async function commitIfNeeded(force = false) {
    if (ops >= 450 || (force && ops > 0)) {
      if (commit) await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  for (const m of movSnap.docs) {
    const data = m.data() || {};
    const catName = data.categoria || data.CATEGORIA || "";
    let subName = data.subcategoria || data.SUBCATEGORIA || "";
    const conName = data.concepto || data.CONCEPTO || "";

    if (!catName) continue;

    // Si no hay subcategoría pero sí concepto, usamos el concepto como subcategoría
    if (!subName && conName) subName = conName;

    if (!subName) continue;

    const catId = catByName.get(normKey(catName));
    if (!catId) continue;

    await loadCatCaches(catId);

    const subKey = `${catId}::${normKey(subName)}`;
    let subId = subByCatName.get(subKey);
    if (!subId) {
      const subRef = db
        .collection("botellas")
        .doc(bottleId)
        .collection("categories")
        .doc(catId)
        .collection("subcategories")
        .doc();
      batch.set(subRef, {
        name: subName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: "backfill",
      });
      ops++;
      createdSubs++;
      subId = subRef.id;
      subByCatName.set(subKey, subId);
    }

    if (conName) {
      const conKey = `${catId}::${subId}::${normKey(conName)}`;
      if (!conBySubName.has(conKey)) {
        const conRef = db
          .collection("botellas")
          .doc(bottleId)
          .collection("categories")
          .doc(catId)
          .collection("subcategories")
          .doc(subId)
          .collection("concepts")
          .doc();
        batch.set(conRef, {
          name: conName,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          source: "backfill",
        });
        ops++;
        createdCons++;
        conBySubName.set(conKey, conRef.id);
      }
    }

    await commitIfNeeded(false);
  }

  await commitIfNeeded(true);

  console.log(
    `Backfill ${dry ? "DRY" : "COMMIT"}: subcategorías creadas=${createdSubs}, conceptos creados=${createdCons}`
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
