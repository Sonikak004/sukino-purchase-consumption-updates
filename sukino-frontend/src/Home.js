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

/*
  Full Home component:
  - Single-row-per-(branch+item) upsert for StockEntries (purchases)
  - Single-row-per-(branch+item) upsert for ConsumptionEntries
  - Prevent negative consumption (cannot consume more than available)
  - Expiry date validation (must be future)
  - MOU field added to purchases and aggregated docs
  - Role mapping: 'branchManager' in Firestore shown as 'Kitchen Incharge' in UI
  - Only 'admin' can edit/delete aggregated docs
  - Writes history entries to StockEntriesHistory and ConsumptionEntriesHistory
  - Includes helper migration/merge function (commented / manual)
  - Extra small utilities: CSV export, toast messages
*/

function Home() {
  const navigate = useNavigate();

  // ---------- AUTH & USER ----------
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState("");
  // roleFromDb: the raw role stored in Firestore (admin | branchManager | user | etc)
  const [roleFromDb, setRoleFromDb] = useState("user");
  // uiRole: the role to display in UI ('Kitchen Incharge' for branchManager)
  const uiRole = roleFromDb === "branchManager" ? "Kitchen Incharge" : roleFromDb;

  // ---------- UI STATE ----------
  const [branch, setBranch] = useState(localStorage.getItem("branch") || "");
  const [tab, setTab] = useState(localStorage.getItem("tab") || "purchase"); // purchase | consumption
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
  // Aggregated single-row docs (StockEntries = purchases aggregated; ConsumptionEntries = consumption aggregated)
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
            // assign branch for branchManagers by default
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

  // Get the latest purchased total for an item (prefer aggregated totalStock)
  const getLatestPurchasedTotal = (descRaw) => {
    const desc = normalize(descRaw);
    if (!desc) return 0;
    const matches = purchaseData.filter(
      (p) => normalize(p.description) === desc || (p.descriptionNorm && p.descriptionNorm === desc)
    );
    if (matches.length > 0) {
      // pick max totalStock for safety
      return matches.reduce((m, p) => Math.max(m, Number(p.totalStock || 0)), 0);
    }
    // fallback to sum of qty across un-aggregated rows (if any exist in purchaseData)
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
    // fallback
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

  // Build itemNames for datalist
  const itemNames = useMemo(() => {
    const setNames = new Set();
    purchaseData.forEach((p) => p.description && setNames.add(p.description));
    consumptionData.forEach((c) => c.description && setNames.add(c.description));
    return Array.from(setNames).sort();
  }, [purchaseData, consumptionData]);

  // Auto old stock for purchase form
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

  // Utility to find aggregated doc by branch + normalized description,
  // with safe fallbacks to scan earlier docs if descriptionNorm missing.
  const findOneByItem = async (collectionName, branchName, descNorm) => {
    // First try indexed query on descriptionNorm
    try {
      const q = query(
        collection(db, collectionName),
        where("branch", "==", branchName),
        where("descriptionNorm", "==", descNorm)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        // return the most recent by date
        let best = null;
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          const ts = d.date?.toMillis?.() ?? 0;
          if (!best || ts > best._ts) best = { id: docSnap.id, ...d, _ts: ts };
        });
        return best;
      }
    } catch (err) {
      // index error or other; we'll fallback to scanning branch docs
      console.warn("Indexed lookup failed (maybe missing index):", err?.message);
    }

    // Fallback: scan documents for branch and compare normalized description client-side
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

    // expiry validation: future-only (strictly > today)
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

    // compute prevPurchasedTotal (before adding this one)
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
        qty: addQty, // last added qty
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
      mou: f.mou || "", // keep MOU if typed
    }));

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

  // ---------- EXPORTS ----------
  const exportCSV = (type = "all") => {
    // type: purchase | consumption | all
    let rows = [];
    if (type === "purchase" || type === "all") {
      rows.push(["PURCHASES"]);
      rows.push(["Date", "Item", "Vendor", "BillNo", "BillAmount", "Qty", "Expiry", "OldStock", "TotalStock", "Branch"]);
      purchaseData.forEach((p) => rows.push([p.date ? p.date.toLocaleString() : "", p.description, p.vendor, p.billNo, p.billAmount, p.qty, p.expiryDate, p.oldStock, p.totalStock, p.branch]));
      rows.push([]);
    }
    if (type === "consumption" || type === "all") {
      rows.push(["CONSUMPTIONS"]);
      rows.push(["Date", "Item", "LastConsumed", "TotalConsumed", "Balance", "Branch"]);
      consumptionData.forEach((c) => rows.push([c.date ? c.date.toLocaleString() : "", c.description, c.consumptionQty ?? c.lastConsumptionQty ?? "", c.totalConsumed ?? c.consumptionQty ?? "", c.balance ?? "", c.branch]));
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
  // NOTE: This is a heavy operation. Run manually from console or wire to a button if required.
  async function mergeDuplicatesForCollection(collectionName) {
    // This function will.scan all docs for the selected branch and merge docs with same normalized description.
    // It writes a single aggregated doc (preserving highest totalStock/totalConsumed logic) and moves raw docs to History.
    if (!window.confirm(`Run merge duplicates on ${collectionName} for branch "${branch}"? This is irreversible.`)) return;
    if (!branch) return alert("Choose a branch first");

    // Step 1: load all docs for branch
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
      if (docs.length <= 1) continue; // nothing to merge
      // merge logic differs for purchase vs consumption
      if (collectionName === "StockEntries") {
        // compute totalStock = max of totalStock or sum(qty)
        let totalStock = docs.reduce((m, d) => Math.max(m, Number(d.totalStock || 0)), 0);
        let last = docs.reduce((best, d) => {
          const ts = d.date?.toMillis?.() ?? 0;
          if (!best || ts > best._ts) return { ...d, _ts: ts };
          return best;
        }, null);
        // create single doc (use last as base and set totalStock)
        const docRef = doc(collection(db, "StockEntries")).withConverter?.() ?? null;
        // can't batch create new doc easily without reference; create via addDoc then delete old ones
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
        // move old docs to history and delete
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
        // add merged doc then history+delete old
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
  const canEdit = roleFromDb === "admin"; // only admin can edit/delete aggregated rows
  const canAdd = roleFromDb === "admin" || roleFromDb === "branchManager";

  // ---------- Render ----------
  return (
    <div className="container py-3">
      {/* Top bar */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap">
        <div>
          <h4 className="mb-0">Inventory — Welcome, {userName} ({uiRole})</h4>
          <small className="text-muted">Branch: {branch || "—"}</small>
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => exportCSV("all")}>Export CSV</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => exportCSV("purchase")}>Export Purchases</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => exportCSV("consumption")}>Export Consumptions</button>
          <button className="btn btn-danger btn-sm" onClick={() => { auth.signOut(); }}>Logout</button>
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
      <div className="mb-3">
        <button className={`btn me-2 ${tab === "purchase" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("purchase")}>Purchase/Stock</button>
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
                  <div className="col-12 col-md-3">
                    <label className="form-label small">Item</label>
                    <input list="itemNames" className="form-control" value={purchaseForm.description} onChange={(e) => setPurchaseForm({ ...purchaseForm, description: e.target.value })} />
                    <datalist id="itemNames">{itemNames.map(n => <option key={n} value={n} />)}</datalist>
                  </div>

                  <div className="col-6 col-md-2">
                    <label className="form-label small">Old Stock</label>
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
                    <input type="text" className="form-control" value={purchaseForm.mou} onChange={(e) => setPurchaseForm({ ...purchaseForm, mou: e.target.value })} placeholder="e.g. Kg, Litre, Pack" />
                  </div>

                  <div className="col-12 col-md-2">
                    <button className="btn btn-success w-100" onClick={handleAddPurchase}>Add / Update</button>
                  </div>
                </div>

                <div className="mt-2">
                  <small className="text-muted">New Purchased Total = Old Stock + Today's Qty (upserted into single row per item).</small>
                </div>
              </div>

              {/* Quick tally hint */}
              {purchaseForm.description && (
                <div className="alert alert-secondary py-2">
                  <strong>{purchaseForm.description}</strong> — Purchased (cum): {getLatestPurchasedTotal(purchaseForm.description)} | Consumed (cum): {getTotalConsumed(purchaseForm.description)} | Net Available: {getCurrentStock(purchaseForm.description)}
                </div>
              )}
            </>
          ) : (
            <div className="alert alert-info">You ({uiRole}) can view stock and add purchases/consumption but cannot delete or edit aggregated rows. Only Admin can delete.</div>
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
                    <td>{p.description}</td>
                    <td>{p.vendor}</td>
                    <td>{p.billNo}</td>
                    <td>{p.billAmount}</td>
                    <td>{p.qty}</td>
                    <td>{p.expiryDate}</td>
                    <td>{p.mou || ""}</td>
                    <td>{p.oldStock}</td>
                    <td>{p.totalStock}</td>
                    <td>{getCurrentStock(p.description)}</td>
                    {canEdit && (
                      <td><button className="btn btn-sm btn-danger" onClick={() => handleDeletePurchase(p.id)}>Delete</button></td>
                    )}
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
          <h5>Daily Consumption</h5>

          {canAdd ? (
            <>
              <div className="card mb-3 p-3">
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
                    <td>{c.description}</td>
                    <td>{c.consumptionQty ?? c.lastConsumptionQty ?? ""}</td>
                    <td>{typeof c.totalConsumed === "number" ? c.totalConsumed : (c.consumptionQty || 0)}</td>
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
          <div className="d-flex gap-2">
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
    </div>
  );
}

export default Home;
