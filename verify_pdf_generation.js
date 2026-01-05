const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { generateReportHtml } = require('./reportTemplate');

// Mock Data matching the structure in generateEquityResearchHTML
const mockData = {
    "companyName": "CRH PLC",
    "ticker": "CRH",
    "subtitle": "Infrastructure Super-Cycle Beneficiary & Valuation Dislocation",
    "date": "November 21, 2025",
    "sector": "Building Materials",
    "region": "United States",
    "rating": "OVERWEIGHT",
    "targetPrice": "$142.00",
    "targetPeriod": "12-18M",
    "currentPrice": "$108.35",
    "upside": "+31%",
    "marketCap": "$73.8 bn",
    "entValue": "$88.8 bn",
    "evEbitda": "10.6x",
    "pe": "17.4x",
    "investmentThesis": [
        {
            "title": "Infrastructure Super-Cycle Beneficiary",
            "content": "CRH is uniquely positioned to capitalize on peak funding years for the IIJA and CHIPS Act (2026-2027). Its integrated 'solutions' model—spanning aggregates, cement, and paving—captures higher share-of-wallet on complex public projects than pure-play peers."
        },
        {
            "title": "Valuation Dislocation Opportunity",
            "content": "Despite transitioning its primary listing to the NYSE and becoming a U.S. domestic issuer, CRH trades at a ~6 turn discount to U.S. aggregates peers (MLM, VMC) on 2026E EV/EBITDA. We expect this gap to narrow as the market fully digests its re-rating as a U.S. infrastructure leader."
        },
        {
            "title": "Capital Allocation Discipline",
            "content": "The company continues to compound value through accretive bolt-on M&A ($3.5bn YTD) while simultaneously returning cash to shareholders via a reliable dividend and sequential buyback tranches."
        }
    ],
    "highlights": [
        {
            "title": "Strong Q3 Delivery",
            "content": "CRH reported Q3 2025 revenue of $11.1bn (+5% YoY) and Adjusted EBITDA of $2.7bn (+10% YoY). EBITDA margins expanded 100bps to 24.3%, driven by pricing discipline and operational efficiencies."
        },
        {
            "title": "Guidance Raised",
            "content": "Management raised the midpoint of FY25 Adjusted EBITDA guidance to a range of $7.6-$7.7bn (previously $7.5-$7.7bn), signaling confidence in Q4 backlog execution."
        }
    ],
    "financialSummary": [
        { "year": "2024A", "rev": "34,950", "ebitda": "6,200", "mrg": "17.7%", "eps": "4.65", "fcf": "3.85" },
        { "year": "2025E", "rev": "36,200", "ebitda": "7,650", "mrg": "21.1%", "eps": "5.60", "fcf": "4.50" },
        { "year": "2026E", "rev": "40,100", "ebitda": "8,420", "mrg": "21.0%", "eps": "6.23", "fcf": "5.10" }
    ],
    "analyst": "SageAlpha Research Team",
    "analystEmail": "research@sagealpha.ai",
    "ratingHistory": [
        { "event": "Init Overweight", "date": "Jun 2023 @ $45" },
        { "event": "Raised PT", "date": "Mar 2025 @ $95" },
        { "event": "Maintained", "date": "Nov 2025" }
    ]
};

async function convertHtmlToPdf(htmlContent) {
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();
    return pdfBuffer;
}

async function verify() {
    console.log("Starting PDF generation verification...");

    // Load logo
    let logoBase64 = "";
    try {
        const logoPath = path.join(__dirname, "../SAGEALPHA_REACT_FRONTEND/frontend/public/logo/sagealpha-logo.png");
        logoBase64 = fs.readFileSync(logoPath).toString('base64');
        console.log("Logo loaded successfully.");
    } catch (err) {
        console.warn("Logo load failed:", err.message);
    }

    const html = generateReportHtml(mockData, logoBase64);
    fs.writeFileSync('verify_report.html', html);
    console.log("HTML report saved to verify_report.html");

    const pdfBuffer = await convertHtmlToPdf(html);
    fs.writeFileSync('verify_report.pdf', pdfBuffer);
    console.log("PDF report saved to verify_report.pdf");

    console.log("Verification complete. Please inspect verify_report.pdf.");
}

verify().catch(console.error);
