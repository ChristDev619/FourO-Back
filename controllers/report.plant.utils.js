const dayjs = require("dayjs");
const {
    prepareParetoData,
    prepareWaterfallData,
    mergeOverlappingBreakdowns,
    formatMergedBreakdownsForReport,
} = require("./report.utils.js");

const ET_PRODUCTION_DIVISOR = 5678;

function buildEtProductionFields(netLiters, lostLiters) {
    const net = parseFloat(netLiters) || 0;
    const lost = parseFloat(lostLiters) || 0;
    return {
        netLiters: parseFloat(net.toFixed(2)),
        lostLiters: parseFloat(lost.toFixed(2)),
        etProduction: parseFloat((net / ET_PRODUCTION_DIVISOR).toFixed(2)),
        etLost: parseFloat((lost / ET_PRODUCTION_DIVISOR).toFixed(2)),
    };
}

/**
 * Resolve start/end dates from report config (WTD/MTD/YTD/DR).
 */
function resolvePeriodDates(config, reportCreatedAt) {
    const referenceDate = dayjs(reportCreatedAt);
    if (config.wtd) {
        return {
            startDate: referenceDate.startOf("week").toDate(),
            endDate: referenceDate.endOf("day").toDate(),
        };
    }
    if (config.mtd) {
        return {
            startDate: referenceDate.startOf("month").toDate(),
            endDate: referenceDate.endOf("day").toDate(),
        };
    }
    if (config.ytd) {
        return {
            startDate: referenceDate.startOf("year").toDate(),
            endDate: referenceDate.endOf("day").toDate(),
        };
    }
    if (config.dr) {
        return {
            startDate: dayjs(config.startDate).startOf("day").toDate(),
            endDate: dayjs(config.endDate).endOf("day").toDate(),
        };
    }
    return { startDate: null, endDate: null };
}

/**
 * Fetch all production lines under a parent plant location.
 */
async function getLinesForPlant(plantId, { Location, Line, Machine, Op }) {
    const childLocations = await Location.findAll({
        where: { parentLocationId: plantId },
        attributes: ["id", "name"],
    });

    if (!childLocations.length) {
        return [];
    }

    const locationIds = childLocations.map((loc) => loc.id);

    return Line.findAll({
        where: { locationId: { [Op.in]: locationIds } },
        attributes: ["id", "name", "locationId"],
        include: [
            {
                model: Machine,
                as: "machines",
                attributes: ["id", "name"],
            },
            {
                model: Machine,
                as: "bottleneckMachine",
                attributes: ["id", "name"],
            },
            {
                model: Location,
                as: "location",
                attributes: ["id", "name"],
            },
        ],
        order: [["name", "ASC"]],
    });
}

/**
 * Aggregate report metrics for all jobs on a single line within a period.
 */
