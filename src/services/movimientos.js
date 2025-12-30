import {
    collection,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    getDocs,
  } from "firebase/firestore";
  import { db } from "../firebase";
  
  export async function fetchMovimientos({
    botellaId,
    tipo,          // "ingreso" | "egreso" | null
    cuenta,        // string | null
    startDate,     // Date | null
    endDate,       // Date | null
    pageSize = 50,
    cursor = null, // DocumentSnapshot | null
  }) {
    const ref = collection(db, "botellas", botellaId, "movimientos");
  
    const constraints = [];
  
    if (tipo) constraints.push(where("tipo", "==", tipo));
    if (cuenta) constraints.push(where("cuentaBancaria", "==", cuenta));
  
    // fecha: necesitas Timestamp. Usamos Date y Firestore lo convierte bien.
    if (startDate) constraints.push(where("fecha", ">=", startDate));
    if (endDate) constraints.push(where("fecha", "<=", endDate));
  
    constraints.push(orderBy("fecha", "desc"));
    constraints.push(limit(pageSize));
  
    if (cursor) constraints.push(startAfter(cursor));
  
    const q = query(ref, ...constraints);
    const snap = await getDocs(q);
  
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
  
    return { items, nextCursor };
  }
  