/**
 * Report Data Service
 * 
 * Service layer for managing reportData collection.
 * Provides methods to save and retrieve structured numerical data from reports.
 */

const ReportData = require('../models/ReportData');
const { parseReportData } = require('../utils/reportDataParser');

/**
 * Save report data extracted from LLM response
 * 
 * @param {mongoose.Types.ObjectId} reportId - The Report document _id
 * @param {object} reportData - The LLM-generated report data object
 * @param {string} companyName - Company name
 * @returns {Promise<object|null>} - Saved ReportData document or null if failed
 */
async function saveReportDataFromLLM(reportId, reportData, companyName) {
  if (!reportId) {
    console.error('[ReportData] saveReportDataFromLLM: reportId is required');
    return null;
  }
  
  if (!reportData) {
    console.warn('[ReportData] saveReportDataFromLLM: reportData is missing, skipping save');
    return null;
  }
  
  try {
    // Parse and extract structured data
    const parsedData = parseReportData(reportData, companyName);
    
    if (!parsedData) {
      console.warn('[ReportData] Failed to parse reportData, skipping save');
      return null;
    }
    
    // Validate required fields
    if (parsedData.current_price === null || parsedData.target_price === null) {
      console.warn('[ReportData] Missing required price fields, but saving partial data');
      // Continue anyway - we'll save what we have
    }
    
    // Use findOneAndUpdate with upsert to ensure ONE report_id maps to ONE reportData document
    const savedReportData = await ReportData.findOneAndUpdate(
      { report_id: reportId },
      {
        report_id: reportId,
        ...parsedData,
        updated_at: new Date()
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );
    
    console.log(`[ReportData] Successfully saved reportData for report_id: ${reportId}`);
    return savedReportData;
  } catch (error) {
    // Log error but do NOT break report generation
    console.error('[ReportData] Error saving reportData:', error);
    return null;
  }
}

/**
 * Get report data by report_id
 * 
 * @param {mongoose.Types.ObjectId|string} reportId - The Report document _id
 * @returns {Promise<object|null>} - ReportData document or null
 */
async function getReportDataByReportId(reportId) {
  try {
    const reportData = await ReportData.findOne({ report_id: reportId }).lean();
    return reportData;
  } catch (error) {
    console.error('[ReportData] Error fetching reportData by report_id:', error);
    return null;
  }
}

/**
 * Get report data by company_name
 * 
 * @param {string} companyName - Company name
 * @param {number} limit - Maximum number of results (default: 10)
 * @returns {Promise<array>} - Array of ReportData documents
 */
async function getReportDataByCompanyName(companyName, limit = 10) {
  try {
    const reportDataList = await ReportData.find({ company_name: companyName })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();
    return reportDataList;
  } catch (error) {
    console.error('[ReportData] Error fetching reportData by company_name:', error);
    return [];
  }
}

/**
 * Get current_price and target_price by report_id
 * Convenience method for Price Analysis frontend feature
 * 
 * @param {mongoose.Types.ObjectId|string} reportId - The Report document _id
 * @returns {Promise<object|null>} - Object with current_price and target_price, or null
 */
async function getPriceDataByReportId(reportId) {
  try {
    const reportData = await ReportData.findOne(
      { report_id: reportId },
      { current_price: 1, target_price: 1, upside_percent: 1, company_name: 1 }
    ).lean();
    
    if (!reportData) return null;
    
    return {
      current_price: reportData.current_price,
      target_price: reportData.target_price,
      upside_percent: reportData.upside_percent,
      company_name: reportData.company_name
    };
  } catch (error) {
    console.error('[ReportData] Error fetching price data by report_id:', error);
    return null;
  }
}

/**
 * Get current_price and target_price by company_name
 * Returns the most recent report data for the company
 * 
 * @param {string} companyName - Company name
 * @returns {Promise<object|null>} - Object with current_price and target_price, or null
 */
async function getPriceDataByCompanyName(companyName) {
  try {
    const reportData = await ReportData.findOne({ company_name: companyName })
      .sort({ created_at: -1 })
      .select('current_price target_price upside_percent company_name')
      .lean();
    
    if (!reportData) return null;
    
    return {
      current_price: reportData.current_price,
      target_price: reportData.target_price,
      upside_percent: reportData.upside_percent,
      company_name: reportData.company_name
    };
  } catch (error) {
    console.error('[ReportData] Error fetching price data by company_name:', error);
    return null;
  }
}

/**
 * Get the latest reportData per company for a given set of report_ids.
 * Intended for the Stock Price Analysis "Last Approved" column where we only want
 * persisted values (no re-parsing) and only for reports that are already approved.
 *
 * @param {Array<mongoose.Types.ObjectId|string>} reportIds - Approved Report _id list
 * @returns {Promise<Array<{company_name:string, created_at:Date|null, current_price:number|null, target_price:number|null}>>}
 */
async function getLatestReportDataByCompanyForReportIds(reportIds) {
  try {
    if (!Array.isArray(reportIds) || reportIds.length === 0) return [];

    const rows = await ReportData.aggregate([
      { $match: { report_id: { $in: reportIds } } },
      { $sort: { created_at: -1 } },
      {
        $group: {
          _id: "$company_name",
          doc: { $first: "$$ROOT" }
        }
      },
      {
        $project: {
          _id: 0,
          company_name: "$doc.company_name",
          created_at: "$doc.created_at",
          current_price: "$doc.current_price",
          target_price: "$doc.target_price"
        }
      }
    ]);

    return rows || [];
  } catch (error) {
    console.error('[ReportData] Error fetching latest reportData per company:', error);
    return [];
  }
}

/**
 * Delete reportData for a given report_id.
 * Used when a report is deleted to keep price analysis consistent.
 *
 * @param {mongoose.Types.ObjectId|string} reportId
 * @returns {Promise<boolean>}
 */
async function deleteReportDataByReportId(reportId) {
  try {
    if (!reportId) return false;
    await ReportData.deleteOne({ report_id: reportId });
    return true;
  } catch (error) {
    console.error('[ReportData] Error deleting reportData by report_id:', error);
    return false;
  }
}

/**
 * Bulk delete reportData for many report_ids.
 *
 * @param {Array<mongoose.Types.ObjectId|string>} reportIds
 * @returns {Promise<number>} deleted count (best-effort)
 */
async function deleteReportDataByReportIds(reportIds) {
  try {
    if (!Array.isArray(reportIds) || reportIds.length === 0) return 0;
    const res = await ReportData.deleteMany({ report_id: { $in: reportIds } });
    return res?.deletedCount || 0;
  } catch (error) {
    console.error('[ReportData] Error bulk deleting reportData by report_ids:', error);
    return 0;
  }
}

module.exports = {
  saveReportDataFromLLM,
  getReportDataByReportId,
  getReportDataByCompanyName,
  getPriceDataByReportId,
  getPriceDataByCompanyName,
  getLatestReportDataByCompanyForReportIds,
  deleteReportDataByReportId,
  deleteReportDataByReportIds
};