async function aggregateJobsForLine({
    jobs,
    line,
    report,
    Program,
    extractJobReportData,
    deps,
}) {
    const {
        Recipie,
        sequelize,
        QueryTypes,
        getTagValuesDifference,
        TagRefs,
        Tags,
        TagValues,
        Op,
        formatAlarms,
        calculateEmsMetrics,
        calculateManHourMetrics,
        Meters,
        Unit,
        Generator,
        GeneratorMeter,
        TariffUsage,
        Tariff,
        Sku,
        Location,
        TariffType,
        Settings,
    } = deps;

    const machineIds = line.machines.map((m) => m.id);
    const bottleneckMachine = line.bottleneckMachine;
    const volumeOfDiesel = parseFloat(report.volumeOfDiesel) || 0;
    const manHours = parseFloat(report.manHours) || 0;

    let totalFillerCount = 0;
    let totalNetProduction = 0;
    let totalBottlesLost = 0;
    let totalCasesCount = 0;
    let totalPalletsCount = 0;
    let allAlarms = [];
    let allMergedBreakdownRows = [];
    let allMetrics = [];
    let allStatesResults = [];
    let allWaterfall = [];
    let totalDuration = 0;
    let allPrograms = [];
    let allRecipes = [];
    let allEmsMetrics = [];
    let allManHourMetrics = [];
    let totalNetLiters = 0;
    let totalLostLiters = 0;

    for (const job of jobs) {
        const program = await Program.findByPk(job.programId);
        allPrograms.push(program);
        const jobData = await extractJobReportData({
            job,
            program,
            line,
            machineIds,
            bottleneckMachine,
            Recipie,
            sequelize,
            QueryTypes,
            getTagValuesDifference,
            TagRefs,
            Tags,
            TagValues,
            Op,
            formatAlarms,
            prepareParetoData,
            prepareWaterfallData,
            calculateEmsMetrics,
            calculateManHourMetrics,
            Meters,
            Unit,
            Generator,
            GeneratorMeter,
            TariffUsage,
            Tariff,
            Sku,
            volumeOfDiesel,
            manHours,
            Location,
            TariffType,
            Settings,
        });

        totalFillerCount += jobData.fillerCount;
        totalNetProduction += jobData.netProduction;
        totalBottlesLost += jobData.bottlesLost;
        totalCasesCount += jobData.casesCount;
        totalPalletsCount += jobData.palletsCount;
        allAlarms.push(...jobData.formattedAlarms);
        const jobMergedRaw = mergeOverlappingBreakdowns(jobData.formattedAlarms);
        allMergedBreakdownRows.push(
            ...formatMergedBreakdownsForReport(jobMergedRaw, {
                jobId: job.id,
                jobName: job.jobName,
            })
        );
        allMetrics.push(jobData.metrics);
        totalDuration += jobData.duration;
        allStatesResults.push(...(jobData.statesResults || []));
        allWaterfall.push({ program, job, metrics: jobData.metrics });
        if (jobData.recipe) allRecipes.push(jobData.recipe);
        if (jobData.emsMetrics) allEmsMetrics.push(jobData.emsMetrics);
        if (jobData.manHourMetrics) allManHourMetrics.push(jobData.manHourMetrics);
        totalNetLiters += parseFloat(jobData.emsMetrics?.totalLiters) || 0;
        totalLostLiters += parseFloat(jobData.emsMetrics?.lostLiters) || 0;
    }

    const sumMetrics = (key) =>
        allMetrics.reduce((sum, m) => sum + (parseFloat(m[key]) || 0), 0);

    const paretoMap = {};
    for (const state of allStatesResults) {
        const key = `${state.stateCode}__${state.stateName}`;
        if (!paretoMap[key]) {
            paretoMap[key] = { ...state, total_duration: 0 };
        }
        paretoMap[key].total_duration =
            parseFloat(paretoMap[key].total_duration) + parseFloat(state.total_duration);
    }
    const paretoData = prepareParetoData(Object.values(paretoMap));

    const firstWaterfall = allWaterfall[0];
    const aggWaterfall = {
        labels: firstWaterfall
            ? prepareWaterfallData(
                  firstWaterfall.program,
                  firstWaterfall.job,
                  firstWaterfall.metrics
              ).labels
            : [],
        values: [],
    };
    if (firstWaterfall) {
        const labelCount = aggWaterfall.labels.length;
        for (let i = 0; i < labelCount; i++) {
            let sum = 0;
            for (const wf of allWaterfall) {
                const wfData = prepareWaterfallData(wf.program, wf.job, wf.metrics);
                sum += parseFloat(wfData.values[i]) || 0;
            }
            aggWaterfall.values.push(sum);
        }
    }

    allMergedBreakdownRows.sort(
        (a, b) =>
            new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime()
    );

    const mergedBreakdowns = mergeOverlappingBreakdowns(allAlarms);
    const numberOfBreakdowns = mergedBreakdowns.length;
    const totalDowntime = mergedBreakdowns.reduce((total, breakdown) => {
        const breakdownDuration = dayjs(breakdown.endDateTime).diff(
            dayjs(breakdown.startDateTime),
            "minute"
        );
        return total + breakdownDuration;
    }, 0);
    const alarmsAboveFiveMinutes = allAlarms.filter(
        (alarm) => parseFloat(alarm.duration) >= 5
    );
    const totalAlarmsDowntime = alarmsAboveFiveMinutes.reduce(
        (total, alarm) => total + parseFloat(alarm.duration),
        0
    );
    const mechanicalDowntime = totalAlarmsDowntime;
    const mechanicalAvailability =
        (totalDuration / (totalDuration + mechanicalDowntime)) * 100;
    const mtbf = numberOfBreakdowns > 0 ? totalDuration / numberOfBreakdowns : 0;
    const mttr = numberOfBreakdowns > 0 ? totalDowntime / numberOfBreakdowns : 0;
    const availability =
        sumMetrics("got") && sumMetrics("batchDuration")
            ? (sumMetrics("got") / sumMetrics("batchDuration")) * 100
            : 0;
    const performance =
        sumMetrics("not") && sumMetrics("got")
            ? (sumMetrics("not") / sumMetrics("got")) * 100
            : 0;
    const oee =
        sumMetrics("vot") && totalDuration
            ? (sumMetrics("vot") / totalDuration) * 100
            : 0;

    const sortedJobs = [...jobs].sort(
        (a, b) => new Date(a.actualStartTime) - new Date(b.actualStartTime)
    );
    const firstJob = sortedJobs[0];
    const lastJob = sortedJobs[sortedJobs.length - 1];
    const firstProgram = allPrograms[0];
    const lastProgram = allPrograms[allPrograms.length - 1];
    const recipe = allRecipes[0];

    let programDuration = null;
    if (firstProgram?.startDate && lastProgram?.endDate) {
        const programStart = dayjs(firstProgram.startDate);
        const programEnd = dayjs(lastProgram.endDate);
        if (programStart.isValid() && programEnd.isValid()) {
            programDuration = Math.max(0, programEnd.diff(programStart, "minute"));
        }
    }

    const productionRunBatches = jobs.map((job) => {
        const jobProgram = allPrograms.find((p) => p.id === job.programId);
        const jobRecipe = allRecipes.find((r) => r.skuId === job.skuId);
        const jobDuration = dayjs(job.actualEndTime).diff(
            dayjs(job.actualStartTime),
            "minute"
        );
        const jobProgramDuration =
            jobProgram?.startDate && jobProgram?.endDate
                ? Math.max(
                      0,
                      dayjs(jobProgram.endDate).diff(dayjs(jobProgram.startDate), "minute")
                  )
                : 0;
        return {
            id: job.id,
            jobName: job.jobName,
            programName: jobProgram?.programName || "N/A",
            startTime: job.actualStartTime
                ? dayjs(job.actualStartTime).utc().format("DD/MM/YYYY HH:mm")
                : null,
            endTime: job.actualEndTime
                ? dayjs(job.actualEndTime).utc().format("DD/MM/YYYY HH:mm")
                : null,
            duration: jobDuration,
            programDuration: jobProgramDuration,
            recipeName: jobRecipe?.name || "N/A",
            skuId: job.skuId,
            programId: job.programId,
            lineId: job.lineId,
            lineName: line.name,
        };
    });

    return {
        production: {
            netProduction: totalNetProduction,
            fillerCounter: totalFillerCount,
            packerCounter: totalCasesCount,
            palCounter: totalPalletsCount,
            bottlesLost: totalBottlesLost,
            ...buildEtProductionFields(totalNetLiters, totalLostLiters),
        },
        kpis: {
            availability: availability.toFixed(2),
            performance: performance.toFixed(2),
            oee: oee.toFixed(2),
            mtbf: mtbf.toFixed(2),
            mttr: mttr.toFixed(2),
            metrics: {
                vot: sumMetrics("vot"),
                ql: sumMetrics("ql"),
                not: sumMetrics("not"),
                udt: sumMetrics("udt"),
                got: sumMetrics("got"),
                slt: sumMetrics("slt"),
                sl: sumMetrics("sl"),
                batchDuration: sumMetrics("batchDuration"),
                valueOperatingTime: sumMetrics("valueOperatingTime"),
                programDuration: sumMetrics("programDuration"),
                trueEfficiency:
                    sumMetrics("programDuration") > 0
                        ? parseFloat(
                              (
                                  (sumMetrics("valueOperatingTime") /
                                      sumMetrics("programDuration")) *
                                  100
                              ).toFixed(2)
                          )
                        : 0,
            },
            mechanicalAvailability: mechanicalAvailability.toFixed(2),
        },
        rawMetrics: allMetrics,
        totalDuration,
        totalCasesCount,
        allAlarms,
        allMergedBreakdownRows,
        paretoData,
        aggWaterfall,
        allStatesResults,
        allEmsMetrics,
        allManHourMetrics,
        productionRunBatches,
        general: {
            lineName: line.name,
            jobName: firstJob && lastJob ? `${firstJob.jobName} - ${lastJob.jobName}` : "N/A",
            startTime: firstJob?.actualStartTime
                ? dayjs(firstJob.actualStartTime).utc().format("DD/MM/YYYY HH:mm")
                : null,
            endTime: lastJob?.actualEndTime
                ? dayjs(lastJob.actualEndTime).utc().format("DD/MM/YYYY HH:mm")
                : null,
            duration: totalDuration,
            programName: firstProgram?.programName || "N/A",
            recipeName: recipe?.name || "N/A",
            programDuration,
            bottleneckName: bottleneckMachine?.name || "N/A",
        },
        line,
        jobs,
    };
}

/**
 * Merge multiple line aggregates into plant-level totals.
 */
function mergeLineAggregates(lineResults) {
    let totalFillerCount = 0;
    let totalNetProduction = 0;
    let totalBottlesLost = 0;
    let totalCasesCount = 0;
    let totalPalletsCount = 0;
    let allAlarms = [];
    let allMergedBreakdownRows = [];
    let allMetrics = [];
    let allStatesResults = [];
    let allWaterfall = [];
    let totalDuration = 0;
    let allEmsMetrics = [];
    let allManHourMetrics = [];
    let allJobs = [];
    let allProductionRunBatches = [];
    let totalNetLiters = 0;
    let totalLostLiters = 0;
    const productionByLine = [];
    const kpisByLine = [];
    const lines = [];

    for (const result of lineResults) {
        const p = result.production;
        totalFillerCount += p.fillerCounter;
        totalNetProduction += p.netProduction;
        totalBottlesLost += p.bottlesLost;
        totalCasesCount += p.packerCounter;
        totalPalletsCount += p.palCounter;
        totalNetLiters += parseFloat(p.netLiters) || 0;
        totalLostLiters += parseFloat(p.lostLiters) || 0;

        productionByLine.push({
            lineId: result.line.id,
            lineName: result.line.name,
            netProduction: p.netProduction,
            fillerCounter: p.fillerCounter,
            packerCounter: p.packerCounter,
            palCounter: p.palCounter,
            bottlesLost: p.bottlesLost,
            netLiters: p.netLiters,
            lostLiters: p.lostLiters,
            etProduction: p.etProduction,
            etLost: p.etLost,
        });

        kpisByLine.push({
            lineId: result.line.id,
            lineName: result.line.name,
            ...result.kpis,
            duration: result.totalDuration,
            programDuration: result.general.programDuration,
        });

        allAlarms.push(...result.allAlarms);
        allMergedBreakdownRows.push(...result.allMergedBreakdownRows);
        allMetrics.push(...result.rawMetrics);
        allStatesResults.push(...result.allStatesResults);
        totalDuration += result.totalDuration;
        allEmsMetrics.push(...result.allEmsMetrics);
        allManHourMetrics.push(...result.allManHourMetrics);
        allJobs.push(...result.jobs);
        allProductionRunBatches.push(...result.productionRunBatches);
        lines.push(result.line);
    }

    const sumMetrics = (key) =>
        allMetrics.reduce((sum, m) => sum + (parseFloat(m[key]) || 0), 0);

    const paretoMap = {};
    for (const state of allStatesResults) {
        const key = `${state.stateCode}__${state.stateName}`;
        if (!paretoMap[key]) {
            paretoMap[key] = { ...state, total_duration: 0 };
        }
        paretoMap[key].total_duration =
            parseFloat(paretoMap[key].total_duration) + parseFloat(state.total_duration);
    }
    const paretoData = prepareParetoData(Object.values(paretoMap));

    allMergedBreakdownRows.sort(
        (a, b) =>
            new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime()
    );

    const mergedBreakdowns = mergeOverlappingBreakdowns(allAlarms);
    const numberOfBreakdowns = mergedBreakdowns.length;
    const totalDowntime = mergedBreakdowns.reduce((total, breakdown) => {
        const breakdownDuration = dayjs(breakdown.endDateTime).diff(
            dayjs(breakdown.startDateTime),
            "minute"
        );
        return total + breakdownDuration;
    }, 0);
    const alarmsAboveFiveMinutes = allAlarms.filter(
        (alarm) => parseFloat(alarm.duration) >= 5
    );
    const totalAlarmsDowntime = alarmsAboveFiveMinutes.reduce(
        (total, alarm) => total + parseFloat(alarm.duration),
        0
    );
    const mechanicalDowntime = totalAlarmsDowntime;
    const mechanicalAvailability =
        (totalDuration / (totalDuration + mechanicalDowntime)) * 100;
    const mtbf = numberOfBreakdowns > 0 ? totalDuration / numberOfBreakdowns : 0;
    const mttr = numberOfBreakdowns > 0 ? totalDowntime / numberOfBreakdowns : 0;
    const availability =
        sumMetrics("got") && sumMetrics("batchDuration")
            ? (sumMetrics("got") / sumMetrics("batchDuration")) * 100
            : 0;
    const performance =
        sumMetrics("not") && sumMetrics("got")
            ? (sumMetrics("not") / sumMetrics("got")) * 100
            : 0;
    const oee =
        sumMetrics("vot") && totalDuration
            ? (sumMetrics("vot") / totalDuration) * 100
            : 0;

    const sortedJobs = allJobs.sort(
        (a, b) => new Date(a.actualStartTime) - new Date(b.actualStartTime)
    );
    const firstJob = sortedJobs[0];
    const lastJob = sortedJobs[sortedJobs.length - 1];

    return {
        production: {
            netProduction: totalNetProduction,
            fillerCounter: totalFillerCount,
            packerCounter: totalCasesCount,
            palCounter: totalPalletsCount,
            bottlesLost: totalBottlesLost,
            byLine: productionByLine,
            ...buildEtProductionFields(totalNetLiters, totalLostLiters),
        },
        kpis: {
            availability: availability.toFixed(2),
            performance: performance.toFixed(2),
            oee: oee.toFixed(2),
            mtbf: mtbf.toFixed(2),
            mttr: mttr.toFixed(2),
            metrics: {
                vot: sumMetrics("vot"),
                ql: sumMetrics("ql"),
                not: sumMetrics("not"),
                udt: sumMetrics("udt"),
                got: sumMetrics("got"),
                slt: sumMetrics("slt"),
                sl: sumMetrics("sl"),
                batchDuration: sumMetrics("batchDuration"),
                valueOperatingTime: sumMetrics("valueOperatingTime"),
                programDuration: sumMetrics("programDuration"),
                trueEfficiency:
                    sumMetrics("programDuration") > 0
                        ? parseFloat(
                              (
                                  (sumMetrics("valueOperatingTime") /
                                      sumMetrics("programDuration")) *
                                  100
                              ).toFixed(2)
                          )
                        : 0,
            },
            mechanicalAvailability: mechanicalAvailability.toFixed(2),
        },
        kpisByLine,
        paretoData: [paretoData],
        alarms: allAlarms,
        mergedBreakdowns: allMergedBreakdownRows,
        jobs: allJobs,
        productionRunBatches: allProductionRunBatches.sort(
            (a, b) => new Date(a.startTime) - new Date(b.startTime)
        ),
        totalDuration,
        totalCasesCount,
        allEmsMetrics,
        allManHourMetrics,
        general: {
            startTime: firstJob?.actualStartTime
                ? dayjs(firstJob.actualStartTime).utc().format("DD/MM/YYYY HH:mm")
                : null,
            endTime: lastJob?.actualEndTime
                ? dayjs(lastJob.actualEndTime).utc().format("DD/MM/YYYY HH:mm")
                : null,
            duration: totalDuration,
            jobName:
                firstJob && lastJob ? `${firstJob.jobName} - ${lastJob.jobName}` : "N/A",
        },
        lines,
    };
}

