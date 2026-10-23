import { useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";

function App() {
    const [loggedIn, setLoggedIn] = useState(
        !!localStorage.getItem("token")
    );

    const [user, setUser] = useState(
        JSON.parse(
            localStorage.getItem("user") || "null"
        )
    );

    function readSavedUser() {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }

    function handleLogin(userData) {
        setUser(userData);
        setLoggedIn(true);
        localStorage.setItem(
            "user",
            JSON.stringify(userData)
        );
    }

    function handleLogout() {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUser(null);
        setLoggedIn(false);
    }

    if (!loggedIn) {
        return (
            <>
                <Login
                    onLogin={handleLogin}
                />
                <Analytics />
            </>
        );
    }
    return (
        <>
            <Dashboard user={user} onLogout={handleLogout} />
            <Analytics />
        </>
    );
}

export default App;