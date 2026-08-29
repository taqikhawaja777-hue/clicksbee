const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testMongoConnection() {
  console.log('Connecting to MongoDB Atlas Database...');
  
  try {
    const orgCount = await prisma.organization.count();
    console.log(`✅ MongoDB Connected! Total Organizations: ${orgCount}`);

    const screenshotCount = await prisma.screenshot.count();
    console.log(`✅ MongoDB Collection "Screenshot" Connected! Total Screenshots in DB: ${screenshotCount}`);

    // Insert a test capture for umer Sohail into MongoDB collection "Screenshot"
    let defaultOrg = await prisma.organization.findFirst();
    if (!defaultOrg) {
      defaultOrg = await prisma.organization.create({
        data: {
          name: 'StitchMonitor Corp',
          slug: 'stitchmonitor-' + Date.now(),
        }
      });
    }

    let umerUser = await prisma.user.findFirst({
      where: { email: 'umer.sohail@stitchmonitor.com' }
    });

    if (!umerUser) {
      umerUser = await prisma.user.create({
        data: {
          organizationId: defaultOrg.id,
          firstName: 'umer',
          lastName: 'Sohail',
          email: 'umer.sohail@stitchmonitor.com',
          passwordHash: '$2b$10$e8.Z/111111111111111111111111111111111111111111111111',
          role: 'EMPLOYEE',
        }
      });
    }

    const testCapture = await prisma.screenshot.create({
      data: {
        organizationId: defaultOrg.id,
        userId: umerUser.id,
        fileName: `umer_Sohail_test_${Date.now()}.png`,
        filePath: 'base64_storage',
        fileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        fileSize: 1024,
        mimeType: 'image/png',
      }
    });

    console.log(`🚀 Successfully inserted test screenshot record into MongoDB collection "Screenshot"! ID: ${testCapture.id}`);
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testMongoConnection();