function buildAggregatedEms(allEmsMetrics, totalCasesCount, volumeOfDiesel) {
    const volumeOfDieselNum = parseFloat(volumeOfDiesel) || 0;
    const aggregatedEms = {
        totalKwh: allEmsMetrics.reduce(
            (sum, ems) => sum + (parseFloat(ems.totalKwh) || 0),
            0
        ),
        kwhPer8OzCase: 0,
        kwhPerPack:
            totalCasesCount > 0
                ? allEmsMetrics.reduce(
                      (sum, ems) => sum + (parseFloat(ems.totalKwh) || 0),
                      0
                  ) / totalCasesCount
                : 0,
        volumeOfDiesel: volumeOfDieselNum,
        costOfKwhPerDiesel: 0,
        pricePerLiter:
            allEmsMetrics.length > 0
                ? allEmsMetrics.reduce(
                      (sum, ems) => sum + (parseFloat(ems.pricePerLiter) || 0),
                      0
                  ) / allEmsMetrics.length
                : 0,
        totalLiters: allEmsMetrics.reduce(
            (sum, ems) => sum + (parseFloat(ems.totalLiters) || 0),
            0
        ),
    };

    const EIGHT_OZ_CASE_FACTOR = 5.678;
    aggregatedEms.kwhPer8OzCase =
        aggregatedEms.totalLiters > 0
            ? aggregatedEms.totalKwh / (aggregatedEms.totalLiters / EIGHT_OZ_CASE_FACTOR)
            : 0;
    aggregatedEms.costOfKwhPerDiesel =
        aggregatedEms.pricePerLiter * volumeOfDieselNum;

    aggregatedEms.totalKwh = parseFloat(
        (parseFloat(aggregatedEms.totalKwh) || 0).toFixed(2)
    );
    aggregatedEms.kwhPer8OzCase = parseFloat(
        (parseFloat(aggregatedEms.kwhPer8OzCase) || 0).toFixed(4)
    );
    aggregatedEms.kwhPerPack = parseFloat(
        (parseFloat(aggregatedEms.kwhPerPack) || 0).toFixed(4)
    );
    aggregatedEms.volumeOfDiesel = parseFloat(
        (parseFloat(aggregatedEms.volumeOfDiesel) || 0).toFixed(2)
    );
    aggregatedEms.costOfKwhPerDiesel = parseFloat(
        (parseFloat(aggregatedEms.costOfKwhPerDiesel) || 0).toFixed(2)
    );
    aggregatedEms.pricePerLiter = parseFloat(
        (parseFloat(aggregatedEms.pricePerLiter) || 0).toFixed(2)
    );
    aggregatedEms.totalLiters = parseFloat(
        (parseFloat(aggregatedEms.totalLiters) || 0).toFixed(2)
    );

    return aggregatedEms;
}

