function generateReportHtml(data, logoBase64) {
  const {
    companyName = "Company Name",
    ticker = "",
    subtitle = "",
    sector = "Sector",
    region = "Region",
    rating = "BUY",
    targetPrice = "N/A",
    targetPeriod = "12M",
    currentPrice = "N/A",
    upside = "N/A",
    marketCap = "N/A",
    entValue = "N/A",
    valuation = "N/A",
    catalysts = [],
    risks = [],
    investmentThesis = [],
    highlights = [],
    valuationMethodology = [],
    analyst = "SageAlpha Research Team",
    analystEmail = "research@sagealpha.ai",
    financialSummary = [],
    date = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  } = data;

  console.log("report data", investmentThesis, valuationMethodology, catalysts, risks);

  const logoSrc = logoBase64 ? `data:image/png;base64,${logoBase64}` : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SageAlpha Capital | ${companyName}</title>

<style>
@page {
  size: A4;
  margin: 0;
}

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  background: #fff;
  font-family: 'Segoe UI', Roboto, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.report-wrapper {
  width: 770px; /* PERFECT TWO COLUMN WIDTH */
  margin: 0 auto;
  padding: 28px;
  box-sizing: border-box;
  page-break-inside: auto; /* Allow content to break naturally */
}

/* HEADER */
.header {
  width: 100%;
  border-bottom: 3px solid #083154;
  padding-bottom: 10px;
  margin-bottom: 12px;
  page-break-after: avoid; /* Keep header with content */
  page-break-inside: avoid; /* Keep header together */
}

.header-row {
  display: flex;
  justify-content: space-between;
}

.logo-text {
  font-size: 26px;
  font-weight: 800;
  font-family: Georgia, serif;
  color: #083154;
  margin: 0;
}
.logo-text span { color: #2e8b57; }
.sub-title {
  font-size: 12px;
  font-weight: 700;
  color: #083154;
  text-transform: uppercase;
}
.date-info {
  font-size: 11px;
  text-align: right;
}

/********** FIXED TWO COLUMN LAYOUT **********/
.columns-table {
  width: 100%;
  table-layout: fixed; /* 🔒 Prevents shrinking */
  border-spacing: 0;
  page-break-inside: auto; /* Allow table to break across pages */
}

.columns-table tr {
  page-break-inside: auto; /* Allow rows to break if needed */
}

.col-left {
  width: 65%;
  vertical-align: top;
  padding-right: 20px;
  page-break-inside: auto; /* Allow left column to break naturally */
}

.col-right {
  width: 35%;
  vertical-align: top;
  padding-left: 20px;
  border-left: 1.5px solid #e0e0e0;
  page-break-inside: auto; /* Allow right column to break naturally */
}

.sidebar-col {
  /* Allow sidebar to break if content is too long, but try to keep recommendation box together */
}

.recommendation-box {
  page-break-inside: avoid;
  break-inside: avoid;
  -webkit-region-break-inside: avoid;
}

/********* CONTENT STYLES *********/
.company-name {
  font-size: 22px;
  font-weight: 700;
  color: #083154;
  margin-bottom: 6px;
}
.ticker {
  font-weight: 400;
  color: #666;
}
.company-subtitle {
  font-size: 13px;
  color: #555;
  font-style: italic;
  margin-bottom: 16px;
}

.section-title {
  margin-top: 20px;
  margin-bottom: 8px;
  padding-bottom: 3px;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  color: #083154;
  border-bottom: 2px solid #083154;
  page-break-after: avoid; /* Keep title with its content */
}

ul { 
  padding-left: 18px; 
  margin: 0; 
  page-break-inside: auto; /* Allow lists to break across pages */
}
li { 
  font-size: 12px; 
  margin-bottom: 8px; 
  line-height: 1.5;
  page-break-inside: avoid; /* Keep list items together */
}

/********** SIDEBAR **********/
.recommendation-box {
  background: #eef8f2;
  border: 2px solid #2e8b57;
  border-radius: 6px;
  padding: 14px;
  text-align: center;
  margin-bottom: 18px;
}
.rating-text {
  font-size: 18px;
  font-weight: 800;
  color: #2e8b57;
}
.price-target {
  font-size: 26px;
  font-weight: 900;
  color: #083154;
}

.metric-row {
  display: flex;
  font-size: 12px;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #e7e7e7;
}

.fin-table {
  width: 100%;
  font-size: 11px;
  border-collapse: collapse;
}
.fin-table th {
  text-align: right;
  border-bottom: 2px solid #083154;
  color: #083154;
  text-transform: uppercase;
}
.fin-table td {
  text-align: right;
  padding: 4px;
  border-bottom: 1px solid #e7e7e7;
}
.fin-table td:first-child,
.fin-table th:first-child {
  text-align: left;
  font-weight: 700;
}

/******** FOOTER ********/
.footer {
  font-size: 12px;
  text-align: left;
  margin-top: 20px;
  padding-top: 8px;
  border-top: 1px solid #d0d0d0;
  color: #555;
  page-break-inside: avoid; /* Keep footer together */
}

</style>
</head>

<body>
<div class="report-wrapper">

  <div class="header">
    <div class="header-row">
      <div>
        <div class="logo-text">Sage<span>Alpha</span> Capital</div>
        <div class="sub-title">Institutional Equity Research</div>
      </div>
      <div class="date-info">
        ${date}<br/>

      </div>
    </div>
  </div>

  <div class="company-name">${companyName} 
    ${ticker ? `<span class="ticker">(${ticker})</span>` : ""}
  </div>
  ${subtitle ? `<div class="company-subtitle">${subtitle}</div>` : ""}

  <table class="columns-table">
    <tr>
      <td class="col-left">

        <div class="section-title">Investment Thesis</div>
        <ul>${investmentThesis.map(x => `<li>${x.content || x}</li>`).join("")}</ul>

        <div class="section-title">Key Highlights</div>
        <ul>${highlights.map(x => `<li>${x.content || x}</li>`).join("")}</ul>

       <div class="section-title">Valuation Methodology</div>
       <ul>${valuationMethodology.map(x => `
       <li><b>${x.method}:</b> ${x.details}</li>
       `).join("")}</ul>

       <div class="section-title">Catalysts</div>
        <ul>${catalysts.map(x => `
        <li><b>${x.title}:</b> ${x.impact}</li>
        `).join("")}</ul>

        <div class="section-title">Risks</div>
        <ul>${risks.map(x => `
        <li><b>${x.title}:</b> ${x.impact}</li>
       `).join("")}</ul>


      </td>

      <td class="col-right sidebar-col">

        <div class="recommendation-box">
          <div class="rating-text">${rating}</div>
          <div class="price-target">${targetPrice}</div>
          <div style="font-size:10px;color:#666;">Price Target (${targetPeriod})</div>
        </div>

        <div class="metric-row"><span>Current Price</span><span>${currentPrice}</span></div>
        <div class="metric-row"><span>Upside</span><span style="color:#2e8b57;">${upside}</span></div>
        <div class="metric-row"><span>Market Cap</span><span>${marketCap}</span></div>
        <div class="metric-row"><span>Ent. Value</span><span>${entValue}</span></div>
        <div class="metric-row"><span>Valuation</span><span>${valuation}</span></div>

        <div class="section-title" style="margin-top:16px;">Financial Summary</div>
        <table class="fin-table">
          <thead>
            <tr>
              <th>Year</th>
              ${financialSummary.map(s => `<th>${s.year}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            <tr><td>Rev</td>${financialSummary.map(s => `<td>${s.rev}</td>`).join("")}</tr>
            <tr><td>EBITDA</td>${financialSummary.map(s => `<td>${s.ebitda}</td>`).join("")}</tr>
            <tr><td>EPS</td>${financialSummary.map(s => `<td>${s.eps}</td>`).join("")}</tr>
          </tbody>
        </table>

        <div class="section-title" style="margin-top:16px;">Analyst</div>
        <div style="font-size:11px;font-weight:600;">${analyst}</div>
        <div style="font-size:10px;color:#444;">${analystEmail}</div>

      </td>
    </tr>
  </table>

  <div class="footer">
    © ${new Date().getFullYear()} SageAlpha Capital. All rights reserved.<br/>
   This report is for informational purposes only and does not constitute financial advice. Powered by SageAlpha.ai. <br/>
   Data provided by CMOTS <br/>
   Data Analytics and Forensics done by AlphaDecisions® 
  </div>



</div>
</body>
</html>`;
}

module.exports = { generateReportHtml };
