import { useState } from 'react';
import { login } from '../../services/authApi';

export default function Login({ onAuthSuccess, switchToSignup }) {
    const [form, setForm] = useState({ username: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e) => {
        setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(form);
            onAuthSuccess(); // parent will redirect to repository management
        } catch (err) {
            setError(err.message || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gh-canvas">
            <div className="w-full max-w-md bg-gh-canvas-subtle border border-gh-border rounded-lg p-6 shadow-xl shadow-black/40">
                <h1 className="text-xl font-semibold text-gh-text mb-4 text-center">Sign in to HitGub</h1>

                {error && (
                    <div className="mb-3 text-sm text-gh-danger bg-gh-danger/10 border border-gh-danger-em/60 rounded px-3 py-2">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm text-gh-text-secondary mb-1">Username</label>
                        <input
                            name="username"
                            value={form.username}
                            onChange={handleChange}
                            className="w-full rounded-md border border-gh-border bg-gh-canvas px-3 py-2 text-sm text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent-em focus:border-gh-accent-em"
                            autoComplete="username"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gh-text-secondary mb-1">Password</label>
                        <input
                            type="password"
                            name="password"
                            value={form.password}
                            onChange={handleChange}
                            className="w-full rounded-md border border-gh-border bg-gh-canvas px-3 py-2 text-sm text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent-em focus:border-gh-accent-em"
                            autoComplete="current-password"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-md bg-gh-success-em hover:bg-gh-success text-white text-sm font-medium py-2.5 disabled:opacity-60"
                    >
                        {loading ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>

                <p className="mt-4 text-xs text-gh-text-secondary text-center">
                    New here?{' '}
                    <button
                        type="button"
                        onClick={switchToSignup}
                        className="text-gh-accent hover:text-gh-accent-em hover:underline"
                    >
                        Create an account
                    </button>
                </p>
            </div>
        </div>
    );
}