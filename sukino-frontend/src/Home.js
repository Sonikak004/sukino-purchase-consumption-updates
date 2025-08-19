import React, { useState, useEffect } from "react";
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
  updateDoc
} from "firebase/firestore";
import 'bootstrap/dist/css/bootstrap.min.css';

function Home() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("user");
  const [branch, setBranch] = useState("");
  const [tab, setTab] = useState("purchase"); // purchase or consumption
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
    oldStock: ""
  });

  const [consumptionForm, setConsumptionForm] = useState({
    description: "",
    consumptionQty: ""
  });

  const branches = [
    "Koramangala",
    "BG Road",
    "HSR Layout",
    "Electronic City",
    "Whitefield",
    "Manyata Tech Park",
    "Coimbatore",
    "Cochin"
  ];

  // Listen for auth changes
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      if (!currentUser) {
        navigate("/login");
        return;
      }
      setUser(currentUser);
      const userRef = doc(db, "Users", currentUser.uid);
      onSnapshot(userRef, (snap) => {
        if (snap.exists()) {
          setUserName(snap.data().Name || currentUser.email);
          setUserRole(snap.data().Role || "user");
        }
      });
    });
    return () => unsubscribe();
  }, [navigate]);

  // Fetch data based on selected branch
  useEffect(() => {
    if (!branch) {
      setPurchaseData([]);
      setConsumptionData([]);
      return;
    }

    const purchaseQuery = query(
      collection(db, "StockEntries"),
      where("Branch", "==", branch),
      orderBy("date", "desc")
    );
    const unsubscribePurchase = onSnapshot(purchaseQuery, (snapshot) => {
      const pData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: doc.data().date ? doc.data().date.toDate() : null
      }));
      setPurchaseData(pData);
    });

    const consumptionQuery = query(
      collection(db, "ConsumptionEntries"),
      where("Branch", "==", branch),
      orderBy("date", "desc")
    );
    const unsubscribeConsumption = onSnapshot(consumptionQuery, (snapshot) => {
      const cData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: doc.data().date ? doc.data().date.toDate() : null
      }));
      setConsumptionData(cData);
    });

    return () => {
      unsubscribePurchase();
      unsubscribeConsumption();
    };
  }, [branch]);

  const handleLogout = () => auth.signOut();

  const handleAddPurchase = async () => {
    const { description, vendor, billNo, billAmount, qty, expiryDate, oldStock } = purchaseForm;
    if (!description || !vendor || !billNo || !billAmount || !qty) return alert("Please fill all required fields");
    if (isNaN(qty) || isNaN(billAmount) || isNaN(oldStock)) return alert("Numeric fields must be numbers");

    const totalStock = Number(oldStock || 0) + Number(qty);
    await addDoc(collection(db, "StockEntries"), {
      Branch: branch,
      description,
      vendor,
      billNo,
      billAmount: Number(billAmount),
      qty: Number(qty),
      expiryDate,
      oldStock: Number(oldStock),
      totalStock,
      date: serverTimestamp()
    });

    setPurchaseForm({ description: "", vendor: "", billNo: "", billAmount: "", qty: "", expiryDate: "", oldStock: "" });
  };

  const handleAddConsumption = async () => {
    const { description, consumptionQty } = consumptionForm;
    if (!description || !consumptionQty) return alert("Please fill all fields");
    if (isNaN(consumptionQty)) return alert("Consumption quantity must be a number");

    const latestStock = purchaseData.filter(p => p.description === description)
      .reduce((acc, p) => acc + Number(p.qty), 0);
    const consumed = consumptionData.filter(c => c.description === description)
      .reduce((acc, c) => acc + Number(c.consumptionQty), 0);
    const balance = latestStock - consumed - Number(consumptionQty);

    await addDoc(collection(db, "ConsumptionEntries"), {
      Branch: branch,
      description,
      consumptionQty: Number(consumptionQty),
      balance,
      date: serverTimestamp()
    });

    setConsumptionForm({ description: "", consumptionQty: "" });
  };

  const handleDeletePurchase = async (id) => {
    if (window.confirm("Are you sure to delete this purchase?")) {
      await deleteDoc(doc(db, "StockEntries", id));
    }
  };

  const handleDeleteConsumption = async (id) => {
    if (window.confirm("Are you sure to delete this consumption?")) {
      await deleteDoc(doc(db, "ConsumptionEntries", id));
    }
  };

  return (
    <div className="container py-3">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap">
        <h4>Welcome, {userName}</h4>
        <button className="btn btn-danger btn-sm mt-2 mt-md-0" onClick={handleLogout}>Logout</button>
      </div>

      {/* Branch selection */}
      <div className="mb-3">
        <label>Select Branch:</label>
        <select className="form-select" value={branch} onChange={e => setBranch(e.target.value)}>
          <option value="">Select Branch</option>
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="mb-3">
        <button className={`btn me-2 ${tab === "purchase" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("purchase")}>Purchase/Stock</button>
        <button className={`btn ${tab === "consumption" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("consumption")}>Consumption</button>
      </div>

      {/* PURCHASE */}
      {tab === "purchase" && branch && (
        <div className="mb-5">
          <h5>Grocery Purchase / Stock</h5>
          <div className="row g-2 mb-2">
            <div className="col-md-3"><input type="text" placeholder="Item Name" className="form-control" value={purchaseForm.description} onChange={e => setPurchaseForm({ ...purchaseForm, description: e.target.value })} /></div>
            <div className="col-md-2"><input type="text" placeholder="Vendor" className="form-control" value={purchaseForm.vendor} onChange={e => setPurchaseForm({ ...purchaseForm, vendor: e.target.value })} /></div>
            <div className="col-md-2"><input type="number" placeholder="Bill No" className="form-control" value={purchaseForm.billNo} onChange={e => setPurchaseForm({ ...purchaseForm, billNo: e.target.value })} /></div>
            <div className="col-md-2"><input type="number" placeholder="Bill Amount" className="form-control" value={purchaseForm.billAmount} onChange={e => setPurchaseForm({ ...purchaseForm, billAmount: e.target.value })} /></div>
            <div className="col-md-1"><input type="number" placeholder="Qty" className="form-control" value={purchaseForm.qty} onChange={e => setPurchaseForm({ ...purchaseForm, qty: e.target.value })} /></div>
            <div className="col-md-2"><input type="date" className="form-control" value={purchaseForm.expiryDate} onChange={e => setPurchaseForm({ ...purchaseForm, expiryDate: e.target.value })} /></div>
            <div className="col-md-1"><input type="number" placeholder="Old Stock" className="form-control" value={purchaseForm.oldStock} onChange={e => setPurchaseForm({ ...purchaseForm, oldStock: e.target.value })} /></div>
            <div className="col-md-2"><button className="btn btn-success w-100" onClick={handleAddPurchase}>Add Purchase</button></div>
          </div>

          <table className="table table-striped table-bordered table-responsive">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Vendor</th>
                <th>Bill No</th>
                <th>Bill Amount</th>
                <th>Qty</th>
                <th>Expiry</th>
                <th>Old Stock</th>
                <th>Total Stock</th>
                {userRole === "admin" && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {purchaseData.map(p => (
                <tr key={p.id}>
                  <td>{p.date ? p.date.toLocaleDateString() : ""}</td>
                  <td>{p.description}</td>
                  <td>{p.vendor}</td>
                  <td>{p.billNo}</td>
                  <td>{p.billAmount}</td>
                  <td>{p.qty}</td>
                  <td>{p.expiryDate}</td>
                  <td>{p.oldStock}</td>
                  <td>{p.totalStock}</td>
                  {userRole === "admin" &&
                    <td>
                      <button className="btn btn-sm btn-danger me-1" onClick={() => handleDeletePurchase(p.id)}>Delete</button>
                    </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CONSUMPTION */}
      {tab === "consumption" && branch && (
        <div className="mb-5">
          <h5>Daily Consumption</h5>
          <div className="row g-2 mb-2">
            <div className="col-md-4"><input type="text" placeholder="Item Name" className="form-control" value={consumptionForm.description} onChange={e => setConsumptionForm({ ...consumptionForm, description: e.target.value })} /></div>
            <div className="col-md-2"><input type="number" placeholder="Consumption Qty" className="form-control" value={consumptionForm.consumptionQty} onChange={e => setConsumptionForm({ ...consumptionForm, consumptionQty: e.target.value })} /></div>
            <div className="col-md-2"><button className="btn btn-success w-100" onClick={handleAddConsumption}>Add Consumption</button></div>
          </div>

          <table className="table table-striped table-bordered table-responsive">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Consumption Qty</th>
                <th>Balance</th>
                {userRole === "admin" && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {consumptionData.map(c => (
                <tr key={c.id}>
                  <td>{c.date ? c.date.toLocaleDateString() : ""}</td>
                  <td>{c.description}</td>
                  <td>{c.consumptionQty}</td>
                  <td>{c.balance}</td>
                  {userRole === "admin" &&
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteConsumption(c.id)}>Delete</button>
                    </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Home;
