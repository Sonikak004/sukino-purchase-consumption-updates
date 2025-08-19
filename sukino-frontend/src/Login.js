import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [branch, setBranch] = useState("");
  const [role, setRole] = useState("user");

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

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/home");
    } catch (error) {
      alert(error.message);
    }
  };

  const handleRegister = async () => {
    if (!branch) return alert("Please select a branch!");
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      await setDoc(doc(db, "Users", user.uid), {
        Email: email,
        Role: role,
        Branch: branch,
        createdAt: new Date(),
      });
      navigate("/home");
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <div className="d-flex justify-content-center align-items-center min-vh-100 bg-gradient">
      <div className="card shadow-lg p-4 rounded-4" style={{ maxWidth: "400px", width: "90%" }}>
        <div className="text-center mb-4">
          <h2 className="fw-bold">{isRegister ? "Create Account" : "Welcome"}</h2>
          <p className="text-muted">{isRegister ? "Register to get started" : "Login to your account"}</p>
        </div>

        <div className="mb-3">
          <input
            className="form-control form-control-lg rounded-pill"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <input
            className="form-control form-control-lg rounded-pill"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {isRegister && (
          <>
            <div className="mb-3">
              <select
                className="form-select form-select-lg rounded-pill"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                <option value="">Select Branch</option>
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <select
                className="form-select form-select-lg rounded-pill"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="user">User</option>
                <option value="branchManager">Branch Manager</option>
              </select>
            </div>
          </>
        )}

        <button
          className="btn btn-primary btn-lg w-100 mb-3 rounded-pill"
          onClick={isRegister ? handleRegister : handleLogin}
        >
          {isRegister ? "Register" : "Login"}
        </button>

        <p className="text-center text-muted mb-0">
          {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
          <span
            className="text-primary fw-bold"
            style={{ cursor: "pointer" }}
            onClick={() => setIsRegister(!isRegister)}
          >
            {isRegister ? "Login" : "Register"}
          </span>
        </p>
      </div>

      {/* Gradient background style */}
      <style>{`
        .bg-gradient {
          background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%);
        }
        input:focus, select:focus {
          box-shadow: 0 0 0 0.25rem rgba(37, 117, 252, 0.25);
        }
      `}</style>
    </div>
  );
}

export default Login;
