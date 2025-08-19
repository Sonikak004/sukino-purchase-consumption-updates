// Home.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { auth, db } from "./firebase";
import { useNavigate } from "react-router-dom";
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
  writeBatch,
} from "firebase/firestore";
import "bootstrap/dist/css/bootstrap.min.css";

function Home() {
  const navigate = useNavigate();

  // ---------- AUTH & USER ----------
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState("");
  const [roleFromDb, setRoleFromDb] = useState("user");
  const uiRole = roleFromDb === "branchManager" ? "Kitchen Incharge" : roleFromDb;

  // ---------- UI STATE ----------
  const [branch, setBranch] = useState(localStorage.getItem("branch") || "");
  const [tab, setTab] = useState(localStorage.getItem("tab") || "purchase");
  const [branches] = useState([
    "Koramangala",
    "BG Road",
    "HSR Layout",
    "Electronic City",
    "Whitefield",
    "Manyata Tech Park",
    "Coimbatore",
    "Cochin",
  ]);

  // ---------- DATA ----------
  const [purchaseData, setPurchaseData] = useState([]);
  const [consumptionData, setConsumptionData] = useState([]);

  // Form states
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

  // Dropdown helpers
  const [addingNewItemPurchase, setAddingNewItemPurchase] = useState(false);
  const [addingNewItemConsumption, setAddingNewItemConsumption] = useState(false);
  const MOU_OPTIONS = ["kg", "ml", "ltr", "grams", "packs"];

  // Toast / messages
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  useEffect(() => {
    return () => clearTimeout(toastTimerRef.current);
  }, []);

  const showToast = (msg, ms = 3500) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  };

  // Persist UI preferences
  useEffect(() => localStorage.setItem("branch", branch), [branch]);
  useEffect(() => localStorage.setItem("tab", tab), [tab]);

  // ---------- AUTH LISTENER ----------
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        navigate("/login");
        return;
      }
      setUser(currentUser);

      // Fetch user doc to get role and display name
      try {
        const userRef = doc(db, "Users", currentUser.uid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const data = snap.data();
          setUserName(data.Name || currentUser.email);
          setRoleFromDb(data.Role || "user");
          if (data.Branch) {
            if (data.Role === "branchManager") {
              setBranch(data.Branch);
            } else {
              if (!branch) setBranch(data.Branch);
            }
          }
        } else {
          setUserName(currentUser.email);
          setRoleFromDb("user");
        }
      } catch (err) {
        console.error("Failed to read user doc:", err);
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // ---------- FIRESTORE LIVE LISTENERS ----------
  useEffect(() => {
    if (!branch) {
      setPurchaseData([]);
      setConsumptionData([]);
      return;
    }

    // purchase aggregated rows (StockEntries)
    const purchaseQ = query(
      collection(db, "StockEntries"),
      where("branch", "==", branch),
      orderBy("date", "desc")
    );
    const unsubscribePurchases = onSnapshot(purchaseQ, (snap) => {
      const arr = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          date:
            data.date && data.date.toDate ? data.date.toDate() : data.date ? new Date(data.date) : null,
        };
      });
      setPurchaseData(arr);
    });

    // consumption aggregated rows (ConsumptionEntries)
    const consumptionQ = query(
      collection(db, "ConsumptionEntries"),
      where("branch", "==", branch),
      orderBy("date", "desc")
    );
    const unsubscribeConsumption = onSnapshot(consumptionQ, (snap) => {
      const arr = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          date:
            data.date && data.date.toDate ? data.date.toDate() : data.date ? new Date(data.date) : null,
        };
      });
      setConsumptionData(arr);
    });

    return () => {
      unsubscribePurchases();
      unsubscribeConsumption();
    };
  }, [branch]);

  // ---------- HELPERS ----------
  const normalize = (s) => (s || "").toString().trim().toLowerCase();

  // Get the latest purchased total for an item
  const getLatestPurchasedTotal = (descRaw) => {
    const desc = normalize(descRaw);
    if (!desc) return 0;
    const matches = purchaseData.filter(
      (p) => normalize(p.description) === desc || (p.descriptionNorm && p.descriptionNorm === desc)
    );
    if (matches.length > 0) {
      return matches.reduce((m, p) => Math.max(m, Number(p.totalStock || 0)), 0);
    }
    return purchaseData
      .filter((p) => normalize(p.description) === desc)
      .reduce((s, p) => s + Number(p.qty || 0), 0);
  };

  // Get total consumed for an item
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

  // Current net available (purchased - consumed)
  const getCurrentStock = (descRaw) => {
    const purchasedTotal = getLatestPurchasedTotal(descRaw);
    const totalConsumed = getTotalConsumed(descRaw);
    const bal = purchasedTotal - totalConsumed;
    return bal < 0 ? 0 : bal;
  };

  // Build itemNames for dropdowns
  const itemNames = useMemo(() => {
    const setNames = new Set();
    purchaseData.forEach((p) => p.description && setNames.add(p.description));
    consumptionData.forEach((c) => c.description && setNames.add(c.description));
    return Array.from(setNames).sort();
  }, [purchaseData, consumptionData]);

  // Auto old stock for purchase form (only for preview in the entry form)
  const [autoOldStock, setAutoOldStock] = useState(0);
  useEffect(() => {
    setAutoOldStock(getLatestPurchasedTotal(purchaseForm.description));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseForm.description, purchaseData, consumptionData]);

  const purchaseQtyNum = Number(purchaseForm.qty || 0);
  const purchaseNewStockPreview = autoOldStock + purchaseQtyNum;

  const consumptionQtyNum = Number(consumptionForm.consumptionQty || 0);
  const consumptionAvailable = getCurrentStock(consumptionForm.description);
  const consumptionBalancePreview = consumptionAvailable - consumptionQtyNum;

  // Utility to find aggregated doc by branch + normalized description
  const findOneByItem = async (collectionName, branchName, descNorm) => {
    try {
      const q = query(
        collection(db, collectionName),
        where("branch", "==", branchName),
        where("descriptionNorm", "==", descNorm)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        let best = null;
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          const ts = d.date?.toMillis?.() ?? 0;
          if (!best || ts > best._ts) best = { id: docSnap.id, ...d, _ts: ts };
        });
        return best;
      }
    } catch (err) {
      console.warn("Indexed lookup failed:", err?.message);
    }

    // Fallback
    const q2 = query(collection(db, collectionName), where("branch", "==", branchName));
    const snap2 = await getDocs(q2);
    let best = null;
    snap2.forEach((docSnap) => {
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
    if (roleFromDb === "user") return alert("You are not allowed to add purchases");

    const { description, vendor, billNo, billAmount, qty, expiryDate, mou } = purchaseForm;
    if (!branch) return alert("Please select a branch first");
    if (!description || !vendor || !billNo || !billAmount || !qty || !mou) {
      return alert("Please fill all required fields (including MOU).");
    }
    if (isNaN(Number(qty)) || isNaN(Number(billAmount))) return alert("Numeric fields must be numbers");

    // expiry validation
    if (expiryDate) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const exp = new Date(expiryDate);
      const expDay = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
      if (expDay <= today) return alert("Expiry date must be a future date.");
    }

    const descNorm = normalize(description);

    // find existing aggregated doc in StockEntries
    const existing = await findOneByItem("StockEntries", branch, descNorm);

    // compute prevPurchasedTotal
    const prevPurchasedTotal = getLatestPurchasedTotal(description);
    const addQty = Number(qty);
    const newTotalPurchased = prevPurchasedTotal + addQty;

    // Upsert aggregated doc
    if (existing) {
      await updateDoc(doc(db, "StockEntries", existing.id), {
        branch,
        description,
        descriptionNorm: descNorm,
        vendor,
        billNo,
        billAmount: Number(billAmount),
        qty: addQty,
        expiryDate: expiryDate || "",
        mou: mou || existing.mou || "",
        oldStock: prevPurchasedTotal,
        totalStock: newTotalPurchased,
        date: serverTimestamp(),
      });

      // history record of bill
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

    // reset fields but keep description to speed up repeated entries
    setPurchaseForm((f) => ({
      ...f,
      vendor: "",
      billNo: "",
      billAmount: "",
      qty: "",
      expiryDate: "",
      // keep MOU
    }));

    setAddingNewItemPurchase(false);
    showToast(`Purchase recorded for ${description}`);
  };

  // ---------- CONSUMPTION UPSERT ----------
  const handleAddConsumption = async () => {
    if (roleFromDb === "user") return alert("You are not allowed to add consumption");

    const { description, consumptionQty } = consumptionForm;
    if (!branch) return alert("Please select a branch first");
    if (!description || !consumptionQty) return alert("Please fill all fields");

    if (isNaN(Number(consumptionQty))) return alert("Consumption quantity must be a number");

    const descNorm = normalize(description);
    const toConsume = Number(consumptionQty);

    // current totals
    const purchasedTotal = getLatestPurchasedTotal(description);
    const consumedTotal = getTotalConsumed(description);
    const available = Math.max(0, purchasedTotal - consumedTotal);

    if (toConsume > available) {
      return alert(`Cannot consume ${toConsume}. Available stock for "${description}" is ${available}.`);
    }

    // find existing aggregated doc in ConsumptionEntries
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

    setConsumptionForm({ description: description, consumptionQty: "" });
    setAddingNewItemConsumption(false);
    showToast(`Consumed ${toConsume} of ${description}`);
  };

  // ---------- DELETE (admin only) ----------
  const handleDeletePurchase = async (id) => {
    if (roleFromDb !== "admin") return alert("Only admin can delete rows");
    if (!window.confirm("Delete this aggregated purchase row? This cannot be undone.")) return;
    await deleteDoc(doc(db, "StockEntries", id));
    showToast("Purchase row deleted");
  };

  const handleDeleteConsumption = async (id) => {
    if (roleFromDb !== "admin") return alert("Only admin can delete rows");
    if (!window.confirm("Delete this aggregated consumption row? This cannot be undone.")) return;
    await deleteDoc(doc(db, "ConsumptionEntries", id));
    showToast("Consumption row deleted");
  };

  // ---------- SIMPLE EDIT MODAL (admin only) ----------
  const [editModal, setEditModal] = useState({ open: false, type: null, row: null });
  const [editForm, setEditForm] = useState({
    vendor: "",
    billNo: "",
    billAmount: "",
    expiryDate: "",
    mou: "",
  });

  const openEditPurchase = (row) => {
    setEditForm({
      vendor: row.vendor || "",
      billNo: row.billNo || "",
      billAmount: row.billAmount || "",
      expiryDate: row.expiryDate || "",
      mou: row.mou || "",
    });
    setEditModal({ open: true, type: "purchase", row });
  };

  const openEditConsumption = (row) => {
    // Minimal editable fields for consumption (keep totals safe)
    setEditForm({
      // allow editing only lastConsumptionQty for a quick fix
      vendor: "",
      billNo: "",
      billAmount: "",
      expiryDate: "",
      mou: "",
      lastConsumptionQty: row.lastConsumptionQty ?? row.consumptionQty ?? "",
    });
    setEditModal({ open: true, type: "consumption", row });
  };

  const saveEdit = async () => {
    if (roleFromDb !== "admin" || !editModal.open || !editModal.row) return;
    try {
      if (editModal.type === "purchase") {
        const ref = doc(db, "StockEntries", editModal.row.id);
        await updateDoc(ref, {
          vendor: editForm.vendor || "",
          billNo: editForm.billNo || "",
          billAmount: Number(editForm.billAmount || 0),
          expiryDate: editForm.expiryDate || "",
          mou: editForm.mou || "",
          date: serverTimestamp(),
        });
        showToast("Purchase row updated");
      } else if (editModal.type === "consumption") {
        const ref = doc(db, "ConsumptionEntries", editModal.row.id);
        const lastQtyNum = Number(editForm.lastConsumptionQty || 0);
        // Update only the lastConsumptionQty / consumptionQty, adjust balance consistently with current purchased total
        const purchasedTotal = getLatestPurchasedTotal(editModal.row.description);
        // Recompute consumed total by replacing this row's last qty with new one
        // We don't have per-item breakdown here, so we safest update current doc's fields
        const newTotalConsumed = Math.max(
          Number(editModal.row.totalConsumed || lastQtyNum), // fallback to existing total
          lastQtyNum // if they only track last qty, at least keep consistent
        );
        const newBalance = Math.max(0, purchasedTotal - newTotalConsumed);

        await updateDoc(ref, {
          consumptionQty: lastQtyNum,
          lastConsumptionQty: lastQtyNum,
          totalConsumed: newTotalConsumed,
          balance: newBalance,
          date: serverTimestamp(),
        });
        showToast("Consumption row updated");
      }
    } catch (e) {
      console.error("Edit save failed", e);
      showToast("Failed to save changes");
    } finally {
      setEditModal({ open: false, type: null, row: null });
    }
  };

  // ---------- LOGOUT FUNCTION ----------
  const handleLogout = async () => {
    try {
      await auth.signOut();
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
      showToast("Failed to logout. Please try again.");
    }
  };

  // ---------- EXPORTS ----------
  const exportCSV = (type = "all") => {
    let rows = [];
    if (type === "purchase" || type === "all") {
      rows.push(["PURCHASES"]);
      rows.push(["Date", "Item", "Vendor", "BillNo", "BillAmount", "Qty", "Expiry", "OldStock", "TotalStock (Closing)", "Branch"]);
      purchaseData.forEach((p) =>
        rows.push([
          p.date ? p.date.toLocaleString() : "",
          p.description,
          p.vendor,
          p.billNo,
          p.billAmount,
          p.qty,
          p.expiryDate,
          p.oldStock,
          p.totalStock,
          p.branch,
        ])
      );
      rows.push([]);
    }
    if (type === "consumption" || type === "all") {
      rows.push(["CONSUMPTIONS"]);
      rows.push(["Date", "Item", "LastConsumed", "TotalConsumed", "Balance", "Branch"]);
      consumptionData.forEach((c) =>
        rows.push([
          c.date ? c.date.toLocaleString() : "",
          c.description,
          c.consumptionQty ?? c.lastConsumptionQty ?? "",
          c.totalConsumed ?? c.consumptionQty ?? "",
          c.balance ?? "",
          c.branch,
        ])
      );
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/\"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory_export_${type}_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Export initiated");
  };

  // ---------- MIGRATION: optional one-time merge duplicates ----------
  async function mergeDuplicatesForCollection(collectionName) {
    if (!window.confirm(`Run merge duplicates on ${collectionName} for branch "${branch}"? This is irreversible.`)) return;
    if (!branch) return alert("Choose a branch first");

    const q = query(collection(db, collectionName), where("branch", "==", branch));
    const snap = await getDocs(q);
    const map = new Map();
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const norm = normalize(d.description);
      if (!map.has(norm)) map.set(norm, []);
      map.get(norm).push({ id: docSnap.id, ...d });
    });

    const batch = writeBatch(db);
    for (const [norm, docs] of map) {
      if (docs.length <= 1) continue;
      if (collectionName === "StockEntries") {
        let totalStock = docs.reduce((m, d) => Math.max(m, Number(d.totalStock || 0)), 0);
        let last = docs.reduce((best, d) => {
          const ts = d.date?.toMillis?.() ?? 0;
          if (!best || ts > best._ts) return { ...d, _ts: ts };
          return best;
        }, null);
        await addDoc(collection(db, "StockEntries"), {
          branch,
          description: last.description,
          descriptionNorm: norm,
          vendor: last.vendor,
          billNo: last.billNo,
          billAmount: Number(last.billAmount || 0),
          qty: Number(last.qty || 0),
          expiryDate: last.expiryDate || "",
          mou: last.mou || "",
          oldStock: Number(last.oldStock || 0),
          totalStock,
          date: serverTimestamp(),
        });
        for (const d of docs) {
          await addDoc(collection(db, "StockEntriesHistory"), { ...d, movedAt: serverTimestamp(), action: "merged" });
          await deleteDoc(doc(db, "StockEntries", d.id));
        }
      } else if (collectionName === "ConsumptionEntries") {
        let totalConsumed = docs.reduce((m, d) => Math.max(m, Number(d.totalConsumed || 0)), 0);
        let last = docs.reduce((best, d) => {
          const ts = d.date?.toMillis?.() ?? 0;
          if (!best || ts > best._ts) return { ...d, _ts: ts };
          return best;
        }, null);
        await addDoc(collection(db, "ConsumptionEntries"), {
          branch,
          description: last.description,
          descriptionNorm: norm,
          consumptionQty: Number(last.consumptionQty || 0),
          lastConsumptionQty: Number(last.lastConsumptionQty || 0),
          totalConsumed,
          balance: Number(last.balance || 0),
          date: serverTimestamp(),
        });
        for (const d of docs) {
          await addDoc(collection(db, "ConsumptionEntriesHistory"), { ...d, movedAt: serverTimestamp(), action: "merged" });
          await deleteDoc(doc(db, "ConsumptionEntries", d.id));
        }
      }
    }
    showToast("Merge completed (manual verification recommended)");
  }

  // ---------- UI helpers ----------
  const canEdit = roleFromDb === "admin";
  const canAdd = roleFromDb === "admin" || roleFromDb === "branchManager";

  // ---------- Render ----------
  return (
    <div className="container py-3">
      {/* Top bar */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div>
          <h4 className="mb-0">Inventory — Welcome, {userName} ({uiRole})</h4>
          <small className="text-muted d-block">Branch: {branch || "—"}</small>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => exportCSV("all")}>Export CSV</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => exportCSV("purchase")}>Export Purchases</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => exportCSV("consumption")}>Export Consumptions</button>
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* Branch selector (only for admin or non-branchManager) */}
      {roleFromDb !== "branchManager" && (
        <div className="mb-3">
          <label className="form-label">Select Branch:</label>
          <select className="form-select" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Select Branch</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-3 d-flex gap-2">
        <button className={`btn ${tab === "purchase" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("purchase")}>Purchase/Stock</button>
        <button className={`btn ${tab === "consumption" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("consumption")}>Consumption</button>
      </div>

      {/* PURCHASE tab */}
      {tab === "purchase" && (
        <div className="mb-5">
          <h5>Grocery Purchase / Stock</h5>

          {canAdd ? (
            <>
              {/* Purchase Form */}
              <div className="card mb-3 p-3">
                <div className="row g-2 align-items-end">
                  <div className="col-12 col-md-4">
                    <label className="form-label small">Item</label>

                    {!addingNewItemPurchase ? (
                      <div className="d-flex gap-2">
                        <select
                          className="form-select"
                          value={purchaseForm.description}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__ADD_NEW__") {
                              setAddingNewItemPurchase(true);
                              setPurchaseForm({ ...purchaseForm, description: "" });
                            } else {
                              setPurchaseForm({ ...purchaseForm, description: v });
                            }
                          }}
                        >
                          <option value="">Select Item</option>
                          {itemNames.map((n) => <option key={n} value={n}>{n}</option>)}
                          <option value="__ADD_NEW__">+ Add new item…</option>
                        </select>
                      </div>
                    ) : (
                      <div className="d-flex gap-2">
                        <input
                          className="form-control"
                          placeholder="Type new item name"
                          value={purchaseForm.description}
                          onChange={(e) => setPurchaseForm({ ...purchaseForm, description: e.target.value })}
                        />
                        <button className="btn btn-outline-secondary" onClick={() => setAddingNewItemPurchase(false)}>Done</button>
                      </div>
                    )}
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Old Stock (auto)</label>
                    <input className="form-control" value={autoOldStock} readOnly disabled />
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
                    <select
                      className="form-select"
                      value={purchaseForm.mou}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, mou: e.target.value })}
                    >
                      <option value="">Select</option>
                      {MOU_OPTIONS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div className="col-12 col-md-2">
                    <button className="btn btn-success w-100" onClick={handleAddPurchase}>Add / Update</button>
                  </div>
                </div>
              </div>

            </>
          ) : (
            <div className="alert alert-info">You ({uiRole}) can view stock and add purchases/consumption but cannot delete or edit aggregated rows. Only Admin can delete.</div>
          )}

          {/* Purchase table */}
          <div className="table-responsive">
            <table className="table table-striped table-bordered align-middle table-sm">
              <thead className="table-light">
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th className="d-none d-sm-table-cell">Vendor</th>
                  <th className="d-none d-md-table-cell">Bill No</th>
                  <th className="d-none d-md-table-cell">Bill Amount</th>
                  <th>Qty</th>
                  <th className="d-none d-md-table-cell">Expiry</th>
                  <th className="d-none d-sm-table-cell">MOU</th>
                  {/* Removed Old Stock from display */}
                  <th>Closing Stock</th>
                  <th className="d-none d-lg-table-cell">Current Balance</th>
                  {canEdit && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {purchaseData.map((p) => (
                  <tr key={p.id}>
                    <td>{p.date ? p.date.toLocaleDateString() : ""}</td>
                    <td>{p.description}</td>
                    <td className="d-none d-sm-table-cell">{p.vendor}</td>
                    <td className="d-none d-md-table-cell">{p.billNo}</td>
                    <td className="d-none d-md-table-cell">{p.billAmount}</td>
                    <td>{p.qty}</td>
                    <td className="d-none d-md-table-cell">{p.expiryDate}</td>
                    <td className="d-none d-sm-table-cell">{p.mou || ""}</td>
                    <td>{p.totalStock}</td>
                    <td className="d-none d-lg-table-cell">{getCurrentStock(p.description)}</td>
                    {canEdit && (
                      <td className="text-nowrap">
                        <button className="btn btn-sm btn-warning me-1" onClick={() => openEditPurchase(p)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeletePurchase(p.id)}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
                {purchaseData.length === 0 && (
                  <tr><td colSpan={canEdit ? 11 : 10} className="text-center text-muted">No purchases yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CONSUMPTION tab */}
      {tab === "consumption" && (
        <div className="mb-5">
          <h5>Daily Consumption</h5>

          {canAdd ? (
            <>
              <div className="card mb-3 p-3">
                <div className="row g-2 align-items-end">
                  <div className="col-12 col-md-5">
                    <label className="form-label small">Item</label>
                    {!addingNewItemConsumption ? (
                      <div className="d-flex gap-2">
                        <select
                          className="form-select"
                          value={consumptionForm.description}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__ADD_NEW__") {
                              setAddingNewItemConsumption(true);
                              setConsumptionForm({ ...consumptionForm, description: "" });
                            } else {
                              setConsumptionForm({ ...consumptionForm, description: v });
                            }
                          }}
                        >
                          <option value="">Select Item</option>
                          {itemNames.map((n) => <option key={n} value={n}>{n}</option>)}
                          <option value="__ADD_NEW__">+ Add new item…</option>
                        </select>
                      </div>
                    ) : (
                      <div className="d-flex gap-2">
                        <input
                          className="form-control"
                          placeholder="Type new item name"
                          value={consumptionForm.description}
                          onChange={(e) => setConsumptionForm({ ...consumptionForm, description: e.target.value })}
                        />
                        <button className="btn btn-outline-secondary" onClick={() => setAddingNewItemConsumption(false)}>Done</button>
                      </div>
                    )}
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

                  <div className="col-12 col-md-1">
                    <button className="btn btn-success w-100" onClick={handleAddConsumption}>Add</button>
                  </div>
                </div>

                <div className="mt-2">
                  <small className="text-muted">Total Consumed accumulates per item; balance = latest purchased total − total consumed.</small>
                </div>
              </div>

              {/* Quick tally hint */}
              {consumptionForm.description && (
                <div className="alert alert-secondary py-2">
                  <strong>{consumptionForm.description}</strong> — Purchased (cum): {getLatestPurchasedTotal(consumptionForm.description)} | Consumed (cum): {getTotalConsumed(consumptionForm.description)} | Net Available: {getCurrentStock(consumptionForm.description)}
                </div>
              )}
            </>
          ) : (
            <div className="alert alert-info">You ({uiRole}) can view consumption and add entries but cannot delete aggregated rows. Only Admin can delete.</div>
          )}

          {/* Consumption table */}
          <div className="table-responsive">
            <table className="table table-striped table-bordered align-middle table-sm">
              <thead className="table-light">
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Last Consumed</th>
                  <th>Total Consumed</th>
                  <th>Balance</th>
                  <th className="d-none d-md-table-cell">Current Balance</th>
                  {canEdit && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {consumptionData.map((c) => (
                  <tr key={c.id}>
                    <td>{c.date ? c.date.toLocaleDateString() : ""}</td>
                    <td>{c.description}</td>
                    <td>{c.consumptionQty ?? c.lastConsumptionQty ?? ""}</td>
                    <td>{typeof c.totalConsumed === "number" ? c.totalConsumed : (c.consumptionQty || 0)}</td>
                    <td>{typeof c.balance === "number" ? c.balance : getCurrentStock(c.description)}</td>
                    <td className="d-none d-md-table-cell">{getCurrentStock(c.description)}</td>
                    {canEdit && (
                      <td className="text-nowrap">
                        <button className="btn btn-sm btn-warning me-1" onClick={() => openEditConsumption(c)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeleteConsumption(c.id)}>Delete</button>
                      </td>
                    )}
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

      {/* Branch not selected message */}
      {!branch && (
        <div className="alert alert-info">
          {roleFromDb === "branchManager"
            ? "Your branch is not set. Ask admin to assign a Branch in Users collection."
            : "Please select a branch to view records."}
        </div>
      )}

      {/* Small migration / admin tools (visible only to admin) */}
      {roleFromDb === "admin" && (
        <div className="card mt-4 p-3">
          <h6>Admin Tools</h6>
          <div className="d-flex gap-2 flex-wrap">
            <button className="btn btn-outline-primary btn-sm" onClick={() => mergeDuplicatesForCollection("StockEntries")}>Merge duplicate StockEntries (manual)</button>
            <button className="btn btn-outline-primary btn-sm" onClick={() => mergeDuplicatesForCollection("ConsumptionEntries")}>Merge duplicate ConsumptionEntries (manual)</button>
            <button className="btn btn-outline-secondary btn-sm" onClick={() => exportCSV("all")}>Export All CSV</button>
          </div>
          <small className="text-muted d-block mt-2">Note: Merge is an advanced operation — run only if you have duplicate aggregated docs created earlier.</small>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 9999 }}>
          <div className="toast show" style={{ minWidth: 250 }}>
            <div className="toast-body">{toast}</div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editModal.open && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100"
          style={{ background: "rgba(0,0,0,0.35)", zIndex: 1050 }}
          onClick={() => setEditModal({ open: false, type: null, row: null })}
        >
          <div
            className="card shadow p-3"
            style={{ maxWidth: 520, width: "92%", margin: "10vh auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="mb-0">
                Edit {editModal.type === "purchase" ? "Purchase" : "Consumption"}
              </h6>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditModal({ open: false, type: null, row: null })}>
                Close
              </button>
            </div>

            {editModal.type === "purchase" && (
              <div className="row g-2">
                <div className="col-12">
                  <label className="form-label small">Item</label>
                  <input className="form-control" value={editModal.row.description} readOnly />
                </div>
                <div className="col-6">
                  <label className="form-label small">Vendor</label>
                  <input className="form-control" value={editForm.vendor} onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small">Bill No</label>
                  <input className="form-control" value={editForm.billNo} onChange={(e) => setEditForm({ ...editForm, billNo: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small">Bill Amount</label>
                  <input type="number" className="form-control" value={editForm.billAmount} onChange={(e) => setEditForm({ ...editForm, billAmount: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small">Expiry</label>
                  <input type="date" className="form-control" value={editForm.expiryDate} onChange={(e) => setEditForm({ ...editForm, expiryDate: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small">MOU</label>
                  <select className="form-select" value={editForm.mou} onChange={(e) => setEditForm({ ...editForm, mou: e.target.value })}>
                    <option value="">Select</option>
                    {MOU_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="col-12 d-flex justify-content-end gap-2 mt-2">
                  <button className="btn btn-secondary" onClick={() => setEditModal({ open: false, type: null, row: null })}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveEdit}>Save</button>
                </div>
              </div>
            )}

            {editModal.type === "consumption" && (
              <div className="row g-2">
                <div className="col-12">
                  <label className="form-label small">Item</label>
                  <input className="form-control" value={editModal.row.description} readOnly />
                </div>
                <div className="col-6">
                  <label className="form-label small">Last Consumed</label>
                  <input
                    type="number"
                    className="form-control"
                    value={editForm.lastConsumptionQty ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, lastConsumptionQty: e.target.value })}
                  />
                </div>
                <div className="col-12 d-flex justify-content-end gap-2 mt-2">
                  <button className="btn btn-secondary" onClick={() => setEditModal({ open: false, type: null, row: null })}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveEdit}>Save</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;
