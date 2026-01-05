# Azure Production Fixes - Complete Summary

## Overview
This document details all fixes applied to make the SageAlpha backend fully compatible with Azure App Service (Linux) production environment.

---

## 1. ENVIRONMENT VARIABLES & SECRETS

### ISSUE
- Hardcoded MongoDB connection string with credentials
- Hardcoded Azure URLs
- Hardcoded secrets (JWT, Session)
- No validation for required production variables

### ROOT CAUSE
Azure App Service requires all configuration via Application Settings. Hardcoded values break security and portability.

### FIX
**File: `index.js`**

1. **MongoDB Connection** (Lines 99-109)
   - Removed hardcoded connection string
   - Added validation: exits if `MONGO_URL` missing in production
   - Uses `process.env.MONGO_URL` exclusively

2. **JWT Secret** (Lines 348-352, 451-456, 493-497)
   - Removed hardcoded fallback secrets
   - Added validation: returns 500 if missing in production
   - Uses `process.env.JWT_SECRET`

3. **Session Secret** (Lines 280-290)
   - Removed hardcoded fallback
   - Added validation: exits if missing in production
   - Uses `process.env.SESSION_SECRET` or `process.env.FLASK_SECRET`

4. **Base URLs** (Lines 1150-1158, 838-846)
   - Removed hardcoded Azure URL
   - Uses `process.env.BACKEND_URL` or `process.env.WEBSITE_HOSTNAME`
   - Falls back to request host if not set

### WHY THIS WORKS IN PRODUCTION
- Azure App Service injects environment variables from Application Settings
- No secrets in code (security best practice)
- Fails fast on missing critical config (prevents runtime errors)

---

## 2. FILE SYSTEM & PATHS (AZURE LINUX)

### ISSUE
- Relative paths break in Azure Linux sandbox
- Assumes writable root filesystem
- Case-sensitive path issues
- Files stored in app directory (ephemeral)

### ROOT CAUSE
Azure App Service Linux uses a read-only filesystem except `/tmp` and specific mounted volumes. Relative paths fail.

### FIX
**File: `index.js`**

1. **Azure-Safe Directory Structure** (Lines 15-50)
   ```javascript
   const DATA_DIR = IS_PRODUCTION 
     ? (process.env.DATA_DIR || path.join(process.env.TMPDIR || '/tmp', 'sagealpha-data'))
     : __dirname;
   
   const REPORTS_DIR = IS_PRODUCTION
     ? (process.env.REPORTS_DIR || path.join(DATA_DIR, 'generated_reports'))
     : path.join(__dirname, "generated_reports");
   
   const UPLOADS_DIR = IS_PRODUCTION
     ? (process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads'))
     : path.join(__dirname, "uploads");
   
   const VECTOR_STORE_DIR = IS_PRODUCTION
     ? (process.env.VECTOR_STORE_DIR || path.join(DATA_DIR, 'vector_store_data'))
     : path.join(__dirname, "vector_store_data");
   ```

2. **Playwright Browser Path** (Lines 11-16)
   ```javascript
   const PLAYWRIGHT_BROWSERS_PATH = IS_PRODUCTION 
     ? (process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.TMPDIR || '/tmp', 'playwright-browsers'))
     : path.join(__dirname, 'playwright-browsers');
   ```

3. **All Paths Use `path.join()`** - No relative paths

### WHY THIS WORKS IN PRODUCTION
- Uses `/tmp` (writable in Azure) as fallback
- Supports custom paths via env vars (for Azure File Shares)
- Absolute paths prevent sandbox issues
- Case-sensitive paths work on Linux

---

## 3. CORS CONFIGURATION

### ISSUE
- Hardcoded allowed origins
- Not configurable for different environments
- Production would fail if frontend URL changes

### ROOT CAUSE
CORS origins must match exactly. Hardcoded values break when frontend domain changes.

### FIX
**File: `index.js`** (Lines 153-160)

```javascript
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : IS_PRODUCTION 
    ? [] // Production MUST set ALLOWED_ORIGINS
    : ["http://localhost:5173", "http://localhost:3000"]; // Dev fallback
```

