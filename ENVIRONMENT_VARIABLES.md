# Environment Variables Reference

## 🔴 CRITICAL (Required in Production)

These must be set in Azure App Service Application Settings. The app will **exit** or **fail** if these are missing in production.

### 1. `MONGO_URL`
- **Description**: MongoDB Atlas connection string
- **Format**: `mongodb+srv://username:password@cluster.mongodb.net/database?appName=AppName`
- **Example**: `mongodb+srv://user:pass@cluster.abc123.mongodb.net/sagealpha?appName=SageAlpha`
- **Required**: ✅ YES (Production)
- **Where to set**: Azure Portal → App Service → Configuration → Application Settings

### 2. `JWT_SECRET`
- **Description**: Secret key for signing JWT tokens
- **Format**: Strong random string (minimum 32 characters)
- **Example**: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0`
- **Required**: ✅ YES (Production)
- **How to generate**: 
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

### 3. `SESSION_SECRET` (or `FLASK_SECRET`)
- **Description**: Secret key for Express sessions
- **Format**: Strong random string (minimum 32 characters)
- **Example**: `x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0`
- **Required**: ✅ YES (Production)
- **Note**: Can use `FLASK_SECRET` as alias (for backward compatibility)
- **How to generate**: 
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

### 4. `ALLOWED_ORIGINS`
- **Description**: Comma-separated list of allowed CORS origins
- **Format**: `origin1,origin2,origin3` (no spaces, or spaces will be trimmed)
- **Example**: `https://blue-cliff-080a39310.4.azurestaticapps.net,https://yourdomain.com`
- **Required**: ✅ YES (Production)
- **Note**: Must include your frontend URL(s)

---

## 🟡 OPTIONAL (Recommended but has fallbacks)

These have safe defaults but should be set for production best practices.

### 5. `BACKEND_URL`
- **Description**: Public URL of your backend (for generating download links)
- **Format**: `https://your-backend.azurewebsites.net`
- **Example**: `https://v5-backend-dnfzbxfccxecgdbw.centralus-01.azurewebsites.net`
- **Required**: ❌ NO (falls back to request host)
- **When to set**: If you want explicit control over generated URLs

### 6. `WEBSITE_HOSTNAME`
- **Description**: Azure auto-sets this, but you can override
- **Format**: `your-app-name.azurewebsites.net`
- **Example**: `v5-backend-dnfzbxfccxecgdbw.centralus-01.azurewebsites.net`
- **Required**: ❌ NO (Azure sets automatically)
- **Note**: Usually auto-configured by Azure

---

## 🟢 OPTIONAL (File Storage - Only if using Azure File Share)

Set these only if you want persistent file storage (not ephemeral `/tmp`).

### 7. `DATA_DIR`
- **Description**: Base directory for application data
- **Format**: `/home/data` or Azure File Share mount path
- **Example**: `/home/data` or `/mnt/fileshare/sagealpha`
- **Required**: ❌ NO (defaults to `/tmp/sagealpha-data` in production)
- **Note**: Files in `/tmp` are **ephemeral** (lost on restart). Use Azure File Share for persistence.

### 8. `REPORTS_DIR`
- **Description**: Directory for generated PDF reports
- **Format**: `/home/data/reports` or custom path
- **Example**: `/home/data/generated_reports`
- **Required**: ❌ NO (defaults to `DATA_DIR/generated_reports`)
- **Note**: Set if you want reports in a specific location

### 9. `UPLOADS_DIR`
- **Description**: Directory for uploaded files
- **Format**: `/home/data/uploads` or custom path
- **Example**: `/home/data/uploads`
- **Required**: ❌ NO (defaults to `DATA_DIR/uploads`)
- **Note**: Set if you want uploads in a specific location

### 10. `VECTOR_STORE_DIR`
- **Description**: Directory for vector store embeddings
- **Format**: `/home/data/vector_store` or custom path
- **Example**: `/home/data/vector_store_data`
- **Required**: ❌ NO (defaults to `DATA_DIR/vector_store_data`)
- **Note**: Set if you want vector store in a specific location

### 11. `PLAYWRIGHT_BROWSERS_PATH`
- **Description**: Path where Playwright browsers are installed
- **Format**: `/tmp/playwright-browsers` or custom path
- **Example**: `/tmp/playwright-browsers`
- **Required**: ❌ NO (defaults to `/tmp/playwright-browsers` in production)
- **Note**: Must be writable. `/tmp` is fine for ephemeral browsers.

