const db = require("../dbInit");
const { User } = db;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const CryptoJS = require("crypto-js");
const logger = require("../utils/logger");
const emailService = require("../utils/services/EmailService");
const emailConfig = require("../config/email.config");

exports.createUser = async (req, res) => {
  try {
    // Check if username already exists
    const existingUser = await User.findOne({
      where: { username: req.body.username },
    });

    if (existingUser) {
      return res.status(400).send({ message: "Username already exists" });
    }

    // Check if email already exists
    if (req.body.email) {
      const existingEmail = await User.findOne({
        where: { email: req.body.email },
      });
      
      if (existingEmail) {
        return res.status(400).send({ message: "Email already exists" });
      }
    }

    let hashedPassword;

    // Handle password - if provided, decrypt and hash it
    // If not provided (new invitation flow), generate temporary random password
    if (req.body.password) {
      // Legacy flow: password provided by admin
      const passphrase = process.env.PASSPHRASE;
      const decryptedBytes = CryptoJS.AES.decrypt(req.body.password, passphrase);
      const decryptedPassword = decryptedBytes.toString(CryptoJS.enc.Utf8);
      hashedPassword = bcrypt.hashSync(decryptedPassword, 10);
    } else if (req.body.email) {
      // New invitation flow: generate temporary password that user will change
      // User cannot login with this - they MUST activate via email
      const tempPassword = require('crypto').randomBytes(32).toString('hex');
      hashedPassword = bcrypt.hashSync(tempPassword, 10);
      logger.info('Generated temporary password for new user invitation', {
        username: req.body.username,
        email: req.body.email,
      });
    } else {
      // No password and no email - invalid request
      return res.status(400).send({ 
        message: "Either password or email must be provided" 
      });
    }

    // Generate activation token if email is provided
    let activationToken = null;
    let hashedToken = null;
    let tokenExpires = null;

    if (req.body.email) {
      activationToken = emailService.generateSecureToken();
      hashedToken = emailService.hashToken(activationToken);
      tokenExpires = new Date();
      tokenExpires.setHours(
        tokenExpires.getHours() + emailConfig.verification.expiresInHours
      );
    }

    // Create user with hashed password and activation token
    const user = await User.create({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      username: req.body.username,
      email: req.body.email,
      password: hashedPassword,
      role: req.body.role ? req.body.role : "user",
      levelId: req.body.levelId,
      locationId: req.body.locationId,
      phoneNumber: req.body.phoneNumber,
      // If password was provided by admin, mark as verified
      // If invited via email (no password), mark as unverified until activation
      emailVerified: req.body.password ? true : false,
      emailVerificationToken: hashedToken,
      emailVerificationExpires: tokenExpires,
    });

    // Send activation email (non-blocking) - only if no password was provided
    if (req.body.email && activationToken && !req.body.password && emailConfig.features.sendWelcomeEmail) {
      emailService.sendAccountActivationEmail(user, activationToken).catch((error) => {
        logger.error('Failed to send activation email', {
          userId: user.id,
          email: user.email,
          error: error.message,
        });
        // Don't fail user creation if email fails
      });

      logger.info('User created successfully - Activation email sent', {
        userId: user.id,
        username: user.username,
        email: user.email,
      });

      return res.status(201).send({
        id: user.id,
        username: user.username,
        role: user.role,
        levelId: user.levelId,
        locationId: user.locationId,
        phoneNumber: user.phoneNumber,
        emailVerified: user.emailVerified,
        message: 'User invited successfully. An activation email has been sent to set their password.',
      });
    }

    // Legacy flow: password provided
    logger.info('User created successfully', {
      userId: user.id,
      username: user.username,
    });

    res.status(201).send({
      id: user.id,
      username: user.username,
      role: user.role,
      levelId: user.levelId,
      locationId: user.locationId,
      phoneNumber: user.phoneNumber,
      emailVerified: user.emailVerified,
      message: 'User created successfully.',
    });
  } catch (error) {
    logger.error("Error creating user", { error: error.message, stack: error.stack });
    res
      .status(500)
      .send({ message: "Error creating user", error: error.message });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const user = await db.User.findOne({
      where: { username: req.body.username },
    });
    if (!user) {
      logger.warn("Login attempt with non-existent username", { username: req.body.username });
      return res.status(401).send({ message: "Invalid username or password" });
    }

    // Decrypt the received password to match the decryption at creation
    const passphrase = process.env.PASSPHRASE;
    if (!passphrase) {
      logger.error("PASSPHRASE not configured");
      return res.status(500).send({ message: "Server configuration error" });
    }

    logger.info("Processing user login", { 
      username: req.body.username,
      hasPassword: !!req.body.password, 
      hasPassphrase: !!passphrase,
      passwordLength: req.body.password ? req.body.password.length : 0
    });

    let decryptedPassword;
    try {
      const decryptedBytes = CryptoJS.AES.decrypt(req.body.password, passphrase);
      decryptedPassword = decryptedBytes.toString(CryptoJS.enc.Utf8);
      
      if (!decryptedPassword || decryptedPassword.length === 0) {
        logger.warn("Password decryption resulted in empty string", { 
          username: req.body.username,
          encryptedLength: req.body.password ? req.body.password.length : 0
        });
        return res.status(401).send({ message: "Invalid username or password" });
      }
      
      logger.info("Password decrypted successfully", { 
        username: req.body.username,
        decryptedLength: decryptedPassword.length 
      });
    } catch (decryptError) {
      logger.error("Password decryption failed", { 
        username: req.body.username,
        error: decryptError.message 
      });
      return res.status(401).send({ message: "Invalid username or password" });
    }

    // Verify the decrypted password with the hashed password stored in the database
    const isPasswordValid = await bcrypt.compare(
      decryptedPassword,
      user.password
    );

    if (!isPasswordValid) {
      logger.warn("Password comparison failed", { username: req.body.username });
      return res.status(401).send({ message: "Invalid username or password" });
    }

    logger.info("Login successful", { username: req.body.username, userId: user.id });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    let levelData = null;
    if (user.levelId) {
      const level = await db.Level.findByPk(user.levelId);
      if (level) {
        levelData = {
          id: level.id,
          name: level.name,
          accessList: level.accessList,
          allowedDashboards: level.allowedDashboards,
          allowedReports: level.allowedReports,
          createdAt: level.createdAt,
          updatedAt: level.updatedAt,
        };
      }
    }

    res.status(200).send({
      id: user.id,
      username: user.username,
      role: user.role,
      accessToken: token,
      level: levelData,
      isDarkMode: !!user.isDarkMode,
    });
  } catch (error) {
    logger.error("Error during user login", { error: error.message, stack: error.stack });
    res.status(500).send({ message: "Server error during login" });
  }
};

