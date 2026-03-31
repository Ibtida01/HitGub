import { useState } from 'react';
import { signup, login } from '../../services/authApi';

export default function Signup({ onAuthSuccess, switchToLogin }) {
    const [form, setForm] = useState({
        username: '',
        email: '',
        password: '',
        full_name: '',
        bio: '',
        avatar_url: '',
    });
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
            await signup(form);
            // auto-login after successful signup
            await login({ username: form.username, password: form.password });
            onAuthSuccess();
        } catch (err) {
            setError(err.message || 'Signup failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gh-canvas">
            <div className="w-full max-w-md bg-gh-canvas-subtle border border-gh-border rounded-lg p-6 overflow-y-auto max-h-[90vh] shadow-xl shadow-black/40">
                <h1 className="text-xl font-semibold text-gh-text mb-4 text-center">Create your account</h1>

                {error && (
                    <div className="mb-3 text-sm text-gh-danger bg-gh-danger/10 border border-gh-danger-em/60 rounded px-3 py-2">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="block text-sm text-gh-text-secondary mb-1">Username</label>
                        <input
                            name="username"
                            value={form.username}
                            onChange={handleChange}
                            placeholder="letters, numbers, _ or -"
                            pattern="[A-Za-z0-9_-]+"
                            title="Use letters, numbers, underscore, or hyphen"
                            className="w-full rounded-md border border-gh-border bg-gh-canvas px-3 py-2 text-sm text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent-em focus:border-gh-accent-em"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gh-text-secondary mb-1">Email</label>
                        <input
                            type="email"
                            name="email"
                            value={form.email}
                            onChange={handleChange}
                            className="w-full rounded-md border border-gh-border bg-gh-canvas px-3 py-2 text-sm text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent-em focus:border-gh-accent-em"
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
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gh-text-secondary mb-1">Full name (optional)</label>
                        <input
                            name="full_name"
                            value={form.full_name}
                            onChange={handleChange}
                            className="w-full rounded-md border border-gh-border bg-gh-canvas px-3 py-2 text-sm text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent-em focus:border-gh-accent-em"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gh-text-secondary mb-1">Bio (optional)</label>
                        <textarea
                            name="bio"
                            value={form.bio}
                            onChange={handleChange}
                            className="w-full rounded-md border border-gh-border bg-gh-canvas px-3 py-2 text-sm text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent-em focus:border-gh-accent-em"
                            rows={2}
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gh-text-secondary mb-1">
                            Avatar URL (optional)
                        </label>
                        <input
                            name="avatar_url"
                            value={form.avatar_url}
                            onChange={handleChange}
                            className="w-full rounded-md border border-gh-border bg-gh-canvas px-3 py-2 text-sm text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent-em focus:border-gh-accent-em"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-md bg-gh-success-em hover:bg-gh-success text-white text-sm font-medium py-2.5 disabled:opacity-60"
                    >
                        {loading ? 'Creating account…' : 'Sign up'}
                    </button>
                </form>

                <p className="mt-4 text-xs text-gh-text-secondary text-center">
                    Already have an account?{' '}
                    <button
                        type="button"
                        onClick={switchToLogin}
                        className="text-gh-accent hover:text-gh-accent-em hover:underline"
                    >
                        Sign in
                    </button>
                </p>
            </div>
        </div>
    );
}