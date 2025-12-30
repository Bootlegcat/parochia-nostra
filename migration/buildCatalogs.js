const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccountKey.json");
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) throw new Error("No serviceAccountKey.json");

admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)) });
const db = admin.firestore();

const BOTELLA_ID = "de-la-iglesia";

function keyify(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "");
}

async function main() {
  const movRef = db.collection("botellas").doc(BOTELLA_ID).collection("movimientos");
  const snap = await movRef.get();

  const catMap = new Map();
  const subMap = new Map();
  const conMap = new Map();

  for (const doc of snap.docs) {
    const m = doc.data();
    const categoria = (m.categoria || "").trim();
    const subcategoria = (m.subcategoria || "").trim();
    const concepto = (m.concepto || "").trim();

    if (categoria) {
      const id = keyify(categoria);
      catMap.set(id, { name: categoria, count: (catMap.get(id)?.count || 0) + 1 });
    }

    if (subcategoria) {
      const id = keyify(`${categoria}__${subcategoria}`);
      subMap.set(id, {
        name: subcategoria,
        categoria: categoria || "",
        count: (subMap.get(id)?.count || 0) + 1,
      });
    }

    if (concepto) {
      const id = keyify(`${categoria}__${subcategoria}__${concepto}`);
      conMap.set(id, {
        name: concepto,
        categoria: categoria || "",
        subcategoria: subcategoria || "",
        count: (conMap.get(id)?.count || 0) + 1,
      });
    }
  }

  const base = db.collection("botellas").doc(BOTELLA_ID).collection("catalogo");

  async function writeMap(map, group) {
    const col = base.doc(group).collection("items");
    let batch = db.batch();
    let n = 0;

    for (const [id, data] of map.entries()) {
      batch.set(col.doc(id), { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      n++;
      if (n % 500 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    await batch.commit();
    console.log(`✅ ${group}: ${map.size} items`);
  }

  await writeMap(catMap, "categorias");
  await writeMap(subMap, "subcategorias");
  await writeMap(conMap, "conceptos");

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
