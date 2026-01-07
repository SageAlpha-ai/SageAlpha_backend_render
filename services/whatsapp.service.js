const twilio = require('twilio');

// Initialize Twilio client using environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

let twilioClient = null;

if (accountSid && authToken) {
  twilioClient = twilio(accountSid, authToken);
  console.log('[WhatsApp] Twilio client initialized');
} else {
  console.warn('[WhatsApp] Twilio credentials not configured. WhatsApp sending will fail.');
}

/**
 * Send WhatsApp report message with PDF file attachment
 * @param {Object} params
 * @param {string} params.phone - Phone number in format: 91XXXXXXXXXX (no +)
 * @param {string} params.userName - Subscriber name
 * @param {string} params.reportName - Report name/company name
 * @param {string} params.pdfUrl - Public URL to PDF file (must be publicly accessible)
 * @returns {Promise<Object>} Twilio message object with SID
 */
async function sendWhatsAppReport({ phone, userName, reportName, pdfUrl }) {
  if (!twilioClient) {
    throw new Error('Twilio client not initialized. Please configure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
  }

  // Format phone number: ensure it starts with country code (no +)
  // Expected format: 91XXXXXXXXXX (e.g., 919876543210)
  let formattedPhone = phone.replace(/[^\d]/g, ''); // Remove all non-digits
  
  // If phone doesn't start with country code, assume it's Indian (91)
  if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
    formattedPhone = `91${formattedPhone}`;
  }
  
  // Add whatsapp: prefix for Twilio
  const toNumber = `whatsapp:+${formattedPhone}`;

  // Construct message body (without URL since PDF is attached)
  const messageBody = `Hello ${userName} 👋

Your ${reportName} report is ready 📄

– SageAlpha`;

  try {
    // Send WhatsApp message with PDF media attachment
    const message = await twilioClient.messages.create({
      body: messageBody,
      from: whatsappFrom,
      to: toNumber,
      mediaUrl: [pdfUrl] // Twilio will download and send the PDF file
    });

    console.log(`[WhatsApp] Message with PDF attachment sent successfully. SID: ${message.sid}`);
    return {
      success: true,
      messageSid: message.sid,
      status: message.status
    };
  } catch (error) {
    console.error('[WhatsApp] Error sending message:', error);
    throw {
      code: error.code,
      message: error.message,
      status: error.status
    };
  }
}

module.exports = {
  sendWhatsAppReport
};

