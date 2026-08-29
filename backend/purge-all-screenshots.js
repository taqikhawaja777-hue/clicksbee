const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function purgeAllScreenshots() {
  console.log('🗑️ Purging all screenshots from MongoDB database & local storage...');

  try {
    // 1. Delete all records from MongoDB collection 'Screenshot'
    const deleteResult = await prisma.screenshot.deleteMany({});
    console.log(`✅ Deleted ${deleteResult.count} screenshot documents from MongoDB Atlas collection 'Screenshot'!`);

    // 2. Delete all files in storage directory
    const storageDir = path.join(__dirname, 'storage');
    if (fs.existsSync(storageDir)) {
      const clearDir = (dirPath) => {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          const curPath = path.join(dirPath, file);
          if (fs.statSync(curPath).isDirectory()) {
            clearDir(curPath);
          } else {
            fs.unlinkSync(curPath);
            console.log(`Deleted file: ${curPath}`);
          }
        }
      };
      clearDir(storageDir);
      console.log('✅ Storage directory cleared!');
    }
  } catch (err) {
    console.error('❌ Error purging screenshots:', err);
  } finally {
    await prisma.$disconnect();
  }
}

purgeAllScreenshots();
