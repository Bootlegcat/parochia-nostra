// Merge duplicate categories by normalized name within a bottle
// Usage:
//  node scripts/mergeDuplicateCategories.js --dry --bottle=construyendo-lazos
//  node scripts/mergeDuplicateCategories.js --commit --bottle=construyendo-lazos
// Requires GOOGLE_APPLICATION_CREDENTIALS

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

function tsToMillis(ts) {
  if (!ts) return Number.MAX_SAFE_INTEGER;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return Number.MAX_SAFE_INTEGER;
}

async function run() {
  const catsSnap = await db
    .collection("botellas")
    .doc(bottleId)
    .collection("categories")
    .get();

  console.log(`Categorías encontradas: ${catsSnap.size}`);

  const groups = new Map();
  for (const d of catsSnap.docs) {
    const name = d.data()?.name || "";
    const key = normKey(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: d.id, data: d.data() || {} });
  }

  const duplicates = Array.from(groups.entries()).filter(([, arr]) => arr.length > 1);
  console.log(`Grupos duplicados: ${duplicates.length}`);

  let batch = db.batch();
  let ops = 0;
  let merged = 0;
  let updatedMovs = 0;
  let updatedEntries = 0;
  let createdSubs = 0;
  let createdCons = 0;
  let deletedCats = 0;

  async function commitIfNeeded(force = false) {
    if (ops >= 450 || (force && ops > 0)) {
      if (commit) await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  for (const [key, arr] of duplicates) {
    // choose canonical: oldest createdAt, else first id
    const sorted = [...arr].sort((a, b) => {
      const am = tsToMillis(a.data.createdAt);
      const bm = tsToMillis(b.data.createdAt);
      if (am !== bm) return am - bm;
      return a.id.localeCompare(b.id);
    });

    const canonical = sorted[0];
    const dupes = sorted.slice(1);

    const canonicalRef = db
      .collection("botellas")
      .doc(bottleId)
      .collection("categories")
      .doc(canonical.id);

    // build subcategory map for canonical by norm name
    const canonicalSubsSnap = await canonicalRef.collection("subcategories").get();
    const subByName = new Map();
    for (const sd of canonicalSubsSnap.docs) {
      subByName.set(normKey(sd.data()?.name), sd.id);
    }

    const conceptBySubAndName = new Map(); // subId::name -> conceptId
    for (const sd of canonicalSubsSnap.docs) {
      const conSnap = await canonicalRef
        .collection("subcategories")
        .doc(sd.id)
        .collection("concepts")
        .get();
      for (const cd of conSnap.docs) {
        conceptBySubAndName.set(`${sd.id}::${normKey(cd.data()?.name)}`, cd.id);
      }
    }

    for (const dupe of dupes) {
      const dupeRef = db
        .collection("botellas")
        .doc(bottleId)
        .collection("categories")
        .doc(dupe.id);

      // map subcategories from dupe -> canonical
      const subMap = new Map(); // oldSubId -> newSubId
      const dupeSubsSnap = await dupeRef.collection("subcategories").get();
      for (const sd of dupeSubsSnap.docs) {
        const name = sd.data()?.name || "";
        const nkey = normKey(name);
        let targetSubId = subByName.get(nkey);
        if (!targetSubId) {
          const newRef = canonicalRef.collection("subcategories").doc();
          batch.set(newRef, {
            name,
            createdAt: sd.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
            source: sd.data()?.source || "merge",
          });
          ops++;
          createdSubs++;
          await commitIfNeeded(false);
          targetSubId = newRef.id;
          subByName.set(nkey, targetSubId);
        }
        subMap.set(sd.id, targetSubId);

        // concepts inside sub
        const conSnap = await dupeRef
          .collection("subcategories")
          .doc(sd.id)
          .collection("concepts")
          .get();

        for (const cd of conSnap.docs) {
          const cname = cd.data()?.name || "";
          const ckey = `${targetSubId}::${normKey(cname)}`;
          if (!conceptBySubAndName.has(ckey)) {
            const newConRef = canonicalRef
              .collection("subcategories")
              .doc(targetSubId)
              .collection("concepts")
              .doc();
            batch.set(newConRef, {
              name: cname,
              createdAt: cd.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
              source: cd.data()?.source || "merge",
            });
            ops++;
            createdCons++;
            await commitIfNeeded(false);
            conceptBySubAndName.set(ckey, newConRef.id);
          }
        }
      }

      // update movimientos referencing dupe categoryId
      const movSnap = await db
        .collection("botellas")
        .doc(bottleId)
        .collection("movimientos")
        .where("categoryId", "==", dupe.id)
        .get();

      for (const m of movSnap.docs) {
        const data = m.data() || {};
        const patch = { categoryId: canonical.id };
        if (data.subCategoryId && subMap.has(data.subCategoryId)) {
          patch.subCategoryId = subMap.get(data.subCategoryId);
        }
        if (data.conceptId) {
          // remap conceptId if possible
          const newSubId = patch.subCategoryId || data.subCategoryId;
          if (newSubId) {
            const key = `${newSubId}::${normKey(data.concepto || data.concept || "")}`;
            if (conceptBySubAndName.has(key)) patch.conceptId = conceptBySubAndName.get(key);
          }
        }
        batch.update(m.ref, patch);
        ops++;
        updatedMovs++;
        await commitIfNeeded(false);
      }

      // update entries referencing dupe categoryId
      const entSnap = await db
        .collection("botellas")
        .doc(bottleId)
        .collection("entries")
        .where("categoryId", "==", dupe.id)
        .get();

      for (const e of entSnap.docs) {
        const data = e.data() || {};
        const patch = { categoryId: canonical.id };
        if (data.subCategoryId && subMap.has(data.subCategoryId)) {
          patch.subCategoryId = subMap.get(data.subCategoryId);
        }
        if (data.conceptId) {
          const newSubId = patch.subCategoryId || data.subCategoryId;
          if (newSubId) {
            const key = `${newSubId}::${normKey(data.concept || data.concepto || "")}`;
            if (conceptBySubAndName.has(key)) patch.conceptId = conceptBySubAndName.get(key);
          }
        }
        batch.update(e.ref, patch);
        ops++;
        updatedEntries++;
        await commitIfNeeded(false);
      }

      // delete duplicate category doc (subcollections remain, but no longer referenced)
      batch.delete(dupeRef);
      ops++;
      deletedCats++;
      await commitIfNeeded(false);

      merged++;
    }
  }

  await commitIfNeeded(true);

  console.log(`\n${dry ? "DRY" : "COMMIT"} summary:`);
  console.log(` merged groups: ${duplicates.length}`);
  console.log(` duplicate cats deleted: ${deletedCats}`);
  console.log(` created subcategories: ${createdSubs}`);
  console.log(` created concepts: ${createdCons}`);
  console.log(` updated movimientos: ${updatedMovs}`);
  console.log(` updated entries: ${updatedEntries}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
