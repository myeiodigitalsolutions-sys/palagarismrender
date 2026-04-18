const express = require('express');
const router = express.Router();
const fs = require('fs');
const upload = require('../middleware/upload');
const Report = require('../models/Report');
const { extractText, splitIntoSentences, countWords } = require('../utils/textExtractor');
const { checkPlagiarism } = require('../utils/plagiarismChecker');

// ─── Helper: build & save report with user info ─────────────────────────────
const buildReport = async (
  fileName,
  text,
  matches,
  userId = null,
  userEmail = null,
  userPhone = null
) => {
  const plagiarized = matches.filter((m) => m.isPlagiarized);
  const plagiarismPercent = Math.round((plagiarized.length / matches.length) * 100) || 0;

  const sourceTypes = {
    educational: matches.filter((m) => m.source === 'educational').length,
    journal: matches.filter((m) => m.source === 'journal' || m.source === 'academic').length,
    wiki: matches.filter((m) => m.source === 'wiki').length,
    forum: matches.filter((m) => m.source === 'forum').length,
    ai: matches.filter((m) => m.source === 'ai-generated').length,
    web: matches.filter((m) => m.source === 'web').length,
    other: matches.filter(
      (m) =>
        !['educational', 'journal', 'academic', 'wiki', 'forum', 'ai-generated', 'web'].includes(
          m.source
        )
    ).length,
  };

  const reportData = {
    fileName,
    originalText: text.substring(0, 10000),
    totalWords: countWords(text),
    totalSentences: matches.length,
    plagiarizedSentences: plagiarized.length,
    originalSentences: matches.length - plagiarized.length,
    plagiarismPercentage: plagiarismPercent,
    matches,
    sourceTypes,
  };

  if (userId) reportData.userId = String(userId).trim();
  if (userEmail) reportData.userEmail = String(userEmail).trim().toLowerCase();
  if (userPhone) reportData.userPhone = String(userPhone).trim();

  const report = new Report(reportData);
  await report.save();
  return report;
};

