const { LineRecipie, Recipie, Sku, DesignSpeed } = require("../../dbInit");

/**
 * Get design speed for a job based on its SKU and line
 * @param {Object} job - Job instance with skuId
 * @param {number} lineId - Line ID
 * @returns {Promise<number>} Design speed in bottles/min (0 if not found)
 */
async function getDesignSpeedForJob(job, lineId) {
  try {
    // If job has no SKU, return 0
    if (!job.skuId) {
      console.warn(`[DesignSpeed] Job ${job.id} has no skuId - returning 0`);
      return 0;
    }

    console.log(`[DesignSpeed] Looking up design speed for Job ${job.id}, SKU ${job.skuId}, Line ${lineId}`);

    // Find the LineRecipie that links this line to the recipe for this SKU
    const lineRecipe = await LineRecipie.findOne({
      where: { lineId },
      include: [
        {
          model: Recipie,
          as: 'recipie',
          where: { skuId: job.skuId },
          include: [
            {
              model: Sku,
              as: 'sku',
              attributes: ['id', 'name']
            }
          ]
        },
        {
          model: DesignSpeed,
          as: 'designSpeed'
        }
      ]
    });

    if (!lineRecipe) {
      console.warn(`[DesignSpeed] No LineRecipie found for Line ${lineId} with SKU ${job.skuId}`);
      return 0;
    }

    if (!lineRecipe.designSpeed) {
      console.warn(`[DesignSpeed] LineRecipie found but no DesignSpeed linked (Line ${lineId}, SKU ${job.skuId})`);
      return 0;
    }

    const designSpeedValue = parseFloat(lineRecipe.designSpeed.value) || 0;
    
    console.log(`[DesignSpeed] ✓ Found design speed: ${designSpeedValue} bottles/min for SKU "${lineRecipe.recipie.sku.name}"`);
    
    return designSpeedValue;

  } catch (error) {
    console.error(`[DesignSpeed] Error fetching design speed for Job ${job.id}:`, error.message);
    return 0;
  }
}

/**
 * Get design speed and SKU info for a job
 * @param {Object} job - Job instance with skuId
 * @param {number} lineId - Line ID
 * @returns {Promise<{designSpeed: number, sku: Object|null}>}
 */
async function getDesignSpeedAndSkuForJob(job, lineId) {
  try {
    if (!job.skuId) {
      return { designSpeed: 0, sku: null };
    }

    const lineRecipe = await LineRecipie.findOne({
      where: { lineId },
      include: [
        {
          model: Recipie,
          as: 'recipie',
          where: { skuId: job.skuId },
          include: [
            {
              model: Sku,
              as: 'sku'
            }
          ]
        },
        {
          model: DesignSpeed,
          as: 'designSpeed'
        }
      ]
    });

    if (!lineRecipe || !lineRecipe.designSpeed) {
      return { designSpeed: 0, sku: lineRecipe?.recipie?.sku || null };
    }

    return {
      designSpeed: parseFloat(lineRecipe.designSpeed.value) || 0,
      sku: lineRecipe.recipie.sku
    };

  } catch (error) {
    console.error(`[DesignSpeed] Error in getDesignSpeedAndSkuForJob:`, error.message);
    return { designSpeed: 0, sku: null };
  }
}

module.exports = {
  getDesignSpeedForJob,
  getDesignSpeedAndSkuForJob
};

