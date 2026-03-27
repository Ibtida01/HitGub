import { API_BASE } from './collabApiConfig';

async function handleJson(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.detail || 'Request failed');
    }
    return data;
}

export async function signup(payload) {
    const res = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return handleJson(res);
}

export async function login(payload) {
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await handleJson(res);
    // backend returns { token }
    localStorage.setItem('auth_token', data.token);
    // also remember username for backend logout
    if (payload?.username) {
        localStorage.setItem('auth_username', payload.username);
    }
    return data;
}

export async function logout() {
    const username = localStorage.getItem('auth_username');
    try {
        if (username) {
            await fetch(`${API_BASE}/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // backend logout only uses username field from Login model
                body: JSON.stringify({ username, password: '' }),
            });
        }
    } catch {
        // ignore network/logout errors; we still clear local state
    }

    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
}