/**
 * Email service using Brevo Transactional Email API
 * Replaces Nodemailer / SMTP completely (Render-safe)
 */

const SibApiV3Sdk = require("sib-api-v3-sdk");

// Read env vars
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@sagealpha.ai";
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "SageAlpha Research";

// Validate config
const isEmailConfigured = !!BREVO_API_KEY;

let emailClient = null;

if (isEmailConfigured) {
  try {
    const client = SibApiV3Sdk.ApiClient.instance;
    client.authentications["api-key"].apiKey = BREVO_API_KEY;

    emailClient = new SibApiV3Sdk.TransactionalEmailsApi();

    console.log("[EMAIL] ✓ Brevo email service initialized");
  } catch (err) {
    console.error("[EMAIL] Failed to initialize Brevo email service:", err.message);
    emailClient = null;
  }
} else {
  console.warn("[EMAIL] Brevo email not configured");
  console.warn("[EMAIL] Required: BREVO_API_KEY");
}

/**
 * Send email with optional attachments
 * @param {Object} options
 * @param {string} options.to
 * @param {string} options.subject
 * @param {string} options.html
 * @param {Array}  options.attachments [{ filename, content (Buffer) }]
 */
async function sendEmail({ to, subject, html, attachments = [] }) {
  if (!emailClient) {
    throw new Error("Email service not configured");
  }

  const payload = {
    sender: {
      email: EMAIL_FROM,
      name: EMAIL_FROM_NAME,
    },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };

  if (attachments.length > 0) {
    payload.attachment = attachments.map(att => ({
      name: att.filename,
      content: att.content.toString("base64"),
    }));
  }

  return emailClient.sendTransacEmail(payload);
}

module.exports = {
  sendEmail,
  isEmailConfigured,
};