### WHY THIS WORKS IN PRODUCTION
- Configurable via Azure Application Settings
- Supports multiple origins (comma-separated)
- Fails safely if not configured (warns but doesn't crash)

---

## 4. PDF GENERATION (PLAYWRIGHT)

### ISSUE
- Playwright browser not configured for Azure Linux
- Missing sandbox flags
- No memory/CPU constraints
- Browser executable path issues

### ROOT CAUSE
Azure App Service Linux has no GUI, limited resources, and requires specific Chromium flags.

### FIX
**File: `index.js`** (Lines 707-760)

```javascript
const launchOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', // Overcome limited resource problems
    '--disable-accelerated-2d-canvas',
    '--disable-gpu', // Azure Linux doesn't have GPU
    '--single-process', // Run in single process mode (Azure memory constraints)
    // ... additional Azure-safe flags
  ]
};
```

### WHY THIS WORKS IN PRODUCTION
- `--no-sandbox` required for Azure Linux
- `--disable-dev-shm-usage` prevents shared memory issues
- `--single-process` reduces memory footprint
- `--disable-gpu` prevents GPU-related crashes
- Timeouts set to 60s (Azure may be slower)

---

## 5. FILE WATCHERS (CHOKIDAR)

### ISSUE
- Chokidar enabled in production
- Causes high CPU/memory usage
- File watchers unnecessary in production

### ROOT CAUSE
File watchers consume resources and are only needed in development for hot-reload.

### FIX
**File: `index.js`** (Lines 245-260)

```javascript
let nunjucksWatch = false;
if (!IS_PRODUCTION) {
  try {
    require.resolve('chokidar');
    nunjucksWatch = true;
  } catch (e) {
    console.warn('[TEMPLATES] chokidar not installed; disabling watch');
  }
} else {
  console.log('[TEMPLATES] File watching disabled in production (Azure-safe)');
}
```

### WHY THIS WORKS IN PRODUCTION
- File watching completely disabled in production
- Reduces CPU/memory usage
- Templates are pre-compiled, no need to watch

---

## 6. GLOBAL ERROR HANDLERS & PROCESS SAFETY

### ISSUE
- No unhandled promise rejection handler
- No uncaught exception handler
- No graceful shutdown
- Missing Express error handler

### ROOT CAUSE
Azure App Service requires graceful error handling. Unhandled errors cause app crashes and restarts.

### FIX
**File: `index.js`** (Lines 1370-1410)

1. **Unhandled Rejection Handler**
   ```javascript
   process.on('unhandledRejection', (reason, promise) => {
     console.error('[PROCESS] Unhandled Rejection at:', promise, 'reason:', reason);
     // In production, log but don't crash
   });
   ```

2. **Uncaught Exception Handler**
   ```javascript
   process.on('uncaughtException', (error) => {
     console.error('[PROCESS] Uncaught Exception:', error);
     process.exit(1); // Always exit on critical error
   });
   ```

3. **Graceful Shutdown**
   ```javascript
   process.on('SIGTERM', () => {
     server.close(() => {
       mongoose.connection.close().then(() => process.exit(0));
     });
   });
   ```

4. **Express Error Handler**
   ```javascript
   app.use((err, req, res, next) => {
     console.error('[EXPRESS] Error:', err);
     res.status(err.status || 500).json({ 
       error: IS_PRODUCTION ? 'Internal server error' : err.message 
     });
   });
   ```

### WHY THIS WORKS IN PRODUCTION
- Prevents app crashes from unhandled errors
- Graceful shutdown preserves data integrity
- Azure can restart app cleanly
- Error messages sanitized in production

---

## 7. SERVER BINDING

### ISSUE
- Server binds to `localhost` only
- Azure requires binding to `0.0.0.0`

### ROOT CAUSE
Azure App Service routes traffic through a reverse proxy. Binding to `localhost` prevents external access.

### FIX
**File: `index.js`** (Line 1412)

```javascript
server.listen(PORT, '0.0.0.0', () => {
  // ...
});
```

### WHY THIS WORKS IN PRODUCTION
- `0.0.0.0` binds to all network interfaces
- Azure reverse proxy can route traffic
- Works with Azure's networking layer

---

## REQUIRED AZURE APPLICATION SETTINGS

Set these in Azure Portal → App Service → Configuration → Application Settings:

### CRITICAL (App won't start without these):
```
MONGO_URL=mongodb+srv://...
JWT_SECRET=<strong-random-secret>
SESSION_SECRET=<strong-random-secret>
ALLOWED_ORIGINS=https://your-frontend.azurestaticapps.net,https://another-domain.com
```

### OPTIONAL (Has safe fallbacks):
```
BACKEND_URL=https://your-backend.azurewebsites.net
WEBSITE_HOSTNAME=your-backend.azurewebsites.net
DATA_DIR=/home/data (if using Azure File Share)
REPORTS_DIR=/home/data/reports (if using Azure File Share)
UPLOADS_DIR=/home/data/uploads (if using Azure File Share)
VECTOR_STORE_DIR=/home/data/vector_store (if using Azure File Share)
PLAYWRIGHT_BROWSERS_PATH=/tmp/playwright-browsers
```

### AZURE-SPECIFIC (Auto-set by Azure):
```
PORT=<auto-set>
WEBSITE_SITE_NAME=<auto-set>
TMPDIR=/tmp
```

---

## STARTUP COMMANDS

No special startup commands required. Azure will run:
```
npm start
```

Which executes:
```
node index.js
```

---

## VALIDATION CHECKLIST

✅ **Environment Variables**
- [x] All secrets moved to env vars
- [x] Production validation added
- [x] Safe fallbacks for dev only

✅ **CORS & Networking**
- [x] Origins configurable via env
- [x] Proper OPTIONS handling
- [x] Credentials support

✅ **File System & Paths**
- [x] All paths use `path.join()`
- [x] Azure-safe directories (`/tmp` fallback)
- [x] No relative paths
- [x] Case-sensitive compatible

✅ **PDF Generation**
- [x] Azure-safe Playwright config
- [x] Sandbox flags set
- [x] Memory constraints
- [x] Timeout handling

✅ **File Watchers**
- [x] Disabled in production
- [x] Dev-only activation

✅ **Process & Memory Safety**
- [x] Unhandled rejection handler
- [x] Uncaught exception handler
- [x] Graceful shutdown
- [x] Express error handler

✅ **API Stability**
- [x] All endpoints have try/catch
- [x] Proper HTTP status codes
- [x] No hanging requests
- [x] Production-safe logging

✅ **Server Binding**
- [x] Binds to `0.0.0.0`
- [x] Uses `process.env.PORT`

---

## TESTING IN PRODUCTION

1. **Health Check**: `GET /health` should return 200
2. **CORS**: Frontend should connect without CORS errors
3. **PDF Generation**: Generate a report, verify PDF downloads
4. **File Uploads**: Upload a file, verify it's saved
5. **Database**: All CRUD operations work
6. **Error Handling**: Invalid requests return proper errors

---

## NOTES

- **File Persistence**: Files in `/tmp` are ephemeral. For persistent storage, use Azure File Share and set `DATA_DIR`, `REPORTS_DIR`, etc.
- **Browser Installation**: Playwright browsers are installed during `npm install` (postinstall script). Ensure `PLAYWRIGHT_BROWSERS_PATH` is writable.
- **Memory Limits**: Azure App Service has memory limits. PDF generation uses significant memory. Monitor usage.
- **Cold Starts**: First PDF generation may be slow (browser startup). Subsequent requests are faster.

---

## SUPPORT

If issues persist:
1. Check Azure App Service logs: `az webapp log tail --name <app-name> --resource-group <rg-name>`
2. Verify all required environment variables are set
3. Check Playwright browser installation: `ls -la $PLAYWRIGHT_BROWSERS_PATH`
4. Monitor memory usage in Azure Portal

---

**Last Updated**: 2024
**Version**: 3.0.0
**Status**: ✅ Production Ready

