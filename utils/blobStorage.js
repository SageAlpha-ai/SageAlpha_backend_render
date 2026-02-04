const { BlobServiceClient } = require("@azure/storage-blob");

const CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || "html-pdf-report";
const CONNECTION_STRING = process.env.AZURE_BLOB_CONNECTION_STRING;

if (!CONNECTION_STRING) {
  console.warn("[BlobStorage] AZURE_BLOB_CONNECTION_STRING not set. Blob storage operations will fail.");
}

let blobServiceClient = null;
let containerClient = null;

/**
 * Initialize blob service client and ensure container exists
 */
async function ensureContainerExists() {
  if (!CONNECTION_STRING) {
    throw new Error("AZURE_BLOB_CONNECTION_STRING environment variable is not set");
  }

  if (!blobServiceClient) {
    blobServiceClient = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
  }

  if (!containerClient) {
    containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    
    // Check if container exists, create if it doesn't
    const exists = await containerClient.exists();
    if (!exists) {
      console.log(`[BlobStorage] Container '${CONTAINER_NAME}' does not exist. Creating...`);
      await containerClient.create({
        access: 'blob' // Public read access for blobs
      });
      console.log(`[BlobStorage] Container '${CONTAINER_NAME}' created successfully`);
    }
  }

  return containerClient;
}

/**
 * Upload HTML content to Azure Blob Storage
 * @param {string} reportId - Report ID (without .html extension)
 * @param {string} htmlContent - HTML content as string
 * @returns {Promise<string>} - Blob file name (reportId.html)
 */
async function uploadHtmlToBlob(reportId, htmlContent) {
  try {
    const container = await ensureContainerExists();
    const blobName = `${reportId}.html`;
    const blockBlobClient = container.getBlockBlobClient(blobName);

    await blockBlobClient.upload(htmlContent, htmlContent.length, {
      blobHTTPHeaders: { 
        blobContentType: "text/html; charset=utf-8" 
      }
    });

    console.log(`[BlobStorage] Uploaded HTML to blob: ${blobName}`);
    return blobName; // Return just the filename
  } catch (error) {
    console.error(`[BlobStorage] Error uploading HTML to blob:`, error.message);
    throw new Error(`Failed to upload HTML to blob storage: ${error.message}`);
  }
}

/**
 * Download HTML content from Azure Blob Storage
 * @param {string} reportId - Report ID (without .html extension)
 * @returns {Promise<string>} - HTML content as string, null if not found
 */
async function getHtmlFromBlob(reportId) {
  try {
    const container = await ensureContainerExists();
    const blobName = `${reportId}.html`;
    const blockBlobClient = container.getBlockBlobClient(blobName);

    // Check if blob exists
    const exists = await blockBlobClient.exists();
    if (!exists) {
      console.error(`[BlobStorage] Blob not found: ${blobName}`);
      return null;
    }

    // Download blob content
    const downloadResponse = await blockBlobClient.download(0);
    const chunks = [];
    
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(chunk);
    }

    // Convert buffer chunks to string
    const buffer = Buffer.concat(chunks);
    const htmlContent = buffer.toString('utf-8');

    console.log(`[BlobStorage] Downloaded HTML from blob: ${blobName} (${htmlContent.length} bytes)`);
    return htmlContent;
  } catch (error) {
    console.error(`[BlobStorage] Error downloading HTML from blob:`, error.message);
    throw new Error(`Failed to download HTML from blob storage: ${error.message}`);
  }
}

/**
 * Delete HTML blob from Azure Blob Storage
 * @param {string} reportId - Report ID (without .html extension)
 * @returns {Promise<boolean>} - True if deleted, false if not found
 */
async function deleteHtmlFromBlob(reportId) {
  try {
    const container = await ensureContainerExists();
    const blobName = `${reportId}.html`;
    const blockBlobClient = container.getBlockBlobClient(blobName);

    const exists = await blockBlobClient.exists();
    if (!exists) {
      console.log(`[BlobStorage] Blob not found for deletion: ${blobName}`);
      return false;
    }

    await blockBlobClient.delete();
    console.log(`[BlobStorage] Deleted blob: ${blobName}`);
    return true;
  } catch (error) {
    console.error(`[BlobStorage] Error deleting blob:`, error.message);
    throw new Error(`Failed to delete blob: ${error.message}`);
  }
}

