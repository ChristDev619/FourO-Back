module.exports = (sequelize, DataTypes) => {
    const OEETimeSeries = sequelize.define('OEETimeSeries', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      jobId: { type: DataTypes.INTEGER, allowNull: false },
      minute: { type: DataTypes.INTEGER, allowNull: false }, // minute offset from job start
      timestamp: { type: DataTypes.DATE, allowNull: false },
      oee: { type: DataTypes.FLOAT, allowNull: false },
      availability: { type: DataTypes.FLOAT, allowNull: false },
      performance: { type: DataTypes.FLOAT, allowNull: false },
      quality: { type: DataTypes.FLOAT, allowNull: false },
      bottleCount: { type: DataTypes.INTEGER, allowNull: false },
      // Add more fields if needed
    }, {
      indexes: [
        { fields: ['jobId', 'minute'] },
        { fields: ['jobId', 'timestamp'] }
      ],
      tableName: 'OEETimeSeries',
      timestamps: false
    });
    return OEETimeSeries;
  };