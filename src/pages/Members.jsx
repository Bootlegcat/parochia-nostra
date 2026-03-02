// src/pages/Members.jsx
import { useEffect, useMemo, useState } from "react";
import { Navigate, Link, useNavigate, useParams } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import BackToHome from "../components/BackToHome";

const BOTTLE_ID_BY_ORG = {
  iglesia: "de-la-iglesia",
  "construyendo-lazos": "construyendo-lazos",
};

const SPECIAL_BOTTLES = ["de-la-iglesia", "construyendo-lazos"];
const SPECIAL_ENTRY_ID = "parroquia-nuestra-senora-de-guadalupe";
const SPECIAL_ENTRY_NAME = "Parroquia Nuestra Señora de Guadalupe";

const ROLES = ["viewer", "editor", "admin"];

function normEmail(s) {
  return String(s || "").trim().toLowerCase();
}

function roleLabel(role) {
  if (role === "admin") return "Administrador";
  if (role === "editor") return "Editor";
  return "Lector";
}

function parseInviteCode(raw, fallbackEntryId) {
  const t = String(raw || "").trim();
  if (!t) return { entryId: "", inviteId: "" };
  if (t.includes(":")) {
    const [entryId, inviteId] = t.split(":").map((x) => x.trim());
    return { entryId: entryId || "", inviteId: inviteId || "" };
  }
  return { entryId: fallbackEntryId || "", inviteId: t };
}

function orgIdForBottleId(bottleId) {
  if (bottleId === "de-la-iglesia") return "iglesia";
  if (bottleId === "construyendo-lazos") return "construyendo-lazos";
  return bottleId;
}

