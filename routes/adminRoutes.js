const express = require('express');
const UserAccess = require('../models/UserAccess');
const Report = require('../models/Report');

const router = express.Router();

const ADMIN_EMAIL = 'myeiokln@gmail.com';

const isAdmin = (req, res, next) => {
  const headerEmail = (req.headers['x-user-email'] || '').trim().toLowerCase();
  const bodyEmail = (req.body?.userEmail || '').trim().toLowerCase();
  const queryEmail = (req.query?.userEmail || '').trim().toLowerCase();

  const email = headerEmail || bodyEmail || queryEmail;

  if (email !== ADMIN_EMAIL) {
    return res.status(403).json({
      success: false,
      message: 'Admin access only',
    });
  }

  next();
};

router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const users = await UserAccess.find({})
      .sort({ createdAt: -1 })
      .select(
        'userId userName userEmail userPhone freeChecksUsed isPaid paidAt createdAt updatedAt'
      )
      .lean();

    const enrichedUsers = users.map((user) => ({
      ...user,
      userName:
        (user.userEmail || '').toLowerCase() === ADMIN_EMAIL
          ? 'Admin'
          : user.userName || 'User',
    }));

    const totalUsers = enrichedUsers.length;
    const totalPurchasedUsers = enrichedUsers.filter((u) => u.isPaid).length;

    res.json({
      success: true,
      data: {
        totalUsers,
        totalPurchasedUsers,
        users: enrichedUsers,
      },
    });
  } catch (error) {
    console.error('ADMIN DASHBOARD ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load admin dashboard',
    });
  }
});

router.get('/user-reports', isAdmin, async (req, res) => {
  try {
    const userEmail = (req.query.userEmail || '').trim().toLowerCase();
    const userPhone = (req.query.userPhone || '').trim();
    const userId = (req.query.userId || '').trim();

    if (!userEmail && !userPhone && !userId) {
      return res.status(400).json({
        success: false,
        message: 'User identity is required',
      });
    }

    const conditions = [];

    if (userEmail) {
      conditions.push({ userEmail });
    }

    if (userPhone) {
      conditions.push({ userPhone });
    }

    if (userId) {
      conditions.push({ userId });
    }

    const reports = await Report.find(
      conditions.length ? { $or: conditions } : {},
      {
        _id: 1,
        fileName: 1,
        originalText: 1,
        createdAt: 1,
        plagiarismPercentage: 1,
        totalWords: 1,
        totalSentences: 1,
        userEmail: 1,
        userPhone: 1,
        userId: 1,
      }
    )
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        count: reports.length,
        reports,
      },
    });
  } catch (error) {
    console.error('ADMIN USER REPORTS ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load user reports',
    });
  }
});

module.exports = router;