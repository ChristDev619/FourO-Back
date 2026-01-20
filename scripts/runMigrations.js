require('dotenv').config();
const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Database configuration
const sequelize = new Sequelize({
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  dialect: "mysql",
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
  timezone: "+00:00",
  logging: (msg) => logger.info('Database query', { query: msg })
});

async function runMigrations() {
  try {
    logger.info('Connecting to database');
    await sequelize.authenticate();
    logger.info('Database connection established successfully');

    // Get all migration files
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.js'))
      .sort();

    logger.info('Found migration files', { count: migrationFiles.length });

    // Create migrations table if it doesn't exist
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS SequelizeMeta (
        name VARCHAR(255) NOT NULL PRIMARY KEY
      )
    `);

    // Get executed migrations
    const [executedMigrations] = await sequelize.query(
      'SELECT name FROM SequelizeMeta'
    );
    const executedMigrationNames = executedMigrations.map(row => row.name);

    // Find pending migrations
    const pendingMigrations = migrationFiles.filter(
      file => !executedMigrationNames.includes(file)
    );

    if (pendingMigrations.length === 0) {
      logger.info('No pending migrations found');
      return;
    }

    logger.info('Running pending migrations', { count: pendingMigrations.length });

    for (const migrationFile of pendingMigrations) {
      logger.info('Running migration', { file: migrationFile });
      
      try {
        const migration = require(path.join(migrationsDir, migrationFile));
        
        if (typeof migration.up === 'function') {
          await migration.up(sequelize.getQueryInterface(), Sequelize);
          
          // Record the migration as executed
          await sequelize.query(
            'INSERT INTO SequelizeMeta (name) VALUES (?)',
            { replacements: [migrationFile] }
          );
          
          logger.info('Migration completed successfully', { file: migrationFile });
        } else {
          logger.warn('Migration has no up function, skipping', { file: migrationFile });
        }
      } catch (error) {
        logger.error('Error running migration', { file: migrationFile, error: error.message, stack: error.stack });
        throw error;
      }
    }

    logger.info('All migrations completed successfully');

  } catch (error) {
    logger.error('Migration failed', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };
