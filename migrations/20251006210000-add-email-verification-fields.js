'use strict';

/**
 * Migration: Add email verification and password reset fields to Users table
 * This enables email verification and forgot password functionality
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add email verification fields
    await queryInterface.addColumn('Users', 'emailVerified', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Indicates if the user has verified their email address'
    });

    await queryInterface.addColumn('Users', 'emailVerificationToken', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'Hashed token for email verification'
    });

    await queryInterface.addColumn('Users', 'emailVerificationExpires', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Expiration timestamp for email verification token'
    });

    // Add password reset fields
    await queryInterface.addColumn('Users', 'resetPasswordToken', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'Hashed token for password reset'
    });

    await queryInterface.addColumn('Users', 'resetPasswordExpires', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Expiration timestamp for password reset token'
    });

    // Add index on tokens for faster lookups
    await queryInterface.addIndex('Users', ['emailVerificationToken'], {
      name: 'idx_users_email_verification_token',
      where: {
        emailVerificationToken: {
          [Sequelize.Op.ne]: null
        }
      }
    });

    await queryInterface.addIndex('Users', ['resetPasswordToken'], {
      name: 'idx_users_reset_password_token',
      where: {
        resetPasswordToken: {
          [Sequelize.Op.ne]: null
        }
      }
    });

    // Mark all existing users with valid emails as verified
    // This ensures backward compatibility - existing users don't need to verify
    await queryInterface.sequelize.query(
      "UPDATE Users SET emailVerified = true WHERE email IS NOT NULL AND email != ''"
    );

    console.log('✓ Email verification and password reset fields added successfully');
    console.log('✓ Existing users with emails marked as verified');
  },

  down: async (queryInterface, Sequelize) => {
    // Remove indexes
    await queryInterface.removeIndex('Users', 'idx_users_email_verification_token');
    await queryInterface.removeIndex('Users', 'idx_users_reset_password_token');

    // Remove columns
    await queryInterface.removeColumn('Users', 'emailVerified');
    await queryInterface.removeColumn('Users', 'emailVerificationToken');
    await queryInterface.removeColumn('Users', 'emailVerificationExpires');
    await queryInterface.removeColumn('Users', 'resetPasswordToken');
    await queryInterface.removeColumn('Users', 'resetPasswordExpires');

    console.log('✓ Email verification and password reset fields removed');
  }
};

