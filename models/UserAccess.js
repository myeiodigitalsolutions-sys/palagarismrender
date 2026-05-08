const mongoose = require('mongoose');

const userAccessSchema = new mongoose.Schema(
  {
    userKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      default: '',
      index: true,
    },
    userName: {
      type: String,
      default: '',
    },
    userEmail: {
      type: String,
      default: '',
      index: true,
    },
    userPhone: {
      type: String,
      default: '',
      index: true,
    },
    freeChecksUsed: {
      type: Number,
      default: 0,
    },
    paidCheckCredits: {
      type: Number,
      default: 0,
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    cashfreeOrderId: {
      type: String,
      default: '',
    },
    cashfreePaymentId: {
      type: String,
      default: '',
    },
    cashfreePaymentStatus: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserAccess', userAccessSchema);