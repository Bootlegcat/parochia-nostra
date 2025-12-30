import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, getDocs } from "firebase/firestore";

function Dashboard() {
  const [entries, setEntries] = useState([]);
  const [type, setType] = useState("income");
  const [amount, setAmount] = useState("");

  const fetchEntries = async () => {
    const snapshot = await getDocs(collection(db, "entries"));
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setEntries(data);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount) return;

    await addDoc(collection(db, "entries"), {
      type,
      amount: parseFloat(amount),
      createdAt: new Date()
    });

    setAmount("");
    fetchEntries(); // refresh
  };

  useEffect(() => {
    fetchEntries();
  }, []);

  return (
    <div className="max-w-md mx-auto mt-10">
      <h2 className="text-xl font-bold mb-4">Ingresos y Gastos</h2>

      <form onSubmit={handleSubmit} className="mb-6 space-y-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="border p-2 w-full"
        >
          <option value="income">Ingreso</option>
          <option value="expense">Gasto</option>
        </select>

        <input
          type="number"
          placeholder="Cantidad"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="border p-2 w-full"
        />

        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">
          Agregar
        </button>
      </form>

      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={entry.id} className="border p-2 flex justify-between">
            <span>{entry.type === "income" ? "Ingreso" : "Gasto"}</span>
            <span>${entry.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Dashboard;
