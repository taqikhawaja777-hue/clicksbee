import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();

    // $connect() only guarantees the query engine is reachable, not that
    // its connection pool holds more than one live connection to the
    // (remote, cross-network) Atlas cluster - measured directly: a cold
    // pool serialized 4 concurrent queries in ~2.3s, but the same 4
    // queries took ~125ms once 2-3 earlier concurrent rounds had already
    // forced the pool to open more connections. Firing a few harmless
    // concurrent queries here pays that one-time cost at boot instead of
    // on whichever real request happens to be first (e.g. the Employee
    // Directory, which fans out several relations in parallel per load).
    try {
      await Promise.all([
        this.user.findFirst({ select: { id: true } }),
        this.user.findFirst({ select: { id: true } }),
        this.user.findFirst({ select: { id: true } }),
      ]);
    } catch {
      // Best-effort warm-up only - a slow first real request is a much
      // smaller problem than failing server startup over it.
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
