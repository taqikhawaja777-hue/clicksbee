# 🚀 StitchMonitor Pro - Employee Monitoring & Productivity Platform

Production-grade NestJS Backend and Multi-Role RBAC Frontend Dashboard Suite for Enterprise Operational Excellence.

---

## 🌟 Architecture Overview

- **Backend Stack**: NestJS 10, Prisma ORM 5 (MongoDB Provider), Redis (BullMQ / Caching), Socket.IO (Live Feeds), Argon2 / JWT Authentication.
- **Frontend Stack**: Single Page Application Router (`index.html`), Glassmorphism UI (Tailwind CSS & Material Symbols), Role-Based Screen Hierarchy (`/admin/*`, `/manager/*`, `/employee/*`).
- **Database**: MongoDB (23+ Prisma Data Models with Indexes).

---

## 🚀 Quick Start Guide

### 1. Local Development Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Generate Prisma Client
npm run prisma:generate

# Seed Database with Default Organization & Admin
npm run prisma:seed

# Build NestJS Backend
npm run build

# Start Backend Server
npm run start:dev
```

- **Web Dashboard Portal**: [http://localhost:8080](http://localhost:8080)
- **Backend API & Swagger Documentation**: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

---

## 🐳 Docker Deployment

To launch the full stack (NestJS API + MongoDB + Redis) with Docker Compose:

```bash
docker-compose up -d --build
```

---

## 🔐 Role-Based Access Control (RBAC) Hierarchy

1. **🟢 EMPLOYEE VIEW (`/employee/*`)**:
   - `Employee Dashboard`: Live Clock-In / Clock-Out widget, Task & Break Tracker.
   - `My Tasks`: Tasks assigned by supervisors.
   - `My Screenshots`: Self-audit transparency log.

2. **🟡 MANAGER VIEW (`/manager/*`)**:
   - `Manager Dashboard`: Team performance counters & active project progress.
   - `Live Monitoring`: Grid view of active employee screens.
   - `Team Directory`: Direct report activity status & contacts.
   - `Activity Timeline`: Review idle times, application/website logs.
   - `Reports`: Export productivity & attendance metrics.

3. **🔴 ADMIN VIEW (`/admin/*`)**:
   - `Admin Dashboard`: Company-wide operational overview.
   - `Live Monitoring & All Feeds`: Real-time monitoring across all teams.
   - `Employee Directory`: User governance & role assignments.
   - `Policy Editor`: Screenshot interval config (5-15m), blur mode, idle timeouts.
   - `Admin Settings`: Security config & REST Swagger documentation.
   - `Manage Licenses`: Enterprise seat allocation & subscription management.
