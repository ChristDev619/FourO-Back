const db = require("../dbInit");
const { User } = db;
const bcrypt = require("bcrypt");
const CryptoJS = require("crypto-js");
const logger = require("../utils/logger");
const emailService = require("../utils/services/EmailService");
const emailConfig = require("../config/email.config");

/**
 * Auth Controller - Handles email verification and password reset operations
 * Follows SOLID principles and maintains separation of concerns
 */

/**
 * Verify user's email address using verification token
 * Route: POST /api/auth/verify-email
 */
exports.verifyEmail = async (req, res) => {
  const { token } = req.body;

  try {
    if (!token) {
      return res.status(400).json({ 
        success: false,
        message: "Verification token is required" 
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = emailService.hashToken(token);

    // Find user with this token that hasn't expired
    const user = await User.findOne({
      where: {
        emailVerificationToken: hashedToken,
        emailVerificationExpires: {
          [db.Sequelize.Op.gt]: new Date(),
        },
      },
    });

    if (!user) {
      logger.warn('Email verification failed - invalid or expired token', {
        hashedToken: hashedToken.substring(0, 10) + '...',
      });
      return res.status(400).json({
        success: false,
        message: "Verification link is invalid or has expired",
      });
    }

    // Update user - mark as verified and clear token
    await user.update({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    });

    logger.info('Email verified successfully', {
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    res.status(200).json({
      success: true,
      message: "Email verified successfully! You can now access all features.",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: true,
      },
    });
  } catch (error) {
    logger.error('Email verification error', {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error verifying email",
      error: error.message,
    });
  }
};

/**
 * Resend verification email to user
 * Route: POST /api/auth/resend-verification
 */
exports.resendVerificationEmail = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ where: { email } });

    if (!user) {
      // Don't reveal if user exists or not for security
      return res.status(200).json({
        success: true,
        message: "If an account exists with this email, a verification email will be sent.",
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    // Generate new verification token
    const verificationToken = emailService.generateSecureToken();
    const hashedToken = emailService.hashToken(verificationToken);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + emailConfig.verification.expiresInHours);

    // Update user with new token
    await user.update({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: expiresAt,
    });

    // Send verification email
    await emailService.sendVerificationEmail(user, verificationToken);

    logger.info('Verification email resent', {
      userId: user.id,
      email: user.email,
    });

    res.status(200).json({
      success: true,
      message: "Verification email sent successfully. Please check your inbox.",
    });
  } catch (error) {
    logger.error('Error resending verification email', {
      email,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error sending verification email",
      error: error.message,
    });
  }
};

/**
 * Request password reset - sends reset email
 * Route: POST /api/auth/forgot-password
 */
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ where: { email } });

    if (!user) {
      // Don't reveal if user exists or not for security
      logger.info('Password reset requested for non-existent email', { email });
      return res.status(200).json({
        success: true,
        message: "If an account exists with this email, a password reset link will be sent.",
      });
    }

    // Check rate limiting - prevent spam
    if (user.resetPasswordExpires && user.resetPasswordExpires > new Date()) {
      const minutesRemaining = Math.ceil(
        (user.resetPasswordExpires - new Date()) / (1000 * 60)
      );
      
      logger.warn('Password reset rate limit hit', {
        userId: user.id,
        email: user.email,
        minutesRemaining,
      });

      return res.status(429).json({
        success: false,
        message: `Please wait ${minutesRemaining} minute(s) before requesting another password reset.`,
      });
    }

    // Generate reset token
    const resetToken = emailService.generateSecureToken();
    const hashedToken = emailService.hashToken(resetToken);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + emailConfig.passwordReset.expiresInHours);

    // Update user with reset token
    await user.update({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: expiresAt,
    });

    // Send password reset email
    await emailService.sendPasswordResetEmail(user, resetToken);

    logger.info('Password reset email sent', {
      userId: user.id,
      email: user.email,
    });

    res.status(200).json({
      success: true,
      message: "Password reset instructions have been sent to your email.",
    });
  } catch (error) {
    logger.error('Error in forgot password', {
      email,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error processing password reset request",
      error: error.message,
    });
  }
};

/**
 * Reset password using reset token
 * Route: POST /api/auth/reset-password
 */
exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Token and new password are required",
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = emailService.hashToken(token);

    // Find user with this token that hasn't expired
    const user = await User.findOne({
      where: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: {
          [db.Sequelize.Op.gt]: new Date(),
        },
      },
    });

    if (!user) {
      logger.warn('Password reset failed - invalid or expired token');
      return res.status(400).json({
        success: false,
        message: "Password reset link is invalid or has expired",
      });
    }

    // Decrypt the new password (if encrypted by frontend)
    let decryptedPassword = newPassword;
    if (process.env.PASSPHRASE) {
      try {
        const decryptedBytes = CryptoJS.AES.decrypt(newPassword, process.env.PASSPHRASE);
        const decrypted = decryptedBytes.toString(CryptoJS.enc.Utf8);
        if (decrypted) {
          decryptedPassword = decrypted;
        }
      } catch (decryptError) {
        // If decryption fails, assume password is not encrypted
        logger.warn('Password decryption failed, using as-is', {
          userId: user.id,
        });
      }
    }

    // Validate password strength (basic validation)
    if (decryptedPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    // Hash the new password
    const hashedPassword = bcrypt.hashSync(decryptedPassword, 10);

    // Update user - set new password and clear reset token
    await user.update({
      password: hashedPassword,
      resetPasswordToken: null,
      resetPasswordExpires: null,
    });

    // Send confirmation email (non-blocking)
    emailService.sendPasswordChangedEmail(user).catch(err => {
      logger.error('Failed to send password changed email', {
        userId: user.id,
        error: err.message,
      });
    });

    logger.info('Password reset successfully', {
      userId: user.id,
      username: user.username,
    });

    res.status(200).json({
      success: true,
      message: "Password reset successfully! You can now log in with your new password.",
    });
  } catch (error) {
    logger.error('Error resetting password', {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error resetting password",
      error: error.message,
    });
  }
};

/**
 * Validate reset token without resetting password
 * Route: POST /api/auth/validate-reset-token
 */
exports.validateResetToken = async (req, res) => {
  const { token } = req.body;

  try {
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Token is required",
      });
    }

    const hashedToken = emailService.hashToken(token);

    const user = await User.findOne({
      where: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: {
          [db.Sequelize.Op.gt]: new Date(),
        },
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    res.status(200).json({
      success: true,
      message: "Token is valid",
      email: user.email, // Return email to show user which account they're resetting
    });
  } catch (error) {
    logger.error('Error validating reset token', {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error validating token",
      error: error.message,
    });
  }
};

/**
 * Check email verification status
 * Route: GET /api/auth/email-status/:userId
 */
exports.checkEmailStatus = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findByPk(userId, {
      attributes: ['id', 'email', 'emailVerified'],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      emailVerified: user.emailVerified,
      email: user.email,
    });
  } catch (error) {
    logger.error('Error checking email status', {
      userId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Error checking email status",
      error: error.message,
    });
  }
};

/**
 * Activate account and set password for new user invitations
 * This combines token verification + password setup in one step
 * Route: POST /api/auth/activate-account
 */
exports.activateAccount = async (req, res) => {
  const { token, password } = req.body;

  try {
    // Validate inputs
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Activation token is required",
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    // Password strength validation
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = emailService.hashToken(token);

    // Find user with this activation token that hasn't expired
    const user = await User.findOne({
      where: {
        emailVerificationToken: hashedToken,
        emailVerificationExpires: {
          [db.Sequelize.Op.gt]: new Date(),
        },
        emailVerified: false, // Only allow activation for unverified accounts
      },
    });

    if (!user) {
      logger.warn('Account activation failed - invalid or expired token', {
        hashedToken: hashedToken.substring(0, 10) + '...',
      });
      return res.status(400).json({
        success: false,
        message: "Activation link is invalid or has expired. Please contact support.",
      });
    }

    // Decrypt the new password (if encrypted by frontend)
    let finalPassword = password;
    if (req.body.encrypted) {
      try {
        const passphrase = process.env.PASSPHRASE;
        const decryptedBytes = CryptoJS.AES.decrypt(password, passphrase);
        finalPassword = decryptedBytes.toString(CryptoJS.enc.Utf8);
      } catch (decryptError) {
        logger.error('Password decryption failed during activation', {
          userId: user.id,
          error: decryptError.message,
        });
        return res.status(400).json({
          success: false,
          message: "Invalid password format",
        });
      }
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(finalPassword, 10);

    // Update user: set password, mark as verified, clear activation token
    await user.update({
      password: hashedPassword,
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    });

    logger.info('Account activated successfully', {
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    res.status(200).json({
      success: true,
      message: "Your account has been activated successfully! You can now log in.",
      username: user.username,
    });
  } catch (error) {
    logger.error('Error activating account', {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error activating account. Please try again.",
      error: error.message,
    });
  }
};

/**
 * Validate activation token without setting password
 * Route: GET /api/auth/validate-activation-token/:token
 */
exports.validateActivationToken = async (req, res) => {
  const { token } = req.params;

  try {
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Activation token is required",
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = emailService.hashToken(token);

    // Find user with this token that hasn't expired
    const user = await User.findOne({
      where: {
        emailVerificationToken: hashedToken,
        emailVerificationExpires: {
          [db.Sequelize.Op.gt]: new Date(),
        },
        emailVerified: false,
      },
      attributes: ['id', 'username', 'email', 'firstName', 'lastName'],
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Activation link is invalid or has expired",
      });
    }

    res.status(200).json({
      success: true,
      valid: true,
      user: {
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    logger.error('Error validating activation token', {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Error validating activation token",
      error: error.message,
    });
  }
};

