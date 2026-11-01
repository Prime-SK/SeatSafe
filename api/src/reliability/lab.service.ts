import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RegistrationError } from '../auth/registration-error.js';
import { LabRunner, newReport } from './lab-runner.js';
import type { LabContext } from './lab-runner.js';
import type { LabReport, LabScenario } from './lab.types.js';
@Injectable()
export class LabService implements OnApplicationShutdown {
  readonly runner: LabRunner;
  private readonly reports = new Map<string, LabReport>();
  private readonly owned = new Map<string, LabContext>();
  private active: Promise<void> | null = null;
  private stopping = false;
  constructor(
    @InjectDataSource() database: DataSource,
    private readonly config: ConfigService,
  ) {
    this.runner = new LabRunner(database.options);
  }
  enabled(): boolean {
    return this.config.get('RELIABILITY_LAB_ENABLED') === true;
  }
  start(owner: string, runId: string, scenario: LabScenario): LabReport {
    const key = `${owner}:${runId}`,
      existing = this.reports.get(key);
    if (existing) {
      if (existing.scenario !== scenario)
        throw new RegistrationError(
          409,
          'LAB_RUN_CONFLICT',
          'Run ID was already used for another scenario',
        );
      return structuredClone(existing);
    }
    if (this.stopping || this.active || this.owned.size)
      throw new RegistrationError(
        409,
        'LAB_BUSY',
        'The reliability lab is busy',
      );
    const report = newReport(runId, scenario);
    this.reports.set(key, report);
    this.active = Promise.resolve()
      .then(() => this.execute(key, report))
      .finally(() => {
        this.active = null;
        this.prune();
      });
    return structuredClone(report);
  }
  read(owner: string, runId: string): LabReport {
    const report = this.reports.get(`${owner}:${runId}`);
    if (!report)
      throw new RegistrationError(
        404,
        'LAB_RUN_NOT_FOUND',
        'Lab run not found',
      );
    return structuredClone(report);
  }
  private async execute(key: string, report: LabReport): Promise<void> {
    let failed = false;
    try {
      const job = this.runner.create();
      this.owned.set(key, job);
      await this.runner.prepare(job, report);
      await this.runner.execute(job, report);
    } catch {
      failed = true;
      report.message = 'The lab run could not be completed';
    } finally {
      report.stage = 'cleaning';
      const job = this.owned.get(key);
      try {
        if (job) await this.runner.cleanup(job);
        this.owned.delete(key);
        report.cleanup = 'removed';
      } catch {
        failed = true;
        report.cleanup = 'failed';
        report.message =
          'Lab cleanup could not be confirmed. Further runs are blocked; stop the lab and inspect its owned resources.';
      }
      report.status = failed
        ? 'failed'
        : report.invariantsPassed
          ? 'completed'
          : 'incomplete';
      report.stage = 'finished';
      report.completedAt = new Date().toISOString();
      if (!failed)
        report.message =
          report.status === 'completed'
            ? 'Observed invariants passed and isolated data was removed'
            : 'The experiment is incomplete or its observed outcomes differ from expectations';
    }
  }
  private prune(): void {
    const terminal = [...this.reports].filter(
      ([key, r]) => r.status !== 'running' && !this.owned.has(key),
    );
    while (terminal.length > 10) {
      const removed = terminal.shift()!;
      this.reports.delete(removed[0]);
    }
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.active;
    for (const [key, job] of this.owned) {
      try {
        await this.runner.cleanup(job);
        this.owned.delete(key);
        const report = this.reports.get(key);
        if (report) report.cleanup = 'removed';
      } catch {
        console.error(
          `Reliability lab cleanup remains unresolved for owned schema ${job.schema}`,
        );
      }
    }
  }
}
