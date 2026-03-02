// Check movimientos IDs coverage
// Usage:
//  node scripts/checkMovsIds.js --bottle=construyendo-lazos

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const args = process.argv.slice(2);
const bottleArg = args.find((a) => a.startsWith("--bottle="));
const bottleId = bottleArg ? bottleArg.split("=").slice(1).join("=") : "";

if (!bottleId) {
  console.error("Debes pasar --bottle=<id>");
  process.exit(1);
}

async function run() {
  const snap = await db.collection("botellas").doc(bottleId).collection("movimientos").get();
  console.log(`Movimientos: ${snap.size}`);

  let noCat = 0, noSub = 0, noCon = 0;
  let withCat = 0, withSub = 0, withCon = 0;

  for (const d of snap.docs) {
    const data = d.data() || {};
    if (data.categoryId) withCat++; else noCat++;
    if (data.subCategoryId) withSub++; else noSub++;
    if (data.conceptId) withCon++; else noCon++;
  }

  console.log(`categoryId: ${withCat} con, ${noCat} sin`);
  console.log(`subCategoryId: ${withSub} con, ${noSub} sin`);
  console.log(`conceptId: ${withCon} con, ${noCon} sin`);
}

run().catch((e)=>{console.error(e); process.exit(1);});