export default function Members() {
  const nav = useNavigate();
  const { orgId } = useParams();

  // ✅ mantener UI/flujo, pero hacer el user reactivo (evita nulls raros)
  const [user, setUser] = useState(() => getAuth().currentUser);

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => setUser(u));
    return () => unsub();
  }, []);

  // hooks siempre primero
  const bottleId = useMemo(() => {
    if (!orgId) return "";
    return BOTTLE_ID_BY_ORG[orgId] || orgId;
  }, [orgId]);

  const refs = useMemo(() => {
    if (!bottleId || !user?.uid) return null;
    return {
      memberDoc: doc(db, "botellas", bottleId, "members", user.uid),
      membersCol: collection(db, "botellas", bottleId, "members"),
    };
  }, [bottleId, user?.uid]);

  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState(null);

  // ✅ datos de entrada
  const [entryId, setEntryId] = useState("");
  const [entryName, setEntryName] = useState("");
  const [entryBottles, setEntryBottles] = useState([]); // {id, name}

  // ✅ abajo: ingresar código (siempre visible)
  const [inviteCode, setInviteCode] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [showClaim, setShowClaim] = useState(false);

  // ✅ unirse a otra entrada con código
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);

  // admin panel
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [adminBusy, setAdminBusy] = useState(false);

  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  // ✅ rol con fallback para que NO salga vacío
  const myRole = member?.role || "viewer";
  const isAdmin = myRole === "admin";

  const entryInviteRefs = useMemo(() => {
    if (!entryId) return null;
    return {
      invitesCol: collection(db, "entradas", entryId, "invites"),
      inviteDoc: (inviteId) => doc(db, "entradas", entryId, "invites", inviteId),
    };
  }, [entryId]);

  async function loadMyMembership() {
    if (!refs?.memberDoc) {
      setMember(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setOkMsg("");
    try {
      const snap = await getDoc(refs.memberDoc);
      setMember(snap.exists() ? snap.data() : null);
    } catch (e) {
      setError(e?.message || String(e));
      setMember(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadEntryData() {
    if (!bottleId || !user?.uid) return;
    try {
      let eId = "";
      let eName = "";

      const bSnap = await getDoc(doc(db, "botellas", bottleId));
      const bData = bSnap.exists() ? bSnap.data() : {};

      eId = bData?.entryId || "";
      eName = bData?.entryName || "";

      if (!eId) {
        if (SPECIAL_BOTTLES.includes(bottleId)) {
          eId = SPECIAL_ENTRY_ID;
          eName = SPECIAL_ENTRY_NAME;
        } else {
          eId = "sin-entrada";
          eName = "Sin entrada";
        }
      }

      setEntryId(eId);
      setEntryName(eName);

      // cargar botellas de esta entrada
      const uSnap = await getDoc(doc(db, "users", user.uid));
      const baseIds = uSnap.exists() ? uSnap.data()?.bottleIds || [] : [];

      const ids = new Set(baseIds);
      if (bottleId) ids.add(bottleId);
      for (const bid of SPECIAL_BOTTLES) {
        try {
          const mRef = doc(db, "botellas", bid, "members", user.uid);
          const mSnap = await getDoc(mRef);
          if (mSnap.exists()) ids.add(bid);
        } catch {
          // ignore
        }
      }

      const rows = [];
      if (eId === SPECIAL_ENTRY_ID) {
        const fallbackRows = [
          { id: "de-la-iglesia", name: "Iglesia" },
          { id: "construyendo-lazos", name: "Construyendo Lazos" },
        ];
        rows.push(...fallbackRows);
        for (const id of SPECIAL_BOTTLES) {
          try {
            const snap = await getDoc(doc(db, "botellas", id));
            if (!snap.exists()) continue;
            const data = snap.data() || {};
            const idx = rows.findIndex((r) => r.id === id);
            if (idx >= 0) rows[idx] = { id, name: data?.name || rows[idx].name };
          } catch {
            // ignore
          }
        }
      } else {
        for (const id of ids) {
          try {
            const snap = await getDoc(doc(db, "botellas", id));
            if (!snap.exists()) continue;
            const data = snap.data() || {};
            const bid =
              data?.entryId || (SPECIAL_BOTTLES.includes(id) ? SPECIAL_ENTRY_ID : "sin-entrada");
            if (bid !== eId) continue;
            rows.push({ id, name: data?.name || id });
          } catch {
            // ignore
          }
        }
      }

      setEntryBottles(rows);
    } catch (e) {
      // ignora errores de permisos en lectura pasiva
    }
  }

  async function loadAdminData() {
    if (!refs || !isAdmin) return;

    setAdminBusy(true);
    setError("");
    try {
      // members
      let mSnap;
      try {
        mSnap = await getDocs(query(refs.membersCol, orderBy("createdAt", "desc")));
      } catch {
        mSnap = await getDocs(refs.membersCol);
      }
      setMembers(mSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // invites (entrada)
      if (entryInviteRefs?.invitesCol) {
        let iSnap;
        try {
          iSnap = await getDocs(query(entryInviteRefs.invitesCol, orderBy("createdAt", "desc"), limit(50)));
        } catch {
          iSnap = await getDocs(query(entryInviteRefs.invitesCol, limit(50)));
        }
        setInvites(iSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (!msg.toLowerCase().includes("missing or insufficient permissions")) {
        setError(msg);
      }
    } finally {
      setAdminBusy(false);
    }
  }

  useEffect(() => {
    loadMyMembership();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs?.memberDoc?.path]);

  useEffect(() => {
    loadEntryData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottleId, user?.uid]);

  useEffect(() => {
    loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, refs?.membersCol?.path, entryInviteRefs?.invitesCol?.path]);

  async function onClaimInvite(e) {
    e.preventDefault();
    setError("");
    setOkMsg("");

    const code = inviteCode.trim();
    if (!code) return setError("Ingresa un código de invitación.");
    if (!entryId) return setError("No se pudo resolver la entrada.");
    if (!user?.email) return setError("Tu usuario no tiene email. Inicia sesión con email.");

    try {
      setClaimBusy(true);

      const parsed = parseInviteCode(code, entryId);
      if (!parsed.entryId || !parsed.inviteId) {
        throw new Error("Código inválido. Usa formato: entradaId:inviteId");
      }
      if (parsed.entryId !== entryId) {
        throw new Error(
          "Este código es para otra entrada. Usa el botón de abajo: “Ingresar código de invitación”."
        );
      }

      const inviteRef = doc(db, "entradas", parsed.entryId, "invites", parsed.inviteId);
      const inviteSnap = await getDoc(inviteRef);
      if (!inviteSnap.exists()) throw new Error("Ese código no existe en esta entrada.");
      const inv = inviteSnap.data() || {};

      if (inv.used === true) throw new Error("Este código ya fue usado.");
      if (normEmail(inv.email) !== normEmail(user.email)) {
        throw new Error("Este código no es para tu correo.");
      }

      const bottleIds = Array.isArray(inv.bottleIds) && inv.bottleIds.length
        ? inv.bottleIds
        : [bottleId];

      const role = ROLES.includes(inv.role) ? inv.role : "viewer";

      for (const bid of bottleIds) {
        await setDoc(
          doc(db, "botellas", bid, "members", user.uid),
          {
            role,
            email: normEmail(user.email),
            inviteId: parsed.inviteId,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await updateDoc(inviteRef, {
        used: true,
        usedBy: user.uid,
        usedEmail: normEmail(user.email),
        usedAt: serverTimestamp(),
      });

      await setDoc(
        doc(db, "users", user.uid),
        { bottleIds: arrayUnion(...bottleIds) },
        { merge: true }
      );

      setOkMsg("✅ Acceso concedido. Ya eres miembro de la entrada.");
      setInviteCode("");
      setShowClaim(false);

      await loadMyMembership();
      await loadAdminData();
    } catch (e2) {
      const msg = e2?.message || String(e2);
      if (msg.toLowerCase().includes("no document to update")) {
        setError(
          "❌ Ese código no existe en esta entrada (o fue borrado). Pide al administrador que te copie el código exacto."
        );
      } else if (msg.toLowerCase().includes("missing or insufficient permissions")) {
        setError(
          "❌ No tienes permiso para usar ese código. Revisa que el invite esté creado para TU email y que no esté usado."
        );
      } else {
        setError(
          msg ||
            "No se pudo usar el código. Verifica que sea correcto y que tu email coincida con el invite."
        );
      }
    } finally {
      setClaimBusy(false);
    }
  }

  async function onCreateInvite(e) {
    e.preventDefault();
    setError("");
    setOkMsg("");

    if (!entryInviteRefs?.invitesCol) return setError("No se pudo resolver la entrada.");
    if (!isAdmin) return setError("No tienes permisos.");

    const email = normEmail(inviteEmail);
    if (!email) return setError("Escribe un email.");
    if (!ROLES.includes(inviteRole)) return setError("Rol inválido.");

    try {
      setAdminBusy(true);

      const bottleIds = entryBottles.length ? entryBottles.map((b) => b.id) : [bottleId];
      const ref = await addDoc(entryInviteRefs.invitesCol, {
        entryId: entryId,
        entryName: entryName || "Entrada",
        bottleId: bottleId,
        bottleIds,
        email,
        role: inviteRole,
        used: false,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || "",
        createdByEmail: normEmail(user?.email || ""),
      });

      setOkMsg(`✅ Invitación creada. Código: ${entryId}:${ref.id}`);
      setInviteEmail("");
      setInviteRole("viewer");
      await loadAdminData();
    } catch (e2) {
      setError(e2?.message || String(e2));
    } finally {
      setAdminBusy(false);
    }
  }

  async function onCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setOkMsg("📋 Copiado.");
      setTimeout(() => setOkMsg(""), 1200);
    } catch {
      setOkMsg("No se pudo copiar (permiso del navegador).");
    }
  }

  async function onSetRole(memberUid, role) {
    setError("");
    setOkMsg("");
    if (!isAdmin) return;
    if (!ROLES.includes(role)) return;
    if (!bottleId) return;

    try {
      setAdminBusy(true);
      await updateDoc(doc(db, "botellas", bottleId, "members", memberUid), { role });
      setOkMsg("✅ Rol actualizado.");
      await loadAdminData();
    } catch (e2) {
      setError(e2?.message || String(e2));
    } finally {
      setAdminBusy(false);
    }
  }

  async function onRemoveMember(memberUid) {
    setError("");
    setOkMsg("");
    if (!isAdmin) return;
    if (!bottleId) return;

    const ok = window.confirm("¿Eliminar este miembro? Perderá acceso.");
    if (!ok) return;

    try {
      setAdminBusy(true);
      await deleteDoc(doc(db, "botellas", bottleId, "members", memberUid));
      setOkMsg("✅ Miembro eliminado.");
      await loadAdminData();
    } catch (e2) {
      setError(e2?.message || String(e2));
    } finally {
      setAdminBusy(false);
    }
  }

  async function onDeleteInvite(inviteId) {
    setError("");
    setOkMsg("");
    if (!isAdmin) return;
    if (!entryInviteRefs?.inviteDoc) return;

    const ok = window.confirm("¿Eliminar esta invitación?");
    if (!ok) return;

    try {
      setAdminBusy(true);
      await deleteDoc(entryInviteRefs.inviteDoc(inviteId));
      setOkMsg("✅ Invitación eliminada.");
      await loadAdminData();
    } catch (e2) {
      setError(e2?.message || String(e2));
    } finally {
      setAdminBusy(false);
    }
  }

  async function onJoinOtherEntry(e) {
    e.preventDefault();
    setError("");
    setOkMsg("");

    const parsed = parseInviteCode(joinCode, "");
    if (!parsed.entryId || !parsed.inviteId) {
      return setError("Código inválido. Usa formato: entradaId:inviteId");
    }
    if (!user?.uid || !user?.email) return setError("No hay sesión activa con email.");

    try {
      setJoinBusy(true);

      const inviteRef = doc(db, "entradas", parsed.entryId, "invites", parsed.inviteId);
      const inviteSnap = await getDoc(inviteRef);
      if (!inviteSnap.exists()) throw new Error("Ese código no existe.");
      const inv = inviteSnap.data() || {};

      if (inv.used === true) throw new Error("Este código ya fue usado.");
      if (normEmail(inv.email) !== normEmail(user.email)) {
        throw new Error("Este código no es para tu correo.");
      }

      const bottleIds = Array.isArray(inv.bottleIds) && inv.bottleIds.length
        ? inv.bottleIds
        : [];
      if (!bottleIds.length) {
        throw new Error("Este código no tiene botellas asociadas. Pide uno nuevo al administrador.");
      }

      const role = ROLES.includes(inv.role) ? inv.role : "viewer";

      for (const bid of bottleIds) {
        await setDoc(
          doc(db, "botellas", bid, "members", user.uid),
          {
            role,
            email: normEmail(user.email),
            inviteId: parsed.inviteId,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await updateDoc(inviteRef, {
        used: true,
        usedBy: user.uid,
        usedEmail: normEmail(user.email),
        usedAt: serverTimestamp(),
      });

      await setDoc(
        doc(db, "users", user.uid),
        { bottleIds: arrayUnion(...bottleIds) },
        { merge: true }
      );

      setOkMsg(`✅ Te uniste a la entrada: ${inv.entryName || parsed.entryId}.`);
      setJoinCode("");
      setJoinOpen(false);
    } catch (e2) {
      setError(e2?.message || String(e2));
    } finally {
      setJoinBusy(false);
    }
  }

  // guards al final (igual flujo)
  if (!orgId) return <Navigate to="/organizaciones" replace />;
  if (!user) return <Navigate to="/" replace />;
  if (!bottleId) return <Navigate to="/organizaciones" replace />;

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Miembros</h1>
          <BackToHome />
        </div>
        <div className="rounded-xl border bg-white p-4">Cargando…</div>
      </div>
    );
  }

  const showError =
    error && !String(error).toLowerCase().includes("missing or insufficient permissions");

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl md:text-3xl font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
          Miembros
        </h1>
        <BackToHome to="/especiales" />
      </div>

      <div className="mb-3 flex items-center justify-between text-sm">
        <Link className="text-white/90 underline underline-offset-4" to="/especiales">
          Volver al inicio
        </Link>
        <span className="text-white/80">Org: {orgId}</span>
      </div>

      {(showError || okMsg) && (
        <div className="mb-4">
          {showError && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800 mb-2">
              {error}
            </div>
          )}
          {okMsg && (
            <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-green-800">
              {okMsg}
            </div>
          )}
        </div>
      )}

      {/* BOTELLAS DE LA ENTRADA */}
      <div className="rounded-2xl border bg-white p-5 mb-6">
        <div className="text-lg font-semibold">Botellas de la entrada</div>
        <div className="text-sm text-slate-600 mt-1">
          Entrada: <b>{entryName || "(sin nombre)"}</b> · ID: <b>{entryId || "(sin ID)"}</b>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {entryBottles.map((b) => (
            <button
              key={b.id}
              type="button"
              className="rounded-xl border px-4 py-3 text-left hover:bg-slate-50"
              onClick={() => nav(`/org/${orgIdForBottleId(b.id)}/home`)}
            >
              <div className="font-semibold">{b.name}</div>
              <div className="text-xs text-slate-500">{b.id}</div>
            </button>
          ))}
          {entryBottles.length === 0 && (
            <div className="text-sm text-slate-500">No hay botellas para esta entrada.</div>
          )}
        </div>
      </div>

      {/* TU ACCESO (igual que antes) */}
      <div className="rounded-2xl border bg-white p-5 mb-6">
        <div className="text-lg font-semibold">Tu acceso</div>
        <div className="text-sm text-slate-600 mt-1">
          Rol: <b>{roleLabel(myRole)}</b> · Email: <b>{member?.email || user.email || "(sin email)"}</b>
        </div>

        {!member && (
          <div className="mt-3 text-sm text-slate-600">
            Aún no eres miembro de esta organización.
          </div>
        )}

        {!isAdmin && member && (
          <div className="mt-3 text-sm text-slate-600">
            Solo el <b>administrador</b> puede invitar y cambiar roles.
          </div>
        )}
      </div>

      {/* ADMIN: invitar miembro (igual) */}
      {isAdmin && (
        <div className="rounded-2xl border bg-white p-5 mb-6">
          <div className="text-lg font-semibold mb-3">Invitar miembro</div>
          <form onSubmit={onCreateInvite} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              className="md:col-span-3 rounded-xl border px-3 py-2"
              placeholder="email@ejemplo.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={adminBusy}
            />
            <select
              className="rounded-xl border px-3 py-2"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              disabled={adminBusy}
            >
              <option value="viewer">Lector</option>
              <option value="editor">Editor</option>
              <option value="admin">Administrador</option>
            </select>
            <button
              className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50"
              disabled={adminBusy}
            >
              Crear invite
            </button>
          </form>
          <div className="text-xs text-slate-500 mt-2">
            Nota: el código se comparte como <b>{entryId || "entradaId"}:inviteId</b>. El usuario entra como <b>lector</b>.
          </div>
        </div>
      )}

      {/* ADMIN: invitaciones (igual) */}
      {isAdmin && (
        <div className="rounded-2xl border bg-white p-5 mb-6">
          <div className="text-lg font-semibold mb-3">Invitaciones</div>
          {invites.length === 0 ? (
            <div className="text-sm text-slate-600">No hay invites.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 pr-3">Entrada</th>
                    <th className="py-2 pr-3">Código</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Rol</th>
                    <th className="py-2 pr-3">Usado</th>
                    <th className="py-2 pr-3">Usado por</th>
                    <th className="py-2 pr-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => {
                    const code = `${entryId}:${inv.id}`;
                    return (
                      <tr key={inv.id} className="border-t">
                        <td className="py-2 pr-3 font-mono text-xs">{entryId}</td>
                        <td className="py-2 pr-3 font-mono">{code}</td>
                        <td className="py-2 pr-3">{inv.email}</td>
                        <td className="py-2 pr-3">{roleLabel(inv.role)}</td>
                        <td className="py-2 pr-3">{inv.used ? "sí" : "no"}</td>
                        <td className="py-2 pr-3">{inv.usedEmail || "—"}</td>
                        <td className="py-2 pr-3 flex gap-2">
                          <button
                            className="rounded-lg border px-3 py-1 hover:bg-slate-50"
                            onClick={() => onCopy(code)}
                            type="button"
                          >
                            Copiar
                          </button>
                          <button
                            className="rounded-lg border px-3 py-1 hover:bg-red-50 hover:text-red-700"
                            onClick={() => onDeleteInvite(inv.id)}
                            type="button"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ADMIN: miembros (igual) */}
      {isAdmin && (
        <div className="rounded-2xl border bg-white p-5 mb-6">
          <div className="text-lg font-semibold mb-3">Miembros</div>
          {members.length === 0 ? (
            <div className="text-sm text-slate-600">No hay miembros.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 pr-3">UID</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Rol</th>
                    <th className="py-2 pr-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="py-2 pr-3 font-mono">{m.id}</td>
                      <td className="py-2 pr-3">{m.email || ""}</td>
                      <td className="py-2 pr-3">
                        <select
                          className="rounded-lg border px-2 py-1"
                          value={m.role || "viewer"}
                          onChange={(e) => onSetRole(m.id, e.target.value)}
                          disabled={adminBusy}
                        >
                          <option value="viewer">Lector</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Administrador</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        {m.id === user.uid ? (
                          <span className="text-slate-500">(tú)</span>
                        ) : (
                          <button
                            className="rounded-lg border px-3 py-1 hover:bg-red-50 hover:text-red-700"
                            onClick={() => onRemoveMember(m.id)}
                            disabled={adminBusy}
                            type="button"
                          >
                            Eliminar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-slate-500 mt-2">
            Si eliminas a alguien, pierde acceso inmediatamente.
          </div>
        </div>
      )}

      {/* ✅ ÚNICO CAMBIO PEDIDO: botón abajo para ingresar código */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Ingresar código de invitación</div>
            <div className="text-sm text-slate-600">
              Pega aquí el código que te dio un admin para unirte a otra entrada.
            </div>
          </div>

          <button
            type="button"
            onClick={() => setJoinOpen((v) => !v)}
            className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
          >
            {joinOpen ? "Cerrar" : "Ingresar código"}
          </button>
        </div>

        {joinOpen && (
          <form onSubmit={onJoinOtherEntry} className="mt-4 flex flex-col md:flex-row gap-3">
            <input
              className="flex-1 rounded-xl border px-3 py-2"
              placeholder="Código (entradaId:inviteId)"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            <button
              className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50"
              disabled={joinBusy}
            >
              {joinBusy ? "Validando…" : "Unirme"}
            </button>
          </form>
        )}

        <div className="text-xs text-slate-500 mt-3">
          Email actual: <b>{user.email || "(sin email)"}</b>
        </div>
      </div>
    </div>
  );
}
