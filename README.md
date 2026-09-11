# Gridiron Lab

NFL analytics lab: **QB comparison**, **DFS optimizer**, **play-calling**, and a **live wire** (in-game box → final whistle → next-morning nflverse). 2023–2025 snapshots plus a 2026 overlay from nflverse PBP / ESPN.

Built with TanStack Start (React 19), Tailwind v4, Recharts.

## Open in VS Code

Needs **Node 20.19+ or 22.12+**. Then:

```bash
git clone https://github.com/Bryancruzcb/gridiron-lab.git
cd gridiron-lab
code .
```

In the VS Code terminal:

```bash
npm install
npm run dev
```

Then open [http://localhost:8080](http://localhost:8080).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 8080 |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |

## Labs

- `/` — board: 2026 leaders + historical EPA
- `/qb` — QB comparison (EPA, CPOE, pressure splits)
- `/optimizer` — DFS lineup solver, projections vs week actuals
- `/play-calling` — 2nd-and-short / 4th-down aggression + heatmap
- `/live` — in-game box, final whistle, next-morning advanced stats

Data: nflverse play-by-play + ESPN scoreboard. Historical seasons are baked into `src/data/`. 2026 is parsed live from nflverse with a snapshot fallback.
