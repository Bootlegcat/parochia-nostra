// Backfill categoryId / subCategoryId / conceptId / bankAccountId
// on movimientos, based on names.
// Usage:
//   node scripts/backfillMovimientoIds.js --dry --bottle=de-la-iglesia
//   node scripts/backfillMovimientoIds.js --commit --bottle=de-la-iglesia
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
    .replace(/[\u0300-\u036f]/g, "");
}

async function buildCaches() {
  const catsSnap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("categories")
    .get();

  const catByName = new Map();
  for (const d of catsSnap.docs) {
    catByName.set(normKey(d.data()?.name), d.id);
  }

  const subByCatAndName = new Map(); // catId::subName -> subId
  const conBySubAndName = new Map(); // subId::conceptName -> conceptId

  for (const catDoc of catsSnap.docs) {
    const catId = catDoc.id;
    const subSnap = await db
      .collection("botellas")
      .doc(bottleId)
      .collection("categories")
      .doc(catId)
      .collection("subcategories")
      .get();

    for (const subDoc of subSnap.docs) {
      const subId = subDoc.id;
      subByCatAndName.set(
        `${catId}::${normKey(subDoc.data()?.name)}`,
        subId
      );

      const conSnap = await db
        .collection("botellas")
        .doc(bottleId)
        .collection("categories")
        .doc(catId)
        .collection("subcategories")
        .doc(subId)
        .collection("concepts")
        .get();
      for (const conDoc of conSnap.docs) {
        conBySubAndName.set(
          `${subId}::${normKey(conDoc.data()?.name)}`,
          conDoc.id
        );
      }
    }
  }

  const bankSnap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("bankAccounts")
    .get();
  const bankByName = new Map();
  for (const b of bankSnap.docs) {
    bankByName.set(normKey(b.data()?.name), b.id);
  }

  return { catByName, subByCatAndName, conBySubAndName, bankByName };
}

async function run() {
  const caches = await buildCaches();
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
    const catName = data.categoria || data.CATEGORIA || "";
    const subName = data.subcategoria || data.SUBCATEGORIA || "";
    const conName = data.concepto || data.CONCEPTO || "";
    const bankName =
      data.cuentaBancaria ||
      data.CUENTA_BANCARIA ||
      data.cuenta ||
      data.CUENTA ||
      "";

    const update = {};

    if (!data.categoryId && catName) {
      const catId = caches.catByName.get(normKey(catName));
      if (catId) update.categoryId = catId;

      if (!data.subCategoryId && subName && catId) {
        const subId = caches.subByCatAndName.get(
          `${catId}::${normKey(subName)}`
        );
        if (subId) update.subCategoryId = subId;

        if (!data.conceptId && conName && subId) {
          const conId = caches.conBySubAndName.get(
            `${subId}::${normKey(conName)}`
          );
          if (conId) update.conceptId = conId;
        }
      }
    }

    if (!data.bankAccountId && bankName) {
      const bankId = caches.bankByName.get(normKey(bankName));
      if (bankId) update.bankAccountId = bankId;
    }

    if (Object.keys(update).length) {
      batch.update(m.ref, update);
      ops++;
      updated++;
      await commitIfNeeded(false);
    }
  }

  await commitIfNeeded(true);
  console.log(`Backfill ${dry ? "DRY" : "COMMIT"}: updated ${updated} movimientos`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
