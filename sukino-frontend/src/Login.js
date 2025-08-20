import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "./firebase";
import { signInWithEmailAndPassword /*, createUserWithEmailAndPassword */ } from "firebase/auth";
// import { doc, setDoc } from "firebase/firestore";
import logo from "./logo.png";

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // --- Register states (kept for later use) ---
  // const [isRegister, setIsRegister] = useState(false);
  // const [branch, setBranch] = useState("");
  // const [role, setRole] = useState("user");

  // const branches = [
  //   "Koramangala",
  //   "BG Road",
  //   "HSR Layout",
  //   "Electronic City",
  //   "Whitefield",
  //   "Manyata Tech Park",
  //   "Coimbatore",
  //   "Cochin",
  // ];

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/home");
    } catch (error) {
      alert(error.message);
    }
  };

  // --- Register handler (kept for later use) ---
  /*
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
  */

  return (
    <div
      className="d-flex justify-content-center align-items-center min-vh-100 px-3"
      style={{ backgroundColor: "white" }}
    >
      <div
        className="card shadow-lg p-4 rounded-4 w-100"
        style={{ maxWidth: "400px", border: "none" }}
      >
        {/* Header with logo */}
        <div className="text-center mb-4">
          <img
            src={logo}
            alt="Logo"
            className="mx-auto mb-3"
            style={{ height: "70px", width: "auto" }}
          />
          <h2 className="fw-bold" style={{ color: "#333" }}>
            Welcome
          </h2>
          <p className="text-muted">Login to your account</p>
        </div>

        {/* Email */}
        <div className="mb-3">
          <input
            className="form-control form-control-lg rounded-pill"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ borderColor: "#fdad1d" }}
          />
        </div>

        {/* Password with toggle */}
        <div className="mb-3 position-relative">
          <input
            className="form-control form-control-lg rounded-pill pe-5"
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ borderColor: "#fdad1d" }}
          />
          {/* Eye icon - mobile friendly */}
          <span
            onMouseDown={(e) => e.preventDefault()} // keeps keyboard open
            onClick={() => setShowPassword(!showPassword)}
            style={{
              position: "absolute",
              right: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: "20px",
              color: "#4f7e2d",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            {showPassword ? "👁️" : "👁️‍🗨️"}
          </span>
        </div>

        {/* Login Button */}
        <button
          className="btn btn-lg w-100 mb-3 rounded-pill"
          onClick={handleLogin}
          style={{
            backgroundColor: "#4f7e2d",
            color: "white",
            border: "none",
          }}
        >
          Login
        </button>

        {/* 
        --- Toggle for Register (kept for later use) ---
        <p className="text-center text-muted mb-0">
          {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
          <span
            className="fw-bold"
            style={{ cursor: "pointer", color: '#4f7e2d' }}
            onClick={() => setIsRegister(!isRegister)}
          >
            {isRegister ? "Login" : "Register"}
          </span>
        </p>
        */}
      </div>

      {/* Custom styles */}
      <style>{`
        input:focus, select:focus {
          box-shadow: 0 0 0 0.25rem rgba(79, 126, 45, 0.25);
          border-color: #4f7e2d;
        }
        .form-control, .form-select {
          border: 1px solid #4f7e2d;
        }
        @media (max-width: 576px) {
          h2 {
            font-size: 1.5rem;
          }
          .form-control-lg {
            font-size: 1rem;
            padding: 0.6rem 1rem;
          }
          button.btn-lg {
            font-size: 1rem;
            padding: 0.6rem;
          }
        }
      `}</style>
    </div>
  );
}

export default Login;
