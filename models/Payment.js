const mongoose = require("mongoose");

// Payment schema keeps orderId unique (generated at order creation),
// allows multiple null paymentId values via sparse index,
// and tracks lifecycle via status: created -> paid / failed.
const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ["PLUS", "PRO"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
    },
    paymentId: {
      type: String,
      sparse: true, // allows multiple null values
      index: true,
    },
    signature: {
      type: String,
    },
    status: {
      type: String,
      enum: ["created", "paid", "failed"],
      default: "created",
    },
    // Keep these optional fields for compatibility / reporting
    currency: {
      type: String,
      default: "INR",
    },
    receipt: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
