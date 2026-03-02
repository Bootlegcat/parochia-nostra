// Backfill categoryId / subCategoryId / conceptId / bankAccountId
// on entries, based on names.
// Usage:
//   node scripts/backfillEntryIds.js --dry --bottle=de-la-iglesia
//   node scripts/backfillEntryIds.js --commit --bottle=de-la-iglesia
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
  const entSnap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("entries")
    .get();

  console.log(`Entries encontrados: ${entSnap.size}`);

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

  for (const e of entSnap.docs) {
    const data = e.data() || {};
    const catName = data.category || data.categoria || "";
    const subName = data.subCategory || data.subcategoria || "";
    const conName = data.concept || data.concepto || "";
    const bankName = data.bankAccount || data.cuentaBancaria || data.cuenta || "";

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
      batch.update(e.ref, update);
      ops++;
      updated++;
      await commitIfNeeded(false);
    }
  }

  await commitIfNeeded(true);
  console.log(`Backfill ${dry ? "DRY" : "COMMIT"}: updated ${updated} entries`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
