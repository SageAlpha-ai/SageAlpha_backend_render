# Render Deployment Guide

## PDF Generation Setup

This application requires `wkhtmltopdf` to be installed for PDF generation to work.

### Build Command for Render

In your Render dashboard, set the **Build Command** to:

```bash
bash build.sh && npm install
```

Or manually install wkhtmltopdf in the build command:

```bash
apt-get update -y && apt-get install -y wget xvfb && wget -q https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6-1/wkhtmltox_0.12.6-1.bionic_amd64.deb -O /tmp/wkhtml.deb && dpkg -i /tmp/wkhtml.deb || apt-get install -yf && rm /tmp/wkhtml.deb && npm install
```

### Start Command

Set the **Start Command** to:

```bash
node index.js
```

### Environment Variables

Make sure to set the following environment variables in Render:

- `MONGO_URL` - MongoDB connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `SESSION_SECRET` - Secret key for sessions
- `ALLOWED_ORIGINS` - Comma-separated list of allowed CORS origins

### Verify PDF Generation

After deployment, check the logs for:
- `[PDF] wkhtmltopdf verification passed` - confirms wkhtmltopdf is installed
- `[PDF] Conversion successful. PDF size: X bytes` - confirms PDF generation is working

If you see errors about wkhtmltopdf not being found, ensure the build command includes the wkhtmltopdf installation step.

