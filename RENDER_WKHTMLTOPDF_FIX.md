# Fix for wkhtmltopdf on Render

## Issue
PDF generation fails with error: "wkhtmltopdf is not installed or not found"

## Root Cause
The `WKHTMLTOPDF_PATH` environment variable is set to `/usr/local/bin/wkhtmltopdf`, but on Render, wkhtmltopdf is typically installed to `/usr/bin/wkhtmltopdf` (standard Debian/Ubuntu location).

## Solution Options

### Option 1: Remove WKHTMLTOPDF_PATH (Recommended)
1. Go to Render Dashboard → Your Service → Environment
2. Delete the `WKHTMLTOPDF_PATH` environment variable
3. The code will auto-detect wkhtmltopdf from standard locations (`/usr/bin/wkhtmltopdf`) or PATH

### Option 2: Update WKHTMLTOPDF_PATH
1. Go to Render Dashboard → Your Service → Environment
2. Change `WKHTMLTOPDF_PATH` from `/usr/local/bin/wkhtmltopdf` to `/usr/bin/wkhtmltopdf`
3. Save and redeploy

### Option 3: Ensure Build Script Runs
Make sure your Render service Build Command includes wkhtmltopdf installation:

```bash
bash build.sh && npm install
```

Or use the manual command:
```bash
apt-get update -y && apt-get install -y wget xvfb && wget -q https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6-1/wkhtmltox_0.12.6-1.bionic_amd64.deb -O /tmp/wkhtml.deb && dpkg -i /tmp/wkhtml.deb || apt-get install -yf && rm /tmp/wkhtml.deb && npm install
```

## Verification
After redeploying, check the Render logs for:
- `[WKHTMLTOPDF] Detected Linux binary at: /usr/bin/wkhtmltopdf` (or similar)
- `[PDF] wkhtmltopdf verification passed`
- `[PDF] Conversion successful. PDF size: X bytes`

If you still see errors, check that:
1. The build command actually runs (check build logs)
2. `which wkhtmltopdf` shows the binary location in build logs
3. `wkhtmltopdf --version` succeeds in build logs

## Code Changes Made
The `pdfGenerator.js` has been updated to:
- Try standard Render location (`/usr/bin/wkhtmltopdf`) first
- Fall back to PATH if custom path doesn't exist
- Better logging for path detection