### 12. `SMTP_HOST`
- **Description**: SMTP server hostname for sending emails (for forgot password OTP)
- **Format**: SMTP server address
- **Example (Gmail)**: `smtp.gmail.com`
- **Example (Outlook)**: `smtp-mail.outlook.com`
- **Example (SendGrid)**: `smtp.sendgrid.net`
- **Required**: ❌ NO (email functionality will be disabled if not set)
- **Note**: Required only if using forgot password feature

### 13. `SMTP_PORT`
- **Description**: SMTP server port
- **Format**: Port number (usually 587 for TLS, 465 for SSL)
- **Example**: `587` or `465`
- **Required**: ❌ NO (defaults to 587)
- **Note**: Use 587 for STARTTLS, 465 for SSL

### 14. `SMTP_USER`
- **Description**: SMTP authentication username (usually your email address)
- **Format**: Email address
- **Example**: `your-email@gmail.com`
- **Required**: ❌ NO (must be set if SMTP_HOST is set)
- **Note**: For Gmail, you may need to use an App Password instead of your regular password

### 15. `SMTP_PASS`
- **Description**: SMTP authentication password
- **Format**: Password or app-specific password
- **Example**: `your-app-password` (for Gmail)
- **Required**: ❌ NO (must be set if SMTP_HOST is set)
- **Note**: 
  - For Gmail: Use an App Password (not your regular password)
  - Enable 2FA and generate App Password in Google Account settings
  - For other providers: Use your email password or app-specific password

### 16. `SMTP_FROM`
- **Description**: "From" email address for outgoing emails
- **Format**: Email address with optional name
- **Example**: `SageAlpha <no-reply@sagealpha.ai>` or `no-reply@sagealpha.ai`
- **Required**: ❌ NO (defaults to `SageAlpha <no-reply@sagealpha.ai>`)

### 17. `SMTP_SECURE`
- **Description**: Use SSL/TLS for SMTP connection
- **Format**: `true` or `false`
- **Example**: `false` (for port 587 with STARTTLS) or `true` (for port 465 with SSL)
- **Required**: ❌ NO (defaults to `false` for port 587, `true` for port 465)

### 18. `OTP_EXPIRY_MINUTES`
- **Description**: OTP expiration time in minutes (for forgot password)
- **Format**: Number in minutes
- **Example**: `5`
- **Required**: ❌ NO (defaults to 5 minutes)

### 19. `MARKET_CHATTER_AI_BASE_URL`
- **Description**: Base URL for the external Market Chatter AI service
- **Format**: `https://market-chatter-ai.onrender.com`
- **Example**: `https://market-chatter-ai.onrender.com`
- **Required**: ❌ NO (has default)
- **Default**: `https://market-chatter-ai.onrender.com`
- **Where to set**: Azure Portal → App Service → Configuration → Application Settings (optional)

### 20. `AGENTIC_AI_BASE_URL`
- **Description**: Base URL for the external agentic AI service (market chatter intelligence)
- **Format**: Full URL without trailing slash
- **Example**: `https://postgres-host-localhost.onrender.com`
- **Required**: ❌ NO (defaults to `https://postgres-host-localhost.onrender.com`)
- **Note**: Required only if using the market intelligence feature. Set this if the default URL changes or you want to use a different service.

---

## 🔵 AZURE AUTO-SET (Don't manually set these)

Azure App Service automatically sets these. You don't need to configure them.

- `PORT` - Port number (Azure sets automatically)
- `WEBSITE_SITE_NAME` - App service name (used to detect production)
- `TMPDIR` - Temporary directory (usually `/tmp`)

---

## 📋 Quick Setup Checklist

### Minimum Required (App will start):
- [ ] `MONGO_URL`
- [ ] `JWT_SECRET`
- [ ] `SESSION_SECRET` (or `FLASK_SECRET`)
- [ ] `ALLOWED_ORIGINS`

### Recommended (Best practices):
- [ ] `BACKEND_URL` (for consistent download links)

### Optional (Only if using persistent storage):
- [ ] `DATA_DIR` (if using Azure File Share)
- [ ] `REPORTS_DIR` (if custom report location)
- [ ] `UPLOADS_DIR` (if custom upload location)

---

## 🔧 How to Set in Azure Portal

1. Go to **Azure Portal** → Your **App Service**
2. Navigate to **Configuration** → **Application Settings**
3. Click **+ New application setting**
4. Add each variable:
   - **Name**: `MONGO_URL`
   - **Value**: `mongodb+srv://...`
5. Click **Save**
6. **Restart** the app service

---

## 🧪 Testing Your Configuration

After setting environment variables, test with:

```bash
# Health check
curl https://your-backend.azurewebsites.net/health

# Should return:
# {
#   "status": "ok",
#   "service": "backend-api",
#   "message": "server is running",
#   ...
# }
```

---

## ⚠️ Security Notes

