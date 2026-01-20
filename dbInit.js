// dbInit.js
console.log(" DB_USER from ENV:", process.env.DB_USER);
const { Sequelize, DataTypes, Op } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        dialect: "mysql",
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false,
            },
        },
        timezone: "+00:00", // for writing to DB
        pool: {
            max: 10,      // Optimal for first client - plenty of headroom
            min: 2,       // Keep 2 connections warm for better response times
            acquire: 30000, // 30s timeout (faster failure detection)
            idle: 15000   // 15s idle time (keep connections a bit longer)
        }
    }
);

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;
db.Op = Op;
// Import models
db.Generator = require("./models/generator.model")(sequelize, Sequelize);
db.Location = require("./models/location.model")(sequelize, Sequelize);
db.Machine = require("./models/machine.model")(sequelize, Sequelize);
db.Meters = require("./models/meters.model")(sequelize, Sequelize);
db.User = require("./models/user.model")(sequelize, DataTypes);
db.Profile = require("./models/profile.model")(sequelize, DataTypes);
db.AccessList = require("./models/accessList.model")(sequelize, DataTypes);
db.Level = require("./models/level.model")(sequelize, DataTypes);
db.Tags = require("./models/tags.model")(sequelize, DataTypes);
db.TagValues = require("./models/tagValues.model")(sequelize, DataTypes);
db.Dashboard = require("./models/dashboard.model")(sequelize, DataTypes);
db.Card = require("./models/card.model")(sequelize, DataTypes);
db.Tariff = require("./models/tariff.model")(sequelize, DataTypes);
db.TariffType = require("./models/TariffType.model")(sequelize, DataTypes);
db.TariffUsage = require("./models/tariffUsage.model")(sequelize, DataTypes);
db.Unit = require("./models/unit.model")(sequelize, DataTypes);
db.GeneratorMachineMeterTagValues =
  require("./models/GeneratorMachineMeterTagValues")(sequelize, DataTypes);
db.AlarmMachineLineView = require("./models/AlarmMachineLineView")(
  sequelize,
  DataTypes
);
db.GeneratorMeter = require("./models/generatorMeter.model")(
  sequelize,
  DataTypes
);

db.OEETimeSeries = require("./models/OEETimeSeries.model")(sequelize, DataTypes);
db.Alarm = require("./models/Alarm.model")(sequelize, DataTypes);
db.Job = require("./models/Job.model")(sequelize, DataTypes);
db.Line = require("./models/Line.model")(sequelize, DataTypes);
db.LineMachine = require("./models/LineMachine.model")(sequelize, DataTypes);
db.LineRecipie = require("./models/LineRecipie.model")(sequelize, DataTypes);
db.PlannedDowntime = require("./models/PlannedDowntime.model")(
  sequelize,
  DataTypes
);
db.Program = require("./models/Program.model")(sequelize, DataTypes);
db.Reason = require("./models/Reason.model")(sequelize, DataTypes);
db.Recipie = require("./models/Recipie.model")(sequelize, DataTypes);
db.PackageType = require("./models/PackageType.model")(sequelize, DataTypes);
db.Sku = require("./models/Sku.model")(sequelize, DataTypes);
db.DesignSpeed = require("./models/DesignSpeed.model")(sequelize, DataTypes);
db.Status = require("./models/Status.model")(sequelize, DataTypes);
db.JobLineMachineTag = require("./models/JobLineMachineTag.model")(
  sequelize,
  DataTypes
);
db.AlarmAggregation = require("./models/AlarmAggregation.model")(
  sequelize,
  DataTypes
);

db.MachineStateAggregation = require("./models/MachineStateAggregation.model")(
  sequelize,
  DataTypes
);

db.Report = require("./models/Report.model")(sequelize, DataTypes);
db.Settings = require("./models/Settings.model")(sequelize, DataTypes);
db.UserDashboardOrder = require("./models/userDashboardOrder.model")(sequelize, DataTypes);
db.UserReportOrder = require("./models/userReportOrder.model")(sequelize, DataTypes);
db.NotificationEvent = require("./models/NotificationEvent.model")(sequelize, DataTypes);
db.Notification = require("./models/Notification.model")(sequelize, DataTypes);
db.DemandForecast = require("./models/DemandForecast.model")(sequelize, DataTypes);
db.SeasonalityData = require("./models/SeasonalityData.model")(sequelize, DataTypes);
db.MonthlyForecast = require("./models/MonthlyForecast.model")(sequelize, DataTypes);
db.LineData = require("./models/LineData.model")(sequelize, DataTypes);
db.PackageSummary = require("./models/PackageSummary.model")(sequelize, DataTypes);


// Setup associations
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

module.exports = db;