function buildAggregatedManHour(allManHourMetrics, totalCasesCount, manHours) {
    const aggregatedManHour = {
        casePerManHour:
            manHours > 0 && totalCasesCount > 0
                ? parseFloat((totalCasesCount / manHours).toFixed(2))
                : "N/A",
        costPerManHour: "N/A",
        costPerManHourValue:
            allManHourMetrics.length > 0
                ? allManHourMetrics.reduce(
                      (sum, mh) => sum + (parseFloat(mh.costPerManHourValue) || 0),
                      0
                  ) / allManHourMetrics.length
                : 0,
        costPerCase: "N/A",
        manHours: manHours || 0,
    };

    if (manHours > 0 && aggregatedManHour.costPerManHourValue > 0) {
        aggregatedManHour.costPerManHour = parseFloat(
            (manHours * aggregatedManHour.costPerManHourValue).toFixed(2)
        );
        if (totalCasesCount > 0 && aggregatedManHour.costPerManHour > 0) {
            aggregatedManHour.costPerCase = parseFloat(
                (aggregatedManHour.costPerManHour / totalCasesCount).toFixed(4)
            );
        }
    }

    if (typeof aggregatedManHour.costPerManHourValue === "number") {
        aggregatedManHour.costPerManHourValue = parseFloat(
            aggregatedManHour.costPerManHourValue.toFixed(2)
        );
    }
    if (typeof aggregatedManHour.costPerManHour === "number") {
        aggregatedManHour.costPerManHour = parseFloat(
            aggregatedManHour.costPerManHour.toFixed(2)
        );
    }

    return aggregatedManHour;
}

module.exports = {
    resolvePeriodDates,
    getLinesForPlant,
    aggregateJobsForLine,
    mergeLineAggregates,
    buildAggregatedEms,
    buildAggregatedManHour,
    ET_PRODUCTION_DIVISOR,
    buildEtProductionFields,
};
