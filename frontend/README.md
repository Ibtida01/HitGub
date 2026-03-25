# HitGub — Frontend

Web UI for the HitGub project (GitHub-style repository & collaborator management). This package is a **single-page application** built with **React** and bundled by **Vite**.

---

## Tech stack

| Layer | Technology |
|--------|------------|
| UI library | [React 18](https://react.dev/) |
| Language | JavaScript with **JSX** (`.jsx` / `.js`) |
| Build tool & dev server | [Vite 5](https://vitejs.dev/) |
| Styling | [Tailwind CSS 3](https://tailwindcss.com/) |
| Icons | [lucide-react](https://lucide.dev/) |
| Linting | [ESLint 9](https://eslint.org/) (flat config) + `eslint-plugin-react` |

---

## Prerequisites

- **[Node.js](https://nodejs.org/)** — **18.x or newer** (20+ recommended; Vite 5 and tooling are tested with current LTS).
- **npm** (comes with Node) or **pnpm** / **yarn** if your team prefers those.

Check versions:

```bash
node -v   # e.g. v20.x or v22.x
npm -v
```

---

## Install dependencies

From the **repository root**:

```bash
cd frontend
npm install
```

This installs everything listed in `package.json` (React, Vite, Tailwind, ESLint, etc.) into `node_modules/`.

---

## Configuration (environment variables)

1. Copy the example env file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` as needed:

   | Variable | Purpose | Typical value |
   |----------|---------|----------------|
   | `VITE_API_URL` | Base URL of the **FastAPI** backend (when you connect real APIs) | `http://localhost:8000` |
   | `VITE_COLLAB_USE_MOCK` | If `true` (or unset), collaborator features use **in-memory mock data**. Set to `false` when backend routes exist and match `src/services/collabApi.js`. | `true` |
   | `VITE_REPO_USE_MOCK` | If `true` (or unset), repository creation/config/branch features use **in-memory mock data**. Set to `false` when backend routes exist and match `src/services/repoApi.js`. | `true` |

> **Note:** Only variables prefixed with `VITE_` are exposed to the browser. Restart the dev server after changing `.env`.

---

## Run the app (development)

```bash
npm run dev
```

- Opens the **Vite** dev server (default **http://localhost:5173**).
- Hot reload: saving files refreshes the UI.
- To listen on all interfaces (e.g. LAN testing): `npm run dev -- --host`

Stop the server with `Ctrl+C`.

---

## Production build

```bash
npm run build
```

- Output goes to **`dist/`** (static HTML/JS/CSS).
- Serve `dist/` with any static file server or put it behind your backend / reverse proxy.

Preview the production build locally:

```bash
npm run preview
```

(Also serves via Vite; check the terminal for the URL, usually http://localhost:4173.)

---

## Linting

```bash
npm run lint
```

Runs ESLint on `src/**/*.js` and `src/**/*.jsx`.

---

## Project layout (high level)

```
frontend/
├── index.html              # HTML shell; loads src/main.jsx
├── vite.config.js          # Vite configuration
├── tailwind.config.js      # Tailwind theme / content paths
├── postcss.config.js
├── jsconfig.json           # Editor hints (paths, JSX)
├── src/
│   ├── main.jsx            # App entry (React root)
│   ├── App.jsx             # Demo shell (nav, repo/user switchers for development)
│   ├── index.css           # Tailwind directives + global styles
│   ├── types/index.js      # Collaborator role/permission constants
│   ├── mock/data.js        # Mock users/repos (used when mock API is on)
│   ├── services/
│   │   ├── collabApi.js    # Collaborator API (mock or HTTP)
│   │   ├── collabApiConfig.js
│   │   └── repoApi.js      # Repository management API (mock or HTTP)
│   ├── components/collab/    # Collaborator management UI
│   └── components/repo/      # Repository creation + branch/config management UI
├── docs/
│   └── repository-api-contract.md   # Backend handoff contract for repo endpoints
└── README.md               # This file
```

For integration, other pages can import from `src/components/collab` (see `index.js` exports).

---

## Troubleshooting

| Issue | What to try |
|--------|----------------|
| `npm install` fails | Use Node 18+; delete `node_modules` and `package-lock.json`, then `npm install` again. |
| Port 5173 in use | Run `npm run dev -- --port 3000` (or another free port). |
| API calls fail after setting `VITE_COLLAB_USE_MOCK=false` | Ensure `VITE_API_URL` is correct and the backend implements the routes expected in `collabApi.js`. |
| Styles missing | Ensure `src/index.css` is imported from `main.jsx` and Tailwind `content` in `tailwind.config.js` includes `./src/**/*.{js,jsx}`. |

---

## Scripts reference

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run lint` | Run ESLint |
