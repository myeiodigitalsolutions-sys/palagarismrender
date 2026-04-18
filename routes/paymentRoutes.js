const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const UserAccess = require('../models/UserAccess');

const router = express.Router();

const PREMIUM_AMOUNT = 1500;
const LOGGED_IN_FREE_CHECK_LIMIT = 1;

const getUserKey = (req) => {
  const email = (req.headers['x-user-email'] || req.body.userEmail || '').trim().toLowerCase();
  const phone = (req.headers['x-user-phone'] || req.body.userPhone || '').trim();
  const userId = (req.headers['x-user-id'] || req.body.userId || '').trim();

  return email || phone || userId;
};

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create order
router.post('/create-order', async (req, res) => {
  try {
    const userKey = getUserKey(req);
    const userEmail = (req.headers['x-user-email'] || req.body.userEmail || '').trim();
    const userPhone = (req.headers['x-user-phone'] || req.body.userPhone || '').trim();

    if (!userKey) {
      return res.status(400).json({
        success: false,
        message: 'User identity is required',
      });
    }

    const options = {
      amount: PREMIUM_AMOUNT * 100,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`,
      notes: {
        userKey,
        userEmail,
        userPhone,
        product: 'plagiarism-premium',
      },
    };

    const order = await razorpay.orders.create(options);

    await UserAccess.findOneAndUpdate(
      { userKey },
      {
        $set: {
          userKey,
          userEmail,
          userPhone,
          razorpayOrderId: order.id,
        },
      },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID,
      amount: PREMIUM_AMOUNT,
    });
  } catch (error) {
    console.error('CREATE ORDER ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create Razorpay order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Verify payment
router.post('/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      userEmail,
      userPhone,
      userId,
    } = req.body;

    const userKey =
      (userEmail || '').trim().toLowerCase() ||
      (userPhone || '').trim() ||
      (userId || '').trim();

    if (!userKey) {
      return res.status(400).json({
        success: false,
        message: 'User identity is required',
      });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment verification fields',
      });
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature',
      });
    }

    const updatedUser = await UserAccess.findOneAndUpdate(
      { userKey },
      {
        $set: {
          userKey,
          userEmail: userEmail || '',
          userPhone: userPhone || '',
          isPaid: true,
          paidAt: new Date(),
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
        },
      },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        isPaid: updatedUser.isPaid,
        paidAt: updatedUser.paidAt,
      },
    });
  } catch (error) {
    console.error('VERIFY PAYMENT ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Payment verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Get usage status
router.get('/usage-status', async (req, res) => {
  try {
    const userKey = getUserKey(req);
    const userEmail = (req.headers['x-user-email'] || '').trim();
    const userPhone = (req.headers['x-user-phone'] || '').trim();

    if (!userKey) {
      return res.status(400).json({
        success: false,
        message: 'User identity is required',
      });
    }

    let user = await UserAccess.findOne({ userKey });

    if (!user) {
      user = await UserAccess.create({
        userKey,
        userEmail,
        userPhone,
        freeChecksUsed: 0,
        isPaid: false,
      });
    }

    return res.json({
      success: true,
      data: {
        freeChecksUsed: user.freeChecksUsed,
        freeChecksLeft: user.isPaid
          ? 'Unlimited'
          : Math.max(LOGGED_IN_FREE_CHECK_LIMIT - user.freeChecksUsed, 0),
        isPaid: user.isPaid,
        paidAt: user.paidAt,
      },
    });
  } catch (error) {
    console.error('USAGE STATUS ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch usage status',
    });
  }
});

// Increment usage after successful plagiarism check
router.post('/increment-usage', async (req, res) => {
  try {
    const userKey = getUserKey(req);
    const userEmail = (req.headers['x-user-email'] || req.body.userEmail || '').trim();
    const userPhone = (req.headers['x-user-phone'] || req.body.userPhone || '').trim();

    if (!userKey) {
      return res.status(400).json({
        success: false,
        message: 'User identity is required',
      });
    }

    let user = await UserAccess.findOne({ userKey });

    if (!user) {
      user = await UserAccess.create({
        userKey,
        userEmail,
        userPhone,
        freeChecksUsed: 0,
        isPaid: false,
      });
    }

    if (!user.isPaid && user.freeChecksUsed >= LOGGED_IN_FREE_CHECK_LIMIT) {
      return res.status(403).json({
        success: false,
        message: 'Free limit exceeded. Payment required.',
        paymentRequired: true,
      });
    }

    if (!user.isPaid) {
      user.freeChecksUsed += 1;
      await user.save();
    }

    return res.json({
      success: true,
      data: {
        freeChecksUsed: user.freeChecksUsed,
        freeChecksLeft: user.isPaid
          ? 'Unlimited'
          : Math.max(LOGGED_IN_FREE_CHECK_LIMIT - user.freeChecksUsed, 0),
        isPaid: user.isPaid,
      },
    });
  } catch (error) {
    console.error('INCREMENT USAGE ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update usage',
    });
  }
});

module.exports = router;