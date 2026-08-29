import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { EmployeesModule } from './employees/employees.module';
import { AttendanceModule } from './attendance/attendance.module';
import { SessionsModule } from './sessions/sessions.module';
import { BreaksModule } from './breaks/breaks.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DevicesModule } from './devices/devices.module';
import { PoliciesModule } from './policies/policies.module';
import { ProductivityModule } from './productivity/productivity.module';
import { ProjectsModule } from './projects/projects.module';
import { ReportsModule } from './reports/reports.module';
import { ScreenshotsModule } from './screenshots/screenshots.module';
import { StorageModule } from './storage/storage.module';
import { TasksModule } from './tasks/tasks.module';
import { TimelineModule } from './timeline/timeline.module';
import { RedisModule } from './redis/redis.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';
import { LicensesModule } from './licenses/licenses.module';
import { LiveModule } from './live/live.module';
import { SyncModule } from './sync/sync.module';
import { TasksCleanupModule } from './common/tasks/tasks.module';
import { ConsentModule } from './consent/consent.module';
import { RecordingsModule } from './recordings/recordings.module';
import { MonitorModule } from './monitor/monitor.module';
import { AiAnalyticsController } from './controllers/aiAnalyticsController';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([{
      ttl: 60,
      limit: 100,
    }]),
    PrismaModule,
    RedisModule,
    AuthModule,
    EmployeesModule,
    AttendanceModule,
    SessionsModule,
    BreaksModule,
    DashboardModule,
    DevicesModule,
    PoliciesModule,
    ProductivityModule,
    ProjectsModule,
    ReportsModule,
    ScreenshotsModule,
    StorageModule,
    TasksModule,
    TimelineModule,
    AuditLogsModule,
    NotificationsModule,
    SearchModule,
    LicensesModule,
    LiveModule,
    SyncModule,
    TasksCleanupModule,
    ConsentModule,
    RecordingsModule,
    MonitorModule,
  ],
  controllers: [AiAnalyticsController, HealthController],
  providers: [],
})
export class AppModule {}
