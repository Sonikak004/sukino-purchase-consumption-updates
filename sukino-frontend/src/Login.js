// Home.js
import React, { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "./firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import * as XLSX from "xlsx";
import "bootstrap/dist/css/bootstrap.min.css";

/*
  Home.js
  - Upsert purchases into StockEntries (one aggregated doc per branch+item)
  - Upsert consumptions into ConsumptionEntries (one aggregated doc per branch+item)
  - Prevent negative consumption
  - Expiry date must be future-only
  - MOU field added
  - Write history docs: StockEntriesHistory, ConsumptionEntriesHistory
  - Admin-only editing/deleting
  - Export aggregated data to Excel (.xlsx)
  - Greeting: Admin shows name; branchManager shows 'Kitchen Incharge'
*/

export default function Home() {
  const navigate = useNavigate();

  // Auth + role + user info
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState("user"); // raw role from Firestore (admin | branchManager | user)
  const uiRole = role === "branchManager" ? "Kitchen Incharge" : role;

  // Branch / UI state
  const [branch, setBranch] = useState(localStorage.getItem("branch") || "");
  const [tab, setTab] = useState(localStorage.getItem("tab") || "purchase"); // 'purchase' | 'consumption'
  const branches = [
    "Koramangala",
    "BG Road",
    "HSR Layout",
    "Electronic City",
    "Whitefield",
    "Manyata Tech Park",
    "Coimbatore",
    "Cochin",
  ];

  // Aggregated data
  const [purchaseData, setPurchaseData] = useState([]); // StockEntries aggregated docs
  const [consumptionData, setConsumptionData] = useState([]); // ConsumptionEntries aggregated docs

  // Forms
  const [purchaseForm, setPurchaseForm] = useState({
    description: "",
    vendor: "",
    billNo: "",
    billAmount: "",
    qty: "",
    expiryDate: "",
    mou: "",
  });
  const [consumptionForm, setConsumptionForm] = useState({
    description: "",
    consumptionQty: "",
  });

  // Toast
  const [toast, setToast] = useState(null);
  const toastRef = useRef(null);
  useEffect(() => () => clearTimeout(toastRef.current), []);
  const showToast = (msg, ms = 3000) => {
    setToast(msg);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), ms);
  };

  // persist UI choices
  useEffect(() => localStorage.setItem("branch", branch), [branch]);
  useEffect(() => localStorage.setItem("tab", tab), [tab]);

  // --- Auth listener & load user's Firestore doc to get Role + Name
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) {
        navigate("/login");
        return;
      }
      setUser(u);
      try {
        const userRef = doc(db, "Users", u.uid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const data = snap.data();
          setRole(data.Role || "user");
          setUserName(data.Name || u.displayName || "");
          // assign branch for branchManager
          if (data.Branch && data.Role === "branchManager") {
            setBranch(data.Branch);
          } else {
            if (!branch && data.Branch) setBranch(data.Branch);
          }
        } else {
          setRole("user");
          setUserName(u.displayName || "");
        }
      } catch (err) {
        console.error("Failed to read user doc:", err);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // --- Live listeners for aggregated docs by branch
  useEffect(() => {
    if (!branch) {
      setPurchaseData([]);
      setConsumptionData([]);
      return;
    }

    const purchasesQ = query(
      collection(db, "StockEntries"),
      where("branch", "==", branch),
      orderBy("date", "desc")
    );
    const unsubP = onSnapshot(purchasesQ, (snap) => {
      const arr = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          date: data.date?.toDate ? data.date.toDate() : data.date ? new Date(data.date) : null,
        };
      });
      setPurchaseData(arr);
    });

    const consumptionsQ = query(
      collection(db, "ConsumptionEntries"),
      where("branch", "==", branch),
      orderBy("date", "desc")
    );
    const unsubC = onSnapshot(consumptionsQ, (snap) => {
      const arr = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          date: data.date?.toDate ? data.date.toDate() : data.date ? new Date(data.date) : null,
        };
      });
      setConsumptionData(arr);
    });

    return () => {
      unsubP();
      unsubC();
    };
  }, [branch]);

  // ---------- helpers ----------
  const normalize = (s) => (s || "").toString().trim().toLowerCase();

  const getLatestPurchasedTotal = (descRaw) => {
    const desc = normalize(descRaw);
    if (!desc) return 0;
    const matches = purchaseData.filter(
      (p) => normalize(p.description) === desc || (p.descriptionNorm && p.descriptionNorm === desc)
    );
    if (matches.length > 0) {
      // choose the max totalStock
      return matches.reduce((m, p) => Math.max(m, Number(p.totalStock || 0)), 0);
    }
    // fallback (sum qty of matching rows, though aggregated schema expects single-row)
    return purchaseData
      .filter((p) => normalize(p.description) === desc)
      .reduce((s, p) => s + Number(p.qty || 0), 0);
  };

  const getTotalConsumed = (descRaw) => {
    const desc = normalize(descRaw);
    if (!desc) return 0;
    const matches = consumptionData.filter(
      (c) => normalize(c.description) === desc || (c.descriptionNorm && c.descriptionNorm === desc)
    );
    if (matches.length > 0) {
      return matches.reduce((m, c) => Math.max(m, Number(c.totalConsumed || 0)), 0);
    }
    return consumptionData
      .filter((c) => normalize(c.description) === desc)
      .reduce((s, c) => s + Number(c.consumptionQty || 0), 0);
  };

  const getCurrentStock = (descRaw) => {
    const purchased = getLatestPurchasedTotal(descRaw);
    const consumed = getTotalConsumed(descRaw);
    const val = purchased - consumed;
    return val < 0 ? 0 : val;
  };

  const itemNames = useMemo(() => {
    const s = new Set();
    purchaseData.forEach((p) => p.description && s.add(p.description));
    consumptionData.forEach((c) => c.description && s.add(c.description));
    return Array.from(s).sort();
  }, [purchaseData, consumptionData]);

  // Auto old stock for purchase form
  const [autoOldStock, setAutoOldStock] = useState(0);
  useEffect(() => {
    setAutoOldStock(getLatestPurchasedTotal(purchaseForm.description));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseForm.description, purchaseData, consumptionData]);

  const purchaseQtyNum = Number(purchaseForm.qty || 0);
  const purchaseNewStockPreview = autoOldStock + (Number.isFinite(purchaseQtyNum) ? purchaseQtyNum : 0);

  const consumptionQtyNum = Number(consumptionForm.consumptionQty || 0);
  const consumptionAvailable = getCurrentStock(consumptionForm.description);
  const consumptionBalancePreview = consumptionAvailable - consumptionQtyNum;

  // Utility: try indexed lookup by descriptionNorm then fallback to scanning branch docs
  const findOneByItem = async (collectionName, branchName, descNorm) => {
    // try indexed query first
    try {
      const q = query(
        collection(db, collectionName),
        where("branch", "==", branchName),
        where("descriptionNorm", "==", descNorm)
      );
      const s = await getDocs(q);
      if (!s.empty) {
        let best = null;
        s.forEach((docSnap) => {
          const d = docSnap.data();
          const ts = d.date?.toMillis?.() ?? 0;
          if (!best || ts > best._ts) best = { id: docSnap.id, ...d, _ts: ts };
        });
        return best;
      }
    } catch (err) {
      // likely missing composite index; fallback to scanning
      console.warn("Indexed lookup failed (maybe missing index):", err?.message);
    }
    // fallback scan
    const q2 = query(collection(db, collectionName), where("branch", "==", branchName));
    const s2 = await getDocs(q2);
    let best = null;
    s2.forEach((docSnap) => {
      const d = docSnap.data();
      if (normalize(d.description) === descNorm) {
        const ts = d.date?.toMillis?.() ?? 0;
        if (!best || ts > best._ts) best = { id: docSnap.id, ...d, _ts: ts };
      }
    });
    return best;
  };

  // ---------- PURCHASE UPSERT ----------
  const handleAddPurchase = async () => {
    if (!branch) return alert("Please select a branch first");
    if (role === "user") return alert("You are not allowed to add purchases");

    const { description, vendor, billNo, billAmount, qty, expiryDate, mou } = purchaseForm;
    if (!description || !vendor || !billNo || !billAmount || !qty || !mou) {
      return alert("Please fill all required fields (description, vendor, billNo, billAmount, qty, mou).");
    }
    if (isNaN(Number(qty)) || isNaN(Number(billAmount))) {
      return alert("Numeric fields must be numbers");
    }

    // expiry validation: strict future-only
    if (expiryDate) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const exp = new Date(expiryDate);
      const expDay = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
      if (expDay <= today) return alert("Expiry date must be a future date.");
    }

    const descNorm = normalize(description);
    const existing = await findOneByItem("StockEntries", branch, descNorm);
    const prevPurchasedTotal = getLatestPurchasedTotal(description);
    const addQty = Number(qty);
    const newTotalPurchased = prevPurchasedTotal + addQty;

    if (existing) {
      // update aggregated doc
      await updateDoc(doc(db, "StockEntries", existing.id), {
        branch,
        description,
        descriptionNorm: descNorm,
        vendor,
        billNo,
        billAmount: Number(billAmount),
        qty: addQty, // last added qty
        expiryDate: expiryDate || "",
        mou: mou || existing.mou || "",
        oldStock: prevPurchasedTotal,
        totalStock: newTotalPurchased,
        date: serverTimestamp(),
      });

      // write history
      await addDoc(collection(db, "StockEntriesHistory"), {
        branch,
        description,
        descriptionNorm: descNorm,
        vendor,
        billNo,
        billAmount: Number(billAmount),
        qty: addQty,
        expiryDate: expiryDate || "",
        mou: mou || existing.mou || "",
        action: "purchase",
        date: serverTimestamp(),
      });
    } else {
      // create aggregated doc
      await addDoc(collection(db, "StockEntries"), {
        branch,
        description,
        descriptionNorm: descNorm,
        vendor,
        billNo,
        billAmount: Number(billAmount),
        qty: addQty,
        expiryDate: expiryDate || "",
        mou: mou || "",
        oldStock: prevPurchasedTotal,
        totalStock: newTotalPurchased,
        date: serverTimestamp(),
      });

      await addDoc(collection(db, "StockEntriesHistory"), {
        branch,
        description,
        descriptionNorm: descNorm,
        vendor,
        billNo,
        billAmount: Number(billAmount),
        qty: addQty,
        expiryDate: expiryDate || "",
        mou: mou || "",
        action: "purchase",
        date: serverTimestamp(),
      });
    }

    // keep description and mou to speed next entries, reset others
    setPurchaseForm((f) => ({
      ...f,
      vendor: "",
      billNo: "",
      billAmount: "",
      qty: "",
      expiryDate: "",
      // keep mou to reduce typing if same unit used
    }));

    showToast(`Purchase recorded: ${description} +${addQty}`);
  };

  // ---------- CONSUMPTION UPSERT ----------
  const handleAddConsumption = async () => {
    if (!branch) return alert("Please select a branch first");
    if (role === "user") return alert("You are not allowed to add consumption");

    const { description, consumptionQty } = consumptionForm;
    if (!description || !consumptionQty) return alert("Please fill all fields");
    if (isNaN(Number(consumptionQty))) return alert("Consumption quantity must be a number");

    const descNorm = normalize(description);
    const toConsume = Number(consumptionQty);

    const purchasedTotal = getLatestPurchasedTotal(description);
    const consumedTotal = getTotalConsumed(description);
    const available = Math.max(0, purchasedTotal - consumedTotal);

    if (toConsume > available) {
      return alert(`Cannot consume ${toConsume}. Available stock for "${description}" is ${available}.`);
    }

    const existing = await findOneByItem("ConsumptionEntries", branch, descNorm);
    const newTotalConsumed = consumedTotal + toConsume;
    const newBalance = Math.max(0, purchasedTotal - newTotalConsumed);

    if (existing) {
      await updateDoc(doc(db, "ConsumptionEntries", existing.id), {
        branch,
        description,
        descriptionNorm: descNorm,
        consumptionQty: toConsume,
        lastConsumptionQty: toConsume,
        totalConsumed: newTotalConsumed,
        balance: newBalance,
        date: serverTimestamp(),
      });

      await addDoc(collection(db, "ConsumptionEntriesHistory"), {
        branch,
        description,
        descriptionNorm: descNorm,
        consumptionQty: toConsume,
        action: "consume",
        date: serverTimestamp(),
      });
    } else {
      await addDoc(collection(db, "ConsumptionEntries"), {
        branch,
        description,
        descriptionNorm: descNorm,
        consumptionQty: toConsume,
        lastConsumptionQty: toConsume,
        totalConsumed: newTotalConsumed,
        balance: newBalance,
        date: serverTimestamp(),
      });

      await addDoc(collection(db, "ConsumptionEntriesHistory"), {
        branch,
        description,
        descriptionNorm: descNorm,
        consumptionQty: toConsume,
        action: "consume",
        date: serverTimestamp(),
      });
    }

    setConsumptionForm({ description: description, consumptionQty: "" }); // keep description for quick next
    showToast(`Consumed ${toConsume} of ${description}`);
  };

  // ---------- Delete (admin only) ----------
  const handleDeletePurchase = async (id) => {
    if (role !== "admin") return alert("Only admin can delete rows");
    if (!window.confirm("Delete this purchase aggregated row? This cannot be undone.")) return;
    await deleteDoc(doc(db, "StockEntries", id));
    showToast("Purchase row deleted");
  };

  const handleDeleteConsumption = async (id) => {
    if (role !== "admin") return alert("Only admin can delete rows");
    if (!window.confirm("Delete this consumption aggregated row? This cannot be undone.")) return;
    await deleteDoc(doc(db, "ConsumptionEntries", id));
    showToast("Consumption row deleted");
  };

  // ---------- Admin inline edit (admin only) ----------
  const handleInlineEdit = async (collectionName, id, updates) => {
    if (role !== "admin") return alert("Only admin can edit rows");
    await updateDoc(doc(db, collectionName, id), updates);
    showToast("Updated");
  };

  // ---------- Export to Excel (admin only) ----------
  const exportToExcel = () => {
    if (role !== "admin") return alert("Only admin can export");

    // Prepare purchase sheet
    const purchases = purchaseData.map((p) => ({
      Date: p.date ? p.date.toLocaleString() : "",
      Branch: p.branch,
      Item: p.description,
      Vendor: p.vendor,
      BillNo: p.billNo,
      BillAmount: p.billAmount,
      Qty_Last: p.qty,
      MOU: p.mou || "",
      Expiry: p.expiryDate || "",
      OldStock: p.oldStock ?? 0,
      TotalStock: p.totalStock ?? 0,
    }));

    const consumptions = consumptionData.map((c) => ({
      Date: c.date ? c.date.toLocaleString() : "",
      Branch: c.branch,
      Item: c.description,
      LastConsumed: c.consumptionQty ?? c.lastConsumptionQty ?? 0,
      TotalConsumed: c.totalConsumed ?? c.consumptionQty ?? 0,
      Balance: c.balance ?? getCurrentStock(c.description),
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(purchases);
    XLSX.utils.book_append_sheet(wb, ws1, "Purchases");
    const ws2 = XLSX.utils.json_to_sheet(consumptions);
    XLSX.utils.book_append_sheet(wb, ws2, "Consumptions");

    const fileName = `inventory_export_${branch || "all"}_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast("Exported to Excel");
  };

  // ---------- Greeting text ----------
  // Requirements: greet only admin with their name; for branchManager show 'Welcome Kitchen Incharge'
  const greetingText = useMemo(() => {
    if (!user) return "";
    if (role === "admin") return `Welcome, ${userName || "Admin"}`;
    if (role === "branchManager") return "Welcome Kitchen Incharge";
    return "";
  }, [user, role, userName]);

  // ---------- UI rendering ----------
  const canAdd = role === "admin" || role === "branchManager";
  const canEdit = role === "admin";

  return (
    <div className="container py-3">
      <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap">
        <div>
          {greetingText ? <h4 className="mb-0">{greetingText}</h4> : null}
          <div className="text-muted small">{role === "branchManager" ? "Kitchen Incharge" : role}</div>
          <div className="mt-1">
            <small className="text-muted">Branch: {branch || (role === "branchManager" ? "Assigned branch" : "—")}</small>
          </div>
        </div>

        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => { auth.signOut(); }}>
            Logout
          </button>
          {canEdit && (
            <button className="btn btn-success btn-sm" onClick={exportToExcel}>
              Export Excel
            </button>
          )}
        </div>
      </div>

      {/* Branch selector (admins & users except branchManager, who is forced to their assigned branch) */}
      {role !== "branchManager" && (
        <div className="mb-3">
          <label className="form-label">Select Branch</label>
          <select className="form-select" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Select Branch</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      )}

      <div className="mb-3">
        <button className={`btn me-2 ${tab === "purchase" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("purchase")}>Purchase/Stock</button>
        <button className={`${tab === "consumption" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("consumption")}>Consumption</button>
      </div>

      {/* PURCHASE tab */}
      {tab === "purchase" && (
        <div className="mb-5">
          <h5 className="mb-3">Grocery Purchase / Stock</h5>

          {canAdd ? (
            <>
              {/* Purchase form */}
              <div className="card p-3 mb-3">
                <div className="row g-2 align-items-end">
                  <div className="col-12 col-md-3">
                    <label className="form-label small">Item</label>
                    <input list="itemNames" className="form-control" value={purchaseForm.description} onChange={(e) => setPurchaseForm({ ...purchaseForm, description: e.target.value })} />
                    <datalist id="itemNames">{itemNames.map(n => <option key={n} value={n} />)}</datalist>
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Old Stock</label>
                    <input type="number" className="form-control" value={autoOldStock} readOnly disabled />
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Today's Qty</label>
                    <input type="number" className="form-control" value={purchaseForm.qty} onChange={(e) => setPurchaseForm({ ...purchaseForm, qty: e.target.value })} />
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">New Stock Preview</label>
                    <input className="form-control" value={Number.isFinite(purchaseNewStockPreview) ? purchaseNewStockPreview : 0} readOnly disabled />
                  </div>

                  <div className="col-6 col-md-3">
                    <label className="form-label small">Vendor</label>
                    <input className="form-control" value={purchaseForm.vendor} onChange={(e) => setPurchaseForm({ ...purchaseForm, vendor: e.target.value })} />
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Bill No</label>
                    <input className="form-control" value={purchaseForm.billNo} onChange={(e) => setPurchaseForm({ ...purchaseForm, billNo: e.target.value })} />
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Bill Amount</label>
                    <input type="number" className="form-control" value={purchaseForm.billAmount} onChange={(e) => setPurchaseForm({ ...purchaseForm, billAmount: e.target.value })} />
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Expiry</label>
                    <input type="date" className="form-control" value={purchaseForm.expiryDate} onChange={(e) => setPurchaseForm({ ...purchaseForm, expiryDate: e.target.value })} />
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">MOU</label>
                    <input type="text" className="form-control" value={purchaseForm.mou} onChange={(e) => setPurchaseForm({ ...purchaseForm, mou: e.target.value })} placeholder="e.g. Kg, Litre" />
                  </div>

                  <div className="col-12 col-md-2">
                    <button className="btn btn-success w-100" onClick={handleAddPurchase}>Add / Update</button>
                  </div>
                </div>
                <div className="mt-2"><small className="text-muted">New Purchased Total = Old Stock + Today's Qty (upserted to a single aggregated row per item).</small></div>
              </div>
            </>
          ) : (
            <div className="alert alert-info">You can view stock but only Admin can delete or edit aggregated rows.</div>
          )}

          {/* Purchase table */}
          <div className="table-responsive">
            <table className="table table-striped table-bordered align-middle">
              <thead className="table-light">
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Vendor</th>
                  <th>Bill No</th>
                  <th>Bill Amount</th>
                  <th>Qty (last)</th>
                  <th>Expiry</th>
                  <th>MOU</th>
                  <th>Old Stock</th>
                  <th>Total Stock</th>
                  <th>Current Balance</th>
                  {canEdit && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {purchaseData.map((p) => (
                  <tr key={p.id}>
                    <td>{p.date ? p.date.toLocaleDateString() : ""}</td>
                    <td>
                      {canEdit ? (
                        <input className="form-control" defaultValue={p.description} onBlur={(e) => handleInlineEdit("StockEntries", p.id, { description: e.target.value, descriptionNorm: normalize(e.target.value) })} />
                      ) : p.description}
                    </td>
                    <td>{canEdit ? <input className="form-control" defaultValue={p.vendor} onBlur={(e) => handleInlineEdit("StockEntries", p.id, { vendor: e.target.value })} /> : p.vendor}</td>
                    <td>{canEdit ? <input className="form-control" defaultValue={p.billNo} onBlur={(e) => handleInlineEdit("StockEntries", p.id, { billNo: e.target.value })} /> : p.billNo}</td>
                    <td>{canEdit ? <input className="form-control" type="number" defaultValue={p.billAmount} onBlur={(e) => handleInlineEdit("StockEntries", p.id, { billAmount: Number(e.target.value) })} /> : p.billAmount}</td>
                    <td>{canEdit ? <input className="form-control" type="number" defaultValue={p.qty} onBlur={(e) => handleInlineEdit("StockEntries", p.id, { qty: Number(e.target.value) })} /> : p.qty}</td>
                    <td>{canEdit ? <input className="form-control" type="date" defaultValue={p.expiryDate} onBlur={(e) => handleInlineEdit("StockEntries", p.id, { expiryDate: e.target.value })} /> : p.expiryDate}</td>
                    <td>{canEdit ? <input className="form-control" defaultValue={p.mou || ""} onBlur={(e) => handleInlineEdit("StockEntries", p.id, { mou: e.target.value })} /> : (p.mou || "")}</td>
                    <td>{p.oldStock}</td>
                    <td>{p.totalStock}</td>
                    <td>{getCurrentStock(p.description)}</td>
                    {canEdit && <td><button className="btn btn-sm btn-danger" onClick={() => handleDeletePurchase(p.id)}>Delete</button></td>}
                  </tr>
                ))}
                {purchaseData.length === 0 && (
                  <tr><td colSpan={canEdit ? 12 : 11} className="text-center text-muted">No purchases yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CONSUMPTION tab */}
      {tab === "consumption" && (
        <div className="mb-5">
          <h5 className="mb-3">Daily Consumption</h5>

          {canAdd ? (
            <>
              <div className="card p-3 mb-3">
                <div className="row g-2 align-items-end">
                  <div className="col-12 col-md-4">
                    <label className="form-label small">Item</label>
                    <input list="itemNames2" className="form-control" value={consumptionForm.description} onChange={(e) => setConsumptionForm({ ...consumptionForm, description: e.target.value })} />
                    <datalist id="itemNames2">{itemNames.map(n => <option key={n} value={n} />)}</datalist>
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Available</label>
                    <input className="form-control" value={getCurrentStock(consumptionForm.description)} readOnly disabled />
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Consumption Qty</label>
                    <input type="number" className="form-control" value={consumptionForm.consumptionQty} onChange={(e) => setConsumptionForm({ ...consumptionForm, consumptionQty: e.target.value })} />
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Balance Preview</label>
                    <input className="form-control" value={Number.isFinite(consumptionBalancePreview) ? consumptionBalancePreview : 0} readOnly disabled />
                  </div>

                  <div className="col-12 col-md-2">
                    <button className="btn btn-success w-100" onClick={handleAddConsumption}>Add / Update</button>
                  </div>
                </div>
                <div className="mt-2"><small className="text-muted">Total Consumed accumulates per item; balance = latest purchased total − total consumed.</small></div>
              </div>
            </>
          ) : (
            <div className="alert alert-info">You can view consumption but only Admin can delete or edit aggregated rows.</div>
          )}

          {/* Consumption table */}
          <div className="table-responsive">
            <table className="table table-striped table-bordered align-middle">
              <thead className="table-light">
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Last Consumed</th>
                  <th>Total Consumed</th>
                  <th>Balance</th>
                  <th>Current Balance</th>
                  {canEdit && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {consumptionData.map((c) => (
                  <tr key={c.id}>
                    <td>{c.date ? c.date.toLocaleDateString() : ""}</td>
                    <td>{canEdit ? <input className="form-control" defaultValue={c.description} onBlur={(e) => handleInlineEdit("ConsumptionEntries", c.id, { description: e.target.value, descriptionNorm: normalize(e.target.value) })} /> : c.description}</td>
                    <td>{canEdit ? <input className="form-control" type="number" defaultValue={c.consumptionQty ?? c.lastConsumptionQty ?? 0} onBlur={(e) => handleInlineEdit("ConsumptionEntries", c.id, { consumptionQty: Number(e.target.value), lastConsumptionQty: Number(e.target.value) })} /> : (c.consumptionQty ?? c.lastConsumptionQty ?? 0)}</td>
                    <td>{c.totalConsumed ?? c.consumptionQty ?? 0}</td>
                    <td>{typeof c.balance === "number" ? c.balance : getCurrentStock(c.description)}</td>
                    <td>{getCurrentStock(c.description)}</td>
                    {canEdit && <td><button className="btn btn-sm btn-danger" onClick={() => handleDeleteConsumption(c.id)}>Delete</button></td>}
                  </tr>
                ))}
                {consumptionData.length === 0 && (
                  <tr><td colSpan={canEdit ? 7 : 6} className="text-center text-muted">No consumption yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Branch not selected */}
      {!branch && (
        <div className="alert alert-info">
          {role === "branchManager"
            ? "Your branch is not set. Ask admin to assign a Branch in Users collection."
            : "Please select a branch to view records."}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 9999 }}>
          <div className="toast show" style={{ minWidth: 200 }}>
            <div className="toast-body">{toast}</div>
          </div>
        </div>
      )}
    </div>
  );
}
