import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  // Create Organization
  const organization = await prisma.organization.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'Acme Corp',
      slug: 'acme-corp',
      timezone: 'UTC',
    },
  });

  // Create Admin User
  const adminPasswordHash = await argon2.hash('Admin@123!');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@acme.corp' },
    update: {},
    create: {
      organizationId: organization.id,
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@acme.corp',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  // Create Department
  const engineeringDept = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Engineering',
      description: 'Software Engineering Department',
    },
  });

  // Create Manager
  const managerPasswordHash = await argon2.hash('Manager@123!');
  const manager = await prisma.user.upsert({
    where: { email: 'manager@acme.corp' },
    update: {},
    create: {
      organizationId: organization.id,
      departmentId: engineeringDept.id,
      firstName: 'Manager',
      lastName: 'User',
      email: 'manager@acme.corp',
      passwordHash: managerPasswordHash,
      role: 'MANAGER',
      isActive: true,
    },
  });

  // Create Employee
  const employeePasswordHash = await argon2.hash('Employee@123!');
  const employee = await prisma.user.upsert({
    where: { email: 'employee@acme.corp' },
    update: {},
    create: {
      organizationId: organization.id,
      departmentId: engineeringDept.id,
      managerId: manager.id,
      firstName: 'Employee',
      lastName: 'User',
      email: 'employee@acme.corp',
      passwordHash: employeePasswordHash,
      role: 'EMPLOYEE',
      isActive: true,
    },
  });

  // Create Default Policy
  await prisma.monitoringPolicy.create({
    data: {
      organizationId: organization.id,
      name: 'Default Policy',
      isDefault: true,
      screenshotEnabled: true,
      applicationTrackingEnabled: true,
      websiteTrackingEnabled: true,
    },
  });

  console.log('Seed completed successfully!');
  console.log('Admin:', admin.email);
  console.log('Manager:', manager.email);
  console.log('Employee:', employee.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
