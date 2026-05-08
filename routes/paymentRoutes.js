const express = require('express');
const { Cashfree, CFEnvironment } = require('cashfree-pg');
const UserAccess = require('../models/UserAccess');

const router = express.Router();

const PREMIUM_AMOUNT = 50;
const LOGGED_IN_FREE_CHECK_LIMIT = 0;

// Initialize Cashfree — must use 'new' to instantiate
const cashfree = new Cashfree(
  process.env.CASHFREE_ENV === 'PROD' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
  process.env.CASHFREE_APP_ID,
  process.env.CASHFREE_SECRET_KEY
);

const getUserKey = (req) => {
  const email = (req.headers['x-user-email'] || req.body.userEmail || '').trim().toLowerCase();
  const phone = (req.headers['x-user-phone'] || req.body.userPhone || '').trim();
  const userId = (req.headers['x-user-id'] || req.body.userId || '').trim();
  return email || phone || userId;
};

const buildUsageData = (user) => {
  const freeChecksUsed = Number(user.freeChecksUsed || 0);
  const paidChecksLeft = Number(user.paidCheckCredits || 0);
  const freeChecksLeft = Math.max(LOGGED_IN_FREE_CHECK_LIMIT - freeChecksUsed, 0);

  return {
    freeChecksUsed,
    freeChecksLeft,
    paidChecksLeft,
    requiresPayment: freeChecksLeft <= 0 && paidChecksLeft <= 0,
    isPaid: false,
    paidAt: user.paidAt || null,
  };
};

router.post('/create-order', async (req, res) => {
  try {
    const userKey = getUserKey(req);
    const userId = (req.headers['x-user-id'] || req.body.userId || '').trim();
    const userName = (req.body.userName || '').trim();
    const userEmail = (req.headers['x-user-email'] || req.body.userEmail || '').trim();
    const userPhone = (req.headers['x-user-phone'] || req.body.userPhone || '').trim();

    if (!userKey) {
      return res.status(400).json({ success: false, message: 'User identity is required' });
    }

    const orderId = `order_${Date.now()}`;

    // Correct Cashfree order request format
    const orderRequest = {
      order_id: orderId,
      order_amount: PREMIUM_AMOUNT,
      order_currency: 'INR',
      customer_details: {
        customer_id: (userId || userKey).substring(0, 50),
        customer_email: userEmail || 'user@example.com',
        customer_phone: (userPhone && userPhone.length === 10) ? userPhone : '9999999999',
        customer_name: userName || 'User',
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/payment-success?order_id={order_id}`,
        notify_url: `${process.env.BACKEND_URL || 'https://palagarismrender.onrender.com'}/api/payment/verify`,
      },
    };

    const response = await cashfree.PGCreateOrder('2023-08-01', orderRequest);
    const order = response.data;

    await UserAccess.findOneAndUpdate(
      { userKey },
      {
        $set: {
          userKey,
          userId,
          userName,
          userEmail,
          userPhone,
          cashfreeOrderId: order.order_id,
        },
        $setOnInsert: {
          freeChecksUsed: 0,
          paidCheckCredits: 0,
          isPaid: false,
        },
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      order,
      appId: process.env.CASHFREE_APP_ID,
      amount: PREMIUM_AMOUNT,
    });
  } catch (error) {
    console.error('CREATE ORDER ERROR:', error?.response?.data || error);
    res.status(500).json({ success: false, message: 'Failed to create Cashfree order' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const {
      orderId,
      userId,
      userName,
      userEmail,
      userPhone,
    } = req.body;

    const userKey =
      (userEmail || '').trim().toLowerCase() ||
      (userPhone || '').trim() ||
      (userId || '').trim();

    if (!userKey || !orderId) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    // Verify payment by fetching order status from Cashfree
    const response = await cashfree.PGFetchOrder('2023-08-01', orderId);
    const orderData = response.data;

    if (orderData.order_status !== 'PAID') {
      return res.status(400).json({ success: false, message: 'Payment not completed' });
    }

    const updatedUser = await UserAccess.findOneAndUpdate(
      { userKey },
      {
        $set: {
          userKey,
          userId: userId || '',
          userName: userName || '',
          userEmail: userEmail || '',
          userPhone: userPhone || '',
          paidAt: new Date(),
          cashfreeOrderId: orderId,
          isPaid: false,
        },
        $inc: {
          paidCheckCredits: 1,
        },
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Payment verified successfully',
      data: buildUsageData(updatedUser),
    });
  } catch (error) {
    console.error('VERIFY PAYMENT ERROR:', error?.response?.data || error);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
});

router.get('/usage-status', async (req, res) => {
  try {
    const userKey = getUserKey(req);
    const userId = (req.headers['x-user-id'] || req.query.userId || '').trim();
    const userName = (req.query.userName || '').trim();
    const userEmail = (req.headers['x-user-email'] || req.query.userEmail || '').trim();
    const userPhone = (req.headers['x-user-phone'] || req.query.userPhone || '').trim();

    if (!userKey) {
      return res.status(400).json({ success: false, message: 'User identity is required' });
    }

    let user = await UserAccess.findOne({ userKey });

    if (!user) {
      user = await UserAccess.create({
        userKey,
        userId,
        userName,
        userEmail,
        userPhone,
        freeChecksUsed: 0,
        paidCheckCredits: 0,
        isPaid: false,
      });
    }

    res.json({
      success: true,
      data: buildUsageData(user),
    });
  } catch (error) {
    console.error('USAGE STATUS ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch usage status' });
  }
});

router.post('/increment-usage', async (req, res) => {
  try {
    const userKey = getUserKey(req);
    const userId = (req.headers['x-user-id'] || req.body.userId || '').trim();
    const userName = (req.body.userName || '').trim();
    const userEmail = (req.headers['x-user-email'] || req.body.userEmail || '').trim();
    const userPhone = (req.headers['x-user-phone'] || req.body.userPhone || '').trim();

    if (!userKey) {
      return res.status(400).json({ success: false, message: 'User identity is required' });
    }

    let user = await UserAccess.findOne({ userKey });

    if (!user) {
      user = await UserAccess.create({
        userKey,
        userId,
        userName,
        userEmail,
        userPhone,
        freeChecksUsed: 0,
        paidCheckCredits: 0,
        isPaid: false,
      });
    }

    const freeChecksUsed = Number(user.freeChecksUsed || 0);
    const paidCheckCredits = Number(user.paidCheckCredits || 0);

    if (freeChecksUsed < LOGGED_IN_FREE_CHECK_LIMIT) {
      user.freeChecksUsed = freeChecksUsed + 1;
    } else if (paidCheckCredits > 0) {
      user.paidCheckCredits = paidCheckCredits - 1;
    } else {
      return res.status(403).json({
        success: false,
        message: 'Payment required for this check.',
        paymentRequired: true,
      });
    }

    if (userId && !user.userId) user.userId = userId;
    if (userName && !user.userName) user.userName = userName;
    if (userEmail && !user.userEmail) user.userEmail = userEmail;
    if (userPhone && !user.userPhone) user.userPhone = userPhone;

    await user.save();

    res.json({
      success: true,
      data: buildUsageData(user),
    });
  } catch (error) {
    console.error('INCREMENT USAGE ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to update usage' });
  }
});

module.exports = router;