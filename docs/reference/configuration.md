# Configuration

Najm requires Node.js 20 or newer. Compiler and server integrations support Vite 5+. Register `najm()` in `vite.config.ts`; keep `.najm` files under application source and route files under `src/pages`.

The server reads `PORT` for preview serving. Production builds separate server output from browser assets. Do not rewrite hashed asset names or move island modules without preserving their public URL mapping.
