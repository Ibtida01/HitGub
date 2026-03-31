import {
    API_BASE,
    clearAuthSession,
    getAuthToken,
    setAuthSession,
} from './collabApiConfig';

async function handleJson(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.detail || 'Request failed');
        err.status = res.status;
        err.detail = data?.detail;
        throw err;
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
    setAuthSession(data.token, payload?.username);
    return data;
}

export async function getCurrentUser() {
    const token = getAuthToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/auth/me`, { headers });
    return handleJson(res);
}

export async function logout() {
    const token = getAuthToken();
    try {
        if (token) {
            await fetch(`${API_BASE}/auth/logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
        }
    } catch {
        // ignore network/logout errors; we still clear local state
    }

    clearAuthSession();
}