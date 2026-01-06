/**
 * PDF Generator using wkhtmltopdf
 * Converts HTML content directly to PDF without external requests
 * Works both locally and on Azure
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

// Determine wkhtmltopdf binary path based on platform

function getWkhtmltopdfPath() {
  const log = (msg) => console.warn(`[WKHTMLTOPDF] ${msg}`);

  const platform = os.platform();

  // 1️⃣ Check for custom environment variable (but verify it exists)
  if (process.env.WKHTMLTOPDF_PATH) {
    const customPath = process.env.WKHTMLTOPDF_PATH.trim();
    // Only use custom path if file actually exists (for absolute paths)
    if (customPath.startsWith('/') || customPath.startsWith('C:') || customPath.includes('\\')) {
      if (fs.existsSync(customPath)) {
        log(`Using custom path: ${customPath}`);
        return customPath;
      } else {
        log(`Custom path set but file not found: ${customPath}, will try standard locations`);
      }
    } else {
      // Relative path or PATH command - trust it
      log(`Using custom path (will use PATH): ${customPath}`);
      return customPath;
    }
  }

  // 2️⃣ Windows paths
  if (platform === "win32") {
    const windowsPaths = [
      "C:\\Program Files\\wkhtmltopdf\\bin\\wkhtmltopdf.exe",
      "C:\\Program Files (x86)\\wkhtmltopdf\\bin\\wkhtmltopdf.exe",
      path.join(process.cwd(), "wkhtmltopdf.exe"),
      "wkhtmltopdf.exe", // Check PATH
    ];

    for (const p of windowsPaths) {
      if (p === "wkhtmltopdf.exe" || fs.existsSync(p)) {
        if (fs.existsSync(p)) {
          log(`Detected Windows binary at: ${p}`);
        }
        return p;
      }
    }
  } 
  else {
    // 3️⃣ Linux / Render paths (check standard locations first)
    const linuxPaths = [
      "/usr/bin/wkhtmltopdf",        // Standard Debian/Ubuntu location (Render uses this)
      "/usr/local/bin/wkhtmltopdf",  // Alternative location
      path.join(process.cwd(), "bin/wkhtmltopdf"),
      "wkhtmltopdf",                 // PATH fallback
    ];

    for (const p of linuxPaths) {
      // For absolute paths, check if file exists
      if (p.startsWith("/")) {
        if (fs.existsSync(p)) {
          log(`Detected Linux binary at: ${p}`);
          return p;
        }
      } else {
        // For PATH-only entries, return as-is (will be verified later)
        log(`Using PATH lookup: ${p}`);
        return p;
      }
    }
  }

  // 4️⃣ PATH fallback (final fallback)
  log("Using PATH fallback: wkhtmltopdf");
  return "wkhtmltopdf";
}

/**
 * Verify that wkhtmltopdf is available and executable
 * @param {string} binPath - Path to wkhtmltopdf binary
 * @returns {Promise<boolean>} True if binary is available
 */
async function verifyWkhtmltopdfInstallation(binPath) {
  try {
    // On Windows, check if file exists (for paths with .exe)
    if (os.platform() === 'win32' && binPath.endsWith('.exe')) {
      // If it's a full path (not just 'wkhtmltopdf.exe'), check if file exists
      if (binPath.includes('\\') || binPath.includes('/')) {
        if (!fs.existsSync(binPath)) {
          return false;
        }
      }
    } else {
      // On Unix, check if file exists for absolute paths
      if (binPath.startsWith('/') && !fs.existsSync(binPath)) {
        return false;
      }
    }

    // Try to execute --version to verify the binary works
    const testCommand = `"${binPath}" --version`;
    await execAsync(testCommand, { timeout: 5000 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get installation instructions based on platform
 * @returns {string} Installation instructions
 */
function getInstallationInstructions() {
  const platform = os.platform();
  
  if (platform === 'win32') {
    return `
wkhtmltopdf is not installed or not found in PATH.

To install on Windows:
1. Download wkhtmltopdf from: https://wkhtmltopdf.org/downloads.html
2. Install it to the default location (C:\\Program Files\\wkhtmltopdf\\bin\\)
3. Or set WKHTMLTOPDF_PATH environment variable to the full path of wkhtmltopdf.exe

Alternatively, you can add wkhtmltopdf to your system PATH.
`;
  } else {
    return `
wkhtmltopdf is not installed or not found in PATH.

To install on Linux:
  sudo apt-get install wkhtmltopdf  # Ubuntu/Debian
  sudo yum install wkhtmltopdf      # CentOS/RHEL

To install on macOS:
  brew install wkhtmltopdf

Or set WKHTMLTOPDF_PATH environment variable to the full path of wkhtmltopdf binary.
`;
  }
}

/**
 * Convert HTML content to PDF using wkhtmltopdf
 * @param {string} htmlContent - HTML content to convert
 * @returns {Promise<Buffer>} PDF buffer
 */
async function convertHtmlToPdf(htmlContent) {
  console.log(`[PDF] Starting PDF conversion, HTML content length: ${htmlContent.length} bytes`);
  const wkhtmltopdfPath = getWkhtmltopdfPath();
  console.log(`[PDF] Using wkhtmltopdf path: ${wkhtmltopdfPath}`);
  
  // Verify wkhtmltopdf is available before proceeding
  console.log(`[PDF] Verifying wkhtmltopdf installation...`);
  const isAvailable = await verifyWkhtmltopdfInstallation(wkhtmltopdfPath);
  if (!isAvailable) {
    const instructions = getInstallationInstructions();
    console.error(`[PDF] wkhtmltopdf not found at: ${wkhtmltopdfPath}`);
    console.error(`[PDF] Installation instructions: ${instructions}`);
    throw new Error(`wkhtmltopdf is not installed or not found. Please install wkhtmltopdf or set WKHTMLTOPDF_PATH environment variable. See server logs for installation instructions.`);
  }
  console.log(`[PDF] wkhtmltopdf verification passed`);
  
  // Create temporary files
  const tempDir = os.tmpdir();
  const tempHtmlFile = path.join(tempDir, `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.html`);
  const tempPdfFile = path.join(tempDir, `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.pdf`);

  try {
    // Write HTML content to temporary file
    fs.writeFileSync(tempHtmlFile, htmlContent, 'utf8');

    // Build wkhtmltopdf command with required options
    // DPI: 140, margins: 0, page size: A4, disable smart shrinking
    const options = [
      `--dpi 140`,                    // DPI: 140
      `--page-size A4`,               // Page size
      `--margin-top 0`,               // No top margin
      `--margin-right 0`,             // No right margin
      `--margin-bottom 0`,            // No bottom margin
      `--margin-left 0`,              // No left margin
      `--disable-smart-shrinking`,    // Disable smart shrinking for accurate rendering
      `--print-media-type`,           // Use print media type for better CSS rendering
      `--no-outline`,                 // Disable PDF outline
      `--enable-local-file-access`,   // Allow local file access (for embedded images)
      `--enable-forms`,               // Enable forms support
      `--quiet`                       // Suppress warnings
    ];

    const command = `"${wkhtmltopdfPath}" ${options.join(' ')} "${tempHtmlFile}" "${tempPdfFile}"`;
    
    console.log(`[PDF] Converting HTML to PDF using wkhtmltopdf...`);
    console.log(`[PDF] Command: ${command.substring(0, 200)}...`);

    // Execute wkhtmltopdf
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 60000 // 60 second timeout
    });

    if (stderr && !stderr.includes('QFont::setPixelSize')) {
      // QFont warnings are common and can be ignored
      console.warn(`[PDF] wkhtmltopdf stderr: ${stderr}`);
    }

    // Check if PDF file was created
    if (!fs.existsSync(tempPdfFile)) {
      throw new Error('PDF file was not created by wkhtmltopdf');
    }

    // Read PDF buffer
    const pdfBuffer = fs.readFileSync(tempPdfFile);

    // Validate PDF buffer
    if (!pdfBuffer || pdfBuffer.length < 100) {
      throw new Error('Generated PDF is too small or invalid');
    }

    // Check PDF magic bytes (PDF files start with %PDF)
    if (pdfBuffer.toString('ascii', 0, 4) !== '%PDF') {
      throw new Error('Generated file is not a valid PDF');
    }

    console.log(`[PDF] Conversion successful. PDF size: ${pdfBuffer.length} bytes`);

    return pdfBuffer;

  } catch (error) {
    console.error(`[PDF] Conversion error:`, error.message);
    console.error(`[PDF] Error stack:`, error.stack);
    if (error.stdout) {
      console.error(`[PDF] Command stdout:`, error.stdout);
    }
    if (error.stderr) {
      console.error(`[PDF] Command stderr:`, error.stderr);
    }
    console.error(`[PDF] wkhtmltopdf path used: ${wkhtmltopdfPath}`);
    console.error(`[PDF] tempDir: ${tempDir}`);
    console.error(`[PDF] tempHtmlFile: ${tempHtmlFile}`);
    console.error(`[PDF] tempPdfFile: ${tempPdfFile}`);
    
    // Check if error is due to command not found
    const errorMsg = error.message || '';
    if (errorMsg.includes('not recognized') || errorMsg.includes('not found') || errorMsg.includes('command not found')) {
      const instructions = getInstallationInstructions();
      console.error(`[PDF] wkhtmltopdf binary not found. Installation instructions: ${instructions}`);
      throw new Error(`wkhtmltopdf is not installed or not found in PATH. Please install wkhtmltopdf or set WKHTMLTOPDF_PATH environment variable. See server logs for installation instructions.`);
    }
    
    throw new Error(`PDF generation failed: ${error.message}`);
  } finally {
    // Clean up temporary files
    try {
      if (fs.existsSync(tempHtmlFile)) {
        fs.unlinkSync(tempHtmlFile);
      }
      if (fs.existsSync(tempPdfFile)) {
        fs.unlinkSync(tempPdfFile);
      }
    } catch (cleanupError) {
      console.warn(`[PDF] Cleanup error:`, cleanupError.message);
    }
  }
}

module.exports = {
  convertHtmlToPdf,
  getWkhtmltopdfPath,
  verifyWkhtmltopdfInstallation,
  getInstallationInstructions
};

