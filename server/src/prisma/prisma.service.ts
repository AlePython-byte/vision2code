import { Injectable, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    // Only connect if DATABASE_URL is set in environment
    if (process.env.DATABASE_URL) {
      await this.$connect();
    }
  }

  async onModuleDestroy() {
    if (process.env.DATABASE_URL) {
      await this.$disconnect();
    }
  }
}

