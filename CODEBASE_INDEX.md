# Finance-Assistant Codebase Index

**Last Updated**: April 1, 2026  
**Project Type**: Monorepo (pnpm workspaces)  
**Primary Language**: TypeScript/TSX  
**License**: MIT

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Workspace Structure](#workspace-structure)
3. [Packages & Modules](#packages--modules)
4. [Artifacts (Applications)](#artifacts-applications)
5. [Shared Libraries](#shared-libraries)
6. [Key Technologies](#key-technologies)
7. [Build & Development](#build--development)
8. [Architecture Patterns](#architecture-patterns)

---

## Project Overview

**Finance-Assistant** is a comprehensive financial management system built as a TypeScript monorepo. It consists of:
- **Backend API Server**: Express.js server handling business logic
- **Frontend Dashboard**: React + Vite web application for financial data visualization and management
- **UI Component Sandbox**: Isolated environment for UI development
- **Shared Libraries**: Reusable modules for API interaction, data validation, and database access

---

## Workspace Structure

```
Finance-Assistant/
├── package.json                  # Root workspace configuration
├── pnpm-workspace.yaml           # pnpm workspace definition
├── tsconfig.base.json            # Base TypeScript configuration
├── tsconfig.json                 # Root TypeScript configuration
├── artifacts/                    # Deployable applications
│   ├── api-server/              # Express backend API
│   ├── finance-dashboard/       # React frontend application
│   └── mockup-sandbox/          # UI component development sandbox
├── lib/                         # Shared libraries
│   ├── api-client-react/        # React Query API client
│   ├── api-spec/                # OpenAPI specification & code generation
│   ├── api-zod/                 # Zod schemas for API validation
│   └── db/                      # Drizzle ORM database layer
├── scripts/                     # Utility scripts
└── attached_assets/             # Project requirements & documentation
```

### Scripts Folder
- **Location**: `scripts/`
- **Purpose**: Contains utility scripts for build processes
- **Key Scripts**: `post-merge.sh` (version control hooks)

---

## Packages & Modules

### Workspace Package Management
- **Package Manager**: pnpm (enforced via `preinstall` script)
- **Root Package Name**: `workspace`
- **All Packages**: Private workspace packages (prefixed with `@workspace/`)

---

## Artifacts (Applications)

### 1. **API Server** (`artifacts/api-server/`)
**Package Name**: `@workspace/api-server`

#### Purpose
Express.js backend API server providing RESTful endpoints for financial data management.

#### Key Files
| File | Purpose |
|------|---------|
| `src/app.ts` | Express app configuration with middleware (CORS, JSON parsing, logging) |
| `src/index.ts` | Server entry point |
| `src/routes/index.ts` | Route aggregator |
| `src/routes/health.ts` | Health check endpoint |
| `src/lib/logger.ts` | Pino logger configuration |
| `build.mjs` | ESBuild compilation script |

#### Dependencies (Key)
- **express** ^5 - Web framework
- **cors** ^2 - CORS middleware
- **pino** & **pino-http** - HTTP logging
- **@workspace/api-zod** - API validation schemas
- **@workspace/db** - Database layer
- **drizzle-orm** - TypeScript ORM

#### Development Scripts
```bash
pnpm run dev          # Build & start in development mode
pnpm run build        # Build with ESBuild
pnpm run start        # Run compiled server
pnpm run typecheck    # TypeScript validation
```

#### Architecture
- Modular routing system
- Structured logging with Pino
- CORS and JSON middleware
- Database integration ready

---

### 2. **Finance Dashboard** (`artifacts/finance-dashboard/`)
**Package Name**: `@workspace/finance-dashboard`

#### Purpose
React web application for viewing and managing financial data with comprehensive dashboard, reporting, and management features.

#### Pages (Routes)
| Page | Path | Purpose |
|------|------|---------|
| Login | `/login` | Authentication entry point |
| Dashboard | `/` | Main overview and metrics |
| Employees | `/employees` | Employee management interface |
| Salary | `/salary` | Salary/payroll management |
| Funds | `/funds` | Fund allocation and tracking |
| Expenses | `/expenses` | Expense tracking and analysis |
| Transactions | `/transactions` | Transaction history and details |
| Settings | `/settings` | Application configuration |
| Not Found | `*` | 404 error page |

#### Key Components
- **Layout Components**: `dashboard-layout.tsx`, `sidebar.tsx`, `topbar.tsx`
- **UI Components**: 30+ Radix UI-based components (accordion, alerts, buttons, cards, charts, etc.)
- **Utilities**: `dashboard-card.tsx`, `theme-provider.tsx`

#### Store (State Management)
- **auth.ts** - Authentication state (Zustand)
- **ui.ts** - UI state management

#### Key Hooks
- **use-mobile.tsx** - Mobile responsiveness detection
- **use-toast.ts** - Toast notifications

#### Configuration
- **Vite** for fast build and dev server
- **TypeScript** strict mode
- **Build Output**: Production-optimized bundles

#### Development Scripts
```bash
pnpm run dev          # Start Vite dev server (0.0.0.0:5173)
pnpm run build        # Production build
pnpm run serve        # Preview production bundle
pnpm run typecheck    # TypeScript validation
```

#### Key Dependencies
- **React** - UI framework
- **Wouter** - Lightweight routing
- **@tanstack/react-query** - Data fetching & caching
- **Zustand** - State management
- **Radix UI** - Accessible component library
- **React Hook Form** - Form handling
- **zod** - Schema validation
- **Tailwind CSS** - Styling (via UI components)

---

### 3. **Mockup Sandbox** (`artifacts/mockup-sandbox/`)
**Package Name**: `@workspace/mockup-sandbox`

#### Purpose
Development sandbox for designing, testing, and showcasing UI components in isolation before integration.

#### Structure
- **Components**: Mockup components and UI previews
- **Hooks**: Reusable hooks (mobile detection, toasts)
- **Utils**: Utility functions

#### Configuration
- **Vite**: Fast development experience
- Similar dependencies to finance-dashboard for UI consistency

#### Development Scripts
```bash
pnpm run dev          # Start Vite dev server
pnpm run build        # Production build
pnpm run preview      # Preview bundle
pnpm run typecheck    # TypeScript validation
```

---

## Shared Libraries

### 1. **API Client React** (`lib/api-client-react/`)
**Package Name**: `@workspace/api-client-react`

#### Purpose
React Query wrapper for API integration with typed client generation.

#### Exports
- Main export: `src/index.ts`

#### Dependencies
- **@tanstack/react-query** - Async state management
- **react** (peer dependency) >= 18

#### Key Features
- `custom-fetch.ts` - Custom fetch implementation
- `generated/api.ts` - Auto-generated API client (via Orval)
- `generated/api.schemas.ts` - TypeScript schemas

---

### 2. **API Specification** (`lib/api-spec/`)
**Package Name**: `@workspace/api-spec`

#### Purpose
OpenAPI specification source and code generation configuration using Orval.

#### Files
- **openapi.yaml** - OpenAPI 3.x specification
- **orval.config.ts** - Orval code generation configuration

#### Development Scripts
```bash
pnpm run codegen      # Generate API client from OpenAPI spec
```

#### Purpose
Central specification for API contracts, generates TypeScript clients and types.

---

### 3. **API Zod Schemas** (`lib/api-zod/`)
**Package Name**: `@workspace/api-zod`

#### Purpose
Zod validation schemas for API request/response validation with TypeScript type inference.

#### Contents
- `src/generated/api.ts` - Auto-generated API schemas
- `src/generated/types/` - Generated TypeScript types

#### Dependencies
- **zod** - Schema validation library

---

### 4. **Database Layer** (`lib/db/`)
**Package Name**: `@workspace/db`

#### Purpose
Drizzle ORM database abstraction layer with PostgreSQL integration.

#### Exports
- `.` → `src/index.ts` - Main database exports
- `./schema` → `src/schema/index.ts` - Database schema definitions

#### Dependencies
- **drizzle-orm** - TypeScript ORM
- **drizzle-zod** - Zod integration for ORM schemas
- **pg** ^8.20.0 - PostgreSQL driver
- **zod** - Schema validation

#### Development Scripts
```bash
pnpm run push          # Apply schema changes to database
pnpm run push-force    # Force apply schema (be careful!)
```

#### Configuration
- **drizzle.config.ts** - Drizzle Kit configuration
- **PostgreSQL** as primary database

#### Schema Structure
- Location: `src/schema/index.ts`
- Zod schema integration for runtime validation

---

## Key Technologies

### Runtime & Build
| Tech | Version | Purpose |
|------|---------|---------|
| TypeScript | ~5.9.2 | Language & type safety |
| Node.js | Latest | Server runtime |
| pnpm | Latest | Package manager |
| Vite | Latest | React dev server & bundler |
| ESBuild | ^0.27.3 | API server bundler |

### Backend
| Tech | Version | Purpose |
|------|---------|---------|
| Express | ^5 | Web framework |
| Drizzle ORM | catalog | SQL builder & ORM |
| PostgreSQL | Updated via pg | Database |
| Pino | ^9 | Structured logging |
| CORS | ^2 | Cross-origin support |

### Frontend
| Tech | Version | Purpose |
|------|---------|---------|
| React | ^18 | UI framework |
| Wouter | Latest | Client-side routing |
| React Query | Latest | Server state management |
| Zustand | Latest | Client state management |
| Radix UI | Latest | Component library |
| React Hook Form | ^3.10.0 | Form handling |
| Tailwind CSS | Via Radix/components | Styling |

### Validation & Schemas
| Tech | Version | Purpose |
|------|---------|---------|
| Zod | Latest | Schema validation |
| Orval | ^8.5.2 | OpenAPI code generation |

### Development Tools
- **Prettier** ^3.8.1 - Code formatting
- **TypeScript ESLint** - Type checking
- **esbuild-plugin-pino** - Pino logging optimization

---

## Build & Development

### Root Scripts
```bash
pnpm build               # Build all packages (typecheck + build all artifacts)
pnpm typecheck:libs    # TypeScript check for lib/ packages only
pnpm typecheck         # Full TypeScript check (libs + artifacts/scripts)
```

### Workspace Configuration
- **Package Manager**: pnpm (enforced)
- **Minimum Release Age**: 1 day (supply-chain security)
- **TypeScript Target**: ES2022
- **Module Resolution**: Bundler (ESM)

### Development Workflow
1. **Install**: `pnpm install`
2. **Develop**: Run individual package dev servers (`pnpm run -r --filter @workspace/finance-dashboard run dev`)
3. **Typecheck**: `pnpm typecheck` before commits
4. **Build**: `pnpm build` for production

---

## Architecture Patterns

### Monorepo Organization
```
Artifacts (Deployable)
├── api-server          → Backend API (Express)
├── finance-dashboard   → Frontend Web App (React)
└── mockup-sandbox      → Component Development (React)

Libraries (Shared Code)
├── api-client-react    → API client wrapper
├── api-spec            → API contracts
├── api-zod             → Validation schemas
└── db                  → Database layer
```

### Data Flow
```
Client (React)
    ↓
React Query (api-client-react)
    ↓
Custom Fetch + Generated Client (api-spec)
    ↓
Schema Validation (api-zod)
    ↓
Express API (api-server)
    ↓
Drizzle ORM (db)
    ↓
PostgreSQL Database
```

### Authentication
- Centralized in `auth` store (Zustand)
- Protected routes via auth check in Router component
- Redirect to login for unauthenticated users

### State Management
- **Server State**: React Query (react-query)
- **Client UI State**: Zustand (ui store)
- **Auth State**: Zustand (auth store)

### Component Architecture
- **Radix UI** for accessible primitives
- **Utility Components**: dashboard-card, theme-provider
- **Layout System**: dashboard-layout, sidebar, topbar
- **Form Handling**: React Hook Form + Zod

### Database Architecture
- **ORM**: Drizzle ORM with TypeScript
- **Database**: PostgreSQL
- **Migrations**: Drizzle Kit (`pnpm push`)
- **Validation**: Drizzle-Zod integration

### API Architecture
- **Specification**: OpenAPI 3.x (openapi.yaml)
- **Code Generation**: Orval (generates api.ts, schemas)
- **Validation**: Zod schemas in api-zod package
- **Type Safety**: Full end-to-end TypeScript

---

## File Naming Conventions

- **Components**: PascalCase (e.g., `Dashboard.tsx`, `SideBar.tsx`)
- **Hooks**: camelCase with `use` prefix (e.g., `useMobile.ts`, `useToast.ts`)
- **Pages**: PascalCase (e.g., `dashboard.tsx`, `employees.tsx`)
- **Utilities**: camelCase (e.g., `utils.ts`, `api.ts`)
- **Databases/ORM**: camelCase (e.g., `drizzle.config.ts`)
- **Config Files**: kebab-case or camelCase (e.g., `vite.config.ts`, `tsconfig.json`, `orval.config.ts`)

---

## Key Entry Points

### Development
- **API Server**: `artifacts/api-server/src/index.ts` (port likely :3000)
- **Dashboard**: `artifacts/finance-dashboard/src/main.tsx` → App.tsx
- **Mockup Sandbox**: `artifacts/mockup-sandbox/src/main.tsx` → App.tsx

### Configuration
- **TypeScript Base Config**: `tsconfig.base.json`
- **Database Config**: `lib/db/drizzle.config.ts`
- **API Generation Config**: `lib/api-spec/orval.config.ts`
- **Vite Config** (Frontend): `artifacts/finance-dashboard/vite.config.ts`
- **Build Config** (Backend): `artifacts/api-server/build.mjs`

---

## Notes

- **Workspace Safety**: Minimum 1-day npm package release age enforced for security
- **TypeScript Strict Mode**: Enabled across the workspace
- **ESM Only**: All packages use ES modules (`"type": "module"`)
- **Middleware Stack**: Express app uses CORS, JSON parsing, structured logging
- **UI Components**: 30+ Radix-based components available for dashboard
- **Type Safety**: Full end-to-end TypeScript from API spec → generated code → React components

---

## Quick Start Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm -r --filter @workspace/api-server run dev
pnpm -r --filter @workspace/finance-dashboard run dev

# Type checking
pnpm typecheck

# Build for production
pnpm build

# Database operations
pnpm -r --filter @workspace/db run push

# Code generation (API)
pnpm -r --filter @workspace/api-spec run codegen
```

---

This index provides a complete overview of the Finance-Assistant codebase structure, packages, technologies, and architectural patterns.