// ─── POST /api/plagiarism/check-file ─────────────────────────────────────────
router.post('/check-file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  const userId = req.headers['x-user-id'] || req.body.userId;
  const userEmail = req.headers['x-user-email'] || req.body.userEmail;
  const userPhone = req.headers['x-user-phone'] || req.body.userPhone;

  const filePath = req.file.path;
  const startTime = Date.now();

  try {
    console.log(
      `\n📄 Processing file: ${req.file.originalname} ${
        userId || userEmail || userPhone ? `for user: ${userEmail || userPhone || userId}` : ''
      }`
    );

    const text = await extractText(filePath, req.file.originalname);
    if (!text || text.trim().length < 30) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message:
          'File has insufficient text content. Please ensure the file contains at least 30 characters of text.',
      });
    }

    const allSentences = splitIntoSentences(text);
    if (allSentences.length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: 'No complete sentences found. Make sure the document contains full sentences.',
      });
    }

    const toCheck = allSentences.slice(0, 25);
    console.log(`📊 Sentences extracted: ${allSentences.length} → checking: ${toCheck.length}`);

    const matches = await checkPlagiarism(toCheck);
    const report = await buildReport(
      req.file.originalname,
      text,
      matches,
      userId,
      userEmail,
      userPhone
    );

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Completed in ${timeTaken}s — Plagiarism: ${report.plagiarismPercentage}%`);

    return res.json({
      success: true,
      report: {
        id: report._id,
        fileName: report.fileName,
        totalWords: report.totalWords,
        totalSentences: report.totalSentences,
        plagiarizedSentences: report.plagiarizedSentences,
        originalSentences: report.originalSentences,
        plagiarismPercentage: report.plagiarismPercentage,
        sourceTypes: report.sourceTypes,
        matches: report.matches,
        createdAt: report.createdAt,
      },
    });
  } catch (err) {
    console.error('❌ check-file error:', err.message);
    console.error('Stack:', err.stack);

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return res.status(500).json({
      success: false,
      message: err.message || 'Plagiarism check failed. Please try again.',
    });
  }
});

// ─── POST /api/plagiarism/check-text ─────────────────────────────────────────
router.post('/check-text', async (req, res) => {
  const { text, fileName = 'Pasted Text', userId, userEmail, userPhone } = req.body;
  const startTime = Date.now();

  const finalUserId = userId || req.headers['x-user-id'];
  const finalUserEmail = userEmail || req.headers['x-user-email'];
  const finalUserPhone = userPhone || req.headers['x-user-phone'];

  if (!text || text.trim().length < 30) {
    return res.status(400).json({
      success: false,
      message: 'Please provide at least 30 characters of text.',
    });
  }

  try {
    console.log(
      `\n📝 Text check - analyzing ${text.length} characters ${
        finalUserId || finalUserEmail || finalUserPhone
          ? `for user: ${finalUserEmail || finalUserPhone || finalUserId}`
          : ''
      }`
    );

    const allSentences = splitIntoSentences(text);
    if (allSentences.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No complete sentences found. Please enter full sentences (not just keywords).',
      });
    }

    const toCheck = allSentences.slice(0, 25);
    console.log(`📊 Sentences extracted: ${allSentences.length} → checking: ${toCheck.length}`);

    const matches = await checkPlagiarism(toCheck);
    const report = await buildReport(
      fileName,
      text,
      matches,
      finalUserId,
      finalUserEmail,
      finalUserPhone
    );

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Completed in ${timeTaken}s — Plagiarism: ${report.plagiarismPercentage}%`);

    return res.json({
      success: true,
      report: {
        id: report._id,
        fileName: report.fileName,
        totalWords: report.totalWords,
        totalSentences: report.totalSentences,
        plagiarizedSentences: report.plagiarizedSentences,
        originalSentences: report.originalSentences,
        plagiarismPercentage: report.plagiarismPercentage,
        sourceTypes: report.sourceTypes,
        matches: report.matches,
        createdAt: report.createdAt,
      },
    });
  } catch (err) {
    console.error('❌ check-text error:', err.message);
    console.error('Stack:', err.stack);

    return res.status(500).json({
      success: false,
      message: err.message || 'Plagiarism check failed. Please try again.',
    });
  }
});

// ─── GET /api/plagiarism/history ──────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.userId;
    const userEmail = req.headers['x-user-email'] || req.query.userEmail;
    const userPhone = req.headers['x-user-phone'] || req.query.userPhone;

    let query = {};

    if (userId || userEmail || userPhone) {
      query = { $or: [] };
      if (userId) query.$or.push({ userId: String(userId).trim() });
      if (userEmail) query.$or.push({ userEmail: String(userEmail).trim().toLowerCase() });
      if (userPhone) query.$or.push({ userPhone: String(userPhone).trim() });
    }

    const reports = await Report.find(query)
      .select(
        'fileName totalWords totalSentences plagiarismPercentage sourceTypes createdAt userId userEmail userPhone'
      )
      .sort({ createdAt: -1 })
      .limit(20);

    console.log(
      `📊 Found ${reports.length} reports ${
        userId || userEmail || userPhone ? `for user ${userEmail || userPhone || userId}` : '(all users)'
      }`
    );

    return res.json({
      success: true,
      reports: reports || [],
    });
  } catch (err) {
    console.error('❌ history error:', err.message);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ─── GET /api/plagiarism/report/:id ──────────────────────────────────────────
router.get('/report/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.userId;
    const userEmail = req.headers['x-user-email'] || req.query.userEmail;
    const userPhone = req.headers['x-user-phone'] || req.query.userPhone;

    let query = { _id: req.params.id };

    if (userId || userEmail || userPhone) {
      query.$or = [];
      if (userId) query.$or.push({ userId: String(userId).trim() });
      if (userEmail) query.$or.push({ userEmail: String(userEmail).trim().toLowerCase() });
      if (userPhone) query.$or.push({ userPhone: String(userPhone).trim() });
    }

    const report = await Report.findOne(query);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found.',
      });
    }

    return res.json({
      success: true,
      report,
    });
  } catch (err) {
    console.error('❌ report fetch error:', err.message);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;