1. **Never commit secrets to Git**
2. **Use Azure Key Vault** for sensitive values (optional but recommended)
3. **Rotate secrets regularly**
4. **Use different secrets for dev/staging/prod**
5. **JWT_SECRET and SESSION_SECRET should be different values**

---

## 📝 Example Complete Configuration

```bash
# Critical
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/sagealpha?appName=SageAlpha
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
SESSION_SECRET=x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0f9e8d7c6b5a4
ALLOWED_ORIGINS=https://blue-cliff-080a39310.4.azurestaticapps.net

# Recommended
BACKEND_URL=https://v5-backend-dnfzbxfccxecgdbw.centralus-01.azurewebsites.net

# Email Configuration (Required for forgot password feature)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password-here
SMTP_FROM=SageAlpha <no-reply@sagealpha.ai>
SMTP_SECURE=false
OTP_EXPIRY_MINUTES=5

# Optional (only if using Azure File Share)
DATA_DIR=/home/data
REPORTS_DIR=/home/data/generated_reports
UPLOADS_DIR=/home/data/uploads
```

---

## 🆘 Troubleshooting

### App won't start
- Check that all **CRITICAL** variables are set
- Check Azure logs: `az webapp log tail --name <app-name>`
- Look for error messages about missing environment variables

### CORS errors
- Verify `ALLOWED_ORIGINS` includes your frontend URL
- Check for typos (no trailing slashes)
- Ensure frontend URL matches exactly (including `https://`)

### PDF generation fails
- Check `PLAYWRIGHT_BROWSERS_PATH` is writable
- Verify browsers installed: Check postinstall script ran
- Check memory limits (PDF generation is memory-intensive)

### Database connection fails
- Verify `MONGO_URL` is correct
- Check MongoDB Atlas IP whitelist (allow Azure IPs or `0.0.0.0/0`)
- Verify MongoDB user has correct permissions

### Email/OTP sending fails (Authentication failed error)
- **For Gmail**:
  1. Enable 2-Factor Authentication in your Google Account
  2. Generate an App Password: Google Account → Security → 2-Step Verification → App passwords
  3. Use the App Password (16 characters) as `SMTP_PASS`, NOT your regular password
  4. Use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`
- **For Outlook/Hotmail**:
  1. Use `SMTP_HOST=smtp-mail.outlook.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`
  2. Use your email address as `SMTP_USER` and your password as `SMTP_PASS`
- **For SendGrid**:
  1. Use `SMTP_HOST=smtp.sendgrid.net`, `SMTP_PORT=587`
  2. Use `apikey` as `SMTP_USER` and your API key as `SMTP_PASS`
- **Common issues**:
  - Error "535 5.7.8 Authentication failed": Credentials are incorrect or app password not used (for Gmail)
  - Error "EAUTH": Check SMTP_USER and SMTP_PASS are correct
  - Error "ETIMEDOUT": Check SMTP_HOST and SMTP_PORT are correct
  - Verify all SMTP environment variables are set correctly

---

### 21. `GOOGLE_CLIENT_ID`
- **Description**: Google OAuth 2.0 Client ID for "Sign in with Google" feature
- **Format**: Google OAuth Client ID string
- **Example**: `123456789-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com`
- **Required**: ❌ NO (Google OAuth will be disabled if not set)
- **How to get**: 
  1. Go to [Google Cloud Console](https://console.cloud.google.com/)
  2. Create a new project or select existing
  3. Enable Google+ API
  4. Go to "Credentials" → "Create Credentials" → "OAuth client ID"
  5. Configure OAuth consent screen
  6. Add authorized redirect URI: `https://your-backend-url/auth/google/callback`
  7. Copy the Client ID

### 22. `GOOGLE_CLIENT_SECRET`
- **Description**: Google OAuth 2.0 Client Secret for "Sign in with Google" feature
- **Format**: Google OAuth Client Secret string
- **Example**: `GOCSPX-abcdefghijklmnopqrstuvwxyz`
- **Required**: ❌ NO (must be set if GOOGLE_CLIENT_ID is set)
- **How to get**: Same as GOOGLE_CLIENT_ID, copy the Client Secret

### 23. `FRONTEND_URL` (or `CLIENT_URL`)
- **Description**: Frontend URL for OAuth redirects after Google authentication
- **Format**: Full URL without trailing slash
- **Example**: `https://blue-cliff-080a39310.4.azurestaticapps.net` or `http://localhost:5173`
- **Required**: ❌ NO (falls back to ALLOWED_ORIGINS[0] or localhost:5173 in dev)
- **Note**: Used to redirect users after Google OAuth callback

---

**Last Updated**: 2024
**Version**: 3.0.0



