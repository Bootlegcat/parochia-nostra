import { db } from "../firebase";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

export async function ensurePersonalBottle(uid, email) {
  if (!uid) throw new Error("ensurePersonalBottle: uid requerido");

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  const existing = userSnap.exists() ? userSnap.data()?.defaultBottleId : null;
  if (existing) return existing;

  const bottleRef = await addDoc(collection(db, "botellas"), {
    name: "Mi botella",
    createdAt: serverTimestamp(),
    ownerUid: uid,
    kind: "personal",
  });

  const bottleId = bottleRef.id;

  await setDoc(doc(db, "botellas", bottleId, "members", uid), {
    role: "admin",
    email: email || "",
    createdAt: serverTimestamp(),
    createdBy: uid,
  });

  await setDoc(
    userRef,
    { defaultBottleId: bottleId, createdAt: serverTimestamp() },
    { merge: true }
  );

  return bottleId;
}
