/**
 * Backfill Script: Populate currentValue for all existing tags
 * 
 * This script fetches the latest value for each tag from TagValues
 * and updates the Tags.currentValue column
 */

const { Tags, TagValues, sequelize } = require("../dbInit");

async function backfillCurrentValues() {
  const startTime = Date.now();
  console.log('🚀 Starting backfill of current tag values...\n');

  try {
    // Fetch all tags
    const allTags = await Tags.findAll({
      attributes: ['id', 'name'],
      raw: true
    });

    console.log(`📊 Found ${allTags.length} tags to process\n`);

    let successCount = 0;
    let noDataCount = 0;
    let errorCount = 0;

    // Process each tag
    for (const tag of allTags) {
      try {
        // Get latest value for this tag using optimized query
        const latestValue = await sequelize.query(`
          SELECT tv.tagId, tv.value, tv.createdAt
          FROM TagValues tv
          WHERE tv.tagId = :tagId
          ORDER BY tv.createdAt DESC
          LIMIT 1
        `, {
          replacements: { tagId: tag.id },
          type: sequelize.QueryTypes.SELECT
        });

        if (latestValue && latestValue.length > 0) {
          const { value, createdAt } = latestValue[0];
          
          // Update Tags table
          await Tags.update(
            { 
              currentValue: value,
              lastValueUpdatedAt: createdAt
            },
            { where: { id: tag.id } }
          );

          successCount++;
          console.log(`✅ Tag ${tag.id} (${tag.name}): ${value} at ${createdAt}`);
        } else {
          noDataCount++;
          console.log(`⚠️  Tag ${tag.id} (${tag.name}): No data found`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ Tag ${tag.id} (${tag.name}): ${error.message}`);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(60));
    console.log('📈 BACKFILL COMPLETE');
    console.log('='.repeat(60));
    console.log(`✅ Success: ${successCount} tags updated`);
    console.log(`⚠️  No Data: ${noDataCount} tags`);
    console.log(`❌ Errors: ${errorCount} tags`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run the backfill
backfillCurrentValues()
  .then(() => {
    console.log('\n✨ Backfill script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Backfill script failed:', error);
    process.exit(1);
  });

