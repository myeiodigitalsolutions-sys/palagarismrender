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

router.post('/create-order', async (req, res) => {
  try {
    const userKey = getUserKey(req);
    const userName = (req.body.userName || '').trim();
    const userEmail = (req.headers['x-user-email'] || req.body.userEmail || '').trim();
    const userPhone = (req.headers['x-user-phone'] || req.body.userPhone || '').trim();

    if (!userKey) {
      return res.status(400).json({ success: false, message: 'User identity is required' });
    }

    const order = await razorpay.orders.create({
      amount: PREMIUM_AMOUNT * 100,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`,
      notes: { userKey, userEmail, userPhone, userName },
    });

    await UserAccess.findOneAndUpdate(
      { userKey },
      {
        $set: {
          userKey,
          userName,
          userEmail,
          userPhone,
          razorpayOrderId: order.id,
        },
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID,
      amount: PREMIUM_AMOUNT,
    });
  } catch (error) {
    console.error('CREATE ORDER ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to create Razorpay order' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      userId,
      userName,
      userEmail,
      userPhone,
    } = req.body;

    const userKey =
      (userEmail || '').trim().toLowerCase() ||
      (userPhone || '').trim() ||
      (userId || '').trim();

    if (!userKey || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    const updatedUser = await UserAccess.findOneAndUpdate(
      { userKey },
      {
        $set: {
          userKey,
          userName: userName || '',
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

    res.json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        isPaid: updatedUser.isPaid,
        paidAt: updatedUser.paidAt,
      },
    });
  } catch (error) {
    console.error('VERIFY PAYMENT ERROR:', error);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
});

router.get('/usage-status', async (req, res) => {
  try {
    const userKey = getUserKey(req);
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
        userName,
        userEmail,
        userPhone,
        freeChecksUsed: 0,
        isPaid: false,
      });
    }

    res.json({
      success: true,
      data: {
        freeChecksUsed: user.freeChecksUsed,
        freeChecksLeft: user.isPaid ? 'Unlimited' : Math.max(LOGGED_IN_FREE_CHECK_LIMIT - user.freeChecksUsed, 0),
        isPaid: user.isPaid,
        paidAt: user.paidAt,
      },
    });
  } catch (error) {
    console.error('USAGE STATUS ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch usage status' });
  }
});

router.post('/increment-usage', async (req, res) => {
  try {
    const userKey = getUserKey(req);
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
        userName,
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
      if (userName && !user.userName) user.userName = userName;
      await user.save();
    }

    res.json({
      success: true,
      data: {
        freeChecksUsed: user.freeChecksUsed,
        freeChecksLeft: user.isPaid ? 'Unlimited' : Math.max(LOGGED_IN_FREE_CHECK_LIMIT - user.freeChecksUsed, 0),
        isPaid: user.isPaid,
      },
    });
  } catch (error) {
    console.error('INCREMENT USAGE ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to update usage' });
  }
});

module.exports = router;