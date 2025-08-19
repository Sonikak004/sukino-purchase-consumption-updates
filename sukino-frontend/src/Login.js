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
  const [role, setRole] = useState("user"); // default role for registration

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

      // Save user info to Firestore
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
    <div className="d-flex justify-content-center align-items-center min-vh-100 bg-light">
      <div className="w-100" style={{ maxWidth: "400px" }}>
        <div className="card shadow p-4 rounded">
          <h3 className="mb-4 text-center">{isRegister ? "Register" : "Login"}</h3>

          {/* Email & Password */}
          <div className="mb-3">
            <input
              className="form-control"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="mb-3">
            <input
              className="form-control"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {/* Registration fields */}
          {isRegister && (
            <>
              <div className="mb-3">
                <select
                  className="form-select"
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
                  className="form-select"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="user">User</option>
                  <option value="branchManager">Branch Manager</option>
                </select>
              </div>
            </>
          )}

          {/* Submit button */}
          <button
            className="btn btn-primary w-100 mb-3"
            onClick={isRegister ? handleRegister : handleLogin}
          >
            {isRegister ? "Register" : "Login"}
          </button>

          {/* Toggle register/login */}
          <p className="text-center mb-0">
            {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
            <span
              style={{ cursor: "pointer", color: "blue" }}
              onClick={() => setIsRegister(!isRegister)}
            >
              {isRegister ? "Login" : "Register"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
