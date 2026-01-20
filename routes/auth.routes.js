const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

/**
 * Auth Routes - Email verification and password reset
 * All routes are public (no authentication required)
 */

/**
 * @route   POST /api/auth/verify-email
 * @desc    Verify user's email address using token
 * @access  Public
 * @body    { token: string }
 */
router.post('/verify-email', authController.verifyEmail);

/**
 * @route   POST /api/auth/resend-verification
 * @desc    Resend verification email to user
 * @access  Public
 * @body    { email: string }
 */
router.post('/resend-verification', authController.resendVerificationEmail);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Request password reset email
 * @access  Public
 * @body    { email: string }
 */
router.post('/forgot-password', authController.forgotPassword);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password using token
 * @access  Public
 * @body    { token: string, newPassword: string }
 */
router.post('/reset-password', authController.resetPassword);

/**
 * @route   POST /api/auth/validate-reset-token
 * @desc    Validate if a reset token is still valid
 * @access  Public
 * @body    { token: string }
 */
router.post('/validate-reset-token', authController.validateResetToken);

/**
 * @route   GET /api/auth/email-status/:userId
 * @desc    Check email verification status for a user
 * @access  Public
 * @params  userId: number
 */
router.get('/email-status/:userId', authController.checkEmailStatus);

/**
 * @route   POST /api/auth/activate-account
 * @desc    Activate account and set password for new user invitations
 * @access  Public
 * @body    { token: string, password: string, encrypted?: boolean }
 */
router.post('/activate-account', authController.activateAccount);

/**
 * @route   GET /api/auth/validate-activation-token/:token
 * @desc    Validate if an activation token is still valid
 * @access  Public
 * @params  token: string
 */
router.get('/validate-activation-token/:token', authController.validateActivationToken);

module.exports = router;

