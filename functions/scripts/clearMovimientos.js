// Borra TODOS los documentos en botellas/{bottleId}/movimientos
// Uso:
//   node scripts/clearMovimientos.js --dry --bottle=construyendo-lazos
//   node scripts/clearMovimientos.js --commit --bottle=construyendo-lazos
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

async function run() {
  const colRef = db.collection("botellas").doc(bottleId).collection("movimientos");
  const snap = await colRef.get();

  console.log(`Movimientos encontrados en ${bottleId}: ${snap.size}`);
  if (snap.empty) {
    console.log("No hay movimientos para borrar.");
    return;
  }

  let batch = db.batch();
  let ops = 0;
  let deleted = 0;

  async function commitIfNeeded(force = false) {
    if (ops >= 450 || (force && ops > 0)) {
      if (commit) await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    ops++;
    deleted++;
    await commitIfNeeded(false);
  }

  await commitIfNeeded(true);

  console.log(`${dry ? "DRY" : "COMMIT"}: borrados ${deleted} movimientos en ${bottleId}`);
}

run().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