/**
 * Upload PDF buffer to Azure Blob Storage
 * @param {string} reportId - Report ID (without .pdf extension)
 * @param {Buffer} pdfBuffer - PDF content as Buffer
 * @returns {Promise<string>} - Blob file name (reportId.pdf)
 */
async function uploadPdfToBlob(reportId, pdfBuffer) {
  try {
    const container = await ensureContainerExists();
    const blobName = `${reportId}.pdf`;
    const blockBlobClient = container.getBlockBlobClient(blobName);

    await blockBlobClient.upload(pdfBuffer, pdfBuffer.length, {
      blobHTTPHeaders: { 
        blobContentType: "application/pdf" 
      }
    });

    console.log(`[BlobStorage] Uploaded PDF to blob: ${blobName}`);
    return blobName; // Return just the filename
  } catch (error) {
    console.error(`[BlobStorage] Error uploading PDF to blob:`, error.message);
    throw new Error(`Failed to upload PDF to blob storage: ${error.message}`);
  }
}

/**
 * Get public/signed URL for a blob (PDF or HTML)
 * @param {string} blobName - Blob name (e.g., "reportId.pdf" or "reportId.html")
 * @param {number} expiryHours - URL expiry in hours (default: 24)
 * @returns {Promise<string>} - Public URL to the blob
 */
async function getBlobUrl(blobName, expiryHours = 24) {
  try {
    const container = await ensureContainerExists();
    const blockBlobClient = container.getBlockBlobClient(blobName);

    // Check if blob exists
    const exists = await blockBlobClient.exists();
    if (!exists) {
      throw new Error(`Blob not found: ${blobName}`);
    }

    // Generate SAS (Shared Access Signature) URL with read permissions
    // This works even if the container is private
    const { BlobSASPermissions, StorageSharedKeyCredential, generateBlobSASQueryParameters } = require('@azure/storage-blob');
    
    const expiresOn = new Date();
    expiresOn.setHours(expiresOn.getHours() + expiryHours);

    // Extract account name and key from connection string
    const accountNameMatch = CONNECTION_STRING.match(/AccountName=([^;]+)/);
    const accountKeyMatch = CONNECTION_STRING.match(/AccountKey=([^;]+)/);
    
    if (!accountNameMatch || !accountKeyMatch) {
      // Fallback: return direct URL (works if container is public)
      const directUrl = blockBlobClient.url;
      console.warn(`[BlobStorage] Using direct URL (container must be public): ${directUrl}`);
      return directUrl;
    }

    const accountName = accountNameMatch[1];
    const accountKey = accountKeyMatch[1];

    // Create shared key credential
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

    // Generate SAS query parameters
    const sasQueryParams = generateBlobSASQueryParameters(
      {
        containerName: CONTAINER_NAME,
        blobName: blobName,
        permissions: BlobSASPermissions.parse('r'), // Read only
        expiresOn: expiresOn
      },
      sharedKeyCredential
    );

    // Construct full URL with SAS token
    const blobUrl = blockBlobClient.url;
    const sasUrl = `${blobUrl}?${sasQueryParams.toString()}`;

    console.log(`[BlobStorage] Generated SAS URL for ${blobName} (expires in ${expiryHours} hours)`);
    return sasUrl;
  } catch (error) {
    console.error(`[BlobStorage] Error generating blob URL:`, error.message);
    
    // Fallback: try direct URL if container might be public
    try {
      const container = await ensureContainerExists();
      const blockBlobClient = container.getBlockBlobClient(blobName);
      const directUrl = blockBlobClient.url;
      console.warn(`[BlobStorage] Using direct URL as fallback (may not work if container is private): ${directUrl}`);
      return directUrl;
    } catch (fallbackError) {
      throw new Error(`Failed to generate blob URL: ${error.message}`);
    }
  }
}

module.exports = {
  uploadHtmlToBlob,
  getHtmlFromBlob,
  deleteHtmlFromBlob,
  uploadPdfToBlob,
  getBlobUrl
};