exports.updateTheme = async (req, res) => {
  const { isDarkMode } = req.body;
  await db.User.update({ isDarkMode: !!isDarkMode }, { where: { id: req.params.id } });
  res.sendStatus(204);
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ["password"] },
      include: ["level", "location"],
    });
    res.status(200).send(users);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ["password"] },
      include: ["level", "location"],
    });
    if (user) {
      res.status(200).send(user);
    } else {
      res.status(404).send({ message: "User not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Decrypt password if provided
    let updatedFields = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      username: req.body.username,
      phoneNumber: req.body.phoneNumber,
      role: req.body.role,
      levelId: req.body.levelId,
      locationId: req.body.locationId,
    };

    if (req.body.password) {
      const passphrase = process.env.PASSPHRASE; // Use an environment variable for the passphrase
      const decryptedBytes = CryptoJS.AES.decrypt(
        req.body.password,
        passphrase
      );
      const decryptedPassword = decryptedBytes.toString(CryptoJS.enc.Utf8);
      if (decryptedPassword !== "") {
        // Hash the decrypted password
        const hashedPassword = bcrypt.hashSync(decryptedPassword, 10);
        updatedFields.password = hashedPassword;
      }
    }

    // Update user in the database
    const [updated] = await User.update(updatedFields, {
      where: { id: userId },
    });

    if (updated) {
      res.status(200).send({ message: "User updated successfully." });
    } else {
      res.status(404).send({ message: "User not found." });
    }
  } catch (error) {
    logger.error("Failed to update user", { error: error.message, stack: error.stack });
    res.status(500).send(error);
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.destroy({
      where: { id: req.params.id },
    });
    if (user == 1) {
      res.status(200).send({ message: "User deleted successfully." });
    } else {
      res.status(404).send({ message: "User not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getUsers = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;
  try {
    const users = await User.findAndCountAll({
      limit: limit,
      offset: offset,
      attributes: { exclude: ["password"] },
      include: ["level", "location"],
    });
    res.status(200).send({
      total: users.count,
      totalPages: Math.ceil(users.count / limit),
      data: users.rows,
    });
  } catch (error) {
    logger.error("Error deleting user", { error: error.message, stack: error.stack });
    res.status(500).send(error);
  }
};

exports.getUsersByLevelId = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { levelId: req.params.levelId },
      attributes: { exclude: ["password"] },
    });
    if (users.length > 0) {
      res.status(200).send(users);
    } else {
      res.status(404).send({ message: "No users found for this level." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.searchUserByFirstName = async (req, res) => {
  try {
    const users = await User.findAll({
      where: {
        username: db.sequelize.where(
          db.sequelize.fn("LOWER", db.sequelize.col("username")),
          "LIKE",
          `%${req.query.username.toLowerCase()}%`
        ),
      },
      attributes: { exclude: ["password"] },
      include: ["level", "location"],
    });

    res.status(200).send({ data: users });
  } catch (error) {
    logger.error("Error searching users by first name", { error: error.message, stack: error.stack });
    res.status(500).send(error);
  }
};

exports.getAllUsersPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const offset = page * limit;

    const { count, rows } = await User.findAndCountAll({
      limit,
      offset,
      attributes: { exclude: ["password"] },
      include: ["level", "location"], // Include level and location associations
      order: [["createdAt", "DESC"]],
    });

    res.status(200).send({
      total: count,
      pages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    logger.error("Paginated user fetch failed", { error: error.message, stack: error.stack });
    res.status(500).send(error);
  }
};

exports.logoutUser = async (req, res) => {
  try {
    // JWT tokens are stateless, so we can't invalidate them server-side
    // The actual token removal happens on the client side via:
    // 1. NextAuth signOut() clears the NextAuth session
    // 2. deleteCookie("token") clears our custom token cookie
    // 3. This endpoint is called for logging and any future server-side cleanup
    
    logger.info("User logout", { 
      userId: req.user?.id || 'unknown',
      username: req.user?.username || 'unknown',
      timestamp: new Date().toISOString()
    });

    res.status(200).send({ 
      message: "Logout successful",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error during logout", { error: error.message, stack: error.stack });
    res.status(500).send({ message: "Server error during logout" });
  }
};

// Get users by location ID (including users in child locations)
exports.getUsersByLocationId = async (req, res) => {
  try {
    const { locationId } = req.params;
    const { includeChildren = 'true' } = req.query;
    
    let locationIds = [parseInt(locationId)];
    
    // If includeChildren is true, get all child locations
    if (includeChildren === 'true') {
      const childLocations = await db.Location.findAll({
        where: {
          parentLocationId: locationId
        },
        attributes: ['id']
      });
      
      // Add child location IDs to the list
      locationIds = locationIds.concat(childLocations.map(loc => loc.id));
      
      // Recursively get all nested children
      const getAllChildren = async (parentId) => {
        const children = await db.Location.findAll({
          where: { parentLocationId: parentId },
          attributes: ['id']
        });
        
        let allChildren = children.map(child => child.id);
        for (const child of children) {
          const grandChildren = await getAllChildren(child.id);
          allChildren = allChildren.concat(grandChildren);
        }
        return allChildren;
      };
      
      const allChildIds = await getAllChildren(locationId);
      locationIds = locationIds.concat(allChildIds);
    }
    
    const users = await User.findAll({
      where: {
        locationId: locationIds
      },
      attributes: { exclude: ["password"] },
      include: ["level", "location"],
    });
    
    res.status(200).send(users);
  } catch (error) {
    logger.error("Error fetching users by location", { error: error.message, stack: error.stack });
    res.status(500).send({ message: "Error fetching users by location" });
  }
};

// Get user's accessible locations (their location + all child locations)
exports.getUserAccessibleLocations = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findByPk(userId, {
      include: ["location"]
    });
    
    if (!user || !user.locationId) {
      return res.status(200).send([]);
    }
    
    // Get all child locations recursively
    const getAllChildren = async (parentId) => {
      const children = await db.Location.findAll({
        where: { parentLocationId: parentId },
        include: ["children"]
      });
      
      let allLocations = [...children];
      for (const child of children) {
        const grandChildren = await getAllChildren(child.id);
        allLocations = allLocations.concat(grandChildren);
      }
      return allLocations;
    };
    
    const childLocations = await getAllChildren(user.locationId);
    const accessibleLocations = [user.location, ...childLocations];
    
    res.status(200).send(accessibleLocations);
  } catch (error) {
    logger.error("Error fetching user accessible locations", { error: error.message, stack: error.stack });
    res.status(500).send({ message: "Error fetching user accessible locations" });
  }
};