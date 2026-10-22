
import { useState } from "react";
import { loginUser, registerUser, setToken } from "../api";

function Login({ onLogin }) {
    const [isRegister, setIsRegister] = useState(false);
    const [form, setForm] = useState({
        name: "",
        email: "",
        password: ""
    });
    const [message, setMessage] = useState("");
    const [messageType, setMessageType] = useState("error");
    const [loading, setLoading] = useState(false);

    function handleChange(e) {
        setForm({
            ...form,
            [e.target.name]: e.target.value
        });
    }

    function toggleForm() {
        setIsRegister(!isRegister);
        setMessage("");
        setForm({
            name: "",
            email: "",
            password: ""
        });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setMessage("");
        setLoading(true);

        try {
            if (isRegister) {
                await registerUser({
                    name: form.name.trim(),
                    email: form.email.trim(),
                    password: form.password
                });

                setMessageType("success");
                setMessage("Registration successful! Please log in.");

                setIsRegister(false);
                setForm({
                    name: "",
                    email: form.email.trim(),
                    password: ""
                });
            } else {
                const response = await loginUser({
                    email: form.email.trim(),
                    password: form.password
                });

                setToken(response.data.token);

                localStorage.setItem(
                    "user",
                    JSON.stringify(response.data.user)
                );

                onLogin(response.data.user);
            }
        } catch (error) {
            console.error("Authentication error:", error);
            console.error("Server response:", error.response?.data);

            setMessageType("error");
            setMessage(
                error.response?.data?.error ||
                error.response?.data?.message ||
                (error.code === "ERR_NETWORK"
                    ? "Cannot connect to the server. Check Flask."
                    : error.message) ||
                "Something went wrong. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={styles.page}>
            <div style={styles.card}>
                <h1 style={styles.heading}>
                    Distributed Job Scheduler
                </h1>

                <p style={styles.subtitle}>
                    {isRegister
                        ? "Create your account to get started"
                        : "Manage and monitor your jobs"}
                </p>

                <form onSubmit={handleSubmit}>
                    {isRegister && (
                        <input
                            type="text"
                            name="name"
                            placeholder="Full Name"
                            value={form.name}
                            onChange={handleChange}
                            required
                            autoComplete="name"
                            style={styles.input}
                        />
                    )}

                    <input
                        type="email"
                        name="email"
                        placeholder="Email"
                        value={form.email}
                        onChange={handleChange}
                        required
                        autoComplete="email"
                        style={styles.input}
                    />

                    <input
                        type="password"
                        name="password"
                        placeholder="Password"
                        value={form.password}
                        onChange={handleChange}
                        required
                        minLength={isRegister ? 8 : undefined}
                        autoComplete={
                            isRegister ? "new-password" : "current-password"
                        }
                        style={styles.input}
                    />

                    <button
                        type="submit"
                        style={{
                            ...styles.button,
                            opacity: loading ? 0.7 : 1
                        }}
                        disabled={loading}
                    >
                        {loading
                            ? "Please wait..."
                            : isRegister
                                ? "Create Account"
                                : "Login"}
                    </button>
                </form>

                {message && (
                    <p
                        role="status"
                        aria-live="polite"
                        style={{
                            ...styles.message,
                            color: messageType === "success"
                                ? "#15803d"
                                : "#dc2626"
                        }}
                    >
                        {message}
                    </p>
                )}

                <button
                    type="button"
                    onClick={toggleForm}
                    style={styles.linkButton}
                    disabled={loading}
                >
                    {isRegister
                        ? "Already have an account? Login"
                        : "Don't have an account? Register"}
                </button>
            </div>
        </div>
    );
}

const styles = {
    page: {
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px",
        boxSizing: "border-box",
        background: "#f3f4f6"
    },
    card: {
        width: "100%",
        maxWidth: "400px",
        padding: "35px",
        boxSizing: "border-box",
        background: "white",
        borderRadius: "12px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)"
    },
    heading: {
        fontSize: "26px",
        lineHeight: 1.3,
        color: "#172554"
    },
    subtitle: {
        color: "#666",
        marginBottom: "25px"
    },
    input: {
        width: "100%",
        padding: "12px",
        marginBottom: "15px",
        boxSizing: "border-box",
        border: "1px solid #ddd",
        borderRadius: "6px",
        fontSize: "15px"
    },
    button: {
        width: "100%",
        padding: "12px",
        border: "none",
        borderRadius: "6px",
        background: "#2563eb",
        color: "white",
        fontSize: "16px",
        cursor: "pointer"
    },
    message: {
        marginTop: "15px",
        fontSize: "14px",
        overflowWrap: "anywhere"
    },
    linkButton: {
        marginTop: "20px",
        border: "none",
        background: "none",
        color: "#2563eb",
        cursor: "pointer",
        padding: "0",
        textAlign: "left"
    }
};

export default Login;
