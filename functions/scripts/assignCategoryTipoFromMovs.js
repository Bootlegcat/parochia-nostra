// Asigna campo "tipo" a categorías usando los movimientos (mayoría)
// Uso:
//  node scripts/assignCategoryTipoFromMovs.js --dry --bottle=construyendo-lazos
//  node scripts/assignCategoryTipoFromMovs.js --commit --bottle=construyendo-lazos
// Requiere GOOGLE_APPLICATION_CREDENTIALS

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

async function run() {
  const catsSnap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("categories")
    .get();

  const catByName = new Map();
  for (const d of catsSnap.docs) {
    const name = d.data()?.name || "";
    if (name) catByName.set(normKey(name), d.id);
  }

  const movSnap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("movimientos")
    .get();

  console.log(`Categorías: ${catsSnap.size}`);
  console.log(`Movimientos: ${movSnap.size}`);

  const counts = new Map(); // catId -> {ing, egr}

  for (const m of movSnap.docs) {
    const data = m.data() || {};
    const catName = data.categoria || data.CATEGORIA || "";
    if (!catName) continue;
    const catId = catByName.get(normKey(catName));
    if (!catId) continue;

    const tipo = String(data.tipo || data.TIPO || "").toLowerCase();
    const isIng = tipo.includes("ing");
    const isEgr = tipo.includes("egr");

    const cur = counts.get(catId) || { ing: 0, egr: 0 };
    if (isIng) cur.ing++;
    else if (isEgr) cur.egr++;
    counts.set(catId, cur);
  }

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

  for (const [catId, c] of counts.entries()) {
    const tipo = c.ing >= c.egr ? "ingreso" : "egreso";
    const ref = db.collection("botellas").doc(bottleId).collection("categories").doc(catId);
    batch.set(ref, { tipo }, { merge: true });
    ops++;
    updated++;
    await commitIfNeeded(false);
  }

  await commitIfNeeded(true);
  console.log(`${dry ? "DRY" : "COMMIT"}: categorías actualizadas=${updated}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
