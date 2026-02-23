# Aurora — Client & project management

A modern client relationship and business management app (inspired by HoneyBook), built with React, TypeScript, and Vite.

## Features

- **Dashboard** — Metrics, recent clients, pipeline summary, activity feed
- **Clients** — CRM list with search and client detail pages (projects + invoices)
- **Projects** — Kanban-style pipeline (Lead → Proposal → Won / Lost)
- **Proposals** — Table of proposals with status (draft, sent, accepted, declined)
- **Invoices** — Invoices with outstanding total and status (draft, sent, paid, overdue)

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
npm run preview
```

## Stack

- React 18 + TypeScript
- React Router 6
- Vite 5
- CSS Modules + CSS variables (no UI library)

Design: DM Sans (body), Fraunces (headings), warm cream/charcoal palette with amber accent.
